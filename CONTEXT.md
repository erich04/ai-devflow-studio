# Context

## Run

A single AI-assisted delivery attempt that starts from a task request and moves through clarification,
design, build, test, pull request, and acceptance.

## Delivery Workflow

The six-stage flow for a Run: requirement clarification, solution design, implementation,
test evidence, governed pull-request delivery, and business acceptance.

## Node

An execution or review unit inside a Run. Nodes can represent agent work, human gates, tests, pull
request creation, or acceptance steps.

## Gate

A human decision point that checks whether the current stage has enough evidence to move into the
next risky stage.

## Clarification Gate

The Gate that reviews whether requirement clarification is complete enough to proceed into solution
design.

## Solution Review Gate

The Gate that reviews whether the solution design is complete enough to proceed into implementation.

## Artifact

A durable piece of evidence produced by a Run or Node, such as a requirement note, design document,
code diff, test report, log, or pull request summary.

## Requirement Decomposition Artifact

A reviewable artifact produced when a user story or requirement is decomposed into domain language,
technical references, assumptions, and follow-up work. It must pass a Gate before it can be treated
as reusable team knowledge.

## PR Delivery Package

A metadata-only handoff artifact that summarizes the original request, solution design, changed
paths, Test Evidence, policy state, and review context. GitHub Delivery may use its title, body, and
evidence references, but the package is never the source of code, repository identity, branch
authority, or credentials.

## GitHub Repository Binding

The non-secret Team Project record that binds one Project to one verified GitHub App installation,
repository, default branch, and binding version. An owner configures or revokes it through Web. The
API resolves repository facts from GitHub rather than trusting renderer-supplied names.

## GitHub Delivery

The V1.5 governed path that publishes one expected commit from the canonical managed worktree to one
approved `devflow/` branch and creates or reconciles one Draft pull request. It requires a separate
signed Web approval and never merges, force-pushes, deletes a branch, publishes a tag, or makes
GitHub authoritative for the local Run.

## Delivery Series

The stable identity for delivery of one Run/PR target from one managed workspace under one
repository binding. A repository rebind creates a new series only after the prior remote request is
proven terminal to the current pairing claimant.

## Delivery Attempt

One immutable publication attempt within a Delivery Series. Retry is allowed only after the exact
remote predecessor is proven `failed` or `revoked`; it creates the next attempt and a new request and
idempotency key. A completed attempt never reopens.

## Delivery Intent

The immutable local Desktop record binding the managed workspace, expected commit, repository
binding, Run/node/version, Test Evidence, changed paths, and PR Delivery Package digests. A
pre-publication material change uses Revise to create a new intent revision in the same series and
attempt and invalidates the older approval.

## Delivery Request

The redacted API/Postgres projection of one Delivery Intent. It is scoped to the paired Project and
current claimant and carries the durable approval, publication, recovery, and Draft pull-request
state without local paths, raw output, patches, source content, or credentials.

## Delivery Approval

An immutable lead/owner decision made through a signed Web session against one exact Delivery
Request revision. Desktop Bearer authority cannot approve its own request, and changed material,
attempt, or binding requires a new approval.

## GitHub Delivery Recovery Action

One explicit operator action chosen from Revise, Resume, Retry, or Stop. Revise replaces changed
pre-publication material; Resume continues the same `recovery_required` attempt; Retry creates a new
attempt only after proven remote terminal authority; Stop parks the exact active attempt for manual
recovery. Background scheduling cannot silently perform these decisions.

## GitHub Delivery Completion

The redacted durable evidence that one expected commit is the verified remote branch head and one
matching pull request remains Draft. Only this evidence can advance the PR node toward Acceptance;
it never authorizes merge.

## Skill

A reusable team capability that defines a process method, prompt strategy, knowledge-reading rule, or
review checklist.

## MCP Server

A local or remote tool connector that an agent can call during a Run, subject to team policy and local
developer configuration.

## Knowledge Base

The team-maintained Git and Markdown source of reusable standards, templates, decisions, examples,
project context, and glossary.

## Knowledge Repository

A Git-managed knowledge repository that links one Team Knowledge Foundation to multiple code
repositories through standards, domain terms, relationships, and source references.
_Avoid_: code repository manager.

## Code Repository

A source code repository linked from a Knowledge Repository. It remains the implementation source,
while reusable understanding extracted from it becomes Repository-Derived Knowledge.

## Repository-Derived Knowledge

Reviewable system or business knowledge summarized from one or more linked Code Repositories and
stored in the Knowledge Repository for later retrieval, review, and Gate evidence.

## Candidate Knowledge

Repository-Derived Knowledge that has been extracted or summarized but has not yet passed review.
It can inform analysis, but it should not be treated as authoritative Gate evidence.

## Confirmed Knowledge

Repository-Derived Knowledge that has passed review and can be used as an authoritative reference
for requirement clarification, solution design, Knowledge Review, and Gate decisions.

## System Knowledge

Repository-Derived Knowledge that explains technical structure, system boundaries, services,
interfaces, data models, dependencies, or implementation constraints.

## Business Knowledge

Repository-Derived Knowledge that explains business terms, rules, user flows, domain assumptions, or
relationships between business concepts.

## Team Knowledge Foundation

The shared knowledge layer that grounds AI-assisted delivery with team standards, domain language,
retrievable references, and relationship context. In Chinese presentation material, use `团队知识底座`.
_Avoid_: realtime library, knowledge frequency.

## Knowledge Domain

A domain-oriented view inside the Team Knowledge Foundation, such as frontend, backend, or database
knowledge. Domains organize reusable knowledge without splitting it into isolated knowledge bases.

## Knowledge Source File

A Markdown file in the repository that remains the reviewable source of truth for a team standard,
checklist, ADR, contract, onboarding note, Skill rule, or MCP rule.

## Knowledge Document

The indexed representation of a Knowledge Source File, including title, category, summary, tags,
owner, source path, and Markdown content.

## Knowledge Chunk

A section-level slice of a Knowledge Document that can be retrieved and cited independently while
still pointing back to the original Markdown source.

## Knowledge Graph

A lightweight relationship layer extracted from the Knowledge Base and Run artifacts. It links terms,
systems, decisions, tasks, artifacts, and owners.

## Knowledge Retrieval

The process of finding relevant Knowledge Chunks for a Run, Node, Artifact, Test Evidence, or Gate
decision. Retrieval recommends references; it does not decide whether a standard is satisfied.

## Knowledge Retrieval Hit

A scored retrieval result that explains which Knowledge Chunk matched a workflow context and why.

## Knowledge Citation

The exact, inspectable link from an Agent answer or observation to one current Knowledge Chunk. It
binds document, chunk, source-relative path, heading, content hash, Knowledge snapshot, retrieval
strategy, and rank provenance. A citation is Context and does not become Governance Evidence by
itself.

## Retrieval Evaluation Corpus

A versioned, reviewable set of synthetic Knowledge, scoped queries, relevant and forbidden chunk
identities, citation expectations, Memory fixtures, and metric thresholds. It compares the lexical
baseline with a candidate retriever deterministically and records retrieval quality, citation
faithfulness, latency, and isolation without paid provider calls by default.

## Memory Candidate

An inert, bounded statement proposed from an accepted observable Agent result. It has exact scope
and provenance but cannot be retrieved as durable Memory until main-owned policy and actor authority
promote it.

## Durable Agent Memory

A promoted, immutable, scoped Memory revision that may be recalled across later Agent sessions. It
records visibility, provenance digest, retention, expiry, sensitivity, and audit metadata. Agent Memory is not Workflow State,
an Agent Checkpoint, repository Knowledge, hidden reasoning, or Governance Evidence.

## Memory Revision

One immutable version of Durable Agent Memory. An update requires the exact current revision and
creates a new revision linked by `supersedes`; conflicting revisions remain explicit instead of using
silent last-write-wins. For Memory visibility, scope is an intersection, never a fallback.

## Memory Tombstone

The monotonic deletion record for one Durable Agent Memory identity. It excludes every revision from
retrieval, drives purge of derived index entries, survives restart and stale sync replay, and cannot
be reversed into live Memory by an older record.

## Knowledge Reference

A relationship between a Run, Node, Artifact, Test Evidence, or Gate decision and a Knowledge
Document. References can cite, satisfy, require evidence for, or violate a standard.

## Knowledge Governance Check

A reviewer-facing summary of whether the currently selected workflow node has enough evidence for
the standards that apply to it. v0.4 displays these checks; later versions can enforce them.

## Agent Review Artifact

A durable review report produced by the Knowledge Review Agent. It summarizes risks, missing
evidence, suggested tests, referenced knowledge, model confidence, and the Gate Advisory produced
for a selected Run/Node.

## Knowledge Review Agent

The DevFlow-owned review agent that evaluates a requirement or workflow node against team knowledge,
evidence, and policy context. It reviews delivery readiness; it does not write code.

## Agent Trace

An auditable step record for an Agent Review, including context preparation, retrieval attachment,
provider call, and artifact creation. Traces explain how the review was produced without exposing
private local paths or raw command output.

## Agent Runtime

The bounded DevFlow-owned observe, decide, act, validate, evaluate, checkpoint, and stop loop used
when work depends on Tool, MCP, or Coding Executor observations. The deterministic Workflow remains authoritative
for Run state, policy, Evidence acceptance, and human Gates. An Agent Runtime cannot
advance a Node, approve a Gate, publish, merge, or widen its own capabilities.

## Agent Trajectory

The ordered, auditable record of externally observable Runtime events such as Context attachment,
observation, action request, permission decision, Tool or executor result, evaluation, checkpoint,
and terminal outcome. It uses bounded summaries and digests and does not claim or persist hidden
reasoning, private scratchpads, raw prompts, source, patches, stdout/stderr, credentials, or local
absolute paths in Team-visible state.

## Agent Checkpoint

A versioned, atomically persisted continuation boundary that binds one Agent Runtime to its exact
Run/Node version, Context and capability-set digests, Local Project, accepted results, sequence,
deadline, and consumed/remaining bounds. Resume revalidates authority and uses optimistic
concurrency; it cannot rewind or replay an accepted side effect as a new action.

## Agent Stop Reason

The explicit terminal reason for a bounded Agent Runtime: success, failure, cancelled, timeout,
step limit, budget exhausted, or policy denied. Agent success produces reviewable Evidence but is not
itself a Workflow transition or Gate decision.

## Coordination Session

The bounded Electron-main-owned container for one Supervisor Agent, its fixed Agent Task Graph, and
the small set of Specialist Agent Runtimes it may start. It binds one exact Run/Node authority,
execution-tenancy scope, Context digest, shared bounds, accepted handoffs, and terminal outcome. A
Coordination Session cannot advance Workflow State, approve a Gate, or publish.

## Supervisor Agent

The only Agent in a Coordination Session allowed to assign ready task nodes to accepted Specialist
Agents, join their bounded results, attribute failure, and stop the session. It can attenuate existing
authority but cannot create Tool, Workflow, Gate, credential, repository, or delivery authority.

## Specialist Agent

A bounded Agent Runtime selected for one exact task node and role. Its scope, capabilities, Context,
deadline, and budget are strict subsets of the Coordination Session. Specialist Agents cannot create
or delegate to another Agent and cannot write outside an explicitly leased resource.

## Agent Task Graph

A versioned directed acyclic graph of bounded task nodes and dependency edges fixed before specialist
side effects. A node becomes ready only after every dependency has an accepted terminal result.
Cycles, unknown dependencies, unbounded fan-out, duplicate ownership, and graph mutation by a model
fail closed.

## Agent Handoff

An immutable metadata-only transfer from one exact task/runtime version to another. It carries scope,
result, Evidence, Context, and resource digests plus an allowlisted summary; it contains no hidden
reasoning, source, patch, prompt, stdout/stderr, credential, or absolute path. The receiver rechecks
current scope and authority before accepting it.

## Execution Tenancy

The isolation contract binding every coordination, task, specialist, capability grant, resource
lease, checkpoint, handoff, and audit to the exact organization, project, user, session, Local
Project, Run/Node, and coordination identity that owns it. Its core rule is: scope, capabilities, and budget are intersections, never fallbacks.
A cross-tenant identifier reveals no data or execution authority.

## Tool Definition

A main-owned, versioned executable capability description with strict input/output schemas,
permission and side-effect class, deadline, cancellation, size limit, idempotency posture, and
audit/redaction rules. A model may select only a Tool already accepted for the current Runtime.

## Tool Capability Grant

An opaque, short-lived Electron-main authority for one bounded Tool or MCP capability. It binds the
Runtime, organization, project, user, session, Local Project, Tool identity/version, permission,
resource scope, expiry, remaining calls, and budget. Text, renderer input, and Team metadata cannot
forge or widen it.

## Local MCP Installation

The Desktop-local, Electron-main-owned record that authorizes one verified MCP executable with fixed
arguments, local stdio transport, environment-name allowlist, identity, deadlines, enabled state,
and version. Team MCP metadata is not local execution authority and cannot create, revise, enable,
or invoke this installation.

## Coding Executor

The governed boundary for scoped repository reads/changes, approved commands/tests, permission
events, cancellation, and structured diff/Test Evidence results. OpenCode is the first external
executor; V2.0 adds one narrow DevFlow-owned Coding Agent behind the same contract. An executor does
not own Workflow, Gate, or delivery authority.

## Coding Executor Capability

A versioned feature advertised before executor selection, such as managed-workspace read/edit,
approved test execution, permission relay, cancellation, checkpoint continuation, or structured
diff/test Evidence. Missing capability is a deterministic selection denial rather than a prompt to
behave outside the descriptor.

## Agent Evaluation Scenario

A versioned reproducible fixture that fixes starting Context, allowed capabilities, expected
trajectory, bounds, stop reason, Evidence, cleanup, and quality/cost/latency/intervention/recovery/
isolation measurements for comparing one Agent Runtime or Coding Executor path.

## Tool / Skill Trace

A Coding Agent runtime timeline that summarizes permission-backed tool activity, the Skill metadata
opencode exposes when available, DevFlow's permission relay decision, and redaction state. It explains
what DevFlow observed; it does not claim to reconstruct opencode's private internal Skill call stack.

## Team Pilot Foundation

The v1.0 product milestone where DevFlow moves from a local-first portfolio workstation to a
self-hosted team pilot. The minimum proof is GitHub login, project creation, Desktop pairing,
authenticated redacted sync, and Web visibility for a small team.

## Authenticated Session

A server-side API session resolved from a real user identity and project membership. It is distinct
from the explicit Demo Session used by seed data, tests, and local walkthroughs.

## User

The team-side identity record for a person in an organization. User data is the source for
membership-aware authorization and can be projected into legacy Team Member UI cards.

## Auth Account

The external login account linked to a DevFlow User, such as a GitHub account. It stores provider
identity metadata and must not be confused with local provider credentials used for model calls.

## Desktop Pairing

The one-time flow that connects an Electron Desktop client to a team project. Web issues a short-lived
pairing code, Desktop exchanges it for a scoped token, and subsequent sync uses that token instead of
demo headers.

## Self-Hosted Pilot

The minimum deployable v1.0 stack for a small team: Web, API, and Postgres running through Docker
Compose with explicit configuration, migration/seed setup, Desktop pairing, and authenticated
redacted sync. It proves team connectivity without claiming public SaaS readiness, managed hosting,
automatic HTTPS, or production release packaging.

## Gate Advisory

A recommendation shown to Gate reviewers after an Agent Review. In v0.5 it is warning-only. From
v0.7 onward, Gate Advisory can feed Gate Enforcement Policy, but approval is still warning-only by
default unless a team explicitly enables blocking policy.

## Gate Enforcement Policy

The team-configurable rules that decide whether Gate approval should pass, warn, block, hard-block,
or require a policy sync. Policy evaluation considers deterministic Knowledge Governance Checks and
probabilistic Agent Policy Findings.

## Policy-Aware Delivery

The delivery mode where policy outcomes, knowledge standards, evidence gaps, and human Gate
decisions shape the next recommended development action without removing human approval.

## Remediation Plan

A reviewer-facing set of proposed actions for resolving a warning or blocked Gate, such as running a
Knowledge Review, adding Test Evidence, updating an API contract, or retrying a Coding Agent task.

## Retry Attempt

A human-approved attempt to rerun or continue work using an existing Run's policy context,
remediation plan, evidence, and prior Agent/Coding history.

## Policy-Aware Delivery Summary

A redacted manager-facing rollup of warning, blocking, override, remediation, retry, and evidence-gap
counts. It never includes local paths, raw logs, prompts, patches, or provider secrets.

## Policy Floor

The organization-level minimum action for an enforcement rule. Project overrides can make a rule
stricter but cannot weaken the organization floor.

## Protected Gate

A human decision node that can require enforcement. In the current model, protected gates are
workflow nodes whose kind is `gate` or `acceptance`.

## Agent Policy Finding

A normalized finding emitted by the Knowledge Review Agent for policy evaluation. Agent findings are
probabilistic; they may warn or block only by explicit policy and can never hard-block.

## Gate Override Decision

An auditable lead decision that allows a blocked Gate to proceed. Overrides require a reason, must
not be performed by the Run creator or selected Node owner, and cannot override hard-blocks.

## Policy Snapshot

A cached enforcement policy bundle used by Desktop. Team projects use the last authoritative cached
snapshot when offline; pure local projects use the built-in warn-only default.

## Provider Credential

The secret used by an Agent Provider. Electron stores provider secrets through the desktop
credential boundary and only returns masked metadata to the renderer. The API stores encrypted
secrets and also only returns masked metadata.

## Agent Provider

The runtime dependency that turns a redacted Agent Review context into structured review output.
DevFlow supports a deterministic fake provider for tests and OpenAI-compatible providers for
explicit live use.

## Coding Agent Adapter

The DevFlow boundary that hosts an external coding engine such as opencode. DevFlow does not
rebuild the coding agent; it owns context assembly, permission relay, worktree management, evidence
capture, tests, and team-safe summaries. In the current workflow model, Coding Agent actions start
only from build-stage task nodes. The fake engine is the deterministic default for automated
verification; the real opencode HTTP engine is env-gated and manually smoke-tested until it is stable
enough to become the default coding engine.

## External Coding Engine

An external agent runtime such as opencode or OpenCode that performs code-writing work behind a
Coding Agent Adapter. DevFlow uses this external capability instead of implementing its own coding
agent core.

## Coding Agent

The code-writing execution path that changes source code through a managed Coding Agent Adapter,
permission relay, and worktree. It implements approved work; it does not replace Knowledge Review.

## Managed Coding Workspace

A per-Coding Agent Run git worktree and branch created by Electron main process. It isolates edits
from the developer's primary checkout but is not a security sandbox.

## Dependency Bootstrap

The visible step that prepares a managed worktree before tests run. Lockfile-based installs can run
with frozen commands; non-frozen installs require human approval.

## Permission Relay

The DevFlow-mediated path for coding engine tool requests such as edit, bash, write, patch, install,
or external-directory access. If nobody answers before timeout, DevFlow rejects by default.

## Coding Diff Artifact

A local artifact containing changed repo-relative paths and a redacted, capped diff from a managed
coding workspace. The team backend receives only a redacted summary, not the raw patch.

## Token Usage

The measured model usage for a Run, Node, member, project, or model provider.

## Runtime Cost Summary

A redacted cost summary for a Coding Agent runtime run. It records provider, model, estimated or
provider-reported token usage, cost, and source, without storing raw prompts, cwd, stdout/stderr,
patch bodies, or provider secrets.

## Runtime Budget Guard

The pre-provider-call policy check that compares projected Coding Agent runtime cost against a team
project budget. It can allow, warn, require lead approval, or accept an existing lead approval before
the real provider is invoked.

## Runtime Budget Approval

An auditable lead approval that permits a specific requester to run real provider work beyond the
configured project budget for a bounded cost and time window.

## Local Project

A repository directory selected on a developer's machine for local execution. It carries local-only
configuration such as the test command and detected package manager.

## Local Execution

Work performed by the desktop client on the developer's machine, such as running a project's test
command and collecting evidence. Local Execution is separate from team-wide synchronized state.

## Test Evidence

The durable record of a local test execution, including command, working directory, result status,
duration, and redacted output.

## Data Origin

The source class for data shown in the app. `seed` is fixture/demo data, `local` is Electron SQLite
state, `remote` is authenticated API/Postgres team state, and `adapter` is an external execution
engine projection such as an OpenCode Coding Agent result.

## Local Settings

Developer-machine preferences stored in Electron SQLite, such as the theme preference and local MCP
UI state. Browser preview can still fall back to localStorage when the Electron preload API is not
available.

## Remote State

Team-shared state owned by API/Postgres, including identity, Projects, redacted Run projections,
policy, budget, collaboration commands, repository bindings, Delivery Requests, approvals, audit,
and manager summaries. Remote State does not own local source execution or complete local evidence.

## Cross-Platform Desktop

The requirement that the Electron client work across macOS and Windows. Windows 11 is the primary
Windows target; Windows 10 is best-effort.

## Windows Compatibility

The product constraint that local execution, SQLite persistence, path handling, command safety, and
smoke tests must not assume macOS-only behavior.

## Platform-Safe Local Execution

Local execution implemented with cross-platform Node/Electron APIs such as `path`, `os.tmpdir()`,
`spawn` with explicit `cwd`/`env`, and Electron `app.getPath('userData')`, without requiring
`bash`, `zsh`, `/tmp`, or POSIX path separators.
