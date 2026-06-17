import type {
  CodingAgentEngine,
  CodingAgentEvent,
  CodingAgentRun,
  CodingDiffArtifact,
  CodingPermissionRequest,
  DependencyBootstrapEvidence,
  LocalProject,
  ManagedCodingWorkspace,
  WorkflowNode,
  WorkflowRun,
} from '@ai-devflow/shared'
import {
  completeFakeCodingRun,
  createFakeCodingRunBundle,
} from './coding-runner.js'

export type CodingEngineEnsureInput = {
  project: LocalProject
}

export type CodingEngineEnsureResult = {
  projectId: string
  engine: CodingAgentEngine
  status: 'ready'
}

export type CodingEngineStartInput = {
  id: string
  run: WorkflowRun
  node: WorkflowNode
  project: LocalProject
  workspace: ManagedCodingWorkspace
  requestedBy: string
  userInstruction: string
  now: string
}

export type CodingEngineStartResult = {
  codingRun: CodingAgentRun
  events: CodingAgentEvent[]
  permissionRequest: CodingPermissionRequest
}

export type CodingEngineApprovePermissionInput = {
  codingRun: CodingAgentRun
  workspace: ManagedCodingWorkspace
  project: LocalProject
  request: CodingPermissionRequest
  now: string
}

export type CodingEngineApprovePermissionResult = {
  codingRun: CodingAgentRun
  events: CodingAgentEvent[]
  diff: CodingDiffArtifact
  bootstrapEvidence: DependencyBootstrapEvidence
}

export type CodingEngineCancelInput = {
  codingRun: CodingAgentRun
}

export type CodingEngineAdapter = {
  engine: CodingAgentEngine
  ensure(input: CodingEngineEnsureInput): Promise<CodingEngineEnsureResult>
  start(input: CodingEngineStartInput): Promise<CodingEngineStartResult>
  approvePermission(input: CodingEngineApprovePermissionInput): Promise<CodingEngineApprovePermissionResult>
  cancel(input: CodingEngineCancelInput): Promise<void>
}

export function createFakeCodingEngineAdapter(): CodingEngineAdapter {
  return {
    engine: 'fake',

    async ensure(input) {
      return {
        projectId: input.project.id,
        engine: 'fake',
        status: 'ready',
      }
    },

    async start(input) {
      const bundle = createFakeCodingRunBundle({
        id: input.id,
        runId: input.run.id,
        nodeId: input.node.id,
        project: input.project,
        requestedBy: input.requestedBy,
        userInstruction: input.userInstruction,
        workspace: input.workspace,
        now: input.now,
        run: input.run,
        node: input.node,
      })

      return {
        codingRun: bundle.codingRun,
        events: bundle.events,
        permissionRequest: bundle.permissionRequest,
      }
    },

    async approvePermission(input) {
      return completeFakeCodingRun({
        codingRun: input.codingRun,
        workspace: input.workspace,
        project: input.project,
        now: input.now,
      })
    },

    async cancel() {
      return undefined
    },
  }
}
