# Native Coding response expenses — issue #139

## Change

Each received Native Provider response now settles its validated usage in the
same durable transaction as its call Trace. Rejected analysis, invalid JSON,
invalid changes and subsequent execution failures retain those expenses. A
response request ID is counted once, and each Coding attempt has a distinct
expense identity locally and when read from Postgres.

Only the expense field is reconciled when an executor submits an older run
snapshot. Workflow, execution status and permission comparisons remain exact.
Cancellation cannot become completion because a later response arrives.

Before evaluating the next project budget, Desktop synchronizes all recorded
Coding settlements for that project. Rejected or failed uploads make the budget
guard unavailable. A missing tariff remains `costUsd: null`, not zero. Preflight
costs are explicitly labeled as estimates. Invalid/incomplete usage observations
remain in Trace even when their expense cannot be settled.

Opening the local store replays older Native traces only where no Provider-reported summary
exists. Repeated recovery is idempotent and does not call the model or advance
the workflow. Historic traces without enough tariff authority retain known
tokens and unknown monetary cost.

## Evidence

- Initial expense regression: five rejected-output cases exposed the previous
  estimate-only behavior.
- Follow-up red tests reproduced missing Coding upload before budget evaluation
  and loss of Trace on incomplete usage.
- Seven-file initial regression: 356 tests passed.
- Local store, canonical sync and Postgres follow-up: 289 tests passed.
- Final nine-file regression: 457 passed, one historical seed failed because its
  timestamp omitted canonical milliseconds. Correcting that fixture and rerunning
  the entire Provider trace file passed all 12 tests; no remaining failed case.
- Startup recovery was then moved to database opening so failed runs are repaired even
  without an active executor or Provider. All 200 store and Provider trace tests passed.
- Desktop and API TypeScript checks passed.
- Coverage includes cancellation/stale completion fences, duplicate observations,
  late responses, malformed JSON, unknown prices, retry identity, team aggregation,
  budget synchronization, restart recovery and historical expense recovery.

Logs: `out/issue-resolution-20260919/expense-*.log` and
`out/issue-resolution-20260919/batch2-typecheck.log`.
These are deterministic integration tests with an owned local Provider server;
they do not claim a new live DeepSeek billing reconciliation.

## Independent advisory review

Cursor session `f5fa948c-5089-473b-8af3-588606a853f3` reviewed the implementation
read-only. It found no blocker to the expense-only optimistic-lock reconciliation.
Its concerns about estimate labeling, remote attempt identity, retaining invalid
usage observations and aggregate-field leakage were independently checked and
addressed. Further inspection found the separate pre-budget synchronization gap,
which was fixed and regression-tested. Cursor's opinion is advisory, not approval.

The user's active To Do Run, conversation, local repository, pairing and
credentials were not used or changed by these tests. Delivery and issue closure
remain pending the combined release validation.
