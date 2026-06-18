import type {
  Artifact,
  CodingAgentEngine,
  CodingAgentEvent,
  CodingAgentRun,
  CodingDiffArtifact,
  CodingPermissionRequest,
  DependencyBootstrapEvidence,
  GateDecision,
  KnowledgeGovernanceCheck,
  KnowledgeReference,
  LocalProject,
  ManagedCodingWorkspace,
  TestEvidence,
  WorkflowNode,
  WorkflowRun,
} from '@ai-devflow/shared'
import {
  completeFakeCodingRun,
  createFakeCodingRunBundle,
} from './coding-runner.js'
import { createOpencodeHttpCodingEngineAdapter } from './opencode-http-engine.js'

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
  providerId: string
  userInstruction: string
  now: string
  upstreamArtifacts: Artifact[]
  knowledgeReferences: KnowledgeReference[]
  governanceChecks: KnowledgeGovernanceCheck[]
  gateDecisions: GateDecision[]
  testEvidence: TestEvidence[]
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

export type CodingEngineApprovePermissionCompletedResult = {
  codingRun: CodingAgentRun
  events: CodingAgentEvent[]
  diff: CodingDiffArtifact
  bootstrapEvidence?: DependencyBootstrapEvidence
}

export type CodingEngineApprovePermissionContinuedResult = {
  codingRun: CodingAgentRun
  events: CodingAgentEvent[]
  permissionRequest: CodingPermissionRequest
}

export type CodingEngineApprovePermissionResult =
  | CodingEngineApprovePermissionCompletedResult
  | CodingEngineApprovePermissionContinuedResult

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

export type CodingEngineSelectionEnv = Partial<
  Pick<
    NodeJS.ProcessEnv,
    | 'DEVFLOW_CODING_ENGINE'
    | 'DEVFLOW_OPENCODE_BIN'
    | 'DEVFLOW_OPENCODE_PROVIDER_ID'
    | 'DEVFLOW_OPENCODE_MODEL_ID'
    | 'DEVFLOW_OPENCODE_API_KEY_ENV'
  >
>

export function createCodingEngineAdapterFromEnv(
  env: CodingEngineSelectionEnv = process.env,
): CodingEngineAdapter {
  const engine = env.DEVFLOW_CODING_ENGINE ?? 'fake'
  if (engine === 'fake') {
    return createFakeCodingEngineAdapter()
  }
  if (engine === 'opencode-http') {
    const apiKeyEnvName = env.DEVFLOW_OPENCODE_API_KEY_ENV ?? 'OPENAI_API_KEY'
    return createOpencodeHttpCodingEngineAdapter({
      binaryPath: env.DEVFLOW_OPENCODE_BIN ?? 'opencode',
      providerID: env.DEVFLOW_OPENCODE_PROVIDER_ID ?? 'openai',
      modelID: env.DEVFLOW_OPENCODE_MODEL_ID ?? 'gpt-4.1-mini',
      apiKeyEnvName,
      runtimeEnv: buildOpencodeRuntimeEnv({
        baseEnv: process.env,
        apiKeyEnvName,
        apiKey: (env as NodeJS.ProcessEnv)[apiKeyEnvName],
      }),
    })
  }

  throw new Error(`Unsupported Coding Agent engine: ${engine}`)
}

export function buildOpencodeRuntimeEnv(input: {
  baseEnv: NodeJS.ProcessEnv
  apiKeyEnvName: string
  apiKey?: string | undefined
}): NodeJS.ProcessEnv {
  return {
    ...input.baseEnv,
    ...(input.apiKey ? { [input.apiKeyEnvName]: input.apiKey } : {}),
  }
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
        providerId: input.providerId,
        userInstruction: input.userInstruction,
        workspace: input.workspace,
        now: input.now,
        run: input.run,
        node: input.node,
        upstreamArtifacts: input.upstreamArtifacts,
        knowledgeReferences: input.knowledgeReferences,
        governanceChecks: input.governanceChecks,
        gateDecisions: input.gateDecisions,
        testEvidence: input.testEvidence,
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
