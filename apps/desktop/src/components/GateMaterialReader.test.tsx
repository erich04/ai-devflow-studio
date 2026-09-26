import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, it, expect, vi } from 'vitest'
import { sha256Text, type Artifact, type AgentReviewResult } from '@ai-devflow/shared'
import { GateMaterialReader } from './GateMaterialReader'
afterEach(cleanup)
const artifact: Artifact = { id: 'clarification-v2', runId: 'r', nodeId: 'n', kind: 'clarification', title: '任务筛选', summary: '摘要', content: '# 任务筛选\n\n|项目|约定|\n|---|---|\n|状态|不持久化|\n\n## Acceptance Criteria\n\n- 使用中文提示。\n\n- 使用中文提示。\n\n## Open Questions\n\n无待确认问题。', updatedAt: '2026-09-23T00:00:00Z', redacted: true }
const bundle = (revision = artifact) => ({ state: 'ready' as const, message: '材料齐全', activeRevision: revision, rawRequest: { ...artifact, id: 'raw-id', content: '原始需求正文' }, revisions: [revision], feedback: [] })
async function reviewForCurrentRevision(): Promise<AgentReviewResult> {
  const digest = await sha256Text(artifact.content)
  const start = artifact.content.indexOf('使用中文提示。')
  return { id: 'review', requestId: 'request', projectId: 'p', runId: 'r', nodeId: 'gate', runtime: 'electron', providerId: 'p', model: 'm', conclusion: '待核对', summary: '补齐文案', risks: [], missingEvidence: ['确定提示文案', '人工核对视觉样式'], suggestedTests: [], knowledgeReferences: [], policyFindings: [], confidence: 0.8,
    gateAdvisory: { id: 'a', runId: 'r', nodeId: 'gate', level: 'warn', blocksApproval: false, summary: '补齐文案', missingEvidence: [], riskCount: 0, createdAt: artifact.updatedAt }, createdAt: artifact.updatedAt,
    missingEvidenceDetails: [{ index: 0, assessment: 'gap', requiresReview: true, citations: [{ sourceId: artifact.id, title: '需求澄清', quote: '使用中文提示。', contentDigest: digest, start, end: start + 7, updatedAt: artifact.updatedAt }] }],
    contextManifest: { version: 1, stage: 'clarify', coverage: 'complete', runRequest: { contentDigest: 'raw', sanitizerVersion: '1', coverage: 'complete' }, subjectArtifacts: [{ id: artifact.id, runId: 'r', nodeId: 'n', kind: 'clarification', updatedAt: artifact.updatedAt, contentDigest: digest, sanitizerVersion: '1', coverage: 'complete', chunks: [] }], knowledgeCriteria: [], criteriaCoverage: 'empty' } }
}
it('keeps technical IDs secondary, references available and the source complete', () => {
  render(<GateMaterialReader bundle={bundle()} reports={[]} knowledge={<p>知识依据</p>} />)
  expect(screen.getByRole('table')).toBeVisible()
  expect(screen.getByText(artifact.id)).not.toBeVisible()
  fireEvent.click(screen.getByText('来源与版本'))
  expect(screen.getByText(artifact.id)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '原始需求' }))
  expect(screen.getByText('原始需求正文')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '收起参考资料' }))
  expect(screen.queryByText('原始需求正文')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '查看原文' }))
  expect(document.querySelector('.message-plain')?.textContent).toBe(artifact.content)
})
it('binds an opinion to exact offsets once, shares selection and leaves unlocated opinions in the list', async () => {
  const review = await reviewForCurrentRevision()
  const toggle = vi.fn()
  const { rerender } = render(<GateMaterialReader bundle={bundle()} review={review} reports={[]} knowledge={null} onToggleRevision={toggle} />)
  await waitFor(() => expect(screen.getByRole('tab', { name: /验收标准/ })).toHaveTextContent('1 条定位意见'))
  fireEvent.click(screen.getByRole('tab', { name: /验收标准/ }))
  expect(screen.getAllByRole('button', { name: '审查意见 1' })).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: '审查意见 1' }))
  fireEvent.click(screen.getByRole('button', { name: '加入修订意见' }))
  expect(toggle).toHaveBeenCalledWith(0)
  rerender(<GateMaterialReader bundle={bundle()} review={review} reports={[]} knowledge={null} onToggleRevision={toggle} revisionSelected={[0]} />)
  expect(screen.getByRole('button', { name: '移出修订意见' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.keyDown(document, { key: 'Escape' })
  fireEvent.click(screen.getByRole('tab', { name: /待确认事项/ }))
  expect(screen.getByText(/意见 2：当前正文没有可核验的位置/)).toBeVisible()
  expect(screen.getByText('人工核对视觉样式')).toBeVisible()
  expect(screen.getByRole('button', { name: '移出修订意见' })).toBeVisible()
})
it('does not place old findings on changed content or treat a stale review as a current approval', async () => {
  const review = await reviewForCurrentRevision()
  render(<GateMaterialReader bundle={bundle({ ...artifact, content: artifact.content + '\n新版本补充' })} review={review} reports={[]} knowledge={null} onToggleRevision={vi.fn()} />)
  fireEvent.click(screen.getByRole('tab', { name: '待确认事项' }))
  expect(screen.getByText(/不能将这份报告当作当前版本已审查/)).toBeVisible()
  expect(screen.queryByRole('button', { name: '加入修订意见' })).toBeNull()
  expect(screen.queryByRole('button', { name: '审查意见 1' })).toBeNull()
})
it.each([
  { name: 'replacement revision with identical text', change: { updatedAt: '2026-09-24T00:00:00Z' } },
  { name: 'artifact moved to another node', change: { nodeId: 'other-node' } },
  { name: 'artifact belonging to another Run', change: { runId: 'other-run' } },
])('keeps a $name historical and non-actionable', async ({ change }) => {
  const review = await reviewForCurrentRevision()
  const revision = { ...artifact, ...change }
  render(<GateMaterialReader bundle={bundle(revision)} review={review} reports={[]} knowledge={null} onToggleRevision={vi.fn()} />)
  await waitFor(() => expect(screen.getByText(/^正文摘要：/)).not.toHaveTextContent('正在核验'))
  fireEvent.click(screen.getByRole('tab', { name: /待确认事项/ }))
  expect(screen.getByText(/不能将这份报告当作当前版本已审查/)).toBeVisible()
  expect(screen.getByText('确定提示文案')).toBeVisible()
  expect(screen.queryByRole('button', { name: '加入修订意见' })).toBeNull()
  fireEvent.click(screen.getByRole('tab', { name: /验收标准/ }))
  expect(screen.queryByRole('button', { name: '审查意见 1' })).toBeNull()
})
it('preserves cross-block, stale and invalid citations in the report without inventing inline locations', async () => {
  const review = await reviewForCurrentRevision()
  const citation = review.missingEvidenceDetails![0]!.citations[0]!
  const end = artifact.content.lastIndexOf('使用中文提示。') + 7
  review.missingEvidenceDetails![0]!.citations = [
    { ...citation, end, quote: artifact.content.slice(citation.start, end) },
    { ...citation, start: -1, end: -1, quote: '' },
    { ...citation, updatedAt: '2026-09-22T00:00:00Z' },
  ]
  render(<GateMaterialReader bundle={bundle()} review={review} reports={[]} knowledge={null} />)
  await waitFor(() => expect(screen.getByText(/可在当前正文定位 0 条/)).toBeVisible())
  fireEvent.click(screen.getByRole('tab', { name: /待确认事项/ }))
  expect(screen.getByText(/意见 1：当前正文没有可核验的位置/)).toBeVisible()
  expect(screen.queryByRole('button', { name: '审查意见 1' })).toBeNull()
  expect(screen.getByText('确定提示文案')).toBeVisible()
})
it('offers discussion with the saved source and feedback beside an inline opinion, without submitting', async () => {
  const review = await reviewForCurrentRevision()
  const discuss = vi.fn(), feedback = vi.fn()
  render(<GateMaterialReader bundle={bundle()} review={review} reports={[]} knowledge={null} onDiscuss={discuss} onFeedback={feedback} />)
  await waitFor(() => expect(screen.getByRole('tab', { name: /验收标准/ })).toHaveTextContent('1 条定位意见'))
  fireEvent.click(screen.getByRole('tab', { name: /验收标准/ }))
  fireEvent.click(screen.getByRole('button', { name: '审查意见 1' }))
  expect(screen.getByRole('button', { name: '反馈误报' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '在右侧讨论' }))
  expect(discuss).toHaveBeenCalledWith(expect.stringContaining(`产物 ID：${artifact.id}`))
  expect(discuss).toHaveBeenCalledWith(expect.stringContaining('使用中文提示。'))
  expect(feedback).not.toHaveBeenCalled()
})
