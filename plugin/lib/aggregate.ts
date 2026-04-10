/**
 * Benchmark aggregation — reads grading.json files from run directories
 * and produces summary statistics.
 *
 * Port of scripts/aggregate_benchmark.py.
 *
 * Supports two directory layouts:
 *   - Workspace layout: <dir>/eval-N/{with_skill,without_skill}/run-N/grading.json
 *   - Legacy layout: <dir>/runs/eval-N/{config}/run-N/grading.json
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs"
import { join, basename } from "path"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RunResult {
  eval_id: number | string
  run_number: number
  pass_rate: number
  passed: number
  failed: number
  total: number
  time_seconds: number
  tokens: number
  tool_calls: number
  errors: number
  expectations: Record<string, unknown>[]
  notes: string[]
}

interface Stats {
  mean: number
  stddev: number
  min: number
  max: number
}

export interface BenchmarkOutput {
  metadata: Record<string, unknown>
  runs: Record<string, unknown>[]
  run_summary: Record<string, unknown>
  notes: string[]
}

interface LoadResultsOutput {
  results: Record<string, RunResult[]>
  evalIds: Array<number | string>
}

function compareEvalIds(a: number | string, b: number | string): number {
  const parseNumeric = (value: number | string): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) return value
    if (typeof value !== "string") return null
    const trimmed = value.trim()
    if (!/^-?\d+$/.test(trimmed)) return null
    const num = Number(trimmed)
    return Number.isFinite(num) ? num : null
  }

  const aNum = parseNumeric(a)
  const bNum = parseNumeric(b)
  if (aNum !== null && bNum !== null) return aNum - bNum

  return String(a).localeCompare(String(b), undefined, { numeric: true })
}

function computeRunsPerConfiguration(results: Record<string, RunResult[]>): number {
  const counts: number[] = []

  for (const runs of Object.values(results)) {
    const byEval = new Map<string, Set<number>>()

    for (const run of runs) {
      const evalKey = String(run.eval_id)
      if (!byEval.has(evalKey)) {
        byEval.set(evalKey, new Set<number>())
      }
      byEval.get(evalKey)!.add(run.run_number)
    }

    for (const set of byEval.values()) {
      counts.push(set.size)
    }
  }

  if (counts.length === 0) return 0
  return Math.min(...counts)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function calculateStats(values: number[]): Stats {
  if (values.length === 0) {
    return { mean: 0, stddev: 0, min: 0, max: 0 }
  }

  const n = values.length
  const mean = values.reduce((a, b) => a + b, 0) / n

  let stddev = 0
  if (n > 1) {
    const variance = values.reduce((acc, x) => acc + (x - mean) ** 2, 0) / (n - 1)
    stddev = Math.sqrt(variance)
  }

  return {
    mean: Math.round(mean * 10000) / 10000,
    stddev: Math.round(stddev * 10000) / 10000,
    min: Math.round(Math.min(...values) * 10000) / 10000,
    max: Math.round(Math.max(...values) * 10000) / 10000,
  }
}

function sortedDirs(dir: string, pattern?: RegExp): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => {
      const full = join(dir, name)
      return statSync(full).isDirectory() && (!pattern || pattern.test(name))
    })
    .sort()
    .map((name) => join(dir, name))
}

// ---------------------------------------------------------------------------
// Load run results
// ---------------------------------------------------------------------------

function loadRunResults(benchmarkDir: string): LoadResultsOutput {
  // Support both layouts
  const runsDir = join(benchmarkDir, "runs")
  let searchDir: string
  if (existsSync(runsDir)) {
    searchDir = runsDir
  } else if (sortedDirs(benchmarkDir, /^eval-/).length > 0) {
    searchDir = benchmarkDir
  } else {
    console.error(
      `No eval directories found in ${benchmarkDir} or ${runsDir}`,
    )
    return { results: {}, evalIds: [] }
  }

  const results: Record<string, RunResult[]> = {}
  const evalIds = new Set<number | string>()

  for (const [evalIdx, evalDir] of sortedDirs(searchDir, /^eval-/).entries()) {
    const metadataPath = join(evalDir, "eval_metadata.json")
    let evalId: number | string = evalIdx
    if (existsSync(metadataPath)) {
      try {
        const meta = JSON.parse(readFileSync(metadataPath, "utf-8"))
        evalId = meta.eval_id ?? evalIdx
      } catch {
        /* ignore */
      }
    } else {
      const parsedEvalId = Number.parseInt(
        basename(evalDir).split("-")[1] ?? "",
        10,
      )
      if (Number.isFinite(parsedEvalId)) {
        evalId = parsedEvalId
      }
    }
    let hasLoadedRuns = false

    // Discover config directories dynamically
    for (const configDir of sortedDirs(evalDir)) {
      // Skip non-config dirs (no run-* subdirs)
      if (sortedDirs(configDir, /^run-/).length === 0) continue

      const config = basename(configDir)
      if (!results[config]) results[config] = []

      for (const runDir of sortedDirs(configDir, /^run-/)) {
        const parsedRunNumber = Number.parseInt(
          basename(runDir).split("-")[1] ?? "",
          10,
        )
        if (!Number.isFinite(parsedRunNumber)) {
          console.error(`Warning: Invalid run directory name: ${runDir}`)
          continue
        }

        const runNumber = parsedRunNumber
        const gradingFile = join(runDir, "grading.json")

        if (!existsSync(gradingFile)) {
          console.error(`Warning: grading.json not found in ${runDir}`)
          continue
        }

        let grading: Record<string, any>
        try {
          grading = JSON.parse(readFileSync(gradingFile, "utf-8"))
        } catch (e) {
          console.error(`Warning: Invalid JSON in ${gradingFile}: ${e}`)
          continue
        }

        const summary = grading.summary ?? {}
        const result: RunResult = {
          eval_id: evalId,
          run_number: runNumber,
          pass_rate: summary.pass_rate ?? 0,
          passed: summary.passed ?? 0,
          failed: summary.failed ?? 0,
          total: summary.total ?? 0,
          time_seconds: 0,
          tokens: 0,
          tool_calls: 0,
          errors: 0,
          expectations: grading.expectations ?? [],
          notes: [],
        }

        // Extract timing
        const timing = grading.timing ?? {}
        result.time_seconds = timing.total_duration_seconds ?? 0
        const timingFile = join(runDir, "timing.json")
        if (result.time_seconds === 0 && existsSync(timingFile)) {
          try {
            const timingData = JSON.parse(readFileSync(timingFile, "utf-8"))
            result.time_seconds = timingData.total_duration_seconds ?? 0
            result.tokens = timingData.total_tokens ?? 0
          } catch {
            /* ignore */
          }
        }

        // Extract metrics
        const metrics = grading.execution_metrics ?? {}
        result.tool_calls = metrics.total_tool_calls ?? 0
        if (!result.tokens) result.tokens = metrics.output_chars ?? 0
        result.errors = metrics.errors_encountered ?? 0

        // Validate expectations fields
        for (const exp of result.expectations) {
          if (!("text" in exp) || !("passed" in exp)) {
            console.error(
              `Warning: expectation in ${gradingFile} missing required fields (text, passed, evidence)`,
            )
          }
        }

        // Extract notes
        const notesSummary = grading.user_notes_summary ?? {}
        const notes: string[] = []
        if (notesSummary.uncertainties) notes.push(...notesSummary.uncertainties)
        if (notesSummary.needs_review) notes.push(...notesSummary.needs_review)
        if (notesSummary.workarounds) notes.push(...notesSummary.workarounds)
        result.notes = notes

        results[config].push(result)
        hasLoadedRuns = true
      }
    }

    if (hasLoadedRuns) {
      evalIds.add(evalId)
    }
  }

  return {
    results,
    evalIds: [...evalIds].sort(compareEvalIds),
  }
}

// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------

function aggregateResults(
  results: Record<string, RunResult[]>,
): Record<string, unknown> {
  const runSummary: Record<string, unknown> = {}
  const configs = Object.keys(results)

  for (const config of configs) {
    const runs = results[config] ?? []
    if (runs.length === 0) {
      runSummary[config] = {
        pass_rate: { mean: 0, stddev: 0, min: 0, max: 0 },
        time_seconds: { mean: 0, stddev: 0, min: 0, max: 0 },
        tokens: { mean: 0, stddev: 0, min: 0, max: 0 },
      }
      continue
    }

    runSummary[config] = {
      pass_rate: calculateStats(runs.map((r) => r.pass_rate)),
      time_seconds: calculateStats(runs.map((r) => r.time_seconds)),
      tokens: calculateStats(runs.map((r) => r.tokens)),
    }
  }

  // Delta between first two configs
  const primary = (runSummary[configs[0]] ?? {}) as Record<string, any>
  const baselineSummary = configs.length >= 2
    ? (runSummary[configs[1]] ?? {}) as Record<string, any>
    : {} as Record<string, any>

  const deltaPR =
    (primary.pass_rate?.mean ?? 0) - (baselineSummary.pass_rate?.mean ?? 0)
  const deltaTime =
    (primary.time_seconds?.mean ?? 0) -
    (baselineSummary.time_seconds?.mean ?? 0)
  const deltaTokens =
    (primary.tokens?.mean ?? 0) - (baselineSummary.tokens?.mean ?? 0)

  runSummary.delta = {
    pass_rate: `${deltaPR >= 0 ? "+" : ""}${deltaPR.toFixed(2)}`,
    time_seconds: `${deltaTime >= 0 ? "+" : ""}${deltaTime.toFixed(1)}`,
    tokens: `${deltaTokens >= 0 ? "+" : ""}${Math.round(deltaTokens)}`,
  }

  return runSummary
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate complete benchmark.json from run results.
 */
export function generateBenchmark(
  benchmarkDir: string,
  skillName = "",
  skillPath = "",
): BenchmarkOutput {
  const loaded = loadRunResults(benchmarkDir)
  const results = loaded.results
  const runSummary = aggregateResults(results)

  // Build runs array
  const runs: Record<string, unknown>[] = []
  for (const config of Object.keys(results)) {
    for (const result of results[config]) {
      runs.push({
        eval_id: result.eval_id,
        configuration: config,
        run_number: result.run_number,
        result: {
          pass_rate: result.pass_rate,
          passed: result.passed,
          failed: result.failed,
          total: result.total,
          time_seconds: result.time_seconds,
          tokens: result.tokens,
          tool_calls: result.tool_calls,
          errors: result.errors,
        },
        expectations: result.expectations,
        notes: result.notes,
      })
    }
  }

  const runsPerConfiguration = computeRunsPerConfiguration(results)

  return {
    metadata: {
      skill_name: skillName || "<skill-name>",
      skill_path: skillPath || "<path/to/skill>",
      executor_model: "<model-name>",
      analyzer_model: "<model-name>",
      timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      evals_run: loaded.evalIds,
      runs_per_configuration: runsPerConfiguration,
    },
    runs,
    run_summary: runSummary,
    notes: [],
  }
}

/**
 * Generate human-readable benchmark.md from benchmark data.
 */
export function generateMarkdown(benchmark: BenchmarkOutput): string {
  const metadata = benchmark.metadata as Record<string, any>
  const runSummary = benchmark.run_summary as Record<string, any>

  const configs = Object.keys(runSummary).filter((k) => k !== "delta")
  const configA = configs[0] ?? "config_a"
  const configB = configs[1] ?? "config_b"
  const labelA = configA.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())
  const labelB = configB.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())

  const a = runSummary[configA] ?? {}
  const b = runSummary[configB] ?? {}
  const delta = runSummary.delta ?? {}

  const lines = [
    `# Skill Benchmark: ${metadata.skill_name}`,
    "",
    `**Model**: ${metadata.executor_model}`,
    `**Date**: ${metadata.timestamp}`,
    `**Evals**: ${(metadata.evals_run ?? []).join(", ")} (${metadata.runs_per_configuration} runs each per configuration)`,
    "",
    "## Summary",
    "",
    `| Metric | ${labelA} | ${labelB} | Delta |`,
    "|--------|------------|---------------|-------|",
  ]

  const fmtPR = (s: any) =>
    s ? `${(s.mean * 100).toFixed(0)}% ± ${(s.stddev * 100).toFixed(0)}%` : "—"
  const fmtTime = (s: any) =>
    s ? `${s.mean.toFixed(1)}s ± ${s.stddev.toFixed(1)}s` : "—"
  const fmtTokens = (s: any) =>
    s ? `${s.mean.toFixed(0)} ± ${s.stddev.toFixed(0)}` : "—"

  lines.push(
    `| Pass Rate | ${fmtPR(a.pass_rate)} | ${fmtPR(b.pass_rate)} | ${delta.pass_rate ?? "—"} |`,
  )
  lines.push(
    `| Time | ${fmtTime(a.time_seconds)} | ${fmtTime(b.time_seconds)} | ${delta.time_seconds ?? "—"}s |`,
  )
  lines.push(
    `| Tokens | ${fmtTokens(a.tokens)} | ${fmtTokens(b.tokens)} | ${delta.tokens ?? "—"} |`,
  )

  if (benchmark.notes?.length) {
    lines.push("", "## Notes", "")
    for (const note of benchmark.notes) {
      lines.push(`- ${note}`)
    }
  }

  return lines.join("\n")
}
