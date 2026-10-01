import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

// H-02: prove the documented V1 floor (object entrypoint, OpenCode >= 1.18.29)
// actually loads the packaged plugin. The official V1 binary is provisioned
// out-of-band via `OPENCODE_V1_BIN`, because it is a ~150 MB platform binary.
// When it is not set the test skips rather than claiming unverified support.

const v1Bin = process.env.OPENCODE_V1_BIN
const skipReason = (() => {
  if (!v1Bin) return "set OPENCODE_V1_BIN to the OpenCode 1.18.29 binary"
  if (!existsSync(v1Bin)) return `OPENCODE_V1_BIN not found: ${v1Bin}`
  return false
})()

test(
  "packaged plugin loads in the documented OpenCode V1 floor (>= 1.18.29)",
  { skip: skipReason },
  () => {
    // A prebuilt tarball installed by the caller into a wrapper directory keeps
    // this test fast; OPENCODE_V1_PROJECT points at that wrapper dir.
    const wrapper = process.env.OPENCODE_V1_PROJECT
    if (!wrapper || !existsSync(wrapper)) {
      assert.fail("set OPENCODE_V1_PROJECT to a dir with the installed tarball + @opencode-ai/plugin")
    }

    const iso = mkdtempSync(join(tmpdir(), "skc-v1-floor-"))
    const home = join(iso, "home")
    const config = join(iso, "config", "opencode")
    const project = join(iso, "project")
    for (const dir of [home, config, project]) mkdirSync(dir, { recursive: true })

    // Point V1 at the installed package directory so its object entrypoint is
    // the module OpenCode loads. The wrapper's node_modules also holds
    // @opencode-ai/plugin, so the externalized import resolves.
    const packageDir = join(wrapper, "node_modules", "opencode-skill-creator")
    if (!existsSync(packageDir)) {
      assert.fail(`no installed package under ${packageDir}`)
    }

    try {
      // V1 uses the singular "plugin" key and the object entrypoint's server().
      writeFileSync(
        join(config, "opencode.json"),
        JSON.stringify(
          { $schema: "https://opencode.ai/config.json", plugin: [packageDir] },
          null,
          2,
        ),
      )

      const env = {
        PATH: process.env.PATH ?? "",
        HOME: home,
        XDG_CONFIG_HOME: join(iso, "config"),
        XDG_DATA_HOME: join(iso, "data"),
        XDG_CACHE_HOME: join(iso, "cache"),
        XDG_STATE_HOME: join(iso, "state"),
      }

      // `debug skill` boots the plugin and lists skills; the bundled skill is
      // only installed when the plugin's server() ran.
      const output = execFileSync(v1Bin, ["debug", "skill"], {
        cwd: project,
        env,
        encoding: "utf-8",
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
      })
      const skills = JSON.parse(output)
      assert.equal(
        skills.some((skill) => skill.name === "opencode-skill-creator"),
        true,
        "bundled skill was installed by the V1 entrypoint",
      )
    } finally {
      rmSync(iso, { recursive: true, force: true })
    }
  },
)

// ---------------------------------------------------------------------------
// Runtime floor: the published artifact must not just import on the promised
// `engines.node >= 18` floor — it must actually RUN there. A static
// `fs.globSync` import (Node 22+) once crashed the plugin on Node 18/20 before
// any tool ran, and a source-syntax scan of the bundle cannot prove runtime
// behavior. So this test provisions a real Node 18 binary as an optional test
// fixture (`SKC_NODE_FLOOR_BIN`, or — only when the caller opts in via
// SKC_NODE_FLOOR_FIXTURE pointing at a prepared `node-bin-darwin-arm64`-style
// tarball — extracted into the approved temp fixture area), packs the plugin,
// installs the tarball into a private consumer directory, and has the floor
// Node itself execute real tool behavior (setup() + skill_parse +
// skill_validate with meaningful outputs). Skips honestly when no floor
// binary is available: an unprovisioned floor is never claimed as tested.
// ---------------------------------------------------------------------------

function floorNodeBin() {
  const explicit = process.env.SKC_NODE_FLOOR_BIN
  if (explicit) {
    return existsSync(explicit) ? { bin: explicit, source: "SKC_NODE_FLOOR_BIN" } : null
  }
  const fixtureTgz = process.env.SKC_NODE_FLOOR_FIXTURE
  if (!fixtureTgz || !existsSync(fixtureTgz)) return null
  // Extract into the approved shared temp area, reusing an existing extracted
  // fixture when present. Test-only provisioning: never installed globally,
  // never added to any manifest, and cleaned up with the temp area.
  const fixtureDir = join(tmpdir(), "skc-node18-fixture")
  const bin = join(fixtureDir, "package", "bin", "node")
  if (existsSync(bin)) return { bin, source: `fixture ${fixtureTgz}` }
  try {
    execFileSync("tar", ["xzf", fixtureTgz, "package/bin/node"], { cwd: fixtureDir })
    return { bin, source: `fixture ${fixtureTgz}` }
  } catch {
    return null
  }
}

test("built artifact runs real tool behavior on the promised Node floor (>= 18)", async () => {
  const floor = floorNodeBin()
  const currentMajor = Number(process.versions.node.split(".")[0])
  if (!floor) {
    test.skip(
      `no Node floor binary provisioned (set SKC_NODE_FLOOR_BIN or SKC_NODE_FLOOR_FIXTURE); current node is ${process.version}`,
    )
    return
  }

  const floorVersion = execFileSync(floor.bin, ["-v"], { encoding: "utf-8" }).trim()
  const floorMajor = Number(floorVersion.slice(1).split(".")[0])
  assert.ok(
    floorMajor < currentMajor,
    `floor binary ${floorVersion} must be older than the dev Node ${process.version} to prove the floor`,
  )
  assert.ok(floorMajor >= 18, `floor binary must be the promised Node >= 18 floor, got ${floorVersion}`)

  // Pack the real artifact and install it into a private consumer directory
  // so the floor Node resolves the plugin exactly like a real consumer (no
  // source-workspace rescue, externalized deps intact).
  const pluginRoot = fileURLToPath(new URL("..", import.meta.url))
  const iso = mkdtempSync(join(tmpdir(), "skc-node-floor-"))
  const consumerDir = join(iso, "consumer")
  const project = join(iso, "project")
  const fixtureSkill = join(iso, "fixture-skill")
  const markerPath = join(iso, "marker.json")
  try {
    mkdirSync(consumerDir, { recursive: true })
    mkdirSync(project, { recursive: true })
    mkdirSync(fixtureSkill, { recursive: true })
    writeFileSync(
      join(fixtureSkill, "SKILL.md"),
      ["---", "name: floor-fixture", "description: A fixture skill parsed by the floor Node.", "---", "", "# Floor fixture", ""].join("\n"),
    )
    // Pack into this test's own temp directory so concurrent test files
    // (which also pack for their runtime proofs) never race on one tarball
    // path inside the plugin directory.
    const packDest = join(iso, "pack")
    mkdirSync(packDest, { recursive: true })
    const tarball = execFileSync(
      "npm",
      ["pack", "--silent", "--ignore-scripts", `--pack-destination=${packDest}`],
      {
        cwd: pluginRoot,
        encoding: "utf-8",
      },
    )
      .trim()
      .split("\n")
      .pop()
    try {
      execFileSync("npm", ["init", "-y"], { cwd: consumerDir, stdio: "pipe" })
      execFileSync(
        "npm",
        ["install", "--ignore-scripts", join(packDest, tarball.trim()), "@opencode-ai/plugin@1.18.29"],
        { cwd: consumerDir, stdio: "pipe" },
      )
    } finally {
      rmSync(join(packDest, tarball.trim()), { force: true })
    }

    writeFileSync(
      join(consumerDir, "floor-behavior.mjs"),
      `
import { mkdirSync, writeFileSync } from "node:fs"
import def from "opencode-skill-creator"

const markerPath = ${JSON.stringify(markerPath)}
const fixtureSkill = ${JSON.stringify(fixtureSkill)}
const marker = { steps: [], parse: null, validate: null, error: null }
try {
  const added = []
  const ctx = {
    location: { directory: ${JSON.stringify(project)} },
    skill: { list: async () => ({ data: [] }) },
    tool: {
      transform: async (callback) => {
        callback({ add: (definition) => added.push(definition) })
      },
    },
  }
  // Private HOME/XDG are inherited from the spawning test process, so the
  // bundled-skill install lands inside the isolated environment.
  process.env.OPENCODE_SKILL_CREATOR_AUTO_UPDATE = "0"

  // 1. real setup(): tool registration path (the code path that historically
  //    crashed at import/exec time on Node 18/20).
  const cleanup = await def.setup(ctx)
  marker.registered = added.map((tool) => tool.name).sort()

  // 2. real executor behavior: parse and validate produce meaningful output.
  const context = { signal: new AbortController().signal, progress: async () => {} }
  const byName = new Map(added.map((tool) => [tool.name, tool]))
  marker.parse = JSON.parse((await byName.get("skill_parse").execute({ skillPath: fixtureSkill }, context)).content)
  marker.validate = JSON.parse((await byName.get("skill_validate").execute({ skillPath: fixtureSkill }, context)).content)

  marker.steps.push("setup", "parse", "validate")
  if (cleanup) await cleanup()
} catch (error) {
  marker.error = String(error && error.stack ? error.stack : error)
} finally {
  writeFileSync(markerPath, JSON.stringify(marker))
}
`,
    )

    const result = execFileSync(
      floor.bin,
      [join(consumerDir, "floor-behavior.mjs")],
      {
        cwd: consumerDir,
        env: {
          PATH: process.env.PATH ?? "",
          HOME: iso,
          XDG_CONFIG_HOME: join(iso, "config"),
          XDG_CACHE_HOME: join(iso, "cache"),
          OPENCODE_SKILL_CREATOR_AUTO_UPDATE: "0",
        },
        encoding: "utf-8",
        timeout: 120_000,
      },
    )
    void result

    const marker = JSON.parse(readFileSync(markerPath, "utf-8"))
    assert.equal(marker.error, null, `floor Node behavior error: ${marker.error}`)
    assert.equal(marker.parse.name, "floor-fixture")
    assert.equal(marker.validate.valid, true)
    assert.equal(
      marker.registered.includes("skill_validate"),
      true,
      "setup() registered the tools on the floor Node",
    )
    assert.deepEqual(marker.steps, ["setup", "parse", "validate"])
  } finally {
    rmSync(iso, { recursive: true, force: true })
  }
})
