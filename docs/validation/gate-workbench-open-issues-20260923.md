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
- [x] Local packaged credential access and real Provider verification; #135 Developer ID signed-install acceptance remains deferred.
- [x] Tests, typecheck, build and isolated live-provider verification where required.
- [x] Browser comparison and design-qa.md. Native rollout verification remains below.
- [x] Rollout to existing profile and services; compare durable business state with snapshot.
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
- Desktop pilot package built successfully (Electron 42.11.6, arm64, app version 2.3.0). The existing installed application and API/Web services were updated using the original data profile.

## Live verification and rollout

After the user authorized Keychain access, the packaged opt-in smoke (`scripts/gate-workbench-live.mts`) passed on 2026-09-24 02:09 UTC. It used a disposable SQLite copy and the existing official DeepSeek Flash Provider configuration (currently thinking disabled); no credential, prompt or model text is written to the diagnostic report. Generic Electron initially failed to decrypt the saved credential; the copied packaged application identity succeeded.

- **#166:** same saved business material, 21,417-character prompt, no `max_tokens`, normal `stop`, complete validated report; 7,185 input / 1,423 output tokens. The business Gate remained unchanged. A real response exposed an additional contract gap: confidence was a string, because its required numeric type/range had never been specified. The prompt now explicitly requires a JSON number from 0 to 1, and invalid responses still fail safely with retained usage.
- **#164:** 6,844-character source containing Chinese, a quoted backslash, emoji and distinct first/middle/final conditions. The actual proposal and independent semantic-verification requests included the entire source with matching SHA-256 digests. Seven coverage mappings passed; all four checked literal/behavioral requirements remained in the proposal. No draft artifact was automatically saved and no workflow state advanced. The original database hash was unchanged.
- Repeated background sentences initially inflated the coverage map beyond the context budget. Identical clauses now share one mapping, while the full original text still travels unchanged. Markdown heading requirements are retained instead of being skipped. Added regression coverage; 58 critical-context/conversation tests and 56 review/runtime tests passed after these live findings.
- The installed native Electron shows horizontal stage/subnode navigation, a central rendered material reader and the original independent conversation tabs. Native stage 01 → 02 → 01 browsing retained the selected conversation and returned to the current unapproved requirement Gate. Actual screenshot: `out/gate-workbench-qa/12-native-installed.png`.
- Preservation comparison covered all 65 existing Desktop tables and all 50 existing Team tables (old columns). Business records remained identical. Expected changes: additive schema migration, one conversation's version/open timestamp, and the Desktop credential's last-used timestamp. Chat messages/drafts, Run/nodes/artifacts, credentials, pairing and the $50/$40 budget were unchanged. Desktop schema 36 adds an empty settlement table; Team schema 30 adds model-attempt accounting.
- Private consistent SQLite/profile/registry and PostgreSQL backups were taken before replacement. API readiness and Web both returned HTTP 200. The user's live review and Gate were never invoked during verification.

#135 Developer ID signed-install acceptance remains deferred under the user's stated local-development exception. This rollout does not claim signed-distribution verification.
