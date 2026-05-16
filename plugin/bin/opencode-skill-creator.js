#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs"
import { applyEdits, modify, parse, printParseErrorCode } from "jsonc-parser"
import { homedir } from "os"
import { join, dirname } from "path"

const PKG_PATH = new URL("../package.json", import.meta.url)
const PLUGIN_LOAD_ERROR_PREFIX = "Failed to load plugin opencode-skill-creator:"

function getVersion() {
  try {
    const pkg = JSON.parse(readFileSync(PKG_PATH, "utf-8"))
    return pkg.version || "unknown"
  } catch {
    return "unknown"
  }
}

function printHelp() {
  console.log(`opencode-skill-creator installer

Links:
  npm:  https://www.npmjs.com/package/opencode-skill-creator
  repo: https://github.com/antongulin/opencode-skill-creator

Usage:
  npx opencode-skill-creator install [--global|--project]
  npx opencode-skill-creator [--global|--project]
  npx opencode-skill-creator --version
  npx opencode-skill-creator --about

Options:
  --global    Update ~/.config/opencode/opencode.jsonc if present, otherwise opencode.json (default)
  --project   Update ./opencode.jsonc if present, otherwise opencode.json in current directory
  -v, --version  Show installer version
  --about     Show package links
  -h, --help  Show help
`)
}

function printAbout() {
  console.log(`opencode-skill-creator ${getVersion()}
npm:  https://www.npmjs.com/package/opencode-skill-creator
repo: https://github.com/antongulin/opencode-skill-creator`)
}

function parseArgs(argv) {
  const input = argv.slice(2)
  const args = new Set(input)

  if (args.has("-h") || args.has("--help")) {
    return {
      help: true,
      about: false,
      version: false,
      global: false,
      command: "install",
    }
  }

  if (args.has("-v") || args.has("--version")) {
    return {
      help: false,
      about: false,
      version: true,
      global: false,
      command: "install",
    }
  }

  if (args.has("--about")) {
    return {
      help: false,
      about: true,
      version: false,
      global: false,
      command: "install",
    }
  }

  const hasProject = args.has("--project")
  const hasGlobal = args.has("--global")

  if (hasProject && hasGlobal) {
    throw new Error("Use either --project or --global, not both.")
  }

  const command = input.find((arg) => !arg.startsWith("-")) || "install"
  if (command !== "install") {
    throw new Error(`Unknown command: ${command}`)
  }

  return {
    help: false,
    about: false,
    version: false,
    global: !hasProject,
    command,
  }
}

function getConfigPath(globalInstall) {
  const configDir = globalInstall
    ? join(homedir(), ".config", "opencode")
    : process.cwd()
  const jsoncPath = join(configDir, "opencode.jsonc")

  if (existsSync(jsoncPath)) {
    return jsoncPath
  }

  return join(configDir, "opencode.json")
}

function clearStaleOpenCodePackageCache() {
  const currentVersion = getVersion()
  if (currentVersion === "unknown") return { cleared: false, error: null }

  const cacheDir = process.env.XDG_CACHE_HOME || join(homedir(), ".cache")
  const packageCacheRoot = join(
    cacheDir,
    "opencode",
    "packages",
    "opencode-skill-creator@latest"
  )
  const cachedPackageJson = join(
    packageCacheRoot,
    "node_modules",
    "opencode-skill-creator",
    "package.json"
  )

  if (!existsSync(cachedPackageJson)) return { cleared: false, error: null }

  try {
    const cachedPackage = JSON.parse(readFileSync(cachedPackageJson, "utf-8"))
    if (cachedPackage.version === currentVersion) {
      return { cleared: false, error: null }
    }
  } catch {
    // Broken cache entries should be removed so OpenCode can recreate them.
  }

  try {
    rmSync(packageCacheRoot, { recursive: true, force: true })
    return { cleared: true, error: null }
  } catch (error) {
    return { cleared: false, error }
  }
}

function getDesktopGlobalDataPath() {
  if (process.platform === "darwin") {
    return join(
      homedir(),
      "Library",
      "Application Support",
      "ai.opencode.desktop",
      "opencode.global.dat"
    )
  }

  if (process.platform === "win32") {
    const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming")
    return join(appData, "ai.opencode.desktop", "opencode.global.dat")
  }

  const configDir = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
  return join(configDir, "ai.opencode.desktop", "opencode.global.dat")
}

function clearPluginFaultNotifications() {
  const dataPath = getDesktopGlobalDataPath()
  if (!existsSync(dataPath)) return 0

  try {
    const data = JSON.parse(readFileSync(dataPath, "utf-8"))
    if (typeof data.notification !== "string") return 0

    const notifications = JSON.parse(data.notification)
    if (!Array.isArray(notifications.list)) return 0

    const originalCount = notifications.list.length
    notifications.list = notifications.list.filter((notification) => {
      if (notification?.type !== "error") return true

      const message = notification?.error?.data?.message
      return typeof message !== "string" || !message.startsWith(PLUGIN_LOAD_ERROR_PREFIX)
    })

    const removedCount = originalCount - notifications.list.length
    if (removedCount === 0) return 0

    data.notification = JSON.stringify(notifications)
    writeFileSync(dataPath, `${JSON.stringify(data, null, "\t")}\n`, "utf-8")
    return removedCount
  } catch {
    // Desktop state cleanup is best-effort; installation should not fail here.
    return 0
  }
}

function loadConfig(path) {
  if (!existsSync(path)) {
    return {
      raw: "{\n}\n",
      config: {},
    }
  }

  const raw = readFileSync(path, "utf-8")
  if (!raw.trim()) {
    return {
      raw: "{\n}\n",
      config: {},
    }
  }

  const errors = []
  const config = parse(raw, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  })

  if (errors.length) {
    const message = errors
      .map((error) => printParseErrorCode(error.error))
      .join(", ")
    throw new Error(
      `Could not parse JSONC in ${path}: ${message}. Please fix the file, then re-run this installer.`
    )
  }

  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error(`Expected top-level config in ${path} to be an object.`)
  }

  return { raw, config }
}

function saveConfig(path, raw, config) {
  const formattingOptions = {
    insertSpaces: true,
    tabSize: 2,
  }

  const edits = Array.isArray(config.plugin)
    ? modify(raw, ["plugin", -1], "opencode-skill-creator", {
        formattingOptions,
      })
    : modify(raw, ["plugin"], ["opencode-skill-creator"], {
        formattingOptions,
      })

  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, applyEdits(raw, edits), "utf-8")
}

function ensurePlugin(config) {
  if (typeof config.plugin === "undefined") {
    return true
  }

  if (!Array.isArray(config.plugin)) {
    throw new Error('Expected "plugin" to be an array in opencode config')
  }

  return !config.plugin.includes("opencode-skill-creator")
}

function main() {
  const { help, about, version, global } = parseArgs(process.argv)
  if (help) {
    printHelp()
    process.exit(0)
  }

  if (about) {
    printAbout()
    process.exit(0)
  }

  if (version) {
    console.log(getVersion())
    process.exit(0)
  }

  const configPath = getConfigPath(global)
  const { raw, config } = loadConfig(configPath)
  const changed = ensurePlugin(config)
  if (changed) {
    saveConfig(configPath, raw, config)
    console.log(`Updated ${configPath}`)
    console.log('Added "opencode-skill-creator" to the "plugin" array.')
  } else {
    console.log(`No changes needed for ${configPath}`)
    console.log('"opencode-skill-creator" is already in the "plugin" array.')
  }

  if (global) {
    const cacheCleanup = clearStaleOpenCodePackageCache()
    if (cacheCleanup.cleared) {
      console.log("Cleared stale OpenCode package cache for opencode-skill-creator.")
    } else if (cacheCleanup.error) {
      console.warn(
        `Could not clear stale OpenCode package cache: ${cacheCleanup.error.message}`
      )
    }
  }

  if (global) {
    const removedNotifications = clearPluginFaultNotifications()
    if (removedNotifications > 0) {
      const noun = removedNotifications === 1 ? "notification" : "notifications"
      console.log(
        `Removed ${removedNotifications} stale opencode-skill-creator plugin fault ${noun}.`
      )
    }
  }

  console.log("\nNext steps:")
  console.log("1) Restart OpenCode")
  console.log("2) Ask: Create a skill that helps with API documentation")
  console.log(
    "\nOn first startup, the plugin auto-installs skill files to ~/.config/opencode/skills/skill-creator/"
  )
}

try {
  main()
} catch (error) {
  printHelp()
  console.error()
  console.error(error.message)
  process.exit(1)
}
