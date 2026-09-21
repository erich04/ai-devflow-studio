import { describe, expect, it } from 'vitest'
import { buildAgentReviewContext, createAgentReviewArtifacts, createOpenAiCompatibleAgentProvider, runKnowledgeReviewAgent } from './agent-review'
import { artifacts, runs } from './fixtures'
import { locateReviewMissingEvidence } from './review-grounding'

describe('Gate review evidence grounding', () => {
  it('does not verify invented, stale or ambiguously assigned citations, and derives locations itself', async () => {
    const run = runs[0]!
    const node = run.nodes.find((item) => item.id === 'n-clarify-gate')!
    const context = await buildAgentReviewContext({ run, node, artifacts, testEvidence: [], knowledgeDocuments: [], knowledgeChunks: [] })
    const source = context.subjectArtifacts[0]!
    const quote = source.content.slice(0, 40)
    const citation = { sourceId: source.id, quote, start: 999999, contentDigest: 'forged-digest' }
    const result = locateReviewMissingEvidence(context, ['valid', 'invented', 'stale', 'duplicate'], [
      { index: 0, assessment: 'gap', citations: [citation] },
      { index: 1, assessment: 'gap', citations: [{ sourceId: source.id, quote: 'AN_INVENTED_CLAIM_NOT_IN_THE_DOCUMENT' }] },
      { index: 2, assessment: 'gap', citations: [{ sourceId: 'old-revision-or-other-run', quote }] },
      { index: 3, assessment: 'gap', citations: [citation] },
      { index: 3, assessment: 'gap', citations: [citation] },
    ])
    expect(result[0]?.citations).toEqual([expect.objectContaining({ start: 0, end: quote.length, contentDigest: source.contentDigest })])
    expect(result.slice(1)).toEqual([1, 2, 3].map((index) => ({ index, assessment: 'unverified', citations: [], requiresReview: true })))
    expect(locateReviewMissingEvidence(context, ['legacy finding'], undefined)).toEqual([
      { index: 0, assessment: 'unverified', citations: [], requiresReview: true },
    ])
    const outsideSection = { ...context, subjectArtifacts: [{ ...source, content: '这里的业务决定只是正文，不是非目标。' }] }
    expect(locateReviewMissingEvidence(outsideSection, ['opinion'], [{ index: 0, assessment: 'explicit_non_goal',
      citations: [{ sourceId: source.id, quote: '业务决定只是正文' }] }])[0]?.assessment).toBe('unverified')
    const repeated = { ...context, subjectArtifacts: [{ ...source, content: '## Goals\n不提供撤销功能\n## Non-goals\n不提供撤销功能' }] }
    expect(locateReviewMissingEvidence(repeated, ['opinion'], [{ index: 0, assessment: 'gap',
      citations: [{ sourceId: source.id, quote: '不提供撤销功能' }] }])[0]?.assessment).toBe('unverified')
  })

  it('marks a missing-decision claim citing an explicit non-goal for human review, with exact current-version evidence', async () => {
    // Public regression reported in #137. This is a controlled reproduction of
    // the observed contradiction, not a claim of a new live-model result.
    const quote = '不做二次确认弹窗、不做撤销/回收站'
    const subject = { ...artifacts[0]!, content: `## Goals\n清除全部已完成任务。\n\n## Non-goals\n- ${quote}\n\n## Open Questions\n无。`, updatedAt: '2026-09-17T07:10:00.000Z' }
    const run = runs[0]!
    const node = run.nodes.find((item) => item.id === 'n-clarify-gate')!
    const context = await buildAgentReviewContext({ run, node, artifacts: [subject,
      { ...subject, id: 'old-clarification', content: 'OLD_UNDECIDED_CONFIRMATION_RULE', updatedAt: '2026-09-16T00:00:00.000Z' }],
      testEvidence: [], knowledgeDocuments: [], knowledgeChunks: [],
    })
    let requestBody = ''
    const provider = createOpenAiCompatibleAgentProvider({ model: 'test-model', apiKey: 'fixture',
      fetcher: async (_url, init) => {
        requestBody = String(init?.body)
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
          conclusion: '需核对', summary: '澄清已生成', risks: [],
          missingEvidence: ['尚未决定是否增加二次确认或撤销。'],
          missingEvidenceDetails: [{ index: 0, assessment: 'gap', explanation: '需要补充决定',
            citations: [{ sourceId: subject.id, quote }] }],
          suggestedTests: [], confidence: 0.8,
        }) } }], usage: { prompt_tokens: 100, completion_tokens: 50 } }))
      },
    })
    const result = await runKnowledgeReviewAgent({ context, provider,
      request: { id: 'review-regression-137', projectId: run.projectId, runId: run.id, nodeId: node.id, requestedBy: 'reviewer', runtime: 'electron' },
    })
    expect(requestBody).toContain(quote)
    expect(requestBody).not.toContain('OLD_UNDECIDED_CONFIRMATION_RULE')
    expect(result.review).toMatchObject({ missingEvidenceDetails: [{ index: 0,
      assessment: 'explicit_non_goal', requiresReview: true,
      citations: [{ sourceId: subject.id, quote, start: subject.content.indexOf(quote),
        end: subject.content.indexOf(quote) + quote.length, updatedAt: subject.updatedAt,
        contentDigest: context.subjectArtifacts[0]!.contentDigest }],
    }] })
    expect(result.review.gateAdvisory.blocksApproval).toBe(false)
    expect(node.status).toBe('success')
    const report = createAgentReviewArtifacts(result).artifact.content
    expect(report).toContain('explicit_non_goal · requires human review')
    expect(report).toContain(quote)
  })
})
