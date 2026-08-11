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
    expect(TEAM_SCHEMA_VERSION).toBe(11)
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
      'released_work_request_claims',
      'github_repository_bindings',
      'github_delivery_requests',
      'github_delivery_approvals',
      'github_delivery_credential_grants',
      'github_branch_publications',
      'github_pull_request_outcomes',
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
      'released_work_request_claims',
      'github_repository_bindings',
      'github_delivery_requests',
      'github_delivery_approvals',
      'github_delivery_credential_grants',
      'github_branch_publications',
      'github_pull_request_outcomes',
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

  it('adds the V1.4 work authority schema through immutable incremental migrations', async () => {
    expect(teamMigrationCatalog).toEqual([
      { version: 7, name: '0001_initial', fileName: '0001_initial.sql' },
      {
        version: 8,
        name: '0008_v14_work_authority',
        fileName: '0008_v14_work_authority.sql',
      },
      {
        version: 9,
        name: '0009_harden_work_request_timeline',
        fileName: '0009_harden_work_request_timeline.sql',
      },
      {
        version: 10,
        name: '0010_harden_gate_command_delivery',
        fileName: '0010_harden_gate_command_delivery.sql',
      },
      {
        version: 11,
        name: '0011_github_delivery',
        fileName: '0011_github_delivery.sql',
      },
      {
        version: 12,
        name: '0012_github_delivery_attempts',
        fileName: '0012_github_delivery_attempts.sql',
      },
    ])

    const migrations = await readTeamMigrationCatalog()
    const migrationV8 = migrations.find((candidate) => candidate.version === 8)
    const migrationV9 = migrations.find((candidate) => candidate.version === 9)
    const migrationV10 = migrations.find((candidate) => candidate.version === 10)
    const migrationV11 = migrations.find((candidate) => candidate.version === 11)
    const migrationV12 = migrations.find((candidate) => candidate.version === 12)
    expect(migrationChecksum(migrationV8?.sql ?? '')).toBe(
      '630b28be579566ceeafd52353c30394d8182f256c1b787ec3780bb44c94992e5',
    )
    expect(migrationV8?.sql).toContain('ADD COLUMN run_version integer NOT NULL DEFAULT 1')
    for (const tableName of [
      'work_requests',
      'collaboration_idempotency',
      'collaboration_audit_events',
      'gate_commands',
      'gate_command_receipts',
      'gate_command_acknowledgements',
    ]) {
      expect(migrationV8?.sql).toContain(`CREATE TABLE ${tableName}`)
    }
    expect(migrationV8?.sql).not.toMatch(
      /\b(?:cookie|bearer_token|token_hash|token_secret|raw_(?:prompt|output|evidence))\s+(?:text|jsonb|bytea)\b/i,
    )
    expect(migrationV9?.sql).toContain(
      'DROP CONSTRAINT work_requests_time_order',
    )
    expect(migrationV9?.sql).toContain("status <> 'expired' OR expires_at IS NOT NULL")
    expect(migrationV9?.sql).toContain('claimed_at < expires_at')
    expect(migrationV9?.sql).toContain('updated_at >= claimed_at')
    expect(migrationV9?.sql).toContain('updated_at >= materialized_at')
    expect(migrationV10?.sql).toContain(
      'ADD COLUMN version integer NOT NULL DEFAULT 1',
    )
    expect(migrationV10?.sql).toContain('ADD COLUMN evaluated_at timestamptz')
    expect(migrationV10?.sql).toContain('SET evaluated_at = created_at')
    expect(migrationV10?.sql).toContain('ALTER COLUMN evaluated_at SET NOT NULL')
    expect(migrationChecksum(migrationV10?.sql ?? '')).toBe(
      '1de25f1b785f0b0c384d8bc5475040563812f9c8dd38f5b486aeb807296ae312',
    )
    for (const tableName of [
      'github_repository_bindings',
      'github_delivery_requests',
      'github_delivery_approvals',
      'github_delivery_credential_grants',
      'github_branch_publications',
      'github_pull_request_outcomes',
    ]) {
      expect(migrationV11?.sql).toContain(`CREATE TABLE ${tableName}`)
    }
    expect(migrationV11?.sql).toContain('github_repository_bindings_one_active_project')
    expect(migrationV11?.sql).toContain('github_repository_bindings_one_active_repository')
    expect(migrationV11?.sql).toContain('github_delivery_requests_logical_key_unique')
    expect(migrationV11?.sql).toContain('github_delivery_requests_one_active_target')
    expect(migrationV11?.sql).toContain(
      'github_delivery_workflow_runs_scope_unique',
    )
    expect(migrationV11?.sql).toContain(
      'FOREIGN KEY (organization_id, project_id, run_id)',
    )
    expect(migrationV11?.sql).toContain(
      'REFERENCES workflow_runs(organization_id, project_id, id)',
    )
    expect(migrationV11?.sql).toContain("strpos(current_item.value #>> '{}', chr(92)) > 0")
    expect(migrationV11?.sql).toContain("'github_delivery_approve'")
    expect(migrationV11?.sql).toContain("'github_credential_grant'")
    expect(migrationV11?.sql).toContain(
      'FOREIGN KEY (request_id, intent_revision, approval_id, repository_id)',
    )
    expect(migrationV11?.sql).toContain(
      'FOREIGN KEY (request_id, intent_revision, grant_id)',
    )
    expect(migrationV11?.sql).toContain(
      "WHERE status IN ('issuing', 'issued', 'recovery_required')",
    )
    expect(migrationChecksum(migrationV11?.sql ?? '')).toBe(
      '999174b7b188947963a23640620f0a4c325afe9485a5f9e3ce63b282a4b15198',
    )
    expect(migrationV11?.sql).not.toMatch(
      /\b(?:token|token_hash|private_key|credential|worktree_path|raw_diff|stdout|stderr)\s+(?:text|jsonb|bytea)\b/i,
    )
    expect(migrationV12?.sql).toContain('ADD COLUMN delivery_series_key text')
    expect(migrationV12?.sql).toContain('ADD COLUMN delivery_attempt integer')
    expect(migrationV12?.sql).toContain(
      'UNIQUE (organization_id, project_id, delivery_series_key, delivery_attempt)',
    )
    expect(migrationV12?.sql).not.toMatch(/^\s*(?:DELETE FROM|TRUNCATE TABLE)\b/im)
  })

  it('defines GitHub delivery authority without persisting credentials or local execution data', () => {
    const bindings = teamTableDefinitions.find(
      (table) => table.name === 'github_repository_bindings',
    )
    const requests = teamTableDefinitions.find(
      (table) => table.name === 'github_delivery_requests',
    )
    const approvals = teamTableDefinitions.find(
      (table) => table.name === 'github_delivery_approvals',
    )
    const grants = teamTableDefinitions.find(
      (table) => table.name === 'github_delivery_credential_grants',
    )
    const publications = teamTableDefinitions.find(
      (table) => table.name === 'github_branch_publications',
    )
    const outcomes = teamTableDefinitions.find(
      (table) => table.name === 'github_pull_request_outcomes',
    )

    expect(bindings?.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'id',
        'version',
        'organization_id',
        'project_id',
        'installation_id',
        'repository_id',
        'full_name',
        'default_branch',
        'status',
        'configured_by_user_id',
      ]),
    )
    expect(requests?.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'id',
        'state_version',
        'intent_revision',
        'organization_id',
        'project_id',
        'run_id',
        'node_id',
        'binding_id',
        'binding_version',
        'requested_by_token_id',
        'status',
        'expected_run_version',
        'head_branch',
        'base_branch',
        'expected_commit_sha',
        'intent_digest',
        'delivery_series_key',
        'delivery_attempt',
        'logical_idempotency_key',
        'diff_digest',
        'test_evidence_digest',
        'package_digest',
        'pr_title',
        'pr_body',
      ]),
    )
    expect(approvals?.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'id',
        'request_id',
        'intent_revision',
        'intent_digest',
        'approved_by_user_id',
        'approved_role',
        'auth_kind',
        'approved_at',
      ]),
    )
    expect(grants?.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'id',
        'request_id',
        'intent_revision',
        'approval_id',
        'issued_to_token_id',
        'requested_at',
        'credential_expires_at',
        'status',
      ]),
    )
    expect(publications?.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'id',
        'request_id',
        'intent_revision',
        'grant_id',
        'status',
        'verified_head_sha',
        'reported_at',
        'verified_at',
      ]),
    )
    expect(outcomes?.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'id',
        'request_id',
        'intent_revision',
        'publication_id',
        'status',
        'pull_request_number',
        'safe_url',
        'draft',
        'head_sha',
      ]),
    )

    for (const table of [bindings, requests, approvals, grants, publications, outcomes]) {
      expect(table?.columns.map((column) => column.name)).not.toEqual(
        expect.arrayContaining([
          'token',
          'token_hash',
          'private_key',
          'credential',
          'worktree_path',
          'raw_diff',
          'stdout',
          'stderr',
        ]),
      )
    }
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
        'version',
        'expected_run_version',
        'expected_policy_version',
        'expected_blocker_ids',
        'evaluated_at',
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

  it('hardens versioned Gate Commands with bounded safe lifecycle data', async () => {
    const migrationV10 = (await readTeamMigrationCatalog()).find(
      (candidate) => candidate.version === 10,
    )
    const sql = migrationV10?.sql ?? ''

    expect(sql).toContain('gate_command_blocker_ids_are_bounded')
    expect(sql).toContain('jsonb_array_length(blocker_ids) > 100')
    expect(sql).toContain(
      "char_length(current_item.value #>> '{}') NOT BETWEEN 1 AND 200",
    )
    expect(sql).toContain('gate_commands_version_positive')
    expect(sql).toContain('gate_commands_identifiers_bounded')
    expect(sql).toContain('gate_commands_local_node_namespace')
    expect(sql).toContain(
      "left(node_id, char_length(run_id) + 1) <> run_id || ':'",
    )
    expect(sql).not.toContain("node_id NOT LIKE run_id || ':%'")
    expect(sql).toContain('char_length(reason) <= 2000')
    expect(sql).toContain("requested_role IN ('owner', 'lead', 'member')")
    expect(sql).toContain('gate_commands_versions_bounded')
    expect(sql).toContain('expected_policy_version >= 0')
    expect(sql).toContain("evaluation_status IN ('allowed', 'blocked')")
    expect(sql).toMatch(
      /UPDATE gate_commands\s+SET evaluation_status = 'blocked',[\s\S]*WHERE evaluation_status = 'denied'/,
    )
    expect(sql).toContain('jsonb_array_length(evaluation_blocker_ids) > 0')
    expect(sql).toContain("outcome_code = 'authorization_denied'")
    expect(sql).toContain('version = version + 1')
    expect(sql).toContain('gate_commands_evaluation_shape')
    expect(sql).toContain('gate_commands_allowed_blocker_binding')
    expect(sql).toMatch(
      /evaluation_status <> 'allowed'\s+OR expected_blocker_ids = evaluation_blocker_ids/,
    )
    expect(sql).toContain('gate_commands_lifecycle')
    expect(sql).toContain('gate_commands_time_order')
    expect(sql).toContain('evaluated_at <= created_at')
    expect(sql).toContain(
      "expires_at <= created_at + interval '15 minutes'",
    )
    expect(sql).toContain("status = 'expired' AND outcome_code = 'expired'")

    for (const outcomeCode of [
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
      'authorization_denied',
    ]) {
      expect(sql).toContain(`'${outcomeCode}'`)
    }

    expect(sql).not.toMatch(
      /\b(?:cookie|bearer_token|token_hash|token_secret|raw_(?:prompt|output|evidence))\s+(?:text|jsonb|bytea)\b/i,
    )
  })

  it('catalogs released Work Request claims as durable Run authority tombstones', async () => {
    const releasedClaims = teamTableDefinitions.find(
      (table) => table.name === 'released_work_request_claims',
    )
    expect(releasedClaims?.columns.map((column) => column.name)).toEqual([
      'organization_id',
      'project_id',
      'work_request_id',
      'run_id',
      'claimed_by_token_id',
      'released_by_user_id',
      'released_claim_version',
      'released_at',
    ])

    const migrationV10 = (await readTeamMigrationCatalog()).find(
      (candidate) => candidate.version === 10,
    )
    const sql = migrationV10?.sql ?? ''
    expect(sql).toContain('CREATE TABLE released_work_request_claims')
    expect(sql).toContain('PRIMARY KEY (organization_id, project_id, run_id)')
    expect(sql).toContain(
      'claimed_by_token_id text NOT NULL REFERENCES desktop_tokens(id) ON DELETE RESTRICT',
    )
    expect(sql).toContain('released_work_request_claims_request_idx')
  })

  it('permits allowed Gate evaluations to retain canonical blocker context', async () => {
    const migrationV10 = (await readTeamMigrationCatalog()).find(
      (candidate) => candidate.version === 10,
    )
    const sql = migrationV10?.sql ?? ''

    expect(sql).toMatch(
      /ADD CONSTRAINT gate_commands_evaluation_shape CHECK \(\s*\(\s*evaluation_status = 'allowed'\s*\)\s*OR \(\s*evaluation_status = 'blocked'\s*AND jsonb_array_length\(evaluation_blocker_ids\) > 0\s*AND status = 'rejected'\s*\)\s*\)/,
    )
  })

  it('rejects duplicate or descending Gate blocker IDs at the database boundary', async () => {
    const migrationV10 = (await readTeamMigrationCatalog()).find(
      (candidate) => candidate.version === 10,
    )
    const sql = migrationV10?.sql ?? ''

    expect(sql).toContain(
      'WITH ORDINALITY AS current_item(value, ordinal)',
    )
    expect(sql).toContain(
      'WITH ORDINALITY AS previous_item(value, ordinal)',
    )
    expect(sql).toContain(
      'previous_item.ordinal = current_item.ordinal - 1',
    )
    expect(sql).toContain(
      "previous_item.value #>> '{}' >= current_item.value #>> '{}'",
    )
  })

  it('accepts Gate Command browser writes only from session-cookie auth', async () => {
    const migrationV10 = (await readTeamMigrationCatalog()).find(
      (candidate) => candidate.version === 10,
    )
    const sql = migrationV10?.sql ?? ''

    expect(sql).toContain('DROP CONSTRAINT gate_commands_auth')
    expect(sql).toMatch(
      /ADD CONSTRAINT gate_commands_browser_write_auth CHECK \(\s*auth_kind = 'session_cookie'\s*AND auth_token_record_id IS NULL\s*\)/,
    )
  })

  it('hardens Gate receipt leases and permits one version-safe terminal acknowledgement', async () => {
    const migrationV10 = (await readTeamMigrationCatalog()).find(
      (candidate) => candidate.version === 10,
    )
    const sql = migrationV10?.sql ?? ''

    expect(sql).toContain('gate_command_receipts_identifiers_bounded')
    expect(sql).toContain('attempt BETWEEN 1 AND 2147483647')
    expect(sql).toContain('gate_command_receipts_time_order')
    expect(sql).toContain('lease_expires_at > leased_at')
    expect(sql).toContain(
      "lease_expires_at <= leased_at + interval '60 seconds'",
    )
    expect(sql).toContain('UNIQUE (command_id, id)')
    expect(sql).toContain('gate_command_acknowledgements_identifiers_bounded')
    expect(sql).toContain(
      'DROP CONSTRAINT gate_command_acknowledgements_check',
    )
    expect(sql).not.toContain(
      'DROP CONSTRAINT gate_command_acknowledgements_after_run_version_check',
    )
    expect(sql).toContain('gate_command_acknowledgements_outcome_safe')
    expect(sql).toContain('gate_command_acknowledgements_version_shape')
    expect(sql).toMatch(
      /outcome_code = 'applied'\s+AND after_run_version::bigint = before_run_version::bigint \+ 1/,
    )
    expect(sql).toMatch(
      /outcome_code <> 'applied'\s+AND after_run_version = before_run_version/,
    )
    expect(sql).toContain('gate_command_acknowledgements_time_order')
    expect(sql).toContain(
      "evaluated_at <= created_at + interval '60 seconds'",
    )
    expect(sql).toContain(
      "outcome_code <> 'expired' OR evaluated_at <= created_at",
    )
    expect(sql).toContain('UNIQUE (command_id)')
    expect(sql).toContain('FOREIGN KEY (command_id, receipt_id)')
    expect(sql).toContain('REFERENCES gate_command_receipts(command_id, id)')
    expect(sql).toContain('gate_commands_active_target_version_unique')
    expect(sql).toContain('gate_commands_inbox_idx')
    expect(sql).toContain('gate_command_receipts_delivery_idx')
  })
})
