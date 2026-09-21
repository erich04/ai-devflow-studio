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
| 4 | #133 #134 #147 | Policy/OpenCode verification and pluggable conversation execution | #133 real Web→Electron warn→block→warn acceptance passed with both QA Runs unchanged; #134 real OpenCode/DeepSeek stage UI accepted on 2026-09-21; #147 real conversation UI and CLI lifecycle verified; delivery pending |
| 5 | #128 | Multi-organization onboarding, isolation and documented end-to-end proof | Implemented in draft PR #152; Web lifecycle acceptance, advisory review, local regression and 15 real-Postgres tests pass, including two parallel complete workflows with real Git/SQLite/local tests and deterministic external providers; final implementation CI passed on macOS, Windows, Postgres and Docker; delivery pending |

Validation boundaries reuse the agreed conversation request/response, saved
conversation lifecycle, right-side UI and all workflow stage interfaces. Extend
existing public API integration coverage for tenancy and diagnostics. Cosmetic
copy changes use existing UI checks; behavioral bugs receive focused regressions.

Baseline: `codex/unified-workbench-conversations-20260916`; pre-existing thinking
changes are preserved. The root checkout contains unrelated changes and is not
modified. A restricted SQLite backup was taken before this work. An issue is
closed only after its acceptance criteria have corresponding evidence and the
fix is delivered; remaining validation gaps stay explicit.

## Reviewable delivery

The draft stack is #127 → #149 → #150 → #151 → #152. PR #149 covers 16 intake issues
(#125 #129 #130 #131 #132 #136 #138 #139 #140 #141 #142 #143 #144 #145 #146 #148),
#150 covers #137, #151 covers #147, and #152 covers #128/#133/#134. These 21 issues have
implementation or completed verification and linked evidence; they remain open until delivery.
No merge or issue closure is represented by this checklist. #135 still needs a normal
signed-install validation with an available Developer ID identity; the test-copy repair and
real native crypto verification are complete. The remaining boundary is explicit on GitHub.

Implementation commit `74c2a50` passes all five jobs in
[CI run 35568113956](https://github.com/erich04/ai-devflow-studio/actions/runs/35568113956):
macOS verify (4,038 tests), Windows compatibility (4,034 tests), Postgres integration
(15 organization tests plus existing smoke/delivery checks), Docker smoke and Docker lifecycle.
Database/platform-specific skips are reported separately, not counted as passed tests.

Evidence: [real To Do full workflow](../validation/real-deepseek-todo-e2e-20260917.md),
[OpenCode stage](../validation/stage-opencode-live-20260921.md), and
[conversation harness](../validation/workbench-opencode-harness-20260920.md), plus
[independent organizations](../validation/multi-organization-20260921.md) and
[Web-to-Electron policy](../validation/team-policy-web-electron-20260921.md).
