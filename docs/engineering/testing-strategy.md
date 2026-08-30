# DevFlow Studio Testing Strategy

DevFlow Studio follows a TDD discipline for new behavior: write the smallest failing contract test,
implement only enough to pass, then refactor under the same tests. Fixture-driven UI does not need
retroactive TDD rewrites unless it is touched.

## Current Persistence Baseline

- Team/API/Postgres uses Team schema v21. Migration tests must prove a fresh v21 database, the
  populated v11-to-v12 delivery-series upgrade, and the v12-to-v13 provider-authoritative expiry
  contract without inventing expiry evidence for legacy issued credentials, followed by the
  v13-to-v14 bounded provider retry boundary, the v14-to-v15 verified publication adoption
  authority without changing legacy grant-backed publications, and the v15-to-v16 metadata-only
  Agent Runtime projection without inventing runtime summaries or audit rows, followed by the
  v16-to-v17 metadata-only Agent Memory projection without inventing Memory summaries or audit rows,
  followed by v17-to-v18 independent same-head Memory quality audit versioning, then an empty
  v18-to-v19 metadata-only Agent Coordination projection, then the v19-to-v20 bounded auth-provider
  constraint that preserves GitHub accounts, accepts `local-development`, and rejects unknown
  providers, then the v20-to-v21 Coding summary constraint that accepts the `native` engine while
  preserving the existing engine values. Retained rows keep reserved quality version 0 until the first new projection converges
  them; new writes start at 1.
- Electron/SQLite uses Desktop schema v34. Local-store tests must prove a fresh v34 database, the
  Desktop schema 17-to-18 retained Runtime upgrade, the 18-to-19 metadata-only Native Tool audit
  upgrade with no invented grant or audit rows, and the 19-to-20 Local MCP installation/audit
  provenance upgrade with no invented installation or MCP audit, and the 20-to-21 retained outbox
  upgrade that accepts only metadata-only Agent Runtime summaries, and the 21-to-22 retrieval-index
  migration with zero fabricated snapshot/chunk/vector/Citation rows, followed by the 22-to-23 inert
  Memory-candidate migration with zero fabricated candidates, followed by the 23-to-24 durable
  revision/head/tombstone/derived-index/audit migration with zero fabricated lifecycle rows, plus
  the 24-to-25 retained migration that removes source-candidate uniqueness without losing revision,
  head, tombstone, index, or audit history, followed by the 25-to-26 additive Runtime Context
  migration without fabricating attachments, followed by the 26-to-27 retained metadata-only outbox
  migration that admits exact Agent Memory summary IDs without changing existing rows, followed by
  the 27-to-28 Coordination Session migration with zero fabricated sessions, tasks, graphs,
  handoffs, leases, audits, or checkpoints, followed by the 28-to-29 retained outbox migration that
  admits exact Coordination Session IDs without changing existing operations, followed by the
  29-to-30 Coding Diff sanitizer-provenance migration, the 30-to-31 content-scan/operator-outcome
  migration, the 31-to-32 indexed stored-evidence privacy provenance migration, and the 32-to-33
  project Coding Runtime configuration plus immutable Native v2 Change Set migration. Tests also lock
  every migration source digest, require all migrations to commit before privacy maintenance, keep
  a single atomic temporary-file-to-rename persistence outlet, prove rollback on migration failure,
  and refuse a newer unknown schema.
- The completed V2.2 Slice 3 matrix proves a fixed Electron-main-owned Specialist registry, opaque
  task authority revalidation, exact child Runtime/Context creation, atomic terminal result and
  deterministic dependency join, fixed fail-fast attribution, and one read-only
  `repository_read` recovery recorded as `task_retried`. Same-process and cold-restart replay do not
  repeat a Specialist start, result, handoff, or retry; mutable and ambiguous effects remain
  ineligible. The focused coordination/store/registry/authority matrix passes 275 tests.
- The completed V2.2 Slice 5 matrix proves strict metadata-only Desktop projection, identifier- and
  version-only renderer commands, main-owned fixed-plan construction, exact Specialist start/resume,
  and confirmed monotonic cancellation. Cold restart leaves generic Agent Runtime recovery unable to
  claim Supervisor or Specialist runtimes referenced by coordination tables. The packaged gate
  persists one partial three-task DAG and one started read-only Specialist, reopens it with identical
  session/task/runtime/audit/checkpoint evidence, records `coordinationRestartDuplicateEffects: 0`,
  cancels it, and then completes the unchanged single-Agent GitHub Delivery path.
- V2.1 retrieval-index tests prove atomic activation preserves the previous current snapshot when
  persistence fails, source update/delete removes stale current identities, and corrupt, mismatched,
  cross-scope, non-finite, or over-1024-chunk state fails closed. An explicit bounded rebuild restores
  only derived index state while preserving its Local Project and Run. The completed Slice 3 matrix
  passed 143 local-store tests and 43 shared retrieval tests; the repository verification passed 192
  test files and 2729 tests.
- The completed V2.1 Slice 4 Memory matrix proves accepted-result-only inert candidates, opaque
  main-owned promotion/revision/deletion capabilities, immutable history, explicit optimistic
  conflicts, scope/visibility/expiry filtering, tombstone-before-retrieval, persistence rollback,
  restart-safe derived-index purge, metadata-only audit, and old-replay fencing. It passed 152
  local-store tests and 48 shared retrieval/Memory tests; repository unit verification passed 192
  test files and 2743 tests after the active-Slice document contracts advanced to Slice 5.
- The completed V2.1 Slice 5 Context matrix proves schema 25-to-26 adds no fabricated attachments,
  Runtime creation and full main-owned Context commit atomically, exact replay/cold reopen preserve
  one attachment, refreshed Knowledge and revised/deleted/expired Memory fail the currentness fence,
  and stale Context invokes zero external Tool work even when authority changes between the initial
  check and durable capability grant reservation. The renderer projection v2 strictly exposes only
  attachment/count/identity-digest provenance, with Knowledge Citation and Durable Memory counts
  visible in Desktop while source paths, bodies, and scope sessions remain in Electron main. The
  focused matrix passes 155 local-store, 18 Desktop Runtime, 8 shared Context, 3 renderer-projection,
  1 renderer-access, 1 console-state, and 3 Runtime-panel tests.
  The separate Memory lifecycle matrix passes 4 shared projection, 6 main-owned access, 6
  main-owned human-action, and 7 panel tests. Repository unit verification passes 197 test files and
  2790 tests after the packaged zero-repeat tracer.
- Agent Memory lifecycle UI identifies one selected Run and exact persisted Agent Runtime through an
  identifier-only IPC. Electron main derives the complete user/session/Local Project scope from that
  Runtime, rechecks the canonical Run and exact current Team pairing before and after loading
  revisions or tombstones, then
  emits a bounded strict projection for Candidate pending/promoted and Durable
  active/conflict/expired/purge/deleted state with exact revision/head versions. Renderer parsing
  rejects extra keys; scope sessions, opaque capabilities, authority digests, raw output, local
  paths, and deleted statements remain main-only. Promotion accepts only the selected Runtime/Run/
  Local Project, Candidate ID, and renderer-observed content/provenance digests; Electron main
  derives human policy/actor authority, consumes the opaque capability, and returns a newly read
  strict projection. Statement revision accepts the exact Memory ID, current revision/head versions,
  current content/provenance digests, and a bounded replacement statement; Electron main preserves
  visibility, sensitivity, retention, expiry, and scope authority before consuming the opaque
  revision capability. Deletion accepts the same exact identity/version/digest boundary only after
  a second renderer confirmation, constructs deletion authority solely in Electron main, persists a
  tombstone before purge, and lets an exact `purge_pending` projection resume derived-state cleanup
  without recreating deletion authority.
- The completed V2.1 Slice 6 matrix proves Team schema 18 fabricates zero Memory summaries, Desktop
  schema 27 retains old outbox rows, exact lifecycle and accepted-Context changes coalesce one
  identifier-only operation, Seed/Postgres independently version monotonic lifecycle and quality
  projections, and Web
  rejects extra local content while exposing no Memory or Runtime mutation action.
- The V2.1 candidate-bound evaluator runs with provider and credential authority removed. It binds
  the exact candidate SHA, frozen corpus SHA-256, and combined ADR/PRD/shared-contract SHA-256;
  compares lexical with hybrid retrieval and no-Memory with scoped active Memory; and requires exact
  citation floors plus zero paid-provider, lifecycle, isolation, deletion, resurrection, source,
  raw-output, path, or secret violations. Team projection quality uses independent `qualityVersion`
  evidence and never substitutes for the local Memory content or promotion authority. Completion
  status accepts only the immutable two-file evidence set and truth-document updates in the clean
  direct child of the passing candidate.
- The packaged Desktop pilot must execute exactly one `scenario.evaluate` Local MCP Tool, persist
  one started and one succeeded installation-bound metadata-only audit, and retain one accepted
  action after cold restart without another grant, MCP call, or audit record. It must also complete
  one approved deterministic native Coding repair, persist one permission decision and the exact
  read/write/saved-test audit pairs, and cold-start without repeating a Tool effect. The same
  packaged run must atomically receive one inert Candidate from an accepted observation, promote it,
  revise it once, tombstone and purge it, then reopen one candidate, two revisions, one tombstone,
  four exact Memory audits, zero derived index rows, and `memoryRestartDuplicateEffects: 0`.
  It must additionally cold-restart one partially active V2.2 Coordination Session without another
  accepted start or durable record, cancel its child Runtime, and return
  `coordinationRestartDuplicateEffects: 0` plus `coordinationCancellation: passed` before continuing
  the original single-Agent comparison.
- Coding Executor contract tests must prove capability denial before provider/workspace side effects,
  a path-free main-owned request, ordered bounded permission turns, repeated-permission rejection,
  no-permission completion, and uniform success/failure/cancel/timeout cleanup-aware terminal results.

## Test Layers

- **Shared domain logic**: Vitest unit tests in `packages/shared/src/*.test.ts` cover policy,
  knowledge, command safety, sync, delivery state, redaction, and Acceptance contracts.
- **Electron main/preload**: parser, local-store, runtime, IPC, and smoke tests cover filesystem,
  shell, SQLite, credential, publication, restart reconciliation, and guarded write paths. Renderer
  tests must prove it receives delivery status but no GitHub App credential.
- **API/Postgres**: route and repository tests cover request validation, role/session authority,
  repository binding, Delivery Request approval, credential grants, remote verification, Draft
  completion, revocation, audit, and redaction.
- **Desktop/Web UI**: component tests cover visible state and explicit user actions; browser E2E
  covers the Workbench and Team Console paths.
- **Deterministic GitHub Delivery**: fake GitHub clients and local bare remotes prove exact-commit,
  no-force publication, verified publication adoption across attempts, and Draft reconciliation
  without an external write.
- **Packaged Desktop**: the packaged smoke exercises production main/preload/renderer boundaries,
  local SQLite, a local fake API, a local bare remote, crash/restart reconciliation, and credential
  non-persistence. The pilot also completes a no-side-effect Agent Runtime through the trusted
  Local MCP fixture and proves the accepted action count remains exactly one after cold restart. It
  also drives the native Coding path through real Workflow/Gate prerequisites, one edit approval,
  the saved test, and exact zero-repeat recovery.
- **Fresh systems and lifecycle**: Postgres and Docker smokes prove current migrations, real service
  wiring, retained-volume upgrades, transactional retry, and bounded rollback.
- **Private sandbox**: one explicitly authorized private GitHub sandbox validates real GitHub App
  authentication and one Draft pull request for the frozen candidate only.

## Required Gates By Change Type

- Shared policy, governance, or delivery transition: failing shared unit test, `typecheck`, and
  relevant integration test.
- Gate approval, Delivery Request approval, or override write path: shared/unit test plus Electron or
  API authorization coverage.
- Desktop execution or publication: Electron runtime/unit coverage and packaged Desktop smoke.
- Team API, migration, or Postgres persistence: route/repository coverage and Postgres smoke.
- Compose, upgrade, backup, or rollback behavior: Docker lifecycle smoke.
- User-visible workflow UI: component test and browser E2E when it affects the operator path.
- Cross-platform local execution: cross-platform tests.

## Verification Commands

The frozen V1.5 candidate must run this complete local matrix against one clean candidate SHA:

```bash
corepack pnpm verify
corepack pnpm build
corepack pnpm test:build-output-smoke
corepack pnpm test:e2e
corepack pnpm test:electron-smoke
corepack pnpm test:native-coding-electron-smoke
corepack pnpm test:v15-github-delivery
DEVFLOW_DATABASE_URL=postgres://... corepack pnpm test:postgres-smoke
DEVFLOW_DATABASE_URL=postgres://... corepack pnpm test:local-auth-postgres-smoke
corepack pnpm test:docker-smoke
corepack pnpm test:docker-lifecycle-smoke
corepack pnpm build:desktop-pilot
corepack pnpm test:desktop-pilot-smoke
DEVFLOW_PACKAGED_SMOKE_NETWORK_MODE=offline \
  corepack pnpm test:v15-github-delivery-packaged-smoke
```

`verify` contains type checking, the complete Vitest suite, and cross-platform static checks. It
intentionally excludes production builds, browser/Electron runtime smoke, Postgres, Docker,
packaged Desktop, and the real private GitHub sandbox because those require dedicated environments,
artifacts, or credentials. Their results must be recorded separately against the same frozen
candidate.

The exact-candidate `workflow_dispatch` is also the artifact authority. Its `macOS verify` job
uploads `ai-devflow-studio-v22-candidate-desktop`; formal V2.2 signoff records that archive's digest, and both
local `release:status` and the Release workflow re-read its index/manifest and hash the same archive
bytes. The Release workflow also checks the recorded run against GitHub's run and job APIs before
downloading it. A current-runner rebuild may be smoked, but it cannot silently replace the candidate
artifact.

## External-Cost And Remote-Write Boundary

The deterministic and packaged GitHub Delivery gates use local fakes and local bare remotes. A real private
GitHub sandbox run is a separately authorized release-only gate: one candidate, one approved branch,
one Draft pull request, no automatic retry, and never merge.

This strategy does not authorize paid-provider smoke. GitHub Delivery verification requires no
paid model request, and routine test commands must not call OpenCode or another paid provider unless
a separate, explicit, candidate-bound authorization exists.
