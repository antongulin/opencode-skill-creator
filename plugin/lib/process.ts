import { spawn } from "node:child_process"

interface RunProcessOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs: number
  maxStderrChars?: number
  onStdoutChunk?: (chunk: string) => void
}

export interface RunProcessResult {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

export function runProcess(command: string[], opts: RunProcessOptions): Promise<RunProcessResult> {
  return new Promise((resolve, reject) => {
    const [file, ...args] = command
    if (!file) {
      reject(new Error("Cannot spawn an empty command"))
      return
    }

    const maxStderrChars = opts.maxStderrChars ?? 64 * 1024
    const proc = spawn(file, args, {
      cwd: opts.cwd,
      env: opts.env,
      stdout: "pipe",
      stderr: "pipe",
    })
    let stdout = ""
    let stderr = ""
    let timedOut = false
    let settled = false

    const timeoutId = setTimeout(() => {
      timedOut = true
      proc.kill()
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
      reject(error)
    })

    proc.on("close", (exitCode) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      resolve({ exitCode, stdout, stderr, timedOut })
    })
  })
}
