# Installation and recovery

[Project overview](../README.md) · [Tool reference](tools.md) · [Website docs](https://skillcreator.page/docs/)

## Requirements

- OpenCode V2, or V1 ≥ 1.18.29 with [manual V1 configuration](../plugin/README.md#supported-v1-setup-manual).
- Node.js and npm for the installer command. The package declares Node.js ≥ 18; this is a package requirement, not a claim that each runtime/OS combination has been tested.
- Access to the npm package when OpenCode loads it. Trigger evals and description improvement invoke `opencode run`, so the CLI and a configured model/provider must be available. Provider usage can cost money.

## Project setup

From the project where you want to use the plugin:

```sh
npx opencode-skill-creator install --project
```

The CLI updates `opencode.jsonc` in the current directory if it exists; otherwise it updates or creates `opencode.json`. It appends the package to V2's `plugins` array, preserves JSONC comments and other entries, and leaves a legacy `plugin` array untouched. An existing package entry avoids a duplicate. Restart OpenCode in that project to load the plugin.

This scopes plugin registration to the project. Startup still copies the bundled workflow skill into the **user-level** skills directory:

- With `XDG_CONFIG_HOME` set: `$XDG_CONFIG_HOME/opencode/skills/opencode-skill-creator/`.
- Otherwise: `~/.config/opencode/skills/opencode-skill-creator/` (where `~` is your home directory).

## Global setup

```sh
npx opencode-skill-creator install --global
```

The CLI updates `~/.config/opencode/opencode.jsonc` if present; otherwise it uses `~/.config/opencode/opencode.json`. Running `install` without a scope flag also selects global configuration. Prefer an explicit scope.

Global installation also attempts to remove a stale cache for this package and matching OpenCode Desktop plugin-fault notifications, including when the configuration already contains the package. It preserves unrelated notifications.

The CLI global config path currently stays under `~/.config` even when `XDG_CONFIG_HOME` is set. For a custom OpenCode configuration root, use manual configuration at the effective config location. Bundled-skill installation honors `XDG_CONFIG_HOME` independently.

## Manual configuration without the installer CLI

For V2, add the package to the `plugins` array in your existing project `opencode.json(c)` or effective user config. The default user config location is `~/.config/opencode/opencode.json(c)`; with a custom XDG config root, use `$XDG_CONFIG_HOME/opencode/opencode.json(c)`. Keep existing settings and plugins:

```json
{
  "plugins": ["opencode-skill-creator"]
}
```

Restart OpenCode in the configured project. This skips the installer CLI; OpenCode still obtains the plugin from npm. It is not an offline installation recipe. For V1 ≥ 1.18.29, use the singular `plugin` key instead; see [V1 setup and entrypoint details](../plugin/README.md#supported-v1-setup-manual).

Official references: [OpenCode V2 plugins](https://opencode.ai/v2/docs/plugins) and [V1 plugins](https://opencode.ai/docs/plugins/). Restarting is a practical setup step across supported versions; some V2 changes can also reload automatically.

## Verify the installation

1. Check that the effective user-level `opencode-skill-creator/` directory contains `SKILL.md`, `agents/`, `references/`, and `templates/` after plugin startup.
2. Ask OpenCode: “Use opencode-skill-creator to create a skill that helps with API documentation.” Check that it loads the workflow and exposes tools such as `skill_validate`.
3. For trigger evaluation, confirm `opencode run` and your chosen provider work before starting a large eval set.

The CLI's “Updated” or “No changes needed” message confirms registration, not successful plugin loading. Check OpenCode's plugin/install errors if files or tools are missing. The installer also supports `--help`, `--version`, and `--about`.

## Upgrades and customizations

The startup installer copies bundled files when `SKILL.md` is missing or the installed version marker differs from the plugin version. A matching version and existing SKILL.md do not repair missing support files.

During an update, the installer attempts to retain your existing `SKILL.md` and copy it to `SKILL.md.user-backup`. That backup refreshes on updates; it is not a historical archive. Preservation is best-effort: a failed copy can leave the bundled version in place. Keep your own backup of custom work.

Updates refresh support files that the bundle still ships, which can overwrite edits to those files. The ownership manifest controls removal of dropped files: only recorded, unchanged regular files that the new bundle no longer ships qualify for pruning. Modified or untracked files remain; pruning refuses symlinked paths. Reserved SKILL.md, its backup, version marker, and manifest are never prune targets. A legacy installation without a manifest prunes nothing. The installer writes ownership metadata before the version marker; failure holds the old marker and reports an error. These writes are not an atomic transaction.

### Reset the bundled skill

Use a file manager for these steps; a reset is an exceptional repair, not a routine upgrade:

1. Close all OpenCode instances using this installation.
2. Locate the effective user-level skill directory using the XDG/default paths above.
3. Move the entire `opencode-skill-creator` directory into a new, uniquely named backup directory **outside all OpenCode skill-discovery directories**, including any custom skill paths. Keep its contents intact. Renaming it alongside other installed skills can leave it discoverable.
4. Reopen a project where this plugin is configured. Plugin startup should create a fresh skill directory. Check for fresh `SKILL.md` and the bundled `agents/`, `references/`, and `templates/` files before restoring anything.
5. If startup does not recreate those files, keep the backup, inspect the plugin/installation error, and confirm you opened a configured project. Do not discard the backup or assume a running OpenCode session proves installation succeeded.
6. Compare the backup with the fresh files and merge your customizations selectively. Do not restore the old `.opencode-skill-creator-version` marker or `.opencode-skill-creator-manifest.json` ownership metadata. Keep the backup until you have checked the result.

This resets bundled skill files from the installed plugin. It does not upgrade the npm plugin.

### Migration from the old skill-creator folder

Earlier versions used the generic `skill-creator` name. Under the effective user-level `opencode/skills/` directory, startup archives an old `skill-creator/` only if it contains this plugin's `.opencode-skill-creator-version` marker. It preserves user files, renames `SKILL.md` to `SKILL.md.backup`, and moves the folder to a timestamped `skill-creator.opencode-skill-creator-backup-…/` directory. The renamed entrypoint makes that legacy archive inactive.

Without the marker, the old folder may belong to another plugin or a manual installation; this plugin leaves it alone.

## Troubleshooting

| Symptom | Next step |
|---|---|
| No config file | Run the project installer in the intended project, or create the manual config above |
| No tools after configuration | Restart in the configured project; check the runtime's `plugins`/`plugin` key and plugin-load errors |
| CLI reports invalid JSONC | Repair the reported syntax or array type before retrying; preserve your existing entries |
| Custom XDG setup shows no change | Check the effective config path; the global CLI writes under `~/.config` |
| Missing bundled support files | Follow the backup-first reset above; a same-version startup may skip copying |
| Another generic skill-creator still appears | Check ownership of that separate skill; do not delete it as part of this plugin's reset |

The package loads compiled JavaScript from `dist/skill-creator.js`; users do not need TypeScript stripping under `node_modules`. Asset resolution uses `import.meta.url` for OpenCode Desktop. See [contributing](../CONTRIBUTING.md) for source builds and the [tool reference](tools.md) for eval-specific diagnostics.
