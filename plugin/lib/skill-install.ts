import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs"
import { basename, join } from "path"

export const SKILL_NAME = "opencode-skill-creator"
export const LEGACY_SKILL_NAME = "skill-creator"
export const INSTALL_VERSION_FILE = ".opencode-skill-creator-version"

export interface EnsureBundledSkillInstalledOptions {
  bundledSkillDir: string
  configDir: string
  packageVersion: string
  backupTimestamp?: () => string
  onError?: (message: string, error: unknown) => void
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

function defaultBackupTimestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "")
}

/**
 * Remove the contents of the plugin-managed skill directory before an
 * incremental copy, except the given file names that must survive the wipe.
 */
function clearManagedSkillDir(skillsDir: string, keepNames: string[]): void {
  const keep = new Set(keepNames)
  for (const entry of readdirSync(skillsDir)) {
    if (keep.has(entry)) continue
    rmSync(join(skillsDir, entry), { recursive: true, force: true })
  }
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

      if (!existsSync(skillsDir)) {
        renameSync(tmpInstallDir, skillsDir)
      } else {
        // Incremental copy would keep files deleted upstream from earlier
        // bundle versions. Only the plugin-managed skill dir is cleared, and
        // the plugin's own markers (version file, user SKILL.md backup) are
        // kept; the legacy dir and any other skill dirs are never touched.
        clearManagedSkillDir(skillsDir, [basename(userSkillBackup), basename(versionFile)])
        copyDirRecursive(tmpInstallDir, skillsDir)
      }

      writeFileSync(versionFile, `${options.packageVersion}\n`)
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
