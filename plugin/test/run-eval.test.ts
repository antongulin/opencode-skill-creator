import { expect, test } from "bun:test"
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "fs"
import { tmpdir } from "os"
import { join } from "path"

import {
  assertNoInstalledSkillConflict,
  buildEvalWarnings,
  buildOpenCodeRunCommand,
  createV2SkillEnumerator,
  findSkillConflictsInList,
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

test("createV2SkillEnumerator maps ctx.skill.list data to name/location", async () => {
  const enumerate = createV2SkillEnumerator({
    skill: {
      list: async () => ({
        data: [
          { id: "a", name: "alpha", path: "/skills/alpha" },
          { id: "b", name: "beta" },
          { id: "c" }, // no name -> dropped
        ],
      }),
    },
  })

  expect(await enumerate("/project")).toEqual([
    { name: "alpha", location: "/skills/alpha" },
    { name: "beta", location: undefined },
  ])
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
// C-03: a captured real v2 event stream fixture drives the parser, so a change
// in the current `opencode run --format json` envelope is caught offline.
// ---------------------------------------------------------------------------

test("parse matches the captured real v2 tool_use envelope", () => {
  // Captured 2026-09-30 from `opencode run --standalone --format json` v2.0.19.
  const fixture = JSON.stringify({
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
        input: { path: "demo-skill-skill-abc123/SKILL.md" },
        output: "Read file",
        title: "read",
      },
    },
  })

  // Mirrors runSingleQuery's consumeLine detection for the synthetic name.
  const event = JSON.parse(fixture)
  expect(event.type).toBe("tool_use")
  expect(["skill", "read"]).toContain(event.part.tool)
  expect(JSON.stringify(event.part)).toContain("demo-skill-skill-abc123")
})

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
  // skill name found in the cwd.
  const fake = `#!/usr/bin/env node
const fs = require("fs")
const path = require("path")
const scenario = JSON.parse(fs.readFileSync(process.env.SKC_EVAL_SCENARIO, "utf-8"))
const cwd = process.cwd()
let cleanName = "unknown"
try {
  const skills = fs.readdirSync(path.join(cwd, ".opencode", "skills"))
  if (skills.length) cleanName = skills[0]
} catch {}
const emit = (line) => process.stdout.write(line.split("{skill}").join(cleanName) + "\\n")
if (Array.isArray(scenario.lines)) scenario.lines.forEach(emit)
if (scenario.sleepMs) {
  setTimeout(() => process.exit(scenario.exitCode ?? 0), scenario.sleepMs)
} else {
  process.exit(scenario.exitCode ?? 0)
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
  opts: { evalSet: { query: string; should_trigger: boolean }[]; runsPerQuery?: number; timeout?: number; numWorkers?: number },
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
    })
  } finally {
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    if (previousScenario === undefined) delete process.env.SKC_EVAL_SCENARIO
    else process.env.SKC_EVAL_SCENARIO = previousScenario
  }
}

test("runEval detects a trigger from a real v2 tool_use JSON line", async () => {
  const harness = makeEvalHarness()
  try {
    const output = await runEvalWithScenario(
      harness,
      { lines: [JSON.stringify({ type: "step_start" }), triggerLine("read")], exitCode: 0 },
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
