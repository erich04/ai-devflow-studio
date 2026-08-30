import type {
  Artifact,
  CodingAgentEngine,
  CodingAgentEvent,
  CodingAgentRun,
  CodingBrief,
  CodingDiffArtifact,
  CodingPermissionRequest,
  DependencyBootstrapEvidence,
  GateDecision,
  KnowledgeGovernanceCheck,
  KnowledgeReference,
  LocalProject,
  ManagedCodingWorkspace,
  RemediationPlan,
  RetryAttempt,
  TestEvidence,
  WorkflowNode,
  WorkflowRun,
  AgentProviderBillingState,
  AgentProviderDeliveryState,
  AgentProviderErrorCode,
} from '@ai-devflow/shared'
import { resolveDevFlowCodingEngineSelection } from '@ai-devflow/shared'
import {
  completeFakeCodingRun,
  createFakeCodingRunBundle,
} from './coding-runner.js'
import {
  createOpencodeHttpCodingEngineAdapter,
  type OpencodeHttpProcessManager,
} from './opencode-http-engine.js'

export type CodingEngineEnsureInput = {
  project: LocalProject
}

export type CodingEngineEnsureResult = {
  projectId: string
  engine: CodingAgentEngine
  status: 'ready'
}

export type CodingProviderCallTrace = {
  stateVersion: 1
  requestId: string
  codingRunId: string
  phase: 'analysis' | 'initial' | 'repair'
  attempt: number
  providerId: string
  model: string
  targetHost?: string
  status: 'started' | 'succeeded' | 'failed'
  startedAt: string
  completedAt?: string
  durationMs?: number
  timeoutMs: number
  promptChars: number
  promptBytes: number
  promptDigest: string
  manifestPathCount: number
  excerptCount: number
  maxOutputTokens: number
  deliveryState: AgentProviderDeliveryState
  billingState: AgentProviderBillingState
  retryable: boolean
  httpStatus?: number
  providerResponseId?: string
  systemFingerprint?: string
  usage?: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens?: number
    cacheMissTokens?: number
    totalTokens: number
    cacheStatus: 'complete' | 'unknown'
  }
  errorCode?: AgentProviderErrorCode
  sanitizedCause?: string
  redacted: true
}

export type CodingProviderCallReporter = (
  trace: CodingProviderCallTrace,
) => Promise<void>

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
  remediationPlan?: RemediationPlan
  retryAttempt?: RetryAttempt
  brief: CodingBrief
  reportProviderCall?: CodingProviderCallReporter
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
  authorizedStart?: CodingEngineStartInput
  reportPhase?: (input: {
    status: Extract<CodingAgentRun['status'], 'applying' | 'testing'>
    summary: string
    timestamp: string
  }) => Promise<void>
  reportProviderCall?: CodingProviderCallReporter
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
  engine: CodingAgentEngine | 'not-configured'
  providerId: string
  modelId?: string
  ensure(input: CodingEngineEnsureInput): Promise<CodingEngineEnsureResult>
  start(input: CodingEngineStartInput): Promise<
    CodingEngineStartResult | CodingEngineApprovePermissionCompletedResult
  >
  approvePermission(input: CodingEngineApprovePermissionInput): Promise<CodingEngineApprovePermissionResult>
  cancel(input: CodingEngineCancelInput): Promise<void>
}

export type CodingEngineSelectionEnv = Partial<
  Pick<
    NodeJS.ProcessEnv,
    | 'DEVFLOW_CODING_ENGINE'
    | 'DEVFLOW_ENABLE_FAKE_RUNTIME'
    | 'DEVFLOW_OPENCODE_BIN'
    | 'DEVFLOW_OPENCODE_PROVIDER_ID'
    | 'DEVFLOW_OPENCODE_MODEL_ID'
    | 'DEVFLOW_OPENCODE_API_KEY_ENV'
  >
>

export type CodingEngineAdapterFactoryDeps = {
  processManager?: OpencodeHttpProcessManager
}

export function createCodingEngineAdapterFromEnv(
  env: CodingEngineSelectionEnv = process.env,
  deps: CodingEngineAdapterFactoryDeps = {},
): CodingEngineAdapter {
  const selection = resolveDevFlowCodingEngineSelection(env)
  if (!selection.engine) {
    return createUnconfiguredCodingEngineAdapter()
  }
  if (selection.engine === 'fake') {
    return createFakeCodingEngineAdapter()
  }
  if (selection.engine === 'opencode-http') {
    const apiKeyEnvName = env.DEVFLOW_OPENCODE_API_KEY_ENV ?? 'OPENAI_API_KEY'
    return createOpencodeHttpCodingEngineAdapter({
      binaryPath: env.DEVFLOW_OPENCODE_BIN ?? 'opencode',
      providerID: env.DEVFLOW_OPENCODE_PROVIDER_ID ?? 'openai',
      modelID: env.DEVFLOW_OPENCODE_MODEL_ID ?? 'gpt-4.1-mini',
      apiKeyEnvName,
      requireExecutionAuthorization: true,
      ...(deps.processManager ? { processManager: deps.processManager } : {}),
      runtimeEnv: buildOpencodeRuntimeEnv({
        baseEnv: process.env,
        apiKeyEnvName,
        apiKey: (env as NodeJS.ProcessEnv)[apiKeyEnvName],
      }),
    })
  }

  const unsupported: never = selection
  throw new Error(`Unsupported Coding Agent engine: ${String(unsupported)}`)
}

export function buildOpencodeRuntimeEnv(input: {
  baseEnv: NodeJS.ProcessEnv
  apiKeyEnvName: string
  apiKey?: string | undefined
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const name of OPENCODE_RUNTIME_ENV_ALLOWLIST) {
    const value = input.baseEnv[name]
    if (value !== undefined) env[name] = value
  }

  if (input.apiKey) {
    assertSafeProviderCredentialEnvName(input.apiKeyEnvName)
    env[input.apiKeyEnvName] = input.apiKey
  }
  return env
}

const OPENCODE_RUNTIME_ENV_ALLOWLIST = [
  'PATH',
  'PATHEXT',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TMPDIR',
  'TMP',
  'TEMP',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  // OpenCode may use its explicitly disclosed local user profile for its own auth.
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
] as const

const FORBIDDEN_CREDENTIAL_ENV_NAME = /^(?:GH_|GITHUB_|GIT_|GITLAB_|BITBUCKET_|AWS_|AZURE_|GCLOUD_|GOOGLE_APPLICATION_CREDENTIALS$|VERCEL_|NETLIFY_|CLOUDFLARE_|FLY_|HEROKU_|NPM_|DOCKER_|SSH_)/u

function assertSafeProviderCredentialEnvName(name: string): void {
  if (
    !/^[A-Z][A-Z0-9_]{0,127}$/u.test(name) ||
    !/(?:_API_KEY|_AUTH_TOKEN)$/u.test(name) ||
    FORBIDDEN_CREDENTIAL_ENV_NAME.test(name)
  ) {
    throw new Error('OpenCode Provider credential environment name is not allowed')
  }
}

export function createFakeCodingEngineAdapter(): CodingEngineAdapter {
  return {
    engine: 'fake',
    providerId: 'fake-coding-engine',
    modelId: 'fake',

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
        remediationPlan: input.remediationPlan,
        retryAttempt: input.retryAttempt,
        brief: input.brief,
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

export function createUnconfiguredCodingEngineAdapter(): CodingEngineAdapter {
  function error(): Error {
    return new Error(
      'Coding Agent engine is not configured. Set DEVFLOW_CODING_ENGINE=opencode-http, or set DEVFLOW_CODING_ENGINE=fake with DEVFLOW_ENABLE_FAKE_RUNTIME=true for demo/test runs.',
    )
  }

  return {
    engine: 'not-configured',
    providerId: 'not-configured',

    async ensure() {
      throw error()
    },

    async start() {
      throw error()
    },

    async approvePermission() {
      throw error()
    },

    async cancel() {
      return undefined
    },
  }
}
