import { createHash } from "node:crypto"
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs"
import { isAbsolute, join, relative, sep } from "path"

export const SKILL_NAME = "opencode-skill-creator"
export const LEGACY_SKILL_NAME = "skill-creator"
export const INSTALL_VERSION_FILE = ".opencode-skill-creator-version"
/**
 * Ownership inventory for the managed skill directory. It records only the
 * files this installer copied from the bundle plus their content hash, so a
 * later upgrade can remove a file that the bundle no longer ships without ever
 * guessing at user-authored content. It is internal metadata, never a public
 * tool contract.
 */
export const INSTALL_MANIFEST_FILE = ".opencode-skill-creator-manifest.json"

export interface EnsureBundledSkillInstalledOptions {
  bundledSkillDir: string
  configDir: string
  packageVersion: string
  backupTimestamp?: () => string
  onError?: (message: string, error: unknown) => void
}

interface SkillInstallManifest {
  schema: 1
  packageVersion: string
  /** relative POSIX path -> sha256 hex of the recorded file at install time */
  files: Record<string, string>
}

function copyDirRecursive(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true })
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry)
    const destPath = join(dest, entry)
    if (statSync(srcPath).isDirectory()) {
      copyDirRecursive(srcPath, destPath)
    } else {
      copyFileSync(srcPath, destPath)
    }
  }
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

/**
 * True when `rel` is a safe, non-empty, relative POSIX path with no `..`,
 * absolute, drive-letter, or backslash component. Used to reject malformed or
 * hostile manifest metadata before it can name a file to delete.
 */
function isSafeRelativePath(rel: unknown): rel is string {
  if (typeof rel !== "string" || rel.length === 0) return false
  if (rel.includes("\\")) return false
  if (isAbsolute(rel)) return false
  if (/^[a-zA-Z]:/.test(rel)) return false
  return rel
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..")
}

/** Read and validate the ownership manifest. Missing or malformed -> null. */
function readManifest(skillsDir: string): SkillInstallManifest | null {
  const manifestPath = join(skillsDir, INSTALL_MANIFEST_FILE)
  if (!existsSync(manifestPath)) return null
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, "utf-8")) as unknown
    if (!parsed || typeof parsed !== "object") return null
    const record = parsed as Record<string, unknown>
    if (record.schema !== 1) return null
    const files = record.files
    if (!files || typeof files !== "object") return null
    const checked: Record<string, string> = {}
    for (const [rel, hash] of Object.entries(files as Record<string, unknown>)) {
      if (!isSafeRelativePath(rel) || typeof hash !== "string") return null
      checked[rel] = hash
    }
    return {
      schema: 1,
      packageVersion:
        typeof record.packageVersion === "string" ? record.packageVersion : "",
      files: checked,
    }
  } catch {
    return null
  }
}

function writeManifest(skillsDir: string, manifest: SkillInstallManifest): void {
  writeFileSync(
    join(skillsDir, INSTALL_MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )
}

/**
 * Build the ownership manifest for a staged install directory. Every regular
 * file copied from the bundle is recorded by relative POSIX path and sha256.
 * The preserved user `SKILL.md` is deliberately NOT recorded when it differs
 * from the bundle's copy: it is user-authored and must never be treated as a
 * plugin-owned file that a later upgrade may prune.
 */
function listBundleFiles(bundledSkillDir: string): Set<string> {
  const files = new Set<string>()
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(abs)
      } else if (entry.isFile()) {
        files.add(relative(bundledSkillDir, abs).split(sep).join("/"))
      }
    }
  }
  walk(bundledSkillDir)
  return files
}

function buildManifest(
  tmpInstallDir: string,
  bundledSkillDir: string,
  packageVersion: string,
): SkillInstallManifest {
  const files: Record<string, string> = {}
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(abs)
      } else if (entry.isFile()) {
        files[relative(tmpInstallDir, abs).split(sep).join("/")] = sha256File(abs)
      }
    }
  }
  walk(tmpInstallDir)

  const bundleSkill = join(bundledSkillDir, "SKILL.md")
  if (
    "SKILL.md" in files &&
    existsSync(bundleSkill) &&
    sha256File(bundleSkill) !== files["SKILL.md"]
  ) {
    // The staged SKILL.md is the preserved user file, not the bundle's.
    delete files["SKILL.md"]
  }
  return { schema: 1, packageVersion, files }
}

/**
 * Remove files this installer previously recorded that are no longer shipped
 * by the bundle. A file is pruned only when ALL hold:
 *   - it was recorded in the previous manifest,
 *   - its on-disk bytes still match the recorded hash (not user-modified),
 *   - it is absent from the new bundle,
 *   - the on-disk entry is a regular file (never a directory or symlink), and
 *   - its real path stays inside the managed skill directory.
 * Anything else — untracked/custom files, locally-modified recorded files,
 * legacy installs without a manifest — is preserved.
 */
function pruneStaleManagedFiles(
  skillsDir: string,
  oldManifest: SkillInstallManifest | null,
  newBundleFiles: ReadonlySet<string>,
): void {
  if (!oldManifest) return
  const canonicalRoot = (() => {
    try {
      return realpathSync(skillsDir)
    } catch {
      return skillsDir
    }
  })()
  const isInside = (child: string): boolean => {
    const rel = relative(canonicalRoot, child)
    if (rel === "" || isAbsolute(rel)) return false
    return rel !== ".." && !rel.startsWith(`..${sep}`)
  }

  for (const [rel, recordedHash] of Object.entries(oldManifest.files)) {
    if (!isSafeRelativePath(rel)) continue
    if (newBundleFiles.has(rel)) continue

    const target = join(skillsDir, rel)
    let stats
    try {
      stats = lstatSync(target)
    } catch {
      continue // already absent
    }
    if (!stats.isFile()) continue // never follow a symlink or remove a dir

    let canonicalTarget: string
    try {
      canonicalTarget = realpathSync(target)
    } catch {
      continue
    }
    if (!isInside(canonicalTarget)) continue

    let onDiskHash: string
    try {
      onDiskHash = sha256File(target)
    } catch {
      continue
    }
    if (onDiskHash !== recordedHash) continue // locally modified -> keep

    rmSync(target, { force: true })
  }
}

function defaultBackupTimestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "")
}

function uniqueBackupDir(skillsRoot: string, timestamp: string): string {
  const base = join(
    skillsRoot,
    `${LEGACY_SKILL_NAME}.opencode-skill-creator-backup-${timestamp}`,
  )
  if (!existsSync(base)) return base

  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${base}-${index}`
    if (!existsSync(candidate)) return candidate
  }

  throw new Error("Could not find an available legacy skill backup path")
}

function archiveLegacySkill(args: {
  skillsRoot: string
  legacySkillDir: string
  backupTimestamp: () => string
}): void {
  const legacyVersionFile = join(args.legacySkillDir, INSTALL_VERSION_FILE)
  if (!existsSync(legacyVersionFile)) return

  const backupDir = uniqueBackupDir(args.skillsRoot, args.backupTimestamp())

  const backupSkillFile = join(args.legacySkillDir, "SKILL.md")
  if (existsSync(backupSkillFile)) {
    renameSync(backupSkillFile, join(args.legacySkillDir, "SKILL.md.backup"))
  }

  renameSync(args.legacySkillDir, backupDir)
}

export function ensureBundledSkillInstalled(
  options: EnsureBundledSkillInstalledOptions,
): void {
  const skillsRoot = join(options.configDir, "opencode", "skills")
  const skillsDir = join(skillsRoot, SKILL_NAME)
  const legacySkillDir = join(skillsRoot, LEGACY_SKILL_NAME)
  const marker = join(skillsDir, "SKILL.md")
  const versionFile = join(skillsDir, INSTALL_VERSION_FILE)
  const userSkillFile = join(skillsDir, "SKILL.md")
  const userSkillBackup = join(skillsDir, "SKILL.md.user-backup")

  if (!existsSync(options.bundledSkillDir)) return

  let installedVersion = ""
  if (existsSync(versionFile)) {
    try {
      installedVersion = readFileSync(versionFile, "utf-8").trim()
    } catch {
      installedVersion = ""
    }
  }

  const shouldInstall = !existsSync(marker) || installedVersion !== options.packageVersion
  const tmpInstallDir = `${skillsDir}.tmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

  try {
    if (shouldInstall) {
      // Snapshot the previous ownership inventory before anything changes so a
      // malformed/missing manifest safely prunes nothing (legacy install).
      const oldManifest = readManifest(skillsDir)

      copyDirRecursive(options.bundledSkillDir, tmpInstallDir)

      if (existsSync(userSkillFile)) {
        try {
          copyFileSync(userSkillFile, userSkillBackup)
        } catch (error) {
          options.onError?.(
            `Failed to back up existing user skill file before updating ${SKILL_NAME}`,
            error,
          )
        }

        try {
          copyFileSync(userSkillFile, join(tmpInstallDir, "SKILL.md"))
        } catch {
          // If copy fails, continue with bundled SKILL.md.
        }
      }

      const newManifest = buildManifest(
        tmpInstallDir,
        options.bundledSkillDir,
        options.packageVersion,
      )
      // A recorded file is stale only when the new bundle no longer ships it —
      // derived from the bundle itself, not from the staged (possibly
      // user-overridden) copy.
      const newBundleFiles = listBundleFiles(options.bundledSkillDir)

      if (!existsSync(skillsDir)) {
        renameSync(tmpInstallDir, skillsDir)
      } else {
        // Remove only previously recorded, unmodified files the new bundle no
        // longer ships. User-authored, untracked, and locally-modified files
        // are never touched; legacy installs (no manifest) prune nothing.
        pruneStaleManagedFiles(skillsDir, oldManifest, newBundleFiles)
        copyDirRecursive(tmpInstallDir, skillsDir)
      }

      // The version marker and ownership manifest advance together, only after
      // the copy above succeeded — so a failed install never reports the new
      // version or claims ownership of files it did not write.
      writeFileSync(versionFile, `${options.packageVersion}\n`)
      writeManifest(skillsDir, newManifest)
    }

    if (existsSync(legacySkillDir)) {
      archiveLegacySkill({
        skillsRoot,
        legacySkillDir,
        backupTimestamp: options.backupTimestamp ?? defaultBackupTimestamp,
      })
    }
  } catch (error) {
    options.onError?.("Failed to install opencode-skill-creator skill", error)
  } finally {
    if (existsSync(tmpInstallDir)) {
      rmSync(tmpInstallDir, { recursive: true, force: true })
    }
  }
}
