# DevFlow Studio Self-Hosted Pilot Guide

This guide runs the minimum v1.0 team pilot stack: Web, API, and Postgres. It is for a small
self-hosted evaluation, not for public SaaS deployment.

## What This Stack Proves

- API and Web run outside the development shell.
- Postgres migrations and demo seed data run inside the stack.
- Web can create a Desktop pairing code for a project.
- Desktop can exchange that code for a scoped Bearer token.
- Authenticated Desktop sync can upload a redacted run summary.
- Web can show the synced project/run state without raw stdout/stderr, cwd, prompt, patch body, or
  provider secret.

## Prerequisites

- Docker with Compose v2.
- Node.js/Corepack only if you want to run local smoke commands from the repo.

## Configure

Copy the example file and replace secrets before sharing the stack with a real team:

```bash
cp .env.example .env
```

Important values:

- `DEVFLOW_SESSION_SECRET`: replace with a long random string.
- `POSTGRES_PASSWORD`: replace before using a persistent host.
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_OAUTH_REDIRECT_URI`: optional for the Docker
  smoke, required for a real GitHub OAuth walkthrough.

## Run The Stack

```bash
docker compose up --build
```

Open:

- Web: <http://127.0.0.1:4311>
- API health: <http://127.0.0.1:4310/health>

The API service runs migrations and seed data before starting. The Web service uses
`DEVFLOW_INTERNAL_API_BASE_URL=http://api:4310` for server-side calls and
`NEXT_PUBLIC_DEVFLOW_API_URL=http://127.0.0.1:4310` for browser-facing links.

## Desktop Pairing Walkthrough

1. Open the Web Team Console.
2. In the Projects panel, click `Create desktop pairing code`.
3. Copy the generated code. Treat it as a short-lived secret.
4. Open the Electron Desktop app.
5. Paste the code into the `Pairing code` field in the topbar and click `Pair`.
6. Click `同步团队`.

After pairing, Desktop sync uses an authenticated Bearer token instead of demo headers. If token
auth fails, the client must reconnect instead of silently falling back to demo mode.

## Smoke Test

Run the explicit Docker smoke from the repo:

```bash
corepack pnpm test:docker-smoke
```

The smoke starts an isolated Compose project on temporary host ports, creates a pairing code,
exchanges it for a Desktop token, syncs a redacted run summary, verifies Web/API visibility, and
then tears the stack down with volumes removed.

`test:docker-smoke` is intentionally not part of `corepack pnpm verify` because it requires Docker.

## Stop And Reset

```bash
docker compose down
docker compose down -v
```

Use `down -v` only when you want to remove the pilot Postgres data volume.

## Current Boundaries

- No automatic HTTPS.
- No Kubernetes.
- No token rotation or revoke UI.
- No multi-Desktop concurrency guarantee.
- No public SaaS onboarding.
