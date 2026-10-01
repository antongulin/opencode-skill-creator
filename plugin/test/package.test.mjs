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
import { tmpdir, homedir } from "node:os"
import { join, relative } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { execFileSync } from "node:child_process"
import { createServer } from "node:http"
import test from "node:test"

// Process-wide test isolation. `setup()`/`server()` run process startup side
// effects once per module load; force those to stay off the network, off the
// developer's real cache, and away from the developer's browser. `withPrivateHome`
// redirects the config/HOME writes per call.
const ISOLATION_ROOT = mkdtempSync(join(tmpdir(), "osc-isolation-"))
process.env.OPENCODE_SKILL_CREATOR_AUTO_UPDATE = "0"
// Never auto-open a browser from automated tests, even if a test forgets to
// pass openBrowser: false.
process.env.OPENCODE_SKILL_CREATOR_OPEN_BROWSER = "0"
process.env.XDG_CACHE_HOME = join(ISOLATION_ROOT, "cache")
process.on("exit", () => {
  rmSync(ISOLATION_ROOT, { recursive: true, force: true })
})

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

test("setup() and server() never write the real user config", async () => {
  // Snapshot the real home's opencode skill dir before running setup/server
  // under a private HOME, then assert it is byte-for-byte unchanged.
  const snapshotSkills = (root) => {
    if (!existsSync(root)) return null
    const hashes = {}
    for (const entry of readdirSync(root, { recursive: true }).sort()) {
      const full = join(root, entry)
      if (statSync(full).isFile()) {
        hashes[entry] = createHash("sha256").update(readFileSync(full)).digest("hex")
      }
    }
    return hashes
  }
  const realSkills = join(homedir(), ".config", "opencode", "skills")
  const before = snapshotSkills(realSkills)

  const mod = await import(`${distEntryPath}?isolation=${Date.now()}`)
  const added = []
  await withPrivateHome(async () => {
    await mod.default.setup(recordingCtx(added))
  })
  await withPrivateHome(async () => {
    await mod.default.server({})
  })

  // The developer's real config must be untouched: the install target is
  // derived from HOME/XDG_CONFIG_HOME, which withPrivateHome redirects.
  assert.deepEqual(snapshotSkills(realSkills), before, "real ~/.config/opencode/skills must be untouched")
  assert.equal(
    added.some((tool) => tool.name === "skill_validate"),
    true,
    "setup still registered tools under the private home",
  )
})

// V2 registers tools through `ctx.tool.transform`; record the added definitions
// from a real setup() call. The recording ctx is a wiring double only — the
// same surface is exercised against the real runtime in v2-runtime.test.mjs.
//
// `setup()` runs process startup side effects (bundled-skill install, auto
// update). Every call MUST run under a private HOME/XDG so the test never
// writes the developer's real `~/.config/opencode`. The helper sets and restores
// that environment around the setup call.
const HOME_KEYS = ["HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "USERPROFILE", "OPENCODE_SKILL_CREATOR_AUTO_UPDATE"]

function withPrivateHome(fn) {
  const tempHome = mkdtempSync(join(tmpdir(), "osc-private-home-"))
  const previous = {}
  for (const key of HOME_KEYS) previous[key] = process.env[key]
  process.env.HOME = tempHome
  process.env.USERPROFILE = tempHome
  process.env.XDG_CONFIG_HOME = join(tempHome, ".config")
  process.env.XDG_CACHE_HOME = join(tempHome, ".cache")
  // Disable the registry auto-update check: no network in unit tests.
  process.env.OPENCODE_SKILL_CREATOR_AUTO_UPDATE = "0"
  const restore = () => {
    for (const key of HOME_KEYS) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
    rmSync(tempHome, { recursive: true, force: true })
  }
  try {
    const result = fn(tempHome)
    if (result && typeof result.then === "function") {
      return result.finally(restore)
    }
    restore()
    return result
  } catch (error) {
    restore()
    throw error
  }
}

async function collectV2Tools(skillListData = [], locationDirectory = process.cwd()) {
  const mod = await import(pathToFileURL(distEntryPath).href)
  const added = []
  const ctx = {
    location: { directory: locationDirectory },
    skill: { list: async () => ({ data: skillListData }) },
    tool: {
      transform: async (callback) => {
        callback({ add: (definition) => added.push(definition) })
      },
    },
  }
  return withPrivateHome(async () => {
    const cleanup = await mod.default.setup(ctx)
    return { added, cleanup }
  })
}

/** Run a V2/V1 setup under a private HOME/XDG and return the cleanup. */
async function setupUnderPrivateHome(mod, ctx) {
  return withPrivateHome(async () => {
    const cleanup = await mod.default.setup(ctx)
    return cleanup
  })
}

function recordingCtx(added, { skillListData = [], locationDirectory = process.cwd() } = {}) {
  return {
    location: { directory: locationDirectory },
    skill: { list: async () => ({ data: skillListData }) },
    tool: {
      transform: async (callback) => {
        callback({ add: (definition) => added.push(definition) })
      },
    },
  }
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
  const hooks = await withPrivateHome(() => mod.default.server({}))
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

test("V2 setup rejects a context without a location directory", async () => {
  const mod = await import(pathToFileURL(distEntryPath).href)
  const added = []
  await assert.rejects(
    setupUnderPrivateHome(mod, {
      skill: { list: async () => ({ data: [] }) },
      tool: {
        transform: async (callback) => {
          callback({ add: (definition) => added.push(definition) })
        },
      },
    }),
    /no ctx\.location\.directory/,
  )
})

test("two V2 locations keep independent enumerators, roots and review servers", async () => {
  const root = mkdtempSync(join(tmpdir(), "osc-two-locations-"))
  const locA = join(root, "a")
  const locB = join(root, "b")
  mkdirSync(join(locA, ".opencode"), { recursive: true })
  mkdirSync(join(locB, ".opencode"), { recursive: true })

  const writeSkill = (dir, name) => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, "SKILL.md"),
      ["---", `name: ${name}`, "description: A fixture skill.", "---", "", "# Fixture", ""].join("\n"),
    )
  }
  writeSkill(join(locA, "alpha"), "alpha")
  writeSkill(join(locB, "alpha"), "alpha")
  const evalSetA = join(root, "eval-a.json")
  const evalSetB = join(root, "eval-b.json")
  for (const path of [evalSetA, evalSetB]) {
    writeFileSync(path, JSON.stringify([{ query: "use alpha", should_trigger: true }]))
  }

  // Each ctx records the skill-list input so we can prove the enumerator is
  // scoped to its own instance's project root.
  const makeCtx = (added, location) => ({
    location: { directory: location },
    skill: {
      list: async (input) => {
        const requested = input?.location?.directory
        if (requested !== location) {
          return { data: [{ name: "alpha", path: `${requested}/alpha` }] }
        }
        return { data: [{ name: "alpha", path: `${location}/alpha` }] }
      },
    },
    tool: {
      transform: async (callback) => {
        callback({ add: (definition) => added.push(definition) })
      },
    },
  })

  const mod = await import(`${distEntryPath}?two-loc=${Date.now()}`)
  const addedA = []
  const addedB = []
  const cleanupA = await setupUnderPrivateHome(mod, makeCtx(addedA, locA))
  const cleanupB = await setupUnderPrivateHome(mod, makeCtx(addedB, locB))

  const evalA = addedA.find((tool) => tool.name === "skill_eval")
  const evalB = addedB.find((tool) => tool.name === "skill_eval")

  // Each instance's skill_eval enumerates against its OWN location; the second
  // setup() must not have overwritten the first instance's enumerator.
  await assert.rejects(
    evalA.execute({ evalSetPath: evalSetA, skillPath: join(locA, "alpha") }),
    new RegExp(`${locA}/alpha`),
  )
  await assert.rejects(
    evalB.execute({ evalSetPath: evalSetB, skillPath: join(locB, "alpha") }),
    new RegExp(`${locB}/alpha`),
  )

  // Server ownership: A starts a review server; B's cleanup must not close it.
  const workspace = join(root, "workspace")
  mkdirSync(join(workspace, "eval-0", "with_skill", "outputs"), { recursive: true })
  writeFileSync(
    join(workspace, "eval-0", "eval_metadata.json"),
    `${JSON.stringify({ eval_id: 0, prompt: "Review" })}\n`,
  )
  writeFileSync(join(workspace, "eval-0", "with_skill", "outputs", "result.txt"), "ok\n")

  const serveA = addedA.find((tool) => tool.name === "skill_serve_review")
  const startedA = JSON.parse(
    (await serveA.execute({ workspace, port: 0, skillName: "owned-by-a", allowPartial: true, openBrowser: false }))
      .content,
  )

  await cleanupB()

  // A's server is still serving after B's cleanup.
  assert.equal((await fetch(startedA.url)).status, 200, "B cleanup must not close A server")

  await cleanupA()
  await assert.rejects(fetch(startedA.url), "A cleanup closes A server")

  rmSync(root, { recursive: true, force: true })
})

test("V1 and V2 tool execution return equivalent payloads", async () => {
  const mod = await import(pathToFileURL(distEntryPath).href)
  const hooks = await withPrivateHome(() => mod.default.server({}))
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

  try {
    mkdirSync(join(workspace, "eval-0", "with_skill", "outputs"), { recursive: true })
    writeFileSync(
      join(workspace, "eval-0", "eval_metadata.json"),
      `${JSON.stringify({ eval_id: 0, prompt: "Review" })}\n`,
    )
    writeFileSync(join(workspace, "eval-0", "with_skill", "outputs", "result.txt"), "ok\n")

    const mod = await import(`${distEntryPath}?v2-cleanup=${Date.now()}`)
    const added = []
    const cleanup = await setupUnderPrivateHome(
      mod,
      recordingCtx(added, { locationDirectory: workspace }),
    )

    const serve = added.find((tool) => tool.name === "skill_serve_review")
    const response = await serve.execute({
      workspace,
      port: 0,
      skillName: "cleanup-skill",
      allowPartial: true,
      openBrowser: false,
    })
    const result = JSON.parse(response.content)

    // Server is live before cleanup.
    assert.equal((await fetch(result.url)).status, 200)

    await cleanup()

    await assert.rejects(fetch(result.url), "server should be closed after cleanup")
  } finally {
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
        openBrowser: false,
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
        openBrowser: false,
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

    const mod = await import(`${distEntryPath}?port-guard=${Date.now()}`)
    const added = []
    await setupUnderPrivateHome(mod, recordingCtx(added, { locationDirectory: workspace }))

    const serve = added.find((tool) => tool.name === "skill_serve_review")
    await assert.rejects(
      serve.execute({
        workspace,
        port,
        skillName: "port-guard",
        allowPartial: true,
        openBrowser: false,
      }),
      /already in use/,
    )

    // The unrelated listener is still serving its own traffic.
    const response = await fetch(`http://127.0.0.1:${port}`)
    assert.equal(await response.text(), "blocker")
    assert.ok(blockerConnections > 0)
  } finally {
    await new Promise((resolve) => blocker.close(resolve))
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

  try {
    // eval-0/with_skill exists, but no baseline run and no run-* outputs.
    mkdirSync(join(workspace, "eval-0", "with_skill"), { recursive: true })

    const mod = await import(`${distEntryPath}?preflight=${Date.now()}`)
    const added = []
    await setupUnderPrivateHome(mod, recordingCtx(added, { locationDirectory: workspace }))

    const serve = added.find((tool) => tool.name === "skill_serve_review")
    await assert.rejects(
      serve.execute({ workspace, port: 0, skillName: "preflight", allowPartial: false, openBrowser: false }),
      /Strict review preflight failed/,
    )

    // allowPartial bypasses the strict gate and starts the server.
    const response = await serve.execute({
      workspace,
      port: 0,
      skillName: "preflight",
      allowPartial: true,
      openBrowser: false,
    })
    const result = JSON.parse(response.content)
    assert.equal(result.workflowGuard.allowPartial, true)
    assert.equal(typeof result.url, "string")

    const stop = added.find((tool) => tool.name === "skill_stop_review")
    await stop.execute({ workspace })
  } finally {
    rmSync(tempHome, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// LD1 / LD3: real executor boundary. These drive the built tools with a real
// `opencode` stub on PATH (no LLM) to prove (a) the loop and eval both select
// the instance project root, never the caller cwd, and (b) a V2 `context.signal`
// and a V1 `context.abort` both cancel the running child.
// ---------------------------------------------------------------------------

/** A real `opencode` stub that records its cwd/skill into a trace file. */
function writeFakeOpencode(binDir, { sleep = false, kind = "eval" } = {}) {
  mkdirSync(binDir, { recursive: true })
  const fake = `#!/usr/bin/env node
const fs = require("fs")
const path = require("path")
const argv = process.argv.slice(2)
// The V1 conflict guard enumerates with \`opencode debug skill\`; answer it
// immediately so only the actual run child is the one under test.
if (argv.includes("debug") && argv.includes("skill")) {
  process.stdout.write("[]\\n")
  process.exit(0)
}
const cwd = process.cwd()
let marker = null
try { marker = fs.readFileSync(path.join(cwd, ".opencode", "probe-marker.txt"), "utf8") } catch {}
let skillName = "unknown"
try {
  const names = fs.readdirSync(path.join(cwd, ".opencode", "skills"))
  if (names.length) skillName = names[0]
} catch {}
if (process.env.SKC_TRACE) {
  fs.writeFileSync(process.env.SKC_TRACE, JSON.stringify({ pid: process.pid, cwd, marker, directConfig: fs.existsSync(path.join(cwd, "opencode.jsonc")) }))
}
const kind = ${JSON.stringify(kind)}
if (${sleep ? "true" : "false"}) {
  process.on("SIGTERM", () => {})
  setInterval(() => {}, 1000)
} else if (kind === "improve") {
  process.stdout.write(JSON.stringify({ type: "text", part: { text: "<new_description>A cancellation fixture description.</new_description>" } }) + "\\n")
  process.exit(0)
} else {
  process.stdout.write(JSON.stringify({ type: "tool_use", part: { tool: "read", input: { path: skillName + "/SKILL.md" } } }) + "\\n")
  process.exit(0)
}
`
  const fakePath = join(binDir, "opencode")
  writeFileSync(fakePath, fake)
  chmodSync(fakePath, 0o755)
  return fakePath
}

function writeProbeProject(dir, label) {
  mkdirSync(join(dir, ".opencode", "skills"), { recursive: true })
  writeFileSync(join(dir, ".opencode", "probe-marker.txt"), label)
  writeFileSync(join(dir, "opencode.jsonc"), JSON.stringify({ instructions: ["./local-rules.md"] }))
  writeFileSync(join(dir, "local-rules.md"), `${label} rules\n`)
}

function writeFixtureSkill(dir, name) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, "SKILL.md"),
    ["---", `name: ${name}`, "description: A controlled boundary fixture.", "---", "", "# Fixture", ""].join("\n"),
  )
}

test("skill_optimize_loop evaluates the instance root, not the caller cwd", async () => {
  const root = mkdtempSync(join(tmpdir(), "osc-loop-root-"))
  const target = join(root, "target")
  const caller = join(root, "caller")
  const binDir = join(root, "bin")
  const trace = join(root, "loop-trace.json")
  const previousPath = process.env.PATH
  const previousTrace = process.env.SKC_TRACE
  const previousCwd = process.cwd()
  let pluginCleanup = null

  try {
    writeProbeProject(target, "target")
    writeProbeProject(caller, "caller")
    writeFakeOpencode(binDir)
    writeFixtureSkill(join(root, "candidate"), "loop-demo")
    const evalSetPath = join(root, "eval.json")
    writeFileSync(evalSetPath, JSON.stringify([{ query: "controlled fixture", should_trigger: true }]))

    process.env.PATH = `${binDir}:${previousPath ?? ""}`
    process.env.SKC_TRACE = trace
    process.chdir(caller)

    const mod = await import(`${distEntryPath}?loop-root=${Date.now()}`)
    const added = []
    pluginCleanup = await setupUnderPrivateHome(mod, recordingCtx(added, { locationDirectory: target }))

    // LD1-2: skill_eval already selected the instance root; lock that in.
    const evalTrace = join(root, "eval-trace.json")
    process.env.SKC_TRACE = evalTrace
    const evalTool = added.find((tool) => tool.name === "skill_eval")
    await evalTool.execute(
      {
        evalSetPath,
        skillPath: join(root, "candidate"),
        numWorkers: 1,
        runsPerQuery: 1,
        timeout: 5,
        model: "fixture/model",
      },
      { signal: new AbortController().signal },
    )
    assert.equal(JSON.parse(readFileSync(evalTrace, "utf-8")).marker, "target")

    // LD1-1: the optimize loop must also evaluate the instance root.
    process.env.SKC_TRACE = trace
    const loop = added.find((tool) => tool.name === "skill_optimize_loop")
    // maxIterations 1 with a passing train set exits after the first eval, so no
    // improvement child runs.
    await loop.execute(
      {
        evalSetPath,
        skillPath: join(root, "candidate"),
        numWorkers: 1,
        runsPerQuery: 1,
        timeout: 5,
        maxIterations: 1,
        holdout: 0,
        model: "fixture/model",
      },
      { signal: new AbortController().signal },
    )

    // The child ran in the synthetic eval root, but its .opencode marker must be
    // the TARGET's, proving the loop evaluated the instance root.
    const recorded = JSON.parse(readFileSync(trace, "utf-8"))
    assert.equal(recorded.marker, "target")
  } finally {
    if (pluginCleanup) await pluginCleanup()
    process.chdir(previousCwd)
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    if (previousTrace === undefined) delete process.env.SKC_TRACE
    else process.env.SKC_TRACE = previousTrace
    rmSync(root, { recursive: true, force: true })
  }
})

/** Assert a PID is gone; kill only that owned PID as a last resort. */
function ensureDead(pid) {
  const alive = () => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }
  if (alive()) {
    try {
      process.kill(pid, "SIGKILL")
    } catch {
      /* already gone */
    }
  }
  return alive()
}

/**
 * Run a cancellation scenario for one V2 entrypoint shape. The executor is
 * invoked with a real abortable context and a real sleeping `opencode` child;
 * on abort the call must reject with an AbortError and the owned child must die.
 * `cleanup` from `def.setup()` is always awaited in `finally`, and only the
 * owned child PID is ever killed.
 */
async function runCancelScenario({ toolName, kind, contextKey, mode = "v2", extraArgs = {} }) {
  const root = mkdtempSync(join(tmpdir(), `osc-cancel-${toolName}-`))
  const target = join(root, "target")
  const binDir = join(root, "bin")
  const trace = join(root, "cancel-trace.json")
  const previousPath = process.env.PATH
  const previousTrace = process.env.SKC_TRACE
  const controller = new AbortController()
  let childPid = null
  let pending = null

  try {
    writeProbeProject(target, "target")
    writeFakeOpencode(binDir, { sleep: true, kind })
    writeFixtureSkill(join(root, "candidate"), "cancel-demo")
    const evalSetPath = join(root, "eval.json")
    writeFileSync(evalSetPath, JSON.stringify([{ query: "controlled fixture", should_trigger: true }]))
    // A minimal eval-results document for the improve-description executor.
    const evalResultsPath = join(root, "eval-results.json")
    writeFileSync(
      evalResultsPath,
      JSON.stringify({
        skill_name: "cancel-demo",
        description: "A cancellation fixture.",
        results: [{ query: "controlled fixture", should_trigger: true, trigger_rate: 0, triggers: 0, runs: 1, successful_runs: 1, errors: 0, pass: false }],
        warnings: [],
        summary: { total: 1, passed: 0, failed: 1, run_errors: 0, queries_with_errors: 0 },
      }),
    )

    process.env.PATH = `${binDir}:${previousPath ?? ""}`
    process.env.SKC_TRACE = trace

    const mod = await import(`${distEntryPath}?cancel-${toolName}-${mode}-${Date.now()}`)

    // Resolve the executor through the requested entrypoint so the context shape
    // is exercised on the real surface: V2 `setup()` editor-added tools, or the
    // legacy V1 `server()` hooks.
    let execTool
    let cleanup = async () => {}
    if (mode === "v1") {
      const hooks = await withPrivateHome(() => mod.default.server({}))
      execTool = hooks.tool[toolName]
    } else {
      const added = []
      cleanup = await setupUnderPrivateHome(mod, recordingCtx(added, { locationDirectory: target }))
      execTool = added.find((tool) => tool.name === toolName)
    }

    try {
      const args = { skillPath: join(root, "candidate"), ...extraArgs }
      if (toolName !== "skill_improve_description") {
        args.evalSetPath = evalSetPath
        args.numWorkers = 1
        args.runsPerQuery = 1
        args.timeout = 60
      } else {
        args.evalResultsPath = evalResultsPath
      }
      pending = execTool.execute(args, { [contextKey]: controller.signal })

      const deadline = Date.now() + 5_000
      while (!existsSync(trace) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      assert.equal(existsSync(trace), true, `${toolName}/${mode}/${contextKey} child started`)
      childPid = JSON.parse(readFileSync(trace, "utf-8")).pid

      controller.abort()
      let caught = null
      try {
        await pending
      } catch (error) {
        caught = error
      }
      pending = null
      assert.equal(caught !== null && caught.name === "AbortError", true, `${toolName}/${mode} aborts explicitly`)
      assert.equal(ensureDead(childPid), false, `${toolName}/${mode} kills the running child`)
    } finally {
      // Always abort and drain the pending call so a failed assertion cannot
      // leave the 60 s child or the plugin instance behind.
      controller.abort()
      if (pending) {
        try {
          await pending
        } catch {
          /* expected AbortError */
        }
      }
      if (childPid !== null) ensureDead(childPid)
      await cleanup()
    }
  } finally {
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    if (previousTrace === undefined) delete process.env.SKC_TRACE
    else process.env.SKC_TRACE = previousTrace
    rmSync(root, { recursive: true, force: true })
  }
}

test("V2 context.signal cancels a real eval child", async () => {
  await runCancelScenario({ toolName: "skill_eval", kind: "eval", contextKey: "signal" })
})

test("V1 server() context.abort cancels a real eval child", async () => {
  await runCancelScenario({ toolName: "skill_eval", kind: "eval", contextKey: "abort", mode: "v1" })
})

test("V2 context.signal cancels a real optimize-loop eval child", async () => {
  await runCancelScenario({
    toolName: "skill_optimize_loop",
    kind: "eval",
    contextKey: "signal",
    extraArgs: { maxIterations: 2, holdout: 0 },
  })
})

test("V2 context.signal cancels a real improve-description child", async () => {
  await runCancelScenario({
    toolName: "skill_improve_description",
    kind: "improve",
    contextKey: "signal",
  })
})