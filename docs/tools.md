# Plugin tool reference

[Project overview](../README.md) · [Installation](installation.md) · [Docker Compose example](../examples/docker-compose-helper/)

## Tool catalog

The shared V1/V2 registration exports these 14 tools:

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

## Inputs and defaults

Paths refer to files or directories accessible to the OpenCode process. These are tool arguments, not shell commands.

| Tool | Required inputs | Useful optional inputs and defaults |
|---|---|---|
| `skill_validate`, `skill_parse` | `skillPath` (directory containing SKILL.md) | None |
| `skill_eval` | `skillPath`, `evalSetPath` | `descriptionOverride`, `model`, `agent: "build"`; execution defaults below |
| `skill_improve_description` | `skillPath`, `evalResultsPath` | `historyPath`, `model`, `logDir`, `iteration` |
| `skill_optimize_loop` | `skillPath`, `evalSetPath` | `maxIterations: 5`, `holdout: 0.4`, `descriptionOverride`, `model`, `agent: "build"`, `liveReportPath`, `logDir`; execution defaults below |
| `skill_aggregate_benchmark` | `benchmarkDir` | `skillName`, `skillPath`, `outputPath`, `markdownPath` |
| `skill_generate_report` | `dataPath`, `outputPath` | `skillName`, `autoRefresh: false` |
| `skill_serve_review` | `workspace` | `port: 3117`, `skillName`, `previousWorkspace`, `benchmarkPath`, `allowPartial: false`, `openBrowser: true` |
| `skill_stop_review` | None | `workspace`; omission stops all servers owned by this instance |
| `skill_export_static_review` | `workspace`, `outputPath` | `skillName`, `previousWorkspace`, `benchmarkPath`, `allowPartial: false` |
| `skill_add_gold_standard` | `skillName`, `description`, `passRate` (observed decimal 0–1) | `notes` |
| `skill_list_gold_standards`, `skill_get_gold_advice` | None | None |
| `skill_remove_gold_standard` | `id` | None |

`skill_eval` and `skill_optimize_loop` share these defaults: `numWorkers: 10`, `timeout: 30` seconds per query, `runsPerQuery: 3`, `triggerThreshold: 0.5`, and `triggerOnly: true`. Use `provider/model` format for `model`. Choose worker count and run count to fit your provider limits and budget; model invocations can cost money.

`skill_aggregate_benchmark` writes `benchmark.json` and `benchmark.md` inside `benchmarkDir` unless you supply output paths. `skill_generate_report` consumes the optimization loop's JSON output and writes an HTML report. It does not run evals.

## Evaluate and improve descriptions

The eval-set file is a JSON array:

```json
[
  { "query": "Review this Docker Compose file", "should_trigger": true },
  { "query": "Write a birthday invitation", "should_trigger": false }
]
```

From a checkout of this repository, ask OpenCode:

```text
Run skill_eval with skillPath examples/docker-compose-helper and evalSetPath examples/docker-compose-helper/evals/eval-set.json. Use runsPerQuery 3 and triggerThreshold 0.5.
```

Trigger evals measure whether OpenCode selects the skill from its description. With `triggerOnly: true`, a run stops once the synthetic skill triggers and ignores later workflow failures. This does not measure task-output quality. Inspect reported run errors as well as pass/fail scores.

Save the returned JSON if you want to pass its file path as `evalResultsPath` to `skill_improve_description`. That tool proposes a description from failure patterns and optional history. The full `skill_optimize_loop` takes the same eval-set and skill paths, splits queries into train/test sets (default 60%/40%), evaluates each candidate, and uses train failures to propose improvements for up to five iterations. It selects the best tested description by test score, or by train score when there is no test set. It can stop early when all train queries pass. The loop consumes your eval set; generating a representative set belongs to the skill-writing workflow. A holdout reduces overfitting risk without guaranteeing generalization.

The [Docker Compose example](../examples/docker-compose-helper/) includes optimization prompts and expected result fields. Compare `best_description` with its train/test scores before editing your skill.

### Eval and parser contracts

- **Project scope (V2):** each plugin instance evaluates the project root it loaded for. Both eval tools use that root rather than the process working directory.
- **Config mirroring:** the isolated eval project mirrors direct root `opencode.jsonc`/`opencode.json`, referenced relative instruction files, `{file:...}` substitutions, single-directory globs such as `dir/*.md`, and `.opencode/` config. Providers, agents, and project instructions stay effective because relative files retain their positions.
- **Skill isolation:** the `.opencode/` mirror keeps sibling skills and excludes the tested skill. A canonical-path guard also excludes config references into `.opencode/skills` or the tested skill, including symlink aliases. It excludes the tested directory wherever it lives in the project and refuses an ancestor reference that would copy it.
- **Unsupported references:** outside-project paths such as `../shared/rules.md`, recursive `**` or brace globs, and malformed glob segments such as `[z-a]` produce stderr diagnostics. Inspect those diagnostics when eval configuration differs from the project.
- **Cancellation:** eval, optimization, and description improvement honor `context.signal` in V2 or `context.abort` in V1. Cancellation kills the running `opencode` child, skips queued queries, and rejects with `AbortError` rather than returning a normal failed eval with `run_errors: 0`. Cleanup removes the isolated eval temp root.
- **Per-item identity:** repeated query text with different labels stays separate. With at least one worker and run per item, eval returns one result per scheduled item in eval-set order. The optimization loop splits results by position against the train/test sets, so duplicate text across the split retains each item's result.
- **Bounded block scalars:** descriptions support `|`/`>` with optional chomping (`+`/`-`) and explicit indent (`1`–`9`) in either order. Literal breaks, folded paragraphs, blank and more-indented lines, and clip/strip/keep trailing breaks match the YAML reference for that subset.

`skill_parse` returns name, description, full content, and content length. The bounded parser does not support general YAML constructs such as anchors, escapes, or flow maps. It normalizes CRLF in the parsed description while retaining the original full-content bytes. Validation checks structure and metadata; passing it does not prove task quality.

## Review task outputs

For output-quality comparisons, produce paired task runs and grading files in an eval workspace. Each `eval-*` directory must contain `with_skill` and a baseline named `without_skill` or `old_skill`. `skill_aggregate_benchmark` summarizes `grading.json` files into pass-rate, timing, and token statistics across runs, including variance. See [workspace schemas](../opencode-skill-creator/references/schemas.md) for run and grading formats.

Both `skill_serve_review` and `skill_export_static_review` check paired data before launch. They report missing pairs; set `allowPartial: true` only for an intentional partial comparison. If you omit `benchmarkPath`, the tools generate `benchmark.json` and `benchmark.md` in the workspace.

For an automated caller, pass these arguments to avoid opening the user's browser:

```json
{
  "workspace": "/path/to/eval-workspace",
  "openBrowser": false
}
```

You can also set `OPENCODE_SKILL_CREATOR_OPEN_BROWSER=0` in the calling process. Interactive use defaults to opening the review URL; a missing platform launcher leaves the server running and reports a URL you can open yourself. The viewer regenerates HTML on page load and writes feedback to the returned `feedbackPath`.

Call `skill_stop_review` with the same `workspace` when finished. Omit it to stop all review servers owned by the current plugin instance. Unload cleanup uses V1 `dispose()` or the V2 setup cleanup closure and releases only that instance's servers. A busy port fails; the plugin does not take it from another process. `skill_export_static_review` writes a standalone HTML file without a server.

## Gold-standard descriptions

Save **skill descriptions** that performed well with `skill_add_gold_standard`, along with the observed `passRate` and optional notes. This stores examples, not exemplary task responses. `skill_list_gold_standards` returns all examples without a skill filter. Remove an example by its `id`. `skill_get_gold_advice` formats the saved examples for prompt context; it does not trigger optimization or apply a description.

## Drafts and eval workspaces

Keep drafts outside the source repository until ready to install:

- Unix/macOS: `/tmp/opencode-skills/<skill-name>/` or a directory under `$TMPDIR`; use a separate `<skill-name>-workspace/` for outputs.
- Windows: `%TEMP%\opencode-skills\<skill-name>\` and a separate `<skill-name>-workspace\`.
- Finished skills: `.opencode/skills/<skill-name>/` for a project, or the effective user-level `opencode/skills/<skill-name>/` directory described in [installation](installation.md#project-setup).

Keep custom skill drafts separate from the plugin's managed bundled workflow skill.
