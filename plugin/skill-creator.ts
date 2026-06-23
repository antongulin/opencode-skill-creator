/**
 * Skill Creator — OpenCode plugin entry point.
 *
 * Registers custom tools that automate the skill development lifecycle:
 * validation, evaluation, description optimization, benchmarking, and
 * review serving. These tools replace the Python scripts from the
 * original Anthropic skill-creator.
 *
 * Install via npm:
 *   Add "opencode-skill-creator" to the "plugin" array in opencode.json
 *
 * Or install locally:
 *   Copy this directory to .opencode/plugins/ or ~/.config/opencode/plugins/
 */

import { type Plugin, tool } from "@opencode-ai/plugin"
import { join, dirname, isAbsolute, relative, sep } from "path"
import { homedir } from "os"
import { fileURLToPath } from "url"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs"

import { validateSkill } from "./lib/validate"
import { parseSkillMd } from "./lib/utils"
import { runEval, findProjectRoot } from "./lib/run-eval"
import { improveDescription } from "./lib/improve-description"
import { runLoop } from "./lib/run-loop"
import { generateBenchmark, generateMarkdown } from "./lib/aggregate"
import { generateHtml as generateReportHtml } from "./lib/report"
import { serveReview, exportStaticReview } from "./lib/review-server"
import { validateComparisonWorkspace } from "./lib/workflow-guard"
import {
  addGoldStandard,
  getGoldAdvice,
  listGoldStandards,
  removeGoldStandard,
} from "./lib/gold-standards"
import { ensureBundledSkillInstalled } from "./lib/skill-install"

import type { EvalItem } from "./lib/run-eval"

// ---------------------------------------------------------------------------
// Resolve the templates directory relative to this file
// ---------------------------------------------------------------------------

const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url))
const TEMPLATES_DIR = join(PLUGIN_DIR, "templates")

// ---------------------------------------------------------------------------
// Bundled skill directory (shipped inside the npm package)
// ---------------------------------------------------------------------------

const BUNDLED_SKILL_DIR = join(PLUGIN_DIR, "skill")
const PACKAGE_JSON_PATH = join(PLUGIN_DIR, "package.json")
export const AUTO_UPDATE_TTL_MS = 24 * 60 * 60 * 1000
export const AUTO_UPDATE_STATUS_FILE = "opencode-skill-creator-update-check.json"
const NPM_REGISTRY_URL = "https://registry.npmjs.org/opencode-skill-creator/latest"
const AUTO_UPDATE_TIMEOUT_MS = 2500
const GOLD_STANDARDS_PATH = join(
  homedir(),
  ".config",
  "opencode",
  "gold-standards.json",
)

const PACKAGE_VERSION = (() => {
  try {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf-8")) as {
      version?: string
    }
    return pkg.version ?? "0.0.0"
  } catch {
    return "0.0.0"
  }
})()

interface ReviewPrepResult {
  strictMode: boolean
  allowPartial: boolean
  validation: ReturnType<typeof validateComparisonWorkspace>
  benchmarkPath: string | null
}

function prepareReviewLaunch(args: {
  workspace: string
  skillName?: string
  benchmarkPath?: string
  allowPartial?: boolean
}): ReviewPrepResult {
  const strictMode = !(args.allowPartial ?? false)
  const validation = validateComparisonWorkspace(args.workspace)

  if (strictMode && !validation.valid) {
    const issueLines = validation.issues.map(
      (issue) => `- ${issue.evalDir}: ${issue.issue}`,
    )

    throw new Error(
      [
        `Strict review preflight failed for ${args.workspace}.`,
        "Preflight issues:",
        ...issueLines,
        "Resolve the issues above, or set allowPartial=true to override.",
      ].join("\n"),
    )
  }

  let resolvedBenchmarkPath = args.benchmarkPath ?? null
  if (!resolvedBenchmarkPath) {
    try {
      const benchmark = generateBenchmark(
        args.workspace,
        args.skillName ?? "",
        "",
      )
      const jsonPath = join(args.workspace, "benchmark.json")
      const mdPath = join(args.workspace, "benchmark.md")
      writeFileSync(jsonPath, JSON.stringify(benchmark, null, 2))
      writeFileSync(mdPath, generateMarkdown(benchmark))
      resolvedBenchmarkPath = jsonPath
    } catch {
      resolvedBenchmarkPath = null
    }
  }

  return {
    strictMode,
    allowPartial: args.allowPartial ?? false,
    validation,
    benchmarkPath: resolvedBenchmarkPath,
  }
}

// ---------------------------------------------------------------------------
type AutoUpdateResult = {
  checked: boolean
  cleared: boolean
  reason:
    | "disabled"
    | "recently-checked"
    | "newer-version"
    | "scheduled-clear"
    | "up-to-date"
    | "missing-cache"
    | "unknown-version"
    | "error"
}

type AutoUpdateOptions = {
  currentVersion?: string
  currentPluginDir?: string
  now?: number
  fetchImpl?: typeof fetch
  scheduleClearImpl?: (path: string) => void
}

type AutoUpdateStatus = {
  lastCheckedAt?: number
  currentVersion?: string
  latestVersion?: string
}

export function getAutoUpdatePaths() {
  const cacheDir = process.env.XDG_CACHE_HOME || join(homedir(), ".cache")
  const configDir = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
  const packageCacheRoot = join(
    cacheDir,
    "opencode",
    "packages",
    "opencode-skill-creator@latest",
  )

  return {
    packageCacheRoot,
    cachedPackageDir: join(
      packageCacheRoot,
      "node_modules",
      "opencode-skill-creator",
    ),
    cachedPackageJson: join(
      packageCacheRoot,
      "node_modules",
      "opencode-skill-creator",
      "package.json",
    ),
    statusPath: join(configDir, "opencode", AUTO_UPDATE_STATUS_FILE),
  }
}

function compareVersions(a: string, b: string) {
  const parse = (value: string) =>
    value.split(".").map((part) => {
      const parsed = Number.parseInt(part, 10)
      return Number.isNaN(parsed) ? 0 : parsed
    })
  const left = parse(a)
  const right = parse(b)
  const length = Math.max(left.length, right.length)

  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }

  return 0
}

function readAutoUpdateStatus(path: string): AutoUpdateStatus {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as AutoUpdateStatus
  } catch {
    return {}
  }
}

function writeAutoUpdateStatus(path: string, status: AutoUpdateStatus) {
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify(status, null, 2)}\n`, "utf-8")
  } catch {
    // Best-effort status tracking only. If this fails, the worst case is an
    // extra registry check on a future startup; plugin startup must not fail.
  }
}

export function isInsidePath(
  parent: string,
  child: string,
  pathModule: Pick<typeof import("path"), "isAbsolute" | "relative" | "sep"> = {
    isAbsolute,
    relative,
    sep,
  },
) {
  const rel = pathModule.relative(parent, child)
  return (
    rel === "" ||
    (!rel.startsWith("..") &&
      !pathModule.isAbsolute(rel) &&
      !rel.startsWith("/") &&
      !rel.startsWith("\\") &&
      !rel.includes(`..${pathModule.sep}`))
  )
}

function scheduleCacheClear(path: string) {
  process.once("exit", () => {
    try {
      rmSync(path, { recursive: true, force: true })
    } catch {
      // Best-effort cache cleanup only. A failed exit-time removal just leaves
      // the stale cache for the next startup/update check.
    }
  })
}

export async function maybeAutoRefreshPluginCache(
  options: AutoUpdateOptions = {},
): Promise<AutoUpdateResult> {
  try {
    if (process.env.OPENCODE_SKILL_CREATOR_AUTO_UPDATE === "0") {
      return { checked: false, cleared: false, reason: "disabled" }
    }

    const currentVersion = options.currentVersion ?? PACKAGE_VERSION
    if (currentVersion === "0.0.0") {
      return { checked: false, cleared: false, reason: "unknown-version" }
    }

    const paths = getAutoUpdatePaths()
    const now = options.now ?? Date.now()
    const status = readAutoUpdateStatus(paths.statusPath)
    if (
      typeof status.lastCheckedAt === "number" &&
      now - status.lastCheckedAt < AUTO_UPDATE_TTL_MS
    ) {
      return { checked: false, cleared: false, reason: "recently-checked" }
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), AUTO_UPDATE_TIMEOUT_MS)

    try {
      const response = await (options.fetchImpl ?? fetch)(NPM_REGISTRY_URL, {
        signal: controller.signal,
      })
      if (!response.ok) return { checked: false, cleared: false, reason: "error" }

      const metadata = (await response.json()) as { version?: string }
      const latestVersion = metadata.version
      if (!latestVersion) return { checked: false, cleared: false, reason: "error" }

      writeAutoUpdateStatus(paths.statusPath, {
        lastCheckedAt: now,
        currentVersion,
        latestVersion,
      })

      if (compareVersions(latestVersion, currentVersion) <= 0) {
        return { checked: true, cleared: false, reason: "up-to-date" }
      }

      if (!existsSync(paths.cachedPackageJson)) {
        return { checked: true, cleared: false, reason: "missing-cache" }
      }

      const currentPluginDir = options.currentPluginDir ?? PLUGIN_DIR
      if (isInsidePath(paths.packageCacheRoot, currentPluginDir)) {
        ;(options.scheduleClearImpl ?? scheduleCacheClear)(paths.packageCacheRoot)
        return { checked: true, cleared: false, reason: "scheduled-clear" }
      }

      rmSync(paths.packageCacheRoot, { recursive: true, force: true })
      return { checked: true, cleared: true, reason: "newer-version" }
    } finally {
      clearTimeout(timeout)
    }
  } catch {
    return { checked: false, cleared: false, reason: "error" }
  }
}

// ---------------------------------------------------------------------------
// Track running review servers so they can be stopped
// ---------------------------------------------------------------------------

const activeServers: Map<string, { stop: () => Promise<void>; url: string }> = new Map()

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

export const SkillCreatorPlugin: Plugin = async (ctx) => {
  // Auto-install bundled skill files to ~/.config/opencode/skills/opencode-skill-creator/
  ensureBundledSkillInstalled({
    bundledSkillDir: BUNDLED_SKILL_DIR,
    configDir: process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
    packageVersion: PACKAGE_VERSION,
    onError: (message, error) => console.warn(message, error),
  })
  void maybeAutoRefreshPluginCache()

  return {
    tool: {
      // ---------------------------------------------------------------
      // skill_validate — validate a skill's SKILL.md structure
      // ---------------------------------------------------------------
      skill_validate: tool({
        description:
          "Validate a skill directory. Checks that SKILL.md exists with well-formed YAML frontmatter, required fields, naming conventions, and description limits.",
        args: {
          skillPath: tool.schema
            .string()
            .describe("Path to the skill directory containing SKILL.md"),
        },
        async execute(args) {
          const result = validateSkill(args.skillPath)
          return JSON.stringify(result, null, 2)
        },
      }),

      // ---------------------------------------------------------------
      // skill_parse — parse a skill's SKILL.md frontmatter
      // ---------------------------------------------------------------
      skill_parse: tool({
        description:
          "Parse a SKILL.md file and return its name, description, and full content.",
        args: {
          skillPath: tool.schema
            .string()
            .describe("Path to the skill directory containing SKILL.md"),
        },
        async execute(args) {
          const meta = parseSkillMd(args.skillPath)
          return JSON.stringify(
            {
              name: meta.name,
              description: meta.description,
              content: meta.fullContent,
              contentLength: meta.fullContent.length,
            },
            null,
            2,
          )
        },
      }),

      // ---------------------------------------------------------------
      // skill_add_gold_standard — save high-performing descriptions
      // ---------------------------------------------------------------
      skill_add_gold_standard: tool({
        description:
          "Save a durable gold-standard skill description example for future meta-learning experiments.",
        args: {
          skillName: tool.schema.string().describe("Skill name for this example"),
          description: tool.schema
            .string()
            .describe("High-performing skill description"),
          passRate: tool.schema
            .number()
            .describe("Observed pass rate as a decimal from 0 to 1"),
          notes: tool.schema
            .string()
            .optional()
            .describe("Optional notes about why this example worked"),
        },
        async execute(args) {
          const standard = addGoldStandard(GOLD_STANDARDS_PATH, {
            skillName: args.skillName,
            description: args.description,
            passRate: args.passRate,
            notes: args.notes,
          })
          return JSON.stringify(standard, null, 2)
        },
      }),

      // ---------------------------------------------------------------
      // skill_list_gold_standards — list saved examples
      // ---------------------------------------------------------------
      skill_list_gold_standards: tool({
        description: "List saved gold-standard skill description examples.",
        args: {},
        async execute() {
          return JSON.stringify(listGoldStandards(GOLD_STANDARDS_PATH), null, 2)
        },
      }),

      // ---------------------------------------------------------------
      // skill_remove_gold_standard — remove a saved example
      // ---------------------------------------------------------------
      skill_remove_gold_standard: tool({
        description: "Remove a saved gold-standard skill description example by id.",
        args: {
          id: tool.schema.string().describe("Gold-standard example id"),
        },
        async execute(args) {
          return JSON.stringify({
            removed: removeGoldStandard(GOLD_STANDARDS_PATH, args.id),
          })
        },
      }),

      // ---------------------------------------------------------------
      // skill_get_gold_advice — format saved examples for prompt context
      // ---------------------------------------------------------------
      skill_get_gold_advice: tool({
        description: "Return formatted gold-standard advice for description optimization prompts.",
        args: {},
        async execute() {
          return JSON.stringify({ advice: getGoldAdvice(GOLD_STANDARDS_PATH) })
        },
      }),

      // ---------------------------------------------------------------
      // skill_eval — run trigger evaluation for a skill description
      // ---------------------------------------------------------------
      skill_eval: tool({
        description:
          "Test whether a skill description causes OpenCode to invoke the skill for a set of queries. Runs each query against `opencode run` and checks if the skill was triggered. Returns pass/fail results per query.",
        args: {
          evalSetPath: tool.schema
            .string()
            .describe("Path to eval_set.json (array of {query, should_trigger})"),
          skillPath: tool.schema
            .string()
            .describe("Path to the skill directory containing SKILL.md"),
          descriptionOverride: tool.schema
            .string()
            .optional()
            .describe("Override description to test (uses SKILL.md description if omitted)"),
          numWorkers: tool.schema
            .number()
            .optional()
            .describe("Parallel workers (default: 10)"),
          timeout: tool.schema
            .number()
            .optional()
            .describe("Timeout per query in seconds (default: 30)"),
          runsPerQuery: tool.schema
            .number()
            .optional()
            .describe("Number of runs per query for reliability (default: 3)"),
          triggerThreshold: tool.schema
            .number()
            .optional()
            .describe("Trigger rate threshold to count as triggered (default: 0.5)"),
          triggerOnly: tool.schema
            .boolean()
            .optional()
            .describe("Stop each eval run as soon as the synthetic skill is triggered and ignore later workflow failures (default: true)"),
          model: tool.schema
            .string()
            .optional()
            .describe("Model ID in provider/model format"),
          agent: tool.schema
            .string()
            .optional()
            .describe("OpenCode agent for trigger eval runs (default: build)"),
        },
        async execute(args) {
          const { readFileSync } = await import("fs")
          const evalSet: EvalItem[] = JSON.parse(
            readFileSync(args.evalSetPath, "utf-8"),
          )

          const validation = validateSkill(args.skillPath)
          if (!validation.valid) {
            throw new Error(`Invalid skill at ${args.skillPath}: ${validation.message}`)
          }

          const meta = parseSkillMd(args.skillPath)
          const projectRoot = findProjectRoot()

          const result = await runEval({
            evalSet,
            skillName: meta.name,
            description: args.descriptionOverride ?? meta.description,
            numWorkers: args.numWorkers ?? 10,
            timeout: args.timeout ?? 30,
            projectRoot,
            runsPerQuery: args.runsPerQuery ?? 3,
            triggerThreshold: args.triggerThreshold ?? 0.5,
            triggerOnly: args.triggerOnly ?? true,
            model: args.model,
            agent: args.agent ?? "build",
          })

          return JSON.stringify(result, null, 2)
        },
      }),

      // ---------------------------------------------------------------
      // skill_improve_description — LLM-powered description improvement
      // ---------------------------------------------------------------
      skill_improve_description: tool({
        description:
          "Call OpenCode to generate an improved skill description based on eval results. Uses the current description and failure patterns to propose a better one.",
        args: {
          skillPath: tool.schema
            .string()
            .describe("Path to the skill directory"),
          evalResultsPath: tool.schema
            .string()
            .describe("Path to JSON file with eval results (output of skill_eval)"),
          historyPath: tool.schema
            .string()
            .optional()
            .describe("Path to JSON file with previous improvement history"),
          model: tool.schema
            .string()
            .optional()
            .describe("Model ID in provider/model format"),
          logDir: tool.schema
            .string()
            .optional()
            .describe("Directory to save improvement transcripts"),
          iteration: tool.schema
            .number()
            .optional()
            .describe("Current iteration number"),
        },
        async execute(args) {
          const { readFileSync } = await import("fs")
          const meta = parseSkillMd(args.skillPath)
          const evalResults = JSON.parse(readFileSync(args.evalResultsPath, "utf-8"))
          const history = args.historyPath
            ? JSON.parse(readFileSync(args.historyPath, "utf-8"))
            : []

          const newDescription = await improveDescription({
            skillName: meta.name,
            skillContent: meta.fullContent,
            currentDescription: meta.description,
            evalResults,
            history,
            model: args.model,
            logDir: args.logDir ?? null,
            iteration: args.iteration ?? null,
          })

          return JSON.stringify({ description: newDescription, charCount: newDescription.length })
        },
      }),

      // ---------------------------------------------------------------
      // skill_optimize_loop — full eval→improve optimization loop
      // ---------------------------------------------------------------
      skill_optimize_loop: tool({
        description:
          "Run the full description optimization loop: split eval set into train/test, evaluate, improve description based on failures, repeat. Returns the best description found. This can take several minutes.",
        args: {
          evalSetPath: tool.schema
            .string()
            .describe("Path to eval_set.json"),
          skillPath: tool.schema
            .string()
            .describe("Path to the skill directory"),
          descriptionOverride: tool.schema
            .string()
            .optional()
            .describe("Starting description override"),
          maxIterations: tool.schema
            .number()
            .optional()
            .describe("Max optimization iterations (default: 5)"),
          numWorkers: tool.schema
            .number()
            .optional()
            .describe("Parallel workers (default: 10)"),
          timeout: tool.schema
            .number()
            .optional()
            .describe("Timeout per query in seconds (default: 30)"),
          runsPerQuery: tool.schema
            .number()
            .optional()
            .describe("Runs per query (default: 3)"),
          triggerThreshold: tool.schema
            .number()
            .optional()
            .describe("Trigger rate threshold (default: 0.5)"),
          triggerOnly: tool.schema
            .boolean()
            .optional()
            .describe("Stop each eval run as soon as the synthetic skill is triggered and ignore later workflow failures (default: true)"),
          holdout: tool.schema
            .number()
            .optional()
            .describe("Test set holdout fraction (default: 0.4)"),
          model: tool.schema
            .string()
            .optional()
            .describe("Model ID in provider/model format"),
          agent: tool.schema
            .string()
            .optional()
            .describe("OpenCode agent for trigger eval runs (default: build)"),
          liveReportPath: tool.schema
            .string()
            .optional()
            .describe("Path to write live HTML report"),
          logDir: tool.schema
            .string()
            .optional()
            .describe("Directory for improvement transcripts"),
        },
        async execute(args) {
          const { readFileSync } = await import("fs")
          const evalSet: EvalItem[] = JSON.parse(
            readFileSync(args.evalSetPath, "utf-8"),
          )

          const result = await runLoop({
            evalSet,
            skillPath: args.skillPath,
            descriptionOverride: args.descriptionOverride ?? null,
            numWorkers: args.numWorkers ?? 10,
            timeout: args.timeout ?? 30,
            maxIterations: args.maxIterations ?? 5,
            runsPerQuery: args.runsPerQuery ?? 3,
            triggerThreshold: args.triggerThreshold ?? 0.5,
            triggerOnly: args.triggerOnly ?? true,
            holdout: args.holdout ?? 0.4,
            model: args.model,
            agent: args.agent ?? "build",
            verbose: true,
            liveReportPath: args.liveReportPath ?? null,
            logDir: args.logDir ?? null,
          })

          return JSON.stringify(result, null, 2)
        },
      }),

      // ---------------------------------------------------------------
      // skill_aggregate_benchmark — aggregate grading.json results
      // ---------------------------------------------------------------
      skill_aggregate_benchmark: tool({
        description:
          "Aggregate grading.json files from benchmark run directories into summary statistics. Produces benchmark.json with pass rates, timing, and token usage per configuration.",
        args: {
          benchmarkDir: tool.schema
            .string()
            .describe("Path to the benchmark directory (containing eval-N/ subdirectories)"),
          skillName: tool.schema
            .string()
            .optional()
            .describe("Skill name for the report header"),
          skillPath: tool.schema
            .string()
            .optional()
            .describe("Path to the skill directory"),
          outputPath: tool.schema
            .string()
            .optional()
            .describe("Path to write benchmark.json (default: <benchmarkDir>/benchmark.json)"),
          markdownPath: tool.schema
            .string()
            .optional()
            .describe("Path to write benchmark.md (default: <benchmarkDir>/benchmark.md)"),
        },
        async execute(args) {
          const { writeFileSync } = await import("fs")
          const benchmark = generateBenchmark(
            args.benchmarkDir,
            args.skillName ?? "",
            args.skillPath ?? "",
          )

          const jsonPath = args.outputPath ?? join(args.benchmarkDir, "benchmark.json")
          writeFileSync(jsonPath, JSON.stringify(benchmark, null, 2))

          const mdPath = args.markdownPath ?? join(args.benchmarkDir, "benchmark.md")
          writeFileSync(mdPath, generateMarkdown(benchmark))

          return JSON.stringify(
            {
              benchmarkJsonPath: jsonPath,
              benchmarkMdPath: mdPath,
              summary: benchmark.run_summary,
            },
            null,
            2,
          )
        },
      }),

      // ---------------------------------------------------------------
      // skill_generate_report — generate HTML optimization report
      // ---------------------------------------------------------------
      skill_generate_report: tool({
        description:
          "Generate a self-contained HTML report showing description optimization results per iteration with pass/fail indicators for each eval query.",
        args: {
          dataPath: tool.schema
            .string()
            .describe("Path to the optimization results JSON (output of skill_optimize_loop)"),
          outputPath: tool.schema
            .string()
            .describe("Path to write the HTML report"),
          skillName: tool.schema
            .string()
            .optional()
            .describe("Skill name for the report title"),
          autoRefresh: tool.schema
            .boolean()
            .optional()
            .describe("Add auto-refresh meta tag (default: false)"),
        },
        async execute(args) {
          const { readFileSync, writeFileSync } = await import("fs")
          const data = JSON.parse(readFileSync(args.dataPath, "utf-8"))
          const html = generateReportHtml(data, {
            autoRefresh: args.autoRefresh ?? false,
            skillName: args.skillName ?? "",
          })
          writeFileSync(args.outputPath, html)
          return JSON.stringify({ reportPath: args.outputPath })
        },
      }),

      // ---------------------------------------------------------------
      // skill_serve_review — start the eval review viewer
      // ---------------------------------------------------------------
      skill_serve_review: tool({
        description:
          "Start an HTTP server that serves the eval review viewer. Regenerates HTML on each page load so refreshing picks up new outputs. Opens the browser automatically.",
        args: {
          workspace: tool.schema
            .string()
            .describe("Path to the workspace directory containing eval results"),
          port: tool.schema
            .number()
            .optional()
            .describe("Server port (default: 3117)"),
          skillName: tool.schema
            .string()
            .optional()
            .describe("Skill name for the viewer header"),
          previousWorkspace: tool.schema
            .string()
            .optional()
            .describe("Path to previous iteration's workspace (for showing old outputs and feedback)"),
          benchmarkPath: tool.schema
            .string()
            .optional()
            .describe("Path to benchmark.json for the Benchmark tab"),
          allowPartial: tool.schema
            .boolean()
            .optional()
            .describe("Allow launching review even if with_skill/baseline run pairs are incomplete (default: false)"),
        },
        async execute(args) {
          const prep = prepareReviewLaunch(args)

          // Stop any existing server for this workspace
          const existing = activeServers.get(args.workspace)
          if (existing) {
            await existing.stop()
            activeServers.delete(args.workspace)
          }

          const templatePath = join(TEMPLATES_DIR, "viewer.html")

          const { server, url, feedbackPath, stop } = await serveReview({
            workspace: args.workspace,
            port: args.port ?? 3117,
            skillName: args.skillName,
            previousWorkspace: args.previousWorkspace ?? null,
            benchmarkPath: prep.benchmarkPath,
            templatePath,
            openBrowser: true,
          })

          activeServers.set(args.workspace, { stop, url })

          return JSON.stringify({
            url,
            feedbackPath,
            benchmarkPath: prep.benchmarkPath,
            workflowGuard: {
              strictMode: prep.strictMode,
              allowPartial: prep.allowPartial,
              evalCount: prep.validation.evalCount,
              foundConfigs: prep.validation.foundConfigs,
              issues: prep.validation.issues,
            },
            message: `Eval viewer running at ${url}. Press Ctrl+C or call skill_stop_review to stop.`,
          })
        },
      }),

      // ---------------------------------------------------------------
      // skill_stop_review — stop a running review server
      // ---------------------------------------------------------------
      skill_stop_review: tool({
        description: "Stop a running eval review viewer server.",
        args: {
          workspace: tool.schema
            .string()
            .optional()
            .describe("Workspace path of the server to stop (stops all if omitted)"),
        },
        async execute(args) {
          if (args.workspace) {
            const srv = activeServers.get(args.workspace)
            if (srv) {
              await srv.stop()
              activeServers.delete(args.workspace)
              return JSON.stringify({ stopped: args.workspace })
            }
            return JSON.stringify({ error: "No server running for this workspace" })
          }

          // Stop all
          const stopped: string[] = []
          for (const [ws, srv] of activeServers) {
            await srv.stop()
            stopped.push(ws)
          }
          activeServers.clear()
          return JSON.stringify({ stopped })
        },
      }),

      // ---------------------------------------------------------------
      // skill_export_static_review — generate standalone HTML file
      // ---------------------------------------------------------------
      skill_export_static_review: tool({
        description:
          "Generate a standalone HTML eval review file (no server needed). Use in headless environments or for sharing.",
        args: {
          workspace: tool.schema
            .string()
            .describe("Path to the workspace directory"),
          outputPath: tool.schema
            .string()
            .describe("Path to write the HTML file"),
          skillName: tool.schema
            .string()
            .optional()
            .describe("Skill name for the viewer header"),
          previousWorkspace: tool.schema
            .string()
            .optional()
            .describe("Path to previous iteration's workspace"),
          benchmarkPath: tool.schema
            .string()
            .optional()
            .describe("Path to benchmark.json"),
          allowPartial: tool.schema
            .boolean()
            .optional()
            .describe("Allow exporting review even if with_skill/baseline run pairs are incomplete (default: false)"),
        },
        async execute(args) {
          const prep = prepareReviewLaunch(args)

          const templatePath = join(TEMPLATES_DIR, "viewer.html")

          const outPath = exportStaticReview({
            workspace: args.workspace,
            outputPath: args.outputPath,
            skillName: args.skillName,
            previousWorkspace: args.previousWorkspace ?? null,
            benchmarkPath: prep.benchmarkPath,
            templatePath,
          })

          return JSON.stringify({
            outputPath: outPath,
            benchmarkPath: prep.benchmarkPath,
            workflowGuard: {
              strictMode: prep.strictMode,
              allowPartial: prep.allowPartial,
              evalCount: prep.validation.evalCount,
              foundConfigs: prep.validation.foundConfigs,
              issues: prep.validation.issues,
            },
            message: `Static viewer written to ${outPath}`,
          })
        },
      }),
    },
  }
}

export default SkillCreatorPlugin
