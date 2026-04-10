/**
 * Description improver — calls OpenCode to generate a better skill
 * description based on eval results.
 *
 * Port of scripts/improve_description.py.
 *
 * Uses `Bun.$` to call `opencode run` with a temp file prompt (via --file).
 * Parses `<new_description>` tags from the response. Retries once if the
 * description exceeds 1024 characters.
 */

import { mkdirSync, unlinkSync, writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { randomBytes } from "crypto"

import type { EvalOutput, EvalResultItem } from "./run-eval"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Run `opencode run` with a prompt written to a temporary file.
 */
async function callOpenCode(
  prompt: string,
  model: string | undefined,
  timeout = 300,
): Promise<string> {
  const tmpPath = join(tmpdir(), `skill-creator-${randomBytes(6).toString("hex")}.md`)
  writeFileSync(tmpPath, prompt)

  try {
    const cmd = ["opencode", "run", "--format", "json"]
    if (model) cmd.push("--model", model)
    cmd.push("--file", tmpPath, "Process the attached file and follow its instructions.")

    const proc = Bun.spawn(cmd, {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
    })

    // Collect stdout with timeout. Prefer structured text events from JSON mode.
    let stdout = ""
    let lineBuffer = ""
    const textParts: string[] = []
    const decoder = new TextDecoder()
    const reader = proc.stdout.getReader()
    const timeoutMs = timeout * 1000

    const consumeLine = (line: string) => {
      const trimmed = line.trim()
      if (!trimmed) return

      try {
        const event = JSON.parse(trimmed) as Record<string, unknown>
        if (event.type !== "text") return
        const part = event.part as Record<string, unknown> | undefined
        if (!part || typeof part !== "object") return
        const text = part.text
        if (typeof text === "string") {
          textParts.push(text)
        }
      } catch {
        // Ignore non-JSON lines.
      }
    }

    const flushLines = (final = false) => {
      let idx = lineBuffer.indexOf("\n")
      while (idx !== -1) {
        const line = lineBuffer.slice(0, idx)
        lineBuffer = lineBuffer.slice(idx + 1)
        consumeLine(line)
        idx = lineBuffer.indexOf("\n")
      }

      if (final && lineBuffer.trim()) {
        consumeLine(lineBuffer)
        lineBuffer = ""
      }
    }

    const timeoutId = setTimeout(() => {
      if (proc.exitCode === null) {
        proc.kill()
      }
    }, timeoutMs)

    try {
      while (true) {
        const result = await reader.read()
        if (result.done) break
        if (result.value) {
          const chunk = decoder.decode(result.value, { stream: true })
          stdout += chunk
          lineBuffer += chunk
          flushLines()
        }
      }

      flushLines(true)
      await proc.exited
    } finally {
      clearTimeout(timeoutId)
      reader.releaseLock()

      if (proc.exitCode === null) {
        proc.kill()
        await proc.exited
      }
    }

    // Check stderr for errors
    const stderrReader = proc.stderr.getReader()
    let stderr = ""
    try {
      while (true) {
        const r = await stderrReader.read()
        if (r.done) break
        if (r.value) stderr += decoder.decode(r.value, { stream: true })
      }
    } finally {
      stderrReader.releaseLock()
    }

    if (proc.exitCode !== 0 && proc.exitCode !== null) {
      throw new Error(`opencode run exited ${proc.exitCode}\nstderr: ${stderr}`)
    }

    if (textParts.length > 0) {
      return textParts.join("")
    }

    return stdout
  } finally {
    try {
      unlinkSync(tmpPath)
    } catch {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HistoryEntry {
  description: string
  passed?: number
  failed?: number
  total?: number
  train_passed?: number
  train_failed?: number
  train_total?: number
  test_passed?: number | null
  test_failed?: number | null
  test_total?: number | null
  results?: EvalResultItem[]
  note?: string
}

export interface ImproveDescriptionOptions {
  skillName: string
  skillContent: string
  currentDescription: string
  evalResults: EvalOutput
  history: HistoryEntry[]
  model: string | undefined
  testResults?: EvalOutput | null
  logDir?: string | null
  iteration?: number | null
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Call OpenCode to improve the description based on eval results.
 * Returns the new description string.
 */
export async function improveDescription(
  opts: ImproveDescriptionOptions,
): Promise<string> {
  const {
    skillName,
    skillContent,
    currentDescription,
    evalResults,
    history,
    model,
    testResults,
    logDir,
    iteration,
  } = opts

  const failedTriggers = evalResults.results.filter(
    (r) => r.should_trigger && !r.pass,
  )
  const falseTriggers = evalResults.results.filter(
    (r) => !r.should_trigger && !r.pass,
  )

  // Build scores summary
  const trainScore = `${evalResults.summary.passed}/${evalResults.summary.total}`
  let scoresSummary: string
  if (testResults) {
    const testScore = `${testResults.summary.passed}/${testResults.summary.total}`
    scoresSummary = `Train: ${trainScore}, Test: ${testScore}`
  } else {
    scoresSummary = `Train: ${trainScore}`
  }

  let prompt = `You are optimizing a skill description for an OpenCode skill called "${skillName}". A "skill" is sort of like a prompt, but with progressive disclosure -- there's a title and description that the agent sees when deciding whether to use the skill, and then if it does use the skill, it reads the .md file which has lots more details and potentially links to other resources in the skill folder like helper files and scripts and additional documentation or examples.

The description appears in the agent's "available_skills" list. When a user sends a query, the agent decides whether to invoke the skill based solely on the title and on this description. Your goal is to write a description that triggers for relevant queries, and doesn't trigger for irrelevant ones.

Here's the current description:
<current_description>
"${currentDescription}"
</current_description>

Current scores (${scoresSummary}):
<scores_summary>
`

  if (failedTriggers.length > 0) {
    prompt += "FAILED TO TRIGGER (should have triggered but didn't):\n"
    for (const r of failedTriggers) {
      prompt += `  - "${r.query}" (triggered ${r.triggers}/${r.runs} times)\n`
    }
    prompt += "\n"
  }

  if (falseTriggers.length > 0) {
    prompt += "FALSE TRIGGERS (triggered but shouldn't have):\n"
    for (const r of falseTriggers) {
      prompt += `  - "${r.query}" (triggered ${r.triggers}/${r.runs} times)\n`
    }
    prompt += "\n"
  }

  if (history.length > 0) {
    prompt +=
      "PREVIOUS ATTEMPTS (do NOT repeat these — try something structurally different):\n\n"
    for (const h of history) {
      const trainS = `${h.train_passed ?? h.passed ?? 0}/${h.train_total ?? h.total ?? 0}`
      const testS =
        h.test_passed != null
          ? `${h.test_passed}/${h.test_total ?? "?"}`
          : null
      const scoreStr = `train=${trainS}` + (testS ? `, test=${testS}` : "")
      prompt += `<attempt ${scoreStr}>\n`
      prompt += `Description: "${h.description}"\n`
      if (h.results) {
        prompt += "Train results:\n"
        for (const r of h.results) {
          const status = r.pass ? "PASS" : "FAIL"
          prompt += `  [${status}] "${r.query.slice(0, 80)}" (triggered ${r.triggers}/${r.runs})\n`
        }
      }
      if (h.note) {
        prompt += `Note: ${h.note}\n`
      }
      prompt += "</attempt>\n\n"
    }
  }

  prompt += `</scores_summary>

Skill content (for context on what the skill does):
<skill_content>
${skillContent}
</skill_content>

Based on the failures, write a new and improved description that is more likely to trigger correctly. When I say "based on the failures", it's a bit of a tricky line to walk because we don't want to overfit to the specific cases you're seeing. So what I DON'T want you to do is produce an ever-expanding list of specific queries that this skill should or shouldn't trigger for. Instead, try to generalize from the failures to broader categories of user intent and situations where this skill would be useful or not useful. The reason for this is twofold:

1. Avoid overfitting
2. The list might get loooong and it's injected into ALL queries and there might be a lot of skills, so we don't want to blow too much space on any given description.

Concretely, your description should not be more than about 100-200 words, even if that comes at the cost of accuracy. There is a hard limit of 1024 characters — descriptions over that will be truncated, so stay comfortably under it.

Here are some tips that we've found to work well in writing these descriptions:
- The skill should be phrased in the imperative -- "Use this skill for" rather than "this skill does"
- The skill description should focus on the user's intent, what they are trying to achieve, vs. the implementation details of how the skill works.
- The description competes with other skills for the agent's attention — make it distinctive and immediately recognizable.
- If you're getting lots of failures after repeated attempts, change things up. Try different sentence structures or wordings.

I'd encourage you to be creative and mix up the style in different iterations since you'll have multiple opportunities to try different approaches and we'll just grab the highest-scoring one at the end. 

Please respond with only the new description text in <new_description> tags, nothing else.`

  let text = await callOpenCode(prompt, model)

  const match = text.match(/<new_description>([\s\S]*?)<\/new_description>/)
  let description = match
    ? match[1].trim().replace(/^["']|["']$/g, "")
    : text.trim().replace(/^["']|["']$/g, "")

  const transcript: Record<string, unknown> = {
    iteration,
    prompt,
    response: text,
    parsed_description: description,
    char_count: description.length,
    over_limit: description.length > 1024,
  }

  // Safety net: if the description is over 1024 chars, ask for a shorter one
  if (description.length > 1024) {
    const shortenPrompt =
      `${prompt}\n\n` +
      `---\n\n` +
      `A previous attempt produced this description, which at ` +
      `${description.length} characters is over the 1024-character hard limit:\n\n` +
      `"${description}"\n\n` +
      `Rewrite it to be under 1024 characters while keeping the most ` +
      `important trigger words and intent coverage. Respond with only ` +
      `the new description in <new_description> tags.`

    const shortenText = await callOpenCode(shortenPrompt, model)
    const shortenMatch = shortenText.match(
      /<new_description>([\s\S]*?)<\/new_description>/,
    )
    const shortened = shortenMatch
      ? shortenMatch[1].trim().replace(/^["']|["']$/g, "")
      : shortenText.trim().replace(/^["']|["']$/g, "")

    transcript.rewrite_prompt = shortenPrompt
    transcript.rewrite_response = shortenText
    transcript.rewrite_description = shortened
    transcript.rewrite_char_count = shortened.length
    description = shortened
  }

  transcript.final_description = description

  if (logDir) {
    mkdirSync(logDir, { recursive: true })
    const logFile = join(logDir, `improve_iter_${iteration ?? "unknown"}.json`)
    writeFileSync(logFile, JSON.stringify(transcript, null, 2))
  }

  return description
}
