# opencode-skill-creator

A **skill + plugin** for [OpenCode](https://opencode.ai) that helps you create, test, and optimize other OpenCode skills.

This is a faithful adaptation of Anthropic's official [skill-creator](https://github.com/anthropics/skills/tree/main/skills/skill-creator) for Claude Code, fully rewritten to work with OpenCode's extensibility mechanisms. The Python scripts from the original have been ported to TypeScript and packaged as an OpenCode plugin with custom tools.

## Architecture

This project has two components:

| Component | What it is | How it's installed |
|-----------|-----------|-------------------|
| **Skill** (`skill-creator/`) | Markdown instructions that tell the agent how to create, evaluate, and improve skills | Copied to `.opencode/skills/` |
| **Plugin** (`plugin/`) | TypeScript module that registers custom tools for validation, eval, benchmarking, and review | Installed via npm or copied to `.opencode/plugins/` |

The skill provides the workflow knowledge; the plugin provides the executable tools the agent calls during that workflow.

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
| `skill_optimize_loop` | Full eval→improve optimization loop |
| `skill_aggregate_benchmark` | Aggregate grading results into statistics |
| `skill_generate_report` | Generate HTML optimization report |
| `skill_serve_review` | Start the eval review viewer (HTTP server) |
| `skill_stop_review` | Stop a running review server |
| `skill_export_static_review` | Generate standalone HTML review file |

## Installation

### Prerequisites

- [OpenCode](https://opencode.ai) CLI installed and configured

### Step 1: Install the plugin (via npm)

Add the plugin to your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-skill-creator"]
}
```

OpenCode will automatically install it via Bun at startup.

### Step 2: Install the skill

The skill (markdown instructions + templates) must be copied into your skills directory. Clone this repo and copy the `skill-creator/` directory:

```bash
git clone https://github.com/antongulin/opencode-skill-creator.git
```

**Global (recommended — available in all projects):**

```bash
cp -r opencode-skill-creator/skill-creator/ ~/.config/opencode/skills/skill-creator/
```

**Project-level (available only in one project):**

```bash
cp -r opencode-skill-creator/skill-creator/ .opencode/skills/skill-creator/
```

### Step 3: Verify

Open OpenCode and ask it to create a skill. It should automatically detect and load the skill-creator, and the plugin tools (`skill_validate`, `skill_eval`, etc.) should be available.

### Alternative: Manual plugin installation

If you prefer not to use npm, you can copy the plugin directory directly:

```bash
# Global
cp -r opencode-skill-creator/plugin/ ~/.config/opencode/plugins/skill-creator/

# Or project-level
cp -r opencode-skill-creator/plugin/ .opencode/plugins/skill-creator/
```

When installed locally, add a `package.json` in your `.opencode/` (or `~/.config/opencode/`) directory with the peer dependency:

```json
{
  "dependencies": {
    "@opencode-ai/plugin": ">=1.0.0"
  }
}
```

OpenCode runs `bun install` at startup to resolve these.

## Usage

Once installed, OpenCode will automatically detect the skill when you ask it to create or improve a skill. For example:

- "Create a skill that helps with Docker compose files"
- "Build me a skill for generating API documentation"
- "Help me make a skill that assists with database migrations"
- "Optimize the description of my existing skill"

OpenCode will load the skill-creator instructions and use the plugin tools to walk through the full workflow.

## Project structure

```
opencode-skill-creator/
├── README.md
├── LICENSE                            # Apache 2.0
├── skill-creator/                     # The SKILL (copied to .opencode/skills/)
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
