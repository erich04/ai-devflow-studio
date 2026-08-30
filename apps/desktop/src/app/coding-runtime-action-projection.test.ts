import { describe, expect, it } from 'vitest'
import type {
  CodingAgentRun,
  CodingAgentRunStatus,
  CodingChangeSetPreview,
  CodingPermissionRequest,
  CodingRuntimeReadiness,
  ManagedCodingWorkspace,
  WorkflowNode,
} from '@ai-devflow/shared'
import { buildCodingRuntimeActionProjection } from './coding-runtime-action-projection'

const now = '2026-08-30T12:00:00.000Z'
const node: WorkflowNode = {
  id: 'node-build',
  stage: 'build',
  title: 'Implement locally',
  subtitle: 'Build',
  kind: 'task',
  status: 'running',
  ownerId: 'user-1',
  retryCount: 0,
  artifactIds: [],
}

function codingRun(status: CodingAgentRunStatus, overrides: Partial<CodingAgentRun> = {}): CodingAgentRun {
  return {
    id: `coding-${status}`,
    runId: 'run-1',
    nodeId: node.id,
    projectId: 'project-1',
    requestedBy: 'user-1',
    providerId: 'provider-1',
    engine: 'native',
    status,
    branchName: 'codex/run-1',
    userInstruction: 'Implement it',
    prompt: 'Implement it safely',
    summary: `${status} summary`,
    changedPaths: [],
    startedAt: '2026-08-30T11:00:00.000Z',
    redacted: true,
    ...overrides,
  }
}

function readiness(status: CodingRuntimeReadiness['status'] = 'ready'): CodingRuntimeReadiness {
  return {
    projectId: 'project-1',
    runId: 'run-1',
    nodeId: node.id,
    status,
    engine: 'native',
    executor: 'native-model',
    availability: status === 'ready' ? 'available' : 'unavailable',
    capabilities: [],
    providerRequirement: 'saved-provider',
    providerId: 'provider-1',
    checks: status === 'ready' ? [] : [{ code: 'provider_unavailable', status: 'blocked', message: 'Provider unavailable' }],
    evaluatedAt: now,
  }
}

function permission(overrides: Partial<CodingPermissionRequest> = {}): CodingPermissionRequest {
  return {
    id: 'permission-1',
    codingRunId: 'coding-waiting_permission',
    runId: 'run-1',
    nodeId: node.id,
    origin: 'coding_executor',
    permission: 'patch',
    title: 'Apply exact Change Set',
    changeSetId: 'change-set-1',
    changeSetDigest: 'digest-1',
    risk: 'warn',
    reasons: ['Review the exact diff.'],
    status: 'pending',
    requestedAt: '2026-08-30T11:59:00.000Z',
    expiresAt: '2026-08-30T12:05:00.000Z',
    ...overrides,
  }
}

function preview(overrides: Partial<CodingChangeSetPreview> = {}): CodingChangeSetPreview {
  return {
    stateVersion: 2,
    id: 'change-set-1',
    codingRunId: 'coding-waiting_permission',
    phase: 'initial',
    changedPaths: ['src/a.ts', 'src/b.ts'],
    unifiedDiff: 'diff --git a/src/a.ts b/src/a.ts\n+changed',
    changeSetDigest: 'digest-1',
    createdAt: '2026-08-30T11:59:00.000Z',
    expiresAt: '2026-08-30T12:05:00.000Z',
    ...overrides,
  }
}

function project(overrides: Partial<Parameters<typeof buildCodingRuntimeActionProjection>[0]> = {}) {
  return buildCodingRuntimeActionProjection({
    runId: 'run-1',
    nodeId: node.id,
    projectId: 'project-1',
    node,
    isSelectedCurrentNode: true,
    codingRuns: [],
    permissionRequests: [],
    workspaces: [],
    diffArtifacts: [],
    testEvidence: [],
    events: [],
    readiness: readiness(),
    isStartingCodingAgent: false,
    now,
    ...overrides,
  })
}

describe('buildCodingRuntimeActionProjection', () => {
  it('offers one new run only when the exact build scope is idle and ready', () => {
    const result = project()
    expect(result.phase).toBe('idle')
    expect(result.action).toMatchObject({ id: 'start', label: '启动 Coding Agent', createsNewRun: true, mayInvokeProvider: true })
  })

  it.each<CodingAgentRunStatus>([
    'queued', 'preparing', 'bootstrapping', 'running', 'applying', 'testing',
  ])('maps active %s to progress without a duplicate write action', (status) => {
    const result = project({ codingRuns: [codingRun(status)] })
    expect(result.action).toMatchObject({ id: 'view-progress', createsNewRun: false, mayInvokeProvider: false })
    expect(result.action.label).toBe(
      status === 'applying'
        ? '查看应用进度'
        : status === 'testing'
          ? '查看测试进度'
          : '查看运行进度',
    )
  })

  it('requires the exact unexpired Change Set preview before approval', () => {
    const run = codingRun('waiting_permission')
    const loading = project({ codingRuns: [run], permissionRequests: [permission()] })
    expect(loading.action.id).toBe('review-permission')
    expect(loading.permission).toMatchObject({ canApprove: false, staleReason: '精确 Change Set 尚未完成校验。' })

    const verified = project({ codingRuns: [run], permissionRequests: [permission()], changeSetPreview: preview() })
    expect(verified.action.label).toBe('审查并批准修改')
    expect(verified.permission).toMatchObject({
      canApprove: true,
      previewVerified: true,
      changedPaths: ['src/a.ts', 'src/b.ts'],
    })
  })

  it.each([
    ['expired request', { now: '2026-08-30T12:05:00.000Z' }],
    ['wrong digest', { changeSetPreview: preview({ changeSetDigest: 'wrong' }) }],
    ['wrong run', { changeSetPreview: preview({ codingRunId: 'other-run' }) }],
  ])('fails closed for a stale Change Set: %s', (_label, override) => {
    const result = project({
      codingRuns: [codingRun('waiting_permission')],
      permissionRequests: [permission()],
      changeSetPreview: preview(),
      ...override,
    })
    expect(result.permission?.canApprove).toBe(false)
    expect(result.permission?.staleReason).toBeTruthy()
    if (_label === 'wrong digest' || _label === 'wrong run') {
      expect(result.permission?.previewVerified).toBe(false)
      expect(result.permission?.changedPaths).toEqual([])
    }
  })

  it('selects by run, node and project and blocks a conflicting active project run', () => {
    const result = project({
      codingRuns: [
        codingRun('failed', { id: 'history' }),
        codingRun('running', { id: 'other', runId: 'run-2', nodeId: 'node-other' }),
      ],
    })
    expect(result.history.map((run) => run.id)).toEqual(['history'])
    expect(result.conflictingActiveRun?.id).toBe('other')
    expect(result.action.disabled).toBe(true)
  })

  it.each<CodingAgentRunStatus>(['failed', 'timed_out', 'interrupted', 'cancelled'])(
    'makes terminal %s an explicit new-run retry',
    (status) => {
      const result = project({ codingRuns: [codingRun(status)] })
      expect(result.action).toMatchObject({
        id: 'retry',
        createsNewRun: true,
        mayInvokeProvider: true,
        requiresConfirmation: true,
      })
      expect(result.action.summary).toContain('新的 token 与费用')
      expect(result.action.label).toBe(
        status === 'timed_out'
          ? '上次运行超时 · 重新运行 Coding Agent'
          : status === 'failed'
            ? '上次运行失败 · 重新运行 Coding Agent'
            : '上次运行已取消 · 重新运行 Coding Agent',
      )
    },
  )

  it('projects terminal evidence and refuses to open a deleted workspace', () => {
    const run = codingRun('failed', {
      managedWorkspaceId: 'workspace-1',
      diffArtifactId: 'diff-1',
      testEvidenceId: 'test-1',
      runtimeCostSummary: {
        id: 'usage-1', runId: 'run-1', nodeId: node.id, userId: 'user-1', projectId: 'project-1',
        provider: 'openai', providerId: 'provider-1', model: 'gpt-test', inputTokens: 120, outputTokens: 30,
        cacheReadTokens: 10, cacheMissTokens: 110, totalTokens: 150, cacheHitRate: 10 / 120,
        usageStatus: 'complete', costStatus: 'settled', phase: 'provider_settlement',
        costUsd: 0.012,
        pricingSnapshot: {
          providerId: 'provider-1', model: 'gpt-test', tier: 'off_peak', effectiveAt: now,
          source: 'https://pricing.example.test', sourceVersion: 'pricing-v1', currency: 'USD',
          unit: 'per_1m_tokens', cacheHitInputUsdPerMillion: 1, cacheMissInputUsdPerMillion: 2,
          outputUsdPerMillion: 3,
        },
        breakdown: { cacheHitInputUsd: 0.001, cacheMissInputUsd: 0.002, outputUsd: 0.009, totalUsd: 0.012 },
        timestamp: now, source: 'provider_reported', redacted: true,
      },
    })
    const workspace: ManagedCodingWorkspace = {
      id: 'workspace-1', projectId: 'project-1', codingRunId: run.id, sourcePath: '/repo', worktreePath: '/gone',
      branchName: run.branchName, baseBranch: 'main', createdAt: now, deletedAt: now, cleanupStatus: 'deleted',
    }
    const result = project({
      codingRuns: [run],
      workspaces: [workspace],
      diffArtifacts: [{
        id: 'diff-1', runId: 'run-1', nodeId: node.id, projectId: 'project-1', changedPaths: ['src/a.ts'],
        patch: 'diff --git a/src/a.ts b/src/a.ts\n+done', truncated: false, redacted: true, createdAt: now,
      }],
      events: [{
        id: 'event-1', codingRunId: run.id, runId: run.runId, nodeId: run.nodeId, sequence: 1,
        kind: 'test', message: 'Saved test failed.', timestamp: now, redacted: true,
      }],
      testEvidence: [{
        id: 'test-1', runId: 'run-1', nodeId: node.id, projectId: 'project-1', command: 'pnpm test', cwd: '/gone',
        status: 'failed', exitCode: 1, durationMs: 12, stdout: '', stderr: 'failed', summary: '1 failed', redacted: true, createdAt: now,
      }],
    })
    expect(result.terminal).toMatchObject({
      inputTokens: 120,
      outputTokens: 30,
      cacheReadTokens: 10,
      cacheMissTokens: 110,
      totalTokens: 150,
      usageStatus: 'complete',
      costStatus: 'settled',
      pricingTier: 'off_peak',
      pricingSourceVersion: 'pricing-v1',
      pricingSnapshot: expect.objectContaining({
        cacheHitInputUsdPerMillion: 1,
        cacheMissInputUsdPerMillion: 2,
        outputUsdPerMillion: 3,
      }),
      costUsd: 0.012,
      testStatus: 'failed',
      workspaceCleanupStatus: 'deleted',
      canOpenWorkspace: false,
      diffPatch: 'diff --git a/src/a.ts b/src/a.ts\n+done',
    })
    expect(result.terminal?.trace).toEqual([
      expect.objectContaining({ id: 'event-1', message: 'Saved test failed.' }),
    ])
  })

  it('keeps completed history read-only and removes start/retry', () => {
    const result = project({ codingRuns: [codingRun('completed')] })
    expect(result.action).toMatchObject({ id: 'view-result', createsNewRun: false, mayInvokeProvider: false })
  })

  it('routes blocked readiness to the existing runtime settings instead of inventing readiness', () => {
    const result = project({ readiness: readiness('blocked') })
    expect(result.action).toMatchObject({ id: 'configure', target: 'runtime-settings' })
    expect(result.action.summary).toBe('Provider unavailable')
  })
})
