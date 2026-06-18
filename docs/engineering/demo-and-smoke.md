# DevFlow Studio Demo And Smoke Guide

This guide keeps the portfolio demo reproducible after v0.7.5.

## Desktop Demo

```bash
corepack pnpm dev:electron
```

Expected result: the app window title is `AI DevFlow Studio`, and Electron loads `apps/desktop` rather than `default_app.asar`.

Suggested path:

- Open the Workbench.
- Select a Gate node and inspect Gate Enforcement reasons.
- Run Knowledge Review to create an Agent Review, trace, advisory, findings, and token usage.
- Connect a local repo, save a test command, and run local tests to archive Test Evidence.
- Open Agents to inspect review/coding history and trace.
- Toggle theme/MCP state and restart to confirm local persistence.

## Web/API Team Demo

```bash
corepack pnpm dev:api
corepack pnpm dev:web
```

Open `http://127.0.0.1:4311`.

Suggested path:

- View Team Overview, runs, evidence, Agent Review summaries, and policy state.
- Apply the Recommended Enforcement preset in the policy panel.
- Confirm weaker project overrides are clamped and explained.

## Smoke Commands

```bash
corepack pnpm test:e2e
corepack pnpm test:electron-smoke
```

For Postgres, start a disposable database or use a clean local one:

```bash
export DEVFLOW_DATABASE_URL='postgres://postgres:devflow@127.0.0.1:55432/devflow_v07'
corepack pnpm test:postgres-smoke
```

The Postgres smoke must cover migration, seed, policy save/read, enforcement evaluation, owner/member/conflicted-lead override rejection, accepted lead override, stale policy rejection, approval sync bypass rejection, and overview redaction.
