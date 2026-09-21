# Unified workbench conversations

## Agreed product contract

- Keep the six-stage workflow and existing gate/execution authority. Improve stage navigation and card hierarchy for every node, including Task, Gate, Test, Delivery and Acceptance.
- The right workspace has one fixed node-details tab and independent conversation tabs. Preserve the existing Inspector, its node-specific sections and every existing action.
- Selecting a card opens its details; attachment counters deep-link to their section. Selecting a card does not retarget a conversation. Starting a discussion may suggest a node, but never restricts which project nodes the conversation can query.
- Every conversation can query the current project's complete live workflow, saved artifacts, evidence, repository and configured knowledge sources. Conversation messages, unanswered questions and private drafts remain isolated. Only explicit publication makes a draft a shared workflow artifact.
- Persist conversations, their history, input drafts, questions and tab visibility locally. Closing a tab does not delete it or cancel work. Restart recovers interrupted work visibly; never silently repeats a provider call.
- Run a bounded read-only investigation loop using the securely stored Provider, real tools, observable steps, citations, cancellation and recoverable errors. No fake success or fabricated workflow facts.
- Structured messages may ask questions, show draft artifacts and expose real navigation/actions. Workflow mutations continue through the existing authoritative execution and Gate paths.

## Verification matrix

Cover all six stages, all five node kinds, non-current nodes, cross-node questions, actual attachment counts and empty states. Exercise navigation from board/counters/chat, preserved Inspector sections and stage actions, session isolation, two projects, shared artifact freshness, private draft boundaries, close/reopen/restart, pending question continuation, provider failure/retry/cancel, stale/deleted targets and restricted repository paths.

Use service/store and renderer tests, the complete existing verification suite, browser end-to-end tests, and Electron integration with isolated data. Record exactly which external Provider/GitHub operations were exercised; never claim a live publication from a deterministic fixture.

## Implementation boundary

Built from PR #127 commit f11246c1c6b2be94ee7f12e8a91ae48f69a00d2d in an isolated worktree. Existing walkthrough data and the main checkout are not development fixtures. Conversations are local-only and excluded from team synchronization.
