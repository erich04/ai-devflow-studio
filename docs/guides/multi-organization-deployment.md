# Independent organizations on one DevFlow deployment

This opt-in feature uses the existing authenticated self-hosted Web/API/Postgres stack. See
[ADR 0023](../adr/0023-independent-organizations.md) for the authority model and
[validation](../validation/multi-organization-20260921.md) for what has actually been tested.

## Upgrade without discarding current work

1. Back up Postgres and each Desktop's complete data directory, including SQLite and credential
   metadata. Retain the existing API session/encryption secrets and OS keychain identity.
2. Run the normal `db:migrate` command before starting the updated API. Schema 29 backfills current
   account memberships; it does not reset projects or Runs. Readiness requires schema 29.
3. Keep `DEVFLOW_REQUIRE_AUTH=true`, demo/fake runtime disabled and `DEV_AUTH_ENABLED=false`.
   Set `DEVFLOW_MULTI_ORGANIZATION_ENABLED=true` in the API environment and restart it. With
   Compose, set it in `.env`; the existing one-shot migration/startup ordering is unchanged.
4. Use **组织与成员** from Web. Create an organization, then explicitly switch into it. It starts
   with no projects. Existing projects remain visible after switching back to their organization.

The default remains single-team onboarding. Setting the flag back to false closes new organization
creation and registration of unknown GitHub accounts, without deleting other organizations or
preventing existing users from switching. It is not a database downgrade. Do not run old binaries
against the upgraded database; binary rollback requires the pre-upgrade database backup and a
coordinated service stop. Preserve Desktop data when rebuilding/restarting the app.

## Members and Desktop

Owners generate an invitation for the recipient's numeric **GitHub 账号 ID**, shown on their own
organization page. Choose the organization role and project access explicitly, then share the
one-time token directly with that person. The recipient signs in, accepts it on **组织与成员**, then
switches organizations. Tokens expire after 24 hours and cannot be reused. An invitee must register
while onboarding is enabled; invitation acceptance does not admit an unknown login after onboarding
has closed. A revoked/disabled issuer or one who is no longer an owner must have another owner
issue a replacement invitation.

Web selection changes only the browser session. Pair Desktop separately to the selected team
project. One Desktop profile has one active pairing; use independent profiles/devices for concurrent
organizations. A role change or organization archive revokes old Desktop credentials. After
restoration, generate a new pairing code. It does not discard the previous local project or history.

Archiving retains projects and requests, and shows a recovery link instead of the team workbench.
Owners restore it in organization management. At least one active owner must remain. The page lists
recent organization/member/invitation audit events; credentials are not included in that history.

## Assign GitHub App repositories

Before using governed GitHub Delivery with multiple organizations, the deployment operator must
assign each repository. Organization owners cannot assign themselves arbitrary GitHub App access.
Expand **组织标识（供部署配置使用）** to obtain the organization ID, then configure the API:

```dotenv
DEVFLOW_GITHUB_REPOSITORY_ASSIGNMENTS='[{"organizationId":"org-example","installationId":"123","repositoryId":"456"}]'
```

Use real numeric installation/repository IDs and the exact organization ID. Each repository may
appear once. Restart the API after changing the list, then the organization owner can configure its
project binding through the existing Web flow. Include existing bindings when enabling the feature.
An unassigned repository remains blocked even if the account is an organization owner, an old
binding exists, or onboarding has since been turned off. Removing an assignment stops new delivery
operations; it does not retroactively revoke a token already minted by GitHub. Use the existing
binding/token revocation flow for that purpose. Keep the GitHub App's selected-repository grants
and short-lived credential policy unchanged.

## Repeatable verification

```bash
corepack pnpm typecheck
corepack pnpm test
DEVFLOW_TENANCY_TEST_DATABASE_URL=postgresql://... corepack pnpm test:organization-postgres
```

Use a dedicated test database. The organization suite creates random schemas, migrates a legacy
account from schema 28, uses real Postgres and independent local SQLite stores, then removes only
its schemas/directories. GitHub login and Agent actions in that suite are deterministic test adapters;
it does not call a paid LLM or publish to GitHub. CI runs it in the Postgres job. See the validation
record for the separate browser acceptance and remaining live workflow evidence.
