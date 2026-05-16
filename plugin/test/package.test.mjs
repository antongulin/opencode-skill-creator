import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const pluginSourcePath = fileURLToPath(new URL("../skill-creator.ts", import.meta.url))
const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url))
const pluginRoot = fileURLToPath(new URL("..", import.meta.url))
const distEntryPath = fileURLToPath(new URL("../dist/skill-creator.js", import.meta.url))
const buildManifestPath = fileURLToPath(new URL("../dist/build-manifest.json", import.meta.url))
const distAssetPaths = [
  "../dist/skill-creator.js",
  "../dist/build-manifest.json",
  "../dist/templates/viewer.html",
  "../dist/skill/SKILL.md",
  "../dist/package.json",
].map((path) => fileURLToPath(new URL(path, import.meta.url)))

function listSourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return listSourceFiles(path)
    return entry.isFile() && path.endsWith(".ts") ? [path] : []
  })
}

function hashPluginSources() {
  const files = [pluginSourcePath, ...listSourceFiles(join(pluginRoot, "lib"))].sort()
  const hash = createHash("sha256")
  for (const file of files) {
    hash.update(relative(pluginRoot, file))
    hash.update("\0")
    hash.update(readFileSync(file))
    hash.update("\0")
  }
  return hash.digest("hex")
}

test("plugin source does not use import.meta.path", () => {
  const source = readFileSync(pluginSourcePath, "utf-8")

  assert.equal(source.includes("import.meta.path"), false)
  assert.equal(source.includes("fileURLToPath(import.meta.url)"), true)
})

test("package entrypoint points to compiled JavaScript", () => {
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8"))

  assert.equal(pkg.main, "./dist/skill-creator.js")
  assert.equal(pkg.files.includes("dist/"), true)
  assert.equal(pkg.files.includes("skill-creator.ts"), false)
})

test("built package includes runtime assets", () => {
  for (const assetPath of distAssetPaths) {
    assert.equal(existsSync(assetPath), true, `${assetPath} should exist`)
  }
})

test("compiled entrypoint imports as a plugin function", async () => {
  const mod = await import(distEntryPath)

  assert.equal(typeof mod.default, "function")
})

test("compiled artifact manifest matches current TypeScript sources", () => {
  const manifest = JSON.parse(readFileSync(buildManifestPath, "utf-8"))

  assert.equal(manifest.entrypoint, "skill-creator.ts")
  assert.equal(manifest.sourceHash, hashPluginSources())
  assert.equal(typeof manifest.builtAt, "string")
  assert.equal(Number.isNaN(Date.parse(manifest.builtAt)), false)
  assert.ok(statSync(distEntryPath).size > 0)
})

test("compiled entrypoint has no trailing whitespace", () => {
  const source = readFileSync(distEntryPath, "utf-8")

  assert.equal(/[ \t]+$/m.test(source), false)
})
