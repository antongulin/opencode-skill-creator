import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import {
  ensureBundledSkillInstalled,
  INSTALL_MANIFEST_FILE,
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

// ---------------------------------------------------------------------------
// P42-04: the installer records an internal ownership manifest of the files it
// copied from the bundle, and prunes only a recorded file that is still
// unchanged on disk when the new bundle stops shipping it. User-authored,
// untracked, or locally-modified files are never removed; legacy installs
// without a manifest prune nothing; malformed/unsafe metadata can never delete
// outside the managed directory or follow a symlink.
//
// All fixtures use a private `configDir` under a temp dir — never a real
// global install.
// ---------------------------------------------------------------------------

function writeBundle(
  root: string,
  name: string,
  files: Record<string, string>,
): string {
  const dir = join(root, name)
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content)
  }
  return dir
}

const SKILL_MD = (name: string) =>
  ["---", `name: ${name}`, "description: Test bundle.", "---", "", "# T", ""].join("\n")

test("P42-04: a recorded unchanged file the new bundle drops is removed on upgrade", () => {
  withTempDir((root) => {
    const configDir = join(root, "config")
    const skillsDir = join(configDir, "opencode", "skills", SKILL_NAME)
    const siblingSkillDir = join(configDir, "opencode", "skills", "unrelated-skill")
    mkdirSync(siblingSkillDir, { recursive: true })
    writeFileSync(join(siblingSkillDir, "SKILL.md"), "third-party\n")

    const v1 = writeBundle(root, "bundle-v1", {
      "SKILL.md": SKILL_MD(SKILL_NAME),
      "agents/helper.md": "helper\n",
      "removed-in-v2.md": "stale\n",
    })
    const v2 = writeBundle(root, "bundle-v2", {
      "SKILL.md": SKILL_MD(SKILL_NAME),
      "agents/helper.md": "helper\n",
    })

    ensureBundledSkillInstalled({ bundledSkillDir: v1, configDir, packageVersion: "1.0.0" })
    expect(existsSync(join(skillsDir, "removed-in-v2.md"))).toBe(true)
    // A file the user added on top (never recorded) must survive the upgrade.
    writeFileSync(join(skillsDir, "user-notes.md"), "keep me\n")

    ensureBundledSkillInstalled({ bundledSkillDir: v2, configDir, packageVersion: "2.0.0" })

    // The recorded, unchanged, now-dropped file is gone...
    expect(existsSync(join(skillsDir, "removed-in-v2.md"))).toBe(false)
    // ...while current bundle files, the user's own file, and sibling skills stay.
    expect(readFileSync(join(skillsDir, "agents", "helper.md"), "utf-8")).toBe("helper\n")
    expect(readFileSync(join(skillsDir, "user-notes.md"), "utf-8")).toBe("keep me\n")
    expect(readFileSync(join(siblingSkillDir, "SKILL.md"), "utf-8")).toBe("third-party\n")
    expect(readFileSync(join(skillsDir, INSTALL_VERSION_FILE), "utf-8")).toBe("2.0.0\n")
    expect(existsSync(join(skillsDir, INSTALL_MANIFEST_FILE))).toBe(true)
  })
})

test("P42-04: a recorded file that was locally modified before being dropped is preserved", () => {
  withTempDir((root) => {
    const configDir = join(root, "config")
    const skillsDir = join(configDir, "opencode", "skills", SKILL_NAME)
    const v1 = writeBundle(root, "bundle-v1", {
      "SKILL.md": SKILL_MD(SKILL_NAME),
      "removed-in-v2.md": "stale\n",
    })
    const v2 = writeBundle(root, "bundle-v2", {
      "SKILL.md": SKILL_MD(SKILL_NAME),
    })

    ensureBundledSkillInstalled({ bundledSkillDir: v1, configDir, packageVersion: "1.0.0" })
    // The user edits the plugin-owned file; it is no longer the recorded bytes.
    writeFileSync(join(skillsDir, "removed-in-v2.md"), "locally edited\n")

    ensureBundledSkillInstalled({ bundledSkillDir: v2, configDir, packageVersion: "2.0.0" })

    // Hash mismatch -> never pruned.
    expect(readFileSync(join(skillsDir, "removed-in-v2.md"), "utf-8")).toBe("locally edited\n")
  })
})

test("P42-04: a legacy install without a manifest deletes nothing and starts tracking", () => {
  withTempDir((root) => {
    const configDir = join(root, "config")
    const skillsDir = join(configDir, "opencode", "skills", SKILL_NAME)
    // Simulate a pre-manifest install: files on disk, no manifest.
    mkdirSync(skillsDir, { recursive: true })
    writeFileSync(join(skillsDir, "SKILL.md"), SKILL_MD(SKILL_NAME))
    writeFileSync(join(skillsDir, INSTALL_VERSION_FILE), "0.0.1\n")
    writeFileSync(join(skillsDir, "ancient-untracked.md"), "keep me\n")
    expect(existsSync(join(skillsDir, INSTALL_MANIFEST_FILE))).toBe(false)

    const bundle = writeBundle(root, "bundle", {
      "SKILL.md": SKILL_MD(SKILL_NAME),
      "agents/helper.md": "helper\n",
    })
    ensureBundledSkillInstalled({ bundledSkillDir: bundle, configDir, packageVersion: "9.9.9" })

    // No manifest -> nothing guessed as stale -> the arbitrary file survives.
    expect(readFileSync(join(skillsDir, "ancient-untracked.md"), "utf-8")).toBe("keep me\n")
    // Tracking now exists for future upgrades.
    expect(existsSync(join(skillsDir, INSTALL_MANIFEST_FILE))).toBe(true)
  })
})

test("P42-04: unsafe or malformed manifest metadata cannot delete outside the managed dir", () => {
  withTempDir((root) => {
    const configDir = join(root, "config")
    const skillsDir = join(configDir, "opencode", "skills", SKILL_NAME)
    const outsideTarget = join(root, "outside-target.txt")
    writeFileSync(outsideTarget, "OUTSIDE\n")
    mkdirSync(skillsDir, { recursive: true })
    writeFileSync(join(skillsDir, "SKILL.md"), SKILL_MD(SKILL_NAME))
    writeFileSync(join(skillsDir, INSTALL_VERSION_FILE), "0.0.1\n")

    // An in-dir symlink whose target lives outside the managed directory. Its
    // recorded hash matches the target, so only the lstat/no-follow rule can
    // stop it being deleted (which would delete the outside file).
    const outsideHash = createHash("sha256").update(readFileSync(outsideTarget)).digest("hex")
    symlinkSync(outsideTarget, join(skillsDir, "linked.md"), "file")

    writeFileSync(
      join(skillsDir, INSTALL_MANIFEST_FILE),
      JSON.stringify({
        schema: 1,
        packageVersion: "0.0.1",
        files: {
          "../evil.txt": outsideHash,
          "/abs/evil.txt": outsideHash,
          "nested/../../evil2.txt": outsideHash,
          "linked.md": outsideHash,
          "missing.md": outsideHash,
        },
      }),
    )

    const bundle = writeBundle(root, "bundle", { "SKILL.md": SKILL_MD(SKILL_NAME) })
    ensureBundledSkillInstalled({ bundledSkillDir: bundle, configDir, packageVersion: "2.0.0" })

    // Nothing outside the managed dir was touched, and no escape paths appeared.
    expect(readFileSync(outsideTarget, "utf-8")).toBe("OUTSIDE\n")
    expect(existsSync(join(root, "evil.txt"))).toBe(false)
    expect(existsSync(join(root, "config", "opencode", "skills", "evil.txt"))).toBe(false)
    // The symlink was not followed, so its target and the link itself survive.
    expect(lstatSync(join(skillsDir, "linked.md")).isSymbolicLink()).toBe(true)
    expect(existsSync(join(skillsDir, "missing.md"))).toBe(false)
    // The malformed manifest was replaced by a valid one after a clean upgrade.
    const manifest = JSON.parse(readFileSync(join(skillsDir, INSTALL_MANIFEST_FILE), "utf-8"))
    expect(manifest.schema).toBe(1)
    expect(manifest.files["linked.md"]).toBeUndefined()
  })
})

test("P42-04: a user's customized SKILL.md and its backup survive an upgrade while new bundle files arrive", () => {
  withTempDir((root) => {
    const configDir = join(root, "config")
    const skillsDir = join(configDir, "opencode", "skills", SKILL_NAME)
    const v1 = writeBundle(root, "bundle-v1", { "SKILL.md": SKILL_MD(SKILL_NAME) })
    ensureBundledSkillInstalled({ bundledSkillDir: v1, configDir, packageVersion: "1.0.0" })

    // The user edits the installed SKILL.md.
    writeFileSync(join(skillsDir, "SKILL.md"), "USER CUSTOM\n")

    const v2 = writeBundle(root, "bundle-v2", {
      "SKILL.md": SKILL_MD("bundle-name"),
      "new-in-v2.md": "new\n",
    })
    ensureBundledSkillInstalled({ bundledSkillDir: v2, configDir, packageVersion: "2.0.0" })

    // The user's SKILL.md is preserved (not overwritten by the bundle's copy),
    // the backup holds the same content, and the new bundle file is installed.
    expect(readFileSync(join(skillsDir, "SKILL.md"), "utf-8")).toBe("USER CUSTOM\n")
    expect(readFileSync(join(skillsDir, "SKILL.md.user-backup"), "utf-8")).toBe("USER CUSTOM\n")
    expect(readFileSync(join(skillsDir, "new-in-v2.md"), "utf-8")).toBe("new\n")
    // The preserved user file is not recorded as plugin-owned.
    const manifest = JSON.parse(readFileSync(join(skillsDir, INSTALL_MANIFEST_FILE), "utf-8"))
    expect(manifest.files["SKILL.md"]).toBeUndefined()
  })
})

test("P42-04: an install failure is reported and never falsely advances the version", () => {
  withTempDir((root) => {
    const configDir = join(root, "config")
    const skillsDir = join(configDir, "opencode", "skills", SKILL_NAME)
    const v1 = writeBundle(root, "bundle-v1", { "SKILL.md": SKILL_MD(SKILL_NAME) })
    ensureBundledSkillInstalled({ bundledSkillDir: v1, configDir, packageVersion: "1.0.0" })

    // A broken bundle (a file where a directory is required) makes the copy throw.
    const brokenBundle = join(root, "broken-bundle")
    writeFileSync(brokenBundle, "not a directory")
    const errors: Array<{ message: string; error: unknown }> = []

    expect(() =>
      ensureBundledSkillInstalled({
        bundledSkillDir: brokenBundle,
        configDir,
        packageVersion: "2.0.0",
        onError: (message, error) => errors.push({ message, error }),
      }),
    ).not.toThrow()

    expect(errors).toHaveLength(1)
    expect(errors[0].message).toBe("Failed to install opencode-skill-creator skill")
    // The version marker still reflects the last successful install.
    expect(readFileSync(join(skillsDir, INSTALL_VERSION_FILE), "utf-8")).toBe("1.0.0\n")
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
