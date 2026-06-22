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

Demo guides:

- Full feature walkthrough:
  [`docs/guides/devflow-studio-full-feature-walkthrough.md`](docs/guides/devflow-studio-full-feature-walkthrough.md)

- v1.3 current hands-on walkthrough:
  [`docs/guides/devflow-studio-v1.3-walkthrough.md`](docs/guides/devflow-studio-v1.3-walkthrough.md)

- v1.2 runtime budget walkthrough:
  [`docs/guides/devflow-studio-v1.2-walkthrough.md`](docs/guides/devflow-studio-v1.2-walkthrough.md)

- v1.0 hands-on user guide:
  [`docs/guides/devflow-studio-v1.0-user-guide.md`](docs/guides/devflow-studio-v1.0-user-guide.md)
- v0.8 historical user guide and workflow validation:
  [`docs/guides/devflow-studio-v0.8-user-guide.md`](docs/guides/devflow-studio-v0.8-user-guide.md)
- v0.9 real runtime / observability demo script:
  [`docs/guides/devflow-studio-v0.9-demo-script.md`](docs/guides/devflow-studio-v0.9-demo-script.md)
- Self-hosted team pilot guide:
  [`docs/guides/devflow-studio-self-hosted-pilot.md`](docs/guides/devflow-studio-self-hosted-pilot.md)

## Core Commands

```bash
corepack pnpm install
corepack pnpm dev:desktop
corepack pnpm dev:electron
corepack pnpm typecheck
corepack pnpm test
corepack pnpm test:postgres-smoke
corepack pnpm test:docker-smoke
corepack pnpm test:agent-live
corepack pnpm test:opencode-smoke
corepack pnpm opencode:status
corepack pnpm test:e2e
corepack pnpm test:electron-smoke
corepack pnpm release:status
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

For the minimum self-hosted team pilot, copy `.env.example`, run `docker compose up --build`, and
open the Web console at `http://127.0.0.1:4311`. Run `corepack pnpm test:docker-smoke` to verify the
containerized API/Web/Postgres stack, Desktop pairing-token exchange, bearer-token sync, and
redacted team overview path. Docker smoke is explicit and is not part of default `verify`.

Use `corepack pnpm build && corepack pnpm --filter @ai-devflow/desktop electron` to run the built
desktop app against `apps/desktop/dist/index.html` without the Vite dev server.

## v0.6.1 Coding Agent / opencode Signoff

The default Coding Agent path is deterministic and uses the fake engine. It is covered by
`corepack pnpm verify`, including the real Electron smoke flow: select a local Git repo, start the
Coding Agent from the build task node, approve the permission relay request, archive a redacted diff,
run the worktree test command, and persist Test Evidence.

The real opencode runtime is explicitly env-gated. It is not part of default `verify` because it
depends on a local opencode installation and provider credentials.

Check the local runtime contract without contacting a provider:

```bash
corepack pnpm opencode:status
```

This reports the local `opencode --version`, confirms live smoke is skipped by default, and shows
whether the real provider profile is intentionally configured.

Default safe check:

```bash
corepack pnpm test:opencode-smoke
```

Without live env vars, this exits successfully and prints the skip message. To manually sign off the
real opencode path, configure the provider and run:

```bash
DEVFLOW_RUN_OPENCODE_SMOKE=1 \
DEVFLOW_CODING_ENGINE=opencode-http \
DEVFLOW_OPENCODE_PROVIDER_ID=openai \
DEVFLOW_OPENCODE_MODEL_ID=gpt-4.1-mini \
OPENAI_API_KEY="$OPENAI_API_KEY" \
corepack pnpm test:opencode-smoke
```

For Volcengine Ark Coding Plan through an opencode provider such as `double`:

```bash
DEVFLOW_RUN_OPENCODE_SMOKE=1 \
DEVFLOW_CODING_ENGINE=opencode-http \
DEVFLOW_OPENCODE_PROVIDER_ID=double \
DEVFLOW_OPENCODE_MODEL_ID=ark-code-latest \
DEVFLOW_OPENCODE_API_KEY_ENV=VOLCENGINE_ARK_API_KEY \
VOLCENGINE_ARK_API_KEY="$VOLCENGINE_ARK_API_KEY" \
corepack pnpm test:opencode-smoke
```

Expected live-smoke result: DevFlow starts `opencode serve`, creates a managed Git worktree, sends
the DevFlow coding brief, relays opencode permission requests, captures a redacted diff, runs
dependency bootstrap when needed, runs `npm test` in the worktree, and removes the temporary smoke
repo afterward. The smoke output must not print the provider key. v0.6.1 live signoff has been
verified with opencode `1.17.5` and Volcengine Ark `double/ark-code-latest`, including a multi-step
`bash -> edit -> bash -> bash` permission sequence.

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

For release signoff, the real opencode provider smoke is stricter: starting with the next product
release, run one live `opencode` smoke against the configured Doubao/Volcengine provider before
creating the release tag, and record the result with
[`docs/plans/release-only-real-opencode-smoke.md`](docs/plans/release-only-real-opencode-smoke.md).
This release-only gate must stay outside default CI and must never print provider secrets.

The first Playwright run in a fresh environment may need browser binaries:

```bash
corepack pnpm exec playwright install
```

## v0.8.1 Release Status

Before creating the `v0.8.1` release tag, run:

```bash
corepack pnpm release:status
```

This checks the local release-signoff prerequisites that are easy to forget: package metadata,
required signoff docs, git cleanliness, tag presence, and whether the manual walkthrough has been
marked complete. Pending items are expected before the final walkthrough and version bump; true
inconsistencies are marked for attention.

For a hard gate after the human walkthrough and package bump, run:

```bash
DEVFLOW_RELEASE_WALKTHROUGH=passed corepack pnpm release:status -- --strict
```

## GitHub Actions Release Workflow

`.github/workflows/verify.yml` is the default quality gate for pushes and pull requests. It runs
macOS verification, Windows compatibility checks, and Postgres integration smoke tests.

`.github/workflows/release.yml` is intentionally narrower and only runs for explicit releases:

- manual `workflow_dispatch`
- pushed tags matching `v*`

The release workflow verifies the repository, builds the desktop/web/API/worker outputs, uploads a
single `ai-devflow-studio-release-artifacts` workflow artifact, and creates or updates a GitHub
Release for tag-triggered runs. It does not deploy a production web/API service, publish npm
packages, run paid real-opencode provider smoke, or produce signed Electron installers yet. The paid
real-opencode provider smoke is a manual release-only signoff gate documented in
`docs/plans/release-only-real-opencode-smoke.md`.
