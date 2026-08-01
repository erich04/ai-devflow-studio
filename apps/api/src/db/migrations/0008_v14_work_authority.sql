ALTER TABLE workflow_runs
  ADD COLUMN run_version integer NOT NULL DEFAULT 1;

ALTER TABLE workflow_runs
  ADD CONSTRAINT workflow_runs_run_version_positive
  CHECK (run_version > 0);

CREATE TABLE work_requests (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  request text NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  status text NOT NULL CHECK (
    status IN ('open', 'claim_pending', 'materialized', 'cancelled', 'expired')
  ),
  created_by_user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  claimed_by_token_id text REFERENCES desktop_tokens(id) ON DELETE RESTRICT,
  claimed_run_id text,
  claimed_at timestamptz,
  materialized_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_requests_claim_state CHECK (
    (status IN ('open', 'expired')
      AND claimed_by_token_id IS NULL
      AND claimed_run_id IS NULL
      AND claimed_at IS NULL
      AND materialized_at IS NULL)
    OR (status = 'claim_pending'
      AND claimed_by_token_id IS NOT NULL
      AND claimed_run_id IS NOT NULL
      AND claimed_at IS NOT NULL
      AND materialized_at IS NULL)
    OR (status = 'materialized'
      AND claimed_by_token_id IS NOT NULL
      AND claimed_run_id IS NOT NULL
      AND claimed_at IS NOT NULL
      AND materialized_at IS NOT NULL)
    OR (status = 'cancelled'
      AND materialized_at IS NULL
      AND ((claimed_by_token_id IS NULL
          AND claimed_run_id IS NULL
          AND claimed_at IS NULL)
        OR (claimed_by_token_id IS NOT NULL
          AND claimed_run_id IS NOT NULL
          AND claimed_at IS NOT NULL)))
  ),
  CONSTRAINT work_requests_time_order CHECK (
    updated_at >= created_at
    AND (expires_at IS NULL OR expires_at > created_at)
    AND (claimed_at IS NULL OR claimed_at >= created_at)
    AND (materialized_at IS NULL OR materialized_at >= claimed_at)
  )
);

CREATE UNIQUE INDEX work_requests_claimed_run_unique
  ON work_requests (claimed_run_id)
  WHERE claimed_run_id IS NOT NULL;

CREATE INDEX work_requests_project_status_updated_idx
  ON work_requests (organization_id, project_id, status, updated_at DESC);

CREATE TABLE collaboration_idempotency (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  actor_user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  auth_kind text NOT NULL CHECK (
    auth_kind IN ('session_cookie', 'desktop_bearer', 'development_header')
  ),
  auth_token_record_id text REFERENCES desktop_tokens(id) ON DELETE RESTRICT,
  operation_kind text NOT NULL CHECK (
    operation_kind IN (
      'work_request_create',
      'work_request_claim',
      'work_request_materialize',
      'work_request_release',
      'gate_command_create',
      'gate_command_receipt',
      'gate_command_acknowledge'
    )
  ),
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  response_status integer NOT NULL,
  outcome_code text NOT NULL,
  response_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT collaboration_idempotency_auth CHECK (
    (auth_kind = 'desktop_bearer' AND auth_token_record_id IS NOT NULL)
    OR (auth_kind <> 'desktop_bearer' AND auth_token_record_id IS NULL)
  ),
  UNIQUE (
    organization_id,
    project_id,
    actor_user_id,
    operation_kind,
    idempotency_key
  )
);

CREATE TABLE collaboration_audit_events (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  actor_user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  actor_role text NOT NULL,
  auth_kind text NOT NULL CHECK (
    auth_kind IN ('session_cookie', 'desktop_bearer', 'development_header')
  ),
  auth_token_record_id text REFERENCES desktop_tokens(id) ON DELETE RESTRICT,
  record_kind text NOT NULL CHECK (
    record_kind IN (
      'work_request',
      'gate_command',
      'gate_receipt',
      'gate_acknowledgement'
    )
  ),
  record_id text NOT NULL,
  action text NOT NULL,
  expected_version integer,
  observed_version integer,
  outcome_code text NOT NULL,
  request_fingerprint text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT collaboration_audit_auth CHECK (
    (auth_kind = 'desktop_bearer' AND auth_token_record_id IS NOT NULL)
    OR (auth_kind <> 'desktop_bearer' AND auth_token_record_id IS NULL)
  )
);

CREATE INDEX collaboration_audit_project_created_idx
  ON collaboration_audit_events (organization_id, project_id, created_at DESC);

CREATE TABLE gate_commands (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  work_request_id text REFERENCES work_requests(id) ON DELETE SET NULL,
  run_id text NOT NULL,
  node_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('approve', 'reject')),
  workflow_command text CHECK (
    workflow_command IN ('approve_gate', 'approve_acceptance')
  ),
  reason text NOT NULL,
  requested_by_user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  requested_role text NOT NULL,
  auth_kind text NOT NULL CHECK (
    auth_kind IN ('session_cookie', 'desktop_bearer', 'development_header')
  ),
  auth_token_record_id text REFERENCES desktop_tokens(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  expected_run_version integer NOT NULL CHECK (expected_run_version > 0),
  expected_policy_version integer NOT NULL CHECK (expected_policy_version > 0),
  expected_blocker_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  evaluation_status text NOT NULL CHECK (evaluation_status IN ('allowed', 'denied')),
  evaluation_blocker_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL CHECK (
    status IN ('pending', 'delivering', 'applied', 'rejected', 'expired')
  ),
  outcome_code text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gate_commands_action_shape CHECK (
    (action = 'approve' AND workflow_command IS NOT NULL)
    OR (action = 'reject' AND workflow_command IS NULL)
  ),
  CONSTRAINT gate_commands_auth CHECK (
    (auth_kind = 'desktop_bearer' AND auth_token_record_id IS NOT NULL)
    OR (auth_kind <> 'desktop_bearer' AND auth_token_record_id IS NULL)
  ),
  CONSTRAINT gate_commands_time_order CHECK (
    updated_at >= created_at AND expires_at > created_at
  )
);

CREATE UNIQUE INDEX gate_commands_active_target_version_unique
  ON gate_commands (organization_id, project_id, run_id, node_id, expected_run_version)
  WHERE status IN ('pending', 'delivering');

CREATE INDEX gate_commands_delivery_idx
  ON gate_commands (organization_id, project_id, status, created_at);

CREATE TABLE gate_command_receipts (
  id text PRIMARY KEY,
  command_id text NOT NULL REFERENCES gate_commands(id) ON DELETE CASCADE,
  attempt integer NOT NULL CHECK (attempt > 0),
  leased_to_token_id text NOT NULL REFERENCES desktop_tokens(id) ON DELETE RESTRICT,
  leased_at timestamptz NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  acknowledged_at timestamptz,
  CONSTRAINT gate_command_receipts_time_order CHECK (
    lease_expires_at > leased_at
    AND (acknowledged_at IS NULL OR acknowledged_at >= leased_at)
  ),
  UNIQUE (command_id, attempt)
);

CREATE TABLE gate_command_acknowledgements (
  id text PRIMARY KEY,
  command_id text NOT NULL REFERENCES gate_commands(id) ON DELETE CASCADE,
  receipt_id text NOT NULL UNIQUE REFERENCES gate_command_receipts(id) ON DELETE CASCADE,
  outcome_code text NOT NULL,
  before_run_version integer NOT NULL CHECK (before_run_version > 0),
  after_run_version integer NOT NULL CHECK (after_run_version >= before_run_version),
  evaluated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
