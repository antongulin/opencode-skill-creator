import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
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
// Runtime floor: the published artifact must be importable on the engine floor
// the package promises (`engines.node >= 18`), not just on the dev machine's
// Node. The correction that first mirrored root config used `fs.globSync`, which
// only exists on Node 22+, so importing the built plugin on Node 18/20 crashed
// before any tool ran. This loads the built artifact with an explicit
// `--no-experimental-*`-style plain import and fails if any imported binding is
// missing on the running engine.
// ---------------------------------------------------------------------------

const distEntry = new URL("../dist/skill-creator.js", import.meta.url)

test("built artifact imports on the promised Node floor (>= 18)", async () => {
  const mod = await import(distEntry.href)
  // If the module imported, every top-level binding it pulls from `fs` exists on
  // this Node runtime. Assert the real entrypoints are present.
  assert.equal(typeof mod.default, "object", "default export present")
  assert.equal(typeof mod.default.setup, "function", "V2 setup() present")
  assert.equal(typeof mod.default.server, "function", "V1 server() present")

  // Guard the specific regression: the built artifact must not statically import
  // Node's `globSync` (Node 22+ only) from `fs`. A static import crashes Node
  // 18/20 before any tool runs, so scan the whole artifact for the binding.
  const { readFileSync } = await import("node:fs")
  const builtSource = readFileSync(distEntry, "utf-8")
  assert.equal(
    /\bglobSync\b/.test(builtSource),
    false,
    "built artifact must not statically import fs.globSync (Node 22+ only)",
  )
})
