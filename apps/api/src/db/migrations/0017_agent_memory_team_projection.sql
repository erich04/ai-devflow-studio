CREATE FUNCTION agent_memory_projection_citation_ids_are_bounded(value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN jsonb_typeof(value) <> 'array' THEN false
    WHEN jsonb_array_length(value) > 64 THEN false
    ELSE
      NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(value) AS citation(item)
        WHERE jsonb_typeof(citation.item) <> 'string'
           OR length(citation.item #>> '{}') NOT BETWEEN 1 AND 200
           OR (citation.item #>> '{}') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
      )
      AND jsonb_array_length(value) = (
        SELECT count(DISTINCT citation.item #>> '{}')
        FROM jsonb_array_elements(value) AS citation(item)
      )
  END
$$;

CREATE TABLE agent_memory_summaries (
  memory_id text PRIMARY KEY CHECK (
    length(memory_id) BETWEEN 1 AND 200 AND
    memory_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
  ),
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id text NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  node_id text NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
  runtime_id text NOT NULL CHECK (
    length(runtime_id) BETWEEN 1 AND 200 AND
    runtime_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
  ),
  owner_user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  candidate_id text NOT NULL CHECK (
    length(candidate_id) BETWEEN 1 AND 200 AND
    candidate_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
  ),
  state_version integer NOT NULL CHECK (state_version = 1),
  projection_version integer NOT NULL CHECK (projection_version = 1),
  current_revision integer NOT NULL CHECK (current_revision BETWEEN 1 AND 2147483647),
  head_version integer NOT NULL CHECK (head_version BETWEEN 1 AND 2147483647),
  lifecycle_status text NOT NULL CHECK (lifecycle_status IN (
    'active', 'conflict', 'expired', 'purge_pending', 'deleted'
  )),
  visibility text NOT NULL CHECK (visibility IN (
    'runtime', 'user_project', 'project_shared'
  )),
  sensitivity text NOT NULL CHECK (sensitivity IN ('private', 'internal')),
  retention_class text NOT NULL CHECK (retention_class IN (
    'session', 'thirty_days', 'until_deleted'
  )),
  provenance_digest text NOT NULL CHECK (
    length(provenance_digest) = 64 AND provenance_digest !~ '[^0-9a-f]'
  ),
  citation_ids jsonb NOT NULL CHECK (
    agent_memory_projection_citation_ids_are_bounded(citation_ids)
  ),
  retrieval_count bigint NOT NULL CHECK (retrieval_count >= 0),
  accepted_context_count bigint NOT NULL CHECK (accepted_context_count >= 0),
  expires_at timestamptz,
  deleted_at timestamptz,
  purge_status text CHECK (purge_status IS NULL OR purge_status IN ('pending', 'completed')),
  purged_at timestamptz,
  memory_updated_at timestamptz NOT NULL,
  projection_digest text NOT NULL CHECK (
    length(projection_digest) = 64 AND projection_digest !~ '[^0-9a-f]'
  ),
  redacted boolean NOT NULL CHECK (redacted),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (head_version >= current_revision),
  CHECK (lifecycle_status <> 'expired' OR expires_at IS NOT NULL),
  CHECK (
    (lifecycle_status IN ('active', 'conflict', 'expired') AND
      deleted_at IS NULL AND purge_status IS NULL AND purged_at IS NULL) OR
    (lifecycle_status = 'purge_pending' AND
      deleted_at IS NOT NULL AND purge_status = 'pending' AND purged_at IS NULL) OR
    (lifecycle_status = 'deleted' AND
      deleted_at IS NOT NULL AND purge_status = 'completed' AND purged_at IS NOT NULL)
  ),
  CHECK (purged_at IS NULL OR purged_at >= deleted_at)
);

CREATE INDEX idx_agent_memory_summaries_project_run
  ON agent_memory_summaries(project_id, run_id, memory_updated_at DESC);

CREATE INDEX idx_agent_memory_summaries_owner_lifecycle
  ON agent_memory_summaries(project_id, owner_user_id, lifecycle_status, memory_updated_at DESC);

CREATE TABLE agent_memory_projection_audits (
  memory_id text NOT NULL REFERENCES agent_memory_summaries(memory_id) ON DELETE CASCADE,
  head_version integer NOT NULL CHECK (head_version BETWEEN 1 AND 2147483647),
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id text NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  node_id text NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
  runtime_id text NOT NULL CHECK (
    length(runtime_id) BETWEEN 1 AND 200 AND
    runtime_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
  ),
  projection_digest text NOT NULL CHECK (
    length(projection_digest) = 64 AND projection_digest !~ '[^0-9a-f]'
  ),
  submitted_by_user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  desktop_token_id text REFERENCES desktop_tokens(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (memory_id, head_version)
);

CREATE INDEX idx_agent_memory_projection_audits_run
  ON agent_memory_projection_audits(run_id, created_at DESC);
