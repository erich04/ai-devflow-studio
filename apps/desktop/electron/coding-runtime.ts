import { randomUUID } from 'node:crypto'
import {
  buildKnowledgeGovernanceChecks,
  buildKnowledgeReferences,
  canRunCodingAgentOnNode,
  createRemoteCodingAgentSummary,
  createTestEvidenceArtifact,
  createTestEvidenceEvent,
  knowledgeChunks as defaultKnowledgeChunks,
  knowledgeDocuments as defaultKnowledgeDocuments,
  type AgentEvent,
  type Artifact,
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
      const updatedRun: CodingAgentRun = {
        ...codingRun,
        status: 'interrupted',
        summary: `Coding Agent permission ${input.decision}; run interrupted.`,
        completedAt: timestamp,
      }
      const event: CodingAgentEvent = {
        id: idGenerator('coding-event'),
        codingRunId: updatedRun.id,
        runId: updatedRun.runId,
        nodeId: updatedRun.nodeId,
        sequence: await nextSequence(updatedRun.id),
        kind: 'permission',
        message: `Coding permission ${input.decision}; run interrupted.`,
        timestamp,
        metadata: { requestId: request.id },
        redacted: true,
      }
      await saveCodingRun(updatedRun)
      await saveEvents([event])
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

      await deps.store.saveManagedCodingWorkspace(workspace)
      await saveCodingRun(bundle.codingRun)
      await saveEvents(bundle.events)
      await savePermissionRequest(bundle.permissionRequest)

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
        status: 'interrupted',
        summary: 'Coding Agent run interrupted by user cancel.',
        completedAt: timestamp,
      }
      const event: CodingAgentEvent = {
        id: idGenerator('coding-event'),
        codingRunId: updated.id,
        runId: updated.runId,
        nodeId: updated.nodeId,
        sequence: await nextSequence(updated.id),
        kind: 'status',
        message: 'Coding Agent run interrupted by user cancel.',
        timestamp,
        redacted: true,
      }
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
