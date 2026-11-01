import { useState } from 'react'
import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { afterEach, it, expect, vi } from 'vitest'
import { sha256Text, type Artifact, type AgentReviewResult } from '@ai-devflow/shared'
import { GateMaterialReader } from './GateMaterialReader'
import type { ReviewRevisionDrafts } from './ReviewEvidenceDetails'
import { findSuggestion, removeSuggestion, upsertSuggestion, type RevisionSuggestion } from '../app/revision-suggestions'
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
  render(<GateMaterialReader bundle={bundle()} knowledge={<p>知识依据</p>} />)
  expect(screen.getByRole('table')).toBeVisible()
  expect(screen.getByText(artifact.id)).not.toBeVisible()
  fireEvent.click(screen.getByText('来源与版本'))
  expect(screen.getByText(artifact.id)).toBeVisible()
  // Review basis, TOC and the raw source share one first-screen disclosure (plan Y6).
  expect(screen.getByRole('button', { name: '原始需求' })).not.toBeVisible()
  fireEvent.click(screen.getByText('阅读工具'))
  fireEvent.click(screen.getByRole('button', { name: '原始需求' }))
  expect(screen.getByText('原始需求正文')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '收起参考资料' }))
  expect(screen.queryByText('原始需求正文')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '查看原文' }))
  expect(document.querySelector('.message-plain')?.textContent).toBe(artifact.content)
})
function DraftHarness({ review, revision = artifact, onOpenReport }: { review: AgentReviewResult; revision?: Artifact; onOpenReport?: () => void }) {
  const [list, setList] = useState<RevisionSuggestion[]>([])
  const drafts: ReviewRevisionDrafts = {
    get: (index) => findSuggestion(list, review.id, index),
    save: (index, draft) => { setList((current) => upsertSuggestion(current, { reviewId: review.id, index, issue: review.missingEvidence[index]!, ...draft })); return undefined },
    remove: (index) => setList((current) => removeSuggestion(current, review.id, index)),
  }
  return <GateMaterialReader bundle={bundle(revision)} review={review} knowledge={null} revisionDrafts={drafts} onOpenReport={onOpenReport} />
}
it('marks an opinion beside its text only, without repeating the report under 待确认事项 (#246)', async () => {
  const review = await reviewForCurrentRevision()
  const openReport = vi.fn()
  render(<DraftHarness review={review} onOpenReport={openReport} />)
  await waitFor(() => expect(screen.getByRole('tab', { name: /验收标准/ })).toHaveTextContent('1 条定位意见'))
  const summary = screen.getByTestId('review-reference-summary')
  expect(summary).toHaveTextContent('审查意见 2 条，正文旁标出 1 条；另有 1 条没有可核验的原文位置')
  fireEvent.click(screen.getByRole('tab', { name: /待确认事项/ }))
  expect(screen.queryByTestId('review-evidence-results')).toBeNull()
  expect(screen.queryByText('确定提示文案')).toBeNull()
  expect(screen.queryByText('人工核对视觉样式')).toBeNull()
  // The unlocated opinion is one click away, never dropped and never given an invented location.
  fireEvent.click(within(summary).getByRole('button', { name: '审查意见 2（未定位）' }))
  expect(screen.getByRole('dialog', { name: '审查意见 2' })).toHaveTextContent('人工核对视觉样式')
  expect(screen.getByRole('dialog', { name: '审查意见 2' })).toHaveTextContent('没有可核验的原文位置')
  fireEvent.keyDown(document, { key: 'Escape' })
  fireEvent.click(within(summary).getByRole('button', { name: '在「材料与版本」查看完整报告' }))
  expect(openReport).toHaveBeenCalledTimes(1)
})
it('drafts a revision suggestion inside the opinion popover and keeps it as a draft (#247)', async () => {
  const review = await reviewForCurrentRevision()
  render(<DraftHarness review={review} />)
  await waitFor(() => expect(screen.getByRole('tab', { name: /验收标准/ })).toHaveTextContent('1 条定位意见'))
  fireEvent.click(screen.getByRole('tab', { name: /验收标准/ }))
  expect(screen.getAllByRole('button', { name: '审查意见 1' })).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: '审查意见 1' }))
  let popover = screen.getByRole('dialog', { name: '审查意见 1' })
  fireEvent.click(within(popover).getByRole('button', { name: '整理修订建议' }))
  expect(popover).toHaveTextContent('只保存到本机修订草稿，不修改需求，也不批准 Gate')
  fireEvent.change(within(popover).getByLabelText('意见 1 的核实结论'), { target: { value: '现有提示文案位于 i18n/zh.json。' } })
  fireEvent.change(within(popover).getByLabelText('意见 1 的拟修改内容'), { target: { value: '验收标准写明提示文案：“暂无任务”。' } })
  fireEvent.click(within(popover).getByRole('button', { name: '保存到修订草稿' }))
  popover = screen.getByRole('dialog', { name: '审查意见 1' })
  expect(within(popover).getByTestId('revision-suggestion-0')).toHaveTextContent('已加入修订草稿 · 尚未提交')
  expect(within(popover).getByTestId('revision-suggestion-0')).toHaveTextContent('拟修改内容：验收标准写明提示文案：“暂无任务”。')
  // Reopening the same opinion shows the same draft; editing keeps the saved text.
  fireEvent.keyDown(document, { key: 'Escape' })
  fireEvent.click(screen.getByRole('button', { name: '审查意见 1' }))
  popover = screen.getByRole('dialog', { name: '审查意见 1' })
  fireEvent.click(within(popover).getByRole('button', { name: '编辑修订建议' }))
  expect(within(popover).getByLabelText('意见 1 的核实结论')).toHaveValue('现有提示文案位于 i18n/zh.json。')
  fireEvent.click(within(popover).getByRole('button', { name: '取消' }))
  fireEvent.click(within(popover).getByRole('button', { name: '移出修订草稿' }))
  expect(within(popover).getByRole('button', { name: '整理修订建议' })).toBeVisible()
})
it('does not place old findings on changed content or treat a stale review as a current approval', async () => {
  const review = await reviewForCurrentRevision()
  render(<DraftHarness review={review} revision={{ ...artifact, content: artifact.content + '\n新版本补充' }} />)
  await waitFor(() => expect(screen.getByTestId('review-reference-summary')).toHaveTextContent('这份审查报告不能证明当前正文已审查'))
  fireEvent.click(screen.getByRole('tab', { name: '待确认事项' }))
  expect(screen.queryByRole('button', { name: '整理修订建议' })).toBeNull()
  expect(screen.queryByRole('button', { name: /^审查意见 1/ })).toBeNull()
})
it.each([
  { name: 'replacement revision with identical text', change: { updatedAt: '2026-09-24T00:00:00Z' } },
  { name: 'artifact moved to another node', change: { nodeId: 'other-node' } },
  { name: 'artifact belonging to another Run', change: { runId: 'other-run' } },
])('keeps a $name historical and non-actionable', async ({ change }) => {
  const review = await reviewForCurrentRevision()
  const revision = { ...artifact, ...change }
  render(<DraftHarness review={review} revision={revision} onOpenReport={vi.fn()} />)
  await waitFor(() => expect(screen.getByText(/^正文摘要：/)).not.toHaveTextContent('正在核验'))
  expect(screen.getByTestId('review-reference-summary')).toHaveTextContent('这份审查报告不能证明当前正文已审查')
  expect(screen.getByRole('button', { name: '在「材料与版本」查看完整报告' })).toBeVisible()
  fireEvent.click(screen.getByRole('tab', { name: /验收标准/ }))
  expect(screen.queryByRole('button', { name: /^审查意见 1/ })).toBeNull()
  expect(screen.queryByRole('button', { name: '整理修订建议' })).toBeNull()
})
it('keeps cross-block, stale and invalid citations reachable without inventing inline locations', async () => {
  const review = await reviewForCurrentRevision()
  const citation = review.missingEvidenceDetails![0]!.citations[0]!
  const end = artifact.content.lastIndexOf('使用中文提示。') + 7
  review.missingEvidenceDetails![0]!.citations = [
    { ...citation, end, quote: artifact.content.slice(citation.start, end) },
    { ...citation, start: -1, end: -1, quote: '' },
    { ...citation, updatedAt: '2026-09-22T00:00:00Z' },
  ]
  render(<GateMaterialReader bundle={bundle()} review={review} knowledge={null} />)
  const summary = await screen.findByTestId('review-reference-summary')
  await waitFor(() => expect(summary).toHaveTextContent('正文旁标出 0 条；另有 2 条没有可核验的原文位置'))
  expect(screen.queryByRole('button', { name: '审查意见 1' })).toBeNull()
  fireEvent.click(within(summary).getByRole('button', { name: '审查意见 1（未定位）' }))
  expect(screen.getByRole('dialog', { name: '审查意见 1' })).toHaveTextContent('确定提示文案')
})
it('offers discussion with the saved source and feedback beside an inline opinion, without submitting', async () => {
  const review = await reviewForCurrentRevision()
  const discuss = vi.fn(), feedback = vi.fn()
  render(<GateMaterialReader bundle={bundle()} review={review} knowledge={null} onDiscuss={discuss} onFeedback={feedback} />)
  await waitFor(() => expect(screen.getByRole('tab', { name: /验收标准/ })).toHaveTextContent('1 条定位意见'))
  fireEvent.click(screen.getByRole('tab', { name: /验收标准/ }))
  fireEvent.click(screen.getByRole('button', { name: '审查意见 1' }))
  expect(screen.getByRole('button', { name: '反馈误报' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '讨论此意见' }))
  // A reference card, not a message: the material, its time and the quoted opinion (plan W7).
  expect(discuss).toHaveBeenCalledWith(expect.objectContaining({
    materialId: expect.stringContaining(artifact.id),
    materialTitle: expect.stringContaining('审查意见 1'),
    version: expect.stringMatching(/^记录于 /),
    excerpt: expect.stringContaining('使用中文提示。'),
  }))
  expect(feedback).not.toHaveBeenCalled()
})
it('adds the requirement version being read as a discussion reference', () => {
  const discuss = vi.fn()
  render(<GateMaterialReader bundle={bundle()} review={null} knowledge={null} onDiscuss={discuss} />)
  fireEvent.click(screen.getByRole('button', { name: '讨论此材料' }))
  expect(discuss).toHaveBeenCalledWith(expect.objectContaining({ materialId: artifact.id, version: expect.stringMatching(/^需求 v\d+$|^记录于 /) }))
})
