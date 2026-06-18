# DevFlow Studio Testing Strategy

DevFlow Studio follows a TDD-style discipline for new behavior: write the smallest failing test for the contract first, implement the minimum code to pass, then refactor under the same tests. Older fixture-driven UI does not need retroactive TDD rewrites unless it is touched.

## Test Layers

- **Shared domain logic**: use Vitest unit tests in `packages/shared/src/*.test.ts` before changing policy, knowledge, command safety, remote sync, or coding contracts.
- **Electron main/preload**: add IPC parser, local-store, runtime, or smoke coverage for any filesystem, shell, SQLite, credential, or write-path change.
- **API/Postgres**: route tests cover request contracts and authorization; `test:postgres-smoke` covers real migration, persistence, policy evaluation, override audit, and sync paths.
- **React desktop/web**: component tests cover visible UI state and user actions; browser E2E covers core workbench and team-console flows.
- **Smoke tests**: Electron smoke proves real preload/main/SQLite behavior; Postgres smoke proves real team backend behavior.

## Required Gates By Change Type

- Shared policy or governance rule: failing shared unit test, `typecheck`, `test`.
- Gate approval or override write path: shared/unit test plus Electron or API smoke coverage.
- Desktop local execution or coding runtime: Electron runtime/unit test and `test:electron-smoke`.
- Team API or Postgres persistence: route/repository test and `test:postgres-smoke`.
- User-visible workflow UI: React test and, when it affects a demo path, browser E2E.
- Cross-platform local execution code: `test:cross-platform`.

## Default Verification

Run before signing off:

```bash
corepack pnpm typecheck
corepack pnpm test
corepack pnpm test:cross-platform
corepack pnpm test:e2e
corepack pnpm test:electron-smoke
corepack pnpm build
corepack pnpm verify
```

Run when Postgres behavior changes:

```bash
DEVFLOW_DATABASE_URL=postgres://... corepack pnpm test:postgres-smoke
```

`verify` intentionally excludes Postgres because it needs an external database.
