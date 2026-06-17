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

v0.6 opencode Coding Adapter is underway with the fake harness and persistence/UI slice
implemented. DevFlow can create a managed git worktree, start a fake Coding Agent Run, show a
permission relay request, approve/reject the request, archive a redacted Coding Diff Artifact and
Dependency Bootstrap Evidence, and sync a redacted Coding Agent summary through Electron, API, and
Postgres. The real opencode HTTP adapter is spike-selected and wrapped behind a tested request
module, but the full real opencode runtime remains a manual hardening path before making it the
default engine.

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
- Added Desktop Agents UI controls for running the fake Coding Agent, approving/rejecting
  permissions, cancelling runs, and opening/deleting managed worktrees.
- Added a tested opencode HTTP adapter wrapper for session creation, permissions, replies, abort,
  prompt send, and diff fetch.
- Added redacted `RemoteCodingAgentSummary` sync through Electron, API route, and Postgres overview
  boundaries.
- Added ADR 0009 and v0.6 plan/research docs.

## Planned Milestones

### v0.6.1: Real opencode Runtime Hardening

- Wire the tested opencode HTTP adapter into Electron's Coding Agent runtime behind the same IPC/UI
  contract used by the fake harness.
- Add manual `test:opencode-smoke` for real opencode permission relay, abort, timeout reject, diff
  capture, dependency bootstrap, and test evidence.
- Keep default `verify` deterministic with the fake harness.

### v0.7: Configurable Agent Knowledge Enforcement

- Add project/team policy controls that can turn selected Gate Advisory categories from warnings
  into blocking checks.
- Let reviewers configure which Knowledge Governance Checks are advisory, required, or blocking.
- Preserve the v0.5 default of human-controlled Gate approval unless policy explicitly enables
  blocking.
- Add stronger reviewer audit trails for policy decisions, overrides, and missing evidence.
- Expand Agent Review to produce structured policy findings without becoming a coding Agent.

## Deferred / Not Yet Started

- HoneyAI adapter or execution-engine bridge.
- Multi-agent orchestration.
- Real MCP process management, permissions audit, and tool-call telemetry.
- Repository file watcher, in-app Markdown editor, and remote knowledge synchronization.
- Electron packaging, macOS signing/notarization, Windows installer/signing, auto-update, and release
  distribution.
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
