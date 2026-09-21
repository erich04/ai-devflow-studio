import type { RecordAgentReviewFeedbackInput } from '@ai-devflow/shared'

export function parseAgentReviewFeedbackInput(value: unknown): RecordAgentReviewFeedbackInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('审查反馈参数无效。')
  const input = value as Record<string, unknown>
  const fields = ['projectId', 'runId', 'reviewId', 'missingEvidenceIndex', 'reason']
  if (Object.keys(input).some((key) => !fields.includes(key))) throw new Error('审查反馈参数无效。')
  for (const field of ['projectId', 'runId', 'reviewId']) {
    const id = input[field]
    if (typeof id !== 'string' || !id.trim() || id.length > 200 || /[\r\n\0]/u.test(id)) throw new Error('审查反馈标识无效。')
  }
  if (!Number.isInteger(input.missingEvidenceIndex) || Number(input.missingEvidenceIndex) < 0 || Number(input.missingEvidenceIndex) > 1000) throw new Error('审查意见不存在。')
  if (typeof input.reason !== 'string' || input.reason.trim().length < 3 || input.reason.length > 1000) throw new Error('请填写 3–1000 字的误报说明。')
  return { projectId: input.projectId as string, runId: input.runId as string, reviewId: input.reviewId as string,
    missingEvidenceIndex: input.missingEvidenceIndex as number, reason: input.reason.trim() }
}
