import { describe, expect, it } from 'vitest'
import type { KnowledgeReference, NodeKind, NodeStage, WorkflowNode } from './domain'
import {
  canRunKnowledgeReviewOnNode,
  projectWorkflowContext,
  resolveKnowledgeReferenceSemantics,
  workflowContextField,
} from './workflow-context-projection'

function node(stage: NodeStage, kind: NodeKind): WorkflowNode {
  return {
    id: `${stage}-${kind}`,
    stage,
    kind,
    title: `${stage} ${kind}`,
    subtitle: 'projection fixture',
    status: 'running',
    ownerId: 'u-test',
    retryCount: 0,
    artifactIds: [],
  }
}

describe('projectWorkflowContext', () => {
  it.each([
    ['clarify', 'agent', 'generation_references', 'optional', 'agent_review', 'not_applicable'],
    ['clarify', 'gate', 'knowledge_references', 'optional', 'test_evidence', 'not_applicable'],
    ['design', 'agent', 'generation_references', 'optional', 'agent_review', 'not_applicable'],
    ['design', 'gate', 'knowledge_references', 'optional', 'test_evidence', 'optional'],
    ['build', 'task', 'coding_result', 'optional', 'github_delivery', 'not_yet_expected'],
    ['test', 'test', 'test_evidence', 'required', 'agent_review', 'not_applicable'],
    ['pr', 'pr', 'github_delivery', 'required', 'acceptance_evidence', 'not_yet_expected'],
    ['accept', 'acceptance', 'acceptance_evidence', 'required', 'coding_result', 'optional'],
  ] as const)(
    'projects %s/%s positive and negative field responsibilities',
    (stage, kind, positiveField, positiveState, negativeField, negativeState) => {
      const projection = projectWorkflowContext({ node: node(stage, kind) })

      expect(workflowContextField(projection, positiveField)?.applicability).toBe(positiveState)
      expect(workflowContextField(projection, negativeField)?.applicability).toBe(negativeState)
    },
  )

  it('distinguishes not applicable, optional, missing required, and available without losing early evidence', () => {
    const clarifyGate = node('clarify', 'gate')
    const absent = projectWorkflowContext({ node: clarifyGate })
    const supplemental = projectWorkflowContext({
      node: clarifyGate,
      availability: { test_evidence: 1 },
    })
    const policyRequired = projectWorkflowContext({
      node: clarifyGate,
      requiredByPolicy: { test_evidence: true },
    })

    expect(workflowContextField(absent, 'test_evidence')).toMatchObject({
      state: 'not_applicable',
      visible: false,
      includeInProviderPrompt: false,
    })
    expect(workflowContextField(supplemental, 'test_evidence')).toMatchObject({
      state: 'available',
      role: 'supplemental',
      visible: true,
      includeInProviderPrompt: true,
    })
    expect(workflowContextField(policyRequired, 'test_evidence')).toMatchObject({
      state: 'missing_required',
      visible: true,
      includeInProviderPrompt: true,
    })
  })

  it('keeps the Knowledge Review runtime capability scoped to Gate and Acceptance nodes', () => {
    expect(canRunKnowledgeReviewOnNode(node('design', 'agent'))).toBe(false)
    expect(canRunKnowledgeReviewOnNode(node('design', 'gate'))).toBe(true)
    expect(canRunKnowledgeReviewOnNode(node('accept', 'acceptance'))).toBe(true)
  })
})

describe('resolveKnowledgeReferenceSemantics', () => {
  const base: KnowledgeReference = {
    id: 'ref-1',
    runId: 'run-1',
    targetType: 'run',
    documentId: 'doc-1',
    relation: 'cites',
    reason: 'legacy record',
  }

  it('does not promote a legacy lexical score to semantic relevance or Gate Evidence', () => {
    expect(resolveKnowledgeReferenceSemantics({
      ...base,
      strategy: 'lexical',
      score: 8,
    })).toEqual({
      lexicalMatch: {
        rawScore: 8,
        matchedTerms: [],
        normalized: false,
        crossQueryComparable: false,
        source: 'legacy_score',
      },
      gateEvidence: { status: 'retrieval_candidate' },
      legacyScore: 8,
    })
  })

  it('keeps explicit lexical, semantic, and reviewed Gate states independent', () => {
    const semantics = resolveKnowledgeReferenceSemantics({
      ...base,
      strategy: 'hybrid',
      score: 0.91,
      lexicalMatch: {
        rawScore: 4,
        matchedTerms: ['acceptance', 'scope'],
        normalized: false,
        crossQueryComparable: false,
        source: 'retriever',
      },
      semanticRelevance: { score: 0.91, model: 'reranker-v1', source: 'retriever' },
      gateEvidence: { status: 'supports_finding', reviewId: 'review-1', findingIds: ['finding-1'] },
    })

    expect(semantics.lexicalMatch?.rawScore).toBe(4)
    expect(semantics.semanticRelevance?.score).toBe(0.91)
    expect(semantics.gateEvidence.status).toBe('supports_finding')
  })
})
