# DevFlow Studio Lessons Learned

This document captures repeatable engineering lessons from DevFlow development. It is for
operational knowledge: symptoms, root causes, checks, fixes, and prevention. Architectural
tradeoffs still belong in ADRs, milestone progress still belongs in `docs/roadmap.md`, and mature
reviewable rules should be promoted into `docs/knowledge/checklists/` or `docs/knowledge/standards/`.

## How To Use This Document

Add an entry when a failure mode is likely to recur during local development, smoke testing, demo
setup, provider signoff, or release validation.

Use this shape:

- **Symptom**: what a developer or reviewer sees.
- **Likely cause**: the smallest useful explanation.
- **Checks**: commands, UI signals, logs, or process state that confirm the issue.
- **Fix**: the shortest safe recovery path.
- **Prevention**: what should be checked before a signoff or demo.
- **Promote when stable**: whether the lesson should become a Knowledge checklist or standard.

## Electron Launch And Demo Windows

- **Symptom**: Electron opens the default welcome app, a blank window, or an unexpected renderer.
- **Likely cause**: Electron was launched without the desktop app path, or a stale Vite server is
  already listening on the expected desktop renderer port.
- **Checks**:
  - The app window should be titled `AI DevFlow Studio` or `ai-devflow-studio`.
  - Electron process arguments should include `apps/desktop`, not only `default_app.asar`.
  - `lsof -nP -iTCP:5173 -sTCP:LISTEN` should show the intended desktop renderer.
- **Fix**:
  - Stop stale DevFlow desktop processes before a demo.
  - Start the real desktop path with `corepack pnpm dev:electron`.
  - If the renderer port is already occupied, clear the old process and restart instead of trusting
    a fallback port for signoff.
- **Prevention**: run the Electron demo readiness checklist before any portfolio or release demo.
- **Promote when stable**: promoted to `docs/knowledge/checklists/electron-demo-readiness.md`.

## Port Conflicts

- **Symptom**: Vite, Next, API, Playwright, or smoke tests fail intermittently even though the code
  did not change.
- **Likely cause**: old dev servers are still listening on DevFlow's fixed local ports.
- **Checks**:
  - Desktop renderer: `5173`
  - API: `4310`
  - Web Team Console: `4311`
  - Incidental fallback renderer: `5174`
- **Fix**:
  - Identify the listener with `lsof -nP -iTCP:<port> -sTCP:LISTEN`.
  - Stop only the DevFlow process tree that owns that listener.
  - Leave editor helper processes alone unless they are explicitly part of the requested cleanup.
- **Prevention**: treat occupied demo ports as environment noise, not a product signoff.
- **Promote when stable**: keep as an engineering lesson unless a release checklist needs a port
  preflight section.

## Postgres Smoke

- **Symptom**: `verify` passes, but team policy, override, migration, or overview behavior is still
  uncertain.
- **Likely cause**: `corepack pnpm verify` intentionally excludes Postgres because it needs an
  external database.
- **Checks**:
  - Run Postgres smoke only with an explicit `DEVFLOW_DATABASE_URL`.
  - Prove a clean database reaches Team schema v21, a populated v11-to-v12 upgrade retains exact
    data, and a v12-to-v13 upgrade preserves a legacy issued credential without fabricating
    provider-authoritative expiry evidence; v13-to-v14 then adds only a bounded non-secret
    provider retry boundary; v14-to-v15 then adds verified publication adoption while retaining
    exact legacy grant-backed publication authority; v15-to-v16 then adds only metadata-only Agent
    Runtime summaries/audit without inventing rows for retained data; v16-to-v17 then adds only
    metadata-only Agent Memory summaries/audit without inventing rows; v17-to-v18 then separates
    same-head quality audit versions from lifecycle head versions; v18-to-v19 adds only bounded
    Coordination projections, v19-to-v20 preserves GitHub accounts while admitting only the
    separately gated `local-development` provider, and v20-to-v21 admits the bounded `native`
    Coding summary engine without changing retained summaries.
  - Run the isolated local-auth Postgres smoke to prove fixed-owner login, project and budget setup,
    pairing-code exchange, and paired Bearer reads without Demo Seed or GitHub OAuth.
  - Confirm policy save/read, enforcement evaluation, override audit, stale policy rejection,
    approval-sync bypass rejection, and overview redaction.
  - Confirm the GitHub App repository binding, Delivery Request, signed approval, credential grant,
    remote-head verification, Draft completion, revocation, and replay-safe audit paths.
- **Fix**:
  - Recreate only the intended fresh fixture; preserve a failed retained-upgrade fixture until its
    transaction boundary and exact incompatible row are understood.
  - Remediate the documented v11 row, then retry the same v11-to-v12 migration rather than applying
    migration SQL by hand or weakening assertions.
  - Keep a legacy issued credential fail closed when `provider_credential_expires_at` is NULL;
    only a bounded provider observation can establish provider-authoritative expiry.
  - Keep verified publication adoption fail closed unless the immediately prior same-series attempt
    has the exact verified head and a terminal Draft failure; never use adoption to mint or push again.
- **Prevention**: run Postgres smoke whenever API, repository, migration, policy, override, or
  GitHub Delivery persistence or manager-summary behavior changes.
- **Promote when stable**: promoted to `docs/knowledge/checklists/postgres-smoke-readiness.md`.

## opencode Runtime Signoff

- **Symptom**: default verification passes, but the real coding engine path is not proven.
- **Likely cause**: the real opencode runtime is explicitly env-gated and is not part of default
  `verify`.
- **Checks**:
  - `DEVFLOW_RUN_OPENCODE_SMOKE=1`
  - `DEVFLOW_CODING_ENGINE=opencode-http`
  - provider ID, model ID, and provider API key env name are set intentionally.
  - Smoke output does not print provider secrets.
- **Fix**:
  - Treat the smoke preflight as the contract gate: without `DEVFLOW_CODING_ENGINE=opencode-http`,
    the live smoke must exit before contacting a provider.
  - Run `corepack pnpm test:opencode-smoke` only when provider credentials and local opencode are
    intentionally available.
  - Keep the fake engine as the deterministic default path for daily verification.
- **Prevention**: use the opencode runtime signoff checklist before claiming live coding adapter
  behavior.
- **Promote when stable**: promoted to `docs/knowledge/checklists/opencode-runtime-signoff.md`.

## Knowledge Retrieval And Evidence

- **Symptom**: a Gate or review appears to cite relevant knowledge, but policy still reports missing
  evidence.
- **Likely cause**: retrieval hits are recommendations; they do not satisfy governance standards by
  themselves.
- **Checks**:
  - Look for durable artifacts, test evidence, review artifacts, or Gate decisions that reference
    the standard.
  - Do not count a retrieval-only match as proof that a standard was satisfied.
- **Fix**:
  - Attach or generate real evidence for the selected Run or Node.
  - Keep retrieval as context for humans and agents.
- **Prevention**: preserve the boundary documented in
  `docs/adr/0007-knowledge-retrieval-is-not-governance-evidence.md`.
- **Promote when stable**: keep this as an ADR-backed engineering lesson unless a specific review
  checklist needs a reminder.

## Gate Enforcement And Retry

- **Symptom**: a blocked Gate has useful remediation text, but no repository changes should happen
  automatically.
- **Likely cause**: v0.8 policy-aware delivery is intentionally human-approved. It provides
  remediation plans and retry context; it does not auto-fix, auto-override, or mutate the primary
  checkout.
- **Checks**:
  - Retry attempts should be started through the explicit Desktop action.
  - Coding work should happen in a managed worktree.
  - Team summaries should remain redacted.
- **Fix**:
  - Use the Inspector remediation CTA only after a human accepts the retry direction.
  - Keep Gate approval and override on the enforcement write path.
- **Prevention**: treat automatic Gate bypass or unapproved retry as a product regression.
- **Promote when stable**: candidate for a future policy-aware delivery readiness checklist.
