# Auto Update Plugin Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add silent, best-effort, once-per-24h cache invalidation so `opencode-skill-creator` users receive newer npm releases after a restart without manually running an update command.

**Architecture:** The plugin startup path will call a small auto-update helper after `ensureSkillInstalled()`. The helper will read a timestamp/status file under `~/.config/opencode`, skip checks younger than 24 hours, fetch npm registry metadata with a short timeout, compare versions, and remove only OpenCode's `opencode-skill-creator@latest` cache directory when npm has a newer version. All failures are swallowed so plugin load never fails.

**Tech Stack:** TypeScript OpenCode plugin, Node/Bun test runner, Node `fs`, `os`, `path`, `fetch`, `AbortController`.

---

## File Structure

- Modify `plugin/skill-creator.ts`
  - Add constants for update-check TTL, status path, cache path, npm registry URL, and environment escape hatches.
  - Add pure helpers for version comparison and timestamp/status handling.
  - Add `maybeAutoRefreshPluginCache()` called during plugin initialization.
- Create `plugin/test/auto-update.test.ts`
  - Unit tests for the helper with injected dependencies, using temp HOME/XDG directories and mocked fetch.
- Modify `plugin/scripts/build.mjs` only if the build manifest check requires dist artifacts to be regenerated through existing build tooling.
- Generated/updated `plugin/dist/skill-creator.js` through `npm run build` if current repo convention requires committed dist output.

---

### Task 1: Add failing tests for once-per-24h auto-update behavior

**Files:**
- Create: `plugin/test/auto-update.test.ts`
- Modify later: `plugin/skill-creator.ts`

- [ ] **Step 1: Write the failing tests**

Create `plugin/test/auto-update.test.ts` with tests that import helpers from `../skill-creator`:

```ts
import { afterEach, beforeEach, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "fs"
import { mkdir, rm } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"

import {
  AUTO_UPDATE_TTL_MS,
  getAutoUpdatePaths,
  maybeAutoRefreshPluginCache,
} from "../skill-creator"

let previousHome: string | undefined
let previousXdgCacheHome: string | undefined
let previousXdgConfigHome: string | undefined
let previousDisable: string | undefined

async function withHome(fn: (home: string) => Promise<void>) {
  const home = mkdtempSync(join(tmpdir(), "opencode-auto-update-"))
  previousHome = process.env.HOME
  previousXdgCacheHome = process.env.XDG_CACHE_HOME
  previousXdgConfigHome = process.env.XDG_CONFIG_HOME
  previousDisable = process.env.OPENCODE_SKILL_CREATOR_AUTO_UPDATE

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

async function writeCachedPackage(home: string, version: string) {
  const paths = getAutoUpdatePaths()
  await mkdir(paths.cachedPackageDir, { recursive: true })
  writeFileSync(join(paths.cachedPackageDir, "package.json"), JSON.stringify({
    name: "opencode-skill-creator",
    version,
  }))
}

function registryFetch(version: string) {
  return async () => new Response(JSON.stringify({
    "dist-tags": { latest: version },
  }), { status: 200 })
}

test("auto update clears stale latest cache and records check timestamp", async () => {
  await withHome(async (home) => {
    await writeCachedPackage(home, "0.2.13")
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
    await writeCachedPackage("", "0.2.13")
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
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test:ts -- test/auto-update.test.ts
```

Expected: FAIL because `AUTO_UPDATE_TTL_MS`, `getAutoUpdatePaths`, and `maybeAutoRefreshPluginCache` are not exported from `skill-creator.ts`.

---

### Task 2: Implement minimal auto-update helper

**Files:**
- Modify: `plugin/skill-creator.ts`

- [ ] **Step 1: Add imports and constants**

In `plugin/skill-creator.ts`, extend fs imports and add constants near `PACKAGE_VERSION`:

```ts
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  rmSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "fs"

export const AUTO_UPDATE_TTL_MS = 24 * 60 * 60 * 1000
const AUTO_UPDATE_STATUS_FILE = "opencode-skill-creator-update-check.json"
const NPM_REGISTRY_URL = "https://registry.npmjs.org/opencode-skill-creator/latest"
const AUTO_UPDATE_TIMEOUT_MS = 2500
```

- [ ] **Step 2: Add helper types and paths**

Add after `ensureSkillInstalled()`:

```ts
type AutoUpdateResult = {
  checked: boolean
  cleared: boolean
  reason:
    | "disabled"
    | "recently-checked"
    | "newer-version"
    | "up-to-date"
    | "missing-cache"
    | "unknown-version"
    | "error"
}

type AutoUpdateOptions = {
  currentVersion?: string
  now?: number
  fetchImpl?: typeof fetch
}

type AutoUpdateStatus = {
  lastCheckedAt?: number
  currentVersion?: string
  latestVersion?: string
}

export function getAutoUpdatePaths() {
  const cacheDir = process.env.XDG_CACHE_HOME || join(homedir(), ".cache")
  const configDir = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
  const packageCacheRoot = join(
    cacheDir,
    "opencode",
    "packages",
    "opencode-skill-creator@latest",
  )

  return {
    packageCacheRoot,
    cachedPackageDir: join(packageCacheRoot, "node_modules", "opencode-skill-creator"),
    cachedPackageJson: join(packageCacheRoot, "node_modules", "opencode-skill-creator", "package.json"),
    statusPath: join(configDir, "opencode", AUTO_UPDATE_STATUS_FILE),
  }
}
```

- [ ] **Step 3: Add version/status helpers**

```ts
function compareVersions(a: string, b: string) {
  const parse = (value: string) => value.split(".").map((part) => Number.parseInt(part, 10) || 0)
  const left = parse(a)
  const right = parse(b)
  const length = Math.max(left.length, right.length)

  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }

  return 0
}

function readAutoUpdateStatus(path: string): AutoUpdateStatus {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as AutoUpdateStatus
  } catch {
    return {}
  }
}

function writeAutoUpdateStatus(path: string, status: AutoUpdateStatus) {
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify(status, null, 2)}\n`, "utf-8")
  } catch {
    // Best-effort status tracking only.
  }
}
```

- [ ] **Step 4: Add the auto-update function**

```ts
export async function maybeAutoRefreshPluginCache(
  options: AutoUpdateOptions = {},
): Promise<AutoUpdateResult> {
  try {
    if (process.env.OPENCODE_SKILL_CREATOR_AUTO_UPDATE === "0") {
      return { checked: false, cleared: false, reason: "disabled" }
    }

    const currentVersion = options.currentVersion ?? PACKAGE_VERSION
    if (currentVersion === "0.0.0") {
      return { checked: false, cleared: false, reason: "unknown-version" }
    }

    const paths = getAutoUpdatePaths()
    const now = options.now ?? Date.now()
    const status = readAutoUpdateStatus(paths.statusPath)
    if (
      typeof status.lastCheckedAt === "number" &&
      now - status.lastCheckedAt < AUTO_UPDATE_TTL_MS
    ) {
      return { checked: false, cleared: false, reason: "recently-checked" }
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), AUTO_UPDATE_TIMEOUT_MS)

    try {
      const response = await (options.fetchImpl ?? fetch)(NPM_REGISTRY_URL, {
        signal: controller.signal,
      })
      if (!response.ok) return { checked: false, cleared: false, reason: "error" }

      const metadata = (await response.json()) as { version?: string }
      const latestVersion = metadata.version
      if (!latestVersion) return { checked: false, cleared: false, reason: "error" }

      writeAutoUpdateStatus(paths.statusPath, {
        lastCheckedAt: now,
        currentVersion,
        latestVersion,
      })

      if (compareVersions(latestVersion, currentVersion) <= 0) {
        return { checked: true, cleared: false, reason: "up-to-date" }
      }

      if (!existsSync(paths.cachedPackageJson)) {
        return { checked: true, cleared: false, reason: "missing-cache" }
      }

      rmSync(paths.packageCacheRoot, { recursive: true, force: true })
      return { checked: true, cleared: true, reason: "newer-version" }
    } finally {
      clearTimeout(timeout)
    }
  } catch {
    return { checked: false, cleared: false, reason: "error" }
  }
}
```

- [ ] **Step 5: Run tests to verify helper passes**

Run:

```bash
npm run test:ts -- test/auto-update.test.ts
```

Expected: all `auto-update.test.ts` tests pass.

---

### Task 3: Wire helper into plugin startup without blocking startup

**Files:**
- Modify: `plugin/skill-creator.ts`
- Test: `plugin/test/auto-update.test.ts`

- [ ] **Step 1: Add startup call**

Modify plugin export:

```ts
export const SkillCreatorPlugin: Plugin = async (ctx) => {
  // Auto-install bundled skill files to ~/.config/opencode/skills/skill-creator/
  ensureSkillInstalled()
  void maybeAutoRefreshPluginCache()

  return {
    tool: {
```

- [ ] **Step 2: Run targeted tests**

Run:

```bash
npm run test:ts -- test/auto-update.test.ts
```

Expected: all auto-update tests pass.

---

### Task 4: Fix test helper bug and add coverage for current session stability

**Files:**
- Modify: `plugin/test/auto-update.test.ts`

- [ ] **Step 1: Correct stale helper call**

In the "not newer" test, replace:

```ts
await writeCachedPackage("", "0.2.13")
```

with:

```ts
await writeCachedPackage(home, "0.2.13")
```

and ensure the callback receives `home`:

```ts
await withHome(async (home) => {
```

- [ ] **Step 2: Add non-blocking startup behavior test if practical**

If the plugin import can be tested without expensive side effects, add:

```ts
test("plugin startup exposes tools even when auto update fails", async () => {
  await withHome(async () => {
    const plugin = await SkillCreatorPlugin({} as never)
    expect(plugin.tool.skill_validate).toBeDefined()
  })
})
```

If this introduces unstable dependencies, skip it and rely on `maybeAutoRefreshPluginCache` swallowing errors.

- [ ] **Step 3: Run all TS tests**

Run:

```bash
npm run test:ts
```

Expected: 24+ tests pass, 0 fail.

---

### Task 5: Build dist and run full verification

**Files:**
- Modify generated: `plugin/dist/skill-creator.js` if changed by build

- [ ] **Step 1: Build package**

Run:

```bash
npm run build
```

Expected: build succeeds and updates dist/manifest outputs if needed.

- [ ] **Step 2: Run full tests**

Run:

```bash
npm test
npm run test:ts
git diff --check
```

Expected:
- `npm test`: all tests pass.
- `npm run test:ts`: all tests pass.
- `git diff --check`: no output.

- [ ] **Step 3: Inspect diff**

Run:

```bash
git diff -- plugin/skill-creator.ts plugin/test/auto-update.test.ts plugin/dist/skill-creator.js docs/superpowers/plans/2026-05-16-auto-update-plugin-cache.md
```

Expected: diff only includes auto-update helper, tests, generated dist, and this plan.

---

### Task 6: Commit, push, and open PR

**Files:**
- Stage intended files only.

- [ ] **Step 1: Check git state**

Run:

```bash
git status --short
git diff --stat
git log --oneline -10
```

Expected: only intended files changed; branch is `fix/auto-update-plugin-cache`.

- [ ] **Step 2: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-05-16-auto-update-plugin-cache.md plugin/skill-creator.ts plugin/test/auto-update.test.ts plugin/dist/skill-creator.js
git commit -m "feat(plugin): auto-refresh stale package cache"
```

Expected: commit succeeds.

- [ ] **Step 3: Push and create PR**

Run:

```bash
git push -u origin fix/auto-update-plugin-cache
gh pr create --title "Auto-refresh stale plugin cache" --body "$(cat <<'EOF'
## Summary
- Add silent once-per-24h npm version check during plugin startup.
- Clear only the OpenCode `opencode-skill-creator@latest` cache when npm has a newer version.
- Keep plugin load best-effort and add an env escape hatch with `OPENCODE_SKILL_CREATOR_AUTO_UPDATE=0`.

## Test Plan
- npm test
- npm run test:ts
- git diff --check
EOF
)"
```

Expected: PR URL is returned.

---

## Self-Review

- Spec coverage: The plan covers once-per-24h check, silent best-effort behavior, stale cache clearing, env disable, no current-session mutation, tests, and PR creation.
- Placeholder scan: No TBD/TODO placeholders remain; optional startup integration test has explicit skip criteria.
- Type consistency: `maybeAutoRefreshPluginCache`, `getAutoUpdatePaths`, and `AUTO_UPDATE_TTL_MS` names are consistent across tests and implementation steps.
