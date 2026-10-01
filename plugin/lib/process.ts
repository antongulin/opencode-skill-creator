import { spawn } from "node:child_process"

interface RunProcessOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs: number
  killGraceMs?: number
  maxStderrChars?: number
  onStdoutChunk?: (chunk: string) => boolean | void
  /**
   * Caller-owned cancellation. When it aborts, the child is asked to stop
   * (SIGTERM, then SIGKILL after `killGraceMs`) and the promise resolves with
   * `aborted: true` rather than rejecting. A signal that is already aborted
   * before this call prevents the spawn entirely.
   */
  signal?: AbortSignal
}

export interface RunProcessResult {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  /** True when the call ended because `opts.signal` aborted. */
  aborted: boolean
}

export function isFailedExitCode(exitCode: number | null): boolean {
  return exitCode != null && exitCode !== 0
}

export function isFailedProcess(result: RunProcessResult): boolean {
  return result.timedOut || isFailedExitCode(result.exitCode)
}

/**
 * Build the child environment for an `opencode` invocation pinned to `cwd`.
 *
 * opencode resolves its project root from `$PWD` rather than the spawn cwd, so
 * an inherited/stale caller PWD leaks the wrong project into the child. Every
 * `opencode` call shares this constructor: `cwd` is always the directory the
 * child must treat as its project root (eval roots pass their temp root).
 *
 * Adapted from the contributor proposal in
 * https://github.com/antongulin/opencode-skill-creator/pull/42
 * (Co-authored-by: sogeisetsu <47493432+sogeisetsu@users.noreply.github.com>).
 */
export function buildOpencodeEnv(cwd: string): NodeJS.ProcessEnv {
  return { ...process.env, PWD: cwd }
}

/**
 * Spawn a command without a shell, collect stdout/stderr, and optionally stream
 * stdout chunks to a parser. Rejects only when the process cannot be spawned;
 * callers decide how to handle exit codes and timeouts. Use `timedOut` to
 * distinguish timeouts from other null-exit process states.
 */
export function runProcess(command: string[], opts: RunProcessOptions): Promise<RunProcessResult> {
  return new Promise((resolve, reject) => {
    const [file, ...args] = command
    if (!file) {
      reject(new Error("Cannot spawn an empty command"))
      return
    }

    const maxStderrChars = opts.maxStderrChars ?? 64 * 1024
    const killGraceMs = opts.killGraceMs ?? 1_000

    // A signal that is already aborted before we start must not spawn at all.
    if (opts.signal?.aborted) {
      resolve({ exitCode: null, stdout: "", stderr: "", timedOut: false, aborted: true })
      return
    }

    // stdin must be closed ("ignore"). The `opencode` binary blocks on an
    // open-but-unwritten stdin pipe and produces no output — see the regression
    // test in process.test.ts. `stdout`/`stderr` are not valid spawn keys.
    const proc = spawn(file, args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    let timedOut = false
    let aborted = false
    let settled = false
    let stopRequested = false
    let killTimeoutId: ReturnType<typeof setTimeout> | undefined

    const requestStop = () => {
      if (settled || stopRequested) return
      stopRequested = true
      proc.kill()
      killTimeoutId = setTimeout(() => {
        if (!settled) {
          proc.kill("SIGKILL")
        }
      }, killGraceMs)
    }

    const onAbort = () => {
      if (settled) return
      aborted = true
      requestStop()
    }
    opts.signal?.addEventListener("abort", onAbort, { once: true })

    const timeoutId = setTimeout(() => {
      timedOut = true
      proc.kill()
      killTimeoutId = setTimeout(() => {
        if (!settled) {
          proc.kill("SIGKILL")
        }
      }, killGraceMs)
    }, opts.timeoutMs)

    proc.stdout.setEncoding("utf-8")
    proc.stdout.on("data", (chunk: string) => {
      stdout += chunk
      const shouldStop = opts.onStdoutChunk?.(chunk)
      if (shouldStop) requestStop()
    })

    proc.stderr.setEncoding("utf-8")
    proc.stderr.on("data", (chunk: string) => {
      stderr += chunk
      if (stderr.length > maxStderrChars) {
        stderr = stderr.slice(-maxStderrChars)
      }
    })

    const detach = () => {
      opts.signal?.removeEventListener("abort", onAbort)
    }

    proc.on("error", (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      if (killTimeoutId) clearTimeout(killTimeoutId)
      detach()
      reject(error)
    })

    proc.on("close", (exitCode) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      if (killTimeoutId) clearTimeout(killTimeoutId)
      detach()
      resolve({ exitCode, stdout, stderr, timedOut, aborted })
    })
  })
}
