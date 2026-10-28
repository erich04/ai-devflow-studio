/** Harness turn protocol is versioned independently of executor implementation and file patches. */
export const CODING_HARNESS_PROTOCOL_VERSION = 2 as const
export const NATIVE_CODING_EXECUTOR_UNAVAILABLE = 'Native v3 任务尚未结算；请在模型与执行方式中切回 Native v3，再重新打开任务或重启应用继续恢复。'
export type CodingHarnessStatus = 'ready' | 'running' | 'waiting_input' | 'waiting_task' | 'waiting_permission' | 'review' | 'paused' | 'reconciling' | 'applying' | 'verifying' | 'completed' | 'cancelled' | 'failed' | 'delivery_conflict'
type CommandBase = { protocolVersion: 2; codingRunId: string }
type Mutation = CommandBase & { commandId: string; expectedVersion: number }
export type CodingHarnessDetail = { kind: 'message' | 'diff'; id: string; offset: number; revisionDigest?: string }
export type CodingHarnessPage = { historyOffset?: number; revisionOffset?: number; detail?: CodingHarnessDetail }
export type CodingHarnessCommand =
  | (CommandBase & CodingHarnessPage & { type: 'get' })
  | (Mutation & { type: 'authorize'; profile: 'trusted_local' | 'container'; manualValidationPlan?: string })
  | (Mutation & { type: 'pause' | 'resume' | 'cancel' | 'retry_unknown' | 'renew_authorization' })
  | (Mutation & { type: 'cleanup_scratch' })
  | (Mutation & { type: 'steer'; text: string })
  | (Mutation & { type: 'reply'; questionId: string; objectiveVersion: number; text: string })
  | (Mutation & { type: 'approve'; revisionDigest: string; objectiveVersion: number; confirmedCriteria?: string[]; manualValidationEvidence?: string })
  | (Mutation & { type: 'reject'; revisionDigest: string; objectiveVersion: number })
  | (Mutation & { type: 'extend_limits'; maxSteps: number; maxActiveMilliseconds: number })
  | (Mutation & { type: 'permission'; permissionId: string; decision: 'approved' | 'rejected' })
export type CodingHarnessSummary = { protocolVersion: 2; sessionId: string; status: CodingHarnessStatus; version: number }
export type CodingHarnessSnapshot = CodingHarnessSummary & {
  codingRunId: string; objectiveVersion: number; pauseReason?: string; steps: number; activeMilliseconds: number
  controlUnavailableReason?: string
  messages: Array<{ id: string; role: 'user' | 'assistant' | 'tool'; text: string; truncated?: boolean }>
  question?: { id: string; text: string; options: string[] }
  permission?: { id: string; title: string; details: string }
  execution?: { testCommand: string; dependencyCommand?: string; baseline: string; inputDigest?: string; dirtyPaths?: string[]; maxTokens?: number; maxCostUsd?: number; profiles: Array<{ kind: 'trusted_local' | 'container'; available: boolean; reason: string }> }
  revision?: { id: string; digest: string; summary: string; files: Array<{ path: string; kind: string; sourcePath?: string; beforeHash: string | null; afterHash: string | null; binary: boolean; diff: string; truncated?: boolean }> }
  detail?: CodingHarnessDetail & { text: string; total: number; previous: number | null; next: number | null }
  evidence: Array<{ id: string; status: string; summary: string }>
  cost: { inputTokens: number | null; outputTokens: number | null; costUsd: number | null; unknownAttempts: number; pendingSettlements: number; knownCostUsd?: number; unknownCostCount?: number }
  children: Array<{ id: string; title: string; status: string }>
  parent?: { codingRunId: string; mode: 'read_only' | 'isolated_coding' }
  acceptance?: Array<{ id: string; text: string; sourceRef: string; resolution: 'unresolved' | 'human_confirmed' }>
  historyPage?: { offset: number; total: number; previous: number | null; next: number | null }
  revisionPage?: { offset: number; total: number; previous: number | null; next: number | null }
  limits?: { maxSteps: number; maxActiveMilliseconds: number }
  storage?: { cleanupAllowed: boolean; reason: string }
  diagnostics?: { checkpoint: number; objectiveVersion: number; writerActive: boolean; uncertainOperations: Array<{ id: string; kind: string; status: string }>; uncertainTotal: number; profile: string }
  manualValidationPlan?: string
}

export function parseCodingHarnessCommand(value: unknown): CodingHarnessCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid coding harness command')
  const input = value as Record<string, unknown>, type = input.type
  const fields: Record<string, string[]> = {
    get: [], authorize: ['profile'], pause: [], resume: [], cancel: [], retry_unknown: [], renew_authorization: [], cleanup_scratch: [], steer: ['text'],
    reply: ['questionId', 'objectiveVersion', 'text'], approve: ['revisionDigest', 'objectiveVersion'], reject: ['revisionDigest', 'objectiveVersion'], permission: ['permissionId', 'decision'], extend_limits: ['maxSteps', 'maxActiveMilliseconds'],
  }
  if (typeof type !== 'string' || !Object.hasOwn(fields, type) || input.protocolVersion !== 2) throw new Error('Unsupported coding harness protocol')
  const optional = type === 'get' ? ['historyOffset', 'revisionOffset', 'detail'] : type === 'approve' ? ['confirmedCriteria', 'manualValidationEvidence'] : type === 'authorize' ? ['manualValidationPlan'] : []
  const expected = ['protocolVersion', 'type', 'codingRunId', ...(type === 'get' ? [] : ['commandId', 'expectedVersion']), ...fields[type]!, ...optional.filter(key => Object.hasOwn(input, key))]
  if (Object.keys(input).length !== expected.length || expected.some(key => !Object.hasOwn(input, key))) throw new Error('Unexpected coding command fields')
  for (const field of ['codingRunId', 'commandId', 'questionId', 'permissionId']) if (field in input && (typeof input[field] !== 'string' || !/^[A-Za-z0-9_.:-]{1,200}$/u.test(input[field]))) throw new Error('Invalid coding command identity')
  for (const field of ['expectedVersion', 'objectiveVersion']) if (field in input && (!Number.isSafeInteger(input[field]) || Number(input[field]) < 1)) throw new Error('Invalid coding command version')
  if ('text' in input && (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 32000)) throw new Error('Invalid coding input')
  for (const field of ['manualValidationPlan', 'manualValidationEvidence']) if (field in input && (typeof input[field] !== 'string' || !input[field].trim() || input[field].length > 8000)) throw new Error('Invalid manual validation input')
  if ('revisionDigest' in input && (typeof input.revisionDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(input.revisionDigest))) throw new Error('Invalid revision digest')
  if ('profile' in input && !['trusted_local', 'container'].includes(String(input.profile))) throw new Error('Invalid coding execution profile')
  if ('decision' in input && !['approved', 'rejected'].includes(String(input.decision))) throw new Error('Invalid coding permission decision')
  for (const field of ['historyOffset', 'revisionOffset']) if (field in input && (!Number.isSafeInteger(input[field]) || Number(input[field]) < 0)) throw new Error('Invalid coding page')
  if ('confirmedCriteria' in input && (!Array.isArray(input.confirmedCriteria) || input.confirmedCriteria.length > 100 || input.confirmedCriteria.some(item => typeof item !== 'string' || !/^[a-zA-Z0-9_.:-]{1,200}$/u.test(item)))) throw new Error('Invalid criterion confirmation')
  if (type === 'extend_limits' && (!Number.isSafeInteger(input.maxSteps) || Number(input.maxSteps) < 1 || Number(input.maxSteps) > 10000 || !Number.isSafeInteger(input.maxActiveMilliseconds) || Number(input.maxActiveMilliseconds) < 1 || Number(input.maxActiveMilliseconds) > 24 * 60 * 60_000)) throw new Error('Invalid task limits')
  if ('detail' in input) {
    const detail = input.detail as Record<string, unknown>
    if (!detail || typeof detail !== 'object' || !['message', 'diff'].includes(String(detail.kind)) || typeof detail.id !== 'string' || detail.id.length > 2048 || !detail.id || !Number.isSafeInteger(detail.offset) || Number(detail.offset) < 0 || Object.keys(detail).some(key => !['kind', 'id', 'offset', 'revisionDigest'].includes(key))) throw new Error('Invalid content page')
    if (detail.kind === 'message' ? !/^message-\d+$/u.test(detail.id) || detail.revisionDigest !== undefined : typeof detail.revisionDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(detail.revisionDigest)) throw new Error('Invalid content identity')
  }
  return value as CodingHarnessCommand
}
