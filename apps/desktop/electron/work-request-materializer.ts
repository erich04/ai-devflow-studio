import { createHash } from 'node:crypto'
import {
  WORK_REQUEST_ID_MAX_LENGTH,
  WORK_REQUEST_VERSION_MAX,
  createWorkflowRunFromRequest,
  parseWorkRequestRecord,
  type ClaimWorkRequestInput,
  type DesktopPairingCredential,
  type MaterializeWorkRequestInput,
  type WorkRequest,
  type WorkflowRun,
} from '@ai-devflow/shared'
import type {
  LocalStore,
  MaterializeClaimedWorkRequestInput,
  WorkRequestMaterializationBinding,
  WorkRequestMaterializationExpectedPairing,
} from './local-store.js'

export type DesktopWorkRequestMaterializationInput = {
  localProjectId: string
  workRequestId: string
  expectedVersion: number
}

export type DesktopWorkRequestMaterializerClient = {
  listWorkRequests(
    projectId: string,
    pairing: DesktopPairingCredential | null,
  ): Promise<WorkRequest[]>
  claimWorkRequest(
    input: ClaimWorkRequestInput,
    pairing: DesktopPairingCredential | null,
  ): Promise<{
    workRequest: WorkRequest
    replayed: boolean
    outcomeCode: 'claimed'
  }>
  materializeWorkRequest(
    input: MaterializeWorkRequestInput,
    pairing: DesktopPairingCredential | null,
  ): Promise<{
    workRequest: WorkRequest
    replayed: boolean
    outcomeCode: 'materialized'
  }>
}

export type DesktopWorkRequestMaterializerStore = Pick<
  LocalStore,
  | 'materializeClaimedWorkRequest'
  | 'markWorkRequestMaterializationAcknowledged'
  | 'getWorkRequestMaterializationByWorkRequestId'
  | 'getWorkRequestMaterializationByRunId'
  | 'getRun'
>

export type DesktopWorkRequestMaterializerDependencies = Readonly<{
  pairing: DesktopPairingCredential
  client: DesktopWorkRequestMaterializerClient
  store: DesktopWorkRequestMaterializerStore
}>

export type DesktopWorkRequestMaterializationResult = {
  run: WorkflowRun
  workRequest: WorkRequest
  localWorkflow: 'created' | 'reused'
  claimReplayed: boolean
  materializeReplayed: boolean
}

export type DesktopWorkRequestMaterializationErrorCode =
  | 'invalid_input'
  | 'invalid_pairing'
  | 'pairing_scope_mismatch'
  | 'work_request_not_found'
  | 'stale_snapshot'
  | 'invalid_remote_response'
  | 'remote_scope_mismatch'
  | 'remote_claim_conflict'
  | 'local_binding_missing'
  | 'local_run_conflict'
  | 'local_ack_conflict'

const errorMessages: Record<
  DesktopWorkRequestMaterializationErrorCode,
  string
> = {
  invalid_input: 'Invalid Desktop Work Request materialization input.',
  invalid_pairing: 'Desktop pairing is invalid or incomplete.',
  pairing_scope_mismatch:
    'Desktop pairing is not bound to the requested local and Team Project scope.',
  work_request_not_found: 'Work Request is not available to this paired Desktop.',
  stale_snapshot: 'Work Request snapshot is stale.',
  invalid_remote_response: 'Remote Work Request response is invalid.',
  remote_scope_mismatch:
    'Remote Work Request escaped the paired organization or Team Project scope.',
  remote_claim_conflict:
    'Work Request claim does not match its deterministic local Run.',
  local_binding_missing:
    'Materialized Work Request has no recoverable local binding.',
  local_run_conflict:
    'Deterministic Work Request Run conflicts with existing local state.',
  local_ack_conflict:
    'Local Work Request materialization acknowledgement conflicts with durable state.',
}

export class DesktopWorkRequestMaterializationError extends Error {
  readonly code: DesktopWorkRequestMaterializationErrorCode

  constructor(code: DesktopWorkRequestMaterializationErrorCode) {
    super(errorMessages[code])
    this.name = 'DesktopWorkRequestMaterializationError'
    this.code = code
  }
}

const inputKeys = [
  'expectedVersion',
  'localProjectId',
  'workRequestId',
] as const
const remoteEnvelopeKeys = [
  'outcomeCode',
  'replayed',
  'workRequest',
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort()
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  )
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= WORK_REQUEST_ID_MAX_LENGTH &&
    value.trim().length > 0 &&
    value.trim() === value
  )
}

function parseInput(value: unknown): DesktopWorkRequestMaterializationInput {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, inputKeys) ||
    !isIdentifier(value.localProjectId) ||
    !isIdentifier(value.workRequestId) ||
    !Number.isInteger(value.expectedVersion) ||
    (value.expectedVersion as number) < 1 ||
    (value.expectedVersion as number) > WORK_REQUEST_VERSION_MAX
  ) {
    throw new DesktopWorkRequestMaterializationError('invalid_input')
  }

  return {
    localProjectId: value.localProjectId,
    workRequestId: value.workRequestId,
    expectedVersion: value.expectedVersion as number,
  }
}

function freezePairing(
  pairing: DesktopPairingCredential,
): DesktopPairingCredential {
  const memberships = pairing.projectMemberships.map((membership) =>
    Object.freeze({ ...membership }),
  )
  return Object.freeze({
    ...pairing,
    projectMemberships: Object.freeze(memberships),
  }) as DesktopPairingCredential
}

function validatePairing(pairing: DesktopPairingCredential): void {
  if (
    !isIdentifier(pairing.tokenId) ||
    !isIdentifier(pairing.organizationId) ||
    !isIdentifier(pairing.projectId) ||
    !isIdentifier(pairing.localProjectId) ||
    !isIdentifier(pairing.userId) ||
    !pairing.projectMemberships.some(
      (membership) =>
        membership.projectId === pairing.projectId &&
        membership.userId === pairing.userId,
    )
  ) {
    throw new DesktopWorkRequestMaterializationError('invalid_pairing')
  }
}

function pairingScope(
  pairing: DesktopPairingCredential,
): WorkRequestMaterializationExpectedPairing {
  return Object.freeze({
    tokenId: pairing.tokenId,
    organizationId: pairing.organizationId,
    projectId: pairing.projectId,
    localProjectId: pairing.localProjectId!,
  })
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')
}

function materializationIdentityDigest(
  scope: WorkRequestMaterializationExpectedPairing,
  workRequestId: string,
): string {
  return sha256([
    'desktop-work-request:v1',
    scope.organizationId,
    scope.projectId,
    scope.localProjectId,
    workRequestId,
  ])
}

function createMaterializationSourceFingerprint(input: {
  workRequest: WorkRequest
  creation: MaterializeClaimedWorkRequestInput['creation']
  scope: WorkRequestMaterializationExpectedPairing
}): string {
  return sha256([
    'work-request-materialization-source:v1',
    input.workRequest,
    {
      organizationId: input.scope.organizationId,
      projectId: input.scope.projectId,
      localProjectId: input.scope.localProjectId,
    },
    {
      run: input.creation.run,
      artifacts: input.creation.artifacts,
      events: input.creation.events,
    },
  ])
}

function cloneAndFreezeWorkRequest(workRequest: WorkRequest): WorkRequest {
  const claim = workRequest.claim
    ? Object.freeze({ ...workRequest.claim })
    : null
  return Object.freeze({ ...workRequest, claim }) as WorkRequest
}

function parseRemoteWorkRequest(value: unknown): WorkRequest {
  try {
    return parseWorkRequestRecord(value)
  } catch {
    throw new DesktopWorkRequestMaterializationError(
      'invalid_remote_response',
    )
  }
}

function parseRemoteList(value: unknown): WorkRequest[] {
  if (!Array.isArray(value)) {
    throw new DesktopWorkRequestMaterializationError(
      'invalid_remote_response',
    )
  }
  const seen = new Set<string>()
  return value.map((candidate) => {
    const workRequest = parseRemoteWorkRequest(candidate)
    if (seen.has(workRequest.id)) {
      throw new DesktopWorkRequestMaterializationError(
        'invalid_remote_response',
      )
    }
    seen.add(workRequest.id)
    return workRequest
  })
}

function remoteEnvelope(value: unknown): {
  workRequest: WorkRequest
  replayed: boolean
  outcomeCode: unknown
} {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, remoteEnvelopeKeys) ||
    typeof value.replayed !== 'boolean'
  ) {
    throw new DesktopWorkRequestMaterializationError(
      'invalid_remote_response',
    )
  }
  return {
    workRequest: parseRemoteWorkRequest(value.workRequest),
    replayed: value.replayed,
    outcomeCode: value.outcomeCode,
  }
}

function assertRemoteScope(
  workRequest: WorkRequest,
  scope: WorkRequestMaterializationExpectedPairing,
): void {
  if (
    workRequest.organizationId !== scope.organizationId ||
    workRequest.projectId !== scope.projectId
  ) {
    throw new DesktopWorkRequestMaterializationError(
      'remote_scope_mismatch',
    )
  }
}

function parseClaimResult(input: {
  value: unknown
  expectedWorkRequestId: string
  expectedVersion: number
  runId: string
  scope: WorkRequestMaterializationExpectedPairing
}): { workRequest: WorkRequest; replayed: boolean } {
  const result = remoteEnvelope(input.value)
  assertRemoteScope(result.workRequest, input.scope)
  if (
    result.outcomeCode !== 'claimed' ||
    result.workRequest.id !== input.expectedWorkRequestId ||
    result.workRequest.version !== input.expectedVersion + 1 ||
    result.workRequest.status !== 'claim_pending' ||
    result.workRequest.claim?.runId !== input.runId ||
    result.workRequest.claim.materializedAt !== null
  ) {
    throw new DesktopWorkRequestMaterializationError(
      'invalid_remote_response',
    )
  }
  return {
    workRequest: result.workRequest,
    replayed: result.replayed,
  }
}

function canonicalClaimSource(workRequest: WorkRequest): WorkRequest {
  if (
    (workRequest.status !== 'claim_pending' &&
      workRequest.status !== 'materialized') ||
    workRequest.claim === null ||
    workRequest.version < 2
  ) {
    throw new DesktopWorkRequestMaterializationError(
      'invalid_remote_response',
    )
  }

  return parseRemoteWorkRequest({
    ...workRequest,
    version:
      workRequest.status === 'materialized'
        ? workRequest.version - 1
        : workRequest.version,
    status: 'claim_pending',
    claim: {
      ...workRequest.claim,
      materializedAt: null,
    },
    updatedAt: workRequest.claim.claimedAt,
  })
}

function sameImmutableWorkRequest(
  claimed: WorkRequest,
  materialized: WorkRequest,
): boolean {
  return (
    claimed.id === materialized.id &&
    claimed.organizationId === materialized.organizationId &&
    claimed.projectId === materialized.projectId &&
    claimed.title === materialized.title &&
    claimed.request === materialized.request &&
    claimed.createdByUserId === materialized.createdByUserId &&
    claimed.expiresAt === materialized.expiresAt &&
    claimed.createdAt === materialized.createdAt &&
    claimed.claim?.runId === materialized.claim?.runId &&
    claimed.claim?.claimedAt === materialized.claim?.claimedAt
  )
}

function parseMaterializeResult(input: {
  value: unknown
  claimed: WorkRequest
  runId: string
  scope: WorkRequestMaterializationExpectedPairing
}): { workRequest: WorkRequest; replayed: boolean } {
  const result = remoteEnvelope(input.value)
  assertRemoteScope(result.workRequest, input.scope)
  if (
    result.outcomeCode !== 'materialized' ||
    result.workRequest.version !== input.claimed.version + 1 ||
    result.workRequest.status !== 'materialized' ||
    result.workRequest.claim?.runId !== input.runId ||
    result.workRequest.claim.materializedAt === null ||
    !sameImmutableWorkRequest(input.claimed, result.workRequest)
  ) {
    throw new DesktopWorkRequestMaterializationError(
      'invalid_remote_response',
    )
  }
  return {
    workRequest: result.workRequest,
    replayed: result.replayed,
  }
}

function createMaterializationSource(input: {
  workRequest: WorkRequest
  localProjectId: string
  pairing: DesktopPairingCredential
  scope: WorkRequestMaterializationExpectedPairing
  runId: string
  digest: string
}): MaterializeClaimedWorkRequestInput {
  const workRequest = cloneAndFreezeWorkRequest(
    canonicalClaimSource(input.workRequest),
  )
  if (workRequest.claim?.runId !== input.runId) {
    throw new DesktopWorkRequestMaterializationError(
      'remote_claim_conflict',
    )
  }
  const creation = createWorkflowRunFromRequest({
    runId: input.runId,
    title: workRequest.title,
    request: workRequest.request,
    projectId: input.localProjectId,
    creatorId: input.pairing.userId,
    branchName: `ai/work-request-${input.digest.slice(0, 12)}`,
    now: workRequest.claim.claimedAt,
  })
  const materializeIdempotencyKey =
    `desktop-work-request:v1:materialize:${input.digest}:v${workRequest.version}`
  const sourceFingerprint = createMaterializationSourceFingerprint({
    workRequest,
    creation,
    scope: input.scope,
  })
  return {
    workRequest,
    creation,
    expectedPairing: input.scope,
    sourceFingerprint,
    materializeIdempotencyKey,
  }
}

function bindingMatches(
  binding: WorkRequestMaterializationBinding,
  source: MaterializeClaimedWorkRequestInput,
): boolean {
  return (
    binding.workRequestId === source.workRequest.id &&
    binding.organizationId === source.workRequest.organizationId &&
    binding.teamProjectId === source.workRequest.projectId &&
    binding.localProjectId === source.expectedPairing.localProjectId &&
    binding.runId === source.creation.run.id &&
    binding.claimVersion === source.workRequest.version &&
    binding.sourceFingerprint === source.sourceFingerprint &&
    binding.materializeIdempotencyKey ===
      source.materializeIdempotencyKey
  )
}

function sameBinding(
  left: WorkRequestMaterializationBinding,
  right: WorkRequestMaterializationBinding,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function isRunDescendedFromMaterialization(
  current: WorkflowRun | null,
  creation: WorkflowRun,
): current is WorkflowRun {
  if (
    current === null ||
    current.id !== creation.id ||
    current.version < creation.version ||
    current.projectId !== creation.projectId ||
    current.creatorId !== creation.creatorId ||
    current.title !== creation.title ||
    current.request !== creation.request ||
    current.branchName !== creation.branchName ||
    current.createdAt !== creation.createdAt ||
    current.nodes.length !== creation.nodes.length ||
    JSON.stringify(current.edges) !== JSON.stringify(creation.edges)
  ) {
    return false
  }

  return current.nodes.every((node, index) => {
    const original = creation.nodes[index]
    return (
      original !== undefined &&
      node.id === original.id &&
      node.stage === original.stage &&
      node.title === original.title &&
      node.subtitle === original.subtitle &&
      node.kind === original.kind &&
      node.ownerId === original.ownerId &&
      node.requiredRole === original.requiredRole
    )
  })
}

function captureDependencies(
  input: DesktopWorkRequestMaterializerDependencies,
): Readonly<{
  pairing: DesktopPairingCredential
  client: DesktopWorkRequestMaterializerClient
  store: DesktopWorkRequestMaterializerStore
}> {
  const pairing = freezePairing(input.pairing)
  validatePairing(pairing)
  return Object.freeze({
    pairing,
    client: Object.freeze({
      listWorkRequests: input.client.listWorkRequests.bind(input.client),
      claimWorkRequest: input.client.claimWorkRequest.bind(input.client),
      materializeWorkRequest:
        input.client.materializeWorkRequest.bind(input.client),
    }),
    store: Object.freeze({
      materializeClaimedWorkRequest:
        input.store.materializeClaimedWorkRequest.bind(input.store),
      markWorkRequestMaterializationAcknowledged:
        input.store.markWorkRequestMaterializationAcknowledged.bind(
          input.store,
        ),
      getWorkRequestMaterializationByWorkRequestId:
        input.store.getWorkRequestMaterializationByWorkRequestId.bind(
          input.store,
        ),
      getWorkRequestMaterializationByRunId:
        input.store.getWorkRequestMaterializationByRunId.bind(input.store),
      getRun: input.store.getRun.bind(input.store),
    }),
  })
}

async function requireLocalMaterialization(input: {
  store: DesktopWorkRequestMaterializerStore
  source: MaterializeClaimedWorkRequestInput
}): Promise<{
  binding: WorkRequestMaterializationBinding
  run: WorkflowRun
}> {
  const runId = input.source.creation.run.id
  const [byWorkRequest, byRun, run] = await Promise.all([
    input.store.getWorkRequestMaterializationByWorkRequestId(
      input.source.workRequest.id,
    ),
    input.store.getWorkRequestMaterializationByRunId(runId),
    input.store.getRun(runId),
  ])
  if (!byWorkRequest || !byRun) {
    throw new DesktopWorkRequestMaterializationError(
      'local_binding_missing',
    )
  }
  if (
    !sameBinding(byWorkRequest, byRun) ||
    !bindingMatches(byWorkRequest, input.source) ||
    !isRunDescendedFromMaterialization(run, input.source.creation.run)
  ) {
    throw new DesktopWorkRequestMaterializationError(
      'local_run_conflict',
    )
  }
  return { binding: byWorkRequest, run }
}

async function markAcknowledged(input: {
  store: DesktopWorkRequestMaterializerStore
  source: MaterializeClaimedWorkRequestInput
  materialized: WorkRequest
}): Promise<void> {
  const acknowledgedAt = input.materialized.claim?.materializedAt
  if (acknowledgedAt === null || acknowledgedAt === undefined) {
    throw new DesktopWorkRequestMaterializationError(
      'invalid_remote_response',
    )
  }
  const result =
    await input.store.markWorkRequestMaterializationAcknowledged({
      workRequestId: input.source.workRequest.id,
      runId: input.source.creation.run.id,
      materializedVersion: input.materialized.version,
      acknowledgedAt,
      expectedPairing: input.source.expectedPairing,
      sourceFingerprint: input.source.sourceFingerprint,
      materializeIdempotencyKey: input.source.materializeIdempotencyKey,
    })
  if (!result.acknowledged) {
    if (result.reason === 'pairing_scope_mismatch') {
      throw new DesktopWorkRequestMaterializationError(
        'pairing_scope_mismatch',
      )
    }
    throw new DesktopWorkRequestMaterializationError(
      'local_ack_conflict',
    )
  }
}

export function createDesktopWorkRequestMaterializer(
  dependenciesInput: DesktopWorkRequestMaterializerDependencies,
): {
  materialize(
    input: DesktopWorkRequestMaterializationInput,
  ): Promise<DesktopWorkRequestMaterializationResult>
} {
  const dependencies = captureDependencies(dependenciesInput)
  const scope = pairingScope(dependencies.pairing)

  return {
    async materialize(rawInput) {
      const input = parseInput(rawInput)
      if (input.localProjectId !== scope.localProjectId) {
        throw new DesktopWorkRequestMaterializationError(
          'pairing_scope_mismatch',
        )
      }

      const snapshots = parseRemoteList(
        await dependencies.client.listWorkRequests(
          scope.projectId,
          dependencies.pairing,
        ),
      )
      for (const snapshot of snapshots) {
        assertRemoteScope(snapshot, scope)
        if (
          snapshot.status !== 'open' &&
          snapshot.status !== 'claim_pending' &&
          snapshot.status !== 'materialized'
        ) {
          throw new DesktopWorkRequestMaterializationError(
            'invalid_remote_response',
          )
        }
      }
      const selected = snapshots.find(
        (candidate) => candidate.id === input.workRequestId,
      )
      if (!selected) {
        throw new DesktopWorkRequestMaterializationError(
          'work_request_not_found',
        )
      }
      assertRemoteScope(selected, scope)
      if (selected.version !== input.expectedVersion) {
        throw new DesktopWorkRequestMaterializationError('stale_snapshot')
      }

      const digest = materializationIdentityDigest(
        scope,
        input.workRequestId,
      )
      const runId = `run-work-request-${digest.slice(0, 32)}`
      let current = selected
      let claimReplayed = false
      if (selected.status === 'open') {
        const claimed = parseClaimResult({
          value: await dependencies.client.claimWorkRequest(
            {
              workRequestId: input.workRequestId,
              expectedVersion: selected.version,
              runId,
              idempotencyKey:
                `desktop-work-request:v1:claim:${digest}:v${selected.version}`,
            },
            dependencies.pairing,
          ),
          expectedWorkRequestId: input.workRequestId,
          expectedVersion: selected.version,
          runId,
          scope,
        })
        current = claimed.workRequest
        claimReplayed = claimed.replayed
      } else if (
        selected.status !== 'claim_pending' &&
        selected.status !== 'materialized'
      ) {
        throw new DesktopWorkRequestMaterializationError(
          'invalid_remote_response',
        )
      }

      if (current.claim?.runId !== runId) {
        throw new DesktopWorkRequestMaterializationError(
          'remote_claim_conflict',
        )
      }
      const source = createMaterializationSource({
        workRequest: current,
        localProjectId: input.localProjectId,
        pairing: dependencies.pairing,
        scope,
        runId,
        digest,
      })

      if (current.status === 'materialized') {
        const localMaterialization = await requireLocalMaterialization({
          store: dependencies.store,
          source,
        })
        const { binding } = localMaterialization
        if (binding.status === 'pending_ack') {
          await markAcknowledged({
            store: dependencies.store,
            source,
            materialized: current,
          })
        } else if (
          binding.acknowledgedVersion !== current.version ||
          binding.acknowledgedAt !== current.claim?.materializedAt
        ) {
          throw new DesktopWorkRequestMaterializationError(
            'local_ack_conflict',
          )
        }
        return {
          run: localMaterialization.run,
          workRequest: current,
          localWorkflow: 'reused',
          claimReplayed: false,
          materializeReplayed: true,
        }
      }

      const local =
        await dependencies.store.materializeClaimedWorkRequest(source)
      if (local.status === 'pairing_scope_mismatch') {
        throw new DesktopWorkRequestMaterializationError(
          'pairing_scope_mismatch',
        )
      }
      if (local.status !== 'created' && local.status !== 'replayed') {
        throw new DesktopWorkRequestMaterializationError(
          'local_run_conflict',
        )
      }
      const localMaterialization = await requireLocalMaterialization({
        store: dependencies.store,
        source,
      })

      const materialized = parseMaterializeResult({
        value: await dependencies.client.materializeWorkRequest(
          {
            workRequestId: input.workRequestId,
            expectedVersion: source.workRequest.version,
            runId,
            idempotencyKey: source.materializeIdempotencyKey,
          },
          dependencies.pairing,
        ),
        claimed: source.workRequest,
        runId,
        scope,
      })
      await markAcknowledged({
        store: dependencies.store,
        source,
        materialized: materialized.workRequest,
      })

      return {
        run: localMaterialization.run,
        workRequest: materialized.workRequest,
        localWorkflow:
          local.status === 'created' ? 'created' : 'reused',
        claimReplayed,
        materializeReplayed: materialized.replayed,
      }
    },
  }
}
