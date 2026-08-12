# ADR 0014: Bounded Agent Runtime And Observable Trajectory

Status: Accepted

Date: 2026-08-12

## Context

ADR 0008 introduced a shared Knowledge Review Agent Core, provider abstraction, durable review
artifact, and redacted trace. That operation is intentionally one bounded provider call. V2.0 needs
work whose next action depends on observations, Tool or MCP results, executor events, and evaluation.
Calling every persisted model invocation an Agent Runtime would hide the difference between a
single-call operation and an iterative system that can act, fail, resume, or exhaust a bound.

The runtime must fit the authority model proven by 1.x. Repository execution and complete local
evidence stay in Electron main and SQLite. Team identity, policy, collaboration intent, and redacted
projections stay in API/Postgres. A model may propose an action, but it cannot create authority.

## Decision

DevFlow will add one bounded first-party Agent Runtime. The Deterministic Workflow remains the outer authority.
An Agent Runtime is not a Workflow: it cannot advance a Node, approve a Gate, publish a
branch, merge a pull request, widen a capability, or replace accepted Evidence.

The runtime executes an explicit loop:

1. observe the versioned Context and prior accepted results;
2. decide on one schema-valid action from the currently granted capability set;
3. execute that action through the Tool or Coding Executor boundary;
4. validate and persist its bounded result;
5. evaluate progress against the scenario and policy contract;
6. atomically persist a checkpoint before another action; and
7. stop with one explicit terminal reason.

### Bounds And Stop Semantics

Every run receives immutable maximum step, wall-clock deadline, cost/token budget, Tool-call count,
per-result size, and retry bounds. A lower authoritative policy limit wins. There is no unbounded
background continuation and no automatic widening when a limit is reached.

The stable stop reasons are `success`, `failure`, `cancelled`, `timeout`, `step_limit`,
`budget_exhausted`, and `policy_denied`. A provider, Tool, MCP process, or Coding Executor failure is
data for the runtime only while another action remains inside all bounds; otherwise the run stops.
`success` still produces Evidence for the deterministic Workflow to assess and does not advance a
Gate by itself.

### Observable Trajectory

An Agent Trajectory is an ordered sequence of allowlisted events: Context attachment, observation,
action request, permission decision, Tool/Executor result, evaluation, checkpoint, and terminal
outcome. Each event has a monotonic sequence number, runtime/checkpoint version, timestamp, safe
type-specific metadata, and content digests where full local data must remain private.

The trajectory records externally observable choices and fixed, bounded decision summaries. It does not persist hidden reasoning,
chain-of-thought, private model scratchpads, raw prompts, source text,
patch bodies, stdout/stderr, credentials, or absolute paths in Team-visible state. Provider-specific
internal traces are not reconstructed or claimed.

### Checkpoint, Resume, And Concurrency

Electron main commits the trajectory event, accepted result reference, counters, and Agent
Checkpoint in one local transaction. A checkpoint binds runtime contract version, Run/Node version,
Local Project, Context digest, capability-set digest, budgets consumed/remaining, next sequence, and
the last accepted observation/result digests.

Resume uses optimistic concurrency against the exact checkpoint version. It revalidates current
Workflow/Node authority, policy, capability grants, deadline, budget, Local Project binding, and
executor availability before any new action. A stale, terminal, mismatched, expired, or superseded
checkpoint fails closed. Resume never rewinds accepted actions and never replays a non-idempotent
result as a new action.

Only one active continuation may own a checkpoint version. Cancellation is monotonic, propagates to
an active Tool/MCP/Executor, and prevents a later continuation from committing another action.

### Runtime Placement And Verification

The first execution boundary is Electron main because it already owns local credentials, managed
workspaces, controlled commands, SQLite, and complete local Evidence. API/Postgres may store only a
strict redacted Agent Runtime summary and team audit metadata; it does not resume local execution.

Default verification uses a deterministic, no-cost fake runtime, fake model decisions, native fake
Tools, and fixture MCP/Coding Executors. Explicit real-provider scenarios remain opt-in, bounded,
and separately evidenced.

## Consequences

- ADR 0008 remains the contract for single-call Knowledge Review. This ADR classifies that path as a
  Single-Call LLM Operation rather than retroactively pretending it is iterative.
- Runtime state, trajectory, and checkpoints need versioned shared contracts and durable Desktop
  storage before a native coding loop is exposed.
- UI can explain the current observation, action, permission, evaluation, bound consumption,
  checkpoint, and stop reason without exposing hidden reasoning.
- Deterministic scenarios can compare quality, cost, latency, intervention, and recovery across
  executors using the same outer runtime contract.

## Rejected Alternatives

- **Let a model own Workflow transitions.** Rejected because it would bypass deterministic Evidence
  and human Gate authority.
- **Treat provider chat history as the checkpoint.** Rejected because it is provider-specific,
  difficult to validate, and likely to persist private reasoning or source content.
- **Resume from the latest timestamp.** Rejected because timestamps do not provide ownership or
  optimistic concurrency.
- **Keep running until the model says it is done.** Rejected because model intent is not a resource,
  safety, cost, or termination bound.
