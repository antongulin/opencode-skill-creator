# Documentation publication plan

Completed October 16, 2026. The accepted documentation was published in [e6464cf](https://github.com/antongulin/opencode-skill-creator/commit/e6464cfb809b7dc0d12b9184789b2370b86f5356), with GitHub rendering and metadata readback verified. No npm release or website deployment was performed.

## Prepared scope

Shorten root and package onboarding while preserving incoming README anchors. Add installation/recovery and 14-tool references, contributor/security guidance, plain Markdown issue/PR templates, and a public navigation index. Reconcile the root agent contract and publish this bounded assessment. See the [scorecard](scorecard.md) for evidence and unresolved limits.

## Accepted implementation plan

1. **Connect the public surfaces.** Point GitHub About at the live website, add nine relevant topics, and put website/docs/example/npm links near the README opening. Retain the existing description, license, and attribution.
2. **Give newcomers one path.** Lead with project-scoped V2 registration, a restart in that project, and one realistic prompt. Explain that the bundled workflow skill still installs at user level. Keep global and V1 setup accessible through the installation guide.
3. **Preserve detailed guidance.** Move repeated setup and behavior explanations into installation and tool references. Preserve the existing website-linked README anchors and show all 14 registered tools with accurate saved-description semantics.
4. **Replace deletion with recovery.** Explain ordinary upgrades, close active instances, move the effective installation outside discovery paths, reopen a configured project, check fresh files, and selectively restore customizations. Keep old ownership/version metadata out of the restored installation.
5. **Help users and contributors report useful information.** Add a verified private security contact, plain Markdown issue/PR templates, reproducible contributor commands, and a public documentation index. Reconcile the root agent contract.
6. **Validate and publish prose.** Check links, anchors, source accuracy, private-data boundaries, and isolated CLI behavior. Publish accepted documentation without triggering the package-release workflow, verify hosted rendering/metadata, then record completion.

## Independent Astra audit

A fresh Astra audit reviewed the plan, repository behavior, release workflow, and saved live website responses before implementation. It requested two narrow revisions; both were accepted and implemented:

- **A01: isolate installer side effects.** Global registration can clean this package's stale cache and matching Desktop fault notifications. The installation guide discloses this; validation isolates home, configuration, cache, and Desktop state.
- **A02: define recovery success and failure.** Recovery must reopen a configured project, check fresh bundled files, retain the backup on failure, and exclude old version/ownership metadata when restoring customizations. It resets bundled files rather than upgrading the npm package.

The audit accepted the bounded SEO approach and documentation-only release boundary. It did not certify indexing, rankings, AI citations, or a complete independent website audit. The lead reviewed the final diff against these decisions.

## Completed publication checks

- The lead accepted the exact 13-file prose diff after link/fragment, preserved-anchor, tool/source accuracy, privacy, and whitespace checks. Isolated local installer fixtures passed and cleaned up.
- The default branch was synchronized before publication. Only accepted prose was committed, using `[skip ci]` because the existing main-push workflow can release the npm package. Workflow YAML, package artifacts, and runtime code were unchanged. This convention does not stop manual dispatches or already-running workflows; see [GitHub's skip guidance](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/skip-workflow-runs).
- Fresh GitHub page readback confirmed the website homepage and nine topics. See [github-metadata.md](github-metadata.md).
- Hosted root/package READMEs and the installation/tool references rendered successfully. Local checks resolved 36 relative links, 17 public-repository blob/tree targets, and nine preserved README anchors; all three catalogs matched the 14 tool registrations.
- After the implementation push, GitHub Actions remained at 198 runs with no new publication run. Remote tags were unchanged; GitHub's latest release and npm's displayed version remained `0.3.5`. The package README source is published on GitHub; npm's displayed README awaits an intended package release.
- The agent-contract reconciliation was included in the implementation. This closeout records the verified publication outcome; final synchronization and cleanup are checked after its documentation-only push.

## Separate follow-ups

Website wording/catalog updates, the independent website audit, Search Console access and indexing evidence, bundled-skill catalog synchronization, and package homepage/release work remain outside this batch. No paid placement, outreach, search submission, crawler-policy change, or ranking guarantee is part of this plan.
