---
title: opencode Runtime Signoff Checklist
category: review_checklist
ownerId: u-erich
tags: opencode, coding-agent, smoke, provider
summary: Real opencode runtime signoff must be explicit, env-gated, permission-audited, and secret-safe.
---

# opencode Runtime Signoff Checklist

Use this checklist only when intentionally validating the real opencode coding adapter.

- Keep the deterministic fake engine as the default daily verification path.
- Confirm local opencode is installed and compatible with the adapter under test.
- Run `corepack pnpm opencode:status` before live smoke to confirm the local binary/version, default fake-engine posture, live-smoke gate, and provider profile state.
- Set `DEVFLOW_RUN_OPENCODE_SMOKE=1` intentionally.
- Set `DEVFLOW_CODING_ENGINE=opencode-http`.
- Set the intended provider ID and model ID explicitly.
- Set the provider API key through the configured env var, never inline in logs or documentation.
- Run `corepack pnpm test:opencode-smoke`.
- Confirm the smoke starts `opencode serve`, creates a managed worktree, relays permissions, captures a redacted diff, runs worktree tests, and cleans up temporary smoke state.
- Confirm permission requests are human-visible and unanswered requests reject by default.
- Confirm smoke output does not print provider secrets.
- Keep live opencode smoke out of `corepack pnpm verify` and default CI.
- For every future product release, run the live provider smoke once before the release tag and record
  the evidence in the release signoff note. Use `docs/plans/release-only-real-opencode-smoke.md` as
  the required evidence template.
