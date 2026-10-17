# OpenCode Skill Creator

[![OpenCode Skill Creator — Build better skills. Create. Evaluate. Improve.](docs/assets/readme-hero.png)](https://skillcreator.page/)

Create, evaluate, and improve OpenCode skills with a bundled workflow skill and TypeScript plugin.

[![npm](https://img.shields.io/npm/v/opencode-skill-creator)](https://www.npmjs.com/package/opencode-skill-creator)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/antongulin/opencode-skill-creator?style=social)](https://github.com/antongulin/opencode-skill-creator/stargazers)

[Website](https://skillcreator.page/) · [Documentation](https://skillcreator.page/docs/) · [Examples](examples/docker-compose-helper/) · [npm](https://www.npmjs.com/package/opencode-skill-creator)

## Quick start

For OpenCode V2, run this from your project directory with Node.js and npm available:

```sh
npx opencode-skill-creator install --project
```

Restart OpenCode in that project, then ask:

> Use opencode-skill-creator to create a skill that reviews Docker Compose files.

The project flag scopes **plugin configuration** to that project. At startup, the plugin still installs its bundled skill in the user-level OpenCode skills directory: `$XDG_CONFIG_HOME/opencode/skills/opencode-skill-creator/` when set, otherwise `~/.config/opencode/skills/opencode-skill-creator/`.

For all projects, use `install --global`. OpenCode V1 ≥ 1.18.29 needs [manual V1 setup](plugin/README.md#supported-v1-setup-manual). See [installation](docs/installation.md) for requirements, verification, and recovery.

## What it does

- Draft a skill with SKILL.md frontmatter and supporting files.
- Build should-trigger and should-not-trigger eval queries.
- Measure description trigger accuracy and improve it with a train/test split.
- Compare graded task outputs, timing, and tokens across runs.
- Review paired outputs in an HTML viewer before installing your finished skill.

This independent adaptation of [Anthropic's skill-creator](https://github.com/anthropics/skills/tree/main/skills/skill-creator) ports its Python automation to TypeScript for [OpenCode](https://opencode.ai). Trigger evals measure skill selection; use graded task outputs and human review to assess output quality. Model and provider behavior varies. The code is open source; model/provider usage can cost money.

## Install

The [installation guide](docs/installation.md) covers project and global configuration, manual configuration without the CLI, compatibility, upgrades, and backup-first recovery. The installer targets V2's `plugins` key and preserves existing entries, including a legacy `plugin` array.

| OpenCode | Configuration | Setup |
|---|---|---|
| V2 | `plugins` | Project quick start above or manual configuration |
| V1 ≥ 1.18.29 | `plugin` | [Supported V1 setup](plugin/README.md#supported-v1-setup-manual) |
| V1 before 1.18.29 | Function default export | Use the older `0.2.x` line; the current bundle does not provide that entrypoint |

## Plugin tools

The plugin exposes 14 tools:

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

See the [tool reference](docs/tools.md) for inputs, defaults, eval isolation, parser limits, and the review workflow.

## Usage

After installation, ask OpenCode to use the workflow:

- “Use opencode-skill-creator to build a skill for API documentation.”
- “Use opencode-skill-creator to improve the description of my existing skill.”
- “Create should-trigger and should-not-trigger queries, then evaluate this skill.”

## Examples

Start with the [Docker Compose helper](examples/docker-compose-helper/) for a complete small skill, eval-set JSON, and prompts for `skill_eval`, `skill_optimize_loop`, and benchmark review.

Draft skills and eval workspaces in a system temp directory outside your source repository. Install the finished skill under `.opencode/skills/<skill-name>/` for a project or the effective user-level OpenCode skills directory. The [tool guide](docs/tools.md#drafts-and-eval-workspaces) includes platform path examples.

## Architecture

| Component | Responsibility |
|---|---|
| Bundled skill | Markdown workflow, grading/analyzing/comparison agents, schemas, and templates |
| Plugin | Validation, trigger evals, description optimization, benchmark aggregation, and review tools |

OpenCode loads the compiled `dist/skill-creator.js` bundle through its V1 or V2 entrypoint. Plugin startup installs or updates the bundled skill at user level, even with project configuration. Updates attempt to retain a customized SKILL.md but refresh bundled support files. Read [upgrade and recovery guidance](docs/installation.md#upgrades-and-customizations) before resetting or restoring files.

### Source map

- `opencode-skill-creator/`: source skill, `agents/`, `references/schemas.md`, and `templates/eval-review.html`.
- `plugin/skill/`: bundled copy of that skill; keep it aligned with the source.
- `plugin/skill-creator.ts` and `plugin/runtime-entry.ts`: tool registration and runtime entrypoints.
- `plugin/lib/`: parsing, validation, evals, optimization, aggregation, installation, and review servers.
- `plugin/templates/viewer.html`: task-output review viewer; `plugin/dist/`: build output shipped on npm.
- `examples/`: runnable workflow examples; `docs/`: installation, tool reference, and publishing assessment.

### Differences from the Anthropic original

The original workflow uses Claude CLI calls and Python scripts. This version invokes `opencode run` for evals and description improvement, exposes tools such as `skill_optimize_loop` and `skill_aggregate_benchmark`, and serves review through `skill_serve_review`. Distribution uses an npm plugin plus a skill directory rather than a `.skill` archive. It targets OpenCode; Anthropic provenance does not imply support for other clients.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) for development checks and [SECURITY.md](SECURITY.md) for private vulnerability reports. Report ordinary bugs in [GitHub issues](https://github.com/antongulin/opencode-skill-creator/issues).

Built by [Anton Gulin](https://skillcreator.page/about/). [Sponsor the project](https://skillcreator.page/sponsor/).

## License

[Apache License 2.0](LICENSE). Based on [anthropics/skills](https://github.com/anthropics/skills) by Anthropic.
