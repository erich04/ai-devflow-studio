import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  TEAM_SCHEMA_VERSION,
  requiredTeamTableNames,
  teamTableDefinitions,
} from './schema'
import {
  migrationChecksum,
  readTeamMigrationCatalog,
  teamMigrationCatalog,
} from './migrate'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const migrationPath = path.join(currentDir, 'migrations', '0001_initial.sql')

describe('team database schema', () => {
  it('defines the team source-of-truth tables', () => {
    expect(TEAM_SCHEMA_VERSION).toBe(8)
    expect(requiredTeamTableNames).toEqual([
      'team_schema_migrations',
      'schema_meta',
      'organizations',
      'users',
      'auth_accounts',
      'desktop_pairing_codes',
      'desktop_tokens',
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
      'runtime_budget_policies',
      'runtime_budget_approvals',
      'agent_policy_findings',
      'work_requests',
      'collaboration_idempotency',
      'collaboration_audit_events',
      'gate_commands',
      'gate_command_receipts',
      'gate_command_acknowledgements',
    ])

    expect(teamTableDefinitions.map((table) => table.name)).toEqual(requiredTeamTableNames)
  })

  it('defines desktop pairing tables without storing copy-once codes or tokens in plaintext', () => {
    const pairingCodes = teamTableDefinitions.find((table) => table.name === 'desktop_pairing_codes')
    const desktopTokens = teamTableDefinitions.find((table) => table.name === 'desktop_tokens')

    expect(pairingCodes?.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'id',
        'organization_id',
        'project_id',
        'created_by_user_id',
        'code_hash',
        'expires_at',
        'consumed_at',
        'failed_attempts',
      ]),
    )
    expect(pairingCodes?.columns.map((column) => column.name)).not.toEqual(
      expect.arrayContaining(['code', 'secret']),
    )
    expect(desktopTokens?.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'id',
        'organization_id',
        'project_id',
        'user_id',
        'token_hash',
        'created_at',
        'last_used_at',
        'revoked_at',
      ]),
    )
    expect(desktopTokens?.columns.map((column) => column.name)).not.toEqual(
      expect.arrayContaining(['token', 'secret']),
    )
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
      expect.arrayContaining([
        'id',
        'run_version',
        'organization_id',
        'project_id',
        'creator_id',
        'data_origin',
      ]),
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

  it('keeps the V1.3 v7 baseline migration frozen', async () => {
    const sql = await readFile(migrationPath, 'utf8')
    const v14TableNames = new Set([
      'team_schema_migrations',
      'work_requests',
      'collaboration_idempotency',
      'collaboration_audit_events',
      'gate_commands',
      'gate_command_receipts',
      'gate_command_acknowledgements',
    ])

    for (const tableName of requiredTeamTableNames.filter((name) => !v14TableNames.has(name))) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${tableName}`)
    }

    expect(migrationChecksum(sql)).toBe(
      'c91dc2cc4ef9afce16e4b208e2b40880e9b0b886a3cad89c0822ba64b2bb45c7',
    )
    expect(sql).toContain("schema_version', '7'")
    expect(sql).toContain('ON CONFLICT')
    expect(sql).not.toContain('/tmp')
    expect(sql).not.toContain('bash')
    expect(sql).not.toContain('zsh')
  })

  it('adds the V1.4 work authority schema only through migration v8', async () => {
    expect(teamMigrationCatalog).toEqual([
      { version: 7, name: '0001_initial', fileName: '0001_initial.sql' },
      {
        version: 8,
        name: '0008_v14_work_authority',
        fileName: '0008_v14_work_authority.sql',
      },
    ])

    const migrations = await readTeamMigrationCatalog()
    const migration = migrations.find((candidate) => candidate.version === 8)
    expect(migration?.sql).toContain('ADD COLUMN run_version integer NOT NULL DEFAULT 1')
    for (const tableName of [
      'work_requests',
      'collaboration_idempotency',
      'collaboration_audit_events',
      'gate_commands',
      'gate_command_receipts',
      'gate_command_acknowledgements',
    ]) {
      expect(migration?.sql).toContain(`CREATE TABLE ${tableName}`)
    }
    expect(migration?.sql).not.toMatch(
      /\b(?:cookie|bearer_token|token_hash|token_secret|raw_(?:prompt|output|evidence))\s+(?:text|jsonb|bytea)\b/i,
    )
  })

  it('defines bounded Work Request, idempotency, audit, and Gate delivery records', () => {
    const workRequests = teamTableDefinitions.find((table) => table.name === 'work_requests')
    const idempotency = teamTableDefinitions.find(
      (table) => table.name === 'collaboration_idempotency',
    )
    const audit = teamTableDefinitions.find(
      (table) => table.name === 'collaboration_audit_events',
    )
    const commands = teamTableDefinitions.find((table) => table.name === 'gate_commands')
    const receipts = teamTableDefinitions.find(
      (table) => table.name === 'gate_command_receipts',
    )
    const acknowledgements = teamTableDefinitions.find(
      (table) => table.name === 'gate_command_acknowledgements',
    )

    expect(workRequests?.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'id',
        'organization_id',
        'project_id',
        'version',
        'status',
        'claimed_by_token_id',
        'claimed_run_id',
        'materialized_at',
      ]),
    )
    expect(idempotency?.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'operation_kind',
        'idempotency_key',
        'request_fingerprint',
        'response_json',
      ]),
    )
    expect(audit?.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['auth_kind', 'auth_token_record_id', 'outcome_code']),
    )
    expect(commands?.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'expected_run_version',
        'expected_policy_version',
        'expected_blocker_ids',
        'status',
        'expires_at',
      ]),
    )
    expect(receipts?.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['command_id', 'attempt', 'leased_to_token_id', 'lease_expires_at']),
    )
    expect(acknowledgements?.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['receipt_id', 'outcome_code', 'before_run_version', 'after_run_version']),
    )
    expect(
      JSON.stringify([
        workRequests,
        idempotency,
        audit,
        commands,
        receipts,
        acknowledgements,
      ]),
    ).not.toMatch(
      /cookie|bearer_token|token_secret|raw_(?:prompt|output|evidence)/i,
    )
  })
})
