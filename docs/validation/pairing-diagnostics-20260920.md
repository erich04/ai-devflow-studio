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
that UUID in response headers; existing response bodies keep their exact schema.
Unknown API exceptions and JSON-body parse errors are recorded with
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

PR #149 CI found a protocol regression in packaged Delivery revocation proof:
adding diagnosticId to every error body violated its intentional exact-key
validation. The real remote client plus API diagnostics reproduced the failure.
The correction keeps correlation in headers, preserves the original body, and
does not weaken credential-proof validation. The HTTP pairing recovery scenario
still passes with this compatible representation.

The same CI run completed Docker lifecycle verification, then failed setup-node's
automatic host-cache save because all dependencies had been installed in Docker.
That job now explicitly disables automatic package-manager caching using the
[official setup-node v5 input](https://github.com/actions/setup-node/blob/v5/action.yml).
# PR #149 CI follow-up

The first CI run exposed two stale E2E fixtures: the pairing visual fixture had
already expired on September 10, and the Team page scroll check still selected
the old sync button name. The fixture now issues a synthetic code with a relative
10-minute lifetime, and the scroll test selects the current user-visible label.
The expiry behavior and viewport/scroll assertions remain unchanged. Remote CI
will rerun these checks; the initial failed run is not counted as a pass.
