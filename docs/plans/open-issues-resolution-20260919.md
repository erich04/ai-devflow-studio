# Open issue resolution — 2026-09-19

Scope: the 22 open issues in `erich04/ai-devflow-studio` at intake. Preserve the
existing To Do user project, pairing, Provider credentials, Run and conversations.
User exercises the business Run personally; verification uses isolated fixtures,
data profiles and test projects. Never substitute simulated evidence for a task
that explicitly requires a live provider or end-to-end result.

## Delivery batches

| Batch | Issues | Scope | Status |
| --- | --- | --- | --- |
| 1 | #129 #131 #132 #141 #142 #143 #145 #148 | Desktop layout, accurate status, chat rendering and removal of manual memory | Implemented and locally verified; delivery pending |
| 2 | #125 #130 #135 #139 #140 | Lifecycle, diagnostics, credentials, failed-run cost and recovery | #125 #130 #139 implemented and locally verified; #135 signed-install evidence pending; #140 already has real recovery evidence in the 2026-09-17 To Do validation |
| 3 | #136 #137 #138 #144 #146 | Stage context/review, delivery facts, configurable thinking across callers | Implemented and locally verified; #136 #138 #144 also have real 2026-09-17 acceptance evidence; PR delivery pending |
| 4 | #133 #134 #147 | Policy/OpenCode verification and pluggable conversation execution | #134 real OpenCode/DeepSeek stage UI accepted on 2026-09-21; #147 real conversation UI and CLI lifecycle verified; #133 live policy UI acceptance pending |
| 5 | #128 | Multi-organization onboarding, isolation and documented end-to-end proof | Implemented; Web lifecycle acceptance and 14 real-Postgres tests pass, including two parallel complete workflows with real Git/SQLite/local tests and deterministic external providers; overall regression/review and PR delivery pending |

Validation boundaries reuse the agreed conversation request/response, saved
conversation lifecycle, right-side UI and all workflow stage interfaces. Extend
existing public API integration coverage for tenancy and diagnostics. Cosmetic
copy changes use existing UI checks; behavioral bugs receive focused regressions.

Baseline: `codex/unified-workbench-conversations-20260916`; pre-existing thinking
changes are preserved. The root checkout contains unrelated changes and is not
modified. A restricted SQLite backup was taken before this work. An issue is
closed only after its acceptance criteria have corresponding evidence and the
fix is delivered; remaining validation gaps stay explicit.

Evidence: [real To Do full workflow](../validation/real-deepseek-todo-e2e-20260917.md),
[OpenCode stage](../validation/stage-opencode-live-20260921.md), and
[conversation harness](../validation/workbench-opencode-harness-20260920.md), plus
[independent organizations](../validation/multi-organization-20260921.md).
