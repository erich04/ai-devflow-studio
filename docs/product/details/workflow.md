# Core Workflow Detail

## 1. Request Intake

User intent:

- Capture a real software request, not a cloned fixture.
- Preserve the raw request as a `raw_request` artifact.
- Create a standard six-stage workflow so the user can see the delivery path immediately.

Required product behavior:

- New Run creation should accept a small renderer input: title, request, project id, creator id, and
  branch name.
- The trusted workflow builder should create nodes, edges, initial artifact, and initial event.
- The UI should make the next expected action obvious.

## 2. Clarify

User intent:

- Convert a raw request into goals, non-goals, acceptance criteria, open questions, and risk
  assumptions.

Required evidence:

- Clarification artifact.
- Agent event showing the clarification step completed.
- Gate decision before moving into design.

## 3. Design

User intent:

- Define implementation approach, affected systems, API/data assumptions, and testing strategy.

Required evidence:

- Design artifact.
- Knowledge references when relevant.
- Gate decision before implementation starts.

## 4. Build

User intent:

- Run AI-assisted implementation locally while keeping developer control.

Required evidence:

- Coding Agent Run.
- Permission relay history.
- Managed worktree state.
- Coding Diff Artifact with redacted changed paths and safe summary.
- Runtime trace that distinguishes fake engine and real opencode paths.

## 5. Test

User intent:

- Prove the change with a configured command and durable result.

Required evidence:

- Test Evidence with command, status, exit code, duration, redacted output summary, and timestamp.
- Command safety feedback before execution.
- Clear failed, timed out, or passed state.

## 6. PR Draft

User intent:

- Produce a handoff artifact that can become a pull request later.

Required evidence:

- Original request.
- Design summary when available.
- Changed paths.
- Latest test evidence.
- Policy and budget status.
- Agent Review summary.
- Safe compare URL when repository mapping is safe.

Non-goal:

- v1.3 does not create real GitHub PRs, push branches, or merge code.

## 7. Acceptance

User intent:

- Make final business or lead signoff based on the full evidence bundle.

Required evidence:

- Acceptance evidence bundle.
- PR draft reference.
- Diff/test/policy/budget/review summary.
- Final Gate decision through the normal enforcement path.

