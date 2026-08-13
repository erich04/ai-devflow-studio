import { createHash, randomUUID } from 'node:crypto'
import {
  CODING_EXECUTOR_CONTRACT_VERSION,
  buildKnowledgeGovernanceChecks,
  buildKnowledgeReferences,
  buildCodingBrief,
  canRunCodingAgentOnNode,
  createTestEvidenceArtifact,
  createTestEvidenceEvent,
  estimateCodingRuntimeCost,
  redactCodingAgentEventForStorage,
  redactLocalAbsolutePaths,
  redactSensitiveText,
  redactTestEvidenceForStorage,
  redactSecrets,
  parseCodingExecutorTerminalResult,
  parseCodingExecutorRequest,
  parseCodingExecutorTurn,
  selectCodingExecutor,
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
  type CodingExecutorCapability,
  type CodingExecutorTerminalResult,
  type GateDecision,
  type KnowledgeChunk,
  type KnowledgeDocument,
  type LocalExecutionState,
  type LocalProject,
  type ManagedCodingWorkspace,
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
import type {
  CodingEngineAdapter,
} from './coding-engine.js'
import {
  createCodingExecutorCompatibilityAdapter,
  type CodingExecutor,
  type CodingExecutorCompletedResult,
} from './coding-executor.js'
import {
  CodingEngineContinuationCleanupError,
  CodingEngineStartupCleanupError,
} from './coding-engine-lifecycle.js'
import type {
  CodingAgentMutation,
  CodingAgentMutationResult,
  ReserveCodingAgentRunResult,
} from './local-store.js'

const defaultKnowledgeDocuments: KnowledgeDocument[] = []
const defaultKnowledgeChunks: KnowledgeChunk[] = []
const baseCodingExecutorCapabilities: CodingExecutorCapability[] = [
  'cancellation',
  'structured_diff',
  'workspace_edit',
  'workspace_read',
]

function requiredCapabilitiesForExecutor(executor: CodingExecutor): CodingExecutorCapability[] {
  return executor.descriptor.kind === 'opencode'
    ? [
        'cancellation',
        'permission_relay',
        'structured_diff',
        'workspace_edit',
        'workspace_read',
      ]
    : baseCodingExecutorCapabilities
}

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
  reserveCodingAgentRun(run: CodingAgentRun): Promise<ReserveCodingAgentRunResult>
  commitCodingAgentMutation(
    mutation: CodingAgentMutation,
  ): Promise<CodingAgentMutationResult>
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

export type CodingRuntimeCompleteWorkflowBuild = (input: {
  runId: string
  nodeId: string
  codingRunId: string
  diffId: string
  now: string
}) => Promise<void>

const FAKE_CODING_MARKER_TEST_COMMAND =
  'node -e "require(\'node:fs\').accessSync(\'devflow-fake-change.txt\'); console.log(\'Fake coding marker verified\')"'

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
  engine?: CodingEngineAdapter
  executor?: CodingExecutor
  publisher?: CodingRuntimePublisher
  runTestCommand?: CodingRuntimeTestCommandRunner
  runDependencyBootstrap?: CodingRuntimeDependencyBootstrapRunner
  schedulePermissionTimeout?: CodingRuntimePermissionTimeoutScheduler
  scheduleRunTimeout?: CodingRuntimeRunTimeoutScheduler
  budgetGuard?: CodingRuntimeBudgetGuard
  completeWorkflowBuild?: CodingRuntimeCompleteWorkflowBuild
  testTimeoutMs?: number
  worktreeRoot?: string
  idGenerator?: (prefix?: string) => string
  now?: () => string
  knowledgeDocuments?: KnowledgeDocument[]
  knowledgeChunks?: KnowledgeChunk[]
  createWorkspace?: typeof createManagedCodingWorkspace
  deleteWorkspace?: typeof deleteManagedCodingWorkspace
  cleanupWorkspace?: (input: {
    workspaceId: string
    projectId?: string
  }) => Promise<ManagedCodingWorkspace>
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
  const selectedExecutor =
    deps.executor ??
    (deps.engine ? createCodingExecutorCompatibilityAdapter(deps.engine) : undefined)
  if (!selectedExecutor) {
    throw new Error('Coding Runtime requires one Coding Executor.')
  }
  const executor: CodingExecutor = selectedExecutor
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

  function validateCodingWorkflowContext(
    run: WorkflowRun,
    input: { nodeId: string; projectId: string },
  ): WorkflowNode {
    if (run.projectId !== input.projectId) {
      throw new Error(
        `Coding workflow project mismatch: run ${run.id} belongs to ${run.projectId}, not ${input.projectId}`,
      )
    }
    if (run.status === 'completed' || run.status === 'cancelled') {
      throw new Error('Coding Agent cannot run on a terminal workflow run')
    }

    const node = run.nodes.find((candidate) => candidate.id === input.nodeId)
    if (!node) {
      throw new Error(`Run node not found: ${input.nodeId}`)
    }
    if (run.currentNodeId !== node.id) {
      throw new Error('Coding Agent can only run on the current workflow node')
    }
    if (!canRunCodingAgentOnNode(node)) {
      throw new Error('Coding Agent can only run from a build task node')
    }
    if (node.status !== 'running' && node.status !== 'failed') {
      throw new Error('Coding Agent build node must be running or failed')
    }

    const expectedRunStatus = node.status === 'failed' ? 'failed' : 'building'
    if (run.status !== expectedRunStatus) {
      throw new Error(
        `Coding workflow invariant violation: run status ${run.status} does not match ${node.status} build node ${node.id}`,
      )
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

  function runBestEffortNotification(callback: () => void): void {
    try {
      callback()
    } catch {
      // Durable Coding Agent state must not be rolled back or misclassified by UI/timer notifications.
    }
  }

  async function saveEvents(events: CodingAgentEvent[]) {
    for (const event of events) {
      const safeEvent = redactCodingAgentEventForStorage(event)
      await deps.store.saveCodingAgentEvent(safeEvent)
      runBestEffortNotification(() => deps.publisher?.publishEvent(safeEvent))
    }
  }

  async function saveCodingRun(run: CodingAgentRun) {
    await deps.store.saveCodingAgentRun(run)
    runBestEffortNotification(() => deps.publisher?.publishRunStatus(run))
  }

  async function commitCodingAgentMutation(
    mutation: CodingAgentMutation,
  ): Promise<CodingAgentMutationResult> {
    const safeEvents = mutation.events?.map((event) => redactCodingAgentEventForStorage(event))
    const result = await deps.store.commitCodingAgentMutation({
      ...mutation,
      ...(safeEvents ? { events: safeEvents } : {}),
    })
    if (!result.committed) {
      return result
    }
    if (mutation.run) {
      runBestEffortNotification(() => deps.publisher?.publishRunStatus(mutation.run!))
    }
    for (const event of safeEvents ?? []) {
      runBestEffortNotification(() => deps.publisher?.publishEvent(event))
    }
    for (const request of mutation.permissionRequests ?? []) {
      publishPermissionRequest(request)
    }
    return result
  }

  function publishPermissionRequest(request: CodingPermissionRequest) {
    runBestEffortNotification(() => deps.publisher?.publishPermission(request))
    if (request.status === 'pending') {
      runBestEffortNotification(() => {
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
      })
    }
  }

  async function savePermissionRequest(request: CodingPermissionRequest) {
    await deps.store.saveCodingPermissionRequest(request)
    publishPermissionRequest(request)
  }

  async function nextSequence(codingRunId: string): Promise<number> {
    return (await deps.store.listCodingAgentEvents(codingRunId)).length + 1
  }

  async function mapObservableExecutorEvents(
    requestId: string,
    events: CodingAgentEvent[],
  ): Promise<CodingAgentEvent[]> {
    let sequence = await nextSequence(requestId)
    return events.map((event) => ({
      ...event,
      sequence: sequence++,
      metadata: {
        ...event.metadata,
        codingExecutorRequestId: requestId,
        codingExecutorEventType:
          event.kind === 'permission'
            ? 'permission_request'
            : event.kind === 'tool_call'
              ? 'tool_request'
              : event.kind === 'tool_result'
                ? 'tool_result'
                : event.kind === 'diff' || event.kind === 'test' || event.kind === 'bootstrap'
                  ? 'evidence'
                  : event.kind === 'error'
                    ? 'observation'
                    : 'observation',
      },
    }))
  }

  async function loadExecutorContinuationState(codingRunId: string): Promise<{
    previousCheckpointVersion: number
    previousSequence: number
    settledPermissionRequestIds: string[]
  }> {
    let previousCheckpointVersion = 0
    let previousSequence = 0
    const settledPermissionRequestIds: string[] = []
    const events = await deps.store.listCodingAgentEvents(codingRunId)
    for (const event of events) {
      const value = event.metadata?.codingExecutorTurn
      if (value === undefined) continue
      const turn = parseCodingExecutorTurn(value, {
        expectedRequestId: codingRunId,
        previousCheckpointVersion,
        previousSequence,
        settledPermissionRequestIds,
      })
      previousCheckpointVersion = turn.checkpointVersion
      previousSequence = turn.events.at(-1)!.sequence
      if (turn.status === 'waiting_permission') {
        settledPermissionRequestIds.push(turn.permissionRequest.id)
      }
    }
    return { previousCheckpointVersion, previousSequence, settledPermissionRequestIds }
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
    const referencedChunkIds = new Set(
      knowledgeReferences.flatMap((reference) => reference.chunkId ? [reference.chunkId] : []),
    )

    return {
      upstreamArtifacts: artifacts.filter((artifact) => artifact.nodeId !== node.id),
      knowledgeReferences,
      knowledgeChunks: knowledgeChunks.filter((chunk) => referencedChunkIds.has(chunk.id)),
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
    const command =
      input.codingRun.engine === 'fake'
        ? FAKE_CODING_MARKER_TEST_COMMAND
        : input.project.testCommand.trim()
    if (!deps.runTestCommand || !command) {
      return { codingRun: input.codingRun }
    }

    const safeCommand = redactSecrets(redactLocalAbsolutePaths(command).value)
    const startedEvent: CodingAgentEvent = {
      id: idGenerator('coding-event'),
      codingRunId: input.codingRun.id,
      runId: input.codingRun.runId,
      nodeId: input.codingRun.nodeId,
      sequence: await nextSequence(input.codingRun.id),
      kind: 'test',
      message: `Running coding worktree tests: ${safeCommand.value}`,
      timestamp: input.timestamp,
      redacted: true,
    }
    await saveEvents([startedEvent])

    const result = await deps.runTestCommand({
      command,
      cwd: input.workspace.worktreePath,
      timeoutMs: deps.testTimeoutMs ?? 120_000,
    })
    const evidence: TestEvidence = redactTestEvidenceForStorage({
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
    })
    const artifact = createTestEvidenceArtifact(evidence)
    const agentEvent = createTestEvidenceEvent(evidence, await nextAgentEventSequence(evidence.runId))
    const completedEvent: CodingAgentEvent = {
      id: idGenerator('coding-event'),
      codingRunId: input.codingRun.id,
      runId: input.codingRun.runId,
      nodeId: input.codingRun.nodeId,
      sequence: await nextSequence(input.codingRun.id),
      kind: 'test',
      message: `Coding worktree tests ${result.status}: ${evidence.summary}`,
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
          : `${input.codingRun.summary} Test evidence ${result.status}: ${evidence.summary}`,
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

  async function cleanupWorkspaceForRun(
    codingRun: CodingAgentRun,
    timestamp: string,
  ): Promise<CodingExecutorTerminalResult['cleanup']> {
    if (!codingRun.managedWorkspaceId) {
      return { status: 'not_required', reasonCode: null }
    }
    let workspace: ManagedCodingWorkspace
    try {
      workspace = await findWorkspace(codingRun.managedWorkspaceId, codingRun.projectId)
    } catch {
      return { status: 'failed', reasonCode: 'workspace_state_unavailable' }
    }

    let cleaned: ManagedCodingWorkspace
    if (deps.cleanupWorkspace) {
      try {
        cleaned = await deps.cleanupWorkspace({
          workspaceId: workspace.id,
          projectId: workspace.projectId,
        })
      } catch (error) {
        cleaned = {
          ...workspace,
          deletedAt: timestamp,
          cleanupStatus: 'cleanup_failed',
          cleanupError: cleanupErrorSummary(error),
        }
        await deps.store.saveManagedCodingWorkspace(cleaned)
      }
    } else {
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
    }
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
    return status === 'deleted'
      ? { status: 'completed', reasonCode: null }
      : { status: 'failed', reasonCode: 'workspace_cleanup_unconfirmed' }
  }

  async function buildCodingExecutorTerminalEvent(input: {
    codingRun: CodingAgentRun
    stopReason: CodingExecutorTerminalResult['stopReason']
    cleanup: CodingExecutorTerminalResult['cleanup']
    timestamp: string
  }): Promise<CodingAgentEvent> {
    const usage = input.codingRun.runtimeCostSummary
    const continuationState = await loadExecutorContinuationState(input.codingRun.id)
    const finalCheckpointVersion = continuationState.previousCheckpointVersion + 1
    const terminalResult = parseCodingExecutorTerminalResult({
      stateVersion: CODING_EXECUTOR_CONTRACT_VERSION,
      requestId: input.codingRun.id,
      stopReason: input.stopReason,
      executor: {
        id: executor.descriptor.id,
        version: executor.descriptor.version,
        kind: executor.descriptor.kind,
      },
      finalCheckpointVersion,
      changedPaths: [...input.codingRun.changedPaths].sort(),
      diffArtifactId: input.codingRun.diffArtifactId ?? null,
      testEvidenceIds: input.codingRun.testEvidenceId ? [input.codingRun.testEvidenceId] : [],
      usage: {
        tokens: usage ? usage.inputTokens + usage.outputTokens + usage.cacheReadTokens : 0,
        costUsd: usage?.costUsd ?? 0,
      },
      cleanup: input.cleanup,
      completedAt: input.timestamp,
    })
    const terminalTurn = parseCodingExecutorTurn(
      {
        stateVersion: CODING_EXECUTOR_CONTRACT_VERSION,
        requestId: input.codingRun.id,
        status: 'terminal',
        checkpointVersion: finalCheckpointVersion,
        events: [
          ...(continuationState.previousSequence === 0
            ? [
                {
                  stateVersion: CODING_EXECUTOR_CONTRACT_VERSION,
                  requestId: input.codingRun.id,
                  sequence: 1,
                  checkpointVersion: 0,
                  type: 'started' as const,
                  createdAt: input.codingRun.startedAt,
                  metadata: {
                    executorId: executor.descriptor.id,
                    executorVersion: executor.descriptor.version,
                  },
                },
              ]
            : []),
          {
            stateVersion: CODING_EXECUTOR_CONTRACT_VERSION,
            requestId: input.codingRun.id,
            sequence:
              continuationState.previousSequence +
              (continuationState.previousSequence === 0 ? 2 : 1),
            checkpointVersion: finalCheckpointVersion,
            type: 'terminal' as const,
            createdAt: input.timestamp,
            metadata: { stopReason: input.stopReason },
          },
        ],
        terminalResult,
      },
      {
        expectedRequestId: input.codingRun.id,
        previousCheckpointVersion: continuationState.previousCheckpointVersion,
        previousSequence: continuationState.previousSequence,
        settledPermissionRequestIds: continuationState.settledPermissionRequestIds,
      },
    )
    return {
      id: idGenerator('coding-event'),
      codingRunId: input.codingRun.id,
      runId: input.codingRun.runId,
      nodeId: input.codingRun.nodeId,
      sequence: await nextSequence(input.codingRun.id),
      kind: 'status',
      message: 'Coding Executor reached a governed terminal result.',
      timestamp: input.timestamp,
      metadata: {
        codingExecutorEventType: 'terminal',
        codingExecutorTurn: terminalTurn,
        codingExecutorTerminalResult: terminalResult,
      },
      redacted: true,
    }
  }

  function cleanupErrorSummary(error: unknown): string {
    const message = error instanceof Error && error.message.trim()
      ? error.message
      : typeof error === 'string' && error.trim()
        ? error
        : 'Workspace cleanup failed.'
    return redactSensitiveText(redactLocalAbsolutePaths(message).value).value.slice(0, 500)
  }

  async function timeOutCodingRun(codingRunId: string, summary: string) {
    let expectedRun = await findCodingRun(codingRunId)
    if (!activeCodingStatuses.has(expectedRun.status)) {
      return
    }
    const timestamp = now()
    await executor.cancel({ codingRun: expectedRun })
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (!activeCodingStatuses.has(expectedRun.status)) {
        return
      }
      const pendingRequests = (await deps.store.listCodingPermissionRequests(codingRunId)).filter(
        (request) => request.status === 'pending',
      )
      const expiredRequests = pendingRequests.map((request) => ({ ...request, status: 'expired' as const }))
      const decisions: CodingPermissionDecision[] = pendingRequests.map((request) => ({
        id: idGenerator('coding-permission-decision'),
        requestId: request.id,
        codingRunId,
        decidedBy: 'devflow-timeout',
        decision: 'expired',
        comment: summary,
        decidedAt: timestamp,
      }))
      const updated: CodingAgentRun = {
        ...expectedRun,
        status: 'timed_out',
        summary,
        completedAt: timestamp,
      }
      const toolResultEvents: CodingAgentEvent[] = []
      let sequence = await nextSequence(updated.id)
      for (const request of pendingRequests) {
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
      const committed = await commitCodingAgentMutation({
        expectedRun,
        run: updated,
        expectedPendingPermissionRequestIds: pendingRequests.map((request) => request.id),
        expectedPermissionRequests: pendingRequests,
        permissionRequests: expiredRequests,
        permissionDecisions: decisions,
        events: [...toolResultEvents, event],
      })
      if (committed.committed) {
        const cleanup = await cleanupWorkspaceForRun(updated, timestamp)
        await saveEvents([
          await buildCodingExecutorTerminalEvent({
            codingRun: updated,
            stopReason: 'timeout',
            cleanup,
            timestamp,
          }),
        ])
        return
      }
      if (!committed.run) {
        throw new Error(`Coding Agent run not found: ${codingRunId}`)
      }
      expectedRun = committed.run
    }
    throw new Error('Coding Agent timeout could not settle concurrent state changes')
  }

  async function settleCompletedExecutorResult(input: {
    expectedRun: CodingAgentRun
    completed: CodingExecutorCompletedResult
    workspace: ManagedCodingWorkspace
    project: LocalProject
    timestamp: string
  }): Promise<boolean> {
    const { completedAt: engineCompletedAt, ...completedRunFields } = input.completed.codingRun
    const bootstrappingRun: CodingAgentRun = {
      ...completedRunFields,
      status: 'bootstrapping',
    }
    const observableEvents = await mapObservableExecutorEvents(
      bootstrappingRun.id,
      input.completed.events,
    )
    const engineResultCommitted = await commitCodingAgentMutation({
      expectedRun: input.expectedRun,
      expectedPendingPermissionRequestIds: [],
      run: bootstrappingRun,
      events: observableEvents,
      diffArtifacts: [input.completed.diff],
    })
    if (!engineResultCommitted.committed) {
      return false
    }
    const bootstrapped = await runCodingBootstrap({
      codingRun: bootstrappingRun,
      workspace: input.workspace,
      project: input.project,
      timestamp: input.timestamp,
      ...(input.completed.bootstrapEvidence
        ? { engineBootstrapEvidence: input.completed.bootstrapEvidence }
        : {}),
    })
    if (!bootstrapped.canContinue) {
      const terminalEvent = await buildCodingExecutorTerminalEvent({
        codingRun: bootstrapped.codingRun,
        stopReason: 'failure',
        cleanup: {
          status: 'not_required',
          reasonCode: 'workspace_retained_for_recovery',
        },
        timestamp: input.timestamp,
      })
      await commitCodingAgentMutation({
        expectedRun: bootstrappingRun,
        expectedPendingPermissionRequestIds: [],
        run: bootstrapped.codingRun,
        events: [terminalEvent],
      })
      return true
    }
    const { completedAt: _bootstrapCompletedAt, ...bootstrappedRunFields } = bootstrapped.codingRun
    const testingRun: CodingAgentRun = {
      ...bootstrappedRunFields,
      status: 'testing',
    }
    const testingStarted = await commitCodingAgentMutation({
      expectedRun: bootstrappingRun,
      expectedPendingPermissionRequestIds: [],
      run: testingRun,
    })
    if (!testingStarted.committed) {
      return false
    }
    const tested = await runCodingTests({
      codingRun: testingRun,
      workspace: input.workspace,
      project: input.project,
      timestamp: input.timestamp,
    })
    const terminalCompletedAt = engineCompletedAt ?? input.timestamp
    const completedRun: CodingAgentRun = {
      ...tested.codingRun,
      status: 'completed',
      completedAt: terminalCompletedAt,
    }
    const terminalEvent = await buildCodingExecutorTerminalEvent({
      codingRun: completedRun,
      stopReason: 'success',
      cleanup: {
        status: 'not_required',
        reasonCode: 'workspace_retained_for_delivery',
      },
      timestamp: terminalCompletedAt,
    })
    const completionCommitted = await commitCodingAgentMutation({
      expectedRun: testingRun,
      expectedPendingPermissionRequestIds: [],
      run: completedRun,
      events: [terminalEvent],
    })
    if (!completionCommitted.committed) {
      return false
    }
    try {
      await deps.completeWorkflowBuild?.({
        runId: completedRun.runId,
        nodeId: completedRun.nodeId,
        codingRunId: completedRun.id,
        diffId: input.completed.diff.id,
        now: input.timestamp,
      })
    } catch (error) {
      const detail =
        error instanceof Error && error.message.trim()
          ? error.message
          : 'Unknown workflow runtime error'
      throw new Error(`Workflow build completion failed: ${detail}`, {
        cause: error,
      })
    }
    return true
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
    const codingRun = await findCodingRun(input.codingRunId)
    if (!activeCodingStatuses.has(codingRun.status) || request.status !== 'pending') {
      return request
    }
    const claimed = await commitCodingAgentMutation({
      expectedRun: codingRun,
      expectedPendingPermissionRequestIds: [request.id],
      expectedPermissionRequests: [request],
      permissionRequests: [updatedRequest],
      permissionDecisions: [decision],
    })
    if (!claimed.committed) {
      return (await deps.store.listCodingPermissionRequests(input.codingRunId)).find(
        (candidate) => candidate.id === input.requestId,
      ) ?? request
    }

    if (input.decision === 'approved') {
      if (!codingRun.managedWorkspaceId) {
        throw new Error(`Coding Agent run has no managed workspace: ${codingRun.id}`)
      }
      const workspace = await findWorkspace(codingRun.managedWorkspaceId, codingRun.projectId)
      const project = await findProject(codingRun.projectId)
      const continuationState = await loadExecutorContinuationState(codingRun.id)
      let completed
      try {
        completed = await executor.continuePermission({
          requestId: codingRun.id,
          ...continuationState,
          runtimeContext: {
            request: updatedRequest,
            codingRun,
            workspace,
            project,
            now: timestamp,
          },
        })
      } catch (error) {
        const currentRun = await findCodingRun(codingRun.id)
        if (!activeCodingStatuses.has(currentRun.status)) {
          throw error
        }
        if (error instanceof CodingEngineContinuationCleanupError) {
          await recordContinuationCleanupFailure(currentRun, timestamp)
          throw error
        }
        try {
          await executor.cancel({ codingRun: currentRun })
        } catch (cleanupError) {
          await recordContinuationCleanupFailure(currentRun, timestamp)
          throw new CodingEngineContinuationCleanupError([error, cleanupError])
        }

        const failedRun: CodingAgentRun = {
          ...currentRun,
          status: 'failed',
          summary: 'Coding engine failed after permission approval.',
          completedAt: timestamp,
        }
        const failedEvent: CodingAgentEvent = {
          id: idGenerator('coding-event'),
          codingRunId: failedRun.id,
          runId: failedRun.runId,
          nodeId: failedRun.nodeId,
          sequence: await nextSequence(failedRun.id),
          kind: 'error',
          message: failedRun.summary,
          timestamp,
          redacted: true,
        }
        const committed = await commitCodingAgentMutation({
          expectedRun: currentRun,
          expectedPendingPermissionRequestIds: [],
          run: failedRun,
          events: [failedEvent],
        })
        if (committed.committed) {
          const cleanup = await cleanupWorkspaceForRun(failedRun, timestamp)
          await saveEvents([
            await buildCodingExecutorTerminalEvent({
              codingRun: failedRun,
              stopReason: 'failure',
              cleanup,
              timestamp,
            }),
          ])
        }
        throw error
      }
      if (completed.kind === 'waiting_permission') {
        const continuationEvents = (await mapObservableExecutorEvents(
          completed.codingRun.id,
          completed.events,
        )).map((event) =>
          event.kind === 'permission'
            ? {
                ...event,
                metadata: { ...event.metadata, codingExecutorTurn: completed.turn },
              }
            : event,
        )
        const continuationCommitted = await commitCodingAgentMutation({
          expectedRun: codingRun,
          expectedPendingPermissionRequestIds: [],
          run: completed.codingRun,
          events: continuationEvents,
          permissionRequests: [completed.permissionRequest],
        })
        if (!continuationCommitted.committed) {
          const persistenceError = new Error(
            'Coding Agent continuation could not be persisted safely.',
          )
          try {
            await executor.cancel({ codingRun: completed.codingRun })
          } catch (cleanupError) {
            if (continuationCommitted.run && activeCodingStatuses.has(continuationCommitted.run.status)) {
              await recordContinuationCleanupFailure(continuationCommitted.run, timestamp)
            }
            throw new CodingEngineContinuationCleanupError([persistenceError, cleanupError])
          }
          if (continuationCommitted.run && activeCodingStatuses.has(continuationCommitted.run.status)) {
            const cleanup = await cleanupWorkspaceForRun(continuationCommitted.run, timestamp)
            await failActiveCodingRun(
              continuationCommitted.run,
              'Coding Agent continuation could not be persisted safely.',
              timestamp,
              cleanup,
            )
          }
          throw persistenceError
        }
        return updatedRequest
      }
      await settleCompletedExecutorResult({
        expectedRun: codingRun,
        completed,
        workspace,
        project,
        timestamp,
      })
    } else {
      await executor.cancel({ codingRun })
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
      const committed = await commitCodingAgentMutation({
        expectedRun: codingRun,
        expectedPendingPermissionRequestIds: [],
        run: updatedRun,
        events: [event, toolResultEvent],
      })
      if (committed.committed) {
        const cleanup = await cleanupWorkspaceForRun(updatedRun, timestamp)
        await saveEvents([
          await buildCodingExecutorTerminalEvent({
            codingRun: updatedRun,
            stopReason: input.decision === 'expired' ? 'timeout' : 'cancelled',
            cleanup,
            timestamp,
          }),
        ])
      }
    }

    return updatedRequest
  }

  async function recordContinuationCleanupFailure(
    codingRun: CodingAgentRun,
    timestamp: string,
  ): Promise<void> {
    if (!activeCodingStatuses.has(codingRun.status)) {
      return
    }
    const summary = 'Coding engine failed after permission approval and session cleanup did not complete.'
    const event: CodingAgentEvent = {
      id: idGenerator('coding-event'),
      codingRunId: codingRun.id,
      runId: codingRun.runId,
      nodeId: codingRun.nodeId,
      sequence: await nextSequence(codingRun.id),
      kind: 'error',
      message: summary,
      timestamp,
      metadata: { sessionCleanupStatus: 'cleanup_failed' },
      redacted: true,
    }
    await commitCodingAgentMutation({
      expectedRun: codingRun,
      expectedPendingPermissionRequestIds: [],
      events: [event],
    })
  }

  async function failActiveCodingRun(
    expectedRun: CodingAgentRun,
    summary: string,
    timestamp: string,
    cleanup: CodingExecutorTerminalResult['cleanup'],
  ): Promise<CodingAgentMutationResult> {
    const failedRun: CodingAgentRun = {
      ...expectedRun,
      status: 'failed',
      summary,
      completedAt: timestamp,
    }
    const event: CodingAgentEvent = {
      id: idGenerator('coding-event'),
      codingRunId: failedRun.id,
      runId: failedRun.runId,
      nodeId: failedRun.nodeId,
      sequence: await nextSequence(failedRun.id),
      kind: 'error',
      message: summary,
      timestamp,
      redacted: true,
    }
    const committed = await commitCodingAgentMutation({
      expectedRun,
      expectedPendingPermissionRequestIds: [],
      run: failedRun,
      events: [event],
    })
    if (committed.committed) {
      await saveEvents([
        await buildCodingExecutorTerminalEvent({
          codingRun: committed.run,
          stopReason: 'failure',
          cleanup,
          timestamp,
        }),
      ])
    }
    return committed
  }

  async function recordActiveCleanupFailure(
    expectedRun: CodingAgentRun,
    timestamp: string,
    summary: string,
  ): Promise<void> {
    const event: CodingAgentEvent = {
      id: idGenerator('coding-event'),
      codingRunId: expectedRun.id,
      runId: expectedRun.runId,
      nodeId: expectedRun.nodeId,
      sequence: await nextSequence(expectedRun.id),
      kind: 'error',
      message: summary,
      timestamp,
      metadata: { sessionCleanupStatus: 'cleanup_failed' },
      redacted: true,
    }
    await commitCodingAgentMutation({
      expectedRun,
      expectedPendingPermissionRequestIds: [],
      events: [event],
    })
  }

  return {
    async ensureCodingEngine(input) {
      const project = await findProject(input.projectId)
      return executor.ensure({ project })
    },

    async listCodingAgentRuns(input = {}) {
      return deps.store.listCodingAgentRuns(input.runId)
    },

    async runCodingAgent(input) {
      const run = await findRun(input.runId)
      const node = validateCodingWorkflowContext(run, input)
      const project = await findProject(input.projectId)
      const requiredCapabilities = requiredCapabilitiesForExecutor(executor)
      selectCodingExecutor({
        descriptors: [executor.descriptor],
        executorId: executor.descriptor.id,
        executorVersion: executor.descriptor.version,
        requiredCapabilities,
      })
      const active = findActiveCodingRun(await deps.store.listCodingAgentRuns(), input.projectId)
      if (active) {
        throw new Error(`Coding Agent run already active for this project: ${active.id}`)
      }

      if (executor.engine === 'not-configured') {
        await executor.ensure({ project })
        throw new Error('Coding Agent engine did not report a configured runtime after ensure.')
      }
      const configuredEngine = executor.engine
      const providerId = executor.providerId
      const codingRunId = idGenerator('coding-run')
      const briefContext = await loadCodingBriefContext(run, node)
      const model = executor.modelId ?? providerId
      const canonicalBrief = buildCodingBrief({
        run,
        node,
        project,
        ...briefContext,
        userInstruction: input.userInstruction,
        worktreePath: '<managed-worktree-created-after-budget-approval>',
        branchName: '<managed-branch-created-after-budget-approval>',
        ...(input.remediationPlan ? { remediationPlan: input.remediationPlan } : {}),
        ...(input.retryAttempt ? { retryAttempt: input.retryAttempt } : {}),
      })
      const estimatedCost = estimateCodingRuntimeCost({
        engine: configuredEngine,
        providerId,
        model,
        prompt: canonicalBrief.prompt,
        runId: run.id,
        nodeId: node.id,
        projectId: project.id,
        userId: input.requestedBy,
        timestamp: now(),
      })
      const budgetDecision = deps.budgetGuard
        ? await deps.budgetGuard({
            codingRunId,
            engine: configuredEngine,
            providerId,
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
        : configuredEngine === 'fake'
          ? {
              status: 'disabled',
              blocksRun: false,
              currentSpendUsd: 0,
              projectedCostUsd: estimatedCost.costUsd,
              reason: 'Runtime budget guard is skipped for a verified no-cost provider run.',
            } satisfies BudgetGuardDecision
          : {
              status: 'unavailable',
              blocksRun: true,
              currentSpendUsd: 0,
              projectedCostUsd: estimatedCost.costUsd,
              reason: 'Runtime budget guard is unavailable for this paid provider run.',
            } satisfies BudgetGuardDecision

      if (budgetDecision.blocksRun) {
        const timestamp = now()
        const safeBudgetDecision = {
          ...budgetDecision,
          reason: redactSensitiveText(budgetDecision.reason).value,
        }
        const summary = safeBudgetDecision.status === 'requires_lead_approval'
          ? `Runtime budget requires lead approval before calling ${configuredEngine}; the paid provider was not called. ${safeBudgetDecision.reason}`
          : safeBudgetDecision.status === 'unavailable'
            ? `Authoritative runtime budget decision is unavailable before calling ${configuredEngine}; the paid provider was not called. ${safeBudgetDecision.reason}`
            : `Runtime budget blocked the call to ${configuredEngine}; the paid provider was not called. ${safeBudgetDecision.reason}`
        const blockedRun: CodingAgentRun = {
          id: codingRunId,
          runId: run.id,
          nodeId: node.id,
          projectId: project.id,
          requestedBy: input.requestedBy,
          providerId,
          engine: configuredEngine,
          status: 'failed',
          branchName: run.branchName,
          userInstruction: input.userInstruction.trim(),
          prompt: canonicalBrief.prompt,
          summary,
          changedPaths: [],
          startedAt: timestamp,
          completedAt: timestamp,
          runtimeCostSummary: estimatedCost,
          budgetDecision: safeBudgetDecision,
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
            budgetStatus: safeBudgetDecision.status,
            projectedCostUsd: safeBudgetDecision.projectedCostUsd,
            limitUsd: safeBudgetDecision.limitUsd,
            approvalRequiredRole: safeBudgetDecision.approvalRequiredRole,
          },
          redacted: true,
        }
        await saveCodingRun(blockedRun)
        await saveEvents([event])
        await saveEvents([
          await buildCodingExecutorTerminalEvent({
            codingRun: blockedRun,
            stopReason: 'policy_denied',
            cleanup: {
              status: 'not_required',
              reasonCode: 'side_effects_not_started',
            },
            timestamp,
          }),
        ])
        return {
          codingRun: blockedRun,
          state: await deps.store.loadState(),
        }
      }
      const reservationTimestamp = now()
      const reservationRun: CodingAgentRun = {
        id: codingRunId,
        runId: run.id,
        nodeId: node.id,
        projectId: project.id,
        requestedBy: input.requestedBy,
        providerId,
        engine: configuredEngine,
        status: 'preparing',
        branchName: run.branchName,
        userInstruction: input.userInstruction.trim(),
        prompt: canonicalBrief.prompt,
        summary: 'Preparing a managed Coding Agent run.',
        changedPaths: [],
        startedAt: reservationTimestamp,
        runtimeCostSummary: estimatedCost,
        budgetDecision,
        redacted: true,
      }
      const reservation = await deps.store.reserveCodingAgentRun(reservationRun)
      if (!reservation.reserved) {
        throw new Error(`Coding Agent run already active for this project: ${reservation.run.id}`)
      }
      runBestEffortNotification(() => deps.publisher?.publishRunStatus(reservationRun))

      try {
        await executor.ensure({ project })
      } catch (error) {
        await failActiveCodingRun(
          reservationRun,
          'Coding engine readiness failed before the managed run started.',
          reservationTimestamp,
          { status: 'not_required', reasonCode: 'side_effects_not_started' },
        )
        throw error
      }

      let workspace: ManagedCodingWorkspace
      try {
        workspace = await createWorkspace({
          project,
          codingRunId,
          runId: run.id,
          nodeId: node.id,
          ...(deps.worktreeRoot ? { worktreeRoot: deps.worktreeRoot } : {}),
        })
      } catch (error) {
        await failActiveCodingRun(
          reservationRun,
          'Managed coding workspace creation failed.',
          reservationTimestamp,
          { status: 'not_required', reasonCode: 'workspace_not_registered' },
        )
        throw error
      }
      const workspacePreparingRun: CodingAgentRun = {
        ...reservationRun,
        managedWorkspaceId: workspace.id,
        branchName: workspace.branchName,
      }
      try {
        await deps.store.saveManagedCodingWorkspace(workspace)
      } catch (error) {
        let cleaned: ManagedCodingWorkspace
        let cleanupFailure: unknown
        try {
          cleaned = await deleteWorkspace(workspace)
        } catch (caughtCleanupFailure) {
          cleanupFailure = caughtCleanupFailure
          cleaned = {
            ...workspace,
            cleanupStatus: 'cleanup_failed',
            cleanupError: cleanupErrorSummary(caughtCleanupFailure),
          }
        }
        const cleanupStatus = cleaned.cleanupStatus ?? (cleaned.deletedAt ? 'deleted' : 'active')
        if (cleanupStatus !== 'deleted' && !cleanupFailure) {
          cleanupFailure = new Error('Managed coding workspace cleanup failed.')
          cleaned = {
            ...cleaned,
            cleanupStatus: 'cleanup_failed',
            cleanupError: cleaned.cleanupError ?? 'Managed coding workspace cleanup failed.',
          }
        }
        let recoveryRun = reservationRun
        let recoveryFailure: unknown
        try {
          await deps.store.saveManagedCodingWorkspace(cleaned)
          const linked = await commitCodingAgentMutation({
            expectedRun: reservationRun,
            expectedPendingPermissionRequestIds: [],
            run: workspacePreparingRun,
          })
          if (linked.committed) {
            recoveryRun = workspacePreparingRun
          } else {
            recoveryFailure = new Error('Coding Agent reservation changed during workspace recovery.')
          }
        } catch (caughtRecoveryFailure) {
          recoveryFailure = caughtRecoveryFailure
        }
        if (cleanupStatus !== 'deleted') {
          await recordActiveCleanupFailure(
            recoveryRun,
            reservationTimestamp,
            'Managed coding workspace registration and cleanup did not complete.',
          )
          throw new AggregateError(
            [error, cleanupFailure, recoveryFailure].filter((failure) => failure !== undefined),
            'coding workspace registration failed and cleanup did not complete',
          )
        }
        await failActiveCodingRun(
          recoveryRun,
          'Managed coding workspace registration failed.',
          reservationTimestamp,
          { status: 'completed', reasonCode: null },
        )
        if (recoveryFailure) {
          throw new AggregateError(
            [error, recoveryFailure],
            'coding workspace registration failed after physical cleanup',
          )
        }
        throw error
      }
      let workspaceLinked: CodingAgentMutationResult
      try {
        workspaceLinked = await commitCodingAgentMutation({
          expectedRun: reservationRun,
          expectedPendingPermissionRequestIds: [],
          run: workspacePreparingRun,
        })
      } catch (linkError) {
        let cleaned: ManagedCodingWorkspace
        let cleanupFailure: unknown
        try {
          cleaned = await deleteWorkspace(workspace)
        } catch (error) {
          cleanupFailure = error
          cleaned = {
            ...workspace,
            cleanupStatus: 'cleanup_failed',
            cleanupError: cleanupErrorSummary(error),
          }
        }
        let cleanupPersistenceFailure: unknown
        try {
          await deps.store.saveManagedCodingWorkspace(cleaned)
        } catch (error) {
          cleanupPersistenceFailure = error
        }
        const cleanupStatus = cleaned.cleanupStatus ?? (cleaned.deletedAt ? 'deleted' : 'active')
        if (cleanupStatus === 'deleted') {
          const currentRun = await findCodingRun(reservationRun.id)
          if (activeCodingStatuses.has(currentRun.status)) {
            await failActiveCodingRun(
              currentRun,
              'Managed coding workspace registration failed.',
              reservationTimestamp,
              { status: 'completed', reasonCode: null },
            )
          }
          if (cleanupPersistenceFailure) {
            throw new AggregateError(
              [linkError, cleanupPersistenceFailure],
              'coding workspace link failed after physical cleanup',
            )
          }
          throw linkError
        }
        let recoveryFailure: unknown
        try {
          const recovered = await commitCodingAgentMutation({
            expectedRun: reservationRun,
            expectedPendingPermissionRequestIds: [],
            run: workspacePreparingRun,
          })
          if (recovered.committed) {
            await recordActiveCleanupFailure(
              workspacePreparingRun,
              reservationTimestamp,
              'Managed coding workspace registration and cleanup did not complete.',
            )
          } else {
            recoveryFailure = new Error('Coding Agent reservation changed during workspace recovery.')
          }
        } catch (error) {
          recoveryFailure = error
        }
        throw new AggregateError(
          [linkError, cleanupFailure, cleanupPersistenceFailure, recoveryFailure].filter(
            (failure) => failure !== undefined,
          ),
          'coding workspace link and cleanup did not complete',
        )
      }
      if (!workspaceLinked.committed) {
        let cleaned: ManagedCodingWorkspace
        let cleanupFailure: unknown
        try {
          cleaned = await deleteWorkspace(workspace)
        } catch (error) {
          cleanupFailure = error
          cleaned = {
            ...workspace,
            cleanupStatus: 'cleanup_failed',
            cleanupError: cleanupErrorSummary(error),
          }
        }
        await deps.store.saveManagedCodingWorkspace(cleaned)
        if ((cleaned.cleanupStatus ?? (cleaned.deletedAt ? 'deleted' : 'active')) !== 'deleted') {
          throw new AggregateError(
            [
              new Error('Coding Agent reservation changed before workspace registration completed'),
              cleanupFailure ?? new Error('Managed coding workspace cleanup failed.'),
            ],
            'coding reservation changed and workspace cleanup did not complete',
          )
        }
        throw new Error('Coding Agent reservation changed before workspace registration completed')
      }
      const engineBriefContext = {
        upstreamArtifacts: briefContext.upstreamArtifacts,
        knowledgeReferences: briefContext.knowledgeReferences,
        governanceChecks: briefContext.governanceChecks,
        gateDecisions: briefContext.gateDecisions,
        testEvidence: briefContext.testEvidence,
      }
      const executorRequest = parseCodingExecutorRequest({
        stateVersion: CODING_EXECUTOR_CONTRACT_VERSION,
        id: codingRunId,
        executor: {
          id: executor.descriptor.id,
          version: executor.descriptor.version,
        },
        scope: {
          organizationId: null,
          projectId: null,
          userId: input.requestedBy,
          sessionId: `coding-session-${codingRunId}`,
          localProjectId: project.id,
          managedWorkspaceId: workspace.id,
        },
        authority: {
          runId: run.id,
          nodeId: node.id,
          runVersion: run.version,
          policyVersion: input.remediationPlan?.policyVersion ?? run.version,
        },
        objectiveDigest: createHash('sha256')
          .update(input.userInstruction.trim(), 'utf8')
          .digest('hex'),
        contextDigest: createHash('sha256')
          .update(canonicalBrief.prompt, 'utf8')
          .digest('hex'),
        requiredCapabilities,
        budget: {
          maxTokens:
            estimatedCost.inputTokens +
            estimatedCost.outputTokens +
            estimatedCost.cacheReadTokens,
          maxCostUsd: budgetDecision.limitUsd ?? budgetDecision.projectedCostUsd,
        },
        expectedCheckpointVersion: 0,
        requestedAt: reservationTimestamp,
        deadline: new Date(Date.parse(reservationTimestamp) + 15 * 60_000).toISOString(),
      })
      const selection = {
        stateVersion: CODING_EXECUTOR_CONTRACT_VERSION,
        id: executor.descriptor.id,
        version: executor.descriptor.version,
        kind: executor.descriptor.kind,
        capabilities: executor.descriptor.capabilities.join(','),
        requestId: executorRequest.id,
        objectiveDigest: executorRequest.objectiveDigest,
        contextDigest: executorRequest.contextDigest,
      }
      const selectionEvent: CodingAgentEvent = {
        id: idGenerator('coding-event'),
        codingRunId,
        runId: run.id,
        nodeId: node.id,
        sequence: await nextSequence(codingRunId),
        kind: 'status',
        message: 'Coding Executor capability selection accepted.',
        timestamp: reservationTimestamp,
        metadata: {
          codingExecutorEventType: 'started',
          codingExecutorRequestId: executorRequest.id,
          codingExecutorSelection: selection,
        },
        redacted: true,
      }
      const selectionCommitted = await commitCodingAgentMutation({
        expectedRun: workspacePreparingRun,
        expectedPendingPermissionRequestIds: [],
        events: [selectionEvent],
      })
      if (!selectionCommitted.committed) {
        const cleanup = await cleanupWorkspaceForRun(
          workspacePreparingRun,
          reservationTimestamp,
        )
        await failActiveCodingRun(
          workspacePreparingRun,
          'Coding Executor selection could not be persisted safely.',
          reservationTimestamp,
          cleanup,
        )
        throw new Error('Coding Executor selection could not be persisted safely.')
      }
      let bundle
      try {
        bundle = await executor.start({
          request: executorRequest,
          runtimeContext: {
            id: codingRunId,
            run,
            node,
            project,
            workspace,
            requestedBy: input.requestedBy,
            providerId,
            userInstruction: input.userInstruction,
            now: reservationTimestamp,
            ...engineBriefContext,
            brief: canonicalBrief,
            ...(input.remediationPlan ? { remediationPlan: input.remediationPlan } : {}),
            ...(input.retryAttempt ? { retryAttempt: input.retryAttempt } : {}),
          },
        })
      } catch (error) {
        if (error instanceof CodingEngineStartupCleanupError) {
          await deps.store.saveManagedCodingWorkspace({
            ...workspace,
            cleanupStatus: 'cleanup_failed',
            cleanupError: 'Coding engine session cleanup did not complete; manual cleanup is required.',
          })
          await recordActiveCleanupFailure(
            workspacePreparingRun,
            reservationTimestamp,
            'Coding engine failed to start and session cleanup did not complete.',
          )
          throw error
        }

        let cleaned: ManagedCodingWorkspace
        try {
          cleaned = await deleteWorkspace(workspace)
        } catch (cleanupError) {
          cleaned = {
            ...workspace,
            cleanupStatus: 'cleanup_failed',
            cleanupError: cleanupErrorSummary(cleanupError),
          }
        }
        if (cleaned.cleanupStatus === 'cleanup_failed' && cleaned.cleanupError) {
          cleaned = { ...cleaned, cleanupError: cleanupErrorSummary(cleaned.cleanupError) }
        }
        await deps.store.saveManagedCodingWorkspace(cleaned)
        if ((cleaned.cleanupStatus ?? (cleaned.deletedAt ? 'deleted' : 'active')) !== 'deleted') {
          await recordActiveCleanupFailure(
            workspacePreparingRun,
            reservationTimestamp,
            'Coding engine failed to start and workspace cleanup did not complete.',
          )
          throw new AggregateError(
            [error, new Error('Managed coding workspace cleanup failed.')],
            'coding engine failed to start and workspace cleanup did not complete',
          )
        }
        await failActiveCodingRun(
          workspacePreparingRun,
          'Coding engine failed to start.',
          reservationTimestamp,
          { status: 'completed', reasonCode: null },
        )
        throw error
      }
      if (bundle.kind === 'engine_completed') {
        const completed: CodingExecutorCompletedResult = {
          ...bundle,
          codingRun: {
            ...bundle.codingRun,
            runtimeCostSummary: estimatedCost,
            budgetDecision,
          },
        }
        const settled = await settleCompletedExecutorResult({
          expectedRun: workspacePreparingRun,
          completed,
          workspace,
          project,
          timestamp: reservationTimestamp,
        })
        if (!settled) {
          await executor.cancel({ codingRun: completed.codingRun })
          const currentRun = await findCodingRun(codingRunId)
          if (activeCodingStatuses.has(currentRun.status)) {
            const cleanup = await cleanupWorkspaceForRun(currentRun, reservationTimestamp)
            await failActiveCodingRun(
              currentRun,
              'Coding Executor completion could not be persisted safely.',
              reservationTimestamp,
              cleanup,
            )
            throw new Error('Coding Executor completion could not be persisted safely.')
          }
        }
        const currentRun = await findCodingRun(codingRunId)
        return {
          codingRun: currentRun,
          state: await deps.store.loadState(),
        }
      }
      let startupRun: CodingAgentRun
      let bundleCommitted: CodingAgentMutationResult
      try {
        const startupEvents = (await mapObservableExecutorEvents(
          executorRequest.id,
          bundle.events,
        )).map((event) =>
          event.kind === 'permission'
            ? {
                ...event,
                metadata: { ...event.metadata, codingExecutorTurn: bundle.turn },
              }
            : event,
        )
        startupRun = {
          ...bundle.codingRun,
          runtimeCostSummary: estimatedCost,
          budgetDecision,
        }
        bundleCommitted = await commitCodingAgentMutation({
          expectedRun: workspacePreparingRun,
          expectedPendingPermissionRequestIds: [],
          run: startupRun,
          events: startupEvents,
          permissionRequests: [bundle.permissionRequest],
        })
      } catch (error) {
        try {
          await executor.cancel({ codingRun: workspacePreparingRun })
        } catch (cleanupError) {
          await recordActiveCleanupFailure(
            workspacePreparingRun,
            reservationTimestamp,
            'Coding engine started, but persistence and session cleanup did not complete.',
          )
          throw new CodingEngineContinuationCleanupError([error, cleanupError])
        }
        const cleanup = await cleanupWorkspaceForRun(workspacePreparingRun, reservationTimestamp)
        await failActiveCodingRun(
          workspacePreparingRun,
          'Coding engine started, but its local run bundle could not be persisted.',
          reservationTimestamp,
          cleanup,
        )
        throw error
      }
      if (!bundleCommitted.committed) {
        try {
          await executor.cancel({ codingRun: workspacePreparingRun })
        } catch (cleanupError) {
          await recordActiveCleanupFailure(
            workspacePreparingRun,
            reservationTimestamp,
            'Coding engine started, but its reservation changed and session cleanup did not complete.',
          )
          throw new CodingEngineContinuationCleanupError([
            new Error('Coding Agent startup bundle lost its reservation.'),
            cleanupError,
          ])
        }
        await cleanupWorkspaceForRun(workspacePreparingRun, reservationTimestamp)
        throw new Error('Coding Agent startup bundle lost its reservation')
      }
      runBestEffortNotification(() => {
        deps.scheduleRunTimeout?.(startupRun, async () => {
          await timeOutCodingRun(startupRun.id, 'Coding Agent run timed out.')
        })
      })

      return {
        codingRun: startupRun,
        state: await deps.store.loadState(),
      }
    },

    async startRetryAttempt(input) {
      const run = await findRun(input.runId)
      const node = validateCodingWorkflowContext(run, input)
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
      let expectedRun = await findCodingRun(input.codingRunId)
      if (!activeCodingStatuses.has(expectedRun.status)) {
        return expectedRun
      }
      await executor.cancel({ codingRun: expectedRun })
      const timestamp = now()
      for (let attempt = 0; attempt < 8; attempt += 1) {
        if (!activeCodingStatuses.has(expectedRun.status)) {
          return expectedRun
        }
        const pendingRequests = (await deps.store.listCodingPermissionRequests(expectedRun.id)).filter(
          (request) => request.status === 'pending',
        )
        const rejectedRequests = pendingRequests.map((request) => ({ ...request, status: 'rejected' as const }))
        const decisions: CodingPermissionDecision[] = pendingRequests.map((request) => ({
          id: idGenerator('coding-permission-decision'),
          requestId: request.id,
          codingRunId: expectedRun.id,
          decidedBy: 'devflow-cancel',
          decision: 'rejected',
          comment: 'Coding Agent run cancelled by user.',
          decidedAt: timestamp,
        }))
        const updated: CodingAgentRun = {
          ...expectedRun,
          status: 'cancelled',
          summary: 'Coding Agent run cancelled by user.',
          completedAt: timestamp,
        }
        let sequence = await nextSequence(updated.id)
        const toolResultEvents = pendingRequests.map((request) => createRelayToolResultEvent({
          codingRun: updated,
          request,
          timestamp,
          sequence: sequence++,
          decision: 'rejected',
          status: 'rejected',
          outputSummary: `DevFlow cancelled ${request.permission} permission with the coding run.`,
        }))
        const event: CodingAgentEvent = {
          id: idGenerator('coding-event'),
          codingRunId: updated.id,
          runId: updated.runId,
          nodeId: updated.nodeId,
          sequence,
          kind: 'status',
          message: 'Coding Agent run cancelled by user.',
          timestamp,
          redacted: true,
        }
        const committed = await commitCodingAgentMutation({
          expectedRun,
          run: updated,
          expectedPendingPermissionRequestIds: pendingRequests.map((request) => request.id),
          expectedPermissionRequests: pendingRequests,
          permissionRequests: rejectedRequests,
          permissionDecisions: decisions,
          events: [...toolResultEvents, event],
        })
        if (committed.committed) {
          const cleanup = await cleanupWorkspaceForRun(updated, timestamp)
          await saveEvents([
            await buildCodingExecutorTerminalEvent({
              codingRun: updated,
              stopReason: 'cancelled',
              cleanup,
              timestamp,
            }),
          ])
          return updated
        }
        if (!committed.run) {
          throw new Error(`Coding Agent run not found: ${input.codingRunId}`)
        }
        expectedRun = committed.run
      }
      throw new Error('Coding Agent cancellation could not settle concurrent state changes')
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
      if (deps.cleanupWorkspace) {
        return deps.cleanupWorkspace({
          workspaceId: workspace.id,
          projectId: workspace.projectId,
        })
      }
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
