import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const distRoot = resolve(pluginRoot, "dist")

function listSourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return listSourceFiles(path)
    return entry.isFile() && path.endsWith(".ts") ? [path] : []
  })
}

function hashPluginSources() {
  const files = [
    resolve(pluginRoot, "skill-creator.ts"),
    ...listSourceFiles(resolve(pluginRoot, "lib")),
  ].sort()
  const hash = createHash("sha256")
  for (const file of files) {
    hash.update(relative(pluginRoot, file))
    hash.update("\0")
    hash.update(readFileSync(file))
    hash.update("\0")
  }
  return hash.digest("hex")
}

function stripTrailingWhitespace(path) {
  const source = readFileSync(path, "utf-8")
  writeFileSync(path, source.replace(/[ \t]+$/gm, ""), "utf-8")
}

rmSync(distRoot, { force: true, recursive: true })
mkdirSync(distRoot, { recursive: true })

execFileSync(
  "bun",
  [
    "build",
    "./skill-creator.ts",
    "--target=bun",
    "--format=esm",
    "--outfile=dist/skill-creator.js",
    "--external:@opencode-ai/plugin",
  ],
  { cwd: pluginRoot, stdio: "inherit" },
)

stripTrailingWhitespace(resolve(distRoot, "skill-creator.js"))

cpSync(resolve(pluginRoot, "templates"), resolve(distRoot, "templates"), { recursive: true })
cpSync(resolve(pluginRoot, "skill"), resolve(distRoot, "skill"), { recursive: true })
cpSync(resolve(pluginRoot, "package.json"), resolve(distRoot, "package.json"))
writeFileSync(
  resolve(distRoot, "build-manifest.json"),
  `${JSON.stringify(
    {
      entrypoint: "skill-creator.ts",
      sourceHash: hashPluginSources(),
      builtAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
)
