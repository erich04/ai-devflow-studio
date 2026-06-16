export const TEAM_SCHEMA_VERSION = 1

export const requiredTeamTableNames = [
  'schema_meta',
  'organizations',
  'users',
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
      column('role', 'text'),
      column('avatar_initials', 'text'),
      column('focus', 'text'),
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
]
