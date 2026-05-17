import { expect, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import {
  ensureBundledSkillInstalled,
  INSTALL_VERSION_FILE,
  LEGACY_SKILL_NAME,
  SKILL_NAME,
} from "../lib/skill-install"

function withTempDir(callback: (path: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "osc-skill-install-"))
  try {
    callback(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function createBundledSkill(root: string) {
  const bundledSkillDir = join(root, "bundled-skill")
  mkdirSync(join(bundledSkillDir, "agents"), { recursive: true })
  writeFileSync(
    join(bundledSkillDir, "SKILL.md"),
    [
      "---",
      `name: ${SKILL_NAME}`,
      "description: Test bundled OpenCode skill creator.",
      "---",
      "",
      "# OpenCode Skill Creator",
      "",
    ].join("\n"),
  )
  writeFileSync(join(bundledSkillDir, "agents", "helper.md"), "helper\n")
  return bundledSkillDir
}

test("ensureBundledSkillInstalled installs the bundled skill under the opencode-specific name", () => {
  withTempDir((root) => {
    const bundledSkillDir = createBundledSkill(root)
    const configDir = join(root, "config")

    ensureBundledSkillInstalled({
      bundledSkillDir,
      configDir,
      packageVersion: "1.2.3",
    })

    const installedSkillDir = join(configDir, "opencode", "skills", SKILL_NAME)
    const legacySkillDir = join(configDir, "opencode", "skills", LEGACY_SKILL_NAME)

    expect(existsSync(join(installedSkillDir, "SKILL.md"))).toBe(true)
    expect(readFileSync(join(installedSkillDir, "SKILL.md"), "utf-8")).toContain(
      `name: ${SKILL_NAME}`,
    )
    expect(readFileSync(join(installedSkillDir, INSTALL_VERSION_FILE), "utf-8")).toBe(
      "1.2.3\n",
    )
    expect(existsSync(legacySkillDir)).toBe(false)
  })
})

test("ensureBundledSkillInstalled archives plugin-owned legacy skill folders so the generic skill name stops loading", () => {
  withTempDir((root) => {
    const bundledSkillDir = createBundledSkill(root)
    const configDir = join(root, "config")
    const skillsRoot = join(configDir, "opencode", "skills")
    const legacySkillDir = join(skillsRoot, LEGACY_SKILL_NAME)
    mkdirSync(legacySkillDir, { recursive: true })
    writeFileSync(join(legacySkillDir, INSTALL_VERSION_FILE), "0.1.0\n")
    writeFileSync(join(legacySkillDir, "SKILL.md"), "legacy custom skill\n")

    ensureBundledSkillInstalled({
      bundledSkillDir,
      configDir,
      packageVersion: "1.2.3",
      backupTimestamp: () => "20260516-153045",
    })

    const installedSkillDir = join(skillsRoot, SKILL_NAME)
    const backupDir = join(
      skillsRoot,
      `${LEGACY_SKILL_NAME}.opencode-skill-creator-backup-20260516-153045`,
    )

    expect(existsSync(join(installedSkillDir, "SKILL.md"))).toBe(true)
    expect(existsSync(legacySkillDir)).toBe(false)
    expect(existsSync(join(backupDir, "SKILL.md"))).toBe(false)
    expect(readFileSync(join(backupDir, "SKILL.md.backup"), "utf-8")).toBe(
      "legacy custom skill\n",
    )
  })
})

test("ensureBundledSkillInstalled leaves unmarked legacy skill folders untouched", () => {
  withTempDir((root) => {
    const bundledSkillDir = createBundledSkill(root)
    const configDir = join(root, "config")
    const skillsRoot = join(configDir, "opencode", "skills")
    const legacySkillDir = join(skillsRoot, LEGACY_SKILL_NAME)
    mkdirSync(legacySkillDir, { recursive: true })
    writeFileSync(join(legacySkillDir, "SKILL.md"), "third-party skill\n")

    ensureBundledSkillInstalled({
      bundledSkillDir,
      configDir,
      packageVersion: "1.2.3",
    })

    expect(readFileSync(join(legacySkillDir, "SKILL.md"), "utf-8")).toBe(
      "third-party skill\n",
    )
    expect(existsSync(join(skillsRoot, SKILL_NAME, "SKILL.md"))).toBe(true)
  })
})

test("ensureBundledSkillInstalled keeps archiving legacy folders when a timestamped backup already exists", () => {
  withTempDir((root) => {
    const bundledSkillDir = createBundledSkill(root)
    const configDir = join(root, "config")
    const skillsRoot = join(configDir, "opencode", "skills")
    const legacySkillDir = join(skillsRoot, LEGACY_SKILL_NAME)
    const existingBackupDir = join(
      skillsRoot,
      `${LEGACY_SKILL_NAME}.opencode-skill-creator-backup-20260516-153045`,
    )
    mkdirSync(legacySkillDir, { recursive: true })
    mkdirSync(existingBackupDir, { recursive: true })
    writeFileSync(join(legacySkillDir, INSTALL_VERSION_FILE), "0.1.0\n")
    writeFileSync(join(legacySkillDir, "SKILL.md"), "legacy custom skill\n")
    writeFileSync(join(existingBackupDir, "SKILL.md.backup"), "older backup\n")

    ensureBundledSkillInstalled({
      bundledSkillDir,
      configDir,
      packageVersion: "1.2.3",
      backupTimestamp: () => "20260516-153045",
    })

    const collisionBackupDir = join(
      skillsRoot,
      `${LEGACY_SKILL_NAME}.opencode-skill-creator-backup-20260516-153045-1`,
    )

    expect(existsSync(legacySkillDir)).toBe(false)
    expect(readFileSync(join(existingBackupDir, "SKILL.md.backup"), "utf-8")).toBe(
      "older backup\n",
    )
    expect(readFileSync(join(collisionBackupDir, "SKILL.md.backup"), "utf-8")).toBe(
      "legacy custom skill\n",
    )
  })
})

test("ensureBundledSkillInstalled reports install failures without throwing", () => {
  withTempDir((root) => {
    const bundledSkillDir = join(root, "not-a-directory")
    const errors: Array<{ message: string; error: unknown }> = []
    writeFileSync(bundledSkillDir, "not a directory")

    expect(() =>
      ensureBundledSkillInstalled({
        bundledSkillDir,
        configDir: join(root, "config"),
        packageVersion: "1.2.3",
        onError: (message, error) => errors.push({ message, error }),
      }),
    ).not.toThrow()

    expect(errors).toHaveLength(1)
    expect(errors[0].message).toBe("Failed to install opencode-skill-creator skill")
    expect(errors[0].error).toBeInstanceOf(Error)
  })
})

test("ensureBundledSkillInstalled reports user skill backup failures before continuing", () => {
  withTempDir((root) => {
    const bundledSkillDir = createBundledSkill(root)
    const configDir = join(root, "config")
    const skillsDir = join(configDir, "opencode", "skills", SKILL_NAME)
    const userSkillFile = join(skillsDir, "SKILL.md")
    const userSkillBackup = join(skillsDir, "SKILL.md.user-backup")
    const errors: Array<{ message: string; error: unknown }> = []

    mkdirSync(dirname(userSkillFile), { recursive: true })
    writeFileSync(userSkillFile, "user-customized skill\n")
    mkdirSync(userSkillBackup)

    ensureBundledSkillInstalled({
      bundledSkillDir,
      configDir,
      packageVersion: "1.2.3",
      onError: (message, error) => errors.push({ message, error }),
    })

    expect(errors).toHaveLength(1)
    expect(errors[0].message).toBe(
      `Failed to back up existing user skill file before updating ${SKILL_NAME}`,
    )
    expect(errors[0].error).toBeInstanceOf(Error)
    expect(basename(userSkillBackup)).toBe("SKILL.md.user-backup")
    expect(readFileSync(userSkillFile, "utf-8")).toBe("user-customized skill\n")
    expect(readFileSync(join(skillsDir, INSTALL_VERSION_FILE), "utf-8")).toBe(
      "1.2.3\n",
    )
  })
})

test("archiveLegacySkill disables legacy SKILL.md before moving the legacy directory", () => {
  const source = readFileSync(join(import.meta.dir, "..", "lib", "skill-install.ts"), "utf-8")
  const disableSkillIndex = source.indexOf(
    'renameSync(backupSkillFile, join(args.legacySkillDir, "SKILL.md.backup"))',
  )
  const moveDirectoryIndex = source.indexOf("renameSync(args.legacySkillDir, backupDir)")

  expect(disableSkillIndex).toBeGreaterThanOrEqual(0)
  expect(moveDirectoryIndex).toBeGreaterThanOrEqual(0)
  expect(disableSkillIndex).toBeLessThan(moveDirectoryIndex)
})
