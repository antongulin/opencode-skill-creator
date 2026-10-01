import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

// Real-runtime integration proof for the #38/V2 work. These tests pack the
// plugin, install the tarball into a private wrapper directory, then load it in
// the real OpenCode V2 CLI under a private HOME/XDG. A wrapper plugin exercises
// the packaged tools inside setup(), so registration AND execution of the
// *delivered artifact* are proven against the real runtime.
//
// Skips when the OpenCode CLI is not installed. The bogus model selected for
// the run is irrelevant: plugin setup and tool registration happen at boot,
// before the model call fails.
//
// Note: the OpenCode plugin loader resolves imports relative to the plugin
// directory, so the tarball must be installed into the wrapper directory's own
// node_modules for a bare `import "opencode-skill-creator"` to resolve.

const pluginRoot = fileURLToPath(new URL("..", import.meta.url))

function resolveOpencode() {
  try {
    return execFileSync("which", ["opencode"], { encoding: "utf-8" }).trim()
  } catch {
    return null
  }
}

const opencodeBin = resolveOpencode()

/**
 * Provision an isolated V2 runtime with the packed plugin installed and return
 * the paths plus a run() that executes the real CLI and a marker reader.
 */
function provisionV2Runtime(prefix, wrapperSource, { binDir } = {}) {
  const iso = mkdtempSync(join(tmpdir(), prefix))
  const home = join(iso, "home")
  const config = join(iso, "config")
  const data = join(iso, "data")
  const cache = join(iso, "cache")
  const state = join(iso, "state")
  const project = join(iso, "project")
  const pluginDir = join(project, "plug")
  for (const dir of [home, config, data, cache, state, project, pluginDir]) {
    mkdirSync(dir, { recursive: true })
  }

  const tarball = execFileSync("npm", ["pack", "--silent", "--ignore-scripts"], {
    cwd: pluginRoot,
    encoding: "utf-8",
  })
    .trim()
    .split("\n")
    .pop()
  const tarballPath = join(pluginRoot, tarball)
  try {
    execFileSync("npm", ["init", "-y"], { cwd: pluginDir, stdio: "pipe" })
    execFileSync(
      "npm",
      ["install", tarballPath, "@opencode-ai/plugin@1.18.29"],
      { cwd: pluginDir, stdio: "pipe" },
    )
  } finally {
    rmSync(tarballPath, { force: true })
  }

  const installedEntry = join(
    pluginDir,
    "node_modules",
    "opencode-skill-creator",
    "dist",
    "skill-creator.js",
  )
  assert.equal(existsSync(installedEntry), true, "tarball ships dist entry")

  const markerPath = join(iso, "marker.json")
  const writeWrapper = (source) => {
    writeFileSync(join(pluginDir, "index.mjs"), source)
  }
  if (typeof wrapperSource === "function") {
    writeWrapper(wrapperSource({ iso, project, pluginDir, installedEntry, markerPath }))
  } else {
    writeWrapper(wrapperSource)
  }

  writeFileSync(
    join(project, "opencode.jsonc"),
    JSON.stringify(
      { $schema: "https://opencode.ai/config.json", plugins: [pluginDir] },
      null,
      2,
    ),
  )

  const env = {
    PATH: process.env.PATH ?? "",
    HOME: home,
    XDG_CONFIG_HOME: config,
    XDG_DATA_HOME: data,
    XDG_CACHE_HOME: cache,
    XDG_STATE_HOME: state,
  }
  if (binDir) {
    env.PATH = `${binDir}:${env.PATH}`
  }

  return {
    iso,
    project,
    pluginDir,
    installedEntry,
    markerPath,
    run() {
      try {
        execFileSync(
          opencodeBin,
          ["run", "--standalone", "--agent", "build", "-m", "nonexistent/model", "ping"],
          { cwd: project, env, stdio: "pipe", timeout: 180_000, maxBuffer: 10 * 1024 * 1024 },
        )
      } catch {
        // The bogus model fails the turn; plugin boot still ran. Marker
        // assertions are the source of truth.
      }
    },
    readMarker() {
      assert.equal(existsSync(markerPath), true, "wrapper setup() ran in the real runtime")
      return JSON.parse(readFileSync(markerPath, "utf-8"))
    },
    log() {
      const logPath = join(data, "opencode", "log", "opencode.log")
      return existsSync(logPath) ? readFileSync(logPath, "utf-8") : ""
    },
    cleanup() {
      rmSync(iso, { recursive: true, force: true })
    },
  }
}

test(
  "packaged plugin loads and runs its tools in the real OpenCode V2 runtime",
  { skip: opencodeBin ? false : "opencode CLI not installed" },
  () => {
    const runtime = provisionV2Runtime("skc-v2-runtime-", ({ iso, installedEntry, markerPath }) => {
      const fixtureSkill = join(iso, "fixture-skill")
      mkdirSync(fixtureSkill, { recursive: true })
      writeFileSync(
        join(fixtureSkill, "SKILL.md"),
        ["---", "name: fixture-skill", "description: A fixture skill for runtime proof.", "---", "", "# Fixture", ""].join("\n"),
      )
      return `
import { writeFileSync } from "node:fs"
import def from "opencode-skill-creator"

// Runtime-registered executors expect the runtime ToolContext (at minimum an
// AbortSignal); supply a minimal one since we invoke them directly.
const context = { signal: new AbortController().signal, progress: async () => {} }

export default {
  ...def,
  async setup(ctx) {
    const cleanup = await def.setup(ctx)
    const tools = new Map((await ctx.tool.list()).map((tool) => [tool.id, tool]))
    const registered = [...tools.keys()].filter((id) => String(id).startsWith("skill_")).sort()
    const parseResult = JSON.parse(
      (await tools.get("skill_parse").execute({ skillPath: ${JSON.stringify(fixtureSkill)} }, context)).content,
    )
    const validateResult = JSON.parse(
      (await tools.get("skill_validate").execute({ skillPath: ${JSON.stringify(fixtureSkill)} }, context)).content,
    )
    writeFileSync(
      ${JSON.stringify(markerPath)},
      JSON.stringify({ registered, parseName: parseResult.name, validateValid: validateResult.valid }),
    )
    return cleanup
  },
}
`
    })

    try {
      runtime.run()
      const marker = runtime.readMarker()
      assert.deepEqual(marker.registered, [
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
      ])
      assert.equal(marker.parseName, "fixture-skill")
      assert.equal(marker.validateValid, true)

      const log = runtime.log()
      assert.equal(/PluginModule\.LoadError/.test(log), false, "no LoadError")
      assert.match(log, /msg="loading plugin"/)
      assert.equal(/"failed to load plugin"/.test(log), false, "no plugin load failure")
    } finally {
      runtime.cleanup()
    }
  },
)

test(
  "D-02: V2 skill enumeration detects a real installed-skill conflict end to end",
  { skip: opencodeBin ? false : "opencode CLI not installed" },
  () => {
    const runtime = provisionV2Runtime("skc-v2-d02-", ({ iso, project, markerPath }) => {
      // A valid skill directory the eval targets.
      const skillDir = join(iso, "demo-skill")
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(
        join(skillDir, "SKILL.md"),
        ["---", "name: demo-skill", "description: A demo skill the eval targets.", "---", "", "# Demo", ""].join("\n"),
      )
      const evalSetPath = join(iso, "eval.json")
      writeFileSync(evalSetPath, JSON.stringify([{ query: "please use demo-skill", should_trigger: true }]))

      return `
import { writeFileSync } from "node:fs"
import def from "opencode-skill-creator"

const context = { signal: new AbortController().signal, progress: async () => {} }

export default {
  ...def,
  async setup(ctx) {
    const location = { location: { directory: ${JSON.stringify(project)} } }
    const before = (await ctx.skill.list(location)).data.map((skill) => skill.name)

    // Register an installed skill that collides with the eval target's base
    // name, exactly the hazard the conflict guard exists to catch.
    await ctx.skill.transform((editor) => {
      editor.add({
        id: "demo-skill",
        name: "demo-skill",
        description: "A pre-installed skill that would steal triggers.",
        path: ${JSON.stringify(join(iso, "demo-skill", "SKILL.md"))},
        content: "---\\nname: demo-skill\\ndescription: Pre-installed.\\n---\\n",
      })
    })
    const after = (await ctx.skill.list(location)).data.map((skill) => skill.name)

    const cleanup = await def.setup(ctx)
    const tools = new Map((await ctx.tool.list()).map((tool) => [tool.id, tool]))

    let evalError = null
    try {
      await tools.get("skill_eval").execute(
        { evalSetPath: ${JSON.stringify(evalSetPath)}, skillPath: ${JSON.stringify(skillDir)} },
        context,
      )
    } catch (error) {
      evalError = String(error && error.message ? error.message : error)
    }

    writeFileSync(
      ${JSON.stringify(markerPath)},
      JSON.stringify({ before, after, evalError }),
    )
    return cleanup
  },
}
`
    })

    try {
      runtime.run()
      const marker = runtime.readMarker()

      // The V2 skill API returns data with name + (path) for the location.
      assert.equal(marker.after.includes("demo-skill"), true, "V2 skill list includes the added skill")
      assert.equal(
        marker.evalError !== null &&
          /already available to opencode/.test(marker.evalError) &&
          /demo-skill/.test(marker.evalError),
        true,
        `skill_eval must abort on the real conflict, got: ${marker.evalError}`,
      )

      const log = runtime.log()
      assert.equal(/PluginModule\.LoadError/.test(log), false, "no LoadError")
    } finally {
      runtime.cleanup()
    }
  },
)

test(
  "D-02: clean state runs the eval against the isolated synthetic skill",
  { skip: opencodeBin ? false : "opencode CLI not installed" },
  () => {
    // A controlled fake `opencode` child emits one trigger event for its own
    // synthetic skill, so the eval reports a positive result without a live
    // model. This proves the clean-state path (no conflict) reaches the child,
    // and that the child runs in the isolated eval root.
    const binDir = mkdtempSync(join(tmpdir(), "skc-v2-d02-bin-"))
    const fake = `#!/usr/bin/env node
const fs = require("fs")
const path = require("path")
const cwd = process.cwd()
let cleanName = "unknown"
try {
  const skills = fs.readdirSync(path.join(cwd, ".opencode", "skills"))
  if (skills.length) cleanName = skills[0]
} catch {}
process.stdout.write(JSON.stringify({ type: "tool_use", part: { tool: "read", input: { path: cleanName + "/SKILL.md" } } }) + "\\n")
process.exit(0)
`
    writeFileSync(join(binDir, "opencode"), fake)
    execFileSync("chmod", ["755", join(binDir, "opencode")])

    const runtime = provisionV2Runtime(
      "skc-v2-clean-",
      ({ iso, project, markerPath }) => {
        const skillDir = join(iso, "clean-skill")
        mkdirSync(skillDir, { recursive: true })
        writeFileSync(
          join(skillDir, "SKILL.md"),
          ["---", "name: clean-skill", "description: A clean skill with no installed conflict.", "---", "", "# Clean", ""].join("\n"),
        )
        const evalSetPath = join(iso, "eval.json")
        writeFileSync(evalSetPath, JSON.stringify([{ query: "use clean-skill now", should_trigger: true }]))

        return `
import { writeFileSync } from "node:fs"
import def from "opencode-skill-creator"

const context = { signal: new AbortController().signal, progress: async () => {} }

export default {
  ...def,
  async setup(ctx) {
    const cleanup = await def.setup(ctx)
    const tools = new Map((await ctx.tool.list()).map((tool) => [tool.id, tool]))
    const result = JSON.parse(
      (await tools.get("skill_eval").execute(
        {
          evalSetPath: ${JSON.stringify(evalSetPath)},
          skillPath: ${JSON.stringify(skillDir)},
          numWorkers: 1,
          timeout: 15,
          runsPerQuery: 1,
        },
        context,
      )).content,
    )
    writeFileSync(${JSON.stringify(markerPath)}, JSON.stringify(result))
    return cleanup
  },
}
`
      },
      { binDir },
    )

    try {
      runtime.run()
      const result = runtime.readMarker()
      assert.equal(result.summary.total, 1)
      assert.equal(result.results[0].triggers, 1, "clean-state eval observed the synthetic trigger")
      assert.equal(result.results[0].errors, 0)
      assert.equal(result.results[0].pass, true)
    } finally {
      runtime.cleanup()
      rmSync(binDir, { recursive: true, force: true })
    }
  },
)
