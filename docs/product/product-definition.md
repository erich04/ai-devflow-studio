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
6. Draft delivery artifacts.
7. Approve or reject each Gate with policy-aware context.
8. Sync redacted summaries to the team view.

The product should keep developers in control of local execution while giving leads and managers enough evidence to govern risk, cost, and delivery readiness.

## Target Users

### Developer

Uses the Electron desktop client to:

- Select a local repository.
- Create or continue a Run.
- Execute local tests.
- Run Coding Agent tasks in a managed worktree.
- Review diffs, permission requests, evidence, and runtime traces.
- Sync redacted summaries to the team backend.

### Tech Lead / Reviewer

Uses Desktop and Web views to:

- Review Gate status.
- Inspect Knowledge Review output.
- Evaluate policy warnings or blockers.
- Approve Gates or explicit overrides.
- Check delivery evidence before implementation, PR, or acceptance.

### Team Manager / Project Owner

Uses Web Team Console to:

- See project overview and recent Runs.
- Track policy state, cost, evidence, and risk.
- Manage team-facing workflow settings such as policies and budget controls.

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
   - Assemble a PR draft or delivery handoff artifact.
   - Link diff, test, policy, and review evidence.

6. Accept
   - Final human Gate for business acceptance.
   - Preserve audit trail and evidence bundle.

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
- Local SQLite persistence.
- Redacted team sync.

### Team Web Console

Team and manager surface. It owns team visibility and administration.

Core responsibilities:

- Team overview.
- Project and Run summaries.
- Policy, budget, and delivery status.
- Pairing code creation for Desktop connection.
- Redacted evidence and review summaries.

### API Backend

Team data and policy source of truth.

Core responsibilities:

- Team identity and sessions.
- Project membership.
- Pairing and authenticated sync.
- Policy and budget persistence.
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
- PR draft and acceptance bundle artifacts.

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

## Current Product Status

The product has already proven:

- Local-first Electron workbench.
- Team API and Web Console.
- Self-hosted pilot stack.
- Knowledge governance.
- Knowledge Review Agent.
- Managed Coding Agent runtime.
- Real `opencode` runtime path.
- Gate Enforcement Policy.
- Policy-aware remediation and retry.
- Runtime cost and budget guard foundation.
- Workflow delivery flow foundations.

Known product gaps still being refined:

- End-to-end demand intake and stage completion polish.
- PR and acceptance handoff depth.
- Review model provider UX maturity.
- Runtime budget administration UX.
- Inspector scrolling and dense-state usability.
- Multi-user collaboration and conflict handling.
- GitHub delivery integration.

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

