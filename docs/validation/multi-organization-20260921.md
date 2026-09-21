# Independent-organization validation — 2026-09-21

Issue #128; candidate branch `codex/multi-organization-tenancy-20260921`, based on
`a0b574688d1e297c67b68ae8eeb48068f921ab6f`. This record distinguishes browser acceptance,
production runtime integration and deterministic external-provider substitutes.

## Environment and preservation

The team QA stack uses its own Postgres 16 database, API and Web ports. A restricted database
backup preceded migration 29. The user's original To Do repository, Run, conversations,
Provider credentials and Desktop profile were not reset or advanced. The Postgres integration
runner creates a random schema, upgrades a populated schema-28 account, then removes only its
schema and temporary Git/SQLite directories. No test below publishes a GitHub PR or spends LLM quota.

A final read-only comparison with the pre-fix SQLite backup found exactly one original Run,
one conversation, one Provider configuration and one pairing record. All four tables' rows
are unchanged. The comparison emits counts/equality only, never credentials or conversation text.

## Automated evidence

`corepack pnpm test:organization-postgres` passes **15 tests** against real Postgres. It is a
required CI Postgres step; the launcher rejects a missing database URL rather than silently
reporting a skipped suite as acceptance.

- Schema 28 → 29 preserves the legacy user/account and v1 cookie; v2 selection isolates newly
  created organizations, including equal project slugs and onboarding switched back off.
- A second verified-account test adapter receives its own organization and cannot select or read
  the first. Invitations require the exact numeric account, explicit project grants, expiry and
  one-use acceptance. Wrong accounts, foreign projects, consumed/revoked/expired tokens fail.
- Last-owner removal fails. Archiving stops business access and revokes existing Desktop tokens;
  restoration keeps the project. Disabling one membership does not disable that account's other
  organization. Pending Gate receipts/inbox entries lose authority when the requester is disabled.
- Cross-origin/non-JSON organization writes fail. Foreign-project budget upsert and approval
  requests fail. Provider credentials cannot be read with another organization's identity.
- GitHub repository access requires the operator's exact organization/installation/repository
  assignment. Other repositories or organizations fail, including after onboarding is closed.
  A clean legacy single-team deployment still permits its original GitHub access with the flag
  off and no assignments; explicitly enabling independent organizations requires assignments.
- Two API-paired Desktop Agent runtimes use separate SQLite profiles. Cancelling one leaves the
  other active; the latter recovers after reopening. Retry keeps the original scope. Re-pairing
  to the other organization prevents the old pending task from executing.
- Two independent accounts/projects run all eight nodes through the production workflow runtime:
  clarification, requirement Gate, design, design Gate, build, tests, delivery and acceptance.
  Every actual transition is uploaded through the paired API. Both end at version 11/completed.
  Managed Git worktrees receive separate marker changes; real local Node assertions pass;
  source checkouts remain clean. SQLite reopening retains the correct artifacts, test evidence
  and permissions. Foreign Run/evidence reads return no data, and cross-project summary writes
  fail. Non-empty legacy artifact rows, cost entries and review summaries are also populated:
  each paired API view contains only its own completed Run, artifact, expense and review;
  deleting or uploading review evidence for the other Run is rejected.

The last scenario uses deterministic clarification/design content, the existing fake coding
adapter and a synthetic GitHub delivery outcome. Git/SQLite, permission records, workflow
transitions, local test execution, paired HTTP handlers and database queries are real. It is
**not** evidence of two live LLM deliveries or real GitHub publication. Separate live-provider
records cover [To Do delivery](./real-deepseek-todo-e2e-20260917.md),
[OpenCode stage generation](./stage-opencode-live-20260921.md) and
[OpenCode conversations](./workbench-opencode-harness-20260920.md).

The full `corepack pnpm verify` run at `844a844` passed workspace/smoke typechecks, **4,036 tests**
across 297 files and the cross-platform check. Its then-14 database tests were intentionally skipped
without the dedicated URL. The final Postgres command above includes the additional compatibility
case. The subsequent 67 API tests, 60 OpenCode engine tests, API typecheck and organization-smoke
typecheck also pass. `test:postgres-smoke` also
passes against a separate disposable database, including migration/seed, pairing, sync, budget,
review, runtime, memory and GitHub-delivery contracts; that database was removed afterward.

## Browser acceptance

Using the development-only local login in the isolated QA stack (production pilot still rejects
that login mode), the real Web interface was exercised through these operations:

1. Preserve **Local Team / Policy QA**; create and switch to **Tenancy UI QA**. The new team shows
   no existing projects. A duplicate slug gives a recoverable conflict and retains the form.
2. Create **Tenancy UI Todo** with the same project slug as the original team. Create a version-1
   request, **组织 B 的隔离验证需求**. The project has a distinct ID.
3. Archive this organization. The business workbench displays its unavailable state and an
   organization-management recovery link. Restore it, reopen the project and verify the same
   request is retained.
4. Switch back to **Local Team**. Only **Policy QA** appears in its project list.

This found and fixed a form hydration gap: before React was ready, native submission could put
form fields into a GET URL. The forms now use POST and remain disabled until their handlers are
ready. A component regression also checks that changing one's own owner role refreshes authority
instead of immediately attempting another now-forbidden owner read.

## Advisory review and CI follow-up

Cursor's separate GitHub-boundary review found no reproducible assignment bypass. The review's
single-team compatibility and runtime-configuration gaps were accepted: real Postgres now verifies
the legacy allow case, while the runtime tests exercise exact assignment matching through the
actual repository authorization path and reject invalid configuration before opening a DB client.
The deployment guide now states that archived or residual demo organizations also require explicit
assignments. Postgres continues to implement the authorization hook; the seed adapter remains
unavailable to independent-organization deployments. No extra presentation-only assertion was added
for the existing 403 copy. The parallel workflow test above is complete, with its external-provider
substitutes stated explicitly; it does not establish live two-team GitHub publication.

The first remote Windows run (`35567343984`) exposed an OpenCode test clock race: advancing 250 ms
at once could cross the synthetic 200 ms deadline while response-body completion was pending.
The tests now advance in small increments only while the result is pending. Success, transport
failure with a recovered diff, busy-session timeout and slow-permission cases remain checked.
Production timeout limits are unchanged. Cross-platform CI must validate the final follow-up commit.

## Boundaries and remaining release work

The default remains a self-hosted single-team deployment; independent organizations require an
explicit flag and authenticated Postgres. Closing onboarding does not delete organizations or
admit unknown invitees. One Desktop profile has one active pairing; use separate profiles/devices
for parallel organizations. Application SQL scoping is tested; database RLS and hosted shared
execution are not claimed. Full source, conversation memory and knowledge content remain local;
common built-in knowledge/templates remain application resources.

This feature's evidence does not replace #133's Web-to-Electron policy acceptance or #135's
Developer-ID-signed installation acceptance. Native UI continuation currently requires the user
to unlock macOS; no signing identity was available for the signed-install check. Those issues
remain explicitly open. Neither this document nor green integration tests represent a release
signoff or permission to merge the PR stack.
