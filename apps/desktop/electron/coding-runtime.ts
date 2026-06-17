import { randomUUID } from 'node:crypto'
import {
  createRemoteCodingAgentSummary,
  type CodingAgentEvent,
  type CodingAgentRun,
  type CodingPermissionDecision,
  type CodingPermissionRequest,
  type DependencyBootstrapEvidence,
  type CodingDiffArtifact,
  type LocalExecutionState,
  type LocalProject,
  type ManagedCodingWorkspace,
  type RemoteCodingAgentSummary,
  type RemoteSyncUploadResult,
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
  saveCodingDiffArtifact(artifact: CodingDiffArtifact): Promise<void>
  loadState(): Promise<LocalExecutionState>
}

export type CodingRuntimeRemoteSync = {
  uploadCodingAgentSummary(summary: RemoteCodingAgentSummary): Promise<RemoteSyncUploadResult>
}

export type RunCodingAgentRuntimeInput = {
  runId: string
  nodeId: string
  projectId: string
  requestedBy: string
  providerId: string
  userInstruction: string
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

export type OpenManagedWorktreeRuntimeInput = {
  workspaceId: string
}

export type DeleteManagedWorktreeRuntimeInput = OpenManagedWorktreeRuntimeInput

export type CodingRuntimeDeps = {
  store: CodingRuntimeStore
  engine: CodingEngineAdapter
  remoteSync: CodingRuntimeRemoteSync
  worktreeRoot?: string
  idGenerator?: (prefix?: string) => string
  now?: () => string
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
  cancelCodingAgentRun(input: CancelCodingAgentRunRuntimeInput): Promise<CodingAgentRun>
  replyCodingPermission(input: ReplyCodingPermissionRuntimeInput): Promise<CodingPermissionRequest>
  subscribeCodingRun(input: { codingRunId: string }): Promise<LocalExecutionState>
  findManagedWorktree(input: OpenManagedWorktreeRuntimeInput): Promise<ManagedCodingWorkspace>
  deleteManagedWorktree(input: DeleteManagedWorktreeRuntimeInput): Promise<ManagedCodingWorkspace>
}

export function createCodingRuntime(deps: CodingRuntimeDeps): CodingRuntime {
  const idGenerator = deps.idGenerator ?? ((prefix = 'id') => `${prefix}-${randomUUID()}`)
  const now = deps.now ?? (() => new Date().toISOString())
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
    if (node.stage !== 'build' && node.kind !== 'task') {
      throw new Error('Coding Agent can only run from an implementation/build node')
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
    }
  }

  async function nextSequence(codingRunId: string): Promise<number> {
    return (await deps.store.listCodingAgentEvents(codingRunId)).length + 1
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
        userInstruction: input.userInstruction,
        now: now(),
      })

      await deps.store.saveManagedCodingWorkspace(workspace)
      await deps.store.saveCodingAgentRun(bundle.codingRun)
      await saveEvents(bundle.events)
      await deps.store.saveCodingPermissionRequest(bundle.permissionRequest)

      return {
        codingRun: bundle.codingRun,
        state: await deps.store.loadState(),
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
      await deps.store.saveCodingAgentRun(updated)
      await deps.store.saveCodingAgentEvent(event)
      return updated
    },

    async replyCodingPermission(input) {
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

      await deps.store.saveCodingPermissionRequest(updatedRequest)
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

        await deps.store.saveCodingAgentRun(completed.codingRun)
        await deps.store.saveDependencyBootstrapEvidence(completed.bootstrapEvidence)
        await deps.store.saveCodingDiffArtifact(completed.diff)
        await saveEvents(completed.events)
        await deps.remoteSync
          .uploadCodingAgentSummary(createRemoteCodingAgentSummary(completed.codingRun, completed.diff))
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
        await deps.store.saveCodingAgentRun(updatedRun)
        await deps.store.saveCodingAgentEvent(event)
      }

      return updatedRequest
    },

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
