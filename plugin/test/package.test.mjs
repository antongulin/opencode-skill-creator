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
import { fileURLToPath, pathToFileURL } from "node:url"
import { execFileSync } from "node:child_process"
import { createServer } from "node:http"
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

test("compiled entrypoint exposes both the V1 server and V2 setup entrypoints", async () => {
  // Windows needs a file:// URL; a bare "E:\..." path is rejected by the ESM loader.
  const mod = await import(pathToFileURL(distEntryPath).href)

  assert.equal(typeof mod.default, "object")
  assert.equal(typeof mod.default.server, "function")
  assert.equal(typeof mod.default.setup, "function")
  assert.equal(mod.default.id, "opencode-skill-creator")
})

test("compiled entrypoint only exposes plugin entrypoints for OpenCode loaders", async () => {
  const mod = await import(pathToFileURL(distEntryPath).href)

  assert.deepEqual(Object.keys(mod), ["default"])
  assert.equal(typeof mod.default.server, "function")
  assert.equal(typeof mod.default.setup, "function")
})

// V2 registers tools through `ctx.tool.transform`; record the added definitions
// from a real setup() call. The recording ctx is a wiring double only — the
// same surface is exercised against the real runtime in v2-runtime.test.mjs.
async function collectV2Tools(skillListData = []) {
  const mod = await import(pathToFileURL(distEntryPath).href)
  const added = []
  const ctx = {
    skill: { list: async () => ({ data: skillListData }) },
    tool: {
      transform: async (callback) => {
        callback({ add: (definition) => added.push(definition) })
      },
    },
  }
  const cleanup = await mod.default.setup(ctx)
  return { added, cleanup }
}

test("V2 setup registers the full public tool surface with JSON Schema input", async () => {
  const { added } = await collectV2Tools()

  const expectedNames = [
    "skill_add_gold_standard",
    "skill_aggregate_benchmark",
    "skill_eval",
    "skill_export_static_review",
    "skill_generate_report",
    "skill_get_gold_advice",
    "skill_improve_description",
    "skill_list_gold_standards",
    "skill_optimize_loop",
    "skill_parse",
    "skill_remove_gold_standard",
    "skill_serve_review",
    "skill_stop_review",
    "skill_validate",
  ]

  assert.deepEqual(
    added.map((tool) => tool.name).sort(),
    expectedNames,
  )

  for (const tool of added) {
    assert.equal(typeof tool.description, "string", `${tool.name} description`)
    assert.equal(tool.input.type, "object", `${tool.name} input type`)
    // Zod sets `additionalProperties: false` whenever the object has keys; a
    // keyless object omits it, which JSON Schema also treats as unconstrained.
    if (typeof tool.input.additionalProperties !== "undefined") {
      assert.equal(
        tool.input.additionalProperties,
        false,
        `${tool.name} additionalProperties`,
      )
    }
    assert.equal(typeof tool.execute, "function", `${tool.name} execute`)
  }

  const validate = added.find((tool) => tool.name === "skill_validate")
  assert.deepEqual(validate.input.required, ["skillPath"])

  const noArgTools = ["skill_list_gold_standards", "skill_get_gold_advice"]
  for (const name of noArgTools) {
    const tool = added.find((entry) => entry.name === name)
    // Zod omits `required` when no key is required; JSON Schema treats that as
    // "nothing required", so accept either an empty array or absence.
    assert.deepEqual(tool.input.required ?? [], [], `${name} required`)
    assert.deepEqual(tool.input.properties, {}, `${name} properties`)
  }
})

test("V1 server() hooks and V2 setup expose the same tool names and required args", async () => {
  const mod = await import(pathToFileURL(distEntryPath).href)
  const hooks = await mod.default.server({})
  const v1Tools = hooks.tool

  const { added } = await collectV2Tools()
  const v2ByName = new Map(added.map((tool) => [tool.name, tool]))

  const v1Names = Object.keys(v1Tools).sort()
  const v2Names = added.map((tool) => tool.name).sort()
  assert.deepEqual(v1Names, v2Names)

  for (const [name, definition] of Object.entries(v1Tools)) {
    const v2 = v2ByName.get(name)
    assert.ok(v2, `${name} present in V2`)
    assert.equal(definition.description, v2.description)

    // The V2 JSON Schema `required` must match the V1 zod shape's required keys.
    const required = Object.entries(definition.args)
      .filter(([, schema]) => !schema.isOptional())
      .map(([key]) => key)
      .sort()
    assert.deepEqual([...(v2.input.required ?? [])].sort(), required, `${name} required`)
  }
})

test("V1 and V2 tool execution return equivalent payloads", async () => {
  const mod = await import(pathToFileURL(distEntryPath).href)
  const hooks = await mod.default.server({})
  const { added } = await collectV2Tools()

  const skillDir = mkdtempSync(join(tmpdir(), "osc-parity-skill-"))
  try {
    writeFileSync(
      join(skillDir, "SKILL.md"),
      ["---", "name: parity-skill", "description: A parity test skill.", "---", "", "# Parity", ""].join("\n"),
    )

    const v1 = await hooks.tool.skill_validate.execute({ skillPath: skillDir })
    const v2 = await added
      .find((tool) => tool.name === "skill_validate")
      .execute({ skillPath: skillDir })

    assert.equal(v2.content, v1)
  } finally {
    rmSync(skillDir, { recursive: true, force: true })
  }
})

test("V2 setup cleanup stops active review servers", async () => {
  const tempHome = mkdtempSync(join(tmpdir(), "osc-v2-cleanup-"))
  const workspace = join(tempHome, "workspace")
  const previousXdgConfigHome = process.env.XDG_CONFIG_HOME

  try {
    mkdirSync(join(workspace, "eval-0", "with_skill", "outputs"), { recursive: true })
    writeFileSync(
      join(workspace, "eval-0", "eval_metadata.json"),
      `${JSON.stringify({ eval_id: 0, prompt: "Review" })}\n`,
    )
    writeFileSync(join(workspace, "eval-0", "with_skill", "outputs", "result.txt"), "ok\n")
    process.env.XDG_CONFIG_HOME = tempHome

    const mod = await import(`${distEntryPath}?v2-cleanup=${Date.now()}`)
    const added = []
    const ctx = {
      skill: { list: async () => ({ data: [] }) },
      tool: {
        transform: async (callback) => {
          callback({ add: (definition) => added.push(definition) })
        },
      },
    }
    const cleanup = await mod.default.setup(ctx)

    const serve = added.find((tool) => tool.name === "skill_serve_review")
    const response = await serve.execute({
      workspace,
      port: 0,
      skillName: "cleanup-skill",
      allowPartial: true,
    })
    const result = JSON.parse(response.content)

    // Server is live before cleanup.
    assert.equal((await fetch(result.url)).status, 200)

    await cleanup()

    await assert.rejects(fetch(result.url), "server should be closed after cleanup")
  } finally {
    if (previousXdgConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME
    } else {
      process.env.XDG_CONFIG_HOME = previousXdgConfigHome
    }
    rmSync(tempHome, { recursive: true, force: true })
  }
})

test("compiled entrypoint does not depend on Bun runtime APIs", () => {
  const source = readFileSync(distEntryPath, "utf-8")

  assert.doesNotMatch(source, /\bBun\b/)
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
    const hooks = await mod.default.server({})
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
    const hooks = await mod.default.server({})
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
    const hooks = await mod.default.server({})

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

// ---------------------------------------------------------------------------
// E-03: the review server must not kill an unrelated process that holds the
// requested port, and must fail loudly instead.
// ---------------------------------------------------------------------------

test("review server refuses to steal a busy port and leaves the other listener alive", async () => {
  const tempHome = mkdtempSync(join(tmpdir(), "osc-port-guard-"))
  const workspace = join(tempHome, "workspace")
  const previousXdgConfigHome = process.env.XDG_CONFIG_HOME

  // An unrelated process owns a port first.
  const blocker = createServer((_req, res) => res.end("blocker"))
  await new Promise((resolve) => blocker.listen(0, "127.0.0.1", resolve))
  const port = blocker.address().port

  let blockerConnections = 0
  blocker.on("connection", () => {
    blockerConnections += 1
  })

  try {
    mkdirSync(join(workspace, "eval-0", "with_skill", "outputs"), { recursive: true })
    writeFileSync(
      join(workspace, "eval-0", "eval_metadata.json"),
      `${JSON.stringify({ eval_id: 0, prompt: "Review" })}\n`,
    )
    writeFileSync(join(workspace, "eval-0", "with_skill", "outputs", "result.txt"), "ok\n")
    process.env.XDG_CONFIG_HOME = tempHome

    const mod = await import(`${distEntryPath}?port-guard=${Date.now()}`)
    const added = []
    const ctx = {
      skill: { list: async () => ({ data: [] }) },
      tool: {
        transform: async (callback) => {
          callback({ add: (definition) => added.push(definition) })
        },
      },
    }
    await mod.default.setup(ctx)

    const serve = added.find((tool) => tool.name === "skill_serve_review")
    await assert.rejects(
      serve.execute({
        workspace,
        port,
        skillName: "port-guard",
        allowPartial: true,
      }),
      /already in use/,
    )

    // The unrelated listener is still serving its own traffic.
    const response = await fetch(`http://127.0.0.1:${port}`)
    assert.equal(await response.text(), "blocker")
    assert.ok(blockerConnections > 0)
  } finally {
    await new Promise((resolve) => blocker.close(resolve))
    if (previousXdgConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME
    } else {
      process.env.XDG_CONFIG_HOME = previousXdgConfigHome
    }
    rmSync(tempHome, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// F-01: the published tarball must ship exactly the runtime assets and no
// sources, and the manifest must describe a source-matching build.
// ---------------------------------------------------------------------------

test("npm pack manifest ships runtime assets and excludes sources", () => {
  const output = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: pluginRoot,
    encoding: "utf-8",
  })
  const parsed = JSON.parse(output)
  // npm 11 returned an array; npm 12 returns an object keyed by package name.
  const manifest = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0]
  const files = manifest.files.map((entry) => entry.path)

  for (const required of [
    "dist/skill-creator.js",
    "dist/package.json",
    "dist/build-manifest.json",
    "dist/templates/viewer.html",
    "dist/skill/SKILL.md",
    "bin/opencode-skill-creator.js",
    "README.md",
  ]) {
    assert.equal(files.includes(required), true, `missing ${required}`)
  }

  assert.equal(files.some((path) => path.endsWith(".ts")), false, "ships no .ts")
  assert.equal(files.some((path) => path.includes("node_modules")), false)
  assert.equal(files.some((path) => path.includes(".codegraph")), false)
})

test("npm pack manifest excludes dist/package.json from leaking dev fields", () => {
  const distPackage = JSON.parse(
    readFileSync(fileURLToPath(new URL("../dist/package.json", import.meta.url)), "utf-8"),
  )
  assert.equal(distPackage.name, "opencode-skill-creator")
  assert.equal(distPackage.main, "./dist/skill-creator.js")
  assert.equal(typeof distPackage.peerDependencies["@opencode/plugin"], "string")
})

// ---------------------------------------------------------------------------
// G-01: the rebuilt dist must externalize the SDK runtimes instead of inlining
// them (the #43 defect), and must not carry any node_modules markers.
// ---------------------------------------------------------------------------

test("rebuilt dist externalizes the SDK packages instead of inlining them", () => {
  const source = readFileSync(distEntryPath, "utf-8")

  assert.doesNotMatch(source, /node_modules\/@opencode/)
  assert.doesNotMatch(source, /node_modules\/zod/)
  // The V1 SDK import stays a bare specifier for the runtime to resolve.
  assert.match(source, /from "@opencode-ai\/plugin"/)
})

test("build script uses the correct bun external flag form", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../scripts/build.mjs", import.meta.url)),
    "utf-8",
  )

  // `--external:<name>` is a silent no-op in bun; only `--external=<name>`
  // works for scoped packages.
  assert.doesNotMatch(source, /--external:/)
  assert.match(source, /--external=@opencode-ai\/plugin/)
  assert.match(source, /--external=@opencode\/plugin/)
})

// ---------------------------------------------------------------------------
// E-02: strict review preflight rejects an incomplete workspace and allows an
// explicit allowPartial override.
// ---------------------------------------------------------------------------

test("review preflight rejects an incomplete workspace unless allowPartial is set", async () => {
  const tempHome = mkdtempSync(join(tmpdir(), "osc-preflight-"))
  const workspace = join(tempHome, "workspace")
  const previousXdgConfigHome = process.env.XDG_CONFIG_HOME

  try {
    // eval-0/with_skill exists, but no baseline run and no run-* outputs.
    mkdirSync(join(workspace, "eval-0", "with_skill"), { recursive: true })
    process.env.XDG_CONFIG_HOME = tempHome

    const mod = await import(`${distEntryPath}?preflight=${Date.now()}`)
    const added = []
    const ctx = {
      skill: { list: async () => ({ data: [] }) },
      tool: {
        transform: async (callback) => {
          callback({ add: (definition) => added.push(definition) })
        },
      },
    }
    await mod.default.setup(ctx)

    const serve = added.find((tool) => tool.name === "skill_serve_review")
    await assert.rejects(
      serve.execute({ workspace, port: 0, skillName: "preflight", allowPartial: false }),
      /Strict review preflight failed/,
    )

    // allowPartial bypasses the strict gate and starts the server.
    const response = await serve.execute({
      workspace,
      port: 0,
      skillName: "preflight",
      allowPartial: true,
    })
    const result = JSON.parse(response.content)
    assert.equal(result.workflowGuard.allowPartial, true)
    assert.equal(typeof result.url, "string")

    const stop = added.find((tool) => tool.name === "skill_stop_review")
    await stop.execute({ workspace })
  } finally {
    if (previousXdgConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME
    } else {
      process.env.XDG_CONFIG_HOME = previousXdgConfigHome
    }
    rmSync(tempHome, { recursive: true, force: true })
  }
})