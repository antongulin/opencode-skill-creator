/**
 * Trigger evaluation — tests whether a skill description causes OpenCode
 * to invoke (read) the skill for a set of queries.
 *
 * Port of scripts/run_eval.py.
 *
 * Uses `Bun.$` to shell out to `opencode run`. For each query a temporary
 * skill is created in .opencode/skills/ so it appears in the available_skills
 * list. The output is scanned for the temporary skill name to determine
 * whether the skill was triggered.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs"
import { dirname, join, parse } from "path"
import { randomBytes } from "crypto"

const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EvalItem {
  query: string
  should_trigger: boolean
}

export interface EvalResultItem {
  query: string
  should_trigger: boolean
  trigger_rate: number
  triggers: number
  runs: number
  successful_runs: number
  errors: number
  pass: boolean
}

export interface EvalOutput {
  skill_name: string
  description: string
  results: EvalResultItem[]
  summary: {
    total: number
    passed: number
    failed: number
    run_errors: number
    queries_with_errors: number
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Walk up from `cwd` looking for `.opencode/` or `.claude/` to find the
 * project root — mirrors how OpenCode discovers its project root.
 */
export function findProjectRoot(cwd?: string): string {
  let current = cwd ?? process.cwd()
  const { root } = parse(current)

  while (true) {
    if (existsSync(join(current, ".opencode"))) return current
    if (existsSync(join(current, ".claude"))) return current
    const parent = dirname(current)
    if (parent === current || parent === root) break
    current = parent
  }
  return cwd ?? process.cwd()
}

/**
 * Run a single query against `opencode run` and return whether the
 * temporary skill name appeared in the output.
 */
async function runSingleQuery(
  query: string,
  skillName: string,
  skillDescription: string,
  timeout: number,
  projectRoot: string,
  model?: string,
): Promise<boolean> {
  if (!SKILL_NAME_RE.test(skillName)) {
    throw new Error(
      `Invalid skill name "${skillName}". Expected kebab-case (lowercase letters, numbers, and hyphens only).`,
    )
  }

  const uniqueId = randomBytes(4).toString("hex")
  const cleanName = `${skillName}-skill-${uniqueId}`
  const skillsDir = join(projectRoot, ".opencode", "skills", cleanName)
  const skillFile = join(skillsDir, "SKILL.md")

  try {
    mkdirSync(skillsDir, { recursive: true })

    // Use YAML block scalar to avoid breaking on quotes in description
    const indentedDesc = skillDescription.split("\n").join("\n  ")
    const skillContent = [
      "---",
      `name: ${cleanName}`,
      "description: |",
      `  ${indentedDesc}`,
      "---",
      "",
      `# ${skillName}`,
      "",
      `This skill handles: ${skillDescription}`,
      "",
    ].join("\n")
    writeFileSync(skillFile, skillContent)

    const cmd = ["opencode", "run", "--format", "json"]
    if (model) cmd.push("--model", model)
    cmd.push(query)

    const proc = Bun.spawn(cmd, {
      cwd: projectRoot,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
    })

    // Collect output with timeout and detect skill invocation from JSON events.
    let buffer = ""
    let triggered = false
    const decoder = new TextDecoder()
    const reader = proc.stdout.getReader()
    const stderrReader = proc.stderr.getReader()
    const stderrDecoder = new TextDecoder()
    const maxStderrChars = 64 * 1024
    let stderrTail = ""
    const timeoutMs = timeout * 1000

    const stderrDrained = (async () => {
      try {
        while (true) {
          const result = await stderrReader.read()
          if (result.done) break
          if (!result.value) continue

          stderrTail += stderrDecoder.decode(result.value, { stream: true })
          if (stderrTail.length > maxStderrChars) {
            stderrTail = stderrTail.slice(-maxStderrChars)
          }
        }

        stderrTail += stderrDecoder.decode()
        if (stderrTail.length > maxStderrChars) {
          stderrTail = stderrTail.slice(-maxStderrChars)
        }
      } finally {
        stderrReader.releaseLock()
      }
    })()

    const consumeLine = (line: string) => {
      const trimmed = line.trim()
      if (!trimmed) return

      try {
        const event = JSON.parse(trimmed) as Record<string, unknown>
        if (event.type !== "tool_use") return

        const part = event.part as Record<string, unknown> | undefined
        if (!part || typeof part !== "object") return

        const toolName = typeof part.tool === "string" ? part.tool : ""
        if (toolName !== "skill" && toolName !== "read") return

        const serialized = JSON.stringify(part)
        if (serialized.includes(cleanName)) {
          triggered = true
        }
      } catch {
        // Ignore non-JSON lines and malformed events.
      }
    }

    const flushBuffer = (final = false) => {
      let newlineIndex = buffer.indexOf("\n")
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex)
        buffer = buffer.slice(newlineIndex + 1)
        consumeLine(line)
        newlineIndex = buffer.indexOf("\n")
      }

      if (final && buffer.trim()) {
        consumeLine(buffer)
        buffer = ""
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
          buffer += decoder.decode(result.value, { stream: true })
          flushBuffer()
        }
      }

      const finalChunk = decoder.decode()
      if (finalChunk) {
        buffer += finalChunk
      }

      flushBuffer(true)
      await proc.exited
      await stderrDrained

      if ((proc.exitCode ?? 0) !== 0) {
        const cleanedStderr = stderrTail.trim()
        throw new Error(
          cleanedStderr
            ? `opencode run exited ${proc.exitCode}: ${cleanedStderr}`
            : `opencode run exited ${proc.exitCode}`,
        )
      }
    } finally {
      clearTimeout(timeoutId)
      reader.releaseLock()

      if (proc.exitCode === null) {
        proc.kill()
        await proc.exited
      }

      await stderrDrained.catch(() => undefined)
    }

    return triggered
  } finally {
    // Clean up the temporary skill directory
    if (existsSync(skillsDir)) {
      rmSync(skillsDir, { recursive: true, force: true })
    }
  }
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export interface RunEvalOptions {
  evalSet: EvalItem[]
  skillName: string
  description: string
  numWorkers: number
  timeout: number
  projectRoot: string
  runsPerQuery?: number
  triggerThreshold?: number
  model?: string
}

/**
 * Run the full eval set and return results.
 *
 * Parallelism is implemented via `Promise.all` with a concurrency limiter
 * instead of Python's ProcessPoolExecutor.
 */
export async function runEval(opts: RunEvalOptions): Promise<EvalOutput> {
  const {
    evalSet,
    skillName,
    description,
    numWorkers,
    timeout,
    projectRoot,
    runsPerQuery = 3,
    triggerThreshold = 0.5,
    model,
  } = opts

  // Build the full list of (item, runIdx) jobs
  type Job = { item: EvalItem; runIdx: number }
  const jobs: Job[] = []
  for (const item of evalSet) {
    for (let r = 0; r < runsPerQuery; r++) {
      jobs.push({ item, runIdx: r })
    }
  }

  // Concurrency-limited execution
  const jobResults: {
    query: string
    triggered: boolean
    item: EvalItem
    errored: boolean
  }[] = []
  let idx = 0

  async function worker() {
    while (idx < jobs.length) {
      const job = jobs[idx++]
      if (!job) break
      try {
        const triggered = await runSingleQuery(
          job.item.query,
          skillName,
          description,
          timeout,
          projectRoot,
          model,
        )
        jobResults.push({
          query: job.item.query,
          triggered,
          item: job.item,
          errored: false,
        })
      } catch (e) {
        console.error(`Warning: query failed: ${e}`)
        jobResults.push({
          query: job.item.query,
          triggered: false,
          item: job.item,
          errored: true,
        })
      }
    }
  }

  const workers = Array.from({ length: Math.min(numWorkers, jobs.length) }, () => worker())
  await Promise.all(workers)

  // Aggregate per-query
  const queryTriggers: Map<string, boolean[]> = new Map()
  const queryErrors: Map<string, number> = new Map()
  const queryItems: Map<string, EvalItem> = new Map()
  for (const jr of jobResults) {
    if (!queryTriggers.has(jr.query)) queryTriggers.set(jr.query, [])
    queryTriggers.get(jr.query)!.push(jr.triggered)
    queryErrors.set(jr.query, (queryErrors.get(jr.query) ?? 0) + (jr.errored ? 1 : 0))
    queryItems.set(jr.query, jr.item)
  }

  const results: EvalResultItem[] = []
  for (const [query, triggers] of queryTriggers) {
    const item = queryItems.get(query)!
    const errors = queryErrors.get(query) ?? 0
    const successfulRuns = triggers.length - errors
    const triggerRate =
      successfulRuns > 0 ? triggers.filter(Boolean).length / successfulRuns : 0
    const shouldTrigger = item.should_trigger
    const thresholdPass = shouldTrigger
      ? triggerRate >= triggerThreshold
      : triggerRate < triggerThreshold
    const didPass = errors === 0 && thresholdPass

    results.push({
      query,
      should_trigger: shouldTrigger,
      trigger_rate: triggerRate,
      triggers: triggers.filter(Boolean).length,
      runs: triggers.length,
      successful_runs: successfulRuns,
      errors,
      pass: didPass,
    })
  }

  const passed = results.filter((r) => r.pass).length
  const runErrors = results.reduce((acc, r) => acc + r.errors, 0)
  const queriesWithErrors = results.filter((r) => r.errors > 0).length

  return {
    skill_name: skillName,
    description,
    results,
    summary: {
      total: results.length,
      passed,
      failed: results.length - passed,
      run_errors: runErrors,
      queries_with_errors: queriesWithErrors,
    },
  }
}
