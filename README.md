# AI DevFlow Studio

AI DevFlow Studio is a team AI development workflow platform with an Electron developer client.

It is designed for small engineering teams that want AI to move work from clarification to design,
implementation, tests, and pull request, while keeping human gates, team knowledge, MCP tools, and
token cost visible.

## Product Shape

- `apps/desktop`: Electron developer client and local execution workbench.
- `apps/web`: team and manager overview console.
- `apps/api`: team API for runs, projects, skills, MCP definitions, and cost telemetry.
- `apps/worker`: async rollup worker placeholder.
- `packages/shared`: domain types, fixtures, cost aggregation, gate policy, redaction, and graph helpers.

Long-term roadmap: [`docs/roadmap.md`](docs/roadmap.md).

## Core Commands

```bash
corepack pnpm install
corepack pnpm dev:desktop
corepack pnpm dev:electron
corepack pnpm typecheck
corepack pnpm test
corepack pnpm test:postgres-smoke
corepack pnpm test:e2e
corepack pnpm test:electron-smoke
```

Use `corepack pnpm dev:desktop` for browser-only UI work. It cannot open local folders or execute
tests because the Electron preload API is not present.

Use `corepack pnpm dev:electron` for the real local demo. It builds the Electron main/preload bundle,
starts the Vite renderer at `http://127.0.0.1:5173`, and launches Electron with local repository
selection, controlled IPC, command safety checks, and SQLite persistence enabled.

The API uses seed data by default for local demos. Set `DEVFLOW_DATABASE_URL` or `DATABASE_URL`
before `corepack pnpm dev:api` to run it against Postgres; uploaded Electron Run/Test Evidence
summaries are written as redacted team records.

For a local Postgres demo, set the database URL and run:

```bash
corepack pnpm --filter @ai-devflow/api db:setup
corepack pnpm dev:api
```

Use `corepack pnpm test:postgres-smoke` with the same database URL to verify migration, seed,
Postgres-backed API reads, and redacted sync write-through.

Use `corepack pnpm build && corepack pnpm --filter @ai-devflow/desktop electron` to run the built
desktop app against `apps/desktop/dist/index.html` without the Vite dev server.
