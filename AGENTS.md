# AGENTS.md

## Cursor Cloud specific instructions

This section captures durable, non-obvious context for running AI DevFlow Studio in the
Cursor Cloud environment. Standard commands live in `README.md`, `CONTRIBUTING.md`, and the
root `package.json` scripts — prefer those and only rely on the notes below for the
environment-specific gotchas.

### Environment baseline (already provisioned in the VM image)

- Node is the environment default (`node` on `PATH`, currently v22.x). There is a system
  `/exec-daemon/node` that takes `PATH` precedence over any `nvm` install, so do NOT rely on
  `nvm use`; just use the default `node`. The repo has no `engines` constraint and the full
  test suite passes on this Node.
- `pnpm` is provided via `corepack` (`packageManager: pnpm@9.15.0`). Always invoke it as
  `corepack pnpm ...` (matches README/Dockerfile).
- PostgreSQL 16 is installed for the team stack. It is a normal service, so it is NOT started
  automatically. Start it each session before running the API against Postgres:
  `sudo pg_ctlcluster 16 main start`
  The `devflow` database, the `postgres` role password (`devflow`), the applied migrations,
  and the seeded demo data persist in the VM snapshot — you normally only need to start the
  cluster, not recreate anything.

### Dependency refresh

- The startup update script only runs `corepack pnpm install --frozen-lockfile`. That is all
  that is needed to refresh dependencies after pulling changes.

### Running lint / tests

- Typecheck (this repo's "lint"): `corepack pnpm typecheck`.
- Unit/component tests: `corepack pnpm test`. IMPORTANT: a handful of Electron
  coding-runtime/worktree tests do heavy git+filesystem work and are slow on this overlayfs;
  with the default 5s per-test timeout ~7 of them time out even though they pass in isolation.
  Run the suite with a larger timeout to get a clean green run:
  `corepack pnpm exec vitest run --testTimeout=30000`
  (`corepack pnpm verify` runs `typecheck` + `test` + `test:cross-platform`; when you need it
  green here, run those three steps individually and use the higher timeout for the test step.)
- Cross-platform static audit: `corepack pnpm test:cross-platform`.

### Running the team stack (API + Web + Postgres) for local development

Docker is not installed here, so use the local dev servers directly (not `docker compose`).
Run the API in the default `development` profile (NOT `pilot`, which would require GitHub OAuth
secrets and HTTPS-style invariants):

1. Start Postgres (see above), then apply migrations if needed:
   `DEVFLOW_DATABASE_URL="postgres://postgres:devflow@127.0.0.1:5432/devflow" corepack pnpm --filter @ai-devflow/api db:migrate`
   Optional demo data:
   `DEVFLOW_DATABASE_URL="postgres://postgres:devflow@127.0.0.1:5432/devflow" DEVFLOW_ENABLE_DEMO_DATA=true corepack pnpm --filter @ai-devflow/api db:seed`
2. API (`:4310`):
   `DEVFLOW_DATABASE_URL="postgres://postgres:devflow@127.0.0.1:5432/devflow" DEV_AUTH_ENABLED=true HOST=127.0.0.1 PORT=4310 corepack pnpm --filter @ai-devflow/api dev`
3. Web console (`:4311`): `corepack pnpm --filter @ai-devflow/web dev`
   (defaults to `http://127.0.0.1:4310` for the API, so no extra env is needed).

Auth notes:
- `DEV_AUTH_ENABLED=true` only authenticates NON-browser clients (requests WITHOUT an `Origin`
  header). Use it for API calls via `curl`/scripts with headers like
  `x-devflow-session-source: demo`, `x-devflow-user-id: u-erich`, `x-devflow-user-role: owner`,
  `x-devflow-organization-id: org-demo`. Browsers send `Origin`, so the Web console itself still
  requires GitHub OAuth to display team data — expect the "Sign in with GitHub" shell in a
  browser unless OAuth is configured.
- API-backed writes (e.g. `POST /api/team/projects`) hit real foreign keys; the referenced org
  and user must exist. Run `db:seed` first (creates `org-demo` and `u-erich`) before writing as
  that demo owner.
- If you do not want Postgres at all, the API can run against an in-memory seed repository with
  no `DEVFLOW_DATABASE_URL` and `DEVFLOW_ENABLE_DEMO_DATA=true`.

### Running the Electron desktop app (the core product)

- The core local-first client is the real Electron app: `corepack pnpm dev:electron`
  (the browser-only `dev:desktop` cannot select folders, run tests, or execute workflow writes).
- In this headless container Electron needs a display and the Chromium sandbox disabled. A
  virtual display is available at `DISPLAY=:1`, and the launcher forwards extra args to Electron,
  so start it as:
  `DISPLAY=:1 DEVFLOW_ENABLE_DEMO_DATA=true DEV_AUTH_ENABLED=true DEVFLOW_ENABLE_FAKE_RUNTIME=true DEVFLOW_CODING_ENGINE=fake node scripts/dev-electron.mjs --no-sandbox`
- The startup log prints noisy but harmless warnings (`Failed to connect to the bus`,
  `Exiting GPU process`, `dconf-WARNING`, DevTools `Autofill.*`). These do NOT indicate failure.
- The fake runtime flags expose the deterministic Workflow/Review provider and fake Coding engine
  so the full Run → Clarify → Gate flow works without any paid provider credentials.
- Creating a Run requires BOTH the "标题" (title) field and the "一句话需求" (request) field in the
  New Run modal; leaving the title blank silently fails validation with a toast.
