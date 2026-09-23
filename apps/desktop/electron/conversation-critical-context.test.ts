import { describe, it, expect } from 'vitest'
import { createWorkflowRunFromRequest } from '@ai-devflow/shared'
import { buildCriticalContext, criticalContextSent, criticalReceipt, receiptIsCurrent } from './conversation-critical-context'

const created = createWorkflowRunFromRequest({ runId: 'long-run', title: '正文核验', request: '头部：保留数据。\n中间：切换不修改任务。\n尾部：中文提示。', projectId: 'p', creatorId: 'u', branchName: 'main', now: '2026-09-23T00:00:00Z' })
const run = created.run
const nodeId = run.currentNodeId
describe('critical proposal context', () => {
  it('requires the exact final serialized body, including middle and tail, independent of tool pagination', () => {
    const context = buildCriticalContext(run, nodeId, [])
    expect(criticalContextSent(JSON.stringify({ criticalProposalInput: context }), context)).toBe(true)
    for (const content of ['头部：保留数据。', '尾部：中文提示。', '头部：保留数据。'.repeat(3)]) {
      const incomplete = structuredClone(context); incomplete.documents[0]!.content = content
      expect(criticalContextSent(JSON.stringify({ criticalProposalInput: incomplete }), context)).toBe(false)
    }
    const other = structuredClone(context); other.runId = 'other'
    expect(criticalContextSent(JSON.stringify({ criticalProposalInput: other }), context)).toBe(false)
  })
  it('rejects missing or duplicated acceptance mappings and detects updated source bodies', () => {
    const context = buildCriticalContext(run, nodeId, [])
    const proposal = '保留数据；切换不修改任务；中文提示。'
    const coverage = context.criteria.map((criterion) => ({ criterionId: criterion.id, sourceQuote: criterion.text, proposalQuote: proposal }))
    const receipt = criticalReceipt(context, proposal, coverage)!
    expect(receiptIsCurrent(receipt, context)).toBe(true)
    expect(criticalReceipt(context, proposal, coverage.slice(1))).toBeNull()
    expect(criticalReceipt(context, proposal, [coverage[0], coverage[0], coverage[0]])).toBeNull()
    expect(receiptIsCurrent(receipt, buildCriticalContext({ ...run, request: run.request + '\n新增尾部条件。' }, nodeId, []))).toBe(false)
  })
  it('preserves Unicode, literal escaping and full long-line body without merging another node’s proposal', () => {
    const content = '😀\\n\"中文\"'.repeat(2500) + '尾部条件'
    const context = buildCriticalContext({ ...run, request: content }, nodeId, [])
    expect(context.documents[0]!.content).toBe(content)
    expect(criticalContextSent(JSON.stringify({ criticalProposalInput: context }), context)).toBe(true)
  })
})
