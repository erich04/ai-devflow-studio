import { describe, expect, it } from 'vitest'
import { createWorkflowRunFromRequest, type WorkRequest } from '@ai-devflow/shared'
import { taskCenterRows } from './task-center'
const run = createWorkflowRunFromRequest({ runId: 'run', projectId: 'local', creatorId: 'user', title: '同名任务', request: '做这件事', branchName: 'task', now: '2026-10-10T00:00:00Z' }).run
const request: WorkRequest = { id: 'request', projectId: 'team', organizationId: 'org', title: run.title, request: run.request, version: 2, status: 'materialized', claim: { runId: run.id, claimedAt: run.createdAt, materializedAt: run.createdAt }, createdByUserId: 'user', expiresAt: null, createdAt: run.createdAt, updatedAt: run.updatedAt }
describe('task center authoritative identity and status', () => {
  it('merges only by claim.runId and never considers materialization or a PR draft completion', () => {
    const rows = taskCenterRows([run, { ...run, id: 'other' }], [request], 'member')
    expect(rows).toHaveLength(2)
    expect(rows.find(row => row.run?.id === 'run')?.request?.id).toBe('request')
    const beforeClaim = taskCenterRows([], [{ ...request, status: 'open', claim: null }])[0]!
    expect(rows.find(row => row.run?.id === 'run')?.id).toBe(beforeClaim.id)
    expect(rows.every(row => row.filter !== 'completed')).toBe(true)
  })
  it('keeps cancelled, missing local runs and pending claims distinct from completion', () => {
    expect(taskCenterRows([], [request], 'owner')[0]).toMatchObject({ status: '待同步本地任务', action: 'sync', filter: 'all' })
    expect(taskCenterRows([], [{ ...request, status: 'claim_pending' }], 'owner')[0]).toMatchObject({ status: '领取待恢复', action: 'claim' })
    expect(taskCenterRows([], [{ ...request, status: 'cancelled' }], 'owner')[0]).toMatchObject({ status: '已取消', action: 'preview' })
  })
  it('labels a real acceptance completion and gates requiring a different role correctly', () => {
    const gate = run.nodes.find(node => node.kind === 'gate')!
    const paused = { ...run, currentNodeId: gate.id, status: 'paused_at_gate' as const, nodes: run.nodes.map(node => node.id === gate.id ? { ...node, status: 'running' as const, requiredRole: 'lead' as const } : node) }
    expect(taskCenterRows([paused], [], 'member')[0]?.filter).toBe('active')
    expect(taskCenterRows([paused], [], 'lead')[0]?.filter).toBe('attention')
    const completed = { ...run, status: 'completed' as const, nodes: run.nodes.map(node => ({ ...node, status: 'success' as const })) }
    expect(taskCenterRows([completed], [], 'member')[0]).toMatchObject({ filter: 'completed', action: 'delivery' })
  })
  it('shows current coding permissions to their requester and does not reuse an older step failure', () => {
    const build = run.nodes.find(node => node.stage === 'build')!
    const current = { ...run, currentNodeId: build.id, status: 'building' as const }
    const coding = { runId: run.id, nodeId: build.id, status: 'waiting_permission' as const, startedAt: run.createdAt, requestedBy: 'user' }
    expect(taskCenterRows([current], [], 'member', [coding], 'user')[0]).toMatchObject({ filter: 'attention', status: '等待工具权限确认' })
    expect(taskCenterRows([current], [], 'member', [coding], 'someone-else')[0]?.filter).toBe('active')
    expect(taskCenterRows([run], [], 'member', [coding], 'user')[0]?.filter).toBe('active')
    expect(taskCenterRows([{ ...current, status: 'failed' }], [], 'member')[0]?.status).toContain('执行失败')
  })
})
