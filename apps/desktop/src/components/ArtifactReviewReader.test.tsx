import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { sha256Text, type AgentReviewResult, type Artifact } from '@ai-devflow/shared'
import { ArtifactReviewReader } from './ArtifactReviewReader'
afterEach(cleanup)

const design: Artifact = {
  id: 'design-v1', runId: 'r', nodeId: 'design', kind: 'design', title: '任务文本编辑方案', summary: '摘要', redacted: true,
  updatedAt: '2026-10-18T14:40:00Z',
  content: '# 实现方案\n\n复用现有列表组件。\n\n# 验证计划\n\n- 编辑后刷新仍保留。\n\n# 交付与风险\n\nlocalStorage 不可用时只能沿用现有内存降级，不能保证刷新保留。\n',
}

async function designReview(): Promise<AgentReviewResult> {
  const digest = await sha256Text(design.content)
  const quote = 'localStorage 不可用时只能沿用现有内存降级，不能保证刷新保留。'
  const start = design.content.indexOf(quote)
  return {
    id: 'review-design', requestId: 'request', projectId: 'p', runId: 'r', nodeId: 'design-gate', runtime: 'electron', providerId: 'p', model: 'm',
    conclusion: '验证计划缺少降级场景', summary: '补齐降级验证', risks: [], suggestedTests: [], knowledgeReferences: [], policyFindings: [], confidence: 0.8,
    missingEvidence: ['验证清单没有覆盖 localStorage 不可用时的内存降级与提示。'],
    missingEvidenceDetails: [{ index: 0, assessment: 'gap', requiresReview: true, citations: [{ sourceId: design.id, title: '方案', quote, contentDigest: digest, start, end: start + quote.length, updatedAt: design.updatedAt }] }],
    gateAdvisory: { id: 'a', runId: 'r', nodeId: 'design-gate', level: 'warn', blocksApproval: false, summary: '补齐', missingEvidence: [], riskCount: 0, createdAt: design.updatedAt },
    createdAt: '2026-10-18T14:53:00Z',
    contextManifest: { version: 1, stage: 'design', coverage: 'complete', runRequest: { contentDigest: 'raw', sanitizerVersion: '1', coverage: 'complete' },
      subjectArtifacts: [{ id: design.id, runId: 'r', nodeId: 'design', kind: 'design', updatedAt: design.updatedAt, contentDigest: digest, sanitizerVersion: '1', coverage: 'complete', chunks: [] }],
      knowledgeCriteria: [], criteriaCoverage: 'empty' },
  }
}

it('shows a design opinion only beside its paragraph and never appends the report under the tabs (#252)', async () => {
  const review = await designReview()
  const openReport = vi.fn()
  render(<ArtifactReviewReader artifact={design} review={review} onOpenReport={openReport} />)
  await waitFor(() => expect(screen.getByRole('tab', { name: /交付与风险/ })).toHaveTextContent('1 条定位意见'))
  // The tab counts are opinions per tab, so the one opinion is not counted three times.
  expect(screen.getByRole('tab', { name: /实现方案/ })).toHaveTextContent('0 条定位意见')
  expect(screen.getByRole('tab', { name: /验证计划/ })).toHaveTextContent('0 条定位意见')
  for (const tab of [/实现方案/, /验证计划/, /交付与风险/]) {
    fireEvent.click(screen.getByRole('tab', { name: tab }))
    // No report and no opinion text below the body on any tab; one summary line instead.
    expect(screen.queryByTestId('review-evidence-results')).toBeNull()
    expect(screen.queryByText(review.missingEvidence[0]!)).toBeNull()
    expect(screen.getAllByTestId('review-reference-summary')).toHaveLength(1)
  }
  expect(screen.getByTestId('review-reference-summary')).toHaveTextContent('审查意见 1 条，均已在正文旁标出。')
  expect(screen.getAllByRole('button', { name: '审查意见 1' })).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: '审查意见 1' }))
  const popover = screen.getByRole('dialog', { name: '审查意见 1' })
  expect(popover).toHaveTextContent(review.missingEvidence[0]!)
  expect(within(popover).getByRole('button', { name: '关闭审查意见 1' })).toBeVisible()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '在「材料与版本」查看完整报告' }))
  expect(openReport).toHaveBeenCalledTimes(1)
  // A design Gate has no requirement drafts.
  expect(screen.queryByRole('button', { name: '整理修订建议' })).toBeNull()
})

it('says when there is no saved review', () => {
  render(<ArtifactReviewReader artifact={design} review={null} />)
  expect(screen.getByTestId('review-reference-summary')).toHaveTextContent('尚未保存 AI 审查报告。')
  expect(screen.queryByRole('button', { name: '在「材料与版本」查看完整报告' })).toBeNull()
})
