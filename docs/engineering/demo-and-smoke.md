# DevFlow Studio Demo And Smoke Guide

This guide describes the released V1.5 GitHub Delivery path. `v1.5.0` is the current release, the
finite 1.x completion gate passed, and its immutable candidate-bound evidence lives under
`docs/releases/v1.5.0/`.

## Baseline Prerequisites

- Team/API/Postgres must report Team schema v21 with provider-authoritative expiry, bounded
  provider retry, verified publication adoption, and metadata-only Agent Runtime, Memory, and
  Coordination projection contracts.
- Electron/SQLite must report Desktop schema v34.
- The Web/API/Postgres walkthrough needs authenticated owner, lead, and paired Desktop identities.
- A GitHub Delivery walkthrough needs a verified GitHub App repository binding, one tested canonical
  managed-worktree commit, a PR Delivery Package, and an exact Delivery Intent.
- Use fake GitHub clients and a local bare remote for routine demos. A real private GitHub sandbox is
  a release-only environment and requires separate candidate-bound authorization.

## Desktop Demo

```bash
corepack pnpm dev:electron
```

Expected result: the window title is `AI DevFlow Studio`, and Electron loads `apps/desktop` rather
than `default_app.asar`.

Suggested path:

1. Open Workbench, connect the local repository, and select the current Run.
2. Inspect Gate Enforcement, Knowledge Review, Coding Agent trace, diff, and Test Evidence.
3. Generate the metadata-only PR Delivery Package and prepare an immutable Delivery Intent.
4. Sync the redacted Delivery Request, then use a separate signed Web lead/owner session to approve
   that exact revision.
5. Resume Desktop publication and confirm the expected commit becomes the verified remote head and
   one matching Draft pull request is recorded.
6. Inspect the completion evidence before Acceptance. Acceptance must never merge or mutate the pull
   request.

Electron main owns the managed worktree read and publication. The GitHub App private key stays in
the API, the short-lived repository token stays in Electron main memory, and the renderer sees only
status.

## Recovery Actions

- **Revise**: create a new pre-publication intent revision after material changes and invalidate the
  previous approval.
- **Resume**: continue the same `recovery_required` attempt without allocating another remote
  identity.
- **Retry**: create the next attempt only after the current pairing claimant proves the exact remote
  predecessor `failed` or `revoked`. If that predecessor already has a verified publication for the
  same immutable series and failed only at Draft creation, the approved next attempt adopts that
  evidence and proceeds directly to Draft reconciliation without another credential or push.
- **Stop**: park the exact active attempt for manual recovery without claiming remote rollback.

None of these actions may silently reuse approval, force-push, delete a branch, publish a tag, or
merge a pull request.

## Web/API Team Demo

```bash
corepack pnpm dev:api
corepack pnpm dev:web
```

Open `http://127.0.0.1:4311` and use authenticated sessions.

Suggested path:

- As an owner, configure or revoke the verified GitHub App repository binding.
- As a lead or owner, inspect the redacted Delivery Request and approve its exact revision.
- Confirm Desktop Bearer authority cannot approve its own request.
- Inspect binding version, approval, series/attempt/revision, remote-head, Draft pull-request, audit,
  and Acceptance summaries without local paths, raw output, patches, source, or credentials.

## Smoke Commands

```bash
corepack pnpm test:e2e
corepack pnpm test:electron-smoke
corepack pnpm test:native-coding-electron-smoke
corepack pnpm test:v15-github-delivery
corepack pnpm test:v15-github-delivery-packaged-smoke
```

For Postgres, use a disposable clean database or an intentional populated v11 fixture:

```bash
export DEVFLOW_DATABASE_URL='postgres://postgres:devflow@127.0.0.1:55432/devflow_v15'
corepack pnpm test:postgres-smoke
corepack pnpm test:local-auth-postgres-smoke
```

The Postgres smoke must prove fresh Team schema v21, populated v11-to-v12 retention, a v12-to-v13
legacy issued credential that remains fail closed when its raw provider expiry is NULL, and the
v13-to-v14 nullable bounded provider retry field. It must also prove v14-to-v15
`source_publication_id` retention and the exact grant-or-adoption authority constraint. The
v15-to-v16 migration must retain all prior state, create empty `agent_runtime_summaries` and
`agent_runtime_projection_audits` tables, and reject non-redacted or structurally incoherent
runtime rows. The v16-to-v17 migration must create empty `agent_memory_summaries` and
`agent_memory_projection_audits` tables without local content or fabricated lifecycle rows.
The v17-to-v18 migration must add an independent `quality_version` to summaries and audits and use
`(memory_id, head_version, quality_version)` as the audit identity.
The v18-to-v19 migration must create empty `agent_coordination_summaries` and
`agent_coordination_projection_audits` tables without local content or fabricated lifecycle rows.
The v19-to-v20 migration must preserve GitHub accounts, accept only `github` and
`local-development`, and reject unknown providers. The v20-to-v21 migration must preserve existing
Coding summaries and admit only the bounded `native` Coding engine in addition to the existing
engine values. The separate local-auth smoke uses an isolated
schema to prove local login, an empty overview, project creation, budget persistence, pairing-code
exchange, and a paired Desktop Bearer read without Demo Seed or a GitHub OAuth call.
It also proves repository binding and revocation, exact Delivery Request approval, credential
grant, remote verification, Draft completion, recovery/audit behavior, and redaction.

For the self-hosted lifecycle boundary:

```bash
corepack pnpm test:docker-lifecycle-smoke
```

The lifecycle smoke covers fresh schema, retained upgrade, transactional migration retry, and
bounded backup/restore rollback. It must stop its API and containers deterministically.

## Real GitHub Sandbox Boundary

The real private GitHub sandbox is not a routine demo command. Release signoff may run it once only
after explicit authorization for the frozen candidate. It may authenticate the GitHub App, publish
one approved commit without force, and create or reconcile one Draft pull request. It has no
automatic retry and must never merge, delete a branch, or publish a tag.

This guide does not authorize paid-provider smoke. GitHub Delivery validation uses no model provider;
OpenCode or other paid-provider requests require their own explicit, candidate-bound authorization.

## GitHub Actions Notes

If PR checks fail immediately with no job steps, inspect check-run annotations before debugging
product code. A runner-account or spending-limit failure means no workflow step ran; local evidence
does not convert that infrastructure failure into a passing CI gate.
