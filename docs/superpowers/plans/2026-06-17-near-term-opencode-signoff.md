# DevFlow Studio Near-Term opencode Signoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the v0.6.1 real opencode path easy to sign off locally without weakening deterministic CI/verify.

**Architecture:** Keep the fake engine as the default automated path. Add a small tested preflight layer around the manual opencode smoke, document the exact local demo/signoff command, and leave true live execution env-gated.

**Tech Stack:** TypeScript scripts via `tsx`, Vitest, existing `scripts/opencode-smoke.ts`, README documentation, `corepack pnpm`.

---

## Near-Term Scope

The immediate milestone is not new product surface. It is v0.6.1 signoff readiness:

- `corepack pnpm test:opencode-smoke` should be safe and deterministic by default.
- When live smoke is requested, missing `opencode`, provider, model, or key configuration should fail with clear remediation.
- README should explain the fake default path, real opencode smoke path, required env vars, and expected outcome.
- Full manual live signoff remains dependent on local opencode installation and provider credentials.

## Tasks

### Task 1: Tested opencode Smoke Preflight

**Files:**
- Create: `scripts/opencode-smoke-preflight.ts`
- Create: `scripts/opencode-smoke-preflight.test.ts`

- [x] Write tests for skip, blocked, and ready preflight modes.
- [x] Implement `evaluateOpencodeSmokePreflight(env)`.
- [x] Verify the helper never prints provider key values.

### Task 2: Wire Preflight into Smoke Script

**Files:**
- Modify: `scripts/opencode-smoke.ts`

- [x] Use `evaluateOpencodeSmokePreflight(process.env)` at script startup.
- [x] Keep default skip behavior exit code 0.
- [x] For blocked live mode, print missing configuration and exit code 1 before importing runtime modules.
- [x] Keep live mode unchanged once preflight returns ready.

### Task 3: README Signoff Instructions

**Files:**
- Modify: `README.md`

- [x] Add a v0.6.1 Coding Agent section.
- [x] Document default fake verification commands.
- [x] Document real opencode smoke env vars and command.
- [x] Explain that live smoke is manual and not part of `verify`.

### Task 4: Verification and Push

**Commands:**

```bash
corepack pnpm test -- scripts/opencode-smoke-preflight.test.ts
corepack pnpm test:opencode-smoke
corepack pnpm --filter @ai-devflow/desktop typecheck
corepack pnpm test
git diff --check
git push origin devflow-v0.2-final-v0.3-start
```

Expected: deterministic checks pass without opencode or provider keys.

## Live Signoff Evidence

- 2026-06-17: Installed/upgraded opencode to `1.17.5`.
- 2026-06-17: Verified Volcengine Ark provider `double/ark-code-latest` can call the model with two
  local API keys; key values were not written to project files.
- 2026-06-17: Fixed opencode HTTP diff capture by falling back to managed worktree git diff when
  opencode returns an empty diff or the message HTTP stream closes after applying changes.
- 2026-06-17: Fixed opencode server shutdown so `stopAll()` waits for exit and force-kills on
  timeout.
- 2026-06-17: `DEVFLOW_RUN_OPENCODE_SMOKE=1 DEVFLOW_CODING_ENGINE=opencode-http
  DEVFLOW_OPENCODE_PROVIDER_ID=double DEVFLOW_OPENCODE_MODEL_ID=ark-code-latest
  corepack pnpm test:opencode-smoke` passed with
  `opencode smoke passed; changed paths: devflow-opencode-smoke.txt`.
- 2026-06-17: Extended the live smoke and opencode HTTP engine to support multi-step permission
  relay. The real smoke passed with `bash -> edit -> bash -> bash` permission approvals before
  producing `devflow-opencode-smoke.txt`.
