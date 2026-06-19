# AI DevFlow Studio Roadmap

This roadmap is the source of truth for completed milestones and future product planning. ADRs
record architectural decisions; `CONTEXT.md` records domain language; this file tracks what has been
completed and what should come next.

## Documentation Map

Use these files by responsibility:

- `docs/roadmap.md`: completed milestones, current project progress, next milestones, and long-term product planning.
- `docs/plans/`: executable milestone plans that are checked against the current codebase before implementation.
- `CONTEXT.md`: stable domain language and ubiquitous terms such as Run, Gate, Artifact, Skill, MCP Server, Knowledge Base, and Test Evidence.
- `docs/adr/`: accepted architecture decisions and tradeoffs. ADRs explain why a direction was chosen; they do not track delivery progress.
- `docs/engineering/`: operational engineering practice, test strategy, demo/smoke reproduction, and lessons learned from recurring failure modes.
- `docs/knowledge/`: reviewable Markdown knowledge sources that DevFlow can index, including standards, rules, ADR summaries, and reusable checklists.
- `docs/research/`: research notes, comparisons, and investigation artifacts. Research can inform roadmap decisions, but it is not the active plan.
- `README.md`: project entrypoint, app/package map, and everyday commands.

## Current Status

AI DevFlow Studio is currently an Electron-first team developer workbench with a workflow canvas,
selected-node inspector, local test execution, SQLite-backed test evidence, light/dark/system theme
support, and Team, Knowledge, Skills, MCP, and Tests views.

The v0.2 Final feature set is complete and release-confirmed locally: a developer can select a
local repository, create a Run, approve a Gate, validate and execute the project's test command
through controlled Electron IPC, persist evidence/settings/MCP state in SQLite schema v2, and
separate local state from seed fixtures. The previously intermittent Electron smoke path around
selecting the new Run's Gate node has been stabilized, and `corepack pnpm verify` has passed
repeatedly.

v0.3 Team Backend Synchronization is complete and verified. DevFlow now has a Postgres-backed team
API path, a Web manager console that reads from the API, an Electron remote sync boundary for
approved Run/Test Evidence summaries, explicit demo session headers, and CI coverage for macOS
verify, Windows compatibility checks, and Postgres integration smoke.

v0.4 Knowledge Governance and v0.4.x Knowledge Retrieval hardening are implemented in the desktop
workbench. DevFlow indexes Git-managed Markdown knowledge sources into governance documents,
section-level chunks, graph entities, tag relations, retrieval hits, and Run references.

v0.5 Knowledge Review Agent Workbench is implemented as the first real Agent runtime slice.
Electron can run a local Knowledge Review Agent against a selected Run/Node and persist Agent
Review, trace, token usage, artifact, and event data in SQLite. The API/Web path can run the same
shared Agent Core against team state and persist the result through the team repository boundary.
Gate Advisory remains warning-only by default.

v0.6 opencode Coding Adapter is implemented and signed off for the macOS local runtime path.
DevFlow can create a managed git worktree, start a Coding Agent Run from a build task node,
assemble the coding brief from persisted DevFlow context, show and push permission relay updates,
expire unanswered permission requests, archive a redacted Coding Diff Artifact, persist Dependency
Bootstrap Evidence and worktree Test Evidence, and sync a redacted Coding Agent summary through
Electron, API, and Postgres. The real opencode runtime is available through explicit
`DEVFLOW_CODING_ENGINE=opencode-http` configuration and a manual
`corepack pnpm test:opencode-smoke` script; default verification remains deterministic on the fake
engine. Manual live signoff completed with opencode `1.17.5` and Volcengine Ark
`double/ark-code-latest`, including a multi-step `bash -> edit -> bash -> bash` permission relay.

v0.7 Configurable Gate Enforcement Policy core is implemented. DevFlow now has a shared policy
resolver/evaluator, warn-only default policy, recommended enforcement preset, Agent Policy Findings,
API/Postgres policy persistence, Web policy controls, Electron policy snapshot/override persistence,
and an Electron Gate approval write path that re-checks `canApproveGateNow` in the main process.
The v0.7.x hardening patch adds explicit Electron app-path launch, Desktop Inspector enforcement
explanations, no-cache team policy `blocked_policy_unavailable`, online policy refresh before
approval, and API sync rejection for approval summaries that would bypass the Gate write path.

Current validation remains macOS-local for the full real Electron window path. Windows compatibility
is preserved through static automation checks and Windows CI for typecheck/unit/audit; full Windows
Electron smoke is still tracked as future compatibility expansion. See
`docs/adr/0006-cross-platform-electron-compatibility.md`.

## Completed Milestones

### v0.1: Fixture-Backed Team Workbench

- Built the initial desktop workbench UI with sidebar navigation, workflow canvas, inspector, run
  list, status metrics, and shell views for Team Overview, Knowledge, Skills, MCP, and Tests.
- Added shared domain types for Runs, Nodes, Gates, Artifacts, Agent Events, Skills, MCP servers,
  token usage, Knowledge Base, and Knowledge Graph concepts.
- Added light, dark, and system theme support for the desktop UI.
- Added unit tests and browser Playwright coverage for core UI flows.

### v0.2: Local Test Execution Slice

- Added Electron main-process IPC for selecting a local project, detecting project metadata, saving
  a test command, running tests, and loading local state.
- Added local SQLite persistence for Local Projects, Workflow Runs, Artifacts, Agent Events, and
  Test Evidence.
- Added test command detection for common JavaScript package managers.
- Added redaction for sensitive stdout/stderr content before evidence is stored.

### v0.2.1: Real Electron Demo Loop

- Added `corepack pnpm dev:electron` as the real desktop development entrypoint.
- Added `corepack pnpm test:electron-smoke` to exercise a real Electron window, preload API,
  controlled IPC, local shell execution, and SQLite persistence.
- Added command safety checks for test execution and blocked destructive shell patterns.
- Added SQLite schema version tracking.
- Removed active HoneyAI/opencode product fixture language from the DevFlow UI.
- Expanded Tests view evidence with command, exit code, duration, redaction status, and output
  summary.

### v0.2 Final: Local State Stabilization

- Persist newly created Runs immediately instead of keeping them only in React state.
- Persist Gate approval changes and generate approval Agent Events.
- Persist MCP server enable/disable state in SQLite.
- Persist Electron theme preference in SQLite, with browser preview falling back to localStorage.
- Separate seeded fixture data from real local SQLite state so local Runs do not mix with fixture
  Artifacts or Events.
- Wire the search input to filter Runs, Artifacts, Events, and Knowledge labels.
- Added `DataOrigin = 'seed' | 'local' | 'remote' | 'adapter'` and local execution state types so
  v0.3 can add synchronized remote data without replacing the local slice.

### v0.2 Final: Validation Stabilization

- Stabilize the real Electron smoke test around selecting the newly created Run and its Gate node.
- Confirmed `corepack pnpm verify` passes repeatedly after the smoke wait path fix.
- Kept the patch limited to test stability and documentation, without adding v0.3 backend features.

### v0.3: Team Backend Synchronization

- Added the team database schema, initial Postgres migration, demo seed CLI, and `pg` runtime
  repository selector with seed fallback for local demos.
- Replaced direct API fixture serving with a repository/route boundary for Runs, team overview,
  Skills, MCP definitions, and redacted sync summaries.
- Connected the Web manager console to `/api/team/overview` through a DevFlow API client instead of
  importing manager dashboard fixtures.
- Kept Electron SQLite as the local/offline/private state boundary and sync only approved summaries
  or redacted evidence to the team backend.
- Added Electron remote sync IPC/client support for loading team snapshots and uploading approved
  Run/Test Evidence summaries while keeping raw stdout/stderr/cwd private.
- Made desktop Team Overview and top-level project/cost indicators consume remote snapshot projects,
  members, and cost rollups after explicit sync.
- Added demo session and tenant/project/member role boundaries, including explicit demo headers in
  Web/Electron clients and a Postgres smoke path with `DEVFLOW_REQUIRE_AUTH=true`.
- Added `corepack pnpm test:postgres-smoke` and GitHub Actions coverage for a real Postgres service.
- Added Windows compatibility guardrails through `corepack pnpm test:cross-platform` and Windows CI
  typecheck/unit/audit coverage.

### v0.4: Knowledge Governance

- Added `KnowledgeSourceFile`, `KnowledgeDocument`, `KnowledgeReference`, and
  `KnowledgeGovernanceCheck` domain types.
- Added Markdown indexing for standards, testing evidence rules, PR review checklists, ADRs, and
  Skill/MCP usage rules.
- Added a lightweight graph projection with standard and term nodes plus `defines` relations.
- Added shared reference/check helpers that link Runs, Artifacts, Test Evidence, and Gate decisions
  back to relevant standards.
- Added desktop Inspector governance checks and an upgraded Knowledge page with Git Markdown index,
  graph, tags, source paths, and current Run references.
- Added representative source Markdown under `docs/knowledge/`.

### v0.4.x: Knowledge Retrieval / RAG-Ready Hardening

- Added section-level Knowledge Chunks with stable content hashes for source-version awareness.
- Added Knowledge Retrieval as the recommendation layer between workflow context and Knowledge
  References.
- Added lexical retrieval metadata including strategy, score, source section, and content hash.
- Kept Governance Checks evidence-driven: Run-level retrieval citations do not satisfy or violate
  standards by themselves.
- Added ADR 0007 to preserve the boundary between retrieval recommendations and governance
  evidence before future RAG work.

### v0.5: Knowledge Review Agent Workbench

- Added a shared Knowledge Review Agent Core with deterministic fake provider and
  OpenAI-compatible provider support.
- Added Electron local Agent runtime through preload IPC and SQLite persistence for Agent Review,
  Agent Trace, Agent Token Usage, `agent_review` Artifact, and `agent_review` Agent Event.
- Added API backend Agent runtime using the same shared Agent Core and Postgres repository boundary.
- Added provider credential flows that return only masked metadata to UI clients.
- Added Desktop Agent Workbench and Inspector `Agent Review` action with provider status, review
  history, trace, warning-only Gate Advisory, and cost source.
- Added Web manager console display plus a server-action trigger for backend Knowledge Review.
- Added redacted Electron `RemoteAgentReviewSummary` sync so local review summaries can appear in
  team state without uploading prompts, raw traces, local paths, or raw command output.
- Added ADR 0008 to lock the warning-only Gate Advisory and dual-runtime Agent Core boundary.

### v0.6.0 / v0.6.x: opencode Coding Adapter Foundation

- Completed a Spike comparing `opencode serve` HTTP and `opencode acp`, selecting HTTP for the first
  managed transport.
- Added Coding Agent domain types for runs, events, permission requests/decisions, managed
  workspaces, dependency bootstrap evidence, diff artifacts, and redacted remote summaries.
- Added SQLite schema v4 persistence for local coding runs, permissions, workspaces, bootstrap
  evidence, and diff artifacts.
- Added a deterministic fake coding harness that creates a managed git worktree, asks permission,
  writes a marker file after approval, captures a redacted diff, and archives bootstrap evidence.
- Added a shared build-task eligibility helper so Coding Agent actions only start from DevFlow's
  implementation task node.
- Hardened the fake runtime path to assemble coding context from Run artifacts, Knowledge
  references, governance checks, Gate decisions, and existing Test Evidence.
- Added Coding Agent push IPC/preload subscriptions for status, event, and permission updates, with
  snapshot/replay still available through `subscribeCodingRun`.
- Added permission timeout expiry and worktree Test Evidence persistence after approved fake coding
  runs.
- Added Desktop Agents UI controls for running the fake Coding Agent, approving/rejecting
  permissions, cancelling runs, and opening/deleting managed worktrees.
- Added a tested opencode HTTP adapter wrapper for session creation, permissions, replies, abort,
  prompt send, and diff fetch.
- Added an env-gated real `opencode-http` Coding Engine Adapter behind the same runtime seam used by
  the fake harness, including managed `opencode serve` process lifecycle, runtime env injection,
  permission reply, abort, redacted diff capture, dependency bootstrap, and skipped-by-default
  `test:opencode-smoke`.
- Signed off the real opencode runtime manually on macOS with opencode `1.17.5` and Volcengine Ark
  `double/ark-code-latest`, including a multi-step `bash -> edit -> bash -> bash` permission relay
  and worktree diff/test-evidence capture.
- Added redacted `RemoteCodingAgentSummary` sync through Electron, API route, and Postgres overview
  boundaries.
- Added ADR 0009 and v0.6 plan/research docs.

### v0.7: Configurable Gate Enforcement Policy

- Added `EnforcementAction`, organization policy floors, project override clamping, effective
  policy source markers, protected Gate detection, and `canApproveGateNow`.
- Added warn-only default policy so human Gate approval remains the out-of-box behavior.
- Added Recommended Enforcement Preset for deterministic missing-review, testing-standard, and
  API-contract blocking rules.
- Added validator constraints so project overrides cannot define floors or hard-block behavior, and
  probabilistic Agent findings can never hard-block.
- Added Agent Policy Findings to Knowledge Review output and remote summary metadata.
- Added Postgres schema v3 tables for enforcement policies, Gate override decisions, and Agent
  policy findings.
- Added API routes for policy load/save, enforcement evaluation, and Gate override.
- Added Web Team Console policy panel and apply-recommended-preset action.
- Added Electron SQLite schema v5 policy snapshot and Gate override persistence.
- Added Electron preload IPC for policy load/evaluate/override and a main-process Gate approval
  handler that re-checks policy before writing approval state.
- Signed off committed-state `verify`, `build`, disposable-Postgres policy/override smoke, and real
  Electron direct-approval rejection smoke on 2026-06-18.
- Added ADR 0010.

### v0.7.x: Enforcement UX and Reconciliation Hardening

- Completed richer Desktop Inspector rendering for policy source, blocking reasons, hard-block
  remediation, and provisional-vs-confirmed override state.
- Completed Electron launch hardening so `corepack pnpm dev:electron` passes the desktop app path
  explicitly instead of falling back to Electron's default app.
- Completed no-cache team policy behavior: team projects without a cached authoritative policy use
  `blocked_policy_unavailable`; pure local projects still use warn-only default policy.
- Completed best-effort online team policy refresh before Desktop approval; failed refresh keeps the
  last cache or blocks when no cache exists.
- Completed API sync hardening: `/api/sync/run-summary` rejects `approval` summaries so approval-like
  writes must use the Gate enforcement path.
- Completed provisional override reconciliation hardening: Desktop records server-confirmed
  overrides as accepted, keeps network failures provisional, and shows server rejections as
  rejected/blocking.
- Added v0.7.5 engineering docs for testing strategy, demo/smoke reproduction, and contribution
  signoff discipline.
- Extracted the Desktop Gate Enforcement path into a focused hook and Inspector panel to reduce
  `App.tsx` coupling without broad UI restructuring.

### v0.8: Policy-Aware Delivery Automation

- Added shared Remediation Model types and deterministic remediation generation from Gate
  Enforcement decisions, Knowledge Governance Checks, Agent Policy Findings, Test Evidence, and
  Knowledge References.
- Added Coding Brief remediation context for human-approved retry attempts while keeping renderer
  inputs limited to IDs and user instruction.
- Added Electron `startRetryAttempt` IPC, SQLite retry persistence, Inspector remediation CTA, and
  Agents retry history for policy-aware Coding Agent retries.
- Added redacted Policy-Aware Delivery summaries to API/Web manager reporting, including warning,
  blocking, override, remediation, retry, and evidence-gap counts.
- Kept v0.8 within human-approved delivery automation: no auto-fix loop, no Gate bypass, no real MCP
  policy execution, and no HoneyAI bridge.
- Signed off release-style validation on 2026-06-19: `corepack pnpm verify`, `corepack pnpm build`,
  disposable-Postgres smoke, and Electron smoke with remediation retry through Test Evidence.

## Planned Milestones

### v0.9: Runtime Expansion Candidates

- Deepen the real opencode adapter beyond local signoff, including longer-running streamed traces
  and release-grade smoke coverage.
- Evaluate MCP policy enforcement and tool-call telemetry once the MCP runtime layer is real.
- Revisit RAG/vector retrieval only after the deterministic Knowledge Retrieval boundary remains
  stable under v0.8 remediation usage.

## Deferred / Not Yet Started

- HoneyAI adapter or execution-engine bridge.
- Multi-agent orchestration.
- Real MCP process management, permissions audit, and tool-call telemetry.
- Repository file watcher, in-app Markdown editor, and remote knowledge synchronization.
- Electron packaging, macOS signing/notarization, Windows installer/signing, auto-update, and release
  distribution.
- Windows real-opencode smoke for managed worktree path handling and dependency bootstrap once the
  macOS manual runtime path is promoted from local signoff to release validation.
- Full release/distribution CI beyond the current verify workflow.

## Knowledge Roadmap Notes

The Knowledge roadmap is intentionally tracked here even though v0.2 does not implement it. It is a
core long-term differentiator for DevFlow Studio: the product should eventually connect workflow
execution with team standards, review policy, testing rules, and project memory.

The expected source model is:

- Markdown in Git remains the source of truth.
- DevFlow indexes and visualizes knowledge instead of replacing the repository.
- Agents and human Gates use indexed knowledge as review context.
- Evidence produced during a Run can link back to the standards it satisfies.

## Tracking Policy

- Use this file for milestone planning, completed-phase summaries, and future product direction.
- Use ADRs for architectural decisions and tradeoffs.
- Use `CONTEXT.md` for stable domain language.
- Use `docs/research/` for investigations and comparison notes.
- When a planned milestone is completed, move its summary into `Completed Milestones` and add the
  next concrete milestone under `Planned Milestones`.
