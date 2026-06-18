import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentEvent,
  Artifact,
  CodingAgentEvent,
  CodingAgentRun,
  CodingDiffArtifact,
  CodingPermissionDecision,
  CodingPermissionRequest,
  DependencyBootstrapEvidence,
  LocalProject,
  ManagedCodingWorkspace,
  RemoteCodingAgentSummary,
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
      remoteSync: { uploadCodingAgentSummary: vi.fn() },
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
      remoteSync: { uploadCodingAgentSummary: vi.fn() },
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

  it('rejects coding runs from nodes that are not build task nodes', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [
        buildRun({
          nodes: [
            buildNode({ id: 'node-build-gate', stage: 'build', kind: 'gate' }),
            buildNode({ id: 'node-design-task', stage: 'design', kind: 'task' }),
          ],
        }),
      ],
    })
    const runtime = createCodingRuntime({
      store,
      engine: createFakeCodingEngineAdapter(),
      remoteSync: { uploadCodingAgentSummary: vi.fn() },
      worktreeRoot: await tempDir('devflow-worktrees-'),
      idGenerator: fixedIds('coding-run-1'),
      now: fixedNow('2026-06-17T00:00:00.000Z'),
    })

    await expect(
      runtime.runCodingAgent({
        runId: 'run-1',
        nodeId: 'node-build-gate',
        projectId: 'project-1',
        requestedBy: 'user-1',
        providerId: 'fake-coding-engine',
        userInstruction: 'Do it.',
      }),
    ).rejects.toThrow('Coding Agent can only run from a build task node')
    await expect(
      runtime.runCodingAgent({
        runId: 'run-1',
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
      remoteSync: { uploadCodingAgentSummary: vi.fn() },
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
    expect(result.codingRun.prompt).toContain('knowledge-doc-api-health')
    expect(result.codingRun.prompt).toContain('Gate Decisions')
    expect(result.codingRun.prompt).toContain('approved by devflow: Lead Gate 已通过：架构 Gate')
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
      remoteSync: { uploadCodingAgentSummary: vi.fn() },
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
      remoteSync: { uploadCodingAgentSummary: vi.fn() },
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
      remoteSync: { uploadCodingAgentSummary: vi.fn() },
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
    expect(store.codingRuns.at(-1)?.status).toBe('interrupted')
  })

  it('archives diff and bootstrap evidence and uploads a redacted summary after approval', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
      runs: [buildRun()],
    })
    const uploadCodingAgentSummary = vi.fn(async () => ({
      accepted: true,
      syncedAt: '2026-06-17T00:02:00.000Z',
      message: 'accepted',
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
      engine: createFakeCodingEngineAdapter(),
      remoteSync: { uploadCodingAgentSummary },
      runTestCommand,
      worktreeRoot: await tempDir('devflow-worktrees-'),
      idGenerator: fixedIds('coding-run-1', 'decision-1', 'evidence-1'),
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

    expect(store.permissionRequests[0]!.status).toBe('approved')
    expect(store.permissionDecisions).toHaveLength(1)
    expect(store.codingRuns.at(-1)?.status).toBe('completed')
    expect(store.bootstrapEvidence).toHaveLength(1)
    expect(store.diffArtifacts[0]?.changedPaths).toEqual(['devflow-fake-change.txt'])
    expect(runTestCommand).toHaveBeenCalledWith({
      command: 'npm test',
      cwd: store.workspaces[0]!.worktreePath,
      timeoutMs: 120_000,
    })
    expect(store.testEvidence[0]).toMatchObject({
      command: 'npm test',
      cwd: store.workspaces[0]!.worktreePath,
      status: 'passed',
      summary: 'Coding worktree tests passed.',
    })
    expect(store.artifacts[0]).toMatchObject({ kind: 'test_report', title: 'Local test evidence' })
    expect(store.events[0]).toMatchObject({ kind: 'test_result', message: 'Coding worktree tests passed.' })
    expect(store.codingRuns.at(-1)?.testEvidenceId).toBe(store.testEvidence[0]?.id)
    expect(store.codingEvents.map((event) => event.kind)).toContain('test')
    expect(uploadCodingAgentSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        id: started.codingRun.id,
        changedPaths: ['devflow-fake-change.txt'],
        redacted: true,
      }),
    )
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
    const uploadCodingAgentSummary = vi.fn()
    const runtime = createCodingRuntime({
      store,
      engine: engineWithNextPermission,
      remoteSync: { uploadCodingAgentSummary },
      publisher,
      runTestCommand,
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
    expect(uploadCodingAgentSummary).not.toHaveBeenCalled()
    expect(publisher.publishPermission).toHaveBeenCalledWith(nextPermission)
  })

  it('runs runtime-owned dependency bootstrap before tests when the engine does not return bootstrap evidence', async () => {
    const repo = await gitRepo()
    const store = new MemoryCodingStore({
      projects: [project(repo)],
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
      remoteSync: {
        uploadCodingAgentSummary: vi.fn(async () => ({
          accepted: true,
          syncedAt: '2026-06-17T00:02:00.000Z',
          message: 'accepted',
        })),
      },
      runDependencyBootstrap,
      runTestCommand,
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
    const uploadCodingAgentSummary = vi.fn()
    const runtime = createCodingRuntime({
      store,
      engine: createFakeCodingEngineAdapter(),
      remoteSync: { uploadCodingAgentSummary },
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
    expect(store.codingEvents.at(-1)?.kind).toBe('permission')
    expect(uploadCodingAgentSummary).not.toHaveBeenCalled()
  })

  it('cancels a running coding run and appends an interrupted status event', async () => {
    const store = new MemoryCodingStore({
      projects: [project('/tmp/repo')],
      runs: [buildRun()],
      codingRuns: [codingRun({ id: 'coding-run-1', status: 'waiting_permission' })],
    })
    const runtime = createCodingRuntime({
      store,
      engine: createFakeCodingEngineAdapter(),
      remoteSync: { uploadCodingAgentSummary: vi.fn() },
      idGenerator: fixedIds('event-1'),
      now: fixedNow('2026-06-17T00:03:00.000Z'),
    })

    const cancelled = await runtime.cancelCodingAgentRun({ codingRunId: 'coding-run-1' })

    expect(cancelled.status).toBe('interrupted')
    expect(cancelled.completedAt).toBe('2026-06-17T00:03:00.000Z')
    expect(store.codingEvents.at(-1)).toMatchObject({
      kind: 'status',
      message: 'Coding Agent run interrupted by user cancel.',
    })
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
}

class MemoryCodingStore {
  readonly projects: LocalProject[]
  readonly runs: WorkflowRun[]
  readonly artifacts: Artifact[]
  readonly events: AgentEvent[]
  readonly testEvidence: TestEvidence[]
  readonly workspaces: ManagedCodingWorkspace[] = []
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
    message: 'Lead Gate 已通过：架构 Gate',
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
