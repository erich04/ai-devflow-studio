import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { AgentReviewResult } from '@ai-devflow/shared'
import { ReviewEvidenceDetails } from './ReviewEvidenceDetails'
afterEach(cleanup)

const review: AgentReviewResult = {
  id: 'review-1', requestId: 'request', projectId: 'project', runId: 'run', nodeId: 'gate', runtime: 'electron',
  providerId: 'provider', model: 'model', conclusion: '核对决定', summary: '待核对', risks: [],
  missingEvidence: ['未决定是否支持撤销'], suggestedTests: [], knowledgeReferences: [], policyFindings: [], confidence: 0.8,
  gateAdvisory: { id: 'advisory', runId: 'run', nodeId: 'gate', level: 'warn', blocksApproval: false, summary: '核对', missingEvidence: [], riskCount: 0, createdAt: '2026-09-20T00:00:00Z' },
  createdAt: '2026-09-20T00:00:00Z', missingEvidenceDetails: [{ index: 0, assessment: 'explicit_non_goal', requiresReview: true,
    citations: [{ sourceId: 'clarification-v2', title: '需求澄清 v2', quote: '不做撤销/回收站', contentDigest: 'digest-v2', start: 15, end: 24, updatedAt: '2026-09-17T07:10:00Z' }] }],
}

it('locates the captured source and records a false-positive report with a reason', async () => {
  const onFeedback = vi.fn(async () => ({ ...review, feedback: [{ id: 'feedback', missingEvidenceIndex: 0, kind: 'false_positive' as const, reason: '原文已经明确不做撤销。', actorId: 'reviewer', createdAt: review.createdAt }] }))
  render(<ReviewEvidenceDetails review={review} onFeedback={onFeedback} />)
  expect(screen.getByText(/原文已有明确的非目标/)).toBeInTheDocument()
  fireEvent.click(screen.getByText('原文依据：需求澄清 v2'))
  expect(screen.getByText('不做撤销/回收站')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '反馈误报' }))
  fireEvent.change(screen.getByLabelText('误报说明'), { target: { value: '原文已经明确不做撤销。' } })
  fireEvent.click(screen.getByRole('button', { name: '保存反馈' }))
  await waitFor(() => expect(screen.getByText(/已记录人工反馈/)).toBeVisible())
  expect(onFeedback).toHaveBeenCalledWith({ projectId: 'project', runId: 'run', reviewId: 'review-1', missingEvidenceIndex: 0, reason: '原文已经明确不做撤销。' })
  expect(screen.getByText('未决定是否支持撤销')).toBeInTheDocument()
  expect(screen.getByText(/不会自动批准 Gate/)).toBeInTheDocument()
})
