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
  const evalRoots: string[] = []
  const evalSignals: (AbortSignal | undefined)[] = []
  const improveTargets: { projectRoot?: string; signal?: AbortSignal }[] = []

  mock.module("../lib/utils", () => ({
    parseSkillMd: () => ({
      name: "warning-skill",
      description: "original description",
      fullContent: "skill content",
    }),
  }))

  mock.module("../lib/run-eval", () => ({
    abortError: (message = "aborted") => {
      const error = new Error(message)
      error.name = "AbortError"
      return error
    },
    buildEvalWarnings: (results: EvalResultItem[]) => {
      const shouldTriggerResults = results.filter((r) => r.should_trigger)
      if (shouldTriggerResults.length === 0) return []
      return shouldTriggerResults.every((r) => r.triggers === 0 && r.errors === 0)
        ? ["all-zero warning"]
        : []
    },
    // Aligned contract: one result per eval-set item, in eval-set order
    // (`runLoop` splits these positionally). A hardcoded out-of-order array
    // would no longer reflect a supported caller.
    runEval: (opts: { evalSet: EvalItem[]; projectRoot: string; signal?: AbortSignal }) => {
      evalRoots.push(opts.projectRoot)
      evalSignals.push(opts.signal)
      return {
        skill_name: "warning-skill",
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
      }
    },
  }))

  mock.module("../lib/improve-description", () => ({
    improveDescription: (opts: { evalResults: EvalOutput; projectRoot?: string; signal?: AbortSignal }) => {
      calls.push({ evalResults: opts.evalResults })
      improveTargets.push({ projectRoot: opts.projectRoot, signal: opts.signal })
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
    const controller = new AbortController()
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
      // LD1-3: the loop must evaluate the caller-supplied instance root, never a
      // process-cwd-derived root (the old `findProjectRoot()` at the top of the
      // loop is the regression this guards).
      projectRoot: "/tmp/instance-root",
      signal: controller.signal,
    })

    expect(evalRoots).toEqual(["/tmp/instance-root", "/tmp/instance-root"])
    expect(calls[0]?.evalResults.warnings).toEqual(["all-zero warning"])
    expect(errors.filter((line) => line === "Warning: all-zero warning")).toHaveLength(2)
    // The caller's signal reaches BOTH the eval phase and the improvement child.
    expect(evalSignals.every((signal) => signal === controller.signal)).toBe(true)
    // The loop's improvement child is pinned to the same project root.
    expect(improveTargets[0]?.projectRoot).toBe("/tmp/instance-root")
    expect(improveTargets[0]?.signal).toBe(controller.signal)
  } finally {
    console.error = originalError
    mock.restore()
  }
})
