# DevFlow Studio v1.2 Walkthrough Result - 2026-06-21

## Summary

This report records a manual walkthrough against the v1.2 guide and the follow-up fixes made after
the first pass:

- Guide: `docs/guides/devflow-studio-v1.2-walkthrough.md`
- Date: 2026-06-21
- Mode: local development, fake/default provider path for Desktop, seed API/Web data
- Initial result: partially passed
- Follow-up result: key blocking issues fixed and verified by targeted automation

The main product surfaces are visible and usable: Desktop navigation, Gate Enforcement, Knowledge Governance, fake Knowledge Review, fake Coding Agent permission relay, coding trace, test evidence, Web Team Console, and Runtime Budget administration UI.

The first walkthrough was not a strict green release walkthrough because:

- `release:status` correctly failed on dirty git state caused by the new guide/docs changes.
- The fake Coding Agent generated a diff and trace, but its worktree test evidence failed because the managed worktree did not have `node_modules`.
- Runtime Budget UI presence was verified, but policy save / approval creation was not conclusively submitted through the browser UI in this pass.

Follow-up verification after fixes:

- `corepack pnpm test:electron-smoke` passed after changing fake Coding Agent test evidence to use a zero-dependency marker verification command.
- `corepack pnpm test -- apps/desktop/electron/coding-runtime.test.ts apps/web/app/page.test.tsx apps/web/app/lib/devflow-api.test.ts scripts/user-guide-doc.test.ts` passed, 38 tests.
- `corepack pnpm test -- apps/api/src/routes/team-routes.test.ts` passed, 35 tests.

## Commands Run

```bash
corepack pnpm test -- scripts/user-guide-doc.test.ts
corepack pnpm release:status
corepack pnpm dev:electron
corepack pnpm dev:api
corepack pnpm dev:web
```

Observed:

- `scripts/user-guide-doc.test.ts`: passed, 9 tests.
- `release:status`: package metadata, tag, and release docs were OK, but working tree was dirty and manual walkthrough was still pending.
- Electron launched the real app when targeted by the explicit app path:
  `/Users/erich/File/claude/10-showcase/ai-devflow-studio/apps/desktop`
- API ran at `http://127.0.0.1:4310`.
- Web ran at `http://127.0.0.1:4311`.

## Desktop Walkthrough

### App Launch

Verified:

- Correct window title: `AI DevFlow Studio`.
- Correct app content loaded at `127.0.0.1:5173`.
- Sidebar entries visible: Workbench, Team Overview, Knowledge, Agents, Skills, MCP, Tests.
- Project context visible: Payments API, local project path, test command.

Note:

- Computer Use initially targeted an old Electron default-app window from a stale worktree. Targeting the full current Electron app path fixed this.

### Gate Enforcement

Verified on the initial Gate node:

- Status: `blocked_policy_unavailable`.
- Approval is blocked.
- Policy source: unavailable, policy version `v0`.
- Blocking reason: team enforcement policy unavailable.
- Remediation candidate: sync team enforcement policy.

This matches the v1.x offline policy behavior: team projects without a cached authoritative policy must not silently fall back to warn-only.

### Knowledge Governance

Verified Knowledge page content:

- Git Markdown Index.
- API Health Endpoint Standard.
- Local Test Evidence Standard.
- PR Review Readiness Checklist.
- Electron Demo Readiness Checklist.
- Postgres Smoke Readiness Checklist.
- opencode Runtime Signoff Checklist.
- v0.9 Demo Readiness Checklist.
- Gate Governance ADR.
- Skill and MCP Usage Rules.
- Run references and evidence links were visible.

### Knowledge Review Agent

Action:

- Ran fake Knowledge Review from the Agents page.

Verified:

- Review was archived.
- Review history updated.
- 23 knowledge references reviewed.
- Provider shown as deterministic fake provider.
- Gate Advisory shown as `warn`, warning-only, not blocking approval.
- Trace included context build, retrieval, provider call, and artifact creation.

### Coding Agent

Action:

- Selected the build task node `本地实现`.
- Started fake Coding Agent.
- Approved the permission request.

Verified:

- Coding Agent action is visible only on the build task path.
- Permission Relay displayed a pending edit permission.
- After approval, run completed with:
  - fake runtime.
  - diff artifact.
  - bootstrap status skipped.
  - budget guard disabled for cost-free fake run.
  - cleanup status active.
  - trace entries for brief, permission, diff, bootstrap, and test.
- Diff artifact was redacted and human-readable.
- Changed path: `devflow-fake-change.txt`.

Issue found:

- Test Evidence for the coding worktree failed.
- Failure reason from output:
  `Local package.json exists, but node_modules missing, did you mean to install?`

Interpretation:

- The product surfaced the failure correctly.
- For a strict human demo, this should either be documented as expected for this path or fixed by choosing a zero-dependency test command / running dependency bootstrap / preparing the managed worktree before test execution.

### Tests Page

Verified:

- Test Evidence list is visible.
- Historical passed and failed test evidence is shown.
- The new coding worktree test failure is shown with command, exit code, duration, and output.
- Summary cards show local evidence counts, unit pass count, smoke pass count, and coverage.

## Web Team Console Walkthrough

### Launch

Verified:

- Web loaded at `http://127.0.0.1:4311`.
- Page title: AI DevFlow Studio.
- GitHub sign-in link is visible.
- Dashboard cards visible: Active Runs, Pending PR, Members, Cost, Agent Reviews.

### Team Overview

Verified:

- Projects list shows Payments API and Internal Admin Console.
- Create desktop pairing code buttons are visible.
- Members and cost summary are visible.
- Runtime Budget section is visible.
- Gate Enforcement Policy and backend Knowledge Review Agent sections are visible.

### Runtime Budget UI

Verified:

- Runtime Budget panel is present.
- Policy controls are visible:
  - enabled checkbox.
  - monthly limit input.
  - warning threshold input.
  - save budget policy button.
- Budget Approval form is visible:
  - requestedBy.
  - provider.
  - maxAdditionalCostUsd.
  - expiresAt.
  - reason.
  - create approval button.

Not conclusively verified:

- Saving a policy through the UI.
- Creating a budget approval through the UI.

Reason:

- Computer Use field entry against browser number inputs was unreliable in this pass. The UI exists, but mutation should be verified either manually in browser or through API/Postgres smoke.

## Not Covered In This Pass

- Real opencode + Doubao/Volcengine provider smoke.
- Docker Compose self-hosted stack.
- GitHub OAuth callback.
- Desktop pairing token exchange.
- Budget policy save / approval creation through the browser UI.
- Release walkthrough completion flag.

## Findings

### P1 - Coding Worktree Test Evidence Fails Without Dependencies - Fixed

The fake Coding Agent path completed the coding run and archived the diff, but generated failed Test Evidence because the managed worktree did not have dependencies installed.

Fix:

- Fake Coding Agent test evidence now uses a zero-dependency marker verification command:
  it verifies `devflow-fake-change.txt` inside the managed worktree instead of running the project
  package test command.
- Real/opencode-style engines still use the project test command and dependency bootstrap path.
- `scripts/electron-smoke.mjs` now asserts the fake marker evidence for the Coding Agent path, and
  still separately verifies project `npm test` evidence through the explicit project test path.

Verification:

- `corepack pnpm test -- apps/desktop/electron/coding-runtime.test.ts` passed.
- `corepack pnpm test:electron-smoke` passed.

### P2 - Computer Use Needs Explicit Electron App Target

Using `app: "Electron"` may target a stale default Electron app from another worktree. For reliable UI automation, target:

`/Users/erich/File/claude/10-showcase/ai-devflow-studio/node_modules/.pnpm/electron@33.4.11/node_modules/electron/dist/Electron.app`

### P2 - Runtime Budget Mutations Need Manual/API Verification - Automated Evidence Added

The budget admin UI is present, but this pass did not conclusively verify save/create mutations because browser field automation was unreliable. This should be verified manually or with existing API/Postgres smoke before release signoff.

Follow-up evidence:

- Web page rendering test confirms the Runtime Budget panel and Budget Approvals list render.
- Web API client tests confirm `saveRuntimeBudgetPolicy` calls `PUT /api/runtime/budget-policy`.
- Web API client tests confirm `createRuntimeBudgetApproval` calls `POST /api/runtime/budget-approvals`.
- API route tests confirm budget policy save, lead approval creation, and approval-backed evaluate flow.

Commands:

```bash
corepack pnpm test -- apps/web/app/page.test.tsx apps/web/app/lib/devflow-api.test.ts
corepack pnpm test -- apps/api/src/routes/team-routes.test.ts
```

### P3 - Release Status Is Correctly Strict

`release:status` fails because the current working tree contains uncommitted guide/report changes. This is correct behavior. Commit or discard documentation changes before treating release status as green.

## Conclusion

The v1.2 walkthrough confirms that the main Desktop and Web surfaces are visible and that the core fake-provider flow works end to end through review, permission relay, diff, trace, and test evidence display.

After follow-up fixes, the prior blocking Coding Agent test evidence issue is resolved by automated Electron smoke. Runtime Budget save/create behavior is verified at Web API client and API route layers; a browser-only manual form submission can still be repeated later if a human wants visual confirmation.

Remaining release hygiene:

- Commit or discard the guide/report changes before expecting `release:status` to pass.
- Real opencode + Doubao provider smoke was not rerun in this walkthrough.
