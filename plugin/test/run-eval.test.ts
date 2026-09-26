import { expect, test } from "bun:test"
import {
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
  aggregateEvalResults,
  buildEvalWarnings,
  buildOpenCodeRunCommand,
  symlinkProjectOpenCodeConfig,
  type EvalResultItem,
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

test("aggregateEvalResults keys by eval-set index, so duplicate queries stay separate", () => {
  const evalSet = [
    { query: "dup query", should_trigger: true },
    { query: "unique query", should_trigger: false },
    { query: "dup query", should_trigger: true },
  ]
  // Simulated concurrent completion order (item 2 finishes first).
  const results = aggregateEvalResults(
    evalSet,
    [
      { itemIndex: 2, triggered: false, errored: false },
      { itemIndex: 0, triggered: true, errored: false },
      { itemIndex: 1, triggered: false, errored: false },
      { itemIndex: 2, triggered: false, errored: false },
      { itemIndex: 0, triggered: false, errored: false },
      { itemIndex: 1, triggered: false, errored: false },
    ],
    0.5,
  )

  // One entry per eval-set item, in eval-set order — not merged by query text.
  expect(results.map((r) => r.query)).toEqual([
    "dup query",
    "unique query",
    "dup query",
  ])
  expect(results[0]?.triggers).toBe(1)
  expect(results[0]?.runs).toBe(2)
  expect(results[2]?.triggers).toBe(0)
  expect(results[2]?.runs).toBe(2)
  expect(results[2]?.pass).toBe(false)
  expect(results[1]?.pass).toBe(true)
})

test("aggregateEvalResults counts errors per eval-set item", () => {
  const evalSet = [{ query: "flaky", should_trigger: true }]
  const results = aggregateEvalResults(
    evalSet,
    [
      { itemIndex: 0, triggered: false, errored: true },
      { itemIndex: 0, triggered: true, errored: false },
      { itemIndex: 0, triggered: true, errored: false },
    ],
    0.5,
  )

  expect(results).toHaveLength(1)
  expect(results[0]?.errors).toBe(1)
  expect(results[0]?.successful_runs).toBe(2)
  expect(results[0]?.trigger_rate).toBe(1)
  // Errors force a fail regardless of trigger rate.
  expect(results[0]?.pass).toBe(false)
})
