CREATE TABLE agent_runtime_summaries (
  runtime_id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id text NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  node_id text NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
  state_version integer NOT NULL CHECK (state_version = 1),
  projection_version integer NOT NULL CHECK (projection_version = 1),
  runtime_version integer NOT NULL CHECK (runtime_version BETWEEN 1 AND 2147483647),
  checkpoint_version integer NOT NULL CHECK (checkpoint_version = runtime_version),
  status text NOT NULL CHECK (status IN (
    'running', 'waiting_permission', 'waiting_action', 'checkpointed', 'terminal'
  )),
  stop_reason text CHECK (stop_reason IS NULL OR stop_reason IN (
    'success', 'failure', 'cancelled', 'timeout', 'step_limit',
    'budget_exhausted', 'policy_denied'
  )),
  steps bigint NOT NULL CHECK (steps >= 0),
  tool_calls bigint NOT NULL CHECK (tool_calls >= 0),
  tokens bigint NOT NULL CHECK (tokens >= 0),
  cost_usd numeric(18,6) NOT NULL CHECK (cost_usd >= 0),
  accepted_action_count bigint NOT NULL CHECK (
    accepted_action_count >= 0 AND accepted_action_count <= steps
  ),
  context_digest text NOT NULL CHECK (
    length(context_digest) = 64 AND context_digest !~ '[^0-9a-f]'
  ),
  capability_set_digest text NOT NULL CHECK (
    length(capability_set_digest) = 64 AND capability_set_digest !~ '[^0-9a-f]'
  ),
  last_observation_digest text NOT NULL CHECK (
    length(last_observation_digest) = 64 AND last_observation_digest !~ '[^0-9a-f]'
  ),
  last_result_digest text CHECK (
    last_result_digest IS NULL OR
    (length(last_result_digest) = 64 AND last_result_digest !~ '[^0-9a-f]')
  ),
  summary_digest text NOT NULL CHECK (
    length(summary_digest) = 64 AND summary_digest !~ '[^0-9a-f]'
  ),
  started_at timestamptz NOT NULL,
  runtime_updated_at timestamptz NOT NULL,
  redacted boolean NOT NULL CHECK (redacted),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'terminal') = (stop_reason IS NOT NULL)),
  CHECK (runtime_updated_at >= started_at)
);

CREATE INDEX idx_agent_runtime_summaries_project_run
  ON agent_runtime_summaries(project_id, run_id, runtime_updated_at DESC);

CREATE TABLE agent_runtime_projection_audits (
  runtime_id text NOT NULL REFERENCES agent_runtime_summaries(runtime_id) ON DELETE CASCADE,
  runtime_version integer NOT NULL CHECK (runtime_version BETWEEN 1 AND 2147483647),
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
  PRIMARY KEY (runtime_id, runtime_version)
);

CREATE INDEX idx_agent_runtime_projection_audits_run
  ON agent_runtime_projection_audits(run_id, created_at DESC);
