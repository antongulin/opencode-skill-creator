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
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "fs"
import { dirname, join, parse } from "path"
import { randomBytes } from "crypto"
import { tmpdir as osTmpdir } from "os"
import { parse as parseJsonc } from "jsonc-parser"

import { buildOpencodeEnv, isFailedProcess, runProcess } from "./process"

const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Config documents a project may place at its root, in precedence order. */
const ROOT_CONFIG_FILES = ["opencode.json", "opencode.jsonc"] as const

/**
 * Create an AbortError-shaped error so cancellation is distinguishable from a
 * genuine negative result or a query failure. Callers must never treat an
 * aborted run as a normal failed query.
 */
export function abortError(message = "skill evaluation aborted by the caller"): Error {
  const error = new Error(message)
  error.name = "AbortError"
  return error
}

export function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || (error as { code?: string }).code === "ABORT_ERR")
  )
}

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
      // Same env contract as the eval run: pin PWD to the project being
      // inspected so a stale caller PWD can't point the check elsewhere.
      env: buildOpencodeEnv(projectRoot),
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
 * Build the V2 skill enumerator from `ctx.skill.list()`. The enumerator scopes
 * enumeration to the project root passed by the caller, so each plugin instance
 * reads the skills for its own location. Returning null on any failure lets the
 * conflict guard abort loudly rather than silently skipping.
 */
export function createV2SkillEnumerator(ctx: {
  skill: {
    list(input?: { location?: { directory?: string } }): Promise<unknown>
  }
}): SkillEnumerator {
  return async (projectRoot: string) => {
    try {
      const output = (await ctx.skill.list({
        location: { directory: projectRoot },
      })) as {
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

/**
 * Collect the local files a root config document references via a relative path
 * (`instructions` entries and `{file:...}` substitutions). They are mirrored as
 * siblings so those references keep resolving from the eval root: OpenCode
 * resolves such paths relative to the config document's directory, which the
 * mirror preserves.
 */
function collectRelativeConfigFiles(projectRoot: string, configFileName: string): string[] {
  const text = readFileSync(join(projectRoot, configFileName), "utf-8")
  const data = parseJsonc(text) as Record<string, unknown> | undefined
  if (!data || typeof data !== "object") return []

  const referenced: string[] = []
  const pushLocal = (value: unknown) => {
    if (typeof value !== "string" || !value) return
    if (value.startsWith("/") || value.startsWith("~") || value.includes("://")) return
    if (/[*?[\]{}]/.test(value)) return
    referenced.push(value)
  }

  if (Array.isArray(data.instructions)) data.instructions.forEach(pushLocal)

  const fromFiles = (value: unknown): void => {
    if (typeof value === "string") {
      const match = /^\{file:(.+)\}$/.exec(value)
      if (match) pushLocal(match[1])
      return
    }
    if (Array.isArray(value)) value.forEach(fromFiles)
    else if (value && typeof value === "object") {
      Object.values(value as Record<string, unknown>).forEach(fromFiles)
    }
  }
  fromFiles(data)

  return referenced
}

/**
 * Mirror a project's direct root config documents into the eval root and carry
 * across any relative `instructions`/`{file:...}` files they reference.
 *
 * OpenCode resolves those relative paths against the directory of the config
 * document, so copying the document into the eval root is only correct if the
 * referenced siblings come with it; otherwise the paths silently re-point at
 * files that do not exist there and the instructions are lost.
 */
function mirrorRootConfigDocuments(projectRoot: string, evalRoot: string): void {
  const referenced = new Set<string>()
  for (const name of ROOT_CONFIG_FILES) {
    const source = join(projectRoot, name)
    if (!existsSync(source)) continue
    linkOrCopyConfigEntry(source, join(evalRoot, name), false)
    for (const relative of collectRelativeConfigFiles(projectRoot, name)) {
      referenced.add(relative)
    }
  }

  for (const relative of referenced) {
    const source = join(projectRoot, relative)
    if (source === projectRoot || !source.startsWith(projectRoot + "/")) continue
    if (!existsSync(source)) continue
    const target = join(evalRoot, relative)
    if (!target.startsWith(evalRoot + "/")) continue
    if (existsSync(target)) continue
    mkdirSync(dirname(target), { recursive: true })
    linkOrCopyConfigEntry(source, target, statSync(source).isDirectory())
  }
}

export function symlinkProjectOpenCodeConfig(
  projectRoot: string,
  evalRoot: string,
  skillName: string,
): void {
  // Mirror the project's *direct root* config documents (and the relative
  // files they reference) first. OpenCode resolves `instructions` (and
  // `{file:...}` references) relative to the directory of the config document,
  // so a root `opencode.jsonc` that lives at `projectRoot` is ineffective when
  // only its `.opencode/` folder is mirrored: the document itself would be
  // absent and its relative paths would have no base in the eval root.
  mirrorRootConfigDocuments(projectRoot, evalRoot)

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
  signal?: AbortSignal,
): Promise<boolean> {
  if (!SKILL_NAME_RE.test(skillName)) {
    throw new Error(
      `Invalid skill name "${skillName}". Expected kebab-case (lowercase letters, numbers, and hyphens only).`,
    )
  }

  const uniqueId = randomBytes(4).toString("hex")
  const cleanName = `${skillName}-skill-${uniqueId}`
  // Pre-aborted call: spawn nothing and create no temp root.
  if (signal?.aborted) throw abortError()
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
      signal,
      onStdoutChunk(chunk) {
        buffer += chunk
        flushBuffer()
        return triggerOnly && triggered
      },
    })

    flushBuffer(true)

    // A cancelled run is not a negative result. Throw so it is never counted as
    // a passed/failed eval outcome in the summary.
    if (result.aborted || signal?.aborted) {
      throw abortError()
    }

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
  /**
   * Caller-owned cancellation. When aborted, queued jobs are not started,
   * in-flight children are killed, and the returned promise rejects with an
   * `AbortError` so cancellation can never be mistaken for a normal negative
   * result (`run_errors: 0`).
   */
  signal?: AbortSignal
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
    signal,
  } = opts

  if (signal?.aborted) throw abortError()

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
  let abortedDuringRun = false

  async function worker() {
    while (idx < jobs.length) {
      // Stop pulling queued jobs once the caller aborts.
      if (signal?.aborted) {
        abortedDuringRun = true
        return
      }
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
          signal,
        )
        jobResults.push({
          query: job.item.query,
          triggered,
          item: job.item,
          errored: false,
        })
      } catch (e) {
        if (isAbortError(e) || signal?.aborted) {
          abortedDuringRun = true
          return
        }
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

  // Cancellation is reported as an explicit abort, never as a scored result.
  if (signal?.aborted || abortedDuringRun) {
    throw abortError()
  }

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
