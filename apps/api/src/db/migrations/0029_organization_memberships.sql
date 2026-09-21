ALTER TABLE organizations ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived'));
ALTER TABLE users ADD CONSTRAINT users_id_organization_unique UNIQUE (id, organization_id);

CREATE TABLE organization_memberships (
  auth_account_id text NOT NULL REFERENCES auth_accounts(id),
  organization_id text NOT NULL REFERENCES organizations(id),
  user_id text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (auth_account_id, organization_id),
  FOREIGN KEY (user_id, organization_id) REFERENCES users(id, organization_id)
);
CREATE INDEX organization_memberships_user_idx ON organization_memberships(user_id, organization_id);
INSERT INTO organization_memberships (auth_account_id, organization_id, user_id)
SELECT auth_accounts.id, users.organization_id, users.id FROM auth_accounts JOIN users ON users.id = auth_accounts.user_id;

CREATE TABLE organization_audit_events (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  actor_auth_account_id text NOT NULL REFERENCES auth_accounts(id),
  action text NOT NULL,
  subject_id text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX organization_audit_scope_idx ON organization_audit_events(organization_id, created_at DESC);

CREATE TABLE organization_invitations (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  created_by_auth_account_id text NOT NULL REFERENCES auth_accounts(id),
  provider_account_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'lead', 'member')),
  project_access jsonb NOT NULL DEFAULT '[]',
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX organization_invitation_scope_idx ON organization_invitations(organization_id, created_at DESC);
