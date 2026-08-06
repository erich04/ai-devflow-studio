# DevFlow Studio Self-Hosted Pilot Guide

This guide runs the v1.4 pilot stack: Web, API, and Postgres. It is intended for a small,
self-hosted evaluation behind an operator-controlled network boundary, not public SaaS deployment.

## What This Stack Proves

- API and Web run as non-root users from production build output, without workspace source or
  development launchers.
- A one-shot migration must finish successfully before API startup; API readiness then verifies the
  expected Postgres schema version.
- Web can create a Desktop pairing code for a project and Desktop can exchange it for a scoped
  Bearer token.
- Web can create a versioned Work Request; the paired Desktop can claim it, materialize the one
  canonical local Run, and upload only its redacted summary.
- Web can submit a version- and policy-bound Gate Command. The claiming Desktop receives it through
  the durable inbox/receipt protocol, re-evaluates local evidence, persists the outcome, and
  acknowledges the exact receipt without giving Team direct mutation authority over the Run.
- Web can show synced project/run state without raw stdout/stderr, cwd, prompt, patch body, or a
  provider secret.

The development-tree walkthrough recorded on 2026-08-01 is available in
[the V1.4 Computer Use result](./devflow-studio-v1.4-walkthrough-result-2026-08-01.md). It is
implementation evidence, not a formal V1.4 release signoff.

## Prerequisites

- Docker with Compose v2.
- Node.js/Corepack only when running repository smoke commands on the host.
- A GitHub OAuth app whose callback URL exactly matches `GITHUB_OAUTH_REDIRECT_URI`.

The candidate pins its Node and Postgres base images by multi-architecture manifest digest. Update
those digests only as an explicit reviewed dependency change, then rerun both Docker smoke commands
before promoting a new candidate.

## Configure

Copy the example and fill every blank value before starting the stack:

```bash
cp .env.example .env
```

Required values:

- `POSTGRES_PASSWORD`: a URL-safe random password because Compose places it in the internal
  Postgres connection URL.
- `DEVFLOW_SESSION_SECRET`: an independent random value of at least 32 characters.
- `DEVFLOW_AGENT_CREDENTIAL_KEY`: another independent random value of at least 32 characters. It
  encrypts stored provider credentials and must be retained for the lifetime of that data.
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `GITHUB_OAUTH_REDIRECT_URI`: the complete GitHub
  OAuth bootstrap configuration. Pilot startup rejects missing, partial, or invalid values.
- `DEVFLOW_WEB_APP_URL`: the browser-reachable Web console URL. After a successful GitHub callback,
  the API redirects here instead of its own non-UI root path.

`DEVFLOW_WEB_APP_URL` and `GITHUB_OAUTH_REDIRECT_URI` must use the same scheme and hostname; their
ports may differ. This keeps the OAuth state/session cookies on one browser trust boundary. When
that shared scheme is HTTPS, the API marks both cookies `Secure`, so terminate TLS consistently at
the trusted reverse proxy and do not mix HTTP and HTTPS URLs.

For example, `openssl rand -hex 32` can generate each secret. Never reuse the displayed examples,
put real values in source control, or rotate `DEVFLOW_AGENT_CREDENTIAL_KEY` without a credential
re-encryption procedure.

Compose fixes the API to `DEVFLOW_DEPLOYMENT_PROFILE=pilot`, `DEVFLOW_REQUIRE_AUTH=true`,
`DEV_AUTH_ENABLED=false`, and disables demo data and fake runtime. The API refuses to start if a
pilot attempts to weaken those invariants; in particular, `DEV_AUTH_ENABLED=true` is rejected.
Unsigned `x-devflow-*` identity headers remain available
only for an explicitly enabled, loopback-bound, non-browser development API.

### Allowed API environment variables

The pilot API owns this explicit configuration surface:

- Network: `HOST`, `PORT`.
- Database: `DEVFLOW_DATABASE_URL` (or `DATABASE_URL`),
  `DEVFLOW_DATABASE_APPLICATION_NAME`, and `DEVFLOW_DATABASE_STATEMENT_TIMEOUT_MS`.
- Security: `DEVFLOW_DEPLOYMENT_PROFILE`, `DEVFLOW_REQUIRE_AUTH`, `DEV_AUTH_ENABLED`,
  `DEVFLOW_SESSION_SECRET`, `DEVFLOW_AGENT_CREDENTIAL_KEY`, and `DEVFLOW_WEB_APP_URL`.
- Runtime gates: `DEVFLOW_ENABLE_DEMO_DATA` and `DEVFLOW_ENABLE_FAKE_RUNTIME`; both must be `false`
  in pilot.
- Login: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `GITHUB_OAUTH_REDIRECT_URI`.

Unknown `DEVFLOW_*` or `DEV_AUTH_*` names are rejected in pilot so misspelled safety settings do
not silently pass. Compose passes only the variables above. The Web runtime allowlist is
`DEVFLOW_INTERNAL_API_BASE_URL`, `DEVFLOW_PUBLIC_API_BASE_URL`, `HOSTNAME`, and `PORT`.

## Run The Stack

```bash
docker compose up --build
```

The migration container runs `node migrate.js` once. Only after it exits successfully does the API
run `node server.js`; only after API readiness succeeds does the standalone Web server run
`node apps/web/server.js`. Neither runtime image contains `tsx`, application source, or workspace
development dependencies.

Open:

- Web: <http://127.0.0.1:4311>
- API liveness: <http://127.0.0.1:4310/health>
- API readiness: <http://127.0.0.1:4310/ready>
- Web liveness: <http://127.0.0.1:4311/health>
- Web readiness: <http://127.0.0.1:4311/ready>

`/health` proves the process can answer. `/ready` proves the API can use the current database schema;
Web readiness also depends on API readiness. Compose uses readiness for startup ordering.

The Web service uses `DEVFLOW_INTERNAL_API_BASE_URL=http://api:4310` for server-side calls and
`DEVFLOW_PUBLIC_API_BASE_URL` for browser-facing OAuth links. Set the latter to the URL users can
actually reach when the pilot is behind a reverse proxy.

Demo seed data is never loaded during normal pilot startup. For an isolated demonstration only,
invoke the explicit one-shot utility after the stack is ready:

```bash
docker compose run --rm seed
```

Do not run that utility against a real team database.

## Build And Verify The Desktop Pilot Bundle

Build the current-host Desktop application, deterministic archive, and manifest from repository
build output:

```bash
corepack pnpm build:desktop-pilot
```

The command writes `out/desktop-pilot/artifact-index.json`, a current-platform app directory, a
`.tar.gz` archive, and a `.manifest.json` file. The manifest records the packaged files and archive
SHA-256 without embedding the source checkout path. Verify that the exact packaged executable
starts with isolated user data, loads its built renderer over `file://`, and ignores an injected
development-server URL:

```bash
corepack pnpm test:desktop-pilot-smoke
```

This bundle is deliberately narrow:

- it is built only for the current host platform and architecture;
- it is unsigned and unnotarized, and the archive is not an installer;
- it contains the built renderer, Electron main/preload output, and the required `sql.js` runtime,
  not workspace source or a development launcher;
- the smoke proves launch isolation and built-renderer loading, not code signing, auto-update,
  Windows UI behavior from a macOS host, or suitability for public distribution.

Version alignment occurs during V1.4 candidate formation. The packaged artifact manifest and
filenames must match the frozen candidate version, but a version label alone is never evidence of
V1.4 signoff.

## Complete Pairing, Work Request, And Gate Walkthrough

1. Sign in to the Web Team Console with GitHub OAuth and select the intended Team Project.
2. In the Projects panel, click `Create desktop pairing code`. Copy the generated code and treat it
   as a short-lived secret.
3. Open the Electron Desktop app, select the Local Project, paste the code into `Desktop pairing
   code`, click `绑定`, and then click `同步团队`.
4. In Web, create a Work Request for that same Team Project with a bounded title and request body.
5. In Desktop, open the paired Local Project, refresh `Work Requests`, and click `创建本地 Run` for
   the request. Desktop atomically claims the expected Work Request version, binds a deterministic
   local Run ID, creates the canonical local Run, and acknowledges materialization. Team does not
   fabricate a Run before this succeeds.
6. Advance the local Run through clarification to its Gate. Click `同步团队` when prompted so
   Desktop holds the current project-scoped Team policy snapshot and Team receives the current
   redacted Run projection.
7. Refresh Web, open the projected Run, choose `approve` or `reject`, enter the required reason, and
   submit the Gate Command. Web submits collaboration intent; it never patches the local Run.
8. Leave the claiming Desktop running. Its scheduler polls the project-scoped command inbox,
   acquires a bounded receipt, verifies project/claim/Run/node/version/policy/blocker scope, and
   re-evaluates the complete local evidence. Approval uses the shared transition; rejection records
   a human decision and keeps the Run paused at the Gate.
9. Confirm in Web that the command reaches a terminal lifecycle after Desktop acknowledges the
   exact receipt. A later `同步团队` publishes any new redacted Run version; the acknowledgement
   itself never mutates the Team Run Projection.

After pairing, Desktop sync uses an authenticated Bearer token instead of demo headers. If token
auth fails, the client must reconnect instead of silently falling back to demo mode. A
`stale_run`, `stale_policy`, blocker mismatch, or expired command is a safe terminal rejection: no
local transition is assumed, and the Web user must refresh before creating a new command.

## Smoke Test

Run the explicit Docker smoke from the repository:

```bash
corepack pnpm test:docker-smoke
```

The smoke starts an isolated Compose project on temporary host ports. Its harness runs the explicit
seed utility, uses a signed authenticated session Cookie to create a pairing code, exchanges that
code for a Desktop Bearer token, executes the Work Request and Gate Command flow, verifies Web/API
visibility, and then removes its isolated stack and volume. It does not enable unsigned identity
headers. `test:docker-smoke` is outside `corepack pnpm verify` because it requires Docker, though CI
runs it in the dedicated Docker smoke step.

### V1.4 lifecycle and rollback matrix

Run the explicit lifecycle proof before forming a release candidate:

```bash
corepack pnpm test:docker-lifecycle-smoke
```

This command is no-cost and remains outside the default `verify` command. It builds the exact
annotated `v1.3.0` source, pins its resolved commit, and exercises these isolated databases and
containers:

| Scenario | Automated proof | Supported operator action |
| --- | --- | --- |
| Fresh V1.4 deploy | The production migration bundle creates schema v10 from an empty database. | Start the one-shot migrator before API/Web. |
| Retained-data upgrade | V1.3 schema v7 and seeded Run data survive a Postgres container restart and the V1.4 migration to schema v10. | Back up the Postgres volume, stop writers, run the V1.4 migrator once, then start V1.4 API/Web. |
| Failed upgrade | A deliberately incompatible v9 Gate row makes v10 fail; the transaction leaves schema v9 unchanged. After the row is remediated, the same production migrator reaches v10. | Keep the failed database offline, fix the reported incompatible data, and rerun the V1.4 migrator. Do not partially apply migration SQL by hand. |
| API application rollback | The exact V1.3 API starts against the upgraded schema v10 and performs an authenticated overview read that retains V1.3 data. | A bounded read-path rollback to the V1.3 API is supported while keeping schema v10, but operators must not run the V1.3 migrator against that upgraded database. Return to V1.4 for writes and further migrations. |
| Desktop application rollback | V1.4 Desktop schema v12 contains migrations unknown to V1.3 schema v8. | There is no in-place Desktop database downgrade. Before upgrading, back up the Desktop user-data directory; to return to V1.3, restore the pre-upgrade backup or use a separate V1.3 user-data directory. |

The API rollback check is deliberately bounded: it proves the V1.3 authenticated read surface can
consume the additive V1.4 Team schema. It does not claim that old binaries own V1.4 writes or can
reverse schema v10. A database-level rollback requires restoring the pre-upgrade Postgres backup.

## Stop And Reset

```bash
docker compose down
docker compose down -v
```

Use `down -v` only when you intentionally want to delete the pilot Postgres volume.

## Current Boundaries

- No automatic HTTPS; terminate TLS at a trusted reverse proxy.
- The Desktop pilot artifact is current-host, unsigned, unnotarized, and has no installer or
  auto-update channel.
- No Kubernetes deployment.
- No provider-key rotation or Desktop token revoke UI.
- No multi-Desktop concurrency guarantee beyond the documented Gate Command lease contract.
- No public SaaS onboarding.
- The 2026-08-01 implementation walkthrough used no paid provider call and does not constitute
  formal V1.4 signoff.
