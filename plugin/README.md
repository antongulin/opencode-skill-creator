# opencode-skill-creator

[![npm](https://img.shields.io/npm/v/opencode-skill-creator)](https://www.npmjs.com/package/opencode-skill-creator)

A **skill + plugin** for [OpenCode](https://opencode.ai) that helps you create, test, and optimize other OpenCode skills.

This is a faithful adaptation of Anthropic's official [skill-creator](https://github.com/anthropics/skills/tree/main/skills/skill-creator) for Claude Code, fully rewritten to work with OpenCode's extensibility mechanisms. The Python scripts from the original have been ported to TypeScript and packaged as an OpenCode plugin with custom tools.

## Install

Package: https://www.npmjs.com/package/opencode-skill-creator

### Pick your option

| If you are... | Use this |
|---|---|
| New to OpenCode / non-developer | **Option A (Recommended)** |
| Already using other plugins | **Option B** |
| Setting up all projects on your computer | **Option C (Global config)** |
| Setting up only one project | **Option D (Project config)** |
| Cannot use npm / offline environment | **Option E (Manual install)** |

### Option A (Recommended): easiest setup for most users

Run one command (global install, recommended):

```bash
npx opencode-skill-creator install --global
```

Optional checks:

```bash
npx opencode-skill-creator --version
npx opencode-skill-creator --help
npx opencode-skill-creator --about
```

What this command does:

1. Creates/updates `~/.config/opencode/opencode.json`
2. Adds `"opencode-skill-creator"` to the `plugin` array
3. Leaves your existing plugins untouched

Then:

4. Restart OpenCode
5. Ask OpenCode: `Create a skill that helps with Docker compose files`

That's it.

Manual equivalent for the same result:

1. Open (or create) `~/.config/opencode/opencode.json`
2. Paste this:

```json
{
  "plugin": ["opencode-skill-creator"]
}
```

3. Restart OpenCode.

If you want project-only install instead, use:

```bash
npx opencode-skill-creator install --project
```

### Option B: you already have plugins

If your file already has plugins, append this package to the list:

```json
{
  "plugin": [
    "your-existing-plugin",
    "opencode-skill-creator"
  ]
}
```

Do not remove your existing plugins.

### Option C: global config (works in all projects)

Use global config when you want this plugin available everywhere.

Command version:

```bash
npx opencode-skill-creator install --global
```

1. Open (or create) `~/.config/opencode/opencode.json`
2. Add:

```json
{
  "plugin": ["opencode-skill-creator"]
}
```

3. Restart OpenCode.

### Option D: project config (only one project)

Use project config when you want this plugin only for one repo.

Command version:

```bash
npx opencode-skill-creator install --project
```

1. Open (or create) `opencode.json` in that project root
2. Add:

```json
{
  "plugin": ["opencode-skill-creator"]
}
```

3. Restart OpenCode in that project.

### Option E: manual install (no npm)

```bash
git clone https://github.com/antongulin/opencode-skill-creator.git
cd opencode-skill-creator

# Install the skill (global)
cp -r skill-creator/ ~/.config/opencode/skills/skill-creator/

# Install the plugin (global)
cp -r plugin/ ~/.config/opencode/plugins/skill-creator/
```

Then create `~/.config/opencode/package.json` if needed:

```json
{
  "dependencies": {
    "@opencode-ai/plugin": ">=1.0.0"
  }
}
```

### What happens after install

After you add `opencode-skill-creator` and restart OpenCode:

1. OpenCode installs the plugin from npm automatically.
2. On first plugin startup, it auto-copies skill files to:
   - `~/.config/opencode/skills/skill-creator/`
3. The skill becomes available automatically in your sessions.

### Verify install

Check that the skill file exists:

```bash
ls ~/.config/opencode/skills/skill-creator/SKILL.md
```

Then ask OpenCode:

```text
Create a skill that helps with API documentation.
```

You should see it use the skill-creator workflow/tools.

### Troubleshooting

- `I don't have opencode.json`: create one in project root (or use global config path).
- `Nothing changed after edit`: fully restart OpenCode.
- `I already had plugins`: keep them; just add `opencode-skill-creator` to the same array.
- `I want a clean reinstall`: delete `~/.config/opencode/skills/skill-creator/` and restart OpenCode.
- `npx command failed`: run `npx opencode-skill-creator --help` and then use `install` or `install --global`.

### For LLMs / automation (compact)

```json
{ "plugin": ["opencode-skill-creator"] }
```

## What it does

When loaded, this skill guides OpenCode through the full skill development lifecycle:

1. **Analyze** the user's request and determine what kind of skill to build
2. **Create** a well-structured skill with proper frontmatter, SKILL.md, and supporting files
3. **Generate** an eval set of test queries (should-trigger and should-not-trigger)
4. **Evaluate** the skill's description by testing whether it triggers correctly
5. **Optimize** the description through iterative improvement loops
6. **Benchmark** skill performance with variance analysis
7. **Install** the skill to the project or global OpenCode skills directory

## Plugin tools

The plugin registers these custom tools that OpenCode can call:

| Tool | Purpose |
|------|---------|
| `skill_validate` | Validate SKILL.md structure and frontmatter |
| `skill_parse` | Parse SKILL.md and extract name/description |
| `skill_eval` | Test trigger accuracy for eval queries |
| `skill_improve_description` | LLM-powered description improvement |
| `skill_optimize_loop` | Full eval->improve optimization loop |
| `skill_aggregate_benchmark` | Aggregate grading results into statistics |
| `skill_generate_report` | Generate HTML optimization report |
| `skill_serve_review` | Start the eval review viewer (HTTP server) |
| `skill_stop_review` | Stop a running review server |
| `skill_export_static_review` | Generate standalone HTML review file |

### Review workflow guard (strict by default)

The review launch tools now enforce paired comparison data by default:

- `skill_serve_review` and `skill_export_static_review` require each `eval-*` directory to include:
  - `with_skill`
  - baseline (`without_skill` or `old_skill`)
- If pairs are missing, the tools fail fast with a clear list of missing items.
- Override only when intentionally reviewing partial data by passing `allowPartial: true`.
- If `benchmarkPath` is omitted, the tools auto-generate `benchmark.json` and `benchmark.md` in the workspace.

## Usage

Once installed, OpenCode will automatically detect the skill when you ask it to create or improve a skill. For example:

- "Create a skill that helps with Docker compose files"
- "Build me a skill for generating API documentation"
- "Help me make a skill that assists with database migrations"
- "Optimize the description of my existing skill"

OpenCode will load the skill-creator instructions and use the plugin tools to walk through the full workflow.

## Architecture

This project has two components:

| Component | What it is |
|-----------|-----------|
| **Skill** | Markdown instructions (SKILL.md + agents + templates) that tell the agent how to create, evaluate, and improve skills |
| **Plugin** | TypeScript module that registers custom tools for validation, eval, benchmarking, and review |

The skill provides the workflow knowledge; the plugin provides the executable tools the agent calls during that workflow.

On first startup, the plugin automatically copies the bundled skill files to `~/.config/opencode/skills/skill-creator/`. If you need to reinstall the skill (e.g., after an update), delete that directory and restart OpenCode.

## Project structure

```
opencode-skill-creator/
├── README.md
├── LICENSE                            # Apache 2.0
├── skill-creator/                     # The SKILL
│   ├── SKILL.md                       # Main skill instructions
│   ├── agents/
│   │   ├── grader.md                  # Assertion evaluation
│   │   ├── analyzer.md                # Benchmark analysis
│   │   └── comparator.md              # Blind A/B comparison
│   ├── references/
│   │   └── schemas.md                 # JSON schema definitions
│   └── templates/
│       └── eval-review.html           # Eval set review/edit UI
└── plugin/                            # The PLUGIN (npm: opencode-skill-creator)
    ├── package.json                   # npm package metadata
    ├── skill-creator.ts               # Entry point — registers all tools
    ├── skill/                         # Bundled copy of skill (auto-installed)
    ├── lib/
    │   ├── utils.ts                   # SKILL.md frontmatter parsing
    │   ├── validate.ts                # Skill structure validation
    │   ├── run-eval.ts                # Trigger evaluation via opencode run
    │   ├── improve-description.ts     # LLM-powered description improvement
    │   ├── run-loop.ts                # Eval→improve optimization loop
    │   ├── aggregate.ts               # Benchmark aggregation
    │   ├── report.ts                  # HTML report generation
    │   └── review-server.ts           # Eval review HTTP server
    └── templates/
        └── viewer.html                # Eval review viewer UI
```

## Differences from the Anthropic original

| Area | Anthropic (Claude Code) | This repo (OpenCode) |
|------|------------------------|---------------------|
| CLI invocation | `claude -p "prompt"` | `opencode run "prompt"` |
| Skill location | `.claude/commands/` | `.opencode/skills/` |
| Automation scripts | Python (`scripts/*.py`) | TypeScript plugin (`plugin/lib/*.ts`) |
| Script execution | `python -m scripts.run_loop` | `skill_optimize_loop` tool call |
| Eval viewer | `python generate_review.py` | `skill_serve_review` tool call |
| Benchmarking | `python aggregate_benchmark.py` | `skill_aggregate_benchmark` tool call |
| Dependencies | Python 3.11+, pyyaml | Bun (via OpenCode), @opencode-ai/plugin |
| Packaging | `.skill` zip files | npm package + skill directory |
| Subagents | Built-in subagent concept | Task tool with `general`/`explore` types |

## License

Apache License 2.0 — see [LICENSE](LICENSE) for details.

Based on [anthropics/skills](https://github.com/anthropics/skills) by Anthropic.
