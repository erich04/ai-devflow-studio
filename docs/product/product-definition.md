# DevFlow Studio Product Definition

## One-Line Definition

DevFlow Studio is a self-hosted AI development workflow workbench for small engineering teams. It turns an AI-assisted code change from an ad hoc prompt into a governed delivery flow with local execution, team policy, evidence, review, cost visibility, and human approval.

## Product North Star

A small team can take a software change request from intake to delivery using DevFlow Studio:

1. Capture the request.
2. Clarify scope and acceptance expectations.
3. Design the solution.
4. Run AI-assisted implementation locally.
5. Produce test and review evidence.
6. Assemble a PR Delivery Package and exact Delivery Intent.
7. Approve or reject each Gate and Delivery Request with policy-aware context.
8. Publish one approved commit as a GitHub Draft pull request.
9. Sync redacted summaries to the team view and complete Acceptance.

The product should keep developers in control of local execution while giving leads and managers enough evidence to govern risk, cost, and delivery readiness.

## Target Users

### Developer

Uses the Electron desktop client to:

- Select a local repository.
- Create or continue a Run.
- Execute local tests.
- Run Coding Agent tasks in a managed worktree.
- Review diffs, permission requests, evidence, and runtime traces.
- Prepare, Revise, Resume, Retry, or Stop a GitHub Delivery through explicit actions.
- Sync redacted summaries to the team backend.

### Tech Lead / Reviewer

Uses Desktop and Web views to:

- Review Gate status.
- Inspect Knowledge Review output.
- Evaluate policy warnings or blockers.
- Approve Gates or explicit overrides.
- Approve or reject one exact redacted Delivery Request through a signed Web session.
- Check delivery evidence before implementation, PR, or acceptance.

### Team Manager / Project Owner

Uses Web Team Console to:

- See project overview and recent Runs.
- Track policy state, cost, evidence, and risk.
- Manage team-facing workflow settings such as policies and budget controls.
- Configure or revoke a Project's verified GitHub App repository binding.

## Core Product Workflow

DevFlow Studio models delivery as a six-stage workflow:

1. Clarify
   - Convert a raw request into clarified scope.
   - Capture goals, non-goals, and acceptance signals.

2. Design
   - Produce a solution design.
   - Identify API, data, testing, and risk assumptions.

3. Build
   - Run Coding Agent work locally.
   - Use managed worktrees and explicit permission relay.

4. Test
   - Run local test commands.
   - Capture Test Evidence with command, result, duration, and redacted output.

5. PR
   - Assemble a metadata-only PR Delivery Package and immutable Delivery Intent.
   - Require a signed lead/owner approval for the exact redacted Delivery Request.
   - Publish the approved expected commit and create or reconcile one Draft pull request.

6. Accept
   - Final human Gate for business acceptance.
   - Require durable GitHub Delivery completion, preserve the audit trail, and never merge.

## Main Product Modules

### Desktop Workbench

Primary developer surface. It owns local execution and local evidence.

Core responsibilities:

- Local repository selection.
- Workflow canvas and Run inspection.
- Test command validation and execution.
- Coding Agent runtime orchestration.
- Knowledge Review execution.
- Gate approval and override actions through guarded write paths.
- Commit-bound Delivery Intent preparation and explicit Revise, Resume, Retry, and Stop actions.
- Repository-scoped GitHub publication from Electron main with an in-memory installation token.
- Local SQLite persistence.
- Redacted team sync.

### Team Web Console

Team and manager surface. It owns team visibility and administration.

Core responsibilities:

- Team overview.
- Project and Run summaries.
- Policy, budget, and delivery status.
- Pairing code creation for Desktop connection.
- GitHub App repository binding/revocation and exact Delivery Request approval.
- Redacted evidence and review summaries.

### API Backend

Team data and policy source of truth.

Core responsibilities:

- Team identity and sessions.
- Project membership.
- Pairing and authenticated sync.
- Policy and budget persistence.
- GitHub App authority, redacted Delivery Requests, approvals, credential-grant metadata, remote-head
  verification, and Draft pull-request creation.
- Postgres-backed team state.
- Redacted overview responses.

### Shared Domain Core

Cross-runtime product logic.

Core responsibilities:

- Workflow types and transitions.
- Gate enforcement policy.
- Knowledge governance rules.
- Budget guard evaluation.
- Remediation and delivery summaries.
- Delivery Intent/Request validation, series/attempt/revision identity, and Acceptance evidence
  requirements.
- Redaction-safe data contracts.

## Agent Boundaries

DevFlow Studio contains multiple agent-related capabilities. They are intentionally different:

### Knowledge Review Agent

DevFlow assembles review context, retrieves knowledge references, calls a selected review model provider, and parses a structured review result.

The model provider, such as Doubao / Volcengine Ark, supplies model inference only. DevFlow owns the review prompt, evidence selection, context redaction, and result interpretation.

### Coding Agent

Coding Agent work is executed through the managed coding runtime. Real coding execution can use `opencode`; fake execution remains available for deterministic local verification and CI.

Coding Agent runs must preserve:

- Explicit permission relay.
- Managed worktree isolation.
- Diff capture.
- Test evidence.
- Runtime trace.
- Cleanup state.

### Skills and MCP

Skills and MCP are team capability surfaces, not substitutes for Gate approval. They may help standardize work, but they do not bypass workflow policy or evidence requirements.

## GitHub Delivery Boundary

Desktop derives an immutable Delivery Intent from the canonical managed worktree, expected commit,
repository binding, Run version, Test Evidence, and PR Delivery Package. API/Postgres stores the
redacted Delivery Request and a separate signed lead/owner approval. A GitHub App supplies
repository-scoped, short-lived authority: Desktop main receives only Contents write capability for
the exact push, while the API verifies the remote head and creates or reconciles one Draft pull
request.

Revise replaces changed pre-publication material and invalidates approval. Resume continues the
same `recovery_required` attempt. Retry creates a new attempt only after the current claimant proves
the exact remote predecessor terminal. Stop parks the exact active attempt for manual recovery.
DevFlow never merges, force-pushes, deletes a branch, publishes a tag, or lets GitHub replace the
canonical local Run.

## Evidence Model

DevFlow Studio treats evidence as the core product primitive.

Important evidence types:

- Request and clarification artifacts.
- Design artifacts.
- Coding diff artifacts.
- Test Evidence.
- Knowledge Review artifacts.
- Gate approval and override decisions.
- Runtime cost and budget decisions.
- PR Delivery Package and acceptance bundle artifacts.
- Delivery Intent, Delivery Request, signed approval, verified remote head, and Draft pull-request
  completion metadata.

Evidence shown to the team must be redacted. Local raw execution details stay local unless explicitly summarized through a safe contract.

## Governance Model

Governance is not a single approval button. It is a combination of:

- Workflow Gates.
- Knowledge governance checks.
- Configurable Gate Enforcement Policy.
- Agent Review findings.
- Test Evidence requirements.
- Budget guard decisions.
- Lead-only overrides with audit trail.

The product rule is:

> UI may explain or initiate actions, but approval and override decisions must be enforced in write paths, not only through disabled buttons.

## Deployment Model

Current product direction is self-hosted team pilot, not public SaaS.

Expected deployment shape:

- Electron Desktop for developers.
- Web Team Console.
- API backend.
- Postgres database.
- Docker Compose for small-team pilot deployment.

Public SaaS, billing, enterprise SSO, and large organization administration are not near-term product goals.

## Product Baseline Scope

Release status and future milestones live only in the [Roadmap](../roadmap.md).

This Product Definition owns the durable product shape, users, workflow, evidence model, governance
rules, and non-goals. The Roadmap remains authoritative for release status and sequencing.

V1.5 is released as `v1.5.0`, and the finite 1.x product line is complete. Its candidate-bound local,
CI, packaged Desktop, Postgres, lifecycle, restart, revocation, redaction, and private GitHub sandbox
evidence is immutable under `docs/releases/v1.5.0/`. V2.0 Native Agent Runtime is complete with
immutable evidence under `docs/releases/v2.0.0/`; V2.1 Evaluated Retrieval and Memory is the active
Roadmap priority, with local retrieval/Memory complete and Runtime Context/Desktop UX in progress.
Desktop now exposes a strict bounded Agent Memory lifecycle view; exact-version human lifecycle
promotion and statement revision are available through main-owned exact-digest/version actions,
and explicit deletion commits a tombstone before restart-safe derived-state purge. Packaged restart
evidence remains before Slice 5 can complete.

The released product baseline provides:

- One trusted workflow command path for Clarify, Design, Build, Test, PR, and Acceptance.
- Main-process canonical writes and durable local persistence for Run, Artifact, Event, Test
  Evidence, Agent Review, Coding activity, policy, budget, and sync state.
- Explicit Local Project ↔ Team Project binding, authenticated collaboration intent, Desktop-owned
  canonical Run execution, and redacted Team projections.
- Managed Coding worktrees, explicit permission relay, diff/test evidence, cost visibility, and
  bounded cleanup/recovery semantics.
- Knowledge Governance, bounded repository Markdown context, durable sync outbox recovery, and
  reproducible self-hosted pilot lifecycle validation.

The released V1.5 extension adds commit-bound Delivery Intent preparation, redacted Delivery
Requests and signed approval, GitHub App repository authority, idempotent branch/Draft publication,
bounded recovery, and Acceptance evidence.

Historical PRDs, plans, walkthroughs, release records, and candidate evidence remain immutable
records of what was proposed or verified at that time. They do not compete with the Roadmap for
current release or priority truth.

## Non-Goals

DevFlow Studio should not become:

- A generic chat assistant.
- A fully autonomous code merge bot.
- A public SaaS platform before the self-hosted pilot is validated.
- A replacement for GitHub, CI, or issue trackers.
- A raw log warehouse that uploads local prompts, stdout, stderr, patches, cwd, or provider secrets.

## Product Quality Bar

A feature is product-ready only when:

1. The user-facing concept is clear.
2. The write path is guarded where needed.
3. Evidence is persisted.
4. Redaction boundaries are preserved.
5. The behavior is covered by the appropriate layer of tests or smoke.
6. The walkthrough can explain what the user should do next.
