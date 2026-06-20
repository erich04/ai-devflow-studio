export const TEAM_SCHEMA_VERSION = 4

export const requiredTeamTableNames = [
  'schema_meta',
  'organizations',
  'users',
  'auth_accounts',
  'projects',
  'project_members',
  'workflow_runs',
  'workflow_nodes',
  'workflow_edges',
  'artifacts',
  'agent_events',
  'test_evidence_summaries',
  'mcp_server_definitions',
  'skills',
  'token_usage',
  'agent_provider_credentials',
  'agent_reviews',
  'agent_traces',
  'agent_token_usage',
  'coding_agent_summaries',
  'enforcement_policies',
  'gate_override_decisions',
  'agent_policy_findings',
] as const

export type TeamTableName = (typeof requiredTeamTableNames)[number]

export type TeamColumnDefinition = {
  name: string
  sqlType: string
  nullable: boolean
  primaryKey?: boolean
  references?: string
}

export type TeamTableDefinition = {
  name: TeamTableName
  columns: TeamColumnDefinition[]
}

function column(
  name: string,
  sqlType: string,
  options: {
    nullable?: boolean
    primaryKey?: boolean
    references?: string
  } = {},
): TeamColumnDefinition {
  const definition: TeamColumnDefinition = {
    name,
    sqlType,
    nullable: options.nullable ?? false,
  }

  if (options.primaryKey !== undefined) {
    definition.primaryKey = options.primaryKey
  }

  if (options.references !== undefined) {
    definition.references = options.references
  }

  return definition
}

export const teamTableDefinitions: TeamTableDefinition[] = [
  {
    name: 'schema_meta',
    columns: [
      column('key', 'text', { primaryKey: true }),
      column('value', 'text'),
      column('updated_at', 'timestamptz'),
    ],
  },
  {
    name: 'organizations',
    columns: [
      column('id', 'text', { primaryKey: true }),
      column('name', 'text'),
      column('slug', 'text'),
      column('created_at', 'timestamptz'),
      column('updated_at', 'timestamptz'),
    ],
  },
  {
    name: 'users',
    columns: [
      column('id', 'text', { primaryKey: true }),
      column('organization_id', 'text', { references: 'organizations.id' }),
      column('name', 'text'),
      column('email', 'text', { nullable: true }),
      column('avatar_url', 'text', { nullable: true }),
      column('role', 'text'),
      column('avatar_initials', 'text'),
      column('focus', 'text'),
      column('created_at', 'timestamptz'),
      column('updated_at', 'timestamptz'),
    ],
  },
  {
    name: 'auth_accounts',
    columns: [
      column('id', 'text', { primaryKey: true }),
      column('user_id', 'text', { references: 'users.id' }),
      column('provider', 'text'),
      column('provider_account_id', 'text'),
      column('username', 'text', { nullable: true }),
      column('email', 'text', { nullable: true }),
      column('created_at', 'timestamptz'),
      column('updated_at', 'timestamptz'),
    ],
  },
  {
    name: 'projects',
    columns: [
      column('id', 'text', { primaryKey: true }),
      column('organization_id', 'text', { references: 'organizations.id' }),
      column('name', 'text'),
      column('repository', 'text'),
      column('default_branch', 'text'),
      column('health', 'text'),
      column('knowledge_base_path', 'text'),
      column('test_command', 'text'),
      column('created_at', 'timestamptz'),
      column('updated_at', 'timestamptz'),
    ],
  },
  {
    name: 'project_members',
    columns: [
      column('project_id', 'text', { primaryKey: true, references: 'projects.id' }),
      column('user_id', 'text', { primaryKey: true, references: 'users.id' }),
      column('role', 'text'),
      column('created_at', 'timestamptz'),
    ],
  },
  {
    name: 'workflow_runs',
    columns: [
      column('id', 'text', { primaryKey: true }),
      column('organization_id', 'text', { references: 'organizations.id' }),
      column('project_id', 'text', { references: 'projects.id' }),
      column('creator_id', 'text', { references: 'users.id' }),
      column('data_origin', 'text'),
      column('title', 'text'),
      column('request', 'text'),
      column('status', 'text'),
      column('current_node_id', 'text'),
      column('branch_name', 'text'),
      column('pull_request_url', 'text', { nullable: true }),
      column('created_at', 'timestamptz'),
      column('updated_at', 'timestamptz'),
    ],
  },
  {
    name: 'workflow_nodes',
    columns: [
      column('id', 'text', { primaryKey: true }),
      column('run_id', 'text', { references: 'workflow_runs.id' }),
      column('stage', 'text'),
      column('title', 'text'),
      column('subtitle', 'text'),
      column('kind', 'text'),
      column('status', 'text'),
      column('owner_id', 'text', { references: 'users.id' }),
      column('required_role', 'text', { nullable: true }),
      column('retry_count', 'integer'),
      column('token_usage_id', 'text', { nullable: true }),
      column('position', 'integer'),
      column('created_at', 'timestamptz'),
      column('updated_at', 'timestamptz'),
    ],
  },
  {
    name: 'workflow_edges',
    columns: [
      column('id', 'text', { primaryKey: true }),
      column('run_id', 'text', { references: 'workflow_runs.id' }),
      column('source_node_id', 'text', { references: 'workflow_nodes.id' }),
      column('target_node_id', 'text', { references: 'workflow_nodes.id' }),
      column('kind', 'text'),
      column('created_at', 'timestamptz'),
    ],
  },
  {
    name: 'artifacts',
    columns: [
      column('id', 'text', { primaryKey: true }),
      column('run_id', 'text', { references: 'workflow_runs.id' }),
      column('node_id', 'text', { references: 'workflow_nodes.id' }),
      column('kind', 'text'),
      column('title', 'text'),
      column('summary', 'text'),
      column('content', 'text'),
      column('redacted', 'boolean'),
      column('updated_at', 'timestamptz'),
    ],
  },
  {
    name: 'agent_events',
    columns: [
      column('id', 'text', { primaryKey: true }),
      column('run_id', 'text', { references: 'workflow_runs.id' }),
      column('node_id', 'text', { nullable: true, references: 'workflow_nodes.id' }),
      column('sequence', 'integer'),
      column('kind', 'text'),
      column('message', 'text'),
      column('timestamp', 'timestamptz'),
    ],
  },
  {
    name: 'test_evidence_summaries',
    columns: [
      column('id', 'text', { primaryKey: true }),
      column('run_id', 'text', { references: 'workflow_runs.id' }),
      column('node_id', 'text', { references: 'workflow_nodes.id' }),
      column('project_id', 'text', { references: 'projects.id' }),
      column('command', 'text'),
      column('status', 'text'),
      column('exit_code', 'integer', { nullable: true }),
      column('duration_ms', 'integer'),
      column('summary', 'text'),
      column('redacted', 'boolean'),
      column('created_at', 'timestamptz'),
    ],
  },
  {
    name: 'mcp_server_definitions',
    columns: [
      column('id', 'text', { primaryKey: true }),
      column('organization_id', 'text', { references: 'organizations.id' }),
      column('name', 'text'),
      column('command', 'text'),
      column('permission', 'text'),
      column('enabled_by_default', 'boolean'),
      column('last_audit_event', 'text'),
      column('created_at', 'timestamptz'),
      column('updated_at', 'timestamptz'),
    ],
  },
  {
    name: 'skills',
    columns: [
      column('id', 'text', { primaryKey: true }),
      column('organization_id', 'text', { references: 'organizations.id' }),
      column('name', 'text'),
      column('stage', 'text'),
      column('description', 'text'),
      column('version', 'text'),
      column('enabled', 'boolean'),
      column('source', 'text'),
      column('created_at', 'timestamptz'),
      column('updated_at', 'timestamptz'),
    ],
  },
  {
    name: 'token_usage',
    columns: [
      column('id', 'text', { primaryKey: true }),
      column('run_id', 'text', { references: 'workflow_runs.id' }),
      column('node_id', 'text', { references: 'workflow_nodes.id' }),
      column('user_id', 'text', { references: 'users.id' }),
      column('project_id', 'text', { references: 'projects.id' }),
      column('provider', 'text'),
      column('model', 'text'),
      column('input_tokens', 'integer'),
      column('output_tokens', 'integer'),
      column('cache_read_tokens', 'integer'),
      column('cost_usd', 'numeric(12,6)'),
      column('timestamp', 'timestamptz'),
    ],
  },
  {
    name: 'agent_provider_credentials',
    columns: [
      column('organization_id', 'text', { primaryKey: true, references: 'organizations.id' }),
      column('provider_id', 'text', { primaryKey: true }),
      column('model', 'text'),
      column('base_url', 'text', { nullable: true }),
      column('masked_credential', 'text'),
      column('encrypted_secret', 'text'),
      column('updated_at', 'timestamptz'),
    ],
  },
  {
    name: 'agent_reviews',
    columns: [
      column('id', 'text', { primaryKey: true }),
      column('organization_id', 'text', { references: 'organizations.id' }),
      column('request_id', 'text'),
      column('run_id', 'text', { references: 'workflow_runs.id' }),
      column('node_id', 'text', { references: 'workflow_nodes.id' }),
      column('project_id', 'text', { references: 'projects.id' }),
      column('runtime', 'text'),
      column('provider_id', 'text'),
      column('model', 'text'),
      column('conclusion', 'text'),
      column('summary', 'text'),
      column('risks', 'jsonb'),
      column('missing_evidence', 'jsonb'),
      column('suggested_tests', 'jsonb'),
      column('knowledge_references', 'jsonb'),
      column('policy_findings', 'jsonb'),
      column('confidence', 'numeric(4,3)'),
      column('gate_advisory', 'jsonb'),
      column('created_at', 'timestamptz'),
    ],
  },
  {
    name: 'agent_traces',
    columns: [
      column('id', 'text', { primaryKey: true }),
      column('organization_id', 'text', { references: 'organizations.id' }),
      column('run_id', 'text', { references: 'workflow_runs.id' }),
      column('node_id', 'text', { references: 'workflow_nodes.id' }),
      column('review_id', 'text', { references: 'agent_reviews.id' }),
      column('runtime', 'text'),
      column('steps', 'jsonb'),
      column('created_at', 'timestamptz'),
    ],
  },
  {
    name: 'agent_token_usage',
    columns: [
      column('id', 'text', { primaryKey: true }),
      column('organization_id', 'text', { references: 'organizations.id' }),
      column('run_id', 'text', { references: 'workflow_runs.id' }),
      column('node_id', 'text', { references: 'workflow_nodes.id' }),
      column('user_id', 'text', { references: 'users.id' }),
      column('project_id', 'text', { references: 'projects.id' }),
      column('provider', 'text'),
      column('model', 'text'),
      column('input_tokens', 'integer'),
      column('output_tokens', 'integer'),
      column('cache_read_tokens', 'integer'),
      column('cost_usd', 'numeric(12,6)'),
      column('timestamp', 'timestamptz'),
      column('source', 'text'),
    ],
  },
  {
    name: 'coding_agent_summaries',
    columns: [
      column('id', 'text', { primaryKey: true }),
      column('organization_id', 'text', { references: 'organizations.id' }),
      column('run_id', 'text', { references: 'workflow_runs.id' }),
      column('node_id', 'text'),
      column('project_id', 'text', { references: 'projects.id' }),
      column('requested_by', 'text', { references: 'users.id' }),
      column('provider_id', 'text'),
      column('engine', 'text'),
      column('status', 'text'),
      column('branch_name', 'text'),
      column('summary', 'text'),
      column('changed_paths', 'jsonb'),
      column('started_at', 'timestamptz'),
      column('completed_at', 'timestamptz', { nullable: true }),
      column('redacted', 'boolean'),
    ],
  },
  {
    name: 'enforcement_policies',
    columns: [
      column('id', 'text', { primaryKey: true }),
      column('organization_id', 'text', { references: 'organizations.id' }),
      column('project_id', 'text', { nullable: true, references: 'projects.id' }),
      column('name', 'text'),
      column('version', 'integer'),
      column('policy', 'jsonb'),
      column('updated_at', 'timestamptz'),
    ],
  },
  {
    name: 'gate_override_decisions',
    columns: [
      column('id', 'text', { primaryKey: true }),
      column('organization_id', 'text', { references: 'organizations.id' }),
      column('run_id', 'text', { references: 'workflow_runs.id' }),
      column('node_id', 'text', { references: 'workflow_nodes.id' }),
      column('project_id', 'text', { references: 'projects.id' }),
      column('user_id', 'text', { references: 'users.id' }),
      column('role', 'text'),
      column('reason', 'text'),
      column('blocked_reason_ids', 'jsonb'),
      column('policy_version', 'integer'),
      column('provisional', 'boolean'),
      column('status', 'text'),
      column('created_at', 'timestamptz'),
    ],
  },
  {
    name: 'agent_policy_findings',
    columns: [
      column('id', 'text', { primaryKey: true }),
      column('organization_id', 'text', { references: 'organizations.id' }),
      column('review_id', 'text', { references: 'agent_reviews.id' }),
      column('run_id', 'text', { references: 'workflow_runs.id' }),
      column('node_id', 'text', { references: 'workflow_nodes.id' }),
      column('category', 'text'),
      column('severity', 'text'),
      column('summary', 'text'),
      column('evidence_ids', 'jsonb'),
      column('knowledge_reference_ids', 'jsonb'),
      column('created_at', 'timestamptz'),
    ],
  },
]
