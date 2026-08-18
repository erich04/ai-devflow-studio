# AI DevFlow Studio Stabilization Plan V0.3

Date: 2026-08-17  
Lifecycle: Implementation complete; final candidate verification and evidence archival in progress.  
Scope: Security boundary repair, authoritative-source convergence, tenant isolation, and progressive
LocalStore decomposition. This plan is distinct from the historical product milestone named v0.3.

## Objective

Close the confirmed security findings on the current development line, converge the repository onto
one authoritative source tree, independently audit organization/project authority, and reduce the
16K-line LocalStore risk without a big-bang rewrite. Every slice must be independently reversible,
test-driven, and leave a clean candidate that can pass the complete 0.x, 1.x, and finite 2.x gate
matrix.

## Non-negotiable boundaries

- `CodingDiffArtifact.redacted` retains its historical “replacement occurred” meaning.
- `sanitizerVersion`, `sanitizedAt`, and `secretReplacementCount` carry processing provenance.
- Evidence sanitization and outbound publication scanning are separate security boundaries.
- Exact Git objects and PR title/body are scanned before any repository credential is minted.
- A blocked publication has no bypass. Recovery requires a clean managed-worktree rebuild and a new
  exact scan bound to the replacement commit.
- Desktop bearer authority is project-scoped and cannot mint or copy bearer credentials.
- Pairing codes are single-use under a serialized database transaction and bounded failure budget.
- Existing migrations are immutable. Their normalized source is machine-hash-locked.
- All schema migrations commit before privacy maintenance starts.
- SQLite durability has one filesystem outlet: temporary file, then atomic rename.
- The canonical source tree and legacy Workspace Truth projection cannot both claim authority.

## Execution slices

### A. Diff provenance and outbound publication safety

1. Sanitize every added, removed, and context line in Coding Diff patches.
2. Persist explicit sanitizer provenance without redefining `redacted`.
3. Extend the existing open-time privacy maintenance to legacy Coding Diff rows.
4. Scan the exact commit range and outbound PR text before credential issuance.
5. Persist the scan result and block unknown, incomplete, or positive scans.
6. Provide a deterministic clean-rebuild recovery path for `content_scan_blocked`.

Acceptance: removed-line and PR-text canaries are blocked; safe diffs carry supported provenance;
no provider call, credential, push, or Draft PR side effect occurs before a safe scan commits.

### B. Authoritative source convergence

1. Freeze main movement while the security slices are under review.
2. Preserve unrelated user document changes outside the code worktree.
3. Fast-forward/merge the fully tested development line into canonical main.
4. Retire the temporary linked worktree and prune only proven-prunable entries.
5. Archive the legacy Workspace Truth source at its registry/projection origin, not inside a
   regeneratable managed block.

Acceptance: one active canonical source tree, no unmerged branch content, no lost user changes, and
the old tree cannot regenerate an active flagship declaration.

### C. Tenant and request-boundary audit

Audit Seed and Postgres parity for organization/project predicates, Desktop bearer scope, shared/API
payload parser equivalence, pairing exchange replay/limits, and unauthenticated body bounds. The
implemented role set is exactly `owner`, `lead`, and `member`; `viewer` is intentionally absent and
recorded as a product decision rather than fabricated for the audit.

Acceptance: cross-project reads/writes fail closed, bearer callers cannot create credentials,
concurrent pairing exchange has exactly one winner, unknown pairing codes never succeed, oversized
JSON is rejected before unbounded buffering, and Seed/Postgres behavior matches.

### D. Progressive LocalStore decomposition

1. Extract schema/migration ownership and lock versions 1 through current with source digests.
2. Extract the single atomic persistence outlet.
3. Add indexed privacy provenance so current rows are not loaded on every open.
4. Extract privacy maintenance and workflow/evidence persistence as bounded domain modules.
5. Preserve characterization tests throughout; do not rewrite capability/state-machine domains in
   the same slice.

Acceptance: a fresh and retained database reaches Desktop schema 32; migration failure rolls back;
privacy maintenance starts only after migrations; current rows use partial-index queries; reopen is
idempotent; the only filesystem persistence sequence remains `write temp → rename`.

## Required final gates

- Workspace typecheck, unit/component suite, cross-platform checks, and production builds.
- V1.5 deterministic GitHub Delivery and packaged Desktop smoke.
- V2.0 Agent Runtime, V2.1 Retrieval/Memory, and V2.2 Multi-Agent evaluators/status gates.
- Real disposable PostgreSQL 16 smoke at Team schema 19.
- Docker stack smoke and lifecycle migration/rollback smoke.
- Reproducible Desktop artifact verification and cold-restart side-effect checks.
- A fresh standard security scan with no unresolved P0/P1 findings.
- A clean candidate commit and repository-contained result record with exact commands, outcomes,
  schema versions, artifact digest, and cleanup status.

## Explicitly deferred

- A big-bang rewrite of the remaining LocalStore capability/state-machine code.
- Restoring spellcheck through external dictionary egress.
- Adding a new `viewer` role without a product/authority decision.
- Paid-provider or production GitHub writes as a substitute for deterministic release gates.
- Reusing the historical v0.3 release evidence namespace for this stabilization effort.
