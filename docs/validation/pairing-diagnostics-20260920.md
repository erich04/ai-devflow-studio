# Pairing recovery and safe diagnostics — issue 130

## Behavior

Desktop exchanges preserve controlled reasons for expired vs invalid/used/revoked
pairing codes. A general 401 remains an authentication failure. The user sees a
Chinese explanation and recovery direction, without IPC or arbitrary server text.
On the Web, expiry hides the code and disables copying; regeneration remains
available. Duplicate issuance/revocation clicks are rejected while pending.
Late results are ignored when account, role or project changes.

Desktop's Diagnostics page filters and copies/exports the local operation history.
Web's pairing section shows the current account/project's recent diagnostic
metadata. API and Desktop keep a bounded, owner-readable JSON history of at most
1,000 operations; credential access terminal outcomes are included on Desktop.
Only fixed metadata fields are persisted. Tokens, pairing codes, cookies, API keys,
paths and complete request/response bodies are excluded. Unauthenticated API
pairing records deliberately have no invented user or project ownership.

Each request carries x-devflow-diagnostic-id. Web proxy, Desktop and API preserve
that UUID. Unknown API exceptions and JSON-body parse errors are recorded with
controlled codes. A transport failure still has a local ID. Invalid response JSON
is recorded separately from HTTP success under the same ID. Pairing POSTs do not
automatically retry; the user generates a new code after failure.

## Operator query

The API log defaults to data/api-diagnostics.json under its process working
directory. DEVFLOW_API_DIAGNOSTICS_PATH can select an operator-managed location.
It is not exposed through an unauthenticated API. OS file permissions govern
operator access. Desktop history is in diagnostics.json in its selected data
profile, separate from its business database.

    corepack pnpm exec tsx scripts/query-diagnostics.ts --file <log-path> --id <UUID>
    corepack pnpm exec tsx scripts/query-diagnostics.ts --file <log-path> --reason pairing_code_expired --export <new-file.json>

Other filters: --from / --to (ISO timestamps), --operation, --project and --run
when that context exists. Export refuses to overwrite an existing file and writes
mode 0600. Web history is limited to the current mounted session, not a new server
query privilege. Shared conversation memory and business audit are unchanged.

## Evidence

scripts/pairing-diagnostics-integration.test.ts starts an isolated real HTTP
listener over the repository and route implementations, connected to the actual
Desktop HTTP client. A controlled clock expires a valid code. The test observes
an expiry error and matching persisted API/Desktop UUID, generates a fresh code,
exchanges it successfully, and rejects reuse. Reopened logs contain all outcomes
and none of either pairing code or the issued token. This is not a production
account or live-provider test.

Representative tests cover general 401, invalid code, 403, network failure, 503,
malformed response JSON, unexpected exceptions, bounded/stalled error bodies,
concurrent log writes and persistence, UI copy/export projection, Web expiry,
duplicate clicks, and account/project/role changes. Pairing and team data errors
retain existing selected project and demand state.

Cursor's advisory run ffb5f9fd-720d-4dfe-b563-ffeaed341cf5 ended with a repeated
connection failure and no final review. It is not counted as a passed review.
Independent code review additionally fixed account-scope visibility before
passive effects, and late revoke/copy results crossing an identity change.
