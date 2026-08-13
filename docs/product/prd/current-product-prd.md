# DevFlow Studio Current Product PRD

Status: Current released baseline; V2.1 Evaluated Retrieval and Memory implementation active
Last updated: 2026-08-13

## Source Documents

- [`Product Definition`](../product-definition.md)
- [`Product Details`](../details/README.md)
- [`Roadmap`](../../roadmap.md)
- [`v1.3 Delivery Flow Completion`](../../plans/v1.3-delivery-flow-completion.md)
- [`V1.5 GitHub Delivery PRD`](./v1.5-github-delivery-prd.md)
- [`V2.0 Native Agent Runtime PRD`](./v2.0-native-agent-runtime-prd.md)
- [`Bounded Agent Runtime`](../../adr/0014-bounded-agent-runtime.md)
- [`Governed Coding Executor`](../../adr/0015-governed-coding-executor.md)
- [`Tool And MCP Execution Authority`](../../adr/0016-tool-mcp-execution-authority.md)
- [`GitHub App Delivery Authority`](../../adr/0013-github-app-delivery-authority.md)
- [`Domain Context`](../../../CONTEXT.md)

## Problem Statement

Small engineering teams are adopting AI-assisted coding, but the actual delivery process often stays
ad hoc: prompts live in chat tools, implementation happens in local terminals, test results are
scattered, policy decisions are informal, and reviewers only see a partial result at the end.

That creates three product problems:

- Developers need local AI assistance without losing control over repositories, commands, secrets,
  or provider credentials.
- Leads need enough evidence to approve risky delivery stages without reading raw local logs or
  trusting a generated summary blindly.
- Team managers need delivery, cost, policy, and risk visibility without turning DevFlow into a
  public SaaS, CI replacement, or autonomous merge bot.

## Solution

DevFlow Studio is a self-hosted AI development workflow workbench for small engineering teams. It
turns an AI-assisted code change from a raw request into a governed delivery flow with local
execution, evidence capture, policy-aware Gates, cost visibility, review artifacts, and redacted team
sync.

The product is not a generic chat surface. It is a workflow and evidence system. A Run should move
from request intake through clarification, design, build, test, PR draft, and acceptance while
preserving the evidence needed for human review.

## Target Users

- Developer: runs local AI-assisted work, manages repository context, approves local tool access,
  captures tests and diffs, and syncs redacted summaries.
- Tech Lead / Reviewer: evaluates Gates, policy findings, Knowledge Review output, test evidence,
  PR draft handoff, and acceptance readiness.
- Team Manager / Project Owner: monitors project delivery health, active Runs, evidence coverage,
  policy state, runtime budget usage, and team workflow adoption.

## User Stories

1. As a developer, I want to create a Run from a raw software request, so that the delivery work has
   a durable starting point.
2. As a developer, I want DevFlow to create a standard workflow from the request, so that I can see
   the expected path from clarification to acceptance.
3. As a developer, I want to select a local repository, so that AI-assisted work runs against the
   correct project.
4. As a developer, I want local paths, raw logs, prompts, patches, and secrets to stay local, so that
   team visibility does not leak private execution data.
5. As a developer, I want to capture clarification output, so that the request becomes goals,
   non-goals, acceptance criteria, and open questions.
6. As a developer, I want to capture design output, so that implementation assumptions and testing
   strategy are reviewable before coding starts.
7. As a developer, I want Coding Agent work to run in a managed workspace, so that generated edits do
   not directly mutate my primary checkout.
8. As a developer, I want to approve or reject tool permission requests, so that local actions remain
   under human control.
9. As a developer, I want dependency bootstrap and tool activity to be visible, so that I can
   understand what happened during a Coding Agent Run.
10. As a developer, I want to run a configured test command, so that DevFlow captures durable Test
    Evidence.
11. As a developer, I want failed, timed-out, and passed tests to be explicit, so that I know
    whether the Run can proceed.
12. As a developer, I want DevFlow to create a PR draft artifact, so that delivery handoff is based
    on request, design, diff, test, policy, budget, and review evidence.
13. As a developer, I want DevFlow to create an acceptance evidence bundle, so that final signoff has
    a single reviewable artifact.
14. As a tech lead, I want Gates to show required evidence and policy state, so that approval is not
    just a decorative UI action.
15. As a tech lead, I want Gate approval to be enforced in write paths, so that disabled buttons are
    not the only protection.
16. As a tech lead, I want to see Knowledge Review findings, so that risks and missing evidence are
    surfaced before risky stages.
17. As a tech lead, I want policy warnings, blockers, hard-blocks, and override paths to be explicit,
    so that governance decisions are auditable.
18. As a tech lead, I want override decisions to require a reason and role-aware constraints, so that
    exceptions are deliberate.
19. As a tech lead, I want budget guard decisions before paid provider usage, so that runtime cost
    does not surprise the team.
20. As a tech lead, I want retries to preserve prior evidence and remediation context, so that
    follow-up work is traceable.
21. As a reviewer, I want to answer what was requested, what changed, what was tested, what agents
    concluded, what policy applied, and who approved, so that final delivery risk is clear.
22. As a team manager, I want a Web Team Console with redacted summaries, so that I can monitor
    delivery health without opening local developer machines.
23. As a team manager, I want runtime budget policy administration, so that provider spending can be
    governed per project.
24. As a project owner, I want Desktop pairing to connect a local client to a team project, so that
    redacted sync uses scoped credentials instead of demo state.
25. As a project owner, I want project-level policy settings, so that Gates match the team's risk
    tolerance.
26. As a team member, I want DevFlow to distinguish local, remote, seed, and adapter-originated data,
    so that I do not confuse fixtures with real work.
27. As a reviewer, I want the active Run to show current stage, blockers, warnings, next action, and
    evidence status, so that I can decide what to do next quickly.
28. As a developer, I want browser preview to avoid a second workflow engine and fail closed for
    execution actions, so that only the Electron main-process runtime can advance trusted state.
29. As a lead, I want redacted Agent Review and Coding Agent summaries in the team view, so that local
    execution is visible without exposing raw data.
30. As a small team, I want a self-hosted deployment path, so that we can validate DevFlow without
    waiting for public SaaS readiness.
31. As a developer, I want Desktop to prepare one immutable Delivery Intent from the canonical
    managed worktree and expected commit, so that GitHub never receives stale or unrelated code.
32. As a lead or owner, I want to approve one exact redacted Delivery Request through a signed Web
    session, so that Desktop bearer authority cannot approve its own remote write.
33. As an owner, I want to configure and revoke one verified GitHub App repository binding per Team
    Project, so that delivery authority is narrow and independently revocable.
34. As a developer, I want one approved commit published without force to one `devflow/` branch and
    represented by one Draft pull request, so that delivery is exact and reviewable.
35. As a developer, I want explicit Revise, Resume, Retry, and Stop actions with distinct semantics,
    so that recovery never silently reuses approval or creates another logical delivery.
36. As an Acceptance reviewer, I want the exact remote head and Draft pull-request evidence in the
    canonical Run before completion, so that a PR handoff artifact alone is insufficient.
37. As an operator, I want restart reconciliation and revocation to avoid duplicate credentials,
    pushes, or pull requests, so that ambiguous remote effects remain bounded.

## Core Requirements

### Request-To-Delivery Workflow

- A Run starts from a real request and creates a raw-request artifact.
- Every Run uses the standard stages: clarify, design, build, test, PR, and accept.
- Gate approval advances the workflow through defined edges rather than hard-coded status jumps.
- Acceptance approval completes the Run and preserves the final evidence bundle.

### Evidence Chain

- Every meaningful workflow action must create evidence or explain why evidence is unavailable.
- Evidence must be attached to a Run and, when possible, to a specific Node.
- Missing evidence must produce a next action or remediation path.
- The Evidence Chain should let a reviewer answer: request, change, tests, agent conclusion, policy,
  approval, and remaining risk.

### Local Execution And Redaction

- Desktop owns local execution, private repository context, local SQLite state, test commands, and
  provider credential boundaries.
- Team-visible data must be redacted before sync.
- Raw local paths, prompts, stdout, stderr, patch bodies, provider secrets, API keys, tokens, and
  external-directory details must not sync by default.
- Renderer code cannot submit Run/Test/Coding summaries directly; Electron main derives remote
  summaries from canonical LocalStore state, and API/Repository ingestion reapplies redaction.
- Test/Review/Coding summaries are child-first and scope-immutable. Only an explicit missing
  canonical Run may trigger one latest-Run upload and one child retry; durable outbox/backoff is a
  v1.4 reliability concern rather than a hidden v1.3 renderer retry loop.
- Team-bound structured metadata, model/cost, and budget/reason objects use strict allowlist
  projection; allowed values are still path/secret-redacted and unknown nested keys are discarded.
- Opening an upgraded local database permanently normalizes legacy Test Evidence, derived/orphaned
  Test Reports, Test Result Events, and Coding Agent event metadata before they can be rendered again.

### Gate Enforcement And Governance

- Protected Gates are human decision nodes that can require policy enforcement.
- Approval and override decisions must be checked in write paths.
- Gate Enforcement Policy can warn, block, hard-block, require policy sync, or allow approval.
- Overrides must be auditable and cannot bypass hard-block rules.
- An accepted override is bound to the exact current blocker-ID set and policy version; changed
  blockers require a new decision.
- An accepted override cannot be reused by another actor: approval rechecks the current project-lead
  actor, exact Run/Node, and creator/node-owner separation of duties.
- Knowledge Governance Checks and Agent Policy Findings inform Gate decisions but do not replace
  human review.
- A remote Agent Review must carry the minimal redacted policy-finding details needed to reconstruct
  exact blocker IDs; a count without those findings is not sufficient Gate evidence.

### Agent Runtime Boundaries

- Knowledge Review uses DevFlow-owned context assembly, evidence selection, redaction, prompts, and
  structured result interpretation.
- Coding Agent work uses a managed runtime adapter. DevFlow owns context assembly, permission relay,
  worktree management, evidence capture, tests, traces, cleanup state, and redacted summaries.
- External model or coding providers own inference and code generation only.
- Fake engines remain available for deterministic automated verification; real provider paths remain
  explicit and signoff-oriented.

### Governed GitHub Delivery

- Desktop derives a Delivery Intent from the canonical managed worktree, expected commit, active
  repository binding, Run/node/version, Test Evidence, changed paths, and PR Delivery Package.
- API/Postgres owns the redacted Delivery Request, signed lead/owner approval, GitHub App binding,
  credential-grant metadata, remote verification, Draft pull-request result, and audit.
- The GitHub App private key remains in the API process. A repository-scoped, short-lived Contents
  token exists only in Electron main memory for one active publication attempt.
- The API independently verifies the approved expected commit as the remote branch head before it
  creates or reconciles one Draft pull request.
- Revise creates a new pre-publication intent revision and invalidates approval. Resume continues
  one `recovery_required` attempt. Retry creates the next attempt only after the current pairing
  claimant proves the exact remote predecessor `failed` or `revoked`. Stop parks the exact active
  attempt for explicit recovery.
- DevFlow never merges, force-pushes, deletes remote branches, publishes tags, broadens GitHub App
  scope, or treats GitHub as Workflow authority.

### Team Console And Self-Hosted Pilot

- Web Team Console shows redacted delivery health, active Runs, Gate status, evidence coverage,
  Agent Review summaries, Test Evidence, policy state, budget state, and Desktop pairing.
- API backend owns authenticated team state, project membership, policy persistence, budget
  persistence, pairing, GitHub repository bindings, Delivery Requests, signed approvals, and
  redacted sync ingestion.
- Unsigned identity headers are off by default and rejected for browser origins; networked Team writes
  use signed session Cookies or paired Desktop Bearer Tokens.
- Only a canonical Run Summary can advance remote Run status/current Node. Prior active Nodes settle,
  and delayed Test/Review/Coding summaries cannot reactivate a non-current Node.
- Remote child IDs remain bound to their original organization/project/Run/Node and canonical sync
  creator. Rebinding is rejected rather than treated as an upsert.
- An independent Lead evaluates an override against the existing creator-owned canonical Run and
  never republishes that Run under the reviewer's identity.
- The deployment target is a self-hosted small-team pilot with Desktop, Web, API, Postgres, and
  Docker Compose.

### PR Delivery And Acceptance

- PR stage creates a metadata-only PR Delivery Package from request, design, changed paths, tests,
  policy, budget, and Agent Review evidence.
- Desktop prepares an immutable Delivery Intent, and Team creates a redacted Delivery Request for
  separate signed Web approval before any GitHub write.
- After approval, Desktop publishes only the expected commit and API creates or reconciles one Draft
  pull request after independently verifying the remote head.
- Acceptance stage creates an evidence bundle that references the original request, PR draft, diff,
  tests, policy, budget, review summaries, Delivery Intent, exact remote head, and Draft URL.
- Acceptance rejects a handoff-only PR artifact when GitHub Delivery is enabled. Acceptance never
  merges, closes, or mutates the pull request.

## Implementation Decisions

- Keep Desktop, Web, API, and Shared Domain Core as separate product surfaces with distinct
  responsibilities.
- Keep the six-stage workflow as the stable product model for delivery.
- Treat Evidence as the core product primitive, not a secondary audit log.
- Enforce Gates through shared domain logic and runtime write paths.
- Keep local raw execution details in Desktop unless converted into a redacted summary contract.
- Keep self-hosted team pilot as the current deployment shape.
- Keep public SaaS, billing, enterprise SSO, and managed multi-tenancy out of the near-term product
  path.
- Keep the PR Delivery Package separate from source/repository authority and require the governed
  GitHub Delivery state machine for a real Draft pull request.
- Keep policy, tests, Knowledge Review, budget, and Agent traces visible around the delivery
  workflow instead of hiding them in separate admin-only screens.
- Keep deterministic fake runtime paths available for CI and local verification.

## Testing Decisions

- Test external product behavior rather than implementation details.
- Shared workflow tests should cover Run creation, stage edges, Gate advancement, terminal
  acceptance, PR draft creation, and acceptance bundle creation.
- Desktop IPC tests should cover small request inputs, guarded approval paths, artifact persistence,
  test command execution, policy snapshot handling, and redaction boundaries.
- Desktop UI tests should cover New Run intake, active Run selection, Inspector actions, Gate
  enforcement explanations, PR draft generation, and acceptance bundle generation.
- API and Postgres tests should cover authenticated team state, pairing, policy persistence, budget
  evaluation, sync ingestion, GitHub App binding/revocation, Delivery Request approval, credential
  grants, remote verification, Draft completion, and rejection of unsafe approval-like writes.
- Web tests should cover team overview, Evidence Chain visibility, latest active Run display,
  policy/budget controls, and redacted summary rendering.
- Cross-platform checks should preserve Windows compatibility for path handling and static runtime
  boundaries, even when full Electron smoke remains macOS-local.
- Deterministic GitHub Delivery tests should use fake GitHub clients and local bare remotes; packaged
  Desktop smoke should prove restart reconciliation without external writes.
- Real GitHub validation should use one explicitly authorized private sandbox, one candidate, one
  Draft pull request, no automatic retry, and no merge.
- Real provider and real opencode smoke should stay explicit release/signoff paths, not default CI
  requirements.

## Acceptance Criteria

- A user can create a Run from a raw request.
- The Run has the six standard workflow stages and an initial raw-request artifact.
- Human Gate approval advances the current node through workflow edges.
- Protected Gates cannot be approved through a UI-only bypass.
- A developer can run local tests and capture Test Evidence.
- A developer can start Coding Agent work from the intended build-stage task.
- Permission relay, runtime trace, diff summary, and cleanup state are visible for Coding Agent work.
- Team-visible sync excludes raw local paths, prompts, stdout, stderr, patches, and secrets.
- Remote Run state has one active current Node; dependent summary IDs cannot be rebound or used to
  advance, synthesize, or reactivate a Run.
- A reviewer can inspect Knowledge Review, policy, test, budget, and evidence state before approval.
- A lead can approve, reject, or override Gates only through guarded paths.
- Web Team Console can show redacted project and Run delivery health.
- Runtime budget policy and approval state are visible where paid provider usage is relevant.
- PR Draft and Acceptance Evidence Bundle artifacts can be generated from accumulated evidence.
- One exact Delivery Intent can become one separately approved Delivery Request, one verified remote
  branch head, and one Draft pull request without leaking credentials or local paths.
- Revise, Resume, Retry, and Stop preserve immutable history and cannot reuse stale approval.
- Revocation blocks a new credential grant, and restart reconciliation does not repeat remote
  effects.
- The product remains explainable as a self-hosted small-team AI delivery workbench.

## Out Of Scope

- Generic chat assistant behavior.
- Fully autonomous code merge or deployment.
- Pull-request merge, auto-merge, branch deletion, force-push, tag publication, issue automation,
  or deployment through GitHub Delivery.
- Public SaaS onboarding.
- Billing and subscription management.
- Enterprise SSO.
- Hosted multi-tenancy.
- Automatic cloud deployment.
- Signed installer distribution and auto-update.
- A first-class `TestEvidence.skipped` state; it requires a future shared/API/store/UI contract.
- Replacing GitHub, CI, or issue trackers.
- Uploading raw local logs, prompts, patches, paths, or secrets.
- Untrusted or remote MCP process execution outside the installed main-owned Local MCP authority.
- Full RAG/vector retrieval provider integration.
- Large-organization concurrency, administration, and audit depth.
- HoneyAI bridge or multi-agent orchestration.

## Further Notes

- V1.5 is released as `v1.5.0`, and the finite 1.x completion gate passed with immutable
  candidate-bound evidence under `docs/releases/v1.5.0/`.
- V2.0 Native Agent Runtime is complete with immutable evidence under `docs/releases/v2.0.0/`.
  V2.1 Evaluated Retrieval and Memory is the active Roadmap priority; retrieval/index and scoped
  durable Memory are complete, while Runtime Context now has strict renderer provenance and a
  bounded read-only Desktop Memory lifecycle view. Exact-version lifecycle actions, packaged
  restart evidence, and later Team projection/evidence still require their ordered plan slices and
  completion gates.
- Runtime Operations and Collaboration Hardening remain evidence-promoted backlog items unless the
  Roadmap assigns milestone priority.
- UI refactor work should preserve the Evidence Chain as the center of gravity: current stage,
  blocking reason, next action, and evidence status must stay visible.
- Only the Roadmap owns current release and milestone status. Release-signoff documents retain
  historical execution and evidence, while this PRD describes the current product baseline.
