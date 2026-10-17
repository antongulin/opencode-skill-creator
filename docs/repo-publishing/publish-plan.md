# Documentation publication plan

Prepared October 16, 2026. Status: local documentation draft awaiting diff acceptance. GitHub homepage and topics are saved and verified. Documentation commit/push verification remains pending; no npm release or website deployment is part of this batch.

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

## Remaining gates

1. Accept the exact documentation diff after checking local links/fragments, preserved anchors, npm absolute links, source/tool accuracy, privacy, and whitespace. No runtime change or new test suite is needed for prose.
2. Recheck default-branch synchronization and publish only accepted prose. The existing main-push workflow can publish an npm release: use the established `[skip ci]` documentation-commit convention and verify hosted workflow state after each push. It does not stop manual dispatches or already-running workflows. Keep workflow YAML and package artifacts unchanged. See [GitHub's skip guidance](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/skip-workflow-runs).
3. Refresh GitHub metadata, apply the accepted homepage/topics through supported access, and verify saved values. Record actual values in [github-metadata.md](github-metadata.md).
4. Inspect rendered GitHub docs and link destinations at the published revision. Confirm no unintended new release, tag, or npm version before and after publication. The package README source change does not update npm's displayed README until an intended release.
5. Record the published revision, completed checks, metadata readback, unchanged release state, documentation reconciliation, and repository cleanup. Replace pending status with verified outcomes, including for any final documentation push.

## Separate follow-ups

Website wording/catalog updates, the independent website audit, Search Console access and indexing evidence, bundled-skill catalog synchronization, and package homepage/release work remain outside this batch. No paid placement, outreach, search submission, crawler-policy change, or ranking guarantee is part of this plan.
