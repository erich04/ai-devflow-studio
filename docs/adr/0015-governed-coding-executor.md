# ADR 0015: Governed Coding Executor Contract

Status: Accepted

Date: 2026-08-12

## Context

ADR 0009 selected `opencode serve` HTTP behind a managed Coding Agent Adapter. The resulting
`CodingEngineAdapter` was sufficient for 1.x, but its `start` result always assumes an immediate
permission request and its continuation shape is tied to the external engine. It cannot express a
no-permission completion, capability negotiation, a runtime-selected executor, a checkpointed
continuation, or one uniform terminal result across native and delegated coding.

V2.0 keeps OpenCode and adds one deliberately narrow DevFlow-owned Coding Agent. Two independent
runtime contracts would create incompatible policy, cancellation, evidence, and recovery behavior.

## Decision

Evolve the 1.x adapter behind one `Coding Executor` contract. ADR 0009 remains the historical
OpenCode transport and managed-worktree decision; this ADR supersedes its external-only product
assumption for V2.0.

### Descriptor And Capability Negotiation

Each executor publishes a versioned descriptor with stable identity, kind (`opencode` or `native`),
contract version, availability, and a bounded set of Coding Executor Capabilities. Capabilities cover
workspace read, workspace edit, approved command/test execution, permission relay, cancellation,
checkpoint continuation, and structured diff/test Evidence. Missing capability is a deterministic
selection denial, not a prompt instruction asking the executor to behave differently.

The Agent Runtime selects only an executor whose descriptor satisfies the immutable request and the
current policy-approved capability set. Capability negotiation occurs before provider or workspace
side effects and is persisted in the trajectory.

### Scoped Request, Events, And Result

A request contains stable IDs and main-owned capability references: organization/project/user,
Run/Node/version, Local Project, managed workspace, objective and Context digests, allowed Tool and
executor capabilities, deadline, budget, and expected checkpoint version. Renderer or Team input
cannot supply a filesystem path, shell command, process environment, credential, or executable.

Executors emit the same allowlisted event families: started, observation, Tool request, permission
request/decision, Tool result, checkpoint, Evidence, and terminal. OpenCode events are mapped only
from the adapter-observable HTTP surface; DevFlow does not claim OpenCode's private internal trajectory.

Both OpenCode and the DevFlow-owned Coding Agent return the same terminal result contract: stop
reason, executor identity/version, final checkpoint version, changed repo-relative paths, redacted
diff reference, Test Evidence references, bounded usage/cost, and cleanup state. Raw patch, source,
prompt, stdout/stderr, cwd, and credentials remain local and outside Team projections.

### Authority And Lifecycle

A Coding Executor may inspect or modify only its main-owned managed workspace and may run only
capability-approved Tools. It can never publish, merge, approve a Gate, or widen scope. Delivery
continues to require the separate deterministic Workflow, policy checks, Test Evidence, Delivery
Intent, and signed human approval proven by 1.x.

Cancellation is idempotent and propagates through the executor handle. A late event cannot commit
after cancellation or a terminal result. Permission defaults to deny on expiry. Cleanup outcome is
part of the terminal result, not a swallowed finally-block detail.

### Migration

The existing OpenCode implementation is wrapped first without rewriting its tested transport. The
compatibility wrapper maps current ensure/start/permission/cancel behavior to executor descriptors,
events, and terminal results. The old adapter remains an internal implementation seam until every
consumer uses `CodingExecutor`; it is not exposed as a second product contract.

The first DevFlow-owned Coding Agent is intentionally narrow: it may use only the accepted native
workspace Tools, operate in a managed worktree, run the saved approved test command, perform a
bounded repair loop, and stop deterministically. Feature parity with OpenCode is not a V2.0 claim.

## Consequences

- Runtime orchestration can compare and route native and delegated coding without duplicating Gate,
  policy, budget, permission, cancellation, or Evidence rules.
- Executor capability differences remain visible instead of being hidden in provider prompts.
- Existing OpenCode test coverage remains valuable while contract-parity tests are added above it.
- Additional CLI candidates require a separate evidence-backed decision but can target this contract.

## Rejected Alternatives

- **Add more optional fields to `CodingEngineAdapter.start`.** Rejected because its control flow is
  structurally tied to an immediate permission request.
- **Let each executor define its own terminal shape.** Rejected because Workflow Evidence and Agent
  evaluation would fork by implementation.
- **Call OpenCode a DevFlow sub-agent.** Rejected because only adapter-exposed events are observable;
  internal OpenCode orchestration is outside DevFlow authority and evidence.
- **Give the native executor direct delivery authority.** Rejected because coding and publication
  are intentionally separate authority domains.
