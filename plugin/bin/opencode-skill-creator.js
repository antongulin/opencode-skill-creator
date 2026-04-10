#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { homedir } from "os"
import { join, dirname } from "path"

const PKG_PATH = new URL("../package.json", import.meta.url)

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
  --global    Update ~/.config/opencode/opencode.json (default)
  --project   Update ./opencode.json in current directory
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
  if (globalInstall) {
    return join(homedir(), ".config", "opencode", "opencode.json")
  }
  return join(process.cwd(), "opencode.json")
}

function loadConfig(path) {
  if (!existsSync(path)) {
    return {}
  }

  const raw = readFileSync(path, "utf-8").trim()
  if (!raw) return {}

  try {
    return JSON.parse(raw)
  } catch {
    throw new Error(
      `Could not parse JSON in ${path}. Please fix the file, then re-run this installer.`
    )
  }
}

function saveConfig(path, config) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf-8")
}

function ensurePlugin(config) {
  if (typeof config.plugin === "undefined") {
    config.plugin = []
  }

  if (!Array.isArray(config.plugin)) {
    throw new Error('Expected "plugin" to be an array in opencode.json')
  }

  if (!config.plugin.includes("opencode-skill-creator")) {
    config.plugin.push("opencode-skill-creator")
    return true
  }

  return false
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
  const config = loadConfig(configPath)
  const changed = ensurePlugin(config)
  saveConfig(configPath, config)

  console.log(`Updated ${configPath}`)
  if (changed) {
    console.log('Added "opencode-skill-creator" to the "plugin" array.')
  } else {
    console.log('"opencode-skill-creator" is already in the "plugin" array.')
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
