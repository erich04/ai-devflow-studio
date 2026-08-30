# ADR 0020: Read-only Stage Agent and versioned clarification review

- Status: Accepted
- Date: 2026-08-30

## Decision

Requirement clarification has two explicit executors behind one `StageAgentExecutor` contract:

- `direct-provider` preserves the existing provider path.
- `local-agent` reuses the managed OpenCode process, but receives only a main-resolved repository
  root, a fixed read/glob/grep/list capability, bounded input/output/tool/citation limits, timeout,
  and cancellation. It has no repository-write, shell, network, Workflow, Gate, or permission-
  escalation authority. There is no automatic fallback between executors.

The local executor must return schema-valid clarification plus verified facts, assumptions, open
questions, acceptance criteria, non-goals, repo-relative citations, file content digests, a
repository digest, usage, terminal reason, and executor provenance. Pending permissions, missing or
invalid citations, limits, CLI unavailability, or any repository change fail closed. Prompts,
traces, and stored artifacts redact secrets and local absolute paths.

## Requirement Gate revision model

The Requirement Gate compares three separate subjects on one screen:

1. the immutable Raw Request;
2. Repository Findings (or an explicit “not verified” state);
3. the exact active Clarification Revision.

A request for changes stores an immutable feedback Artifact with trusted actor, time, reason digest,
and exact target identity. The current revision becomes `revision_requested`, Workflow returns to
the clarification Agent, and the next execution creates v2 while preserving v1 and feedback.
Approval requires the exact current artifact ID, revision, digest, and non-stale review subject.
Missing, ambiguous, wrong-Run, wrong-node, and stale associations fail closed.

Artifact, audit Event, Agent Trace, token usage, and Workflow transition commit atomically. Team
sync remains a redacted summary boundary: source, raw tool output, secrets, absolute paths, and full
clarification bodies stay local.

## Consequences

- Workflow remains the only stage and Gate authority.
- This is a narrow clarification adapter, not another general-purpose Coding Agent.
- Existing direct-provider Runs remain readable; tracked revisions add exact stale-review checks.
- Real OpenCode smoke is opt-in. Default tests use a deterministic fake runner and never call a paid
  provider.
