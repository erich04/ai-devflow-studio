# AI DevFlow Studio

**A self-hosted AI development workbench that connects local coding with team review and delivery.**

Take a request through clarification, design, implementation, tests, a Draft pull request, and business acceptance. Developers work in Electron; reviewers use the Web console to inspect evidence, policy, and cost before approving the next step.

[Quick start](#quick-start) · [Workflow](#from-request-to-acceptance) · [Architecture](#architecture) · [Documentation](#documentation) · [项目简介（中文）](docs/product/project-introduction.zh-CN.md)

![Full Electron workbench with four completed stages, three passing test suites, usage totals and a populated project conversation](docs/guides/screenshots/readme-20260924/desktop-workbench.png)

_Full-window capture of the current Electron UI, September 24, 2026. The populated Payments API example includes four Runs, stage progress, artifacts, three test results, usage estimates, and saved conversations. Workflow history, reviews, usage, and conversation text are illustrative fixtures; the 14 sample-project tests were actually executed. Click any image to inspect it at full resolution. [Capture details](docs/guides/screenshots/readme-20260924/README.md)._

> **Current release and roadmap status:** the latest published release is [`v2.3.0`](https://github.com/erich04/ai-devflow-studio/releases/tag/v2.3.0), published September 14, 2026. This README describes the current `main` source, including subsequent workbench, Memory, model-governance, and multi-organization changes. Build from source to use those changes; the published installer does not acquire them automatically. See the [V2.3 release notes](docs/releases/v2.3.0/notes.md) and [Roadmap](docs/roadmap.md). Candidate verification and formal signoff are recorded separately from published packages.

## From Request to Acceptance

One **Run** connects the original request, artifacts, code changes, tests, review decisions, and delivery records. Its default workflow has six stages and eight nodes, including two intermediate human Gates.

| Stage | What happens | Result |
| --- | --- | --- |
| **Clarify** | Turn the request into requirements, acceptance criteria, and non-goals; review the requirement Gate. | Clarification artifact and human decision. |
| **Design** | Read project context, propose an implementation plan, and review the solution Gate. | Design artifact, references, and approval to build. |
| **Build** | Run Native Coding or OpenCode in a managed Git worktree with permission checks. | Reviewable changes, runtime trace, and recorded usage. |
| **Test** | Execute the project's saved test command and retain its actual result. | Test Evidence tied to the Run and node. |
| **PR** | Prepare the delivery package, obtain separate Web approval, and publish the approved commit. | A verified branch head and Draft pull request. |
| **Acceptance** | Review the delivery and its evidence against the requested outcome. | Explicit business acceptance. |

Browsing a stage does not advance the Run. The workbench distinguishes the stage you are viewing from the real current step, shows partial progress while a Gate is pending, and provides a return-to-current action. Compact, flow, and list views use the same workflow state.

<details>
<summary>See the full workflow board with populated stage cards and evidence</summary>

![Full Electron flow view showing completed clarification, design, implementation and testing, with PR delivery pending](docs/guides/screenshots/readme-20260924/desktop-workflow-overview.png)

_The same example in flow view: six stages, Task/Gate/Test/Delivery cards, artifact and trace counts, test results, and the independent conversation. Captured as a complete 2560 × 1600 application viewport._

</details>

<details>
<summary>Electron stage gallery: requirements → design → code changes → PR preparation</summary>

**1. Clarification — original request, acceptance criteria, and non-goals**

![Full Electron window with the request and expanded clarification artifact beside the project conversation](docs/guides/screenshots/readme-20260924/desktop-clarification.png)

_Browse a completed clarification node while the Run remains at PR preparation. The reader expands the goal, acceptance criteria, and scope boundaries._

**2. Design — module responsibilities, tradeoffs, and review questions**

![Full Electron window with the payment-idempotency design, component responsibilities and a design-review conversation](docs/guides/screenshots/readme-20260924/desktop-design.png)

_The idempotency example connects the proposed modules, database consistency boundary, test plan, and release-order concern. Its design Gate is still pending._

**3. Implementation — changed files and the sample repository's actual Git diff**

![Full Electron window with the changed-file summary and expanded Git diff alongside test and delivery progress](docs/guides/screenshots/readme-20260924/desktop-implementation.png)

_The artifact contains a real diff from the isolated sample repository, including the implementation and test files. Workflow history and the conversation remain demonstration fixtures._

**5. PR preparation — scope, test evidence, and remaining delivery checks**

![Full Electron window with an expanded PR preparation artifact containing changed files, passing sample tests and an unfinished delivery checklist](docs/guides/screenshots/readme-20260924/desktop-pr-preparation.png)

_An authored PR-material preview illustrates the delivery reader. It explicitly records the missing timeout work and pending Team approval; this is not a published PR or completed acceptance._

</details>

## Agents and Conversations

| Capability | Current implementation |
| --- | --- |
| **Clarification and design** | Direct Provider or read-only OpenCode analysis produces formal stage artifacts. Model selection can be set for the current node. |
| **Independent conversations** | Direct Provider or OpenCode can investigate Runs, nodes, artifacts, repository files, and configured knowledge. Each conversation retains its own history, draft, questions, and execution method. |
| **Coding** | A shared Coding Executor contract supports OpenCode and the bounded Native Coding executor. Native v2 supports repository discovery, multi-file Change Sets, explicit approval, managed-worktree edits, saved tests, and bounded repair. |
| **Gate Review** | Knowledge-grounded findings, missing evidence, suggested tests, and policy advice help a person decide whether to approve. The model does not approve the Gate. |
| **Bounded coordination** | The advanced Supervisor/Specialist runtime uses predefined task dependency graphs, shared budgets, scoped capabilities, and single-writer workspace leases. See the [V2.2 contract and evaluation scope](docs/product/prd/v2.2-multi-agent-execution-tenancy-prd.md). |

Conversations stay beside node details while you browse the workflow. Create a conversation with its execution method, reopen it from history, or open its Tab menu for details and model-call records. A discussion can be saved as a **pending node proposal**; it does not directly change code, approve a Gate, or publish a PR.

## Knowledge, Memory, and Evidence

- **Repository knowledge:** Git-managed Markdown remains the reviewable source for standards, decisions, checklists, and project context. Retrieval attaches citations; the knowledge relationship view connects documents, terms, and workflow evidence.
- **Agent Memory:** accepted Runtime results can become stored candidates. The current product requires explicit human promotion before a candidate becomes durable Memory. Coding automatically recalls eligible saved Memory with scope, revision, expiry, and deletion checks. Automatic learning after every Coding Run is not implemented.
- **Bounded context:** Native Coding and OpenCode receive a shared Coding Brief. Existing summaries and explicit constraints compact older context while preserving the current request and selected Memory. This is bounded, extractive compaction rather than an unlimited conversation memory.
- **Actual evidence:** Coding completion records checks against current artifacts, diffs, and executed tests. Missing or stale evidence cannot be substituted with a successful evaluation fixture. Memory and model advice do not satisfy a Gate or authorize an action.

Read the [Memory and Context validation](docs/engineering/memory-context-execution-validation.md), [memory lifecycle ADR](docs/adr/0018-scoped-agent-memory-lifecycle.md), and [coding-context ADR](docs/adr/0021-coding-memory-context-and-evidence-evaluation.md) for implementation limits and recorded experiments.

![Full Electron window with a pending design Gate, readiness checks, policy details and a populated design-review conversation](docs/guides/screenshots/readme-20260924/desktop-gate-review.png)

_A second populated Run demonstrates a pending design Gate, its readiness checks and policy details, beside a saved discussion of concurrency, release ordering, and compatibility. The design, review, and conversation are explicitly seeded demonstration records; the Gate remains unapproved._

## Team Collaboration and Delivery

The current Web shell contains the workbench, team overview, project setup, budget, and policy screens. The historical `/legacy-shell` URL redirects into this shell.

- **Projects and requests:** create a Team Project, submit a Work Request, and explicitly claim it in a paired Desktop. Active project members can create their own expiring, one-time Desktop pairing code.
- **Organizations:** independent organizations, membership, invitations, switching, archive/restore, and scoped GitHub repository assignments are implemented behind `DEVFLOW_MULTI_ORGANIZATION_ENABLED=true`. Default onboarding remains single-team. See the [deployment guide](docs/guides/multi-organization-deployment.md).
- **Budgets and policy:** inspect usage, configure project policy and budgets, and review approval or remediation requests. Paid Coding and Gate Review runtimes fail closed before provider invocation when authoritative budget context is unavailable or out of scope; governed model calls also cover stage generation and workbench conversations.
- **Recoverable synchronization:** Durable redacted sync uses a persisted outbox with bounded retries and restart recovery. Desktop remains authoritative for the local Run and full execution records.
- **GitHub Delivery:** a Delivery Intent binds the exact commit, Run version, tests, repository binding, and delivery package. A separate signed Web approval precedes publication. A least-privilege GitHub App supports the exact branch push and API-verified Draft pull request. DevFlow never merges, force-pushes, deletes a remote branch, or publishes a tag.

![Full Web team overview with members, estimated project cost, multiple Runs at different stages and three passing test summaries](docs/guides/screenshots/readme-20260924/web-team-overview.png)

_Current Next.js team overview with populated members, project cost, Run statuses, and test evidence. The isolated demo API receives redacted sample summaries through its normal endpoints. Full-window captures and their source commit are recorded with the [screenshots](docs/guides/screenshots/readme-20260924/README.md)._

<details>
<summary>Web control console gallery: work requests → evidence and review → budgets → team policy</summary>

**1. Work requests — submit requirements and inspect the intake queue**

![Full Web console with three saved work requests, a populated new-request draft and project/Run selection](docs/guides/screenshots/readme-20260924/web-work-requests.png)

_Three sample requests are saved in the isolated Team API; the filled form is an unsent fourth draft. Desktop explicitly claims requests before creating local Runs._

**2. Evidence and human review — inspect progress before approving the next stage**

![Full Web viewport showing delivery metrics, all eight workflow nodes, 38 percent progress and a pending design Gate with a draft review comment](docs/guides/screenshots/readme-20260924/web-evidence-review.png)

_The console is scrolled to Evidence Chain, with all eight nodes and the pending human decision visible. Complete Run graphs are seeded for this demonstration; the review comment has not been submitted._

**3. Budget governance — limits, recorded spend, and scoped approvals**

![Full Web settings screen with a saved project budget, two demo budget approvals and a populated approval draft](docs/guides/screenshots/readme-20260924/web-budget-governance.png)

_A $200 monthly demo limit, $150 warning threshold, and two sample approvals illustrate the controls. The displayed spend is illustrative; no paid model was invoked._

**4. Team policy — rule actions, minimum requirements, and repair guidance**

![Full Web Team Policy screen with a saved Recommended preset, rule actions, minimum requirements and project-effective policy](docs/guides/screenshots/readme-20260924/web-team-policy.png)

_The demo Owner saves the built-in Recommended preset as policy v2 through the actual Web editor. The page distinguishes the saved Team policy from the Desktop's last synchronized snapshot._

</details>

## Architecture

DevFlow is a TypeScript/pnpm monorepo built around **local execution, team governance, and shared domain rules**. Electron owns the canonical development Run and repository operations. The Team API owns collaboration authority and shared records. Both use `@ai-devflow/shared` to validate workflow transitions, evidence, policy, and versioned contracts.

### System and process boundaries

```mermaid
flowchart TB
    subgraph Local["Developer machine"]
        UI["Electron renderer<br/>React + Vite workbench"]
        Main["Electron main<br/>Workflow + execution + sync"]
        SQLite[("SQLite / LocalStore<br/>local state and evidence")]
        Git["Repository + Git worktrees<br/>code, Markdown, diffs, tests"]
        UI -- "typed preload / IPC" --> Main
        Main <--> SQLite
        Main <--> Git
    end
    subgraph Team["Team services"]
        Web["Next.js Web console<br/>requests, reviews, policy, budgets"]
        API["Node.js Team API<br/>auth, collaboration, delivery"]
        Postgres[("PostgreSQL<br/>team records and summaries")]
        Web -- "signed session / HTTP" --> API
        API <--> Postgres
    end
    Models["Configured model providers"]
    GitHub["GitHub<br/>approved branch + Draft pull request"]
    Main <-- "scoped HTTP<br/>sync, claims, polled commands" --> API
    Main -- "selected task context" --> Models
    API -- "server-side Gate Review" --> Models
    Main -- "approved exact-commit push" --> GitHub
    API -- "verify remote head / create Draft PR" --> GitHub
```

Arrows show runtime communication or local access. The API-to-Desktop direction represents responses and polled commands, not a server-initiated remote shell. Desktop, Web, API, and Worker import `@ai-devflow/shared`; it is a library, not a deployed service.

| Layer | Responsibility | Code |
| --- | --- | --- |
| **Desktop renderer** | Stage navigation, node reader, independent conversations, knowledge, and execution controls. Repository actions cross the typed preload bridge. | [`App.tsx`](apps/desktop/src/App.tsx), [`preload.ts`](apps/desktop/electron/preload.ts), [`ipc-contract.ts`](apps/desktop/electron/ipc-contract.ts) |
| **Electron main** | Assemble services; validate IPC; own credentials, local commands, worktrees, SQLite, execution recovery, and synchronization. | [`main.ts`](apps/desktop/electron/main.ts), [`LocalStore`](apps/desktop/electron/local-store.ts) |
| **Web** | Next.js pages, server actions, and API proxies for team intake, review, settings, organization management, and delivery approval. | [`apps/web/app`](apps/web/app), [`API client`](apps/web/app/lib/devflow-api.ts) |
| **Team API** | Node HTTP request handling, signed browser/paired Desktop authentication, live membership checks, business routes, repositories, and GitHub integration. | [`server.ts`](apps/api/src/server.ts), [`server-request.ts`](apps/api/src/server-request.ts), [`repositories`](apps/api/src/repositories) |
| **Shared domain core** | Workflow/Agent contracts, deterministic transitions, policy evaluation, retrieval, Memory, coordination, redaction, and cost rules. | [`packages/shared/src`](packages/shared/src) |
| **Worker** | Standalone project/member cost-rollup entry point. It currently has no background job queue and is not part of the Docker Compose stack. | [`apps/worker/src/index.ts`](apps/worker/src/index.ts) |

### Execution model

**Deterministic Workflow owns progress; AI execution produces candidate results and evidence.** The [Desktop Workflow runtime](apps/desktop/electron/workflow-runtime.ts) loads the current Run and its evidence, calls [`applyWorkflowCommand`](packages/shared/src/workflow-transition.ts), and commits accepted changes through an optimistic LocalStore transaction. That transaction also queues the corresponding remote summary. A model response, conversation reply, or runtime `success` is not itself a Gate approval.

| Subsystem | How it fits into the architecture | Implementation entry |
| --- | --- | --- |
| **Stage generation and conversations** | Clarification/design produce formal artifacts; project conversations investigate workflow, artifacts, repository files, and knowledge through bounded read tools. Direct Provider and read-only OpenCode are separate execution choices. | [`workflow-agent.ts`](packages/shared/src/workflow-agent.ts), [`workbench-conversation-service.ts`](apps/desktop/electron/workbench-conversation-service.ts) |
| **Coding orchestration** | `coding-runtime` prepares the managed worktree and Coding Brief, checks permissions/budget, invokes the selected executor, and archives the diff, tests, usage, and outcome. Native Coding and OpenCode share a Coding Executor contract. | [`coding-runtime.ts`](apps/desktop/electron/coding-runtime.ts), [`coding-executor.ts`](apps/desktop/electron/coding-executor.ts), [`native-coding-executor-v2.ts`](apps/desktop/electron/native-coding-executor-v2.ts) |
| **Bounded Runtime and coordination** | Iterative observe/act/evaluate/checkpoint execution has explicit limits and recovery. Supervisor/Specialist coordination adds predefined task dependencies, scoped authority, shared budgets, and workspace ownership. These are distinct from a single stage-generation or review call. | [`agent-runtime-runtime.ts`](apps/desktop/electron/agent-runtime-runtime.ts), [`specialist-runtime-coordinator.ts`](apps/desktop/electron/specialist-runtime-coordinator.ts) |
| **Knowledge and Memory** | Repository Markdown is indexed for retrieval and citations. Versioned, scoped Memory can contribute to the Coding context after explicit promotion. Private conversation history is stored separately. | [`repository-knowledge.ts`](apps/desktop/electron/repository-knowledge.ts), [`coding-context.ts`](apps/desktop/electron/coding-context.ts), [`agent-memory-human-actions.ts`](apps/desktop/electron/agent-memory-human-actions.ts) |
| **Tools and MCP** | Main-owned registries validate tool definitions and execution authority. Trusted local stdio MCP installations and the OpenCode conversation's temporary read-only MCP bridge have separate boundaries. | [`native-tool-registry.ts`](apps/desktop/electron/native-tool-registry.ts), [`local-mcp-client.ts`](apps/desktop/electron/local-mcp-client.ts), [`workbench-mcp-bridge.ts`](apps/desktop/electron/workbench-mcp-bridge.ts) |
| **Model-call governance** | Governed calls reserve budget before dispatch, record the attempt, and settle reported usage or uncertain outcomes. Pending accounting is reconciled before another charge; runtime and permission limits still apply independently. | [`governed-provider.ts`](packages/shared/src/governed-provider.ts), [`model-call-budget.ts`](apps/api/src/repositories/model-call-budget.ts) |

### State ownership and collaboration

| Data or decision | Authoritative owner | What crosses the boundary |
| --- | --- | --- |
| Canonical Run, complete node graph, artifacts, execution/checkpoint state, diffs, test output, private conversations, and Memory content | **Electron / local SQLite and files** | Allowlisted Run, test, review, Coding, Runtime, Memory, and coordination summaries; conversations are excluded. |
| Organizations, memberships, Team Projects, Work Requests, Gate Commands, policy, budgets, repository bindings, and delivery approvals | **Team API / PostgreSQL** | Project-scoped claims, commands, policy snapshots, budget decisions, and delivery grants to the paired Desktop. |
| Team Run projection and manager overview | **API read model derived from Desktop summaries** | A versioned, redacted, lossy view for Web. It is not a replica of the complete local Run or an independent workflow authority. |
| Published branch head and Draft PR | **GitHub**, with local/Team audit records | Desktop pushes the approved commit; API verifies GitHub's actual head and records the Draft PR result. |

Electron owns repository access, shell execution, full local evidence, and private conversation history. The Team service receives allowlisted summaries rather than raw repository content or local paths. Configured model services can receive the selected code and context required for their task. Managed Git worktrees isolate changes; they are not operating-system sandboxes. Browser previews cannot replace Electron's trusted execution boundary.

Local changes that require synchronization commit their sync intent alongside the state change in a **durable outbox**. The [outbox processor](apps/desktop/electron/remote-sync-outbox-processor.ts) reloads canonical records, constructs project-bound summaries, and handles bounded retries and restart recovery. Shared records are scoped by Organization and live project membership; a Desktop credential stays bound to its paired organization/project. Multi-organization onboarding is enabled separately by `DEVFLOW_MULTI_ORGANIZATION_ENABLED`.

The following path shows a **Team-originated request**. A local-only Run can start directly in Desktop; governed GitHub publication additionally requires the Team binding and approval.

```mermaid
sequenceDiagram
    participant Web as Web / reviewer
    participant API as Team API + PostgreSQL
    participant Desktop as Electron main
    participant Local as LocalStore + worktree
    participant GitHub as GitHub
    Web->>API: Create versioned Work Request
    Desktop->>API: Explicitly claim request with paired identity
    API-->>Desktop: Bind request to stable local Run ID
    Desktop->>Local: Create canonical Run atomically
    Note over Desktop,Local: Clarify/design artifacts and review evidence
    Desktop->>API: Upload redacted current summary
    Web->>API: Submit version-bound Gate Command
    Desktop->>API: Poll inbox and obtain receipt
    Desktop->>Local: Validate evidence and apply Workflow command
    Desktop->>API: Acknowledge and sync resulting summary
    Note over Desktop,Local: Approved coding, managed-worktree tests, delivery package
    Desktop->>API: Register exact-commit Delivery Request
    Web->>API: Separately approve that Delivery Request
    Desktop->>API: Obtain scoped, short-lived publication grant
    Desktop->>GitHub: Push only the approved commit and branch
    Desktop->>API: Request remote-head verification and Draft PR
    API->>GitHub: Verify expected head and create/reconcile Draft PR
    API-->>Desktop: Return verified delivery outcome
    Desktop->>Local: Record delivery and prepare business acceptance
    Note over Desktop,Local: Acceptance advances only after its own checks and human decision
```

Web approval queues intent; the owning Desktop re-evaluates it against local evidence before changing the Run. A receipt acknowledgement does not itself advance the Team projection. Browser GitHub OAuth establishes identity; a separately configured GitHub App supplies the narrow publication capability. See [Web/Desktop authority](docs/adr/0012-web-desktop-work-authority.md) and [GitHub delivery authority](docs/adr/0013-github-app-delivery-authority.md).

### Deployment and code reading map

The default [Docker Compose deployment](docker-compose.yml) starts PostgreSQL, a one-shot migration job, the API, and Web. Electron runs on each developer's machine. The standalone Worker is not required for this topology. API persistence uses Postgres; the in-memory seed repository is selected only by an explicit demo flag when no database is configured.

```text
apps/
  desktop/
    src/          React workbench, views, state and UI actions
    electron/     Main/preload, IPC, LocalStore, execution and sync
  web/app/        Next.js team console, server actions and API proxies
  api/src/
    auth/         Browser sessions, identity and Desktop authentication
    routes/       Team, organization, collaboration and delivery endpoints
    repositories/ Persistence contracts, Postgres and demo adapters
    db/           Database client and versioned SQL migrations
  worker/src/     Standalone cost aggregation
packages/shared/ Domain types, parsers, workflow/Agent rules and projections
docs/adr/         Architecture decisions and authority boundaries
scripts/          Integration smoke tests, evaluations and release checks
```

For a first code-reading pass, follow **[`domain.ts`](packages/shared/src/domain.ts) → [`workflow-transition.ts`](packages/shared/src/workflow-transition.ts) → [`workflow-runtime.ts`](apps/desktop/electron/workflow-runtime.ts) → [`main.ts`](apps/desktop/electron/main.ts) → [`server-request.ts`](apps/api/src/server-request.ts)**, then inspect the relevant renderer or Web view. For design rationale, start with [data ownership](docs/adr/0003-postgres-sqlite-data-boundary.md), [bounded Runtime](docs/adr/0014-bounded-agent-runtime.md), [Memory lifecycle](docs/adr/0018-scoped-agent-memory-lifecycle.md), [multi-agent coordination](docs/adr/0019-bounded-multi-agent-coordination.md), and [organization isolation](docs/adr/0023-independent-organizations.md).

## Quick Start

Use **Node.js 24**, **Corepack**, and the repository-pinned **pnpm 9.15.0**. Git is required for managed worktrees. The source workflow is exercised on macOS; see the [Windows guide](docs/guides/windows-zip-smoke.md) for its validation scope.

```bash
git clone https://github.com/erich04/ai-devflow-studio.git
cd ai-devflow-studio
corepack pnpm install --frozen-lockfile
```

### Try the Desktop with deterministic demo runtimes

```bash
DEVFLOW_ENABLE_DEMO_DATA=true \
DEV_AUTH_ENABLED=true \
DEVFLOW_ENABLE_FAKE_RUNTIME=true \
DEVFLOW_CODING_ENGINE=fake \
corepack pnpm dev:electron
```

These development flags make the deterministic Workflow/Review provider and fake Coding engine available. Choose **Deterministic Fake Provider** in **Agents** for this walkthrough; it does not call a paid model. Select a repository and create a Run to populate the Desktop. Keep demo authentication disabled on a network-exposed deployment.

1. Select a small committed Git repository and save its detected test command.
2. Create a Run with a concrete request and acceptance criteria.
3. Generate clarification and design, inspect their materials, and review the human Gates.
4. Run Coding from the Build node, inspect permissions and the worktree diff, then execute tests.
5. Review artifacts, tests, trace, and usage. Real GitHub publication additionally requires the Team setup, repository binding, and separate delivery approval.

For normal use, omit the demo flags, configure the desired provider/executor in **Agents**, and set up the paired Team project and budget before paid model calls. Credentials and the execution method are configured explicitly; installing DevFlow does not configure a model provider.

`corepack pnpm dev:desktop` serves only the browser renderer preview. Use `corepack pnpm dev:electron` for folder selection, local commands, workflow writes, and Coding execution.

### Start a local Team without GitHub login

Create a dedicated local PostgreSQL database, then use the same loopback hostname for API and Web:

```bash
export DEVFLOW_DATABASE_URL='postgres://postgres:devflow@127.0.0.1:5432/devflow_local'
export DEVFLOW_ENABLE_DEMO_DATA=false
export DEVFLOW_LOCAL_AUTH_ENABLED=true
export DEVFLOW_REQUIRE_AUTH=true
export DEVFLOW_WEB_APP_URL='http://127.0.0.1:4311'
export HOST='127.0.0.1'

corepack pnpm --filter @ai-devflow/api db:setup
corepack pnpm --parallel --filter @ai-devflow/api --filter @ai-devflow/web dev
```

Open `http://127.0.0.1:4311` and choose **使用本地开发身份**. Use the current Web shell to create a Team Project, configure its budget under **设置**, and generate a Desktop pairing code. In another terminal, run `corepack pnpm dev:electron`, select the local repository, and enter the code to bind it. Local development identity requires real Postgres and does not enable Demo Seed or replace production authentication.

For Docker, GitHub OAuth, deployment secrets, backup/restore, and release packages, follow the [self-hosted pilot guide](docs/guides/devflow-studio-self-hosted-pilot.md). For multiple organizations, also follow the [organization deployment guide](docs/guides/multi-organization-deployment.md).

## Verification

```bash
corepack pnpm verify
```

This runs TypeScript checks, the unit/component suite, and cross-platform static checks. Other verification paths are available for the relevant environment:

| Command | Scope |
| --- | --- |
| `corepack pnpm test:e2e` | Browser workbench and Web interactions with isolated demo services. |
| `corepack pnpm test:electron-smoke` | Real Electron main/preload, local SQLite, and workflow operations. |
| `corepack pnpm test:native-coding-electron-smoke` | Native Coding approval, worktree edits, tests, and evidence against a controlled local model server. |
| `corepack pnpm test:postgres-smoke` | Postgres migrations, persistence, policy, approval, and redacted sync. |
| `corepack pnpm test:organization-postgres` | Organization membership, isolation, pairing, and repository assignments in a dedicated test database. |
| `corepack pnpm test:docker-smoke` / `corepack pnpm test:docker-lifecycle-smoke` | Container startup, migration, retained data, and recovery. |
| `corepack pnpm test:v15-github-delivery` | Offline governed branch publication and Draft PR delivery. |
| `corepack pnpm build:desktop-pilot` + `corepack pnpm test:v15-github-delivery-packaged-smoke` | Packaged Desktop delivery against isolated Postgres and a local GitHub substitute. |
| `corepack pnpm test:v21-retrieval-memory-evaluator` / `corepack pnpm v21:completion-status` | Frozen retrieval/Memory evaluation and candidate-bound milestone evidence. |
| `corepack pnpm test:v22-multi-agent-evaluator` / `corepack pnpm v22:completion-status` | Bounded coordination evaluation and candidate-bound milestone evidence. |
| `corepack pnpm audit:production` | Check production dependencies against the current registry advisories. |

Commands are entry points, not a claim that every environment or release gate has passed on every commit. Live-provider experiments are explicit opt-in runs and may spend quota. See the [testing strategy](docs/engineering/testing-strategy.md), [demo and smoke guide](docs/engineering/demo-and-smoke.md), and [release evidence](docs/releases/).

## Current Boundaries

- This is a self-hosted team workbench; operating a managed public SaaS remains outside its current release scope.
- Local execution belongs to Electron. Web approval is not remote shell access, and conversations do not bypass workflow authority.
- Memory is versioned and scoped, but new durable entries still require explicit promotion. Conversation history is separate from Agent Memory.
- The evaluated hybrid retrieval path and trusted local stdio MCP execution exist; external vector-provider integration and remote MCP transports remain deferred.
- Bounded coordination is not open-ended autonomous delegation. Stage/specialist Memory routing has not been expanded by the Coding Memory integration.
- Draft PR delivery and business acceptance do not implement automatic merge, production deployment, or production maintenance.
- macOS has real-window validation and unsigned pilot packaging. Windows has CI/source compatibility coverage; signed installers and full platform release signoff are separate work.

## Documentation

| Need | Start here |
| --- | --- |
| Chinese project introduction | [项目简介（中文）](docs/product/project-introduction.zh-CN.md) |
| Product vocabulary and historical design | [Product Definition](docs/product/product-definition.md), [Context Glossary](CONTEXT.md), [ADRs](docs/adr/) |
| Current workbench behavior | [Stage navigation and conversation pane](docs/validation/workflow-navigation-20260924.md), [conversation architecture](docs/engineering/workbench-conversations.md) |
| Memory, context, and actual evidence checks | [Implementation validation](docs/engineering/memory-context-execution-validation.md) |
| Organizations and tenancy | [Deployment](docs/guides/multi-organization-deployment.md), [ADR 0023](docs/adr/0023-independent-organizations.md), [validation](docs/validation/multi-organization-20260921.md) |
| Desktop pairing | [Pairing authority and diagnostics](docs/engineering/desktop-pairing-security.md) |
| Self-hosted team setup | [Self-Hosted Pilot](docs/guides/devflow-studio-self-hosted-pilot.md) |
| Governed GitHub Delivery | [V1.5 walkthrough](docs/guides/devflow-studio-v1.5-walkthrough.md) |
| Milestone contracts and plans | [PRD index](docs/product/prd/README.md), [Roadmap](docs/roadmap.md) |
| Historical feature tours | [Full feature walkthrough](docs/guides/devflow-studio-full-feature-walkthrough.md) (V1.3), [V2.2 walkthrough](docs/guides/devflow-studio-v2.2-walkthrough.md) |
| Screenshots in this README | [Source commit, capture method, and demo-data scope](docs/guides/screenshots/readme-20260924/README.md) |
