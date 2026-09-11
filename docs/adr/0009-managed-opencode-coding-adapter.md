# ADR 0009: Managed opencode Coding Adapter

## Status

Accepted

## Context

DevFlow v0.5 introduced a Knowledge Review Agent, but it intentionally did not implement a coding
agent. The next product step needs coding assistance without rebuilding opencode or forcing users to
leave DevFlow for an external TUI.

The integration must preserve DevFlow's product role:

- DevFlow owns workflow context, Gates, permission relay, evidence, tests, and team summaries.
- opencode owns coding execution.
- Worktree isolation is required, but it is not a security sandbox.

## Decision

DevFlow will host opencode as an external coding engine through a Coding Agent Adapter.

The v0.6 implementation starts with:

- A spike-gated HTTP transport decision.
- A deterministic fake coding harness for default tests and demos.
- A managed worktree per Coding Agent Run.
- Permission Relay for edit/bash/write/patch/install-style actions.
- Dependency Bootstrap as a visible step before test execution.
- Redacted Coding Diff Artifacts and redacted team summaries.

The selected real transport is `opencode serve` HTTP. Direct ACP is deferred because ACP adds a
stdin/stdout protocol layer and still delegates cancellation to the backing HTTP session abort path.

ADR 0008 remains correct for v0.5: DevFlow does not build its own coding agent. This ADR clarifies
that starting in v0.6, DevFlow can host an external coding agent while keeping DevFlow-native
workflow semantics.

## Consequences

- The renderer never gets direct filesystem or shell access.
- `runCodingAgent(input)` accepts IDs and user instruction, not a prebuilt prompt.
- The main/shared layer assembles the coding brief from Run, Node, artifacts, knowledge, Gates,
  tests, and worktree constraints.
- Only one active Coding Agent Run is allowed per Local Project in the MVP.
- Worktree dependency installation must be explicit; `node_modules` is not assumed to exist in a git
  worktree.
- Managed OpenCode tool-approval expiry pauses the run and retains its live session and worktree.
  Renewal revalidates the original Workflow version, pending executor permission, Git boundary, and
  worktree diff, then creates a new local approval ID bound to the original executor request.
  The expired decision remains in history; renewal does not approve execution or start a Provider.
  Revalidation also runs before the renewed approval is relayed.
  A lost session (including Desktop restart) cannot be resumed automatically; existing recovery
  retains the worktree and requires an explicit new attempt.
- Cancel marks the run `cancelled` and aborts the underlying session when a real engine is active.
- Execution Authorization, Change Acceptance, and dependency-install approval retain their existing
  expiry behavior. Actual execution timeout marks the run `timed_out`, distinct from user cancel,
  tool failure, and unexpected interruption. Managed OpenCode's active execution deadline excludes
  time waiting for tool approval; tool-turn and policy-correction limits remain enforced.
- After Execution Authorization, precisely recognized local checks (`pwd`, supported plain
  `git status` forms, and `git branch --show-current`) can be approved automatically. Other supported
  shell operations still require approval. Unsupported requests receive policy feedback before a
  human approval is displayed, with at most three correction opportunities within the same session.
- Three OpenCode attempts per Workflow Run / node / project remain the default. The user may
  explicitly authorize exactly the next additional attempt. The authorization records the trusted
  actor and current attempt count and is checked again inside durable run reservation. Replaying a
  consumed authorization fails; previous attempts, budget controls, and execution limits remain.
- Starting in v0.9, managed `opencode serve` processes are launched in a POSIX process group when
  available and terminated with `SIGTERM` followed by `SIGKILL` fallback. Worktree/process cleanup is
  recorded as redacted Coding Agent events.
- Remote team sync receives only `RemoteCodingAgentSummary`, never raw patch, raw logs, prompt, cwd,
  provider secrets, or repo-external paths.

## Deferred

- Full opencode HTTP runtime as the default engine in daily verify.
- Multi-run concurrency per project.
- Strong sandboxing beyond worktree isolation.
- Automatic dependency install without human approval when lockfiles are absent.
- Coding auto-fix loops, multi-agent handoff, and real MCP tool execution.
