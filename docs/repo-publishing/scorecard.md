# Public publishing assessment

Assessment date: October 16, 2026. Plugin source baseline: `f943062`. Status: documentation prepared locally for review; documentation publication remains pending; GitHub homepage/topics are verified. This assessment covers repository presentation and bounded website checks, rather than a full search-performance audit.

## Findings and outcomes

| Area | Evidence and prepared improvement | Remaining gate |
|---|---|---|
| Project identity | Existing public npm package, Apache-2.0 license, and Anthropic attribution. README now leads with the OpenCode workflow, website, and project quick start. | Review and publish the documentation diff |
| Onboarding | Installer source distinguishes project/global config from user-level bundled-skill installation. New guide explains XDG paths, manual V1/V2 configuration, verification, and global cache/notification cleanup. | Hosted rendering and link readback after publication |
| Recovery | Replaced deletion advice with an external backup, configured-project reopen, fresh-file checks, failure handling, and selective restoration without old metadata. | Review prose against installer behavior; no recovery script introduced |
| Tools | Compared the catalog against 14 shared V1/V2 registrations. Corrected gold standards to description examples and retained eval, parser, review, and ownership details in focused guides. | Bundled skill's abbreviated catalog needs a separate coordinated update |
| Community guidance | Prepared npm-lockfile development instructions, Markdown issue/PR templates, and private email security reporting. The address appears on the maintainer's public website. | Publish files; no response SLA or GitHub private-reporting claim |
| Navigation | Added a public-only llms.txt linking docs, skill source, examples, releases, and contact surfaces. | Publish and check public destinations; llms.txt is navigation, not a Google ranking signal |
| GitHub metadata | Saved homepage https://skillcreator.page/ and nine relevant topics; retained the specific description. Fresh page readback confirmed both changes. | Complete; see metadata receipt |
| npm presentation | Package README source now uses public absolute document links and concise onboarding. | npm's displayed README stays unchanged until a normal package release |

## Local documentation checks

- Passed path/fragment checks across 13 changed prose files, including the preserved root install/tools/usage/architecture anchors and package V1 setup anchor. Package README document links use public absolute URLs.
- Matched all 14 catalog entries in both READMEs and the tool guide to source registrations; checked required inputs and defaults against executor definitions. Whitespace check passed.
- Local CLI help and isolated project/global fixtures passed on macOS. Fixtures covered JSONC precedence/comments, existing entries, duplicate avoidance, custom XDG versus global config paths, stale package-cache cleanup, and preservation of unrelated Desktop notifications. Temporary resources were removed.
- No dependency install, model call, full runtime suite, OpenCode startup, or cross-platform runtime check ran for this prose change. External URL rendering and hosted publication need delivery verification; the website findings below come from the bounded audit.

## Bounded website observations

Checks of eight public pages found HTTP 200 responses, unique titles/descriptions, self-canonicals, index/follow metadata, one H1 each, and core copy in response HTML. Homepage SoftwareSourceCode and article BlogPosting JSON-LD parsed. The advertised [robots.txt](https://skillcreator.page/robots.txt), [sitemap.xml](https://skillcreator.page/sitemap.xml), and [llms.txt](https://skillcreator.page/llms.txt) returned HTTP 200; the sitemap represented eight pages. Checked internal fragments resolved. Unadvertised sitemap URL probes returning 404 did not establish a defect in the advertised sitemap.

These observations do not prove bot-specific access, indexing, Google-selected canonicals, rankings, AI citations, field Core Web Vitals, or social-platform rendering. Search Console property access was unavailable during the audit; URL inspection, submission, and performance remain unverified. A search query returning no results is not conclusive indexing evidence.

Google's [AI optimization guidance](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide) applies normal SEO foundations and states that llms.txt does not affect Google Search visibility. OpenAI documents separate search and training crawler controls in its [bot reference](https://developers.openai.com/api/docs/bots). This batch changes no website crawler policy.

## Boundaries and follow-ups

- Website content should clarify project configuration versus global skill installation and link its abbreviated tool catalog to the complete reference. Website changes and the independent website audit remain separate work.
- Align the bundled skill catalogs during a coordinated source/build release. Do not edit one bundled copy or generated output in isolation.
- Package homepage metadata and npm README publication remain for an intended package release. No package version, dependency, runtime, or workflow change belongs to this prose batch.
- Local installed dependencies differ from the committed lockfile, and committed dist metadata differs from package metadata. This assessment does not claim fresh runtime-matrix or published-artifact verification.

See [metadata recommendations](github-metadata.md) and [publication gates](publish-plan.md).
