import { expect, mock, test } from "bun:test"
import { EventEmitter } from "events"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { fileURLToPath } from "url"

// Mock only the OS launcher boundary (node:child_process.spawn). This proves the
// platform command and arguments that `defaultOpenBrowser` actually hands to the
// OS, and that an asynchronous spawn failure is contained — without launching a
// real browser. The mock must be installed before review-server is imported.
interface SpawnCall {
  command: string
  args: string[]
}

const spawnCalls: SpawnCall[] = []
const pendingProcs: EventEmitter[] = []

mock.module("node:child_process", () => ({
  spawn: (command: string, args: string[]) => {
    spawnCalls.push({ command, args })
    const proc = new EventEmitter() as EventEmitter & {
      unref: () => void
      kill: () => void
    }
    proc.unref = () => {}
    proc.kill = () => {}
    pendingProcs.push(proc)
    return proc
  },
}))

const { browserOpenCommand, serveReview } = await import("../lib/review-server")

const templatePath = fileURLToPath(new URL("../templates/viewer.html", import.meta.url))

function makeWorkspace() {
  const root = mkdtempSync(join(tmpdir(), "osc-browser-spawn-"))
  const workspace = join(root, "workspace")
  mkdirSync(join(workspace, "eval-0", "with_skill", "outputs"), { recursive: true })
  writeFileSync(
    join(workspace, "eval-0", "eval_metadata.json"),
    `${JSON.stringify({ eval_id: 0, prompt: "Review" })}\n`,
  )
  writeFileSync(join(workspace, "eval-0", "with_skill", "outputs", "result.txt"), "ok\n")
  return { root, workspace }
}

test("defaultOpenBrowser spawns the platform launcher and survives an async error", async () => {
  const { root, workspace } = makeWorkspace()
  const previousEnv = process.env.OPENCODE_SKILL_CREATOR_OPEN_BROWSER
  const warnings: string[] = []
  const originalWarn = console.warn
  let stop: (() => Promise<void>) | undefined
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "))
  }
  try {
    delete process.env.OPENCODE_SKILL_CREATOR_OPEN_BROWSER
    spawnCalls.length = 0
    pendingProcs.length = 0

    const served = await serveReview({
      workspace,
      port: 0,
      templatePath,
      openBrowser: true,
    })
    stop = served.stop

    // The real default launcher ran and chose the platform command for this
    // host, passing the server URL verbatim.
    const expected = browserOpenCommand(served.url)
    expect(spawnCalls).toEqual([{ command: expected.command, args: expected.args }])

    // Deliver the asynchronous ENOENT a missing launcher produces.
    for (const proc of pendingProcs) {
      const error = new Error("spawn ENOENT") as NodeJS.ErrnoException
      error.code = "ENOENT"
      proc.emit("error", error)
    }

    // The error is contained: the host is alive and the reviewer still serves.
    const response = await fetch(served.url)
    expect(response.status).toBe(200)
    expect(warnings.some((message) => message.includes(served.url))).toBe(true)
  } finally {
    try {
      await stop?.()
    } finally {
      console.warn = originalWarn
      if (previousEnv === undefined) delete process.env.OPENCODE_SKILL_CREATOR_OPEN_BROWSER
      else process.env.OPENCODE_SKILL_CREATOR_OPEN_BROWSER = previousEnv
      rmSync(root, { recursive: true, force: true })
    }
  }
})

test("no-open mode performs zero launcher calls at the OS boundary", async () => {
  const { root, workspace } = makeWorkspace()
  const previousEnv = process.env.OPENCODE_SKILL_CREATOR_OPEN_BROWSER
  let stop: (() => Promise<void>) | undefined
  try {
    process.env.OPENCODE_SKILL_CREATOR_OPEN_BROWSER = "0"
    spawnCalls.length = 0

    const served = await serveReview({
      workspace,
      port: 0,
      templatePath,
      // Even with the tool default (openBrowser omitted => true), the env
      // override must short-circuit before any spawn.
    })
    stop = served.stop

    expect(spawnCalls).toEqual([])
  } finally {
    try {
      await stop?.()
    } finally {
      if (previousEnv === undefined) delete process.env.OPENCODE_SKILL_CREATOR_OPEN_BROWSER
      else process.env.OPENCODE_SKILL_CREATOR_OPEN_BROWSER = previousEnv
      rmSync(root, { recursive: true, force: true })
    }
  }
})
