import type { Artifact, WorkflowRun } from '@ai-devflow/shared'

/** Offsets are UTF-16 character positions in the stored body, before redaction. */
export function conversationContentPage(content: string, offset: unknown = 0, limit: unknown = 6000) {
  if (!Number.isSafeInteger(offset) || Number(offset) < 0 || Number(offset) > content.length ||
    !Number.isSafeInteger(limit) || Number(limit) < 1 || Number(limit) > 18000) throw new Error('产物分页范围无效。')
  const start = Number(offset)
  let end = Math.min(content.length, start + Number(limit))
  // Leave room for JSON escaping inside the bounded tool response.
  while (JSON.stringify(content.slice(start, end)).length > 10000) end = start + Math.floor((end - start) / 2)
  return { content: content.slice(start, end), offset: start, endOffset: end, totalCharacters: content.length,
    nextOffset: end < content.length ? end : null, truncated: start > 0 || end < content.length }
}

export type RequirementContext = ReturnType<typeof buildRequirementContext>

export function buildRequirementContext(run: WorkflowRun, artifacts: Artifact[] | undefined) {
  const raw = artifacts?.find((item) => item.runId === run.id && item.kind === 'raw_request')
  const content = raw?.content ?? run.request
  const page = conversationContentPage(content || '')
  return {
    runId: run.id, runVersion: run.version, runUpdatedAt: run.updatedAt,
    source: raw ? 'raw_request' as const : 'run_request' as const,
    artifactId: raw?.id ?? null, updatedAt: raw?.updatedAt ?? run.updatedAt,
    availability: content ? 'available' as const : 'unavailable' as const,
    ...page,
    note: content
      ? '这是原始需求正文。只对已读范围作结论；未读部分不等于用户没有提供。'
      : '原始需求正文暂时无法读取，不能把标题或摘要当作全文，也不能据此断言用户没有提供要求。',
  }
}
