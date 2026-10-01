import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
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
// behavior. When the caller pre-provisions a real floor Node binary via
// SKC_NODE_FLOOR_BIN (test fixture, provisioned outside the tests), this test
// packs the plugin, npm-installs the tarball into a private consumer
// directory, and has the floor Node itself execute real tool behavior
// (setup() + skill_parse + skill_validate with meaningful outputs). Skips
// honestly when no floor binary is provided: an unprovisioned floor is never
// claimed as tested.
// ---------------------------------------------------------------------------

test("built artifact runs real tool behavior on the promised Node floor (>= 18)", async (t) => {
  const floorBin = process.env.SKC_NODE_FLOOR_BIN
  if (!floorBin) {
    t.skip(`no Node floor binary provisioned (set SKC_NODE_FLOOR_BIN); current node is ${process.version}`)
    return
  }
  if (!existsSync(floorBin)) {
    assert.fail(`SKC_NODE_FLOOR_BIN does not exist: ${floorBin}`)
  }

  const floorVersion = execFileSync(floorBin, ["-v"], { encoding: "utf-8" }).trim()
  const floorMajor = Number(floorVersion.replace(/^v/, "").split(".")[0])
  // The promised floor IS Node 18; a binary older or newer than it does not
  // prove the documented engine floor. Prove the actual 18 floor.
  assert.equal(
    floorMajor,
    18,
    `SKC_NODE_FLOOR_BIN must be a Node 18 binary (the promised engines.node floor), got ${floorVersion}`,
  )

  // Pack the real artifact and install it into a private consumer directory
  // so the floor Node resolves the plugin exactly like a real consumer (no
  // source-workspace rescue, externalized deps intact).
  const pluginRoot = fileURLToPath(new URL("..", import.meta.url))
  const iso = mkdtempSync(join(tmpdir(), "skc-node-floor-"))
  const consumerDir = join(iso, "consumer")
  const project = join(iso, "project")
  const fixtureSkill = join(iso, "fixture-skill")
  const crlfFixtureSkill = join(iso, "crlf-fixture-skill")
  const crlfInvalidFixtureSkill = join(iso, "crlf-invalid-fixture-skill")
  const reviewWorkspace = join(iso, "review-workspace")
  const markerPath = join(iso, "marker.json")
  try {
    mkdirSync(consumerDir, { recursive: true })
    mkdirSync(project, { recursive: true })
    mkdirSync(fixtureSkill, { recursive: true })
    mkdirSync(crlfFixtureSkill, { recursive: true })
    mkdirSync(crlfInvalidFixtureSkill, { recursive: true })
    mkdirSync(join(reviewWorkspace, "eval-0", "with_skill", "outputs"), { recursive: true })
    writeFileSync(
      join(reviewWorkspace, "eval-0", "eval_metadata.json"),
      `${JSON.stringify({ eval_id: 0, prompt: "Review" })}\n`,
    )
    writeFileSync(join(reviewWorkspace, "eval-0", "with_skill", "outputs", "result.txt"), "ok\n")
    writeFileSync(
      join(fixtureSkill, "SKILL.md"),
      ["---", "name: floor-fixture", "description: A fixture skill parsed by the floor Node.", "---", "", "# Floor fixture", ""].join("\n"),
    )
    // Full-CRLF fixtures (delimiters included): the CRLF-tolerant validator path
    // must work on the real Node 18 floor, and keep its line-3 diagnostic.
    writeFileSync(
      join(crlfFixtureSkill, "SKILL.md"),
      ["---", "name: floor-crlf", 'description: "CRLF: a quoted value."', "---", "", "# Floor CRLF", ""].join("\r\n"),
    )
    writeFileSync(
      join(crlfInvalidFixtureSkill, "SKILL.md"),
      ["---", "name: floor-crlf-bad", "description: A value with: an unquoted colon.", "---", "", "# Floor CRLF bad", ""].join("\r\n"),
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
import { createServer } from "node:net"
import { get as httpGet } from "node:http"
import def from "opencode-skill-creator"

const markerPath = ${JSON.stringify(markerPath)}
const fixtureSkill = ${JSON.stringify(fixtureSkill)}
const crlfFixtureSkill = ${JSON.stringify(crlfFixtureSkill)}
const crlfInvalidFixtureSkill = ${JSON.stringify(crlfInvalidFixtureSkill)}
const reviewWorkspace = ${JSON.stringify(reviewWorkspace)}
const marker = { steps: [], parse: null, validate: null, crlfValidate: null, crlfInvalidValidate: null, v1HooksDispose: null, v1Http200: null, v1PortRebindable: null, cleanupError: null, error: null }

// Owned resources are tracked outside the try so the finally ALWAYS releases
// whatever this probe created, even when it fails before dispose.
let v2Cleanup = null
let v1Hooks = null

// Real HTTP status through the built-in core client (no global fetch, no
// undici keep-alive dispatcher): a one-off agent plus Connection: close and a
// drained response leave no live socket behind.
function httpStatus(url) {
  return new Promise((resolve, reject) => {
    const req = httpGet(url, { agent: false, headers: { connection: "close" } }, (res) => {
      res.resume()
      res.on("end", () => resolve(res.statusCode))
      res.on("error", reject)
    })
    req.setTimeout(10000, () => {
      req.destroy(new Error("floor probe HTTP request timed out"))
    })
    req.on("error", reject)
  })
}

function recordCleanupError(label, error) {
  const text = label + ": " + String(error && error.stack ? error.stack : error)
  marker.cleanupError = marker.cleanupError ? marker.cleanupError + "\\n" + text : text
}

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
  v2Cleanup = await def.setup(ctx)
  marker.registered = added.map((tool) => tool.name).sort()

  // 2. real executor behavior: parse and validate produce meaningful output.
  const context = { signal: new AbortController().signal, progress: async () => {} }
  const byName = new Map(added.map((tool) => [tool.name, tool]))
  marker.parse = JSON.parse((await byName.get("skill_parse").execute({ skillPath: fixtureSkill }, context)).content)
  marker.validate = JSON.parse((await byName.get("skill_validate").execute({ skillPath: fixtureSkill }, context)).content)
  // Full-CRLF on the real floor: valid stays valid, and the invalid path keeps
  // its actionable line-3 diagnostic.
  marker.crlfValidate = JSON.parse((await byName.get("skill_validate").execute({ skillPath: crlfFixtureSkill }, context)).content)
  marker.crlfInvalidValidate = JSON.parse((await byName.get("skill_validate").execute({ skillPath: crlfInvalidFixtureSkill }, context)).content)

  marker.steps.push("setup", "parse", "validate")
  if (v2Cleanup) await v2Cleanup()

  // 3. V1 dispose on the real floor: the V1 hooks expose dispose, and a review
  //    server this instance started releases its port after dispose (real
  //    sockets, not a registration-only claim). The V1 floor binary loads the
  //    object entrypoint via server().
  v1Hooks = await def.server({})
  marker.v1HooksDispose = typeof v1Hooks.dispose === "function"
  const started = JSON.parse(await v1Hooks.tool.skill_serve_review.execute({
    workspace: reviewWorkspace, port: 0, allowPartial: true, openBrowser: false,
  }))
  const port = Number(new URL(started.url).port)
  // The listener binds 127.0.0.1; use the literal address because Node 18 does
  // not fall back from a ::1 localhost resolution here.
  marker.v1Http200 = (await httpStatus("http://127.0.0.1:" + port + "/")) === 200
  await v1Hooks.dispose()
  marker.v1PortRebindable = await new Promise((resolve) => {
    const probe = createServer()
    probe.once("error", () => resolve(false))
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)))
  })
} catch (error) {
  marker.error = String(error && error.stack ? error.stack : error)
} finally {
  // Always release anything this probe created, through the existing tools.
  // A cleanup failure is recorded (and asserted by the parent test) rather than
  // hidden, and none of these hold the process open.
  if (v1Hooks) {
    try {
      await v1Hooks.tool.skill_stop_review.execute({ workspace: reviewWorkspace })
    } catch (error) {
      recordCleanupError("skill_stop_review", error)
    }
    try {
      await v1Hooks.dispose()
    } catch (error) {
      recordCleanupError("v1 dispose", error)
    }
  }
  if (v2Cleanup) {
    try {
      await v2Cleanup()
    } catch (error) {
      recordCleanupError("v2 cleanup", error)
    }
  }
  writeFileSync(markerPath, JSON.stringify(marker))
}
`,
    )

    // spawnSync captures the child's NATURAL exit status: no forced
    // process.exit in the probe, so status 0 proves the real Node 18 child
    // settled on its own after every owned client/server/probe closed. A hang
    // or an unhandled error surfaces as a non-zero status/timedOut.
    const result = spawnSync(
      floorBin,
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
    assert.equal(result.error ?? null, null, `floor child spawn error: ${result.error}`)
    assert.equal(result.signal, null, `floor child killed by signal ${result.signal}`)
    assert.equal(
      result.status,
      0,
      `floor child must exit 0 naturally (status=${result.status}, stderr=${result.stderr})`,
    )

    const marker = JSON.parse(readFileSync(markerPath, "utf-8"))
    assert.equal(marker.error, null, `floor Node behavior error: ${marker.error}`)
    assert.equal(
      marker.cleanupError,
      null,
      `floor probe cleanup must not fail: ${marker.cleanupError}`,
    )
    assert.equal(marker.parse.name, "floor-fixture")
    assert.equal(marker.validate.valid, true)
    assert.equal(
      marker.crlfValidate.valid,
      true,
      "full-CRLF skill validates on the Node 18 floor",
    )
    assert.equal(marker.crlfValidate.message, "Skill is valid!")
    assert.equal(marker.crlfInvalidValidate.valid, false)
    assert.match(marker.crlfInvalidValidate.message, /line 3/)
    assert.match(marker.crlfInvalidValidate.message, /Hint: quote the value/)
    assert.equal(
      marker.registered.includes("skill_validate"),
      true,
      "setup() registered the tools on the floor Node",
    )
    assert.deepEqual(marker.steps, ["setup", "parse", "validate"])
    // V1 dispose works on the real Node 18 floor: the hooks expose dispose and
    // a started review server's port is released afterwards.
    assert.equal(marker.v1HooksDispose, true, "V1 server() hooks expose dispose on the Node floor")
    assert.equal(marker.v1Http200, true, "V1 review server served HTTP 200 on the Node floor")
    assert.equal(marker.v1PortRebindable, true, "V1 dispose releases the review port on the Node floor")
  } finally {
    rmSync(iso, { recursive: true, force: true })
  }
})
