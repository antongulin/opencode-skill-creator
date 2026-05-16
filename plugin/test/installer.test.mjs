import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { chmod, mkdir, rm } from "node:fs/promises"
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
    env: {
      ...process.env,
      APPDATA: join(home, "AppData", "Roaming"),
      HOME: home,
      XDG_CACHE_HOME: join(home, ".cache"),
      XDG_CONFIG_HOME: join(home, ".config"),
    },
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

function cachedPackagePath(home) {
  return join(
    home,
    ".cache",
    "opencode",
    "packages",
    "opencode-skill-creator@latest",
    "node_modules",
    "opencode-skill-creator"
  )
}

function desktopDataPath(home) {
  if (process.platform === "darwin") {
    return join(home, "Library", "Application Support", "ai.opencode.desktop", "opencode.global.dat")
  }

  if (process.platform === "win32") {
    return join(home, "AppData", "Roaming", "ai.opencode.desktop", "opencode.global.dat")
  }

  return join(home, ".config", "ai.opencode.desktop", "opencode.global.dat")
}

async function writeDesktopNotifications(home, notifications) {
  const path = desktopDataPath(home)
  await mkdir(join(path, ".."), { recursive: true })
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        notification: JSON.stringify({ list: notifications }),
        layout: JSON.stringify({ sidebar: { opened: true } }),
      },
      null,
      "\t"
    )}\n`,
    "utf-8"
  )
}

function readDesktopNotifications(home) {
  const data = JSON.parse(readFileSync(desktopDataPath(home), "utf-8"))
  return JSON.parse(data.notification).list
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

test("global install clears stale OpenCode package cache", async () => {
  await withHome(async (home) => {
    const path = configPath(home, "opencode.json")
    writeFileSync(path, `{
  "plugin": ["opencode-skill-creator"]
}
`, "utf-8")

    const packagePath = cachedPackagePath(home)
    await mkdir(packagePath, { recursive: true })
    writeFileSync(join(packagePath, "package.json"), `{
  "name": "opencode-skill-creator",
  "version": "0.2.11",
  "main": "./skill-creator.ts"
}
`, "utf-8")

    const result = await runInstaller(home)

    assert.equal(existsSync(packagePath), false)
    assert.match(result.stdout, /Cleared stale OpenCode package cache/)
  })
})

test("global install continues when stale cache cleanup fails", async () => {
  await withHome(async (home) => {
    const path = configPath(home, "opencode.json")
    writeFileSync(path, `{
  "plugin": []
}
`, "utf-8")

    const packagePath = cachedPackagePath(home)
    await mkdir(packagePath, { recursive: true })
    writeFileSync(join(packagePath, "package.json"), `{
  "name": "opencode-skill-creator",
  "version": "0.2.11",
  "main": "./skill-creator.ts"
}
`, "utf-8")

    writeFileSync(join(packagePath, "open-file"), "keep", "utf-8")

    const packagesDir = join(packagePath, "..", "..", "..")
    await chmod(packagesDir, 0o555)
    try {
      await assert.doesNotReject(runInstaller(home))
    } finally {
      await chmod(packagesDir, 0o755)
    }

    const updated = readFileSync(path, "utf-8")
    assert.match(updated, /"opencode-skill-creator"/)
  })
})

test("global install removes opencode-skill-creator plugin fault notifications", async () => {
  await withHome(async (home) => {
    const path = configPath(home, "opencode.json")
    writeFileSync(path, `{
  "plugin": ["opencode-skill-creator"]
}
`, "utf-8")

    await writeDesktopNotifications(home, [
      {
        directory: "/tmp/project-a",
        time: 1,
        viewed: false,
        type: "error",
        session: "global",
        error: {
          name: "UnknownError",
          data: {
            message:
              "Failed to load plugin opencode-skill-creator: Stripping types is currently unsupported for files under node_modules",
          },
        },
      },
      {
        directory: "/tmp/project-b",
        time: 2,
        viewed: false,
        type: "error",
        session: "global",
        error: {
          name: "UnknownError",
          data: { message: "Failed to load plugin other-plugin: boom" },
        },
      },
      {
        directory: "/tmp/project-c",
        time: 3,
        viewed: false,
        type: "error",
        session: "global",
        error: {
          name: "UnknownError",
          data: { message: "Failed to load plugin opencode-skill-creator-extra: boom" },
        },
      },
      {
        directory: "/tmp/project-d",
        time: 4,
        viewed: false,
        type: "turn-complete",
        session: "ses_test",
      },
    ])

    const result = await runInstaller(home)

    const notifications = readDesktopNotifications(home)
    assert.equal(notifications.length, 3)
    assert.equal(
      notifications.some((notification) =>
        JSON.stringify(notification).includes("Failed to load plugin opencode-skill-creator:")
      ),
      false
    )
    assert.equal(
      notifications.some((notification) =>
        JSON.stringify(notification).includes("Failed to load plugin other-plugin")
      ),
      true
    )
    assert.equal(
      notifications.some((notification) =>
        JSON.stringify(notification).includes("Failed to load plugin opencode-skill-creator-extra")
      ),
      true
    )
    assert.match(result.stdout, /Removed 1 stale opencode-skill-creator plugin fault notification/)
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
