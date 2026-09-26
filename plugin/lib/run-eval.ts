/**
 * Trigger evaluation — tests whether a skill description causes OpenCode
 * to invoke (read) the skill for a set of queries.
 *
 * Port of scripts/run_eval.py.
 *
 * Uses Node child_process to shell out to `opencode run`. For each query a temporary
 * skill is created in .opencode/skills/ so it appears in the available_skills
 * list. The output is scanned for the temporary skill name to determine
 * whether the skill was triggered.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs"
import { dirname, join, parse } from "path"
import { randomBytes } from "crypto"
import { tmpdir as osTmpdir } from "os"

import { buildOpencodeEnv, isFailedProcess, runProcess } from "./process"

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
  warnings: string[]
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

const ALL_ZERO_WARNING =
  "All should-trigger queries produced 0 triggers with no run errors. Check that trigger evals are using an agent that exposes skill tool events, such as the build agent."

export function buildOpenCodeRunCommand(
  query: string,
  opts: { agent?: string; model?: string },
): string[] {
  const cmd = [
    "opencode",
    "run",
    "--format",
    "json",
    "--agent",
    opts.agent ?? "build",
  ]
  if (opts.model) cmd.push("--model", opts.model)
  cmd.push(query)
  return cmd
}

export function buildEvalWarnings(results: EvalResultItem[]): string[] {
  const shouldTriggerResults = results.filter((r) => r.should_trigger)
  if (shouldTriggerResults.length === 0) return []

  const allZeroWithoutErrors = shouldTriggerResults.every(
    (r) => r.triggers === 0 && r.errors === 0,
  )
  return allZeroWithoutErrors ? [ALL_ZERO_WARNING] : []
}

export function findSkillConflicts(
  stdoutText: string,
  skillName: string,
): string[] {
  try {
    const parsed = JSON.parse(stdoutText) as unknown
    if (!Array.isArray(parsed)) return []

    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return []
      const record = entry as Record<string, unknown>
      if (record.name !== skillName) return []
      return [
        typeof record.location === "string" && record.location.trim()
          ? record.location
          : "unknown location",
      ]
    })
  } catch {
    return []
  }
}

export async function assertNoInstalledSkillConflict(
  skillName: string,
  projectRoot: string,
): Promise<void> {
  let result
  try {
    result = await runProcess(["opencode", "debug", "skill"], {
      cwd: projectRoot,
      // Same env contract as the eval run: pin PWD to the project being
      // inspected so a stale caller PWD can't point the check elsewhere.
      env: buildOpencodeEnv(projectRoot),
      timeoutMs: 10_000,
    })
  } catch {
    return
  }

  if (isFailedProcess(result)) return

  const locations = findSkillConflicts(result.stdout, skillName)
  if (locations.length === 0) return

  throw new Error(
    `skill_eval conflict: skill "${skillName}" is already available to opencode at ${locations.join(", ")}. Remove that installed skill or its skills.paths entry before running skill_eval. The eval tool creates a synthetic skill named "${skillName}-skill-<id>" and only counts that temporary skill as triggered; an installed skill with the base name can steal triggers and produce false negatives.`,
  )
}

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
 * Mirror a project config entry into the eval root. Prefers a symlink (cheap,
 * no copy), passing an explicit type so directory links resolve correctly. On
 * platforms where symlinks are unavailable — Windows without admin/Developer
 * Mode rejects them with EPERM — fall back to a recursive copy so eval
 * isolation still works cross-platform.
 */
function linkOrCopyConfigEntry(source: string, target: string, isDirectory: boolean): void {
  try {
    symlinkSync(source, target, isDirectory ? "dir" : "file")
  } catch {
    cpSync(source, target, { recursive: true })
  }
}

export function symlinkProjectOpenCodeConfig(
  projectRoot: string,
  evalRoot: string,
  skillName: string,
): void {
  const sourceOpenCode = join(projectRoot, ".opencode")
  if (!existsSync(sourceOpenCode)) return

  const targetOpenCode = join(evalRoot, ".opencode")
  mkdirSync(targetOpenCode, { recursive: true })

  for (const entry of readdirSync(sourceOpenCode, { withFileTypes: true })) {
    if (entry.name === "skills") continue
    linkOrCopyConfigEntry(
      join(sourceOpenCode, entry.name),
      join(targetOpenCode, entry.name),
      entry.isDirectory(),
    )
  }

  const sourceSkills = join(sourceOpenCode, "skills")
  if (!existsSync(sourceSkills)) return

  const targetSkills = join(targetOpenCode, "skills")
  mkdirSync(targetSkills, { recursive: true })
  for (const entry of readdirSync(sourceSkills, { withFileTypes: true })) {
    if (entry.name === skillName) continue
    linkOrCopyConfigEntry(
      join(sourceSkills, entry.name),
      join(targetSkills, entry.name),
      entry.isDirectory(),
    )
  }
}

/**
 * Run a single query against `opencode run` and return whether the temporary
 * skill name appeared in the output.
 *
 * Each run gets its own temporary OpenCode project root. This keeps parallel
 * workers from seeing one another's synthetic skills and producing false
 * negatives when a sibling synthetic skill is selected.
 */
async function runSingleQuery(
  query: string,
  skillName: string,
  skillDescription: string,
  timeout: number,
  projectRoot: string,
  agent: string,
  triggerOnly: boolean,
  model?: string,
): Promise<boolean> {
  if (!SKILL_NAME_RE.test(skillName)) {
    throw new Error(
      `Invalid skill name "${skillName}". Expected kebab-case (lowercase letters, numbers, and hyphens only).`,
    )
  }

  const uniqueId = randomBytes(4).toString("hex")
  const cleanName = `${skillName}-skill-${uniqueId}`
  const evalRoot = mkdtempSync(join(osTmpdir(), "opencode-skill-eval-"))
  const skillsDir = join(evalRoot, ".opencode", "skills", cleanName)
  const skillFile = join(skillsDir, "SKILL.md")

  try {
    symlinkProjectOpenCodeConfig(projectRoot, evalRoot, skillName)
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

    const cmd = buildOpenCodeRunCommand(query, { agent, model })

    // Collect output with timeout and detect skill invocation from JSON events.
    let buffer = ""
    let triggered = false
    const maxStderrChars = 64 * 1024
    const timeoutMs = timeout * 1000

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

    const result = await runProcess(cmd, {
      cwd: evalRoot,
      // opencode resolves its project root (and thus project-scoped skills) from
      // $PWD, not the spawn cwd. Leaking the caller's PWD makes the nested run
      // load the *real* project skill under test (base name), so its triggers are
      // attributed to that skill instead of the synthetic one — a false 0. Pin PWD
      // to evalRoot so only the synthetic skill (plus global skills) are in scope.
      env: buildOpencodeEnv(evalRoot),
      timeoutMs,
      maxStderrChars,
      onStdoutChunk(chunk) {
        buffer += chunk
        flushBuffer()
        return triggerOnly && triggered
      },
    })

    flushBuffer(true)

    if (triggered && triggerOnly) {
      return true
    }

    if (isFailedProcess(result)) {
      const cleanedStderr = result.stderr.trim()
      throw new Error(
        cleanedStderr
          ? `opencode run exited ${result.exitCode}: ${cleanedStderr}`
          : `opencode run exited ${result.exitCode}`,
      )
    }

    return triggered
  } finally {
    // Clean up the isolated temporary project root.
    if (existsSync(evalRoot)) {
      rmSync(evalRoot, { recursive: true, force: true })
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
  triggerOnly?: boolean
  model?: string
  agent?: string
}

/**
 * A single finished query run, keyed by the eval-set item it belongs to.
 */
export interface EvalJobResult {
  /** Index of the eval-set item this run belongs to — the stable aggregation key. */
  itemIndex: number
  triggered: boolean
  errored: boolean
}

/**
 * Aggregate per-run outcomes into one result per eval-set item.
 *
 * Keyed by eval-set array index, never by query string: duplicate queries must
 * not merge into one entry (which would blend their runs and corrupt the pass
 * rate). Results come back in eval-set order — run-loop splits train/test
 * positionally against the same order instead of re-matching query text.
 */
export function aggregateEvalResults(
  evalSet: EvalItem[],
  jobResults: EvalJobResult[],
  triggerThreshold: number,
): EvalResultItem[] {
  const byItem = new Map<number, { triggers: boolean[]; errors: number }>()
  for (const jr of jobResults) {
    let bucket = byItem.get(jr.itemIndex)
    if (!bucket) {
      bucket = { triggers: [], errors: 0 }
      byItem.set(jr.itemIndex, bucket)
    }
    bucket.triggers.push(jr.triggered)
    if (jr.errored) bucket.errors += 1
  }

  const results: EvalResultItem[] = []
  for (const [itemIndex, item] of evalSet.entries()) {
    const bucket = byItem.get(itemIndex)
    if (!bucket) continue

    const triggers = bucket.triggers
    const errors = bucket.errors
    const successfulRuns = triggers.length - errors
    const triggerRate =
      successfulRuns > 0 ? triggers.filter(Boolean).length / successfulRuns : 0
    const shouldTrigger = item.should_trigger
    const thresholdPass = shouldTrigger
      ? triggerRate >= triggerThreshold
      : triggerRate < triggerThreshold
    const didPass = errors === 0 && thresholdPass

    results.push({
      query: item.query,
      should_trigger: shouldTrigger,
      trigger_rate: triggerRate,
      triggers: triggers.filter(Boolean).length,
      runs: triggers.length,
      successful_runs: successfulRuns,
      errors,
      pass: didPass,
    })
  }
  return results
}

/**
 * Run the full eval set and return results.
 *
 * Parallelism is implemented via `Promise.all` with a concurrency limiter
 * instead of Python's ProcessPoolExecutor.
 *
 * Returned `results` contain one entry per eval-set item, in eval-set order
 * (duplicate queries stay separate).
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
    triggerOnly = true,
    model,
    agent = "build",
  } = opts

  // Build the full list of (item, runIdx) jobs. itemIndex is the stable key
  // that ties every run back to its eval-set entry.
  type Job = { item: EvalItem; runIdx: number; itemIndex: number }
  const jobs: Job[] = []
  evalSet.forEach((item, itemIndex) => {
    for (let r = 0; r < runsPerQuery; r++) {
      jobs.push({ item, runIdx: r, itemIndex })
    }
  })

  // Concurrency-limited execution
  const jobResults: EvalJobResult[] = []
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
          agent,
          triggerOnly,
          model,
        )
        jobResults.push({
          itemIndex: job.itemIndex,
          triggered,
          errored: false,
        })
      } catch (e) {
        console.error(`Warning: query failed: ${e}`)
        jobResults.push({
          itemIndex: job.itemIndex,
          triggered: false,
          errored: true,
        })
      }
    }
  }

  const workers = Array.from({ length: Math.min(numWorkers, jobs.length) }, () => worker())
  await Promise.all(workers)

  // Aggregate per eval-set item (index-keyed, eval-set order)
  const results = aggregateEvalResults(evalSet, jobResults, triggerThreshold)

  const passed = results.filter((r) => r.pass).length
  const runErrors = results.reduce((acc, r) => acc + r.errors, 0)
  const queriesWithErrors = results.filter((r) => r.errors > 0).length

  return {
    skill_name: skillName,
    description,
    results,
    warnings: buildEvalWarnings(results),
    summary: {
      total: results.length,
      passed,
      failed: results.length - passed,
      run_errors: runErrors,
      queries_with_errors: queriesWithErrors,
    },
  }
}
