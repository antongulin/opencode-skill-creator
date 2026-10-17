# Contributing to OpenCode Skill Creator

Report bugs, propose use cases, improve the documentation, or share a small skill example through [GitHub issues](https://github.com/antongulin/opencode-skill-creator/issues). Read [SECURITY.md](SECURITY.md) before reporting a vulnerability.

## Development setup

Fork and clone the repository, then create a focused branch. Use Node.js, npm, and Bun. CI uses Node.js 22, installs from the committed npm lockfile, checks the committed bundle before rebuilding, and runs these commands from `plugin/` in this order:

```sh
cd plugin
npm ci
OPENCODE_SKILL_CREATOR_OPEN_BROWSER=0 npm test
OPENCODE_SKILL_CREATOR_OPEN_BROWSER=0 npm run test:ts
npm run build
npm pack --dry-run --json --ignore-scripts
```

`npm test` runs the Node test suites; `npm run test:ts` uses Bun's isolated test runner. The builder uses Bun to bundle TypeScript. Keep `package-lock.json` reproducible and leave unrelated dependencies alone. The pack dry run inspects package contents without running lifecycle scripts. Do not publish a package as part of local validation.

Some checks need a provisioned runtime: the Node-floor test exercises setup, parsing, and validation under the declared floor when that binary is available, and reports a skip otherwise. A local pass with a skipped floor check does not establish floor compatibility. Release-safety tests also check the compiled import and whether the committed bundle matches source. If an intended source edit makes the committed-bundle checks fail, rebuild and rerun the relevant checks; report both the change and final results.

## Source ownership

- `opencode-skill-creator/` contains the source workflow skill. Make corresponding changes in `plugin/skill/` when editing its instructions, agents, references, or templates.
- `plugin/skill-creator.ts`, `runtime-entry.ts`, and `plugin/lib/` contain plugin behavior. Follow existing TypeScript patterns.
- `plugin/scripts/build.mjs` generates `plugin/dist/`, including bundled assets. Use the build script; do not hand-edit generated files. Keep the committed bundle consistent with source when submitting code changes.
- [Installation](docs/installation.md) and [tools](docs/tools.md) own detailed user guidance. Keep both READMEs concise; use absolute public links in `plugin/README.md` for npm rendering.
- Read [AGENTS.md](AGENTS.md) and applicable child contracts before editing. Reconcile affected documentation when behavior changes.

## Validation and cleanup

For a behavior change, describe the observable result and cover realistic failures at the lowest useful test layer. Include reproduction steps for bug fixes. Documentation-only changes need link/fragment checks, command/source accuracy checks, and `git diff --check`; they do not need new runtime tests.

Automated checks must not launch the user's default browser. Pass `openBrowser: false` to review calls or set `OPENCODE_SKILL_CREATOR_OPEN_BROWSER=0`. Tear down servers, sockets, child processes, and temporary directories in `finally` blocks. Use isolated configuration, cache, home, and Desktop-state paths for installer tests; never test against your real installed skills or user state.

Interactive testing uses a configured OpenCode project. Confirm the intended plugin entrypoint loaded before assessing behavior. Trigger evals and description improvements can incur model/provider charges; do not include live model calls in routine documentation checks.

## Pull requests

Keep each PR focused on a single change. Explain the user-visible behavior, relevant tests with commands/results, and any skipped or blocked checks. Include documentation updates and example data when they help someone reproduce the result. Review and resolve findings before merge; see [AGENTS.md](AGENTS.md) for repository delivery rules.

If you adopt another contributor's code, tests, or design, reference the source PR/commit, preserve a `Co-authored-by:` trailer, and credit the contributor in the release notes for the release containing that work. Do not credit unrelated or rejected work.

This project adapts [Anthropic's skill-creator](https://github.com/anthropics/skills/tree/main/skills/skill-creator) for OpenCode. Contributions use the project's [Apache License 2.0](LICENSE).
