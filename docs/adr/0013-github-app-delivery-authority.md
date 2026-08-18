# ADR 0013: GitHub App Delivery Authority

Status: Accepted

Date: 2026-08-11

## Context

DevFlow currently uses a GitHub OAuth App only to establish browser identity. It requests
`read:user user:email`, reads the profile, and discards the access token. V1.5 needs narrowly scoped
write authority for one repository so Desktop can publish one expected commit and the API can create
one Draft pull request after explicit signed Web approval.

The alternatives are:

1. widen and persist the existing user OAuth token;
2. ask each Desktop operator for a personal access token;
3. use a GitHub App installation with repository-scoped, short-lived credentials;
4. make the API upload code through GitHub's object APIs.

The managed worktree and git objects live on Desktop. The API must not become a raw source-code
upload service, while Desktop must not permanently custody a broad user token.

## Decision

Use a GitHub App installation for V1.5 delivery.

- The self-hosted API holds the GitHub App id and private key in operator configuration.
- Postgres stores only the Project-to-installation/repository binding and redacted audit metadata.
- The existing GitHub OAuth App remains identity-only with `read:user user:email`; its access token
  is not persisted or reused for delivery.
- A live lead or owner approves the exact redacted Delivery Request through a signed browser session;
  Desktop bearer authority cannot approve its own request.
- After that decision, paired Desktop main requests an installation access token through the
  authenticated API.
- The API narrows the Desktop installation access token to one repository and `Contents: write`.
- The token lifetime is no more than one hour. Desktop main holds it only in memory for the active
  attempt and clears it after use.
- The renderer never receives the private key, installation access token, authorization header,
  credential helper, or raw git command.
- Desktop main publishes only the approved expected commit to the approved namespaced branch.
- The API independently reads the remote branch head and, only after it matches the expected commit,
  uses an API-held token narrowed to one repository and the exact permission pair
  `Contents: read + Pull requests: write` to read the two refs and create only a Draft pull request.
- DevFlow will never merge or auto-merge, never force-push, never delete a remote branch, never
  publish a tag, and never widen permissions as part of V1.5.

## Authority Model

| Fact or action | Authority |
| --- | --- |
| Full local Run, managed worktree, expected commit, local attempt, result | Desktop SQLite / Electron main |
| Redacted Delivery Request, lead/owner approval, organization, membership, Project repository, GitHub App installation binding, revocation | API/Postgres |
| App private key and installation-token minting | API process configuration |
| Short-lived Contents token use for exact git push | Electron main memory |
| Remote-head verification and Draft pull-request creation | API process |
| Published branch and Draft pull request | GitHub |
| Workflow stage advance and Acceptance | Canonical local Run after evidence checks |

An installation access token proves GitHub capability, not human intent. Delivery Approval remains a
separate, immutable Team decision tied to the exact redacted Delivery Request and mirrored into the
local attempt before publication.

## Failure And Recovery Rules

- Missing, stale, revoked, cross-project, cross-repository, or over-broad authority fails closed.
- No credential is issued before an approved intent exists.
- A changed expected commit or evidence digest invalidates approval.
- Electron main scans the exact outbound Git objects and durably records a non-secret safe receipt
  before any GitHub credential is requested. The API separately scans the PR title and body before
  it requests PR-write provider authority. These are distinct outbound-content boundaries; neither
  evidence redaction nor one passing boundary substitutes for the other.
- A high-confidence match at either boundary becomes `content_scan_blocked`.
  The operator must not Resume or override the block.
  The only safe continuation is a new Work Request/Run. Its implementation is rebuilt and retested
  in a clean Coding Agent workspace. A Git-content block is pre-push; a PR-text block can occur after
  a verified branch publication, but no further remote write may be made for the blocked intent.
- An ambiguous push or PR response is reconciled against GitHub before another write is attempted.
- A conflicting remote branch or pull request becomes operator-visible recovery work; DevFlow does
  not rewrite it.
- Revocation blocks new credential issuance. An already issued token is treated as short-lived and
  the local attempt is stopped as soon as revocation becomes known.

## Consequences

Positive consequences:

- Repository access can be installed and revoked independently from user identity.
- Installation tokens are short-lived and can be narrowed to one repository and permission set.
- Desktop keeps code publication local without persisting a long-lived write credential.
- GitHub audit attribution identifies the App installation.

Costs and limitations:

- Self-hosted operators must create and install a GitHub App and configure its private key.
- The API must implement JWT signing, installation discovery/binding, token minting, and redacted
  error handling.
- V1.5 does not attribute the remote write to an individual GitHub user token; the signed Web
  Delivery Approval and Team audit provide the human attribution.
- Token revocation is not instantaneous for a token already minted, so short lifetime, single-use
  attempt handling, and local cancellation remain important.

## Rejected Alternatives

### Persist the current OAuth access token

Rejected because identity OAuth currently has a narrow, well-tested contract and discards the token.
Widening it couples sign-in to repository writes, creates long-lived user credential custody, and
makes revocation and repository scope harder to reason about.

### Personal access token on Desktop

Rejected because PAT scope and lifetime are operator-dependent, difficult to prove, and prone to
renderer/log/persistence leakage. It also creates a second credential model outside the Team Project
authority boundary.

### API-side Git object upload

Rejected because it would require source blobs and commit objects to cross the current local-first
boundary. Desktop already owns the canonical managed worktree and is the correct place to run git.

## References

- https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app
- https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation
- https://docs.github.com/en/rest/pulls/pulls#create-a-pull-request
