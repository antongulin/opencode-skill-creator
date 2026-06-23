import { expect, mock, test } from "bun:test"

import type { EvalItem, EvalOutput, EvalResultItem } from "../lib/run-eval"

const result = (
  query: string,
  overrides: Partial<EvalResultItem> = {},
): EvalResultItem => ({
  query,
  should_trigger: true,
  trigger_rate: 0,
  triggers: 0,
  runs: 3,
  successful_runs: 3,
  errors: 0,
  pass: false,
  ...overrides,
})

test("runLoop derives train warnings from train results and prints unique split warnings", async () => {
  const calls: { evalResults: EvalOutput }[] = []

  mock.module("../lib/utils", () => ({
    parseSkillMd: () => ({
      name: "warning-skill",
      description: "original description",
      fullContent: "skill content",
    }),
  }))

  mock.module("../lib/run-eval", () => ({
    findProjectRoot: () => "/tmp/project",
    buildEvalWarnings: (results: EvalResultItem[]) => {
      const shouldTriggerResults = results.filter((r) => r.should_trigger)
      if (shouldTriggerResults.length === 0) return []
      return shouldTriggerResults.every((r) => r.triggers === 0 && r.errors === 0)
        ? ["all-zero warning"]
        : []
    },
    runEval: () => ({
      skill_name: "warning-skill",
      description: "original description",
      results: [
        result("train trigger"),
        result("train negative", { should_trigger: false }),
        result("test trigger"),
      ],
      warnings: [],
      summary: {
        passed: 1,
        failed: 2,
        total: 3,
        run_errors: 0,
        queries_with_errors: 0,
      },
    }),
  }))

  mock.module("../lib/improve-description", () => ({
    improveDescription: (opts: { evalResults: EvalOutput }) => {
      calls.push({ evalResults: opts.evalResults })
      return "improved description"
    },
  }))

  mock.module("../lib/report", () => ({
    generateHtml: () => "<html></html>",
  }))

  const evalSet: EvalItem[] = [
    { query: "train trigger", should_trigger: true },
    { query: "train negative", should_trigger: false },
    { query: "test trigger", should_trigger: true },
  ]
  const errors: string[] = []
  const originalError = console.error
  console.error = (...args: unknown[]) => {
    errors.push(args.join(" "))
  }

  try {
    const { runLoop } = await import("../lib/run-loop")
    await runLoop({
      evalSet,
      skillPath: "/tmp/skill/SKILL.md",
      numWorkers: 1,
      timeout: 1,
      maxIterations: 2,
      runsPerQuery: 3,
      triggerThreshold: 0.5,
      triggerOnly: true,
      holdout: 1 / 3,
      model: undefined,
      agent: undefined,
      verbose: true,
    })

    expect(calls[0]?.evalResults.warnings).toEqual(["all-zero warning"])
    expect(errors.filter((line) => line === "Warning: all-zero warning")).toHaveLength(2)
  } finally {
    console.error = originalError
    mock.restore()
  }
})
