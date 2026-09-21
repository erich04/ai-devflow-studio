// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRemoteRunSummary, createRemoteTestEvidenceSummary, createWorkflowRunFromRequest, toTeamStoredNodeId, type DesktopPairingExchangeResult } from '../packages/shared/src/index'
import { completeOrganizationWorkflow } from './organization-workflow-fixture'
import { createLocalStore, type LocalStore } from '../apps/desktop/electron/local-store'
import { createDesktopAgentRuntime, type DesktopAgentRuntimeSnapshot } from '../apps/desktop/electron/agent-runtime-runtime'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createPostgresPoolClient } from '../apps/api/src/db/postgres-client'
import { readTeamMigrationCatalog, runTeamMigrations } from '../apps/api/src/db/migrate'
import type { TeamDbPoolClient } from '../apps/api/src/db/client'
import { createPostgresTeamRepository } from '../apps/api/src/repositories/postgres-team-repository'
import type { TeamRepository } from '../apps/api/src/repositories/team-repository'
import { resolveApiRouteRequest } from '../apps/api/src/server-request'
import type { ApiRouteResult } from '../apps/api/src/routes/team-routes'
import { createSessionCookie } from '../apps/api/src/auth/session-cookie'

const databaseUrl = process.env['DEVFLOW_TENANCY_TEST_DATABASE_URL']
const secret = 'organization-integration-test-only-secret'
const schema = `tenancy_${randomUUID().replaceAll('-', '')}`
const config = (connectionString: string) => ({ connectionString, applicationName: 'devflow-tenancy-test', statementTimeoutMs: 5_000 })

describe.skipIf(!databaseUrl)('multi-organization public API with real Postgres', () => {
  let admin: TeamDbPoolClient
  let db: TeamDbPoolClient
  let repository: TeamRepository
  let ownerCookie: string
  let teamBId: string
  let bCookie: string
  let bProjectId: string
  const cookieFrom = (result: ApiRouteResult | null) => {
    const value = result?.headers?.['set-cookie']
    return (Array.isArray(value) ? value[0]! : value!)?.split(';')[0]!
  }
  const request = (method: string, pathname: string, cookie = ownerCookie, body?: unknown) => resolveApiRouteRequest({
    method, pathname: pathname.split('?')[0]!, searchParams: new URLSearchParams(pathname.split('?')[1]), headers: { cookie, 'content-type': 'application/json', origin: 'http://localhost:4311' }, body,
  }, { repository, sessionSecret: secret, multiOrganizationEnabled: true, postAuthRedirectUrl: 'http://localhost:4311' })
  const bearer = (method: string, pathname: string, token: string, body?: unknown) => resolveApiRouteRequest({ method, pathname, headers: { authorization: `Bearer ${token}` }, body }, { repository, sessionSecret: secret })
  const loginAccount = (providerAccountId: string) => resolveApiRouteRequest({
    method: 'GET', pathname: '/api/auth/github/callback', headers: { cookie: 'devflow_oauth_state=test-state' },
    searchParams: new URLSearchParams({ state: 'test-state', code: 'test-verified' }),
  }, { repository, sessionSecret: secret, multiOrganizationEnabled: true,
    githubOAuth: { createAuthorizationUrl: () => '', exchangeCodeForProfile: async () => ({ providerAccountId, name: `User ${providerAccountId}` }) } })

  beforeAll(async () => {
    admin = createPostgresPoolClient(config(databaseUrl!))
    await admin.query(`CREATE SCHEMA ${schema}`)
    const scoped = new URL(databaseUrl!)
    scoped.searchParams.set('options', `-c search_path=${schema}`)
    db = createPostgresPoolClient(config(scoped.toString()))
    const migrations = await readTeamMigrationCatalog()
    await runTeamMigrations(db, migrations.filter(m => m.version <= 28))
    await db.query("INSERT INTO organizations (id, name, slug) VALUES ('org-legacy', 'Legacy team', 'legacy')")
    await db.query("INSERT INTO users (id, organization_id, name, role, avatar_initials, focus) VALUES ('legacy-owner', 'org-legacy', 'Owner A', 'owner', 'OA', '')")
    await db.query("INSERT INTO auth_accounts (id, user_id, provider, provider_account_id) VALUES ('acct-github-1001', 'legacy-owner', 'github', '1001')")
    const legacyCookie = createSessionCookie({ authAccountId: 'acct-github-1001' }, secret).split(';')[0]!
    await runTeamMigrations(db, migrations)
    repository = createPostgresTeamRepository(db, { multiOrganizationEnabled: true })
    const login = await resolveApiRouteRequest({
      method: 'GET', pathname: '/api/auth/github/callback',
      headers: { cookie: 'devflow_oauth_state=test-state' },
      searchParams: new URLSearchParams({ state: 'test-state', code: 'verified-by-test-oauth-client' }),
    }, {
      repository, sessionSecret: secret, multiOrganizationEnabled: true,
      githubOAuth: { createAuthorizationUrl: () => '', exchangeCodeForProfile: async () => ({ providerAccountId: '1001', name: 'Owner A', username: 'owner-a' }) },
    })
    expect(login?.status).toBe(302)
    ownerCookie = legacyCookie
    expect(await repository.resolveBrowserSession('acct-github-1001')).toMatchObject({ organizationId: 'org-legacy', userId: 'legacy-owner', role: 'owner' })
  }, 30_000)

  afterAll(async () => {
    await db?.close()
    if (admin) { await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.close() }
  })

  it('retains legacy single-team GitHub access until the operator explicitly enables independent organizations', async () => {
    const created = await request('POST', '/api/team/projects', ownerCookie, { name: 'Legacy authorization', slug: 'legacy-authorization', description: 'Compatibility check', repository: 'example/todo' })
    expect(created?.status).toBe(201)
    const projectId = (created!.body as { id: string }).id
    try {
      const session = (await repository.resolveBrowserSession('acct-github-1001'))!
      const principal = { session, authentication: { kind: 'session_cookie' as const, tokenRecordId: null } }
      const target = { projectId, installationId: '123', repositoryId: '456' }
      expect(await createPostgresTeamRepository(db).authorizeGitHubRepository!(target, principal)).toBe(true)
      expect(await repository.authorizeGitHubRepository!(target, principal)).toBe(false)
      const configured = createPostgresTeamRepository(db, { githubRepositoryAssignments: [{ organizationId: 'org-legacy', installationId: '123', repositoryId: '456' }] })
      expect(await configured.authorizeGitHubRepository!(target, principal)).toBe(true)
      expect(await configured.authorizeGitHubRepository!({ ...target, repositoryId: '789' }, principal)).toBe(false)
    } finally { await db.query('DELETE FROM projects WHERE id = $1', [projectId]) }
  })

  it('creates and switches independent organizations while a legacy cookie keeps its original scope', async () => {
    const initial = await request('GET', '/api/organizations')
    expect(initial?.status).toBe(200)
    const created = await request('POST', '/api/organizations', ownerCookie, { name: 'Team B', slug: 'team-b' })
    expect(created?.status).toBe(201)
    const teamB = created!.body as { id: string }
    teamBId = teamB.id
    const selected = await request('POST', `/api/organizations/${teamB.id}/select`)
    expect(selected?.status).toBe(200)
    bCookie = cookieFrom(selected)
    const project = { name: 'Shared name', slug: 'shared', description: 'Tenant isolation test', repository: 'example/todo' }
    const aProject = await request('POST', '/api/team/projects', ownerCookie, project)
    const bProject = await request('POST', '/api/team/projects', bCookie, project)
    expect(aProject?.status).toBe(201)
    expect(bProject?.status).toBe(201)
    const aId = (aProject!.body as { id: string }).id
    const bId = (bProject!.body as { id: string }).id
    bProjectId = bId
    expect(aId).not.toBe(bId)
    const overviewA = await request('GET', '/api/team/overview')
    const overviewB = await request('GET', '/api/team/overview', bCookie)
    expect((overviewA!.body as { projects: { id: string }[] }).projects.map(p => p.id)).toEqual([aId])
    expect((overviewB!.body as { projects: { id: string }[] }).projects.map(p => p.id)).toEqual([bId])
    const crossPair = await request('POST', `/api/team/projects/${bId}/pairing-codes`)
    expect([403, 404]).toContain(crossPair?.status)
    expect((await request('POST', '/api/organizations/missing/select'))?.status).toBe(404)
  })

  it('archives only its organization, revokes desktop credentials, and protects the last owner', async () => {
    const pairing = await request('POST', `/api/team/projects/${bProjectId}/pairing-codes`, bCookie)
    expect(pairing?.status).toBe(201)
    const exchange = await request('POST', '/api/desktop/pairing/exchange', '', { code: (pairing!.body as { code: string }).code })
    expect(exchange?.status).toBe(201)
    const token = (exchange!.body as { token: string }).token
    const browserSession = await request('GET', '/api/auth/session', bCookie)
    const ownerId = (browserSession!.body as { user: { id: string } }).user.id
    expect((await request('PUT', `/api/organizations/${teamBId}/members/${ownerId}`, bCookie, { role: 'member', status: 'active', projects: [] }))?.status).toBe(409)
    const archived = await request('PUT', `/api/organizations/${teamBId}`, bCookie, { name: 'Archived B', status: 'archived' })
    expect(archived?.status).toBe(200)
    expect((await request('GET', '/api/team/overview', bCookie))?.status).toBe(403)
    expect((await request('GET', '/api/team/overview'))?.status).toBe(200)
    const oldToken = await resolveApiRouteRequest({ method: 'GET', pathname: '/api/team/overview', headers: { authorization: `Bearer ${token}` } }, { repository, sessionSecret: secret })
    expect(oldToken?.status).toBe(401)
    expect((await request('PUT', `/api/organizations/${teamBId}`, bCookie, { name: 'Team B', status: 'active' }))?.status).toBe(200)
    expect((await request('GET', '/api/team/overview', bCookie))?.status).toBe(200)
  })

  it('admits another verified GitHub account without joining any existing organization', async () => {
    const secondLogin = await loginAccount('2002')
    expect(secondLogin?.status).toBe(302)
    const secondCookie = cookieFrom(secondLogin)
    const secondOverview = await request('GET', '/api/team/overview', secondCookie)
    expect((secondOverview!.body as { projects: unknown[] }).projects).toEqual([])
    expect((await request('POST', `/api/organizations/${teamBId}/select`, secondCookie))?.status).toBe(404)
    expect((await request('GET', `/api/organizations/${teamBId}/members`, secondCookie))?.status).toBe(403)
    const singleTeamRepository = createPostgresTeamRepository(db)
    expect((await singleTeamRepository.resolveOrBootstrapGitHubIdentity({ providerAccountId: '3003', name: 'Not admitted' })).status).toBe('blocked')
  })

  it('binds one-use invitations to the verified account and keeps roles local to each organization', async () => {
    const invitation = await request('POST', `/api/organizations/${teamBId}/invitations`, bCookie, {
      providerAccountId: '2002', role: 'member', status: 'active', projects: [{ projectId: bProjectId, role: 'member' }],
    })
    expect(invitation?.status).toBe(201)
    const token = (invitation!.body as { token: string }).token
    expect((await request('POST', '/api/organizations/invitations/accept', ownerCookie, { token }))?.status).toBe(403)
    const secondCookie = cookieFrom(await loginAccount('2002'))
    expect((await request('POST', '/api/organizations/invitations/accept', secondCookie, { token }))?.status).toBe(200)
    expect((await request('POST', '/api/organizations/invitations/accept', secondCookie, { token }))?.status).toBe(404)
    const memberCookie = cookieFrom(await request('POST', `/api/organizations/${teamBId}/select`, secondCookie))
    const memberSession = await request('GET', '/api/auth/session', memberCookie)
    const memberId = (memberSession!.body as { user: { id: string; role: string } }).user.id
    expect((memberSession!.body as { user: { role: string } }).user.role).toBe('member')
    expect((await request('POST', '/api/team/projects', memberCookie, { name: 'Forbidden', slug: 'forbidden', description: 'Must fail', repository: 'example/todo' }))?.status).toBe(403)
    expect((await request('GET', '/api/auth/session', secondCookie))!.body).toMatchObject({ user: { role: 'owner' } })
    expect((await request('PUT', `/api/organizations/${teamBId}/members/${memberId}`, bCookie, { role: 'member', status: 'disabled', projects: [] }))?.status).toBe(200)
    expect((await request('GET', '/api/team/overview', memberCookie))?.status).toBe(401)
    expect((await request('GET', '/api/team/overview', secondCookie))?.status).toBe(200)
  })

  it('rejects browser cross-origin and non-JSON organization mutations', async () => {
    const base = { method: 'POST', pathname: '/api/organizations', body: { name: 'Attack', slug: 'attack' } }
    const options = { repository, sessionSecret: secret, multiOrganizationEnabled: true, postAuthRedirectUrl: 'http://localhost:4311' }
    expect((await resolveApiRouteRequest({ ...base, headers: { cookie: ownerCookie, origin: 'https://unrelated.invalid', 'content-type': 'application/json' } }, options))?.status).toBe(403)
    expect((await resolveApiRouteRequest({ ...base, headers: { cookie: ownerCookie, 'content-type': 'text/plain' } }, options))?.status).toBe(415)
    expect((await resolveApiRouteRequest({ ...base, headers: { cookie: ownerCookie, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' } }, options))?.status).toBe(403)
  })

  it('keeps budgets and provider credentials independent even when an owner supplies another project ID', async () => {
    const policy = { projectId: bProjectId, enabled: true, monthlyLimitUsd: 20, warningThresholdUsd: 10 }
    expect((await request('PUT', '/api/runtime/budget-policy', bCookie, policy))?.status).toBe(200)
    expect((await request('PUT', '/api/runtime/budget-policy', ownerCookie, { ...policy, monthlyLimitUsd: 999 }))?.status).toBe(403)
    expect((await request('GET', `/api/runtime/budget-policy?projectId=${bProjectId}`, bCookie))?.body).toMatchObject({ policy: { monthlyLimitUsd: 20 } })
    expect((await request('GET', `/api/runtime/budget-policy?projectId=${bProjectId}`))?.body).toEqual({ policy: null })
    const bSession = await repository.resolveBrowserSession('acct-github-1001', teamBId)
    const aSession = await repository.resolveBrowserSession('acct-github-1001')
    const metadata = { providerId: 'test-provider', name: 'B Provider', model: 'test', baseUrl: 'https://example.invalid', maskedCredential: '***B', updatedAt: new Date().toISOString() }
    await repository.saveAgentProviderCredential(metadata, 'test-only-encrypted-value', bSession!)
    expect(await repository.getAgentProviderCredential(metadata.providerId, aSession!)).toBeNull()
    expect((await request('GET', '/api/agent/providers'))?.body).not.toEqual(expect.objectContaining({ providers: expect.arrayContaining([expect.objectContaining({ name: 'B Provider' })]) }))
    const approval = { projectId: bProjectId, requestedBy: bSession!.userId, providerId: metadata.providerId, maxAdditionalCostUsd: 5, reason: 'Cross tenant must fail', expiresAt: new Date(Date.now() + 60_000).toISOString() }
    expect((await request('POST', '/api/runtime/budget-approvals', ownerCookie, approval))?.status).toBe(403)
  })

  it('rejects revoked or expired invitations and foreign project grants without exposing invitation secrets', async () => {
    const input = { providerAccountId: '4004', role: 'member', status: 'active', projects: [] }
    const aProjects = (await request('GET', '/api/team/overview'))!.body as { projects: { id: string }[] }
    expect((await request('POST', `/api/organizations/${teamBId}/invitations`, bCookie, { ...input, projects: [{ projectId: aProjects.projects[0]!.id, role: 'owner' }] }))?.status).toBe(400)
    const invite = (await request('POST', `/api/organizations/${teamBId}/invitations`, bCookie, input))!.body as { id: string; token: string }
    const cCookie = cookieFrom(await loginAccount('4004'))
    const listed = await request('GET', `/api/organizations/${teamBId}/invitations`, bCookie)
    expect(JSON.stringify(listed?.body)).not.toContain(invite.token.split('.')[1])
    expect(JSON.stringify(listed?.body)).not.toContain('token_hash')
    expect((await request('POST', `/api/organizations/${teamBId}/invitations/${invite.id}/revoke`, bCookie))?.status).toBe(200)
    expect((await request('POST', '/api/organizations/invitations/accept', cCookie, { token: invite.token }))?.status).toBe(404)
    const expiring = (await request('POST', `/api/organizations/${teamBId}/invitations`, bCookie, input))!.body as { id: string; token: string }
    await db.query("UPDATE organization_invitations SET expires_at = now() - interval '1 second' WHERE id = $1", [expiring.id])
    expect((await request('POST', '/api/organizations/invitations/accept', cCookie, { token: expiring.token }))?.status).toBe(404)
  })

  it('requires operator-assigned GitHub repositories per organization even after onboarding closes', async () => {
    const session = (await repository.resolveBrowserSession('acct-github-1001', teamBId))!
    const principal = { session, authentication: { kind: 'session_cookie' as const, tokenRecordId: null } }
    const input = { projectId: bProjectId, installationId: '123', repositoryId: '456' }
    expect(await repository.authorizeGitHubRepository!(input, principal)).toBe(false)
    const assigned = createPostgresTeamRepository(db, { githubRepositoryAssignments: [{ organizationId: teamBId, installationId: '123', repositoryId: '456' }] })
    expect(await assigned.authorizeGitHubRepository!(input, principal)).toBe(true)
    expect(await assigned.authorizeGitHubRepository!({ ...input, repositoryId: '789' }, principal)).toBe(false)
    expect(await assigned.authorizeGitHubRepository!(input, { ...principal, session: (await repository.resolveBrowserSession('acct-github-1001'))! })).toBe(false)
    const closed = createPostgresTeamRepository(db)
    expect(await closed.authorizeGitHubRepository!(input, principal)).toBe(false)
  })

  it.each(['receipts', 'inbox'])('revokes pending Gate commands when their requester is disabled, including %s', async operation => {
    const secondCookie = cookieFrom(await loginAccount('2002'))
    const members = (await request('GET', `/api/organizations/${teamBId}/members`, bCookie))!.body as { members: { userId: string; providerAccountId: string }[] }
    const memberId = members.members.find(m => m.providerAccountId === '2002')!.userId
    const memberAccess = { role: 'lead', status: 'active', projects: [{ projectId: bProjectId, role: 'lead' }] }
    expect((await request('PUT', `/api/organizations/${teamBId}/members/${memberId}`, bCookie, memberAccess))?.status).toBe(200)
    const leadCookie = cookieFrom(await request('POST', `/api/organizations/${teamBId}/select`, secondCookie))
    const pairing = await request('POST', `/api/team/projects/${bProjectId}/pairing-codes`, bCookie)
    const paired = await request('POST', '/api/desktop/pairing/exchange', '', { code: (pairing!.body as { code: string }).code })
    const token = (paired!.body as { token: string }).token
    const runId = `run-disabled-requester-${operation}`, nodeId = `${runId}-gate`
    const created = await request('POST', `/api/team/projects/${bProjectId}/work-requests`, bCookie, { projectId: bProjectId, title: 'Pending decision', request: 'Verify live requester authority.', idempotencyKey: runId, expiresAt: null })
    const workRequestId = (created!.body as { workRequest: { id: string } }).workRequest.id
    for (const [action, version] of [['claim', 1], ['materialized', 2]] as const) {
      expect((await bearer('POST', `/api/desktop/work-requests/${workRequestId}/${action}`, token, { workRequestId, expectedVersion: version, runId, idempotencyKey: `${runId}-${action}` }))?.status).toBe(200)
    }
    expect((await bearer('POST', '/api/sync/run-summary', token, {
      kind: 'run', runId, version: 3, projectId: bProjectId, title: 'Pending decision', status: 'paused_at_gate', currentNodeId: nodeId,
      currentNode: { id: nodeId, kind: 'gate', stage: 'design', status: 'blocked', requiredRole: 'lead' }, branchName: `ai/${operation}`, updatedAt: new Date().toISOString(),
    }))?.status).toBe(202)
    const evaluation = (await request('POST', '/api/enforcement/evaluate', leadCookie, { projectId: bProjectId, runId, nodeId }))!.body as { policyVersion: number; blockingReasons: { id: string }[] }
    const commandResult = await request('POST', `/api/team/projects/${bProjectId}/gate-commands`, leadCookie, {
      projectId: bProjectId, runId, nodeId, action: 'reject', reason: 'Test pending request revocation', expectedRunVersion: 3,
      expectedPolicyVersion: evaluation.policyVersion, expectedBlockerIds: evaluation.blockingReasons.map(r => r.id), idempotencyKey: `${runId}-command`,
    })
    expect(commandResult?.status, JSON.stringify(commandResult?.body)).toBe(201)
    const commandId = (commandResult!.body as { command: { id: string } }).command.id
    expect((await request('PUT', `/api/organizations/${teamBId}/members/${memberId}`, bCookie, { ...memberAccess, status: 'disabled' }))?.status).toBe(200)
    if (operation === 'receipts') {
      expect(await bearer('POST', `/api/desktop/gate-commands/${commandId}/receipts`, token, {})).toMatchObject({ status: 403, body: { outcomeCode: 'requester_revoked' } })
    }
    expect(await bearer('GET', `/api/desktop/projects/${bProjectId}/gate-commands/inbox`, token)).toMatchObject({ status: 200, body: { commands: [] } })
    expect(await db.query('SELECT outcome_code FROM gate_commands WHERE id = $1', [commandId])).toEqual([{ outcome_code: 'requester_revoked' }])
  })

  it('materializes and synchronizes two independent workflow projections with cookie and bearer scope enforced', async () => {
    const secondCookie = cookieFrom(await loginAccount('2002'))
    const aOverview = await request('GET', '/api/team/overview')
    const aProjectId = (aOverview!.body as { projects: { id: string }[] }).projects[0]!.id
    const secondProject = await request('POST', '/api/team/projects', secondCookie, { name: 'Independent team project', slug: 'shared', repository: 'example/todo', description: 'Independent scope' })
    expect(secondProject?.status).toBe(201)
    const secondProjectId = (secondProject!.body as { id: string }).id
    async function workflow(cookie: string, projectId: string, suffix: string) {
      const pairing = await request('POST', `/api/team/projects/${projectId}/pairing-codes`, cookie)
      expect(pairing?.status).toBe(201)
      const paired = await request('POST', '/api/desktop/pairing/exchange', '', { code: (pairing!.body as { code: string }).code })
      const token = (paired!.body as { token: string }).token
      const created = await request('POST', `/api/team/projects/${projectId}/work-requests`, cookie, { projectId, title: `Tenant ${suffix}`, request: 'Add filtering to todo', idempotencyKey: `create-${suffix}`, expiresAt: null })
      expect(created?.status).toBe(201)
      const workRequest = (created!.body as { workRequest: { id: string } }).workRequest
      const runId = `run-tenant-${suffix}`
      for (const [action, version] of [['claim', 1], ['materialized', 2]] as const) {
        expect((await bearer('POST', `/api/desktop/work-requests/${workRequest.id}/${action}`, token, { workRequestId: workRequest.id, expectedVersion: version, runId, idempotencyKey: `${action}-${suffix}` }))?.status).toBe(200)
      }
      let version = 3
      for (const stage of ['clarify', 'design', 'build', 'test', 'pr', 'accept'] as const) {
        const nodeId = `${runId}-${stage}`
        const synced = await bearer('POST', '/api/sync/run-summary', token, {
          kind: 'run', runId, version: version++, projectId, title: `Tenant ${suffix}`, status: ({ clarify: 'clarifying', design: 'designing', build: 'building', test: 'testing', pr: 'building', accept: 'completed' } as const)[stage],
          currentNodeId: nodeId, currentNode: { id: nodeId, stage, kind: stage === 'test' ? 'test' : stage === 'pr' ? 'pr' : stage === 'accept' ? 'acceptance' : 'task', status: 'success' },
          branchName: `ai/tenant-${suffix}`, updatedAt: new Date(Date.now() + version * 1_000).toISOString(),
        })
        expect(synced?.status, `sync ${stage}: ${JSON.stringify(synced?.body)}`).toBe(202)
      }
      return { projectId, runId, token, workRequestId: workRequest.id }
    }
    const [a, c] = await Promise.all([workflow(ownerCookie, aProjectId, 'a'), workflow(secondCookie, secondProjectId, 'c')])
    for (const [own, other, cookie] of [[a, c, ownerCookie], [c, a, secondCookie]] as const) {
      const runs = await bearer('GET', '/api/runs', own.token)
      expect((runs!.body as { runs: { id: string }[] }).runs.map(r => r.id)).toEqual([own.runId])
      // Collection reads deliberately return no records for an inaccessible scope.
      expect(await request('GET', `/api/team/projects/${other.projectId}/work-requests`, cookie)).toMatchObject({ status: 200, body: { workRequests: [] } })
      expect([403, 404]).toContain((await bearer('POST', `/api/desktop/work-requests/${other.workRequestId}/claim`, own.token, { workRequestId: other.workRequestId, expectedVersion: 3, runId: other.runId, idempotencyKey: `cross-${own.runId}` }))?.status)
      const audit = await request('GET', `/api/organizations/${teamBId}/audit`, secondCookie)
      expect(audit?.status).toBe(403)
    }
  })

  it('keeps two API-paired Desktop runtimes isolated through cancellation, restart and retry', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'devflow-organizations-'))
    const stores: LocalStore[] = []
    const now = new Date().toISOString()
    const command = (state: DesktopAgentRuntimeSnapshot) => ({ runtimeId: state.runtime.id, runId: state.runtime.authority.runId, localProjectId: state.runtime.scope.localProjectId, expectedVersion: state.runtime.version, expectedCheckpointVersion: state.runtime.checkpointVersion })
    async function desktop(cookie: string, suffix: string) {
      const overview = (await request('GET', '/api/team/overview', cookie))!.body as { projects: { id: string }[] }
      const projectId = overview.projects[0]!.id
      const issued = (await request('POST', `/api/team/projects/${projectId}/pairing-codes`, cookie))!.body as { code: string }
      const exchange = (await request('POST', '/api/desktop/pairing/exchange', '', { code: issued.code }))!.body as DesktopPairingExchangeResult
      const { token: _token, ...credential } = exchange
      const dbPath = path.join(root, suffix, 'devflow.sqlite')
      const store = await createLocalStore({ dbPath }); stores.push(store)
      // Deliberately identical local IDs in separate profiles: organization authority
      // comes from the verified pairing, never from a renderer-provided label.
      const localProjectId = 'local-todo'
      await store.upsertProject({ id: localProjectId, name: 'Todo', path: path.join(root, suffix), packageManager: 'unknown', testCommand: '', detectedTestCommand: '', createdAt: now, updatedAt: now })
      await store.saveDesktopPairingCredential({ ...credential, localProjectId }, 'test-only-encrypted-token')
      const created = createWorkflowRunFromRequest({ runId: `run-desktop-${suffix}`, title: 'Independent task', request: `Only tenant ${suffix}`, projectId: localProjectId, creatorId: credential.userId, branchName: `ai/${suffix}`, now })
      await store.saveRun(created.run)
      for (const artifact of created.artifacts) await store.saveArtifact(artifact)
      const executor = vi.fn(async () => ({ resultDigest: suffix.repeat(64), evaluationSummary: `Test adapter for ${suffix}` }))
      const runtime = createDesktopAgentRuntime({ store, executeFakeAction: executor })
      const started = await runtime.start({ runId: created.run.id, nodeId: created.run.currentNodeId, localProjectId })
      expect(started.runtime.scope).toMatchObject({ organizationId: credential.organizationId, projectId, userId: credential.userId, sessionId: credential.tokenId })
      return { store, dbPath, runtime, started, executor, created, credential }
    }
    try {
      const [a, b] = await Promise.all([desktop(ownerCookie, 'a'), desktop(cookieFrom(await loginAccount('2002')), 'b')])
      expect(a.started.runtime.scope.organizationId).not.toBe(b.started.runtime.scope.organizationId)
      await expect(b.runtime.cancel(command(a.started))).rejects.toThrow()
      const cancelled = await a.runtime.cancel(command(a.started))
      expect(cancelled.runtime.stopReason).toBe('cancelled')
      const resumed = await b.runtime.advance(command(b.started))
      const waiting = await b.runtime.advance(command(resumed))
      expect(waiting.runtime.status).toBe('waiting_action')
      b.store.close(); stores.splice(stores.indexOf(b.store), 1)
      const reopened = await createLocalStore({ dbPath: b.dbPath }); stores.push(reopened)
      const restored = createDesktopAgentRuntime({ store: reopened, executeFakeAction: b.executor })
      const recovered = await restored.recover()
      expect(recovered).toHaveLength(1)
      expect(recovered[0]!.runtime).toMatchObject({ stopReason: 'success', scope: b.started.runtime.scope })
      expect(await reopened.getRun(a.created.run.id)).toBeNull()
      expect(await a.store.getRun(b.created.run.id)).toBeNull()
      const retried = await a.runtime.start({ runId: a.created.run.id, nodeId: a.created.run.currentNodeId, localProjectId: 'local-todo' })
      expect(retried.runtime.id).not.toBe(cancelled.runtime.id)
      expect(retried.runtime.scope).toEqual(a.started.runtime.scope)
      expect((await reopened.listAgentRuntimeEvents(b.started.runtime.id)).map(event => event.type)).not.toContain('runtime_cancelled')
      await a.store.saveDesktopPairingCredential({ ...b.credential, localProjectId: 'local-todo' }, 'test-only-other-organization-token')
      await expect(a.runtime.advance(command(retried))).rejects.toThrow()
      expect(a.executor).not.toHaveBeenCalled()
    } finally {
      stores.forEach(store => store.close())
      await rm(root, { recursive: true, force: true })
    }
  })

  it('completes two parallel standard Runs with real Git, tests and SQLite, then restores only each tenant’s data', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'devflow-tenant-workflows-'))
    const secondCookie = cookieFrom(await loginAccount('2002'))
    async function workflow(cookie: string, suffix: string) {
      const project = await request('POST', '/api/team/projects', cookie, { name: 'Full workflow', slug: 'full-workflow', repository: 'example/tenancy-test', description: 'Deterministic provider integration' })
      expect(project?.status).toBe(201)
      const projectId = (project!.body as { id: string }).id
      const issued = (await request('POST', `/api/team/projects/${projectId}/pairing-codes`, cookie))!.body as { code: string }
      const exchange = (await request('POST', '/api/desktop/pairing/exchange', '', { code: issued.code }))!.body as DesktopPairingExchangeResult
      const { token, ...credential } = exchange
      const runId = `run-complete-${suffix}`
      const created = await request('POST', `/api/team/projects/${projectId}/work-requests`, cookie, { projectId, title: `Complete ${suffix}`, request: 'Exercise a full isolated workflow', idempotencyKey: `complete-${suffix}`, expiresAt: null })
      const workRequestId = (created!.body as { workRequest: { id: string } }).workRequest.id
      for (const [action, version] of [['claim', 1], ['materialized', 2]] as const) {
        expect((await bearer('POST', `/api/desktop/work-requests/${workRequestId}/${action}`, token, { workRequestId, expectedVersion: version, runId, idempotencyKey: `${action}-${runId}` }))?.status).toBe(200)
      }
      const versions: number[] = []
      const result = await completeOrganizationWorkflow({ root: path.join(root, suffix), runId, pairing: { ...credential, localProjectId: 'local-full-workflow' }, onTransition: async run => {
        const summary = createRemoteRunSummary({ ...run, projectId })
        const response = await bearer('POST', '/api/sync/run-summary', token, summary)
        expect(response?.status, JSON.stringify(response?.body)).toBe(202)
        versions.push(run.version)
      } })
      const evidenceSummary = createRemoteTestEvidenceSummary({ ...result.evidence, projectId })
      expect((await bearer('POST', '/api/sync/test-evidence-summary', token, evidenceSummary))?.status).toBe(202)
      const nodeId = result.completed.currentNodeId
      const review = { id: `review-${runId}`, runId, nodeId, projectId, runtime: 'electron', providerId: 'test-review', model: 'test',
        conclusion: `Only ${runId}`, summary: 'Deterministic review', riskCount: 0, missingEvidenceCount: 0, advisoryLevel: 'info',
        blocksApproval: false, confidence: 1, redacted: true, createdAt: result.completed.updatedAt }
      expect((await bearer('POST', '/api/sync/agent-review-summary', token, review))?.status).toBe(202)
      // Populate legacy Team artifact and cost rows so read-isolation checks are
      // non-vacuous. Full local artifact bodies are not uploaded by current sync.
      const storedNode = toTeamStoredNodeId(runId, nodeId)
      await db.query(`INSERT INTO artifacts (id, run_id, node_id, kind, title, summary, content, updated_at)
        VALUES ($1, $2, $3, 'acceptance', 'Legacy artifact', $4, $4, $5)`, [`legacy-${runId}`, runId, storedNode, `Private fixture ${runId}`, result.completed.updatedAt])
      await db.query(`INSERT INTO token_usage (id, run_id, node_id, user_id, project_id, provider, model, input_tokens, output_tokens, cost_usd, timestamp)
        VALUES ($1, $2, $3, $4, $5, 'local', 'test', 10, 5, 0.125, $6)`, [`cost-${runId}`, runId, storedNode, credential.userId, projectId, result.completed.updatedAt])
      expect(result.completed).toMatchObject({ status: 'completed', version: 11 })
      expect(result.completed.nodes.every(node => node.status === 'success')).toBe(true)
      expect(versions).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
      expect(result.sourceStatus).toBe('')
      expect(result.marker).toContain(runId)
      return { ...result, projectId, runId, token, credential, review }
    }
    try {
      const [a, b] = await Promise.all([workflow(ownerCookie, 'a'), workflow(secondCookie, 'b')])
      expect(a.credential.organizationId).not.toBe(b.credential.organizationId)
      expect(a.credential.userId).not.toBe(b.credential.userId)
      for (const [own, other] of [[a, b], [b, a]] as const) {
        const runs = (await bearer('GET', '/api/runs', own.token))!.body as { runs: { id: string; status: string }[]; artifacts: { id: string }[] }
        expect(runs.runs).toEqual([expect.objectContaining({ id: own.runId, status: 'completed' })])
        expect(runs.artifacts.map(a => a.id)).toEqual([`legacy-${own.runId}`])
        const overview = (await bearer('GET', '/api/team/overview', own.token))!.body as { projectCost: { key: string; costUsd: number }[]; agentReviews: { id: string }[] }
        expect(overview.projectCost).toEqual([expect.objectContaining({ key: own.projectId, costUsd: 0.125 })])
        expect(overview.agentReviews.map(review => review.id)).toEqual([own.review.id])
        expect(JSON.stringify(overview)).not.toContain(other.runId)
        expect((await bearer('DELETE', `/api/runs/${other.runId}`, own.token))?.status).toBe(404)
        expect((await bearer('POST', '/api/sync/agent-review-summary', own.token, other.review))?.status).toBe(403)
        const reopened = await createLocalStore({ dbPath: own.dbPath })
        try {
          expect(await reopened.getRun(own.runId)).toMatchObject({ status: 'completed', version: 11 })
          expect(await reopened.getRun(other.runId)).toBeNull()
          expect((await reopened.listArtifacts(own.runId)).map(a => a.kind)).toEqual(expect.arrayContaining(['raw_request', 'clarification', 'design', 'test_report', 'pr', 'acceptance']))
          expect(await reopened.listTestEvidence(other.runId)).toEqual([])
          expect((await reopened.listTestEvidence(own.runId))[0]).toMatchObject({ status: 'passed', exitCode: 0 })
          expect(await reopened.listCodingPermissionRequests()).toEqual([expect.objectContaining({ id: own.permissionId, status: 'approved' })])
          expect(JSON.stringify(await reopened.listArtifacts(own.runId))).not.toContain(other.runId)
          expect(own.marker).not.toContain(other.runId)
        } finally { reopened.close() }
        expect((await bearer('POST', '/api/sync/run-summary', own.token, createRemoteRunSummary({ ...other.completed, projectId: other.projectId })))?.status).toBe(403)
      }
    } finally { await rm(root, { recursive: true, force: true }) }
  }, 30_000)

  it('keeps existing teams usable after onboarding is disabled, including equal new project slugs', async () => {
    const disabledRepository = createPostgresTeamRepository(db)
    const disabled = (pathname: string, cookie: string, body?: unknown) => resolveApiRouteRequest({ method: 'POST', pathname, headers: { cookie, 'content-type': 'application/json' }, body }, { repository: disabledRepository, sessionSecret: secret, multiOrganizationEnabled: false })
    expect((await disabled('/api/organizations', ownerCookie, { name: 'No new org', slug: 'closed' }))?.status).toBe(403)
    expect((await disabled(`/api/organizations/${teamBId}/select`, ownerCookie))?.status).toBe(200)
    const project = { name: 'After onboarding closes', slug: 'closed-mode-project', description: 'Still an independent project', repository: 'example/todo' }
    const a = await disabled('/api/team/projects', ownerCookie, project)
    const b = await disabled('/api/team/projects', bCookie, project)
    expect(a?.status).toBe(201)
    expect(b?.status).toBe(201)
    expect((a!.body as { id: string }).id).not.toBe((b!.body as { id: string }).id)
  })
})
