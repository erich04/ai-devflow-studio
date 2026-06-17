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
- `packages/shared`: domain types, fixtures, cost aggregation, gate policy, redaction, knowledge
  governance, and graph helpers.

Long-term roadmap: [`docs/roadmap.md`](docs/roadmap.md).

## Core Commands

```bash
corepack pnpm install
corepack pnpm dev:desktop
corepack pnpm dev:electron
corepack pnpm typecheck
corepack pnpm test
corepack pnpm test:postgres-smoke
corepack pnpm test:agent-live
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
Postgres-backed API reads, explicit demo session headers with `DEVFLOW_REQUIRE_AUTH=true`, and
redacted sync write-through.

Use `corepack pnpm build && corepack pnpm --filter @ai-devflow/desktop electron` to run the built
desktop app against `apps/desktop/dist/index.html` without the Vite dev server.

## v0.5 Knowledge Review Agent Demo

The default demo uses the deterministic fake provider, so it is repeatable and cost-free. It proves
the Agent runtime, trace, advisory, token usage, artifact, event, and redacted team summary paths
without calling a live model.

1. Start the real Electron app:

   ```bash
   corepack pnpm dev:electron
   ```

2. In Electron, choose a local repository from the project picker.
3. Select a Gate node in the workflow canvas.
4. Click `Agent Review` in the Inspector.
5. Open the `Agents` view to inspect the Knowledge Review Agent history, trace, warning-only Gate
   advisory, provider status, and token/cost source.
6. To see the team-visible summary, start the API/Web pair and open the Web console:

   ```bash
   corepack pnpm dev:api
   corepack pnpm dev:web
   ```

   Electron sync uploads only redacted Agent Review summaries. The Web console should show the
   conclusion/advisory/cost without local cwd, stdout/stderr, raw prompt, or provider secrets.

For a real OpenAI-compatible smoke test, set `DEVFLOW_AGENT_OPENAI_API_KEY` or `OPENAI_API_KEY`
and run:

```bash
corepack pnpm test:agent-live
```

Optional live provider smoke is not part of `corepack pnpm verify`; it should be run manually when
you explicitly want to spend provider quota and validate the live request/usage mapping path.

The first Playwright run in a fresh environment may need browser binaries:

```bash
corepack pnpm exec playwright install
```
