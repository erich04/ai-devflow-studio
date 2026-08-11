import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import {
  createGitHubDeliveryCompletion,
  type Artifact,
  type GitHubDeliveryIntent,
} from '@ai-devflow/shared'
import {
  type GitHubGitPublisher,
  type GitHubGitPublisherErrorCode,
} from './github-git-publisher.js'
import type {
  CreateGitHubDraftPullRequestInput,
  CreateGitHubDraftPullRequestResult,
  EphemeralGitHubDeliveryCredential,
  GitHubCredentialGrantInput,
  GitHubCredentialPublishResult,
  GitHubDeliveryRecoverySnapshot,
  GitHubDeliveryRequestRecord,
  GetGitHubDeliveryRecoverySnapshotInput,
  ReportGitHubBranchPublicationInput,
  ReportGitHubBranchPublicationResult,
  SubmitGitHubDeliveryInput,
  SubmitGitHubDeliveryResult,
} from './github-delivery-remote-client.js'
import { GitHubDeliveryRemoteError } from './github-delivery-remote-client.js'
import type { LocalStore } from './local-store.js'
import type { GitHubDeliveryRuntime } from './github-delivery-runtime.js'
import type { WorkflowRuntime } from './workflow-runtime.js'
import type { WorkspaceOperationCoordinator } from './workspace-operation-coordinator.js'

export type GitHubDeliveryProcessorDisposition =
  | 'submitted'
  | 'waiting_for_approval'
  | 'advanced'
  | 'workflow_advanced'
  | 'recovery_required'
  | 'failed'
  | 'revoked'
  | 'local_conflict'

export type GitHubDeliveryProcessorResult = {
  intentId: string
  remoteRequestId: string | null
  disposition: GitHubDeliveryProcessorDisposition
  outcomeCode: string | null
}

export type GitHubDeliveryProcessorSummary = {
  results: GitHubDeliveryProcessorResult[]
}

type ProcessorStore = Pick<
  LocalStore,
  | 'listGitHubDeliveryIntents'
  | 'listArtifacts'
  | 'listManagedCodingWorkspaces'
  | 'getRun'
  | 'commitGitHubDeliveryIntentStatus'
  | 'commitGitHubDeliveryIntentCompletion'
>

type CompletedReconciliationStore = Pick<
  LocalStore,
  | 'listGitHubDeliveryIntents'
  | 'listArtifacts'
  | 'getRun'
>

type RemoteCompletedReconciliationStore = CompletedReconciliationStore & Pick<
  LocalStore,
  'commitGitHubDeliveryIntentCompletion'
>

type CompletedWorkflowDeps = {
  store: CompletedReconciliationStore
  workflow: WorkflowRuntime
  now?: () => string
}

type ProcessorRemote = {
  submit(input: SubmitGitHubDeliveryInput): Promise<SubmitGitHubDeliveryResult>
  listInbox(projectId: string): Promise<GitHubDeliveryRequestRecord[]>
  getRecoverySnapshot(
    input: GetGitHubDeliveryRecoverySnapshotInput,
  ): Promise<GitHubDeliveryRecoverySnapshot>
  withCredentialGrant(
    input: GitHubCredentialGrantInput,
    publisher: (
      credential: Readonly<EphemeralGitHubDeliveryCredential>,
    ) => Promise<{
      outcome: 'pushed' | 'already_present'
      expectedCommitSha: string
      repository: string
      headBranch: string
    }>,
  ): Promise<GitHubCredentialPublishResult>
  reportBranchPublication(
    input: ReportGitHubBranchPublicationInput,
  ): Promise<ReportGitHubBranchPublicationResult>
  createDraftPullRequest(
    input: CreateGitHubDraftPullRequestInput,
  ): Promise<CreateGitHubDraftPullRequestResult>
}

export type GitHubDeliveryProcessorDeps = {
  store: ProcessorStore
  remote: ProcessorRemote
  publisher: GitHubGitPublisher
  workflow: WorkflowRuntime
  preparationRuntime: GitHubDeliveryRuntime
  workspaceCoordinator: WorkspaceOperationCoordinator
  now?: () => string
  maxIntentsPerCycle?: number
  maxIntentsScannedPerCycle?: number
  minimumCredentialLifetimeMs?: number
  onIntentOperationChange?: (
    active: GitHubDeliveryActiveIntentOperation | null,
  ) => void | Promise<void>
}

export type GitHubDeliveryActiveIntentOperation = Readonly<{
  intentId: string
  expectedUpdatedAt: string
}>

const persistedPublisherOutcomeCodes: ReadonlySet<GitHubGitPublisherErrorCode> = new Set([
  'invalid_delivery_source',
  'operation_cancelled',
  'publisher_cleanup_failed',
  'remote_branch_diverged',
  'remote_unavailable',
  'repository_mismatch',
  'push_result_unknown',
  'workspace_dirty',
  'workspace_mismatch',
])

export type ReconcileCompletedGitHubDeliveryIntentsDeps =
  CompletedWorkflowDeps & {
    maxIntentsPerCycle?: number
  }

export type ReconcileRemoteCompletedGitHubDeliveryIntentsDeps = {
  store: RemoteCompletedReconciliationStore
  remote: Pick<ProcessorRemote, 'listInbox' | 'getRecoverySnapshot'>
  workflow: WorkflowRuntime
  now?: () => string
  maxIntentsPerCycle?: number
  maxIntentsScannedPerCycle?: number
}

export type ResumeGitHubDeliveryInput = {
  intentId: string
  expectedUpdatedAt: string
}

export type GitHubDeliveryProcessor = {
  recoverAndAdvance(): Promise<GitHubDeliveryProcessorSummary>
  resume(input: ResumeGitHubDeliveryInput): Promise<GitHubDeliveryProcessorResult>
}

export async function reconcileCompletedGitHubDeliveryIntents(
  deps: ReconcileCompletedGitHubDeliveryIntentsDeps,
): Promise<GitHubDeliveryProcessorSummary> {
  const maxIntentsPerCycle = validateCycleBound(deps.maxIntentsPerCycle ?? 20)
  const completed = [...await deps.store.listGitHubDeliveryIntents()]
    .filter((intent): intent is GitHubDeliveryIntent & {
      status: 'completed'
      completion: NonNullable<GitHubDeliveryIntent['completion']>
    } => intent.status === 'completed' && intent.completion !== undefined)
    .sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
    )
  const results: GitHubDeliveryProcessorResult[] = []
  for (const intent of completed) {
    if (results.length >= maxIntentsPerCycle) break
    if (await workflowAlreadyAdvanced(deps, intent)) continue
    try {
      results.push(await advanceWorkflow(
        deps,
        intent,
        intent.completion.remoteRequestId,
      ))
    } catch {
      results.push(safeResult(
        intent.id,
        intent.completion.remoteRequestId,
        'failed',
        'processor_failed',
      ))
    }
  }
  return { results }
}

export async function reconcileRemoteCompletedGitHubDeliveryIntents(
  deps: ReconcileRemoteCompletedGitHubDeliveryIntentsDeps,
): Promise<GitHubDeliveryProcessorSummary> {
  const maxIntentsPerCycle = validateCycleBound(deps.maxIntentsPerCycle ?? 20)
  const maxIntentsScannedPerCycle = validateScanBound(
    deps.maxIntentsScannedPerCycle ??
      Math.min(1_000, Math.max(maxIntentsPerCycle, maxIntentsPerCycle * 20)),
  )
  const eligible = [...await deps.store.listGitHubDeliveryIntents()]
    .filter((intent) =>
      intent.status === 'creating_pr' || intent.status === 'recovery_required',
    )
    .sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
    )
  const results: GitHubDeliveryProcessorResult[] = []
  let scanned = 0
  for (const source of eligible) {
    if (
      results.length >= maxIntentsPerCycle ||
      scanned >= maxIntentsScannedPerCycle
    ) {
      break
    }
    scanned += 1
    let remoteRequestId: string | null = null
    try {
      const inbox = await deps.remote.listInbox(source.teamProjectId)
      const candidates = inbox.filter((request) =>
        referencesIntentOrLogicalScope(source, request),
      )
      if (candidates.length === 0) continue
      const request = candidates[0]!
      remoteRequestId = request.id
      if (candidates.length !== 1 || !matchesAuthority(source, request)) {
        results.push(safeResult(
          source.id,
          request.id,
          'local_conflict',
          'authority_mismatch',
        ))
        continue
      }
      if (request.status !== 'completed') continue
      if (!await verifyPendingWorkflowAuthority(deps, source)) {
        results.push(safeResult(
          source.id,
          request.id,
          'local_conflict',
          'authority_mismatch',
        ))
        continue
      }
      const snapshot = await deps.remote.getRecoverySnapshot({
        projectId: source.teamProjectId,
        requestId: request.id,
      })
      if (!matchesExactRemoteCompletion(source, request, snapshot)) {
        results.push(safeResult(
          source.id,
          request.id,
          'local_conflict',
          'completion_evidence_invalid',
        ))
        continue
      }
      const completion = buildCompletion(
        deps,
        source,
        snapshot.request,
        snapshot.publication!.id,
        snapshot.pullRequest!,
      )
      if (!completion) {
        results.push(safeResult(
          source.id,
          request.id,
          'local_conflict',
          'completion_evidence_invalid',
        ))
        continue
      }
      const completed = {
        ...source,
        status: 'completed' as const,
        completion,
        updatedAt: completion.recordedAt,
      }
      const committed = await deps.store.commitGitHubDeliveryIntentCompletion({
        expectedIntent: source,
        intent: completed,
      })
      if (!committed.committed) {
        results.push(safeResult(
          source.id,
          request.id,
          'local_conflict',
          'stale_intent',
        ))
        continue
      }
      results.push(await advanceWorkflow(
        deps,
        committed.intent as GitHubDeliveryIntent & {
          status: 'completed'
          completion: typeof completion
        },
        request.id,
      ))
    } catch (error) {
      results.push(safeResult(
        source.id,
        remoteRequestId,
        'failed',
        error instanceof GitHubDeliveryRemoteError
          ? error.outcomeCode ?? error.code
          : 'processor_failed',
      ))
    }
  }
  return { results }
}

function validateCycleBound(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
    throw new Error('GitHub Delivery cycle bound must be between 1 and 100')
  }
  return value
}

function validateScanBound(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000) {
    throw new Error('GitHub Delivery scan bound must be between 1 and 1000')
  }
  return value
}

function consumesActionableBudget(
  source: GitHubDeliveryIntent,
  result: GitHubDeliveryProcessorResult,
): boolean {
  if (result.disposition === 'waiting_for_approval') return false
  return !(
    source.status === 'recovery_required' &&
    result.disposition === 'recovery_required'
  )
}

export function createGitHubDeliveryProcessor(
  deps: GitHubDeliveryProcessorDeps,
): GitHubDeliveryProcessor {
  const maxIntentsPerCycle = validateCycleBound(deps.maxIntentsPerCycle ?? 20)
  const maxIntentsScannedPerCycle = validateScanBound(
    deps.maxIntentsScannedPerCycle ??
      Math.min(1_000, Math.max(maxIntentsPerCycle, maxIntentsPerCycle * 20)),
  )
  const minimumCredentialLifetimeMs = deps.minimumCredentialLifetimeMs ?? 300_000
  if (!Number.isSafeInteger(minimumCredentialLifetimeMs) || minimumCredentialLifetimeMs < 1) {
    throw new Error('GitHub Delivery credential lifetime margin is invalid')
  }
  let nextScanOffset = 0
  return {
    async recoverAndAdvance() {
      const intents = [...await deps.store.listGitHubDeliveryIntents()]
        .filter((intent) => intent.status !== 'failed' && intent.status !== 'revoked')
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
      const start = intents.length === 0 ? 0 : nextScanOffset % intents.length
      const ordered = [...intents.slice(start), ...intents.slice(0, start)]
      const results: GitHubDeliveryProcessorResult[] = []
      let actionable = 0
      let scanned = 0
      let visited = 0
      for (const intent of ordered) {
        if (actionable >= maxIntentsPerCycle) break
        if (scanned >= maxIntentsScannedPerCycle) break
        visited += 1
        scanned += 1
        if (intent.status === 'completed' && await workflowAlreadyAdvanced(deps, intent)) {
          continue
        }
        const result = await processIntentWithFence(
          deps,
          intent,
          false,
          minimumCredentialLifetimeMs,
        )
        results.push(result)
        if (consumesActionableBudget(intent, result)) actionable += 1
      }
      if (intents.length > 0 && visited > 0) {
        nextScanOffset = (start + visited) % intents.length
      }
      return { results }
    },

    async resume(input) {
      const intents = await deps.store.listGitHubDeliveryIntents()
      const intent = intents.find((candidate) => candidate.id === input.intentId)
      if (!intent || intent.updatedAt !== input.expectedUpdatedAt) {
        return safeResult(input.intentId, null, 'local_conflict', 'stale_intent')
      }
      return processIntentWithFence(
        deps,
        intent,
        true,
        minimumCredentialLifetimeMs,
      )
    },
  }
}

async function processIntentWithFence(
  deps: GitHubDeliveryProcessorDeps,
  intent: GitHubDeliveryIntent,
  explicitResume: boolean,
  minimumCredentialLifetimeMs: number,
): Promise<GitHubDeliveryProcessorResult> {
  const notify = deps.onIntentOperationChange
  if (!notify) {
    return processIntent(deps, intent, explicitResume, minimumCredentialLifetimeMs)
  }
  try {
    await notify(Object.freeze({
      intentId: intent.id,
      expectedUpdatedAt: intent.updatedAt,
    }))
  } catch {
    try {
      await notify(null)
    } catch {
      // Registration failed closed; cleanup cannot make it safe to process.
    }
    return safeResult(
      intent.id,
      intent.completion?.remoteRequestId ?? null,
      'local_conflict',
      'processor_failed',
    )
  }
  try {
    const current = await reloadIntent(deps, intent.id)
    if (!current || !isDeepStrictEqual(current, intent)) {
      return safeResult(
        intent.id,
        intent.completion?.remoteRequestId ?? null,
        'local_conflict',
        'stale_intent',
      )
    }
    return await processIntent(
      deps,
      intent,
      explicitResume,
      minimumCredentialLifetimeMs,
    )
  } finally {
    try {
      await notify(null)
    } catch {
      // Clearing observability must not replace the settled processor result.
    }
  }
}

async function processIntent(
  deps: GitHubDeliveryProcessorDeps,
  intent: GitHubDeliveryIntent,
  explicitResume: boolean,
  minimumCredentialLifetimeMs: number,
): Promise<GitHubDeliveryProcessorResult> {
  let remoteRequestId: string | null = intent.completion?.remoteRequestId ?? null
  try {
    if (intent.status === 'recovery_required' && !explicitResume) {
      return safeResult(
        intent.id,
        null,
        'recovery_required',
        'explicit_resume_required',
      )
    }
    if (intent.status === 'completed') {
      return advanceWorkflow(
        deps,
        intent as GitHubDeliveryIntent & {
          status: 'completed'
          completion: NonNullable<GitHubDeliveryIntent['completion']>
        },
        intent.completion!.remoteRequestId,
      )
    }
    const inbox = await deps.remote.listInbox(intent.teamProjectId)
    const candidates = inbox.filter((request) =>
      referencesIntentOrLogicalScope(intent, request),
    )
    if (candidates.length === 0) {
      const resumesBeforeFirstSubmission =
        explicitResume && intent.status === 'recovery_required'
      if (intent.status !== 'approval_required' && !resumesBeforeFirstSubmission) {
        return safeResult(intent.id, null, 'local_conflict', 'remote_request_missing')
      }
      const artifacts = await deps.store.listArtifacts(intent.runId)
      const prPackage = artifacts.find((artifact) => artifact.id === intent.prPackageArtifactId)
      if (!prPackage || prPackage.kind !== 'pr' || prPackage.redacted !== true) {
        return safeResult(intent.id, null, 'local_conflict', 'pr_package_missing')
      }
      if (!await verifyPreparedAuthority(deps, intent)) {
        return safeResult(intent.id, null, 'local_conflict', 'authority_mismatch')
      }
      const submitted = await deps.remote.submit({
        projectId: intent.teamProjectId,
        intent: resumesBeforeFirstSubmission
          ? { ...intent, status: 'approval_required' }
          : intent,
        prTitle: prPackage.title,
        prBody: prPackage.content,
        expectedStateVersion: 0,
      })
      if (!matchesAuthority(intent, submitted.request)) {
        return safeResult(intent.id, submitted.request.id, 'local_conflict', 'authority_mismatch')
      }
      return safeResult(
        intent.id,
        submitted.request.id,
        'submitted',
        submitted.outcomeCode,
      )
    }
    if (candidates.length !== 1) {
      return safeResult(
        intent.id,
        candidates[0]?.id ?? null,
        'local_conflict',
        'authority_mismatch',
      )
    }
    const remoteRequest = candidates[0]!
    remoteRequestId = remoteRequest.id
    if (!matchesAuthority(intent, remoteRequest)) {
      if (!matchesRevisionLineage(intent, remoteRequest)) {
        return safeResult(
          intent.id,
          remoteRequest.id,
          'local_conflict',
          'authority_mismatch',
        )
      }
      if (!await verifyPreparedAuthority(deps, intent)) {
        return safeResult(intent.id, remoteRequest.id, 'local_conflict', 'authority_mismatch')
      }
      const artifacts = await deps.store.listArtifacts(intent.runId)
      const prPackage = artifacts.find((artifact) => artifact.id === intent.prPackageArtifactId)
      if (!prPackage || prPackage.kind !== 'pr' || prPackage.redacted !== true) {
        return safeResult(intent.id, remoteRequest.id, 'local_conflict', 'pr_package_missing')
      }
      let submitted: SubmitGitHubDeliveryResult
      try {
        submitted = await deps.remote.submit({
          projectId: intent.teamProjectId,
          intent,
          prTitle: prPackage.title,
          prBody: prPackage.content,
          expectedStateVersion: remoteRequest.stateVersion,
        })
      } catch (error) {
        if (
          error instanceof GitHubDeliveryRemoteError &&
          error.outcomeCode === 'stale_version'
        ) {
          return safeResult(
            intent.id,
            remoteRequest.id,
            'local_conflict',
            'stale_intent',
          )
        }
        throw error
      }
      if (!matchesRevisionResponse(intent, remoteRequest, submitted.request)) {
        return safeResult(
          intent.id,
          submitted.request.id,
          'local_conflict',
          'authority_mismatch',
        )
      }
      return safeResult(
        intent.id,
        submitted.request.id,
        'submitted',
        submitted.outcomeCode,
      )
    }
    if (!await verifyPreparedAuthority(deps, intent)) {
      return safeResult(intent.id, remoteRequest.id, 'local_conflict', 'authority_mismatch')
    }
    const recovered = await deps.remote.getRecoverySnapshot({
      projectId: intent.teamProjectId,
      requestId: remoteRequest.id,
    })
    if (
      recovered.request.id !== remoteRequest.id ||
      !matchesAuthority(intent, recovered.request) ||
      !matchesSnapshotAuthority(intent, recovered)
    ) {
      return safeResult(intent.id, remoteRequest.id, 'local_conflict', 'authority_mismatch')
    }
    return await advanceRecovered(
      deps,
      intent,
      recovered,
      explicitResume,
      minimumCredentialLifetimeMs,
    )
  } catch (error) {
    const latest = await reloadIntent(deps, intent.id) ?? intent
    const failure = error
    if (failure instanceof GitHubDeliveryRemoteError) {
      const operatorOutcomeCode = failure.operatorOutcomeCode !== null &&
        persistedPublisherOutcomeCodes.has(failure.operatorOutcomeCode)
        ? failure.operatorOutcomeCode
        : undefined
      if (failure.outcomeCode === 'binding_inactive') {
        const revoked = await transitionTo(deps, latest, 'revoked')
        return revoked
          ? safeResult(intent.id, remoteRequestId, 'revoked', failure.outcomeCode ?? failure.code)
          : safeResult(intent.id, remoteRequestId, 'local_conflict', 'stale_intent')
      }
      if (
        operatorOutcomeCode !== undefined ||
        failure.retryable ||
        failure.code === 'conflict' ||
        failure.code === 'publisher_failed'
      ) {
        return requireRecovery(
          deps,
          latest,
          remoteRequestId,
          failure.outcomeCode ?? failure.code,
          false,
          operatorOutcomeCode,
        )
      }
      return requireRecovery(
        deps,
        latest,
        remoteRequestId,
        failure.outcomeCode ?? failure.code,
      )
    }
    if (latest.status === 'completed' || latest.status === 'failed' || latest.status === 'revoked') {
      return safeResult(intent.id, remoteRequestId, 'failed', 'processor_failed')
    }
    return requireRecovery(
      deps,
      latest,
      remoteRequestId,
      'processor_failed',
    )
  }
}

async function reloadIntent(
  deps: GitHubDeliveryProcessorDeps,
  intentId: string,
): Promise<GitHubDeliveryIntent | null> {
  const intents = await deps.store.listGitHubDeliveryIntents()
  return intents.find((candidate) => candidate.id === intentId) ?? null
}

async function advanceRecovered(
  deps: GitHubDeliveryProcessorDeps,
  source: GitHubDeliveryIntent,
  snapshot: GitHubDeliveryRecoverySnapshot,
  explicitResume: boolean,
  minimumCredentialLifetimeMs: number,
): Promise<GitHubDeliveryProcessorResult> {
  const request = snapshot.request
  if (request.status === 'revoked') {
    const local = await transitionTo(deps, source, 'revoked')
    return local
      ? safeResult(source.id, request.id, 'revoked', request.outcomeCode)
      : safeResult(source.id, request.id, 'local_conflict', 'stale_intent')
  }
  if (request.status === 'failed') {
    const local = await transitionTo(deps, source, 'failed')
    return local
      ? safeResult(source.id, request.id, 'failed', request.outcomeCode)
      : safeResult(source.id, request.id, 'local_conflict', 'stale_intent')
  }
  if (request.status === 'approval_required') {
    return safeResult(source.id, request.id, 'waiting_for_approval', null)
  }
  if (request.status === 'recovery_required') {
    if (!explicitResume) {
      return requireRecovery(
        deps,
        source,
        request.id,
        request.outcomeCode,
        snapshot.approval !== null,
      )
    }
    if (!snapshot.approval) {
      return safeResult(source.id, request.id, 'local_conflict', 'authority_mismatch')
    }
    if (snapshot.publication?.status === 'verified') {
      if (!await verifyPreparedAuthority(deps, source)) {
        return safeResult(source.id, request.id, 'local_conflict', 'authority_mismatch')
      }
      const published = source.status === 'creating_pr'
        ? source
        : await transitionTo(deps, source, 'branch_published')
      if (!published) return safeResult(source.id, request.id, 'local_conflict', 'stale_intent')
      return createPullRequest(deps, published, request, snapshot.publication)
    }
  }
  if (
    request.status === 'publishing_branch' &&
    snapshot.grant?.status === 'issued' &&
    snapshot.publication === null &&
    !explicitResume
  ) {
    return requireRecovery(
      deps,
      source,
      request.id,
      'credential_issued_without_publication',
      true,
    )
  }
  if (request.status === 'completed') {
    return completeFromRemote(deps, source, snapshot)
  }
  if (source.status === 'recovery_required' && !explicitResume) {
    return requireRecovery(
      deps,
      source,
      request.id,
      'explicit_resume_required',
      snapshot.approval !== null,
    )
  }
  if (
    request.status === 'branch_published' ||
    request.status === 'creating_pr' ||
    (request.status === 'publishing_branch' && snapshot.publication?.status === 'verified')
  ) {
    const branchPublication = snapshot.publication
    if (!branchPublication || branchPublication.status !== 'verified') {
      return requireRecovery(deps, source, request.id, 'publication_evidence_missing', true)
    }
    if (!await verifyPreparedAuthority(deps, source)) {
      return safeResult(source.id, request.id, 'local_conflict', 'authority_mismatch')
    }
    const published = source.status === 'creating_pr'
      ? source
      : await transitionTo(deps, source, 'branch_published')
    if (!published) return safeResult(source.id, request.id, 'local_conflict', 'stale_intent')
    return createPullRequest(deps, published, request, branchPublication)
  }
  if (
    request.status !== 'approved' &&
    request.status !== 'publishing_branch' &&
    request.status !== 'recovery_required'
  ) {
    return requireRecovery(deps, source, request.id, 'remote_state_unsupported', snapshot.approval !== null)
  }
  if (request.status === 'publishing_branch' && !explicitResume) {
    return requireRecovery(deps, source, request.id, 'publication_resume_required')
  }

  if (!await verifyPreparedAuthority(deps, source)) {
    return safeResult(source.id, request.id, 'local_conflict', 'authority_mismatch')
  }
  let publishing = source
  if (source.status !== 'publishing_branch') {
    const approved = await transitionTo(deps, source, 'approved')
    if (!approved) return safeResult(source.id, request.id, 'local_conflict', 'stale_intent')
    if (!await verifyPreparedAuthority(deps, approved)) {
      return requireRecovery(deps, approved, request.id, 'authority_mismatch')
    }
    const transitioned = await transitionTo(deps, approved, 'publishing_branch')
    if (!transitioned) return safeResult(source.id, request.id, 'local_conflict', 'stale_intent')
    publishing = transitioned
  }
  if (!await verifyPreparedAuthority(deps, publishing)) {
    return requireRecovery(deps, publishing, request.id, 'authority_mismatch')
  }

  const published = await deps.remote.withCredentialGrant(
    {
      projectId: source.teamProjectId,
      requestId: request.id,
      expectedStateVersion: request.stateVersion,
    },
    async (credential) => {
      if (
        credential.repositoryId !== source.repositoryId ||
        credential.repository !== source.repository ||
        credential.headBranch !== source.headBranch ||
        credential.expectedCommitSha !== source.expectedCommitSha
      ) {
        throw new Error('Credential authority mismatch')
      }
      if (!await verifyPreparedAuthority(deps, publishing)) {
        throw new Error('Local authority changed during credential issuance')
      }
      return deps.workspaceCoordinator.runExclusive(source.workspaceId, async () => {
        const currentIntent = await reloadIntent(deps, publishing.id)
        const credentialExpiry = Date.parse(credential.expiresAt)
        const currentTime = Date.parse(deps.now?.() ?? new Date().toISOString())
        if (
          !currentIntent ||
          JSON.stringify(currentIntent) !== JSON.stringify(publishing) ||
          !Number.isFinite(credentialExpiry) ||
          !Number.isFinite(currentTime) ||
          credentialExpiry - currentTime < minimumCredentialLifetimeMs
        ) {
          throw new Error('Credential or local authority is no longer current')
        }
        const workspaces = await deps.store.listManagedCodingWorkspaces(source.localProjectId)
        const matchingWorkspaces = workspaces.filter((workspace) => (
          workspace.id === source.workspaceId &&
          workspace.projectId === source.localProjectId &&
          workspace.headCommitSha === source.expectedCommitSha &&
          workspace.cleanupStatus === 'active' &&
          !workspace.deletedAt
        ))
        const workspace = matchingWorkspaces[0]
        if (!workspace || matchingWorkspaces.length !== 1) {
          throw new Error('Workspace authority mismatch')
        }
        return deps.publisher.publish({
          worktreePath: workspace.worktreePath,
          repository: source.repository,
          headBranch: source.headBranch,
          expectedCommitSha: source.expectedCommitSha,
          token: credential.token,
        })
      })
    },
  )
  if (
    !matchesAuthority(source, published.request) ||
    published.request.status !== 'publishing_branch' ||
    published.grant.requestId !== request.id ||
    published.grant.intentRevision !== published.request.intentRevision ||
    published.grant.repositoryId !== source.repositoryId ||
    published.grant.status !== 'issued'
  ) {
    return safeResult(source.id, request.id, 'local_conflict', 'authority_mismatch')
  }
  if (!await verifyPreparedAuthority(deps, publishing)) {
    return requireRecovery(deps, publishing, request.id, 'authority_mismatch')
  }
  const report = await deps.remote.reportBranchPublication({
    projectId: source.teamProjectId,
    requestId: request.id,
    grantId: published.grant.id,
    expectedStateVersion: published.request.stateVersion,
    expectedGrantVersion: published.grant.version,
    reportedOutcomeCode: published.publisherResult.outcome,
  })
  if (
    !matchesAuthority(source, report.request) ||
    report.publication.requestId !== request.id ||
    report.publication.grantId !== published.grant.id ||
    report.publication.intentRevision !== report.request.intentRevision ||
    (report.outcomeCode === 'publication_verified' && (
      report.request.status !== 'branch_published' ||
      report.publication.status !== 'verified' ||
      report.publication.verifiedHeadSha !== source.expectedCommitSha ||
      report.publication.outcomeCode !== 'branch_verified'
    ))
  ) {
    return safeResult(source.id, request.id, 'local_conflict', 'authority_mismatch')
  }
  if (report.outcomeCode !== 'publication_verified') {
    return requireRecovery(deps, publishing, request.id, report.publication.outcomeCode)
  }
  if (!await verifyPreparedAuthority(deps, publishing)) {
    return requireRecovery(deps, publishing, request.id, 'authority_mismatch')
  }
  const branchPublished = publishing.status === 'creating_pr'
    ? publishing
    : await transitionTo(deps, publishing, 'branch_published')
  if (!branchPublished) return safeResult(source.id, request.id, 'local_conflict', 'stale_intent')
  return createPullRequest(deps, branchPublished, report.request, report.publication)
}

async function createPullRequest(
  deps: GitHubDeliveryProcessorDeps,
  source: GitHubDeliveryIntent,
  request: GitHubDeliveryRequestRecord,
  publication: NonNullable<GitHubDeliveryRecoverySnapshot['publication']>,
): Promise<GitHubDeliveryProcessorResult> {
  if (!await verifyPreparedAuthority(deps, source)) {
    return safeResult(source.id, request.id, 'local_conflict', 'authority_mismatch')
  }
  const creating = await transitionTo(deps, source, 'creating_pr')
  if (!creating) return safeResult(source.id, request.id, 'local_conflict', 'stale_intent')
  if (!await verifyPreparedAuthority(deps, creating)) {
    return requireRecovery(deps, creating, request.id, 'authority_mismatch')
  }
  const result = await deps.remote.createDraftPullRequest({
    projectId: source.teamProjectId,
    requestId: request.id,
    publicationId: publication.id,
    expectedStateVersion: request.stateVersion,
  })
  if (
    !matchesAuthority(source, result.request) ||
    result.pullRequest.requestId !== request.id ||
    result.pullRequest.publicationId !== publication.id ||
    result.pullRequest.intentRevision !== result.request.intentRevision ||
    result.pullRequest.headBranch !== source.headBranch ||
    result.pullRequest.baseBranch !== source.baseBranch ||
    result.pullRequest.headSha !== source.expectedCommitSha ||
    (result.outcomeCode === 'pull_request_completed' && (
      result.request.status !== 'completed' ||
      result.request.outcomeCode !== 'draft_pr_created' ||
      result.pullRequest.status !== 'completed' ||
      result.pullRequest.outcomeCode !== 'draft_pr_created'
    ))
  ) {
    return safeResult(source.id, request.id, 'local_conflict', 'authority_mismatch')
  }
  if (result.outcomeCode !== 'pull_request_completed') {
    return requireRecovery(deps, creating, request.id, result.pullRequest.outcomeCode)
  }
  return persistCompletionAndAdvance(deps, creating, result.request, publication.id, result.pullRequest)
}

async function completeFromRemote(
  deps: GitHubDeliveryProcessorDeps,
  source: GitHubDeliveryIntent,
  snapshot: GitHubDeliveryRecoverySnapshot,
): Promise<GitHubDeliveryProcessorResult> {
  if (
    snapshot.request.status !== 'completed' ||
    snapshot.request.outcomeCode !== 'draft_pr_created' ||
    !snapshot.approval ||
    !snapshot.grant ||
    snapshot.grant.status !== 'consumed' ||
    !snapshot.publication ||
    snapshot.publication.status !== 'verified' ||
    snapshot.publication.outcomeCode !== 'branch_verified' ||
    snapshot.publication.verifiedHeadSha !== source.expectedCommitSha ||
    snapshot.publication.grantId !== snapshot.grant.id ||
    !snapshot.pullRequest ||
    snapshot.pullRequest.status !== 'completed' ||
    snapshot.pullRequest.outcomeCode !== 'draft_pr_created'
  ) {
    return requireRecovery(
      deps,
      source,
      snapshot.request.id,
      'completion_evidence_missing',
      snapshot.approval !== null,
    )
  }
  if (!await verifyPreparedAuthority(deps, source)) {
    return safeResult(source.id, snapshot.request.id, 'local_conflict', 'authority_mismatch')
  }
  const creating = await transitionTo(deps, source, 'creating_pr')
  if (!creating) return safeResult(source.id, snapshot.request.id, 'local_conflict', 'stale_intent')
  return persistCompletionAndAdvance(
    deps,
    creating,
    snapshot.request,
    snapshot.publication.id,
    snapshot.pullRequest,
  )
}

async function persistCompletionAndAdvance(
  deps: GitHubDeliveryProcessorDeps,
  source: GitHubDeliveryIntent,
  request: GitHubDeliveryRequestRecord,
  publicationId: string,
  pullRequest: NonNullable<GitHubDeliveryRecoverySnapshot['pullRequest']>,
): Promise<GitHubDeliveryProcessorResult> {
  const completion = buildCompletion(
    deps,
    source,
    request,
    publicationId,
    pullRequest,
  )
  if (!completion) {
    return requireRecovery(deps, source, request.id, 'completion_evidence_invalid')
  }
  const completed: GitHubDeliveryIntent & { status: 'completed'; completion: typeof completion } = {
    ...source,
    status: 'completed',
    completion,
    updatedAt: completion.recordedAt,
  }
  const committed = await deps.store.commitGitHubDeliveryIntentCompletion({
    expectedIntent: source,
    intent: completed,
  })
  if (!committed.committed) {
    return safeResult(source.id, request.id, 'local_conflict', 'stale_intent')
  }
  return advanceWorkflow(
    deps,
    committed.intent as GitHubDeliveryIntent & { status: 'completed'; completion: typeof completion },
    request.id,
  )
}

function buildCompletion(
  deps: { now?: () => string },
  source: GitHubDeliveryIntent,
  request: GitHubDeliveryRequestRecord,
  publicationId: string,
  pullRequest: NonNullable<GitHubDeliveryRecoverySnapshot['pullRequest']>,
): NonNullable<GitHubDeliveryIntent['completion']> | null {
  if (
    pullRequest.status !== 'completed' ||
    pullRequest.pullRequestId === null ||
    pullRequest.pullRequestNumber === null ||
    pullRequest.safeUrl === null ||
    pullRequest.providerCreatedAt === null
  ) {
    return null
  }
  try {
    const recordedAt = timestampAfter(
      deps,
      source.updatedAt,
      pullRequest.providerCreatedAt,
    )
    return createGitHubDeliveryCompletion({
      intent: source,
      remoteRequestId: request.id,
      publicationId,
      pullRequestOutcomeId: pullRequest.id,
      pullRequestId: pullRequest.pullRequestId,
      pullRequestNumber: pullRequest.pullRequestNumber,
      pullRequestUrl: pullRequest.safeUrl,
      repository: source.repository,
      baseBranch: source.baseBranch,
      headBranch: source.headBranch,
      headSha: source.expectedCommitSha,
      draft: true,
      providerCreatedAt: pullRequest.providerCreatedAt,
      recordedAt,
    })
  } catch {
    return null
  }
}

async function advanceWorkflow(
  deps: CompletedWorkflowDeps,
  source: GitHubDeliveryIntent & { status: 'completed'; completion: NonNullable<GitHubDeliveryIntent['completion']> },
  requestId: string,
): Promise<GitHubDeliveryProcessorResult> {
  const run = await deps.store.getRun(source.runId)
  if (!run) return safeResult(source.id, requestId, 'failed', 'workflow_run_missing')
  if (workflowMatchesCompletion(run, source)) {
    return safeResult(source.id, requestId, 'workflow_advanced', 'draft_pr_created')
  }
  if (!await verifyCompletedWorkflowAuthority(deps, source, run)) {
    return safeResult(source.id, requestId, 'local_conflict', 'authority_mismatch')
  }
  const workflowResult = await deps.workflow.execute({
    runId: source.runId,
    command: {
      type: 'complete_pr',
      nodeId: source.nodeId,
      artifactId: source.prPackageArtifactId,
    },
    now: timestampAfter(deps, source.updatedAt),
    expectedRunUpdatedAt: run.updatedAt,
  })
  if (workflowResult.applied) {
    return safeResult(source.id, requestId, 'workflow_advanced', 'draft_pr_created')
  }
  const replayedRun = await deps.store.getRun(source.runId)
  return replayedRun && workflowMatchesCompletion(replayedRun, source)
    ? safeResult(source.id, requestId, 'workflow_advanced', 'draft_pr_created')
    : safeResult(source.id, requestId, 'failed', 'workflow_not_advanced')
}

async function workflowAlreadyAdvanced(
  deps: Pick<CompletedWorkflowDeps, 'store'>,
  source: GitHubDeliveryIntent,
): Promise<boolean> {
  if (source.status !== 'completed' || !source.completion) return false
  const run = await deps.store.getRun(source.runId)
  return Boolean(run && workflowMatchesCompletion(run, source as GitHubDeliveryIntent & {
    status: 'completed'
    completion: NonNullable<GitHubDeliveryIntent['completion']>
  }))
}

function workflowMatchesCompletion(
  run: NonNullable<Awaited<ReturnType<ProcessorStore['getRun']>>>,
  source: GitHubDeliveryIntent & { completion: NonNullable<GitHubDeliveryIntent['completion']> },
): boolean {
  const prNode = run.nodes.find((node) => node.id === source.nodeId)
  return prNode?.status === 'success' && run.pullRequestUrl === source.completion.pullRequestUrl
}

async function verifyCompletedWorkflowAuthority(
  deps: Pick<CompletedWorkflowDeps, 'store'>,
  source: GitHubDeliveryIntent & {
    status: 'completed'
    completion: NonNullable<GitHubDeliveryIntent['completion']>
  },
  run: NonNullable<Awaited<ReturnType<CompletedReconciliationStore['getRun']>>>,
): Promise<boolean> {
  const completion = source.completion
  if (
    source.updatedAt !== completion.recordedAt ||
    !await matchesPendingWorkflowAuthority(deps, source, run)
  ) {
    return false
  }
  try {
    const recordedAt = Date.parse(completion.recordedAt)
    if (!Number.isFinite(recordedAt)) return false
    const { completion: _completion, ...intentWithoutCompletion } = source
    const canonical = createGitHubDeliveryCompletion({
      intent: {
        ...intentWithoutCompletion,
        status: 'creating_pr',
        updatedAt: new Date(recordedAt - 1).toISOString(),
      },
      remoteRequestId: completion.remoteRequestId,
      publicationId: completion.publicationId,
      pullRequestOutcomeId: completion.pullRequestOutcomeId,
      pullRequestId: completion.pullRequestId,
      pullRequestNumber: completion.pullRequestNumber,
      pullRequestUrl: completion.pullRequestUrl,
      repository: source.repository,
      baseBranch: source.baseBranch,
      headBranch: source.headBranch,
      headSha: source.expectedCommitSha,
      draft: true,
      providerCreatedAt: completion.providerCreatedAt,
      recordedAt: completion.recordedAt,
    })
    return JSON.stringify(canonical) === JSON.stringify(completion)
  } catch {
    return false
  }
}

async function verifyPendingWorkflowAuthority(
  deps: Pick<CompletedWorkflowDeps, 'store'>,
  source: GitHubDeliveryIntent,
): Promise<boolean> {
  const run = await deps.store.getRun(source.runId)
  return Boolean(run && await matchesPendingWorkflowAuthority(
    deps,
    source,
    run,
  ))
}

async function matchesPendingWorkflowAuthority(
  deps: Pick<CompletedWorkflowDeps, 'store'>,
  source: GitHubDeliveryIntent,
  run: NonNullable<Awaited<ReturnType<CompletedReconciliationStore['getRun']>>>,
): Promise<boolean> {
  const prNode = run.nodes.find((node) => node.id === source.nodeId)
  if (
    source.redacted !== true ||
    run.id !== source.runId ||
    run.projectId !== source.localProjectId ||
    run.version !== source.runVersion ||
    run.currentNodeId !== source.nodeId ||
    run.pullRequestUrl !== undefined ||
    !prNode ||
    prNode.kind !== 'pr' ||
    prNode.stage !== 'pr' ||
    prNode.status !== 'running' ||
    !prNode.artifactIds.includes(source.prPackageArtifactId)
  ) {
    return false
  }
  const packages = (await deps.store.listArtifacts(source.runId)).filter(
    (artifact) => artifact.id === source.prPackageArtifactId,
  )
  return packages.length === 1 && matchesCompletedPackage(source, packages[0]!)
}

function matchesCompletedPackage(
  source: GitHubDeliveryIntent,
  artifact: Artifact,
): boolean {
  if (
    artifact.runId !== source.runId ||
    artifact.nodeId !== source.nodeId ||
    artifact.kind !== 'pr' ||
    artifact.redacted !== true ||
    artifact.updatedAt !== source.prPackageUpdatedAt
  ) {
    return false
  }
  const material = JSON.stringify({
    id: artifact.id,
    title: artifact.title,
    summary: artifact.summary,
    content: artifact.content,
    githubDeliverySource: artifact.githubDeliverySource,
    updatedAt: artifact.updatedAt,
  })
  return sha256Hex(material) === source.prPackageDigest
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

async function requireRecovery(
  deps: GitHubDeliveryProcessorDeps,
  source: GitHubDeliveryIntent,
  requestId: string | null,
  outcomeCode: string | null,
  approvalValidated = false,
  operatorOutcomeCode?: GitHubGitPublisherErrorCode,
): Promise<GitHubDeliveryProcessorResult> {
  if (source.status === 'approval_required') {
    if (!approvalValidated) {
      const recovered = await transitionTo(
        deps,
        source,
        'recovery_required',
        operatorOutcomeCode,
      )
      return recovered
        ? safeResult(source.id, requestId, 'recovery_required', outcomeCode)
        : safeResult(source.id, requestId, 'local_conflict', 'stale_intent')
    }
    const approved = await transitionTo(deps, source, 'approved')
    if (!approved) return safeResult(source.id, requestId, 'local_conflict', 'stale_intent')
    const publishing = await transitionTo(deps, approved, 'publishing_branch')
    if (!publishing) return safeResult(source.id, requestId, 'local_conflict', 'stale_intent')
    const recovered = await transitionTo(
      deps,
      publishing,
      'recovery_required',
      operatorOutcomeCode,
    )
    return recovered
      ? safeResult(source.id, requestId, 'recovery_required', outcomeCode)
      : safeResult(source.id, requestId, 'local_conflict', 'stale_intent')
  }
  const local = await transitionTo(
    deps,
    source,
    'recovery_required',
    operatorOutcomeCode,
  )
  return local
    ? safeResult(source.id, requestId, 'recovery_required', outcomeCode)
    : safeResult(source.id, requestId, 'local_conflict', 'stale_intent')
}

const transitionPaths: Readonly<Record<string, readonly GitHubDeliveryIntent['status'][]>> = {
  'approval_required:approved': ['approved'],
  'approval_required:publishing_branch': ['approved', 'publishing_branch'],
  'approval_required:branch_published': ['approved', 'publishing_branch', 'branch_published'],
  'approval_required:creating_pr': ['approved', 'publishing_branch', 'branch_published', 'creating_pr'],
  'approved:publishing_branch': ['publishing_branch'],
  'approved:branch_published': ['publishing_branch', 'branch_published'],
  'approved:creating_pr': ['publishing_branch', 'branch_published', 'creating_pr'],
  'publishing_branch:branch_published': ['branch_published'],
  'publishing_branch:creating_pr': ['branch_published', 'creating_pr'],
  'branch_published:creating_pr': ['creating_pr'],
  'recovery_required:approved': ['approved'],
  'recovery_required:publishing_branch': ['publishing_branch'],
  'recovery_required:branch_published': ['branch_published'],
  'recovery_required:creating_pr': ['creating_pr'],
}

async function transitionTo(
  deps: GitHubDeliveryProcessorDeps,
  source: GitHubDeliveryIntent,
  target: GitHubDeliveryIntent['status'],
  operatorOutcomeCode?: GitHubGitPublisherErrorCode,
): Promise<GitHubDeliveryIntent | null> {
  if (source.status === target) return source
  let current = source
  const path = target === 'failed' || target === 'revoked' || target === 'recovery_required'
    ? [target]
    : transitionPaths[`${source.status}:${target}`]
  if (!path) return null
  for (const status of path) {
    const next: GitHubDeliveryIntent = {
      ...current,
      status,
      updatedAt: timestampAfter(deps, current.updatedAt),
    }
    let committed: Awaited<ReturnType<ProcessorStore['commitGitHubDeliveryIntentStatus']>>
    try {
      committed = await deps.store.commitGitHubDeliveryIntentStatus({
        expectedIntent: current,
        intent: next,
        ...(status === 'recovery_required' && operatorOutcomeCode !== undefined
          ? { operatorOutcomeCode }
          : {}),
      })
    } catch {
      return null
    }
    if (!committed.committed) return null
    current = committed.intent
  }
  return current
}

function timestampAfter(
  deps: { now?: () => string },
  ...timestamps: string[]
): string {
  const supplied = Date.parse(deps.now?.() ?? new Date().toISOString())
  const parsedTimestamps = timestamps.map((value) => Date.parse(value))
  if (!Number.isFinite(supplied) || parsedTimestamps.some((value) => !Number.isFinite(value))) {
    throw new Error('GitHub Delivery timestamp authority is invalid')
  }
  const floor = Math.max(...parsedTimestamps) + 1
  return new Date(Math.max(supplied, floor)).toISOString()
}

function matchesSnapshotAuthority(
  intent: GitHubDeliveryIntent,
  snapshot: GitHubDeliveryRecoverySnapshot,
): boolean {
  const { request, approval, grant, publication, pullRequest } = snapshot
  const publicationReferencesRecoverablePriorGrant = Boolean(
    publication &&
    grant &&
    publication.grantId !== grant.id &&
    request.status === 'publishing_branch' &&
    grant.status === 'issued' &&
    (publication.status === 'recovery_required' || publication.status === 'conflict') &&
    pullRequest === null
  )
  const approvalRequired = request.status === 'approved' ||
    request.status === 'publishing_branch' ||
    request.status === 'branch_published' ||
    request.status === 'creating_pr' ||
    request.status === 'completed'
  return (
    (!approvalRequired || approval !== null) &&
    (!approval || (
      approval.requestId === request.id &&
      approval.intentRevision === request.intentRevision &&
      approval.requestStateVersion <= request.stateVersion &&
      approval.intentDigest === intent.intentDigest &&
      approval.repositoryBindingId === intent.repositoryBindingId &&
      approval.repositoryBindingVersion === intent.repositoryBindingVersion &&
      approval.runId === intent.runId &&
      approval.runVersion === intent.runVersion &&
      approval.nodeId === intent.nodeId &&
      approval.repositoryId === intent.repositoryId &&
      approval.baseBranch === intent.baseBranch &&
      approval.headBranch === intent.headBranch &&
      approval.expectedCommitSha === intent.expectedCommitSha &&
      approval.testEvidenceDigest === intent.testEvidenceDigest &&
      approval.packageDigest === intent.prPackageDigest
    )) &&
    (!grant || (
      approval !== null &&
      grant.requestId === request.id &&
      grant.intentRevision === request.intentRevision &&
      grant.approvalId === approval.id &&
      grant.repositoryId === intent.repositoryId
    )) &&
    (!publication || (
      grant !== null &&
      publication.requestId === request.id &&
      publication.intentRevision === request.intentRevision &&
      (!grant || publication.grantId === grant.id || publicationReferencesRecoverablePriorGrant) &&
      (publication.status === 'verified'
        ? publication.verifiedHeadSha === intent.expectedCommitSha
        : publication.verifiedHeadSha === null || publication.verifiedHeadSha === intent.expectedCommitSha)
    )) &&
    (!pullRequest || (
      pullRequest.requestId === request.id &&
      pullRequest.intentRevision === request.intentRevision &&
      (!publication || pullRequest.publicationId === publication.id) &&
      pullRequest.headBranch === intent.headBranch &&
      pullRequest.baseBranch === intent.baseBranch &&
      pullRequest.headSha === intent.expectedCommitSha
    ))
  )
}

function matchesExactRemoteCompletion(
  intent: GitHubDeliveryIntent,
  inboxRequest: GitHubDeliveryRequestRecord,
  snapshot: GitHubDeliveryRecoverySnapshot,
): boolean {
  const { request, approval, grant, publication, pullRequest } = snapshot
  return (
    isDeepStrictEqual(request, inboxRequest) &&
    matchesAuthority(intent, request) &&
    matchesSnapshotAuthority(intent, snapshot) &&
    request.status === 'completed' &&
    request.outcomeCode === 'draft_pr_created' &&
    approval !== null &&
    grant !== null &&
    grant.status === 'consumed' &&
    grant.consumedAt !== null &&
    publication !== null &&
    publication.status === 'verified' &&
    publication.outcomeCode === 'branch_verified' &&
    publication.verifiedHeadSha === intent.expectedCommitSha &&
    publication.verifiedAt !== null &&
    publication.grantId === grant.id &&
    pullRequest !== null &&
    pullRequest.status === 'completed' &&
    pullRequest.outcomeCode === 'draft_pr_created' &&
    pullRequest.pullRequestId !== null &&
    pullRequest.pullRequestNumber !== null &&
    pullRequest.safeUrl !== null &&
    pullRequest.providerCreatedAt !== null &&
    pullRequest.draft === true &&
    pullRequest.publicationId === publication.id
  )
}

async function verifyPreparedAuthority(
  deps: GitHubDeliveryProcessorDeps,
  expected: GitHubDeliveryIntent,
): Promise<boolean> {
  const prepared = await deps.preparationRuntime.prepare({
    runId: expected.runId,
    nodeId: expected.nodeId,
  })
  return prepared.status === 'prepared' && JSON.stringify(prepared.intent) === JSON.stringify(expected)
}

function referencesIntentOrLogicalScope(
  intent: GitHubDeliveryIntent,
  request: GitHubDeliveryRequestRecord,
): boolean {
  return request.localIntentId === intent.id || (
    request.logicalIdempotencyKey === intent.idempotencyKey &&
    request.organizationId === intent.organizationId &&
    request.projectId === intent.teamProjectId &&
    request.runId === intent.runId &&
    request.nodeId === intent.nodeId &&
    request.deliverySeriesKey === intent.deliverySeriesKey &&
    request.deliveryAttempt === intent.deliveryAttempt
  )
}

function matchesRevisionLineage(
  intent: GitHubDeliveryIntent,
  request: GitHubDeliveryRequestRecord,
): boolean {
  return (
    intent.status === 'approval_required' &&
    request.localIntentId !== intent.id &&
    (request.status === 'approval_required' || request.status === 'approved') &&
    request.organizationId === intent.organizationId &&
    request.projectId === intent.teamProjectId &&
    request.localProjectId === intent.localProjectId &&
    request.runId === intent.runId &&
    request.nodeId === intent.nodeId &&
    request.repositoryBindingId === intent.repositoryBindingId &&
    request.repositoryBindingVersion === intent.repositoryBindingVersion &&
    request.installationId === intent.installationId &&
    request.repositoryId === intent.repositoryId &&
    request.repository === intent.repository &&
    request.workspaceId === intent.workspaceId &&
    request.deliverySeriesKey === intent.deliverySeriesKey &&
    request.deliveryAttempt === intent.deliveryAttempt &&
    request.logicalIdempotencyKey === intent.idempotencyKey &&
    request.baseBranch === intent.baseBranch &&
    request.headBranch === intent.headBranch
  )
}

function matchesRevisionResponse(
  intent: GitHubDeliveryIntent,
  previous: GitHubDeliveryRequestRecord,
  revised: GitHubDeliveryRequestRecord,
): boolean {
  return (
    revised.id === previous.id &&
    revised.stateVersion === previous.stateVersion + 1 &&
    revised.intentRevision === previous.intentRevision + 1 &&
    revised.status === 'approval_required' &&
    revised.outcomeCode === null &&
    matchesAuthority(intent, revised)
  )
}

function matchesAuthority(
  intent: GitHubDeliveryIntent,
  request: GitHubDeliveryRequestRecord,
): boolean {
  return (
    request.localIntentId === intent.id &&
    request.organizationId === intent.organizationId &&
    request.projectId === intent.teamProjectId &&
    request.localProjectId === intent.localProjectId &&
    request.runId === intent.runId &&
    request.runVersion === intent.runVersion &&
    request.expectedRunVersion === intent.runVersion &&
    request.nodeId === intent.nodeId &&
    request.repositoryBindingId === intent.repositoryBindingId &&
    request.repositoryBindingVersion === intent.repositoryBindingVersion &&
    request.installationId === intent.installationId &&
    request.repositoryId === intent.repositoryId &&
    request.repository === intent.repository &&
    request.codingRunId === intent.codingRunId &&
    request.workspaceId === intent.workspaceId &&
    request.deliverySeriesKey === intent.deliverySeriesKey &&
    request.deliveryAttempt === intent.deliveryAttempt &&
    request.diffArtifactId === intent.diffArtifactId &&
    request.testEvidenceId === intent.testEvidenceId &&
    request.prPackageArtifactId === intent.prPackageArtifactId &&
    request.baseBranch === intent.baseBranch &&
    request.headBranch === intent.headBranch &&
    request.baseCommitSha === intent.baseCommitSha &&
    request.expectedCommitSha === intent.expectedCommitSha &&
    request.intentDigest === intent.intentDigest &&
    request.logicalIdempotencyKey === intent.idempotencyKey &&
    request.diffDigest === intent.diffSourceDigest &&
    request.testEvidenceDigest === intent.testEvidenceDigest &&
    request.packageDigest === intent.prPackageDigest &&
    JSON.stringify(request.changedPaths) === JSON.stringify(intent.changedPaths)
  )
}

function safeResult(
  intentId: string,
  remoteRequestId: string | null,
  disposition: GitHubDeliveryProcessorDisposition,
  outcomeCode: string | null,
): GitHubDeliveryProcessorResult {
  return { intentId, remoteRequestId, disposition, outcomeCode }
}
