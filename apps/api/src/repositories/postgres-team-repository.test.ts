import { describe, expect, it } from 'vitest'
import type { RequestPrincipal } from '../auth/request-auth'
import type { TeamDbRepositoryClient } from '../db/client'
import { createPostgresTeamRepository } from './postgres-team-repository'

const readContext = { organizationId: 'org-demo' }

const postgresGatePrincipal: RequestPrincipal = {
  session: {
    source: 'authenticated',
    authAccountId: 'acct-github-ling',
    organizationId: 'org-demo',
    userId: 'u-ling',
    role: 'lead',
    projectMemberships: [
      { projectId: 'p-payments', userId: 'u-ling', role: 'lead' },
    ],
  },
  authentication: { kind: 'session_cookie', tokenRecordId: null },
}

function gateCommandMarker(sql: string): string | null {
  return /\/\* gate_command:([^*]+) \*\//.exec(sql)?.[1]?.trim() ?? null
}

class FakeTeamDbClient implements TeamDbRepositoryClient {
  readonly queries: Array<{ sql: string; params?: unknown[] }> = []
  readonly acceptedChildSummaryWrites = new Map<string, unknown[]>()
  checkoutCount = 0
  releaseCount = 0
  private readonly childSummaryScopes = new Map<string, string>()

  constructor(
    private readonly canonicalRunExists = true,
    private readonly runSummaryAccepted = true,
    private readonly desktopUserRole: 'owner' | 'lead' | 'member' = 'lead',
    private readonly failOnSqlFragment?: string,
    private readonly nodeSummaryAccepted = true,
  ) {}

  private acceptScopedChildSummaryWrite(
    table: string,
    id: unknown,
    scope: string,
    params: unknown[],
  ): boolean {
    const key = `${table}:${String(id)}`
    const existingScope = this.childSummaryScopes.get(key)
    if (existingScope && existingScope !== scope) {
      return false
    }

    this.childSummaryScopes.set(key, scope)
    this.acceptedChildSummaryWrites.set(key, [...params])
    return true
  }

  async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    this.queries.push(params === undefined ? { sql } : { sql, params })

    if (this.failOnSqlFragment && sql.includes(this.failOnSqlFragment)) {
      throw new Error(`forced repository write failure: ${this.failOnSqlFragment}`)
    }

    if (sql.includes('INSERT INTO test_evidence_summaries')) {
      const values = params ?? []
      const accepted = this.acceptScopedChildSummaryWrite(
        'test_evidence_summaries',
        values[0],
        `${String(values[11])}:${String(values[1])}:${String(values[2])}:${String(values[3])}`,
        values,
      )
      return (accepted ? [{ id: values[0] }] : []) as T[]
    }

    if (sql.includes('INSERT INTO agent_reviews')) {
      const values = params ?? []
      const accepted = this.acceptScopedChildSummaryWrite(
        'agent_reviews',
        values[0],
        `${String(values[1])}:${String(values[3])}:${String(values[4])}:${String(values[5])}`,
        values,
      )
      return (accepted ? [{ id: values[0] }] : []) as T[]
    }

    if (sql.includes('INSERT INTO coding_agent_summaries')) {
      const values = params ?? []
      const accepted = this.acceptScopedChildSummaryWrite(
        'coding_agent_summaries',
        values[0],
        `${String(values[1])}:${String(values[2])}:${String(values[3])}:${String(values[4])}`,
        values,
      )
      return (accepted ? [{ id: values[0] }] : []) as T[]
    }

    if (sql.includes('INSERT INTO workflow_runs')) {
      return (this.runSummaryAccepted ? [{ id: params?.[0] }] : []) as T[]
    }

    if (sql.includes('INSERT INTO workflow_nodes')) {
      return (this.nodeSummaryAccepted ? [{ id: params?.[0] }] : []) as T[]
    }

    if (sql.includes('SELECT id') && sql.includes('FROM workflow_runs')) {
      return (this.canonicalRunExists
        ? [{ id: 'run-remote-1', current_node_id: `${String(params?.[0])}:n-current` }]
        : []) as T[]
    }

    if (sql.includes('FROM projects')) {
      return [
        {
          id: 'p-payments',
          name: 'Payments API',
          slug: 'payments-api',
          description: 'Payment workflow service.',
          repository: 'erich/payments-api',
          default_branch: 'main',
          health: 'at_risk',
          knowledge_base_path: 'docs/payments/',
          test_command: 'pnpm test',
        },
      ] as T[]
    }

    if (sql.includes('FROM auth_accounts')) {
      return [
        {
          auth_account_id: 'acct-github-ling',
          auth_account_user_id: 'u-ling',
          provider: 'github',
          provider_account_id: 'github:ling',
          username: 'ling-gh',
          auth_account_email: 'ling@example.com',
          auth_account_created_at: '2026-06-16T09:00:00.000Z',
          auth_account_updated_at: '2026-06-16T09:05:00.000Z',
          user_id: 'u-ling',
          organization_id: 'org-demo',
          name: 'Ling',
          role: 'lead',
          email: 'ling@example.com',
          avatar_url: 'https://avatars.example/ling.png',
          avatar_initials: 'LG',
          focus: 'Architecture',
          user_created_at: '2026-06-16T08:00:00.000Z',
          user_updated_at: '2026-06-16T08:05:00.000Z',
        },
      ] as T[]
    }

    if (sql.includes('FROM project_members')) {
      if (params?.length === 3) {
        return [
          {
            project_id: params[1],
            user_id: 'u-ling',
            role: this.desktopUserRole,
          },
        ] as T[]
      }
      if (sql.includes('JOIN projects')) {
        return [
          { project_id: 'p-payments', user_id: 'u-ling', role: 'lead' },
          { project_id: 'p-admin', user_id: 'u-ling', role: 'member' },
        ] as T[]
      }
      if (params?.length === 2) {
        return [
          {
            project_id: params[1],
            user_id: 'u-ling',
            role: this.desktopUserRole,
          },
        ] as T[]
      }
      return [
        { project_id: 'p-payments', user_id: 'u-ling', role: 'lead' },
        { project_id: 'p-admin', user_id: 'u-ling', role: 'member' },
      ] as T[]
    }

    if (sql.includes('FROM desktop_tokens')) {
      return [
        {
          token_id: 'desktop-token-p-payments',
          organization_id: 'org-demo',
          project_id: 'p-payments',
          user_id: 'u-ling',
          token_hash: 'cd577fe2561ebff23505db0bb006300c7cdecbd46bc0e03c449afafaca2c25bf',
          revoked_at: null,
          role: this.desktopUserRole,
          auth_account_id: 'acct-github-ling',
        },
      ] as T[]
    }

    if (sql.includes('FROM users')) {
      return [
        {
          id: 'u-ling',
          name: 'Ling',
          role: 'lead',
          avatar_initials: 'LG',
          focus: 'Architecture',
        },
      ] as T[]
    }

    if (sql.includes('FROM workflow_runs')) {
      return [
        {
          id: 'run-remote-1',
          run_version: 4,
          title: 'Remote health endpoint',
          request: 'Add team-visible health endpoint evidence.',
          project_id: 'p-payments',
          creator_id: 'u-ling',
          status: 'paused_at_gate',
          current_node_id: 'n-design-gate',
          branch_name: 'ai/health-endpoint',
          pull_request_url: null,
          created_at: '2026-06-16T10:00:00.000Z',
          updated_at: '2026-06-16T10:15:00.000Z',
        },
      ] as T[]
    }

    if (sql.includes('FROM workflow_nodes')) {
      return [
        {
          id: 'n-design-gate',
          run_id: 'run-remote-1',
          stage: 'design',
          title: 'Architecture Gate',
          subtitle: 'Lead approval before implementation',
          kind: 'gate',
          status: 'blocked',
          owner_id: 'u-ling',
          required_role: 'lead',
          retry_count: 0,
          token_usage_id: null,
          position: 0,
        },
      ] as T[]
    }

    if (sql.includes('FROM workflow_edges')) {
      return [
        {
          id: 'edge-1',
          run_id: 'run-remote-1',
          source_node_id: 'n-design-gate',
          target_node_id: 'n-test',
          kind: 'gate',
        },
      ] as T[]
    }

    if (sql.includes('FROM artifacts')) {
      return [
        {
          id: 'art-design',
          run_id: 'run-remote-1',
          node_id: 'n-design-gate',
          kind: 'design',
          title: 'Design summary',
          summary: 'Remote design artifact summary.',
          content: 'Redacted remote artifact content.',
          redacted: true,
          updated_at: '2026-06-16T10:14:00.000Z',
        },
      ] as T[]
    }

    if (sql.includes('FROM agent_events')) {
      return [
        {
          id: 'ev-approval',
          run_id: 'run-remote-1',
          node_id: 'n-design-gate',
          sequence: 1,
          kind: 'approval',
          message: 'Waiting for lead approval.',
          timestamp: '2026-06-16T10:15:00.000Z',
        },
      ] as T[]
    }

    if (sql.includes('FROM token_usage')) {
      return [
        {
          id: 'tok-1',
          run_id: 'run-remote-1',
          node_id: 'n-design-gate',
          user_id: 'u-ling',
          project_id: 'p-payments',
          provider: 'dashscope',
          model: 'qwen3-coder-plus',
          input_tokens: 1000,
          output_tokens: 300,
          cache_read_tokens: 200,
          cost_usd: '0.109',
          timestamp: '2026-06-16T10:15:00.000Z',
        },
      ] as T[]
    }

    if (sql.includes('FROM test_evidence_summaries')) {
      return [
        {
          id: 'evidence-remote-1',
          run_id: 'run-remote-1',
          node_id: 'n-test',
          project_id: 'p-payments',
          command: 'pnpm test',
          status: 'passed',
          exit_code: 0,
          duration_ms: 1200,
          summary: 'Remote tests passed.',
          redacted: true,
          created_at: '2026-06-16T10:20:00.000Z',
        },
      ] as T[]
    }

    if (sql.includes('FROM coding_agent_summaries')) {
      return [
        {
          id: 'coding-run-remote-1',
          run_id: 'run-remote-1',
          node_id: 'n-build',
          project_id: 'p-payments',
          requested_by: 'u-ling',
          provider_id: 'fake-coding-engine',
          engine: 'fake',
          status: 'completed',
          branch_name: 'devflow/run-remote-1-n-build-coding-run-remote-1',
          summary: 'Coding summary stored in Postgres.',
          changed_paths: ['src/health.ts'],
          started_at: '2026-06-16T10:18:00.000Z',
          completed_at: '2026-06-16T10:19:00.000Z',
          redacted: true,
        },
      ] as T[]
    }

    if (sql.includes('FROM skills')) {
      return [
        {
          id: 'skill-design-review',
          name: '方案评审',
          stage: 'design',
          description: 'Review design risk.',
          version: '0.1.0',
          enabled: true,
          source: 'team',
        },
      ] as T[]
    }

    if (sql.includes('FROM mcp_server_definitions')) {
      return [
        {
          id: 'mcp-github',
          name: 'GitHub',
          command: 'mcp-server-github',
          permission: 'network',
          enabled_by_default: false,
          last_audit_event: 'Query PR checks.',
        },
      ] as T[]
    }

    return []
  }

  async checkout() {
    this.checkoutCount += 1
    return {
      query: <T>(sql: string, params?: unknown[]) => this.query<T>(sql, params),
      release: () => {
        this.releaseCount += 1
      },
    }
  }

  async close(): Promise<void> {
    return undefined
  }
}

class ReleasedWorkRequestRunDbClient extends FakeTeamDbClient {
  override async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    if (sql.includes('/* run_summary:authority-lock */')) {
      this.queries.push(params === undefined ? { sql } : { sql, params })
      return []
    }
    if (sql.includes('/* run_summary:current-work-request-claim */')) {
      this.queries.push(params === undefined ? { sql } : { sql, params })
      return []
    }
    if (sql.includes('/* run_summary:released-claim-tombstone */')) {
      this.queries.push(params === undefined ? { sql } : { sql, params })
      return [
        {
          work_request_id: 'wr-released',
          claimed_by_token_id: 'desktop-token-p-payments',
        } as T,
      ]
    }
    return super.query<T>(sql, params)
  }
}

class CurrentWorkRequestRunDbClient extends FakeTeamDbClient {
  constructor(private readonly claimantTokenId: string) {
    super()
  }

  override async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    if (sql.includes('/* run_summary:authority-lock */')) {
      this.queries.push(params === undefined ? { sql } : { sql, params })
      return []
    }
    if (sql.includes('/* run_summary:current-work-request-claim */')) {
      this.queries.push(params === undefined ? { sql } : { sql, params })
      return [
        {
          id: 'wr-current',
          status: 'materialized',
          claimed_by_token_id: this.claimantTokenId,
        } as T,
      ]
    }
    if (sql.includes('/* run_summary:released-claim-tombstone */')) {
      this.queries.push(params === undefined ? { sql } : { sql, params })
      return []
    }
    return super.query<T>(sql, params)
  }
}

class HistoricalGateOverrideDbClient extends FakeTeamDbClient {
  override async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    const marker = gateCommandMarker(sql)
    if (marker === 'cookie-identity') {
      this.queries.push(params === undefined ? { sql } : { sql, params })
      return [
        {
          user_id: 'u-ling',
          organization_id: 'org-demo',
          organization_role: 'lead',
          project_role: 'lead',
        } as T,
      ]
    }
    if (marker === 'create-authority') {
      this.queries.push(params === undefined ? { sql } : { sql, params })
      return [
        {
          work_request_id: 'work-request-gate-history',
          claimed_by_token_id: 'desktop-token-gate-history',
          run_id: 'run-remote-1',
          run_version: 4,
          current_node_id: 'run-remote-1:n-design-gate',
          creator_id: 'u-ling',
        } as T,
      ]
    }
    if (marker === 'create') {
      this.queries.push(params === undefined ? { sql } : { sql, params })
      const values = params ?? []
      return [
        {
          id: values[0],
          version: 1,
          organization_id: values[1],
          project_id: values[2],
          work_request_id: values[3],
          run_id: values[4],
          node_id: values[5],
          action: values[6],
          workflow_command: values[7],
          reason: values[8],
          requested_by_user_id: values[9],
          requested_role: values[10],
          idempotency_key: values[11],
          request_fingerprint: values[12],
          expected_run_version: values[13],
          expected_policy_version: values[14],
          expected_blocker_ids: values[15],
          evaluation_status: values[16],
          evaluation_blocker_ids: values[17],
          evaluated_at: values[18],
          status: 'pending',
          outcome_code: null,
          expires_at: values[19],
          created_at: values[18],
          updated_at: values[18],
        } as T,
      ]
    }
    if (sql.includes('FROM gate_override_decisions')) {
      this.queries.push(params === undefined ? { sql } : { sql, params })
      return [
        {
          id: 'gate-override-stale-pass-history',
          run_id: 'run-remote-1',
          node_id: 'n-design-gate',
          project_id: 'p-payments',
          user_id: 'u-ling',
          role: 'lead',
          reason: 'This decision belongs to an obsolete policy snapshot.',
          blocked_reason_ids: ['obsolete-blocker'],
          policy_version: 999,
          provisional: false,
          status: 'accepted',
          created_at: '2026-07-31T12:00:00.000Z',
        } as T,
      ]
    }
    return super.query<T>(sql, params)
  }
}

class ExistingRunProjectionDbClient extends FakeTeamDbClient {
  constructor(private readonly projection: Record<string, unknown>) {
    super(true, false)
  }

  override async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    if (sql.includes('workflow_runs.run_version') && sql.includes('node_stage')) {
      this.queries.push(params === undefined ? { sql } : { sql, params })
      return [this.projection as T]
    }

    return super.query<T>(sql, params)
  }
}

class NamespacedMixedOriginDbClient extends FakeTeamDbClient {
  override async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    if (sql.includes('FROM workflow_runs') && !sql.includes('SELECT id')) {
      this.queries.push(params === undefined ? { sql } : { sql, params })
      return [
        {
          id: 'run-health-001',
          run_version: 1,
          title: 'Seeded health endpoint',
          request: 'Ship the seeded health endpoint.',
          project_id: 'p-payments',
          creator_id: 'u-ling',
          status: 'paused_at_gate',
          current_node_id: 'run-health-001:n-clarify-gate',
          branch_name: 'ai/seeded-health-endpoint',
          pull_request_url: null,
          data_origin: 'seed',
          created_at: '2026-06-16T09:00:00.000Z',
          updated_at: '2026-06-16T09:15:00.000Z',
        },
        {
          id: 'run-remote-1',
          run_version: 4,
          title: 'Remote health endpoint',
          request: 'Add team-visible health endpoint evidence.',
          project_id: 'p-payments',
          creator_id: 'u-ling',
          status: 'paused_at_gate',
          current_node_id: 'run-remote-1:n-design-gate',
          branch_name: 'ai/health-endpoint',
          pull_request_url: null,
          data_origin: 'remote',
          created_at: '2026-06-16T10:00:00.000Z',
          updated_at: '2026-06-16T10:15:00.000Z',
        },
      ] as T[]
    }

    if (sql.includes('FROM workflow_nodes')) {
      this.queries.push(params === undefined ? { sql } : { sql, params })
      return [
        {
          id: 'run-health-001:n-clarify-gate',
          run_id: 'run-health-001',
          stage: 'clarify',
          title: 'Clarify Gate',
          subtitle: 'Lead approval before design',
          kind: 'gate',
          status: 'blocked',
          owner_id: 'u-ling',
          required_role: 'lead',
          retry_count: 0,
          token_usage_id: null,
          position: 0,
        },
        {
          id: 'run-remote-1:n-design-gate',
          run_id: 'run-remote-1',
          stage: 'design',
          title: 'Architecture Gate',
          subtitle: 'Lead approval before implementation',
          kind: 'gate',
          status: 'blocked',
          owner_id: 'u-ling',
          required_role: 'lead',
          retry_count: 0,
          token_usage_id: null,
          position: 0,
        },
      ] as T[]
    }

    if (sql.includes('FROM workflow_edges')) {
      this.queries.push(params === undefined ? { sql } : { sql, params })
      return [
        {
          id: 'run-health-001:edge-clarify-design',
          run_id: 'run-health-001',
          source_node_id: 'run-health-001:n-clarify-gate',
          target_node_id: 'run-health-001:n-design',
          kind: 'gate',
        },
        {
          id: 'run-remote-1:edge-design-build',
          run_id: 'run-remote-1',
          source_node_id: 'run-remote-1:n-design-gate',
          target_node_id: 'run-remote-1:n-build',
          kind: 'gate',
        },
      ] as T[]
    }

    if (sql.includes('FROM artifacts')) {
      this.queries.push(params === undefined ? { sql } : { sql, params })
      return [
        {
          id: 'run-health-001:art-clarify',
          run_id: 'run-health-001',
          node_id: 'run-health-001:n-clarify-gate',
          kind: 'spec',
          title: 'Seeded clarification',
          summary: 'Seeded clarification artifact.',
          content: 'Seeded clarification content.',
          redacted: false,
          updated_at: '2026-06-16T09:14:00.000Z',
        },
        {
          id: 'run-remote-1:art-design',
          run_id: 'run-remote-1',
          node_id: 'run-remote-1:n-design-gate',
          kind: 'design',
          title: 'Remote design summary',
          summary: 'Remote design artifact summary.',
          content: 'Redacted remote artifact content.',
          redacted: true,
          updated_at: '2026-06-16T10:14:00.000Z',
        },
      ] as T[]
    }

    if (sql.includes('FROM agent_events')) {
      this.queries.push(params === undefined ? { sql } : { sql, params })
      return [] as T[]
    }

    return super.query<T>(sql, params)
  }
}

class EmptyBootstrapDbClient implements TeamDbRepositoryClient {
  readonly queries: Array<{ sql: string; params?: unknown[] }> = []

  async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    this.queries.push(params === undefined ? { sql } : { sql, params })

    if (sql.includes('FROM auth_accounts')) {
      return [] as T[]
    }

    if (sql.includes('FROM organizations')) {
      return [] as T[]
    }

    return [] as T[]
  }

  async close(): Promise<void> {
    return undefined
  }

  async checkout() {
    return {
      query: <T>(sql: string, params?: unknown[]) => this.query<T>(sql, params),
      release() {},
    }
  }
}

class ExistingOrganizationNoAccountDbClient implements TeamDbRepositoryClient {
  readonly queries: Array<{ sql: string; params?: unknown[] }> = []

  async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    this.queries.push(params === undefined ? { sql } : { sql, params })

    if (sql.includes('FROM auth_accounts')) {
      return [] as T[]
    }

    if (sql.includes('FROM organizations')) {
      return [
        {
          id: 'org-existing',
          name: 'Existing Team',
          slug: 'existing-team',
        },
      ] as T[]
    }

    return [] as T[]
  }

  async close(): Promise<void> {
    return undefined
  }

  async checkout() {
    return {
      query: <T>(sql: string, params?: unknown[]) => this.query<T>(sql, params),
      release() {},
    }
  }
}

class OrganizationScopedReadDbClient implements TeamDbRepositoryClient {
  readonly queries: Array<{ sql: string; params?: unknown[] }> = []

  async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    this.queries.push(params === undefined ? { sql } : { sql, params })
    const hasRequestedOrganization =
      params?.[0] === 'org-other' && /organization_id\s*=\s*\$1/.test(sql)

    if (/FROM\s+projects\b/.test(sql)) {
      return (hasRequestedOrganization
        ? []
        : [
            {
              id: 'p-demo-private',
              name: 'Demo private project',
              slug: 'demo-private',
              description: 'Must remain inside org-demo.',
              repository: 'demo/private',
              default_branch: 'main',
              health: 'on_track',
              knowledge_base_path: 'docs/',
              test_command: 'pnpm test',
            },
          ]) as T[]
    }

    if (/FROM\s+workflow_runs\b/.test(sql)) {
      return (hasRequestedOrganization
        ? []
        : [
            {
              id: 'run-demo-private',
              run_version: 1,
              title: 'Demo private run',
              request: 'Must remain inside org-demo.',
              project_id: 'p-demo-private',
              creator_id: 'u-demo',
              status: 'building',
              current_node_id: 'node-build',
              branch_name: 'ai/demo-private',
              pull_request_url: null,
              created_at: '2026-06-16T10:00:00.000Z',
              updated_at: '2026-06-16T10:15:00.000Z',
            },
          ]) as T[]
    }

    if (/FROM\s+agent_provider_credentials\b/.test(sql)) {
      return (hasRequestedOrganization
        ? []
        : [{
            organization_id: 'org-demo',
            provider_id: 'private-provider',
            model: 'private-model',
            base_url: 'https://private.example.invalid',
            masked_credential: 'private...secret',
            encrypted_secret: 'encrypted-private-secret',
            updated_at: '2026-06-16T10:15:00.000Z',
          }]) as T[]
    }

    if (/FROM\s+skills\b/.test(sql)) {
      return (hasRequestedOrganization ? [] : [{
        id: 'skill-private',
        organization_id: 'org-demo',
        name: 'Private skill',
        stage: 'all',
        description: 'Must stay in org-demo.',
        version: '1.0.0',
        enabled: true,
        source: 'team',
      }]) as T[]
    }

    if (/FROM\s+mcp_server_definitions\b/.test(sql)) {
      return (hasRequestedOrganization ? [] : [{
        id: 'mcp-private',
        organization_id: 'org-demo',
        name: 'Private MCP',
        command: 'private-command',
        permission: 'shell',
        enabled_by_default: false,
        last_audit_event: 'private audit',
      }]) as T[]
    }

    return []
  }

  async close(): Promise<void> {
    return undefined
  }

  async checkout() {
    return {
      query: <T>(sql: string, params?: unknown[]) => this.query<T>(sql, params),
      release() {},
    }
  }
}

describe('Postgres team repository', () => {
  it('does not inject a historical Gate override into a non-blocking Postgres enforcement decision', async () => {
    const repository = createPostgresTeamRepository(
      new HistoricalGateOverrideDbClient(),
    )

    await expect(
      repository.createGateCommand(
        {
          projectId: 'p-payments',
          runId: 'run-remote-1',
          nodeId: 'n-design-gate',
          action: 'approve',
          reason: 'Approve the current non-blocking policy snapshot.',
          expectedRunVersion: 4,
          expectedPolicyVersion: 1,
          expectedBlockerIds: [],
          idempotencyKey: 'gate-command:create:postgres-pass-history:v4',
        },
        postgresGatePrincipal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      responseStatus: 201,
      outcomeCode: 'created',
    })
  })

  it('scopes Run and overview reads to the requested organization in SQL', async () => {
    const db = new OrganizationScopedReadDbClient()
    const repository = createPostgresTeamRepository(db)
    const context = { organizationId: 'org-other' }

    const scopedDefinitions = repository as unknown as {
      getSkills(input: typeof context): ReturnType<typeof repository.getSkills>
      getMcpServers(input: typeof context): ReturnType<typeof repository.getMcpServers>
    }
    const [bundle, overview, providers, scopedSkills, scopedMcpServers] = await Promise.all([
      repository.getRunsBundle(context),
      repository.getTeamOverview(context),
      repository.listAgentProviders({ ...context, userId: 'u-other' }),
      scopedDefinitions.getSkills(context),
      scopedDefinitions.getMcpServers(context),
    ])

    expect(bundle).toEqual({ runs: [], artifacts: [], events: [] })
    expect(overview.projects).toEqual([])
    expect(overview.runs).toEqual([])
    expect(providers).toEqual([])
    expect(scopedSkills).toEqual([])
    expect(scopedMcpServers).toEqual([])
    expect(overview.enforcementPolicies.organizationPolicy.organizationId).toBe('org-other')
    expect(db.queries.length).toBeGreaterThan(0)
    expect(db.queries.every((query) => query.params?.[0] === 'org-other')).toBe(true)
    const eventQuery = db.queries.find((query) => /FROM\s+agent_events\b/.test(query.sql))
    expect(eventQuery?.sql).toMatch(
      /JOIN\s+workflow_runs\s+ON\s+workflow_runs\.id\s*=\s*agent_events\.run_id/,
    )
    expect(eventQuery?.sql).toMatch(/workflow_runs\.organization_id\s*=\s*\$1/)
  })

  it('maps workflow runs with nodes, edges, artifacts, and events', async () => {
    const db = new FakeTeamDbClient()
    const repository = createPostgresTeamRepository(db)

    const bundle = await repository.getRunsBundle(readContext)

    expect(bundle.runs[0]).toMatchObject({
      id: 'run-remote-1',
      version: 4,
      projectId: 'p-payments',
      currentNodeId: 'n-design-gate',
      nodes: [
        {
          id: 'n-design-gate',
          requiredRole: 'lead',
          artifactIds: ['art-design'],
        },
      ],
      edges: [{ id: 'edge-1', source: 'n-design-gate', target: 'n-test', kind: 'gate' }],
    })
    expect(bundle.artifacts[0]).toMatchObject({ id: 'art-design', redacted: true })
    expect(bundle.events[0]).toMatchObject({ id: 'ev-approval', kind: 'approval' })
  })

  it('preserves globally namespaced workflow IDs across seeded and remote Postgres runs', async () => {
    const repository = createPostgresTeamRepository(new NamespacedMixedOriginDbClient())

    const bundle = await repository.getRunsBundle(readContext)

    expect(bundle.runs).toEqual([
      expect.objectContaining({
        id: 'run-health-001',
        version: 1,
        currentNodeId: 'run-health-001:n-clarify-gate',
        nodes: [expect.objectContaining({ id: 'run-health-001:n-clarify-gate' })],
        edges: [
          expect.objectContaining({
            source: 'run-health-001:n-clarify-gate',
            target: 'run-health-001:n-design',
          }),
        ],
      }),
      expect.objectContaining({
        id: 'run-remote-1',
        version: 4,
        currentNodeId: 'run-remote-1:n-design-gate',
        nodes: [expect.objectContaining({ id: 'run-remote-1:n-design-gate' })],
        edges: [
          expect.objectContaining({
            source: 'run-remote-1:n-design-gate',
            target: 'run-remote-1:n-build',
          }),
        ],
      }),
    ])
    expect(bundle.artifacts.map((artifact) => artifact.nodeId)).toEqual([
      'run-health-001:n-clarify-gate',
      'run-remote-1:n-design-gate',
    ])
  })

  it('builds team overview and cost rollups from Postgres rows', async () => {
    const repository = createPostgresTeamRepository(new FakeTeamDbClient())

    const overview = await repository.getTeamOverview(readContext)

    expect(overview.projects[0]).toMatchObject({
      id: 'p-payments',
      slug: 'payments-api',
      description: 'Payment workflow service.',
      defaultBranch: 'main',
      knowledgeBasePath: 'docs/payments/',
    })
    expect(overview.members[0]).toMatchObject({ id: 'u-ling', avatarInitials: 'LG' })
    expect(overview.projectCost).toEqual([
      {
        key: 'p-payments',
        inputTokens: 1000,
        outputTokens: 300,
        cacheReadTokens: 200,
        totalTokens: 1500,
        costUsd: 0.109,
      },
    ])
    expect(overview.totalCost).toBe('$0.109')
    expect(
      overview.enforcementPolicies.effectivePolicies.map((policy) => policy.projectId),
    ).toEqual(overview.projects.map((project) => project.id))
    expect(overview.testEvidenceSummaries).toEqual([
      {
        id: 'evidence-remote-1',
        runId: 'run-remote-1',
        nodeId: 'n-test',
        projectId: 'p-payments',
        command: 'pnpm test',
        status: 'passed',
        exitCode: 0,
        durationMs: 1200,
        summary: 'Remote tests passed.',
        redacted: true,
        createdAt: '2026-06-16T10:20:00.000Z',
      },
    ])
    expect(overview.codingAgentSummaries).toEqual([
      {
        id: 'coding-run-remote-1',
        runId: 'run-remote-1',
        nodeId: 'n-build',
        projectId: 'p-payments',
        requestedBy: 'u-ling',
        providerId: 'fake-coding-engine',
        engine: 'fake',
        status: 'completed',
        branchName: 'devflow/run-remote-1-n-build-coding-run-remote-1',
        summary: 'Coding summary stored in Postgres.',
        changedPaths: ['src/health.ts'],
        startedAt: '2026-06-16T10:18:00.000Z',
        completedAt: '2026-06-16T10:19:00.000Z',
        redacted: true,
      },
    ])
  })

  it('scopes the effective policy returned for a project without an override', async () => {
    const repository = createPostgresTeamRepository(new FakeTeamDbClient())

    const result = await repository.getEnforcementPolicy('p-payments', {
      ...readContext,
      userId: 'u-ling',
    })

    expect(result.projectOverride).toBeNull()
    expect(result.effectivePolicy.projectId).toBe('p-payments')
  })

  it('only exposes the fake agent provider when fake runtime is enabled', async () => {
    await expect(createPostgresTeamRepository(new FakeTeamDbClient()).listAgentProviders({
      organizationId: 'org-demo',
      userId: 'u-ling',
    })).resolves.toEqual([])

    await expect(createPostgresTeamRepository(new FakeTeamDbClient(), {
      fakeRuntimeEnabled: true,
    }).listAgentProviders({
      organizationId: 'org-demo',
      userId: 'u-ling',
    })).resolves.toEqual([
      expect.objectContaining({ id: 'fake-knowledge-review', kind: 'fake' }),
    ])
  })

  it('maps skills and MCP server definitions from team tables', async () => {
    const repository = createPostgresTeamRepository(new FakeTeamDbClient())

    await expect(repository.getSkills(readContext)).resolves.toEqual([
      {
        id: 'skill-design-review',
        name: '方案评审',
        stage: 'design',
        description: 'Review design risk.',
        version: '0.1.0',
        enabled: true,
        source: 'team',
      },
    ])
    await expect(repository.getMcpServers(readContext)).resolves.toEqual([
      {
        id: 'mcp-github',
        name: 'GitHub',
        command: 'mcp-server-github',
        permission: 'network',
        enabledLocally: false,
        lastAuditEvent: 'Query PR checks.',
      },
    ])
  })

  it('resolves authenticated identity from auth_accounts and existing project_members', async () => {
    const db = new FakeTeamDbClient()
    const repository = createPostgresTeamRepository(db)

    await expect(
      repository.getAuthenticatedIdentity({
        provider: 'github',
        providerAccountId: 'github:ling',
      }),
    ).resolves.toEqual({
      user: {
        id: 'u-ling',
        organizationId: 'org-demo',
        name: 'Ling',
        role: 'lead',
        email: 'ling@example.com',
        avatarUrl: 'https://avatars.example/ling.png',
        avatarInitials: 'LG',
        focus: 'Architecture',
        createdAt: '2026-06-16T08:00:00.000Z',
        updatedAt: '2026-06-16T08:05:00.000Z',
      },
      authAccount: {
        id: 'acct-github-ling',
        userId: 'u-ling',
        provider: 'github',
        providerAccountId: 'github:ling',
        username: 'ling-gh',
        email: 'ling@example.com',
        createdAt: '2026-06-16T09:00:00.000Z',
        updatedAt: '2026-06-16T09:05:00.000Z',
      },
      projectMemberships: [
        { projectId: 'p-payments', userId: 'u-ling', role: 'lead' },
        { projectId: 'p-admin', userId: 'u-ling', role: 'member' },
      ],
    })

    expect(db.queries[0]?.sql).toContain('FROM auth_accounts')
    expect(db.queries[0]?.params).toEqual(['github', 'github:ling'])
    expect(db.queries[1]?.sql).toContain('FROM project_members')
    expect(db.queries[1]?.params).toEqual(['u-ling'])
  })

  it('resolves a fresh browser session by stable auth account ID', async () => {
    const db = new FakeTeamDbClient()
    const repository = createPostgresTeamRepository(db)

    await expect(repository.resolveBrowserSession('acct-github-ling')).resolves.toEqual({
      source: 'authenticated',
      organizationId: 'org-demo',
      userId: 'u-ling',
      role: 'lead',
      authAccountId: 'acct-github-ling',
      projectMemberships: [
        { projectId: 'p-payments', userId: 'u-ling', role: 'lead' },
        { projectId: 'p-admin', userId: 'u-ling', role: 'member' },
      ],
    })

    expect(db.queries[0]?.sql).toContain('auth_accounts.id = $1')
    expect(db.queries[0]?.params).toEqual(['acct-github-ling'])
    expect(db.queries[1]?.sql).toContain('JOIN projects')
    expect(db.queries[1]?.sql).toContain('projects.organization_id = $2')
    expect(db.queries[1]?.params).toEqual(['u-ling', 'org-demo'])
  })

  it('bootstraps the first GitHub login as the default organization owner only when the deployment is empty', async () => {
    const db = new EmptyBootstrapDbClient()
    const repository = createPostgresTeamRepository(db)

    await expect(
      repository.resolveOrBootstrapGitHubIdentity({
        providerAccountId: '123456',
        username: 'erich04',
        name: 'Erich',
        email: 'erich@example.com',
        avatarUrl: 'https://avatars.example/erich.png',
      }),
    ).resolves.toMatchObject({
      status: 'created',
      identity: {
        user: {
          id: 'u-github-123456',
          organizationId: 'org-default',
          name: 'Erich',
          role: 'owner',
          email: 'erich@example.com',
          avatarUrl: 'https://avatars.example/erich.png',
        },
        authAccount: {
          id: 'acct-github-123456',
          userId: 'u-github-123456',
          provider: 'github',
          providerAccountId: '123456',
          username: 'erich04',
          email: 'erich@example.com',
        },
        projectMemberships: [],
      },
    })

    expect(db.queries.some((query) => query.sql.includes('INSERT INTO organizations'))).toBe(true)
    expect(db.queries.some((query) => query.sql.includes('INSERT INTO users'))).toBe(true)
    expect(db.queries.some((query) => query.sql.includes('INSERT INTO auth_accounts'))).toBe(true)
  })

  it('does not silently make a later unknown GitHub login an owner when an organization already exists', async () => {
    const db = new ExistingOrganizationNoAccountDbClient()
    const repository = createPostgresTeamRepository(db)

    await expect(
      repository.resolveOrBootstrapGitHubIdentity({
        providerAccountId: '999999',
        username: 'new-person',
        name: 'New Person',
      }),
    ).resolves.toEqual({
      status: 'blocked',
      reason: 'organization_exists',
    })

    expect(db.queries.some((query) => query.sql.includes('INSERT INTO users'))).toBe(false)
    expect(db.queries.some((query) => query.sql.includes('INSERT INTO auth_accounts'))).toBe(false)
  })

  it('creates a minimal team project and records the creator as project owner', async () => {
    const db = new EmptyBootstrapDbClient()
    const repository = createPostgresTeamRepository(db)

    await expect(
      repository.createProject(
        {
          name: 'Agent Platform',
          slug: 'agent-platform',
          description: 'Pilot project for Agent platform delivery.',
          repository: 'erich/agent-platform',
        },
        { organizationId: 'org-default', userId: 'u-github-123456' },
      ),
    ).resolves.toEqual({
      id: 'p-agent-platform',
      name: 'Agent Platform',
      slug: 'agent-platform',
      description: 'Pilot project for Agent platform delivery.',
      repository: 'erich/agent-platform',
      defaultBranch: 'main',
      health: 'on_track',
      knowledgeBasePath: 'docs/agent-platform/',
      testCommand: '',
    })

    expect(db.queries.some((query) => query.sql.includes('INSERT INTO projects'))).toBe(true)
    expect(db.queries.some((query) => query.sql.includes('INSERT INTO project_members'))).toBe(true)
    expect(db.queries.at(-1)?.params).toEqual([
      'p-agent-platform',
      'u-github-123456',
      'owner',
    ])
  })

  it('creates desktop pairing codes without storing the copy-once code plaintext', async () => {
    const db = new FakeTeamDbClient()
    const repository = createPostgresTeamRepository(db)

    const result = await repository.createDesktopPairingCode(
      { projectId: 'p-payments' },
      { organizationId: 'org-demo', userId: 'u-ling' },
    )

    expect(result).toMatchObject({
      organizationId: 'org-demo',
      projectId: 'p-payments',
      createdByUserId: 'u-ling',
      attemptsRemaining: 5,
    })
    expect(result.code).toContain('.')
    const insert = db.queries.find((query) => query.sql.includes('INSERT INTO desktop_pairing_codes'))
    expect(insert?.sql).toMatch(/INSERT INTO desktop_pairing_codes[\s\S]+SELECT[\s\S]+FROM projects/)
    expect(insert?.sql).toMatch(/projects\.organization_id\s*=\s*\$2/)
    const write = db.queries.find((query) => query.sql.includes('INSERT INTO desktop_pairing_codes'))
    expect(write?.params).toHaveLength(8)
    expect(write?.params).not.toContain(result.code)
    expect(write?.params).not.toContain(result.code.split('.')[1])
  })

  it('resolves desktop bearer tokens as authenticated project-scoped sessions', async () => {
    const db = new FakeTeamDbClient()
    const repository = createPostgresTeamRepository(db)

    await expect(repository.resolveDesktopTokenSession('desktop-token-p-payments.demo-secret')).resolves.toEqual({
      tokenRecordId: 'desktop-token-p-payments',
      session: {
        source: 'authenticated',
        organizationId: 'org-demo',
        userId: 'u-ling',
        role: 'lead',
        authAccountId: 'acct-github-ling',
        projectMemberships: [
          { projectId: 'p-payments', userId: 'u-ling', role: 'lead' },
        ],
      },
    })

    const tokenQuery = db.queries.find((query) => query.sql.includes('FROM desktop_tokens'))
    expect(tokenQuery?.sql).toContain(
      'users.organization_id = desktop_tokens.organization_id',
    )
    const membershipQuery = db.queries.find((query) =>
      query.sql.includes('FROM project_members'),
    )
    expect(membershipQuery?.sql).toContain('JOIN projects')
    expect(membershipQuery?.sql).toContain('project_id = $2')
    expect(membershipQuery?.sql).toContain('projects.organization_id = $3')
    expect(membershipQuery?.params).toEqual(['u-ling', 'p-payments', 'org-demo'])
  })

  it('downgrades organization owners to project-lead authority for desktop bearer tokens', async () => {
    const repository = createPostgresTeamRepository(new FakeTeamDbClient(true, true, 'owner'))

    await expect(
      repository.resolveDesktopTokenSession('desktop-token-p-payments.demo-secret'),
    ).resolves.toMatchObject({
      tokenRecordId: 'desktop-token-p-payments',
      session: {
        role: 'lead',
        projectMemberships: [
          { projectId: 'p-payments', userId: 'u-ling', role: 'lead' },
        ],
      },
    })
  })

  it('writes run summaries into workflow_runs with tenant context', async () => {
    const db = new FakeTeamDbClient()
    const repository = createPostgresTeamRepository(db)

    await expect(
      repository.uploadRunSummary(
        {
          kind: 'approval',
          runId: 'run-synced',
          version: 7,
          projectId: 'p-payments',
          title: 'Synced approval',
          status: 'building',
          currentNodeId: 'n-build',
          currentNode: { id: 'n-build', stage: 'build', kind: 'task', status: 'running' },
          branchName: 'ai/synced-approval',
          updatedAt: '2026-06-16T12:00:00.000Z',
        },
        { organizationId: 'org-demo', userId: 'u-ling' },
      ),
    ).resolves.toMatchObject({
      accepted: true,
      message: 'run summary written to Postgres repository',
    })

    const write = db.queries.find((query) => query.sql.includes('INSERT INTO workflow_runs'))
    expect(write?.sql).toContain('INSERT INTO workflow_runs')
    expect(write?.sql).toContain('run_version')
    expect(write?.sql).toContain('ON CONFLICT (id) DO UPDATE')
    const updateClause = write?.sql.split('SET')[1]?.split('WHERE')[0]
    expect(updateClause).not.toContain('project_id = excluded.project_id')
    expect(write?.sql).toContain('workflow_runs.organization_id = excluded.organization_id')
    expect(write?.sql).toContain('workflow_runs.project_id = excluded.project_id')
    expect(write?.sql).toContain('workflow_runs.creator_id = excluded.creator_id')
    expect(write?.sql).toContain("workflow_runs.data_origin = 'remote'")
    expect(write?.sql).toContain('workflow_runs.run_version < excluded.run_version')
    expect(write?.sql).not.toContain('workflow_runs.updated_at <= excluded.updated_at')
    expect(write?.sql).toContain('RETURNING id')
    expect(write?.params).toEqual([
      'run-synced',
      7,
      'org-demo',
      'p-payments',
      'u-ling',
      'Synced approval',
      'Synced from DevFlow Electron.',
      'building',
      'run-synced:n-build',
      'ai/synced-approval',
      '2026-06-16T12:00:00.000Z',
    ])
    const nodeWrite = db.queries.find((query) => query.sql.includes('INSERT INTO workflow_nodes'))
    expect(nodeWrite?.params).toEqual([
      'run-synced:n-build',
      'run-synced',
      'build',
      'Synced build node',
      'Canonical current node from DevFlow Electron.',
      'task',
      'running',
      'u-ling',
      null,
      400,
      '2026-06-16T12:00:00.000Z',
    ])
    const statements = db.queries.map(({ sql }) => sql.trim())
    const beginIndex = statements.indexOf('BEGIN')
    const runWriteIndex = db.queries.findIndex(({ sql }) => sql.includes('INSERT INTO workflow_runs'))
    const convergenceIndex = db.queries.findIndex(
      ({ sql }) => sql.includes('UPDATE workflow_nodes'),
    )
    const nodeWriteIndex = db.queries.findIndex(
      ({ sql }) => sql.includes('INSERT INTO workflow_nodes'),
    )
    const commitIndex = statements.indexOf('COMMIT')
    expect(beginIndex).toBeGreaterThanOrEqual(0)
    expect(runWriteIndex).toBeGreaterThan(beginIndex)
    expect(convergenceIndex).toBeGreaterThan(runWriteIndex)
    expect(nodeWriteIndex).toBeGreaterThan(convergenceIndex)
    expect(commitIndex).toBeGreaterThan(nodeWriteIndex)
    expect(statements).not.toContain('ROLLBACK')
    expect(db.checkoutCount).toBe(1)
    expect(db.releaseCount).toBe(1)
  })

  it('rejects a late Run projection after its Work Request claim was released', async () => {
    const db = new ReleasedWorkRequestRunDbClient()
    const repository = createPostgresTeamRepository(db)

    await expect(
      repository.uploadRunSummary(
        {
          kind: 'run',
          runId: 'run-released-work-request',
          version: 1,
          projectId: 'p-payments',
          title: 'Released Work Request Run',
          status: 'clarifying',
          currentNodeId: 'n-clarify',
          currentNode: {
            id: 'n-clarify',
            stage: 'clarify',
            kind: 'task',
            status: 'running',
          },
          branchName: 'ai/released-work-request',
          updatedAt: '2026-08-01T12:00:00.000Z',
        },
        {
          organizationId: 'org-demo',
          userId: 'u-ling',
          tokenRecordId: 'desktop-token-p-payments',
        },
      ),
    ).rejects.toThrow('Remote Run Summary conflicts with canonical ownership or is stale')

    const statements = db.queries.map(({ sql }) => sql.trim())
    expect(statements.indexOf('BEGIN')).toBeGreaterThanOrEqual(0)
    const authorityLockIndex = db.queries.findIndex(({ sql }) =>
      sql.includes('/* run_summary:authority-lock */'),
    )
    const tombstoneIndex = db.queries.findIndex(({ sql }) =>
      sql.includes('/* run_summary:released-claim-tombstone */'),
    )
    expect(authorityLockIndex).toBeGreaterThan(statements.indexOf('BEGIN'))
    expect(authorityLockIndex).toBeLessThan(tombstoneIndex)
    expect(
      db.queries.some(({ sql }) => sql.includes('INSERT INTO workflow_runs')),
    ).toBe(false)
    expect(statements).toContain('ROLLBACK')
  })

  it('rejects a Work Request Run projection from a stale Desktop token', async () => {
    const db = new CurrentWorkRequestRunDbClient('desktop-token-current')
    const repository = createPostgresTeamRepository(db)

    await expect(
      repository.uploadRunSummary(
        {
          kind: 'run',
          runId: 'run-current-work-request',
          version: 1,
          projectId: 'p-payments',
          title: 'Current Work Request Run',
          status: 'clarifying',
          currentNodeId: 'n-clarify',
          currentNode: {
            id: 'n-clarify',
            stage: 'clarify',
            kind: 'task',
            status: 'running',
          },
          branchName: 'ai/current-work-request',
          updatedAt: '2026-08-01T12:00:00.000Z',
        },
        {
          organizationId: 'org-demo',
          userId: 'u-ling',
          tokenRecordId: 'desktop-token-stale',
        },
      ),
    ).rejects.toThrow('Remote Run Summary conflicts with canonical ownership or is stale')

    expect(
      db.queries.some(({ sql }) => sql.includes('INSERT INTO workflow_runs')),
    ).toBe(false)
  })

  it('accepts a Work Request Run projection only from its exact claimant token', async () => {
    const db = new CurrentWorkRequestRunDbClient('desktop-token-current')
    const repository = createPostgresTeamRepository(db)

    await expect(
      repository.uploadRunSummary(
        {
          kind: 'run',
          runId: 'run-current-work-request',
          version: 1,
          projectId: 'p-payments',
          title: 'Current Work Request Run',
          status: 'clarifying',
          currentNodeId: 'n-clarify',
          currentNode: {
            id: 'n-clarify',
            stage: 'clarify',
            kind: 'task',
            status: 'running',
          },
          branchName: 'ai/current-work-request',
          updatedAt: '2026-08-01T12:00:00.000Z',
        },
        {
          organizationId: 'org-demo',
          userId: 'u-ling',
          tokenRecordId: 'desktop-token-current',
        },
      ),
    ).resolves.toMatchObject({ accepted: true })

    const beginIndex = db.queries.findIndex(({ sql }) => sql.trim() === 'BEGIN')
    const authorityLockIndex = db.queries.findIndex(({ sql }) =>
      sql.includes('/* run_summary:authority-lock */'),
    )
    const firstBusinessQueryIndex = db.queries.findIndex(
      ({ sql }) => sql.trim() !== 'BEGIN',
    )
    expect(authorityLockIndex).toBeGreaterThan(beginIndex)
    expect(authorityLockIndex).toBe(firstBusinessQueryIndex)
    expect(db.queries[authorityLockIndex]?.params).toEqual([
      '["org-demo","p-payments","run-current-work-request"]',
    ])
    expect(
      db.queries.some(({ sql }) => sql.includes('INSERT INTO workflow_runs')),
    ).toBe(true)
  })

  it('rolls back the Run projection when the canonical node write fails', async () => {
    const db = new FakeTeamDbClient(
      true,
      true,
      'lead',
      'INSERT INTO workflow_nodes',
    )
    const repository = createPostgresTeamRepository(db)

    await expect(repository.uploadRunSummary(
      {
        kind: 'run',
        runId: 'run-atomic-failure',
        version: 2,
        projectId: 'p-payments',
        title: 'Atomic Run projection',
        status: 'testing',
        currentNodeId: 'n-test',
        currentNode: {
          id: 'n-test',
          stage: 'test',
          kind: 'test',
          status: 'running',
        },
        branchName: 'ai/atomic-run-projection',
        updatedAt: '2026-08-01T12:00:00.000Z',
      },
      { organizationId: 'org-demo', userId: 'u-ling' },
    )).rejects.toThrow('forced repository write failure: INSERT INTO workflow_nodes')

    const statements = db.queries.map(({ sql }) => sql.trim())
    expect(db.checkoutCount).toBe(1)
    expect(statements).toContain('ROLLBACK')
    expect(statements).not.toContain('COMMIT')
    expect(db.releaseCount).toBe(1)
  })

  it('accepts an identical Postgres projection idempotently at the same Run version', async () => {
    const summary = {
      kind: 'run' as const,
      runId: 'run-idempotent-pg',
      version: 4,
      projectId: 'p-payments',
      title: 'Idempotent Postgres projection',
      status: 'testing' as const,
      currentNodeId: 'n-test',
      currentNode: {
        id: 'n-test',
        stage: 'test' as const,
        kind: 'test' as const,
        status: 'running' as const,
      },
      branchName: 'ai/idempotent-pg',
      updatedAt: '2026-06-16T12:00:00.000Z',
    }
    const db = new ExistingRunProjectionDbClient({
      id: summary.runId,
      run_version: summary.version,
      organization_id: 'org-demo',
      project_id: summary.projectId,
      creator_id: 'u-ling',
      data_origin: 'remote',
      title: summary.title,
      status: summary.status,
      current_node_id: `${summary.runId}:${summary.currentNodeId}`,
      branch_name: summary.branchName,
      updated_at: summary.updatedAt,
      node_id: `${summary.runId}:${summary.currentNode.id}`,
      node_stage: summary.currentNode.stage,
      node_kind: summary.currentNode.kind,
      node_status: summary.currentNode.status,
      node_required_role: null,
    })
    const repository = createPostgresTeamRepository(db)

    await expect(
      repository.uploadRunSummary(summary, { organizationId: 'org-demo', userId: 'u-ling' }),
    ).resolves.toMatchObject({ accepted: true })
    expect(db.queries.some((query) => query.sql.includes('INSERT INTO workflow_nodes'))).toBe(false)
    expect(db.queries.some((query) => query.sql.includes('UPDATE workflow_nodes'))).toBe(false)

    await expect(
      repository.uploadRunSummary(
        { ...summary, title: 'Conflicting content at version four' },
        { organizationId: 'org-demo', userId: 'u-ling' },
      ),
    ).rejects.toThrow('Remote Run Summary conflicts with canonical ownership or is stale')
  })

  it('converges non-current active nodes after accepting a newer canonical summary', async () => {
    const db = new FakeTeamDbClient()
    const repository = createPostgresTeamRepository(db)

    await repository.uploadRunSummary(
      {
        kind: 'run',
        runId: 'run-synced',
        version: 8,
        projectId: 'p-payments',
        title: 'Advanced canonical Run',
        status: 'testing',
        currentNodeId: 'n-test',
        currentNode: { id: 'n-test', stage: 'test', kind: 'test', status: 'running' },
        branchName: 'ai/advanced-run',
        updatedAt: '2026-06-16T12:10:00.000Z',
      },
      { organizationId: 'org-demo', userId: 'u-ling' },
    )

    const convergenceWrite = db.queries.find(
      (query) =>
        query.sql.includes('UPDATE workflow_nodes') &&
        query.sql.includes("status IN ('running', 'blocked')"),
    )
    expect(convergenceWrite?.sql).toContain("SET status = 'success'")
    expect(convergenceWrite?.sql).toContain('id <> $2')
    expect(convergenceWrite?.params).toEqual([
      'run-synced',
      'run-synced:n-test',
      '2026-06-16T12:10:00.000Z',
    ])
  })

  it('redacts Run title and branch name again before writing them to Postgres', async () => {
    const db = new FakeTeamDbClient()
    const repository = createPostgresTeamRepository(db)

    await repository.uploadRunSummary(
      {
        kind: 'run',
        runId: 'run-hostile-metadata',
        version: 1,
        projectId: 'p-payments',
        title: 'Build from /Users/Alice/private/repo API_TOKEN=title-secret',
        status: 'building',
        currentNodeId: 'n-build',
        currentNode: { id: 'n-build', stage: 'build', kind: 'task', status: 'running' },
        branchName: 'C:\\Users\\Alice\\private\\branch API_TOKEN=branch-secret',
        updatedAt: '2026-06-16T12:10:00.000Z',
      },
      { organizationId: 'org-demo', userId: 'u-ling' },
    )

    const runWrite = db.queries.find((query) => query.sql.includes('INSERT INTO workflow_runs'))
    expect(JSON.stringify(runWrite?.params)).not.toContain('title-secret')
    expect(JSON.stringify(runWrite?.params)).not.toContain('branch-secret')
    expect(JSON.stringify(runWrite?.params)).not.toContain('/Users/Alice')
    expect(JSON.stringify(runWrite?.params)).not.toMatch(/C:[\\/]Users[\\/]Alice/)
  })

  it('rejects colliding or stale run summaries before node ownership can be rewritten', async () => {
    const db = new FakeTeamDbClient(true, false)
    const repository = createPostgresTeamRepository(db)

    await expect(
      repository.uploadRunSummary(
        {
          kind: 'run',
          runId: 'run-colliding',
          version: 1,
          projectId: 'p-payments',
          title: 'Colliding summary',
          status: 'building',
          currentNodeId: 'n-build',
          currentNode: { id: 'n-build', stage: 'build', kind: 'task', status: 'running' },
          branchName: 'ai/colliding-summary',
          updatedAt: '2026-06-16T12:00:00.000Z',
        },
        { organizationId: 'org-demo', userId: 'u-ling' },
      ),
    ).rejects.toThrow('Remote Run Summary conflicts with canonical ownership or is stale')

    expect(db.queries.some((query) => query.sql.includes('INSERT INTO workflow_nodes'))).toBe(false)
    expect(db.queries.some((query) => query.sql.includes('UPDATE workflow_nodes'))).toBe(false)
  })

  it('rolls back when a remote node ID collides with a node owned by another Run', async () => {
    const db = new FakeTeamDbClient(true, true, 'lead', undefined, false)
    const repository = createPostgresTeamRepository(db)

    await expect(
      repository.uploadRunSummary(
        {
          kind: 'run',
          runId: 'run:a',
          version: 2,
          projectId: 'p-payments',
          title: 'Collision-safe projection',
          status: 'building',
          currentNodeId: 'node:b',
          currentNode: {
            id: 'node:b',
            stage: 'build',
            kind: 'task',
            status: 'running',
          },
          branchName: 'ai/collision-safe',
          updatedAt: '2026-08-01T12:00:00.000Z',
        },
        { organizationId: 'org-demo', userId: 'u-ling' },
      ),
    ).rejects.toThrow('Remote Run Summary conflicts with canonical ownership or is stale')

    const nodeWrite = db.queries.find((query) => query.sql.includes('INSERT INTO workflow_nodes'))
    expect(nodeWrite?.sql).toContain('WHERE workflow_nodes.run_id = excluded.run_id')
    expect(nodeWrite?.sql).toContain('RETURNING id')
    expect(db.queries.map(({ sql }) => sql.trim())).toContain('ROLLBACK')
    expect(db.queries.map(({ sql }) => sql.trim())).not.toContain('COMMIT')
    expect(db.releaseCount).toBe(1)
  })

  it('deletes workflow runs by tenant and relies on database cascade', async () => {
    const db = new FakeTeamDbClient()
    const repository = createPostgresTeamRepository(db)

    const result = await repository.deleteRun('run-remote-1', {
      organizationId: 'org-demo',
      userId: 'u-ling',
    })

    const deleteQuery = db.queries.find((query) => query.sql.includes('DELETE FROM workflow_runs'))
    expect(result).toMatchObject({ deleted: true })
    expect(deleteQuery?.params).toEqual(['run-remote-1', 'org-demo'])
  })

  it('writes test evidence without advancing or synthesizing the canonical workflow run', async () => {
    const db = new FakeTeamDbClient()
    const repository = createPostgresTeamRepository(db)

    await expect(
      repository.uploadTestEvidenceSummary(
        {
          id: 'evidence-synced',
          runId: 'run-synced',
          nodeId: 'n-test',
          projectId: 'p-payments',
          command: 'pnpm test',
          status: 'passed',
          exitCode: 0,
          durationMs: 1234,
          summary: 'Tests passed in 1.2s.',
          redacted: true,
          createdAt: '2026-06-16T12:05:00.000Z',
        },
        { organizationId: 'org-demo', userId: 'u-ling' },
      ),
    ).resolves.toMatchObject({
      accepted: true,
      message: 'test evidence summary written to Postgres repository',
    })

    expect(db.queries.some((query) => query.sql.includes('INSERT INTO workflow_runs'))).toBe(false)
    expect(db.queries.some((query) => query.sql.includes('FROM workflow_runs'))).toBe(true)
    const canonicalRunQuery = db.queries.find((query) =>
      query.sql.includes('SELECT id') && query.sql.includes('FROM workflow_runs'),
    )
    expect(canonicalRunQuery?.sql).toContain('creator_id = $4')
    expect(canonicalRunQuery?.params).toEqual([
      'run-synced',
      'org-demo',
      'p-payments',
      'u-ling',
    ])

    const write = db.queries.at(-1)
    expect(write?.sql).toContain('INSERT INTO test_evidence_summaries')
    expect(write?.params).toEqual([
      'evidence-synced',
      'run-synced',
      'run-synced:n-test',
      'p-payments',
      'pnpm test',
      'passed',
      0,
      1234,
      'Tests passed in 1.2s.',
      true,
      '2026-06-16T12:05:00.000Z',
      'org-demo',
    ])
  })

  it('redacts allowed Test Evidence fields again before writing them to Postgres', async () => {
    const db = new FakeTeamDbClient()
    const repository = createPostgresTeamRepository(db)

    await repository.uploadTestEvidenceSummary(
      {
        id: 'evidence-hostile-fields',
        runId: 'run-synced',
        nodeId: 'n-test',
        projectId: 'p-payments',
        command: 'node C:\\Users\\Alice\\repo\\test.js API_TOKEN=command-secret',
        status: 'failed',
        exitCode: 1,
        durationMs: 10,
        summary: 'failed at file:///C:/Users/Alice/repo/test.js GH_TOKEN=summary-secret',
        redacted: false,
        createdAt: '2026-06-16T12:05:00.000Z',
        rawOutput: '/Users/Alice/repo API_TOKEN=unknown-field-secret',
      } as Parameters<typeof repository.uploadTestEvidenceSummary>[0],
      { organizationId: 'org-demo', userId: 'u-ling' },
    )

    const write = db.queries.at(-1)
    expect(write?.sql).toContain('INSERT INTO test_evidence_summaries')
    expect(write?.params?.[9]).toBe(true)
    expect(JSON.stringify(write?.params)).not.toMatch(/C:[\\/]Users[\\/]Alice/)
    expect(JSON.stringify(write?.params)).not.toContain('command-secret')
    expect(JSON.stringify(write?.params)).not.toContain('summary-secret')
    expect(JSON.stringify(write?.params)).not.toContain('unknown-field-secret')
  })

  it('rejects evidence sync before the canonical Run Summary exists', async () => {
    const db = new FakeTeamDbClient(false)
    const repository = createPostgresTeamRepository(db)

    await expect(
      repository.uploadTestEvidenceSummary(
        {
          id: 'evidence-orphaned',
          runId: 'run-missing',
          nodeId: 'n-test',
          projectId: 'p-payments',
          command: 'pnpm test',
          status: 'passed',
          exitCode: 0,
          durationMs: 1234,
          summary: 'Tests passed, but no canonical Run exists.',
          redacted: true,
          createdAt: '2026-06-16T12:05:00.000Z',
        },
        { organizationId: 'org-demo', userId: 'u-ling' },
      ),
    ).rejects.toThrow('Canonical Run Summary is required before evidence sync')

    expect(db.queries).toHaveLength(1)
    expect(db.queries[0]?.sql).toContain('FROM workflow_runs')
  })

  it('writes agent review evidence without changing the canonical workflow position', async () => {
    const db = new FakeTeamDbClient()
    const repository = createPostgresTeamRepository(db)

    await expect(
      repository.uploadAgentReviewSummary(
        {
          id: 'review-synced',
          runId: 'run-synced',
          nodeId: 'n-design-gate',
          projectId: 'p-payments',
          runtime: 'electron',
          providerId: 'fake-knowledge-review',
          model: 'fake',
          conclusion: 'Review complete.',
          summary: 'The design is ready for its policy decision.',
          riskCount: 0,
          missingEvidenceCount: 0,
          policyFindingCount: 0,
          policyFindingCategories: [],
          advisoryLevel: 'info',
          blocksApproval: false,
          confidence: 0.9,
          redacted: true,
          createdAt: '2026-06-16T12:06:00.000Z',
        },
        { organizationId: 'org-demo', userId: 'u-ling' },
      ),
    ).resolves.toMatchObject({
      accepted: true,
      message: 'agent review summary written to Postgres repository',
    })

    expect(db.queries.some((query) => query.sql.includes('INSERT INTO workflow_runs'))).toBe(false)
    expect(db.queries.some((query) => query.sql.includes('FROM workflow_runs'))).toBe(true)
    expect(db.queries.at(-1)?.sql).toContain('INSERT INTO agent_reviews')
  })

  it('persists synced agent policy findings for canonical enforcement evaluation', async () => {
    const db = new FakeTeamDbClient()
    const repository = createPostgresTeamRepository(db)

    await repository.uploadAgentReviewSummary(
      {
        id: 'review-policy-finding',
        runId: 'run-synced',
        nodeId: 'n-design-gate',
        projectId: 'p-payments',
        runtime: 'electron',
        providerId: 'fake-knowledge-review',
        model: 'fake',
        conclusion: 'Security review completed.',
        summary: 'A security finding needs a policy decision.',
        riskCount: 1,
        missingEvidenceCount: 0,
        policyFindingCount: 1,
        policyFindingCategories: ['security_risk'],
        policyFindings: [
          {
            id: 'finding-security-policy',
            reviewId: 'review-policy-finding',
            runId: 'run-synced',
            nodeId: 'n-design-gate',
            category: 'security_risk',
            severity: 'high',
            summary: 'Authentication boundary is incomplete.',
            createdAt: '2026-07-31T12:00:00.000Z',
          },
        ],
        advisoryLevel: 'block',
        blocksApproval: true,
        confidence: 0.95,
        redacted: true,
        createdAt: '2026-07-31T12:00:00.000Z',
      },
      { organizationId: 'org-demo', userId: 'u-ling' },
    )

    const write = db.queries.at(-1)
    const serializedFindings = write?.params?.find(
      (value) => typeof value === 'string' && value.includes('finding-security-policy'),
    )
    expect(serializedFindings).toBeTypeOf('string')
    expect(JSON.parse(serializedFindings as string)).toEqual([
      {
        id: 'finding-security-policy',
        reviewId: 'review-policy-finding',
        runId: 'run-synced',
        nodeId: 'run-synced:n-design-gate',
        category: 'security_risk',
        severity: 'high',
        summary: 'Authentication boundary is incomplete.',
        createdAt: '2026-07-31T12:00:00.000Z',
        evidenceIds: [],
        knowledgeReferenceIds: [],
      },
    ])
  })

  it('rejects child summary ID rebinding while allowing same-scope idempotent updates', async () => {
    const db = new FakeTeamDbClient()
    const repository = createPostgresTeamRepository(db)
    const victimContext = { organizationId: 'org-demo', userId: 'u-ling' }
    const attackerContext = { organizationId: 'org-demo', userId: 'u-attacker' }
    const evidence = {
      id: 'evidence-victim',
      runId: 'run-victim',
      nodeId: 'n-test',
      projectId: 'p-payments',
      command: 'pnpm test',
      status: 'passed' as const,
      exitCode: 0,
      durationMs: 100,
      summary: 'Victim tests passed.',
      redacted: true,
      createdAt: '2026-07-31T12:00:00.000Z',
    }
    const review: Parameters<typeof repository.uploadAgentReviewSummary>[0] = {
      id: 'review-victim',
      runId: 'run-victim',
      nodeId: 'n-design-gate',
      projectId: 'p-payments',
      runtime: 'electron' as const,
      providerId: 'fake-knowledge-review',
      model: 'fake',
      conclusion: 'Victim review completed.',
      summary: 'Victim policy finding remains blocking.',
      riskCount: 1,
      missingEvidenceCount: 0,
      policyFindingCount: 1,
      policyFindingCategories: ['security_risk'],
      policyFindings: [
        {
          id: 'finding-victim',
          reviewId: 'review-victim',
          runId: 'run-victim',
          nodeId: 'n-design-gate',
          category: 'security_risk' as const,
          severity: 'high' as const,
          summary: 'Victim authentication boundary is incomplete.',
          createdAt: '2026-07-31T12:00:00.000Z',
        },
      ],
      advisoryLevel: 'block' as const,
      blocksApproval: true,
      confidence: 0.95,
      redacted: true,
      createdAt: '2026-07-31T12:00:00.000Z',
    }
    const coding = {
      id: 'coding-victim',
      runId: 'run-victim',
      nodeId: 'n-build',
      projectId: 'p-payments',
      requestedBy: 'u-ling',
      providerId: 'fake-coding-engine',
      engine: 'fake' as const,
      status: 'completed' as const,
      branchName: 'devflow/run-victim-n-build',
      summary: 'Victim coding completed.',
      changedPaths: ['src/victim.ts'],
      startedAt: '2026-07-31T12:00:00.000Z',
      completedAt: '2026-07-31T12:01:00.000Z',
      redacted: true,
    }

    await expect(repository.uploadTestEvidenceSummary(evidence, victimContext)).resolves.toMatchObject({
      accepted: true,
    })
    await expect(repository.uploadAgentReviewSummary(review, victimContext)).resolves.toMatchObject({
      accepted: true,
    })
    await expect(repository.uploadCodingAgentSummary(coding, victimContext)).resolves.toMatchObject({
      accepted: true,
    })
    await expect(
      repository.uploadTestEvidenceSummary(
        { ...evidence, summary: 'Victim tests passed again.' },
        victimContext,
      ),
    ).resolves.toMatchObject({ accepted: true })
    await expect(
      repository.uploadAgentReviewSummary(
        { ...review, summary: 'Victim policy finding remains after retry.' },
        victimContext,
      ),
    ).resolves.toMatchObject({ accepted: true })
    await expect(
      repository.uploadCodingAgentSummary(
        { ...coding, summary: 'Victim coding retry completed.' },
        victimContext,
      ),
    ).resolves.toMatchObject({ accepted: true })

    await expect(
      repository.uploadTestEvidenceSummary(
        { ...evidence, nodeId: 'n-other-test' },
        victimContext,
      ),
    ).rejects.toThrow('conflicts with canonical scope')
    await expect(
      repository.uploadAgentReviewSummary(
        { ...review, nodeId: 'n-other-design-gate' },
        victimContext,
      ),
    ).rejects.toThrow('conflicts with canonical scope')
    await expect(
      repository.uploadCodingAgentSummary(
        { ...coding, nodeId: 'n-other-build' },
        victimContext,
      ),
    ).rejects.toThrow('conflicts with canonical scope')

    await expect(
      repository.uploadTestEvidenceSummary(
        { ...evidence, runId: 'run-attacker', projectId: 'p-admin', summary: 'Rebound.' },
        attackerContext,
      ),
    ).rejects.toThrow('conflicts with canonical scope')
    await expect(
      repository.uploadAgentReviewSummary(
        {
          ...review,
          runId: 'run-attacker',
          nodeId: 'n-attacker-gate',
          projectId: 'p-admin',
          conclusion: 'Attacker overwrite.',
          summary: 'Attacker clears victim findings.',
          policyFindingCount: 0,
          policyFindingCategories: [],
          policyFindings: [],
        },
        attackerContext,
      ),
    ).rejects.toThrow('conflicts with canonical scope')
    await expect(
      repository.uploadCodingAgentSummary(
        {
          ...coding,
          runId: 'run-attacker',
          nodeId: 'n-attacker-build',
          projectId: 'p-admin',
          summary: 'Attacker overwrite.',
        },
        attackerContext,
      ),
    ).rejects.toThrow('conflicts with canonical scope')

    const evidenceWrite = db.queries.find((query) =>
      query.sql.includes('INSERT INTO test_evidence_summaries'),
    )
    const reviewWrite = db.queries.find((query) => query.sql.includes('INSERT INTO agent_reviews'))
    const codingWrite = db.queries.find((query) =>
      query.sql.includes('INSERT INTO coding_agent_summaries'),
    )
    expect(evidenceWrite?.sql).toContain(
      'test_evidence_summaries.run_id = excluded.run_id',
    )
    expect(evidenceWrite?.sql).toContain(
      'test_evidence_summaries.project_id = excluded.project_id',
    )
    expect(evidenceWrite?.sql).toContain('test_evidence_summaries.node_id = excluded.node_id')
    expect(evidenceWrite?.sql).toContain('RETURNING id')
    expect(reviewWrite?.sql).toContain('agent_reviews.organization_id = excluded.organization_id')
    expect(reviewWrite?.sql).toContain('agent_reviews.run_id = excluded.run_id')
    expect(reviewWrite?.sql).toContain('agent_reviews.node_id = excluded.node_id')
    expect(reviewWrite?.sql).toContain('agent_reviews.project_id = excluded.project_id')
    expect(reviewWrite?.sql).toContain('RETURNING id')
    expect(codingWrite?.sql).toContain(
      'coding_agent_summaries.organization_id = excluded.organization_id',
    )
    expect(codingWrite?.sql).toContain('coding_agent_summaries.run_id = excluded.run_id')
    expect(codingWrite?.sql).toContain('coding_agent_summaries.node_id = excluded.node_id')
    expect(codingWrite?.sql).toContain('coding_agent_summaries.project_id = excluded.project_id')
    expect(codingWrite?.sql).toContain('RETURNING id')
    const persistedReview = db.acceptedChildSummaryWrites.get('agent_reviews:review-victim')
    expect(JSON.stringify(persistedReview)).toContain('finding-victim')
    expect(JSON.stringify(persistedReview)).not.toContain('Attacker clears victim findings')
  })

  it('does not materialize stale child summaries as additional active workflow nodes', async () => {
    const db = new FakeTeamDbClient()
    const repository = createPostgresTeamRepository(db)
    const context = { organizationId: 'org-demo', userId: 'u-ling' }
    const evidence = {
      runId: 'run-synced',
      projectId: 'p-payments',
      command: 'pnpm test',
      status: 'running' as const,
      exitCode: null,
      durationMs: 100,
      summary: 'Tests are running.',
      redacted: true,
      createdAt: '2026-07-31T12:00:00.000Z',
    }
    const review = {
      runId: 'run-synced',
      projectId: 'p-payments',
      runtime: 'electron' as const,
      providerId: 'fake-knowledge-review',
      model: 'fake',
      conclusion: 'Review complete.',
      summary: 'Review summary.',
      riskCount: 0,
      missingEvidenceCount: 0,
      policyFindingCount: 0,
      policyFindingCategories: [],
      policyFindings: [],
      advisoryLevel: 'info' as const,
      blocksApproval: false,
      confidence: 0.9,
      redacted: true,
      createdAt: '2026-07-31T12:00:00.000Z',
    }

    await repository.uploadTestEvidenceSummary(
      { ...evidence, id: 'evidence-current', nodeId: 'n-current' },
      context,
    )
    await repository.uploadTestEvidenceSummary(
      { ...evidence, id: 'evidence-stale-running', nodeId: 'n-old-test' },
      context,
    )
    await repository.uploadTestEvidenceSummary(
      {
        ...evidence,
        id: 'evidence-stale-failed',
        nodeId: 'n-old-failed-test',
        status: 'failed',
        exitCode: 1,
      },
      context,
    )
    await repository.uploadAgentReviewSummary(
      { ...review, id: 'review-current', nodeId: 'n-current' },
      context,
    )
    await repository.uploadAgentReviewSummary(
      { ...review, id: 'review-stale-blocked', nodeId: 'n-old-design-gate' },
      context,
    )

    const nodeWrites = db.queries.filter((query) => query.sql.includes('INSERT INTO workflow_nodes'))
    const statusFor = (nodeId: string) =>
      nodeWrites.find((write) => write.params?.[0] === nodeId)?.params?.[3]
    expect(statusFor('run-synced:n-current')).toBe('running')
    expect(statusFor('run-synced:n-old-test')).toBe('success')
    expect(statusFor('run-synced:n-old-failed-test')).toBe('failed')
    expect(
      nodeWrites.filter((write) => write.params?.[0] === 'run-synced:n-current').at(-1)?.params?.[3],
    ).toBe('blocked')
    expect(statusFor('run-synced:n-old-design-gate')).toBe('success')
  })

  it('namespaces a canonical local Gate override and rejects storage-style node IDs', async () => {
    const db = new FakeTeamDbClient()
    const repository = createPostgresTeamRepository(db)
    const context = { organizationId: 'org-demo', userId: 'u-ling' }
    const localDecision = {
      id: 'gate-override-local',
      runId: 'run-remote-1',
      nodeId: 'n-design-gate',
      projectId: 'p-payments',
      userId: 'u-ling',
      role: 'lead' as const,
      reason: 'Reviewed local node identity.',
      blockedReasonIds: ['missing_agent_review:protected_gate:missing'],
      policyVersion: 1,
      provisional: false,
      status: 'accepted' as const,
      createdAt: '2026-07-31T12:00:00.000Z',
    }
    const namespacedDecision = {
      ...localDecision,
      id: 'gate-override-namespaced',
      nodeId: 'run-remote-1:n-design-gate',
    }

    await expect(repository.saveGateOverride(localDecision, context)).resolves.toEqual(localDecision)
    await expect(
      repository.saveGateOverride(namespacedDecision, context),
    ).rejects.toThrow('Local node ID uses the reserved Team node namespace.')

    const writes = db.queries.filter((query) =>
      query.sql.includes('INSERT INTO gate_override_decisions'),
    )
    expect(writes.map((write) => write.params?.[3])).toEqual([
      'run-remote-1:n-design-gate',
    ])
  })

  it('writes coding agent summaries into the dedicated Postgres table', async () => {
    const db = new FakeTeamDbClient()
    const repository = createPostgresTeamRepository(db)

    await expect(
      repository.uploadCodingAgentSummary(
        {
          id: 'coding-run-synced',
          runId: 'run-synced',
          nodeId: 'n-build',
          projectId: 'p-payments',
          requestedBy: 'local-user',
          providerId: 'fake-coding-engine',
          engine: 'fake',
          status: 'completed',
          branchName: 'devflow/run-synced-n-build-coding-run-synced',
          summary: 'Coding Agent completed with redacted paths.',
          changedPaths: ['src/health.ts'],
          startedAt: '2026-06-16T12:10:00.000Z',
          completedAt: '2026-06-16T12:11:00.000Z',
          costSummary: {
            id: 'coding-runtime-cost-run-synced-n-build',
            provider: 'openai',
            providerId: 'double',
            model: 'ark-code-latest',
            inputTokens: 120,
            outputTokens: 80,
            cacheReadTokens: 0,
            costUsd: 0.018,
            source: 'estimated',
            redacted: true,
            runId: 'run-synced',
            nodeId: 'n-build',
            projectId: 'p-payments',
            userId: 'u-ling',
            timestamp: '2026-06-16T12:11:00.000Z',
          },
          redacted: true,
        },
        { organizationId: 'org-demo', userId: 'u-ling' },
      ),
    ).resolves.toMatchObject({
      accepted: true,
      message: 'coding agent summary written to Postgres repository',
    })

    expect(db.queries.some((query) => query.sql.includes('INSERT INTO workflow_runs'))).toBe(false)
    expect(db.queries.some((query) => query.sql.includes('FROM workflow_runs'))).toBe(true)

    const write = db.queries.at(-1)
    expect(write?.sql).toContain('INSERT INTO coding_agent_summaries')
    expect(write?.params).toEqual([
      'coding-run-synced',
      'org-demo',
      'run-synced',
      'run-synced:n-build',
      'p-payments',
      'u-ling',
      'fake-coding-engine',
      'fake',
      'completed',
      'devflow/run-synced-n-build-coding-run-synced',
      'Coding Agent completed with redacted paths.',
      JSON.stringify(['src/health.ts']),
      '2026-06-16T12:10:00.000Z',
      '2026-06-16T12:11:00.000Z',
      'openai',
      'ark-code-latest',
      120,
      80,
      0,
      0.018,
      'estimated',
      true,
    ])
  })

  it('redacts Coding Summary display text again before writing it to Postgres', async () => {
    const db = new FakeTeamDbClient()
    const repository = createPostgresTeamRepository(db)

    await repository.uploadCodingAgentSummary(
      {
        id: 'coding-hostile-metadata',
        runId: 'run-synced',
        nodeId: 'n-build',
        projectId: 'p-payments',
        requestedBy: 'local-user',
        providerId: 'fake-coding-engine',
        engine: 'fake',
        status: 'completed',
        branchName: 'C:\\Users\\Alice\\private\\branch API_TOKEN=branch-secret',
        summary: 'Changed /Users/Alice/private/repo API_TOKEN=summary-secret',
        changedPaths: ['src/health.ts'],
        startedAt: '2026-06-16T12:10:00.000Z',
        completedAt: '2026-06-16T12:11:00.000Z',
        costSummary: {
          id: 'cost-hostile-metadata',
          runId: 'run-synced',
          nodeId: 'n-build',
          userId: 'u-ling',
          projectId: 'p-payments',
          provider: 'openai',
          providerId: 'fake-coding-engine',
          model: 'model from /Users/Alice/private/model API_TOKEN=model-secret',
          inputTokens: 120,
          outputTokens: 80,
          cacheReadTokens: 0,
          costUsd: 0.018,
          timestamp: '2026-06-16T12:11:00.000Z',
          source: 'estimated',
          redacted: true,
          apiKey: 'nested-api-key-secret',
        },
        budgetDecision: {
          status: 'allowed',
          blocksRun: false,
          currentSpendUsd: 1,
          projectedCostUsd: 2,
          reason: 'Approved from /Users/Alice/private/repo API_TOKEN=budget-secret',
          token: 'nested-budget-token-secret',
        },
        redacted: true,
      } as Parameters<typeof repository.uploadCodingAgentSummary>[0],
      { organizationId: 'org-demo', userId: 'u-ling' },
    )

    const write = db.queries.at(-1)
    expect(write?.params?.[15]).toBe(
      'model from [REDACTED:local_absolute_path] [REDACTED:env_secret_assignment]',
    )
    expect(JSON.stringify(write?.params)).not.toContain('branch-secret')
    expect(JSON.stringify(write?.params)).not.toContain('summary-secret')
    expect(JSON.stringify(write?.params)).not.toContain('budget-secret')
    expect(JSON.stringify(write?.params)).not.toContain('model-secret')
    expect(JSON.stringify(write?.params)).not.toContain('nested-api-key-secret')
    expect(JSON.stringify(write?.params)).not.toContain('nested-budget-token-secret')
    expect(JSON.stringify(write?.params)).not.toContain('/Users/Alice')
    expect(JSON.stringify(write?.params)).not.toMatch(/C:[\\/]Users[\\/]Alice/)
  })

  it('persists a standalone redacted Knowledge Review budget-block event', async () => {
    const db = new FakeTeamDbClient()
    const repository = createPostgresTeamRepository(db)

    const saved = await repository.saveAgentEvent(
      {
        id: 'knowledge-review-budget-audit-1',
        runId: 'run-remote-1',
        nodeId: 'n-design-gate',
        sequence: 2,
        kind: 'error',
        message:
          'Knowledge Review budget blocked. projectId=p-payments providerId=openai-default requestedBy=u-ling status=unavailable reason=Failed at /Users/Alice/private/repo API_TOKEN=audit-secret',
        timestamp: '2026-07-31T00:00:00.000Z',
      },
      { organizationId: 'org-demo', userId: 'u-ling' },
    )

    expect(saved).toMatchObject({
      id: 'knowledge-review-budget-audit-1',
      kind: 'error',
      message:
        'Knowledge Review budget blocked. projectId=p-payments providerId=openai-default requestedBy=u-ling status=unavailable reason=Failed at [REDACTED:local_absolute_path] [REDACTED:env_secret_assignment]',
    })
    const write = db.queries.at(-1)
    expect(write?.sql).toContain('INSERT INTO agent_events')
    expect(write?.params).toEqual([
      'knowledge-review-budget-audit-1',
      'run-remote-1',
      'n-design-gate',
      2,
      'error',
      saved.message,
      '2026-07-31T00:00:00.000Z',
      'org-demo',
    ])
    expect(JSON.stringify(write?.params)).not.toContain('audit-secret')
    expect(JSON.stringify(write?.params)).not.toContain('/Users/Alice')
  })
})
