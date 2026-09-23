# Gate workbench and open issues — 2026-09-23

## Scope and state preservation

Implement the selected horizontal stage navigation, wide Markdown document reader and independent conversation pane. Keep the compact pinned node / conversation / new / history header. Node and Run browsing must not change the active conversation or its draft. No business Gate is approved by this rollout.

Source baseline: `fb072a1968be9427ce5dcdad82cebad15ea58107`. Work branch: `codex/gate-workbench-open-issues`.

Private recovery snapshot (not committed): `out/local-blank-20260921/backups/before-gate-workbench-20260923T173254Z` in the original checkout. Includes consistent SQLite, desktop profile/registry, manifest and PostgreSQL dump. Baseline: 1 Run, 8 nodes, 4 artifacts, 5 conversations. Current node: requirement confirmation Gate; unapproved.

## Delivery checklist

- [x] Horizontal navigation, material reader, independent conversation pane and UI regression checks.
- [x] #167 implementation: technical identifiers hidden by default and available in source details.
- [x] #166 implementation: provider default output allowance, classified failures, per-attempt accounting and cancellation.
- [x] #165 implementation: cloud policy readiness before all paid execution paths, local configuration order and actionable reasons.
- [x] #164 implementation: verified critical-body coverage before accepting complete proposals, bounded recovery and semantic coverage checks.
- [ ] #135: verify existing asynchronous keychain fix; distinguish local verification from Developer ID signed-install acceptance.
- [ ] Tests, typecheck, build and isolated live-provider verification where required.
- [x] Browser comparison and design-qa.md. Native rollout verification remains below.
- [ ] Rollout to existing profile and services; compare durable business state with snapshot.
- [ ] Publish evidence and close only verified issues.

## Visual reference

Selected user reference: horizontal six-stage navigation, document reader, persistent independent conversation on the right. Updated reference generated with the existing compact header: `exec-6a063be0-0cff-47b0-9094-57ccf832ea76.png`. Source data and existing product controls take precedence over fictional mock content.

## Verified implementation evidence

- Full repository test run: 307 files passed, 1 skipped; 4,123 tests passed, 15 skipped. Subsequent targeted checks after accounting/UI refinements: 238 application/IPC tests, then 115 API/governance/repository tests and the PostgreSQL smoke passed. Full typecheck (including OpenCode/memory/organization smoke configurations), API/desktop builds and desktop cross-platform checks passed.
- PostgreSQL smoke uses a separate disposable database. It verifies concurrent reservation serialization, immutable/idempotent settlement, failure usage, actual reported totals, unknown-cost blocking and fresh disabled-budget policy. Client clocks cannot move a reservation into a previous billing month. Duplicate historical imports must match the original project, user and settlement.
- Critical-body tests cover actual serialized request coverage, Unicode/escaping, truncation, obsolete versions, cross-target input, bounded recovery and separate semantic criterion verification. Opaque OpenCode input cannot be claimed as verified complete. Saved proposals are rechecked against their true target and document versions.
- Review tests cover default omission of output limits, preserved thinking settings, classified stop/failure conditions, usage before parsing, late cancellation and retention of earlier successful review artifacts. API cancellation during accounting retains usage but does not save the review.
- Governed Direct/Native/OpenCode requests reserve and settle per actual provider call. Cloud policy and spend are authoritative. The local durable pending queue reconciles metadata after synchronization failures; unknown cost is never silently treated as zero. OpenCode relay tests cover authentication, configured-model enforcement, streamed tool calls/UTF-8, budget and cancellation.
- The API also persists a received settlement before final accounting and reconciles it before budget preflight on the next request. PostgreSQL verification recreates the repository between persistence and settlement, confirms recovery and removes the pending marker atomically. Provisional dispatch markers are not exposed as final results to another worker.
- Budget configuration is in project foundation settings. Warning/block reasons reach all model entry points, and explicit extra-budget approval is available without requiring a Coding executor. Creating an approval does not run a model or advance a Gate.
- Desktop pilot package built successfully (Electron 42.11.6, arm64, app version 2.3.0). The package has not yet been rolled out at this checkpoint.

## Remaining acceptance boundary

The opt-in isolated live smoke (`scripts/gate-workbench-live.mts`) is waiting for the user to allow macOS Keychain access to the saved Provider credential. It has not dispatched a model request. Therefore the real same-material default-output review required by #166 and real long-body proposal required by #164 are **not yet verified**. Controlled-provider tests do not substitute for these acceptance items. The script uses a database copy and does not approve or advance the user's business Run. #135 Developer ID signed-install acceptance remains deferred under the user's stated local-development exception.

The final native UI check reported that macOS is locked. The user has been asked to unlock and allow Keychain access. The existing Electron, API and Web have not been replaced or restarted at this checkpoint; business state remains at the same unapproved requirement Gate with four artifacts and five conversations. Issue closure waits for the remaining acceptance checks and preservation verification.
