# opencode Runtime Contract Refresh

Date: 2026-06-19

Related plan: `docs/plans/v0.9-real-runtime-observability.md`

Related ADR: `docs/adr/0009-managed-opencode-coding-adapter.md`

## Summary

This is the v0.9.1 contract refresh entry point. It verifies the current local opencode baseline and
records the runtime contract that v0.9.2 should harden. It does not change runtime code and does not
claim a fresh live-provider smoke.

Current local finding:

- `opencode` binary is available at `/opt/homebrew/bin/opencode`.
- `opencode --version` returns `1.17.5`.
- This matches the v0.6 live signoff notes in
  `docs/superpowers/plans/2026-06-17-near-term-opencode-signoff.md`.

## Existing Evidence

The v0.6 near-term opencode signoff recorded:

- opencode `1.17.5`.
- Volcengine Ark provider profile: provider ID `double`, model `ark-code-latest`.
- Real smoke passed with `DEVFLOW_RUN_OPENCODE_SMOKE=1`,
  `DEVFLOW_CODING_ENGINE=opencode-http`, `DEVFLOW_OPENCODE_PROVIDER_ID=double`, and
  `DEVFLOW_OPENCODE_MODEL_ID=ark-code-latest`.
- The successful real smoke used multi-step permission relay: `bash -> edit -> bash -> bash`.
- The smoke produced `devflow-opencode-smoke.txt`.
- Provider key values were not written to project files.

This evidence is useful but historical. v0.9 should re-run live signoff before claiming current
runtime demonstrability.

## Current Code Contract

### Engine Selection

Source: `apps/desktop/electron/coding-engine.ts`

- Default engine: `fake`.
- Real engine switch: `DEVFLOW_CODING_ENGINE=opencode-http`.
- Real provider inputs:
  - `DEVFLOW_OPENCODE_BIN`
  - `DEVFLOW_OPENCODE_PROVIDER_ID`
  - `DEVFLOW_OPENCODE_MODEL_ID`
  - `DEVFLOW_OPENCODE_API_KEY_ENV`
- If `DEVFLOW_OPENCODE_API_KEY_ENV` is absent, the default key env name is `OPENAI_API_KEY`.

The fake engine must remain the default `corepack pnpm verify` path.

### HTTP Transport

Source: `apps/desktop/electron/opencode-http-adapter.ts`

The current selected transport is still `opencode serve` HTTP:

- start server with `opencode serve --hostname <host> --port <port>`
- create session with `POST /session`
- send message with `POST /session/:id/message`
- poll permissions with `GET /permission`
- reply to permission with `POST /permission/:id/reply`
- abort session with `POST /session/:id/abort`
- fetch diff with `GET /session/:id/diff`

ACP remains deferred by ADR 0009 unless v0.9 live contract testing proves it is now the better fit.

### Permission Relay

Current default permission rules ask before:

- `edit`
- `bash`
- `write`
- `patch`

The engine normalizes additional opencode permission names when received:

- `install`
- `external_directory`

v0.9.2 should prove these are visible and actionable in the Desktop Agents UI for a real run, not
only in unit tests.

### Cancel And Timeout

Current code has cancellation surfaces:

- `CodingEngineAdapter.cancel(input)`
- `abortOpencodeSession(...)`
- managed opencode process shutdown through `opencode-process.ts`

v0.9.2 must prove the full lifecycle:

- cancel while a run is in progress
- timeout while waiting for permission or runtime completion
- terminal state is distinct for cancel vs timeout vs normal completion
- managed worktree and opencode server are cleaned up in all terminal paths

### Diff And Evidence

Current code can fetch opencode HTTP diff and has historical fallback behavior through managed
worktree diff capture when opencode returns empty diff or closes the message stream after changes.

v0.9.2 should preserve the fake-engine evidence shape:

- redacted diff artifact
- bootstrap evidence
- local test evidence
- coding events
- redacted remote summary only

No raw prompt, raw stdout/stderr, raw patch, cwd, provider secret, or repo-external path should be
sent to the team API.

## Provider Contract To Reconfirm

The likely demo provider remains Volcengine Ark, but v0.9 must verify rather than assume:

- protocol family: OpenAI-compatible or Anthropic-compatible
- base URL
- provider ID
- model ID
- API key env var name
- proxy requirements
- whether opencode stores or expects global auth files

The desired DevFlow boundary remains:

- credentials are injected at runtime into the managed process environment
- no provider secret is written to global opencode auth from DevFlow
- logs and smoke output must not print key values

## v0.9.2 Go Criteria

Proceed from contract refresh to runtime hardening only when these are true:

- The target opencode version is recorded.
- The selected transport is recorded and still compatible with ADR 0009, or ADR 0009 is amended.
- Provider profile is documented without secrets.
- Permission ask/reply, cancel, timeout/default rejection, diff capture, and cleanup are each marked
  supported, unsupported, or deferred.
- `corepack pnpm test:opencode-smoke` remains skipped by default and live only when explicitly
  enabled with `DEVFLOW_RUN_OPENCODE_SMOKE=1`.

## Open Questions For Live Signoff

- Does current `opencode serve` still expose the same HTTP session/permission/diff endpoints under
  `1.17.5` in this environment?
- Does Volcengine Ark require OpenAI-compatible or Anthropic-compatible mode for the most stable
  coding run?
- Can session abort reliably stop a live run while a permission request is pending?
- Does timeout cleanup always kill `opencode serve` and remove the managed worktree?
- Which subset of real trace events should be promoted to the Agents UI in v0.9.3?

