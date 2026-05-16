import type { EvalResultItem } from "./run-eval"

export type FailureCategory = "false_negative" | "false_positive" | "run_error"

export interface FailureDiagnostic {
  category: FailureCategory
  query: string
  explanation: string
  remediation: string
}

export function classifyEvalFailures(
  results: EvalResultItem[],
): FailureDiagnostic[] {
  return results
    .filter((result) => !result.pass)
    .map((result) => {
      if (result.errors > 0) {
        return {
          category: "run_error",
          query: result.query,
          explanation:
            "The eval run had execution errors, so trigger accuracy is not trustworthy.",
          remediation:
            "Fix the eval execution error before optimizing this description.",
        }
      }

      if (result.should_trigger) {
        return {
          category: "false_negative",
          query: result.query,
          explanation: "The skill should have triggered but did not.",
          remediation:
            "Broaden the description around this intent without listing only this exact query.",
        }
      }

      return {
        category: "false_positive",
        query: result.query,
        explanation: "The skill triggered for a query that should not use it.",
        remediation: "Add clearer boundaries for when not to use the skill.",
      }
    })
}

export function formatFailureDiagnostics(
  diagnostics: FailureDiagnostic[],
): string {
  if (diagnostics.length === 0) return ""

  return diagnostics
    .map(
      (diagnostic) =>
        `- [${diagnostic.category}] ${diagnostic.query}: ${diagnostic.explanation} ${diagnostic.remediation}`,
    )
    .join("\n")
}
