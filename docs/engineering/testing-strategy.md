# DevFlow Studio Testing Strategy

DevFlow Studio follows a TDD discipline for new behavior: write the smallest failing contract test,
implement only enough to pass, then refactor under the same tests. Fixture-driven UI does not need
retroactive TDD rewrites unless it is touched.

## Current Persistence Baseline

- Team/API/Postgres uses Team schema v15. Migration tests must prove a fresh v15 database, the
  populated v11-to-v12 delivery-series upgrade, and the v12-to-v13 provider-authoritative expiry
  contract without inventing expiry evidence for legacy issued credentials, followed by the
  v13-to-v14 bounded provider retry boundary, and the v14-to-v15 verified publication adoption
  authority without changing legacy grant-backed publications.
- Electron/SQLite uses Desktop schema v18. Local-store tests must prove a fresh v18 database, the
  Desktop schema 17-to-18 retained upgrade with no invented Runtime rows, rollback on migration
  failure, and refusal of a newer unknown schema.

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
  non-persistence. The pilot also completes a no-side-effect Agent Runtime and proves the
  accepted action count remains exactly one after cold restart.
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
corepack pnpm test:v15-github-delivery
DEVFLOW_DATABASE_URL=postgres://... corepack pnpm test:postgres-smoke
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
uploads `ai-devflow-studio-v15-candidate-desktop`; signoff records that archive's digest, and both
local `release:status` and the Release workflow re-read its index/manifest and hash the same archive
bytes. The Release workflow also checks the recorded run against GitHub's run and job APIs before
downloading it. A current-runner rebuild may be smoked, but it cannot silently replace the candidate
artifact.

## External-Cost And Remote-Write Boundary

The deterministic and packaged V1.5 gates use local fakes and local bare remotes. A real private
GitHub sandbox run is a separately authorized release-only gate: one candidate, one approved branch,
one Draft pull request, no automatic retry, and never merge.

This strategy does not authorize paid-provider smoke. V1.5 GitHub Delivery verification requires no
paid model request, and routine test commands must not call OpenCode or another paid provider unless
a separate, explicit, candidate-bound authorization exists.
