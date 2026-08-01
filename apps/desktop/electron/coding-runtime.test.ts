import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentEvent,
  Artifact,
  BudgetGuardDecision,
  CodingAgentEvent,
  CodingAgentRun,
  CodingDiffArtifact,
  CodingPermissionDecision,
  CodingPermissionRequest,
  DependencyBootstrapEvidence,
  LocalProject,
  ManagedCodingWorkspace,
  RemediationPlan,
  RetryAttempt,
  TestEvidence,
  WorkflowRun,
} from '@ai-devflow/shared'
import { createFakeCodingEngineAdapter, type CodingEngineAdapter } from './coding-engine'
import { createCodingRuntime } from './coding-runtime'

const execFileAsync = promisify(execFile)
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
  tempDirs.length = 0
})

describe('CodingRuntime', () => {
  it('starts a fake coding run by creating a worktree and persisting the run bundle', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
    })
    const runtime = createCodingRuntime({
      store,
      engine: createFakeCodingEngineAdapter(),
      worktreeRoot: await tempDir('devflow-worktrees-'),
      idGenerator: fixedIds('coding-run-1'),
      now: fixedNow('2026-06-17T00:00:00.000Z'),
    })

    const result = await runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'fake-coding-engine',
      userInstruction: 'Add the marker file.',
    })

    expect(result.codingRun.status).toBe('waiting_permission')
    expect(store.workspaces).toHaveLength(1)
    expect(store.codingRuns).toEqual([result.codingRun])
    expect(store.codingEvents.map((event) => event.kind)).toEqual(['brief', 'permission'])
    expect(store.permissionRequests).toHaveLength(1)
    expect(await readFile(path.join(store.workspaces[0]!.worktreePath, 'package.json'), 'utf8')).toContain('fixture')
  })

  it('blocks a paid coding run when no authoritative budget guard is configured', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
    })
    const engine = createSpyCodingEngine('opencode-http')
    const createWorkspace = vi.fn(async () => {
      throw new Error('createWorkspace should not be called before a paid budget decision')
    })
    const runtime = createCodingRuntime({
      store,
      engine,
      createWorkspace,
      idGenerator: fixedIds('coding-run-budget-unavailable'),
      now: fixedNow('2026-07-31T00:00:00.000Z'),
    })

    const result = await runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'double',
      userInstruction: 'Use the paid runtime.',
    })

    expect(engine.ensure).not.toHaveBeenCalled()
    expect(engine.start).not.toHaveBeenCalled()
    expect(createWorkspace).not.toHaveBeenCalled()
    expect(result.codingRun).toMatchObject({
      status: 'failed',
      budgetDecision: {
        status: 'unavailable',
        blocksRun: true,
      },
    })
    expect(result.codingRun.summary).toContain('unavailable')
    expect(result.codingRun.summary).not.toContain('lead approval')
    expect(store.codingEvents).toEqual([
      expect.objectContaining({
        kind: 'error',
        redacted: true,
        metadata: expect.objectContaining({ budgetStatus: 'unavailable' }),
      }),
    ])
    expect(store.workspaces).toHaveLength(0)
    expect(result.state.managedCodingWorkspaces).toHaveLength(0)
  })

  it('rejects a second active coding run for the same local project', async () => {
    const repo = await gitRepo()
    const activeRun = codingRun({ projectId: 'project-1', status: 'waiting_permission' })
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
      codingRuns: [activeRun],
    })
    const runtime = createCodingRuntime({
      store,
      engine: createFakeCodingEngineAdapter(),
      worktreeRoot: await tempDir('devflow-worktrees-'),
      idGenerator: fixedIds('coding-run-2'),
      now: fixedNow('2026-06-17T00:00:00.000Z'),
    })

    await expect(
      runtime.runCodingAgent({
        runId: 'run-1',
        nodeId: 'node-build',
        projectId: 'project-1',
        requestedBy: 'user-1',
        providerId: 'fake-coding-engine',
        userInstruction: 'Do it.',
      }),
    ).rejects.toThrow(/already active/)
    expect(store.workspaces).toHaveLength(0)
  })

  it('rejects cross-project coding runs before engine, worktree, or persistence side effects', async () => {
    const repo = await gitRepo()
    const otherProject = {
      ...project(repo),
      id: 'project-2',
      name: 'Other fixture',
    }
    const store = new MemoryCodingStore({
      projects: [project(repo), otherProject],
      runs: [buildRun()],
    })
    const engine = createSpyCodingEngine('fake')
    const createWorkspace = vi.fn(async () => {
      throw new Error('createWorkspace should not be called')
    })
    const runtime = createCodingRuntime({
      store,
      engine,
      createWorkspace,
    })

    await expect(
      runtime.runCodingAgent({
        runId: 'run-1',
        nodeId: 'node-build',
        projectId: 'project-2',
        requestedBy: 'user-1',
        providerId: 'fake-coding-engine',
        userInstruction: 'Do not cross the project boundary.',
      }),
    ).rejects.toThrow('Coding workflow project mismatch')

    expect(engine.ensure).not.toHaveBeenCalled()
    expect(createWorkspace).not.toHaveBeenCalled()
    expect(store.codingRuns).toHaveLength(0)
    expect(store.workspaces).toHaveLength(0)
    expect(store.codingEvents).toHaveLength(0)
  })

  it('rejects historical build nodes before engine, worktree, or persistence side effects', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [
        buildRun({
          currentNodeId: 'node-build-current',
          nodes: [
            buildNode({ id: 'node-build-history', status: 'success' }),
            buildNode({ id: 'node-build-current', status: 'running' }),
          ],
        }),
      ],
    })
    const engine = createSpyCodingEngine('fake')
    const createWorkspace = vi.fn(async () => {
      throw new Error('createWorkspace should not be called')
    })
    const runtime = createCodingRuntime({
      store,
      engine,
      createWorkspace,
    })

    await expect(
      runtime.runCodingAgent({
        runId: 'run-1',
        nodeId: 'node-build-history',
        projectId: 'project-1',
        requestedBy: 'user-1',
        providerId: 'fake-coding-engine',
        userInstruction: 'Do not rerun a historical node.',
      }),
    ).rejects.toThrow('Coding Agent can only run on the current workflow node')

    expect(engine.ensure).not.toHaveBeenCalled()
    expect(createWorkspace).not.toHaveBeenCalled()
    expect(store.codingRuns).toHaveLength(0)
    expect(store.workspaces).toHaveLength(0)
  })

  it.each([
    {
      label: 'a pending build node',
      run: buildRun({ nodes: [buildNode({ status: 'pending' })] }),
      expectedError: 'Coding Agent build node must be running or failed',
    },
    {
      label: 'a completed workflow run',
      run: buildRun({ status: 'completed' }),
      expectedError: 'Coding Agent cannot run on a terminal workflow run',
    },
    {
      label: 'a cancelled workflow run',
      run: buildRun({ status: 'cancelled' }),
      expectedError: 'Coding Agent cannot run on a terminal workflow run',
    },
    {
      label: 'a run status that disagrees with its running build node',
      run: buildRun({ status: 'testing' }),
      expectedError: 'Coding workflow invariant violation',
    },
    {
      label: 'a run status that disagrees with its failed build node',
      run: buildRun({
        status: 'building',
        nodes: [buildNode({ status: 'failed' })],
      }),
      expectedError: 'Coding workflow invariant violation',
    },
  ])('rejects $label before engine, worktree, or persistence side effects', async ({ run, expectedError }) => {
    const store = new MemoryCodingStore({
      projects: [project('/tmp/repo')],
      runs: [run],
    })
    const engine = createSpyCodingEngine('fake')
    const createWorkspace = vi.fn(async () => {
      throw new Error('createWorkspace should not be called')
    })
    const runtime = createCodingRuntime({
      store,
      engine,
      createWorkspace,
    })

    await expect(
      runtime.runCodingAgent({
        runId: 'run-1',
        nodeId: 'node-build',
        projectId: 'project-1',
        requestedBy: 'user-1',
        providerId: 'fake-coding-engine',
        userInstruction: 'Respect workflow state.',
      }),
    ).rejects.toThrow(expectedError)

    expect(engine.ensure).not.toHaveBeenCalled()
    expect(createWorkspace).not.toHaveBeenCalled()
    expect(store.codingRuns).toHaveLength(0)
    expect(store.workspaces).toHaveLength(0)
    expect(store.codingEvents).toHaveLength(0)
  })

  it('allows a failed current build node to start a controlled coding retry', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [
        buildRun({
          status: 'failed',
          nodes: [buildNode({ status: 'failed' })],
        }),
      ],
    })
    const runtime = createCodingRuntime({
      store,
      engine: createFakeCodingEngineAdapter(),
      worktreeRoot: await tempDir('devflow-worktrees-'),
      idGenerator: fixedIds('coding-run-failed-build-retry'),
      now: fixedNow('2026-06-17T00:00:00.000Z'),
    })

    const result = await runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'fake-coding-engine',
      userInstruction: 'Retry the failed build.',
    })

    expect(result.codingRun).toMatchObject({
      id: 'coding-run-failed-build-retry',
      runId: 'run-1',
      nodeId: 'node-build',
      status: 'waiting_permission',
    })
  })

  it('blocks real provider coding runs before engine start when project budget requires lead approval', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
    })
    const engine = createSpyCodingEngine('opencode-http')
    const budgetGuard = vi.fn(async () => ({
      status: 'requires_lead_approval',
      blocksRun: true,
      currentSpendUsd: 0.95,
      projectedCostUsd: 0.2,
      limitUsd: 1,
      approvalRequiredRole: 'lead',
      reason: 'Project runtime budget would be exceeded.',
    } satisfies BudgetGuardDecision))
    const runtime = createCodingRuntime({
      store,
      engine,
      worktreeRoot: await tempDir('devflow-worktrees-'),
      idGenerator: fixedIds('coding-run-budget'),
      now: fixedNow('2026-06-20T00:00:00.000Z'),
      budgetGuard,
    })

    const result = await runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'opencode-http',
      userInstruction: 'Use the real runtime.',
    })

    expect(engine.ensure).not.toHaveBeenCalled()
    expect(engine.start).not.toHaveBeenCalled()
    expect(budgetGuard).toHaveBeenCalledWith(
      expect.objectContaining({
        engine: 'opencode-http',
        providerId: 'double',
        requestedBy: 'user-1',
        estimatedCost: expect.objectContaining({ costUsd: expect.any(Number), redacted: true }),
      }),
    )
    expect(result.codingRun.status).toBe('failed')
    expect(result.codingRun.providerId).toBe('double')
    expect(result.codingRun.summary).toContain('Runtime budget requires lead approval')
    expect(result.codingRun.summary).toContain('paid provider was not called')
    expect(store.workspaces).toHaveLength(0)
    expect(store.codingEvents.some((event) => event.kind === 'error' && event.message.includes('budget'))).toBe(true)
  })

  it('redacts an unavailable budget reason before persisting or publishing the blocked run', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
    })
    const engine = createSpyCodingEngine('opencode-http')
    const publishRunStatus = vi.fn()
    const runtime = createCodingRuntime({
      store,
      engine,
      publisher: {
        publishRunStatus,
        publishEvent: vi.fn(),
        publishPermission: vi.fn(),
      },
      createWorkspace: vi.fn(async () => {
        throw new Error('createWorkspace should not be called after a rejecting budget decision')
      }),
      budgetGuard: vi.fn(async () => ({
        status: 'unavailable',
        blocksRun: true,
        currentSpendUsd: 0,
        projectedCostUsd: 0.2,
        reason: 'API_KEY=sk-private-value failed at /Users/operator/private/config.json',
      } satisfies BudgetGuardDecision)),
      idGenerator: fixedIds('coding-run-budget-redaction'),
      now: fixedNow('2026-07-31T00:00:00.000Z'),
    })

    const result = await runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'double',
      userInstruction: 'Use the paid runtime.',
    })

    const persisted = JSON.stringify({
      run: store.codingRuns[0],
      events: store.codingEvents,
      published: publishRunStatus.mock.calls,
      result: result.codingRun,
    })
    expect(persisted).not.toContain('sk-private-value')
    expect(persisted).not.toContain('/Users/operator/private/config.json')
    expect(persisted).toContain('[REDACTED:')
    expect(engine.ensure).not.toHaveBeenCalled()
    expect(engine.start).not.toHaveBeenCalled()
    expect(store.workspaces).toHaveLength(0)
  })

  it('passes runtime budget approval ids to the guard before starting the real engine', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
    })
    const engine = createSpyCodingEngine('opencode-http')
    vi.mocked(engine.start).mockResolvedValueOnce({
      codingRun: codingRun({
        id: 'coding-run-approved-budget',
        projectId: 'project-1',
        providerId: 'double',
        engine: 'opencode-http',
        status: 'waiting_permission',
        budgetDecision: {
          status: 'approved_over_budget',
          blocksRun: false,
          currentSpendUsd: 0.95,
          projectedCostUsd: 0.2,
          limitUsd: 1,
          approvalId: 'runtime-budget-approval-project-1',
          reason: 'Lead approval allows this runtime run to continue beyond the project budget.',
        },
      }),
      events: [],
      permissionRequest: {
        id: 'permission-approved-budget',
        codingRunId: 'coding-run-approved-budget',
        runId: 'run-1',
        nodeId: 'node-build',
        permission: 'bash',
        title: 'opencode requested bash permission',
        command: 'npm test',
        risk: 'warn',
        reasons: ['opencode requested shell access.'],
        status: 'pending',
        requestedAt: '2026-06-21T00:00:00.000Z',
        expiresAt: '2026-06-21T00:01:00.000Z',
      },
    })
    const budgetGuard = vi.fn(async () => ({
      status: 'approved_over_budget',
      blocksRun: false,
      currentSpendUsd: 0.95,
      projectedCostUsd: 0.2,
      limitUsd: 1,
      approvalId: 'runtime-budget-approval-project-1',
      reason: 'Lead approval allows this runtime run to continue beyond the project budget.',
    } satisfies BudgetGuardDecision))
    const runtime = createCodingRuntime({
      store,
      engine,
      worktreeRoot: await tempDir('devflow-worktrees-'),
      idGenerator: fixedIds('coding-run-approved-budget'),
      now: fixedNow('2026-06-21T00:00:00.000Z'),
      budgetGuard,
    })

    const result = await runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'double',
      runtimeBudgetApprovalId: 'runtime-budget-approval-project-1',
      userInstruction: 'Use the real runtime after lead approval.',
    })

    expect(budgetGuard).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalId: 'runtime-budget-approval-project-1',
      }),
    )
    expect(engine.start).toHaveBeenCalledOnce()
    expect(result.codingRun.budgetDecision?.status).toBe('approved_over_budget')
    expect(result.codingRun.budgetDecision?.approvalId).toBe('runtime-budget-approval-project-1')
  })

  it('rejects coding runs from nodes that are not build task nodes', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [
        buildRun({
          id: 'run-gate',
          status: 'paused_at_gate',
          currentNodeId: 'node-build-gate',
          nodes: [buildNode({ id: 'node-build-gate', stage: 'build', kind: 'gate' })],
        }),
        buildRun({
          id: 'run-design',
          status: 'designing',
          currentNodeId: 'node-design-task',
          nodes: [buildNode({ id: 'node-design-task', stage: 'design', kind: 'task' })],
        }),
      ],
    })
    const runtime = createCodingRuntime({
      store,
      engine: createFakeCodingEngineAdapter(),
      worktreeRoot: await tempDir('devflow-worktrees-'),
      idGenerator: fixedIds('coding-run-1'),
      now: fixedNow('2026-06-17T00:00:00.000Z'),
    })

    await expect(
      runtime.runCodingAgent({
        runId: 'run-gate',
        nodeId: 'node-build-gate',
        projectId: 'project-1',
        requestedBy: 'user-1',
        providerId: 'fake-coding-engine',
        userInstruction: 'Do it.',
      }),
    ).rejects.toThrow('Coding Agent can only run from a build task node')
    await expect(
      runtime.runCodingAgent({
        runId: 'run-design',
        nodeId: 'node-design-task',
        projectId: 'project-1',
        requestedBy: 'user-1',
        providerId: 'fake-coding-engine',
        userInstruction: 'Do it.',
      }),
    ).rejects.toThrow('Coding Agent can only run from a build task node')
    expect(store.workspaces).toHaveLength(0)
  })

  it('assembles the coding prompt from persisted DevFlow context', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
      artifacts: [designArtifact()],
      events: [approvalEvent()],
      testEvidence: [passingEvidence(repo)],
    })
    const runtime = createCodingRuntime({
      store,
      engine: createFakeCodingEngineAdapter(),
      worktreeRoot: await tempDir('devflow-worktrees-'),
      idGenerator: fixedIds('coding-run-1'),
      now: fixedNow('2026-06-17T00:00:00.000Z'),
    })

    const result = await runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'fake-coding-engine',
      userInstruction: 'Use the approved health endpoint design.',
    })

    expect(result.codingRun.prompt).toContain('Health endpoint design')
    expect(result.codingRun.prompt).toContain('No knowledge references are attached.')
    expect(result.codingRun.prompt).not.toContain('knowledge-doc-api-health')
    expect(result.codingRun.prompt).toContain('Gate Decisions')
    expect(result.codingRun.prompt).toContain('approved by devflow: Lead Gate 已通过：方案评审 Gate')
    expect(result.codingRun.prompt).toContain('Existing Test Evidence')
    expect(result.codingRun.prompt).toContain('npm test [passed]: Existing local tests passed.')
  })

  it('starts a human-approved retry attempt with remediation context in the coding brief', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
      artifacts: [designArtifact()],
      testEvidence: [passingEvidence(repo)],
    })
    const runtime = createCodingRuntime({
      store,
      engine: createFakeCodingEngineAdapter(),
      worktreeRoot: await tempDir('devflow-worktrees-'),
      idGenerator: fixedIds('retry-1', 'coding-run-1'),
      now: fixedNow('2026-06-18T12:00:00.000Z'),
    })

    const result = await runtime.startRetryAttempt({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'fake-coding-engine',
      remediationPlan: remediationPlan(),
      candidateIds: ['candidate-api'],
      userInstruction: 'Retry only the API contract remediation.',
    })

    expect(store.retryAttempts[0]).toMatchObject({
      id: 'retry-1',
      remediationPlanId: 'remediation-run-1-node-build-7',
      candidateIds: ['candidate-api'],
      status: 'started',
      codingRunId: result.codingRun.id,
    })
    expect(store.artifacts.some((artifact) => artifact.title === 'Policy remediation retry attempt')).toBe(true)
    expect(store.events.some((event) => event.message.includes('Retry Attempt approved'))).toBe(true)
    expect(result.codingRun.prompt).toContain('Remediation Plan')
    expect(result.codingRun.prompt).toContain('Retry Attempt: retry-1 [approved]')
    expect(result.codingRun.prompt).toContain('Fix API contract violation')
    expect(result.codingRun.prompt).toContain('Policy reason: governance_check:api_contract:violated:check-api')
  })

  it('rejects an invalid retry workflow context before persisting retry evidence', async () => {
    const store = new MemoryCodingStore({
      projects: [project('/tmp/repo')],
      runs: [
        buildRun({
          currentNodeId: 'node-build-current',
          nodes: [
            buildNode({ id: 'node-build-history', status: 'failed' }),
            buildNode({ id: 'node-build-current', status: 'running' }),
          ],
        }),
      ],
    })
    const engine = createSpyCodingEngine('fake')
    const createWorkspace = vi.fn(async () => {
      throw new Error('createWorkspace should not be called')
    })
    const runtime = createCodingRuntime({
      store,
      engine,
      createWorkspace,
    })

    await expect(
      runtime.startRetryAttempt({
        runId: 'run-1',
        nodeId: 'node-build-history',
        projectId: 'project-1',
        requestedBy: 'user-1',
        providerId: 'fake-coding-engine',
        remediationPlan: remediationPlan(),
        candidateIds: ['candidate-api'],
        userInstruction: 'Do not retry a historical node.',
      }),
    ).rejects.toThrow('Coding Agent can only run on the current workflow node')

    expect(engine.ensure).not.toHaveBeenCalled()
    expect(createWorkspace).not.toHaveBeenCalled()
    expect(store.retryAttempts).toHaveLength(0)
    expect(store.artifacts).toHaveLength(0)
    expect(store.events).toHaveLength(0)
    expect(store.codingRuns).toHaveLength(0)
  })

  it('publishes coding run, event, and permission updates as they are persisted', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
    })
    const publisher = {
      publishRunStatus: vi.fn(),
      publishEvent: vi.fn(),
      publishPermission: vi.fn(),
    }
    const runtime = createCodingRuntime({
      store,
      engine: createFakeCodingEngineAdapter(),
      publisher,
      worktreeRoot: await tempDir('devflow-worktrees-'),
      idGenerator: fixedIds('coding-run-1'),
      now: fixedNow('2026-06-17T00:00:00.000Z'),
    })

    const result = await runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'fake-coding-engine',
      userInstruction: 'Add the marker file.',
    })

    expect(publisher.publishRunStatus).toHaveBeenCalledWith(result.codingRun)
    expect(publisher.publishEvent).toHaveBeenCalledTimes(2)
    expect(publisher.publishPermission).toHaveBeenCalledWith(store.permissionRequests[0])
  })

  it('recursively redacts Coding Agent event messages and metadata before storage and publish', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
    })
    const baseEngine = createFakeCodingEngineAdapter()
    const engine: CodingEngineAdapter = {
      ...baseEngine,
      async start(input) {
        const bundle = await baseEngine.start(input)
        return {
          ...bundle,
          events: bundle.events.map((event, index) =>
            index === 0
              ? {
                  ...event,
                  message: `Opened error:${repo}/private/report.json with Authorization: Bearer opaque-runtime-secret`,
                  metadata: {
                    token: 'opaque-structured-runtime-token',
                    Authorization: 'Bearer opaque-structured-runtime-bearer',
                    nested: {
                      password: 'opaque-structured-runtime-password',
                      filePath: `${repo}/private/report.json`,
                      output: [
                        `--token opaque-runtime-secret`,
                        { route: '/v1/users' },
                      ],
                    },
                  },
                  redacted: false,
                }
              : event,
          ),
        }
      },
    }
    const publisher = {
      publishRunStatus: vi.fn(),
      publishEvent: vi.fn(),
      publishPermission: vi.fn(),
    }
    const runtime = createCodingRuntime({
      store,
      engine,
      publisher,
      worktreeRoot: await tempDir('devflow-worktrees-'),
      idGenerator: fixedIds('coding-run-redaction'),
      now: fixedNow('2026-06-17T00:00:00.000Z'),
    })

    await runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'fake-coding-engine',
      userInstruction: 'Add the marker file.',
    })

    const stored = store.codingEvents[0]
    const published = publisher.publishEvent.mock.calls[0]?.[0]
    expect(JSON.stringify(stored)).not.toContain(repo)
    expect(JSON.stringify(stored)).not.toContain('opaque-runtime-secret')
    expect(JSON.stringify(stored)).not.toContain('opaque-structured-runtime-token')
    expect(JSON.stringify(stored)).not.toContain('opaque-structured-runtime-bearer')
    expect(JSON.stringify(stored)).not.toContain('opaque-structured-runtime-password')
    expect(JSON.stringify(stored)).toContain('/v1/users')
    expect(stored?.redacted).toBe(true)
    expect(published).toEqual(stored)
  })

  it('expires unanswered permission requests through the scheduler callback', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
    })
    let expire: (() => Promise<void>) | undefined
    const runtime = createCodingRuntime({
      store,
      engine: createFakeCodingEngineAdapter(),
      schedulePermissionTimeout: (_request, callback) => {
        expire = callback
      },
      worktreeRoot: await tempDir('devflow-worktrees-'),
      idGenerator: fixedIds('coding-run-1', 'decision-1', 'event-1'),
      now: sequenceNow('2026-06-17T00:00:00.000Z', '2026-06-17T00:01:00.000Z'),
    })

    const started = await runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'fake-coding-engine',
      userInstruction: 'Add the marker file.',
    })
    await expire?.()

    expect(store.permissionRequests[0]).toMatchObject({ status: 'expired' })
    expect(store.permissionDecisions[0]).toMatchObject({
      codingRunId: started.codingRun.id,
      decision: 'expired',
      decidedBy: 'devflow-timeout',
    })
    expect(store.codingRuns.at(-1)?.status).toBe('timed_out')
    expect(store.codingEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'tool_result',
          metadata: expect.objectContaining({
            permissionRequestId: store.permissionRequests[0]!.id,
            decision: 'expired',
            status: 'expired',
            outputSummary: 'DevFlow relay expired edit permission; coding run timed out.',
          }),
        }),
      ]),
    )
  })

  it('times out an active coding run through the run timeout scheduler', async () => {
    const repo = await gitRepo()
    const workspace = managedWorkspace({ sourcePath: repo, worktreePath: '/tmp/worktree' })
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
      workspaces: [workspace],
    })
    let expireRun: (() => Promise<void>) | undefined
    const engine = createFakeCodingEngineAdapter()
    const cancel = vi.spyOn(engine, 'cancel')
    const runtime = createCodingRuntime({
      store,
      engine,
      scheduleRunTimeout: (_codingRun, callback) => {
        expireRun = callback
      },
      worktreeRoot: await tempDir('devflow-worktrees-'),
      deleteWorkspace: async (input) => ({
        ...input,
        deletedAt: '2026-06-17T00:02:00.000Z',
        cleanupStatus: 'deleted',
      }),
      idGenerator: fixedIds('coding-run-1', 'event-1', 'decision-1', 'event-2'),
      now: sequenceNow('2026-06-17T00:00:00.000Z', '2026-06-17T00:02:00.000Z'),
    })

    const started = await runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'fake-coding-engine',
      userInstruction: 'Add the marker file.',
    })
    await expireRun?.()

    expect(cancel).toHaveBeenCalledWith({ codingRun: started.codingRun })
    expect(store.permissionRequests[0]).toMatchObject({ status: 'expired' })
    expect(store.codingRuns.at(-1)).toMatchObject({
      id: started.codingRun.id,
      status: 'timed_out',
    })
    expect(store.codingEvents.map((event) => event.kind)).toContain('cleanup')
  })

  it('archives terminal Coding evidence without directly uploading a summary after approval', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
    })
    const runTestCommand = vi.fn(async ({ cwd }: { cwd: string }) => ({
      status: 'failed' as const,
      exitCode: 1,
      durationMs: 77,
      stdout: `coding tests failed in ${cwd}`,
      stderr: 'API_TOKEN=super-secret-token',
      redacted: false,
      summary: `Coding worktree tests failed in ${cwd}.`,
    }))
    const completeWorkflowBuild = vi.fn(async (input) => {
      expect(store.codingRuns.find((candidate) => candidate.id === input.codingRunId)?.status).toBe(
        'completed',
      )
      expect(store.diffArtifacts.find((candidate) => candidate.id === input.diffId)).toBeDefined()
    })
    const legacyDirectUpload = vi.fn()
    const runtimeDependencies = {
      store,
      engine: createFakeCodingEngineAdapter(),
      remoteSync: { uploadCodingAgentSummary: legacyDirectUpload },
      completeWorkflowBuild,
      runTestCommand,
      worktreeRoot: await tempDir('devflow-worktrees-'),
      idGenerator: fixedIds('coding-run-1', 'decision-1', 'evidence-1'),
      now: sequenceNow('2026-06-17T00:00:00.000Z', '2026-06-17T00:01:00.000Z'),
    }
    const runtime = createCodingRuntime(runtimeDependencies)
    const started = await runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'fake-coding-engine',
      userInstruction: 'Add the marker file.',
    })

    await runtime.replyCodingPermission({
      requestId: store.permissionRequests[0]!.id,
      codingRunId: started.codingRun.id,
      decidedBy: 'user-1',
      decision: 'approved',
      comment: 'Approved from test.',
    })

    expect(store.permissionRequests[0]!.status).toBe('approved')
    expect(store.permissionDecisions).toHaveLength(1)
    expect(store.codingRuns.at(-1)?.status).toBe('completed')
    expect(store.bootstrapEvidence).toHaveLength(1)
    expect(store.diffArtifacts[0]?.changedPaths).toEqual(['devflow-fake-change.txt'])
    expect(runTestCommand).toHaveBeenCalledWith({
      command: expect.stringContaining('devflow-fake-change.txt'),
      cwd: store.workspaces[0]!.worktreePath,
      timeoutMs: 120_000,
    })
    expect(store.testEvidence[0]).toMatchObject({
      command: expect.stringContaining('devflow-fake-change.txt'),
      cwd: '<workspace>',
      status: 'failed',
      stdout: 'coding tests failed in <workspace>',
      stderr: '[REDACTED:env_secret_assignment]',
      summary: 'Coding worktree tests failed in <workspace>.',
      redacted: true,
    })
    expect(JSON.stringify(store.testEvidence[0])).not.toContain(store.workspaces[0]!.worktreePath)
    expect(JSON.stringify(store.testEvidence[0])).not.toContain('super-secret-token')
    expect(store.artifacts[0]).toMatchObject({ kind: 'test_report', title: 'Local test evidence' })
    expect(JSON.stringify(store.artifacts[0])).not.toContain(store.workspaces[0]!.worktreePath)
    expect(JSON.stringify(store.artifacts[0])).not.toContain('super-secret-token')
    expect(store.events[0]).toMatchObject({ kind: 'test_result', message: 'Coding worktree tests failed in <workspace>.' })
    expect(JSON.stringify(store.codingEvents)).not.toContain(store.workspaces[0]!.worktreePath)
    expect(JSON.stringify(store.codingEvents)).not.toContain('super-secret-token')
    expect(store.codingRuns.at(-1)?.testEvidenceId).toBe(store.testEvidence[0]?.id)
    expect(store.codingRuns.at(-1)?.summary).toContain(
      'Test evidence failed: Coding worktree tests failed in <workspace>.',
    )
    expect(store.codingEvents.map((event) => event.kind)).toContain('test')
    expect(legacyDirectUpload).not.toHaveBeenCalled()
    expect(completeWorkflowBuild).toHaveBeenCalledWith({
      runId: 'run-1',
      nodeId: 'node-build',
      codingRunId: started.codingRun.id,
      diffId: store.diffArtifacts[0]!.id,
      now: '2026-06-17T00:01:00.000Z',
    })
  })

  it('surfaces workflow build completion failures after preserving coding evidence', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
    })
    const completeWorkflowBuild = vi.fn(async () => {
      throw new Error('not_current_node')
    })
    const runtime = createCodingRuntime({
      store,
      engine: createFakeCodingEngineAdapter(),
      completeWorkflowBuild,
      runTestCommand: async () => ({
        status: 'passed',
        exitCode: 0,
        durationMs: 10,
        stdout: 'passed',
        stderr: '',
        redacted: true,
        summary: 'Coding worktree tests passed.',
      }),
      worktreeRoot: await tempDir('devflow-worktrees-'),
      idGenerator: fixedIds('coding-run-workflow-failure', 'decision-workflow-failure'),
      now: sequenceNow('2026-06-17T00:00:00.000Z', '2026-06-17T00:01:00.000Z'),
    })
    const started = await runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'fake-coding-engine',
      userInstruction: 'Add the marker file.',
    })

    await expect(
      runtime.replyCodingPermission({
        requestId: store.permissionRequests[0]!.id,
        codingRunId: started.codingRun.id,
        decidedBy: 'user-1',
        decision: 'approved',
        comment: 'Approved from test.',
      }),
    ).rejects.toThrow('Workflow build completion failed: not_current_node')

    expect(completeWorkflowBuild).toHaveBeenCalledOnce()
    expect(store.codingRuns.at(-1)?.status).toBe('completed')
    expect(store.diffArtifacts).toHaveLength(1)
  })

  it('persists the next live permission request without finalizing the run', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
    })
    const fakeEngine = createFakeCodingEngineAdapter()
    const nextPermission: CodingPermissionRequest = {
      id: 'permission-edit-2',
      codingRunId: 'coding-run-1',
      runId: 'run-1',
      nodeId: 'node-build',
      permission: 'edit',
      title: 'opencode requested edit permission',
      filePath: 'src/new-file.ts',
      risk: 'warn',
      reasons: ['opencode requested a second permission.'],
      status: 'pending',
      requestedAt: '2026-06-17T00:01:00.000Z',
      expiresAt: '2026-06-17T00:02:00.000Z',
    }
    const engineWithNextPermission: CodingEngineAdapter = {
      ...fakeEngine,
      engine: 'opencode-http',
      async approvePermission(input) {
        return {
          codingRun: {
            ...input.codingRun,
            engine: 'opencode-http',
            status: 'waiting_permission',
            summary: 'opencode is waiting for another DevFlow permission relay.',
          },
          events: [
            {
              id: 'coding-event-next-permission',
              codingRunId: input.codingRun.id,
              runId: input.codingRun.runId,
              nodeId: input.codingRun.nodeId,
              sequence: 3,
              kind: 'permission',
              message: 'opencode requested edit permission.',
              timestamp: '2026-06-17T00:01:00.000Z',
              metadata: { requestId: nextPermission.id },
              redacted: true,
            },
          ],
          permissionRequest: nextPermission,
        }
      },
    }
    const publisher = {
      publishRunStatus: vi.fn(),
      publishEvent: vi.fn(),
      publishPermission: vi.fn(),
    }
    const runTestCommand = vi.fn()
    const completeWorkflowBuild = vi.fn()
    const runtime = createCodingRuntime({
      store,
      engine: engineWithNextPermission,
      completeWorkflowBuild,
      publisher,
      runTestCommand,
      budgetGuard: createAllowingBudgetGuard(),
      worktreeRoot: await tempDir('devflow-worktrees-'),
      idGenerator: fixedIds('coding-run-1', 'decision-1'),
      now: sequenceNow('2026-06-17T00:00:00.000Z', '2026-06-17T00:01:00.000Z'),
    })
    const started = await runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'openai',
      userInstruction: 'Add the marker file.',
    })

    await runtime.replyCodingPermission({
      requestId: store.permissionRequests[0]!.id,
      codingRunId: started.codingRun.id,
      decidedBy: 'user-1',
      decision: 'approved',
      comment: 'Approved first permission.',
    })

    expect(store.permissionRequests).toHaveLength(2)
    expect(store.permissionRequests[0]!.status).toBe('approved')
    expect(store.permissionRequests[1]).toEqual(nextPermission)
    expect(store.codingRuns.at(-1)).toMatchObject({
      status: 'waiting_permission',
      summary: 'opencode is waiting for another DevFlow permission relay.',
    })
    expect(store.diffArtifacts).toHaveLength(0)
    expect(runTestCommand).not.toHaveBeenCalled()
    expect(completeWorkflowBuild).not.toHaveBeenCalled()
    expect(publisher.publishPermission).toHaveBeenCalledWith(nextPermission)
  })

  it('does not complete the workflow build when dependency bootstrap fails', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
    })
    const fakeEngine = createFakeCodingEngineAdapter()
    const engineWithFailedBootstrap: CodingEngineAdapter = {
      ...fakeEngine,
      async approvePermission(input) {
        const completed = await fakeEngine.approvePermission(input)
        if ('permissionRequest' in completed) {
          throw new Error(`Expected completed fake result, got permission ${completed.permissionRequest.id}`)
        }
        return {
          ...completed,
          bootstrapEvidence: {
            ...completed.bootstrapEvidence!,
            status: 'failed',
            exitCode: 1,
            stderr: 'dependency installation failed',
            summary: 'Dependency bootstrap failed.',
          },
        }
      },
    }
    const completeWorkflowBuild = vi.fn()
    const runTestCommand = vi.fn()
    const runtime = createCodingRuntime({
      store,
      engine: engineWithFailedBootstrap,
      completeWorkflowBuild,
      runTestCommand,
      worktreeRoot: await tempDir('devflow-worktrees-'),
      idGenerator: fixedIds('coding-run-bootstrap-failure', 'decision-bootstrap-failure'),
      now: sequenceNow('2026-06-17T00:00:00.000Z', '2026-06-17T00:01:00.000Z'),
    })
    const started = await runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'fake-coding-engine',
      userInstruction: 'Add the marker file.',
    })

    await runtime.replyCodingPermission({
      requestId: store.permissionRequests[0]!.id,
      codingRunId: started.codingRun.id,
      decidedBy: 'user-1',
      decision: 'approved',
      comment: 'Approved from test.',
    })

    expect(store.codingRuns.at(-1)?.status).toBe('failed')
    expect(store.diffArtifacts).toHaveLength(1)
    expect(runTestCommand).not.toHaveBeenCalled()
    expect(completeWorkflowBuild).not.toHaveBeenCalled()
  })

  it('runs runtime-owned dependency bootstrap before tests when the engine does not return bootstrap evidence', async () => {
    const repo = await gitRepo()
    const projectWithAbsoluteTestCommand = {
      ...project(repo),
      testCommand: `node ${repo}/test.js API_TOKEN=command-secret`,
    }
    const store = new MemoryCodingStore({
      projects: [projectWithAbsoluteTestCommand],
      runs: [buildRun()],
    })
    const fakeEngine = createFakeCodingEngineAdapter()
    const engineWithoutBootstrap: CodingEngineAdapter = {
      ...fakeEngine,
      engine: 'opencode-http',
      async approvePermission(input) {
        const completed = await fakeEngine.approvePermission(input)
        if ('permissionRequest' in completed) {
          throw new Error(`Expected completed fake result, got permission ${completed.permissionRequest.id}`)
        }
        return {
          codingRun: {
            ...completed.codingRun,
            engine: 'opencode-http',
          },
          events: completed.events,
          diff: completed.diff,
        }
      },
    }
    const runDependencyBootstrap = vi.fn(async (): Promise<DependencyBootstrapEvidence> => ({
      id: 'bootstrap-runtime-1',
      codingRunId: 'coding-run-1',
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      command: 'npm ci',
      status: 'passed',
      exitCode: 0,
      durationMs: 15,
      stdout: 'installed',
      stderr: '',
      summary: 'Runtime bootstrap passed.',
      dependencyHash: 'hash-runtime',
      redacted: false,
      createdAt: '2026-06-17T00:01:00.000Z',
    }))
    const runTestCommand = vi.fn(async () => ({
      status: 'passed' as const,
      exitCode: 0,
      durationMs: 77,
      stdout: 'coding tests passed',
      stderr: '',
      redacted: true,
      summary: 'Coding worktree tests passed.',
    }))
    const runtime = createCodingRuntime({
      store,
      engine: engineWithoutBootstrap,
      runDependencyBootstrap,
      runTestCommand,
      budgetGuard: createAllowingBudgetGuard(),
      worktreeRoot: await tempDir('devflow-worktrees-'),
      idGenerator: fixedIds('coding-run-1', 'decision-1', 'evidence-1'),
      now: sequenceNow('2026-06-17T00:00:00.000Z', '2026-06-17T00:01:00.000Z'),
    })
    const started = await runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'openai',
      userInstruction: 'Add the marker file.',
    })

    await runtime.replyCodingPermission({
      requestId: store.permissionRequests[0]!.id,
      codingRunId: started.codingRun.id,
      decidedBy: 'user-1',
      decision: 'approved',
      comment: 'Approved from test.',
    })

    expect(runDependencyBootstrap).toHaveBeenCalledWith({
      codingRun: expect.objectContaining({ id: 'coding-run-1' }),
      project: expect.objectContaining({ id: 'project-1' }),
      workspace: expect.objectContaining({ id: store.workspaces[0]!.id }),
      previousDependencyHash: undefined,
      timestamp: '2026-06-17T00:01:00.000Z',
    })
    expect(store.bootstrapEvidence[0]).toMatchObject({
      id: 'bootstrap-runtime-1',
      status: 'passed',
      command: 'npm ci',
    })
    expect(runTestCommand).toHaveBeenCalled()
    expect(runTestCommand).toHaveBeenCalledWith({
      command: projectWithAbsoluteTestCommand.testCommand,
      cwd: store.workspaces[0]!.worktreePath,
      timeoutMs: 120_000,
    })
    expect(JSON.stringify(store.codingEvents)).not.toContain(repo)
    expect(JSON.stringify(store.codingEvents)).not.toContain('command-secret')
    expect(JSON.stringify(store.testEvidence)).not.toContain(repo)
    expect(JSON.stringify(store.testEvidence)).not.toContain('command-secret')
    expect(store.codingRuns.at(-1)).toMatchObject({
      status: 'completed',
      bootstrapEvidenceId: 'bootstrap-runtime-1',
      testEvidenceId: store.testEvidence[0]?.id,
    })
  })

  it('interrupts the coding run without uploading a summary when permission is rejected', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
    })
    const completeWorkflowBuild = vi.fn()
    const runtime = createCodingRuntime({
      store,
      engine: createFakeCodingEngineAdapter(),
      completeWorkflowBuild,
      worktreeRoot: await tempDir('devflow-worktrees-'),
      idGenerator: fixedIds('coding-run-1', 'decision-1', 'event-1'),
      now: sequenceNow('2026-06-17T00:00:00.000Z', '2026-06-17T00:01:00.000Z'),
    })
    const started = await runtime.runCodingAgent({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'fake-coding-engine',
      userInstruction: 'Add the marker file.',
    })

    const request = await runtime.replyCodingPermission({
      requestId: store.permissionRequests[0]!.id,
      codingRunId: started.codingRun.id,
      decidedBy: 'user-1',
      decision: 'rejected',
      comment: 'No.',
    })

    expect(request.status).toBe('rejected')
    expect(store.codingRuns.at(-1)?.status).toBe('interrupted')
    expect(store.codingEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'tool_result',
          metadata: expect.objectContaining({
            permissionRequestId: store.permissionRequests[0]!.id,
            decision: 'rejected',
            status: 'rejected',
            outputSummary: 'DevFlow relay rejected edit permission; coding run interrupted.',
          }),
        }),
      ]),
    )
    expect(completeWorkflowBuild).not.toHaveBeenCalled()
  })

  it('cancels a running coding run, cleans up the worktree, and appends cleanup evidence', async () => {
    const workspace = managedWorkspace()
    const store = new MemoryCodingStore({
      projects: [project('/tmp/repo')],
      runs: [buildRun()],
      codingRuns: [codingRun({ id: 'coding-run-1', status: 'waiting_permission' })],
      workspaces: [workspace],
    })
    const deleteWorkspace = vi.fn(async () => ({
      ...workspace,
      deletedAt: '2026-06-17T00:03:00.000Z',
      cleanupStatus: 'deleted' as const,
    }))
    const completeWorkflowBuild = vi.fn()
    const runtime = createCodingRuntime({
      store,
      engine: createFakeCodingEngineAdapter(),
      completeWorkflowBuild,
      idGenerator: fixedIds('event-1'),
      now: fixedNow('2026-06-17T00:03:00.000Z'),
      deleteWorkspace,
    })

    const cancelled = await runtime.cancelCodingAgentRun({ codingRunId: 'coding-run-1' })

    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.completedAt).toBe('2026-06-17T00:03:00.000Z')
    expect(deleteWorkspace).toHaveBeenCalledWith(workspace)
    expect(store.workspaces.at(-1)).toMatchObject({ cleanupStatus: 'deleted' })
    expect(store.codingEvents.map((event) => event.kind)).toContain('cleanup')
    expect(store.codingEvents.at(-1)).toMatchObject({
      kind: 'status',
      message: 'Coding Agent run cancelled by user.',
    })
    expect(completeWorkflowBuild).not.toHaveBeenCalled()
  })
})

type StoreSeed = {
  projects?: LocalProject[]
  runs?: WorkflowRun[]
  artifacts?: Artifact[]
  events?: AgentEvent[]
  testEvidence?: TestEvidence[]
  codingRuns?: CodingAgentRun[]
  retryAttempts?: RetryAttempt[]
  workspaces?: ManagedCodingWorkspace[]
}

class MemoryCodingStore {
  readonly projects: LocalProject[]
  readonly runs: WorkflowRun[]
  readonly artifacts: Artifact[]
  readonly events: AgentEvent[]
  readonly testEvidence: TestEvidence[]
  readonly workspaces: ManagedCodingWorkspace[]
  readonly codingRuns: CodingAgentRun[]
  readonly codingEvents: CodingAgentEvent[] = []
  readonly permissionRequests: CodingPermissionRequest[] = []
  readonly permissionDecisions: CodingPermissionDecision[] = []
  readonly bootstrapEvidence: DependencyBootstrapEvidence[] = []
  readonly diffArtifacts: CodingDiffArtifact[] = []
  readonly retryAttempts: RetryAttempt[]

  constructor(seed: StoreSeed = {}) {
    this.projects = seed.projects ?? []
    this.runs = seed.runs ?? []
    this.artifacts = seed.artifacts ?? []
    this.events = seed.events ?? []
    this.testEvidence = seed.testEvidence ?? []
    this.codingRuns = seed.codingRuns ?? []
    this.retryAttempts = seed.retryAttempts ?? []
    this.workspaces = seed.workspaces ?? []
  }

  async listProjects() {
    return this.projects
  }

  async listRuns() {
    return this.runs
  }

  async listArtifacts(runId?: string) {
    return runId ? this.artifacts.filter((artifact) => artifact.runId === runId) : this.artifacts
  }

  async listEvents(runId?: string) {
    return runId ? this.events.filter((event) => event.runId === runId) : this.events
  }

  async listTestEvidence(runId?: string) {
    return runId ? this.testEvidence.filter((evidence) => evidence.runId === runId) : this.testEvidence
  }

  async saveRun(run: WorkflowRun) {
    upsert(this.runs, run)
  }

  async saveArtifact(artifact: Artifact) {
    upsert(this.artifacts, artifact)
  }

  async saveEvent(event: AgentEvent) {
    upsert(this.events, event)
  }

  async saveTestEvidence(evidence: TestEvidence) {
    upsert(this.testEvidence, evidence)
  }

  async listCodingAgentRuns(runId?: string) {
    return runId ? this.codingRuns.filter((run) => run.runId === runId) : this.codingRuns
  }

  async saveCodingAgentRun(run: CodingAgentRun) {
    upsert(this.codingRuns, run)
  }

  async saveCodingAgentEvent(event: CodingAgentEvent) {
    upsert(this.codingEvents, event)
  }

  async listCodingAgentEvents(codingRunId?: string) {
    return codingRunId
      ? this.codingEvents.filter((event) => event.codingRunId === codingRunId)
      : this.codingEvents
  }

  async saveCodingPermissionRequest(request: CodingPermissionRequest) {
    upsert(this.permissionRequests, request)
  }

  async listCodingPermissionRequests(codingRunId?: string) {
    return codingRunId
      ? this.permissionRequests.filter((request) => request.codingRunId === codingRunId)
      : this.permissionRequests
  }

  async saveCodingPermissionDecision(decision: CodingPermissionDecision) {
    upsert(this.permissionDecisions, decision)
  }

  async saveManagedCodingWorkspace(workspace: ManagedCodingWorkspace) {
    upsert(this.workspaces, workspace)
  }

  async listManagedCodingWorkspaces(projectId?: string) {
    return projectId ? this.workspaces.filter((workspace) => workspace.projectId === projectId) : this.workspaces
  }

  async saveDependencyBootstrapEvidence(evidence: DependencyBootstrapEvidence) {
    upsert(this.bootstrapEvidence, evidence)
  }

  async listDependencyBootstrapEvidence(codingRunId?: string) {
    return codingRunId
      ? this.bootstrapEvidence.filter((evidence) => evidence.codingRunId === codingRunId)
      : this.bootstrapEvidence
  }

  async saveCodingDiffArtifact(artifact: CodingDiffArtifact) {
    upsert(this.diffArtifacts, artifact)
  }

  async saveRetryAttempt(attempt: RetryAttempt) {
    upsert(this.retryAttempts, attempt)
    return attempt
  }

  async listRetryAttempts(runId?: string) {
    return runId ? this.retryAttempts.filter((attempt) => attempt.runId === runId) : this.retryAttempts
  }

  async loadState() {
    return {
      remoteSyncOperations: [],
      projects: this.projects,
      runs: this.runs,
      artifacts: this.artifacts,
      events: this.events,
      testEvidence: this.testEvidence,
      agentReviews: [],
      agentTraces: [],
      agentTokenUsage: [],
      codingRuns: this.codingRuns,
      codingEvents: this.codingEvents,
      codingPermissionRequests: this.permissionRequests,
      codingPermissionDecisions: this.permissionDecisions,
      managedCodingWorkspaces: this.workspaces,
      dependencyBootstrapEvidence: this.bootstrapEvidence,
      codingDiffArtifacts: this.diffArtifacts,
      retryAttempts: this.retryAttempts,
      settings: { themePreference: 'system' as const },
      mcpServers: [],
    }
  }
}

function upsert<T extends { id: string }>(items: T[], item: T) {
  const index = items.findIndex((candidate) => candidate.id === item.id)
  if (index >= 0) {
    items[index] = item
  } else {
    items.push(item)
  }
}

function createSpyCodingEngine(engine: CodingAgentRun['engine']): CodingEngineAdapter {
  return {
    engine,
    providerId: engine === 'fake' ? 'fake-coding-engine' : 'double',
    modelId: engine === 'fake' ? 'fake' : 'ark-code-latest',
    ensure: vi.fn(async (input) => ({
      projectId: input.project.id,
      engine,
      status: 'ready' as const,
    })),
    start: vi.fn(async () => {
      throw new Error('engine.start should not be called in this test')
    }),
    approvePermission: vi.fn(async () => {
      throw new Error('approvePermission should not be called in this test')
    }),
    cancel: vi.fn(async () => undefined),
  }
}

function createAllowingBudgetGuard() {
  return vi.fn(async () => ({
    status: 'allowed',
    blocksRun: false,
    currentSpendUsd: 0,
    projectedCostUsd: 0.01,
    limitUsd: 10,
    reason: 'Paid runtime is within the configured project budget.',
  } satisfies BudgetGuardDecision))
}

async function tempDir(prefix: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function gitRepo() {
  const repo = await tempDir('devflow-runtime-git-')
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { test: 'node --test' } }))
  await writeFile(path.join(repo, 'sum.js'), 'export function sum(a, b) { return a + b }\\n')
  await execFileAsync('git', ['init'], { cwd: repo })
  await execFileAsync('git', ['config', 'user.email', 'devflow@example.com'], { cwd: repo })
  await execFileAsync('git', ['config', 'user.name', 'DevFlow'], { cwd: repo })
  await execFileAsync('git', ['add', '.'], { cwd: repo })
  await execFileAsync('git', ['commit', '-m', 'fixture'], { cwd: repo })
  return repo
}

function project(repo: string): LocalProject {
  return {
    id: 'project-1',
    name: 'Fixture',
    path: repo,
    packageManager: 'npm',
    detectedTestCommand: 'npm test',
    testCommand: 'npm test',
    createdAt: '2026-06-17T00:00:00.000Z',
    updatedAt: '2026-06-17T00:00:00.000Z',
  }
}

function designArtifact(): Artifact {
  return {
    id: 'artifact-design',
    runId: 'run-1',
    nodeId: 'node-design',
    kind: 'design',
    title: 'Health endpoint design',
    summary: 'Follow the API health endpoint standard and include degraded dependency states.',
    content: 'The implementation must expose ok, degraded, and down states with test evidence.',
    redacted: false,
    updatedAt: '2026-06-17T00:00:00.000Z',
  }
}

function approvalEvent(): AgentEvent {
  return {
    id: 'event-approval-1',
    runId: 'run-1',
    nodeId: 'node-design-gate',
    sequence: 1,
    kind: 'approval',
    message: 'Lead Gate 已通过：方案评审 Gate',
    timestamp: '2026-06-17T00:00:00.000Z',
  }
}

function passingEvidence(repo: string): TestEvidence {
  return {
    id: 'evidence-1',
    runId: 'run-1',
    nodeId: 'node-build',
    projectId: 'project-1',
    command: 'npm test',
    cwd: repo,
    status: 'passed',
    exitCode: 0,
    durationMs: 42,
    stdout: 'ok',
    stderr: '',
    summary: 'Existing local tests passed.',
    redacted: true,
    createdAt: '2026-06-17T00:00:00.000Z',
  }
}

function buildRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: 'run-1',
    title: 'Implement build node',
    request: 'Use DevFlow context to implement a small change.',
    projectId: 'project-1',
    creatorId: 'user-1',
    status: 'building',
    currentNodeId: 'node-build',
    branchName: 'ai/build-node',
    createdAt: '2026-06-17T00:00:00.000Z',
    updatedAt: '2026-06-17T00:00:00.000Z',
    nodes: [buildNode()],
    edges: [],
    ...overrides,
  }
}

function buildNode(overrides: Partial<WorkflowRun['nodes'][number]> = {}): WorkflowRun['nodes'][number] {
  return {
    id: 'node-build',
    stage: 'build',
    title: 'Build implementation',
    subtitle: 'Make the requested code change.',
    kind: 'task',
    status: 'running',
    ownerId: 'user-1',
    retryCount: 0,
    artifactIds: [],
    ...overrides,
  }
}

function codingRun(overrides: Partial<CodingAgentRun> = {}): CodingAgentRun {
  return {
    id: 'coding-run-active',
    runId: 'run-1',
    nodeId: 'node-build',
    projectId: 'project-1',
    requestedBy: 'user-1',
    providerId: 'fake-coding-engine',
    engine: 'fake',
    status: 'waiting_permission',
    managedWorkspaceId: 'workspace-1',
    branchName: 'devflow/run-1-node-build-coding-run-active',
    userInstruction: 'Do it.',
    prompt: 'Prompt',
    summary: 'Waiting.',
    changedPaths: [],
    startedAt: '2026-06-17T00:00:00.000Z',
    redacted: true,
    ...overrides,
  }
}

function managedWorkspace(overrides: Partial<ManagedCodingWorkspace> = {}): ManagedCodingWorkspace {
  return {
    id: 'workspace-1',
    projectId: 'project-1',
    codingRunId: 'coding-run-1',
    sourcePath: '/tmp/repo',
    worktreePath: '/tmp/worktree',
    branchName: 'devflow/run-1-node-build-coding-run-1',
    baseBranch: 'main',
    createdAt: '2026-06-17T00:00:00.000Z',
    cleanupStatus: 'active',
    ...overrides,
  }
}

function remediationPlan(): RemediationPlan {
  return {
    id: 'remediation-run-1-node-build-7',
    runId: 'run-1',
    nodeId: 'node-build',
    status: 'blocked',
    policyVersion: 7,
    blockingReasonIds: ['governance_check:api_contract:violated:check-api'],
    warningReasonIds: [],
    remainingEvidenceGaps: ['API contract'],
    candidates: [
      {
        id: 'candidate-api',
        kind: 'fix_api_contract',
        title: 'Fix API contract violation',
        summary: 'Update implementation to match the API contract.',
        priority: 'high',
        sourceReasonIds: ['governance_check:api_contract:violated:check-api'],
        governanceCheckIds: ['check-api'],
        agentFindingIds: [],
        evidenceIds: [],
        knowledgeReferenceIds: [],
        requiresHumanApproval: true,
        eligibleForCodingRetry: true,
      },
    ],
    createdAt: '2026-06-18T12:00:00.000Z',
  }
}

function fixedIds(...ids: string[]) {
  let index = 0
  return () => ids[index++] ?? `id-${index}`
}

function fixedNow(value: string) {
  return () => value
}

function sequenceNow(...values: string[]) {
  let index = 0
  return () => values[index++] ?? values.at(-1) ?? new Date(0).toISOString()
}
