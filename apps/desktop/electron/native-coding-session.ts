import { isDeepStrictEqual } from 'node:util'
import { validateNativeHistory, parseCodingCommandRules, type NativeToolMessage, type AgentProviderUsage, type AgentRuntimeState, type CodingModelRetryReason } from '@ai-devflow/shared'
import type { NativeToolCapabilityGrantRecord, NativeToolAuditRecord } from './native-tool-registry'
import type { CodingExecutorStartInput } from './coding-executor'
import type { CodingCommandPlan, CodingExecutionProfile } from './coding-command-runner'
import type { CodingDeliveryEvidence } from './coding-evidence-v3'
import type { CodingRevision } from './coding-candidate-workspace'
import type { CodingDependencyPlan } from './coding-dependency-preparation'
import type { CodingOperationPermission } from './native-coding-permissions'
import type { CodingCompaction } from './native-coding-context'
import { validateIndependentVerification, type IndependentVerificationState } from './native-coding-independent-verification'

export type NativeCodingStatus = 'ready' | 'running' | 'waiting_input' | 'waiting_task' | 'waiting_permission' | 'review' | 'paused' | 'reconciling' | 'applying' | 'verifying' | 'completed' | 'cancelled' | 'failed' | 'delivery_conflict'
export type NativeCodingQuestion = { id: string; toolCallId: string; text: string; options: string[]; objectiveVersion: number }
/** Saved on a failed attempt before the host waits; the next attempt with `retryOf` re-sends the same step. */
export type CodingModelRetry = { reason: CodingModelRetryReason; number: number; limit: number; delayMs: number; notBefore: string; retryAfterMs?: number }
export type CodingModelAttempt = { id: string; operationKey: string; requestDigest: string; step: number; objectiveVersion: number; status: 'started' | 'completed' | 'not_sent' | 'unknown'; createdAt: string; completedAt?: string; usage?: AgentProviderUsage; error?: string; acknowledgedBy?: string; retry?: CodingModelRetry; retryOf?: string }
export type CodingToolReceipt = { id: string; name: string; input: Record<string, unknown>; inputDigest: string; objectiveVersion: number; effect: 'read' | 'write' | 'command'; status: 'started' | 'completed' | 'unknown'; result?: unknown; error?: string }
/** Private host record. Never project raw transcript or credentials to the Team API. */
export type NativeCodingSession = {
  schemaVersion: 1
  executorVersion: 3
  id: string
  localProjectId: string
  codingRunId: string
  workflowRunId: string
  nodeId: string
  providerId: string
  model: string
  version: number
  objective: string
  objectiveVersion: number
  status: NativeCodingStatus
  pauseReason?: string
  transcript: NativeToolMessage[]
  question?: NativeCodingQuestion
  attempts: CodingModelAttempt[]
  toolReceipts: CodingToolReceipt[]
  toolAuthorities: Array<{ runtime: AgentRuntimeState; grant?: NativeToolCapabilityGrantRecord; consumed: boolean; audit: NativeToolAuditRecord[] }>
  commands: Array<{ id: string; digest: string }>
  pendingInput: Array<{ id: string; text: string }>
  steps: number
  rootStepAttempts?: string[]
  activeMilliseconds: number
  limits: { maxSteps: number; maxActiveMilliseconds: number; batchSteps: number; noProgressLimit: number }
  writer?: { owner: string; processId: number; epoch: number; expiresAt: string }
  writerEpoch: number
  progressFingerprints: string[]
  /** Set when repeated fingerprints first trigger a warning to the model; the same fingerprint again pauses. */
  progressNudge?: { fingerprint: string; delivered: boolean }
  /** Consecutive model replies whose tool batch was rejected; the first gets an explanation, the second pauses. */
  invalidToolBatches?: number
  binding?: {
    request: CodingExecutorStartInput['request']
    context: Omit<CodingExecutorStartInput['runtimeContext'], 'reportProviderCall' | 'reportPermissionPolicyDecision' | 'assertContextCurrent'>
    workspaceRoot: string
    testPlan: CodingCommandPlan
    testPlanDigest: string
    executionGranted: boolean
    profile: CodingExecutionProfile
    dependencyPlan?: CodingDependencyPlan
    authorizationExpiresAt?: string
    input?: Awaited<ReturnType<typeof import('./coding-input').inspectCodingInput>>
    manualValidationPlan?: string
    permissionPolicy?: import('@ai-devflow/shared').CodingPermissionPolicy
    /** Required for newly authorized automatic V3 tasks; old records retain their historical semantics. */
    independentVerificationRequired?: boolean
  }
  deliveryEvidence: CodingDeliveryEvidence[]
  revisions: CodingRevision[]
  permissions: CodingOperationPermission[]
  compactions: CodingCompaction[]
  taskBudget?: import('@ai-devflow/shared').ModelTaskBudget
  parent?: { sessionId: string; codingRunId: string; objectiveVersion: number; baseDigest: string; mode: 'read_only' | 'isolated_coding'; paths: string[] }
  children: Array<{ sessionId: string; codingRunId: string; title: string; state: 'active' | 'included' | 'excluded'; mergedChangeSetId?: string }>
  activity: import('./coding-activity-clock').CodingActivity[]
  acceptance: Array<{ id: string; objectiveVersion: number; sourceRef: string; text: string; confirmation: 'approved_source'; resolution: 'unresolved' | 'human_confirmed'; revisionDigest?: string }>
  /** Host-only acceptance code. Never part of implementer or child transcripts. */
  independentVerification?: IndependentVerificationState
  createdAt: string
  updatedAt: string
}

export function createNativeCodingSession(input: Pick<NativeCodingSession, 'id' | 'localProjectId' | 'codingRunId' | 'workflowRunId' | 'nodeId' | 'providerId' | 'model' | 'objective'> & { now: string }): NativeCodingSession {
  const { now, ...identity } = input
  return parseNativeCodingSession({ ...identity, schemaVersion: 1, executorVersion: 3, version: 1, objectiveVersion: 1,
    status: 'ready', transcript: [{ role: 'user', content: input.objective }], attempts: [], toolReceipts: [], toolAuthorities: [], commands: [], pendingInput: [], steps: 0, activeMilliseconds: 0,
    limits: { maxSteps: 80, maxActiveMilliseconds: 60 * 60_000, batchSteps: 12, noProgressLimit: 3 }, writerEpoch: 0, progressFingerprints: [], deliveryEvidence: [], revisions: [], permissions: [], compactions: [], children: [], activity: [], acceptance: [], createdAt: now, updatedAt: now })
}

export async function mutateNativeCodingSession(store: { getNativeCodingSession(id: string): Promise<NativeCodingSession | undefined>; saveNativeCodingSession(session: NativeCodingSession, expectedVersion: number): Promise<boolean> }, id: string, change: (draft: NativeCodingSession) => void): Promise<NativeCodingSession> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const before = await store.getNativeCodingSession(id)
    if (!before) throw new Error('Coding session not found')
    const after = updateNativeCodingSession(before, new Date().toISOString(), change)
    if (await store.saveNativeCodingSession(after, before.version)) return after
  }
  throw new Error('Coding session changed concurrently')
}

export function updateNativeCodingSession(previous: NativeCodingSession, now: string, change: (draft: NativeCodingSession) => void): NativeCodingSession {
  const next = structuredClone(previous)
  change(next)
  next.version = previous.version + 1
  next.updatedAt = now
  return parseNativeCodingSession(next, previous)
}

export function parseNativeCodingSession(value: unknown, previous?: NativeCodingSession): NativeCodingSession {
  const session = value as NativeCodingSession
  const identifier = (item: unknown) => typeof item === 'string' && /^[a-zA-Z0-9_.:-]{1,200}$/u.test(item)
  const timestamp = (item: unknown) => typeof item === 'string' && Number.isFinite(Date.parse(item)) && new Date(item).toISOString() === item
  if (!session || session.schemaVersion !== 1 || session.executorVersion !== 3 ||
    ![session.id, session.localProjectId, session.codingRunId, session.workflowRunId, session.nodeId, session.providerId].every(identifier) ||
    typeof session.model !== 'string' || !session.model || typeof session.objective !== 'string' || !session.objective.trim() ||
    !Number.isSafeInteger(session.version) || session.version < 1 || !Number.isSafeInteger(session.objectiveVersion) || session.objectiveVersion < 1 ||
    !['ready', 'running', 'waiting_input', 'waiting_task', 'waiting_permission', 'review', 'paused', 'reconciling', 'applying', 'verifying', 'completed', 'cancelled', 'failed', 'delivery_conflict'].includes(session.status) ||
    !timestamp(session.createdAt) || !timestamp(session.updatedAt) || session.updatedAt < session.createdAt) throw new Error('Invalid native coding session')
  validateNativeHistory(session.transcript, true)
  if (session.independentVerification) validateIndependentVerification(session.independentVerification, previous?.independentVerification)
  else if (previous?.independentVerification) throw new Error('Independent verification history cannot be removed')
  if (session.binding?.independentVerificationRequired !== undefined && typeof session.binding.independentVerificationRequired !== 'boolean') throw new Error('Invalid independent verification requirement')
  if (session.binding?.manualValidationPlan !== undefined && (typeof session.binding.manualValidationPlan !== 'string' || !session.binding.manualValidationPlan.trim() || session.binding.manualValidationPlan.length > 8000)) throw new Error('Invalid manual validation plan')
  if (session.rootStepAttempts && (new Set(session.rootStepAttempts).size !== session.rootStepAttempts.length || !session.rootStepAttempts.every(identifier))) throw new Error('Invalid root step reservations')
  const digest = (item: unknown) => typeof item === 'string' && /^[a-f0-9]{64}$/u.test(item)
  const natural = (item: unknown) => Number.isSafeInteger(item) && Number(item) >= 0
  for (const name of ['attempts', 'toolReceipts', 'toolAuthorities', 'commands', 'pendingInput', 'progressFingerprints', 'deliveryEvidence', 'revisions', 'permissions', 'compactions', 'children', 'activity', 'acceptance'] as const) {
    if (!Array.isArray(session[name])) throw new Error(`Invalid coding ${name}`)
  }
  if (![session.steps, session.activeMilliseconds, session.writerEpoch].every(natural) || !session.limits || !Object.values(session.limits).every(item => natural(item) && item > 0) || session.limits.batchSteps > 12 || session.limits.maxSteps > 10000 || session.limits.maxActiveMilliseconds > 24 * 60 * 60_000) throw new Error('Invalid coding execution bounds')
  if (session.writer && (!identifier(session.writer.owner) || !natural(session.writer.processId) || session.writer.processId < 1 || session.writer.epoch !== session.writerEpoch || !timestamp(session.writer.expiresAt))) throw new Error('Invalid coding writer')
  for (const records of [session.attempts, session.toolReceipts, session.commands, session.pendingInput, session.revisions, session.permissions]) if (new Set(records.map(item => item.id)).size !== records.length || records.some(item => !identifier(item.id))) throw new Error('Duplicate coding operation identity')
  const earlierAttempts = new Set<string>()
  for (const attempt of session.attempts) {
    if (!identifier(attempt.operationKey) || !digest(attempt.requestDigest) || !natural(attempt.step) || attempt.step < 1 || !natural(attempt.objectiveVersion) || attempt.objectiveVersion < 1 || attempt.objectiveVersion > session.objectiveVersion || !['started', 'completed', 'not_sent', 'unknown'].includes(attempt.status) || !timestamp(attempt.createdAt) ||
      (attempt.retryOf !== undefined && !earlierAttempts.has(attempt.retryOf)) ||
      (attempt.retry !== undefined && (!['rate_limited', 'overloaded', 'server_error', 'connection_not_sent'].includes(attempt.retry.reason) || !natural(attempt.retry.number) || attempt.retry.number < 1 || !natural(attempt.retry.limit) || attempt.retry.number > attempt.retry.limit ||
        !natural(attempt.retry.delayMs) || !timestamp(attempt.retry.notBefore) || (attempt.retry.retryAfterMs !== undefined && !natural(attempt.retry.retryAfterMs))))) throw new Error('Invalid coding model receipt')
    earlierAttempts.add(attempt.id)
  }
  if ((session.invalidToolBatches !== undefined && (!natural(session.invalidToolBatches) || session.invalidToolBatches < 1)) ||
    (session.progressNudge !== undefined && (!digest(session.progressNudge.fingerprint) || typeof session.progressNudge.delivered !== 'boolean'))) throw new Error('Invalid coding progress state')
  for (const receipt of session.toolReceipts) if (!receipt.name || !digest(receipt.inputDigest) || !['read', 'write', 'command'].includes(receipt.effect) || !['started', 'completed', 'unknown'].includes(receipt.status) || !receipt.input || typeof receipt.input !== 'object' || !natural(receipt.objectiveVersion) || receipt.objectiveVersion > session.objectiveVersion) throw new Error('Invalid coding tool receipt')
  for (const command of session.commands) if (!digest(command.digest)) throw new Error('Invalid coding command receipt')
  for (const input of session.pendingInput) if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 32000) throw new Error('Invalid pending coding input')
  for (const interval of session.activity) if (typeof interval.unitId !== 'string' || !natural(interval.startedAt) || (interval.endedAt !== undefined && (!natural(interval.endedAt) || interval.endedAt < interval.startedAt))) throw new Error('Invalid coding activity')
  for (const compaction of session.compactions) if (!natural(compaction.through) || compaction.through < 1 || compaction.through > session.transcript.length || !digest(compaction.sourceDigest) || typeof compaction.summary !== 'string' || compaction.summary.length > 16000 || !identifier(compaction.attemptId)) throw new Error('Invalid coding compaction')
  if (session.parent && (!identifier(session.parent.sessionId) || !identifier(session.parent.codingRunId) || !digest(session.parent.baseDigest) || !['read_only', 'isolated_coding'].includes(session.parent.mode) || !Array.isArray(session.parent.paths))) throw new Error('Invalid coding delegation')
  if (session.question && (!identifier(session.question.id) || !identifier(session.question.toolCallId) || typeof session.question.text !== 'string' || !session.question.text.trim() ||
    !Array.isArray(session.question.options) || session.question.options.some(option => typeof option !== 'string') || session.question.objectiveVersion !== session.objectiveVersion)) throw new Error('Invalid coding question')
  if (session.binding?.permissionPolicy) {
    const policy = session.binding.permissionPolicy
    if (policy.version !== 1 || !['ask', 'sandbox_rules', 'unattended'].includes(policy.mode)) throw new Error('Invalid saved coding permission policy')
    parseCodingCommandRules(policy.rules)
  }
  if (previous) {
    if (previous.binding?.executionGranted && !isDeepStrictEqual(previous.binding.permissionPolicy, session.binding?.permissionPolicy)) throw new Error('Granted coding permission policy is immutable')
    if (previous.binding?.independentVerificationRequired !== undefined && session.binding?.independentVerificationRequired !== previous.binding.independentVerificationRequired) throw new Error('Independent verification requirement cannot change')
    for (const key of ['schemaVersion', 'executorVersion', 'id', 'localProjectId', 'codingRunId', 'workflowRunId', 'nodeId', 'providerId', 'model', 'createdAt'] as const) {
      if (session[key] !== previous[key]) throw new Error('Coding session identity is immutable')
    }
    if (session.version !== previous.version + 1 || session.objectiveVersion < previous.objectiveVersion || session.updatedAt < previous.updatedAt ||
      (session.objective !== previous.objective && session.objectiveVersion === previous.objectiveVersion) ||
      !isDeepStrictEqual(session.transcript.slice(0, previous.transcript.length), previous.transcript)) throw new Error('Invalid coding checkpoint transition')
    for (const key of ['attempts', 'toolReceipts', 'commands', 'revisions', 'permissions'] as const) if (previous[key].some((record, index) => session[key][index]?.id !== record.id)) throw new Error('Coding receipts are append-only')
    if (['completed', 'cancelled', 'failed'].includes(previous.status)) {
      // A late bill/receipt is still a fact, but cannot revive execution or alter its transcript.
      const execution = (record: NativeCodingSession) => {
        const { version: _version, updatedAt: _updated, attempts: _attempts, commands: _commands, toolReceipts: _receipts, toolAuthorities: _audit, activeMilliseconds: _active, activity: _activity, writer: _writer, ...rest } = record
        return rest
      }
      if (!isDeepStrictEqual(execution(session), execution(previous))) throw new Error('Terminal coding session cannot resume')
    }
  }
  return session
}
