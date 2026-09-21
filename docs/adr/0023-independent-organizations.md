# ADR 0023: Independent organizations in a self-hosted deployment

Status: accepted for implementation. Issue #128 tracks acceptance and delivery.

## Decision and scope

Use Organization as the tenant. Keep one shared Postgres database with explicit scoped queries
and exact object-authority checks. Do not introduce a remote source-code executor, hosted SaaS,
billing, enterprise SSO or an automatic public signup service. Deployment operators retain control
of the network boundary and whether new organizations may be created.

An `auth_accounts` row identifies one verified GitHub account; its numeric provider account ID is
the immutable login identity. A new `organization_memberships` row associates that account with
one organization-specific `users` row. Roles and project memberships are local to that organization.
`auth_accounts.user_id` remains the legacy home profile, not a global role or access grant.

Schema 29 backfills existing memberships without changing project IDs, Run IDs, local SQLite,
Provider secrets or historical records. Browser cookie v2 signs the selected organization and
account ID. Each request reloads live membership/role; the cookie contains no cached permissions.
Legacy v1 cookies retain their home organization. They never fall back to a different team.

## Onboarding and lifecycle

`DEVFLOW_MULTI_ORGANIZATION_ENABLED` defaults to false. Enabling it requires authenticated
Postgres, no demo data and no development identity headers. Pilot still forbids local-development
login. An unknown verified GitHub account receives its own empty organization; an existing account
can explicitly create another or switch between its active memberships. Neither path auto-joins an
existing organization. Closing onboarding stops new organizations and unknown account registration;
existing memberships, selection and management continue. Project IDs remain collision-free after
onboarding closes, while pre-existing IDs stay unchanged.

Owners invite a specific numeric GitHub account with explicit organization/project roles. Tokens
are random, stored as hashes, expire after 24 hours, and are single-use. Acceptance requires the
matching authenticated GitHub account and an active owner issuer. An issuer losing owner authority
invalidates its unconsumed invitation; another owner may issue a replacement. When onboarding is
closed, invitees must already have registered on this deployment. Invitations do not bypass login
admission. The UI and deployment guide state this boundary.

Member updates serialize on the organization and protect the last active owner. Disabling a
membership removes browser access and revokes its Desktop tokens/pairing codes. Pending Gate
commands from a disabled requester cannot acquire a new receipt. Archiving preserves data but
stops business access and revokes all organization Desktop credentials and pending invitations.
The organization management page remains available for an owner to restore it. Restoration does
not resurrect revoked tokens: Desktop must pair again. Mutations write organization audit records.

## Authority boundaries

| Surface | Authority |
| --- | --- |
| Web/API | Signed account + selected organization + live user/project membership; browser mutations require JSON and reject cross-origin requests. |
| Postgres | Queries scope objects to organization/project; writes validate the target rather than trusting an owner-supplied project ID. No claim of database RLS. |
| Desktop | Each credential fixes organization, project, user and token/session. Switching Web organizations does not silently re-pair Desktop. Separate profiles provide separate local stores. |
| Agent Runtime | Existing exact-scope checkpoints, tool grants, Context/Memory authority and commit checks remain authoritative; re-pairing cannot resume an old tenant's pending action. |
| Knowledge and Memory | Full content remains local. Team synchronization stores only scoped redacted metadata. Built-in knowledge/templates remain common application resources. |
| Budgets/cost | Policy reads, upserts and approval actors must belong to the target organization/project; aggregate reads use the selected scope. |
| GitHub Delivery | Browser owner status does not grant use of every repository connected to the deployment's GitHub App. An operator assignment permits one exact organization/installation/repository tuple. |
| Background processing | Processors use the original pairing/claimant scope, not whichever organization the browser last selected. |

`DEVFLOW_GITHUB_REPOSITORY_ASSIGNMENTS` is operator-owned JSON. It is checked before repository
verification, credential issuance, branch verification/adoption and Draft-PR creation, including
recovery. The same repository cannot be assigned to two organizations. Unassigned operations fail
before a GitHub call. Existing single-team installations without assignments retain their behavior;
once multiple organizations exist, turning onboarding off does not restore global App authority.
Existing bindings and stored requests cannot bypass a removed assignment. Assignment changes apply
after API restart; already issued short-lived credentials retain their provider expiry/revocation
contract. This mechanism does not rotate the GitHub App key or widen its permissions.

## Tradeoffs and review

Application-scoped SQL is compatible with the current repository layer, but it requires negative
tests at every write boundary. This work reproduced and fixed a foreign-project budget upsert and
pending Gate receipt issuance for a disabled requester. The GitHub App boundary needs explicit
operator assignment because single-team owner trust does not generalize to independent tenants.

Cursor's advisory review found no additional reproducible access path in the earlier patch. Its
suggestion to retain invitations after the issuer loses authority was not adopted: explicit
re-issuance preserves the intended revocation behavior. Its warning about owner checks relying on
SQL target scoping is addressed by real-Postgres negative tests, not by treating owner as global.
The later GitHub assignment changes are validated separately; the earlier review does not cover them.

See the [deployment guide](../guides/multi-organization-deployment.md) and
[validation record](../validation/multi-organization-20260921.md). Neither integration tests nor
this ADR alone constitute a release signoff or a claim of a live multi-tenant LLM delivery.
