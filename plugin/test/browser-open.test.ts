import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { fileURLToPath } from "url"

import { browserOpenCommand, browserOpenDisabledByEnv, serveReview } from "../lib/review-server"

const templatePath = fileURLToPath(new URL("../templates/viewer.html", import.meta.url))

function makeWorkspace() {
  const root = mkdtempSync(join(tmpdir(), "osc-browser-open-"))
  const workspace = join(root, "workspace")
  mkdirSync(join(workspace, "eval-0", "with_skill", "outputs"), { recursive: true })
  writeFileSync(
    join(workspace, "eval-0", "eval_metadata.json"),
    `${JSON.stringify({ eval_id: 0, prompt: "Review" })}\n`,
  )
  writeFileSync(join(workspace, "eval-0", "with_skill", "outputs", "result.txt"), "ok\n")
  return { root, workspace }
}

/** Restore an env var, treating `undefined` as "was not set". */
function restoreEnv(name: string, previous: string | undefined) {
  if (previous === undefined) delete process.env[name]
  else process.env[name] = previous
}

test("browserOpenDisabledByEnv recognizes the disable values", () => {
  expect(browserOpenDisabledByEnv({ OPENCODE_SKILL_CREATOR_OPEN_BROWSER: "0" })).toBe(true)
  expect(browserOpenDisabledByEnv({ OPENCODE_SKILL_CREATOR_OPEN_BROWSER: "false" })).toBe(true)
  expect(browserOpenDisabledByEnv({ OPENCODE_SKILL_CREATOR_OPEN_BROWSER: "1" })).toBe(false)
  expect(browserOpenDisabledByEnv({})).toBe(false)
})

test("browserOpenCommand selects the platform browser launcher and arguments", () => {
  const url = "http://localhost:3117"

  // macOS: `open <url>`.
  expect(browserOpenCommand(url, "darwin")).toEqual({
    command: "open",
    args: [url],
  })

  // Windows: `cmd /c start "" <url>` — the empty title keeps the URL from being
  // consumed as the window title.
  expect(browserOpenCommand(url, "win32")).toEqual({
    command: "cmd",
    args: ["/c", "start", "", url],
  })

  // Linux and every other Unix platform: `xdg-open <url>`.
  expect(browserOpenCommand(url, "linux")).toEqual({
    command: "xdg-open",
    args: [url],
  })
  expect(browserOpenCommand(url, "freebsd")).toEqual({
    command: "xdg-open",
    args: [url],
  })

  // The URL is passed through verbatim, never shell-interpolated.
  const tricky = "http://localhost:3117/review?a=1&b=2"
  expect(browserOpenCommand(tricky, "win32").args).toEqual([
    "/c",
    "start",
    "",
    tricky,
  ])
  expect(browserOpenCommand(tricky, "darwin").args).toEqual([tricky])
})

test("serveReview does not invoke the browser launcher when openBrowser is false", async () => {
  const { root, workspace } = makeWorkspace()
  let launched = 0
  let stop: (() => Promise<void>) | undefined
  try {
    ;({ stop } = await serveReview({
      workspace,
      port: 0,
      templatePath,
      openBrowser: false,
      openBrowserImpl: () => {
        launched += 1
      },
    }))
    expect(launched).toBe(0)
  } finally {
    try {
      await stop?.()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
})

test("serveReview does not invoke the browser launcher when disabled by env", async () => {
  const { root, workspace } = makeWorkspace()
  const previous = process.env.OPENCODE_SKILL_CREATOR_OPEN_BROWSER
  process.env.OPENCODE_SKILL_CREATOR_OPEN_BROWSER = "0"
  let launched = 0
  let stop: (() => Promise<void>) | undefined
  try {
    ;({ stop } = await serveReview({
      workspace,
      port: 0,
      templatePath,
      openBrowserImpl: () => {
        launched += 1
      },
    }))
    expect(launched).toBe(0)
  } finally {
    try {
      await stop?.()
    } finally {
      restoreEnv("OPENCODE_SKILL_CREATOR_OPEN_BROWSER", previous)
      rmSync(root, { recursive: true, force: true })
    }
  }
})

test("serveReview invokes the browser launcher by default when enabled", async () => {
  const { root, workspace } = makeWorkspace()
  const previous = process.env.OPENCODE_SKILL_CREATOR_OPEN_BROWSER
  delete process.env.OPENCODE_SKILL_CREATOR_OPEN_BROWSER
  const urls: string[] = []
  let stop: (() => Promise<void>) | undefined
  try {
    const served = await serveReview({
      workspace,
      port: 0,
      templatePath,
      openBrowserImpl: (u) => {
        urls.push(u)
      },
    })
    stop = served.stop
    expect(urls).toEqual([served.url])
  } finally {
    try {
      await stop?.()
    } finally {
      restoreEnv("OPENCODE_SKILL_CREATOR_OPEN_BROWSER", previous)
      rmSync(root, { recursive: true, force: true })
    }
  }
})

test("serveReview survives a missing browser launcher (async spawn error)", async () => {
  const { root, workspace } = makeWorkspace()
  const previousPath = process.env.PATH
  const previousEnv = process.env.OPENCODE_SKILL_CREATOR_OPEN_BROWSER
  const warnings: string[] = []
  const originalWarn = console.warn
  let stop: (() => Promise<void>) | undefined
  let emptyBin: string | undefined
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "))
  }
  try {
    delete process.env.OPENCODE_SKILL_CREATOR_OPEN_BROWSER
    // Point PATH at an empty directory so the real platform launcher
    // (`open` on macOS) fails with ENOENT — the same asynchronous failure a
    // headless host produces. This launches no browser: the command lookup
    // itself fails.
    emptyBin = mkdtempSync(join(tmpdir(), "osc-empty-bin-"))
    process.env.PATH = emptyBin

    const served = await serveReview({
      workspace,
      port: 0,
      templatePath,
      openBrowser: true, // exercise the real defaultOpenBrowser path
    })
    stop = served.stop

    // Bounded wait for the async ENOENT to reach the error handler.
    const deadline = Date.now() + 2000
    while (warnings.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setImmediate(resolve))
    }

    // The process is still alive and the review server still answers.
    const response = await fetch(served.url)
    expect(response.status).toBe(200)
    expect(warnings.some((message) => message.includes(served.url))).toBe(true)
  } finally {
    try {
      await stop?.()
    } finally {
      console.warn = originalWarn
      process.env.PATH = previousPath
      restoreEnv("OPENCODE_SKILL_CREATOR_OPEN_BROWSER", previousEnv)
      if (emptyBin) rmSync(emptyBin, { recursive: true, force: true })
      rmSync(root, { recursive: true, force: true })
    }
  }
})
