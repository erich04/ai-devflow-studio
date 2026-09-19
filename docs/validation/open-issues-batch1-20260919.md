# Open issues, batch 1 — 2026-09-19

## Scope and changes

- #129: storage profile and data-source internals are available under Diagnostics, outside normal workflow chrome. Project binding remains distinct.
- #131: pull-team-data label and accessible help explain direction, scope, deployment and separation from Git delivery.
- #132: full-width header, removed redundant DF/avatar placeholders, fixed remaining-row height, responsive non-wrapping controls.
- #141: saved Coding configuration is distinct from permission, workflow-stage and active-run eligibility. Execution preflight is unchanged.
- #142: PR inspector recognizes exact archived upstream Coding diff before delivery intent creation. It does not mark the PR package generated or waive main-process delivery validation.
- #143: successful proposal publication resolves only its save confirmation, including narrow legacy wording. Other business questions remain pending; failed publication changes nothing.
- #145: declared Markdown/plain text and unknown-format fallback, deterministic legacy Markdown display, original-text toggle, no raw HTML or automatically loaded images, safe link schemes. Workflow actions remain separately validated.
- #148: remove editable private memory and its prompt injection. Preserve legacy values as clearly disabled read-only notes; conversation history and drafts remain intact.
- Preserve and deliver the existing low-effort DeepSeek reasoning stream changes in this working tree; see workbench-deepseek-reasoning-20260917.md. Provider-wide thinking configuration is tracked separately by #146.

## Verification

- 235 tests passed across App, WorkbenchWorkspace, conversation service, node-inspector view model and layout checks.
- Desktop TypeScript and renderer/Electron builds passed.
- Isolated Electron smoke passed all eight workflow card inspectors and their tabs, project-wide conversation queries, repository/document reads, questions, proposal publication, two-conversation isolation, failure/retry/cancel, history/restart and preserved input draft.
- Real renderer checks covered live reasoning before the answer, collapsed completed reasoning, Markdown strong/list rendering, saved-question resolution, absence of manual memory editing, Diagnostics navigation and 1280/1366/1920 viewports in light/dark screenshots.
- Smoke used 20 controlled local SSE responses through real Provider/IPC/SQLite paths. No external model was called; this is not a new live DeepSeek full-workflow acceptance claim.
- Screenshots and machine-readable report: out/workbench-conversation-qa/. Commands/logs: out/issue-resolution-20260919/.
- Read-only checks of the user profile and pre-change backup both show one workflow, one conversation and no Coding runs. The user profile was never used by smoke tests.

## Review decisions

Cursor read-only review 7f318719-fb02-4bac-93d4-172fb1fb6d01 was advisory. Accepted: display-only upstream diff selector, latest/active attempt precedence, run/node/project/diff identity checks, preservation of the delivery-intent path and unchanged delivery authority. Revised: an archived diff remains visible after workspace cleanup; workspace availability is enforced by publication commands, not by the evidence-exists label. Tests reject stale, truncated, foreign and failed-attempt evidence.

## Limits

This batch is locally verified, not yet merged or deployed. Remaining issues stay open. CSS changes initially exposed a full-height content overflow; fixed before the successful Electron rerun. No user workflow or chat was reset.
