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

## Planned Milestones

### v0.4: Knowledge Governance

- Build the standards-focused Knowledge Base on top of Git-managed Markdown.
- Index development standards, testing standards, PR and review checklists, ADRs, API contracts,
  onboarding notes, and Skill/MCP usage rules.
- Build a lightweight Knowledge Graph with nodes for systems, modules, standards, terms, owners,
  Skills, testing strategies, and ADRs.
- Link Runs, Artifacts, Test Evidence, and Gate decisions back to relevant standards and knowledge
  nodes.
- Keep Markdown as the source of truth so knowledge changes can be reviewed like code.

### v0.5: Agent Knowledge Enforcement

- Let Agents cite relevant standards during clarification and design.
- Check designs against ADRs and project conventions before Gate approval.
- Generate test checklists from team testing standards.
- Show Gate reviewers which standards are satisfied, violated, or missing evidence.
- Record which knowledge nodes were referenced during Agent Events.

## Deferred / Not Yet Started

- HoneyAI adapter or execution-engine bridge.
- Real LLM or multi-agent orchestration.
- Real MCP process management, permissions audit, and tool-call telemetry.
- Git Markdown indexing pipeline and editor.
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
