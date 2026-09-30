import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { fileURLToPath } from "url"

import { browserOpenDisabledByEnv, serveReview } from "../lib/review-server"

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

test("browserOpenDisabledByEnv recognizes the disable values", () => {
  expect(browserOpenDisabledByEnv({ OPENCODE_SKILL_CREATOR_OPEN_BROWSER: "0" })).toBe(true)
  expect(browserOpenDisabledByEnv({ OPENCODE_SKILL_CREATOR_OPEN_BROWSER: "false" })).toBe(true)
  expect(browserOpenDisabledByEnv({ OPENCODE_SKILL_CREATOR_OPEN_BROWSER: "1" })).toBe(false)
  expect(browserOpenDisabledByEnv({})).toBe(false)
})

test("serveReview does not invoke the browser launcher when openBrowser is false", async () => {
  const { root, workspace } = makeWorkspace()
  let launched = 0
  try {
    const { stop } = await serveReview({
      workspace,
      port: 0,
      templatePath,
      openBrowser: false,
      openBrowserImpl: () => {
        launched += 1
      },
    })
    expect(launched).toBe(0)
    await stop()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("serveReview does not invoke the browser launcher when disabled by env", async () => {
  const { root, workspace } = makeWorkspace()
  const previous = process.env.OPENCODE_SKILL_CREATOR_OPEN_BROWSER
  process.env.OPENCODE_SKILL_CREATOR_OPEN_BROWSER = "0"
  let launched = 0
  try {
    const { stop } = await serveReview({
      workspace,
      port: 0,
      templatePath,
      openBrowserImpl: () => {
        launched += 1
      },
    })
    expect(launched).toBe(0)
    await stop()
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_SKILL_CREATOR_OPEN_BROWSER
    else process.env.OPENCODE_SKILL_CREATOR_OPEN_BROWSER = previous
    rmSync(root, { recursive: true, force: true })
  }
})

test("serveReview invokes the browser launcher by default when enabled", async () => {
  const { root, workspace } = makeWorkspace()
  const previous = process.env.OPENCODE_SKILL_CREATOR_OPEN_BROWSER
  delete process.env.OPENCODE_SKILL_CREATOR_OPEN_BROWSER
  const urls: string[] = []
  try {
    const { url, stop } = await serveReview({
      workspace,
      port: 0,
      templatePath,
      openBrowserImpl: (u) => {
        urls.push(u)
      },
    })
    expect(urls).toEqual([url])
    await stop()
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_SKILL_CREATOR_OPEN_BROWSER
    else process.env.OPENCODE_SKILL_CREATOR_OPEN_BROWSER = previous
    rmSync(root, { recursive: true, force: true })
  }
})
