import { expect, test } from "bun:test"

import {
  classifyEvalFailures,
  formatFailureDiagnostics,
} from "../lib/failure-taxonomy"
import type { EvalResultItem } from "../lib/run-eval"

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

test("classifyEvalFailures classifies false negatives for failing should-trigger results with zero triggers", () => {
  expect(
    classifyEvalFailures([
      baseResult({
        query: "Create a skill for repository cleanup",
        should_trigger: true,
        triggers: 0,
      }),
    ]),
  ).toEqual([
    {
      category: "false_negative",
      query: "Create a skill for repository cleanup",
      explanation: "The skill should have triggered but did not.",
      remediation:
        "Broaden the description around this intent without listing only this exact query.",
    },
  ])
})

test("classifyEvalFailures classifies false positives for failing should-not-trigger results with triggers", () => {
  expect(
    classifyEvalFailures([
      baseResult({
        query: "Explain TypeScript generics",
        should_trigger: false,
        triggers: 2,
      }),
    ]),
  ).toEqual([
    {
      category: "false_positive",
      query: "Explain TypeScript generics",
      explanation: "The skill triggered for a query that should not use it.",
      remediation: "Add clearer boundaries for when not to use the skill.",
    },
  ])
})

test("classifyEvalFailures classifies run errors before trigger accuracy", () => {
  expect(
    classifyEvalFailures([
      baseResult({
        query: "Broken eval query",
        errors: 1,
        triggers: 0,
      }),
    ]),
  ).toEqual([
    {
      category: "run_error",
      query: "Broken eval query",
      explanation:
        "The eval run had execution errors, so trigger accuracy is not trustworthy.",
      remediation:
        "Fix the eval execution error before optimizing this description.",
    },
  ])
})

test("classifyEvalFailures ignores passing results", () => {
  expect(
    classifyEvalFailures([
      baseResult({
        query: "Passing trigger",
        triggers: 3,
        pass: true,
      }),
      baseResult({
        query: "Passing non-trigger",
        should_trigger: false,
        triggers: 0,
        pass: true,
      }),
    ]),
  ).toEqual([])
})

test("formatFailureDiagnostics returns empty string for no diagnostics", () => {
  expect(formatFailureDiagnostics([])).toBe("")
})

test("formatFailureDiagnostics formats one diagnostic per line", () => {
  expect(
    formatFailureDiagnostics([
      {
        category: "false_negative",
        query: "Create a skill",
        explanation: "The skill should have triggered but did not.",
        remediation:
          "Broaden the description around this intent without listing only this exact query.",
      },
      {
        category: "false_positive",
        query: "Explain cooking",
        explanation: "The skill triggered for a query that should not use it.",
        remediation: "Add clearer boundaries for when not to use the skill.",
      },
    ]),
  ).toBe(
    [
      "- [false_negative] Create a skill: The skill should have triggered but did not. Broaden the description around this intent without listing only this exact query.",
      "- [false_positive] Explain cooking: The skill triggered for a query that should not use it. Add clearer boundaries for when not to use the skill.",
    ].join("\n"),
  )
})
