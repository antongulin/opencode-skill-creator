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

test("archiveLegacySkill disables legacy SKILL.md before moving the legacy directory", () => {
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

// ---------------------------------------------------------------------------
// P42-04 correction: ownership metadata must be written BEFORE the version
// marker commits. A metadata-write failure must hold the old version and report
// it; a retry after the owned obstacle is removed completes the upgrade.
// ---------------------------------------------------------------------------

test("P42-04c1: a manifest-write failure holds the old version and reports, then a retry completes", () => {
  withTempDir((root) => {
    const configDir = join(root, "config")
    const skillsDir = join(configDir, "opencode", "skills", SKILL_NAME)
    const bundle = writeBundle(root, "bundle", {
      "SKILL.md": SKILL_MD(SKILL_NAME),
      "agents/helper.md": "helper\n",
    })

    // First install commits version + manifest normally.
    ensureBundledSkillInstalled({ bundledSkillDir: bundle, configDir, packageVersion: "1.0.0" })
    expect(readFileSync(join(skillsDir, INSTALL_VERSION_FILE), "utf-8")).toBe("1.0.0\n")

    // Seed an OWNED obstacle: a directory where the manifest file must be
    // written makes the manifest write fail deterministically (EISDIR).
    rmSync(join(skillsDir, INSTALL_MANIFEST_FILE), { force: true })
    mkdirSync(join(skillsDir, INSTALL_MANIFEST_FILE))

    const errors: Array<{ message: string; error: unknown }> = []
    expect(() =>
      ensureBundledSkillInstalled({
        bundledSkillDir: bundle,
        configDir,
        packageVersion: "2.0.0",
        onError: (message, error) => errors.push({ message, error }),
      }),
    ).not.toThrow()

    // The upgrade did NOT falsely report the new version.
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toBe("Failed to install opencode-skill-creator skill")
    expect(readFileSync(join(skillsDir, INSTALL_VERSION_FILE), "utf-8")).toBe("1.0.0\n")

    // Remove the owned obstacle and retry: the upgrade now commits cleanly.
    rmSync(join(skillsDir, INSTALL_MANIFEST_FILE), { recursive: true, force: true })
    ensureBundledSkillInstalled({ bundledSkillDir: bundle, configDir, packageVersion: "2.0.0" })
    expect(readFileSync(join(skillsDir, INSTALL_VERSION_FILE), "utf-8")).toBe("2.0.0\n")
    const manifest = JSON.parse(readFileSync(join(skillsDir, INSTALL_MANIFEST_FILE), "utf-8"))
    expect(manifest.schema).toBe(1)
    expect(manifest.packageVersion).toBe("2.0.0")
  })
})

// ---------------------------------------------------------------------------
// P42-04 correction: reserved root paths are never owned/pruned, even when a
// well-formed manifest records them with a matching hash.
// ---------------------------------------------------------------------------

test("P42-04c2: a user SKILL.md identical to the bundle is still excluded from the inventory", () => {
  withTempDir((root) => {
    const configDir = join(root, "config")
    const skillsDir = join(configDir, "opencode", "skills", SKILL_NAME)
    const bundle = writeBundle(root, "bundle", {
      "SKILL.md": SKILL_MD(SKILL_NAME),
      "agents/helper.md": "helper\n",
    })
    ensureBundledSkillInstalled({ bundledSkillDir: bundle, configDir, packageVersion: "1.0.0" })

    // The installed SKILL.md is byte-identical to the bundle's, yet it must
    // never be recorded as plugin-owned.
    const manifest = JSON.parse(readFileSync(join(skillsDir, INSTALL_MANIFEST_FILE), "utf-8"))
    expect(manifest.files["SKILL.md"]).toBeUndefined()
    expect(manifest.files[INSTALL_VERSION_FILE]).toBeUndefined()
    expect(manifest.files[INSTALL_MANIFEST_FILE]).toBeUndefined()
    expect(manifest.files["agents/helper.md"]).toBeTypeOf("string")

    // A later upgrade that drops the bundle's SKILL.md must not delete the
    // installed SKILL.md (it was never owned).
    const v2 = writeBundle(root, "bundle2", { "agents/helper.md": "helper2\n" })
    ensureBundledSkillInstalled({ bundledSkillDir: v2, configDir, packageVersion: "2.0.0" })
    expect(existsSync(join(skillsDir, "SKILL.md"))).toBe(true)
  })
})

test("P42-04c3: a forged manifest recording reserved paths with matching hashes cannot prune them", () => {
  withTempDir((root) => {
    const configDir = join(root, "config")
    const skillsDir = join(configDir, "opencode", "skills", SKILL_NAME)
    const bundle = writeBundle(root, "bundle", { "agents/helper.md": "helper\n" })
    ensureBundledSkillInstalled({ bundledSkillDir: bundle, configDir, packageVersion: "1.0.0" })

    // Replace the installed SKILL.md / backup with sentinels and record every
    // reserved path in a WELL-FORMED manifest with a matching hash.
    writeFileSync(join(skillsDir, "SKILL.md"), "USER SKILL SENTINEL\n")
    writeFileSync(join(skillsDir, "SKILL.md.user-backup"), "USER BACKUP SENTINEL\n")
    const hash = (s: string) => createHash("sha256").update(Buffer.from(s)).digest("hex")
    const versionContent = readFileSync(join(skillsDir, INSTALL_VERSION_FILE), "utf-8")
    const manifestContent = JSON.stringify({
      schema: 1,
      packageVersion: "1.0.0",
      files: {
        "SKILL.md": hash("USER SKILL SENTINEL\n"),
        "SKILL.md.user-backup": hash("USER BACKUP SENTINEL\n"),
        [INSTALL_VERSION_FILE]: hash(versionContent),
      },
    })
    writeFileSync(join(skillsDir, INSTALL_MANIFEST_FILE), manifestContent)

    // Upgrade with a bundle that ships neither SKILL.md nor the backups.
    ensureBundledSkillInstalled({ bundledSkillDir: bundle, configDir, packageVersion: "2.0.0" })

    // Every reserved file survives (the SKILL.md is not pruned, the backup is
    // refreshed from the current user SKILL.md by the existing contract, not
    // deleted), and the forged entries are ignored.
    expect(readFileSync(join(skillsDir, "SKILL.md"), "utf-8")).toBe("USER SKILL SENTINEL\n")
    expect(readFileSync(join(skillsDir, "SKILL.md.user-backup"), "utf-8")).toBe("USER SKILL SENTINEL\n")
    expect(existsSync(join(skillsDir, INSTALL_VERSION_FILE))).toBe(true)
    expect(existsSync(join(skillsDir, INSTALL_MANIFEST_FILE))).toBe(true)
    // The rewritten manifest is clean (no reserved entries).
    const rewritten = JSON.parse(readFileSync(join(skillsDir, INSTALL_MANIFEST_FILE), "utf-8"))
    expect(rewritten.files["SKILL.md"]).toBeUndefined()
    expect(rewritten.files["SKILL.md.user-backup"]).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// P42-04 correction: prune must never follow a symlink — not the managed-dir
// root, not any intermediate component. Real FS, no mocks.
// ---------------------------------------------------------------------------

test("P42-04c4: an internal ancestor symlink alias is not pruned through", () => {
  withTempDir((root) => {
    const configDir = join(root, "config")
    const skillsDir = join(configDir, "opencode", "skills", SKILL_NAME)
    const bundleV1 = writeBundle(root, "v1", {
      "SKILL.md": SKILL_MD(SKILL_NAME),
      "agents/helper.md": "helper\n",
    })
    ensureBundledSkillInstalled({ bundledSkillDir: bundleV1, configDir, packageVersion: "1.0.0" })

    // A physical sentinel in a real managed subdirectory, plus an ancestor
    // symlink `sub -> real` that a recorded `sub/sentinel.md` would follow.
    mkdirSync(join(skillsDir, "real"), { recursive: true })
    const physical = join(skillsDir, "real", "sentinel.md")
    writeFileSync(physical, "PHYSICAL SENTINEL\n")
    const hash = createHash("sha256").update(readFileSync(physical)).digest("hex")
    symlinkSync(join(skillsDir, "real"), join(skillsDir, "sub"), "dir")
    writeFileSync(
      join(skillsDir, INSTALL_MANIFEST_FILE),
      JSON.stringify({ schema: 1, packageVersion: "1.0.0", files: { "sub/sentinel.md": hash } }),
    )

    const bundleV2 = writeBundle(root, "v2", { "SKILL.md": SKILL_MD(SKILL_NAME) })
    ensureBundledSkillInstalled({ bundledSkillDir: bundleV2, configDir, packageVersion: "2.0.0" })

    // The ancestor symlink was detected; the physical sentinel survived and the
    // alias was not removed.
    expect(readFileSync(physical, "utf-8")).toBe("PHYSICAL SENTINEL\n")
    expect(lstatSync(join(skillsDir, "sub")).isSymbolicLink()).toBe(true)
  })
})

test("P42-04c5: an external symlink alias target outside the root is never deleted", () => {
  withTempDir((root) => {
    const configDir = join(root, "config")
    const skillsDir = join(configDir, "opencode", "skills", SKILL_NAME)
    const bundle = writeBundle(root, "bundle", { "SKILL.md": SKILL_MD(SKILL_NAME) })
    ensureBundledSkillInstalled({ bundledSkillDir: bundle, configDir, packageVersion: "1.0.0" })

    const outside = join(root, "outside.md")
    writeFileSync(outside, "OUTSIDE SENTINEL\n")
    const hash = createHash("sha256").update(readFileSync(outside)).digest("hex")
    symlinkSync(outside, join(skillsDir, "external.md"), "file")
    writeFileSync(
      join(skillsDir, INSTALL_MANIFEST_FILE),
      JSON.stringify({ schema: 1, packageVersion: "1.0.0", files: { "external.md": hash } }),
    )

    ensureBundledSkillInstalled({ bundledSkillDir: bundle, configDir, packageVersion: "2.0.0" })

    expect(readFileSync(outside, "utf-8")).toBe("OUTSIDE SENTINEL\n")
    expect(lstatSync(join(skillsDir, "external.md")).isSymbolicLink()).toBe(true)
  })
})

test("P42-04c6: a symlinked managed-dir root does no pruning even if its canonical root is external", () => {
  withTempDir((root) => {
    const configDir = join(root, "config")
    const skillsRoot = join(configDir, "opencode", "skills")
    const skillsDir = join(skillsRoot, SKILL_NAME)
    mkdirSync(skillsRoot, { recursive: true })

    // The managed dir itself is a symlink to an external directory holding a
    // sentinel that a matching manifest entry could target.
    const external = join(root, "external-real")
    mkdirSync(external, { recursive: true })
    writeFileSync(join(external, "sentinel.md"), "EXTERNAL ROOT SENTINEL\n")
    const hash = createHash("sha256").update(readFileSync(join(external, "sentinel.md"))).digest("hex")
    symlinkSync(external, skillsDir, "dir")

    // A legacy-looking install: a version marker and manifest inside the target.
    writeFileSync(join(external, INSTALL_VERSION_FILE), "0.0.1\n")
    writeFileSync(
      join(external, INSTALL_MANIFEST_FILE),
      JSON.stringify({ schema: 1, packageVersion: "0.0.1", files: { "sentinel.md": hash } }),
    )

    const bundle = writeBundle(root, "bundle", { "SKILL.md": SKILL_MD(SKILL_NAME) })
    ensureBundledSkillInstalled({ bundledSkillDir: bundle, configDir, packageVersion: "2.0.0" })

    // The symlinked root makes every path resolve elsewhere: no prune happens.
    expect(readFileSync(join(external, "sentinel.md"), "utf-8")).toBe("EXTERNAL ROOT SENTINEL\n")
    expect(lstatSync(skillsDir).isSymbolicLink()).toBe(true)
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
