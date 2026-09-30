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

// Real-runtime integration proof for the #38/V2 fix. It packs the plugin,
// installs the tarball into a private wrapper directory, then loads it in the
// real OpenCode V2 CLI under a private HOME/XDG. The wrapper executes the
// packaged tools inside setup(), so registration AND execution of the
// *delivered artifact* are proven without any model call.
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

test(
  "packaged plugin loads and runs its tools in the real OpenCode V2 runtime",
  { skip: opencodeBin ? false : "opencode CLI not installed" },
  () => {
    const iso = mkdtempSync(join(tmpdir(), "skc-v2-runtime-"))
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

    try {
      // 1. Pack the delivered artifact. `--ignore-scripts` skips `prepack` so
      //    this test does not recursively run the suite; CI and prepack still
      //    build + test before a real publish.
      const tarball = execFileSync("npm", ["pack", "--silent", "--ignore-scripts"], {
        cwd: pluginRoot,
        encoding: "utf-8",
      })
        .trim()
        .split("\n")
        .pop()
      const tarballPath = join(pluginRoot, tarball)

      // 2. Install it (plus the runtime SDK) into the wrapper dir's node_modules
      //    so the loader can resolve a bare import from inside the plugin dir.
      try {
        execFileSync(
          "npm",
          ["init", "-y"],
          { cwd: pluginDir, stdio: "pipe" },
        )
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

      // 3. Wrapper plugin: load the installed package, run setup(), execute the
      //    packaged tools, and record the results for assertions.
      const markerPath = join(iso, "marker.json")
      const fixtureSkill = join(iso, "fixture-skill")
      mkdirSync(fixtureSkill, { recursive: true })
      writeFileSync(
        join(fixtureSkill, "SKILL.md"),
        ["---", "name: fixture-skill", "description: A fixture skill for runtime proof.", "---", "", "# Fixture", ""].join("\n"),
      )

      writeFileSync(
        join(pluginDir, "index.mjs"),
        `
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
`,
      )
      writeFileSync(
        join(project, "opencode.jsonc"),
        JSON.stringify(
          { $schema: "https://opencode.ai/config.json", plugins: [pluginDir] },
          null,
          2,
        ),
      )

      // 4. Run the real V2 CLI in the private environment. Build a minimal env
      //    so the harness's own OpenCode/OpenChamber variables cannot leak the
      //    real global config into the isolated run.
      const env = {
        PATH: process.env.PATH ?? "",
        HOME: home,
        XDG_CONFIG_HOME: config,
        XDG_DATA_HOME: data,
        XDG_CACHE_HOME: cache,
        XDG_STATE_HOME: state,
      }

      try {
        execFileSync(
          opencodeBin,
          ["run", "--standalone", "--agent", "build", "-m", "nonexistent/model", "ping"],
          { cwd: project, env, stdio: "pipe", timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
        )
      } catch {
        // The bogus model fails the turn; plugin boot still ran. Marker
        // assertions below are the source of truth.
      }

      assert.equal(existsSync(markerPath), true, "wrapper setup() ran in the real runtime")
      const marker = JSON.parse(readFileSync(markerPath, "utf-8"))
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

      // 5. The plugin loaded and no load failure was logged.
      const logPath = join(data, "opencode", "log", "opencode.log")
      const log = existsSync(logPath) ? readFileSync(logPath, "utf-8") : ""
      assert.equal(/PluginModule\.LoadError/.test(log), false, "no LoadError")
      assert.match(log, /msg="loading plugin"/)
      assert.equal(/"failed to load plugin"/.test(log), false, "no plugin load failure")
    } finally {
      rmSync(iso, { recursive: true, force: true })
    }
  },
)
