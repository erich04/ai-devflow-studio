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

## 6. PR Delivery

User intent:

- Turn one tested commit in the canonical managed worktree into one separately approved GitHub
  Draft pull request without transferring source or repository authority into a handoff artifact.

Required evidence:

- Original request.
- Design summary when available.
- Changed paths.
- Latest test evidence.
- Policy and budget status.
- Agent Review summary.
- Metadata-only PR Delivery Package.
- Immutable Delivery Intent bound to the expected commit, repository binding, Run/node/version,
  Test Evidence, changed paths, and package digest.
- Redacted Delivery Request and immutable signed Web approval for its exact revision.
- Verified remote branch head and matching Draft pull-request completion.

Authority and recovery:

- A verified GitHub App repository binding supplies narrow, revocable repository authority.
- The GitHub App private key remains in the API process. Electron main holds a short-lived,
  repository-scoped Contents token only for the active publication attempt; the renderer never
  receives it.
- Revise creates a new pre-publication intent revision and invalidates approval.
- Resume continues the same `recovery_required` attempt without creating a new remote identity.
- Retry creates a new attempt only after the current claimant proves the predecessor terminal.
- Stop parks the exact active attempt for explicit operator recovery.

Non-goal:

- GitHub Delivery never merges, force-pushes, deletes a branch, publishes a tag, or makes GitHub the
  authority for the local Run.

## 7. Acceptance

User intent:

- Make final business or lead signoff based on the full evidence bundle.

Required evidence:

- Acceptance evidence bundle.
- PR Delivery Package, Delivery Intent, Delivery Request approval, verified remote head, and Draft
  pull-request reference.
- Diff/test/policy/budget/review summary.
- Final Gate decision through the normal enforcement path.
- Acceptance may record signoff after delivery completion but must never merge, close, or otherwise
  mutate the pull request.
