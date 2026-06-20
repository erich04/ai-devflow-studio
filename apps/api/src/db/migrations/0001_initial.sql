BEGIN;

CREATE TABLE IF NOT EXISTS schema_meta (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organizations (
  id text PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text,
  avatar_url text,
  role text NOT NULL CHECK (role IN ('owner', 'lead', 'member')),
  avatar_initials text NOT NULL,
  focus text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url text;

CREATE TABLE IF NOT EXISTS auth_accounts (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('github')),
  provider_account_id text NOT NULL,
  username text,
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_account_id)
);

CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  repository text NOT NULL,
  default_branch text NOT NULL,
  health text NOT NULL CHECK (health IN ('on_track', 'at_risk', 'blocked')),
  knowledge_base_path text NOT NULL,
  test_command text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'lead', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  creator_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  data_origin text NOT NULL CHECK (data_origin IN ('seed', 'local', 'remote', 'adapter')),
  title text NOT NULL,
  request text NOT NULL,
  status text NOT NULL CHECK (
    status IN (
      'created',
      'clarifying',
      'designing',
      'building',
      'testing',
      'paused_at_gate',
      'completed',
      'failed',
      'cancelled'
    )
  ),
  current_node_id text NOT NULL,
  branch_name text NOT NULL,
  pull_request_url text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_nodes (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  stage text NOT NULL CHECK (stage IN ('clarify', 'design', 'build', 'test', 'pr', 'accept')),
  title text NOT NULL,
  subtitle text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('agent', 'gate', 'task', 'test', 'pr', 'acceptance')),
  status text NOT NULL CHECK (status IN ('pending', 'running', 'blocked', 'success', 'failed', 'skipped')),
  owner_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  required_role text CHECK (required_role IN ('member', 'lead', 'owner')),
  retry_count integer NOT NULL DEFAULT 0,
  token_usage_id text,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workflow_edges (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  source_node_id text NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
  target_node_id text NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('normal', 'gate', 'retry', 'failure')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS artifacts (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  node_id text NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (
    kind IN ('raw_request', 'clarification', 'design', 'diff', 'test_report', 'agent_review', 'log', 'pr', 'acceptance')
  ),
  title text NOT NULL,
  summary text NOT NULL,
  content text NOT NULL,
  redacted boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_events (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  node_id text REFERENCES workflow_nodes(id) ON DELETE SET NULL,
  sequence integer NOT NULL,
  kind text NOT NULL CHECK (
    kind IN ('thinking', 'tool_call', 'tool_result', 'file_change', 'test_result', 'agent_review', 'approval', 'error', 'sync')
  ),
  message text NOT NULL,
  timestamp timestamptz NOT NULL,
  UNIQUE (run_id, sequence)
);

CREATE TABLE IF NOT EXISTS test_evidence_summaries (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  node_id text NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  command text NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'passed', 'failed', 'timed_out')),
  exit_code integer,
  duration_ms integer NOT NULL,
  summary text NOT NULL,
  redacted boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS mcp_server_definitions (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  command text NOT NULL,
  permission text NOT NULL CHECK (permission IN ('read', 'write', 'network', 'shell')),
  enabled_by_default boolean NOT NULL DEFAULT false,
  last_audit_event text NOT NULL DEFAULT '未启用',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS skills (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  stage text NOT NULL CHECK (stage IN ('clarify', 'design', 'build', 'test', 'pr', 'accept', 'all')),
  description text NOT NULL,
  version text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  source text NOT NULL CHECK (source IN ('team', 'project', 'local')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS token_usage (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  node_id text NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('openai', 'anthropic', 'dashscope', 'local')),
  model text NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cache_read_tokens integer NOT NULL DEFAULT 0,
  cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  timestamp timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_provider_credentials (
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider_id text NOT NULL,
  model text NOT NULL,
  base_url text,
  masked_credential text NOT NULL,
  encrypted_secret text NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, provider_id)
);

CREATE TABLE IF NOT EXISTS agent_reviews (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  request_id text NOT NULL,
  run_id text NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  node_id text NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  runtime text NOT NULL CHECK (runtime IN ('electron', 'api')),
  provider_id text NOT NULL,
  model text NOT NULL,
  conclusion text NOT NULL,
  summary text NOT NULL,
  risks jsonb NOT NULL DEFAULT '[]'::jsonb,
  missing_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  suggested_tests jsonb NOT NULL DEFAULT '[]'::jsonb,
  knowledge_references jsonb NOT NULL DEFAULT '[]'::jsonb,
  policy_findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence numeric(4,3) NOT NULL DEFAULT 0,
  gate_advisory jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_traces (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  run_id text NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  node_id text NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
  review_id text NOT NULL REFERENCES agent_reviews(id) ON DELETE CASCADE,
  runtime text NOT NULL CHECK (runtime IN ('electron', 'api')),
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_token_usage (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  run_id text NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  node_id text NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('openai', 'anthropic', 'dashscope', 'local')),
  model text NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cache_read_tokens integer NOT NULL DEFAULT 0,
  cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  timestamp timestamptz NOT NULL,
  source text NOT NULL CHECK (source IN ('provider_reported', 'estimated'))
);

CREATE TABLE IF NOT EXISTS coding_agent_summaries (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  run_id text NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  node_id text NOT NULL,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  requested_by text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider_id text NOT NULL,
  engine text NOT NULL CHECK (engine IN ('fake', 'opencode-http', 'opencode-acp')),
  status text NOT NULL,
  branch_name text NOT NULL,
  summary text NOT NULL,
  changed_paths jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  redacted boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS enforcement_policies (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id text REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  version integer NOT NULL,
  policy jsonb NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS gate_override_decisions (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  run_id text NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  node_id text NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role text NOT NULL,
  reason text NOT NULL,
  blocked_reason_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  policy_version integer NOT NULL,
  provisional boolean NOT NULL DEFAULT false,
  status text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_policy_findings (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  review_id text NOT NULL REFERENCES agent_reviews(id) ON DELETE CASCADE,
  run_id text NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  node_id text NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
  category text NOT NULL,
  severity text NOT NULL,
  summary text NOT NULL,
  evidence_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  knowledge_reference_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_organization_id ON projects(organization_id);
CREATE INDEX IF NOT EXISTS idx_auth_accounts_user_id ON auth_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_project_id ON workflow_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_workflow_nodes_run_id ON workflow_nodes(run_id);
CREATE INDEX IF NOT EXISTS idx_agent_events_run_id_sequence ON agent_events(run_id, sequence);
CREATE INDEX IF NOT EXISTS idx_test_evidence_summaries_run_id ON test_evidence_summaries(run_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_project_id ON token_usage(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_reviews_run_id ON agent_reviews(run_id);
CREATE INDEX IF NOT EXISTS idx_agent_traces_review_id ON agent_traces(review_id);
CREATE INDEX IF NOT EXISTS idx_agent_token_usage_project_id ON agent_token_usage(project_id);
CREATE INDEX IF NOT EXISTS idx_coding_agent_summaries_project_id ON coding_agent_summaries(project_id);
CREATE INDEX IF NOT EXISTS idx_enforcement_policies_project_id ON enforcement_policies(project_id);
CREATE INDEX IF NOT EXISTS idx_gate_override_decisions_run_id ON gate_override_decisions(run_id);
CREATE INDEX IF NOT EXISTS idx_agent_policy_findings_review_id ON agent_policy_findings(review_id);

INSERT INTO schema_meta (key, value)
VALUES ('schema_version', '4')
ON CONFLICT (key) DO UPDATE
SET value = excluded.value,
    updated_at = now();

COMMIT;
