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
import { join, dirname } from "path"
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "fs"

import { validateSkill } from "./lib/validate"
import { parseSkillMd } from "./lib/utils"
import { runEval, findProjectRoot } from "./lib/run-eval"
import { improveDescription } from "./lib/improve-description"
import { runLoop } from "./lib/run-loop"
import { generateBenchmark, generateMarkdown } from "./lib/aggregate"
import { generateHtml as generateReportHtml } from "./lib/report"
import { serveReview, exportStaticReview } from "./lib/review-server"

import type { EvalItem } from "./lib/run-eval"

// ---------------------------------------------------------------------------
// Resolve the templates directory relative to this file
// ---------------------------------------------------------------------------

const TEMPLATES_DIR = join(dirname(import.meta.path), "templates")

// ---------------------------------------------------------------------------
// Bundled skill directory (shipped inside the npm package)
// ---------------------------------------------------------------------------

const BUNDLED_SKILL_DIR = join(dirname(import.meta.path), "skill")
const PACKAGE_JSON_PATH = join(dirname(import.meta.path), "package.json")
const INSTALL_VERSION_FILE = ".opencode-skill-creator-version"

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

// ---------------------------------------------------------------------------
// Auto-install: copy bundled skill files to the global skills directory
// ---------------------------------------------------------------------------

function copyDirRecursive(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true })
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry)
    const destPath = join(dest, entry)
    if (statSync(srcPath).isDirectory()) {
      copyDirRecursive(srcPath, destPath)
    } else {
      copyFileSync(srcPath, destPath)
    }
  }
}

function ensureSkillInstalled(): void {
  // Determine the global skills directory
  const configDir =
    process.env.XDG_CONFIG_HOME || join(process.env.HOME || "~", ".config")
  const skillsDir = join(configDir, "opencode", "skills", "skill-creator")
  const marker = join(skillsDir, "SKILL.md")
  const versionFile = join(skillsDir, INSTALL_VERSION_FILE)

  // Skip if bundled skill files are missing (e.g., local dev without skill/)
  if (!existsSync(BUNDLED_SKILL_DIR)) return

  // Install/update when missing, or when package version changed.
  let installedVersion = ""
  if (existsSync(versionFile)) {
    try {
      installedVersion = readFileSync(versionFile, "utf-8").trim()
    } catch {
      installedVersion = ""
    }
  }

  const shouldInstall = !existsSync(marker) || installedVersion !== PACKAGE_VERSION
  if (!shouldInstall) return

  try {
    copyDirRecursive(BUNDLED_SKILL_DIR, skillsDir)
    writeFileSync(versionFile, `${PACKAGE_VERSION}\n`)
  } catch {
    // Silently fail — the user can always install manually
  }
}

// ---------------------------------------------------------------------------
// Track running review servers so they can be stopped
// ---------------------------------------------------------------------------

const activeServers: Map<string, { stop: () => void; url: string }> = new Map()

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

export const SkillCreatorPlugin: Plugin = async (ctx) => {
  // Auto-install bundled skill files to ~/.config/opencode/skills/skill-creator/
  ensureSkillInstalled()

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
          model: tool.schema
            .string()
            .optional()
            .describe("Model ID in provider/model format"),
        },
        async execute(args) {
          const { readFileSync } = await import("fs")
          const evalSet: EvalItem[] = JSON.parse(
            readFileSync(args.evalSetPath, "utf-8"),
          )

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
            model: args.model,
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
          holdout: tool.schema
            .number()
            .optional()
            .describe("Test set holdout fraction (default: 0.4)"),
          model: tool.schema
            .string()
            .optional()
            .describe("Model ID in provider/model format"),
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
            holdout: args.holdout ?? 0.4,
            model: args.model,
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
        },
        async execute(args) {
          // Stop any existing server for this workspace
          const existing = activeServers.get(args.workspace)
          if (existing) {
            existing.stop()
            activeServers.delete(args.workspace)
          }

          const templatePath = join(TEMPLATES_DIR, "viewer.html")

          const { server, url, feedbackPath, stop } = await serveReview({
            workspace: args.workspace,
            port: args.port ?? 3117,
            skillName: args.skillName,
            previousWorkspace: args.previousWorkspace ?? null,
            benchmarkPath: args.benchmarkPath ?? null,
            templatePath,
            openBrowser: true,
          })

          activeServers.set(args.workspace, { stop, url })

          return JSON.stringify({
            url,
            feedbackPath,
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
              srv.stop()
              activeServers.delete(args.workspace)
              return JSON.stringify({ stopped: args.workspace })
            }
            return JSON.stringify({ error: "No server running for this workspace" })
          }

          // Stop all
          const stopped: string[] = []
          for (const [ws, srv] of activeServers) {
            srv.stop()
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
        },
        async execute(args) {
          const templatePath = join(TEMPLATES_DIR, "viewer.html")

          const outPath = exportStaticReview({
            workspace: args.workspace,
            outputPath: args.outputPath,
            skillName: args.skillName,
            previousWorkspace: args.previousWorkspace ?? null,
            benchmarkPath: args.benchmarkPath ?? null,
            templatePath,
          })

          return JSON.stringify({
            outputPath: outPath,
            message: `Static viewer written to ${outPath}`,
          })
        },
      }),
    },
  }
}

export default SkillCreatorPlugin
