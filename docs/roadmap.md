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

## Product North Star

DevFlow Studio's product direction is a **small-team self-hosted AI DevFlow workbench**: a team can
run its own API/Web/Postgres stack, connect local Electron clients, let developers use real local
Agent runtimes, and give leads a governed, auditable view of evidence, policy, cost, and delivery
state without uploading raw repository content or provider secrets.

The v1.x line should stay anchored to that team-pilot product shape:

- **v1.0** proved the minimum team pilot foundation: authenticated Web, Desktop pairing,
  redacted sync, and Docker Compose.
- **v1.0.x** hardens the team connection layer: pairing/token negative paths, audit entries,
  token revoke/rotation, backup/restore guidance, and later multi-Desktop concurrency checks.
- **v1.1 Runtime Cost + Budget Guard** adds project/run/user/provider cost summaries and lead
  approval before real provider usage exceeds configured budget thresholds.
- **v1.3-v1.7** should complete the request-to-delivery workflow and pilot trust boundary before
  broad operations or platform expansion: request intake, workflow advancement, PR draft handoff,
  acceptance evidence, auth/budget hardening, GitHub delivery integration, runtime operations, and
  light collaboration hardening.
- **v2.0** is the earliest reasonable point to revisit managed/public SaaS, billing, hosted
  multi-tenancy, and managed credentials.

Keep these out of the near-term path unless a later roadmap explicitly promotes them: public SaaS,
billing, enterprise SSO, automatic cloud deployment, signed installers, auto-update, HoneyAI bridge,
multi-agent orchestration, real MCP execution, and full RAG/vector retrieval. The
**Next concrete action** is V1.4 candidate formation and candidate-bound verification. GitHub
delivery and operations expansion wait until V1.4 formal signoff is complete.

## Current Status

`v1.3.0` is the released baseline. The annotated tag resolves to signoff commit
`06f3cc321300e3751aaa41c67f66d70cfaf6ebe4`, whose evidence is stored under
`docs/releases/v1.3.0/`. The formal paired walkthrough and the single authorized real-opencode
smoke are recorded in `docs/guides/devflow-studio-v1.3-walkthrough-result-2026-07-31.md`.

The tag-triggered Release run exposed an annotated-tag shallow-fetch conflict before checkout. The
release assets were recovered from the successful pre-tag run at the same signoff SHA, and
`b7b879c` fixed the workflow for future tags without moving `v1.3.0`. The post-fix `main` Verify run
passed macOS, Windows, Postgres, and Docker jobs.

| Layer | Current status |
| --- | --- |
| Released baseline | `v1.3.0` signed, tagged, and published |
| Development branch | V1.4 scoped implementation complete from `b7b879c`; candidate formation pending |
| Package metadata | Remains `1.3.0` until V1.4 candidate formation |
| V1.4 contract | `docs/product/prd/v1.4-pilot-trust-boundary-prd.md` |
| V1.4 execution | `docs/plans/v1.4-pilot-trust-boundary.md` |

V1.3 provides the complete local request-to-delivery workflow, canonical main-process writes,
paired project-bound sync, local-first merge, evidence-gated Acceptance, explicit fake/no-cost
runtime boundaries, redaction, runnable API/Worker outputs, and expanded release automation.

V1.4 scoped implementation has closed the planned pilot trust gaps: paid-runtime fail-closed
decisions, durable sync outbox, real repository knowledge integration, authenticated Web management
paths, and reproducible unsigned pilot lifecycle artifacts. Candidate formation, package version
alignment, candidate-bound verification, and formal signoff remain pending. Real GitHub delivery
remains V1.5.

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

### v0.8.1: Release Signoff And Version Alignment

- Made the repository public to unblock GitHub Actions for the release candidate and confirmed run
  `27863202387` passed macOS verify, Windows compatibility, and Postgres integration.
- Fixed the Windows-only knowledge fixture path normalization failure found by CI.
- Aligned all first-party package metadata to `0.8.1` and created the annotated `v0.8.1` tag after
  automated verification passed.
- Preserved the final human walkthrough as a post-tag acceptance checklist, because Computer Use
  could read the Electron UI but still could not reliably click through it in this environment.
- See `docs/plans/v0.8.1-release-signoff.md`.

### v0.9: Real opencode Runtime + Observability + Demo Readiness

- Re-confirmed the real opencode runtime contract against local opencode `1.17.5` and documented the
  Volcengine Ark OpenAI-compatible provider profile without committing secrets.
- Hardened the real opencode adapter lifecycle: user cancel is `cancelled`, permission/run timeout is
  `timed_out`, POSIX process groups are used when available, and worktree cleanup records
  `deleted`/`cleanup_failed` instead of silently swallowing failures.
- Made real-runtime behavior legible in Agents with runtime labeling, terminal state, permission
  timeline, changed paths, bootstrap/test evidence, and cleanup status without exposing raw
  worktree/source paths.
- Added a v0.9.x Tool / Skill Timeline for real opencode runs by recording permission-backed
  `tool_call` / `tool_result` coding events with redacted metadata. Missing opencode Skill metadata
  is shown as inferred/unknown instead of fabricating internal Skill call-stack details.
- Closed v0.9 with dual-path signoff: deterministic fake-engine `verify`, `build`,
  disposable-Postgres smoke, default no-cost opencode smoke skip, and explicit real-opencode smoke
  against the configured Volcengine provider. A post-release live smoke on 2026-06-20 also passed
  against provider `double` / model `ark-code-latest` in about 1m38s with `bash -> edit -> bash`
  permission relay, fixture test evidence, and managed worktree cleanup.
- See `docs/plans/v0.9-real-runtime-observability.md`.

### v1.0: Team Pilot Foundation

- Reframed v1.0 from portfolio packaging to a minimum self-hosted team pilot: a small team can log
  in, create a project, pair Desktop, sync redacted local workflow summaries, and view them in Web.
- Completed v1.0a Identity Foundation by formalizing `User`, `AuthAccount`, authenticated sessions,
  and identity-backed team projections without creating a parallel membership source.
- Completed v1.0b GitHub OAuth + Minimal Team Project with first-user organization-owner bootstrap,
  session-cookie handling, logout, and owner-only project creation.
- Completed v1.0c Desktop Pairing + Authenticated Sync with one-time pairing codes, scoped Desktop
  bearer tokens, credential-boundary storage, and redacted bearer-token sync.
- Completed v1.0d Self-Hosted Minimum Deployment with Docker Compose for API/Web/Postgres,
  `.env.example`, a self-hosted pilot guide, and CI Docker smoke coverage.
- Preserved v0.9's verification discipline: fake engine in default CI/`verify`, real opencode and
  paid provider calls only in explicit smoke/signoff paths.
- Signed off v1.0.0 with local deterministic verification plus GitHub Actions coverage for Docker
  smoke, Postgres integration, Windows compatibility, and macOS verify.
- See `docs/plans/v1.0-team-pilot-foundation.md` and
  `docs/plans/v1.0-release-signoff.md`.

### v1.1: Runtime Cost + Budget Guard

- Added project/run/user/provider cost summaries for the real opencode provider path while keeping
  fake-engine verification cost-free.
- Introduced project-level budget thresholds and lead approvals for real provider runs that exceed
  configured limits.
- Wired Electron Coding Runtime to estimate cost before provider invocation and call the team budget
  evaluator before starting paid provider work.
- Persisted runtime budget policies, approvals, and redacted coding cost summaries in Postgres.
- Included redacted coding runtime cost summaries in team cost rollups and remote coding summaries.
- See `docs/plans/v1.1-runtime-cost-budget-guard.md`.

### v1.2: Runtime Cost UX + Budget Administration

- Added Web Team Console controls for viewing and saving runtime budget policies.
- Added Web Team Console budget approval creation and approval listing.
- Added Desktop Coding Agent budget decision trace details for projected/current/limit cost,
  decision reason, and approval id.
- Added explicit Desktop "Retry with approval" flow for runs blocked by
  `requires_lead_approval`.
- Preserved the v1.1 safety boundary: Desktop passes an approval id, while the team API/runtime
  boundary resolves that id to a complete approval record before budget evaluation.
- Kept paid real-provider validation out of default CI. The 2026-06-21 v1.2 signoff ran the
  release-only real opencode smoke against the local Volcengine/Doubao profile and confirmed
  `opencode smoke passed; changed paths: devflow-opencode-smoke.txt` after adding command metadata
  path redaction for tool traces.
- See `docs/plans/v1.2-runtime-cost-ux-budget-administration.md`.

### v1.3: Delivery Flow Verification and Release Hardening

- Released `v1.3.0` with the request-based six-stage workflow, trusted main-process commands,
  atomic local evidence writes, project-bound sync, local-first merge, redaction, and final
  Acceptance checks.
- Signed off candidate-bound macOS, Windows, Postgres, Docker, Electron, build/output, paired
  Computer Use, and one explicitly authorized real-opencode smoke.
- Published the release at signoff commit `06f3cc3`; fixed the annotated-tag checkout workflow on
  post-release `main` without moving the tag.
- Kept PR delivery as a human-readable artifact; real GitHub publication remains V1.5.

## Planned Milestones

### v1.4 Candidate: Pilot Trust Boundary (implementation complete; candidate pending)

- Make real paid Coding and Knowledge Review runtimes fail closed on missing, invalid,
  unauthenticated, out-of-scope, or unavailable budget decisions, with redacted audit evidence.
- Add a durable remote-sync outbox with bounded backoff, restart recovery, immutable project scope,
  and operator-visible retry/recovery state.
- Connect repository Markdown indexing to the real Electron, API Review, Coding Runtime, and Gate
  paths instead of passing empty knowledge arrays.
- Keep unsigned identity headers out of pilot/production paths and add remaining negative-path and
  configuration coverage.
- Complete Web request intake, Gate actions, Desktop pairing, and explicit run selection.
- Harden the minimum runnable outputs from v1.3 into reproducible Electron/Web/API pilot packages
  with deploy, upgrade, and rollback smoke before external pilot use.
- Execute against `docs/product/prd/v1.4-pilot-trust-boundary-prd.md` and
  `docs/plans/v1.4-pilot-trust-boundary.md`.

### v1.5 Candidate: GitHub Delivery Integration

- Add project-to-repository delivery settings and use the v1.3 PR draft artifact as the source for
  GitHub compare/PR creation.
- Decide GitHub App vs scoped user token before implementation, and keep credentials inside the
  existing team/Desktop credential boundary.
- Do not silently push or merge. Human approval remains required for branch publication and PR
  creation.

### v1.6 Candidate: Runtime Operations Hardening

- Add self-hosted operations hardening after the delivery flow closes: backup/restore guidance,
  token-revocation UX, selected auth/pairing negative-path smoke coverage, and cleanup/recovery
  notes for self-hosted pilots.
- Keep release-only real opencode provider smoke as the paid-runtime signoff gate.

### v1.7 Candidate: Collaboration Hardening

- Add small-team collaboration checks after the single-user delivery loop is coherent: 2-3 Desktop
  clients, basic conflict visibility, audit review, and member administration improvements.
- Do not treat 10-person concurrency as a v1.3-v1.5 requirement.

## Deferred / Not Yet Started

- HoneyAI adapter or execution-engine bridge.
- Multi-agent orchestration.
- Real MCP process management, permissions audit, and tool-call telemetry beyond the current
  opencode permission-backed Tool / Skill Timeline.
- MCP policy enforcement and Skill/MCP runtime execution.
- RAG/vector retrieval provider integration.
- Repository file watcher, in-app Markdown editor, and remote knowledge synchronization.
- Electron packaging, macOS signing/notarization, Windows installer/signing, auto-update, and release
  distribution.
- Public SaaS onboarding, billing, hosted multi-tenancy, and managed credentials.
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
