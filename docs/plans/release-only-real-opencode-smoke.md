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
  - `corepack pnpm opencode:status`
  - `DEVFLOW_RUN_OPENCODE_SMOKE=1 ... corepack pnpm test:opencode-smoke`
- The smoke must be run before creating the release tag.
- For v1.3, the passing result must be written to `docs/releases/v1.3.0/real-opencode.json` and
  bound to the candidate commit `C`.
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

corepack pnpm opencode:status
corepack pnpm test:opencode-smoke

unset ANTHROPIC_AUTH_TOKEN DEVFLOW_RUN_OPENCODE_SMOKE DEVFLOW_CODING_ENGINE
unset DEVFLOW_OPENCODE_PROVIDER_ID DEVFLOW_OPENCODE_MODEL_ID DEVFLOW_OPENCODE_API_KEY_ENV
```

If the local `opencode` binary is not on `PATH`, include:

```bash
export DEVFLOW_OPENCODE_BIN=/opt/homebrew/bin/opencode
```

Set `DEVFLOW_OPENCODE_BIN` before both commands. The v1.3 release profile is exactly
`double/ark-code-latest`, and its key environment name is exactly `ANTHROPIC_AUTH_TOKEN`.
Do not substitute `ARK_API_KEY` in the v1.3 release record.

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
| opencode version | From `corepack pnpm opencode:status` |
| Provider | `double` |
| Model | `ark-code-latest` |
| Key handling | `ANTHROPIC_AUTH_TOKEN` name only, never its value |
| Result | `passed` only after every criterion succeeds |
| Duration | Approximate runtime |
| Permission relay | Permission sequence, for example `bash -> edit -> bash` |
| Diff evidence | Changed path summary, repo-relative only |
| Test evidence | passed/failed/timed_out |
| Cleanup | managed worktree deleted or cleanup_failed |
| Redaction check | confirms no provider key, cwd, raw stdout/stderr, raw prompt, or raw patch was printed |

## Candidate And Signoff Commit Binding

Run the smoke against the clean candidate commit `C`. Create the JSON only from that observed run.
Its `candidateSha` must equal the full SHA of `C`, not the later evidence commit or tag target.

The direct child commit `S` contains exactly this JSON, `walkthrough.json`, `required-gates.json`,
and the dated Computer Use result. Run pre-tag status on clean `S` while `v1.3.0` is absent. Only
after it passes may `v1.3.0` be created at the same `S` and tagged status be run.

## Pass Criteria

The release-only real smoke passes only when all are true:

- The preflight required an explicit `DEVFLOW_RUN_OPENCODE_SMOKE=1`.
- The engine was explicitly `DEVFLOW_CODING_ENGINE=opencode-http`.
- `opencode serve` started and created a managed session.
- DevFlow relayed at least one real permission request.
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
