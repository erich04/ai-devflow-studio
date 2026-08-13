# ADR 0018: Scoped Agent Memory Lifecycle

Status: Accepted

Date: 2026-08-13

## Context

V2.0 Agent Checkpoints already preserve bounded continuation state for one exact Runtime. That is
not long-lived Memory. Repository Knowledge is reviewable Markdown owned in Git. Workflow State is
authoritative delivery state. V2.1 needs useful recall across later Agent turns without silently
converting model output into durable fact, leaking one tenant into another, or creating an undeletable
shadow knowledge base.

## Decision

Agent Memory is a separate, versioned, scoped product concept. It is not Workflow State, a
Knowledge Source File, Governance Evidence, an Agent Checkpoint, or hidden reasoning.

### Memory Kinds And Authority

- Working Memory is bounded to one Agent Runtime and remains in its checkpoint contract.
- A Memory Candidate is an allowlisted statement proposed from an accepted observable result. It is
  inert until an authoritative promotion policy accepts it.
- Durable Agent Memory is a promoted immutable revision with exact scope, provenance, retention,
  sensitivity, status, and audit metadata.

Only Electron main may promote full-fidelity local Memory derived from repository work. Team/API may
store an explicitly allowed redacted Memory projection only when product policy names that field set;
it cannot request raw local text or promote local Memory. A model, renderer, retrieval hit, or MCP
server cannot mint promotion authority.

### Scope And Retrieval

Every candidate/revision binds organization, project, user, session, Local Project when applicable,
and its declared visibility (`runtime`, `user_project`, or `project_shared`). Retrieval requires an
exact compatible scope and caller authority. Scope is an intersection, never a fallback: a missing
or mismatched dimension returns no item and no existence signal.

Memory retrieval participates as a separately labeled Context source. It never changes Knowledge
chunk scores, satisfies Governance Checks, advances Workflow, or expands a Tool/Executor capability.

### Revision, Conflict, Retention, And Deletion

Promotion creates immutable revision 1. An update requires the exact current revision and creates a
new immutable revision linked by `supersedes`; optimistic concurrency rejects stale writers. A
content digest and provenance digest bind the accepted statement to its source observation without
persisting hidden reasoning or raw private output in Team state.

Each revision has a fixed retention class and optional canonical `expiresAt`. Expired items are
excluded before ranking and cannot be revived by clock rollback; changing retention requires a new
authorized revision. The invariant is that deleted or expired Memory is unavailable before retrieval.
Deletion creates a monotonic tombstone, removes the item from retrieval, and queues all derived local
embeddings/index entries for purge. It prevents replay or an older sync from resurrecting it. Purge
completion is auditable; a pending purge remains unavailable.

Conflicting active memories are not silently merged. Retrieval reports the conflict set and its
versions or excludes it according to the caller contract; a model cannot choose a winner and write
it back without promotion authority.

### Audit And Privacy

Local audit records stable IDs, exact scope, revision, status transition, retention/expiry,
provenance digest, actor authority, and timestamps. It excludes raw prompt, hidden reasoning,
credentials, source, patch, stdout/stderr, and absolute paths. Team projections are metadata-only
and redacted. Enumeration, timing, error, and count behavior must not reveal another tenant's Memory.

Default verification uses a deterministic clock, fixture memories, and no provider call. It covers
cross-organization/project/user/session/Local Project isolation, stale revision conflict, expiry
boundaries, delete/purge/restart, projection redaction, and no-resurrection replay.

## Consequences

- Checkpoint recovery and durable Memory remain independently understandable and testable.
- Memory persistence starts locally; any Team projection is a later explicit slice with its own
  allowlist and schema migration.
- Deletion and scope filtering happen before retrieval/reranking, not as a UI-only filter.
- V2.2 may delegate only memories already visible to the delegated scope; delegation creates no new
  visibility.

## Rejected Alternatives

- **Persist every Agent observation automatically.** This creates unreviewed, noisy, and potentially
  sensitive shadow state.
- **Use chat history as Memory.** It is provider-specific, unbounded, hard to delete, and may contain
  hidden reasoning or secrets.
- **Reuse Workflow or Knowledge tables.** Their ownership and authority semantics are different.
- **Soft-hide deleted Memory only in UI.** Retrieval, embeddings, restart, and sync could resurrect
  it.
