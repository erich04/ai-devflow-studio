# Gate review findings and human feedback — #137

The reported DeepSeek review at `2026-09-17T07:18:49Z` claimed that a decision
about confirmation/undo was absent, although clarification v2 explicitly said
“不做二次确认弹窗、不做撤销/回收站” in its non-goals. The issue records that the
full current body and correct version were supplied; no old-version contamination
was established. This change does not invent a model-internal explanation.

## Result

- Review instructions distinguish an explicit non-goal, an unresolved choice and
  conflicting decisions. Every missing-evidence opinion requests exact citations.
- The host accepts only quotations that occur in the current review subjects or
  original request. It computes the source digest, timestamp and character
  offsets itself. Missing, invented, stale or duplicate assignments are shown as
  unverified. A citation in the owned non-goals section is flagged for review.
- The Inspector and review report retain the original opinion and its source
  check. A valid quote locates evidence; it does not prove the opinion is correct.
- A user can record a false-positive explanation. The main process resolves the
  actor, checks project/Run/review ownership and index, redacts sensitive text,
  and atomically saves feedback plus an event. Duplicate submissions are
  idempotent. Feedback does not change the original finding, policy or Gate.
- Existing review JSON remains readable; new fields are optional. No destructive
  database migration or user-data reset is required.

## Evidence

`packages/shared/src/review-grounding.test.ts` preserves the reported Chinese
decision/contradiction as a controlled quality sample. It captures actual Provider
HTTP messages, checks the complete current subject and exclusion of an older
artifact, and verifies host-generated provenance and an unchanged Gate advisory.
This is a repeatable regression sample, **not a new live DeepSeek evaluation**.

The focused suite passed **47 tests** across grounding, review artifact generation,
SQLite feedback persistence and Inspector feedback rendering. The earlier
cross-module run passed **512 tests** across review, enforcement, remote sync,
knowledge-review runtime, local store, IPC and App. Root `pnpm typecheck` passed.
Negative checks cover invented/foreign quotes, duplicate citation assignment,
forged actor fields, cross-project feedback, nonexistent finding indices and
secret redaction. Reopening SQLite preserves feedback and leaves Run state intact.

The initial failing grounding/report and feedback tests were observed before the
corresponding implementation. Local logs are in
`out/issue-resolution-20260919/review-grounding-*` and
`review-report-grounding-red.log`.

## Limits

The model can still misinterpret a valid quotation or omit a relevant one. Such
opinions remain subject to human judgment; no keyword heuristic dismisses a
finding or approves a Gate. Feedback is local audit data and is not silently used
as shared memory, training data or a modification to the original review report.
