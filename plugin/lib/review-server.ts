/**
 * Eval review server — generates and serves a review page for eval results.
 *
 * Port of eval-viewer/generate_review.py.
 *
 * Reads a workspace directory, discovers runs (directories with outputs/),
 * embeds all output data into a self-contained HTML page, and serves it via
 * Bun.serve(). Feedback auto-saves to feedback.json in the workspace.
 *
 * No external dependencies beyond Bun built-ins are required.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "fs"
import { basename, extname, join, relative } from "path"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Files to exclude from output listings. */
const METADATA_FILES = new Set(["transcript.md", "user_notes.md", "metrics.json"])

/** Extensions rendered as inline text. */
const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".json", ".csv", ".py", ".js", ".ts", ".tsx", ".jsx",
  ".yaml", ".yml", ".xml", ".html", ".css", ".sh", ".rb", ".go", ".rs",
  ".java", ".c", ".cpp", ".h", ".hpp", ".sql", ".r", ".toml",
])

/** Extensions rendered as inline images. */
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"])

/** MIME type overrides for common types. */
const MIME_OVERRIDES: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EmbeddedFile {
  name: string
  type: "text" | "image" | "pdf" | "xlsx" | "binary" | "error"
  content?: string
  mime?: string
  data_uri?: string
  data_b64?: string
}

interface Run {
  id: string
  prompt: string
  eval_id: number | string | null
  outputs: EmbeddedFile[]
  grading: Record<string, unknown> | null
}

interface FeedbackReviewItem {
  run_id: string
  feedback: string
  timestamp?: string
}

interface FeedbackPayload {
  reviews: FeedbackReviewItem[]
  status?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  if (ext in MIME_OVERRIDES) return MIME_OVERRIDES[ext]

  // Simple mime lookup for common types
  const mimeMap: Record<string, string> = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".json": "application/json",
    ".xml": "application/xml",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".csv": "text/csv",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
    ".zip": "application/zip",
  }
  return mimeMap[ext] ?? "application/octet-stream"
}

function embedFile(filePath: string): EmbeddedFile {
  const name = basename(filePath)
  const ext = extname(filePath).toLowerCase()
  const mime = getMimeType(filePath)

  if (TEXT_EXTENSIONS.has(ext)) {
    try {
      const content = readFileSync(filePath, "utf-8")
      return { name, type: "text", content }
    } catch {
      return { name, type: "error", content: "(Error reading file)" }
    }
  }

  if (IMAGE_EXTENSIONS.has(ext)) {
    try {
      const raw = readFileSync(filePath)
      const b64 = raw.toString("base64")
      return { name, type: "image", mime, data_uri: `data:${mime};base64,${b64}` }
    } catch {
      return { name, type: "error", content: "(Error reading file)" }
    }
  }

  if (ext === ".pdf") {
    try {
      const raw = readFileSync(filePath)
      const b64 = raw.toString("base64")
      return { name, type: "pdf", data_uri: `data:${mime};base64,${b64}` }
    } catch {
      return { name, type: "error", content: "(Error reading file)" }
    }
  }

  if (ext === ".xlsx") {
    try {
      const raw = readFileSync(filePath)
      const b64 = raw.toString("base64")
      return { name, type: "xlsx", data_b64: b64 }
    } catch {
      return { name, type: "error", content: "(Error reading file)" }
    }
  }

  // Binary / unknown — base64 download link
  try {
    const raw = readFileSync(filePath)
    const b64 = raw.toString("base64")
    return { name, type: "binary", mime, data_uri: `data:${mime};base64,${b64}` }
  } catch {
    return { name, type: "error", content: "(Error reading file)" }
  }
}

// ---------------------------------------------------------------------------
// Run discovery
// ---------------------------------------------------------------------------

function findRunsRecursive(
  root: string,
  current: string,
  runs: Run[],
): void {
  if (!existsSync(current) || !statSync(current).isDirectory()) return

  const outputsDir = join(current, "outputs")
  if (existsSync(outputsDir) && statSync(outputsDir).isDirectory()) {
    const run = buildRun(root, current)
    if (run) runs.push(run)
    return
  }

  const skip = new Set(["node_modules", ".git", "__pycache__", "skill", "inputs"])
  const entries = readdirSync(current).sort()
  for (const entry of entries) {
    const full = join(current, entry)
    if (statSync(full).isDirectory() && !skip.has(entry)) {
      findRunsRecursive(root, full, runs)
    }
  }
}

function findRuns(workspace: string): Run[] {
  const runs: Run[] = []
  findRunsRecursive(workspace, workspace, runs)
  runs.sort((a, b) => {
    const aId = typeof a.eval_id === "number" ? a.eval_id : Infinity
    const bId = typeof b.eval_id === "number" ? b.eval_id : Infinity
    if (aId !== bId) return aId - bId
    return a.id.localeCompare(b.id)
  })
  return runs
}

function buildRun(root: string, runDir: string): Run | null {
  let prompt = ""
  let evalId: number | string | null = null

  // Try eval_metadata.json
  for (const candidate of [join(runDir, "eval_metadata.json"), join(runDir, "..", "eval_metadata.json")]) {
    if (existsSync(candidate)) {
      try {
        const metadata = JSON.parse(readFileSync(candidate, "utf-8"))
        prompt = metadata.prompt ?? ""
        evalId = metadata.eval_id ?? null
      } catch {
        /* ignore */
      }
      if (prompt) break
    }
  }

  // Fall back to transcript.md
  if (!prompt) {
    for (const candidate of [join(runDir, "transcript.md"), join(runDir, "outputs", "transcript.md")]) {
      if (existsSync(candidate)) {
        try {
          const text = readFileSync(candidate, "utf-8")
          const match = text.match(/## Eval Prompt\n\n([\s\S]*?)(?=\n##|$)/)
          if (match) prompt = match[1].trim()
        } catch {
          /* ignore */
        }
        if (prompt) break
      }
    }
  }

  if (!prompt) prompt = "(No prompt found)"

  const runId = relative(root, runDir).replace(/[/\\]/g, "-")

  // Collect output files
  const outputsDir = join(runDir, "outputs")
  const outputFiles: EmbeddedFile[] = []
  if (existsSync(outputsDir) && statSync(outputsDir).isDirectory()) {
    const files = readdirSync(outputsDir).sort()
    for (const f of files) {
      const full = join(outputsDir, f)
      if (statSync(full).isFile() && !METADATA_FILES.has(f)) {
        outputFiles.push(embedFile(full))
      }
    }
  }

  // Load grading if present
  let grading: Record<string, unknown> | null = null
  for (const candidate of [join(runDir, "grading.json"), join(runDir, "..", "grading.json")]) {
    if (existsSync(candidate)) {
      try {
        grading = JSON.parse(readFileSync(candidate, "utf-8"))
      } catch {
        /* ignore */
      }
      if (grading) break
    }
  }

  return { id: runId, prompt, eval_id: evalId, outputs: outputFiles, grading }
}

function isValidFeedbackPayload(value: unknown): value is FeedbackPayload {
  if (typeof value !== "object" || value === null) return false
  if (!Object.prototype.hasOwnProperty.call(value, "reviews")) return false

  const record = value as Record<string, unknown>
  if (!Array.isArray(record.reviews)) return false

  for (const item of record.reviews) {
    if (typeof item !== "object" || item === null) return false
    const review = item as Record<string, unknown>
    if (typeof review.run_id !== "string") return false
    if (typeof review.feedback !== "string") return false
    if (
      Object.prototype.hasOwnProperty.call(review, "timestamp") &&
      typeof review.timestamp !== "string"
    ) {
      return false
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(record, "status") &&
    typeof record.status !== "string"
  ) {
    return false
  }

  return true
}

// ---------------------------------------------------------------------------
// Previous iteration loading
// ---------------------------------------------------------------------------

function loadPreviousIteration(
  workspace: string,
): Record<string, { feedback: string; outputs: EmbeddedFile[] }> {
  const result: Record<string, { feedback: string; outputs: EmbeddedFile[] }> = {}

  // Load feedback
  const feedbackMap: Record<string, string> = {}
  const feedbackPath = join(workspace, "feedback.json")
  if (existsSync(feedbackPath)) {
    try {
      const data = JSON.parse(readFileSync(feedbackPath, "utf-8"))
      for (const r of data.reviews ?? []) {
        if (r.feedback?.trim()) {
          feedbackMap[r.run_id] = r.feedback
        }
      }
    } catch {
      /* ignore */
    }
  }

  // Load runs to get outputs
  const prevRuns = findRuns(workspace)
  for (const run of prevRuns) {
    result[run.id] = {
      feedback: feedbackMap[run.id] ?? "",
      outputs: run.outputs ?? [],
    }
  }

  // Also add feedback for run_ids that had feedback but no matching run
  for (const [runId, fb] of Object.entries(feedbackMap)) {
    if (!(runId in result)) {
      result[runId] = { feedback: fb, outputs: [] }
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// HTML generation
// ---------------------------------------------------------------------------

export function generateReviewHtml(opts: {
  runs: Run[]
  skillName: string
  previous?: Record<string, { feedback: string; outputs: EmbeddedFile[] }> | null
  benchmark?: Record<string, unknown> | null
  templatePath: string
}): string {
  const { runs, skillName, previous, benchmark, templatePath } = opts

  const template = readFileSync(templatePath, "utf-8")

  // Build previous_feedback and previous_outputs maps
  const previousFeedback: Record<string, string> = {}
  const previousOutputs: Record<string, EmbeddedFile[]> = {}
  if (previous) {
    for (const [runId, data] of Object.entries(previous)) {
      if (data.feedback) previousFeedback[runId] = data.feedback
      if (data.outputs?.length) previousOutputs[runId] = data.outputs
    }
  }

  const embedded: Record<string, unknown> = {
    skill_name: skillName,
    runs,
    previous_feedback: previousFeedback,
    previous_outputs: previousOutputs,
  }
  if (benchmark) embedded.benchmark = benchmark

  const dataJson = JSON.stringify(embedded)
  return template.replace("/*__EMBEDDED_DATA__*/", `const EMBEDDED_DATA = ${dataJson};`)
}

// ---------------------------------------------------------------------------
// Port-killing utility
// ---------------------------------------------------------------------------

async function killPort(port: number): Promise<void> {
  try {
    const proc = Bun.spawn(["lsof", "-ti", `:${port}`], {
      stdout: "pipe",
      stderr: "ignore",
    })
    const text = await new Response(proc.stdout).text()
    await proc.exited

    for (const pidStr of text.trim().split("\n")) {
      const pid = parseInt(pidStr.trim(), 10)
      if (!isNaN(pid)) {
        try {
          process.kill(pid, "SIGTERM")
        } catch {
          /* process already gone */
        }
      }
    }
    if (text.trim()) {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  } catch {
    /* lsof not available or no process found */
  }
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export interface ServeReviewOptions {
  workspace: string
  port?: number
  skillName?: string
  previousWorkspace?: string | null
  benchmarkPath?: string | null
  templatePath: string
  openBrowser?: boolean
}

/**
 * Start the eval review HTTP server.
 *
 * Regenerates HTML on each page load so refreshing picks up new outputs
 * without restarting. Returns the Bun server instance.
 */
export async function serveReview(opts: ServeReviewOptions): Promise<{
  server: ReturnType<typeof Bun.serve>
  url: string
  feedbackPath: string
  stop: () => void
}> {
  const {
    workspace,
    port = 3117,
    skillName: skillNameOpt,
    previousWorkspace,
    benchmarkPath,
    templatePath,
    openBrowser = true,
  } = opts

  if (!existsSync(workspace) || !statSync(workspace).isDirectory()) {
    throw new Error(`Workspace is not a directory: ${workspace}`)
  }

  const skillName = skillNameOpt ?? basename(workspace).replace(/-workspace$/, "")
  const feedbackPath = join(workspace, "feedback.json")

  // Load previous iteration data
  let previous: Record<string, { feedback: string; outputs: EmbeddedFile[] }> | null = null
  if (previousWorkspace && existsSync(previousWorkspace)) {
    previous = loadPreviousIteration(previousWorkspace)
  }

  // Kill any existing process on the target port
  await killPort(port)

  let actualPort = port

  const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url)

      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        // Regenerate HTML on each request (re-scans workspace for new outputs)
        const runs = findRuns(workspace)

        let benchmark: Record<string, unknown> | null = null
        if (benchmarkPath && existsSync(benchmarkPath)) {
          try {
            benchmark = JSON.parse(readFileSync(benchmarkPath, "utf-8"))
          } catch {
            /* ignore */
          }
        }

        const html = generateReviewHtml({
          runs,
          skillName,
          previous,
          benchmark,
          templatePath,
        })

        return new Response(html, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        })
      }

      if (req.method === "GET" && url.pathname === "/api/feedback") {
        let data = "{}"
        if (existsSync(feedbackPath)) {
          try {
            data = readFileSync(feedbackPath, "utf-8")
          } catch {
            /* ignore */
          }
        }
        return new Response(data, {
          headers: { "Content-Type": "application/json" },
        })
      }

      if (req.method === "POST" && url.pathname === "/api/feedback") {
        let body: unknown
        try {
          body = (await req.json()) as unknown
        } catch (e) {
          return new Response(JSON.stringify({ error: String(e) }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          })
        }

        if (!isValidFeedbackPayload(body)) {
          return new Response(
            JSON.stringify({ error: "Expected JSON object with a valid 'reviews' array" }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            },
          )
        }

        try {
          writeFileSync(feedbackPath, JSON.stringify(body, null, 2) + "\n")
        } catch (e) {
          return new Response(JSON.stringify({ error: String(e) }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          })
        }

        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        })
      }

      return new Response("Not Found", { status: 404 })
    },
  })

  actualPort = server.port
  const serverUrl = `http://localhost:${actualPort}`

  if (openBrowser) {
    // Open browser (best-effort, non-blocking)
    try {
      Bun.spawn(["open", serverUrl], { stdout: "ignore", stderr: "ignore" })
    } catch {
      /* ignore — headless environment */
    }
  }

  return {
    server,
    url: serverUrl,
    feedbackPath,
    stop: () => server.stop(),
  }
}

// ---------------------------------------------------------------------------
// Static HTML export
// ---------------------------------------------------------------------------

export interface StaticExportOptions {
  workspace: string
  outputPath: string
  skillName?: string
  previousWorkspace?: string | null
  benchmarkPath?: string | null
  templatePath: string
}

/**
 * Generate a standalone HTML file (no server needed).
 */
export function exportStaticReview(opts: StaticExportOptions): string {
  const {
    workspace,
    outputPath,
    skillName: skillNameOpt,
    previousWorkspace,
    benchmarkPath,
    templatePath,
  } = opts

  const skillName = skillNameOpt ?? basename(workspace).replace(/-workspace$/, "")
  const runs = findRuns(workspace)

  if (runs.length === 0) {
    throw new Error(`No runs found in ${workspace}`)
  }

  let previous: Record<string, { feedback: string; outputs: EmbeddedFile[] }> | null = null
  if (previousWorkspace && existsSync(previousWorkspace)) {
    previous = loadPreviousIteration(previousWorkspace)
  }

  let benchmark: Record<string, unknown> | null = null
  if (benchmarkPath && existsSync(benchmarkPath)) {
    try {
      benchmark = JSON.parse(readFileSync(benchmarkPath, "utf-8"))
    } catch {
      /* ignore */
    }
  }

  const html = generateReviewHtml({
    runs,
    skillName,
    previous,
    benchmark,
    templatePath,
  })

  // Ensure parent directory exists
  const parentDir = join(outputPath, "..")
  mkdirSync(parentDir, { recursive: true })
  writeFileSync(outputPath, html)

  return outputPath
}
