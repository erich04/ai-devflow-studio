# Execution tools and read-only design validation — 2026-09-22

Issues: #156, #157, #158. #135 remains deferred for signed macOS installation acceptance.

## Resulting behavior

- Agents names the implementation configuration **项目执行工具** and the built-in executor
  **DevFlow Native（内置编码执行器）**. Implementation v2 and configuration revision are labeled
  separately. Internal identifiers, saved settings and old records are unchanged.
- Clarification and design choose an executor and saved Provider per Run/node. OpenCode design
  uses the existing read-only Stage Agent contract; chat and implementation configuration remain
  independent. Main discovers OpenCode and resolves credentials rather than trusting Renderer paths.
- Both design paths require the exact clarification bound to a successful Requirement Gate.
  The complete approved clarification and Raw Request bodies, plus saved design-node proposals,
  reach the Provider. Unapproved revisions and unrelated-node discussion inputs are excluded.
- Design evidence records approved input identity/body digest, executor/model and verified local
  citations. Failure/cancellation leaves the current stage unchanged; success stops at Design Review.

## Verification

- `corepack pnpm typecheck`: passed; the additional design smoke is included in
  `typecheck:opencode-smoke`.
- `corepack pnpm test`: 300 test files passed, 4,081 tests passed. The 15 opt-in PostgreSQL tests
  were skipped locally; the existing CI Postgres job covers them separately.
- `corepack pnpm build`, `test:cross-platform`, `test:build-output-smoke`: passed.
- `corepack pnpm test:e2e`: all 41 browser scenarios passed. Updated the existing execution-tool
  selectors and the Direct Provider repository-impact expectation to match the clarified UI.
- Added approval-input tests cover pending/ambiguous/wrong-Run/wrong-node/unapproved/tampered
  bindings, legacy compatibility, actual HTTP request bodies and stopping at the review Gate.
- Added tests cover explicit OpenCode design IPC routing without Coding configuration writes,
  independent node choices, UI cancellation/retry, bounded cancellation identifiers, late-result
  rejection, and read-only repository/permission checks for both clarification and design.
- `corepack pnpm test:stage-agent-design-contract`: real OpenCode 1.18.15 with a local synthetic
  OpenAI-compatible streaming service. It read `task.ts`, supplied complete approved inputs,
  produced a digest-backed citation, left Git/file contents unchanged, ran a second model concurrently
  without interrupting the held operation, and cancelled only that held request.
- `corepack pnpm test:stage-agent-design-electron`: isolated real Electron Main/preload/renderer,
  real OpenCode and the same synthetic service. Verified UI selection, cancellation before any design
  artifact, explicit retry, one design artifact, unchanged Coding configuration, human review still
  pending, and no duplicate model request or artifact after restart. Credential storage was replaced
  only in that test process with an adapter accepting exactly its synthetic secret; no user keychain
  or paid model was used. Screenshots are emitted under `output/playwright/stage-agent-design/`.

## Cursor advisor disposition

Cursor Grok 4.6 Extra High reviewed the bounded plan and current implementation read-only and
reported `pass_with_risks`. Its advice was independently checked against source:

- Accepted a dedicated cancellation/commit boundary; Run timestamps alone cannot reject late replies.
- Accepted cancellation from both Inspector and Agents, with exact Run/node ownership.
- Accepted strict approval-input, explicit routing and restart tests, and a bounded cancellation parser.
- Accepted visible verified facts/citations and updated current operating guides.
- Kept the existing Stage Agent adapter. No shared chat-tool rewrite or broad runtime migration was
  needed; implementation commands are described in the design but cannot execute in this stage.

## User environment preservation

All development and functional tests used an isolated checkout, temporary repositories and test
profiles. No user Run, Gate, conversation, proposal, Provider or project configuration was operated
on. The rollout reuses the existing application identity, Desktop profile, API database and ports,
with fresh SQLite/Postgres backups and before/after data comparisons recorded locally. Existing
business progress must be verified after restart before handing control back to the user.
