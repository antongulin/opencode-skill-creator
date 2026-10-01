import { expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readlinkSync,
  readdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  realpathSync,
} from "fs"
import { tmpdir } from "os"
import { dirname, join } from "path"

import {
  assertNoInstalledSkillConflict,
  buildEvalWarnings,
  buildOpenCodeRunCommand,
  createV2SkillEnumerator,
  findSkillConflictsInList,
  isAbortError,
  runEval,
  symlinkProjectOpenCodeConfig,
  type EvalResultItem,
  type SkillEnumerator,
} from "../lib/run-eval"

const baseResult = (overrides: Partial<EvalResultItem>): EvalResultItem => ({
  query: "query",
  should_trigger: true,
  trigger_rate: 0,
  triggers: 0,
  runs: 3,
  successful_runs: 3,
  errors: 0,
  pass: false,
  ...overrides,
})

test("buildOpenCodeRunCommand uses the build agent by default", () => {
  expect(buildOpenCodeRunCommand("Create a skill", {})).toEqual([
    "opencode",
    "run",
    "--format",
    "json",
    "--agent",
    "build",
    "Create a skill",
  ])
})

test("buildOpenCodeRunCommand accepts a custom agent and model", () => {
  expect(
    buildOpenCodeRunCommand("Create a skill", {
      agent: "custom-agent",
      model: "openai/gpt-5.5",
    }),
  ).toEqual([
    "opencode",
    "run",
    "--format",
    "json",
    "--agent",
    "custom-agent",
    "--model",
    "openai/gpt-5.5",
    "Create a skill",
  ])
})

test("buildEvalWarnings warns when all should-trigger results have zero triggers and no errors", () => {
  expect(
    buildEvalWarnings([
      baseResult({ query: "trigger one" }),
      baseResult({ query: "trigger two" }),
      baseResult({
        query: "negative",
        should_trigger: false,
        pass: true,
      }),
    ]),
  ).toEqual([
    "All should-trigger queries produced 0 triggers with no run errors. Check that trigger evals are using an agent that exposes skill tool events, such as the build agent.",
  ])
})

test("buildEvalWarnings returns no warnings when any should-trigger query triggers", () => {
  expect(
    buildEvalWarnings([
      baseResult({ query: "trigger one" }),
      baseResult({
        query: "trigger two",
        trigger_rate: 1,
        triggers: 3,
        pass: true,
      }),
    ]),
  ).toEqual([])
})

test("symlinkProjectOpenCodeConfig preserves config and excludes tested skill", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "skill-eval-project-"))
  const evalRoot = mkdtempSync(join(tmpdir(), "skill-eval-root-"))
  try {
    const sourceOpenCode = join(projectRoot, ".opencode")
    mkdirSync(join(sourceOpenCode, "skills", "tested-skill"), { recursive: true })
    mkdirSync(join(sourceOpenCode, "skills", "other-skill"), { recursive: true })
    writeFileSync(join(sourceOpenCode, "opencode.json"), "{}")

    symlinkProjectOpenCodeConfig(projectRoot, evalRoot, "tested-skill")

    // Config and sibling skills are mirrored into the eval root. Where symlinks
    // are supported the entries are links pointing at the source; where the copy
    // fallback runs (e.g. Windows without Developer Mode) they are plain copies.
    // Assert presence either way, and the exact link target when it is a symlink.
    const opencodeJson = join(evalRoot, ".opencode", "opencode.json")
    expect(existsSync(opencodeJson)).toBe(true)
    if (lstatSync(opencodeJson).isSymbolicLink()) {
      expect(readlinkSync(opencodeJson)).toBe(join(sourceOpenCode, "opencode.json"))
    }

    const otherSkill = join(evalRoot, ".opencode", "skills", "other-skill")
    expect(existsSync(otherSkill)).toBe(true)
    if (lstatSync(otherSkill).isSymbolicLink()) {
      expect(readlinkSync(otherSkill)).toBe(join(sourceOpenCode, "skills", "other-skill"))
    }

    // The skill under test is excluded entirely so it cannot steal triggers.
    expect(existsSync(join(evalRoot, ".opencode", "skills", "tested-skill"))).toBe(false)
  } finally {
    rmSync(projectRoot, { recursive: true, force: true })
    rmSync(evalRoot, { recursive: true, force: true })
  }
})

test("symlinkProjectOpenCodeConfig mirrors the direct root config documents and preserves relative base", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "skill-eval-rootconfig-"))
  const evalRoot = mkdtempSync(join(tmpdir(), "skill-eval-rootconfig-eval-"))
  try {
    // A project that defines provider/agent config at BOTH the root document
    // and the .opencode directory, plus a root-relative instructions file.
    writeFileSync(
      join(projectRoot, "opencode.jsonc"),
      JSON.stringify({ instructions: ["./local-rules.md"], agent: { "root-agent": {} } }),
    )
    writeFileSync(
      join(projectRoot, "opencode.json"),
      JSON.stringify({ agent: { "json-agent": {} } }),
    )
    writeFileSync(join(projectRoot, "local-rules.md"), "root rules\n")
    mkdirSync(join(projectRoot, ".opencode"), { recursive: true })
    writeFileSync(join(projectRoot, ".opencode", "opencode.json"), JSON.stringify({}))

    symlinkProjectOpenCodeConfig(projectRoot, evalRoot, "tested-skill")

    // Both root documents are present in the eval root at the SAME relative
    // position, so a relative `instructions`/`{file:...}` path resolves to the
    // (mirrored) sibling rather than silently re-pointing into the eval root.
    for (const name of ["opencode.json", "opencode.jsonc"]) {
      const target = join(evalRoot, name)
      expect(existsSync(target)).toBe(true)
      if (lstatSync(target).isSymbolicLink()) {
        expect(readlinkSync(target)).toBe(join(projectRoot, name))
      }
    }
    // The sibling instruction file the root config references is resolvable
    // from the eval root because it is a sibling document there too. Assert
    // unconditionally: a missing reference must fail, not silently pass.
    const rulesTarget = join(evalRoot, "local-rules.md")
    expect(existsSync(rulesTarget)).toBe(true)
    expect(readFileSync(rulesTarget, "utf-8")).toBe("root rules\n")
    // The .opencode document is still mirrored.
    expect(existsSync(join(evalRoot, ".opencode", "opencode.json"))).toBe(true)
  } finally {
    rmSync(projectRoot, { recursive: true, force: true })
    rmSync(evalRoot, { recursive: true, force: true })
  }
})

test("symlinkProjectOpenCodeConfig expands glob references and never reintroduces the tested skill", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "skill-eval-glob-"))
  const evalRoot = mkdtempSync(join(tmpdir(), "skill-eval-glob-eval-"))
  try {
    // A glob instruction and a directory reference that *contains* the tested
    // skill under .opencode/skills — neither may smuggle the skill back in.
    writeFileSync(
      join(projectRoot, "opencode.jsonc"),
      JSON.stringify({
        instructions: [".cursor/rules/*.md", ".opencode/skills"],
      }),
    )
    mkdirSync(join(projectRoot, ".cursor", "rules"), { recursive: true })
    writeFileSync(join(projectRoot, ".cursor", "rules", "a.md"), "A rules\n")
    writeFileSync(join(projectRoot, ".cursor", "rules", "b.md"), "B rules\n")
    mkdirSync(join(projectRoot, ".opencode", "skills", "tested-skill"), { recursive: true })
    writeFileSync(
      join(projectRoot, ".opencode", "skills", "tested-skill", "SKILL.md"),
      "---\nname: tested-skill\n---\n",
    )
    mkdirSync(join(projectRoot, ".opencode", "skills", "sibling-skill"), { recursive: true })
    writeFileSync(join(projectRoot, ".opencode", "skills", "sibling-skill", "SKILL.md"), "x")

    symlinkProjectOpenCodeConfig(projectRoot, evalRoot, "tested-skill")

    // Glob-expanded files come across with content intact.
    expect(existsSync(join(evalRoot, ".cursor", "rules", "a.md"))).toBe(true)
    expect(existsSync(join(evalRoot, ".cursor", "rules", "b.md"))).toBe(true)
    expect(readFileSync(join(evalRoot, ".cursor", "rules", "a.md"), "utf-8")).toBe("A rules\n")
    // The sibling skill is mirrored; the tested skill must be ABSENT — the
    // directory reference into `.opencode/skills` must never reintroduce it.
    expect(existsSync(join(evalRoot, ".opencode", "skills", "tested-skill"))).toBe(false)
  } finally {
    rmSync(projectRoot, { recursive: true, force: true })
    rmSync(evalRoot, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// Glob-mirror boundaries (CG1): real files, observable stderr, no silent loss.
// The mirror reports unsupported patterns on stderr and never copies outside
// the project root; supported patterns keep working.
// ---------------------------------------------------------------------------

/** Capture stderr during one mirror call, plus which files appeared. */
function mirrorCapturingStderr(
  layout: (projectRoot: string) => void,
  pattern: string,
  skillName = "tested-skill",
) {
  const projectRoot = mkdtempSync(join(tmpdir(), "skill-eval-glob-boundary-"))
  const evalRoot = mkdtempSync(join(tmpdir(), "skill-eval-glob-boundary-eval-"))
  const warnings: string[] = []
  const originalError = console.error
  let result: { warnings: string[]; mirrored: string[]; readMirror: (name: string) => string }
  try {
    layout(projectRoot)
    writeFileSync(
      join(projectRoot, "opencode.jsonc"),
      JSON.stringify({ instructions: [pattern] }),
    )
    console.error = (...args: unknown[]) => warnings.push(args.join(" "))
    symlinkProjectOpenCodeConfig(projectRoot, evalRoot, skillName)
    console.error = originalError
    const mirrored: string[] = []
    // Content is read from the source project (the mirror is a symlink to it
    // on symlink-capable platforms), captured as data before cleanup.
    const contents: Map<string, string> = new Map()
    const collect = (base: string) => {
      for (const entry of readdirSync(base, { withFileTypes: true })) {
        if (entry.name === "opencode.jsonc") continue
        const child = join(base, entry.name)
        if (entry.isDirectory()) collect(child)
        else {
          mirrored.push(child)
          const source = lstatSync(child).isSymbolicLink()
            ? readlinkSync(child)
            : child
          try {
            contents.set(entry.name, readFileSync(source, "utf-8"))
          } catch {
            // A dangling or unreadable mirror entry still counts as mirrored;
            // per-test assertions read from `mirrored`, not from contents.
          }
        }
      }
    }
    collect(evalRoot)
    const readMirror = (name: string): string => {
      const value = contents.get(name)
      expect(value !== undefined).toBe(true)
      return value!
    }
    result = { warnings, mirrored: mirrored.sort(), readMirror }
    return result
  } finally {
    console.error = originalError
    rmSync(projectRoot, { recursive: true, force: true })
    rmSync(evalRoot, { recursive: true, force: true })
  }
}

test("parent-directory glob is reported and never copied out of the project", () => {
  let siblingFile = ""
  const { warnings, mirrored, projectRoot } = mirrorCapturingStderr((root) => {
    // The referenced material lives OUTSIDE the project: ../shared/a.md.
    const shared = join(dirname(root), "shared")
    mkdirSync(shared, { recursive: true })
    siblingFile = join(shared, "a.md")
    writeFileSync(siblingFile, "shared rules\n")
  }, "../shared/*.md")
  expect(warnings.length).toBe(1)
  expect(warnings[0]).toContain("../shared/*.md")
  expect(warnings[0]).toContain("parent directory")
  // Nothing outside the project root may appear inside the eval root.
  expect(mirrored.some((path) => path.includes("shared"))).toBe(false)
  // ...and nothing outside the project root was itself modified.
  expect(existsSync(siblingFile)).toBe(true)
  expect(readFileSync(siblingFile, "utf-8")).toBe("shared rules\n")
  // Only the mirrored config document lands in the eval root.
  expect(mirrored).toEqual([])
})

test("brace alternation is reported as unsupported and nothing is mirrored", () => {
  const { warnings, mirrored } = mirrorCapturingStderr((root) => {
    mkdirSync(join(root, "rules"), { recursive: true })
    writeFileSync(join(root, "rules", "a.md"), "A rules\n")
    writeFileSync(join(root, "rules", "b.md"), "B rules\n")
  }, "rules/{a,b}.md")
  expect(warnings.length).toBe(1)
  expect(warnings[0]).toContain("rules/{a,b}.md")
  expect(warnings[0]).toContain("brace alternation")
  expect(mirrored).toEqual([])
})

test("single-directory glob remains supported and copies only the pattern matches", () => {
  const { warnings, mirrored, readMirror } = mirrorCapturingStderr((root) => {
    mkdirSync(join(root, "rules"), { recursive: true })
    writeFileSync(join(root, "rules", "foo.md"), "A rules\n")
    // Same prefix, different extension: `*.md` must not select it.
    writeFileSync(join(root, "rules", "foo.md.bak"), "backup\n")
  }, "rules/*.md")
  expect(warnings).toEqual([])
  expect(mirrored.length).toBe(1)
  expect(mirrored[0]).toContain("foo.md")
  expect(readMirror("foo.md")).toBe("A rules\n")
  expect(mirrored.some((path) => path.endsWith(".bak"))).toBe(false)
})

test("repeated directory segments match by position, not by name", () => {
  const { warnings, mirrored, readMirror } = mirrorCapturingStderr((root) => {
    // `a/a/*.md` needs the LAST segment to expand the directory a second
    // time, even though its value equals the first segment's value.
    mkdirSync(join(root, "a", "a"), { recursive: true })
    writeFileSync(join(root, "a", "a", "deep.md"), "deep rules\n")
  }, "a/a/*.md")
  expect(warnings).toEqual([])
  expect(mirrored.length).toBe(1)
  expect(mirrored[0]).toContain(join("a", "a", "deep.md"))
  expect(readMirror("deep.md")).toBe("deep rules\n")
})

test("dot-prefixed basename inside the project is a valid mirror target", () => {
  const { warnings, mirrored, readMirror } = mirrorCapturingStderr((root) => {
    // `..notes.md` starts with ".." but stays inside the project root.
    writeFileSync(join(root, "..notes.md"), "dot-prefixed rules\n")
  }, "..notes.md")
  expect(warnings).toEqual([])
  expect(mirrored.length).toBe(1)
  expect(mirrored[0]).toContain("..notes.md")
  expect(readMirror("..notes.md")).toBe("dot-prefixed rules\n")
})

test("dot-prefixed basename nested under a directory mirrors too", () => {
  const { warnings, mirrored, readMirror } = mirrorCapturingStderr((root) => {
    mkdirSync(join(root, "rules"), { recursive: true })
    writeFileSync(join(root, "rules", "..notes.md"), "nested dot-prefixed rules\n")
  }, "rules/..notes.md")
  expect(warnings).toEqual([])
  expect(mirrored.length).toBe(1)
  expect(mirrored[0]).toContain(join("rules", "..notes.md"))
  expect(readMirror("..notes.md")).toBe("nested dot-prefixed rules\n")
})

test("malformed character class is reported, not thrown", () => {
  const { warnings, mirrored } = mirrorCapturingStderr((root) => {
    writeFileSync(join(root, "za.md"), "z rules\n")
  }, "[z-a].md")
  expect(warnings.length).toBe(1)
  expect(warnings[0]).toContain("[z-a]")
  expect(warnings[0]).toContain("malformed glob segment")
  expect(mirrored).toEqual([])
})

test("** recursion keeps reporting its unsupported boundary", () => {
  const { warnings, mirrored } = mirrorCapturingStderr((root) => {
    mkdirSync(join(root, "a", "b"), { recursive: true })
    writeFileSync(join(root, "a", "b", "deep.md"), "deep rules\n")
  }, "a/**/*.md")
  expect(warnings.length).toBe(1)
  expect(warnings[0]).toContain("**")
  expect(mirrored).toEqual([])
})

test("glob reference into the tested skill's directory never reintroduces it", () => {
  const { warnings, mirrored } = mirrorCapturingStderr((root) => {
    // The glob's expansion range overlaps .opencode/skills/<tested-skill>;
    // the tested skill must stay excluded while its sibling comes across.
    mkdirSync(join(root, ".opencode", "skills", "tested-skill"), { recursive: true })
    mkdirSync(join(root, ".opencode", "skills", "sibling-skill"), { recursive: true })
    writeFileSync(join(root, ".opencode", "skills", "tested-skill", "SKILL.md"), "tested skill body")
    writeFileSync(join(root, ".opencode", "skills", "sibling-skill", "SKILL.md"), "sibling body")
  }, ".opencode/skills/*/SKILL.md", "tested-skill")
  expect(warnings).toEqual([])
  expect(mirrored.some((path) => path.includes("sibling-skill"))).toBe(true)
  expect(mirrored.some((path) => path.includes("tested-skill"))).toBe(false)
})

// ---------------------------------------------------------------------------
// Conflict guard (D-01): the enumerator is injected so V2's ctx.skill.list path
// is exercised deterministically. A null result must abort, not warn-and-skip.
// ---------------------------------------------------------------------------

test("assertNoInstalledSkillConflict throws the conflict when a skill matches", async () => {
  const enumerate: SkillEnumerator = async () => [
    { name: "demo-skill", location: "/skills/demo-skill" },
  ]

  await expect(
    assertNoInstalledSkillConflict("demo-skill", "/project", enumerate),
  ).rejects.toThrow(/already available to opencode at \/skills\/demo-skill/)
})

test("assertNoInstalledSkillConflict passes when no skill matches", async () => {
  const enumerate: SkillEnumerator = async () => [
    { name: "other-skill", location: "/skills/other" },
  ]

  await expect(
    assertNoInstalledSkillConflict("demo-skill", "/project", enumerate),
  ).resolves.toBeUndefined()
})

test("assertNoInstalledSkillConflict aborts with an actionable error when enumeration is unavailable", async () => {
  const enumerate: SkillEnumerator = async () => null

  await expect(
    assertNoInstalledSkillConflict("demo-skill", "/project", enumerate),
  ).rejects.toThrow(/could not enumerate the skills installed in this project/)
})

test("findSkillConflictsInList reports unknown location when a match has none", () => {
  expect(findSkillConflictsInList([{ name: "target" }], "target")).toEqual([
    "unknown location",
  ])
})

// ---------------------------------------------------------------------------
// D-02: the V2 ctx.skill.list -> enumerator mapping is exercised directly.
// ---------------------------------------------------------------------------

test("createV2SkillEnumerator scopes the request to the project root", async () => {
  const calls: unknown[] = []
  const enumerate = createV2SkillEnumerator({
    skill: {
      list: async (input) => {
        calls.push(input)
        return {
          data: [
            { id: "a", name: "alpha", path: "/skills/alpha" },
            { id: "b", name: "beta" },
            { id: "c" }, // no name -> dropped
          ],
        }
      },
    },
  })

  expect(await enumerate("/project/location")).toEqual([
    { name: "alpha", location: "/skills/alpha" },
    { name: "beta", location: undefined },
  ])
  expect(calls).toEqual([{ location: { directory: "/project/location" } }])
})

test("createV2SkillEnumerator returns null when the skill API fails", async () => {
  const enumerate = createV2SkillEnumerator({
    skill: {
      list: async () => {
        throw new Error("server unavailable")
      },
    },
  })

  expect(await enumerate("/project")).toBeNull()
})

test("createV2SkillEnumerator returns null for an unexpected shape", async () => {
  const enumerate = createV2SkillEnumerator({
    skill: { list: async () => ({ data: "not-an-array" }) },
  })

  expect(await enumerate("/project")).toBeNull()
})

// ---------------------------------------------------------------------------
// C-03: the captured real v2 event stream is fed through the actual runEval
// subprocess harness (not a re-implementation of the parser), so a real
// envelope change is caught against observable behavior.
// ---------------------------------------------------------------------------

// Captured 2026-09-30 from `opencode run --standalone --format json` v2.0.19.
const CAPTURED_TOOL_USE_EVENT = {
  type: "tool_use",
  timestamp: 1790804495430,
  sessionID: "ses_fixture",
  part: {
    partID: "prt_fixture",
    sessionID: "ses_fixture",
    messageID: "msg_fixture",
    type: "tool",
    id: "call_fixture",
    tool: "read",
    state: {
      status: "completed",
      input: { path: "{skill}/SKILL.md" },
      output: "Read file data.txt, lines 1-1",
      title: "read",
    },
  },
}

// ---------------------------------------------------------------------------
// runEval subprocess harness (C-01/C-02): a scripted fake `opencode` on PATH.
// Real Node child_process plumbing, no LLM.
// ---------------------------------------------------------------------------

interface EvalHarness {
  root: string
  binDir: string
  projectRoot: string
  scenarioPath: string
  cleanup: () => void
}

function makeEvalHarness(): EvalHarness {
  const root = mkdtempSync(join(tmpdir(), "skill-eval-harness-"))
  const binDir = join(root, "bin")
  const projectRoot = join(root, "project")
  mkdirSync(binDir, { recursive: true })
  mkdirSync(projectRoot, { recursive: true })

  // Fake `opencode`: emits the JSON lines listed in the scenario file, then
  // exits with the configured code. `{skill}` is replaced with the synthetic
  // skill name found in the cwd. Optional scenario fields:
  //   argvFile  - path to write process.argv.slice(2) for flag assertions
  //   envFile   - path to write cwd + PWD + root-config file set for isolation
  //               and config-mirroring assertions
  //   chunkSize - split the whole payload into chunks of this byte size,
  //               forcing buffer reassembly across chunk boundaries
  //   noFinalNewline - omit the trailing newline so the final-buffer path runs
  //   markerFile - write this pid to the file at startup so the test can
  //                observe/await a running child before aborting it
  //   startLog   - append `{pid,cwd}` (one JSON line per start) so a test can
  //                count started jobs and later verify their temp roots are gone
  const fake = `#!/usr/bin/env node
const fs = require("fs")
const path = require("path")
const scenario = JSON.parse(fs.readFileSync(process.env.SKC_EVAL_SCENARIO, "utf-8"))
const cwd = process.cwd()
if (scenario.startLog) fs.appendFileSync(scenario.startLog, JSON.stringify({ pid: process.pid, cwd }) + "\\n")
let cleanName = "unknown"
try {
  const skills = fs.readdirSync(path.join(cwd, ".opencode", "skills"))
  if (skills.length) cleanName = skills[0]
} catch {}
if (scenario.markerFile) fs.writeFileSync(scenario.markerFile, String(process.pid))
if (scenario.argvFile) fs.writeFileSync(scenario.argvFile, JSON.stringify(process.argv.slice(2)))
if (scenario.envFile) {
  const rootConfigs = ["opencode.json", "opencode.jsonc"].filter((name) => fs.existsSync(path.join(cwd, name)))
  const instructionFiles = ["local-rules.md"].filter((name) => fs.existsSync(path.join(cwd, name)))
  const instructionContent = instructionFiles.length ? fs.readFileSync(path.join(cwd, "local-rules.md"), "utf-8") : null
  fs.writeFileSync(scenario.envFile, JSON.stringify({
    cwd: fs.realpathSync(cwd),
    pwd: process.env.PWD ? fs.realpathSync(process.env.PWD) : null,
    rootConfigs,
    instructionFiles,
    instructionContent,
    testedSkillPresent: fs.existsSync(path.join(cwd, ".opencode", "skills", "demo-skill")),
  }))
}
const lines = Array.isArray(scenario.lines) ? scenario.lines : []
const payload = lines.map((line) => line.split("{skill}").join(cleanName) + "\\n").join("")
const finish = () => {
  if (scenario.sleepMs) setTimeout(() => process.exit(scenario.exitCode ?? 0), scenario.sleepMs)
  else process.exit(scenario.exitCode ?? 0)
}
if (scenario.ignoreSigterm) process.on("SIGTERM", () => {})
if (scenario.chunkSize) {
  let offset = 0
  const writeNext = () => {
    if (offset >= payload.length) return finish()
    process.stdout.write(payload.slice(offset, offset + scenario.chunkSize))
    offset += scenario.chunkSize
    setImmediate(writeNext)
  }
  writeNext()
} else if (payload) {
  process.stdout.write(scenario.noFinalNewline ? payload.replace(/\\n$/, "") : payload)
  finish()
} else {
  finish()
}
`
  const fakePath = join(binDir, "opencode")
  writeFileSync(fakePath, fake)
  chmodSync(fakePath, 0o755)

  const scenarioPath = join(root, "scenario.json")

  return {
    root,
    binDir,
    projectRoot,
    scenarioPath,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

function triggerLine(tool = "read"): string {
  return JSON.stringify({
    type: "tool_use",
    part: { tool, input: { path: "{skill}/SKILL.md" } },
  })
}

async function runEvalWithScenario(
  harness: EvalHarness,
  scenario: Record<string, unknown>,
  opts: {
    evalSet: { query: string; should_trigger: boolean }[]
    runsPerQuery?: number
    timeout?: number
    numWorkers?: number
    model?: string
    agent?: string
    signal?: AbortSignal
  },
) {
  writeFileSync(harness.scenarioPath, JSON.stringify(scenario))
  const previousPath = process.env.PATH
  const previousScenario = process.env.SKC_EVAL_SCENARIO
  process.env.PATH = `${harness.binDir}:${previousPath ?? ""}`
  process.env.SKC_EVAL_SCENARIO = harness.scenarioPath
  try {
    return await runEval({
      evalSet: opts.evalSet,
      skillName: "demo-skill",
      description: "A demo skill for testing.",
      numWorkers: opts.numWorkers ?? 2,
      timeout: opts.timeout ?? 10,
      projectRoot: harness.projectRoot,
      runsPerQuery: opts.runsPerQuery ?? 1,
      model: opts.model,
      agent: opts.agent,
      signal: opts.signal,
    })
  } finally {
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    if (previousScenario === undefined) delete process.env.SKC_EVAL_SCENARIO
    else process.env.SKC_EVAL_SCENARIO = previousScenario
  }
}

test("runEval detects a trigger from the captured real v2 tool_use event", async () => {
  const harness = makeEvalHarness()
  try {
    // The captured event is passed unchanged through the real subprocess parser.
    const output = await runEvalWithScenario(
      harness,
      {
        lines: [
          JSON.stringify({ type: "step_start" }),
          JSON.stringify(CAPTURED_TOOL_USE_EVENT),
        ],
        exitCode: 0,
      },
      { evalSet: [{ query: "trigger me", should_trigger: true }] },
    )

    expect(output.summary.total).toBe(1)
    expect(output.results[0].triggers).toBe(1)
    expect(output.results[0].trigger_rate).toBe(1)
    expect(output.results[0].pass).toBe(true)
  } finally {
    harness.cleanup()
  }
})

test("runEval detects a trigger when the stream is split across chunk boundaries", async () => {
  const harness = makeEvalHarness()
  try {
    const output = await runEvalWithScenario(
      harness,
      {
        lines: [JSON.stringify(CAPTURED_TOOL_USE_EVENT)],
        chunkSize: 7,
        exitCode: 0,
      },
      { evalSet: [{ query: "chunked", should_trigger: true }] },
    )

    expect(output.results[0].triggers).toBe(1)
    expect(output.results[0].errors).toBe(0)
  } finally {
    harness.cleanup()
  }
})

test("runEval detects a trigger when the final event has no trailing newline", async () => {
  const harness = makeEvalHarness()
  try {
    const output = await runEvalWithScenario(
      harness,
      {
        lines: [JSON.stringify(CAPTURED_TOOL_USE_EVENT)],
        noFinalNewline: true,
        exitCode: 0,
      },
      { evalSet: [{ query: "final buffer", should_trigger: true }] },
    )

    expect(output.results[0].triggers).toBe(1)
  } finally {
    harness.cleanup()
  }
})

test("runEval passes agent/model flags and isolates the child PWD to the eval root", async () => {
  const harness = makeEvalHarness()
  const argvFile = join(harness.root, "argv.json")
  const envFile = join(harness.root, "env.json")
  try {
    await runEvalWithScenario(
      harness,
      { lines: [triggerLine("read")], argvFile, envFile, exitCode: 0 },
      {
        evalSet: [{ query: "flags", should_trigger: true }],
        agent: "custom-agent",
        model: "ollama-cloud/deepseek-v4.1-flash",
      },
    )

    const argv = JSON.parse(readFileSync(argvFile, "utf-8"))
    expect(argv).toEqual([
      "run",
      "--format",
      "json",
      "--agent",
      "custom-agent",
      "--model",
      "ollama-cloud/deepseek-v4.1-flash",
      "flags",
    ])

    // The child must not inherit the caller's PWD: the nested run resolves
    // project skills from PWD, so leaking it reintroduces the false-0 bug.
    // The fake records already-resolved paths (the eval root is removed on
    // cleanup, so the test must not re-resolve them).
    const env = JSON.parse(readFileSync(envFile, "utf-8"))
    expect(env.pwd).toBe(env.cwd)
    expect(env.cwd.startsWith(realpathSync(tmpdir()))).toBe(true)
    // The eval root is isolated, not the real project under test.
    expect(env.cwd).not.toBe(realpathSync(harness.projectRoot))
  } finally {
    harness.cleanup()
  }
})

test("runEval ignores non-JSON noise and unrelated tools", async () => {
  const harness = makeEvalHarness()
  try {
    const output = await runEvalWithScenario(
      harness,
      {
        lines: [
          "not json at all",
          "{broken",
          JSON.stringify({ type: "tool_use", part: { tool: "bash", input: { command: "ls" } } }),
          JSON.stringify({ type: "tool_use", part: { tool: "read", input: { path: "/elsewhere" } } }),
        ],
        exitCode: 0,
      },
      { evalSet: [{ query: "should not trigger", should_trigger: false }] },
    )

    expect(output.results[0].triggers).toBe(0)
    expect(output.results[0].pass).toBe(true) // negative query passing
    expect(output.summary.run_errors).toBe(0)
  } finally {
    harness.cleanup()
  }
})

test("runEval accounts a non-zero exit as an error and aggregates summary", async () => {
  const harness = makeEvalHarness()
  try {
    const output = await runEvalWithScenario(
      harness,
      { lines: [], exitCode: 3 },
      { evalSet: [{ query: "will error", should_trigger: true }] },
    )

    expect(output.results[0].errors).toBe(1)
    expect(output.results[0].pass).toBe(false)
    expect(output.summary.run_errors).toBe(1)
    expect(output.summary.queries_with_errors).toBe(1)
    expect(output.summary.failed).toBe(1)
  } finally {
    harness.cleanup()
  }
})

test("runEval treats a timeout as an error rather than a missing trigger", async () => {
  const harness = makeEvalHarness()
  try {
    const output = await runEvalWithScenario(
      harness,
      { lines: [], sleepMs: 5_000, exitCode: 0 },
      { evalSet: [{ query: "slow", should_trigger: true }], timeout: 1 },
    )

    expect(output.results[0].errors).toBe(1)
    expect(output.summary.run_errors).toBe(1)
  } finally {
    harness.cleanup()
  }
})

test("runEval stops a query early once the trigger is seen", async () => {
  const harness = makeEvalHarness()
  try {
    const started = Date.now()
    const output = await runEvalWithScenario(
      harness,
      { lines: [triggerLine("skill")], sleepMs: 5_000, exitCode: 0 },
      { evalSet: [{ query: "early stop", should_trigger: true }], timeout: 30 },
    )
    const elapsed = Date.now() - started

    expect(output.results[0].triggers).toBe(1)
    expect(output.results[0].errors).toBe(0)
    // Would exceed this if the slow child were awaited to completion.
    expect(elapsed).toBeLessThan(4_000)
  } finally {
    harness.cleanup()
  }
})

test("runEval aggregates multi-run trigger rates and thresholds", async () => {
  const harness = makeEvalHarness()
  try {
    // First run triggers, second run does not (alternating via scenario swap is
    // awkward; use a trigger line and a runsPerQuery of 1 with two items).
    const output = await runEvalWithScenario(
      harness,
      { lines: [triggerLine("read")], exitCode: 0 },
      {
        evalSet: [
          { query: "positive", should_trigger: true },
          { query: "negative", should_trigger: false },
        ],
        runsPerQuery: 2,
      },
    )

    const positive = output.results.find((r) => r.query === "positive")!
    const negative = output.results.find((r) => r.query === "negative")!

    expect(positive.triggers).toBe(2)
    expect(positive.runs).toBe(2)
    expect(positive.pass).toBe(true)
    // A negative query that triggers fails its threshold.
    expect(negative.triggers).toBe(2)
    expect(negative.pass).toBe(false)
    expect(output.summary.total).toBe(2)
    expect(output.summary.passed).toBe(1)
    expect(output.summary.failed).toBe(1)
  } finally {
    harness.cleanup()
  }
})

// ---------------------------------------------------------------------------
// LD2-2: the child eval root exposes the project's direct root config documents
// (and the relative files they reference) plus the .opencode document, while the
// evaluated skill stays excluded. This is a real subprocess; no LLM.
// ---------------------------------------------------------------------------

test("runEval child root carries the direct root config, referenced instructions and .opencode config", async () => {
  const harness = makeEvalHarness()
  const envFile = join(harness.root, "layout.json")
  try {
    // Root config referencing a root-relative instruction file, plus the
    // .opencode document and the skill that must be excluded.
    writeFileSync(
      join(harness.projectRoot, "opencode.jsonc"),
      JSON.stringify({ instructions: ["./local-rules.md"] }),
    )
    writeFileSync(join(harness.projectRoot, "local-rules.md"), "project local rules\n")
    const dotOpenCode = join(harness.projectRoot, ".opencode")
    mkdirSync(dotOpenCode, { recursive: true })
    writeFileSync(join(dotOpenCode, "opencode.json"), "{}")
    mkdirSync(join(dotOpenCode, "skills", "demo-skill"), { recursive: true })

    await runEvalWithScenario(
      harness,
      { lines: [triggerLine("read")], envFile, exitCode: 0 },
      { evalSet: [{ query: "layout", should_trigger: true }] },
    )

    const layout = JSON.parse(readFileSync(envFile, "utf-8"))
    expect(layout.pwd).toBe(layout.cwd)
    // The direct root document the project defines is present in the eval root.
    expect(layout.rootConfigs).toContain("opencode.jsonc")
    // Its relative instruction file is carried across with its CONTENT intact,
    // so it stays resolvable and effective from the selected root.
    expect(layout.instructionFiles).toContain("local-rules.md")
    expect(layout.instructionContent).toBe("project local rules\n")
    // The skill under test is excluded so it cannot steal triggers.
    expect(layout.testedSkillPresent).toBe(false)
  } finally {
    harness.cleanup()
  }
})

// ---------------------------------------------------------------------------
// LD3-2: an external abort stops queued jobs, kills running children and is
// reported as an explicit AbortError, never a scored negative.
// ---------------------------------------------------------------------------

test("runEval aborts with AbortError, stops queued jobs, kills the child and cleans its root", async () => {
  const harness = makeEvalHarness()
  const startLog = join(harness.root, "starts.log")
  const controller = new AbortController()
  let pending: Promise<unknown> | undefined
  try {
    pending = runEvalWithScenario(
      harness,
      { lines: [], sleepMs: 30_000, startLog, exitCode: 0 },
      {
        evalSet: [
          { query: "job-a", should_trigger: true },
          { query: "job-b", should_trigger: true },
          { query: "job-c", should_trigger: true },
        ],
        numWorkers: 1,
        timeout: 60,
        signal: controller.signal,
      },
    )

    // Wait until the first child has actually started (its start record is
    // appended), then abort.
    const deadline = Date.now() + 5_000
    while (!existsSync(startLog) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const starts = () => readFileSync(startLog, "utf-8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
    const started = starts()
    expect(started.length).toBeGreaterThan(0)
    const first = started[0]

    const startedAt = Date.now()
    controller.abort()

    let caught: unknown
    try {
      await pending
    } catch (error) {
      caught = error
    }
    expect(isAbortError(caught)).toBe(true)
    // Did not run the full 30 s child.
    expect(Date.now() - startedAt).toBeLessThan(5_000)

    // Exactly one job started: the queued jobs (numWorkers 1) never spawned.
    expect(starts()).toHaveLength(1)

    const alive = (() => {
      try {
        process.kill(first.pid, 0)
        return true
      } catch {
        return false
      }
    })()
    expect(alive).toBe(false)

    // Every started child's isolated eval root was removed after the run.
    const allStarted = starts()
    for (const entry of allStarted) {
      expect(existsSync(entry.cwd)).toBe(false)
    }
  } finally {
    controller.abort()
    try {
      await pending
    } catch {
      /* rejected with AbortError; nothing to do */
    }
    harness.cleanup()
  }
})

test("runEval rejects a pre-aborted signal without spawning any child", async () => {
  const harness = makeEvalHarness()
  const startLog = join(harness.root, "starts.log")
  const controller = new AbortController()
  controller.abort()
  let pending: Promise<unknown> | undefined
  try {
    pending = runEvalWithScenario(
      harness,
      { lines: [triggerLine("read")], startLog, exitCode: 0 },
      {
        evalSet: [{ query: "never", should_trigger: true }],
        signal: controller.signal,
      },
    )
    let caught: unknown
    try {
      await pending
    } catch (error) {
      caught = error
    }
    expect(isAbortError(caught)).toBe(true)
    expect(existsSync(startLog)).toBe(false)
  } finally {
    controller.abort()
    try {
      await pending
    } catch {
      /* expected */
    }
    harness.cleanup()
  }
})

test("runEval escalates to SIGKILL for an abort-ignoring child within the grace period", async () => {
  const harness = makeEvalHarness()
  const startLog = join(harness.root, "starts.log")
  const controller = new AbortController()
  let pending: Promise<unknown> | undefined
  try {
    pending = runEvalWithScenario(
      harness,
      { lines: [], sleepMs: 30_000, ignoreSigterm: true, startLog, exitCode: 0 },
      {
        evalSet: [{ query: "stubborn", should_trigger: true }],
        numWorkers: 1,
        timeout: 60,
        signal: controller.signal,
      },
    )

    const deadline = Date.now() + 5_000
    while (!existsSync(startLog) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const first = JSON.parse(readFileSync(startLog, "utf-8").trim().split("\n")[0])

    const startedAt = Date.now()
    controller.abort()

    let caught: unknown
    try {
      await pending
    } catch (error) {
      caught = error
    }
    expect(isAbortError(caught)).toBe(true)
    // The default 1 s grace period escalates to SIGKILL, so the stubborn child
    // is gone well before its 30 s lifetime.
    expect(Date.now() - startedAt).toBeLessThan(5_000)

    const alive = (() => {
      try {
        process.kill(first.pid, 0)
        return true
      } catch {
        return false
      }
    })()
    expect(alive).toBe(false)
  } finally {
    controller.abort()
    try {
      await pending
    } catch {
      /* expected */
    }
    harness.cleanup()
  }
})

// ---------------------------------------------------------------------------
// LD2-3: effective V2 config through the real runtime, not a document list.
// A synthetic eval root is built by mirroring the ORIGINAL project (a root
// `opencode.jsonc` plus a root-relative instructions file), then the real
// OpenCode CLI is run from that eval root. `--agent <root-agent>` resolves only
// if the mirrored root config is actually effective (an unknown id exits with
// "Agent not found"), and the eval-root child reads the mirrored instruction
// file and reports its CONTENT. Offline, no model; skips without the CLI.
// ---------------------------------------------------------------------------

function resolveOpencodeCli(): string | null {
  try {
    return execFileSync("which", ["opencode"], { encoding: "utf-8" }).trim() || null
  } catch {
    return null
  }
}

test(
  "the mirrored eval root is effective: a root-config agent resolves and its relative instruction content is present",
  { skip: resolveOpencodeCli() ? false : "opencode CLI not installed" },
  () => {
    const root = mkdtempSync(join(tmpdir(), "skc-effective-probe-"))
    const project = join(root, "project")
    const evalRoot = join(root, "evalroot")
    mkdirSync(join(project, ".opencode"), { recursive: true })
    mkdirSync(evalRoot, { recursive: true })
    writeFileSync(join(project, "local-rules.md"), "EFFECTIVE_INSTRUCTION_CONTENT\n")
    writeFileSync(
      join(project, "opencode.jsonc"),
      JSON.stringify({
        instructions: ["./local-rules.md"],
        agent: { "root-probe-agent": { description: "ROOT_AGENT_DESC", mode: "primary" } },
      }),
    )

    const run = (args) =>
      execFileSync(resolveOpencodeCli()!, args, {
        cwd: evalRoot,
        env: {
          PATH: process.env.PATH ?? "",
          HOME: join(root, "home"),
          XDG_CONFIG_HOME: join(root, "config"),
          XDG_DATA_HOME: join(root, "data"),
          XDG_CACHE_HOME: join(root, "cache"),
          XDG_STATE_HOME: join(root, "state"),
          // Pin PWD to the eval root exactly as runSingleQuery does.
          PWD: evalRoot,
        },
        encoding: "utf-8",
        timeout: 60_000,
        stdio: ["ignore", "pipe", "pipe"],
      })

    try {
      let beforeError = ""
      try {
        run(["run", "--standalone", "--agent", "root-probe-agent", "-m", "nonexistent/model", "ping"])
      } catch (error) {
        beforeError = String(error.stderr ?? error.message ?? error)
      }
      // Before mirroring, the eval root has no root config, so the agent is unknown.
      if (!/Agent not found/.test(beforeError) || /Model unavailable/.test(beforeError)) {
        throw new Error(`precondition failed: expected "Agent not found", got: ${beforeError.slice(0, 300)}`)
      }

      // Build the eval root exactly as runSingleQuery does.
      symlinkProjectOpenCodeConfig(project, evalRoot, "tested-skill")

      let afterError = ""
      try {
        run(["run", "--standalone", "--agent", "root-probe-agent", "-m", "nonexistent/model", "ping"])
      } catch (error) {
        afterError = String(error.stderr ?? error.message ?? error)
      }
      // The root-config agent now resolves (the next failure is the bogus model),
      // proving the mirrored root config is effective in the eval root.
      expect(/Model unavailable/.test(afterError)).toBe(true)
      expect(/Agent not found/.test(afterError)).toBe(false)

      // The mirrored relative instruction file content is present (not just a path).
      expect(existsSync(join(evalRoot, "local-rules.md"))).toBe(true)
      expect(readFileSync(join(evalRoot, "local-rules.md"), "utf-8")).toBe("EFFECTIVE_INSTRUCTION_CONTENT\n")
      // The config document itself is present at the same relative position.
      expect(existsSync(join(evalRoot, "opencode.jsonc"))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  },
)
