import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { GitHubDeliveryIntent } from '@ai-devflow/shared'
import type { RequestPrincipal } from '../auth/request-auth'
import type { TeamDbRepositoryClient } from '../db/client'
import { createPostgresGitHubDeliveryRepository } from './postgres-github-delivery-repository'

type QueryCall = { sql: string; params: unknown[] }
type QueryHandler = (
  sql: string,
  params: unknown[],
) => unknown[] | Promise<unknown[]>

const now = '2026-08-11T10:00:00.000Z'

const ownerPrincipal = {
  session: {
    source: 'authenticated',
    authAccountId: 'auth-owner',
    organizationId: 'org-a',
    userId: 'user-owner',
    role: 'owner',
    projectMemberships: [],
  },
  authentication: { kind: 'session_cookie', tokenRecordId: null },
} satisfies RequestPrincipal

const desktopPrincipal = {
  session: {
    source: 'authenticated',
    authAccountId: 'auth-desktop',
    organizationId: 'org-a',
    userId: 'user-desktop',
    role: 'member',
    projectMemberships: [
      { projectId: 'project-a', userId: 'user-desktop', role: 'member' },
    ],
  },
  authentication: {
    kind: 'desktop_bearer',
    tokenRecordId: 'desktop-token-1',
  },
} satisfies RequestPrincipal

const leadPrincipal = {
  session: {
    source: 'authenticated',
    authAccountId: 'auth-lead',
    organizationId: 'org-a',
    userId: 'user-lead',
    role: 'lead',
    projectMemberships: [
      { projectId: 'project-a', userId: 'user-lead', role: 'lead' },
    ],
  },
  authentication: { kind: 'session_cookie', tokenRecordId: null },
} satisfies RequestPrincipal

const bindingRow = {
  id: 'github-binding-1',
  version: 1,
  organization_id: 'org-a',
  project_id: 'project-a',
  installation_id: '12345',
  repository_id: '98765',
  full_name: 'example/project',
  default_branch: 'main',
  status: 'active',
  configured_by_user_id: 'user-owner',
  updated_by_user_id: 'user-owner',
  validated_at: '2026-08-11T09:59:00.000Z',
  revoked_at: null,
  created_at: '2026-08-11T09:59:00.000Z',
  updated_at: now,
}

const shaA = 'a'.repeat(40)
const shaB = 'b'.repeat(40)
const digestA = 'a'.repeat(64)
const digestB = 'b'.repeat(64)
const digestC = 'c'.repeat(64)
const digestD = 'd'.repeat(64)

function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function expectedIntentDigest(intent: GitHubDeliveryIntent): string {
  return sha256Text(JSON.stringify({
    stateVersion: intent.stateVersion,
    organizationId: intent.organizationId,
    teamProjectId: intent.teamProjectId,
    localProjectId: intent.localProjectId,
    runId: intent.runId,
    runVersion: intent.runVersion,
    nodeId: intent.nodeId,
    repositoryBindingId: intent.repositoryBindingId,
    repositoryBindingVersion: intent.repositoryBindingVersion,
    installationId: intent.installationId,
    repositoryId: intent.repositoryId,
    codingRunId: intent.codingRunId,
    codingRunCompletedAt: intent.codingRunCompletedAt,
    workspaceId: intent.workspaceId,
    repository: intent.repository,
    baseBranch: intent.baseBranch,
    headBranch: intent.headBranch,
    baseCommitSha: intent.baseCommitSha,
    expectedCommitSha: intent.expectedCommitSha,
    diffArtifactId: intent.diffArtifactId,
    diffSourceDigest: intent.diffSourceDigest,
    testEvidenceId: intent.testEvidenceId,
    testEvidenceCreatedAt: intent.testEvidenceCreatedAt,
    testEvidenceDigest: intent.testEvidenceDigest,
    prPackageArtifactId: intent.prPackageArtifactId,
    prPackageUpdatedAt: intent.prPackageUpdatedAt,
    prPackageDigest: intent.prPackageDigest,
    changedPaths: intent.changedPaths,
  }))
}

function expectedLogicalDeliveryKey(intent: GitHubDeliveryIntent): string {
  return `github-delivery:${sha256Text(JSON.stringify({
    organizationId: intent.organizationId,
    teamProjectId: intent.teamProjectId,
    localProjectId: intent.localProjectId,
    runId: intent.runId,
    nodeId: intent.nodeId,
    repositoryBindingId: intent.repositoryBindingId,
    repositoryBindingVersion: intent.repositoryBindingVersion,
    workspaceId: intent.workspaceId,
  }))}`
}

function deliveryIntent(
  overrides: Partial<GitHubDeliveryIntent> = {},
): GitHubDeliveryIntent {
  const intent: GitHubDeliveryIntent = {
    stateVersion: 1,
    id: 'local-intent-1',
    organizationId: 'org-a',
    teamProjectId: 'project-a',
    localProjectId: 'local-project-a',
    runId: 'run-1',
    runVersion: 7,
    nodeId: 'pr-1',
    repositoryBindingId: 'github-binding-1',
    repositoryBindingVersion: 1,
    installationId: '12345',
    repositoryId: '98765',
    codingRunId: 'coding-1',
    codingRunCompletedAt: '2026-08-11T09:55:00.000Z',
    workspaceId: 'workspace-1',
    repository: 'example/project',
    baseBranch: 'main',
    headBranch: 'devflow/run-1-pr-1',
    baseCommitSha: shaA,
    expectedCommitSha: shaB,
    diffArtifactId: 'diff-1',
    diffSourceDigest: digestA,
    testEvidenceId: 'test-1',
    testEvidenceCreatedAt: '2026-08-11T09:56:00.000Z',
    testEvidenceDigest: digestB,
    prPackageArtifactId: 'package-1',
    prPackageUpdatedAt: '2026-08-11T09:57:00.000Z',
    prPackageDigest: digestC,
    changedPaths: ['apps/api/src/example.ts'],
    intentDigest: digestD,
    idempotencyKey: `github-delivery:${'e'.repeat(64)}`,
    status: 'approval_required',
    createdAt: '2026-08-11T09:58:00.000Z',
    updatedAt: '2026-08-11T09:58:00.000Z',
    redacted: true,
    ...overrides,
  }
  if (!Object.hasOwn(overrides, 'intentDigest')) {
    intent.intentDigest = expectedIntentDigest(intent)
  }
  if (!Object.hasOwn(overrides, 'idempotencyKey')) {
    intent.idempotencyKey = expectedLogicalDeliveryKey(intent)
  }
  return intent
}

const deliveryRequestRow = {
  id: 'github-delivery-1',
  state_version: 1,
  intent_revision: 1,
  organization_id: 'org-a',
  project_id: 'project-a',
  requested_by_user_id: 'user-desktop',
  requested_by_token_id: 'desktop-token-1',
  local_intent_id: 'local-intent-1',
  local_project_id: 'local-project-a',
  run_id: 'run-1',
  run_version: 7,
  node_id: 'pr-1',
  binding_id: 'github-binding-1',
  binding_version: 1,
  installation_id: '12345',
  repository_id: '98765',
  repository_full_name: 'example/project',
  coding_run_id: 'coding-1',
  workspace_id: 'workspace-1',
  diff_artifact_id: 'diff-1',
  test_evidence_id: 'test-1',
  pr_package_artifact_id: 'package-1',
  status: 'approval_required',
  outcome_code: null,
  expected_run_version: 7,
  base_branch: 'main',
  head_branch: 'devflow/run-1-pr-1',
  base_commit_sha: shaA,
  expected_commit_sha: shaB,
  intent_digest: digestD,
  logical_idempotency_key: `github-delivery:${'e'.repeat(64)}`,
  diff_digest: digestA,
  test_evidence_digest: digestB,
  package_digest: digestC,
  changed_paths: ['apps/api/src/example.ts'],
  pr_title: 'Deliver the reviewed change',
  pr_body: 'Bound to passing Test Evidence.',
  expires_at: '2026-08-11T11:00:00.000Z',
  created_at: now,
  updated_at: now,
}

function canonicalAuthority(overrides: Record<string, unknown> = {}) {
  return {
    run_version: 7,
    current_node_id: 'run-1:pr-1',
    node_stage: 'pr',
    node_kind: 'pr',
    node_status: 'running',
    claim_status: 'materialized',
    claimed_by_token_id: 'desktop-token-1',
    ...overrides,
  }
}

function deliveryApprovalRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'github-approval-1',
    request_id: 'github-delivery-1',
    intent_revision: 1,
    request_state_version: 1,
    intent_digest: digestD,
    binding_id: 'github-binding-1',
    binding_version: 1,
    run_id: 'run-1',
    run_version: 7,
    node_id: 'pr-1',
    repository_id: '98765',
    base_branch: 'main',
    head_branch: 'devflow/run-1-pr-1',
    expected_commit_sha: shaB,
    test_evidence_digest: digestB,
    package_digest: digestC,
    approved_by_user_id: 'user-lead',
    approved_role: 'lead',
    auth_kind: 'session_cookie',
    approved_at: '2026-08-11T09:58:00.000Z',
    ...overrides,
  }
}

function credentialGrantRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'github-grant-1',
    version: 2,
    request_id: 'github-delivery-1',
    intent_revision: 1,
    approval_id: 'github-approval-1',
    attempt: 1,
    issued_to_token_id: 'desktop-token-1',
    repository_id: '98765',
    permission: 'contents:write',
    repository_count: 1,
    status: 'issued',
    requested_at: '2026-08-11T09:55:00.000Z',
    issued_at: '2026-08-11T09:56:00.000Z',
    credential_expires_at: '2026-08-11T10:45:00.000Z',
    consumed_at: null,
    outcome_code: null,
    ...overrides,
  }
}

function branchPublicationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'github-publication-1',
    version: 2,
    request_id: 'github-delivery-1',
    intent_revision: 1,
    grant_id: 'github-grant-1',
    status: 'recovery_required',
    reported_outcome_code: 'unknown',
    verified_head_sha: null,
    reported_at: '2026-08-11T09:57:00.000Z',
    verified_at: null,
    outcome_code: 'branch_verification_failed',
    ...overrides,
  }
}

function pullRequestOutcomeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'github-pull-request-1',
    version: 1,
    request_id: 'github-delivery-1',
    intent_revision: 1,
    publication_id: 'github-publication-1',
    status: 'creating',
    pull_request_id: null,
    pull_request_number: null,
    safe_url: null,
    draft: true,
    head_branch: 'devflow/run-1-pr-1',
    base_branch: 'main',
    head_sha: shaB,
    provider_created_at: null,
    recorded_at: now,
    outcome_code: null,
    ...overrides,
  }
}

function marker(sql: string): string | null {
  return /\/\* github_delivery:([^*]+) \*\//.exec(sql)?.[1] ?? null
}

class FakeGitHubDeliveryDb implements TeamDbRepositoryClient {
  readonly calls: QueryCall[] = []
  checkoutCount = 0
  releaseCount = 0

  constructor(private readonly handler: QueryHandler) {}

  async checkout(): Promise<this> {
    this.checkoutCount += 1
    return this
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    this.calls.push({ sql, params })
    if (
      sql === 'BEGIN' ||
      sql === 'BEGIN ISOLATION LEVEL REPEATABLE READ' ||
      sql === 'COMMIT' ||
      sql === 'ROLLBACK'
    ) return []
    return (await this.handler(sql, params)) as T[]
  }

  release(): void {
    this.releaseCount += 1
  }

  async close(): Promise<void> {}

  markers(): string[] {
    return this.calls.flatMap(({ sql }) => {
      const value = marker(sql)
      return value === null ? [] : [value]
    })
  }
}

function cookieIdentity(role: 'member' | 'lead' | 'owner' = 'owner') {
  return {
    user_id: ownerPrincipal.session.userId,
    organization_id: ownerPrincipal.session.organizationId,
    organization_role: role,
    project_role: role === 'owner' ? null : role,
  }
}

function bearerIdentity() {
  return {
    user_id: desktopPrincipal.session.userId,
    organization_id: desktopPrincipal.session.organizationId,
    project_id: 'project-a',
    organization_role: 'member',
    project_role: 'member',
  }
}

function leadIdentity() {
  return {
    user_id: 'user-lead',
    organization_id: 'org-a',
    organization_role: 'lead',
    project_role: 'lead',
  }
}

describe('Postgres GitHub Delivery repository', () => {
  it('loads an allowlisted repository binding only through live project authority', async () => {
    const db = new FakeGitHubDeliveryDb((sql) => {
      switch (marker(sql)) {
        case 'cookie-identity':
          return [cookieIdentity()]
        case 'binding-read':
          return [bindingRow]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGitHubDeliveryRepository(db)

    const result = await repository.getGitHubRepositoryBinding(
      'project-a',
      ownerPrincipal,
    )

    expect(result).toEqual({
      stateVersion: 1,
      id: 'github-binding-1',
      version: 1,
      organizationId: 'org-a',
      teamProjectId: 'project-a',
      installationId: '12345',
      repositoryId: '98765',
      repository: 'example/project',
      defaultBranch: 'main',
      status: 'active',
      validatedAt: '2026-08-11T09:59:00.000Z',
      updatedAt: now,
      redacted: true,
    })
    expect(JSON.stringify(result)).not.toContain('configuredBy')
    expect(db.checkoutCount).toBe(0)
    expect(db.markers()).toEqual(['cookie-identity', 'binding-read'])
    const read = db.calls.find(({ sql }) => marker(sql) === 'binding-read')
    expect(read?.sql).toMatch(/organization_id\s*=\s*\$1/i)
    expect(read?.sql).toMatch(/project_id\s*=\s*\$2/i)
    expect(read?.params).toEqual(['org-a', 'project-a'])
  })

  it('creates a binding under project lock, live owner authority, audit, and bounded idempotency metadata', async () => {
    const createdRow = { ...bindingRow, id: 'github-binding-fixed' }
    const db = new FakeGitHubDeliveryDb((sql) => {
      switch (marker(sql)) {
        case 'project-lock':
        case 'repository-lock':
        case 'audit-insert':
        case 'idempotency-insert':
        case 'delivery-grants-revoke':
        case 'deliveries-revoke':
          return []
        case 'cookie-identity':
          return [cookieIdentity()]
        case 'idempotency-read':
        case 'binding-lock':
        case 'binding-repository-conflict':
          return []
        case 'binding-create':
          return [createdRow]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGitHubDeliveryRepository(db, {
      now: () => new Date(now),
      createId: (kind) => `github-${kind}-fixed`,
    })

    const result = await repository.upsertGitHubRepositoryBinding(
      {
        projectId: 'project-a',
        installationId: '12345',
        repositoryId: '98765',
        repository: 'Example/Project',
        defaultBranch: 'main',
        verifiedAt: '2026-08-11T09:59:00.000Z',
        expectedStateVersion: 0,
      },
      ownerPrincipal,
    )

    expect(result).toMatchObject({
      ok: true,
      responseStatus: 201,
      outcomeCode: 'binding_created',
      replayed: false,
      binding: {
        id: 'github-binding-fixed',
        repository: 'example/project',
      },
    })
    expect(db.checkoutCount).toBe(1)
    expect(db.releaseCount).toBe(1)
    expect(db.calls[0]?.sql).toBe('BEGIN')
    expect(db.calls.at(-1)?.sql).toBe('COMMIT')
    expect(db.markers()).toEqual([
      'project-lock',
      'cookie-identity',
      'idempotency-read',
      'repository-lock',
      'binding-lock',
      'binding-repository-conflict',
      'binding-create',
      'audit-insert',
      'idempotency-insert',
    ])
    const authority = db.calls.find(
      ({ sql }) => marker(sql) === 'cookie-identity',
    )
    expect(authority?.sql).toMatch(/FOR SHARE OF auth_accounts,\s*users,\s*projects/i)
    const create = db.calls.find(({ sql }) => marker(sql) === 'binding-create')
    expect(create?.params).toContain('2026-08-11T09:59:00.000Z')
    expect(create?.params).toContain('2026-08-11T10:00:00.000Z')
    const persisted = db.calls.find(
      ({ sql }) => marker(sql) === 'idempotency-insert',
    )
    expect(String(persisted?.params.at(-1))).not.toContain('Example/Project')
    expect(String(persisted?.params.at(-1))).not.toContain('desktop-token')
  })

  it('serializes repository claims across Projects and returns a typed binding conflict', async () => {
    const db = new FakeGitHubDeliveryDb((sql) => {
      switch (marker(sql)) {
        case 'project-lock':
        case 'repository-lock':
        case 'audit-insert':
        case 'idempotency-insert':
          return []
        case 'cookie-identity':
          return [cookieIdentity()]
        case 'idempotency-read':
        case 'binding-lock':
        case 'binding-repository-conflict':
        case 'binding-create':
          return []
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGitHubDeliveryRepository(db, {
      now: () => new Date(now),
      createId: (kind) => `github-${kind}-fixed`,
    })

    await expect(
      repository.upsertGitHubRepositoryBinding(
        {
          projectId: 'project-a',
          installationId: '12345',
          repositoryId: '98765',
          repository: 'example/project',
          defaultBranch: 'main',
          verifiedAt: '2026-08-11T09:59:00.000Z',
          expectedStateVersion: 0,
        },
        ownerPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      outcomeCode: 'binding_conflict',
    })
    expect(db.markers()).toContain('repository-lock')
    const repositoryLock = db.calls.find(
      ({ sql }) => marker(sql) === 'repository-lock',
    )
    expect(repositoryLock?.params).toEqual(['org-a', '98765'])
  })

  it('replays an identical binding upsert after the original response was lost', async () => {
    const db = new FakeGitHubDeliveryDb((sql) => {
      switch (marker(sql)) {
        case 'project-lock':
        case 'repository-lock':
          return []
        case 'cookie-identity':
          return [cookieIdentity()]
        case 'idempotency-read':
          return [{
            request_fingerprint: digestA,
            response_json: {
              ok: true,
              responseStatus: 201,
              outcomeCode: 'binding_created',
              recordId: bindingRow.id,
              observedVersion: 1,
            },
          }]
        case 'binding-lock':
          return [bindingRow]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGitHubDeliveryRepository(db, {
      now: () => new Date(now),
    })

    await expect(
      repository.upsertGitHubRepositoryBinding(
        {
          projectId: 'project-a',
          installationId: '12345',
          repositoryId: '98765',
          repository: 'Example/Project',
          defaultBranch: 'main',
          verifiedAt: '2026-08-11T09:59:00.000Z',
          expectedStateVersion: 0,
        },
        ownerPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      outcomeCode: 'binding_created',
      replayed: true,
      binding: { id: bindingRow.id, version: 1 },
    })
    expect(db.markers()).not.toContain('binding-update')
    expect(db.markers()).not.toContain('audit-insert')
  })

  it('revokes the exact binding version and rejects stale updates before writing', async () => {
    const revokedRow = {
      ...bindingRow,
      version: 2,
      status: 'revoked',
      revoked_at: now,
      updated_at: now,
    }
    const db = new FakeGitHubDeliveryDb((sql) => {
      switch (marker(sql)) {
        case 'project-lock':
        case 'audit-insert':
        case 'idempotency-insert':
        case 'delivery-grants-revoke':
        case 'deliveries-revoke':
          return []
        case 'cookie-identity':
          return [cookieIdentity()]
        case 'idempotency-read':
          return []
        case 'binding-lock':
          return [bindingRow]
        case 'binding-revoke':
          return [revokedRow]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGitHubDeliveryRepository(db, {
      now: () => new Date(now),
      createId: (kind) => `github-${kind}-fixed`,
    })

    const result = await repository.revokeGitHubRepositoryBinding(
      { projectId: 'project-a', expectedStateVersion: 1 },
      ownerPrincipal,
    )

    expect(result).toMatchObject({
      ok: true,
      outcomeCode: 'binding_revoked',
      binding: { version: 2, status: 'revoked' },
    })
    const update = db.calls.find(({ sql }) => marker(sql) === 'binding-revoke')
    expect(update?.sql).toMatch(/version\s*=\s*version\s*\+\s*1/i)
    expect(update?.sql).toMatch(/version\s*=\s*\$4/i)
    expect(update?.params).toEqual([
      'github-binding-1',
      'org-a',
      'project-a',
      1,
      'user-owner',
      now,
    ])
  })

  it('replays an identical binding revocation without cascading a second time', async () => {
    const revokedRow = {
      ...bindingRow,
      version: 2,
      status: 'revoked',
      revoked_at: now,
      updated_at: now,
    }
    const db = new FakeGitHubDeliveryDb((sql) => {
      switch (marker(sql)) {
        case 'project-lock':
          return []
        case 'cookie-identity':
          return [cookieIdentity()]
        case 'idempotency-read':
          return [{
            request_fingerprint: digestA,
            response_json: {
              ok: true,
              responseStatus: 200,
              outcomeCode: 'binding_revoked',
              recordId: bindingRow.id,
              observedVersion: 2,
            },
          }]
        case 'binding-lock':
          return [revokedRow]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGitHubDeliveryRepository(db, {
      now: () => new Date(now),
    })

    await expect(
      repository.revokeGitHubRepositoryBinding(
        { projectId: 'project-a', expectedStateVersion: 1 },
        ownerPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      outcomeCode: 'binding_revoked',
      replayed: true,
      binding: { version: 2, status: 'revoked' },
    })
    expect(db.markers()).not.toContain('binding-revoke')
    expect(db.markers()).not.toContain('deliveries-revoke')
  })

  it('submits a redacted request only after canonical Run and materialized claimant recheck', async () => {
    const db = new FakeGitHubDeliveryDb((sql) => {
      switch (marker(sql)) {
        case 'project-lock':
        case 'audit-insert':
        case 'idempotency-insert':
          return []
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'binding-lock':
          return [bindingRow]
        case 'canonical-authority':
          return [canonicalAuthority()]
        case 'delivery-logical-lock':
        case 'delivery-active-target':
        case 'idempotency-read':
          return []
        case 'delivery-create':
          return [deliveryRequestRow]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGitHubDeliveryRepository(db, {
      now: () => new Date(now),
      createId: (kind) => `github-${kind}-1`,
    })

    const result = await repository.createOrReviseGitHubDeliveryRequest(
      {
        projectId: 'project-a',
        intent: deliveryIntent(),
        prTitle: 'Deliver the reviewed change',
        prBody: 'Bound to passing Test Evidence.',
        expectedStateVersion: 0,
      },
      desktopPrincipal,
    )

    expect(result).toMatchObject({
      ok: true,
      responseStatus: 201,
      outcomeCode: 'delivery_created',
      replayed: false,
      request: {
        id: 'github-delivery-1',
        runId: 'run-1',
        nodeId: 'pr-1',
        expectedCommitSha: shaB,
        changedPaths: ['apps/api/src/example.ts'],
        redacted: true,
      },
    })
    expect(JSON.stringify(result)).not.toContain('desktop-token-1')
    const authority = db.calls.find(
      ({ sql }) => marker(sql) === 'canonical-authority',
    )
    expect(authority?.sql).toMatch(/workflow_runs/i)
    expect(authority?.sql).toMatch(/workflow_nodes/i)
    expect(authority?.sql).toMatch(/work_requests/i)
    expect(authority?.sql).toMatch(/status\s*=\s*'materialized'/i)
    expect(authority?.sql).toMatch(/FOR SHARE/i)
    expect(authority?.params).toEqual([
      'org-a',
      'project-a',
      'run-1',
      'user-desktop',
      'desktop-token-1',
    ])
    const insert = db.calls.find(
      ({ sql }) => marker(sql) === 'delivery-create',
    )
    expect(insert?.sql).toMatch(/requested_by_token_id/i)
    expect(insert?.params).toContain('desktop-token-1')
    expect(insert?.params).toContain('2026-08-12T10:00:00.000Z')
    const safeIdempotency = db.calls.find(
      ({ sql }) => marker(sql) === 'idempotency-insert',
    )
    expect(String(safeIdempotency?.params.at(-1))).not.toContain(
      'apps/api/src/example.ts',
    )
  })

  it('rejects delivery when the canonical PR node is no longer running', async () => {
    const db = new FakeGitHubDeliveryDb((sql) => {
      switch (marker(sql)) {
        case 'project-lock':
        case 'audit-insert':
        case 'idempotency-insert':
          return []
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'binding-lock':
          return [bindingRow]
        case 'canonical-authority':
          return [canonicalAuthority({ node_status: 'success' })]
        case 'delivery-logical-lock':
        case 'idempotency-read':
          return []
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGitHubDeliveryRepository(db, {
      now: () => new Date(now),
      createId: (kind) => `github-${kind}-1`,
    })

    await expect(
      repository.createOrReviseGitHubDeliveryRequest(
        {
          projectId: 'project-a',
          intent: deliveryIntent(),
          prTitle: 'Deliver the reviewed change',
          prBody: 'Bound to passing Test Evidence.',
          expectedStateVersion: 0,
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({ ok: false, outcomeCode: 'invalid_state' })
    expect(db.markers()).not.toContain('delivery-create')
  })

  it('rejects an intent whose durable fields no longer match its digest', async () => {
    const tamperedIntent = deliveryIntent()
    tamperedIntent.workspaceId = 'workspace-after-digest'
    const db = new FakeGitHubDeliveryDb((sql) => {
      switch (marker(sql)) {
        case 'project-lock':
        case 'audit-insert':
        case 'idempotency-insert':
          return []
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'binding-lock':
          return [bindingRow]
        case 'idempotency-read':
          return []
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGitHubDeliveryRepository(db, {
      now: () => new Date(now),
      createId: (kind) => `github-${kind}-1`,
    })

    await expect(
      repository.createOrReviseGitHubDeliveryRequest(
        {
          projectId: 'project-a',
          intent: tamperedIntent,
          prTitle: 'Deliver the reviewed change',
          prBody: 'Bound to passing Test Evidence.',
          expectedStateVersion: 0,
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({ ok: false, outcomeCode: 'invalid_state' })
    expect(db.markers()).not.toContain('canonical-authority')
    expect(db.markers()).not.toContain('delivery-create')
  })

  it('rejects PR copy containing local paths or credential material before persistence', async () => {
    const db = new FakeGitHubDeliveryDb((sql) => {
      switch (marker(sql)) {
        case 'project-lock':
        case 'audit-insert':
        case 'idempotency-insert':
          return []
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'binding-lock':
          return [bindingRow]
        case 'idempotency-read':
          return []
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGitHubDeliveryRepository(db, {
      now: () => new Date(now),
      createId: (kind) => `github-${kind}-1`,
    })
    const unsafeBody =
      'Read /Users/example/private/repo and use ghp_123456789012345678901234.'

    await expect(
      repository.createOrReviseGitHubDeliveryRequest(
        {
          projectId: 'project-a',
          intent: deliveryIntent(),
          prTitle: 'Deliver the reviewed change',
          prBody: unsafeBody,
          expectedStateVersion: 0,
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({ ok: false, outcomeCode: 'invalid_state' })
    expect(JSON.stringify(db.calls)).not.toContain(unsafeBody)
    expect(db.markers()).not.toContain('delivery-create')
  })

  it('rejects local-only paths disguised as delivery identifiers', async () => {
    const unsafeIntent = deliveryIntent({
      workspaceId: '/Users/example/private/worktree',
    })
    const db = new FakeGitHubDeliveryDb((sql) => {
      switch (marker(sql)) {
        case 'project-lock':
        case 'audit-insert':
        case 'idempotency-insert':
          return []
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'binding-lock':
          return [bindingRow]
        case 'idempotency-read':
          return []
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGitHubDeliveryRepository(db, {
      now: () => new Date(now),
      createId: (kind) => `github-${kind}-1`,
    })

    await expect(
      repository.createOrReviseGitHubDeliveryRequest(
        {
          projectId: 'project-a',
          intent: unsafeIntent,
          prTitle: 'Deliver the reviewed change',
          prBody: 'Bound to passing Test Evidence.',
          expectedStateVersion: 0,
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({ ok: false, outcomeCode: 'invalid_state' })
    expect(JSON.stringify(db.calls)).not.toContain(unsafeIntent.workspaceId)
    expect(db.markers()).not.toContain('delivery-create')
  })

  it('rejects credential material embedded in a changed path', async () => {
    const unsafePath = 'fixtures/ghp_123456789012345678901234.txt'
    const unsafeIntent = deliveryIntent({ changedPaths: [unsafePath] })
    const db = new FakeGitHubDeliveryDb((sql) => {
      switch (marker(sql)) {
        case 'project-lock':
        case 'audit-insert':
        case 'idempotency-insert':
          return []
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'binding-lock':
          return [bindingRow]
        case 'idempotency-read':
          return []
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGitHubDeliveryRepository(db, {
      now: () => new Date(now),
      createId: (kind) => `github-${kind}-1`,
    })

    await expect(
      repository.createOrReviseGitHubDeliveryRequest(
        {
          projectId: 'project-a',
          intent: unsafeIntent,
          prTitle: 'Deliver the reviewed change',
          prBody: 'Bound to passing Test Evidence.',
          expectedStateVersion: 0,
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({ ok: false, outcomeCode: 'invalid_state' })
    expect(JSON.stringify(db.calls)).not.toContain(unsafePath)
    expect(db.markers()).not.toContain('delivery-create')
  })

  it('does not persist an unmatched caller identifier in audit metadata', async () => {
    const unsafeGrantId = '/Users/example/private/ghp_123456789012345678901234'
    const db = new FakeGitHubDeliveryDb((sql) => {
      switch (marker(sql)) {
        case 'project-lock':
        case 'audit-insert':
        case 'idempotency-insert':
          return []
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'delivery-lock':
        case 'idempotency-read':
          return []
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGitHubDeliveryRepository(db, {
      now: () => new Date(now),
      createId: (kind) => `github-${kind}-1`,
    })

    await expect(
      repository.finalizeGitHubCredentialGrant(
        {
          projectId: 'project-a',
          requestId: 'missing-delivery',
          grantId: unsafeGrantId,
          expectedStateVersion: 1,
          expectedGrantVersion: 1,
          outcome: {
            status: 'failed',
            outcomeCode: 'credential_issue_failed',
          },
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({ ok: false, outcomeCode: 'not_found' })
    expect(JSON.stringify(db.calls)).not.toContain(unsafeGrantId)
    const audit = db.calls.find(({ sql }) => marker(sql) === 'audit-insert')
    expect(audit?.params[8]).toMatch(/^github-grant-unresolved-[a-f0-9]{32}$/u)
  })

  it('lists browser and Desktop delivery views through separate live authority scopes', async () => {
    const desktopDb = new FakeGitHubDeliveryDb((sql) => {
      switch (marker(sql)) {
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'delivery-list-desktop':
          return [deliveryRequestRow]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const desktopRepository = createPostgresGitHubDeliveryRepository(desktopDb)
    const desktopResult = await desktopRepository.listGitHubDeliveryInbox(
      'project-a',
      desktopPrincipal,
    )
    expect(desktopResult).toHaveLength(1)
    expect(JSON.stringify(desktopResult)).not.toContain('desktop-token-1')
    const desktopList = desktopDb.calls.find(
      ({ sql }) => marker(sql) === 'delivery-list-desktop',
    )
    expect(desktopList?.sql).toMatch(/requested_by_token_id\s*=\s*\$3/i)
    expect(desktopList?.params).toEqual([
      'org-a',
      'project-a',
      'desktop-token-1',
    ])

    const browserDb = new FakeGitHubDeliveryDb((sql) => {
      switch (marker(sql)) {
        case 'cookie-identity':
          return [cookieIdentity('lead')]
        case 'delivery-list-browser':
          return [deliveryRequestRow]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const browserRepository = createPostgresGitHubDeliveryRepository(browserDb)
    await expect(
      browserRepository.listGitHubDeliveryRequests('project-a', {
        ...ownerPrincipal,
        session: { ...ownerPrincipal.session, role: 'lead' },
      }),
    ).resolves.toHaveLength(1)
    expect(browserDb.checkoutCount).toBe(0)
  })

  it('loads a current-revision recovery snapshot for the exact live paired Desktop claimant', async () => {
    const request = {
      ...deliveryRequestRow,
      state_version: 7,
      status: 'creating_pr',
    }
    const db = new FakeGitHubDeliveryDb((sql) => {
      switch (marker(sql)) {
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'recovery-delivery-read':
          return [request]
        case 'recovery-approval-read':
          return [deliveryApprovalRow()]
        case 'recovery-grant-read':
          return [credentialGrantRow({ version: 3, status: 'consumed' })]
        case 'recovery-publication-read':
          return [branchPublicationRow({ version: 3, status: 'verified' })]
        case 'recovery-pull-request-read':
          return [pullRequestOutcomeRow({ version: 2 })]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGitHubDeliveryRepository(db)

    const snapshot = await repository.getGitHubDeliveryRecoverySnapshot(
      'project-a',
      request.id,
      desktopPrincipal,
    )

    expect(snapshot).toMatchObject({
      request: {
        id: request.id,
        stateVersion: 7,
        intentRevision: 1,
        status: 'creating_pr',
        redacted: true,
      },
      approval: { id: 'github-approval-1', intentRevision: 1, redacted: true },
      grant: {
        id: 'github-grant-1',
        version: 3,
        intentRevision: 1,
        status: 'consumed',
        redacted: true,
      },
      publication: {
        id: 'github-publication-1',
        version: 3,
        intentRevision: 1,
        status: 'verified',
        redacted: true,
      },
      pullRequest: {
        id: 'github-pull-request-1',
        version: 2,
        intentRevision: 1,
        status: 'creating',
        redacted: true,
      },
    })
    expect(JSON.stringify(snapshot)).not.toMatch(
      /desktop-token-1|private.?key|credential_value|workspacePath|authorization/i,
    )
    expect(db.checkoutCount).toBe(1)
    expect(db.releaseCount).toBe(1)
    expect(db.calls[0]?.sql).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ')
    expect(db.calls.at(-1)?.sql).toBe('COMMIT')
    expect(db.markers()).toEqual([
      'bearer-identity',
      'recovery-delivery-read',
      'recovery-approval-read',
      'recovery-grant-read',
      'recovery-publication-read',
      'recovery-pull-request-read',
    ])
    for (const { sql } of db.calls) {
      expect(sql).not.toMatch(/FOR\s+(?:UPDATE|NO\s+KEY\s+UPDATE)/i)
      expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b/i)
    }
    const requestRead = db.calls.find(
      ({ sql }) => marker(sql) === 'recovery-delivery-read',
    )
    expect(requestRead?.sql).toMatch(/organization_id\s*=\s*\$2/i)
    expect(requestRead?.sql).toMatch(/project_id\s*=\s*\$3/i)
    expect(requestRead?.sql).toMatch(/requested_by_token_id\s*=\s*\$4/i)
    expect(requestRead?.params).toEqual([
      request.id,
      'org-a',
      'project-a',
      'desktop-token-1',
    ])
  })

  it('returns no recovery snapshot to another paired token or tenant', async () => {
    const otherTokenPrincipal = {
      ...desktopPrincipal,
      authentication: {
        kind: 'desktop_bearer' as const,
        tokenRecordId: 'desktop-token-2',
      },
    }
    const tokenDb = new FakeGitHubDeliveryDb((sql, params) => {
      switch (marker(sql)) {
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'recovery-delivery-read':
          expect(params.at(-1)).toBe('desktop-token-2')
          return []
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const tokenRepository = createPostgresGitHubDeliveryRepository(tokenDb)

    await expect(
      tokenRepository.getGitHubDeliveryRecoverySnapshot(
        'project-a',
        deliveryRequestRow.id,
        otherTokenPrincipal,
      ),
    ).resolves.toBeNull()
    expect(tokenDb.markers()).toEqual([
      'bearer-identity',
      'recovery-delivery-read',
    ])

    const otherTenantPrincipal = {
      ...desktopPrincipal,
      session: { ...desktopPrincipal.session, organizationId: 'org-b' },
    }
    const tenantDb = new FakeGitHubDeliveryDb((sql) => {
      if (marker(sql) === 'bearer-identity') return []
      throw new Error(`Unexpected query: ${sql}`)
    })
    const tenantRepository = createPostgresGitHubDeliveryRepository(tenantDb)
    await expect(
      tenantRepository.getGitHubDeliveryRecoverySnapshot(
        'project-a',
        deliveryRequestRow.id,
        otherTenantPrincipal,
      ),
    ).resolves.toBeNull()
    expect(tenantDb.markers()).toEqual(['bearer-identity'])
  })

  it('records one immutable exact approval only after live lead, binding, Run, and claimant rechecks', async () => {
    const approvalRow = {
      id: 'github-approval-1',
      request_id: 'github-delivery-1',
      intent_revision: 1,
      request_state_version: 1,
      intent_digest: digestD,
      binding_id: 'github-binding-1',
      binding_version: 1,
      run_id: 'run-1',
      run_version: 7,
      node_id: 'pr-1',
      repository_id: '98765',
      base_branch: 'main',
      head_branch: 'devflow/run-1-pr-1',
      expected_commit_sha: shaB,
      test_evidence_digest: digestB,
      package_digest: digestC,
      approved_by_user_id: 'user-lead',
      approved_role: 'lead',
      auth_kind: 'session_cookie',
      approved_at: now,
    }
    const approvedRequest = {
      ...deliveryRequestRow,
      state_version: 2,
      status: 'approved',
    }
    const db = new FakeGitHubDeliveryDb((sql) => {
      switch (marker(sql)) {
        case 'project-lock':
        case 'audit-insert':
        case 'idempotency-insert':
          return []
        case 'cookie-identity':
          return [leadIdentity()]
        case 'delivery-lock':
          return [deliveryRequestRow]
        case 'binding-lock':
          return [bindingRow]
        case 'canonical-authority':
          return [canonicalAuthority()]
        case 'approval-current':
        case 'idempotency-read':
          return []
        case 'approval-create':
          return [approvalRow]
        case 'delivery-approve':
          return [approvedRequest]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGitHubDeliveryRepository(db, {
      now: () => new Date(now),
      createId: (kind) => `github-${kind}-1`,
    })

    const result = await repository.decideGitHubDeliveryRequest(
      {
        projectId: 'project-a',
        requestId: 'github-delivery-1',
        decision: 'approve',
        expectedStateVersion: 1,
      },
      leadPrincipal,
    )

    expect(result).toMatchObject({
      ok: true,
      outcomeCode: 'delivery_approved',
      replayed: false,
      request: { stateVersion: 2, status: 'approved' },
      approval: {
        id: 'github-approval-1',
        approvedByUserId: 'user-lead',
        authenticationKind: 'session_cookie',
        expectedCommitSha: shaB,
        redacted: true,
      },
    })
    expect(JSON.stringify(result)).not.toContain('desktop-token-1')
    const authority = db.calls.find(
      ({ sql }) => marker(sql) === 'canonical-authority',
    )
    expect(authority?.params).toEqual([
      'org-a',
      'project-a',
      'run-1',
      'user-desktop',
      'desktop-token-1',
    ])
    const update = db.calls.find(
      ({ sql }) => marker(sql) === 'delivery-approve',
    )
    expect(update?.sql).toMatch(/state_version\s*=\s*state_version\s*\+\s*1/i)
    expect(update?.sql).toMatch(/state_version\s*=\s*\$4/i)
  })

  it('replays an identical rejection after its terminal response was lost', async () => {
    const rejectedRequest = {
      ...deliveryRequestRow,
      state_version: 2,
      status: 'revoked',
      outcome_code: 'approval_rejected',
    }
    const db = new FakeGitHubDeliveryDb((sql) => {
      switch (marker(sql)) {
        case 'project-lock':
          return []
        case 'cookie-identity':
          return [leadIdentity()]
        case 'delivery-lock':
          return [rejectedRequest]
        case 'approval-current':
          return []
        case 'idempotency-read':
          return [{
            request_fingerprint: digestA,
            response_json: {
              ok: true,
              responseStatus: 200,
              outcomeCode: 'delivery_rejected',
              recordId: rejectedRequest.id,
              observedVersion: 2,
            },
          }]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGitHubDeliveryRepository(db, {
      now: () => new Date(now),
    })

    await expect(
      repository.decideGitHubDeliveryRequest(
        {
          projectId: 'project-a',
          requestId: rejectedRequest.id,
          decision: 'reject',
          expectedStateVersion: 1,
        },
        leadPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      outcomeCode: 'delivery_rejected',
      replayed: true,
      request: { stateVersion: 2, status: 'revoked' },
      approval: null,
    })
    expect(db.markers()).not.toContain('binding-lock')
    expect(db.markers()).not.toContain('delivery-reject')
  })

  it('reserves one repository-scoped credential attempt only for the exact approved claimant', async () => {
    const approvedRequest = {
      ...deliveryRequestRow,
      state_version: 2,
      status: 'approved',
    }
    const publishingRequest = {
      ...approvedRequest,
      state_version: 3,
      status: 'publishing_branch',
    }
    const approvalRow = {
      id: 'github-approval-1',
      request_id: 'github-delivery-1',
      intent_revision: 1,
      request_state_version: 1,
      intent_digest: digestD,
      binding_id: 'github-binding-1',
      binding_version: 1,
      run_id: 'run-1',
      run_version: 7,
      node_id: 'pr-1',
      repository_id: '98765',
      base_branch: 'main',
      head_branch: 'devflow/run-1-pr-1',
      expected_commit_sha: shaB,
      test_evidence_digest: digestB,
      package_digest: digestC,
      approved_by_user_id: 'user-lead',
      approved_role: 'lead',
      auth_kind: 'session_cookie',
      approved_at: now,
    }
    const grantRow = {
      id: 'github-grant-1',
      version: 1,
      request_id: 'github-delivery-1',
      intent_revision: 1,
      approval_id: 'github-approval-1',
      attempt: 1,
      issued_to_token_id: 'desktop-token-1',
      repository_id: '98765',
      permission: 'contents:write',
      repository_count: 1,
      status: 'issuing',
      requested_at: now,
      issued_at: null,
      credential_expires_at: null,
      consumed_at: null,
      outcome_code: null,
    }
    const db = new FakeGitHubDeliveryDb((sql) => {
      switch (marker(sql)) {
        case 'project-lock':
        case 'audit-insert':
        case 'idempotency-insert':
          return []
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'delivery-lock':
          return [approvedRequest]
        case 'binding-lock':
          return [bindingRow]
        case 'canonical-authority':
          return [canonicalAuthority()]
        case 'approval-current':
          return [approvalRow]
        case 'grant-current':
        case 'idempotency-read':
          return []
        case 'delivery-start-publishing':
          return [publishingRequest]
        case 'grant-create':
          return [grantRow]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGitHubDeliveryRepository(db, {
      now: () => new Date(now),
      createId: (kind) => `github-${kind}-1`,
    })

    const result = await repository.reserveGitHubCredentialGrant(
      {
        projectId: 'project-a',
        requestId: 'github-delivery-1',
        expectedStateVersion: 2,
      },
      desktopPrincipal,
    )

    expect(result).toMatchObject({
      ok: true,
      responseStatus: 201,
      outcomeCode: 'grant_reserved',
      replayed: false,
      request: { stateVersion: 3, status: 'publishing_branch' },
      grant: {
        id: 'github-grant-1',
        attempt: 1,
        repositoryId: '98765',
        permission: 'contents:write',
        repositoryCount: 1,
        status: 'issuing',
        redacted: true,
      },
    })
    expect(JSON.stringify(result)).not.toContain('desktop-token-1')
    const create = db.calls.find(({ sql }) => marker(sql) === 'grant-create')
    expect(create?.sql).not.toMatch(/token_hash|credential_value|private_key/i)
    expect(create?.params).toContain('desktop-token-1')
  })

  it('reserves a new numbered grant after a consumed publication enters recovery', async () => {
    const recoveringRequest = {
      ...deliveryRequestRow,
      state_version: 6,
      status: 'recovery_required',
      outcome_code: 'branch_verification_failed',
    }
    const publishingRequest = {
      ...recoveringRequest,
      state_version: 7,
      status: 'publishing_branch',
      outcome_code: null,
    }
    const consumedGrant = credentialGrantRow({
      version: 3,
      status: 'consumed',
      consumed_at: '2026-08-11T09:57:00.000Z',
    })
    const nextGrant = credentialGrantRow({
      id: 'github-grant-2',
      version: 1,
      attempt: 2,
      status: 'issuing',
      requested_at: now,
      issued_at: null,
      credential_expires_at: null,
      consumed_at: null,
    })
    const db = new FakeGitHubDeliveryDb((sql) => {
      switch (marker(sql)) {
        case 'project-lock':
        case 'audit-insert':
        case 'idempotency-insert':
          return []
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'delivery-lock':
          return [recoveringRequest]
        case 'approval-current':
          return [deliveryApprovalRow()]
        case 'grant-current':
          return [consumedGrant]
        case 'publication-current':
          return [branchPublicationRow({ status: 'conflict' })]
        case 'binding-lock':
          return [bindingRow]
        case 'canonical-authority':
          return [canonicalAuthority()]
        case 'idempotency-read':
          return []
        case 'delivery-start-publishing':
          return [publishingRequest]
        case 'grant-create':
          return [nextGrant]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGitHubDeliveryRepository(db, {
      now: () => new Date(now),
      createId: (kind) => `github-${kind}-2`,
    })

    await expect(
      repository.reserveGitHubCredentialGrant(
        {
          projectId: 'project-a',
          requestId: 'github-delivery-1',
          expectedStateVersion: 6,
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      replayed: false,
      request: { stateVersion: 7, status: 'publishing_branch' },
      grant: { id: 'github-grant-2', attempt: 2, status: 'issuing' },
    })
    const audit = db.calls.find(({ sql }) => marker(sql) === 'audit-insert')
    expect(audit?.params[8]).toBe('github-grant-2')
  })

  it('closes a stale issuing lease before reserving one bounded replacement', async () => {
    const request = {
      ...deliveryRequestRow,
      state_version: 4,
      status: 'publishing_branch',
      outcome_code: null,
    }
    const staleGrant = credentialGrantRow({
      version: 1,
      status: 'issuing',
      requested_at: '2026-08-11T09:58:00.000Z',
      issued_at: null,
      credential_expires_at: null,
    })
    const closedGrant = {
      ...staleGrant,
      version: 2,
      status: 'failed',
      outcome_code: 'credential_issue_failed',
    }
    const publishingRequest = { ...request, state_version: 5 }
    const nextGrant = credentialGrantRow({
      id: 'github-grant-2',
      version: 1,
      attempt: 2,
      status: 'issuing',
      requested_at: now,
      issued_at: null,
      credential_expires_at: null,
    })
    const db = new FakeGitHubDeliveryDb((sql) => {
      switch (marker(sql)) {
        case 'project-lock':
        case 'audit-insert':
        case 'idempotency-insert':
          return []
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'delivery-lock':
          return [request]
        case 'approval-current':
          return [deliveryApprovalRow()]
        case 'grant-current':
          return [staleGrant]
        case 'binding-lock':
          return [bindingRow]
        case 'canonical-authority':
          return [canonicalAuthority()]
        case 'idempotency-read':
          return []
        case 'grant-close-stale-issuance':
          return [closedGrant]
        case 'delivery-start-publishing':
          return [publishingRequest]
        case 'grant-create':
          return [nextGrant]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGitHubDeliveryRepository(db, {
      now: () => new Date(now),
      createId: (kind) => `github-${kind}-2`,
    })

    await expect(
      repository.reserveGitHubCredentialGrant(
        {
          projectId: 'project-a',
          requestId: request.id,
          expectedStateVersion: request.state_version,
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      replayed: false,
      request: { stateVersion: 5, status: 'publishing_branch' },
      grant: { id: 'github-grant-2', attempt: 2, status: 'issuing' },
    })
    const close = db.calls.find(
      ({ sql }) => marker(sql) === 'grant-close-stale-issuance',
    )
    expect(close?.sql).toMatch(/status\s*=\s*'failed'/i)
    expect(close?.sql).toMatch(/outcome_code\s*=\s*'credential_issue_failed'/i)
  })

  it('replays an issuing credential reservation while its lease is live', async () => {
    const request = {
      ...deliveryRequestRow,
      state_version: 4,
      status: 'publishing_branch',
      outcome_code: null,
    }
    const issuingGrant = credentialGrantRow({
      version: 1,
      status: 'issuing',
      requested_at: '2026-08-11T09:59:00.001Z',
      issued_at: null,
      credential_expires_at: null,
    })
    const db = new FakeGitHubDeliveryDb((sql) => {
      switch (marker(sql)) {
        case 'project-lock':
        case 'audit-insert':
        case 'idempotency-insert':
          return []
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'delivery-lock':
          return [request]
        case 'approval-current':
          return [deliveryApprovalRow()]
        case 'grant-current':
          return [issuingGrant]
        case 'binding-lock':
          return [bindingRow]
        case 'canonical-authority':
          return [canonicalAuthority()]
        case 'idempotency-read':
          return []
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGitHubDeliveryRepository(db, {
      now: () => new Date(now),
    })

    await expect(
      repository.reserveGitHubCredentialGrant(
        {
          projectId: 'project-a',
          requestId: request.id,
          expectedStateVersion: request.state_version,
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      replayed: true,
      request: { stateVersion: 4, status: 'publishing_branch' },
      grant: { id: issuingGrant.id, attempt: 1, status: 'issuing' },
    })
    expect(db.markers()).not.toContain('grant-create')
  })

  it('transitions an issued grant to expired before reserving its replacement', async () => {
    const request = {
      ...deliveryRequestRow,
      state_version: 4,
      status: 'publishing_branch',
      outcome_code: null,
    }
    const expiredGrant = credentialGrantRow({
      credential_expires_at: now,
    })
    const transitionedGrant = {
      ...expiredGrant,
      version: 3,
      status: 'expired',
      outcome_code: 'credential_expired',
    }
    const publishingRequest = { ...request, state_version: 5 }
    const nextGrant = credentialGrantRow({
      id: 'github-grant-2',
      version: 1,
      attempt: 2,
      status: 'issuing',
      requested_at: now,
      issued_at: null,
      credential_expires_at: null,
    })
    const db = new FakeGitHubDeliveryDb((sql) => {
      switch (marker(sql)) {
        case 'project-lock':
        case 'audit-insert':
        case 'idempotency-insert':
          return []
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'delivery-lock':
          return [request]
        case 'approval-current':
          return [deliveryApprovalRow()]
        case 'grant-current':
          return [expiredGrant]
        case 'binding-lock':
          return [bindingRow]
        case 'canonical-authority':
          return [canonicalAuthority()]
        case 'idempotency-read':
          return []
        case 'grant-expire':
          return [transitionedGrant]
        case 'delivery-start-publishing':
          return [publishingRequest]
        case 'grant-create':
          return [nextGrant]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGitHubDeliveryRepository(db, {
      now: () => new Date(now),
      createId: (kind) => `github-${kind}-2`,
    })

    await expect(
      repository.reserveGitHubCredentialGrant(
        {
          projectId: 'project-a',
          requestId: 'github-delivery-1',
          expectedStateVersion: 4,
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      replayed: false,
      request: { stateVersion: 5, status: 'publishing_branch' },
      grant: { id: 'github-grant-2', attempt: 2, status: 'issuing' },
    })
    const expire = db.calls.find(({ sql }) => marker(sql) === 'grant-expire')
    expect(expire?.sql).toMatch(/status\s*=\s*'expired'/i)
    expect(expire?.sql).toMatch(/outcome_code\s*=\s*'credential_expired'/i)
    expect(expire?.sql).toMatch(/credential_expires_at\s*<=\s*\$5/i)
  })

  it('supersedes an issued grant before a bounded replacement after response loss', async () => {
    const request = {
      ...deliveryRequestRow,
      state_version: 4,
      status: 'publishing_branch',
      outcome_code: null,
    }
    const issuedGrant = credentialGrantRow({
      credential_expires_at: '2026-08-11T10:45:00.000Z',
    })
    const supersededGrant = {
      ...issuedGrant,
      version: 3,
      status: 'failed',
      outcome_code: 'credential_superseded',
    }
    const publishingRequest = { ...request, state_version: 5 }
    const nextGrant = credentialGrantRow({
      id: 'github-grant-2',
      version: 1,
      attempt: 2,
      status: 'issuing',
      requested_at: now,
      issued_at: null,
      credential_expires_at: null,
      consumed_at: null,
    })
    const db = new FakeGitHubDeliveryDb((sql) => {
      switch (marker(sql)) {
        case 'project-lock':
        case 'audit-insert':
        case 'idempotency-insert':
          return []
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'delivery-lock':
          return [request]
        case 'approval-current':
          return [deliveryApprovalRow()]
        case 'grant-current':
          return [issuedGrant]
        case 'binding-lock':
          return [bindingRow]
        case 'canonical-authority':
          return [canonicalAuthority()]
        case 'idempotency-read':
          return []
        case 'grant-supersede-lost-response':
          return [supersededGrant]
        case 'delivery-start-publishing':
          return [publishingRequest]
        case 'grant-create':
          return [nextGrant]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGitHubDeliveryRepository(db, {
      now: () => new Date(now),
      createId: (kind) => `github-${kind}-2`,
    })

    await expect(
      repository.reserveGitHubCredentialGrant(
        {
          projectId: 'project-a',
          requestId: 'github-delivery-1',
          expectedStateVersion: 4,
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      replayed: false,
      request: { stateVersion: 5, status: 'publishing_branch' },
      grant: { id: 'github-grant-2', attempt: 2, status: 'issuing' },
    })
    const supersede = db.calls.find(
      ({ sql }) => marker(sql) === 'grant-supersede-lost-response',
    )
    expect(supersede?.sql).toMatch(/status\s*=\s*'failed'/i)
    expect(supersede?.sql).toMatch(
      /outcome_code\s*=\s*'credential_superseded'/i,
    )
  })

  it('rechecks the exact binding before finalizing a credential grant', async () => {
    const request = {
      ...deliveryRequestRow,
      state_version: 3,
      status: 'publishing_branch',
    }
    const grant = credentialGrantRow({
      version: 1,
      status: 'issuing',
      issued_at: null,
      credential_expires_at: null,
    })
    const revokedBinding = {
      ...bindingRow,
      version: 2,
      status: 'revoked',
      revoked_at: now,
    }
    const db = new FakeGitHubDeliveryDb((sql) => {
      switch (marker(sql)) {
        case 'project-lock':
        case 'audit-insert':
        case 'idempotency-insert':
          return []
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'delivery-lock':
          return [request]
        case 'grant-lock':
          return [grant]
        case 'approval-current':
          return [deliveryApprovalRow()]
        case 'binding-lock':
          return [revokedBinding]
        case 'idempotency-read':
          return []
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGitHubDeliveryRepository(db, {
      now: () => new Date(now),
      createId: (kind) => `github-${kind}-1`,
    })

    await expect(
      repository.finalizeGitHubCredentialGrant(
        {
          projectId: 'project-a',
          requestId: request.id,
          grantId: grant.id,
          expectedStateVersion: 3,
          expectedGrantVersion: 1,
          outcome: {
            status: 'recovery_required',
            outcomeCode: 'credential_issue_failed',
          },
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({ ok: false, outcomeCode: 'binding_inactive' })
    expect(db.markers()).not.toContain('grant-finalize')
  })

  it('rejects publication finalization when the canonical PR node has moved', async () => {
    const request = {
      ...deliveryRequestRow,
      state_version: 5,
      status: 'publishing_branch',
    }
    const publication = branchPublicationRow({
      version: 1,
      status: 'verifying',
      reported_outcome_code: 'pushed',
      outcome_code: null,
    })
    const db = new FakeGitHubDeliveryDb((sql) => {
      switch (marker(sql)) {
        case 'project-lock':
        case 'audit-insert':
        case 'idempotency-insert':
          return []
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'delivery-lock':
          return [request]
        case 'publication-lock':
          return [publication]
        case 'approval-current':
          return [deliveryApprovalRow()]
        case 'binding-lock':
          return [bindingRow]
        case 'canonical-authority':
          return [canonicalAuthority({ node_status: 'success' })]
        case 'idempotency-read':
          return []
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGitHubDeliveryRepository(db, {
      now: () => new Date(now),
      createId: (kind) => `github-${kind}-1`,
    })

    await expect(
      repository.finalizeGitHubBranchPublication(
        {
          projectId: 'project-a',
          requestId: request.id,
          publicationId: publication.id,
          expectedStateVersion: 5,
          expectedPublicationVersion: 1,
          verification: {
            status: 'recovery_required',
            verifiedHeadSha: null,
            verifiedAt: null,
            outcomeCode: 'branch_verification_failed',
          },
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({ ok: false, outcomeCode: 'invalid_state' })
    expect(db.markers()).not.toContain('publication-finalize')
  })

  it('accepts an exact Draft PR created before verification and records the observation time', async () => {
    const request = {
      ...deliveryRequestRow,
      state_version: 7,
      status: 'creating_pr',
    }
    const pullRequest = pullRequestOutcomeRow()
    const publication = branchPublicationRow({
      status: 'verified',
      verified_head_sha: shaB,
      verified_at: '2026-08-11T09:59:00.000Z',
      outcome_code: 'branch_verified',
    })
    const providerCreatedAt = '2026-08-11T09:50:00.000Z'
    const completedPullRequest = {
      ...pullRequest,
      version: 2,
      status: 'completed',
      pull_request_id: '456789',
      pull_request_number: 42,
      safe_url: 'https://github.com/example/project/pull/42',
      provider_created_at: providerCreatedAt,
      recorded_at: now,
      outcome_code: 'draft_pr_created',
    }
    const completedRequest = {
      ...request,
      state_version: 8,
      status: 'completed',
      outcome_code: 'draft_pr_created',
      updated_at: now,
    }
    const db = new FakeGitHubDeliveryDb((sql) => {
      switch (marker(sql)) {
        case 'project-lock':
        case 'audit-insert':
        case 'idempotency-insert':
          return []
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'delivery-lock':
          return [request]
        case 'pull-request-lock':
          return [pullRequest]
        case 'publication-lock':
          return [publication]
        case 'approval-current':
          return [deliveryApprovalRow()]
        case 'binding-lock':
          return [bindingRow]
        case 'canonical-authority':
          return [canonicalAuthority()]
        case 'idempotency-read':
          return []
        case 'pull-request-finalize':
          return [completedPullRequest]
        case 'delivery-finalize-pull-request':
          return [completedRequest]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGitHubDeliveryRepository(db, {
      now: () => new Date(now),
    })

    await expect(
      repository.finalizeGitHubDraftPullRequest(
        {
          projectId: 'project-a',
          requestId: request.id,
          pullRequestOutcomeId: pullRequest.id,
          expectedStateVersion: request.state_version,
          expectedPullRequestVersion: pullRequest.version,
          outcome: {
            status: 'completed',
            pullRequestId: '456789',
            pullRequestNumber: 42,
            safeUrl: 'https://github.com/example/project/pull/42',
            draft: true,
            repository: 'example/project',
            baseBranch: 'main',
            headBranch: 'devflow/run-1-pr-1',
            headSha: shaB,
            providerCreatedAt,
            outcomeCode: 'draft_pr_created',
          },
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      request: { stateVersion: 8, status: 'completed' },
      pullRequest: {
        status: 'completed',
        providerCreatedAt,
        recordedAt: now,
      },
    })
    const finalize = db.calls.find(
      ({ sql }) => marker(sql) === 'pull-request-finalize',
    )
    expect(finalize?.params[9]).toBe(now)
  })

  it('rechecks the immutable approval before finalizing a Draft PR', async () => {
    const request = {
      ...deliveryRequestRow,
      state_version: 7,
      status: 'creating_pr',
    }
    const pullRequest = pullRequestOutcomeRow()
    const publication = branchPublicationRow({
      status: 'verified',
      verified_head_sha: shaB,
      verified_at: '2026-08-11T09:59:00.000Z',
      outcome_code: 'branch_verified',
    })
    const db = new FakeGitHubDeliveryDb((sql) => {
      switch (marker(sql)) {
        case 'project-lock':
        case 'audit-insert':
        case 'idempotency-insert':
          return []
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'delivery-lock':
          return [request]
        case 'pull-request-lock':
          return [pullRequest]
        case 'publication-lock':
          return [publication]
        case 'approval-current':
          return [deliveryApprovalRow({ intent_digest: digestA })]
        case 'binding-lock':
          return [bindingRow]
        case 'canonical-authority':
          return [canonicalAuthority()]
        case 'idempotency-read':
          return []
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGitHubDeliveryRepository(db, {
      now: () => new Date(now),
      createId: (kind) => `github-${kind}-1`,
    })

    await expect(
      repository.finalizeGitHubDraftPullRequest(
        {
          projectId: 'project-a',
          requestId: request.id,
          pullRequestOutcomeId: pullRequest.id,
          expectedStateVersion: 7,
          expectedPullRequestVersion: 1,
          outcome: {
            status: 'recovery_required',
            outcomeCode: 'pull_request_failed',
          },
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({ ok: false, outcomeCode: 'approval_required' })
    expect(db.markers()).not.toContain('pull-request-finalize')
  })

  it('consumes issued grant metadata and records one branch publication for API verification', async () => {
    const request = {
      ...deliveryRequestRow,
      state_version: 4,
      status: 'publishing_branch',
    }
    const touchedRequest = { ...request, state_version: 5 }
    const grant = {
      id: 'github-grant-1',
      version: 2,
      request_id: 'github-delivery-1',
      intent_revision: 1,
      approval_id: 'github-approval-1',
      attempt: 1,
      issued_to_token_id: 'desktop-token-1',
      repository_id: '98765',
      permission: 'contents:write',
      repository_count: 1,
      status: 'issued',
      requested_at: '2026-08-11T09:59:00.000Z',
      issued_at: '2026-08-11T09:59:01.000Z',
      credential_expires_at: '2026-08-11T10:45:00.000Z',
      consumed_at: null,
      outcome_code: null,
    }
    const consumedGrant = {
      ...grant,
      version: 3,
      status: 'consumed',
      consumed_at: now,
    }
    const approval = {
      id: 'github-approval-1',
      request_id: 'github-delivery-1',
      intent_revision: 1,
      request_state_version: 1,
      intent_digest: digestD,
      binding_id: 'github-binding-1',
      binding_version: 1,
      run_id: 'run-1',
      run_version: 7,
      node_id: 'pr-1',
      repository_id: '98765',
      base_branch: 'main',
      head_branch: 'devflow/run-1-pr-1',
      expected_commit_sha: shaB,
      test_evidence_digest: digestB,
      package_digest: digestC,
      approved_by_user_id: 'user-lead',
      approved_role: 'lead',
      auth_kind: 'session_cookie',
      approved_at: '2026-08-11T09:58:00.000Z',
    }
    const publication = {
      id: 'github-publication-1',
      version: 1,
      request_id: 'github-delivery-1',
      intent_revision: 1,
      grant_id: 'github-grant-1',
      status: 'verifying',
      reported_outcome_code: 'pushed',
      verified_head_sha: null,
      reported_at: now,
      verified_at: null,
      outcome_code: null,
    }
    const db = new FakeGitHubDeliveryDb((sql) => {
      switch (marker(sql)) {
        case 'project-lock':
        case 'audit-insert':
        case 'idempotency-insert':
          return []
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'delivery-lock':
          return [request]
        case 'grant-lock':
          return [grant]
        case 'binding-lock':
          return [bindingRow]
        case 'canonical-authority':
          return [canonicalAuthority()]
        case 'approval-current':
          return [approval]
        case 'publication-current':
        case 'idempotency-read':
          return []
        case 'grant-consume':
          return [consumedGrant]
        case 'publication-create':
          return [publication]
        case 'delivery-touch-publication':
          return [touchedRequest]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGitHubDeliveryRepository(db, {
      now: () => new Date(now),
      createId: (kind) => `github-${kind}-1`,
    })

    const result = await repository.recordGitHubBranchPublicationReport(
      {
        projectId: 'project-a',
        requestId: 'github-delivery-1',
        grantId: 'github-grant-1',
        expectedStateVersion: 4,
        expectedGrantVersion: 2,
        reportedOutcomeCode: 'pushed',
      },
      desktopPrincipal,
    )

    expect(result).toMatchObject({
      ok: true,
      responseStatus: 201,
      outcomeCode: 'publication_reported',
      replayed: false,
      request: { stateVersion: 5, status: 'publishing_branch' },
      grant: { version: 3, status: 'consumed', consumedAt: now },
      publication: {
        id: 'github-publication-1',
        status: 'verifying',
        reportedOutcomeCode: 'pushed',
        verifiedHeadSha: null,
      },
    })
  })

  it('rebinds a recoverable publication to a newly issued grant attempt', async () => {
    const request = {
      ...deliveryRequestRow,
      state_version: 8,
      status: 'publishing_branch',
      outcome_code: null,
    }
    const touchedRequest = { ...request, state_version: 9 }
    const grant = credentialGrantRow({
      id: 'github-grant-2',
      attempt: 2,
      credential_expires_at: '2026-08-11T10:45:00.000Z',
    })
    const consumedGrant = {
      ...grant,
      version: 3,
      status: 'consumed',
      consumed_at: now,
    }
    const publication = branchPublicationRow({
      status: 'conflict',
      outcome_code: 'branch_conflict',
    })
    const rearmedPublication = {
      ...publication,
      version: 3,
      grant_id: 'github-grant-2',
      status: 'verifying',
      reported_outcome_code: 'pushed',
      reported_at: now,
      outcome_code: null,
    }
    const db = new FakeGitHubDeliveryDb((sql) => {
      switch (marker(sql)) {
        case 'project-lock':
        case 'audit-insert':
        case 'idempotency-insert':
          return []
        case 'bearer-identity':
          return [bearerIdentity()]
        case 'delivery-lock':
          return [request]
        case 'grant-lock':
          return [grant]
        case 'publication-current':
          return [publication]
        case 'approval-current':
          return [deliveryApprovalRow()]
        case 'binding-lock':
          return [bindingRow]
        case 'canonical-authority':
          return [canonicalAuthority()]
        case 'idempotency-read':
          return []
        case 'grant-consume':
          return [consumedGrant]
        case 'publication-rearm':
          return [rearmedPublication]
        case 'delivery-touch-publication':
          return [touchedRequest]
        default:
          throw new Error(`Unexpected query: ${sql}`)
      }
    })
    const repository = createPostgresGitHubDeliveryRepository(db, {
      now: () => new Date(now),
      createId: (kind) => `github-${kind}-2`,
    })

    await expect(
      repository.recordGitHubBranchPublicationReport(
        {
          projectId: 'project-a',
          requestId: 'github-delivery-1',
          grantId: 'github-grant-2',
          expectedStateVersion: 8,
          expectedGrantVersion: 2,
          reportedOutcomeCode: 'pushed',
        },
        desktopPrincipal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      replayed: false,
      grant: { id: 'github-grant-2', version: 3, status: 'consumed' },
      publication: {
        id: 'github-publication-1',
        version: 3,
        grantId: 'github-grant-2',
        status: 'verifying',
      },
    })
    const rearm = db.calls.find(
      ({ sql }) => marker(sql) === 'publication-rearm',
    )
    expect(rearm?.sql).toMatch(/grant_id\s*=\s*\$5/i)
    expect(rearm?.params[4]).toBe('github-grant-2')
  })
})
