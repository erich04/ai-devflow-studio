# ADR 0019: Bounded Multi-Agent Coordination And Execution Tenancy

Status: Accepted

Date: 2026-08-13

## Context

V2.0 established one bounded Agent Runtime, native Tool/MCP authority, governed Coding Executors,
checkpoint recovery, and an observable trajectory. V2.1 added scoped Context, exact Citations, and
governed Memory. Neither milestone defines how DevFlow itself coordinates more than one Agent.

Calling an external executor's private internal workers “DevFlow Multi-Agent” would be unverifiable.
Allowing an Agent to spawn arbitrary peers would create unbounded cost, unclear termination, confused
deputy risks, shared-workspace races, and authority that cannot be reconciled with the deterministic
Workflow and human Gate model.

V2.2 therefore needs a finite coordination model that can be evaluated against the immutable V2.0
single-Agent baseline without turning the self-hosted pilot into hosted public multi-tenancy.

## Decision

DevFlow will support one Supervisor Agent and at most four Specialist Agents in one bounded
Coordination Session. The Supervisor is the only coordination authority. Specialist Agents cannot delegate,
spawn, invite, or resume another Agent. The hard delegation depth is one, so the product
cannot form an open-ended swarm.

Workflow and Gate authority remain outside coordination. A Supervisor or Specialist cannot advance
a Workflow Node, approve or override a Gate, publish or merge, mint credentials, widen policy, or
accept its own output as Governance Evidence.

### Coordination Session And Task Graph

Electron main creates a Coordination Session from one exact V2.0 Agent Runtime authority and a
versioned directed acyclic Agent Task Graph. The graph is fixed before specialist side effects and is
bounded to 12 task nodes, 24 dependency edges, four specialists, three concurrently running
specialists, and 16 accepted handoffs. Node IDs and edge identities are unique. Every dependency
targets a node in the same graph; cycles, disconnected hidden work, mutable dependencies, unknown
roles, and excess fan-out fail closed.

A task progresses monotonically through `pending`, `ready`, `running`, and one terminal state:
`succeeded`, `failed`, `cancelled`, or `blocked`. It becomes ready only after every dependency has an
accepted succeeded result. The Supervisor may select an accepted Specialist descriptor for a ready
node, join completed results, attribute a failure, request bounded recovery allowed by the plan, or
stop. It cannot rewrite a completed node or convert a failed result into success.

The Coordination Session has immutable shared limits for wall time, steps, Tool calls, tokens, cost,
handoffs, retries, graph size, and concurrency. Every Specialist allocation is deducted from those
limits. Unused sub-budget may return to the session, but no allocation may exceed the remaining
shared budget.

### Capability Attenuation And Execution Tenancy

Each Specialist receives a new opaque main-owned authority bound to the exact coordination, task,
role, parent Supervisor runtime/version, organization, project, user, session, Local Project,
Run/Node/version, Context digest, capability-set digest, deadline, and sub-budget. Its scope is the
intersection of the Supervisor authority, task declaration, current Workflow/policy state, and
resource lease. Its capabilities form a capability and budget subset of the Supervisor; missing or
broader authority is never inferred from prompts, task text, Team state, or another Specialist.

This is the V2.2 execution-tenancy boundary. Every task, checkpoint, Tool grant, Coding Executor
request, handoff, resource lease, and audit record carries the same exact tenancy identity. A
cross-organization, cross-project, cross-user, cross-session, cross-Local-Project, cross-Run, or
cross-coordination reference is rejected before data lookup or side effects and reveals neither
existence nor count. An Agent Handoff never crosses an execution-tenancy boundary.

Team/API remains a metadata-only projection and cannot create a Coordination Session, issue a
Specialist authority, resume local execution, or mutate the graph.

### Handoff, Join, And Evidence

An Agent Handoff is immutable and versioned. It binds source and target task/runtime versions,
coordination/tenancy identity, result digest, Evidence reference digests, Context digest, resource
lease outcome, bounded allowlisted summary, and monotonic sequence. The receiver revalidates every
identity and current dependency result before acceptance. Duplicate delivery is idempotent by exact
handoff identity; conflicting replay fails closed.

The handoff and coordination trajectory record only externally observable choices and bounded
metadata. The evidence does not persist hidden reasoning, private scratchpads, prompts, source, patches,
stdout/stderr, credentials, or absolute paths in renderer or Team-visible state. Specialist success
does not become Workflow Evidence until the existing deterministic Evidence boundary validates it.

### Resource Arbitration And Side Effects

Parallel read-only Specialists may use independent granted resources. Any mutable resource uses a
main-owned single-writer lease bound to exact tenancy, task, capability, resource digest, version,
and expiry. V2.2 never permits two Specialists to edit the same managed workspace concurrently. A
writer cannot inherit a reader's handle, and an expired/cancelled lease cannot commit.

Non-idempotent Tool, MCP, Coding Executor, and provider effects retain their existing reconciliation
contracts. Coordination does not make an ambiguous effect safe to repeat. A Specialist may use only
the V2.0 Tool/Coding boundaries already accepted for its attenuated authority.

### Checkpoint, Failure, Cancellation, And Restart

Electron main atomically persists the graph state, shared counters, accepted handoff identities,
resource leases, Specialist runtime/checkpoint references, and coordination trajectory. Resume uses
optimistic concurrency and revalidates Workflow/Node, policy, pairing, Context, capability, resource,
deadline, and tenancy before another action.

Parent cancellation propagates from the Coordination Session to every ready/running Specialist, active Tool,
MCP process, Coding Executor, pending handoff, and writer lease. It is monotonic: a late Specialist
result cannot commit after cancellation or another terminal outcome. Specialist failure is attributed
to the exact task/runtime and follows an explicit fail-fast or bounded-plan recovery policy; it is not
silently reassigned.

Restart recovery reopens only the exact persisted versions. It does not recreate a Specialist,
handoff, Tool call, or mutable effect already accepted before the crash. Unknown or ambiguous
in-flight effects remain blocked until their existing reconciliation boundary resolves them.

### Evaluation

Default evaluation is deterministic and no-cost. A frozen V2.2 dataset executes the V2.0
single-Agent baseline and the bounded Multi-Agent candidate on selected decomposition-friendly tasks,
then compares quality, cost, latency, human intervention, recovery, and failure attribution. The
Multi-Agent claim requires measurable aggregate quality improvement without exceeding frozen cost or
latency multipliers and with zero authority, isolation, termination, replay, redaction, or paid-call
violations.

## Consequences

- Multi-Agent behavior is DevFlow-owned and observable rather than inferred from an external engine.
- Specialist authority is strictly attenuated from existing main-owned authority.
- A fixed DAG, hard agent count, shared budget, and cancellation tree make termination inspectable.
- Single-writer leases prevent parallel specialists from racing the same mutable workspace.
- V2.0 single-Agent execution remains a supported baseline and fallback.
- Team visibility can remain metadata-only and read-only.

## Rejected Alternatives

- **Open-ended Agent swarm.** Rejected because membership, cost, termination, and authority would be
  unbounded.
- **Allow Specialists to delegate.** Rejected because recursive authority and termination would no
  longer fit the frozen depth-one contract.
- **Count OpenCode's private workers as DevFlow Multi-Agent.** Rejected because DevFlow cannot
  observe or evidence their internal coordination.
- **Let Specialists share one writable worktree concurrently.** Rejected because file and Git state
  would race outside deterministic Evidence.
- **Use Team/Postgres as the local coordinator.** Rejected because local source, credentials, Tools,
  and complete trajectories remain Electron-main authority.
- **Treat execution tenancy as public SaaS isolation.** Rejected because V2.2 scopes execution inside
  the self-hosted product and makes no hosted infrastructure claim.
