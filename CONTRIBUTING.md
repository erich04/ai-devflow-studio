# Contributing To DevFlow Studio

DevFlow Studio is a portfolio-grade multi-runtime app. Keep changes small, tested, and easy to replay.

## Working Rules

- Work on a feature branch, not `main`/`master`.
- Do not mix new product scope into signoff or hardening patches.
- Prefer shared pure functions for domain rules used by both API and Electron.
- Renderer code must not directly access filesystem, shell, credentials, or SQLite.
- Team policy truth lives in API/Postgres; Desktop consumes, caches, explains, and enforces.

## TDD-Style Flow

- Write a failing test before changing behavior.
- Use the narrowest test layer that proves the contract.
- For write paths, do not rely on disabled UI only; test the main/API enforcement path.
- Refactor only after focused tests pass.

## Signoff Checklist

Before claiming a milestone or hardening patch is complete:

- `git status --short` is clean except intentional changes.
- New files are tracked by git.
- Focused tests for the changed area pass.
- `corepack pnpm typecheck` passes.
- `corepack pnpm test` passes.
- `corepack pnpm test:e2e` and `corepack pnpm test:electron-smoke` pass when UI/runtime paths changed.
- `corepack pnpm test:postgres-smoke` passes when API/Postgres policy or sync behavior changed.
- `corepack pnpm build` and `corepack pnpm verify` pass.
- Roadmap or plan docs record the signoff when the change completes a milestone.
