import {
  REMOTE_SYNC_MAX_ATTEMPTS,
  calculateRemoteSyncBackoffMs,
  classifyRemoteSyncFailure,
  sanitizeRemoteSyncErrorMessage,
  type RemoteSyncFailureCode,
  type RemoteSyncOperation,
  type RemoteSyncRecovery,
  type RemoteSyncUploadResult,
} from '@ai-devflow/shared'
import { RemoteSyncHttpError } from './remote-sync'
import {
  CanonicalRemoteSyncEntityError,
  type ProjectBoundRemoteSyncScope,
} from './project-bound-remote-sync'
import type {
  BindRemoteSyncOperationScopeInput,
  BindRemoteSyncOperationScopeResult,
  LocalStore,
  SettleRemoteSyncOperationInput,
  SettleRemoteSyncOperationResult,
} from './local-store'

export type {
  BindRemoteSyncOperationScopeInput,
  BindRemoteSyncOperationScopeResult,
  SettleRemoteSyncOperationInput,
  SettleRemoteSyncOperationResult,
} from './local-store'

export type RemoteSyncOutboxStore = Pick<
  LocalStore,
  | 'claimNextRemoteSyncOperation'
  | 'bindRemoteSyncOperationScope'
  | 'settleRemoteSyncOperation'
  | 'recoverInterruptedRemoteSyncOperations'
  | 'getDesktopPairingCredential'
>

export type IdentifierOnlyProjectBoundRemoteSync = {
  uploadCanonicalRunSummary(runId: string): Promise<RemoteSyncUploadResult>
  uploadCanonicalTestEvidenceSummary(
    evidenceId: string,
  ): Promise<RemoteSyncUploadResult>
  uploadCanonicalAgentReviewSummary(
    reviewId: string,
  ): Promise<RemoteSyncUploadResult>
  uploadCanonicalCodingAgentSummary(
    codingRunId: string,
  ): Promise<RemoteSyncUploadResult>
  uploadCanonicalAgentRuntimeSummary(runtimeId: string): Promise<RemoteSyncUploadResult>
}

type ProcessorDependencies = {
  store: RemoteSyncOutboxStore
  getRemoteSync(input: {
    scope: ProjectBoundRemoteSyncScope
    signal: AbortSignal
  }): Promise<IdentifierOnlyProjectBoundRemoteSync>
  onStateChanged?: () => void | Promise<void>
  clock?: { now(): string }
  timers?: {
    setTimeout(callback: () => void, delayMs: number): unknown
    clearTimeout(handle: unknown): void
  }
  attemptTimeoutMs?: number
}

export const REMOTE_SYNC_ATTEMPT_TIMEOUT_MS = 30_000

async function uploadOperation(
  remoteSync: IdentifierOnlyProjectBoundRemoteSync,
  operation: RemoteSyncOperation,
): Promise<RemoteSyncUploadResult> {
  switch (operation.kind) {
    case 'run-summary':
      return remoteSync.uploadCanonicalRunSummary(operation.entityId)
    case 'test-evidence-summary':
      return remoteSync.uploadCanonicalTestEvidenceSummary(operation.entityId)
    case 'agent-review-summary':
      return remoteSync.uploadCanonicalAgentReviewSummary(operation.entityId)
    case 'coding-agent-summary':
      return remoteSync.uploadCanonicalCodingAgentSummary(operation.entityId)
    case 'agent-runtime-summary':
      return remoteSync.uploadCanonicalAgentRuntimeSummary(operation.entityId)
  }
}

function completedSettlement(
  operation: RemoteSyncOperation,
  now: string,
): SettleRemoteSyncOperationInput {
  return {
    id: operation.id,
    generation: operation.generation,
    status: 'completed',
    updatedAt: now,
    nextAttemptAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    recovery: 'none',
    completedAt: now,
  }
}

function terminalSettlement(
  operation: RemoteSyncOperation,
  now: string,
  code: RemoteSyncFailureCode,
  message: string,
  recovery: RemoteSyncRecovery = 'none',
): SettleRemoteSyncOperationInput {
  return {
    id: operation.id,
    generation: operation.generation,
    status: 'terminal',
    updatedAt: now,
    nextAttemptAt: null,
    lastErrorCode: code,
    lastErrorMessage: sanitizeRemoteSyncErrorMessage(message),
    recovery,
    completedAt: null,
  }
}

function retrySettlement(
  operation: RemoteSyncOperation,
  now: string,
  code: RemoteSyncFailureCode,
  message: string,
): SettleRemoteSyncOperationInput {
  const nextAttemptAt = new Date(
    Date.parse(now) + calculateRemoteSyncBackoffMs(operation.attemptCount),
  ).toISOString()
  return {
    id: operation.id,
    generation: operation.generation,
    status: 'retry-scheduled',
    updatedAt: now,
    nextAttemptAt,
    lastErrorCode: code,
    lastErrorMessage: sanitizeRemoteSyncErrorMessage(message),
    recovery: 'none',
    completedAt: null,
  }
}

export function createRemoteSyncOutboxProcessor(deps: ProcessorDependencies) {
  let activeDrain: Promise<void> | null = null
  const clock = deps.clock ?? { now: () => new Date().toISOString() }
  const timers = deps.timers ?? {
    setTimeout: (callback: () => void, delayMs: number) =>
      globalThis.setTimeout(callback, delayMs),
    clearTimeout: (handle: unknown) =>
      globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
  }
  const attemptTimeoutMs = deps.attemptTimeoutMs ?? REMOTE_SYNC_ATTEMPT_TIMEOUT_MS

  async function notifyStateChanged() {
    await deps.onStateChanged?.()
  }

  async function runUploadAttempt(
    operation: RemoteSyncOperation,
  ): Promise<RemoteSyncUploadResult> {
    const controller = new AbortController()
    let timeoutHandle: unknown
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutHandle = timers.setTimeout(() => {
        controller.abort()
        reject(new RemoteSyncHttpError({
          status: 408,
          code: 'request_timeout',
          path: '/api/sync/outbox',
          retryable: true,
        }))
      }, attemptTimeoutMs)
    })
    const upload = deps.getRemoteSync({
      scope: {
        localProjectId: operation.localProjectId,
        organizationId: operation.organizationId!,
        teamProjectId: operation.teamProjectId!,
      },
      signal: controller.signal,
    }).then((remoteSync) => uploadOperation(remoteSync, operation))

    try {
      return await Promise.race([upload, timeout])
    } finally {
      timers.clearTimeout(timeoutHandle)
    }
  }

  async function processClaimedOperation(claimed: RemoteSyncOperation): Promise<void> {
    const pairing = await deps.store.getDesktopPairingCredential()
    if (!pairing || !pairing.localProjectId) {
      const result = await deps.store.settleRemoteSyncOperation(
        terminalSettlement(
          claimed,
          clock.now(),
          'pairing_required',
          'Pairing is required before remote sync.',
        ),
      )
      if (result.settled) await notifyStateChanged()
      return
    }
    if (pairing.localProjectId !== claimed.localProjectId) {
      const result = await deps.store.settleRemoteSyncOperation(
        terminalSettlement(
          claimed,
          clock.now(),
          'scope_mismatch',
          'The paired local project does not match the remote sync operation.',
        ),
      )
      if (result.settled) await notifyStateChanged()
      return
    }

    const bound = await deps.store.bindRemoteSyncOperationScope({
      id: claimed.id,
      generation: claimed.generation,
      organizationId: pairing.organizationId,
      teamProjectId: pairing.projectId,
      updatedAt: clock.now(),
    })
    if (!bound.bound) {
      if (bound.reason === 'scope_mismatch') {
        const result = await deps.store.settleRemoteSyncOperation(
          terminalSettlement(
            claimed,
            clock.now(),
            'scope_mismatch',
            'The paired Team Project does not match the remote sync operation.',
          ),
        )
        if (result.settled) await notifyStateChanged()
      }
      return
    }

    let settlement: SettleRemoteSyncOperationInput
    try {
      const result = await runUploadAttempt(bound.operation)
      const settledAt = clock.now()
      settlement = result.accepted
        ? completedSettlement(bound.operation, settledAt)
        : terminalSettlement(
            bound.operation,
            settledAt,
            'remote_error',
            'The remote endpoint did not accept the sync operation.',
          )
    } catch (error) {
      const failedAt = clock.now()
      if (error instanceof CanonicalRemoteSyncEntityError) {
        settlement = terminalSettlement(
          bound.operation,
          failedAt,
          error.code,
          error.message,
        )
      } else if (!(error instanceof RemoteSyncHttpError)) {
        settlement = terminalSettlement(
          bound.operation,
          failedAt,
          'remote_error',
          'The remote sync operation failed.',
        )
      } else {
        const classification = classifyRemoteSyncFailure({
          status: error.status,
          code: error.code,
        })
        const safeMessage = `Remote sync failed (${error.status ?? 'unavailable'}, ${error.code}).`
        if (classification.disposition === 'retryable') {
          settlement = bound.operation.attemptCount >= REMOTE_SYNC_MAX_ATTEMPTS
            ? terminalSettlement(
                bound.operation,
                failedAt,
                'max_attempts',
                'Remote sync reached the retry limit.',
              )
            : retrySettlement(bound.operation, failedAt, error.code, safeMessage)
        } else if (classification.disposition === 'recovery') {
          settlement = terminalSettlement(
            bound.operation,
            failedAt,
            error.code,
            safeMessage,
            'child-retried',
          )
        } else {
          settlement = terminalSettlement(
            bound.operation,
            failedAt,
            error.code,
            safeMessage,
          )
        }
      }
    }
    const settled = await deps.store.settleRemoteSyncOperation(settlement)
    if (settled.settled) await notifyStateChanged()
  }

  async function drainLoop(): Promise<void> {
    for (;;) {
      const claimed = await deps.store.claimNextRemoteSyncOperation(clock.now())
      if (!claimed) return
      await processClaimedOperation(claimed)
    }
  }

  function runExclusive(action: () => Promise<void>): Promise<void> {
    activeDrain ??= action().finally(() => {
      activeDrain = null
    })
    return activeDrain
  }

  function drain(): Promise<void> {
    return runExclusive(() => drainLoop())
  }

  function recoverAndDrain(): Promise<void> {
    return runExclusive(async () => {
      await deps.store.recoverInterruptedRemoteSyncOperations(clock.now())
      await drainLoop()
    })
  }

  return { drain, recoverAndDrain }
}
