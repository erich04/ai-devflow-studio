# AI DevFlow Studio v2.3.0

V2.3 brings the request-to-delivery workflow improvements accumulated since V2.2 into one release.

## Changes

- Native Coding Executor v2 and governed OpenCode integration, with project-level executor readiness, saved Provider selection, safe credential removal, and explicit permission handling.
- More reliable Web onboarding, project creation, local authentication, repository selection, pairing, Team sync, budget configuration, and theme persistence.
- Consistent clarification, design, Gate Review, implementation, test, PR, and acceptance evidence. Web approvals bind summaries and fingerprints to Desktop-owned artifacts.
- Better DeepSeek structured responses and Provider diagnostics, atomic usage recording, review concurrency controls, and explicit unknown costs.
- Reliable blank-repository execution, dependency preparation, OpenCode idle detection, and GitHub Delivery paths across JavaScript and Postgres collations.
- Cross-platform Git/npm fixture reliability, packaged Desktop isolation, and production dependency fixes.

## Verification and scope

The release candidate runs the full Verify matrix, including Windows compatibility, macOS verification, browser and Electron checks, Postgres integration, Docker installation/upgrade checks, packaged Desktop checks, and the existing bounded Runtime, Memory, and coordination evaluators. Final results are recorded against the exact candidate commit; a list of intended checks is not a passing result.

The earlier [blank-project live walkthrough](../../engineering/blank-project-e2e-2026-09-11.zh-CN.md) used real DeepSeek/OpenCode and GitHub, generated a Chinese task-list application, passed 17 application tests and real browser checks, and delivered a merged PR. That earlier result is historical evidence, not a substitute for the V2.3 candidate-bound release signoff.

Distribution remains self-hosted source plus Web, API, Worker build archives and an unsigned portable macOS Apple Silicon Desktop archive. Windows compatibility is tested; this bundle does not include a Windows installer, a signed/notarized macOS installer, a public hosted service, or automatic deployment.

Multi-Agent coordination remains an optional bounded advanced capability with a fixed task graph. This release does not claim automatic multi-Agent delivery of arbitrary projects. Product GitHub Delivery ends at a governed Draft PR and acceptance; merging and public deployment remain operator actions.

## Upgrade

Back up the self-hosted Postgres database and Desktop profile before upgrading. The current Team schema is v28 and Desktop schema is v34; start the API through the documented migration path. Keep the existing identity and GitHub App configuration. Use the [self-hosted guide](../../guides/devflow-studio-self-hosted-pilot.md) for installation and configuration.

Download the Desktop archive together with its integrity manifest and `artifact-index.json`. Extract and run the packaged application. API, Web, and Worker archives are build outputs; use the tagged source and lockfile for a complete reproducible deployment.
