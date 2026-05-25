import { expect, test } from "bun:test"

import { isFailedExitCode, isFailedProcess, runProcess } from "../lib/process"

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
