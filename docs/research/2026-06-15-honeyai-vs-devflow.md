# HoneyAI vs AI DevFlow Studio

Date: 2026-06-15

## Snapshot

Both apps are aimed at team-level AI software delivery, but they currently sit at different layers.

- HoneyAI is strongest as a self-hosted DevPipeline execution engine: requirement IR, design IR,
  implementation, Gates, GitHub PR, costs, SSE, database, worker, sandbox, and adapters.
- AI DevFlow Studio is strongest as the team-facing workbench: Electron local execution, workflow
  canvas, manager overview, knowledge graph, Skill/MCP management, tests, token visibility, and theme
  polished interaction.

## Current Runtime Observation

HoneyAI was started at `http://127.0.0.1:3000` and AI DevFlow Studio was already running at
`http://127.0.0.1:5173`.

Observed HoneyAI pages:

- `/t/alice/runs`: authenticated list page. It shows a minimal run list with one seeded run.
- `/t/alice/runs/<runId>`: authenticated run detail page. It shows title, description, and status.
- `/prototype/run-detail.html?runId=<runId>`: high-fidelity DevPipeline prototype. This is where the
  mature visual workflow, artifact rail, review gates, PR panel, cost table, and IR evolution chain
  are visible.

Observed DevFlow Studio page:

- `/`: fixture-backed desktop workbench with sidebar navigation, workflow canvas, selected-node
  inspector, artifacts, agent events, Gate action, test action, metrics, Skill/MCP/Knowledge/Test
  views, and light/dark/system theme control.

## Difference Matrix

| Dimension | HoneyAI | AI DevFlow Studio | Judgment |
| --- | --- | --- | --- |
| Product posture | AI DevPipeline that turns one-line requirements into GitHub PRs | Team developer platform with desktop client and manager console | Complementary, not duplicates |
| Primary user | 5-10 person dev team, especially Tech Lead and intermediate engineer | Individual developer day-to-day plus lead/manager overview | DevFlow broadens the audience |
| Current real UI | Minimal Next pages for run list and run detail | Rich workbench UI already implemented | DevFlow is ahead on visible product surface |
| Prototype UI | Strong static prototype for run detail and setup | Implemented UI rather than static prototype | HoneyAI prototype should be mined for interaction patterns |
| Workflow model | 3 stages: requirement, design, code+UT; Gate between risky stages | 6 stages: clarify, design, build, test, PR, acceptance | DevFlow better matches full team lifecycle |
| Execution model | Worker + orchestrator + sandbox + LLM runtime adapters | Electron local execution agent planned; API/worker placeholders | HoneyAI is ahead as execution backend |
| Data model | Postgres + Drizzle schema, artifacts, events, gates, tenants, cost events | Shared TypeScript contracts and fixtures; Postgres/SQLite boundary documented | HoneyAI has stronger persistence foundation |
| Agent observability | SSE, events, IR chain, cost events designed and partially wired | Agent event cards and inspector visible in UI | HoneyAI has backend path; DevFlow has better operator surface |
| Knowledge | Assets: skill/rule/command/script/hook/hint/template/context | Git Markdown KB plus lightweight Knowledge Graph | DevFlow has clearer knowledge product framing |
| Skill/MCP | HoneyAI Assets include skills; MCP not central in current spec | Skill and MCP are first-class views | DevFlow better fits Codex/team tooling management |
| Testing | Code+UT is part of Stage 3; prototype mentions SIT as V2 | Test evidence is a first-class stage and view | DevFlow is stronger for QA workflow |
| Manager view | Tenant/run/cost concepts exist; no strong current management dashboard | Team Overview is already in product shell | DevFlow is stronger for team enablement |
| Deployment | Self-hosted Next.js on k3s/ECS with Postgres/Redis/MinIO | Desktop client plus web/API/worker platform | Different operational envelope |

## Recommended Convergence

Do not merge the two projects immediately.

Recommended split:

- HoneyAI becomes the execution engine and domain source of truth.
- AI DevFlow Studio becomes the team experience layer and desktop client.
- The bridge should be an adapter that maps HoneyAI `Run`, `Node`, `Gate`, `Artifact`, `Event`, and
  cost data into DevFlow Studio's workflow canvas and team dashboard.

This keeps HoneyAI's backend-heavy investment useful while avoiding a rewrite of the richer desktop
workbench.

## What To Reuse From HoneyAI

- Run/Node/Gate state machine semantics.
- IR document model: RequirementIR, DesignIR, ImplementationIR.
- Artifact and artifact blob model.
- Cost event model and stage-level cost accounting.
- SSE event shape and run stream endpoint.
- GitHub PR creation and tenant isolation concepts.
- Prototype run detail sections: execution rail, artifacts rail, review gates, PR banner, cost table,
  tool trace, and IR evolution chain.

## What To Keep From DevFlow Studio

- Electron developer client direction.
- Six-stage workflow vocabulary: clarify, design, build, test, PR, acceptance.
- Workflow canvas and selected-node inspector.
- Team Overview for lead/manager perspective.
- Knowledge Graph and Git Markdown knowledge source.
- Skill/MCP management as first-class concepts.
- Light/dark/system theme and polished operator UI.
- Unit and Playwright functional test harness.

## Main Tension

The word `Skill` is overloaded.

- In HoneyAI, Skills are one kind of broader Asset.
- In DevFlow Studio, Skill means a reusable team process capability.
- MCP server definitions are separate tool connectors.

Recommended vocabulary:

- Asset: any reusable stored content from HoneyAI.
- Skill: a process capability that can affect an agent workflow.
- MCP Server: a callable tool connector with permissions and audit policy.
- Knowledge Base: Git/Markdown source of truth for standards, glossary, examples, and decisions.

## Next MVP Bridge

The next practical integration should be small:

1. Add a HoneyAI adapter package in DevFlow Studio.
2. Read HoneyAI demo API or database data into DevFlow's shared `WorkflowRun` shape.
3. Render a real HoneyAI run in the DevFlow canvas.
4. Keep Gate/test buttons disabled until real HoneyAI actions are wired.
5. Add snapshot and Playwright tests around the adapter-fed run.

That proves the two systems can compose without committing to a full migration.
