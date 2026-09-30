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

import { isFailedProcess, runProcess } from "./process"

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

export interface EnumeratedSkill {
  name: string
  location?: string
}

/**
 * Enumerate the skills installed for a project. Returns `null` when the
 * mechanism is unavailable so the caller can fail loudly instead of silently
 * skipping the conflict guard.
 */
export type SkillEnumerator = (
  projectRoot: string,
) => Promise<EnumeratedSkill[] | null>

function parseCliSkillList(stdoutText: string): EnumeratedSkill[] | null {
  try {
    const parsed = JSON.parse(stdoutText) as unknown
    if (!Array.isArray(parsed)) return null
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return []
      const record = entry as Record<string, unknown>
      if (typeof record.name !== "string") return []
      return [
        {
          name: record.name,
          location:
            typeof record.location === "string" ? record.location : undefined,
        },
      ]
    })
  } catch {
    return null
  }
}

/**
 * Find locations of an installed skill with `skillName` inside a skill list.
 * Shared by the V1 CLI JSON parser and the V2 `ctx.skill.list` path.
 */
export function findSkillConflictsInList(
  skills: readonly EnumeratedSkill[],
  skillName: string,
): string[] {
  return skills
    .filter((entry) => entry.name === skillName)
    .map((entry) =>
      typeof entry.location === "string" && entry.location.trim()
        ? entry.location
        : "unknown location",
    )
}

export function findSkillConflicts(
  stdoutText: string,
  skillName: string,
): string[] {
  const skills = parseCliSkillList(stdoutText)
  if (skills === null) return []
  return findSkillConflictsInList(skills, skillName)
}

/**
 * V1 enumerator: `opencode debug skill` prints a JSON array of skills.
 * OpenCode V2 removed that subcommand, so this returns `null` there and the
 * V2 tool path supplies `ctx.skill.list` instead.
 */
export const cliInstalledSkillEnumerator: SkillEnumerator = async (
  projectRoot,
) => {
  let result
  try {
    result = await runProcess(["opencode", "debug", "skill"], {
      cwd: projectRoot,
      timeoutMs: 10_000,
    })
  } catch {
    return null
  }

  if (isFailedProcess(result)) return null
  return parseCliSkillList(result.stdout)
}

export function skillConflictMessage(
  skillName: string,
  locations: string[],
): string {
  return `skill_eval conflict: skill "${skillName}" is already available to opencode at ${locations.join(", ")}. Remove that installed skill or its skills.paths entry before running skill_eval. The eval tool creates a synthetic skill named "${skillName}-skill-<id>" and only counts that temporary skill as triggered; an installed skill with the base name can steal triggers and produce false negatives.`
}

export function skillEnumerationUnavailableMessage(skillName: string): string {
  return `skill_eval aborted: could not enumerate the skills installed in this project to check whether "${skillName}" is already available. A pre-installed skill with the base name can steal triggers and produce false negatives, so the eval does not run rather than return misleading results. In OpenCode V2 the plugin uses the skill list API; if that call fails, retry once the server is healthy. In V1 the check uses \`opencode debug skill\`.`
}

export async function assertNoInstalledSkillConflict(
  skillName: string,
  projectRoot: string,
  enumerate: SkillEnumerator = cliInstalledSkillEnumerator,
): Promise<void> {
  const skills = await enumerate(projectRoot)
  if (skills === null) {
    throw new Error(skillEnumerationUnavailableMessage(skillName))
  }

  const locations = findSkillConflictsInList(skills, skillName)
  if (locations.length === 0) return

  throw new Error(skillConflictMessage(skillName, locations))
}

/**
 * Build the V2 skill enumerator from `ctx.skill.list()`. Returning null on any
 * failure lets the conflict guard abort loudly rather than silently skipping.
 */
export function createV2SkillEnumerator(ctx: {
  skill: { list(input?: unknown): Promise<unknown> }
}): SkillEnumerator {
  return async () => {
    try {
      const output = (await ctx.skill.list()) as {
        data?: readonly { name?: unknown; path?: unknown }[]
      }
      if (!output || !Array.isArray(output.data)) return null
      return output.data.flatMap((entry) => {
        if (!entry || typeof entry.name !== "string") return []
        return [
          {
            name: entry.name,
            location: typeof entry.path === "string" ? entry.path : undefined,
          },
        ]
      })
    } catch {
      return null
    }
  }
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
      env: { ...process.env, PWD: evalRoot },
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
    triggerOnly = true,
    model,
    agent = "build",
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
          agent,
          triggerOnly,
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
