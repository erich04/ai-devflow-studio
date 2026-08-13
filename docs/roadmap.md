# AI DevFlow Studio Roadmap

This roadmap is the single source of truth for major-version charters, the current release, the
active priority, milestone sequencing, completed milestones, and explicitly deferred product work.

PRDs define a milestone outcome, plans define implementation and verification, ADRs record
architectural decisions, and release evidence proves what shipped.

None of those files creates a parallel roadmap. Research and proposals do not change product
sequence until this file promotes them.

## Documentation Map

Use these files by responsibility:

- `docs/roadmap.md`: the only version-planning entrypoint; it owns version-line goals, current
  release truth, milestone order, completion gates, and deferred scope.
- `docs/product/prd/`: user-facing milestone contracts. A PRD does not assign roadmap priority by
  itself.
- `docs/plans/`: executable milestone plans that are checked against the current codebase before implementation.
- `docs/releases/`: immutable candidate-bound evidence for releases that actually shipped.
- `CONTEXT.md`: stable domain language and ubiquitous terms such as Run, Gate, Artifact, Skill, MCP Server, Knowledge Base, and Test Evidence.
- `docs/adr/`: accepted architecture decisions and tradeoffs. ADRs explain why a direction was chosen; they do not track delivery progress.
- `docs/engineering/`: operational engineering practice, test strategy, demo/smoke reproduction, and lessons learned from recurring failure modes.
- `docs/knowledge/`: reviewable Markdown knowledge sources that DevFlow can index, including standards, rules, ADR summaries, and reusable checklists.
- `docs/research/`: research notes, comparisons, and investigation artifacts. Research can inform roadmap decisions, but it is not the active plan.
- `README.md`: project entrypoint, app/package map, and everyday commands.

## Product North Star

DevFlow Studio is a **small-team self-hosted AI DevFlow workbench**. Its deterministic outer
Workflow governs identity, policy, cost, evidence, and human Gates.

The 2.x line adds a DevFlow-native, observable, and evaluable Agent Runtime inside that governed
delivery model.

Desktop remains the authority for private repository execution and full-fidelity local evidence.
API/Postgres remains the authority for team identity, policy, collaboration intent, and redacted
projections.

Product evolution must deepen Agent capability without weakening those authority and redaction
rules.

### Invariants Across Version Lines

- Workflow, Run, Gate, and Evidence remain the deterministic outer control model.
- Electron main owns local source execution, local credentials, and complete local runtime state.
- API/Postgres owns team identity, policy, collaboration commands, and redacted projections.
- An Agent, Tool, Skill, MCP Server, retrieval result, or Memory record cannot bypass a human Gate.
- Default CI remains deterministic and no-cost. Real-provider signoff remains explicit and bounded.
- Knowledge Retrieval and Agent Memory do not automatically become Governance Evidence.
- The 2.x execution-tenancy goal means organization/project/user/session isolation inside the
  self-hosted product; it does not imply public SaaS or hosted shared infrastructure.

## Major Version Charters

| Version line | Core question | Included scope | Completion definition | Status |
| --- | --- | --- | --- | --- |
| 0.x | Engineering foundation | Real Electron execution, durable local state, team sync, Knowledge Governance, Gate policy, a managed external Coding Agent Adapter, runtime observability, and release discipline. | Fake and explicitly authorized real Coding paths can execute in managed worktrees, preserve auditable evidence, obey human Gates, sync only redacted summaries, and pass reproducible verification. | Completed at v0.9.0. |
| 1.x | Governed self-hosted delivery | Authenticated team pilot, Desktop pairing, project scope, policy and budget controls, durable sync, repository knowledge, Web collaboration commands, reproducible lifecycle, and human-approved GitHub delivery. | One authenticated Work Request becomes one canonical local Run, reaches tested and evidence-backed delivery, and publishes a branch and pull request only after explicit human approval. V1.5 is the final planned 1.x feature milestone. | Completed at v1.5.0. |
| 2.x | DevFlow-native Agent Runtime | A bounded first-party Agent loop, native Tool and MCP execution, pluggable Coding Executors, trajectory and evaluation, scoped Context and Memory, evaluated RAG, Multi-Agent orchestration, and tenant-scoped execution. | Benchmarked scenarios demonstrate bounded single- and Multi-Agent execution, native and delegated coding, MCP/tool use, evaluated retrieval and Memory, failure recovery, tenant isolation, and auditable trajectories while Workflow and Gate authority remains intact. | Active; V2.0 implementation is the current priority. |

The version lines are finite product contracts, not an instruction to keep adding versions. A line
ends when its completion gate passes; remaining ideas move to maintenance, evidence-promoted work,
or a separately approved future charter.

## Current Release

`v1.5.0` is the released baseline. Its annotated tag resolves to signoff commit
`bd7de6f82c3a60092816bd947f5590e9f148c3ae`, whose direct parent is candidate
`f461f9d9de300b8e4a15fe31be8f518bde37b2b8`.

Immutable release evidence is stored under `docs/releases/v1.5.0/`. All first-party package
manifests at that release commit report `1.5.0`.

The candidate-bound local matrix, exact-SHA CI, packaged Desktop walkthrough, restart/revocation
checks, and one real private GitHub sandbox Draft-PR walkthrough passed. The published Desktop
archive SHA-256 is `3e44cdfe6d07aa355c259821e2b36f857cbd3ac239bde2ea7c3cdc34abfc449b`.

The published [GitHub Release](https://github.com/erich04/ai-devflow-studio/releases/tag/v1.5.0)
contains the signoff-bound release artifacts.

| Layer | Current status |
| --- | --- |
| Released baseline | `v1.5.0` signed off, tagged, and published |
| Release evidence | `docs/releases/v1.5.0/` |
| V1.5 product contract | `docs/product/prd/v1.5-github-delivery-prd.md` |
| V1.5 execution history | `docs/plans/v1.5-github-delivery.md` and the four immutable release evidence files |
| Completed version line | 1.x governed self-hosted delivery |
| Active version line | 2.x DevFlow-native Agent Runtime |
| Active milestone | V2.0 Native Agent Runtime implementation |
| Next gate | Slice 6 narrow native Coding Agent through accepted main-owned Tools |

The finite 1.x product line is complete. Its final walkthrough proved one authenticated Work Request
became one canonical local Run, one tested commit, one human-approved Draft pull request, a cold
restart with zero repeated remote effects, Acceptance, and a versioned credential-revocation proof.
V2.0 implementation is active. Slices 1–5 are complete: the shared kernel, durable Desktop Runtime,
main-owned Native Tool boundary, trusted local stdio MCP boundary, and governed Coding Executor are
implemented; narrow native coding is next.

## Now / Next / Later

### Now — Implement V2.0 Native Agent Runtime

V1.5 and the finite 1.x line are released and complete. Slices 1–5 are complete; V2.0 now proceeds
through the accepted contract and executable slice plan:

- `docs/product/prd/v2.0-native-agent-runtime-prd.md`
- `docs/adr/0014-bounded-agent-runtime.md`
- `docs/adr/0015-governed-coding-executor.md`
- `docs/adr/0016-tool-mcp-execution-authority.md`
- `docs/plans/v2.0-native-agent-runtime.md`

- Slice 0 froze the accepted bounded Runtime, Coding Executor, and Tool/MCP authority contracts.
- Slice 1 added the versioned shared deterministic kernel, strict transitions, bounds, scenario
  parser, and evaluation metrics without performing I/O.
- Slice 2 added Desktop schema 18, atomic trajectory/checkpoint persistence, strict IPC, startup
  recovery, cancellation fencing, and a packaged no-side-effect Runtime restart probe.
- Slice 3 added Desktop schema 19, immutable Tool definitions, opaque one-shot grants, bounded
  repository read/workspace edit/saved-test/scenario Tools, durable metadata-only audit, restart
  reconciliation, and a packaged Native Tool probe with zero repeat execution.
- Slice 4 added Desktop schema 20, main-owned `LocalMcpInstallation` authority, exact executable
  verification, bounded stdio discovery and calls, a negotiated capability-set digest,
  installation-bound audit, and a packaged Local MCP probe with zero repeat execution.
- Slice 5 added the versioned Coding Executor descriptor, capability negotiation, path-free
  main-owned request, bounded permission turns, no-permission completion, observable OpenCode
  compatibility mapping, and one uniform terminal result including cleanup state.
- Continue with Slice 6 while preserving Workflow/Gate authority, local evidence boundaries, and
  deterministic no-cost default verification.

### Next — Add Narrow Native Coding

- Add one deliberately narrow DevFlow-owned Coding Agent behind the completed common executor
  contract, using only accepted main-owned Tools in one managed worktree.
- Prove bounded plan/read/edit/test/evaluate/repair, deterministic stop behavior, and no delivery or
  Gate authority before moving to Runtime UX and Team projection.

### Later — V2.1 Retrieval/Memory And V2.2 Multi-Agent/Tenancy

- V2.1 adds evaluated hybrid retrieval and scoped Agent Memory only after the V2.0 single-Agent
  baseline is durable.
- V2.2 adds bounded supervisor/specialist coordination and execution tenancy only after V2.1 proves
  retrieval, Memory, citation, and isolation behavior.
- New 1.x work is limited to release defects, security fixes, dependency maintenance, or hardening
  justified by real pilot evidence; there is no planned V1.6 feature milestone.

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

### v1.4: Pilot Trust Boundary

- Released `v1.4.0`; its annotated tag resolves to signoff commit
  `e746843c1943755c50c8fb060bdf533b06442232`, whose direct parent is candidate
  `b7986d4faec2f8f1bcc220a0341cb0686286209e`.
- Made real paid Coding and Knowledge Review runtime decisions fail closed on missing, invalid,
  unauthenticated, out-of-scope, or unavailable budget authority.
- Added a durable sync outbox for redacted team projections with bounded backoff, restart recovery,
  immutable project scope, idempotent delivery, and operator-visible recovery state.
- Integrated bounded local repository Markdown into Gate, Review, and Coding context without
  implicitly uploading repository content. V1.4 API Review knowledge provenance remains `none`.
- Completed authenticated Web Work Request, Run selection, Desktop pairing, and Gate Command paths
  without creating a second workflow authority.
- Added reproducible unsigned pilot deploy, retained-data upgrade, failed-upgrade recovery, bounded
  rollback, and packaged Desktop validation.
- Passed the candidate-bound local matrix, exact-SHA CI, packaged Desktop Computer Use walkthrough,
  and one explicitly authorized real OpenCode smoke without automatic retry.
- Preserved the scoped contract and execution history in
  `docs/product/prd/v1.4-pilot-trust-boundary-prd.md`,
  `docs/plans/v1.4-pilot-trust-boundary.md`, and `docs/plans/v1.4-release-signoff.md`.
- See immutable release evidence under `docs/releases/v1.4.0/`.

### v1.5: GitHub Delivery Integration

- Added project-to-repository delivery settings. The canonical managed worktree and expected local
  commit as the source for branch publication and GitHub compare.
- Uses the PR Delivery Package as the source for Draft PR title, body, evidence links, and review
  context; it is a handoff artifact, not source or Git identity.
- Adopted a GitHub App while retaining identity-only OAuth; App credentials remain inside the
  existing Team/Desktop credential boundary.
- Requires explicit human approval for branch publication and pull-request creation.
- Keeps push/create operations idempotent, auditable, recoverable, and bound to the expected project,
  repository, branch, commit, and evidence version.
- Provides and verifies a minimum operator path to revoke delivery credentials. Richer credential
  administration UX remains evidence-promoted maintenance work.
- Never silently merges, force-pushes, widens repository permissions, or treats GitHub state as authority
  over the canonical local Run.
- Preserves explicit Revise, Resume, Retry, and Stop behavior without reusing an older approval or
  allowing background scheduling to resume manual recovery.
- Released `v1.5.0` at signoff commit `bd7de6f82c3a60092816bd947f5590e9f148c3ae`,
  whose direct parent is candidate `f461f9d9de300b8e4a15fe31be8f518bde37b2b8`.
- Passed the candidate-bound local, packaged, exact-SHA CI, Postgres, Docker lifecycle, restart,
  revocation, redaction, and real private GitHub sandbox gates.
- Preserved the immutable completion evidence under `docs/releases/v1.5.0/` and published the
  signoff-bound assets in the `v1.5.0` GitHub Release.
- Preserved the scoped contract and authority decision in `docs/product/prd/v1.5-github-delivery-prd.md`,
  `docs/adr/0013-github-app-delivery-authority.md`, and `docs/plans/v1.5-github-delivery.md`.

## 1.x Completion Gate

The 1.x product line is complete when an independent non-maintainer operator who did not author or
modify the frozen candidate can follow only the documented Web and packaged Desktop steps and take
one authenticated Work Request through one canonical local Run. Pre-run App installation and secret
injection may be performed by a setup principal; shell/direct-API/SQL/GitHub-CLI repair or an
undocumented maintainer intervention after the run starts fails the gate.

That Run must reach governed local implementation, Test Evidence, human-approved GitHub Draft PR
publication, and Acceptance without ad hoc maintainer assistance.

The gate also requires verified redaction, explicit publication authority, bounded recovery,
revocable credentials, deterministic default CI, and no open P0/P1 defects in the core path.

After that gate, 1.x defaults to maintenance; it does not automatically produce a V1.6 or V1.7
feature milestone.

## 2.x Agent Execution Model

This model explains how deterministic workflow control, bounded model use, autonomous Agent work,
and code-changing execution fit together.

It is the stable 2.x direction, not a claim that the current 1.x runtime already implements every
layer.

| Layer | Owns | Use it when | Product posture |
| --- | --- | --- | --- |
| Deterministic Workflow | Run state, identity, policy, budget, Evidence, human Gates, and whether an operation may start or advance. | Every governed delivery path. | Exists in 1.x and remains the outer control plane in 2.x. |
| Single-Call LLM Operation | One bounded provider request with assembled Context and a validated result; it has no autonomous Tool loop. | The input is already sufficient for a narrow summary, classification, review, or artifact generation. | Current Knowledge Review is an example: a persisted trace and Artifact do not make it an iterative Agent loop. |
| DevFlow Agent Runtime | A bounded observe, decide, act, checkpoint, evaluation, and stop loop. | The task must explore, react to Tool/MCP results, revise a plan, or choose an approved executor. | Planned for V2.0 and owned by DevFlow. It is neither the Workflow nor a Coding Executor. |
| Coding Executor | Scoped repository reads and changes, commands, tests, and structured diff/test/terminal results. | Approved work must inspect or modify code. | OpenCode is the current external executor. A later DevFlow-owned Coding Agent implements the same executor contract. |

The deterministic Workflow remains the outer authority. It establishes scope, policy, budget, and
human approval before work starts, then persists accepted Evidence and controls stage transitions.

The Agent Runtime may select only capabilities already allowed for that Run. Neither the Runtime nor
a Coding Executor may publish, merge, widen scope, or bypass a human Gate by itself.

### Routing Rules

1. Use a Single-Call LLM Operation when the bounded input already contains enough information and
   no autonomous exploration or Tool iteration is required.
2. Use the DevFlow Agent Runtime when the next step depends on observations, retrieval, Tool/MCP
   results, checkpointed state, or iterative evaluation.
3. Use a Coding Executor when approved work must inspect or modify a repository, run commands, or
   produce test and diff Evidence.
4. Return executor events and results to the Agent Runtime for evaluation and to the deterministic
   Workflow for Evidence, policy re-checks, and human Gate decisions.

In 1.x, the governed coding path invokes the existing `CodingEngineAdapter` directly. In 2.x, the
Agent Runtime may select an executor only from the capability- and policy-approved set for the
current Run.

### Executor Adoption

- First, V2.0 adds the DevFlow Agent Runtime while retaining OpenCode as the first external Coding
  Executor. DevFlow owns orchestration, Context, Tool/MCP policy, checkpoints, evaluation, and routing.
- Next, V2.0 adds a deliberately narrow DevFlow-owned Coding Agent behind the same executor contract.
  It proves a native code loop without claiming immediate feature parity with OpenCode.
- Later, additional CLI adapters may be evaluated behind that contract. Codex CLI and Kimi Code are
  implementation candidates, not committed integrations.
- Executor selection must be capability-based, policy-bound, observable, cancellable, and measured
  against the same quality, latency, cost, intervention, and recovery scenarios.

OpenCode remains an external Agent Runtime. DevFlow evaluates only adapter-exposed events, diffs,
Test Evidence, and terminal results; it does not claim OpenCode's private internal trajectory.

Delegating from one DevFlow Agent to OpenCode does not by itself satisfy the V2.2 Multi-Agent claim.
That claim requires DevFlow-owned coordination, handoff, termination, and comparative evaluation.

Before native Coding Agent implementation, approve an ADR that explicitly evolves ADR 0009 and the
current `CONTEXT.md` external-only Coding Agent definitions. The Roadmap does not silently supersede
accepted architecture decisions.

## 2.x Planned Milestones

The following milestones define outcomes, not pre-approved implementation designs. Each milestone
requires a scoped PRD and the necessary ADRs before product code begins.

### v2.0: Native Agent Runtime Foundation

- Add a bounded first-party Agent loop with explicit success, failure, cancellation, timeout,
  budget, and step-limit stop reasons.
- Persist checkpoint, resume, and an auditable trajectory without exposing hidden reasoning.
- Evolve the current `CodingEngineAdapter` interface into one Coding Executor contract for
  capabilities, scoped requests, permission and Tool events, cancellation, test/diff Evidence, and
  terminal results.
- Retain OpenCode as the first external Coding Executor behind the current adapter seam.
- Add one deliberately narrow DevFlow-owned Coding Agent to prove native repository Tool use,
  test feedback, repair, and deterministic stopping without claiming OpenCode feature parity.
- Approve the ADR that evolves ADR 0009 and `CONTEXT.md` before implementing the native Coding Agent.
- Add a native Tool registry/executor and bounded MCP discovery, schema validation, lifecycle,
  permission, deadline, cancellation, and audit behavior for explicitly accepted scenarios.
- Define and enforce the execution scopes required by those scenarios without weakening existing
  organization, project, credential, or Desktop authority boundaries.
- Establish a reproducible scenario dataset and single-Agent quality/cost/latency baseline.
- Keep Workflow and human Gate authority outside the non-deterministic Agent loop.

V2.0 exits when one DevFlow-owned Agent completes benchmarked work through native Tool/MCP
execution, resumes from a checkpoint, stops deterministically, and produces an auditable trajectory.

The same Runtime must complete governed coding scenarios through both OpenCode and the narrow
DevFlow-owned Coding Agent, with comparable structured events, cancellation, Evidence, and Gate
behavior.

### v2.1: Evaluated Retrieval And Memory

- Extend the existing lexical baseline with vector retrieval, hybrid ranking, reranking, citations,
  and retrieval evaluation.
- Add short-term and long-term Agent Memory with tenant, user, project, and session scope.
- Define authority, conflict, version, retention, expiry, promotion, deletion, and audit semantics.
- Keep Workflow State, repository Knowledge, and Agent Memory as distinct product concepts.
- Track retrieval quality and citation faithfulness with a versioned evaluation corpus rather than
  treating a vector database as completion.

V2.1 exits when retrieval and Memory improve defined benchmark outcomes over the lexical/no-Memory
baseline without citation, privacy, or cross-tenant isolation regressions.

### v2.2: Multi-Agent And Execution Tenancy

- Add one bounded supervisor and a small number of specialist Agents; do not create an open-ended
  Agent swarm.
- Use a dependency-aware task graph, scoped Context, evidence-based handoff, join, cycle detection,
  termination, cancellation propagation, and shared budget.
- Add capability-scoped delegation, bounded resource controls, execution isolation, and
  cross-tenant negative-path tests; the PRD and ADRs choose the concrete mechanism.
- Attribute failures and compare selected Multi-Agent scenarios against the V2.0 single-Agent
  baseline for quality, cost, latency, and human intervention.

V2.2 exits only when Multi-Agent execution measurably beats the single-Agent baseline on selected
tasks without violating cost, termination, evidence, or tenant-isolation constraints.

## 2.x Completion Gate

The 2.x line is complete when documented, repeatable scenarios cover a bounded native Agent loop,
accepted native MCP execution, evaluated RAG and Memory, and justified Multi-Agent coordination.

Those scenarios must also prove execution tenancy, failure recovery, and auditable trajectories
inside the existing Workflow/Gate authority model.

Native and delegated Coding Executors must use the same governed contract rather than creating
separate delivery authorities.

After V2.2, the default is real pilot use, interview/demo documentation, security and dependency
maintenance, and evidence-driven fixes.

There is no automatic V2.3. Any public SaaS or substantially different product direction requires a
separately approved future major-version charter.

## Evidence-Promoted Maintenance Backlog

These items receive a version only when pilot evidence, a release risk, or a security requirement
promotes them. They no longer reserve automatic V1.6/V1.7 milestones:

- Backup/restore and rollback guidance beyond the verified V1.4 lifecycle.
- Credential-revocation administration beyond the minimum verified 1.x operator path, plus member
  administration and audit-review UX.
- Additional authentication and pairing negative-path smoke coverage.
- Two-to-three Desktop conflict visibility and collaboration recovery.
- Windows real-OpenCode managed-worktree validation.
- Signed/notarized installers, auto-update, and broader public distribution.

## Explicitly Deferred

- Public SaaS, billing, enterprise SSO, hosted shared-infrastructure multi-tenancy, and managed
  provider credentials.
- Automatic cloud deployment and large-organization administration or 10+ client concurrency.
- HoneyAI adapter or execution-engine bridge.
- Repository file watcher, in-app Markdown editor, and implicit remote Knowledge synchronization.
- Replacing GitHub, CI, issue trackers, or human delivery accountability.

## Knowledge Evolution

Knowledge is a cross-version capability rather than a parallel roadmap:

- v0.4 introduced Git/Markdown governance, chunks, lexical retrieval, citations, and the rule that a
  retrieval hit is not Governance Evidence.
- v1.4 connected bounded real repository Markdown to local Gate, Review, and Coding context without
  implicitly uploading raw repository content.
- v2.1 will add evaluated hybrid retrieval and Agent Memory while preserving Knowledge provenance,
  authority, redaction, and deletion semantics.

Markdown in Git remains the reviewable source of truth for team standards and reusable Knowledge.
DevFlow indexes and cites it rather than silently replacing it.

Agents and human Gates may use retrieved Knowledge as context, but evidence and policy still decide
whether a standard is satisfied.

## Tracking Policy

- Do not create a parallel roadmap. Use this file for all version-line goals, current release truth,
  milestone sequencing, completion gates, and explicitly deferred product work.
- Use scoped PRDs for user-facing milestone outcomes and `docs/plans/` for implementation and
  verification. Neither receives roadmap priority until this file lists the work under Now, Next, or
  Later.
- Use ADRs for architectural decisions, `CONTEXT.md` for stable domain language, and
  `docs/research/` for investigations and comparison notes.
- Keep exactly one `Current Release` and one active `Now` priority.
- When a release publishes, update `Current Release`, `Completed Milestones`, and `Now` in the first
  post-release documentation change without moving or rewriting the release tag/evidence.
- When a planned milestone completes, move its durable summary into `Completed Milestones`; do not
  leave candidate language in the current-release section.
- A proposal, PRD, plan, ADR, or research note not promoted by this file does not change product
  sequence.
