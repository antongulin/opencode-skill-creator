import { expect, test } from "bun:test"
import { existsSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { isFailedExitCode, isFailedProcess, runProcess } from "../lib/process"

/** Poll for a readiness file the child writes after it has started. */
async function waitForFile(path: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!existsSync(path) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  if (!existsSync(path)) throw new Error(`ready marker not written: ${path}`)
}

test("isFailedExitCode treats only defined non-zero exit codes as failures", () => {
  expect(isFailedExitCode(1)).toBe(true)
  expect(isFailedExitCode(0)).toBe(false)
  expect(isFailedExitCode(null)).toBe(false)
})

test("isFailedProcess treats timeouts as failures without changing null exit semantics", () => {
  expect(
    isFailedProcess({ exitCode: null, stdout: "", stderr: "", timedOut: true }),
  ).toBe(true)
  expect(
    isFailedProcess({ exitCode: null, stdout: "", stderr: "", timedOut: false }),
  ).toBe(false)
  expect(
    isFailedProcess({ exitCode: 1, stdout: "", stderr: "", timedOut: false }),
  ).toBe(true)
})

test("runProcess reports timeouts without treating null exits as failures", async () => {
  const result = await runProcess(
    ["node", "-e", "setTimeout(() => undefined, 1000)"],
    { timeoutMs: 10 },
  )

  expect(result.timedOut).toBe(true)
  expect(result.exitCode).toBe(null)
  expect(isFailedExitCode(result.exitCode)).toBe(false)
})

test("runProcess force kills processes that ignore timeout termination", async () => {
  const startedAt = Date.now()
  const result = await runProcess(
    [
      "node",
      "-e",
      "process.on('SIGTERM', () => {}); setTimeout(() => undefined, 2000)",
    ],
    { timeoutMs: 200, killGraceMs: 20 },
  )

  expect(result.timedOut).toBe(true)
  expect(Date.now() - startedAt).toBeLessThan(1_000)
})

test("runProcess keeps only the tail of stderr", async () => {
  const result = await runProcess(
    ["node", "-e", "process.stderr.write('abcde12345')"],
    { timeoutMs: 1_000, maxStderrChars: 5 },
  )

  expect(result.stderr).toBe("12345")
})

test("runProcess rejects spawn errors", async () => {
  await expect(
    runProcess(["definitely-not-a-real-command-opencode-skill-creator"], {
      timeoutMs: 1_000,
    }),
  ).rejects.toThrow()
})

test("runProcess does not hang when the child blocks on stdin", async () => {
  // Regression for the silent stdio typo where `stdout: "pipe", stderr: "pipe"`
  // was passed instead of `stdio: [...]`, leaving stdin as an unwritten pipe.
  // The opencode binary (the real consumer) blocks on that stdin and produces
  // zero output. We simulate that here with a child that explicitly reads stdin
  // to EOF: with stdin closed it exits 0 immediately; with stdin piped open and
  // no writer it would hang until the test timeout.
  const result = await runProcess(
    [
      "node",
      "-e",
      "process.stdin.on('data', () => {}); process.stdin.on('end', () => { console.log('done'); process.exit(0) })",
    ],
    { timeoutMs: 3_000 },
  )

  expect(result.exitCode).toBe(0)
  expect(result.timedOut).toBe(false)
  expect(result.stdout.trim()).toBe("done")
})

test("runProcess can stop early from stdout parsing without timing out", async () => {
  const startedAt = Date.now()
  const result = await runProcess(
    [
      "node",
      "-e",
      "process.stdout.write('triggered\\n'); setTimeout(() => process.stdout.write('late\\n'), 1000)",
    ],
    {
      timeoutMs: 3_000,
      onStdoutChunk(chunk) {
        return chunk.includes("triggered")
      },
    },
  )

  expect(result.timedOut).toBe(false)
  expect(result.stdout).toContain("triggered")
  expect(Date.now() - startedAt).toBeLessThan(1_000)
})

test("runProcess kills the child and reports aborted when the signal aborts", async () => {
  const controller = new AbortController()
  const ready = join(mkdtempSync(join(tmpdir(), "osc-abort-ready-")), "ready")
  const startedAt = Date.now()
  const pending = runProcess(
    [
      "node",
      "-e",
      `require("fs").writeFileSync(process.env.SKC_READY, "1"); setTimeout(() => undefined, 30_000)`,
    ],
    {
      timeoutMs: 60_000,
      signal: controller.signal,
      env: { ...process.env, SKC_READY: ready },
    },
  )

  // Deterministic readiness instead of an arbitrary delay: abort only once the
  // child has actually spawned and signalled it is running.
  await waitForFile(ready)
  controller.abort()

  const result = await pending

  expect(result.aborted).toBe(true)
  expect(result.timedOut).toBe(false)
  // Must not have awaited the full 30 s child lifetime.
  expect(Date.now() - startedAt).toBeLessThan(5_000)
})

test("runProcess force-kills an abort-ignoring child after the grace period", async () => {
  const controller = new AbortController()
  const ready = join(mkdtempSync(join(tmpdir(), "osc-kill-ready-")), "ready")
  const startedAt = Date.now()
  const pending = runProcess(
    [
      "node",
      "-e",
      // The SIGTERM handler is installed BEFORE the ready marker, so once the
      // marker exists the abort's SIGTERM is guaranteed to be ignored and the
      // SIGKILL escalation is what actually ends the child.
      `process.on("SIGTERM", () => {}); require("fs").writeFileSync(process.env.SKC_READY, "1"); setTimeout(() => undefined, 30_000)`,
    ],
    {
      timeoutMs: 60_000,
      killGraceMs: 50,
      signal: controller.signal,
      env: { ...process.env, SKC_READY: ready },
    },
  )

  await waitForFile(ready)
  controller.abort()

  const result = await pending

  expect(result.aborted).toBe(true)
  expect(Date.now() - startedAt).toBeLessThan(5_000)
})

test("runProcess does not spawn when the signal is already aborted", async () => {
  const controller = new AbortController()
  controller.abort()

  const result = await runProcess(["node", "-e", "process.exit(1)"], {
    timeoutMs: 1_000,
    signal: controller.signal,
  })

  expect(result.aborted).toBe(true)
  expect(result.exitCode).toBe(null)
})
