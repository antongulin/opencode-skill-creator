# AGENTS.md

Project agent rules.

<!-- DOX:BEGIN (canonical: github.com/agent0ai/dox AGENTS.md — always-latest copy; safe to edit/extend the block below, e.g. fill in Child DOX Index) -->
# DOX framework

- DOX is highly performant AGENTS.md hierarchy installed here
- Agent must follow DOX instructions across any edits

## Core Contract

- AGENTS.md files are binding work contracts for their subtrees
- Work products, source materials, instructions, records, assets, and durable docs must stay understandable from the nearest applicable AGENTS.md plus every parent AGENTS.md above it

## Read Before Editing

1. Read the root AGENTS.md
2. Identify every file or folder you expect to touch
3. Walk from the repository root to each target path
4. Read every AGENTS.md found along each route
5. If a parent AGENTS.md lists a child AGENTS.md whose scope contains the path, read that child and continue from there
6. Use the nearest AGENTS.md as the local contract and parent docs for repo-wide rules
7. If docs conflict, the closer doc controls local work details, but no child doc may weaken DOX

Do not rely on memory. Re-read the applicable DOX chain in the current session before editing.

## Update After Editing

Every meaningful change requires a DOX pass before the task is done.

Update the closest owning AGENTS.md when a change affects:

- purpose, scope, ownership, or responsibilities
- durable structure, contracts, workflows, or operating rules
- required inputs, outputs, permissions, constraints, side effects, or artifacts
- user preferences about behavior, communication, process, organization, or quality
- AGENTS.md creation, deletion, move, rename, or index contents

Update parent docs when parent-level structure, ownership, workflow, or child index changes. Update child docs when parent changes alter local rules. Remove stale or contradictory text immediately. Small edits that do not change behavior or contracts may leave docs unchanged, but the DOX pass still must happen.

## Hierarchy

- Root AGENTS.md is the DOX rail: project-wide instructions, global preferences, durable workflow rules, and the top-level Child DOX Index
- Child AGENTS.md files own domain-specific instructions and their own Child DOX Index
- Each parent explains what its direct children cover and what stays owned by the parent
- The closer a doc is to the work, the more specific and practical it must be

## Child Doc Shape

- Create a child AGENTS.md when a folder becomes a durable boundary with its own purpose, rules, responsibilities, workflow, materials, or quality standards
- Work Guidance must reflect the current standards of the project or user instructions; if there are no specific standards or instructions yet, leave it empty
- Verification must reflect an existing check; if no verification framework exists yet, leave it empty and update it when one exists

Default section order:
- Purpose
- Ownership
- Local Contracts
- Work Guidance
- Verification
- Child DOX Index

## Style

- Keep docs concise, current, and operational
- Document stable contracts, not diary entries
- Put broad rules in parent docs and concrete details in child docs
- Prefer direct bullets with explicit names
- Do not duplicate rules across many files unless each scope needs a local version
- Delete stale notes instead of explaining history
- Trim obvious statements, repeated rules, misplaced detail, and warnings for risks that no longer exist

## Closeout

1. Re-check changed paths against the DOX chain
2. Update nearest owning docs and any affected parents or children
3. Refresh every affected Child DOX Index
4. Remove stale or contradictory text
5. Run existing verification when relevant
6. Report any docs intentionally left unchanged and why

## User Preferences

When the user requests a durable behavior change, record it here or in the relevant child AGENTS.md

### Automated tests must not open the browser

- Automated tests, library use, and tool-based QA must never launch the user's
  default browser. Pass `openBrowser: false` to `serveReview`/`skill_serve_review`
  and/or set `OPENCODE_SKILL_CREATOR_OPEN_BROWSER=0` in the test process.
- The interactive `skill_serve_review` default stays `openBrowser: true` for the
  user-facing flow. Never flip that default for tests by editing the tool; opt out
  per call or via the environment.
- Every test must tear down the listeners/servers/processes/temp resources it
  creates in a `finally` block (stop review servers, close any sockets, remove temp dirs).
- Interactive QA uses exactly one Ego TaskSpace and reuses one page/tab per task;
  close only the pages the task created when it completes.
- Workers explicitly report their cleanup in the handoff (listeners, processes,
  temp dirs, browser pages). A worker that opened a browser page closes it before
  finishing; the lead verifies.

### Credit adopted contributor work in release notes

- When an external contributor's code, tests, or design is adopted — reworked or
  not — credit the contributor by handle and reference the source (PR/commit) in
  the release notes and the commit trailer (`Co-authored-by:`).
- Credit only work actually adopted. Do not name contributors for ideas that were
  rejected or not merged, and do not hardcode a contributor into unrelated
  releases: derive the credit from the work each release actually contains.
- Release notes are authored during the release/delivery stage for the revision
  being published; keep the attribution truthful per release.

## Child DOX Index

The root `AGENTS.md` owns cross-cutting repository rules. No child `AGENTS.md` files exist;
the areas below are described here and should get a child contract only when one becomes a
distinct ownership boundary.

- `plugin/` — the OpenCode plugin (npm package `opencode-skill-creator`): TypeScript source
  (`skill-creator.ts`, `runtime-entry.ts`, `lib/`), the committed `dist/` bundle, the installer
  CLI (`bin/`), the build script (`scripts/build.mjs`), and the test suites. Build with
  `npm run build`; verify with `npm test` and `npm run test:ts`. The bundle must externalize
  `@opencode-ai/plugin` and `@opencode/plugin` (bun `--external=<name>` form) and never inline
  `node_modules`.
- `opencode-skill-creator/` — the bundled skill (`SKILL.md`, `agents/`, `references/`,
  `templates/`). Copied into `plugin/skill/` and shipped in the package; edit both the source
  skill and the plugin copy when behavior changes.
- `examples/` — usage examples, not part of the published package.
- `.github/workflows/` — `ci.yml` (npm ci + build + tests on PRs), `publish.yml` (auto
  patch-version bump and npm publish on `main`), and `code-review.yml` (Robin).

<!-- DOX:END -->

<!-- BASELINE:BEGIN (managed by agents-md-bootstrap) -->
## Engineering baseline

This repo follows the baseline: `~/Code/700 systems/baseline` (https://github.com/antongulin/baseline, private).
Read `baseline/00-laws.md` first; pillars 01–07 hold the law (workspace, agents, project,
stacks, infra, delivery, knowledge). Answer standards questions from those files, not memory.
Anything missing or broken against the baseline is surfaced loudly — never skipped (law 2).
<!-- BASELINE:END -->
