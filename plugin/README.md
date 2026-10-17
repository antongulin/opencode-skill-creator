# OpenCode Skill Creator

Create, evaluate, and improve OpenCode skills with a bundled workflow skill and TypeScript plugin.

[![npm](https://img.shields.io/npm/v/opencode-skill-creator)](https://www.npmjs.com/package/opencode-skill-creator)

[Website](https://skillcreator.page/) · [Documentation](https://skillcreator.page/docs/) · [Example](https://github.com/antongulin/opencode-skill-creator/tree/main/examples/docker-compose-helper) · [Source](https://github.com/antongulin/opencode-skill-creator)

## Quick start

For OpenCode V2, run this from your project directory with Node.js and npm available:

```sh
npx opencode-skill-creator install --project
```

Restart OpenCode in that project, then ask:

> Use opencode-skill-creator to create a skill that reviews Docker Compose files.

The project flag scopes plugin configuration to this project. On startup, the plugin still installs its bundled workflow skill at `$XDG_CONFIG_HOME/opencode/skills/opencode-skill-creator/`, or `~/.config/opencode/skills/opencode-skill-creator/` when unset.

Use `install --global` for all projects. V1 users need [manual setup](#supported-v1-setup-manual). See the [installation guide](https://github.com/antongulin/opencode-skill-creator/blob/main/docs/installation.md) for requirements, manual V2 configuration, verification, upgrades, and backup-first recovery.

## Install

The installer writes V2's `plugins` array. It keeps existing plugins and any legacy `plugin` array. Global installation also attempts to clear this package's stale OpenCode cache and matching Desktop plugin-fault notifications. CLI global configuration uses `~/.config/opencode/`, even when `XDG_CONFIG_HOME` points elsewhere; use the installation guide's manual configuration for a custom config root.

Configuration success does not prove the plugin loaded. Reopen the configured project and check that the bundled SKILL.md and tools are available. OpenCode obtains the npm package when loading the configuration; manual configuration still requires package access.

## Compatibility

| OpenCode | Config key | Entrypoint | Plugin SDK |
|---|---|---|---|
| **V2** (current) | `plugins` | `id` + `setup()` | `@opencode/plugin` ^2.0.0 |
| **V1** ≥ 1.18.29 | `plugin` | object `server()` | `@opencode-ai/plugin` ≥ 1.18.29 |

The published package ships both entrypoints from one bundle, so one npm package serves both
runtimes. The **automatic installer targets OpenCode V2**: it writes only the `plugins` array
and leaves any existing legacy `plugin` array untouched. OpenCode V2 reads `plugins`, while V1
reads `plugin`, so on the supported V1 floor you add the plugin to `plugin` manually and
restart OpenCode (see [Supported V1 setup (manual)](#supported-v1-setup-manual)).

Older V1 releases (before 1.18.29) only accept a function default export, which this package
no longer provides. If you must support them, pin the older `0.2.x` line, the last releases
that accepted the function default export. The `0.3.x` line requires the `>= 1.18.29` floor.

On the supported V1 floor, `server()` also returns a `dispose()` hook. OpenCode calls it when
the plugin is unloaded, so it can release review servers started through `skill_serve_review`.
V2 uses the cleanup closure that `setup()` returns. Both release only the servers the instance started.

### Supported V1 setup (manual)

The installer does not configure V1. To use the supported V1 floor (>= 1.18.29), register the
package under the singular `plugin` key yourself:

1. Open (or create) `~/.config/opencode/opencode.json` (or the project `opencode.json`).
2. Add the package to the `plugin` array (keep any existing entries):

   ```json
   {
     "plugin": ["opencode-skill-creator"]
   }
   ```

3. Restart OpenCode in the configured project to load the plugin.

Do not add the package to **both** keys as a routine setup: V1 ignores `plugins`, and a mixed
config can change which entries other plugins load. One exception: the installer upgrades a V1
config by appending to `plugins` while preserving the existing legacy `plugin` array, so an
upgraded config can legitimately contain both. After upgrading, keep only the key your runtime
uses and preserve the other entries you still want — the installer does not remove or rewrite
your existing plugin lists.

## What it does

Use the workflow to draft a skill, generate trigger evals, optimize its description, compare benchmarks, and review task outputs. Trigger evals measure selection of a skill, not task-output quality. Use paired graded outputs and human review for quality comparisons.

This independent OpenCode adaptation of [Anthropic's skill-creator](https://github.com/anthropics/skills/tree/main/skills/skill-creator) ports the automation from Python to TypeScript. Model/provider behavior varies and their usage can cost money.

## Plugin tools

| Tool | Purpose |
|---|---|
| `skill_validate` | Validate SKILL.md structure and frontmatter |
| `skill_parse` | Read name, description, and full content |
| `skill_eval` | Measure description trigger accuracy |
| `skill_improve_description` | Propose a description from eval failures |
| `skill_optimize_loop` | Evaluate and improve descriptions with a train/test split |
| `skill_aggregate_benchmark` | Summarize grading, timing, and token usage |
| `skill_generate_report` | Write an HTML description-optimization report |
| `skill_serve_review` | Start an HTTP review viewer |
| `skill_stop_review` | Stop review servers owned by this plugin instance |
| `skill_export_static_review` | Write a standalone HTML review |
| `skill_add_gold_standard` | Save a skill description example with its observed pass rate |
| `skill_list_gold_standards` | List all saved description examples |
| `skill_remove_gold_standard` | Remove a saved description example by ID |
| `skill_get_gold_advice` | Format saved description examples for prompt context |

See the [complete tool reference](https://github.com/antongulin/opencode-skill-creator/blob/main/docs/tools.md) for required inputs, defaults, eval behavior, and review setup. Gold standards are **skill description examples**, rather than task responses. Listing returns all saved examples; advice formats them for prompt context without running optimization.

## Usage

Ask OpenCode to use opencode-skill-creator to create a skill or improve an existing description. The [Docker Compose example](https://github.com/antongulin/opencode-skill-creator/tree/main/examples/docker-compose-helper) includes the skill, trigger eval JSON, and tool prompts.

Review tools require paired `with_skill` and `without_skill` or `old_skill` runs by default. For automation, pass `openBrowser: false` to `skill_serve_review` or set `OPENCODE_SKILL_CREATOR_OPEN_BROWSER=0`. Stop the server with `skill_stop_review` when finished. See [review details](https://github.com/antongulin/opencode-skill-creator/blob/main/docs/tools.md#review-task-outputs).

## Architecture

The Markdown skill supplies workflow instructions; the plugin supplies executable tools. OpenCode loads compiled JavaScript from `dist/skill-creator.js`. Asset paths use `import.meta.url` for Desktop compatibility. The bundle imports runtime `tool` support from the required `@opencode-ai/plugin` peer; `@opencode/plugin` is an optional peer used to type-check the V2 source build. Package metadata declares Node.js ≥ 18.

Startup installs the bundled skill at user level. Updates attempt to retain customized SKILL.md and refresh support files, which can overwrite edits. Use [backup-first recovery](https://github.com/antongulin/opencode-skill-creator/blob/main/docs/installation.md#reset-the-bundled-skill) for a reset. It does not upgrade the npm plugin.

[Development and source layout](https://github.com/antongulin/opencode-skill-creator/blob/main/CONTRIBUTING.md) · [Private security reports](https://github.com/antongulin/opencode-skill-creator/blob/main/SECURITY.md)

Built by [Anton Gulin](https://skillcreator.page/about/). [Sponsor the project](https://skillcreator.page/sponsor/).

## License

[Apache License 2.0](https://github.com/antongulin/opencode-skill-creator/blob/main/LICENSE). Based on [anthropics/skills](https://github.com/anthropics/skills) by Anthropic.
