# Release-Only Real opencode Provider Smoke

## Summary

Every future DevFlow Studio product release must include one explicit real `opencode` smoke against
the configured paid provider profile before the release tag is created.

This is a release-only gate. It stays outside `corepack pnpm verify`, GitHub's default CI, and daily
developer checks because it can spend provider quota and depends on local opencode/provider
configuration.

## Policy

- Default CI remains deterministic:
  - `corepack pnpm verify`
  - fake Coding Agent engine
  - no paid provider call
- Release signoff adds a manual paid-provider smoke:
  - `corepack pnpm opencode:status`
  - `DEVFLOW_RUN_OPENCODE_SMOKE=1 ... corepack pnpm test:opencode-smoke`
- The smoke must be run before creating the release tag.
- The result must be written into the release signoff note or the release PR.
- Provider secrets must never be written to docs, logs, screenshots, PR descriptions, GitHub
  releases, team summaries, or smoke artifacts.

## Standard Volcengine / Doubao Command

Use the local provider profile that has been validated for DevFlow real-runtime signoff:

```bash
export ANTHROPIC_AUTH_TOKEN="<set in shell only; never commit>"

DEVFLOW_RUN_OPENCODE_SMOKE=1 \
DEVFLOW_CODING_ENGINE=opencode-http \
DEVFLOW_OPENCODE_PROVIDER_ID=double \
DEVFLOW_OPENCODE_MODEL_ID=ark-code-latest \
DEVFLOW_OPENCODE_API_KEY_ENV=ANTHROPIC_AUTH_TOKEN \
corepack pnpm test:opencode-smoke
```

If the local `opencode` binary is not on `PATH`, include:

```bash
DEVFLOW_OPENCODE_BIN=/opt/homebrew/bin/opencode
```

## Required Evidence To Record

Record these fields in the release signoff document:

| Field | Required value |
| --- | --- |
| Date/time | Local date/time of the live smoke |
| Release candidate | Commit SHA or tag candidate |
| opencode version | From `corepack pnpm opencode:status` |
| Provider | `double` or the intentionally selected provider ID |
| Model | `ark-code-latest` or the intentionally selected model |
| Key handling | Env var name only, never the value |
| Result | passed/failed |
| Duration | Approximate runtime |
| Permission relay | Permission sequence, for example `bash -> edit -> bash` |
| Diff evidence | Changed path summary, repo-relative only |
| Test evidence | passed/failed/timed_out |
| Cleanup | managed worktree deleted or cleanup_failed |
| Redaction check | confirms no provider key, cwd, raw stdout/stderr, raw prompt, or raw patch was printed |

## Pass Criteria

The release-only real smoke passes only when all are true:

- The preflight required an explicit `DEVFLOW_RUN_OPENCODE_SMOKE=1`.
- The engine was explicitly `DEVFLOW_CODING_ENGINE=opencode-http`.
- `opencode serve` started and created a managed session.
- DevFlow relayed at least one real permission request.
- The run produced a redacted diff.
- The smoke ran Test Evidence successfully.
- Managed worktree cleanup completed or any cleanup failure was recorded as a visible failure.
- The smoke output did not print provider secrets.

## Failure Handling

- If provider billing/network is temporarily unavailable, do not mark the release as signed off.
- If the failure is clearly external and urgent release work must continue, record it as a release
  blocker or accepted risk explicitly; do not silently substitute fake-engine evidence.
- Recorded trace/video material can support a demo, but it does not replace the final release-only
  live smoke.

## Current Historical Evidence

- 2026-06-20: v0.9.0 post-release live smoke passed against the local Volcengine Ark profile using
  provider `double`, model `ark-code-latest`, and `opencode` `1.17.5`. It completed in about 1m38s,
  relayed `bash -> edit -> bash`, produced `devflow-opencode-smoke.txt`, ran fixture Test Evidence,
  and completed managed worktree cleanup.

## Applies From

This release gate applies to the next product release after this document lands. Historical release
notes remain factual and are not retroactively rewritten.
