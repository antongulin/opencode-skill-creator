#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { homedir } from "os"
import { join, dirname } from "path"

function printHelp() {
  console.log(`opencode-skill-creator installer

Usage:
  npx opencode-skill-creator install [--project|--global]
  npx opencode-skill-creator [--project|--global]

Options:
  --project   Update ./opencode.json in current directory (default)
  --global    Update ~/.config/opencode/opencode.json
  -h, --help  Show help
`)
}

function parseArgs(argv) {
  const args = new Set(argv.slice(2))
  if (args.has("-h") || args.has("--help")) {
    return { help: true, global: false }
  }

  const global = args.has("--global")
  return { help: false, global }
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
  if (!Array.isArray(config.plugin)) {
    config.plugin = []
  }

  if (!config.plugin.includes("opencode-skill-creator")) {
    config.plugin.push("opencode-skill-creator")
    return true
  }

  return false
}

function main() {
  const { help, global } = parseArgs(process.argv)
  if (help) {
    printHelp()
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
  console.error(error.message)
  process.exit(1)
}
