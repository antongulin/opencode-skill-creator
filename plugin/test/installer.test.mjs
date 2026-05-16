import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import test from "node:test"

const execFileAsync = promisify(execFile)
const binPath = fileURLToPath(new URL("../bin/opencode-skill-creator.js", import.meta.url))

async function createHome() {
  const home = mkdtempSync(join(tmpdir(), "opencode-installer-"))
  await mkdir(join(home, ".config", "opencode"), { recursive: true })
  return home
}

async function runInstaller(home) {
  return execFileAsync(process.execPath, [binPath, "install", "--global"], {
    env: { ...process.env, HOME: home },
  })
}

async function runProjectInstaller(cwd) {
  return execFileAsync(process.execPath, [binPath, "install", "--project"], {
    cwd,
    env: { ...process.env },
  })
}

function configPath(home, filename) {
  return join(home, ".config", "opencode", filename)
}

async function withHome(fn) {
  const home = await createHome()
  try {
    await fn(home)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}

async function withProject(fn) {
  const project = mkdtempSync(join(tmpdir(), "opencode-project-"))
  try {
    await fn(project)
  } finally {
    await rm(project, { recursive: true, force: true })
  }
}

test("global install updates opencode.jsonc when it exists and preserves comments and existing plugins", async () => {
  await withHome(async (home) => {
    const path = configPath(home, "opencode.jsonc")
    writeFileSync(
      path,
      `{
  // Keep this comment
  "plugin": [
    "existing-plugin"
  ]
}
`,
      "utf-8"
    )

    await runInstaller(home)

    const updated = readFileSync(path, "utf-8")
    assert.match(updated, /\/\/ Keep this comment/)
    assert.match(updated, /"existing-plugin"/)
    assert.match(updated, /"opencode-skill-creator"/)
    assert.equal(existsSync(configPath(home, "opencode.json")), false)
  })
})

test("global install creates plugin array in existing opencode.jsonc without plugin key", async () => {
  await withHome(async (home) => {
    const path = configPath(home, "opencode.jsonc")
    writeFileSync(
      path,
      `{
  // Keep this comment
  "model": "anthropic/claude-sonnet-4-6"
}
`,
      "utf-8"
    )

    await runInstaller(home)

    const updated = readFileSync(path, "utf-8")
    assert.match(updated, /\/\/ Keep this comment/)
    assert.match(updated, /"model": "anthropic\/claude-sonnet-4-6"/)
    assert.match(updated, /"plugin": \[/)
    assert.match(updated, /"opencode-skill-creator"/)
    assert.equal(existsSync(configPath(home, "opencode.json")), false)
  })
})

test("global install prefers opencode.jsonc when both opencode.jsonc and opencode.json exist", async () => {
  await withHome(async (home) => {
    const jsoncPath = configPath(home, "opencode.jsonc")
    const jsonPath = configPath(home, "opencode.json")
    writeFileSync(jsoncPath, `{
  // preferred
  "plugin": []
}
`, "utf-8")
    writeFileSync(jsonPath, `{
  "plugin": ["json-plugin"]
}
`, "utf-8")

    await runInstaller(home)

    assert.match(readFileSync(jsoncPath, "utf-8"), /"opencode-skill-creator"/)
    assert.equal(
      readFileSync(jsonPath, "utf-8"),
      `{
  "plugin": ["json-plugin"]
}
`
    )
  })
})

test("global install falls back to opencode.json when JSONC is absent", async () => {
  await withHome(async (home) => {
    const jsonPath = configPath(home, "opencode.json")
    writeFileSync(jsonPath, `{
  "plugin": ["json-plugin"]
}
`, "utf-8")

    await runInstaller(home)

    const updated = readFileSync(jsonPath, "utf-8")
    assert.match(updated, /"json-plugin"/)
    assert.match(updated, /"opencode-skill-creator"/)
  })
})

test("global install rejects invalid JSONC without modifying the file", async () => {
  await withHome(async (home) => {
    const path = configPath(home, "opencode.jsonc")
    const original = `{
  // broken config
  "plugin": [
}
`
    writeFileSync(path, original, "utf-8")

    await assert.rejects(runInstaller(home), /Could not parse JSONC/)
    assert.equal(readFileSync(path, "utf-8"), original)
    assert.equal(existsSync(configPath(home, "opencode.json")), false)
  })
})

test("project install updates opencode.jsonc in the current directory", async () => {
  await withProject(async (project) => {
    const path = join(project, "opencode.jsonc")
    writeFileSync(path, `{
  // project config
  "plugin": []
}
`, "utf-8")

    await runProjectInstaller(project)

    const updated = readFileSync(path, "utf-8")
    assert.match(updated, /\/\/ project config/)
    assert.match(updated, /"opencode-skill-creator"/)
    assert.equal(existsSync(join(project, "opencode.json")), false)
  })
})
