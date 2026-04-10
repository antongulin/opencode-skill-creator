/**
 * Eval → improve loop orchestrator.
 *
 * Port of scripts/run_loop.py.
 *
 * Splits the eval set into train/test, repeatedly evaluates the current
 * description and asks the LLM to improve it based on failures. Tracks
 * history and writes a live HTML report. Returns the best description found.
 */

import { writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

import { parseSkillMd } from "./utils"
import { findProjectRoot, runEval } from "./run-eval"
import { improveDescription } from "./improve-description"
import { generateHtml } from "./report"

import type { EvalItem, EvalResultItem, EvalOutput } from "./run-eval"
import type { HistoryEntry } from "./improve-description"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Split eval set into train and test, stratified by should_trigger.
 */
function splitEvalSet(
  evalSet: EvalItem[],
  holdout: number,
  seed = 42,
): [EvalItem[], EvalItem[]] {
  // Simple seeded shuffle using xorshift32
  let state = seed
  function rand(): number {
    state ^= state << 13
    state ^= state >> 17
    state ^= state << 5
    return ((state >>> 0) % 10000) / 10000
  }

  const trigger = evalSet.filter((e) => e.should_trigger)
  const noTrigger = evalSet.filter((e) => !e.should_trigger)

  // Fisher-Yates shuffle with seeded random
  function shuffle<T>(arr: T[]): T[] {
    const a = [...arr]
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }

  const shuffledTrigger = shuffle(trigger)
  const shuffledNoTrigger = shuffle(noTrigger)

  const nTriggerTest = Math.max(1, Math.floor(shuffledTrigger.length * holdout))
  const nNoTriggerTest = Math.max(
    1,
    Math.floor(shuffledNoTrigger.length * holdout),
  )

  const testSet = [
    ...shuffledTrigger.slice(0, nTriggerTest),
    ...shuffledNoTrigger.slice(0, nNoTriggerTest),
  ]
  const trainSet = [
    ...shuffledTrigger.slice(nTriggerTest),
    ...shuffledNoTrigger.slice(nNoTriggerTest),
  ]

  return [trainSet, testSet]
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RunLoopOptions {
  evalSet: EvalItem[]
  skillPath: string
  descriptionOverride?: string | null
  numWorkers: number
  timeout: number
  maxIterations: number
  runsPerQuery: number
  triggerThreshold: number
  holdout: number
  model: string | undefined
  verbose: boolean
  liveReportPath?: string | null
  logDir?: string | null
}

export interface LoopHistoryEntry extends HistoryEntry {
  iteration: number
  description: string
  train_passed: number
  train_failed: number
  train_total: number
  test_passed: number | null
  test_failed: number | null
  test_total: number | null
  passed: number
  failed: number
  total: number
  results: EvalResultItem[]
  train_results?: EvalResultItem[]
  test_results?: EvalResultItem[] | null
}

export interface RunLoopOutput {
  exit_reason: string
  original_description: string
  best_description: string
  best_score: string
  best_train_score: string
  best_test_score: string | null
  final_description: string
  iterations_run: number
  holdout: number
  train_size: number
  test_size: number
  history: LoopHistoryEntry[]
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function runLoop(opts: RunLoopOptions): Promise<RunLoopOutput> {
  const {
    evalSet,
    skillPath,
    descriptionOverride,
    numWorkers,
    timeout,
    maxIterations,
    runsPerQuery,
    triggerThreshold,
    holdout,
    model,
    verbose,
    liveReportPath,
    logDir,
  } = opts

  const projectRoot = findProjectRoot()
  const { name, description: originalDescription, fullContent: content } =
    parseSkillMd(skillPath)
  let currentDescription = descriptionOverride ?? originalDescription

  // Split into train/test if holdout > 0
  let trainSet: EvalItem[]
  let testSet: EvalItem[]
  if (holdout > 0) {
    ;[trainSet, testSet] = splitEvalSet(evalSet, holdout)
    if (verbose) {
      console.error(
        `Split: ${trainSet.length} train, ${testSet.length} test (holdout=${holdout})`,
      )
    }
  } else {
    trainSet = evalSet
    testSet = []
  }

  const history: LoopHistoryEntry[] = []
  let exitReason = "unknown"

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    if (verbose) {
      console.error(`\n${"=".repeat(60)}`)
      console.error(`Iteration ${iteration}/${maxIterations}`)
      console.error(`Description: ${currentDescription}`)
      console.error("=".repeat(60))
    }

    // Evaluate train + test together in one batch for parallelism
    const allQueries = [...trainSet, ...testSet]
    const t0 = Date.now()
    const allResults = await runEval({
      evalSet: allQueries,
      skillName: name,
      description: currentDescription,
      numWorkers,
      timeout,
      projectRoot,
      runsPerQuery,
      triggerThreshold,
      model,
    })
    const evalElapsed = (Date.now() - t0) / 1000

    // Split results back into train/test by matching queries
    const trainQueriesSet = new Set(trainSet.map((q) => q.query))
    const trainResultList = allResults.results.filter((r) =>
      trainQueriesSet.has(r.query),
    )
    const testResultList = allResults.results.filter(
      (r) => !trainQueriesSet.has(r.query),
    )

    const trainPassed = trainResultList.filter((r) => r.pass).length
    const trainTotal = trainResultList.length
    const trainSummary = {
      passed: trainPassed,
      failed: trainTotal - trainPassed,
      total: trainTotal,
    }
    const trainResults: EvalOutput = {
      skill_name: name,
      description: currentDescription,
      results: trainResultList,
      summary: trainSummary,
    }

    let testResults: EvalOutput | null = null
    let testSummary: { passed: number; failed: number; total: number } | null =
      null
    if (testSet.length > 0) {
      const testPassed = testResultList.filter((r) => r.pass).length
      const testTotal = testResultList.length
      testSummary = {
        passed: testPassed,
        failed: testTotal - testPassed,
        total: testTotal,
      }
      testResults = {
        skill_name: name,
        description: currentDescription,
        results: testResultList,
        summary: testSummary,
      }
    }

    history.push({
      iteration,
      description: currentDescription,
      train_passed: trainSummary.passed,
      train_failed: trainSummary.failed,
      train_total: trainSummary.total,
      train_results: trainResultList,
      test_passed: testSummary?.passed ?? null,
      test_failed: testSummary?.failed ?? null,
      test_total: testSummary?.total ?? null,
      test_results: testResultList.length > 0 ? testResultList : null,
      // Backward compat with report generator
      passed: trainSummary.passed,
      failed: trainSummary.failed,
      total: trainSummary.total,
      results: trainResultList,
    })

    // Write live report if path provided
    if (liveReportPath) {
      const partialOutput: Record<string, unknown> = {
        original_description: originalDescription,
        best_description: currentDescription,
        best_score: "in progress",
        iterations_run: history.length,
        holdout,
        train_size: trainSet.length,
        test_size: testSet.length,
        history,
      }
      writeFileSync(
        liveReportPath,
        generateHtml(partialOutput, { autoRefresh: true, skillName: name }),
      )
    }

    if (verbose) {
      console.error(
        `Train: ${trainSummary.passed}/${trainSummary.total} passed (${evalElapsed.toFixed(1)}s)`,
      )
      if (testSummary) {
        console.error(
          `Test:  ${testSummary.passed}/${testSummary.total} passed`,
        )
      }
    }

    if (trainSummary.failed === 0) {
      exitReason = `all_passed (iteration ${iteration})`
      if (verbose) {
        console.error(
          `\nAll train queries passed on iteration ${iteration}!`,
        )
      }
      break
    }

    if (iteration === maxIterations) {
      exitReason = `max_iterations (${maxIterations})`
      if (verbose) {
        console.error(`\nMax iterations reached (${maxIterations}).`)
      }
      break
    }

    // Improve the description based on train results
    if (verbose) {
      console.error("\nImproving description...")
    }

    const t1 = Date.now()
    // Strip test scores from history so improvement model can't see them
    const blindedHistory: HistoryEntry[] = history.map((h) => {
      const stripped: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(h)) {
        if (!k.startsWith("test_")) stripped[k] = v
      }
      return stripped as HistoryEntry
    })

    const newDescription = await improveDescription({
      skillName: name,
      skillContent: content,
      currentDescription,
      evalResults: trainResults,
      history: blindedHistory,
      model,
      logDir,
      iteration,
    })
    const improveElapsed = (Date.now() - t1) / 1000

    if (verbose) {
      console.error(
        `Proposed (${improveElapsed.toFixed(1)}s): ${newDescription}`,
      )
    }

    currentDescription = newDescription
  }

  // Find the best iteration by TEST score (or train if no test set)
  let best: LoopHistoryEntry
  if (testSet.length > 0) {
    best = history.reduce((a, b) =>
      (a.test_passed ?? 0) >= (b.test_passed ?? 0) ? a : b,
    )
  } else {
    best = history.reduce((a, b) =>
      (a.train_passed ?? 0) >= (b.train_passed ?? 0) ? a : b,
    )
  }

  const bestScore =
    testSet.length > 0
      ? `${best.test_passed}/${best.test_total}`
      : `${best.train_passed}/${best.train_total}`

  if (verbose) {
    console.error(`\nExit reason: ${exitReason}`)
    console.error(
      `Best score: ${bestScore} (iteration ${best.iteration})`,
    )
  }

  return {
    exit_reason: exitReason,
    original_description: originalDescription,
    best_description: best.description,
    best_score: bestScore,
    best_train_score: `${best.train_passed}/${best.train_total}`,
    best_test_score:
      testSet.length > 0 ? `${best.test_passed}/${best.test_total}` : null,
    final_description: currentDescription,
    iterations_run: history.length,
    holdout,
    train_size: trainSet.length,
    test_size: testSet.length,
    history,
  }
}
