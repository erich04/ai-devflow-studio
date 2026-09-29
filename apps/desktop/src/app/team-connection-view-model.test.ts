import { describe, expect, it } from 'vitest'
import type { DesktopPairingCredential, GitHubDeliveryIntent, RemoteSyncOperation } from '@ai-devflow/shared'
import { buildTeamConnectionView, deliveryIntentsRevokedByRepair } from './team-connection-view-model'

const pairingFor = (localProjectId: string, projectId = 'team-x'): DesktopPairingCredential => ({
  tokenId: 'token-1',
  organizationId: 'org-1',
  projectId,
  projectName: projectId === 'team-x' ? 'Team X' : 'Team Y',
  localProjectId,
  userId: 'u-1',
  userName: 'Ling',
  role: 'lead',
  authAccountId: 'acct-1',
  projectMemberships: [{ projectId, userId: 'u-1', role: 'lead' }],
  createdAt: '2026-09-28T00:00:00.000Z',
} as DesktopPairingCredential)

const operation = (overrides: Partial<RemoteSyncOperation>): RemoteSyncOperation => ({
  id: 'op-1',
  kind: 'run-summary',
  localProjectId: 'local-a',
  organizationId: null,
  teamProjectId: null,
  runId: 'run-1',
  entityId: 'run-1',
  idempotencyKey: 'key',
  status: 'terminal',
  generation: 1,
  attemptCount: 1,
  nextAttemptAt: null,
  leaseExpiresAt: null,
  lastAttemptAt: null,
  lastErrorCode: 'pairing_required',
  lastErrorMessage: null,
  recovery: 'none',
  completedAt: null,
  createdAt: '2026-09-28T00:00:00.000Z',
  updatedAt: '2026-09-28T00:00:00.000Z',
  ...overrides,
} as RemoteSyncOperation)

const base = { localProjectId: 'local-a', pairingExpired: false }

describe('team connection view (plan §6.5)', () => {
  it('never reports a failure for a local project that is not connected (D3)', () => {
    const view = buildTeamConnectionView({ ...base, pairing: null, operations: [operation({})] })
    expect(view).toMatchObject({ connection: 'local', summary: '本地项目', tone: 'neutral', uploadLine: '当前未启用团队上传。' })
    expect(view.records[0]).toMatchObject({ canRetry: false, reason: expect.stringContaining('连接团队后会自动尝试上传') })
    expect(JSON.stringify(view)).not.toContain('失败')
  })

  it('shows uploads in progress after connecting, without claiming success', () => {
    const view = buildTeamConnectionView({
      ...base,
      pairing: pairingFor('local-a'),
      operations: [operation({ status: 'sending', organizationId: 'org-1', teamProjectId: 'team-x', lastErrorCode: null })],
    })
    expect(view).toMatchObject({ connection: 'connected', summary: '正在上传 1 项', tone: 'progress' })
    expect(view.records.map((record) => record.statusLabel)).toEqual(['正在上传'])
  })

  it('does not call queued records "uploading" while no credential exists', () => {
    const view = buildTeamConnectionView({
      ...base,
      pairing: null,
      operations: [
        operation({ status: 'pending', lastErrorCode: null }),
        operation({ id: 'op-2', status: 'retry-scheduled', lastErrorCode: null, organizationId: 'org-1', teamProjectId: 'team-x' }),
      ],
    })
    expect(view.records.map((record) => record.statusLabel)).toEqual(['未上传', '未上传'])
    expect(view.records[1]!.reason).toBe('需要重新连接到 team-x 后才会上传。')
    expect(view.summary).toBe('1 条未上传')
    expect(view.tone).toBe('warning')
    expect(view.uploadLine).toBe('有 1 条记录未上传。')
  })

  it('offers team data updates only while connected', () => {
    const expired = buildTeamConnectionView({ ...base, pairing: pairingFor('local-a'), pairingExpired: true, operations: [] })
    expect(expired).toMatchObject({ connection: 'reconnect', dataLine: '重新连接后可以更新团队数据。' })
  })

  it('waits for the owning project when the credential belongs to another local project', () => {
    const view = buildTeamConnectionView({
      ...base,
      pairing: pairingFor('local-b'),
      operations: [operation({ lastErrorCode: 'scope_mismatch', organizationId: 'org-1', teamProjectId: 'team-x' })],
    })
    expect(view.connection).toBe('local')
    expect(view.records[0]).toMatchObject({ canRetry: false, reason: expect.stringContaining('重新连接到 team-x') })
  })

  it('asks to reconnect to the original target when no credential exists', () => {
    const view = buildTeamConnectionView({
      ...base,
      pairing: null,
      operations: [operation({ organizationId: 'org-1', teamProjectId: 'team-x' })],
    })
    expect(view.records[0]).toMatchObject({ canRetry: false, reason: '需要重新连接到 team-x，之后手动重试。' })
  })

  it('offers no retry when the original target can no longer be reached', () => {
    const view = buildTeamConnectionView({
      ...base,
      pairing: pairingFor('local-a', 'team-y'),
      operations: [operation({ lastErrorCode: 'scope_mismatch', organizationId: 'org-1', teamProjectId: 'team-x' })],
    })
    expect(view.records[0]).toMatchObject({ statusLabel: '无法上传', canRetry: false })
    expect(view.summary).toBe('1 条未上传')
  })

  it('requires reconnection after the server rejects the credential and offers no retry until then (X3)', () => {
    const rejected = operation({ lastErrorCode: 'unauthorized', organizationId: 'org-1', teamProjectId: 'team-x', lastAttemptAt: '2026-09-28T01:00:00.000Z' })
    const view = buildTeamConnectionView({ ...base, pairing: pairingFor('local-a'), operations: [rejected] })
    expect(view).toMatchObject({ connection: 'reconnect', summary: '需要重新连接', tone: 'warning' })
    expect(view.records[0]).toMatchObject({ canRetry: false, reason: '团队服务拒绝了当前凭据。重新连接后可以重试。' })

    // After re-pairing, the old failure no longer describes the connection and can be retried.
    const repaired = { ...pairingFor('local-a'), createdAt: '2026-09-28T02:00:00.000Z' }
    const after = buildTeamConnectionView({ ...base, pairing: repaired, operations: [rejected] })
    expect(after.connection).toBe('connected')
    expect(after.records[0]).toMatchObject({ canRetry: true, reason: '上次上传时凭据被拒绝；现在已重新连接，可以重试。' })
  })

  it('does not claim everything is synced before team data has been read', () => {
    const unread = buildTeamConnectionView({ ...base, pairing: pairingFor('local-a'), operations: [] })
    expect(unread.summary).toBe('已连接 · 团队数据未读取')
    expect(unread.dataLine).toBe('本次启动还没有读取团队数据。')
    const read = buildTeamConnectionView({ ...base, pairing: pairingFor('local-a'), operations: [], teamDataReadAt: '2026-09-28 10:00' })
    expect(read).toMatchObject({ summary: '已连接 · Team X', tone: 'ok' })
  })

  it('lists every in-flight delivery that re-pairing revokes, in any project (P1)', () => {
    const intent = (status: GitHubDeliveryIntent['status'], localProjectId: string) =>
      ({ id: `${status}-${localProjectId}`, status, localProjectId }) as GitHubDeliveryIntent
    const revoked = deliveryIntentsRevokedByRepair([
      intent('approval_required', 'local-a'),
      intent('creating_pr', 'local-b'),
      intent('completed', 'local-a'),
      intent('revoked', 'local-b'),
    ])
    expect(revoked.map((item) => item.id)).toEqual(['approval_required-local-a', 'creating_pr-local-b'])
  })
})
