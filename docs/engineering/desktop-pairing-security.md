# Desktop pairing security contract

This is the current authority contract for binding Electron to a Team Project.

- Any authenticated, active project member may create a pairing code, but only for their own
  identity. The Web UI shows the member, project, and resulting Desktop role before creation.
- `createdByUserId` is the immutable token subject. The exchange endpoint accepts only `code`; a
  client-supplied user ID or role is rejected.
- Issuance records `issuedRole`. Organization owners are intentionally capped at `lead` for Desktop.
  A request uses the lower of `issuedRole` and the member's current project role, so a later role
  change can downgrade or invalidate an existing token but can never upgrade it.
- Legacy pairing rows and tokens are migrated with a `lead` issued-role ceiling because pairing was
  lead-only before schema v23.
- Pairing codes expire after ten minutes, allow at most five failed attempts, are single-use, and
  can be explicitly revoked by their creator. Desktop tokens expire after thirty days and can be
  explicitly self-revoked.
- Codes and bearer values are copy-once secrets. Postgres stores only hashes; API errors and audit
  data must never include either value.
- Project-membership removal fails closed. A `member` Desktop session cannot use lead-only Gate,
  enforcement override, budget, or delivery authority.

Relevant API boundaries:

- `POST /api/team/projects/:projectId/pairing-codes`
- `DELETE /api/team/projects/:projectId/pairing-codes/:pairingCodeId`
- `POST /api/desktop/pairing/exchange`
- `DELETE /api/team/projects/:projectId/desktop-tokens/:tokenId`

The signed browser cookie is required for issuance and code revocation. Development headers and an
existing Desktop bearer cannot mint a replacement credential.
