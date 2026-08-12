---
title: opencode Runtime Signoff Checklist
category: review_checklist
ownerId: u-erich
tags: opencode, coding-agent, smoke, provider
summary: Real opencode runtime signoff must be explicit, env-gated, permission-audited, and secret-safe.
---

# opencode Runtime Signoff Checklist

Use this checklist only when intentionally validating the real opencode coding adapter under a
release contract that explicitly requires it and after separate candidate-bound authorization. This
checklist does not grant provider-spend authority by itself.

- Keep the deterministic fake engine as the default daily verification path.
- Confirm local opencode is installed and compatible with the adapter under test.
- Run `corepack pnpm --silent opencode:status` before live smoke to confirm the local binary/version, default fake-engine posture, live-smoke gate, and provider profile state without printing pnpm's working-directory banner.
- Set `DEVFLOW_RUN_OPENCODE_SMOKE=1` intentionally.
- Set `DEVFLOW_CODING_ENGINE=opencode-http`.
- Set the intended provider ID and model ID explicitly.
- For V1.4 set `DEVFLOW_OPENCODE_RELEASE_PROFILE=v1.4`; the exact provider/model/key triple without
  this selector must fail before OpenCode starts.
- Set the provider API key through the configured env var, never inline in logs or documentation.
- For V1.4 run `corepack pnpm --silent opencode:release-preflight` and require its fixed no-network
  resolved-config success summary before the paid smoke.
- Run `corepack pnpm --silent test:opencode-smoke` so pnpm does not print the local candidate path.
- Confirm the smoke starts `opencode serve`, creates a managed worktree, relays permissions, captures a redacted diff, runs worktree tests, and cleans up temporary smoke state.
- Confirm permission requests are human-visible and unanswered requests reject by default.
- Confirm smoke output does not print provider secrets.
- Keep live opencode smoke out of `corepack pnpm verify` and default CI.
- A future product release runs live provider smoke only when its own release contract explicitly
  requires it and separate candidate-bound authorization has been recorded.
- V1.5 does not require or authorize another paid-provider smoke. Preserve the V1.4 paid-smoke record
  as immutable V1.4 evidence.
