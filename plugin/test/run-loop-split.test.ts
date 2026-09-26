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

test("runLoop splits train/test by eval-set position even when a query is duplicated across the boundary", async () => {
  mock.module("../lib/utils", () => ({
    parseSkillMd: () => ({
      name: "split-skill",
      description: "original description",
      fullContent: "skill content",
    }),
  }))

  // runEval returns one result per eval-set item, in eval-set order. The
  // duplicated query appears in both train and test after the holdout split;
  // query-text matching would steal the test copy into train (3/1 instead of
  // 2/2).
  mock.module("../lib/run-eval", () => ({
    findProjectRoot: () => "/tmp/project",
    buildEvalWarnings: () => [],
    runEval: (opts: { evalSet: EvalItem[] }): EvalOutput => ({
      skill_name: "split-skill",
      description: "original description",
      results: opts.evalSet.map((item) =>
        result(item.query, { should_trigger: item.should_trigger }),
      ),
      warnings: [],
      summary: {
        passed: 0,
        failed: opts.evalSet.length,
        total: opts.evalSet.length,
        run_errors: 0,
        queries_with_errors: 0,
      },
    }),
  }))

  mock.module("../lib/improve-description", () => ({
    improveDescription: () => "improved description",
  }))

  mock.module("../lib/report", () => ({
    generateHtml: () => "<html></html>",
  }))

  const evalSet: EvalItem[] = [
    { query: "dup query", should_trigger: true },
    { query: "other query", should_trigger: true },
    { query: "negative query", should_trigger: false },
    { query: "dup query", should_trigger: true },
  ]
  const errors: string[] = []
  const originalError = console.error
  console.error = (...args: unknown[]) => {
    errors.push(args.join(" "))
  }

  try {
    const { runLoop } = await import("../lib/run-loop")
    const output = await runLoop({
      evalSet,
      skillPath: "/tmp/skill/SKILL.md",
      numWorkers: 1,
      timeout: 1,
      maxIterations: 1,
      runsPerQuery: 1,
      triggerThreshold: 0.5,
      triggerOnly: true,
      holdout: 0.5,
      model: undefined,
      agent: undefined,
      verbose: false,
    })

    const entry = output.history[0]
    expect(output.train_size).toBe(2)
    expect(output.test_size).toBe(2)
    expect(entry?.train_results).toHaveLength(output.train_size)
    expect(entry?.test_results).toHaveLength(output.test_size)
    // The duplicated query must show up once on each side.
    expect(entry?.train_results?.map((r) => r.query).sort()).toEqual([
      "dup query",
      "other query",
    ])
    expect(entry?.test_results?.map((r) => r.query).sort()).toEqual([
      "dup query",
      "negative query",
    ])
  } finally {
    console.error = originalError
    mock.restore()
  }
})
