---
title: v0.9 Demo Readiness Checklist
category: review_checklist
ownerId: u-erich
tags: demo, opencode, observability, policy-aware-delivery
summary: v0.9 demos should prove policy-aware delivery, runtime observability, and honest real-opencode boundaries.
---

# v0.9 Demo Readiness Checklist

Use this checklist before presenting the v0.9 real runtime and observability story.

- Start from the v0.8 user guide and the v0.9 demo script.
- Run `corepack pnpm release:status` and confirm only intentional release-pending items remain.
- Run `corepack pnpm opencode:status` and confirm local opencode version, fake-by-default posture, live-smoke gate, and provider profile state.
- Keep `corepack pnpm verify` on the deterministic fake engine.
- If claiming real opencode behavior, run `corepack pnpm test:opencode-smoke` with explicit live env vars first.
- Demonstrate Gate Enforcement, Remediation Plan, Knowledge Review, Retry Coding, Tests, and Team Overview in one coherent flow.
- Show which evidence came from fake engine versus real opencode.
- Confirm provider secrets, cwd, raw prompts, raw traces, raw logs, and patches are not shown in team summaries.
- Do not claim automatic repair, MCP runtime enforcement, RAG, packaging, Windows Electron smoke, or default real-opencode verification.
