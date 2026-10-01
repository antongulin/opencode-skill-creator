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
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "fs"
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "path"
import { randomBytes } from "crypto"
import { tmpdir as osTmpdir } from "os"
import { parse as parseJsonc } from "jsonc-parser"

import { buildOpencodeEnv, isFailedProcess, runProcess } from "./process"

const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Config documents a project may place at its root; all present ones are mirrored. */
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
 * isolation still works cross-platform. Idempotent: an existing target is left
 * untouched, so overlapping mirrors never collide with EEXIST.
 */
function linkOrCopyConfigEntry(source: string, target: string, isDirectory: boolean): void {
  if (existsSync(target)) return
  mkdirSync(dirname(target), { recursive: true })
  try {
    symlinkSync(source, target, isDirectory ? "dir" : "file")
  } catch {
    if (!existsSync(target)) cpSync(source, target, { recursive: true })
  }
}

/** True when `child` is strictly inside `parent` (no partial-name matches). */
function isInsidePath(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  if (rel === "" || isAbsolute(rel)) return false
  // Reject only genuine escapes (`..` itself or segments under it). A plain
  // `startsWith("..")` would also reject valid names such as `..notes.md`.
  return rel !== ".." && !rel.startsWith(`..${sep}`)
}

/**
 * Canonicalize a path for the skill-exclusion guard, resolving symlinks so an
 * alias such as `alias-skills -> .opencode/skills` cannot smuggle the real
 * skill back into the isolated eval root past a purely lexical check. `isInsidePath`
 * only compares path strings and is therefore fooled by aliases.
 */
function canonicalizeForExclusion(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

/**
 * True when `absolute` is the canonical `.opencode/skills` directory itself or
 * lives inside it. On a realpath failure the lexical form is still checked, so
 * the guard fails closed (a forbidden path stays excluded) rather than open.
 */
function referencesSkillsRoot(skillsRoot: string, absolute: string): boolean {
  const canonicalRoot = canonicalizeForExclusion(skillsRoot)
  const canonicalAbsolute = canonicalizeForExclusion(absolute)
  if (
    canonicalAbsolute === canonicalRoot ||
    isInsidePath(canonicalRoot, canonicalAbsolute)
  ) {
    return true
  }
  return absolute === skillsRoot || isInsidePath(skillsRoot, absolute)
}

/**
 * True when `absolute` is the tested skill's own directory or a descendant of
 * it (canonical match, so an alias/symlink cannot bypass it). `excludedSkillPath`
 * is the candidate skill the eval is running: its original `SKILL.md` must never
 * reach the isolated eval root, so its full body cannot leak into a
 * description-only eval. Omitted -> no extra exclusion (backward compatible).
 */
function isWithinExcludedSkill(
  excludedSkillPath: string | undefined,
  absolute: string,
): boolean {
  if (!excludedSkillPath) return false
  const canonicalExcluded = canonicalizeForExclusion(excludedSkillPath)
  const canonicalAbsolute = canonicalizeForExclusion(absolute)
  return (
    canonicalAbsolute === canonicalExcluded ||
    isInsidePath(canonicalExcluded, canonicalAbsolute)
  )
}

/**
 * True when `absolute` is a canonical ancestor of the tested skill directory.
 * Mirroring such a reference would copy the whole parent (including the tested
 * skill) into the eval root, reintroducing the candidate's body. Callers must
 * refuse it with an accurate diagnostic rather than copy the parent tree.
 */
function isAncestorOfExcludedSkill(
  excludedSkillPath: string | undefined,
  absolute: string,
): boolean {
  if (!excludedSkillPath) return false
  const canonicalExcluded = canonicalizeForExclusion(excludedSkillPath)
  const canonicalAbsolute = canonicalizeForExclusion(absolute)
  return isInsidePath(canonicalAbsolute, canonicalExcluded)
}

/**
 * Collect the local paths a root config document references (`instructions`
 * entries and `{file:...}` substitutions). Returns each entry unchanged so the
 * caller can distinguish literal paths from glob patterns; absolute paths,
 * URLs, and `~`-prefixed paths are never local to the project and are skipped.
 */
function collectRelativeConfigRefs(projectRoot: string, configFileName: string): string[] {
  const text = readFileSync(join(projectRoot, configFileName), "utf-8")
  const data = parseJsonc(text) as Record<string, unknown> | undefined
  if (!data || typeof data !== "object") return []

  const referenced: string[] = []
  const pushLocal = (value: unknown) => {
    if (typeof value !== "string" || !value) return
    // A `{file:...}` instruction is a substitution wrapper, not a path. It is
    // normalized to its inner path exactly once by `fromFiles` below, so feeding
    // the raw wrapper to glob detection here would emit a false
    // "brace alternation ... not supported" warning for a supported reference.
    if (/^\{file:.+\}$/.test(value)) return
    if (value.startsWith("/") || value.startsWith("~") || value.includes("://")) return
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
 * Expand a glob pattern into project-relative matches using only the Node fs
 * API guaranteed on the promised `node >=18` floor. `fs.globSync` is
 * deliberately NOT used: it only exists on Node 22+, so importing it would
 * break the plugin on Node 18/20 before any tool runs.
 *
 * Supported grammar: literal directories, `*`, `?`, and `[...]`/`[!...]`
 * classes; every segment stays at a single directory level. Anything outside
 * that subset — `**` recursion, a `..` parent reference, or brace alternation
 * — is reported on stderr and expands to nothing, so a material config
 * reference is never silently lost.
 */
function expandConfigGlob(projectRoot: string, pattern: string): string[] {
  const segments = pattern.split("/").filter((part) => part !== "" && part !== ".")
  if (segments.some((segment) => segment === "..")) {
    // Escaping the project root cannot be mirrored as a sibling. Surface it
    // instead of silently losing the referenced files.
    console.error(
      `skill_eval: instruction pattern "${pattern}" references a parent directory (".."), which the isolated eval-root mirror cannot mirror; move the reference inside the project if eval runs must see it.`,
    )
    return []
  }
  if (segments.some((segment) => segment.includes("{") || segment.includes("}"))) {
    console.error(
      `skill_eval: instruction pattern "${pattern}" uses brace alternation, which the isolated eval-root mirror does not support; list one explicit file or glob per entry such as "dir/a.md", "dir/b.md", or "dir/*.md".`,
    )
    return []
  }
  if (segments.some((segment) => segment.includes("**"))) {
    console.error(
      `skill_eval: instruction pattern "${pattern}" uses "**" recursion, which the isolated eval-root mirror does not support; list explicit files or a single-directory glob such as "dir/*.md".`,
    )
    return []
  }

  let bases: string[] = [""]
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]
    const next: string[] = []
    const hasGlob = /[*?[]/.test(segment)
    for (const base of bases) {
      const dirAbsolute = base ? join(projectRoot, base) : projectRoot
      if (!existsSync(dirAbsolute)) continue
      let entries: string[]
      try {
        entries = readdirSync(dirAbsolute)
      } catch {
        continue
      }
      let matcher: RegExp | null
      if (hasGlob) {
        try {
          matcher = globSegmentToRegExp(segment)
        } catch (error) {
          // A malformed glob (e.g. `[z-a]`, an unclosed `[`) must not throw
          // out of the mirror or silently expand to nothing.
          console.error(
            `skill_eval: instruction pattern "${pattern}" contains an unsupported or malformed glob segment "${segment}" (${error instanceof Error ? error.message : String(error)}); the reference is not mirrored into the isolated eval root.`,
          )
          return []
        }
      } else {
        matcher = null
      }
      for (const entry of entries) {
        if (matcher ? !matcher.test(entry) : entry !== segment) continue
        const childRelative = base ? `${base}/${entry}` : entry
        const childAbsolute = join(projectRoot, childRelative)
        // Intermediate segments must resolve to directories; the FINAL match
        // may be a file or a directory (a directory named by the last segment
        // is mirrored as a directory link). Compare the POSITION, not the
        // segment value: a repeated directory name such as `a/a/*.md` has its
        // final segment equal to an earlier one.
        if (index !== segments.length - 1) {
          try {
            if (!statSync(childAbsolute).isDirectory()) continue
          } catch {
            continue
          }
          next.push(childRelative)
        } else {
          next.push(childRelative)
        }
      }
    }
    bases = next
    if (bases.length === 0) break
  }
  return bases
}

/**
 * Compile one glob path segment (`a*b?c[de]`) to a fully anchored RegExp. The
 * returned pattern always spans the whole segment (`^...$`), never a partial
 * match. A malformed character class is thrown and reported by the caller.
 */
function globSegmentToRegExp(segment: string): RegExp {
  let out = "^"
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i]
    if (ch === "*") {
      out += "[^/]*"
    } else if (ch === "?") {
      out += "[^/]"
    } else if (ch === "[") {
      const close = segment.indexOf("]", i + 1)
      if (close === -1) {
        throw new Error("unterminated character class (missing ']')")
      }
      let body = segment.slice(i + 1, close)
      if (body.startsWith("!")) body = `^${body.slice(1)}`
      try {
        // Probe the resulting class so a malformed range such as [z-a]
        // is reported, not thrown as an opaque RegExp error.
        void new RegExp(`[${body}]`)
      } catch {
        throw new Error(`unsupported character class "[${body}]"`)
      }
      out += `[${body}]`
      // Skip past the class; the range probe already validated its body.
      i = close
    } else {
      out += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    }
  }
  return new RegExp(`${out}$`)
}

/**
 * Expand one instruction/reference entry into concrete project-relative files.
 * Glob patterns are expanded with the local matcher above; literal paths are
 * used as-is. Paths that resolve outside the project root are reported and
 * skipped rather than silently dropped.
 */
function expandConfigReference(projectRoot: string, reference: string): string[] {
  const hasGlob = /[*?[\]{}]/.test(reference)
  let matches: string[]
  if (hasGlob) {
    matches = expandConfigGlob(projectRoot, reference)
  } else {
    matches = [reference]
  }

  const resolved: string[] = []
  for (const match of matches) {
    const absolute = resolve(projectRoot, match)
    if (!isInsidePath(projectRoot, absolute)) {
      // e.g. `../shared/rules.md` — cannot be mirrored as a sibling without
      // escaping the eval root. Surface it instead of silently losing it.
      console.error(
        `skill_eval: instruction reference "${reference}" resolves outside the project root and is not mirrored into the isolated eval root; move it inside the project if eval runs must see it.`,
      )
      continue
    }
    if (existsSync(absolute)) resolved.push(absolute)
  }
  return resolved
}

/**
 * Mirror a project's direct root config documents into the eval root and carry
 * across any relative `instructions`/`{file:...}` files they reference.
 *
 * OpenCode resolves those relative paths against the directory of the config
 * document, so copying the document into the eval root is only correct if the
 * referenced siblings come with it; otherwise the paths silently re-point at
 * files that do not exist there and the instructions are lost.
 *
 * Safety: the skill under test, and anything under `.opencode/skills`, is never
 * mirrored — a reference into that directory cannot be allowed to reintroduce
 * the real skill into the isolated root.
 */
function mirrorRootConfigDocuments(
  projectRoot: string,
  evalRoot: string,
  excludedSkillPath?: string,
): void {
  const skillsRoot = join(projectRoot, ".opencode", "skills")

  for (const name of ROOT_CONFIG_FILES) {
    const source = join(projectRoot, name)
    if (!existsSync(source)) continue
    linkOrCopyConfigEntry(source, join(evalRoot, name), false)

    for (const reference of collectRelativeConfigRefs(projectRoot, name)) {
      for (const absolute of expandConfigReference(projectRoot, reference)) {
        // Never reintroduce the tested skill or anything under the project's
        // skills directory into the isolated eval root. Compare canonical
        // paths so an alias (symlink) into `.opencode/skills` is caught too.
        if (referencesSkillsRoot(skillsRoot, absolute)) continue
        // Also exclude the tested candidate's own directory wherever it lives,
        // so a root-config reference cannot leak its full original body. A
        // reference to an ANCESTOR of the candidate would copy the whole parent
        // (reintroducing the candidate); refuse it with an accurate warning.
        if (isWithinExcludedSkill(excludedSkillPath, absolute)) continue
        if (isAncestorOfExcludedSkill(excludedSkillPath, absolute)) {
          console.error(
            `skill_eval: instruction reference "${reference}" resolves to a directory containing the tested skill; the isolated eval-root mirror refuses to copy that parent tree (it would reintroduce the skill under test). Reference the specific file instead.`,
          )
          continue
        }
        const relativeTarget = relative(projectRoot, absolute)
        const target = join(evalRoot, relativeTarget)
        if (!isInsidePath(evalRoot, target)) continue
        linkOrCopyConfigEntry(absolute, target, statSync(absolute).isDirectory())
      }
    }
  }
}

export function symlinkProjectOpenCodeConfig(
  projectRoot: string,
  evalRoot: string,
  skillName: string,
  excludedSkillPath?: string,
): void {
  // Mirror the project's `.opencode/` config first (excluding skills), then the
  // direct root config documents and their referenced files. Runs in this order
  // so root references that point into `.opencode/` are idempotent no-ops
  // rather than collisions.
  const sourceOpenCode = join(projectRoot, ".opencode")
  if (existsSync(sourceOpenCode)) {
    const targetOpenCode = join(evalRoot, ".opencode")
    mkdirSync(targetOpenCode, { recursive: true })

    const sourceSkillsRoot = join(sourceOpenCode, "skills")
    for (const entry of readdirSync(sourceOpenCode, { withFileTypes: true })) {
      if (entry.name === "skills") continue
      const entryPath = join(sourceOpenCode, entry.name)
      // An entry that is an alias (symlink) into `.opencode/skills` — or into
      // the tested candidate's own directory — would otherwise mirror the
      // skill under test under a different name. Compare canonical paths.
      if (referencesSkillsRoot(sourceSkillsRoot, entryPath)) continue
      if (isWithinExcludedSkill(excludedSkillPath, entryPath)) continue
      if (isAncestorOfExcludedSkill(excludedSkillPath, entryPath)) continue
      linkOrCopyConfigEntry(entryPath, join(targetOpenCode, entry.name), entry.isDirectory())
    }

    const sourceSkills = join(sourceOpenCode, "skills")
    if (existsSync(sourceSkills)) {
      const targetSkills = join(targetOpenCode, "skills")
      mkdirSync(targetSkills, { recursive: true })
      const canonicalSkillsRoot = canonicalizeForExclusion(sourceSkills)
      // Candidate-specific exclusion: the tested skill's own directory wherever
      // it lives (default: `.opencode/skills/<skillName>`). This preserves the
      // legacy alias safety even when no explicit path is passed.
      const candidatePath = excludedSkillPath ?? join(sourceSkills, skillName)
      for (const entry of readdirSync(sourceSkills, { withFileTypes: true })) {
        if (entry.name === skillName) continue
        const entryPath = join(sourceSkills, entry.name)
        const canonicalEntry = canonicalizeForExclusion(entryPath)
        // A whole-skills-root alias (`.opencode/skills/alias -> .opencode/skills`)
        // would reintroduce every skill, including the tested one. Descendants of
        // the root are legitimate siblings and MUST still be mirrored.
        if (canonicalEntry === canonicalSkillsRoot) continue
        // An alias to the tested candidate (inside `.opencode/skills`, or — when
        // an explicit path is given — outside `.opencode`) must not reintroduce
        // the candidate's body. Equality/descendant only; never excludes siblings.
        if (isWithinExcludedSkill(candidatePath, entryPath)) continue
        // A parent/ancestor alias (`.opencode/skills/alias -> <a dir that
        // contains the candidate>`) would copy the whole subtree and reintroduce
        // the candidate. Refuse it; a normal sibling is never an ancestor of the
        // candidate, so legitimate siblings remain mirrored.
        if (isAncestorOfExcludedSkill(candidatePath, entryPath)) continue
        linkOrCopyConfigEntry(entryPath, join(targetSkills, entry.name), entry.isDirectory())
      }
    }
  }

  // Root config documents (and the relative files they reference) are mirrored
  // at the same relative position. OpenCode resolves `instructions` and
  // `{file:...}` references relative to the config document's directory, so the
  // document is only effective if its relative siblings come across too.
  mirrorRootConfigDocuments(projectRoot, evalRoot, excludedSkillPath)
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
  excludedSkillPath?: string,
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
    symlinkProjectOpenCodeConfig(projectRoot, evalRoot, skillName, excludedSkillPath)
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
  /**
   * The tested skill's own directory (the candidate the eval runs). Its
   * original `SKILL.md` must never be mirrored into the isolated eval root, so
   * a root-config `instructions`/`{file:...}` reference into it (or into an
   * ancestor that would copy it) is excluded. Omitted -> no extra exclusion.
   */
  excludedSkillPath?: string
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
    excludedSkillPath,
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
          excludedSkillPath,
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
