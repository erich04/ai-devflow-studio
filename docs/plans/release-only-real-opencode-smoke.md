# Release-Only Real opencode Provider Smoke

## Summary

Every future DevFlow Studio product release must include one explicit real `opencode` smoke against
the configured paid provider profile before the release tag is created.

This is a release-only gate. It stays outside `corepack pnpm verify`, GitHub's default CI, and daily
developer checks because it can spend provider quota and depends on local opencode/provider
configuration.

This policy defines the gate; it does not by itself assert that v1.3 passed or failed. The v1.3
state is determined by the release JSON files, the matching `release:status` mode, and the
`v1.3.0` tag target.

## Policy

- Default CI remains deterministic:
  - `corepack pnpm verify`
  - fake Coding Agent engine
  - no paid provider call
- Release signoff adds a manual paid-provider smoke:
  - `corepack pnpm --silent opencode:status`
  - `corepack pnpm --silent opencode:release-preflight`
  - `DEVFLOW_RUN_OPENCODE_SMOKE=1 ... corepack pnpm --silent test:opencode-smoke`
- The smoke must be run before creating the release tag.
- For v1.3, the passing result must be written to `docs/releases/v1.3.0/real-opencode.json` and
  bound to the candidate commit `C`.
- For v1.4, the passing result must be written to `docs/releases/v1.4.0/real-opencode.json`, bound
  to candidate `C`, and record exactly one candidate-bound top-level paid smoke invocation, no
  uncredited provider request, and the owner's explicit authorization without a hard provider cost
  cap.
- A second top-level paid smoke invocation requires a substantive new candidate and new explicit
  authorization.
- Provider secrets must never be written to docs, logs, screenshots, PR descriptions, GitHub
  releases, team summaries, or smoke artifacts.

## Standard Volcengine / Doubao Command

Use the local provider profile that has been validated for DevFlow real-runtime signoff:

```bash
export ANTHROPIC_AUTH_TOKEN="<set in shell only; never commit>"
export DEVFLOW_RUN_OPENCODE_SMOKE=1
export DEVFLOW_CODING_ENGINE=opencode-http
export DEVFLOW_OPENCODE_PROVIDER_ID=double
export DEVFLOW_OPENCODE_MODEL_ID=ark-code-latest
export DEVFLOW_OPENCODE_API_KEY_ENV=ANTHROPIC_AUTH_TOKEN
export DEVFLOW_OPENCODE_RELEASE_PROFILE=v1.4

corepack pnpm --silent opencode:status
corepack pnpm --silent opencode:release-preflight
corepack pnpm --silent test:opencode-smoke

unset ANTHROPIC_AUTH_TOKEN DEVFLOW_RUN_OPENCODE_SMOKE DEVFLOW_CODING_ENGINE
unset DEVFLOW_OPENCODE_PROVIDER_ID DEVFLOW_OPENCODE_MODEL_ID DEVFLOW_OPENCODE_API_KEY_ENV
unset DEVFLOW_OPENCODE_RELEASE_PROFILE
```

If the local `opencode` binary is not on `PATH`, include:

```bash
export DEVFLOW_OPENCODE_BIN=/opt/homebrew/bin/opencode
```

Set `DEVFLOW_OPENCODE_BIN` before all three commands. The v1.3 release profile is exactly
`double/ark-code-latest`, and its key environment name is exactly `ANTHROPIC_AUTH_TOKEN`.
Do not substitute `ARK_API_KEY` in the v1.3 release record.

The V1.4 release invocation owns its exact provider configuration in candidate code. The exact
identity is reported by `corepack pnpm --silent opencode:status`. For
`double/ark-code-latest` with key environment name `ANTHROPIC_AUTH_TOKEN`, it replaces any ambient
inline OpenCode configuration with the candidate-owned Responses API profile: package
`@ai-sdk/openai`, base URL `https://ark.cn-beijing.volces.com/api/coding/v3`, and key reference
`{env:ANTHROPIC_AUTH_TOKEN}`. The profile contains no key value and uses bounded provider transport
timeouts. During the live invocation, candidate code replaces that base URL with a random loopback
capability owned by a credential-owning provider egress gate. OpenCode receives only a one-run dummy
credential; only the gate attaches the real token to a request, and it pins every forwarded request
to the official Ark Responses endpoint.

The release-only commands use pnpm's `--silent` option solely to suppress pnpm's own lifecycle
banner, which includes the local candidate working directory. The status and smoke output remain
visible and must still pass the absolute-path and secret redaction checks.

The release preflight runs `opencode debug config --pure` with a fake credential, isolated storage,
and the macOS network sandbox. It parses the resolved JSON only in memory, verifies the exact
Responses package/base URL/model/timeout fields, deletes its temporary root, and prints only a fixed
pass/fail summary. It never forwards the real provider credential.

The managed process forces `OPENCODE_CLIENT=server` and disables the optional question-tool override;
the session also denies `question` and `task` permissions because those interaction and child-session
channels are not relayed by DevFlow. DevFlow polls the exact parent session status,
permanently discards provider retry message/action details, and fails with the static
`provider_retry_observed` code on the first observed retry. A 240-second permission-discovery
deadline applies separately to the initial segment and every continuation segment, and covers
permission and status requests that ignore cancellation. It is not a 240-second end-to-end smoke
deadline. Either condition aborts the managed session and must complete verified cleanup before the
smoke can finish.

The release smoke uses a stricter tool profile: wildcard deny followed by `ask` for only
`edit` and `bash`. The credential-owning gate enforces exactly three credited provider segments:
bash-only, edit-only, and completion-only. Before forwarding each Responses request, it retains only
the required tool for the first two segments, sets `tool_choice` to `required`, disables parallel
tool calls, and removes all tools for the completion segment. The initial credit is bash-only; the
unique approved bash permission activates edit-only, and the unique approved edit permission
activates completion-only. Credits never accumulate. The smoke waits for the source Responses stream
to complete before replying to its permission. An invalid approval sequence or uncredited request is
blocked locally, revokes any outstanding credit, and permanently marks the smoke failed. A pass
requires all three credited segments to produce one successful `response.completed` stream, with zero
blocked uncredited requests, zero invalid requests, zero failed segments, and no active connection at
cleanup.

## Required Evidence To Record

The release record is a JSON object at `docs/releases/v1.3.0/real-opencode.json`:

```json
{
  "targetVersion": "1.3.0",
  "candidateSha": "<C full SHA>",
  "status": "passed",
  "recordedAt": "YYYY-MM-DDTHH:mm:ss.sssZ",
  "opencodeVersion": "<version from opencode:status>",
  "provider": "double",
  "model": "ark-code-latest",
  "keyEnvName": "ANTHROPIC_AUTH_TOKEN",
  "duration": "<elapsed duration>",
  "permissionRelay": "<observed permission sequence>",
  "diffEvidence": ["devflow-opencode-smoke.txt"],
  "testEvidence": "passed",
  "cleanup": "passed",
  "redactionCheck": "passed"
}
```

The V1.3 record above is historical and remains valid without retroactive fields. The V1.4 record
at `docs/releases/v1.4.0/real-opencode.json` uses the same observed non-secret metadata and adds:

```json
{
  "targetVersion": "1.4.0",
  "candidateSha": "<C full SHA>",
  "status": "passed",
  "attemptCount": 1,
  "automaticRetry": false,
  "costCapUsd": null,
  "releaseProfile": "v1.4",
  "providerApiMode": "responses",
  "resolvedConfigPreflight": "passed",
  "providerRetryObserved": false,
  "egressGate": {
    "armedSegmentCount": 3,
    "forwardedRequestCount": 3,
    "completedResponseCount": 3,
    "blockedUncreditedRequestCount": 0,
    "blockedInvalidCount": 0,
    "failedSegmentCount": 0,
    "activeRequestCount": 0,
    "closed": true
  }
}
```

These values describe the authorization boundary, not an invented billed amount. `attemptCount`
counts the candidate-bound top-level smoke invocation. `automaticRetry: false` means the DevFlow
launcher never repeats that invocation, the engine observes no retry status, and no uncredited
request is forwarded to the provider. The
engine also aborts when it first observes OpenCode enter provider retry state. Legitimate later
model steps are separately credited only by an explicit managed permission approval. A passing run
must observe zero locally blocked uncredited requests; otherwise it cannot record
`automaticRetry: false`. `costCapUsd: null`
explicitly records that this authorization does not impose a hard provider cost cap; it is not a
missing or unknown field. Once the top-level paid smoke invocation begins, a pass, failure,
timeout, or provider error consumes the one authorized invocation.

Replace every placeholder with observed data from the run against `C`. `recordedAt` must be a valid
date-time, and `diffEvidence` must contain at least one non-empty, repository-relative changed path.

The record must not contain a field named `apiKey`, `apiKeyValue`, `authorization`, `credential`,
`password`, `providerToken`, `secret`, or `token`, including nested objects. `keyEnvName` is allowed;
the corresponding value is not.

The required field meanings are:

| Field | Required value |
| --- | --- |
| Date/time | Local date/time of the live smoke |
| Release candidate | Full SHA of candidate commit `C` |
| opencode version | From `corepack pnpm --silent opencode:status` |
| Provider | `double` |
| Model | `ark-code-latest` |
| Key handling | `ANTHROPIC_AUTH_TOKEN` name only, never its value |
| Result | `passed` only after every criterion succeeds |
| Duration | Approximate runtime |
| Permission relay | Exact V1.4 permission sequence `bash -> edit` |
| Diff evidence | Changed path summary, repo-relative only |
| Test evidence | passed/failed/timed_out |
| Cleanup | managed worktree deleted or cleanup_failed |
| Redaction check | confirms no provider key, cwd, raw stdout/stderr, raw prompt, or raw patch was printed |

## Candidate And Signoff Commit Binding

Run the smoke against the clean candidate commit `C`. Create the JSON only from that observed run.
Its `candidateSha` must equal the full SHA of `C`, not the later evidence commit or tag target.

The direct child commit `S` contains exactly this JSON, `walkthrough.json`, `required-gates.json`,
and the dated Computer Use result. For V1.3, run pre-tag status on clean `S` while `v1.3.0` is
absent. For V1.4, run it while `v1.4.0` is absent. Only after the matching profile passes may its
version tag be created at that same `S` and tagged status be run.

## Pass Criteria

The release-only real smoke passes only when all are true:

- The preflight required an explicit `DEVFLOW_RUN_OPENCODE_SMOKE=1`.
- The no-network resolved-config preflight passed for the candidate-owned V1.4 Responses profile.
- The engine was explicitly `DEVFLOW_CODING_ENGINE=opencode-http`.
- `opencode serve` started and created a managed session.
- DevFlow relayed exactly two real permission requests in order: `bash -> edit`.
- The credential-owning egress gate forwarded exactly the three credited bash-only, edit-only, and
  completion-only Responses segments and observed no uncredited, invalid, failed, or active request
  at cleanup.
- The run produced a redacted diff.
- The smoke ran Test Evidence successfully.
- Managed worktree cleanup completed with a deleted workspace; any cleanup failure fails the smoke.
- The smoke output did not print provider secrets.

The JSON record is valid only when all required strings are non-empty, `diffEvidence` is non-empty,
and `testEvidence`, `cleanup`, and `redactionCheck` are exactly `passed`.

## Failure Handling

- If provider billing/network is temporarily unavailable, do not mark the release as signed off.
- If the failure is clearly external and urgent release work must continue, record it as a release
  blocker or accepted risk explicitly; do not silently substitute fake-engine evidence.
- Recorded trace/video material can support a demo, but it does not replace the final release-only
  live smoke.
- Missing binary, wrong engine, missing provider/model/key configuration, or a blocked preflight is
  a failed release gate.
- An observed provider retry (`provider_retry_observed`) is a failed release gate; do not wait for
  or initiate a second top-level smoke invocation on the same candidate.
- Exceeding the permission limit, producing no changed path, or missing `tool_call` / `tool_result`
  evidence is a failed release gate.
- Dependency bootstrap failure, Test Evidence failure, incomplete worktree cleanup, secret/path
  leakage, or any unhandled process/provider error is a failed release gate.
- A failed attempt may be described as a blocker, but `real-opencode.json` must not use
  `status: "passed"` until a new candidate-bound run satisfies every pass criterion.

## Current Historical Evidence

- 2026-06-20: v0.9.0 post-release live smoke passed against the local Volcengine Ark profile using
  provider `double`, model `ark-code-latest`, and `opencode` `1.17.5`. It completed in about 1m38s,
  relayed `bash -> edit -> bash`, produced `devflow-opencode-smoke.txt`, ran fixture Test Evidence,
  and completed managed worktree cleanup.

## Applies From

This release gate applies to v1.3.0 and later product releases. Historical release notes remain
factual and are not retroactively rewritten.
