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

- [ ] Write tests for skip, blocked, and ready preflight modes.
- [ ] Implement `evaluateOpencodeSmokePreflight(env)`.
- [ ] Verify the helper never prints provider key values.

### Task 2: Wire Preflight into Smoke Script

**Files:**
- Modify: `scripts/opencode-smoke.ts`

- [ ] Use `evaluateOpencodeSmokePreflight(process.env)` at script startup.
- [ ] Keep default skip behavior exit code 0.
- [ ] For blocked live mode, print missing configuration and exit code 1 before importing runtime modules.
- [ ] Keep live mode unchanged once preflight returns ready.

### Task 3: README Signoff Instructions

**Files:**
- Modify: `README.md`

- [ ] Add a v0.6.1 Coding Agent section.
- [ ] Document default fake verification commands.
- [ ] Document real opencode smoke env vars and command.
- [ ] Explain that live smoke is manual and not part of `verify`.

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
