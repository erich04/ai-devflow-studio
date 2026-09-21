# Web-to-Electron policy acceptance — 2026-09-21

Issue #133 passes the complete save, pull, behavior-change and restoration sequence.
This is an isolated QA project, not the user's original To Do project. No Gate was
approved and no business workflow was advanced during this check.

## Environment and fixed comparison

- API/Web: candidate `74c2a5043f85f0e78c97c8547b443dde21cca2aa`, isolated Postgres 16,
  loopback ports 58536/58537, development-only local login.
- Desktop: packaged candidate `a0b574688d1e297c67b68ae8eeb48068f921ab6f`, Electron
  42.11.6, separate QA profile and repository. The policy UI/evaluation code is
  unchanged by the subsequent organization commits. Native UI actions use CUA.
- Team project: **Policy QA**, `p-policy-qa-20260921`, organization `org-local`.
  The same paired actor, **Local Developer / lead**, was used throughout.
- Selected Run: **OpenCode 验收：增加清除已完成按钮**, version 2, `paused_at_gate`;
  its current node is the requirement-confirmation Gate. Generated clarification
  revision 1 is `review_requested`; the knowledge-based Gate review is absent throughout.
- Baseline policy: version 1, `remote_cache`, ten rules with warning actions,
  no project override. Save the policy and both QA Run records before changing it.

## Actual UI and persistence results

| Step | Web and stored policy | Electron after pulling | Same Gate's actual result |
| --- | --- | --- | --- |
| Baseline | v1, missing review = `warn` | v1, `remote_cache`, synced at 06:25:51.954Z | “Gate 可以通过，但仍有待处理项”; 3 passed, 1 warning, 1 missing, 0 blocks |
| Change | Owner changes only `missing_agent_review:protected_gate:missing` from `warn` to `block`, previews one change and confirms; re-read retains v2 | v2, `remote_cache`, synced at 06:27:54.101Z; SQLite agrees with Postgres | “Gate 暂时不能通过”; missing knowledge-based review is the stated reason; 2 passed, 0 warnings, 1 missing, 2 blocked rows |
| Restore | Change the same action back to `warn`, preview and save; re-read retains v3 | v3, `remote_cache`, synced at 06:34:00.184Z; SQLite agrees with Postgres | “Gate 可以通过，但仍有待处理项”; 3 passed, 1 warning, 1 missing, 0 blocks; explicitly “当前策略仅警告，不阻断审批” |

All timestamps above are UTC on 2026-09-21. The two blocked rows are the Gate
conclusion and policy/permission rollup, not two changed rules. The actor, selected
node, artifacts, missing review and other nine rules stayed fixed, so the comparison
does not rely on a version badge or a generic “sync succeeded” notice alone.
Native accessibility text provides the UI evidence; an outdated window image was
not treated as evidence of the final screen.

After restoration, compare every effective rule's key, target, category,
status/severity, action, floor, override setting and source: all match the baseline.
Version and update timestamps legitimately advance. Both QA `workflow_runs` JSON
records compare exactly equal to the baseline, including versions and node state.
The user's original Run, conversation, Provider and pairing rows separately remain
equal to their pre-fix backup.

## Separate upload diagnostic

The QA profile also displays a terminal `run-summary` conflict. This is separate
from policy download and was present in the comparison. The earlier standalone
OpenCode call belongs to `local-user`; the later team pairing belongs to
`u-local-owner`. The API rejects stage-usage rows whose user differs from the
authenticated actor (`persistStageUsage` in `postgres-team-repository.ts`). The
failed upload creates no remote Run record. No identity or cost record was rewritten
to make this fixture upload succeed. This check proves the policy read/evaluation
path, not migration of standalone usage into a different team identity.

## Evidence and limits

Restricted, ignored QA artifacts under `out/issue-resolution-20260919/`:

- `policy-ui-baseline.json`: baseline policy and unchanged Run JSON.
- `policy-ui-server-block.json`, `policy-ui-desktop-block.json`: v2 server/cache.
- `policy-ui-server-restore.json`, `policy-ui-desktop-restore.json`: v3 server/cache.
- `policy-ui-comparison.json`: version 1 → 3, rules restored, two Runs unchanged.
- `original-data-preservation-20260921.json`: counts/equality for the user's data.

No credentials, ciphertext, pairing codes, or raw conversations are committed.
No LLM call, code modification, Gate approval or delivery was performed by this
policy check. The lifecycle and signed-install boundary of #135 is documented
separately in [Desktop credential validation](./desktop-lifecycle-credentials-thinking-20260919.md).
