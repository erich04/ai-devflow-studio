CREATE FUNCTION github_delivery_changed_paths_are_bounded(paths jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $function$
  SELECT CASE
    WHEN jsonb_typeof(paths) <> 'array' THEN false
    WHEN jsonb_array_length(paths) NOT BETWEEN 1 AND 200 THEN false
    ELSE NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(paths) WITH ORDINALITY AS current_item(value, ordinal)
      LEFT JOIN jsonb_array_elements(paths) WITH ORDINALITY AS previous_item(value, ordinal)
        ON previous_item.ordinal = current_item.ordinal - 1
      WHERE jsonb_typeof(current_item.value) <> 'string'
        OR char_length(current_item.value #>> '{}') NOT BETWEEN 1 AND 500
        OR btrim(current_item.value #>> '{}') <> current_item.value #>> '{}'
        OR left(current_item.value #>> '{}', 1) IN ('/', '~')
        OR strpos(current_item.value #>> '{}', chr(92)) > 0
        OR current_item.value #>> '{}' ~ '(^|/)(\.|\.\.)(/|$)'
        OR previous_item.value #>> '{}' >= current_item.value #>> '{}'
    )
  END
$function$;

CREATE TABLE github_repository_bindings (
  id text PRIMARY KEY,
  version integer NOT NULL DEFAULT 1,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  installation_id text NOT NULL,
  repository_id text NOT NULL,
  full_name text NOT NULL,
  default_branch text NOT NULL,
  status text NOT NULL,
  configured_by_user_id text NOT NULL REFERENCES users(id),
  updated_by_user_id text NOT NULL REFERENCES users(id),
  validated_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT github_repository_bindings_version_positive CHECK (version > 0),
  CONSTRAINT github_repository_bindings_ids_bounded CHECK (
    char_length(id) BETWEEN 1 AND 200 AND id = btrim(id)
    AND installation_id ~ '^[1-9][0-9]{0,19}$'
    AND repository_id ~ '^[1-9][0-9]{0,19}$'
  ),
  CONSTRAINT github_repository_bindings_repository_shape CHECK (
    char_length(full_name) BETWEEN 3 AND 201
    AND full_name = lower(full_name)
    AND full_name ~ '^[a-z0-9_.-]+/[a-z0-9_.-]+$'
    AND char_length(default_branch) BETWEEN 1 AND 200
    AND default_branch = btrim(default_branch)
    AND default_branch !~ '(^/|/$|\.\.|//|@\{|\.lock$)'
  ),
  CONSTRAINT github_repository_bindings_lifecycle CHECK (
    (status IN ('active', 'stale') AND revoked_at IS NULL)
    OR (status = 'revoked' AND revoked_at IS NOT NULL)
  ),
  CONSTRAINT github_repository_bindings_time_order CHECK (
    validated_at >= created_at
    AND updated_at >= created_at
    AND (revoked_at IS NULL OR revoked_at >= validated_at)
  ),
  CONSTRAINT github_repository_bindings_project_scope_unique
    UNIQUE (organization_id, project_id, id),
  CONSTRAINT github_repository_bindings_repo_scope_unique
    UNIQUE (organization_id, project_id, repository_id, id)
);

CREATE UNIQUE INDEX github_repository_bindings_one_active_project
  ON github_repository_bindings (organization_id, project_id)
  WHERE status = 'active';

CREATE UNIQUE INDEX github_repository_bindings_one_active_repository
  ON github_repository_bindings (organization_id, repository_id)
  WHERE status = 'active';

CREATE TABLE github_delivery_requests (
  id text PRIMARY KEY,
  state_version integer NOT NULL DEFAULT 1,
  intent_revision integer NOT NULL DEFAULT 1,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  requested_by_user_id text NOT NULL REFERENCES users(id),
  requested_by_token_id text NOT NULL REFERENCES desktop_tokens(id),
  local_intent_id text NOT NULL,
  local_project_id text NOT NULL,
  run_id text NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  run_version integer NOT NULL,
  node_id text NOT NULL,
  binding_id text NOT NULL REFERENCES github_repository_bindings(id),
  binding_version integer NOT NULL,
  installation_id text NOT NULL,
  repository_id text NOT NULL,
  repository_full_name text NOT NULL,
  coding_run_id text NOT NULL,
  workspace_id text NOT NULL,
  diff_artifact_id text NOT NULL,
  test_evidence_id text NOT NULL,
  pr_package_artifact_id text NOT NULL,
  status text NOT NULL,
  outcome_code text,
  expected_run_version integer NOT NULL,
  base_branch text NOT NULL,
  head_branch text NOT NULL,
  base_commit_sha text NOT NULL,
  expected_commit_sha text NOT NULL,
  intent_digest text NOT NULL,
  logical_idempotency_key text NOT NULL,
  diff_digest text NOT NULL,
  test_evidence_digest text NOT NULL,
  package_digest text NOT NULL,
  changed_paths jsonb NOT NULL,
  pr_title text NOT NULL,
  pr_body text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT github_delivery_requests_versions_positive CHECK (
    state_version > 0 AND intent_revision > 0 AND run_version > 0
    AND binding_version > 0 AND expected_run_version > 0
  ),
  CONSTRAINT github_delivery_requests_ids_bounded CHECK (
    char_length(id) BETWEEN 1 AND 200 AND id = btrim(id)
    AND char_length(local_intent_id) BETWEEN 1 AND 200 AND local_intent_id = btrim(local_intent_id)
    AND char_length(local_project_id) BETWEEN 1 AND 200 AND local_project_id = btrim(local_project_id)
    AND char_length(run_id) BETWEEN 1 AND 200 AND run_id = btrim(run_id)
    AND char_length(node_id) BETWEEN 1 AND 200 AND node_id = btrim(node_id)
    AND char_length(coding_run_id) BETWEEN 1 AND 200 AND coding_run_id = btrim(coding_run_id)
    AND char_length(workspace_id) BETWEEN 1 AND 200 AND workspace_id = btrim(workspace_id)
    AND char_length(diff_artifact_id) BETWEEN 1 AND 200 AND diff_artifact_id = btrim(diff_artifact_id)
    AND char_length(test_evidence_id) BETWEEN 1 AND 200 AND test_evidence_id = btrim(test_evidence_id)
    AND char_length(pr_package_artifact_id) BETWEEN 1 AND 200 AND pr_package_artifact_id = btrim(pr_package_artifact_id)
    AND installation_id ~ '^[1-9][0-9]{0,19}$'
    AND repository_id ~ '^[1-9][0-9]{0,19}$'
  ),
  CONSTRAINT github_delivery_requests_repository_shape CHECK (
    repository_full_name = lower(repository_full_name)
    AND repository_full_name ~ '^[a-z0-9_.-]+/[a-z0-9_.-]+$'
    AND char_length(base_branch) BETWEEN 1 AND 200
    AND base_branch !~ '(^/|/$|\.\.|//|@\{|\.lock$)'
    AND char_length(head_branch) BETWEEN 9 AND 200
    AND head_branch LIKE 'devflow/%'
    AND head_branch !~ '(^/|/$|\.\.|//|@\{|\.lock$)'
  ),
  CONSTRAINT github_delivery_requests_evidence_shape CHECK (
    base_commit_sha ~ '^[a-f0-9]{40}([a-f0-9]{24})?$'
    AND expected_commit_sha ~ '^[a-f0-9]{40}([a-f0-9]{24})?$'
    AND base_commit_sha <> expected_commit_sha
    AND intent_digest ~ '^[a-f0-9]{64}$'
    AND char_length(logical_idempotency_key) BETWEEN 1 AND 200
    AND logical_idempotency_key LIKE 'github-delivery:%'
    AND diff_digest ~ '^[a-f0-9]{64}$'
    AND test_evidence_digest ~ '^[a-f0-9]{64}$'
    AND package_digest ~ '^[a-f0-9]{64}$'
    AND github_delivery_changed_paths_are_bounded(changed_paths)
  ),
  CONSTRAINT github_delivery_requests_copy_bounded CHECK (
    char_length(pr_title) BETWEEN 1 AND 256
    AND char_length(pr_body) BETWEEN 1 AND 20000
  ),
  CONSTRAINT github_delivery_requests_lifecycle CHECK (
    status IN (
      'approval_required', 'approved', 'publishing_branch', 'branch_published',
      'creating_pr', 'completed', 'failed', 'recovery_required', 'revoked'
    )
    AND (
      (status IN ('approval_required', 'approved', 'publishing_branch', 'branch_published', 'creating_pr')
        AND outcome_code IS NULL)
      OR (status = 'completed' AND outcome_code = 'draft_pr_created')
      OR (status IN ('failed', 'recovery_required', 'revoked') AND outcome_code IS NOT NULL)
    )
  ),
  CONSTRAINT github_delivery_requests_time_order CHECK (
    expires_at > created_at
    AND expires_at <= created_at + interval '24 hours'
    AND updated_at >= created_at
  ),
  CONSTRAINT github_delivery_requests_binding_scope_fk
    FOREIGN KEY (organization_id, project_id, binding_id)
    REFERENCES github_repository_bindings(organization_id, project_id, id),
  CONSTRAINT github_delivery_requests_logical_key_unique
    UNIQUE (organization_id, project_id, logical_idempotency_key)
);

CREATE UNIQUE INDEX github_delivery_requests_one_active_target
  ON github_delivery_requests (organization_id, project_id, run_id, node_id)
  WHERE status IN (
    'approval_required', 'approved', 'publishing_branch', 'branch_published',
    'creating_pr', 'completed', 'recovery_required'
  );

CREATE INDEX github_delivery_requests_desktop_inbox
  ON github_delivery_requests (organization_id, project_id, status, created_at);

CREATE TABLE github_delivery_approvals (
  id text PRIMARY KEY,
  request_id text NOT NULL REFERENCES github_delivery_requests(id) ON DELETE CASCADE,
  intent_revision integer NOT NULL,
  request_state_version integer NOT NULL,
  intent_digest text NOT NULL,
  binding_id text NOT NULL REFERENCES github_repository_bindings(id),
  binding_version integer NOT NULL,
  run_id text NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  run_version integer NOT NULL,
  node_id text NOT NULL,
  repository_id text NOT NULL,
  base_branch text NOT NULL,
  head_branch text NOT NULL,
  expected_commit_sha text NOT NULL,
  test_evidence_digest text NOT NULL,
  package_digest text NOT NULL,
  approved_by_user_id text NOT NULL REFERENCES users(id),
  approved_role text NOT NULL,
  auth_kind text NOT NULL,
  approved_at timestamptz NOT NULL,
  CONSTRAINT github_delivery_approvals_versions_positive CHECK (
    intent_revision > 0 AND request_state_version > 0 AND binding_version > 0 AND run_version > 0
  ),
  CONSTRAINT github_delivery_approvals_authority CHECK (
    approved_role IN ('lead', 'owner') AND auth_kind = 'session_cookie'
  ),
  CONSTRAINT github_delivery_approvals_snapshot_shape CHECK (
    intent_digest ~ '^[a-f0-9]{64}$'
    AND repository_id ~ '^[1-9][0-9]{0,19}$'
    AND expected_commit_sha ~ '^[a-f0-9]{40}([a-f0-9]{24})?$'
    AND test_evidence_digest ~ '^[a-f0-9]{64}$'
    AND package_digest ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT github_delivery_approvals_revision_unique UNIQUE (request_id, intent_revision),
  CONSTRAINT github_delivery_approvals_request_revision_unique
    UNIQUE (request_id, intent_revision, id)
);

CREATE TABLE github_delivery_credential_grants (
  id text PRIMARY KEY,
  version integer NOT NULL DEFAULT 1,
  request_id text NOT NULL REFERENCES github_delivery_requests(id) ON DELETE CASCADE,
  intent_revision integer NOT NULL,
  approval_id text NOT NULL REFERENCES github_delivery_approvals(id),
  attempt integer NOT NULL,
  issued_to_token_id text NOT NULL REFERENCES desktop_tokens(id),
  repository_id text NOT NULL,
  permission text NOT NULL,
  repository_count integer NOT NULL,
  status text NOT NULL,
  requested_at timestamptz NOT NULL,
  issued_at timestamptz,
  credential_expires_at timestamptz,
  consumed_at timestamptz,
  outcome_code text,
  CONSTRAINT github_delivery_grants_positive CHECK (
    version > 0 AND intent_revision > 0 AND attempt > 0
  ),
  CONSTRAINT github_delivery_grants_scope CHECK (
    repository_id ~ '^[1-9][0-9]{0,19}$'
    AND permission = 'contents:write'
    AND repository_count = 1
  ),
  CONSTRAINT github_delivery_grants_lifecycle CHECK (
    status IN ('issuing', 'issued', 'consumed', 'failed', 'recovery_required', 'expired', 'revoked')
    AND ((status IN ('issuing', 'issued', 'consumed') AND outcome_code IS NULL)
      OR (status IN ('failed', 'recovery_required', 'expired', 'revoked') AND outcome_code IS NOT NULL))
    AND (issued_at IS NULL) = (credential_expires_at IS NULL)
    AND (status <> 'issuing' OR issued_at IS NULL)
    AND (status NOT IN ('issued', 'consumed', 'expired') OR issued_at IS NOT NULL)
    AND (credential_expires_at IS NULL OR (
      credential_expires_at > issued_at
      AND credential_expires_at <= issued_at + interval '1 hour'
    ))
    AND (consumed_at IS NULL OR consumed_at >= issued_at)
  ),
  CONSTRAINT github_delivery_grants_attempt_unique UNIQUE (request_id, intent_revision, attempt),
  CONSTRAINT github_delivery_grants_approval_revision_fk
    FOREIGN KEY (request_id, intent_revision, approval_id)
    REFERENCES github_delivery_approvals(request_id, intent_revision, id)
);

CREATE UNIQUE INDEX github_delivery_grants_one_active
  ON github_delivery_credential_grants (request_id, intent_revision)
  WHERE status IN ('issuing', 'issued', 'consumed', 'recovery_required');

CREATE TABLE github_branch_publications (
  id text PRIMARY KEY,
  version integer NOT NULL DEFAULT 1,
  request_id text NOT NULL REFERENCES github_delivery_requests(id) ON DELETE CASCADE,
  intent_revision integer NOT NULL,
  grant_id text NOT NULL REFERENCES github_delivery_credential_grants(id),
  status text NOT NULL,
  reported_outcome_code text NOT NULL,
  verified_head_sha text,
  reported_at timestamptz NOT NULL,
  verified_at timestamptz,
  outcome_code text,
  CONSTRAINT github_branch_publications_positive CHECK (version > 0 AND intent_revision > 0),
  CONSTRAINT github_branch_publications_lifecycle CHECK (
    reported_outcome_code IN ('pushed', 'already_present', 'unknown')
    AND status IN ('verifying', 'verified', 'conflict', 'recovery_required', 'failed')
    AND ((status = 'verifying' AND outcome_code IS NULL AND verified_at IS NULL)
      OR (status = 'verified' AND outcome_code = 'branch_verified'
        AND verified_at IS NOT NULL
        AND verified_head_sha ~ '^[a-f0-9]{40}([a-f0-9]{24})?$')
      OR (status IN ('conflict', 'recovery_required', 'failed')
        AND outcome_code IS NOT NULL AND verified_at IS NOT NULL))
  ),
  CONSTRAINT github_branch_publications_revision_unique UNIQUE (request_id, intent_revision),
  CONSTRAINT github_branch_publications_request_revision_unique
    UNIQUE (request_id, intent_revision, id)
);

CREATE TABLE github_pull_request_outcomes (
  id text PRIMARY KEY,
  version integer NOT NULL DEFAULT 1,
  request_id text NOT NULL REFERENCES github_delivery_requests(id) ON DELETE CASCADE,
  intent_revision integer NOT NULL,
  publication_id text NOT NULL REFERENCES github_branch_publications(id),
  status text NOT NULL,
  pull_request_id text,
  pull_request_number integer,
  safe_url text,
  draft boolean NOT NULL DEFAULT true,
  head_branch text NOT NULL,
  base_branch text NOT NULL,
  head_sha text NOT NULL,
  provider_created_at timestamptz,
  recorded_at timestamptz NOT NULL,
  outcome_code text,
  CONSTRAINT github_pull_request_outcomes_positive CHECK (version > 0 AND intent_revision > 0),
  CONSTRAINT github_pull_request_outcomes_source_shape CHECK (
    head_sha ~ '^[a-f0-9]{40}([a-f0-9]{24})?$'
    AND char_length(head_branch) BETWEEN 9 AND 200
    AND head_branch LIKE 'devflow/%'
    AND char_length(base_branch) BETWEEN 1 AND 200
  ),
  CONSTRAINT github_pull_request_outcomes_lifecycle CHECK (
    status IN ('creating', 'completed', 'recovery_required', 'failed')
    AND ((status = 'creating' AND outcome_code IS NULL)
      OR (status = 'completed'
        AND outcome_code = 'draft_pr_created'
        AND draft
        AND pull_request_id IS NOT NULL
        AND pull_request_number > 0
        AND safe_url ~ '^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/pull/[1-9][0-9]*$'
        AND provider_created_at IS NOT NULL)
      OR (status IN ('recovery_required', 'failed') AND outcome_code IS NOT NULL))
  ),
  CONSTRAINT github_pull_request_outcomes_revision_unique UNIQUE (request_id, intent_revision),
  CONSTRAINT github_pull_request_outcomes_publication_revision_fk
    FOREIGN KEY (request_id, intent_revision, publication_id)
    REFERENCES github_branch_publications(request_id, intent_revision, id)
);
