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
import { join } from "path"
import { randomBytes } from "crypto"
import { parseSkillMd } from "./utils"

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
  const { root } = require("path").parse(current)

  while (true) {
    if (existsSync(join(current, ".opencode"))) return current
    if (existsSync(join(current, ".claude"))) return current
    const parent = require("path").dirname(current)
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

    const cmd = ["opencode", "run"]
    if (model) cmd.push("--model", model)
    cmd.push(query)

    const proc = Bun.spawn(cmd, {
      cwd: projectRoot,
      stdout: "pipe",
      stderr: "ignore",
      env: { ...process.env },
    })

    // Collect output with timeout
    let buffer = ""
    const decoder = new TextDecoder()
    const reader = proc.stdout.getReader()
    const deadline = Date.now() + timeout * 1000

    try {
      while (Date.now() < deadline) {
        const remaining = deadline - Date.now()
        const result = await Promise.race([
          reader.read(),
          new Promise<{ done: true; value: undefined }>((resolve) =>
            setTimeout(() => resolve({ done: true, value: undefined }), remaining),
          ),
        ])
        if (result.done) break
        if (result.value) {
          buffer += decoder.decode(result.value, { stream: true })
        }
      }
    } finally {
      reader.releaseLock()
      proc.kill()
      await proc.exited
    }

    return buffer.includes(cleanName)
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
    runsPerQuery = 1,
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
  const jobResults: { query: string; triggered: boolean; item: EvalItem }[] = []
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
        jobResults.push({ query: job.item.query, triggered, item: job.item })
      } catch (e) {
        console.error(`Warning: query failed: ${e}`)
        jobResults.push({ query: job.item.query, triggered: false, item: job.item })
      }
    }
  }

  const workers = Array.from({ length: Math.min(numWorkers, jobs.length) }, () => worker())
  await Promise.all(workers)

  // Aggregate per-query
  const queryTriggers: Map<string, boolean[]> = new Map()
  const queryItems: Map<string, EvalItem> = new Map()
  for (const jr of jobResults) {
    if (!queryTriggers.has(jr.query)) queryTriggers.set(jr.query, [])
    queryTriggers.get(jr.query)!.push(jr.triggered)
    queryItems.set(jr.query, jr.item)
  }

  const results: EvalResultItem[] = []
  for (const [query, triggers] of queryTriggers) {
    const item = queryItems.get(query)!
    const triggerRate = triggers.filter(Boolean).length / triggers.length
    const shouldTrigger = item.should_trigger
    const didPass = shouldTrigger
      ? triggerRate >= triggerThreshold
      : triggerRate < triggerThreshold

    results.push({
      query,
      should_trigger: shouldTrigger,
      trigger_rate: triggerRate,
      triggers: triggers.filter(Boolean).length,
      runs: triggers.length,
      pass: didPass,
    })
  }

  const passed = results.filter((r) => r.pass).length

  return {
    skill_name: skillName,
    description,
    results,
    summary: {
      total: results.length,
      passed,
      failed: results.length - passed,
    },
  }
}
