import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { createConnection } from "node:net"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const pluginSourcePath = fileURLToPath(new URL("../skill-creator.ts", import.meta.url))
const runtimeEntryPath = fileURLToPath(new URL("../runtime-entry.ts", import.meta.url))
const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url))
const pluginRoot = fileURLToPath(new URL("..", import.meta.url))
const distEntryPath = fileURLToPath(new URL("../dist/skill-creator.js", import.meta.url))
const buildManifestPath = fileURLToPath(new URL("../dist/build-manifest.json", import.meta.url))
const distAssetPaths = [
  "../dist/skill-creator.js",
  "../dist/build-manifest.json",
  "../dist/templates/viewer.html",
  "../dist/skill/SKILL.md",
  "../dist/package.json",
].map((path) => fileURLToPath(new URL(path, import.meta.url)))

function listSourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return listSourceFiles(path)
    return entry.isFile() && path.endsWith(".ts") ? [path] : []
  })
}

function hashPluginSources() {
  const files = [runtimeEntryPath, pluginSourcePath, ...listSourceFiles(join(pluginRoot, "lib"))].sort()
  const hash = createHash("sha256")
  for (const file of files) {
    hash.update(relative(pluginRoot, file))
    hash.update("\0")
    hash.update(readFileSync(file))
    hash.update("\0")
  }
  return hash.digest("hex")
}

test("plugin source does not use import.meta.path", () => {
  const source = readFileSync(pluginSourcePath, "utf-8")

  assert.equal(source.includes("import.meta.path"), false)
  assert.equal(source.includes("fileURLToPath(import.meta.url)"), true)
})

test("package entrypoint points to compiled JavaScript", () => {
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8"))

  assert.equal(pkg.main, "./dist/skill-creator.js")
  assert.equal(pkg.files.includes("dist/"), true)
  assert.equal(pkg.files.includes("skill-creator.ts"), false)
})

test("built package includes runtime assets", () => {
  for (const assetPath of distAssetPaths) {
    assert.equal(existsSync(assetPath), true, `${assetPath} should exist`)
  }
})

test("bundled skill uses the opencode-specific skill name", () => {
  const sourceSkill = readFileSync(
    fileURLToPath(new URL("../skill/SKILL.md", import.meta.url)),
    "utf-8",
  )
  const distSkill = readFileSync(
    fileURLToPath(new URL("../dist/skill/SKILL.md", import.meta.url)),
    "utf-8",
  )

  assert.match(sourceSkill, /^name: opencode-skill-creator$/m)
  assert.match(distSkill, /^name: opencode-skill-creator$/m)
})

test("compiled entrypoint imports as a plugin function", async () => {
  const mod = await import(distEntryPath)

  assert.equal(typeof mod.default, "function")
})

test("compiled entrypoint only exposes plugin functions for legacy OpenCode loaders", async () => {
  const mod = await import(distEntryPath)

  assert.deepEqual(Object.keys(mod), ["default"])
  assert.equal(typeof mod.default, "function")
})

test("compiled review server runs in Node without a Bun runtime global", async () => {
  assert.equal(globalThis.Bun, undefined)

  const tempHome = mkdtempSync(join(tmpdir(), "osc-review-server-"))
  const workspace = join(tempHome, "workspace")
  const fakeBin = join(tempHome, "bin")
  const previousXdgConfigHome = process.env.XDG_CONFIG_HOME
  const previousPath = process.env.PATH

  try {
    const outputsDir = join(workspace, "eval-0", "with_skill", "outputs")
    mkdirSync(outputsDir, { recursive: true })
    mkdirSync(fakeBin, { recursive: true })
    writeFileSync(
      join(workspace, "eval-0", "eval_metadata.json"),
      `${JSON.stringify({ eval_id: 0, prompt: "Review this output" })}\n`,
    )
    const benchmarkPath = join(workspace, "benchmark.json")
    writeFileSync(
      benchmarkPath,
      `${JSON.stringify({ summary: { total_evals: 1, pass_rate: 1 } })}\n`,
    )
    writeFileSync(join(outputsDir, "result.txt"), "ok\n")
    writeFileSync(join(fakeBin, "open"), "#!/bin/sh\nexit 0\n")
    chmodSync(join(fakeBin, "open"), 0o755)

    process.env.XDG_CONFIG_HOME = tempHome
    process.env.PATH = previousPath ? `${fakeBin}:${previousPath}` : fakeBin

    const mod = await import(`${distEntryPath}?review-node=${Date.now()}`)
    const hooks = await mod.default({})
    const result = JSON.parse(
      await hooks.tool.skill_serve_review.execute({
        workspace,
        port: 0,
        skillName: "test-skill",
        benchmarkPath,
        allowPartial: true,
      }),
    )

    try {
      const response = await fetch(result.url)
      assert.equal(response.status, 200)
      const html = await response.text()
      assert.match(html, /test-skill/)
      assert.match(html, /ok/)
      assert.match(html, /total_evals/)

      const feedback = {
        status: "complete",
        reviews: [
          {
            run_id: "eval-0-with_skill",
            feedback: "works",
            timestamp: "2026-05-24T00:00:00.000Z",
          },
        ],
      }
      const feedbackResponse = await fetch(`${result.url}/api/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(feedback),
      })
      assert.equal(feedbackResponse.status, 200)
      assert.equal(readFileSync(result.feedbackPath, "utf-8"), `${JSON.stringify(feedback, null, 2)}\n`)

      const oversizedResponse = await fetch(`${result.url}/api/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviews: [
            {
              run_id: "eval-0-with_skill",
              feedback: "x".repeat(1_100_000),
            },
          ],
        }),
      })
      assert.equal(oversizedResponse.status, 413)
    } finally {
      await hooks.tool.skill_stop_review.execute({ workspace })
    }
  } finally {
    if (previousXdgConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME
    } else {
      process.env.XDG_CONFIG_HOME = previousXdgConfigHome
    }
    if (previousPath === undefined) {
      delete process.env.PATH
    } else {
      process.env.PATH = previousPath
    }
    rmSync(tempHome, { recursive: true, force: true })
  }
})

test("compiled review server stop closes active browser connections", async () => {
  const tempHome = mkdtempSync(join(tmpdir(), "osc-review-stop-"))
  const workspace = join(tempHome, "workspace")
  const previousXdgConfigHome = process.env.XDG_CONFIG_HOME
  let socket
  let stopPromise

  try {
    const outputsDir = join(workspace, "eval-0", "with_skill", "outputs")
    mkdirSync(outputsDir, { recursive: true })
    writeFileSync(
      join(workspace, "eval-0", "eval_metadata.json"),
      `${JSON.stringify({ eval_id: 0, prompt: "Review this output" })}\n`,
    )
    writeFileSync(join(outputsDir, "result.txt"), "ok\n")

    process.env.XDG_CONFIG_HOME = tempHome

    const mod = await import(`${distEntryPath}?review-stop=${Date.now()}`)
    const hooks = await mod.default({})
    const result = JSON.parse(
      await hooks.tool.skill_serve_review.execute({
        workspace,
        port: 0,
        skillName: "test-skill",
        allowPartial: true,
      }),
    )
    const url = new URL(result.url)

    socket = await new Promise((resolve, reject) => {
      const client = createConnection(Number(url.port), url.hostname, () => resolve(client))
      client.on("error", reject)
    })
    socket.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n")

    stopPromise = hooks.tool.skill_stop_review.execute({ workspace })
    await Promise.race([
      stopPromise,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Timed out waiting for review server to stop")), 500)
      }),
    ])
  } finally {
    socket?.destroy()
    if (stopPromise) await stopPromise.catch(() => {})
    if (previousXdgConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME
    } else {
      process.env.XDG_CONFIG_HOME = previousXdgConfigHome
    }
    rmSync(tempHome, { recursive: true, force: true })
  }
})

test("compiled plugin startup installs renamed skill and archives plugin-owned legacy skill", async () => {
  const tempHome = mkdtempSync(join(tmpdir(), "osc-compiled-plugin-"))
  const previousXdgConfigHome = process.env.XDG_CONFIG_HOME

  try {
    const legacySkillDir = join(
      tempHome,
      "opencode",
      "skills",
      "skill-creator",
    )
    mkdirSync(legacySkillDir, { recursive: true })
    writeFileSync(join(legacySkillDir, ".opencode-skill-creator-version"), "0.2.12\n")
    writeFileSync(join(legacySkillDir, "SKILL.md"), "legacy plugin-owned skill\n")

    process.env.XDG_CONFIG_HOME = tempHome

    const mod = await import(`${distEntryPath}?startup=${Date.now()}`)
    const hooks = await mod.default({})

    const newSkillDir = join(
      tempHome,
      "opencode",
      "skills",
      "opencode-skill-creator",
    )
    const backupDirs = readdirSync(join(tempHome, "opencode", "skills")).filter(
      (entry) => entry.startsWith("skill-creator.opencode-skill-creator-backup-"),
    )

    assert.equal(typeof hooks.tool.skill_validate.execute, "function")
    assert.equal(existsSync(join(newSkillDir, "SKILL.md")), true)
    assert.match(
      readFileSync(join(newSkillDir, "SKILL.md"), "utf-8"),
      /^name: opencode-skill-creator$/m,
    )
    assert.equal(existsSync(legacySkillDir), false)
    assert.equal(backupDirs.length, 1)
    assert.equal(
      existsSync(
        join(
          tempHome,
          "opencode",
          "skills",
          backupDirs[0],
          "SKILL.md.backup",
        ),
      ),
      true,
    )
    assert.equal(
      existsSync(
        join(tempHome, "opencode", "skills", backupDirs[0], "SKILL.md"),
      ),
      false,
    )
  } finally {
    if (previousXdgConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME
    } else {
      process.env.XDG_CONFIG_HOME = previousXdgConfigHome
    }
    rmSync(tempHome, { recursive: true, force: true })
  }
})

test("compiled artifact manifest matches current TypeScript sources", () => {
  const manifest = JSON.parse(readFileSync(buildManifestPath, "utf-8"))

  assert.equal(manifest.entrypoint, "skill-creator.ts")
  assert.equal(manifest.runtimeEntrypoint, "runtime-entry.ts")
  assert.equal(manifest.sourceHash, hashPluginSources())
  assert.equal(typeof manifest.builtAt, "string")
  assert.equal(Number.isNaN(Date.parse(manifest.builtAt)), false)
  assert.ok(statSync(distEntryPath).size > 0)
})

test("compiled entrypoint has no trailing whitespace", () => {
  const source = readFileSync(distEntryPath, "utf-8")

  assert.equal(/[ \t]+$/m.test(source), false)
})
