CREATE FUNCTION agent_coordination_role_counts_are_exact(value jsonb, expected_task_count bigint)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN jsonb_typeof(value) <> 'array' THEN false
    WHEN jsonb_array_length(value) NOT BETWEEN 1 AND 12 THEN false
    ELSE
      NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(value) AS role(item)
        WHERE jsonb_typeof(role.item) <> 'object'
           OR (SELECT array_agg(key ORDER BY key)
               FROM jsonb_object_keys(role.item) AS keys(key))
                <> ARRAY['count', 'roleId']
           OR jsonb_typeof(role.item -> 'roleId') <> 'string'
           OR (role.item ->> 'roleId') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
           OR jsonb_typeof(role.item -> 'count') <> 'number'
           OR (role.item ->> 'count') !~ '^[0-9]+$'
           OR CASE
                WHEN (role.item ->> 'count') ~ '^[0-9]+$'
                THEN (role.item ->> 'count')::bigint NOT BETWEEN 1 AND 12
                ELSE true
              END
      )
      AND jsonb_array_length(value) = (
        SELECT count(DISTINCT role.item ->> 'roleId')
        FROM jsonb_array_elements(value) AS role(item)
      )
      AND value = (
        SELECT jsonb_agg(role.item ORDER BY role.item ->> 'roleId')
        FROM jsonb_array_elements(value) AS role(item)
      )
      AND expected_task_count = (
        SELECT sum(CASE
          WHEN (role.item ->> 'count') ~ '^[0-9]+$'
          THEN (role.item ->> 'count')::bigint
          ELSE -2147483648
        END)
        FROM jsonb_array_elements(value) AS role(item)
      )
  END
$$;

CREATE FUNCTION agent_coordination_task_status_counts_are_exact(
  value jsonb,
  expected_task_count bigint
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN jsonb_typeof(value) <> 'object' THEN false
    WHEN (SELECT count(*) FROM jsonb_object_keys(value)) <> 7 THEN false
    WHEN NOT value ?& ARRAY[
      'pending', 'ready', 'running', 'succeeded', 'failed', 'cancelled', 'blocked'
    ] THEN false
    ELSE
      NOT EXISTS (
        SELECT 1
        FROM jsonb_each(value) AS entry(key, item)
        WHERE jsonb_typeof(entry.item) <> 'number'
           OR (entry.item #>> '{}') !~ '^[0-9]+$'
           OR CASE
                WHEN (entry.item #>> '{}') ~ '^[0-9]+$'
                THEN (entry.item #>> '{}')::bigint NOT BETWEEN 0 AND 12
                ELSE true
              END
      )
      AND expected_task_count = (
        SELECT sum(CASE
          WHEN (entry.item #>> '{}') ~ '^[0-9]+$'
          THEN (entry.item #>> '{}')::bigint
          ELSE -2147483648
        END)
        FROM jsonb_each(value) AS entry(key, item)
      )
  END
$$;

CREATE FUNCTION agent_coordination_failure_counts_are_bounded(
  value jsonb,
  expected_task_count bigint,
  retry_count bigint
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN jsonb_typeof(value) <> 'object' THEN false
    WHEN (SELECT count(*) FROM jsonb_object_keys(value)) <> 7 THEN false
    WHEN NOT value ?& ARRAY[
      'timeout', 'budget_exhausted', 'policy_denied', 'tool_error',
      'coding_executor_error', 'invalid_result', 'dependency_failed'
    ] THEN false
    ELSE
      NOT EXISTS (
        SELECT 1
        FROM jsonb_each(value) AS entry(key, item)
        WHERE jsonb_typeof(entry.item) <> 'number'
           OR (entry.item #>> '{}') !~ '^[0-9]+$'
      )
      AND expected_task_count + retry_count >= (
        SELECT sum(CASE
          WHEN (entry.item #>> '{}') ~ '^[0-9]+$'
          THEN (entry.item #>> '{}')::bigint
          ELSE 2147483648
        END)
        FROM jsonb_each(value) AS entry(key, item)
      )
  END
$$;

CREATE TABLE agent_coordination_summaries (
  coordination_id text PRIMARY KEY CHECK (
    length(coordination_id) BETWEEN 1 AND 200 AND
    coordination_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
  ),
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id text NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  node_id text NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
  state_version integer NOT NULL CHECK (state_version = 1),
  projection_version integer NOT NULL CHECK (projection_version = 1),
  coordination_version integer NOT NULL CHECK (coordination_version BETWEEN 1 AND 2147483647),
  graph_version integer NOT NULL CHECK (graph_version BETWEEN 1 AND 2147483647),
  status text NOT NULL CHECK (status IN ('running', 'terminal')),
  stop_reason text CHECK (stop_reason IS NULL OR stop_reason IN (
    'success', 'failure', 'cancelled', 'timeout', 'budget_exhausted',
    'policy_denied', 'blocked_dependency'
  )),
  role_counts jsonb NOT NULL,
  task_status_counts jsonb NOT NULL,
  failure_category_counts jsonb NOT NULL,
  task_count bigint NOT NULL CHECK (task_count BETWEEN 1 AND 12),
  edge_count bigint NOT NULL CHECK (edge_count BETWEEN 0 AND 24),
  specialist_starts bigint NOT NULL CHECK (specialist_starts BETWEEN 0 AND 8),
  accepted_handoff_count bigint NOT NULL CHECK (
    accepted_handoff_count BETWEEN 0 AND 16 AND accepted_handoff_count <= edge_count
  ),
  retry_count bigint NOT NULL CHECK (
    retry_count BETWEEN 0 AND 4 AND retry_count <= specialist_starts
  ),
  step_count bigint NOT NULL CHECK (step_count BETWEEN 0 AND 32),
  tool_call_count bigint NOT NULL CHECK (tool_call_count BETWEEN 0 AND 64),
  token_count bigint NOT NULL CHECK (token_count BETWEEN 0 AND 10000000),
  cost_usd numeric(18,6) NOT NULL CHECK (cost_usd BETWEEN 0 AND 1000000),
  single_agent_quality numeric(7,6) CHECK (single_agent_quality BETWEEN 0 AND 1),
  coordination_quality numeric(7,6) CHECK (coordination_quality BETWEEN 0 AND 1),
  latency_ms bigint NOT NULL CHECK (latency_ms BETWEEN 0 AND 1800000),
  human_intervention_count bigint NOT NULL CHECK (human_intervention_count BETWEEN 0 AND 2147483647),
  authority_violation_count bigint NOT NULL CHECK (authority_violation_count BETWEEN 0 AND 2147483647),
  isolation_violation_count bigint NOT NULL CHECK (isolation_violation_count BETWEEN 0 AND 2147483647),
  termination_violation_count bigint NOT NULL CHECK (termination_violation_count BETWEEN 0 AND 2147483647),
  replay_violation_count bigint NOT NULL CHECK (replay_violation_count BETWEEN 0 AND 2147483647),
  redaction_violation_count bigint NOT NULL CHECK (redaction_violation_count BETWEEN 0 AND 2147483647),
  coordination_updated_at timestamptz NOT NULL,
  isolated boolean NOT NULL CHECK (isolated),
  redacted boolean NOT NULL CHECK (redacted),
  summary_digest text NOT NULL CHECK (
    length(summary_digest) = 64 AND summary_digest !~ '[^0-9a-f]'
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'terminal') = (stop_reason IS NOT NULL)),
  CHECK ((single_agent_quality IS NULL) = (coordination_quality IS NULL)),
  CHECK (agent_coordination_role_counts_are_exact(role_counts, task_count)),
  CHECK (agent_coordination_task_status_counts_are_exact(task_status_counts, task_count)),
  CHECK (agent_coordination_failure_counts_are_bounded(
    failure_category_counts, task_count, retry_count
  ))
);

CREATE INDEX idx_agent_coordination_summaries_project_run
  ON agent_coordination_summaries(project_id, run_id, coordination_updated_at DESC);

CREATE TABLE agent_coordination_projection_audits (
  coordination_id text NOT NULL REFERENCES agent_coordination_summaries(coordination_id) ON DELETE CASCADE,
  coordination_version integer NOT NULL CHECK (coordination_version BETWEEN 1 AND 2147483647),
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id text NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  node_id text NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
  summary_digest text NOT NULL CHECK (
    length(summary_digest) = 64 AND summary_digest !~ '[^0-9a-f]'
  ),
  submitted_by_user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  desktop_token_id text REFERENCES desktop_tokens(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (coordination_id, coordination_version)
);

CREATE INDEX idx_agent_coordination_projection_audits_run
  ON agent_coordination_projection_audits(run_id, created_at DESC);
