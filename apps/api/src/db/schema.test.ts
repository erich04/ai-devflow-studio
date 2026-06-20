import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  TEAM_SCHEMA_VERSION,
  requiredTeamTableNames,
  teamTableDefinitions,
} from './schema'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const migrationPath = path.join(currentDir, 'migrations', '0001_initial.sql')

describe('team database schema', () => {
  it('defines the team source-of-truth tables', () => {
    expect(TEAM_SCHEMA_VERSION).toBe(5)
    expect(requiredTeamTableNames).toEqual([
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
    ])

    expect(teamTableDefinitions.map((table) => table.name)).toEqual(requiredTeamTableNames)
  })

  it('defines identity tables without replacing project_members', () => {
    const users = teamTableDefinitions.find((table) => table.name === 'users')
    const authAccounts = teamTableDefinitions.find((table) => table.name === 'auth_accounts')
    const projectMembers = teamTableDefinitions.find((table) => table.name === 'project_members')

    expect(users?.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['id', 'organization_id', 'name', 'email', 'avatar_url', 'role']),
    )
    expect(authAccounts?.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'id',
        'user_id',
        'provider',
        'provider_account_id',
        'username',
        'email',
      ]),
    )
    expect(projectMembers?.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['project_id', 'user_id', 'role']),
    )
  })

  it('defines project metadata for authenticated team project creation', () => {
    const projects = teamTableDefinitions.find((table) => table.name === 'projects')

    expect(projects?.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['id', 'organization_id', 'name', 'slug', 'description', 'repository']),
    )
  })

  it('keeps remote workflow state separate from private local execution details', () => {
    const runs = teamTableDefinitions.find((table) => table.name === 'workflow_runs')
    const evidence = teamTableDefinitions.find((table) => table.name === 'test_evidence_summaries')

    expect(runs?.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['id', 'organization_id', 'project_id', 'creator_id', 'data_origin']),
    )
    expect(evidence?.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'id',
        'run_id',
        'node_id',
        'project_id',
        'command',
        'status',
        'duration_ms',
        'redacted',
      ]),
    )
    expect(evidence?.columns.map((column) => column.name)).not.toEqual(
      expect.arrayContaining(['cwd', 'stdout', 'stderr']),
    )
  })

  it('ships an idempotent initial Postgres migration for every table', async () => {
    const sql = await readFile(migrationPath, 'utf8')

    for (const tableName of requiredTeamTableNames) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${tableName}`)
    }

    expect(sql).toContain(`schema_version', '${TEAM_SCHEMA_VERSION}'`)
    expect(sql).toContain('ON CONFLICT')
    expect(sql).not.toContain('/tmp')
    expect(sql).not.toContain('bash')
    expect(sql).not.toContain('zsh')
  })
})
