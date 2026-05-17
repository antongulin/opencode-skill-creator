import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "fs"
import { mkdir, rm } from "fs/promises"
import { tmpdir } from "os"
import { join, win32 } from "path"

import {
  AUTO_UPDATE_STATUS_FILE,
  AUTO_UPDATE_TTL_MS,
  SkillCreatorPlugin,
  getAutoUpdatePaths,
  isInsidePath,
  maybeAutoRefreshPluginCache,
} from "../skill-creator"

async function withHome(fn: (home: string) => Promise<void>) {
  const home = mkdtempSync(join(tmpdir(), "opencode-auto-update-"))
  const previousHome = process.env.HOME
  const previousXdgCacheHome = process.env.XDG_CACHE_HOME
  const previousXdgConfigHome = process.env.XDG_CONFIG_HOME
  const previousDisable = process.env.OPENCODE_SKILL_CREATOR_AUTO_UPDATE

  process.env.HOME = home
  process.env.XDG_CACHE_HOME = join(home, ".cache")
  process.env.XDG_CONFIG_HOME = join(home, ".config")
  delete process.env.OPENCODE_SKILL_CREATOR_AUTO_UPDATE

  try {
    await fn(home)
  } finally {
    process.env.HOME = previousHome
    if (previousXdgCacheHome === undefined) delete process.env.XDG_CACHE_HOME
    else process.env.XDG_CACHE_HOME = previousXdgCacheHome
    if (previousXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previousXdgConfigHome
    if (previousDisable === undefined) delete process.env.OPENCODE_SKILL_CREATOR_AUTO_UPDATE
    else process.env.OPENCODE_SKILL_CREATOR_AUTO_UPDATE = previousDisable
    await rm(home, { recursive: true, force: true })
  }
}

async function writeCachedPackage(version: string) {
  const paths = getAutoUpdatePaths()
  await mkdir(paths.cachedPackageDir, { recursive: true })
  writeFileSync(
    join(paths.cachedPackageDir, "package.json"),
    JSON.stringify({
      name: "opencode-skill-creator",
      version,
    }),
  )
}

function registryFetch(version: string) {
  return async () => new Response(JSON.stringify({ version }), { status: 200 })
}

test("auto update clears stale latest cache and records check timestamp", async () => {
  await withHome(async () => {
    await writeCachedPackage("0.2.13")
    const paths = getAutoUpdatePaths()

    const result = await maybeAutoRefreshPluginCache({
      currentVersion: "0.2.13",
      now: 1_000_000,
      fetchImpl: registryFetch("0.2.14"),
    })

    expect(result).toEqual({ checked: true, cleared: true, reason: "newer-version" })
    expect(existsSync(paths.packageCacheRoot)).toBe(false)
    const status = JSON.parse(readFileSync(paths.statusPath, "utf-8"))
    expect(status.lastCheckedAt).toBe(1_000_000)
    expect(status.latestVersion).toBe("0.2.14")
    expect(status.currentVersion).toBe("0.2.13")
  })
})

test("auto update exports the status file name used by getAutoUpdatePaths", async () => {
  await withHome(async () => {
    const paths = getAutoUpdatePaths()

    expect(paths.statusPath).toBe(
      join(process.env.XDG_CONFIG_HOME!, "opencode", AUTO_UPDATE_STATUS_FILE),
    )
  })
})

test("auto update schedules stale cache clearing when plugin runs from that cache", async () => {
  await withHome(async () => {
    await writeCachedPackage("0.2.13")
    const paths = getAutoUpdatePaths()
    const scheduledPaths: string[] = []

    const result = await maybeAutoRefreshPluginCache({
      currentVersion: "0.2.13",
      currentPluginDir: paths.cachedPackageDir,
      now: 1_000_000,
      fetchImpl: registryFetch("0.2.14"),
      scheduleClearImpl: (path) => scheduledPaths.push(path),
    })

    expect(result).toEqual({ checked: true, cleared: false, reason: "scheduled-clear" })
    expect(scheduledPaths).toEqual([paths.packageCacheRoot])
    expect(existsSync(paths.packageCacheRoot)).toBe(true)
  })
})

test("auto update treats non-numeric version parts explicitly as zero", async () => {
  await withHome(async () => {
    await writeCachedPackage("0.2.13")
    const paths = getAutoUpdatePaths()

    const result = await maybeAutoRefreshPluginCache({
      currentVersion: "0.2.beta",
      now: 1_000_000,
      fetchImpl: registryFetch("0.2.1"),
    })

    expect(result).toEqual({ checked: true, cleared: true, reason: "newer-version" })
    expect(existsSync(paths.packageCacheRoot)).toBe(false)
  })
})

test("path containment check rejects Windows absolute paths outside the cache root", () => {
  expect(
    isInsidePath("C:\\Users\\me\\cache", "D:\\Users\\me\\other", win32),
  ).toBe(false)
  expect(
    isInsidePath(
      "C:\\Users\\me\\cache",
      "C:\\Users\\me\\cache\\node_modules\\opencode-skill-creator",
      win32,
    ),
  ).toBe(true)
})

test("auto update skips registry check when previous check is younger than ttl", async () => {
  await withHome(async () => {
    const paths = getAutoUpdatePaths()
    await mkdir(join(paths.statusPath, ".."), { recursive: true })
    writeFileSync(paths.statusPath, JSON.stringify({ lastCheckedAt: 10_000 }))

    let fetchCalled = false
    const result = await maybeAutoRefreshPluginCache({
      currentVersion: "0.2.13",
      now: 10_000 + AUTO_UPDATE_TTL_MS - 1,
      fetchImpl: async () => {
        fetchCalled = true
        return new Response("{}", { status: 200 })
      },
    })

    expect(result).toEqual({ checked: false, cleared: false, reason: "recently-checked" })
    expect(fetchCalled).toBe(false)
  })
})

test("auto update does not clear cache when npm latest is not newer", async () => {
  await withHome(async () => {
    await writeCachedPackage("0.2.13")
    const paths = getAutoUpdatePaths()

    const result = await maybeAutoRefreshPluginCache({
      currentVersion: "0.2.13",
      now: 20_000,
      fetchImpl: registryFetch("0.2.13"),
    })

    expect(result).toEqual({ checked: true, cleared: false, reason: "up-to-date" })
    expect(existsSync(paths.packageCacheRoot)).toBe(true)
  })
})

test("auto update is disabled by env var", async () => {
  await withHome(async () => {
    process.env.OPENCODE_SKILL_CREATOR_AUTO_UPDATE = "0"
    let fetchCalled = false

    const result = await maybeAutoRefreshPluginCache({
      currentVersion: "0.2.13",
      now: 30_000,
      fetchImpl: async () => {
        fetchCalled = true
        return new Response("{}", { status: 200 })
      },
    })

    expect(result).toEqual({ checked: false, cleared: false, reason: "disabled" })
    expect(fetchCalled).toBe(false)
  })
})

test("auto update swallows registry errors", async () => {
  await withHome(async () => {
    const result = await maybeAutoRefreshPluginCache({
      currentVersion: "0.2.13",
      now: 40_000,
      fetchImpl: async () => {
        throw new Error("network down")
      },
    })

    expect(result).toEqual({ checked: false, cleared: false, reason: "error" })
  })
})

test("plugin startup exposes tools when auto update is disabled", async () => {
  await withHome(async () => {
    process.env.OPENCODE_SKILL_CREATOR_AUTO_UPDATE = "0"

    const plugin = await SkillCreatorPlugin({} as never)

    expect(plugin.tool?.skill_validate).toBeDefined()
  })
})
