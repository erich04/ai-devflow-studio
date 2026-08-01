ALTER TABLE gate_commands
  ADD COLUMN version integer NOT NULL DEFAULT 1;

ALTER TABLE gate_commands
  ADD COLUMN evaluated_at timestamptz;

UPDATE gate_commands
SET evaluated_at = created_at
WHERE evaluated_at IS NULL;

ALTER TABLE gate_commands
  ALTER COLUMN evaluated_at SET NOT NULL;

CREATE FUNCTION gate_command_blocker_ids_are_bounded(blocker_ids jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $function$
  SELECT CASE
    WHEN jsonb_typeof(blocker_ids) <> 'array' THEN false
    WHEN jsonb_array_length(blocker_ids) > 100 THEN false
    ELSE NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(blocker_ids)
        WITH ORDINALITY AS current_item(value, ordinal)
      LEFT JOIN jsonb_array_elements(blocker_ids)
        WITH ORDINALITY AS previous_item(value, ordinal)
        ON previous_item.ordinal = current_item.ordinal - 1
      WHERE jsonb_typeof(current_item.value) <> 'string'
        OR char_length(current_item.value #>> '{}') NOT BETWEEN 1 AND 200
        OR btrim(current_item.value #>> '{}') <> current_item.value #>> '{}'
        OR previous_item.value #>> '{}' >= current_item.value #>> '{}'
    )
  END
$function$;

ALTER TABLE gate_commands
  DROP CONSTRAINT gate_commands_expected_policy_version_check;

ALTER TABLE gate_commands
  DROP CONSTRAINT gate_commands_evaluation_status_check;

ALTER TABLE gate_commands
  DROP CONSTRAINT gate_commands_auth;

UPDATE gate_commands
SET evaluation_status = 'blocked',
  status = 'rejected',
  outcome_code = 'authorization_denied',
  version = version + 1,
  updated_at = GREATEST(updated_at, CURRENT_TIMESTAMP)
WHERE evaluation_status = 'denied'
  AND status = 'pending'
  AND outcome_code IS NULL
  AND jsonb_typeof(evaluation_blocker_ids) = 'array'
  AND jsonb_array_length(evaluation_blocker_ids) > 0;

ALTER TABLE gate_commands
  DROP CONSTRAINT gate_commands_time_order;

ALTER TABLE gate_commands
  ADD CONSTRAINT gate_commands_version_positive CHECK (
    version > 0
  ),
  ADD CONSTRAINT gate_commands_browser_write_auth CHECK (
    auth_kind = 'session_cookie'
    AND auth_token_record_id IS NULL
  ),
  ADD CONSTRAINT gate_commands_identifiers_bounded CHECK (
    char_length(id) BETWEEN 1 AND 200
    AND id = btrim(id)
    AND char_length(organization_id) BETWEEN 1 AND 200
    AND organization_id = btrim(organization_id)
    AND char_length(project_id) BETWEEN 1 AND 200
    AND project_id = btrim(project_id)
    AND (
      work_request_id IS NULL
      OR (
        char_length(work_request_id) BETWEEN 1 AND 200
        AND work_request_id = btrim(work_request_id)
      )
    )
    AND char_length(run_id) BETWEEN 1 AND 200
    AND run_id = btrim(run_id)
    AND char_length(node_id) BETWEEN 1 AND 200
    AND node_id = btrim(node_id)
    AND char_length(requested_by_user_id) BETWEEN 1 AND 200
    AND requested_by_user_id = btrim(requested_by_user_id)
    AND (
      auth_token_record_id IS NULL
      OR (
        char_length(auth_token_record_id) BETWEEN 1 AND 200
        AND auth_token_record_id = btrim(auth_token_record_id)
      )
    )
  ),
  ADD CONSTRAINT gate_commands_local_node_namespace CHECK (
    left(node_id, char_length(run_id) + 1) <> run_id || ':'
  ),
  ADD CONSTRAINT gate_commands_request_bounded CHECK (
    char_length(reason) <= 2000
    AND char_length(btrim(reason)) >= 1
    AND requested_role IN ('owner', 'lead', 'member')
    AND char_length(idempotency_key) BETWEEN 1 AND 200
    AND idempotency_key = btrim(idempotency_key)
    AND request_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  ADD CONSTRAINT gate_commands_versions_bounded CHECK (
    expected_run_version > 0
    AND expected_policy_version >= 0
  ),
  ADD CONSTRAINT gate_commands_blocker_ids_bounded CHECK (
    gate_command_blocker_ids_are_bounded(expected_blocker_ids)
    AND gate_command_blocker_ids_are_bounded(evaluation_blocker_ids)
  ),
  ADD CONSTRAINT gate_commands_evaluation_status CHECK (
    evaluation_status IN ('allowed', 'blocked')
  ),
  ADD CONSTRAINT gate_commands_evaluation_shape CHECK (
    (
      evaluation_status = 'allowed'
    )
    OR (
      evaluation_status = 'blocked'
      AND jsonb_array_length(evaluation_blocker_ids) > 0
      AND status = 'rejected'
    )
  ),
  ADD CONSTRAINT gate_commands_allowed_blocker_binding CHECK (
    evaluation_status <> 'allowed'
    OR expected_blocker_ids = evaluation_blocker_ids
  ),
  ADD CONSTRAINT gate_commands_lifecycle CHECK (
    (status IN ('pending', 'delivering') AND outcome_code IS NULL)
    OR (
      status = 'applied'
      AND (
        (action = 'approve' AND outcome_code = 'applied')
        OR (action = 'reject' AND outcome_code = 'human_rejected')
      )
    )
    OR (
      status = 'rejected'
      AND outcome_code IN (
        'requester_revoked',
        'scope_mismatch',
        'run_not_found',
        'stale_run',
        'stale_policy',
        'blockers_changed',
        'evidence_blocked',
        'authorization_denied'
      )
    )
    OR (status = 'expired' AND outcome_code = 'expired')
  ),
  ADD CONSTRAINT gate_commands_time_order CHECK (
    evaluated_at <= created_at
    AND updated_at >= created_at
    AND expires_at > created_at
    AND expires_at <= created_at + interval '15 minutes'
    AND (status <> 'expired' OR updated_at >= expires_at)
  );

ALTER TABLE gate_command_receipts
  DROP CONSTRAINT gate_command_receipts_attempt_check;

ALTER TABLE gate_command_receipts
  DROP CONSTRAINT gate_command_receipts_time_order;

ALTER TABLE gate_command_receipts
  ADD CONSTRAINT gate_command_receipts_identifiers_bounded CHECK (
    char_length(id) BETWEEN 1 AND 200
    AND id = btrim(id)
    AND char_length(command_id) BETWEEN 1 AND 200
    AND command_id = btrim(command_id)
    AND char_length(leased_to_token_id) BETWEEN 1 AND 200
    AND leased_to_token_id = btrim(leased_to_token_id)
  ),
  ADD CONSTRAINT gate_command_receipts_attempt_bounded CHECK (
    attempt BETWEEN 1 AND 2147483647
  ),
  ADD CONSTRAINT gate_command_receipts_time_order CHECK (
    lease_expires_at > leased_at
    AND lease_expires_at <= leased_at + interval '60 seconds'
    AND (acknowledged_at IS NULL OR acknowledged_at >= leased_at)
  ),
  ADD CONSTRAINT gate_command_receipts_command_id_id_unique
    UNIQUE (command_id, id);

ALTER TABLE gate_command_acknowledgements
  DROP CONSTRAINT gate_command_acknowledgements_before_run_version_check;

ALTER TABLE gate_command_acknowledgements
  DROP CONSTRAINT gate_command_acknowledgements_check;

ALTER TABLE gate_command_acknowledgements
  ADD CONSTRAINT gate_command_acknowledgements_identifiers_bounded CHECK (
    char_length(id) BETWEEN 1 AND 200
    AND id = btrim(id)
    AND char_length(command_id) BETWEEN 1 AND 200
    AND command_id = btrim(command_id)
    AND char_length(receipt_id) BETWEEN 1 AND 200
    AND receipt_id = btrim(receipt_id)
  ),
  ADD CONSTRAINT gate_command_acknowledgements_outcome_safe CHECK (
    outcome_code IN (
      'applied',
      'human_rejected',
      'requester_revoked',
      'expired',
      'scope_mismatch',
      'run_not_found',
      'stale_run',
      'stale_policy',
      'blockers_changed',
      'evidence_blocked',
      'authorization_denied'
    )
  ),
  ADD CONSTRAINT gate_command_acknowledgements_version_shape CHECK (
    before_run_version > 0
    AND after_run_version > 0
    AND (
      (
        outcome_code = 'applied'
        AND after_run_version::bigint = before_run_version::bigint + 1
      )
      OR (
        outcome_code <> 'applied'
        AND after_run_version = before_run_version
      )
    )
  ),
  ADD CONSTRAINT gate_command_acknowledgements_time_order CHECK (
    evaluated_at <= created_at + interval '60 seconds'
    AND (outcome_code <> 'expired' OR evaluated_at <= created_at)
  ),
  ADD CONSTRAINT gate_command_acknowledgements_command_unique
    UNIQUE (command_id),
  ADD CONSTRAINT gate_command_acknowledgements_receipt_matches_command
    FOREIGN KEY (command_id, receipt_id)
    REFERENCES gate_command_receipts(command_id, id)
    ON DELETE CASCADE;

DROP INDEX gate_commands_active_target_version_unique;

CREATE UNIQUE INDEX gate_commands_active_target_version_unique
  ON gate_commands (
    organization_id,
    project_id,
    run_id,
    node_id,
    expected_run_version
  )
  WHERE status IN ('pending', 'delivering');

DROP INDEX gate_commands_delivery_idx;

CREATE INDEX gate_commands_inbox_idx
  ON gate_commands (
    organization_id,
    project_id,
    status,
    expires_at,
    created_at,
    id
  )
  WHERE status IN ('pending', 'delivering');

CREATE INDEX gate_command_receipts_delivery_idx
  ON gate_command_receipts (
    command_id,
    leased_to_token_id,
    acknowledged_at,
    lease_expires_at DESC,
    attempt DESC
  );

CREATE TABLE released_work_request_claims (
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  work_request_id text NOT NULL REFERENCES work_requests(id) ON DELETE RESTRICT,
  run_id text NOT NULL,
  claimed_by_token_id text NOT NULL REFERENCES desktop_tokens(id) ON DELETE RESTRICT,
  released_by_user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  released_claim_version integer NOT NULL CHECK (released_claim_version > 0),
  released_at timestamptz NOT NULL,
  CONSTRAINT released_work_request_claims_identifiers_bounded CHECK (
    char_length(organization_id) BETWEEN 1 AND 200
    AND organization_id = btrim(organization_id)
    AND char_length(project_id) BETWEEN 1 AND 200
    AND project_id = btrim(project_id)
    AND char_length(work_request_id) BETWEEN 1 AND 200
    AND work_request_id = btrim(work_request_id)
    AND char_length(run_id) BETWEEN 1 AND 200
    AND run_id = btrim(run_id)
    AND char_length(claimed_by_token_id) BETWEEN 1 AND 200
    AND claimed_by_token_id = btrim(claimed_by_token_id)
    AND char_length(released_by_user_id) BETWEEN 1 AND 200
    AND released_by_user_id = btrim(released_by_user_id)
  ),
  PRIMARY KEY (organization_id, project_id, run_id)
);

CREATE INDEX released_work_request_claims_request_idx
  ON released_work_request_claims (
    organization_id,
    project_id,
    work_request_id,
    released_at DESC
  );
