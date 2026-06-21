import { randomUUID } from 'node:crypto'
import {
  buildKnowledgeGovernanceChecks,
  buildKnowledgeReferences,
  buildCodingBrief,
  canRunCodingAgentOnNode,
  createRemoteCodingAgentSummary,
  createTestEvidenceArtifact,
  createTestEvidenceEvent,
  estimateCodingRuntimeCost,
  knowledgeChunks as defaultKnowledgeChunks,
  knowledgeDocuments as defaultKnowledgeDocuments,
  redactSecrets,
  type AgentEvent,
  type Artifact,
  type BudgetGuardDecision,
  type CodingRuntimeCostSummary,
  type CodingAgentEvent,
  type CodingAgentRun,
  type CodingPermissionDecision,
  type CodingPermissionRequest,
  type DependencyBootstrapEvidence,
  type CodingDiffArtifact,
  type GateDecision,
  type KnowledgeChunk,
  type KnowledgeDocument,
  type LocalExecutionState,
  type LocalProject,
  type ManagedCodingWorkspace,
  type RemoteCodingAgentSummary,
  type RemoteSyncUploadResult,
  type RemediationPlan,
  type RetryAttempt,
  type TestEvidence,
  type TestEvidenceStatus,
  type WorkflowNode,
  type WorkflowRun,
} from '@ai-devflow/shared'
import {
  createManagedCodingWorkspace,
  deleteManagedCodingWorkspace,
  findActiveCodingRun,
} from './coding-runner.js'
import type { CodingEngineAdapter } from './coding-engine.js'

export type CodingRuntimeStore = {
  listProjects(): Promise<LocalProject[]>
  listRuns(): Promise<WorkflowRun[]>
  listArtifacts(runId?: string): Promise<Artifact[]>
  listEvents(runId?: string): Promise<AgentEvent[]>
  listTestEvidence(runId?: string): Promise<TestEvidence[]>
  saveArtifact(artifact: Artifact): Promise<void>
  saveEvent(event: AgentEvent): Promise<void>
  saveTestEvidence(evidence: TestEvidence): Promise<void>
  listCodingAgentRuns(runId?: string): Promise<CodingAgentRun[]>
  saveCodingAgentRun(run: CodingAgentRun): Promise<void>
  saveCodingAgentEvent(event: CodingAgentEvent): Promise<void>
  listCodingAgentEvents(codingRunId?: string): Promise<CodingAgentEvent[]>
  saveCodingPermissionRequest(request: CodingPermissionRequest): Promise<void>
  listCodingPermissionRequests(codingRunId?: string): Promise<CodingPermissionRequest[]>
  saveCodingPermissionDecision(decision: CodingPermissionDecision): Promise<void>
  saveManagedCodingWorkspace(workspace: ManagedCodingWorkspace): Promise<void>
  listManagedCodingWorkspaces(projectId?: string): Promise<ManagedCodingWorkspace[]>
  saveDependencyBootstrapEvidence(evidence: DependencyBootstrapEvidence): Promise<void>
  listDependencyBootstrapEvidence(codingRunId?: string): Promise<DependencyBootstrapEvidence[]>
  saveCodingDiffArtifact(artifact: CodingDiffArtifact): Promise<void>
  saveRetryAttempt(attempt: RetryAttempt): Promise<RetryAttempt>
  listRetryAttempts(runId?: string): Promise<RetryAttempt[]>
  loadState(): Promise<LocalExecutionState>
}

export type CodingRuntimeRemoteSync = {
  uploadCodingAgentSummary(summary: RemoteCodingAgentSummary): Promise<RemoteSyncUploadResult>
}

export type CodingRuntimePublisher = {
  publishRunStatus(run: CodingAgentRun): void
  publishEvent(event: CodingAgentEvent): void
  publishPermission(request: CodingPermissionRequest): void
}

export type CodingRuntimeTestCommandResult = {
  status: TestEvidenceStatus
  exitCode: number | null
  durationMs: number
  stdout: string
  stderr: string
  redacted: boolean
  summary: string
}

export type CodingRuntimeTestCommandRunner = (input: {
  command: string
  cwd: string
  timeoutMs: number
}) => Promise<CodingRuntimeTestCommandResult>

export type CodingRuntimePermissionTimeoutScheduler = (
  request: CodingPermissionRequest,
  expire: () => Promise<void>,
) => void

export type CodingRuntimeRunTimeoutScheduler = (
  codingRun: CodingAgentRun,
  expire: () => Promise<void>,
) => void

export type CodingRuntimeBudgetGuard = (input: {
  codingRunId: string
  engine: CodingAgentRun['engine']
  providerId: string
  model: string
  project: LocalProject
  run: WorkflowRun
  node: WorkflowNode
  requestedBy: string
  estimatedCost: CodingRuntimeCostSummary
  approvalId?: string
}) => Promise<BudgetGuardDecision>

export type CodingRuntimeDependencyBootstrapRunner = (input: {
  codingRun: CodingAgentRun
  project: LocalProject
  workspace: ManagedCodingWorkspace
  previousDependencyHash?: string | undefined
  timestamp: string
}) => Promise<DependencyBootstrapEvidence>

export type RunCodingAgentRuntimeInput = {
  runId: string
  nodeId: string
  projectId: string
  requestedBy: string
  providerId: string
  userInstruction: string
  runtimeBudgetApprovalId?: string
  remediationPlan?: RemediationPlan
  retryAttempt?: RetryAttempt
}

export type RunCodingAgentRuntimeResult = {
  codingRun: CodingAgentRun
  state: LocalExecutionState
}

export type ReplyCodingPermissionRuntimeInput = {
  requestId: string
  codingRunId: string
  decidedBy: string
  decision: CodingPermissionDecision['decision']
  comment: string
}

export type CancelCodingAgentRunRuntimeInput = {
  codingRunId: string
}

export type StartRetryAttemptRuntimeInput = {
  runId: string
  nodeId: string
  projectId: string
  requestedBy: string
  providerId: string
  remediationPlan: RemediationPlan
  candidateIds: string[]
  userInstruction: string
}

export type StartRetryAttemptRuntimeResult = RunCodingAgentRuntimeResult & {
  retryAttempt: RetryAttempt
}

export type OpenManagedWorktreeRuntimeInput = {
  workspaceId: string
}

export type DeleteManagedWorktreeRuntimeInput = OpenManagedWorktreeRuntimeInput

export type CodingRuntimeDeps = {
  store: CodingRuntimeStore
  engine: CodingEngineAdapter
  remoteSync: CodingRuntimeRemoteSync
  publisher?: CodingRuntimePublisher
  runTestCommand?: CodingRuntimeTestCommandRunner
  runDependencyBootstrap?: CodingRuntimeDependencyBootstrapRunner
  schedulePermissionTimeout?: CodingRuntimePermissionTimeoutScheduler
  scheduleRunTimeout?: CodingRuntimeRunTimeoutScheduler
  budgetGuard?: CodingRuntimeBudgetGuard
  testTimeoutMs?: number
  worktreeRoot?: string
  idGenerator?: (prefix?: string) => string
  now?: () => string
  knowledgeDocuments?: KnowledgeDocument[]
  knowledgeChunks?: KnowledgeChunk[]
  createWorkspace?: typeof createManagedCodingWorkspace
  deleteWorkspace?: typeof deleteManagedCodingWorkspace
}

export type CodingRuntime = {
  ensureCodingEngine(input: { projectId: string }): Promise<{
    projectId: string
    engine: CodingAgentRun['engine']
    status: 'ready'
  }>
  listCodingAgentRuns(input?: { runId?: string }): Promise<CodingAgentRun[]>
  runCodingAgent(input: RunCodingAgentRuntimeInput): Promise<RunCodingAgentRuntimeResult>
  startRetryAttempt(input: StartRetryAttemptRuntimeInput): Promise<StartRetryAttemptRuntimeResult>
  cancelCodingAgentRun(input: CancelCodingAgentRunRuntimeInput): Promise<CodingAgentRun>
  replyCodingPermission(input: ReplyCodingPermissionRuntimeInput): Promise<CodingPermissionRequest>
  subscribeCodingRun(input: { codingRunId: string }): Promise<LocalExecutionState>
  findManagedWorktree(input: OpenManagedWorktreeRuntimeInput): Promise<ManagedCodingWorkspace>
  deleteManagedWorktree(input: DeleteManagedWorktreeRuntimeInput): Promise<ManagedCodingWorkspace>
}

export function createCodingRuntime(deps: CodingRuntimeDeps): CodingRuntime {
  const idGenerator = deps.idGenerator ?? ((prefix = 'id') => `${prefix}-${randomUUID()}`)
  const now = deps.now ?? (() => new Date().toISOString())
  const knowledgeDocuments = deps.knowledgeDocuments ?? defaultKnowledgeDocuments
  const knowledgeChunks = deps.knowledgeChunks ?? defaultKnowledgeChunks
  const createWorkspace = deps.createWorkspace ?? createManagedCodingWorkspace
  const deleteWorkspace = deps.deleteWorkspace ?? deleteManagedCodingWorkspace
  const activeCodingStatuses = new Set<CodingAgentRun['status']>([
    'queued',
    'preparing',
    'waiting_permission',
    'bootstrapping',
    'running',
    'testing',
  ])

  async function findProject(projectId: string): Promise<LocalProject> {
    const project = (await deps.store.listProjects()).find((candidate) => candidate.id === projectId)
    if (!project) {
      throw new Error(`Local project not found: ${projectId}`)
    }
    return project
  }

  async function findRun(runId: string): Promise<WorkflowRun> {
    const run = (await deps.store.listRuns()).find((candidate) => candidate.id === runId)
    if (!run) {
      throw new Error(`Run not found: ${runId}`)
    }
    return run
  }

  function findNode(run: WorkflowRun, nodeId: string): WorkflowNode {
    const node = run.nodes.find((candidate) => candidate.id === nodeId)
    if (!node) {
      throw new Error(`Run node not found: ${nodeId}`)
    }
    if (!canRunCodingAgentOnNode(node)) {
      throw new Error('Coding Agent can only run from a build task node')
    }
    return node
  }

  async function findCodingRun(codingRunId: string): Promise<CodingAgentRun> {
    const codingRun = (await deps.store.listCodingAgentRuns()).find((candidate) => candidate.id === codingRunId)
    if (!codingRun) {
      throw new Error(`Coding Agent run not found: ${codingRunId}`)
    }
    return codingRun
  }

  async function findPermissionRequest(input: ReplyCodingPermissionRuntimeInput): Promise<CodingPermissionRequest> {
    const request = (await deps.store.listCodingPermissionRequests(input.codingRunId)).find(
      (candidate) => candidate.id === input.requestId,
    )
    if (!request) {
      throw new Error(`Coding permission request not found: ${input.requestId}`)
    }
    return request
  }

  async function findWorkspace(workspaceId: string, projectId?: string): Promise<ManagedCodingWorkspace> {
    const workspace = (await deps.store.listManagedCodingWorkspaces(projectId)).find(
      (candidate) => candidate.id === workspaceId,
    )
    if (!workspace) {
      throw new Error(`Managed worktree not found: ${workspaceId}`)
    }
    return workspace
  }

  async function saveEvents(events: CodingAgentEvent[]) {
    for (const event of events) {
      await deps.store.saveCodingAgentEvent(event)
      deps.publisher?.publishEvent(event)
    }
  }

  async function saveCodingRun(run: CodingAgentRun) {
    await deps.store.saveCodingAgentRun(run)
    deps.publisher?.publishRunStatus(run)
  }

  async function savePermissionRequest(request: CodingPermissionRequest) {
    await deps.store.saveCodingPermissionRequest(request)
    deps.publisher?.publishPermission(request)
    if (request.status === 'pending') {
      deps.schedulePermissionTimeout?.(request, async () => {
        const latest = (await deps.store.listCodingPermissionRequests(request.codingRunId)).find(
          (candidate) => candidate.id === request.id,
        )
        if (!latest || latest.status !== 'pending') {
          return
        }
        await replyCodingPermission({
          requestId: request.id,
          codingRunId: request.codingRunId,
          decidedBy: 'devflow-timeout',
          decision: 'expired',
          comment: 'Permission request expired.',
        })
      })
    }
  }

  async function nextSequence(codingRunId: string): Promise<number> {
    return (await deps.store.listCodingAgentEvents(codingRunId)).length + 1
  }

  async function nextAgentEventSequence(runId: string): Promise<number> {
    return (await deps.store.listEvents(runId)).length + 1
  }

  async function loadCodingBriefContext(run: WorkflowRun, node: WorkflowNode) {
    const artifacts = await deps.store.listArtifacts(run.id)
    const events = await deps.store.listEvents(run.id)
    const testEvidence = await deps.store.listTestEvidence(run.id)
    const knowledgeReferences = buildKnowledgeReferences({
      run,
      artifacts,
      documents: knowledgeDocuments,
      chunks: knowledgeChunks,
      testEvidence,
    })
    const governanceChecks = buildKnowledgeGovernanceChecks({
      run,
      node,
      artifacts,
      documents: knowledgeDocuments,
      chunks: knowledgeChunks,
      testEvidence,
    })

    return {
      upstreamArtifacts: artifacts.filter((artifact) => artifact.nodeId !== node.id),
      knowledgeReferences,
      governanceChecks,
      gateDecisions: events.flatMap((event) => gateDecisionFromEvent(event)),
      testEvidence,
    }
  }

  function gateDecisionFromEvent(event: AgentEvent): GateDecision[] {
    if (event.kind !== 'approval' || !event.nodeId) {
      return []
    }

    return [
      {
        id: `gate-decision-${event.id}`,
        runId: event.runId,
        nodeId: event.nodeId,
        approverId: 'devflow',
        decision: 'approved',
        comment: event.message,
        decidedAt: event.timestamp,
      },
    ]
  }

  async function runCodingTests(input: {
    codingRun: CodingAgentRun
    project: LocalProject
    workspace: ManagedCodingWorkspace
    timestamp: string
  }): Promise<{ codingRun: CodingAgentRun; evidence?: TestEvidence }> {
    const command = input.project.testCommand.trim()
    if (!deps.runTestCommand || !command) {
      return { codingRun: input.codingRun }
    }

    const startedEvent: CodingAgentEvent = {
      id: idGenerator('coding-event'),
      codingRunId: input.codingRun.id,
      runId: input.codingRun.runId,
      nodeId: input.codingRun.nodeId,
      sequence: await nextSequence(input.codingRun.id),
      kind: 'test',
      message: `Running coding worktree tests: ${command}`,
      timestamp: input.timestamp,
      redacted: true,
    }
    await saveEvents([startedEvent])

    const result = await deps.runTestCommand({
      command,
      cwd: input.workspace.worktreePath,
      timeoutMs: deps.testTimeoutMs ?? 120_000,
    })
    const evidence: TestEvidence = {
      id: idGenerator('evidence'),
      runId: input.codingRun.runId,
      nodeId: input.codingRun.nodeId,
      projectId: input.project.id,
      command,
      cwd: input.workspace.worktreePath,
      status: result.status,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      stdout: result.stdout,
      stderr: result.stderr,
      summary: result.summary,
      redacted: result.redacted,
      createdAt: input.timestamp,
    }
    const artifact = createTestEvidenceArtifact(evidence)
    const agentEvent = createTestEvidenceEvent(evidence, await nextAgentEventSequence(evidence.runId))
    const completedEvent: CodingAgentEvent = {
      id: idGenerator('coding-event'),
      codingRunId: input.codingRun.id,
      runId: input.codingRun.runId,
      nodeId: input.codingRun.nodeId,
      sequence: await nextSequence(input.codingRun.id),
      kind: 'test',
      message: `Coding worktree tests ${result.status}: ${result.summary}`,
      timestamp: input.timestamp,
      metadata: { evidenceId: evidence.id, status: result.status },
      redacted: true,
    }
    const codingRun: CodingAgentRun = {
      ...input.codingRun,
      testEvidenceId: evidence.id,
      summary:
        result.status === 'passed'
          ? `${input.codingRun.summary} Test evidence passed.`
          : `${input.codingRun.summary} Test evidence ${result.status}: ${result.summary}`,
    }

    await deps.store.saveTestEvidence(evidence)
    await deps.store.saveArtifact(artifact)
    await deps.store.saveEvent(agentEvent)
    await saveEvents([completedEvent])

    return { codingRun, evidence }
  }

  async function runCodingBootstrap(input: {
    codingRun: CodingAgentRun
    project: LocalProject
    workspace: ManagedCodingWorkspace
    timestamp: string
    engineBootstrapEvidence?: DependencyBootstrapEvidence
  }): Promise<{ codingRun: CodingAgentRun; canContinue: boolean }> {
    const previousDependencyHash = deps.runDependencyBootstrap
      ? await latestDependencyHash(input.project.id)
      : undefined
    const evidence =
      input.engineBootstrapEvidence ??
      (deps.runDependencyBootstrap
        ? await deps.runDependencyBootstrap({
            codingRun: input.codingRun,
            project: input.project,
            workspace: input.workspace,
            ...(previousDependencyHash ? { previousDependencyHash } : {}),
            timestamp: input.timestamp,
          })
        : undefined)

    if (!evidence) {
      return { codingRun: input.codingRun, canContinue: true }
    }

    await deps.store.saveDependencyBootstrapEvidence(evidence)
    const event: CodingAgentEvent = {
      id: idGenerator('coding-event'),
      codingRunId: input.codingRun.id,
      runId: input.codingRun.runId,
      nodeId: input.codingRun.nodeId,
      sequence: await nextSequence(input.codingRun.id),
      kind: 'bootstrap',
      message: `Dependency bootstrap ${evidence.status}: ${evidence.summary}`,
      timestamp: input.timestamp,
      metadata: { bootstrapEvidenceId: evidence.id, status: evidence.status },
      redacted: true,
    }
    await saveEvents([event])

    const canContinue = evidence.status === 'passed' || evidence.status === 'skipped'
    const codingRun: CodingAgentRun = {
      ...input.codingRun,
      bootstrapEvidenceId: evidence.id,
      ...(canContinue
        ? { summary: `${input.codingRun.summary} Dependency bootstrap ${evidence.status}.` }
        : {
            status: 'failed',
            summary: `Dependency bootstrap ${evidence.status}; coding tests were not run.`,
            completedAt: input.timestamp,
          }),
    }

    return { codingRun, canContinue }
  }

  async function latestDependencyHash(projectId: string): Promise<string | undefined> {
    const evidence = await deps.store.listDependencyBootstrapEvidence()
    return evidence
      .filter((candidate) => candidate.projectId === projectId && candidate.dependencyHash)
      .at(-1)?.dependencyHash
  }

  async function cleanupWorkspaceForRun(codingRun: CodingAgentRun, timestamp: string): Promise<void> {
    let workspace: ManagedCodingWorkspace
    try {
      workspace = await findWorkspace(codingRun.managedWorkspaceId, codingRun.projectId)
    } catch {
      return
    }

    let cleaned: ManagedCodingWorkspace
    try {
      cleaned = await deleteWorkspace(workspace)
    } catch (error) {
      cleaned = {
        ...workspace,
        deletedAt: timestamp,
        cleanupStatus: 'cleanup_failed',
        cleanupError: cleanupErrorSummary(error),
      }
    }

    await deps.store.saveManagedCodingWorkspace(cleaned)
    const status = cleaned.cleanupStatus ?? (cleaned.deletedAt ? 'deleted' : 'active')
    const event: CodingAgentEvent = {
      id: idGenerator('coding-event'),
      codingRunId: codingRun.id,
      runId: codingRun.runId,
      nodeId: codingRun.nodeId,
      sequence: await nextSequence(codingRun.id),
      kind: 'cleanup',
      message:
        status === 'deleted'
          ? 'Managed coding workspace cleaned up.'
          : 'Managed coding workspace cleanup failed; manual cleanup is required.',
      timestamp,
      metadata: {
        workspaceId: cleaned.id,
        cleanupStatus: status,
        ...(cleaned.cleanupError ? { cleanupError: cleaned.cleanupError } : {}),
      },
      redacted: true,
    }
    await saveEvents([event])
  }

  function cleanupErrorSummary(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
      return error.message.slice(0, 500)
    }
    return 'Workspace cleanup failed.'
  }

  async function expirePendingPermissions(codingRunId: string, timestamp: string, comment: string) {
    const pendingRequests = (await deps.store.listCodingPermissionRequests(codingRunId)).filter(
      (request) => request.status === 'pending',
    )
    for (const request of pendingRequests) {
      await savePermissionRequest({ ...request, status: 'expired' })
      await deps.store.saveCodingPermissionDecision({
        id: idGenerator('coding-permission-decision'),
        requestId: request.id,
        codingRunId,
        decidedBy: 'devflow-timeout',
        decision: 'expired',
        comment,
        decidedAt: timestamp,
      })
    }
    return pendingRequests
  }

  async function timeOutCodingRun(codingRunId: string, summary: string) {
    const codingRun = await findCodingRun(codingRunId)
    if (!activeCodingStatuses.has(codingRun.status)) {
      return
    }
    const timestamp = now()
    await deps.engine.cancel({ codingRun }).catch(() => undefined)
    const expiredRequests = await expirePendingPermissions(codingRunId, timestamp, summary)
    const updated: CodingAgentRun = {
      ...codingRun,
      status: 'timed_out',
      summary,
      completedAt: timestamp,
    }
    await cleanupWorkspaceForRun(updated, timestamp)
    const toolResultEvents: CodingAgentEvent[] = []
    let sequence = await nextSequence(updated.id)
    for (const request of expiredRequests) {
      toolResultEvents.push(
        createRelayToolResultEvent({
          codingRun: updated,
          request,
          timestamp,
          sequence: sequence++,
          decision: 'expired',
          status: 'expired',
          outputSummary: `DevFlow relay expired ${request.permission} permission; coding run timed out.`,
        }),
      )
    }
    const event: CodingAgentEvent = {
      id: idGenerator('coding-event'),
      codingRunId: updated.id,
      runId: updated.runId,
      nodeId: updated.nodeId,
      sequence,
      kind: 'status',
      message: summary,
      timestamp,
      redacted: true,
    }
    await saveCodingRun(updated)
    await saveEvents([...toolResultEvents, event])
  }

  async function replyCodingPermission(input: ReplyCodingPermissionRuntimeInput): Promise<CodingPermissionRequest> {
    const request = await findPermissionRequest(input)
    const timestamp = now()
    const updatedRequest: CodingPermissionRequest = {
      ...request,
      status:
        input.decision === 'approved'
          ? 'approved'
          : input.decision === 'expired'
            ? 'expired'
            : 'rejected',
    }
    const decision: CodingPermissionDecision = {
      id: idGenerator('coding-permission-decision'),
      requestId: request.id,
      codingRunId: input.codingRunId,
      decidedBy: input.decidedBy,
      decision: input.decision,
      comment: input.comment,
      decidedAt: timestamp,
    }

    await savePermissionRequest(updatedRequest)
    await deps.store.saveCodingPermissionDecision(decision)

    const codingRun = await findCodingRun(input.codingRunId)
    if (input.decision === 'approved') {
      const workspace = await findWorkspace(codingRun.managedWorkspaceId, codingRun.projectId)
      const project = await findProject(codingRun.projectId)
      const completed = await deps.engine.approvePermission({
        request: updatedRequest,
        codingRun,
        workspace,
        project,
        now: timestamp,
      })
      if ('permissionRequest' in completed) {
        await saveCodingRun(completed.codingRun)
        await saveEvents(completed.events)
        await savePermissionRequest(completed.permissionRequest)
        return updatedRequest
      }
      await deps.store.saveCodingDiffArtifact(completed.diff)
      await saveEvents(completed.events)
      const bootstrapped = await runCodingBootstrap({
        codingRun: completed.codingRun,
        workspace,
        project,
        timestamp,
        ...(completed.bootstrapEvidence ? { engineBootstrapEvidence: completed.bootstrapEvidence } : {}),
      })
      if (!bootstrapped.canContinue) {
        await saveCodingRun(bootstrapped.codingRun)
        await deps.remoteSync
          .uploadCodingAgentSummary(createRemoteCodingAgentSummary(bootstrapped.codingRun, completed.diff))
          .catch(() => undefined)
        return updatedRequest
      }
      const tested = await runCodingTests({
        codingRun: bootstrapped.codingRun,
        workspace,
        project,
        timestamp,
      })

      await saveCodingRun(tested.codingRun)
      await deps.remoteSync
        .uploadCodingAgentSummary(createRemoteCodingAgentSummary(tested.codingRun, completed.diff))
        .catch(() => undefined)
    } else {
      const terminalStatus = input.decision === 'expired' ? 'timed_out' : 'interrupted'
      const sequence = await nextSequence(codingRun.id)
      const updatedRun: CodingAgentRun = {
        ...codingRun,
        status: terminalStatus,
        summary:
          input.decision === 'expired'
            ? 'Coding Agent permission expired; run timed out.'
            : `Coding Agent permission ${input.decision}; run interrupted.`,
        completedAt: timestamp,
      }
      const event: CodingAgentEvent = {
        id: idGenerator('coding-event'),
        codingRunId: updatedRun.id,
        runId: updatedRun.runId,
        nodeId: updatedRun.nodeId,
        sequence,
        kind: 'permission',
        message:
          input.decision === 'expired'
            ? 'Coding permission expired; run timed out.'
            : `Coding permission ${input.decision}; run interrupted.`,
        timestamp,
        metadata: { requestId: request.id },
        redacted: true,
      }
      const toolResultEvent = createRelayToolResultEvent({
        codingRun: updatedRun,
        request,
        timestamp,
        sequence: sequence + 1,
        decision: input.decision === 'expired' ? 'expired' : 'rejected',
        status: input.decision === 'expired' ? 'expired' : 'rejected',
        outputSummary:
          input.decision === 'expired'
            ? `DevFlow relay expired ${request.permission} permission; coding run timed out.`
            : `DevFlow relay rejected ${request.permission} permission; coding run interrupted.`,
      })
      await cleanupWorkspaceForRun(updatedRun, timestamp)
      await saveCodingRun(updatedRun)
      await saveEvents([event, toolResultEvent])
    }

    return updatedRequest
  }

  return {
    async ensureCodingEngine(input) {
      const project = await findProject(input.projectId)
      return deps.engine.ensure({ project })
    },

    async listCodingAgentRuns(input = {}) {
      return deps.store.listCodingAgentRuns(input.runId)
    },

    async runCodingAgent(input) {
      const project = await findProject(input.projectId)
      const active = findActiveCodingRun(await deps.store.listCodingAgentRuns(), input.projectId)
      if (active) {
        throw new Error(`Coding Agent run already active for this project: ${active.id}`)
      }

      const run = await findRun(input.runId)
      const node = findNode(run, input.nodeId)
      const codingRunId = idGenerator('coding-run')
      const briefContext = await loadCodingBriefContext(run, node)
      const workspace = await createWorkspace({
        project,
        codingRunId,
        runId: run.id,
        nodeId: node.id,
        ...(deps.worktreeRoot ? { worktreeRoot: deps.worktreeRoot } : {}),
      })
      const model = deps.engine.modelId ?? input.providerId
      const preliminaryBrief = buildCodingBrief({
        run,
        node,
        project,
        ...briefContext,
        userInstruction: input.userInstruction,
        worktreePath: workspace.worktreePath,
        branchName: workspace.branchName,
        ...(input.remediationPlan ? { remediationPlan: input.remediationPlan } : {}),
        ...(input.retryAttempt ? { retryAttempt: input.retryAttempt } : {}),
      })
      const estimatedCost = estimateCodingRuntimeCost({
        engine: deps.engine.engine,
        providerId: input.providerId,
        model,
        prompt: preliminaryBrief.prompt,
        runId: run.id,
        nodeId: node.id,
        projectId: project.id,
        userId: input.requestedBy,
        timestamp: now(),
      })
      const budgetDecision = deps.budgetGuard
        ? await deps.budgetGuard({
            codingRunId,
            engine: deps.engine.engine,
            providerId: input.providerId,
            model,
            project,
            run,
            node,
            requestedBy: input.requestedBy,
            estimatedCost,
            ...(input.runtimeBudgetApprovalId?.trim()
              ? { approvalId: input.runtimeBudgetApprovalId.trim() }
              : {}),
          })
        : {
            status: 'disabled',
            blocksRun: false,
            currentSpendUsd: 0,
            projectedCostUsd: estimatedCost.costUsd,
            reason: 'Runtime budget guard is not configured for this local project.',
          } satisfies BudgetGuardDecision

      if (budgetDecision.blocksRun) {
        const timestamp = now()
        const blockedRun: CodingAgentRun = {
          id: codingRunId,
          runId: run.id,
          nodeId: node.id,
          projectId: project.id,
          requestedBy: input.requestedBy,
          providerId: input.providerId,
          engine: deps.engine.engine,
          status: 'failed',
          managedWorkspaceId: workspace.id,
          branchName: workspace.branchName,
          userInstruction: input.userInstruction.trim(),
          prompt: preliminaryBrief.prompt,
          summary: `Runtime budget requires lead approval before calling ${deps.engine.engine}. ${budgetDecision.reason}`,
          changedPaths: [],
          startedAt: timestamp,
          completedAt: timestamp,
          runtimeCostSummary: estimatedCost,
          budgetDecision,
          redacted: true,
        }
        const event: CodingAgentEvent = {
          id: idGenerator('coding-event'),
          codingRunId: blockedRun.id,
          runId: blockedRun.runId,
          nodeId: blockedRun.nodeId,
          sequence: 1,
          kind: 'error',
          message: blockedRun.summary,
          timestamp,
          metadata: {
            budgetStatus: budgetDecision.status,
            projectedCostUsd: budgetDecision.projectedCostUsd,
            limitUsd: budgetDecision.limitUsd,
            approvalRequiredRole: budgetDecision.approvalRequiredRole,
          },
          redacted: true,
        }
        await deps.store.saveManagedCodingWorkspace(workspace)
        await saveCodingRun(blockedRun)
        await saveEvents([event])
        await cleanupWorkspaceForRun(blockedRun, timestamp)
        return {
          codingRun: blockedRun,
          state: await deps.store.loadState(),
        }
      }
      const bundle = await deps.engine.start({
        id: codingRunId,
        run,
        node,
        project,
        workspace,
        requestedBy: input.requestedBy,
        providerId: input.providerId,
        userInstruction: input.userInstruction,
        now: now(),
        ...briefContext,
        ...(input.remediationPlan ? { remediationPlan: input.remediationPlan } : {}),
        ...(input.retryAttempt ? { retryAttempt: input.retryAttempt } : {}),
      })
      bundle.codingRun.runtimeCostSummary = estimatedCost
      bundle.codingRun.budgetDecision = budgetDecision

      await deps.store.saveManagedCodingWorkspace(workspace)
      await saveCodingRun(bundle.codingRun)
      await saveEvents(bundle.events)
      await savePermissionRequest(bundle.permissionRequest)
      deps.scheduleRunTimeout?.(bundle.codingRun, async () => {
        await timeOutCodingRun(bundle.codingRun.id, 'Coding Agent run timed out.')
      })

      return {
        codingRun: bundle.codingRun,
        state: await deps.store.loadState(),
      }
    },

    async startRetryAttempt(input) {
      const run = await findRun(input.runId)
      const node = findNode(run, input.nodeId)
      const selectedCandidates = input.remediationPlan.candidates.filter((candidate) =>
        input.candidateIds.includes(candidate.id),
      )
      if (selectedCandidates.length === 0) {
        throw new Error('Retry Attempt requires at least one remediation candidate')
      }
      const nonRetryable = selectedCandidates.find((candidate) => !candidate.eligibleForCodingRetry)
      if (nonRetryable) {
        throw new Error(`Remediation candidate is not eligible for Coding retry: ${nonRetryable.id}`)
      }

      const timestamp = now()
      const retryAttempt: RetryAttempt = {
        id: idGenerator('retry'),
        runId: input.runId,
        nodeId: input.nodeId,
        projectId: input.projectId,
        remediationPlanId: input.remediationPlan.id,
        candidateIds: selectedCandidates.map((candidate) => candidate.id),
        requestedBy: input.requestedBy,
        userInstruction: input.userInstruction,
        status: 'approved',
        createdAt: timestamp,
      }
      await deps.store.saveRetryAttempt(retryAttempt)
      await deps.store.saveArtifact({
        id: idGenerator('artifact'),
        runId: run.id,
        nodeId: node.id,
        kind: 'log',
        title: 'Policy remediation retry attempt',
        summary: `Retry attempt approved for ${selectedCandidates.length} remediation candidate(s).`,
        content: selectedCandidates.map((candidate) => `${candidate.title}: ${candidate.summary}`).join('\n'),
        redacted: true,
        updatedAt: timestamp,
      })
      await deps.store.saveEvent({
        id: idGenerator('event'),
        runId: run.id,
        nodeId: node.id,
        sequence: await nextAgentEventSequence(run.id),
        kind: 'tool_call',
        message: `Retry Attempt approved from remediation plan ${input.remediationPlan.id}.`,
        timestamp,
      })

      const result = await this.runCodingAgent({
        runId: input.runId,
        nodeId: input.nodeId,
        projectId: input.projectId,
        requestedBy: input.requestedBy,
        providerId: input.providerId,
        userInstruction: input.userInstruction,
        remediationPlan: input.remediationPlan,
        retryAttempt,
      })
      const linkedRetryAttempt: RetryAttempt = {
        ...retryAttempt,
        status: 'started',
        codingRunId: result.codingRun.id,
      }
      await deps.store.saveRetryAttempt(linkedRetryAttempt)

      return {
        ...result,
        retryAttempt: linkedRetryAttempt,
      }
    },

    async cancelCodingAgentRun(input) {
      const codingRun = await findCodingRun(input.codingRunId)
      await deps.engine.cancel({ codingRun })
      const timestamp = now()
      const updated: CodingAgentRun = {
        ...codingRun,
        status: 'cancelled',
        summary: 'Coding Agent run cancelled by user.',
        completedAt: timestamp,
      }
      const event: CodingAgentEvent = {
        id: idGenerator('coding-event'),
        codingRunId: updated.id,
        runId: updated.runId,
        nodeId: updated.nodeId,
        sequence: await nextSequence(updated.id),
        kind: 'status',
        message: 'Coding Agent run cancelled by user.',
        timestamp,
        redacted: true,
      }
      await cleanupWorkspaceForRun(updated, timestamp)
      await saveCodingRun(updated)
      await saveEvents([event])
      return updated
    },

    replyCodingPermission,

    async subscribeCodingRun() {
      return deps.store.loadState()
    },

    async findManagedWorktree(input) {
      return findWorkspace(input.workspaceId)
    },

    async deleteManagedWorktree(input) {
      const workspace = await findWorkspace(input.workspaceId)
      const deleted = await deleteWorkspace(workspace)
      await deps.store.saveManagedCodingWorkspace(deleted)
      return deleted
    },
  }
}

function createRelayToolResultEvent(input: {
  codingRun: CodingAgentRun
  request: CodingPermissionRequest
  timestamp: string
  sequence: number
  decision: 'approved' | 'rejected' | 'expired'
  status: 'completed' | 'continued' | 'rejected' | 'expired'
  outputSummary: string
}): CodingAgentEvent {
  const command = input.request.command ? redactSecrets(input.request.command) : undefined
  const output = redactSecrets(input.outputSummary)
  return {
    id: `coding-event-${input.codingRun.id}-tool-result-${input.request.id}`,
    codingRunId: input.codingRun.id,
    runId: input.codingRun.runId,
    nodeId: input.codingRun.nodeId,
    sequence: input.sequence,
    kind: 'tool_result',
    message: `DevFlow ${input.decision} ${input.request.permission} permission.`,
    timestamp: input.timestamp,
    metadata: {
      source: input.request.command || input.request.filePath ? 'opencode_metadata' : 'inferred',
      permissionRequestId: input.request.id,
      permission: input.request.permission,
      toolName: input.request.permission,
      ...(command ? { commandSummary: command.value } : {}),
      ...(input.request.filePath ? { filePath: input.request.filePath } : {}),
      decision: input.decision,
      status: input.status,
      outputSummary: output.value,
      redactionApplied: Boolean(command?.redacted || output.redacted),
    },
    redacted: true,
  }
}
