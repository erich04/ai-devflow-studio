import type { BudgetGuardDecision, ChangeSetDiffView, CodingAgentRun, CodingChangeReview, CodingChangeSet, CodingPermissionRequest, LocalExecutionState, TestEvidence, WorkflowRun } from '@ai-devflow/shared'
export type CodingChangeSetRecord = Pick<CodingChangeSet, 'id' | 'codingRunId' | 'phase' | 'revision' | 'createdAt' | 'expiresAt'> & { digest: string; verified: boolean; view?: ChangeSetDiffView; changedPaths: string[] }
export type CodingChangeHistory = { runId: string; observedAt: string; changeSets: CodingChangeSetRecord[]; reviews: CodingChangeReview[] }
export type PermissionExpected = { runId: string; nodeId: string; changeSetId?: string; changeSetDigest?: string; diffArtifactId?: string; diffSourceDigest?: string; expiresAt: string }
export type ReviseCodingChangeSetInput = { codingRunId: string; requestId: string; changeSetId: string; changeSetDigest: string; changeRequest: string; itemCount: number; requestedBy: string }
export type ConfirmTestEvidenceInput = { runId: string; nodeId: string; evidenceId: string; expectedRunUpdatedAt: string }
export type CodingRetryContext = { kind: 'redevelop' | 'refix'; previousCodingRunId: string; changeSetId?: string; failedTestEvidenceId?: string; reason?: string }
export type CodingActionBudget = { blocks: boolean; status: BudgetGuardDecision['status']; reason?: string } | null
export type CodingActionCosts = {
  executor: 'native' | 'opencode' | 'compatibility' | 'unconfigured'; executorLabel: string; modelLabel?: string
  billing: 'metered' | 'opaque' | 'no_cost'; start: number | null; revise: number | null; selfCheck: number | null; repair: number | null; repairRevise: number | null
  budget: { revise: CodingActionBudget; selfCheck: CodingActionBudget; repairRevise: CodingActionBudget }
}
export type BuildTestDesktopApi = {
  getCodingChangeHistory(input: { runId: string }): Promise<CodingChangeHistory>
  reviseCodingChangeSet(input: ReviseCodingChangeSetInput): Promise<{ codingRun: CodingAgentRun; changeSetId: string; state: LocalExecutionState }>
  cancelCodingRevision(input: { codingRunId: string }): Promise<{ codingRun: CodingAgentRun }>
  startCodingChangeReview(input: { codingRunId: string; changeSetId: string; changeSetDigest: string }): Promise<{ review: CodingChangeReview }>
  cancelCodingChangeReview(input: { codingRunId: string; reviewId: string }): Promise<{ review: CodingChangeReview }>
  getCodingActionCosts(input: { projectId: string }): Promise<CodingActionCosts>
  confirmTestEvidence(input: ConfirmTestEvidenceInput): Promise<{ run: WorkflowRun; evidence: TestEvidence; state: LocalExecutionState }>
  onCodingChangeHistoryUpdated(listener: (input: { runId: string }) => void): () => void
}
function invalid(field: string): never { throw new Error(`[invalid_input] ${field}`) }
export function strictFields(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid('payload')
  if (Object.keys(value).some(k => !fields.includes(k))) return invalid('unknown field')
  return value as Record<string, unknown>
}
export function boundedId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value || value.length > 200 || value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) return invalid(field)
  return value
}
export function digest(value: unknown, field: string): string { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) return invalid(field); return value }
export function canonicalIso(value: unknown, field: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) return invalid(field)
  return value
}
export function boundedText(value: unknown, field: string, max: number, empty = false): string {
  if (typeof value !== 'string' || value.length > max || value.includes('\0') || (!empty && !value.trim())) return invalid(field)
  return value.trim()
}
export function optionalBoolean(value: unknown): boolean | undefined { if (value !== undefined && typeof value !== 'boolean') return invalid('completeOnPass'); return value }
export function parsePermissionExpected(value: unknown): PermissionExpected {
  const v = strictFields(value, ['runId', 'nodeId', 'changeSetId', 'changeSetDigest', 'diffArtifactId', 'diffSourceDigest', 'expiresAt'])
  const base = { runId: boundedId(v.runId, 'runId'), nodeId: boundedId(v.nodeId, 'nodeId'), expiresAt: canonicalIso(v.expiresAt, 'expiresAt') }
  if ((v.changeSetId !== undefined || v.changeSetDigest !== undefined) && (v.diffArtifactId !== undefined || v.diffSourceDigest !== undefined)) return invalid('ambiguous change identity')
  if (v.changeSetId !== undefined || v.changeSetDigest !== undefined) return { ...base, changeSetId: boundedId(v.changeSetId, 'changeSetId'), changeSetDigest: digest(v.changeSetDigest, 'changeSetDigest') }
  if (v.diffArtifactId !== undefined || v.diffSourceDigest !== undefined) return { ...base, diffArtifactId: boundedId(v.diffArtifactId, 'diffArtifactId'), diffSourceDigest: digest(v.diffSourceDigest, 'diffSourceDigest') }
  return base
}
export function assertPermissionExpected(request: CodingPermissionRequest, expected: PermissionExpected): void {
  for (const key of ['runId', 'nodeId', 'changeSetId', 'changeSetDigest', 'diffArtifactId', 'diffSourceDigest', 'expiresAt'] as const) if (request[key] !== expected[key]) throw new Error('[coding_permission_stale] 页面上的改动已更新，请重新查看。')
  if (request.status !== 'pending') throw new Error('[coding_permission_stale] 这份请求已经结束，请重新查看。')
}
export function parseReviseCodingChangeSet(value: unknown): ReviseCodingChangeSetInput {
  const v = strictFields(value, ['codingRunId', 'requestId', 'changeSetId', 'changeSetDigest', 'changeRequest', 'itemCount', 'requestedBy'])
  if (!Number.isInteger(v.itemCount) || Number(v.itemCount) < 1 || Number(v.itemCount) > 100) return invalid('itemCount')
  return { codingRunId: boundedId(v.codingRunId, 'codingRunId'), requestId: boundedId(v.requestId, 'requestId'), changeSetId: boundedId(v.changeSetId, 'changeSetId'), changeSetDigest: digest(v.changeSetDigest, 'changeSetDigest'), changeRequest: boundedText(v.changeRequest, 'changeRequest', 4000), itemCount: Number(v.itemCount), requestedBy: boundedId(v.requestedBy, 'requestedBy') }
}
export function parseConfirmTestEvidence(value: unknown): ConfirmTestEvidenceInput {
  const v = strictFields(value, ['runId', 'nodeId', 'evidenceId', 'expectedRunUpdatedAt'])
  return { runId: boundedId(v.runId, 'runId'), nodeId: boundedId(v.nodeId, 'nodeId'), evidenceId: boundedId(v.evidenceId, 'evidenceId'), expectedRunUpdatedAt: canonicalIso(v.expectedRunUpdatedAt, 'expectedRunUpdatedAt') }
}
export function parseCodingRetryContext(value: unknown): CodingRetryContext {
  const v = strictFields(value, ['kind', 'previousCodingRunId', 'changeSetId', 'failedTestEvidenceId', 'reason'])
  if (v.kind !== 'redevelop' && v.kind !== 'refix') return invalid('kind')
  return { kind: v.kind, previousCodingRunId: boundedId(v.previousCodingRunId, 'previousCodingRunId'), ...(v.changeSetId === undefined ? {} : { changeSetId: boundedId(v.changeSetId, 'changeSetId') }), ...(v.failedTestEvidenceId === undefined ? {} : { failedTestEvidenceId: boundedId(v.failedTestEvidenceId, 'failedTestEvidenceId') }), ...(v.reason === undefined ? {} : { reason: boundedText(v.reason, 'reason', 1000, true) }) }
}
