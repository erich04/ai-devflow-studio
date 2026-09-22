# ADR 0020: Read-only Stage Agent and versioned clarification review

- Status: Accepted
- Date: 2026-08-30

## Decision

Requirement clarification and solution design have two explicit executors behind one `StageAgentExecutor` contract:

- `direct-provider` preserves the existing provider path.
- `local-agent` reuses the managed OpenCode process, but receives only a main-resolved repository
  root, a fixed read/glob/grep/list capability, bounded input/output/tool/citation limits, timeout,
  and cancellation. It has no repository-write, shell, network, Workflow, Gate, or permission-
  escalation authority. There is no automatic fallback between executors.

The local executor must return schema-valid stage output plus verified facts, assumptions, open
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
- This adapter generates clarification or design artifacts with read-only repository evidence.
- Existing direct-provider Runs remain readable; tracked revisions add exact stale-review checks.
- Real OpenCode smoke is opt-in. Default tests use a deterministic fake runner and never call a paid
  provider.

## Saved Provider binding (2026-09-10)

When a confirmed project's OpenCode Provider ID exactly matches a DevFlow saved Provider ID,
Electron Main resolves that credential and endpoint. It supplies a dedicated credential environment
variable and an inline OpenCode config referencing that variable to the managed child only. The
credential is not copied to OpenCode's auth file or sent through Renderer IPC. Display names never
select credentials, credential resolution errors fail closed, and rotation changes the runtime cache
identity. Providers without an exact saved binding retain their existing OpenCode profile behavior.

Read-only output specifies object-shaped facts and citations. DevFlow derives model identity and
usage from OpenCode messages, counts tools across the whole session, and computes citation digests
from local bytes. OpenCode usage is recorded in the stage Trace; monetary aggregation is tracked in
#81 because an unknown external cost must not be treated as free or priced using an unrelated model.

## Design stage and independent node choices (2026-09-22, #156–#158)

Clarification and design now each select `direct-provider` or `local-agent` and a saved Provider in
that node. Choices apply to the current generation and default to Direct Provider for a different
node. Electron Main resolves the repository, discovers the compatible local OpenCode binary, and
binds the selected saved Provider without saving or changing `CodingRuntimeConfiguration`. Older
clarification clients without an explicit Provider retain their confirmed project OpenCode profile;
design requires an explicit saved Provider. Chat remains independently configured.

Before either design executor runs, the successful Requirement Gate must uniquely reference a
same-Run clarification from its clarification node. Tracked revisions must be approved, bound to the
Raw Request, and pass digest validation. Legacy artifacts remain usable only through an unambiguous
successful Gate. The complete approved body and Raw Request body enter the prompt; newer unapproved
revisions and unrelated-node proposals are excluded. Explicitly saved design-node proposals are
pending input and may not silently override the approved scope.

A design may describe future file changes and test commands, but OpenCode receives the same fixed
read/glob/grep/list permissions and limits as clarification. It cannot execute those commands, edit
files, approve Gates, or fall back to another executor. Main revalidates the approved input before
commit. Cancellation owns one Run/node operation; a late response cannot commit after accepted
cancellation, and cancellation is rejected once atomic completion has begun. Failure audits preserve
available reported usage while leaving artifacts and workflow position unchanged.

The optional `Artifact.designEvidence` binds the exact clarification identity/body digest to executor,
Provider, model and validated repository findings. SQLite preserves it across restart; the Inspector
shows the input, file/line citations, facts and unchecked scopes. Success uses the existing atomic
artifact/trace/usage/workflow mutation and stops at the Design Review Gate for human approval.

The UI calls the project configuration **项目执行工具**, used for implementation. **DevFlow Native**
means the built-in coding executor (`native-model`); “Native Coding Agent” / “Native Executor” are old
names. Implementation version v2 is separate from saved-configuration revision. Names and optional
evidence metadata require no data migration or rewriting of existing conversations or Runs.
