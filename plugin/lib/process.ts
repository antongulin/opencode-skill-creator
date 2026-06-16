import { spawn } from "node:child_process"

interface RunProcessOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs: number
  killGraceMs?: number
  maxStderrChars?: number
  onStdoutChunk?: (chunk: string) => void
}

export interface RunProcessResult {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

export function isFailedExitCode(exitCode: number | null): boolean {
  return exitCode != null && exitCode !== 0
}

export function isFailedProcess(result: RunProcessResult): boolean {
  return result.timedOut || isFailedExitCode(result.exitCode)
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
    let settled = false
    let killTimeoutId: ReturnType<typeof setTimeout> | undefined

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
      opts.onStdoutChunk?.(chunk)
    })

    proc.stderr.setEncoding("utf-8")
    proc.stderr.on("data", (chunk: string) => {
      stderr += chunk
      if (stderr.length > maxStderrChars) {
        stderr = stderr.slice(-maxStderrChars)
      }
    })

    proc.on("error", (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      if (killTimeoutId) clearTimeout(killTimeoutId)
      reject(error)
    })

    proc.on("close", (exitCode) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      if (killTimeoutId) clearTimeout(killTimeoutId)
      resolve({ exitCode, stdout, stderr, timedOut })
    })
  })
}
