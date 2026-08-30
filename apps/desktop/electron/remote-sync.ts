import {
  parseBudgetGuardDecision,
  parseGateCommandAcknowledgementCreate,
  parseGateCommandAcknowledgementRecord,
  parseGateCommandRecord,
  parseGateCommandReceiptRecord,
  parseWorkRequestClaim,
  parseWorkRequestMaterialize,
  parseWorkRequestRecord,
  type AgentEvent,
  type Artifact,
  type ClaimWorkRequestInput,
  type CreateGateCommandAcknowledgementInput,
  type DevFlowSessionHeaders,
  type DesktopPairingCredential,
  type DesktopPairingExchangeResult,
  type BudgetGuardDecision,
  type RuntimeBudgetApproval,
  type RuntimeBudgetPolicy,
  type MaterializeWorkRequestInput,
  type RemoteAgentReviewSummary,
  type RemoteAgentCoordinationSummary,
  type RemoteAgentMemorySummary,
  type RemoteAgentRuntimeSummary,
  type RemoteCodingAgentSummary,
  type RemoteRunDeleteResult,
  type RemoteRunSummary,
  type RemoteSyncFailureCode,
  type RemoteSyncUploadResult,
  type RemoteTeamSnapshot,
  type RemoteTestEvidenceSummary,
  type EffectiveEnforcementPolicy,
  type GateCommand,
  type GateCommandAcknowledgement,
  type GateCommandReceipt,
  type GateOverrideDecision,
  type OrganizationEnforcementPolicy,
  type ProjectEnforcementPolicyOverride,
  type TeamMember,
  type Project,
  type TokenUsageRollup,
  type WorkRequest,
  type WorkflowRun,
} from '@ai-devflow/shared'
import type { LoadRemoteSnapshotInput } from './ipc-contract'

type Fetcher = typeof fetch

export type RemoteSyncErrorCode = RemoteSyncFailureCode

export class RemoteSyncHttpError extends Error {
  readonly status: number | null
  readonly code: RemoteSyncErrorCode
  readonly path: string
  readonly retryable: boolean

  constructor(input: {
    status: number | null
    code: RemoteSyncErrorCode
    path: string
    retryable: boolean
  }) {
    const statusLabel = input.status === null ? 'unavailable' : `HTTP ${input.status}`
    super(`Remote sync request failed (${statusLabel}, ${input.code}).`)
    this.name = 'RemoteSyncHttpError'
    this.status = input.status
    this.code = input.code
    this.path = input.path
    this.retryable = input.retryable
  }
}

export type RemoteSyncClientOptions = {
  apiBaseUrl?: string
  fetcher?: Fetcher
  authToken?: string
  sessionHeaders?: DevFlowSessionHeaders
  signal?: AbortSignal
}

export type RemoteRunsBundleResponse = {
  runs: WorkflowRun[]
  artifacts: Artifact[]
  events: AgentEvent[]
}

export type RemoteTeamOverviewResponse = {
  projects: Project[]
  members: TeamMember[]
  runs: WorkflowRun[]
  projectCost: TokenUsageRollup[]
  memberCost: TokenUsageRollup[]
  totalCost: string
  enforcementPolicies?: {
    organizationPolicy: OrganizationEnforcementPolicy
    projectOverrides: ProjectEnforcementPolicyOverride[]
    effectivePolicies: EffectiveEnforcementPolicy[]
    gateOverrides: GateOverrideDecision[]
  }
}

export type RemoteSyncClient = {
  exchangeDesktopPairingCode(input: { code: string }): Promise<DesktopPairingExchangeResult>
  loadRemoteSnapshot(input?: LoadRemoteSnapshotInput): Promise<RemoteTeamSnapshot>
  listWorkRequests(
    projectId: string,
    pairing: DesktopPairingCredential | null,
  ): Promise<WorkRequest[]>
  claimWorkRequest(
    input: ClaimWorkRequestInput,
    pairing: DesktopPairingCredential | null,
  ): Promise<RemoteClaimWorkRequestResult>
  materializeWorkRequest(
    input: MaterializeWorkRequestInput,
    pairing: DesktopPairingCredential | null,
  ): Promise<RemoteMaterializeWorkRequestResult>
  listGateCommandInbox(
    projectId: string,
    pairing: DesktopPairingCredential | null,
  ): Promise<GateCommand[]>
  createGateCommandReceipt(
    commandId: string,
    pairing: DesktopPairingCredential | null,
  ): Promise<RemoteGateCommandReceiptResult>
  acknowledgeGateCommandReceipt(
    receiptId: string,
    input: CreateGateCommandAcknowledgementInput,
    pairing: DesktopPairingCredential | null,
  ): Promise<RemoteGateCommandAcknowledgementResult>
  uploadRunSummary(summary: RemoteRunSummary): Promise<RemoteSyncUploadResult>
  deleteRun(input: { runId: string }): Promise<RemoteRunDeleteResult>
  uploadTestEvidenceSummary(summary: RemoteTestEvidenceSummary): Promise<RemoteSyncUploadResult>
  uploadAgentReviewSummary(summary: RemoteAgentReviewSummary): Promise<RemoteSyncUploadResult>
  uploadCodingAgentSummary(summary: RemoteCodingAgentSummary): Promise<RemoteSyncUploadResult>
  uploadAgentRuntimeSummary(summary: RemoteAgentRuntimeSummary): Promise<RemoteSyncUploadResult>
  uploadAgentMemorySummary(summary: RemoteAgentMemorySummary): Promise<RemoteSyncUploadResult>
  uploadAgentCoordinationSummary(
    summary: RemoteAgentCoordinationSummary,
  ): Promise<RemoteSyncUploadResult>
  saveGateOverride(input: RemoteGateOverrideInput): Promise<GateOverrideDecision>
  getRuntimeBudgetPolicy(projectId: string): Promise<RuntimeBudgetPolicy | null>
  saveRuntimeBudgetPolicy(input: {
    projectId: string
    enabled: boolean
    monthlyLimitUsd: number
    warningThresholdUsd: number
  }): Promise<RuntimeBudgetPolicy>
  createRuntimeBudgetApproval(input: {
    projectId: string
    providerId: string
    requestedBy: string
    maxAdditionalCostUsd: number
    reason: string
    expiresAt: string
  }): Promise<RuntimeBudgetApproval>
  evaluateRuntimeBudget(input: RemoteRuntimeBudgetEvaluateInput): Promise<BudgetGuardDecision>
}

export type RemoteClaimWorkRequestResult = {
  workRequest: WorkRequest
  replayed: boolean
  outcomeCode: 'claimed'
}

export type RemoteMaterializeWorkRequestResult = {
  workRequest: WorkRequest
  replayed: boolean
  outcomeCode: 'materialized'
}

export type RemoteGateCommandReceiptResult = {
  command: GateCommand
  receipt: GateCommandReceipt
  replayed: boolean
}

export type RemoteGateCommandAcknowledgementResult = {
  acknowledgement: GateCommandAcknowledgement
  replayed: boolean
}

export type RemoteGateOverrideInput = {
  runId: string
  nodeId: string
  projectId: string
  reason: string
  blockedReasonIds: string[]
  policyVersion: number
}

export type RemoteRuntimeBudgetEvaluateInput = {
  projectId: string
  providerId: string
  projectedCostUsd: number
  approvalId?: string
}

export function resolveRemoteApiBaseUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const value =
    env['DEVFLOW_API_BASE_URL'] ??
    env['NEXT_PUBLIC_DEVFLOW_API_URL'] ??
    'http://127.0.0.1:4310'

  return value.replace(/\/$/, '')
}

function buildUrl(baseUrl: string, pathname: string, input?: LoadRemoteSnapshotInput): string {
  const url = new URL(pathname, `${baseUrl}/`)
  if (input?.organizationId) {
    url.searchParams.set('organizationId', input.organizationId)
  }

  return url.toString()
}

function jsonGetHeaders(sessionHeaders: DevFlowSessionHeaders): Record<string, string> {
  return { accept: 'application/json', ...sessionHeaders }
}

function jsonPostHeaders(sessionHeaders: DevFlowSessionHeaders): Record<string, string> {
  return { ...jsonGetHeaders(sessionHeaders), 'content-type': 'application/json' }
}

function tokenGetHeaders(authToken: string): Record<string, string> {
  return { accept: 'application/json', authorization: `Bearer ${authToken}` }
}

function tokenPostHeaders(authToken: string): Record<string, string> {
  return { ...tokenGetHeaders(authToken), 'content-type': 'application/json' }
}

function hasAuthToken(authToken: string | undefined): authToken is string {
  return typeof authToken === 'string' && authToken.trim().length > 0
}

function missingRemoteAuthError(): Error {
  return new Error('Pair DevFlow Studio with a Team Project before syncing remote team state.')
}

function requireSessionHeaders(
  sessionHeaders: DevFlowSessionHeaders | undefined,
): DevFlowSessionHeaders {
  if (!sessionHeaders) {
    throw missingRemoteAuthError()
  }

  return sessionHeaders
}

function requireGetHeaders(input: {
  authToken: string | undefined
  sessionHeaders: DevFlowSessionHeaders | undefined
}): Record<string, string> {
  if (hasAuthToken(input.authToken)) {
    return tokenGetHeaders(input.authToken)
  }

  return jsonGetHeaders(requireSessionHeaders(input.sessionHeaders))
}

function requirePostHeaders(input: {
  authToken: string | undefined
  sessionHeaders: DevFlowSessionHeaders | undefined
}): Record<string, string> {
  if (hasAuthToken(input.authToken)) {
    return tokenPostHeaders(input.authToken)
  }

  return jsonPostHeaders(requireSessionHeaders(input.sessionHeaders))
}

function headersForSnapshotRequest(
  sessionHeaders: DevFlowSessionHeaders,
  input?: LoadRemoteSnapshotInput,
): DevFlowSessionHeaders {
  if (!input?.organizationId) {
    return sessionHeaders
  }

  return { ...sessionHeaders, 'x-devflow-organization-id': input.organizationId }
}

const CANONICAL_RUN_REQUIRED_MESSAGE =
  /^Canonical Run Summary is required before evidence sync: [A-Za-z0-9][A-Za-z0-9._:-]* \([A-Za-z0-9][A-Za-z0-9._:-]*\)$/
const CANONICAL_RUN_RECOVERY_PATHS = new Set([
  '/api/sync/test-evidence-summary',
  '/api/sync/agent-review-summary',
  '/api/sync/coding-agent-summary',
])

function classifyHttpError(status: number): RemoteSyncErrorCode {
  if (status >= 500) {
    return 'service_unavailable'
  }

  switch (status) {
    case 400:
      return 'bad_request'
    case 401:
      return 'unauthorized'
    case 403:
      return 'forbidden'
    case 404:
      return 'not_found'
    case 408:
      return 'request_timeout'
    case 409:
      return 'conflict'
    case 429:
      return 'rate_limited'
    default:
      return 'remote_error'
  }
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

async function readJson<T>(response: Response, path: string): Promise<T> {
  if (!response.ok) {
    let code = classifyHttpError(response.status)
    if (response.status === 409 && CANONICAL_RUN_RECOVERY_PATHS.has(path)) {
      try {
        const body = await response.clone().json() as { message?: unknown }
        if (
          typeof body.message === 'string' &&
          CANONICAL_RUN_REQUIRED_MESSAGE.test(body.message)
        ) {
          code = 'canonical_run_required'
        }
      } catch {
        // Response bodies are untrusted and never copied into the local error.
      }
    }
    throw new RemoteSyncHttpError({
      status: response.status,
      code,
      path,
      retryable: isRetryableHttpStatus(response.status),
    })
  }

  try {
    return (await response.json()) as T
  } catch {
    throw new RemoteSyncHttpError({
      status: response.status,
      code: 'invalid_response',
      path,
      retryable: true,
    })
  }
}

async function fetchRemote(
  fetcher: Fetcher,
  url: string,
  init: RequestInit,
  path: string,
  signal?: AbortSignal,
): Promise<Response> {
  try {
    return await fetcher(url, signal ? { ...init, signal } : init)
  } catch {
    throw new RemoteSyncHttpError({
      status: null,
      code: signal?.aborted ? 'request_timeout' : 'remote_unavailable',
      path,
      retryable: true,
    })
  }
}

async function postJson<T>(
  fetcher: Fetcher,
  url: string,
  body: unknown,
  path: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
  method: 'POST' | 'PUT' = 'POST',
): Promise<T> {
  const response = await fetchRemote(
    fetcher,
    url,
    {
      method,
      headers,
      body: JSON.stringify(body),
    },
    path,
    signal,
  )

  return readJson<T>(response, path)
}

async function postRemoteSyncUpload(
  fetcher: Fetcher,
  url: string,
  body: unknown,
  path: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<RemoteSyncUploadResult> {
  const response = await fetchRemote(
    fetcher,
    url,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    },
    path,
    signal,
  )
  const result = await readJson<unknown>(response, path)
  if (
    typeof result !== 'object' ||
    result === null ||
    typeof Reflect.get(result, 'accepted') !== 'boolean' ||
    typeof Reflect.get(result, 'syncedAt') !== 'string' ||
    typeof Reflect.get(result, 'message') !== 'string'
  ) {
    throw new RemoteSyncHttpError({
      status: response.status,
      code: 'invalid_response',
      path,
      retryable: true,
    })
  }

  return result as RemoteSyncUploadResult
}

const WORK_REQUEST_LIST_PATH = '/api/team/projects/:projectId/work-requests'
const WORK_REQUEST_CLAIM_PATH = '/api/desktop/work-requests/:workRequestId/claim'
const WORK_REQUEST_MATERIALIZE_PATH =
  '/api/desktop/work-requests/:workRequestId/materialized'
const WORK_REQUEST_LIST_RESPONSE_KEYS = ['workRequests'] as const
const WORK_REQUEST_MUTATION_RESPONSE_KEYS = [
  'outcomeCode',
  'replayed',
  'workRequest',
] as const
const GATE_COMMAND_INBOX_PATH =
  '/api/desktop/projects/:projectId/gate-commands/inbox'
const GATE_COMMAND_INBOX_RESPONSE_KEYS = ['commands'] as const
const GATE_COMMAND_RECEIPT_PATH =
  '/api/desktop/gate-commands/:commandId/receipts'
const GATE_COMMAND_RECEIPT_RESPONSE_KEYS = [
  'command',
  'outcomeCode',
  'receipt',
  'replayed',
] as const
const GATE_COMMAND_ACKNOWLEDGEMENT_PATH =
  '/api/desktop/gate-command-receipts/:receiptId/acknowledgements'
const GATE_COMMAND_ACKNOWLEDGEMENT_RESPONSE_KEYS = [
  'acknowledgement',
  'command',
  'outcomeCode',
  'receipt',
  'replayed',
] as const
const DESKTOP_WORK_REQUEST_LIST_STATUSES = new Set([
  'open',
  // The Bearer-scoped API filters claim_pending by token record. The public
  // Work Request intentionally omits that identifier, so the client must not
  // infer claim ownership from a user ID or Run ID.
  'claim_pending',
  'materialized',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value).sort()
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index])
  )
}

function invalidWorkRequestResponse(status: number, path: string): RemoteSyncHttpError {
  return new RemoteSyncHttpError({
    status,
    code: 'invalid_response',
    path,
    retryable: true,
  })
}

function invalidGateCommandResponse(status: number, path: string): RemoteSyncHttpError {
  return new RemoteSyncHttpError({
    status,
    code: 'invalid_response',
    path,
    retryable: true,
  })
}

function invalidPairingError(path: string): RemoteSyncHttpError {
  return new RemoteSyncHttpError({
    status: 401,
    code: 'unauthorized',
    path,
    retryable: false,
  })
}

function pairingScopeMismatchError(path: string): RemoteSyncHttpError {
  return new RemoteSyncHttpError({
    status: 403,
    code: 'scope_mismatch',
    path,
    retryable: false,
  })
}

function isExactIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim() === value
}

function requireWorkRequestPairing(input: {
  authToken: string | undefined
  pairing: DesktopPairingCredential | null
  path: string
  projectId?: string
}): { pairing: DesktopPairingCredential; headers: Record<string, string> } {
  if (!input.pairing || !hasAuthToken(input.authToken)) {
    throw missingRemoteAuthError()
  }
  if (
    !isExactIdentifier(input.pairing.tokenId) ||
    !isExactIdentifier(input.pairing.organizationId) ||
    !isExactIdentifier(input.pairing.projectId)
  ) {
    throw invalidPairingError(input.path)
  }
  if (input.projectId !== undefined && input.projectId !== input.pairing.projectId) {
    throw pairingScopeMismatchError(input.path)
  }

  return {
    pairing: input.pairing,
    headers: tokenGetHeaders(input.authToken),
  }
}

function parseDesktopWorkRequestListResponse(input: {
  value: unknown
  responseStatus: number
  pairing: DesktopPairingCredential
}): WorkRequest[] {
  const { value, responseStatus, pairing } = input
  if (
    !isRecord(value) ||
    !hasExactKeys(value, WORK_REQUEST_LIST_RESPONSE_KEYS) ||
    !Array.isArray(value.workRequests)
  ) {
    throw invalidWorkRequestResponse(responseStatus, WORK_REQUEST_LIST_PATH)
  }

  const seenIds = new Set<string>()
  try {
    return value.workRequests.map((candidate) => {
      const workRequest = parseWorkRequestRecord(candidate)
      if (
        workRequest.organizationId !== pairing.organizationId ||
        workRequest.projectId !== pairing.projectId ||
        !DESKTOP_WORK_REQUEST_LIST_STATUSES.has(workRequest.status) ||
        seenIds.has(workRequest.id)
      ) {
        throw invalidWorkRequestResponse(responseStatus, WORK_REQUEST_LIST_PATH)
      }
      seenIds.add(workRequest.id)
      return workRequest
    })
  } catch (error) {
    if (error instanceof RemoteSyncHttpError) {
      throw error
    }
    throw invalidWorkRequestResponse(responseStatus, WORK_REQUEST_LIST_PATH)
  }
}

function parseWorkRequestMutationResponse<
  TOutcome extends 'claimed' | 'materialized',
>(input: {
  value: unknown
  responseStatus: number
  path: string
  pairing: DesktopPairingCredential
  workRequestId: string
  runId: string
  expectedVersion: number
  expectedStatus: 'claim_pending' | 'materialized'
  expectedOutcome: TOutcome
}): {
  workRequest: WorkRequest
  replayed: boolean
  outcomeCode: TOutcome
} {
  const { value } = input
  if (
    !isRecord(value) ||
    !hasExactKeys(value, WORK_REQUEST_MUTATION_RESPONSE_KEYS) ||
    typeof value.replayed !== 'boolean' ||
    value.outcomeCode !== input.expectedOutcome
  ) {
    throw invalidWorkRequestResponse(input.responseStatus, input.path)
  }

  let workRequest: WorkRequest
  try {
    workRequest = parseWorkRequestRecord(value.workRequest)
  } catch {
    throw invalidWorkRequestResponse(input.responseStatus, input.path)
  }

  if (
    workRequest.organizationId !== input.pairing.organizationId ||
    workRequest.projectId !== input.pairing.projectId ||
    workRequest.id !== input.workRequestId ||
    workRequest.status !== input.expectedStatus ||
    workRequest.version !== input.expectedVersion + 1 ||
    workRequest.claim?.runId !== input.runId
  ) {
    throw invalidWorkRequestResponse(input.responseStatus, input.path)
  }

  return {
    workRequest,
    replayed: value.replayed,
    outcomeCode: input.expectedOutcome,
  }
}

function parseGateCommandInboxResponse(input: {
  value: unknown
  responseStatus: number
  pairing: DesktopPairingCredential
}): GateCommand[] {
  if (
    input.responseStatus !== 200 ||
    !isRecord(input.value) ||
    !hasExactKeys(input.value, GATE_COMMAND_INBOX_RESPONSE_KEYS) ||
    !Array.isArray(input.value.commands)
  ) {
    throw invalidGateCommandResponse(
      input.responseStatus,
      GATE_COMMAND_INBOX_PATH,
    )
  }

  const seenIds = new Set<string>()
  try {
    return input.value.commands.map((candidate) => {
      const command = parseGateCommandRecord(candidate)
      if (
        command.organizationId !== input.pairing.organizationId ||
        command.projectId !== input.pairing.projectId ||
        command.workRequestId === null ||
        (command.status !== 'pending' && command.status !== 'delivering') ||
        seenIds.has(command.id)
      ) {
        throw invalidGateCommandResponse(
          input.responseStatus,
          GATE_COMMAND_INBOX_PATH,
        )
      }
      seenIds.add(command.id)
      return command
    })
  } catch (error) {
    if (error instanceof RemoteSyncHttpError) {
      throw error
    }
    throw invalidGateCommandResponse(
      input.responseStatus,
      GATE_COMMAND_INBOX_PATH,
    )
  }
}

function parseGateCommandReceiptResponse(input: {
  value: unknown
  responseStatus: number
  pairing: DesktopPairingCredential
  commandId: string
}): RemoteGateCommandReceiptResult {
  if (
    input.responseStatus !== 201 ||
    !isRecord(input.value) ||
    !hasExactKeys(input.value, GATE_COMMAND_RECEIPT_RESPONSE_KEYS) ||
    input.value.outcomeCode !== 'receipt_created' ||
    typeof input.value.replayed !== 'boolean'
  ) {
    throw invalidGateCommandResponse(
      input.responseStatus,
      GATE_COMMAND_RECEIPT_PATH,
    )
  }

  try {
    const command = parseGateCommandRecord(input.value.command)
    const receipt = parseGateCommandReceiptRecord(input.value.receipt)
    if (
      command.organizationId !== input.pairing.organizationId ||
      command.projectId !== input.pairing.projectId ||
      command.workRequestId === null ||
      command.id !== input.commandId ||
      command.status !== 'delivering' ||
      receipt.commandId !== input.commandId ||
      receipt.acknowledgedAt !== null
    ) {
      throw invalidGateCommandResponse(
        input.responseStatus,
        GATE_COMMAND_RECEIPT_PATH,
      )
    }
    return {
      command,
      receipt,
      replayed: input.value.replayed,
    }
  } catch (error) {
    if (error instanceof RemoteSyncHttpError) {
      throw error
    }
    throw invalidGateCommandResponse(
      input.responseStatus,
      GATE_COMMAND_RECEIPT_PATH,
    )
  }
}

function parseGateCommandAcknowledgementResponse(input: {
  value: unknown
  responseStatus: number
  pairing: DesktopPairingCredential
  receiptId: string
  acknowledgementInput: CreateGateCommandAcknowledgementInput
}): RemoteGateCommandAcknowledgementResult {
  if (
    input.responseStatus !== 201 ||
    !isRecord(input.value) ||
    !hasExactKeys(
      input.value,
      GATE_COMMAND_ACKNOWLEDGEMENT_RESPONSE_KEYS,
    ) ||
    input.value.outcomeCode !== 'acknowledged' ||
    typeof input.value.replayed !== 'boolean'
  ) {
    throw invalidGateCommandResponse(
      input.responseStatus,
      GATE_COMMAND_ACKNOWLEDGEMENT_PATH,
    )
  }

  try {
    const command = parseGateCommandRecord(input.value.command)
    const receipt = parseGateCommandReceiptRecord(input.value.receipt)
    const acknowledgement = parseGateCommandAcknowledgementRecord(
      input.value.acknowledgement,
    )
    const expected = input.acknowledgementInput
    if (
      command.organizationId !== input.pairing.organizationId ||
      command.projectId !== input.pairing.projectId ||
      command.workRequestId === null ||
      command.id !== expected.commandId ||
      command.outcomeCode !== expected.outcomeCode ||
      (command.status !== 'applied' &&
        command.status !== 'rejected' &&
        command.status !== 'expired') ||
      receipt.id !== input.receiptId ||
      receipt.commandId !== expected.commandId ||
      receipt.acknowledgedAt === null ||
      acknowledgement.commandId !== expected.commandId ||
      acknowledgement.receiptId !== input.receiptId ||
      acknowledgement.outcomeCode !== expected.outcomeCode ||
      acknowledgement.beforeRunVersion !== expected.beforeRunVersion ||
      acknowledgement.afterRunVersion !== expected.afterRunVersion ||
      acknowledgement.evaluatedAt !== expected.evaluatedAt
    ) {
      throw invalidGateCommandResponse(
        input.responseStatus,
        GATE_COMMAND_ACKNOWLEDGEMENT_PATH,
      )
    }
    return {
      acknowledgement,
      replayed: input.value.replayed,
    }
  } catch (error) {
    if (error instanceof RemoteSyncHttpError) {
      throw error
    }
    throw invalidGateCommandResponse(
      input.responseStatus,
      GATE_COMMAND_ACKNOWLEDGEMENT_PATH,
    )
  }
}

export function createRemoteSyncClient(
  options: RemoteSyncClientOptions = {},
): RemoteSyncClient {
  const apiBaseUrl = options.apiBaseUrl ?? resolveRemoteApiBaseUrl()
  const fetcher = options.fetcher ?? fetch
  const authToken = options.authToken?.trim()
  const sessionHeaders = options.sessionHeaders
  const signal = options.signal

  return {
    async exchangeDesktopPairingCode(input) {
      return postJson<DesktopPairingExchangeResult>(
        fetcher,
        buildUrl(apiBaseUrl, '/api/desktop/pairing/exchange'),
        input,
        '/api/desktop/pairing/exchange',
        { accept: 'application/json', 'content-type': 'application/json' },
        signal,
      )
    },

    async loadRemoteSnapshot(input) {
      const overviewPath = '/api/team/overview'
      const runsPath = '/api/runs'
      const headers = hasAuthToken(authToken)
        ? tokenGetHeaders(authToken)
        : jsonGetHeaders(headersForSnapshotRequest(requireSessionHeaders(sessionHeaders), input))
      const [overview, runsBundle] = await Promise.all([
        fetchRemote(
          fetcher,
          buildUrl(apiBaseUrl, overviewPath, input),
          { headers },
          overviewPath,
          signal,
        ).then((response) => readJson<RemoteTeamOverviewResponse>(response, overviewPath)),
        fetchRemote(
          fetcher,
          buildUrl(apiBaseUrl, runsPath, input),
          { headers },
          runsPath,
          signal,
        ).then((response) => readJson<RemoteRunsBundleResponse>(response, runsPath)),
      ])

      return {
        projects: overview.projects,
        members: overview.members,
        runs: runsBundle.runs,
        artifacts: runsBundle.artifacts,
        events: runsBundle.events,
        projectCost: overview.projectCost,
        memberCost: overview.memberCost,
        totalCost: overview.totalCost,
        ...(overview.enforcementPolicies ? { enforcementPolicies: overview.enforcementPolicies } : {}),
      }
    },

    async listWorkRequests(projectId, pairing) {
      const authorization = requireWorkRequestPairing({
        authToken,
        pairing,
        path: WORK_REQUEST_LIST_PATH,
        projectId,
      })
      const actualPath = `/api/team/projects/${encodeURIComponent(projectId)}/work-requests`
      const response = await fetchRemote(
        fetcher,
        buildUrl(apiBaseUrl, actualPath),
        { headers: authorization.headers },
        WORK_REQUEST_LIST_PATH,
        signal,
      )
      const value = await readJson<unknown>(response, WORK_REQUEST_LIST_PATH)
      return parseDesktopWorkRequestListResponse({
        value,
        responseStatus: response.status,
        pairing: authorization.pairing,
      })
    },

    async claimWorkRequest(rawInput, pairing) {
      const authorization = requireWorkRequestPairing({
        authToken,
        pairing,
        path: WORK_REQUEST_CLAIM_PATH,
      })
      const input = parseWorkRequestClaim(rawInput)
      const actualPath = `/api/desktop/work-requests/${encodeURIComponent(input.workRequestId)}/claim`
      const response = await fetchRemote(
        fetcher,
        buildUrl(apiBaseUrl, actualPath),
        {
          method: 'POST',
          headers: {
            ...authorization.headers,
            'content-type': 'application/json',
          },
          body: JSON.stringify(input),
        },
        WORK_REQUEST_CLAIM_PATH,
        signal,
      )
      const value = await readJson<unknown>(response, WORK_REQUEST_CLAIM_PATH)
      return parseWorkRequestMutationResponse({
        value,
        responseStatus: response.status,
        path: WORK_REQUEST_CLAIM_PATH,
        pairing: authorization.pairing,
        workRequestId: input.workRequestId,
        runId: input.runId,
        expectedVersion: input.expectedVersion,
        expectedStatus: 'claim_pending',
        expectedOutcome: 'claimed',
      })
    },

    async materializeWorkRequest(rawInput, pairing) {
      const authorization = requireWorkRequestPairing({
        authToken,
        pairing,
        path: WORK_REQUEST_MATERIALIZE_PATH,
      })
      const input = parseWorkRequestMaterialize(rawInput)
      const actualPath = `/api/desktop/work-requests/${encodeURIComponent(input.workRequestId)}/materialized`
      const response = await fetchRemote(
        fetcher,
        buildUrl(apiBaseUrl, actualPath),
        {
          method: 'POST',
          headers: {
            ...authorization.headers,
            'content-type': 'application/json',
          },
          body: JSON.stringify(input),
        },
        WORK_REQUEST_MATERIALIZE_PATH,
        signal,
      )
      const value = await readJson<unknown>(response, WORK_REQUEST_MATERIALIZE_PATH)
      return parseWorkRequestMutationResponse({
        value,
        responseStatus: response.status,
        path: WORK_REQUEST_MATERIALIZE_PATH,
        pairing: authorization.pairing,
        workRequestId: input.workRequestId,
        runId: input.runId,
        expectedVersion: input.expectedVersion,
        expectedStatus: 'materialized',
        expectedOutcome: 'materialized',
      })
    },

    async listGateCommandInbox(projectId, pairing) {
      const authorization = requireWorkRequestPairing({
        authToken,
        pairing,
        path: GATE_COMMAND_INBOX_PATH,
        projectId,
      })
      const actualPath =
        `/api/desktop/projects/${encodeURIComponent(projectId)}/gate-commands/inbox`
      const response = await fetchRemote(
        fetcher,
        buildUrl(apiBaseUrl, actualPath),
        { headers: authorization.headers },
        GATE_COMMAND_INBOX_PATH,
        signal,
      )
      return parseGateCommandInboxResponse({
        value: await readJson<unknown>(response, GATE_COMMAND_INBOX_PATH),
        responseStatus: response.status,
        pairing: authorization.pairing,
      })
    },

    async createGateCommandReceipt(commandId, pairing) {
      const authorization = requireWorkRequestPairing({
        authToken,
        pairing,
        path: GATE_COMMAND_RECEIPT_PATH,
      })
      if (!isExactIdentifier(commandId)) {
        throw new RemoteSyncHttpError({
          status: null,
          code: 'bad_request',
          path: GATE_COMMAND_RECEIPT_PATH,
          retryable: false,
        })
      }
      const actualPath =
        `/api/desktop/gate-commands/${encodeURIComponent(commandId)}/receipts`
      const response = await fetchRemote(
        fetcher,
        buildUrl(apiBaseUrl, actualPath),
        {
          method: 'POST',
          headers: {
            ...authorization.headers,
            'content-type': 'application/json',
          },
          body: JSON.stringify({}),
        },
        GATE_COMMAND_RECEIPT_PATH,
        signal,
      )
      return parseGateCommandReceiptResponse({
        value: await readJson<unknown>(response, GATE_COMMAND_RECEIPT_PATH),
        responseStatus: response.status,
        pairing: authorization.pairing,
        commandId,
      })
    },

    async acknowledgeGateCommandReceipt(receiptId, rawInput, pairing) {
      const authorization = requireWorkRequestPairing({
        authToken,
        pairing,
        path: GATE_COMMAND_ACKNOWLEDGEMENT_PATH,
      })
      if (!isExactIdentifier(receiptId)) {
        throw new RemoteSyncHttpError({
          status: null,
          code: 'bad_request',
          path: GATE_COMMAND_ACKNOWLEDGEMENT_PATH,
          retryable: false,
        })
      }
      let input: CreateGateCommandAcknowledgementInput
      try {
        input = parseGateCommandAcknowledgementCreate(rawInput)
      } catch {
        throw new RemoteSyncHttpError({
          status: null,
          code: 'bad_request',
          path: GATE_COMMAND_ACKNOWLEDGEMENT_PATH,
          retryable: false,
        })
      }
      const actualPath =
        `/api/desktop/gate-command-receipts/${encodeURIComponent(receiptId)}/acknowledgements`
      const response = await fetchRemote(
        fetcher,
        buildUrl(apiBaseUrl, actualPath),
        {
          method: 'POST',
          headers: {
            ...authorization.headers,
            'content-type': 'application/json',
          },
          body: JSON.stringify(input),
        },
        GATE_COMMAND_ACKNOWLEDGEMENT_PATH,
        signal,
      )
      return parseGateCommandAcknowledgementResponse({
        value: await readJson<unknown>(
          response,
          GATE_COMMAND_ACKNOWLEDGEMENT_PATH,
        ),
        responseStatus: response.status,
        pairing: authorization.pairing,
        receiptId,
        acknowledgementInput: input,
      })
    },

    async uploadRunSummary(summary) {
      return postRemoteSyncUpload(
        fetcher,
        buildUrl(apiBaseUrl, '/api/sync/run-summary'),
        summary,
        '/api/sync/run-summary',
        requirePostHeaders({ authToken, sessionHeaders }),
        signal,
      )
    },

    async deleteRun(input) {
      const path = `/api/runs/${encodeURIComponent(input.runId)}`
      const safePath = '/api/runs/:runId'
      const response = await fetchRemote(
        fetcher,
        buildUrl(apiBaseUrl, path),
        {
          method: 'DELETE',
          headers: requireGetHeaders({ authToken, sessionHeaders }),
        },
        safePath,
        signal,
      )

      if (response.status === 404) {
        return {
          deleted: false,
          deletedAt: new Date().toISOString(),
          message: 'remote run not found',
        }
      }

      return readJson<RemoteRunDeleteResult>(response, safePath)
    },

    async uploadTestEvidenceSummary(summary) {
      return postRemoteSyncUpload(
        fetcher,
        buildUrl(apiBaseUrl, '/api/sync/test-evidence-summary'),
        summary,
        '/api/sync/test-evidence-summary',
        requirePostHeaders({ authToken, sessionHeaders }),
        signal,
      )
    },

    async uploadAgentReviewSummary(summary) {
      return postRemoteSyncUpload(
        fetcher,
        buildUrl(apiBaseUrl, '/api/sync/agent-review-summary'),
        summary,
        '/api/sync/agent-review-summary',
        requirePostHeaders({ authToken, sessionHeaders }),
        signal,
      )
    },

    async uploadCodingAgentSummary(summary) {
      return postRemoteSyncUpload(
        fetcher,
        buildUrl(apiBaseUrl, '/api/sync/coding-agent-summary'),
        summary,
        '/api/sync/coding-agent-summary',
        requirePostHeaders({ authToken, sessionHeaders }),
        signal,
      )
    },

    async uploadAgentRuntimeSummary(summary) {
      return postRemoteSyncUpload(
        fetcher,
        buildUrl(apiBaseUrl, '/api/sync/agent-runtime-summary'),
        summary,
        '/api/sync/agent-runtime-summary',
        requirePostHeaders({ authToken, sessionHeaders }),
        signal,
      )
    },

    async uploadAgentMemorySummary(summary) {
      return postRemoteSyncUpload(
        fetcher,
        buildUrl(apiBaseUrl, '/api/sync/agent-memory-summary'),
        summary,
        '/api/sync/agent-memory-summary',
        requirePostHeaders({ authToken, sessionHeaders }),
        signal,
      )
    },

    async uploadAgentCoordinationSummary(summary) {
      return postRemoteSyncUpload(
        fetcher,
        buildUrl(apiBaseUrl, '/api/sync/agent-coordination-summary'),
        summary,
        '/api/sync/agent-coordination-summary',
        requirePostHeaders({ authToken, sessionHeaders }),
        signal,
      )
    },

    async saveGateOverride(input) {
      return postJson<GateOverrideDecision>(
        fetcher,
        buildUrl(apiBaseUrl, '/api/gates/override'),
        {
          runId: input.runId,
          nodeId: input.nodeId,
          projectId: input.projectId,
          reason: input.reason,
          blockedReasonIds: input.blockedReasonIds,
          policyVersion: input.policyVersion,
        },
        '/api/gates/override',
        requirePostHeaders({ authToken, sessionHeaders }),
        signal,
      )
    },

    async getRuntimeBudgetPolicy(projectId) {
      const safePath = '/api/runtime/budget-policy'
      const url = new URL(buildUrl(apiBaseUrl, safePath))
      url.searchParams.set('projectId', projectId)
      const response = await fetchRemote(
        fetcher,
        url.toString(),
        { headers: requireGetHeaders({ authToken, sessionHeaders }) },
        safePath,
        signal,
      )
      const result = await readJson<{ policy: RuntimeBudgetPolicy | null }>(response, safePath)
      return result.policy
    },

    async saveRuntimeBudgetPolicy(input) {
      return postJson<RuntimeBudgetPolicy>(
        fetcher,
        buildUrl(apiBaseUrl, '/api/runtime/budget-policy'),
        input,
        '/api/runtime/budget-policy',
        requirePostHeaders({ authToken, sessionHeaders }),
        signal,
        'PUT',
      )
    },

    async createRuntimeBudgetApproval(input) {
      return postJson<RuntimeBudgetApproval>(
        fetcher,
        buildUrl(apiBaseUrl, '/api/runtime/budget-approvals'),
        input,
        '/api/runtime/budget-approvals',
        requirePostHeaders({ authToken, sessionHeaders }),
        signal,
      )
    },

    async evaluateRuntimeBudget(input) {
      const decision = await postJson<unknown>(
        fetcher,
        buildUrl(apiBaseUrl, '/api/runtime/budget/evaluate'),
        {
          projectId: input.projectId,
          providerId: input.providerId,
          projectedCostUsd: input.projectedCostUsd,
          ...(input.approvalId ? { approvalId: input.approvalId } : {}),
        },
        '/api/runtime/budget/evaluate',
        requirePostHeaders({ authToken, sessionHeaders }),
        signal,
      )
      const parsedDecision = parseBudgetGuardDecision(decision)
      if (parsedDecision.projectedCostUsd !== input.projectedCostUsd) {
        throw new Error('Invalid runtime budget decision')
      }
      return parsedDecision
    },
  }
}
