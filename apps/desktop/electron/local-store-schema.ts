import type { Database } from 'sql.js'
import type { LocalSettings } from '@ai-devflow/shared'

export const CURRENT_SCHEMA_VERSION = 32
export const DEFAULT_LOCAL_SETTINGS: LocalSettings = { themePreference: 'system' }

export type SchemaMigration = {
  version: number
  migrate(db: Database, hooks: LocalStoreSchemaHooks): void
}

export type LocalStoreSchemaHooks = {
  migrateWorkflowRunsIntoRelationalTables(db: Database): void
  afterMigrations(db: Database): void
}

export const schemaMigrations: readonly SchemaMigration[] = [
  {
    version: 1,
    migrate(db) {
      db.run(`
    create table if not exists schema_meta (
      key text primary key,
      value text not null
    );

    create table if not exists local_projects (
      id text primary key,
      json text not null,
      created_at text not null,
      updated_at text not null
    );

    create table if not exists workflow_runs (
      id text primary key,
      json text not null,
      created_at text not null,
      updated_at text not null
    );

    create table if not exists artifacts (
      id text primary key,
      run_id text not null,
      json text not null,
      updated_at text not null
    );

    create table if not exists agent_events (
      id text primary key,
      run_id text not null,
      sequence integer not null,
      json text not null,
      timestamp text not null
    );

    create table if not exists test_evidence (
      id text primary key,
      run_id text not null,
      node_id text not null,
      project_id text not null,
      json text not null,
      created_at text not null
    );
      `)
    },
  },
  {
    version: 2,
    migrate(db) {
      db.run(`
    create table if not exists local_settings (
      key text primary key,
      json text not null,
      updated_at text not null
    );

    create table if not exists mcp_servers (
      id text primary key,
      json text not null,
      updated_at text not null
    );

    insert into local_settings (key, json, updated_at)
    values ('settings', '${JSON.stringify(DEFAULT_LOCAL_SETTINGS)}', datetime('now'))
    on conflict(key) do nothing;
      `)
    },
  },
  {
    version: 3,
    migrate(db) {
      db.run(`

    create table if not exists agent_reviews (
      id text primary key,
      run_id text not null,
      node_id text not null,
      json text not null,
      created_at text not null
    );

    create table if not exists agent_traces (
      id text primary key,
      run_id text not null,
      node_id text not null,
      review_id text not null,
      json text not null,
      created_at text not null
    );

    create table if not exists agent_token_usage (
      id text primary key,
      run_id text not null,
      node_id text not null,
      json text not null,
      timestamp text not null
    );

    create table if not exists provider_credentials (
      provider_id text primary key,
      json text not null,
      encrypted_secret text not null,
      updated_at text not null
    );
      `)
    },
  },
  {
    version: 4,
    migrate(db) {
      db.run(`

    create table if not exists coding_agent_runs (
      id text primary key,
      run_id text not null,
      node_id text not null,
      json text not null,
      started_at text not null,
      updated_at text not null
    );

    create table if not exists coding_agent_events (
      id text primary key,
      coding_run_id text not null,
      run_id text not null,
      node_id text not null,
      sequence integer not null,
      json text not null,
      timestamp text not null
    );

    create table if not exists coding_permission_requests (
      id text primary key,
      coding_run_id text not null,
      run_id text not null,
      node_id text not null,
      json text not null,
      requested_at text not null
    );

    create table if not exists coding_permission_decisions (
      id text primary key,
      request_id text not null,
      coding_run_id text not null,
      json text not null,
      decided_at text not null
    );

    create table if not exists managed_coding_workspaces (
      id text primary key,
      project_id text not null,
      coding_run_id text not null,
      json text not null,
      created_at text not null
    );

    create table if not exists dependency_bootstrap_evidence (
      id text primary key,
      coding_run_id text not null,
      run_id text not null,
      node_id text not null,
      project_id text not null,
      json text not null,
      created_at text not null
    );

    create table if not exists coding_diff_artifacts (
      id text primary key,
      run_id text not null,
      node_id text not null,
      project_id text not null,
      json text not null,
      created_at text not null
    );
      `)
    },
  },
  {
    version: 5,
    migrate(db) {
      db.run(`

    create table if not exists policy_snapshots (
      project_id text primary key,
      json text not null,
      synced_at text not null
    );

    create table if not exists gate_overrides (
      id text primary key,
      run_id text not null,
      node_id text not null,
      json text not null,
      created_at text not null
    );
      `)
    },
  },
  {
    version: 6,
    migrate(db) {
      db.run(`

    create table if not exists retry_attempts (
      id text primary key,
      run_id text not null,
      node_id text not null,
      json text not null,
      created_at text not null
    );
      `)
    },
  },
  {
    version: 7,
    migrate(db) {
      db.run(`

    create table if not exists desktop_pairing_credentials (
      id text primary key,
      json text not null,
      encrypted_token text not null,
      updated_at text not null
    );
      `)
    },
  },
  {
    version: 8,
    migrate(db, hooks) {
      db.run(`

    create table if not exists workflow_nodes (
      id text primary key,
      run_id text not null references workflow_runs(id) on delete cascade,
      stage text not null,
      title text not null,
      subtitle text not null,
      kind text not null,
      status text not null,
      owner_id text not null,
      required_role text,
      retry_count integer not null default 0,
      token_usage_id text,
      artifact_ids text not null default '[]',
      position integer not null default 0,
      json text not null,
      created_at text not null,
      updated_at text not null
    );

    create table if not exists workflow_edges (
      id text primary key,
      run_id text not null references workflow_runs(id) on delete cascade,
      source_node_id text not null,
      target_node_id text not null,
      kind text not null,
      position integer not null default 0,
      json text not null,
      created_at text not null
    );

    create index if not exists idx_workflow_nodes_run_id_position
      on workflow_nodes(run_id, position);

    create index if not exists idx_workflow_edges_run_id_position
      on workflow_edges(run_id, position);
      `)
      hooks.migrateWorkflowRunsIntoRelationalTables(db)
    },
  },
  {
    version: 9,
    migrate(db) {
      db.run(`

    create table if not exists remote_sync_outbox (
      id text primary key,
      kind text not null,
      local_project_id text not null,
      organization_id text,
      team_project_id text,
      run_id text not null,
      entity_id text not null,
      idempotency_key text not null unique,
      status text not null,
      generation integer not null,
      attempt_count integer not null,
      next_attempt_at text,
      lease_expires_at text,
      last_attempt_at text,
      last_error_code text,
      last_error_message text,
      recovery text not null,
      completed_at text,
      created_at text not null,
      updated_at text not null,
      check (kind in (
        'run-summary', 'test-evidence-summary', 'agent-review-summary',
        'coding-agent-summary', 'agent-runtime-summary'
      )),
      check (status in ('pending', 'sending', 'retry-scheduled', 'completed', 'terminal')),
      check (generation >= 1),
      check (attempt_count >= 0),
      check (
        (status = 'sending' and lease_expires_at is not null) or
        (status <> 'sending' and lease_expires_at is null)
      ),
      check (
        (organization_id is null and team_project_id is null) or
        (organization_id is not null and team_project_id is not null)
      )
    );

    create index if not exists idx_remote_sync_outbox_due
      on remote_sync_outbox(status, next_attempt_at, created_at);
      `)
    },
  },
  {
    version: 10,
    migrate(db) {
      db.run(`

    create table if not exists work_request_materializations (
      work_request_id text primary key,
      organization_id text not null,
      team_project_id text not null,
      local_project_id text not null,
      run_id text not null unique references workflow_runs(id) on delete restrict,
      claim_version integer not null,
      source_fingerprint text not null,
      materialize_idempotency_key text not null unique,
      status text not null,
      acknowledged_version integer,
      created_at text not null,
      updated_at text not null,
      acknowledged_at text,
      check (length(trim(work_request_id)) > 0 and trim(work_request_id) = work_request_id),
      check (length(trim(organization_id)) > 0 and trim(organization_id) = organization_id),
      check (length(trim(team_project_id)) > 0 and trim(team_project_id) = team_project_id),
      check (length(trim(local_project_id)) > 0 and trim(local_project_id) = local_project_id),
      check (length(trim(run_id)) > 0 and trim(run_id) = run_id),
      check (claim_version > 0),
      check (
        length(source_fingerprint) = 64 and
        source_fingerprint not glob '*[^0-9a-f]*'
      ),
      check (
        length(trim(materialize_idempotency_key)) > 0 and
        length(materialize_idempotency_key) <= 200 and
        trim(materialize_idempotency_key) = materialize_idempotency_key
      ),
      check (status in ('pending_ack', 'acknowledged')),
      check (updated_at >= created_at),
      check (
        (status = 'pending_ack' and acknowledged_version is null and acknowledged_at is null) or
        (status = 'acknowledged' and acknowledged_version = claim_version + 1 and acknowledged_at is not null)
      )
    );

    create index if not exists idx_work_request_materializations_pending
      on work_request_materializations(status, updated_at, work_request_id);

    create index if not exists idx_work_request_materializations_run_id
      on work_request_materializations(run_id);
      `)
    },
  },
  {
    version: 11,
    migrate(db) {
      db.run(`

    create table if not exists gate_command_executions (
      command_id text primary key,
      organization_id text not null,
      team_project_id text not null,
      local_project_id text not null,
      claim_token_id text not null,
      work_request_id text,
      run_id text not null,
      node_id text not null,
      action text not null,
      workflow_command text,
      requested_by_user_id text not null,
      requested_role text not null,
      server_request_fingerprint text not null,
      execution_fingerprint text not null,
      expected_run_version integer not null,
      expected_policy_version integer not null,
      expected_blocker_ids_hash text not null,
      outcome_code text not null,
      before_run_version integer not null,
      after_run_version integer not null,
      evaluated_at text not null,
      command_expires_at text not null,
      created_at text not null,
      check (length(trim(command_id)) > 0 and length(command_id) <= 200 and trim(command_id) = command_id),
      check (length(trim(organization_id)) > 0 and length(organization_id) <= 200 and trim(organization_id) = organization_id),
      check (length(trim(team_project_id)) > 0 and length(team_project_id) <= 200 and trim(team_project_id) = team_project_id),
      check (length(trim(local_project_id)) > 0 and length(local_project_id) <= 200 and trim(local_project_id) = local_project_id),
      check (length(trim(claim_token_id)) > 0 and length(claim_token_id) <= 200 and trim(claim_token_id) = claim_token_id),
      check (work_request_id is null or (length(trim(work_request_id)) > 0 and length(work_request_id) <= 200 and trim(work_request_id) = work_request_id)),
      check (length(trim(run_id)) > 0 and length(run_id) <= 200 and trim(run_id) = run_id),
      check (length(trim(node_id)) > 0 and length(node_id) <= 200 and trim(node_id) = node_id),
      check (
        (action = 'approve' and workflow_command in ('approve_gate', 'approve_acceptance')) or
        (action = 'reject' and workflow_command is null)
      ),
      check (requested_role in ('owner', 'lead', 'member')),
      check (
        length(server_request_fingerprint) = 64 and
        server_request_fingerprint not glob '*[^0-9a-f]*'
      ),
      check (
        length(execution_fingerprint) = 64 and
        execution_fingerprint not glob '*[^0-9a-f]*'
      ),
      check (
        length(expected_blocker_ids_hash) = 64 and
        expected_blocker_ids_hash not glob '*[^0-9a-f]*'
      ),
      check (expected_run_version between 1 and 2147483647),
      check (expected_policy_version between 0 and 2147483647),
      check (before_run_version between 1 and 2147483647),
      check (after_run_version between 1 and 2147483647),
      check (outcome_code in (
        'applied', 'human_rejected', 'requester_revoked', 'expired',
        'scope_mismatch', 'run_not_found', 'stale_run', 'stale_policy',
        'blockers_changed', 'evidence_blocked', 'authorization_denied'
      )),
      check (
        (outcome_code = 'applied' and action = 'approve' and
          before_run_version = expected_run_version and
          after_run_version = before_run_version + 1) or
        (outcome_code = 'human_rejected' and action = 'reject' and
          before_run_version = expected_run_version and
          after_run_version = before_run_version) or
        (outcome_code not in ('applied', 'human_rejected') and
          after_run_version = before_run_version)
      ),
      check (command_expires_at > created_at),
      check (
        (julianday(command_expires_at) - julianday(created_at)) * 86400.0 <= 900.0001
      ),
      check (evaluated_at >= created_at)
    );

    create table if not exists gate_command_receipts (
      receipt_id text primary key,
      command_id text not null references gate_command_executions(command_id) on delete restrict,
      attempt integer not null,
      leased_at text not null,
      lease_expires_at text not null,
      acknowledged_at text,
      received_at text not null,
      check (length(trim(receipt_id)) > 0 and length(receipt_id) <= 200 and trim(receipt_id) = receipt_id),
      check (attempt between 1 and 2147483647),
      check (lease_expires_at > leased_at),
      check (
        (julianday(lease_expires_at) - julianday(leased_at)) * 86400.0 <= 60.0001
      ),
      check (acknowledged_at is null or acknowledged_at >= leased_at),
      check (received_at >= leased_at),
      unique (command_id, attempt),
      unique (receipt_id, command_id)
    );

    create index if not exists idx_gate_command_receipts_command
      on gate_command_receipts(command_id, attempt, leased_at);

    create table if not exists gate_command_acknowledgements (
      receipt_id text primary key references gate_command_receipts(receipt_id) on delete restrict,
      command_id text not null references gate_command_executions(command_id) on delete restrict,
      outcome_code text not null,
      before_run_version integer not null,
      after_run_version integer not null,
      evaluated_at text not null,
      status text not null,
      remote_acknowledgement_id text,
      remote_created_at text,
      remote_replayed integer,
      created_at text not null,
      acknowledged_at text,
      failure_code text,
      failed_at text,
      check (outcome_code in (
        'applied', 'human_rejected', 'requester_revoked', 'expired',
        'scope_mismatch', 'run_not_found', 'stale_run', 'stale_policy',
        'blockers_changed', 'evidence_blocked', 'authorization_denied'
      )),
      check (before_run_version between 1 and 2147483647),
      check (after_run_version between 1 and 2147483647),
      check (status in ('pending', 'acknowledged', 'terminal')),
      check (failure_code is null or failure_code in (
        'bad_request', 'unauthorized', 'forbidden', 'not_found', 'conflict',
        'scope_mismatch', 'remote_error'
      )),
      check (failed_at is null or failed_at >= created_at),
      check (
        (status = 'pending' and remote_acknowledgement_id is null and
          remote_created_at is null and remote_replayed is null and
          acknowledged_at is null and failure_code is null and failed_at is null) or
        (status = 'acknowledged' and remote_acknowledgement_id is not null and
          remote_created_at is not null and remote_replayed in (0, 1) and
          acknowledged_at is not null and failure_code is null and failed_at is null) or
        (status = 'terminal' and remote_acknowledgement_id is null and
          remote_created_at is null and remote_replayed is null and
          acknowledged_at is null and failure_code is not null and failed_at is not null)
      ),
      unique (remote_acknowledgement_id),
      foreign key (receipt_id, command_id)
        references gate_command_receipts(receipt_id, command_id) on delete restrict
    );

    create index if not exists idx_gate_command_acknowledgements_pending
      on gate_command_acknowledgements(status, created_at, receipt_id);
      `)
    },
  },
  {
    version: 12,
    migrate(db) {
      db.run(`

    create table if not exists gate_command_receipt_observations (
      receipt_id text primary key,
      command_id text not null,
      attempt integer not null,
      leased_at text not null,
      lease_expires_at text not null,
      received_at text not null,
      organization_id text not null,
      team_project_id text not null,
      local_project_id text not null,
      work_request_id text,
      run_id text not null,
      node_id text not null,
      claim_token_id text not null,
      execution_fingerprint text not null,
      status text not null,
      outcome_code text,
      evaluated_at text,
      check (length(trim(receipt_id)) > 0 and length(receipt_id) <= 200 and trim(receipt_id) = receipt_id),
      check (length(trim(command_id)) > 0 and length(command_id) <= 200 and trim(command_id) = command_id),
      check (attempt between 1 and 2147483647),
      check (lease_expires_at > leased_at),
      check (
        (julianday(lease_expires_at) - julianday(leased_at)) * 86400.0 <= 60.0001
      ),
      check (received_at >= leased_at),
      check (length(trim(organization_id)) > 0 and length(organization_id) <= 200 and trim(organization_id) = organization_id),
      check (length(trim(team_project_id)) > 0 and length(team_project_id) <= 200 and trim(team_project_id) = team_project_id),
      check (length(trim(local_project_id)) > 0 and length(local_project_id) <= 200 and trim(local_project_id) = local_project_id),
      check (work_request_id is null or (length(trim(work_request_id)) > 0 and length(work_request_id) <= 200 and trim(work_request_id) = work_request_id)),
      check (length(trim(run_id)) > 0 and length(run_id) <= 200 and trim(run_id) = run_id),
      check (length(trim(node_id)) > 0 and length(node_id) <= 200 and trim(node_id) = node_id),
      check (length(trim(claim_token_id)) > 0 and length(claim_token_id) <= 200 and trim(claim_token_id) = claim_token_id),
      check (
        length(execution_fingerprint) = 64 and
        execution_fingerprint not glob '*[^0-9a-f]*'
      ),
      check (status in ('received', 'evaluated')),
      check (outcome_code is null or outcome_code in (
        'applied', 'human_rejected', 'requester_revoked', 'expired',
        'scope_mismatch', 'run_not_found', 'stale_run', 'stale_policy',
        'blockers_changed', 'evidence_blocked', 'authorization_denied'
      )),
      check (
        (status = 'received' and outcome_code is null and evaluated_at is null) or
        (status = 'evaluated' and outcome_code is not null and
          evaluated_at is not null and evaluated_at >= received_at)
      ),
      unique (command_id, attempt)
    );

    create index if not exists idx_gate_command_receipt_observations_command
      on gate_command_receipt_observations(command_id, attempt, received_at);

    insert into gate_command_receipt_observations (
      receipt_id, command_id, attempt, leased_at, lease_expires_at, received_at,
      organization_id, team_project_id, local_project_id, work_request_id,
      run_id, node_id, claim_token_id, execution_fingerprint,
      status, outcome_code, evaluated_at
    )
    select
      receipt.receipt_id, receipt.command_id, receipt.attempt,
      receipt.leased_at, receipt.lease_expires_at, receipt.received_at,
      execution.organization_id, execution.team_project_id,
      execution.local_project_id, execution.work_request_id,
      execution.run_id, execution.node_id, execution.claim_token_id,
      execution.execution_fingerprint, 'evaluated', execution.outcome_code,
      receipt.received_at
    from gate_command_receipts as receipt
    join gate_command_executions as execution
      on execution.command_id = receipt.command_id;
      `)
    },
  },
  {
    version: 13,
    migrate(db) {
      db.run(`
    create table if not exists github_repository_bindings (
      id text primary key,
      organization_id text not null,
      team_project_id text not null,
      installation_id text not null,
      repository_id text not null,
      version integer not null,
      status text not null,
      json text not null,
      updated_at text not null,
      check (length(trim(id)) > 0 and length(id) <= 200 and trim(id) = id),
      check (length(trim(organization_id)) > 0 and length(organization_id) <= 200 and trim(organization_id) = organization_id),
      check (length(trim(team_project_id)) > 0 and length(team_project_id) <= 200 and trim(team_project_id) = team_project_id),
      check (installation_id glob '[1-9]*' and installation_id not glob '*[^0-9]*' and length(installation_id) <= 20),
      check (repository_id glob '[1-9]*' and repository_id not glob '*[^0-9]*' and length(repository_id) <= 20),
      check (version between 1 and 2147483647),
      check (status in ('active', 'stale', 'revoked')),
      check (json_valid(json)),
      check (json_extract(json, '$.id') = id),
      check (json_extract(json, '$.organizationId') = organization_id),
      check (json_extract(json, '$.teamProjectId') = team_project_id),
      check (json_extract(json, '$.installationId') = installation_id),
      check (json_extract(json, '$.repositoryId') = repository_id),
      check (json_extract(json, '$.version') = version),
      check (json_extract(json, '$.status') = status),
      check (json_extract(json, '$.redacted') = 1)
    );

    create unique index if not exists idx_github_repository_bindings_active_project
      on github_repository_bindings(team_project_id)
      where status = 'active';

    create table if not exists github_delivery_intents (
      id text primary key,
      organization_id text not null,
      team_project_id text not null,
      local_project_id text not null,
      run_id text not null,
      node_id text not null,
      repository_binding_id text not null,
      repository_binding_version integer not null,
      installation_id text not null,
      repository_id text not null,
      coding_run_id text not null,
      workspace_id text not null,
      diff_artifact_id text not null,
      test_evidence_id text not null,
      pr_package_artifact_id text not null,
      base_commit_sha text not null,
      expected_commit_sha text not null,
      intent_digest text not null unique,
      idempotency_key text not null unique,
      status text not null,
      state_version integer not null,
      json text not null,
      created_at text not null,
      updated_at text not null,
      check (length(trim(id)) > 0 and length(id) <= 200 and trim(id) = id),
      check (length(trim(organization_id)) > 0 and length(organization_id) <= 200 and trim(organization_id) = organization_id),
      check (length(trim(team_project_id)) > 0 and length(team_project_id) <= 200 and trim(team_project_id) = team_project_id),
      check (length(trim(local_project_id)) > 0 and length(local_project_id) <= 200 and trim(local_project_id) = local_project_id),
      check (length(trim(run_id)) > 0 and length(run_id) <= 200 and trim(run_id) = run_id),
      check (length(trim(node_id)) > 0 and length(node_id) <= 200 and trim(node_id) = node_id),
      check (length(trim(repository_binding_id)) > 0 and length(repository_binding_id) <= 200 and trim(repository_binding_id) = repository_binding_id),
      check (repository_binding_version between 1 and 2147483647),
      check (installation_id glob '[1-9]*' and installation_id not glob '*[^0-9]*' and length(installation_id) <= 20),
      check (repository_id glob '[1-9]*' and repository_id not glob '*[^0-9]*' and length(repository_id) <= 20),
      check (length(trim(coding_run_id)) > 0 and length(coding_run_id) <= 200 and trim(coding_run_id) = coding_run_id),
      check (length(trim(workspace_id)) > 0 and length(workspace_id) <= 200 and trim(workspace_id) = workspace_id),
      check (length(trim(diff_artifact_id)) > 0 and length(diff_artifact_id) <= 200 and trim(diff_artifact_id) = diff_artifact_id),
      check (length(trim(test_evidence_id)) > 0 and length(test_evidence_id) <= 200 and trim(test_evidence_id) = test_evidence_id),
      check (length(trim(pr_package_artifact_id)) > 0 and length(pr_package_artifact_id) <= 200 and trim(pr_package_artifact_id) = pr_package_artifact_id),
      check (
        length(base_commit_sha) in (40, 64) and
        base_commit_sha not glob '*[^0-9a-f]*'
      ),
      check (
        length(expected_commit_sha) in (40, 64) and
        expected_commit_sha not glob '*[^0-9a-f]*' and
        expected_commit_sha <> base_commit_sha
      ),
      check (
        length(intent_digest) = 64 and
        intent_digest not glob '*[^0-9a-f]*'
      ),
      check (
        length(idempotency_key) = 80 and
        substr(idempotency_key, 1, 16) = 'github-delivery:' and
        substr(idempotency_key, 17) not glob '*[^0-9a-f]*'
      ),
      check (status in (
        'approval_required', 'approved', 'publishing_branch',
        'branch_published', 'creating_pr', 'completed', 'failed',
        'recovery_required', 'revoked'
      )),
      check (state_version = 1),
      check (json_valid(json)),
      check (json_extract(json, '$.id') = id),
      check (json_extract(json, '$.organizationId') = organization_id),
      check (json_extract(json, '$.teamProjectId') = team_project_id),
      check (json_extract(json, '$.localProjectId') = local_project_id),
      check (json_extract(json, '$.runId') = run_id),
      check (json_extract(json, '$.nodeId') = node_id),
      check (json_extract(json, '$.repositoryBindingId') = repository_binding_id),
      check (json_extract(json, '$.repositoryBindingVersion') = repository_binding_version),
      check (json_extract(json, '$.installationId') = installation_id),
      check (json_extract(json, '$.repositoryId') = repository_id),
      check (json_extract(json, '$.codingRunId') = coding_run_id),
      check (json_extract(json, '$.workspaceId') = workspace_id),
      check (json_extract(json, '$.diffArtifactId') = diff_artifact_id),
      check (json_extract(json, '$.testEvidenceId') = test_evidence_id),
      check (json_extract(json, '$.prPackageArtifactId') = pr_package_artifact_id),
      check (json_extract(json, '$.stateVersion') = state_version),
      check (json_extract(json, '$.intentDigest') = intent_digest),
      check (json_extract(json, '$.idempotencyKey') = idempotency_key),
      check (json_extract(json, '$.status') = status),
      check (json_extract(json, '$.redacted') = 1),
      check (updated_at >= created_at)
    );

    create index if not exists idx_github_delivery_intents_run
      on github_delivery_intents(run_id, created_at, id);

    create index if not exists idx_github_delivery_intents_status
      on github_delivery_intents(status, updated_at, id);

    create unique index if not exists idx_github_delivery_intents_active_scope
      on github_delivery_intents(run_id, node_id)
      where status in (
        'approval_required', 'approved', 'publishing_branch',
        'branch_published', 'creating_pr', 'recovery_required'
      );
      `)
    },
  },
  {
    version: 14,
    migrate(db) {
      db.run(`
    create table if not exists github_delivery_operator_outcomes (
      intent_id text primary key,
      intent_updated_at text not null,
      outcome_code text not null,
      state_version integer not null,
      json text not null,
      recorded_at text not null,
      check (length(trim(intent_id)) > 0 and length(intent_id) <= 200 and trim(intent_id) = intent_id),
      check (outcome_code in (
        'invalid_delivery_source', 'operation_cancelled',
        'publisher_cleanup_failed', 'remote_branch_diverged',
        'remote_unavailable', 'repository_mismatch', 'push_result_unknown',
        'workspace_dirty', 'workspace_mismatch'
      )),
      check (state_version = 1),
      check (json_valid(json)),
      check (json_extract(json, '$.stateVersion') = state_version),
      check (json_extract(json, '$.intentId') = intent_id),
      check (json_extract(json, '$.intentUpdatedAt') = intent_updated_at),
      check (json_extract(json, '$.outcomeCode') = outcome_code),
      check (json_extract(json, '$.recordedAt') = recorded_at),
      check (json_extract(json, '$.redacted') = 1)
    );

    create index if not exists idx_github_delivery_operator_outcomes_recorded
      on github_delivery_operator_outcomes(recorded_at, intent_id);
      `)
    },
  },
  {
    version: 15,
    migrate(db) {
      db.run(`
    alter table github_delivery_intents rename to github_delivery_intents_v14;

    drop index idx_github_delivery_intents_run;
    drop index idx_github_delivery_intents_status;
    drop index idx_github_delivery_intents_active_scope;

    create table github_delivery_intents (
      id text primary key,
      organization_id text not null,
      team_project_id text not null,
      local_project_id text not null,
      run_id text not null,
      node_id text not null,
      repository_binding_id text not null,
      repository_binding_version integer not null,
      installation_id text not null,
      repository_id text not null,
      coding_run_id text not null,
      workspace_id text not null,
      diff_artifact_id text not null,
      test_evidence_id text not null,
      pr_package_artifact_id text not null,
      base_commit_sha text not null,
      expected_commit_sha text not null,
      intent_digest text not null unique,
      idempotency_key text not null,
      delivery_series_key text not null,
      delivery_attempt integer not null,
      status text not null,
      state_version integer not null,
      json text not null,
      created_at text not null,
      updated_at text not null,
      check (length(trim(id)) > 0 and length(id) <= 200 and trim(id) = id),
      check (length(trim(organization_id)) > 0 and length(organization_id) <= 200 and trim(organization_id) = organization_id),
      check (length(trim(team_project_id)) > 0 and length(team_project_id) <= 200 and trim(team_project_id) = team_project_id),
      check (length(trim(local_project_id)) > 0 and length(local_project_id) <= 200 and trim(local_project_id) = local_project_id),
      check (length(trim(run_id)) > 0 and length(run_id) <= 200 and trim(run_id) = run_id),
      check (length(trim(node_id)) > 0 and length(node_id) <= 200 and trim(node_id) = node_id),
      check (length(trim(repository_binding_id)) > 0 and length(repository_binding_id) <= 200 and trim(repository_binding_id) = repository_binding_id),
      check (repository_binding_version between 1 and 2147483647),
      check (installation_id glob '[1-9]*' and installation_id not glob '*[^0-9]*' and length(installation_id) <= 20),
      check (repository_id glob '[1-9]*' and repository_id not glob '*[^0-9]*' and length(repository_id) <= 20),
      check (length(trim(coding_run_id)) > 0 and length(coding_run_id) <= 200 and trim(coding_run_id) = coding_run_id),
      check (length(trim(workspace_id)) > 0 and length(workspace_id) <= 200 and trim(workspace_id) = workspace_id),
      check (length(trim(diff_artifact_id)) > 0 and length(diff_artifact_id) <= 200 and trim(diff_artifact_id) = diff_artifact_id),
      check (length(trim(test_evidence_id)) > 0 and length(test_evidence_id) <= 200 and trim(test_evidence_id) = test_evidence_id),
      check (length(trim(pr_package_artifact_id)) > 0 and length(pr_package_artifact_id) <= 200 and trim(pr_package_artifact_id) = pr_package_artifact_id),
      check (
        length(base_commit_sha) in (40, 64) and
        base_commit_sha not glob '*[^0-9a-f]*'
      ),
      check (
        length(expected_commit_sha) in (40, 64) and
        expected_commit_sha not glob '*[^0-9a-f]*' and
        expected_commit_sha <> base_commit_sha
      ),
      check (
        length(intent_digest) = 64 and
        intent_digest not glob '*[^0-9a-f]*'
      ),
      check (
        length(idempotency_key) = 80 and
        substr(idempotency_key, 1, 16) = 'github-delivery:' and
        substr(idempotency_key, 17) not glob '*[^0-9a-f]*'
      ),
      check (
        length(delivery_series_key) = 80 and
        substr(delivery_series_key, 1, 16) = 'github-delivery:' and
        substr(delivery_series_key, 17) not glob '*[^0-9a-f]*'
      ),
      check (delivery_attempt between 1 and 2147483647),
      check (status in (
        'approval_required', 'approved', 'publishing_branch',
        'branch_published', 'creating_pr', 'completed', 'failed',
        'recovery_required', 'revoked'
      )),
      check (state_version = 1),
      check (json_valid(json)),
      check (json_extract(json, '$.id') = id),
      check (json_extract(json, '$.organizationId') = organization_id),
      check (json_extract(json, '$.teamProjectId') = team_project_id),
      check (json_extract(json, '$.localProjectId') = local_project_id),
      check (json_extract(json, '$.runId') = run_id),
      check (json_extract(json, '$.nodeId') = node_id),
      check (json_extract(json, '$.repositoryBindingId') = repository_binding_id),
      check (json_extract(json, '$.repositoryBindingVersion') = repository_binding_version),
      check (json_extract(json, '$.installationId') = installation_id),
      check (json_extract(json, '$.repositoryId') = repository_id),
      check (json_extract(json, '$.codingRunId') = coding_run_id),
      check (json_extract(json, '$.workspaceId') = workspace_id),
      check (json_extract(json, '$.diffArtifactId') = diff_artifact_id),
      check (json_extract(json, '$.testEvidenceId') = test_evidence_id),
      check (json_extract(json, '$.prPackageArtifactId') = pr_package_artifact_id),
      check (json_extract(json, '$.stateVersion') = state_version),
      check (json_extract(json, '$.intentDigest') = intent_digest),
      check (json_extract(json, '$.idempotencyKey') = idempotency_key),
      check (json_extract(json, '$.deliverySeriesKey') = delivery_series_key),
      check (json_extract(json, '$.deliveryAttempt') = delivery_attempt),
      check (json_extract(json, '$.status') = status),
      check (json_extract(json, '$.redacted') = 1),
      check (updated_at >= created_at)
    );

    insert into github_delivery_intents (
      id, organization_id, team_project_id, local_project_id,
      run_id, node_id, repository_binding_id, repository_binding_version,
      installation_id, repository_id, coding_run_id, workspace_id,
      diff_artifact_id, test_evidence_id, pr_package_artifact_id,
      base_commit_sha, expected_commit_sha, intent_digest, idempotency_key,
      delivery_series_key, delivery_attempt, status, state_version, json,
      created_at, updated_at
    )
    select
      id, organization_id, team_project_id, local_project_id,
      run_id, node_id, repository_binding_id, repository_binding_version,
      installation_id, repository_id, coding_run_id, workspace_id,
      diff_artifact_id, test_evidence_id, pr_package_artifact_id,
      base_commit_sha, expected_commit_sha, intent_digest, idempotency_key,
      coalesce(json_extract(json, '$.deliverySeriesKey'), idempotency_key),
      coalesce(json_extract(json, '$.deliveryAttempt'), 1),
      status, state_version,
      json_set(
        json,
        '$.deliverySeriesKey', coalesce(json_extract(json, '$.deliverySeriesKey'), idempotency_key),
        '$.deliveryAttempt', coalesce(json_extract(json, '$.deliveryAttempt'), 1)
      ),
      created_at, updated_at
    from github_delivery_intents_v14;

    drop table github_delivery_intents_v14;

    create index idx_github_delivery_intents_run
      on github_delivery_intents(run_id, created_at, id);

    create index idx_github_delivery_intents_status
      on github_delivery_intents(status, updated_at, id);

    create index idx_github_delivery_intents_idempotency
      on github_delivery_intents(idempotency_key, created_at, id);

    create unique index idx_github_delivery_intents_active_scope
      on github_delivery_intents(run_id, node_id)
      where status in (
        'approval_required', 'approved', 'publishing_branch',
        'branch_published', 'creating_pr', 'recovery_required'
      );
      `)
    },
  },
  {
    version: 16,
    migrate(db) {
      db.run(`
    create table if not exists github_delivery_revocation_checks (
      intent_id text primary key,
      intent_updated_at text not null,
      binding_id text not null,
      binding_version integer not null,
      outcome_code text not null,
      checked_at text not null,
      state_version integer not null,
      json text not null,
      check (length(trim(intent_id)) > 0 and length(intent_id) <= 200 and trim(intent_id) = intent_id),
      check (length(trim(binding_id)) > 0 and length(binding_id) <= 200 and trim(binding_id) = binding_id),
      check (binding_version between 1 and 2147483647),
      check (outcome_code = 'binding_inactive'),
      check (state_version = 1),
      check (json_valid(json)),
      check (json_extract(json, '$.stateVersion') = state_version),
      check (json_extract(json, '$.intentId') = intent_id),
      check (json_extract(json, '$.intentUpdatedAt') = intent_updated_at),
      check (json_extract(json, '$.bindingId') = binding_id),
      check (json_extract(json, '$.bindingVersion') = binding_version),
      check (json_extract(json, '$.outcomeCode') = outcome_code),
      check (json_extract(json, '$.checkedAt') = checked_at),
      check (json_extract(json, '$.redacted') = 1)
    );

    create index if not exists idx_github_delivery_revocation_checks_checked
      on github_delivery_revocation_checks(checked_at, intent_id);
      `)
    },
  },
  {
    version: 17,
    migrate(db) {
      db.run(`
    drop table if exists github_delivery_revocation_checks;

    create table github_delivery_revocation_checks (
      intent_id text primary key,
      intent_updated_at text not null,
      binding_id text not null,
      binding_version integer not null,
      outcome_code text not null,
      checked_at text not null,
      state_version integer not null,
      json text not null,
      check (length(trim(intent_id)) > 0 and length(intent_id) <= 200 and trim(intent_id) = intent_id),
      check (length(trim(binding_id)) > 0 and length(binding_id) <= 200 and trim(binding_id) = binding_id),
      check (binding_version between 1 and 2147483647),
      check (outcome_code = 'binding_inactive'),
      check (state_version = 2),
      check (json_valid(json)),
      check (json_extract(json, '$.stateVersion') = state_version),
      check (json_extract(json, '$.intentId') = intent_id),
      check (json_extract(json, '$.intentUpdatedAt') = intent_updated_at),
      check (json_extract(json, '$.bindingId') = binding_id),
      check (json_extract(json, '$.bindingVersion') = binding_version),
      check (json_extract(json, '$.outcomeCode') = outcome_code),
      check (json_extract(json, '$.checkedAt') = checked_at),
      check (json_extract(json, '$.redacted') = 1)
    );

    create index idx_github_delivery_revocation_checks_checked
      on github_delivery_revocation_checks(checked_at, intent_id);
      `)
    },
  },
  {
    version: 18,
    migrate(db) {
      db.run(`
    create table agent_runtimes (
      id text primary key,
      scope_kind text not null,
      organization_id text,
      team_project_id text,
      user_id text not null,
      session_id text not null,
      local_project_id text not null,
      run_id text not null,
      node_id text not null,
      run_version integer not null,
      policy_version integer not null,
      context_digest text not null,
      capability_set_digest text not null,
      status text not null,
      stop_reason text,
      version integer not null,
      checkpoint_version integer not null,
      next_sequence integer not null,
      state_version integer not null,
      json text not null,
      requested_at text not null,
      started_at text not null,
      updated_at text not null,
      deadline text not null,
      check (length(trim(id)) > 0 and length(id) <= 200 and trim(id) = id),
      check (scope_kind in ('team', 'local')),
      check (
        (scope_kind = 'team' and organization_id is not null and team_project_id is not null) or
        (scope_kind = 'local' and organization_id is null and team_project_id is null)
      ),
      check (length(trim(user_id)) > 0 and length(user_id) <= 200 and trim(user_id) = user_id),
      check (length(trim(session_id)) > 0 and length(session_id) <= 200 and trim(session_id) = session_id),
      check (length(trim(local_project_id)) > 0 and length(local_project_id) <= 200 and trim(local_project_id) = local_project_id),
      check (length(trim(run_id)) > 0 and length(run_id) <= 200 and trim(run_id) = run_id),
      check (length(trim(node_id)) > 0 and length(node_id) <= 200 and trim(node_id) = node_id),
      check (run_version between 1 and 2147483647),
      check (policy_version between 1 and 2147483647),
      check (length(context_digest) = 64 and context_digest not glob '*[^0-9a-f]*'),
      check (length(capability_set_digest) = 64 and capability_set_digest not glob '*[^0-9a-f]*'),
      check (status in ('running', 'waiting_permission', 'waiting_action', 'checkpointed', 'terminal')),
      check (stop_reason is null or stop_reason in (
        'success', 'failure', 'cancelled', 'timeout',
        'step_limit', 'budget_exhausted', 'policy_denied'
      )),
      check ((status = 'terminal') = (stop_reason is not null)),
      check (version between 1 and 2147483647),
      check (checkpoint_version = version),
      check (next_sequence between 4 and 2147483647),
      check (state_version = 1),
      check (json_valid(json)),
      check (json_extract(json, '$.stateVersion') = state_version),
      check (json_extract(json, '$.id') = id),
      check (json_extract(json, '$.scope.kind') = scope_kind),
      check (json_extract(json, '$.scope.organizationId') is organization_id),
      check (json_extract(json, '$.scope.projectId') is team_project_id),
      check (json_extract(json, '$.scope.userId') = user_id),
      check (json_extract(json, '$.scope.sessionId') = session_id),
      check (json_extract(json, '$.scope.localProjectId') = local_project_id),
      check (json_extract(json, '$.authority.runId') = run_id),
      check (json_extract(json, '$.authority.nodeId') = node_id),
      check (json_extract(json, '$.authority.runVersion') = run_version),
      check (json_extract(json, '$.authority.policyVersion') = policy_version),
      check (json_extract(json, '$.contextDigest') = context_digest),
      check (json_extract(json, '$.capabilitySetDigest') = capability_set_digest),
      check (json_extract(json, '$.status') = status),
      check (json_extract(json, '$.stopReason') is stop_reason),
      check (json_extract(json, '$.version') = version),
      check (json_extract(json, '$.checkpointVersion') = checkpoint_version),
      check (json_extract(json, '$.nextSequence') = next_sequence),
      check (requested_at = json_extract(json, '$.requestedAt')),
      check (started_at = json_extract(json, '$.startedAt')),
      check (updated_at = json_extract(json, '$.updatedAt')),
      check (deadline = json_extract(json, '$.deadline')),
      check (started_at = requested_at and updated_at >= started_at and deadline > requested_at)
    );

    create index idx_agent_runtimes_run
      on agent_runtimes(run_id, node_id, updated_at, id);

    create index idx_agent_runtimes_recovery
      on agent_runtimes(status, updated_at, id);

    create table agent_runtime_events (
      runtime_id text not null,
      sequence integer not null,
      checkpoint_version integer not null,
      type text not null,
      state_version integer not null,
      json text not null,
      created_at text not null,
      primary key (runtime_id, sequence),
      foreign key (runtime_id) references agent_runtimes(id) on delete cascade,
      check (length(trim(runtime_id)) > 0 and length(runtime_id) <= 200 and trim(runtime_id) = runtime_id),
      check (sequence between 1 and 2147483647),
      check (checkpoint_version between 1 and 2147483647),
      check (type in (
        'runtime_started', 'context_attached', 'runtime_resumed',
        'decision_recorded', 'action_requested', 'permission_decided',
        'action_result', 'observation_recorded', 'evaluation_recorded',
        'checkpointed', 'runtime_stopped'
      )),
      check (state_version = 1),
      check (json_valid(json)),
      check (json_extract(json, '$.stateVersion') = state_version),
      check (json_extract(json, '$.runtimeId') = runtime_id),
      check (json_extract(json, '$.sequence') = sequence),
      check (json_extract(json, '$.checkpointVersion') = checkpoint_version),
      check (json_extract(json, '$.type') = type),
      check (json_extract(json, '$.createdAt') = created_at)
    );

    create index idx_agent_runtime_events_checkpoint
      on agent_runtime_events(runtime_id, checkpoint_version, sequence);

    create table agent_runtime_checkpoints (
      runtime_id text not null,
      version integer not null,
      runtime_version integer not null,
      status text not null,
      stop_reason text,
      state_version integer not null,
      json text not null,
      created_at text not null,
      primary key (runtime_id, version),
      unique (runtime_id, runtime_version),
      foreign key (runtime_id) references agent_runtimes(id) on delete cascade,
      check (version between 1 and 2147483647),
      check (runtime_version between 1 and 2147483647),
      check (status in ('running', 'waiting_permission', 'waiting_action', 'checkpointed', 'terminal')),
      check (stop_reason is null or stop_reason in (
        'success', 'failure', 'cancelled', 'timeout',
        'step_limit', 'budget_exhausted', 'policy_denied'
      )),
      check ((status = 'terminal') = (stop_reason is not null)),
      check (state_version = 1),
      check (json_valid(json)),
      check (json_extract(json, '$.stateVersion') = state_version),
      check (json_extract(json, '$.runtimeId') = runtime_id),
      check (json_extract(json, '$.version') = version),
      check (json_extract(json, '$.runtimeVersion') = runtime_version),
      check (json_extract(json, '$.status') = status),
      check (json_extract(json, '$.stopReason') is stop_reason),
      check (json_extract(json, '$.createdAt') = created_at)
    );

    create table agent_runtime_evaluations (
      runtime_id text not null,
      sequence integer not null,
      checkpoint_version integer not null,
      evaluation text not null,
      summary text not null,
      event_json text not null,
      created_at text not null,
      primary key (runtime_id, sequence),
      foreign key (runtime_id, sequence)
        references agent_runtime_events(runtime_id, sequence) on delete cascade,
      check (evaluation in ('continue', 'success', 'failure')),
      check (length(summary) between 1 and 2000),
      check (json_valid(event_json)),
      check (json_extract(event_json, '$.type') = 'evaluation_recorded'),
      check (json_extract(event_json, '$.metadata.evaluation') = evaluation),
      check (json_extract(event_json, '$.metadata.summary') = summary),
      check (json_extract(event_json, '$.checkpointVersion') = checkpoint_version),
      check (json_extract(event_json, '$.createdAt') = created_at)
    );

    create table agent_runtime_capability_grants (
      id text primary key,
      runtime_id text not null,
      capability_id text not null,
      capability_version integer not null,
      request_digest text not null,
      status text not null,
      granted_at text not null,
      expires_at text not null,
      settled_at text,
      foreign key (runtime_id) references agent_runtimes(id) on delete cascade,
      check (length(trim(id)) > 0 and length(id) <= 200 and trim(id) = id),
      check (length(trim(capability_id)) > 0 and length(capability_id) <= 200 and trim(capability_id) = capability_id),
      check (capability_version between 1 and 2147483647),
      check (length(request_digest) = 64 and request_digest not glob '*[^0-9a-f]*'),
      check (status in ('active', 'consumed', 'denied', 'expired', 'cancelled')),
      check (expires_at > granted_at),
      check ((status = 'active') = (settled_at is null))
    );

    create unique index idx_agent_runtime_capability_grants_active
      on agent_runtime_capability_grants(runtime_id, capability_id)
      where status = 'active';

    create table agent_runtime_terminal_summaries (
      runtime_id text primary key,
      checkpoint_version integer not null,
      stop_reason text not null,
      state_version integer not null,
      json text not null,
      completed_at text not null,
      foreign key (runtime_id) references agent_runtimes(id) on delete cascade,
      check (checkpoint_version between 1 and 2147483647),
      check (stop_reason in (
        'success', 'failure', 'cancelled', 'timeout',
        'step_limit', 'budget_exhausted', 'policy_denied'
      )),
      check (state_version = 1),
      check (json_valid(json)),
      check (json_extract(json, '$.stateVersion') = state_version),
      check (json_extract(json, '$.runtimeId') = runtime_id),
      check (json_extract(json, '$.checkpointVersion') = checkpoint_version),
      check (json_extract(json, '$.stopReason') = stop_reason),
      check (json_extract(json, '$.completedAt') = completed_at),
      check (json_extract(json, '$.redacted') = 1)
    );
      `)
    },
  },
  {
    version: 19,
    migrate(db) {
      db.run(`
    alter table agent_runtime_capability_grants
      add column permission_class text check (permission_class in ('read', 'edit', 'execute'));
    alter table agent_runtime_capability_grants
      add column resource_kind text check (resource_kind in ('local_project', 'managed_workspace'));
    alter table agent_runtime_capability_grants
      add column resource_id text check (
        resource_id is null or
        (length(trim(resource_id)) > 0 and length(resource_id) <= 200 and trim(resource_id) = resource_id)
      );

    create table agent_runtime_tool_audits (
      id text primary key,
      runtime_id text not null,
      action_id text not null,
      grant_id text not null,
      organization_id text,
      team_project_id text,
      user_id text not null,
      session_id text not null,
      local_project_id text not null,
      tool_id text not null,
      tool_version integer not null,
      permission_class text not null,
      side_effect_class text not null,
      resource_kind text not null,
      resource_id text not null,
      status text not null,
      code text,
      input_digest text not null,
      result_digest text,
      result_bytes integer,
      redaction_state text not null,
      state_version integer not null,
      json text not null,
      created_at text not null,
      foreign key (runtime_id) references agent_runtimes(id) on delete cascade,
      foreign key (grant_id) references agent_runtime_capability_grants(id) on delete cascade,
      check (length(trim(id)) > 0 and length(id) <= 200 and trim(id) = id),
      check (length(trim(action_id)) > 0 and length(action_id) <= 200 and trim(action_id) = action_id),
      check (
        (organization_id is null and team_project_id is null) or
        (organization_id is not null and team_project_id is not null)
      ),
      check (length(trim(user_id)) > 0 and length(user_id) <= 200 and trim(user_id) = user_id),
      check (length(trim(session_id)) > 0 and length(session_id) <= 200 and trim(session_id) = session_id),
      check (length(trim(local_project_id)) > 0 and length(local_project_id) <= 200 and trim(local_project_id) = local_project_id),
      check (length(trim(tool_id)) > 0 and length(tool_id) <= 200 and trim(tool_id) = tool_id),
      check (tool_version between 1 and 2147483647),
      check (permission_class in ('read', 'edit', 'execute')),
      check (side_effect_class in ('none', 'workspace_write', 'local_process')),
      check (resource_kind in ('local_project', 'managed_workspace')),
      check (length(trim(resource_id)) > 0 and length(resource_id) <= 200 and trim(resource_id) = resource_id),
      check (status in ('started', 'succeeded', 'failed', 'cancelled', 'timeout')),
      check (code is null or code in (
        'invalid_output', 'result_too_large', 'redaction_failed',
        'handler_failed', 'deadline_exceeded', 'cancelled'
      )),
      check (length(input_digest) = 64 and input_digest not glob '*[^0-9a-f]*'),
      check (result_digest is null or (length(result_digest) = 64 and result_digest not glob '*[^0-9a-f]*')),
      check (result_bytes is null or result_bytes between 0 and 262144),
      check (redaction_state in ('not_recorded', 'passed', 'applied', 'failed')),
      check (state_version = 1),
      check (json_valid(json)),
      check (json_extract(json, '$.stateVersion') = state_version),
      check (json_extract(json, '$.id') = id),
      check (json_extract(json, '$.runtimeId') = runtime_id),
      check (json_extract(json, '$.actionId') = action_id),
      check (json_extract(json, '$.grantId') = grant_id),
      check (json_extract(json, '$.organizationId') is organization_id),
      check (json_extract(json, '$.projectId') is team_project_id),
      check (json_extract(json, '$.userId') = user_id),
      check (json_extract(json, '$.sessionId') = session_id),
      check (json_extract(json, '$.localProjectId') = local_project_id),
      check (json_extract(json, '$.toolId') = tool_id),
      check (json_extract(json, '$.toolVersion') = tool_version),
      check (json_extract(json, '$.permissionClass') = permission_class),
      check (json_extract(json, '$.sideEffectClass') = side_effect_class),
      check (json_extract(json, '$.resourceKind') = resource_kind),
      check (json_extract(json, '$.resourceId') = resource_id),
      check (json_extract(json, '$.status') = status),
      check (json_extract(json, '$.code') is code),
      check (json_extract(json, '$.inputDigest') = input_digest),
      check (json_extract(json, '$.resultDigest') is result_digest),
      check (json_extract(json, '$.resultBytes') is result_bytes),
      check (json_extract(json, '$.redactionState') = redaction_state),
      check (json_extract(json, '$.createdAt') = created_at)
    );

    create unique index idx_agent_runtime_tool_audits_started
      on agent_runtime_tool_audits(grant_id) where status = 'started';

    create unique index idx_agent_runtime_tool_audits_terminal
      on agent_runtime_tool_audits(grant_id) where status <> 'started';

    create index idx_agent_runtime_tool_audits_runtime
      on agent_runtime_tool_audits(runtime_id, created_at, id);
      `)
    },
  },
  {
    version: 20,
    migrate(db) {
      db.run(`
    update agent_runtime_tool_audits
       set json = json_set(
         json,
         '$.source', 'native',
         '$.installationId', json('null'),
         '$.installationVersion', json('null')
       );

    alter table agent_runtime_tool_audits
      add column source text not null default 'native'
      check (
        source in ('native', 'mcp') and
        json_extract(json, '$.source') = source
      );
    alter table agent_runtime_tool_audits
      add column installation_id text
      check (
        (installation_id is null or
          (length(trim(installation_id)) > 0 and length(installation_id) <= 200 and trim(installation_id) = installation_id)) and
        json_extract(json, '$.installationId') is installation_id
      );
    alter table agent_runtime_tool_audits
      add column installation_version integer
      check (
        (installation_version is null or installation_version between 1 and 2147483647) and
        json_extract(json, '$.installationVersion') is installation_version and
        (
          (source = 'native' and installation_id is null and installation_version is null) or
          (source = 'mcp' and installation_id is not null and installation_version is not null)
        )
      );

    create table local_mcp_installations (
      id text primary key,
      version integer not null,
      enabled integer not null,
      transport text not null,
      executable_sha256 text not null,
      state_version integer not null,
      json text not null,
      created_at text not null,
      updated_at text not null,
      check (length(trim(id)) > 0 and length(id) <= 200 and trim(id) = id),
      check (version between 1 and 2147483647),
      check (enabled in (0, 1)),
      check (transport = 'stdio'),
      check (length(executable_sha256) = 64 and executable_sha256 not glob '*[^0-9a-f]*'),
      check (state_version = 1),
      check (updated_at >= created_at),
      check (json_valid(json)),
      check (json_extract(json, '$.stateVersion') = state_version),
      check (json_extract(json, '$.id') = id),
      check (json_extract(json, '$.version') = version),
      check (json_extract(json, '$.enabled') = enabled),
      check (json_extract(json, '$.transport') = transport),
      check (json_extract(json, '$.executableSha256') = executable_sha256),
      check (json_extract(json, '$.createdAt') = created_at),
      check (json_extract(json, '$.updatedAt') = updated_at)
    );

    create index idx_local_mcp_installations_enabled
      on local_mcp_installations(enabled, id);
      `)
    },
  },
  {
    version: 21,
    migrate(db) {
      db.run(`
    drop index if exists idx_remote_sync_outbox_due;
    alter table remote_sync_outbox rename to remote_sync_outbox_v20;

    create table remote_sync_outbox (
      id text primary key,
      kind text not null,
      local_project_id text not null,
      organization_id text,
      team_project_id text,
      run_id text not null,
      entity_id text not null,
      idempotency_key text not null unique,
      status text not null,
      generation integer not null,
      attempt_count integer not null,
      next_attempt_at text,
      lease_expires_at text,
      last_attempt_at text,
      last_error_code text,
      last_error_message text,
      recovery text not null,
      completed_at text,
      created_at text not null,
      updated_at text not null,
      check (kind in (
        'run-summary', 'test-evidence-summary', 'agent-review-summary',
        'coding-agent-summary', 'agent-runtime-summary'
      )),
      check (status in ('pending', 'sending', 'retry-scheduled', 'completed', 'terminal')),
      check (generation >= 1),
      check (attempt_count >= 0),
      check (
        (status = 'sending' and lease_expires_at is not null) or
        (status <> 'sending' and lease_expires_at is null)
      ),
      check (
        (organization_id is null and team_project_id is null) or
        (organization_id is not null and team_project_id is not null)
      )
    );

    insert into remote_sync_outbox (
      id, kind, local_project_id, organization_id, team_project_id,
      run_id, entity_id, idempotency_key, status, generation, attempt_count,
      next_attempt_at, lease_expires_at, last_attempt_at, last_error_code,
      last_error_message, recovery, completed_at, created_at, updated_at
    )
    select
      id, kind, local_project_id, organization_id, team_project_id,
      run_id, entity_id, idempotency_key, status, generation, attempt_count,
      next_attempt_at, lease_expires_at, last_attempt_at, last_error_code,
      last_error_message, recovery, completed_at, created_at, updated_at
    from remote_sync_outbox_v20;

    drop table remote_sync_outbox_v20;

    create index idx_remote_sync_outbox_due
      on remote_sync_outbox(status, next_attempt_at, created_at);
      `)
    },
  },
  {
    version: 22,
    migrate(db) {
      db.run(`
    create table knowledge_index_snapshots (
      id text primary key,
      local_project_id text not null,
      organization_id text,
      team_project_id text,
      snapshot_hash text not null,
      embedding_model_id text not null,
      embedding_model_version text not null,
      vector_dimensions integer not null,
      status text not null,
      state_version integer not null,
      created_at text not null,
      updated_at text not null,
      activated_at text,
      foreign key (local_project_id) references local_projects(id) on delete cascade,
      check (length(trim(id)) > 0 and length(id) <= 200 and trim(id) = id),
      check (length(trim(local_project_id)) > 0 and length(local_project_id) <= 200 and trim(local_project_id) = local_project_id),
      check (
        (organization_id is null and team_project_id is null) or
        (organization_id is not null and team_project_id is not null)
      ),
      check (organization_id is null or (length(trim(organization_id)) > 0 and length(organization_id) <= 200 and trim(organization_id) = organization_id)),
      check (team_project_id is null or (length(trim(team_project_id)) > 0 and length(team_project_id) <= 200 and trim(team_project_id) = team_project_id)),
      check (
        length(snapshot_hash) = 71 and
        substr(snapshot_hash, 1, 7) = 'sha256:' and
        substr(snapshot_hash, 8) not glob '*[^0-9a-f]*'
      ),
      check (length(trim(embedding_model_id)) > 0 and length(embedding_model_id) <= 200 and trim(embedding_model_id) = embedding_model_id),
      check (length(trim(embedding_model_version)) > 0 and length(embedding_model_version) <= 200 and trim(embedding_model_version) = embedding_model_version),
      check (vector_dimensions between 1 and 4096),
      check (status in ('building', 'current', 'superseded', 'failed')),
      check (state_version = 1),
      check (updated_at >= created_at),
      check (
        (status in ('current', 'superseded') and activated_at is not null) or
        (status in ('building', 'failed') and activated_at is null)
      )
    );

    create unique index idx_knowledge_index_snapshots_current
      on knowledge_index_snapshots(local_project_id)
      where status = 'current';
    create index idx_knowledge_index_snapshots_scope
      on knowledge_index_snapshots(organization_id, team_project_id, local_project_id, created_at);

    create table knowledge_index_chunks (
      snapshot_id text not null,
      document_id text not null,
      chunk_id text not null,
      source_path text not null,
      heading_path_json text not null,
      content_hash text not null,
      content_text text not null,
      ordinal integer not null,
      state_version integer not null,
      primary key (snapshot_id, chunk_id),
      unique (snapshot_id, document_id, chunk_id, content_hash),
      foreign key (snapshot_id) references knowledge_index_snapshots(id) on delete cascade,
      check (length(trim(document_id)) > 0 and length(document_id) <= 200 and trim(document_id) = document_id),
      check (length(trim(chunk_id)) > 0 and length(chunk_id) <= 200 and trim(chunk_id) = chunk_id),
      check (length(trim(source_path)) > 0 and length(source_path) <= 500 and trim(source_path) = source_path),
      check (substr(source_path, 1, 1) <> '/' and instr(source_path, '\\') = 0 and instr(source_path, '//') = 0),
      check (json_valid(heading_path_json) and json_type(heading_path_json) = 'array' and json_array_length(heading_path_json) > 0),
      check (length(trim(content_hash)) > 0 and length(content_hash) <= 200 and trim(content_hash) = content_hash),
      check (length(content_text) between 1 and 65536 and trim(content_text) = content_text),
      check (ordinal between 0 and 2147483647),
      check (state_version = 1)
    );

    create index idx_knowledge_index_chunks_document
      on knowledge_index_chunks(snapshot_id, document_id, ordinal, chunk_id);

    create table knowledge_index_vectors (
      snapshot_id text not null,
      chunk_id text not null,
      model_id text not null,
      model_version text not null,
      vector_dimensions integer not null,
      vector_json text not null,
      created_at text not null,
      primary key (snapshot_id, chunk_id),
      foreign key (snapshot_id, chunk_id)
        references knowledge_index_chunks(snapshot_id, chunk_id) on delete cascade,
      check (length(trim(model_id)) > 0 and length(model_id) <= 200 and trim(model_id) = model_id),
      check (length(trim(model_version)) > 0 and length(model_version) <= 200 and trim(model_version) = model_version),
      check (vector_dimensions between 1 and 4096),
      check (
        json_valid(vector_json) and
        json_type(vector_json) = 'array' and
        json_array_length(vector_json) = vector_dimensions
      )
    );

    create table knowledge_citations (
      id text primary key,
      snapshot_id text not null,
      request_id text not null,
      document_id text not null,
      chunk_id text not null,
      content_hash text not null,
      strategy_chain_json text not null,
      rank integer not null,
      score real not null,
      state_version integer not null,
      cited_at text not null,
      foreign key (snapshot_id, document_id, chunk_id, content_hash)
        references knowledge_index_chunks(snapshot_id, document_id, chunk_id, content_hash)
        on delete cascade,
      check (length(trim(id)) > 0 and length(id) <= 200 and trim(id) = id),
      check (length(trim(request_id)) > 0 and length(request_id) <= 200 and trim(request_id) = request_id),
      check (json_valid(strategy_chain_json) and json_type(strategy_chain_json) = 'array' and json_array_length(strategy_chain_json) between 1 and 4),
      check (rank between 1 and 20),
      check (score between 0 and 1),
      check (state_version = 1)
    );

    create index idx_knowledge_citations_request
      on knowledge_citations(request_id, rank, id);
      `)
    },
  },
  {
    version: 23,
    migrate(db) {
      db.run(`
    create table agent_memory_candidates (
      id text primary key,
      scope_kind text not null,
      local_project_id text not null,
      organization_id text,
      team_project_id text,
      user_id text not null,
      session_id text not null,
      runtime_id text not null,
      action_id text not null,
      checkpoint_version integer not null,
      observation_sequence integer not null,
      result_digest text not null,
      statement text not null,
      content_digest text not null,
      provenance_digest text not null,
      status text not null,
      state_version integer not null,
      json text not null,
      created_at text not null,
      foreign key (local_project_id) references local_projects(id) on delete cascade,
      unique (local_project_id, provenance_digest, content_digest),
      check (scope_kind in ('team', 'local')),
      check (
        (scope_kind = 'team' and organization_id is not null and team_project_id is not null) or
        (scope_kind = 'local' and organization_id is null and team_project_id is null)
      ),
      check (length(trim(id)) > 0 and length(id) <= 200 and trim(id) = id),
      check (length(trim(local_project_id)) > 0 and length(local_project_id) <= 200 and trim(local_project_id) = local_project_id),
      check (organization_id is null or (length(trim(organization_id)) > 0 and length(organization_id) <= 200 and trim(organization_id) = organization_id)),
      check (team_project_id is null or (length(trim(team_project_id)) > 0 and length(team_project_id) <= 200 and trim(team_project_id) = team_project_id)),
      check (length(trim(user_id)) > 0 and length(user_id) <= 200 and trim(user_id) = user_id),
      check (length(trim(session_id)) > 0 and length(session_id) <= 200 and trim(session_id) = session_id),
      check (length(trim(runtime_id)) > 0 and length(runtime_id) <= 200 and trim(runtime_id) = runtime_id),
      check (length(trim(action_id)) > 0 and length(action_id) <= 200 and trim(action_id) = action_id),
      check (checkpoint_version between 1 and 2147483647),
      check (observation_sequence between 1 and 2147483647),
      check (length(result_digest) = 64 and result_digest not glob '*[^0-9a-f]*'),
      check (length(cast(statement as blob)) between 1 and 8192 and trim(statement) = statement),
      check (length(content_digest) = 64 and content_digest not glob '*[^0-9a-f]*'),
      check (length(provenance_digest) = 64 and provenance_digest not glob '*[^0-9a-f]*'),
      check (status = 'candidate'),
      check (state_version = 1),
      check (json_valid(json) and json_type(json) = 'object'),
      check (json_extract(json, '$.id') = id),
      check (json_extract(json, '$.status') = status),
      check (json_extract(json, '$.scope.kind') = scope_kind),
      check (json_extract(json, '$.scope.localProjectId') = local_project_id),
      check (json_extract(json, '$.scope.organizationId') is organization_id),
      check (json_extract(json, '$.scope.projectId') is team_project_id),
      check (json_extract(json, '$.scope.userId') = user_id),
      check (json_extract(json, '$.scope.sessionId') = session_id),
      check (json_extract(json, '$.provenance.runtimeId') = runtime_id),
      check (json_extract(json, '$.provenance.actionId') = action_id),
      check (json_extract(json, '$.provenance.checkpointVersion') = checkpoint_version),
      check (json_extract(json, '$.provenance.sequence') = observation_sequence),
      check (json_extract(json, '$.provenance.resultDigest') = result_digest),
      check (json_extract(json, '$.statement') = statement),
      check (json_extract(json, '$.contentDigest') = content_digest),
      check (json_extract(json, '$.provenanceDigest') = provenance_digest),
      check (json_extract(json, '$.stateVersion') = state_version),
      check (json_extract(json, '$.createdAt') = created_at)
    );

    create index idx_agent_memory_candidates_scope
      on agent_memory_candidates(
        organization_id, team_project_id, user_id, session_id, local_project_id, created_at, id
      );
      `)
    },
  },
  {
    version: 24,
    migrate(db) {
      db.run(`
    create table agent_memory_revisions (
      memory_id text not null,
      revision integer not null,
      local_project_id text not null,
      scope_kind text not null,
      organization_id text,
      team_project_id text,
      user_id text not null,
      session_id text not null,
      visibility text not null,
      statement text not null,
      content_digest text not null,
      provenance_digest text not null,
      source_candidate_id text not null unique,
      supersedes_revision integer,
      sensitivity text not null,
      retention_class text not null,
      expires_at text,
      promotion_decision_id text not null unique,
      promotion_actor_kind text not null,
      promotion_actor_id text not null,
      promotion_policy_id text not null,
      promotion_policy_version integer not null,
      promotion_authority_digest text not null,
      status text not null,
      state_version integer not null,
      json text not null,
      created_at text not null,
      primary key (memory_id, revision),
      foreign key (local_project_id) references local_projects(id) on delete cascade,
      foreign key (source_candidate_id) references agent_memory_candidates(id),
      check (length(trim(memory_id)) > 0 and length(memory_id) <= 200 and trim(memory_id) = memory_id),
      check (revision between 1 and 2147483647),
      check (
        (revision = 1 and supersedes_revision is null) or
        (revision > 1 and supersedes_revision = revision - 1)
      ),
      check (scope_kind in ('team', 'local')),
      check (
        (scope_kind = 'team' and organization_id is not null and team_project_id is not null) or
        (scope_kind = 'local' and organization_id is null and team_project_id is null)
      ),
      check (visibility in ('runtime', 'user_project', 'project_shared')),
      check (visibility <> 'project_shared' or scope_kind = 'team'),
      check (length(cast(statement as blob)) between 1 and 8192 and trim(statement) = statement),
      check (length(content_digest) = 64 and content_digest not glob '*[^0-9a-f]*'),
      check (length(provenance_digest) = 64 and provenance_digest not glob '*[^0-9a-f]*'),
      check (sensitivity in ('private', 'internal')),
      check (retention_class in ('session', 'thirty_days', 'until_deleted')),
      check (
        (retention_class = 'until_deleted' and expires_at is null) or
        (retention_class <> 'until_deleted' and expires_at is not null and expires_at > created_at)
      ),
      check (promotion_actor_kind in ('human', 'policy')),
      check (promotion_policy_version between 1 and 2147483647),
      check (length(promotion_authority_digest) = 64 and promotion_authority_digest not glob '*[^0-9a-f]*'),
      check (status in ('active', 'conflict')),
      check (state_version = 1),
      check (json_valid(json) and json_type(json) = 'object'),
      check (json_extract(json, '$.id') = memory_id),
      check (json_extract(json, '$.revision') = revision),
      check (json_extract(json, '$.sourceCandidateId') = source_candidate_id),
      check (json_extract(json, '$.contentDigest') = content_digest),
      check (json_extract(json, '$.provenanceDigest') = provenance_digest),
      check (json_extract(json, '$.stateVersion') = state_version),
      check (json_extract(json, '$.createdAt') = created_at)
    );

    create table agent_memory_heads (
      memory_id text primary key,
      current_revision integer not null,
      local_project_id text not null,
      scope_kind text not null,
      organization_id text,
      team_project_id text,
      user_id text not null,
      session_id text not null,
      status text not null,
      version integer not null,
      updated_at text not null,
      foreign key (memory_id, current_revision)
        references agent_memory_revisions(memory_id, revision),
      check (current_revision between 1 and 2147483647),
      check (scope_kind in ('team', 'local')),
      check (
        (scope_kind = 'team' and organization_id is not null and team_project_id is not null) or
        (scope_kind = 'local' and organization_id is null and team_project_id is null)
      ),
      check (status in ('active', 'conflict', 'expired', 'purge_pending', 'deleted')),
      check (version between 1 and 2147483647)
    );

    create index idx_agent_memory_heads_scope
      on agent_memory_heads(
        organization_id, team_project_id, user_id, session_id, local_project_id, status, memory_id
      );

    create table agent_memory_tombstones (
      memory_id text primary key,
      deletion_version integer not null,
      last_revision integer not null,
      local_project_id text not null,
      scope_kind text not null,
      organization_id text,
      team_project_id text,
      user_id text not null,
      session_id text not null,
      actor_kind text not null,
      actor_id text not null,
      authority_digest text not null,
      purge_status text not null,
      state_version integer not null,
      json text not null,
      deleted_at text not null,
      purged_at text,
      foreign key (memory_id, last_revision)
        references agent_memory_revisions(memory_id, revision),
      check (deletion_version between 1 and 2147483647),
      check (last_revision between 1 and 2147483647),
      check (scope_kind in ('team', 'local')),
      check (
        (scope_kind = 'team' and organization_id is not null and team_project_id is not null) or
        (scope_kind = 'local' and organization_id is null and team_project_id is null)
      ),
      check (actor_kind in ('human', 'policy')),
      check (length(authority_digest) = 64 and authority_digest not glob '*[^0-9a-f]*'),
      check (purge_status in ('pending', 'completed')),
      check (
        (purge_status = 'pending' and purged_at is null) or
        (purge_status = 'completed' and purged_at is not null and purged_at >= deleted_at)
      ),
      check (state_version = 1),
      check (json_valid(json) and json_type(json) = 'object')
    );

    create table agent_memory_index_entries (
      memory_id text not null,
      revision integer not null,
      model_id text not null,
      model_version text not null,
      vector_dimensions integer not null,
      vector_json text not null,
      created_at text not null,
      primary key (memory_id, revision, model_id, model_version),
      foreign key (memory_id, revision)
        references agent_memory_revisions(memory_id, revision) on delete cascade,
      check (vector_dimensions between 1 and 4096),
      check (
        json_valid(vector_json) and json_type(vector_json) = 'array' and
        json_array_length(vector_json) = vector_dimensions
      )
    );

    create table agent_memory_audits (
      id text primary key,
      memory_id text not null,
      revision integer not null,
      local_project_id text not null,
      scope_kind text not null,
      organization_id text,
      team_project_id text,
      user_id text not null,
      session_id text not null,
      event_kind text not null,
      actor_kind text not null,
      actor_id text not null,
      authority_digest text not null,
      state_version integer not null,
      metadata_json text not null,
      created_at text not null,
      foreign key (memory_id, revision)
        references agent_memory_revisions(memory_id, revision),
      check (event_kind in (
        'candidate_promoted', 'memory_revised', 'conflict_recorded',
        'memory_expired', 'memory_deleted', 'purge_completed'
      )),
      check (actor_kind in ('human', 'policy', 'system')),
      check (length(authority_digest) = 64 and authority_digest not glob '*[^0-9a-f]*'),
      check (state_version = 1),
      check (json_valid(metadata_json) and json_type(metadata_json) = 'object')
    );

    create index idx_agent_memory_audits_memory
      on agent_memory_audits(memory_id, revision, created_at, id);
      `)
    },
  },
  {
    version: 25,
    migrate(db) {
      db.run('pragma legacy_alter_table = on')
      try {
        db.run(`
    alter table agent_memory_revisions rename to agent_memory_revisions_v24;

    create table agent_memory_revisions (
      memory_id text not null,
      revision integer not null,
      local_project_id text not null,
      scope_kind text not null,
      organization_id text,
      team_project_id text,
      user_id text not null,
      session_id text not null,
      visibility text not null,
      statement text not null,
      content_digest text not null,
      provenance_digest text not null,
      source_candidate_id text not null,
      supersedes_revision integer,
      sensitivity text not null,
      retention_class text not null,
      expires_at text,
      promotion_decision_id text not null unique,
      promotion_actor_kind text not null,
      promotion_actor_id text not null,
      promotion_policy_id text not null,
      promotion_policy_version integer not null,
      promotion_authority_digest text not null,
      status text not null,
      state_version integer not null,
      json text not null,
      created_at text not null,
      primary key (memory_id, revision),
      foreign key (local_project_id) references local_projects(id) on delete cascade,
      foreign key (source_candidate_id) references agent_memory_candidates(id),
      check (length(trim(memory_id)) > 0 and length(memory_id) <= 200 and trim(memory_id) = memory_id),
      check (revision between 1 and 2147483647),
      check (
        (revision = 1 and supersedes_revision is null) or
        (revision > 1 and supersedes_revision = revision - 1)
      ),
      check (scope_kind in ('team', 'local')),
      check (
        (scope_kind = 'team' and organization_id is not null and team_project_id is not null) or
        (scope_kind = 'local' and organization_id is null and team_project_id is null)
      ),
      check (visibility in ('runtime', 'user_project', 'project_shared')),
      check (visibility <> 'project_shared' or scope_kind = 'team'),
      check (length(cast(statement as blob)) between 1 and 8192 and trim(statement) = statement),
      check (length(content_digest) = 64 and content_digest not glob '*[^0-9a-f]*'),
      check (length(provenance_digest) = 64 and provenance_digest not glob '*[^0-9a-f]*'),
      check (sensitivity in ('private', 'internal')),
      check (retention_class in ('session', 'thirty_days', 'until_deleted')),
      check (
        (retention_class = 'until_deleted' and expires_at is null) or
        (retention_class <> 'until_deleted' and expires_at is not null and expires_at > created_at)
      ),
      check (promotion_actor_kind in ('human', 'policy')),
      check (promotion_policy_version between 1 and 2147483647),
      check (length(promotion_authority_digest) = 64 and promotion_authority_digest not glob '*[^0-9a-f]*'),
      check (status in ('active', 'conflict')),
      check (state_version = 1),
      check (json_valid(json) and json_type(json) = 'object'),
      check (json_extract(json, '$.id') = memory_id),
      check (json_extract(json, '$.revision') = revision),
      check (json_extract(json, '$.sourceCandidateId') = source_candidate_id),
      check (json_extract(json, '$.contentDigest') = content_digest),
      check (json_extract(json, '$.provenanceDigest') = provenance_digest),
      check (json_extract(json, '$.stateVersion') = state_version),
      check (json_extract(json, '$.createdAt') = created_at)
    );

    insert into agent_memory_revisions (
      memory_id, revision, local_project_id, scope_kind, organization_id,
      team_project_id, user_id, session_id, visibility, statement,
      content_digest, provenance_digest, source_candidate_id, supersedes_revision,
      sensitivity, retention_class, expires_at, promotion_decision_id,
      promotion_actor_kind, promotion_actor_id, promotion_policy_id,
      promotion_policy_version, promotion_authority_digest, status,
      state_version, json, created_at
    )
    select
      memory_id, revision, local_project_id, scope_kind, organization_id,
      team_project_id, user_id, session_id, visibility, statement,
      content_digest, provenance_digest, source_candidate_id, supersedes_revision,
      sensitivity, retention_class, expires_at, promotion_decision_id,
      promotion_actor_kind, promotion_actor_id, promotion_policy_id,
      promotion_policy_version, promotion_authority_digest, status,
      state_version, json, created_at
    from agent_memory_revisions_v24;

    drop table agent_memory_revisions_v24;
        `)
      } finally {
        db.run('pragma legacy_alter_table = off')
      }
    },
  },
  {
    version: 26,
    migrate(db) {
      db.run(`
    create table agent_runtime_context_attachments (
      id text primary key,
      runtime_id text not null unique,
      checkpoint_version integer not null,
      context_digest text not null unique,
      knowledge_identity_digest text not null,
      memory_identity_digest text not null,
      knowledge_citation_count integer not null,
      memory_revision_count integer not null,
      state_version integer not null,
      json text not null,
      attached_at text not null,
      foreign key (runtime_id) references agent_runtimes(id) on delete cascade,
      check (length(trim(id)) > 0 and length(id) <= 200 and trim(id) = id),
      check (length(trim(runtime_id)) > 0 and length(runtime_id) <= 200 and trim(runtime_id) = runtime_id),
      check (checkpoint_version between 1 and 2147483647),
      check (length(context_digest) = 64 and context_digest not glob '*[^0-9a-f]*'),
      check (length(knowledge_identity_digest) = 64 and knowledge_identity_digest not glob '*[^0-9a-f]*'),
      check (length(memory_identity_digest) = 64 and memory_identity_digest not glob '*[^0-9a-f]*'),
      check (knowledge_citation_count between 0 and 20),
      check (memory_revision_count between 0 and 32),
      check (state_version = 1),
      check (json_valid(json) and json_type(json) = 'object'),
      check (length(cast(json as blob)) <= 524288),
      check (json_extract(json, '$.stateVersion') = state_version),
      check (json_extract(json, '$.id') = id),
      check (json_extract(json, '$.runtimeId') = runtime_id),
      check (json_extract(json, '$.checkpointVersion') = checkpoint_version),
      check (json_extract(json, '$.contextDigest') = context_digest),
      check (json_extract(json, '$.knowledgeIdentityDigest') = knowledge_identity_digest),
      check (json_extract(json, '$.memoryIdentityDigest') = memory_identity_digest),
      check (json_array_length(json_extract(json, '$.knowledgeCitations')) = knowledge_citation_count),
      check (json_array_length(json_extract(json, '$.memoryRevisions')) = memory_revision_count),
      check (json_extract(json, '$.attachedAt') = attached_at)
    );

    create index idx_agent_runtime_context_attachments_attached
      on agent_runtime_context_attachments(attached_at, runtime_id);
      `)
    },
  },
  {
    version: 27,
    migrate(db) {
      db.run(`
    drop index if exists idx_remote_sync_outbox_due;
    alter table remote_sync_outbox rename to remote_sync_outbox_v26;

    create table remote_sync_outbox (
      id text primary key,
      kind text not null,
      local_project_id text not null,
      organization_id text,
      team_project_id text,
      run_id text not null,
      entity_id text not null,
      idempotency_key text not null unique,
      status text not null,
      generation integer not null,
      attempt_count integer not null,
      next_attempt_at text,
      lease_expires_at text,
      last_attempt_at text,
      last_error_code text,
      last_error_message text,
      recovery text not null,
      completed_at text,
      created_at text not null,
      updated_at text not null,
      check (kind in (
        'run-summary', 'test-evidence-summary', 'agent-review-summary',
        'coding-agent-summary', 'agent-runtime-summary', 'agent-memory-summary'
      )),
      check (status in ('pending', 'sending', 'retry-scheduled', 'completed', 'terminal')),
      check (generation >= 1),
      check (attempt_count >= 0),
      check (
        (status = 'sending' and lease_expires_at is not null) or
        (status <> 'sending' and lease_expires_at is null)
      ),
      check (
        (organization_id is null and team_project_id is null) or
        (organization_id is not null and team_project_id is not null)
      )
    );

    insert into remote_sync_outbox (
      id, kind, local_project_id, organization_id, team_project_id,
      run_id, entity_id, idempotency_key, status, generation, attempt_count,
      next_attempt_at, lease_expires_at, last_attempt_at, last_error_code,
      last_error_message, recovery, completed_at, created_at, updated_at
    )
    select
      id, kind, local_project_id, organization_id, team_project_id,
      run_id, entity_id, idempotency_key, status, generation, attempt_count,
      next_attempt_at, lease_expires_at, last_attempt_at, last_error_code,
      last_error_message, recovery, completed_at, created_at, updated_at
    from remote_sync_outbox_v26;

    drop table remote_sync_outbox_v26;

    create index idx_remote_sync_outbox_due
      on remote_sync_outbox(status, next_attempt_at, created_at);
      `)
    },
  },
  {
    version: 28,
    migrate(db) {
      db.run(`
    create table agent_coordination_sessions (
      id text primary key,
      contract_version integer not null,
      local_project_id text not null,
      organization_id text not null,
      team_project_id text not null,
      user_id text not null,
      scope_session_id text not null,
      run_id text not null,
      node_id text not null,
      supervisor_runtime_id text not null,
      graph_id text not null unique,
      graph_version integer not null,
      version integer not null,
      status text not null,
      stop_reason text,
      context_digest text not null,
      capability_set_digest text not null,
      request_json text not null,
      state_json text not null,
      requested_at text not null,
      started_at text not null,
      updated_at text not null,
      deadline text not null,
      foreign key (local_project_id) references local_projects(id) on delete restrict,
      foreign key (run_id) references workflow_runs(id) on delete restrict,
      foreign key (supervisor_runtime_id) references agent_runtimes(id) on delete restrict,
      check (contract_version = 1),
      check (graph_version between 1 and 2147483647),
      check (version between 1 and 2147483647),
      check (status in ('running', 'terminal')),
      check (stop_reason is null or stop_reason in (
        'success', 'failure', 'cancelled', 'timeout', 'budget_exhausted',
        'policy_denied', 'blocked_dependency'
      )),
      check (
        (status = 'running' and stop_reason is null) or
        (status = 'terminal' and stop_reason is not null)
      ),
      check (length(context_digest) = 64 and context_digest not glob '*[^0-9a-f]*'),
      check (length(capability_set_digest) = 64 and capability_set_digest not glob '*[^0-9a-f]*'),
      check (json_valid(request_json) and json_type(request_json) = 'object'),
      check (json_valid(state_json) and json_type(state_json) = 'object'),
      check (length(cast(request_json as blob)) <= 262144),
      check (length(cast(state_json as blob)) <= 262144),
      check (requested_at <= started_at and started_at <= updated_at and updated_at < deadline)
    );

    create index idx_agent_coordination_sessions_scope
      on agent_coordination_sessions(
        organization_id, team_project_id, user_id, scope_session_id,
        local_project_id, run_id, status, id
      );

    create table agent_coordination_graphs (
      id text primary key,
      coordination_id text not null unique,
      version integer not null,
      node_count integer not null,
      edge_count integer not null,
      graph_json text not null,
      created_at text not null,
      foreign key (coordination_id) references agent_coordination_sessions(id) on delete cascade,
      check (version between 1 and 2147483647),
      check (node_count between 1 and 12),
      check (edge_count between 0 and 24),
      check (json_valid(graph_json) and json_type(graph_json) = 'object'),
      check (length(cast(graph_json as blob)) <= 262144)
    );

    create table agent_coordination_tasks (
      coordination_id text not null,
      task_id text not null,
      graph_id text not null,
      role_id text not null,
      version integer not null,
      status text not null,
      agent_id text,
      runtime_id text,
      runtime_version integer,
      state_json text not null,
      updated_at text not null,
      primary key (coordination_id, task_id),
      foreign key (coordination_id) references agent_coordination_sessions(id) on delete cascade,
      foreign key (graph_id) references agent_coordination_graphs(id) on delete cascade,
      check (version between 1 and 2147483647),
      check (status in ('pending', 'ready', 'running', 'succeeded', 'failed', 'cancelled', 'blocked')),
      check (
        (runtime_id is null and runtime_version is null) or
        (runtime_id is not null and runtime_version between 1 and 2147483647)
      ),
      check (json_valid(state_json) and json_type(state_json) = 'object'),
      check (length(cast(state_json as blob)) <= 65536)
    );

    create index idx_agent_coordination_tasks_status
      on agent_coordination_tasks(coordination_id, status, task_id);

    create table agent_coordination_handoffs (
      id text primary key,
      coordination_id text not null,
      sequence integer not null,
      source_task_id text not null,
      target_task_id text not null,
      result_digest text not null,
      handoff_json text not null,
      created_at text not null,
      foreign key (coordination_id, source_task_id)
        references agent_coordination_tasks(coordination_id, task_id) on delete cascade,
      foreign key (coordination_id, target_task_id)
        references agent_coordination_tasks(coordination_id, task_id) on delete cascade,
      unique (coordination_id, sequence),
      check (sequence between 1 and 16),
      check (source_task_id <> target_task_id),
      check (length(result_digest) = 64 and result_digest not glob '*[^0-9a-f]*'),
      check (json_valid(handoff_json) and json_type(handoff_json) = 'object'),
      check (length(cast(handoff_json as blob)) <= 65536)
    );

    create table agent_coordination_leases (
      id text primary key,
      coordination_id text not null,
      task_id text not null,
      resource_id text not null,
      resource_digest text not null,
      mode text not null,
      status text not null,
      version integer not null,
      lease_json text not null,
      acquired_at text not null,
      expires_at text not null,
      released_at text,
      foreign key (coordination_id, task_id)
        references agent_coordination_tasks(coordination_id, task_id) on delete cascade,
      check (mode in ('read', 'write')),
      check (status in ('active', 'released', 'expired', 'cancelled')),
      check (version between 1 and 2147483647),
      check (length(resource_digest) = 64 and resource_digest not glob '*[^0-9a-f]*'),
      check (json_valid(lease_json) and json_type(lease_json) = 'object'),
      check (length(cast(lease_json as blob)) <= 65536),
      check (acquired_at < expires_at),
      check (
        (status = 'active' and released_at is null) or
        (status <> 'active' and released_at is not null and released_at >= acquired_at)
      )
    );

    create index idx_agent_coordination_leases_resource
      on agent_coordination_leases(coordination_id, resource_id, status, mode, id);

    create table agent_coordination_audits (
      id text primary key,
      coordination_id text not null,
      task_id text,
      event_kind text not null,
      session_version integer not null,
      metadata_json text not null,
      created_at text not null,
      foreign key (coordination_id) references agent_coordination_sessions(id) on delete cascade,
      foreign key (coordination_id, task_id)
        references agent_coordination_tasks(coordination_id, task_id) on delete cascade,
      check (session_version between 1 and 2147483647),
      check (json_valid(metadata_json) and json_type(metadata_json) = 'object'),
      check (length(cast(metadata_json as blob)) <= 65536)
    );

    create index idx_agent_coordination_audits_session
      on agent_coordination_audits(coordination_id, created_at, id);

    create table agent_coordination_checkpoints (
      coordination_id text not null,
      checkpoint_version integer not null,
      session_version integer not null,
      graph_version integer not null,
      checkpoint_json text not null,
      created_at text not null,
      primary key (coordination_id, checkpoint_version),
      foreign key (coordination_id) references agent_coordination_sessions(id) on delete cascade,
      check (checkpoint_version between 1 and 2147483647),
      check (session_version between 1 and 2147483647),
      check (graph_version between 1 and 2147483647),
      check (json_valid(checkpoint_json) and json_type(checkpoint_json) = 'object'),
      check (length(cast(checkpoint_json as blob)) <= 262144)
    );
      `)
    },
  },
  {
    version: 29,
    migrate(db) {
      db.run(`
    drop index if exists idx_remote_sync_outbox_due;
    alter table remote_sync_outbox rename to remote_sync_outbox_v28;

    create table remote_sync_outbox (
      id text primary key,
      kind text not null,
      local_project_id text not null,
      organization_id text,
      team_project_id text,
      run_id text not null,
      entity_id text not null,
      idempotency_key text not null unique,
      status text not null,
      generation integer not null,
      attempt_count integer not null,
      next_attempt_at text,
      lease_expires_at text,
      last_attempt_at text,
      last_error_code text,
      last_error_message text,
      recovery text not null,
      completed_at text,
      created_at text not null,
      updated_at text not null,
      check (kind in (
        'run-summary', 'test-evidence-summary', 'agent-review-summary',
        'coding-agent-summary', 'agent-runtime-summary', 'agent-memory-summary',
        'agent-coordination-summary'
      )),
      check (status in ('pending', 'sending', 'retry-scheduled', 'completed', 'terminal')),
      check (generation >= 1),
      check (attempt_count >= 0),
      check (
        (status = 'sending' and lease_expires_at is not null) or
        (status <> 'sending' and lease_expires_at is null)
      ),
      check (
        (organization_id is null and team_project_id is null) or
        (organization_id is not null and team_project_id is not null)
      )
    );

    insert into remote_sync_outbox (
      id, kind, local_project_id, organization_id, team_project_id,
      run_id, entity_id, idempotency_key, status, generation, attempt_count,
      next_attempt_at, lease_expires_at, last_attempt_at, last_error_code,
      last_error_message, recovery, completed_at, created_at, updated_at
    )
    select
      id, kind, local_project_id, organization_id, team_project_id,
      run_id, entity_id, idempotency_key, status, generation, attempt_count,
      next_attempt_at, lease_expires_at, last_attempt_at, last_error_code,
      last_error_message, recovery, completed_at, created_at, updated_at
    from remote_sync_outbox_v28;

    drop table remote_sync_outbox_v28;

    create index idx_remote_sync_outbox_due
      on remote_sync_outbox(status, next_attempt_at, created_at);
      `)
    },
  },
  {
    version: 30,
    migrate(db) {
      db.run(`
    alter table coding_diff_artifacts rename to coding_diff_artifacts_v29;

    create table coding_diff_artifacts (
      id text primary key,
      run_id text not null,
      node_id text not null,
      project_id text not null,
      json text not null,
      sanitizer_version integer,
      sanitized_at text,
      secret_replacement_count integer,
      created_at text not null,
      check (
        (sanitizer_version is null and sanitized_at is null and secret_replacement_count is null) or
        (
          sanitizer_version between 1 and 2147483647 and
          sanitized_at is not null and
          secret_replacement_count between 0 and 50000
        )
      )
    );

    insert into coding_diff_artifacts (
      id, run_id, node_id, project_id, json, sanitizer_version,
      sanitized_at, secret_replacement_count, created_at
    )
    select id, run_id, node_id, project_id, json, null, null, null, created_at
    from coding_diff_artifacts_v29;

    drop table coding_diff_artifacts_v29;

    create index idx_coding_diff_artifacts_sanitizer_version
      on coding_diff_artifacts(sanitizer_version, created_at, id);

    create index idx_coding_diff_artifacts_pending_sanitization
      on coding_diff_artifacts(created_at, id)
      where sanitizer_version is null or sanitizer_version < 2;
      `)
    },
  },
  {
    version: 31,
    migrate(db) {
      db.run(`
    alter table github_delivery_operator_outcomes
      rename to github_delivery_operator_outcomes_v30;

    create table github_delivery_operator_outcomes (
      intent_id text primary key,
      intent_updated_at text not null,
      outcome_code text not null,
      state_version integer not null,
      json text not null,
      recorded_at text not null,
      check (length(trim(intent_id)) > 0 and length(intent_id) <= 200 and trim(intent_id) = intent_id),
      check (outcome_code in (
        'content_scan_blocked', 'content_scan_incomplete',
        'invalid_delivery_source', 'operation_cancelled',
        'publisher_cleanup_failed', 'remote_branch_diverged',
        'remote_unavailable', 'repository_mismatch', 'push_result_unknown',
        'workspace_dirty', 'workspace_mismatch'
      )),
      check (state_version = 1),
      check (json_valid(json)),
      check (json_extract(json, '$.stateVersion') = state_version),
      check (json_extract(json, '$.intentId') = intent_id),
      check (json_extract(json, '$.intentUpdatedAt') = intent_updated_at),
      check (json_extract(json, '$.outcomeCode') = outcome_code),
      check (json_extract(json, '$.recordedAt') = recorded_at),
      check (json_extract(json, '$.redacted') = 1)
    );

    insert into github_delivery_operator_outcomes (
      intent_id, intent_updated_at, outcome_code, state_version, json, recorded_at
    )
    select intent_id, intent_updated_at, outcome_code, state_version, json, recorded_at
    from github_delivery_operator_outcomes_v30;

    drop table github_delivery_operator_outcomes_v30;

    create index idx_github_delivery_operator_outcomes_recorded
      on github_delivery_operator_outcomes(recorded_at, intent_id);

    create table github_delivery_content_scans (
      intent_id text primary key references github_delivery_intents(id) on delete cascade,
      intent_updated_at text not null,
      workspace_id text not null,
      base_commit_sha text not null,
      expected_commit_sha text not null,
      scanner_version integer not null,
      commit_count integer not null,
      scanned_byte_count integer not null,
      secret_match_count integer not null,
      scan_digest text not null,
      status text not null,
      state_version integer not null,
      json text not null,
      scanned_at text not null,
      check (length(trim(intent_id)) > 0 and length(intent_id) <= 200 and trim(intent_id) = intent_id),
      check (length(trim(workspace_id)) > 0 and length(workspace_id) <= 200 and trim(workspace_id) = workspace_id),
      check (base_commit_sha not glob '*[^0-9a-f]*' and length(base_commit_sha) = 40),
      check (expected_commit_sha not glob '*[^0-9a-f]*' and length(expected_commit_sha) = 40),
      check (base_commit_sha <> expected_commit_sha),
      check (scanner_version = 1),
      check (commit_count between 1 and 256),
      check (scanned_byte_count between 0 and 67108864),
      check (secret_match_count = 0),
      check (scan_digest not glob '*[^0-9a-f]*' and length(scan_digest) = 64),
      check (status = 'safe'),
      check (state_version = 1),
      check (json_valid(json)),
      check (json_extract(json, '$.stateVersion') = state_version),
      check (json_extract(json, '$.intentId') = intent_id),
      check (json_extract(json, '$.intentUpdatedAt') = intent_updated_at),
      check (json_extract(json, '$.workspaceId') = workspace_id),
      check (json_extract(json, '$.baseCommitSha') = base_commit_sha),
      check (json_extract(json, '$.expectedCommitSha') = expected_commit_sha),
      check (json_extract(json, '$.scannerVersion') = scanner_version),
      check (json_extract(json, '$.commitCount') = commit_count),
      check (json_extract(json, '$.scannedByteCount') = scanned_byte_count),
      check (json_extract(json, '$.secretMatchCount') = secret_match_count),
      check (json_extract(json, '$.scanDigest') = scan_digest),
      check (json_extract(json, '$.status') = status),
      check (json_extract(json, '$.scannedAt') = scanned_at),
      check (json_extract(json, '$.redacted') = 1),
      check (scanned_at >= intent_updated_at)
    );

    create index idx_github_delivery_content_scans_scanned
      on github_delivery_content_scans(scanned_at, intent_id);
      `)
    },
  },
  {
    version: 32,
    migrate(db) {
      for (const table of ['artifacts', 'agent_events', 'coding_agent_events', 'test_evidence']) {
        const columns = db.exec(`pragma table_info(${table})`)[0]?.values ?? []
        if (!columns.some((column) => String(column[1]) === 'privacy_version')) {
          db.run(`alter table ${table} add column privacy_version integer`)
        }
      }
      db.run(`
    create index if not exists idx_artifacts_pending_privacy
      on artifacts(updated_at, id)
      where privacy_version is null or privacy_version < 1;

    create index if not exists idx_agent_events_pending_privacy
      on agent_events(timestamp, id)
      where privacy_version is null or privacy_version < 1;

    create index if not exists idx_coding_agent_events_pending_privacy
      on coding_agent_events(timestamp, id)
      where privacy_version is null or privacy_version < 1;

    create index if not exists idx_test_evidence_pending_privacy
      on test_evidence(created_at, id)
      where privacy_version is null or privacy_version < 1;
      `)
    },
  },
]

export const schemaMigrationVersions = Object.freeze(
  schemaMigrations.map((migration) => migration.version),
)

export function readLocalStoreSchemaVersion(db: Database): number {
  const result = db.exec("select value from schema_meta where key = 'schema_version'")
  const value = result[0]?.values[0]?.[0]
  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('DevFlow local database schema version is missing or invalid')
  }
  return parsed
}

export function migrateLocalStoreSchema(
  db: Database,
  hooks: LocalStoreSchemaHooks,
): void {
  const expectedVersions = Array.from(
    { length: CURRENT_SCHEMA_VERSION },
    (_, index) => index + 1,
  )
  if (schemaMigrationVersions.some((version, index) => version !== expectedVersions[index])) {
    throw new Error('DevFlow local database migration history is not contiguous')
  }

  const schemaMetaExists = Boolean(
    db.exec("select name from sqlite_master where type = 'table' and name = 'schema_meta'")[0]
      ?.values.length,
  )
  const existingVersion = schemaMetaExists ? readLocalStoreSchemaVersion(db) : 0
  if (existingVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `DevFlow local database schema version ${existingVersion} is newer than supported version ${CURRENT_SCHEMA_VERSION}`,
    )
  }

  for (const migration of schemaMigrations) {
    if (migration.version <= existingVersion) continue
    db.run('begin transaction')
    try {
      migration.migrate(db, hooks)
      db.run(
        `insert into schema_meta (key, value) values ('schema_version', ?) on conflict(key) do update set value = excluded.value`,
        [String(migration.version)],
      )
      db.run('commit')
    } catch (error) {
      db.run('rollback')
      throw error
    }
  }

  db.run('begin transaction')
  try {
    hooks.afterMigrations(db)
    db.run('commit')
  } catch (error) {
    db.run('rollback')
    throw error
  }
}
