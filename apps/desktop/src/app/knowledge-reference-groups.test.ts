import { describe, expect, it } from 'vitest'
import type {
  Artifact,
  ClarificationRevisionMetadata,
  KnowledgeDocument,
  KnowledgeReference,
} from '@ai-devflow/shared'
import { artifacts as fixtureArtifacts, runs as fixtureRuns } from '@ai-devflow/shared/fixtures'
import { groupKnowledgeReferences, type KnowledgeCitation } from './knowledge-reference-groups'

const run = fixtureRuns[0]!

const apiDocument: KnowledgeDocument = {
  id: 'doc-api',
  title: 'API 健康端点规范',
  category: 'api_contract',
  sourcePath: 'docs/knowledge/standards/api-health.md',
  summary: '健康端点的响应格式与错误模型。',
  tags: ['api'],
  updatedAt: '2026-08-01T00:00:00.000Z',
  markdown: '# API 健康端点规范',
}

const testDocument: KnowledgeDocument = {
  id: 'doc-test',
  title: '本地测试证据规范',
  category: 'testing_standard',
  sourcePath: 'docs/knowledge/standards/testing.md',
  summary: '测试证据要求。',
  tags: ['test'],
  updatedAt: '2026-08-01T00:00:00.000Z',
  markdown: '# 本地测试证据规范',
}

function reference(
  fields: Pick<KnowledgeReference, 'id' | 'targetType' | 'documentId' | 'relation'> & Partial<KnowledgeReference>,
): KnowledgeReference {
  return { runId: run.id, reason: 'Matched api health guidance.', ...fields }
}

const responseSection = ['API 健康端点规范', '响应格式']

const references: KnowledgeReference[] = [
  reference({
    id: 'knowledge-ref-run-run-health-001-doc-api-cites',
    targetType: 'run',
    documentId: 'doc-api',
    relation: 'cites',
    strategy: 'lexical',
    lexicalMatch: { rawScore: 3, matchedTerms: ['health'], normalized: false, crossQueryComparable: false, source: 'retriever' },
    chunkId: 'chunk-api-response',
    contentHash: 'kh-aaa111',
    headingPath: responseSection,
  }),
  reference({
    id: 'ref-test-run',
    targetType: 'run',
    documentId: 'doc-test',
    relation: 'cites',
    chunkId: 'chunk-test-1',
    contentHash: 'kh-ttt000',
    headingPath: ['本地测试证据规范'],
  }),
  reference({
    id: 'ref-clarify-material',
    targetType: 'artifact',
    artifactId: 'art-clarify',
    nodeId: 'n-clarify',
    documentId: 'doc-api',
    relation: 'cites',
    strategy: 'lexical',
    chunkId: 'chunk-api-response',
    contentHash: 'kh-aaa111',
    headingPath: responseSection,
  }),
  reference({
    id: 'ref-design-material',
    targetType: 'artifact',
    artifactId: 'art-design',
    nodeId: 'n-design',
    documentId: 'doc-api',
    relation: 'cites',
    chunkId: 'chunk-api-errors',
    contentHash: 'kh-bbb222',
    headingPath: ['API 健康端点规范', '错误模型'],
  }),
  reference({
    id: 'ref-design-gate',
    targetType: 'gate_decision',
    nodeId: 'n-design-gate',
    documentId: 'doc-api',
    relation: 'requires_evidence',
    chunkId: 'chunk-api-response',
    contentHash: 'kh-aaa111',
    headingPath: responseSection,
    gateEvidence: { status: 'reviewed_reference', reviewId: 'review-design-1' },
  }),
]

function firstLayerLabels(citation: KnowledgeCitation): string[] {
  return [
    citation.placeKindLabel,
    citation.placeTitle,
    citation.contextLabel,
    citation.otherTaskLabel,
    citation.sectionLabel,
    citation.versionLabel,
    citation.materialVersionLabel,
    citation.relationLabel,
    citation.reviewStatusLabel,
    citation.retrievalLabel,
  ].filter((value): value is string => typeof value === 'string')
}

describe('groupKnowledgeReferences', () => {
  it('collapses every citation of one document into one group', () => {
    const groups = groupKnowledgeReferences({
      references,
      documents: [apiDocument, testDocument],
      run,
      artifacts: fixtureArtifacts,
    })

    expect(groups.map((group) => group.documentId)).toEqual(['doc-api', 'doc-test'])
    const api = groups[0]!
    expect(api.title).toBe('API 健康端点规范')
    expect(api.document).toBe(apiDocument)
    expect(api.citations.map((citation) => [citation.placeKindLabel, citation.placeTitle])).toEqual([
      ['开发任务', run.title],
      ['材料', '需求澄清结果'],
      ['材料', '方案设计'],
      ['Gate', '方案评审 Gate'],
    ])
    expect(api.citations[1]!.contextLabel).toBe('步骤：需求澄清')
    expect(api.citations[0]!.contextLabel).toBeUndefined()
    expect(groups[1]!.citations).toHaveLength(1)
  })

  it('keeps a stable order: groups by first citation, citations in reference order', () => {
    const first = groupKnowledgeReferences({ references, documents: [testDocument, apiDocument], run, artifacts: fixtureArtifacts })
    const second = groupKnowledgeReferences({ references, documents: [apiDocument, testDocument], run, artifacts: fixtureArtifacts })

    expect(first.map((group) => group.documentId)).toEqual(['doc-api', 'doc-test'])
    expect(first).toEqual(second)
    expect(first[0]!.citations.map((citation) => citation.referenceId)).toEqual([
      'knowledge-ref-run-run-health-001-doc-api-cites',
      'ref-clarify-material',
      'ref-design-material',
      'ref-design-gate',
    ])
  })

  it('retains version, section and review relation per citation', () => {
    const [api] = groupKnowledgeReferences({ references, documents: [apiDocument], run, artifacts: fixtureArtifacts })
    const [runCitation, clarifyCitation, designCitation, gateCitation] = api!.citations

    expect(runCitation).toMatchObject({
      sectionLabel: 'API 健康端点规范 / 响应格式',
      versionLabel: '内容版本已记录',
      relationLabel: '引用',
      isReviewBasis: false,
      reviewStatusLabel: '检索候选，尚未经审查确认',
      retrievalLabel: '关键词检索',
    })
    expect(clarifyCitation!.sectionLabel).toBe('API 健康端点规范 / 响应格式')
    expect(designCitation).toMatchObject({ sectionLabel: 'API 健康端点规范 / 错误模型', versionLabel: '内容版本已记录' })
    expect(gateCitation).toMatchObject({
      relationLabel: '审查依据',
      isReviewBasis: true,
      reviewStatusLabel: '已经审查确认',
    })
    expect(gateCitation!.retrievalLabel).toBeUndefined()
  })

  it('numbers content versions only within the same section', () => {
    const [api] = groupKnowledgeReferences({
      references: [
        ...references,
        reference({
          id: 'ref-build-step',
          targetType: 'node',
          nodeId: 'n-build',
          documentId: 'doc-api',
          relation: 'cites',
          chunkId: 'chunk-api-response',
          contentHash: 'kh-ccc333',
          headingPath: responseSection,
        }),
        reference({ id: 'ref-no-hash', targetType: 'node', nodeId: 'n-test', documentId: 'doc-api', relation: 'satisfies' }),
      ],
      documents: [apiDocument],
      run,
    })
    const version = (id: string) => api!.citations.find((citation) => citation.referenceId === id)!.versionLabel

    expect(version('knowledge-ref-run-run-health-001-doc-api-cites')).toBe('内容版本 1/2')
    expect(version('ref-design-gate')).toBe('内容版本 1/2')
    expect(version('ref-build-step')).toBe('内容版本 2/2')
    expect(version('ref-design-material')).toBe('内容版本已记录')
    expect(version('ref-no-hash')).toBe('未记录内容版本')
    expect(api!.citations.find((citation) => citation.referenceId === 'ref-build-step')).toMatchObject({
      placeKindLabel: '步骤',
      placeTitle: '本地实现',
    })
    expect(api!.citations.find((citation) => citation.referenceId === 'ref-no-hash')!.relationLabel).toBe('已满足此规范')
  })

  it('keeps identifiers, hashes and scores out of first-layer labels but in details', () => {
    const groups = groupKnowledgeReferences({ references, documents: [apiDocument, testDocument], run, artifacts: fixtureArtifacts })
    const identifiers = [
      'kh-',
      run.id,
      'run-',
      'knowledge-ref',
      'ref-',
      'chunk-',
      'art-',
      'n-design',
      'review-design-1',
      'lexical',
      'LEXICAL',
      'retrieval_candidate',
      'reviewed_reference',
      'requires_evidence',
      '匹配分',
    ]

    for (const citation of groups.flatMap((group) => group.citations)) {
      for (const label of firstLayerLabels(citation)) {
        for (const identifier of identifiers) expect(label).not.toContain(identifier)
      }
    }

    const runCitation = groups[0]!.citations[0]!
    const details = Object.fromEntries(runCitation.details.map((detail) => [detail.label, detail.value]))
    expect(details).toMatchObject({
      内容哈希: 'kh-aaa111',
      分段标识: 'chunk-api-response',
      检索方法: 'lexical',
      命中词: 'health',
      引用标识: 'knowledge-ref-run-run-health-001-doc-api-cites',
      任务标识: run.id,
      来源路径: 'docs/knowledge/standards/api-health.md',
    })
    expect(details.关键词匹配分).toContain('3')
    expect(details.审查状态).toContain('retrieval_candidate')
    expect(details.审查状态).toContain('不是 Gate 结论')
    const gateDetails = groups[0]!.citations[3]!.details.map((detail) => detail.value)
    expect(gateDetails).toContain('review-design-1')
    expect(gateDetails).toContain('requires_evidence')
  })

  it('names materials from artifacts, with their revision, and falls back without them', () => {
    const revised: Artifact = {
      ...fixtureArtifacts[0]!,
      clarificationRevision: { revision: 2 } as ClarificationRevisionMetadata,
    }
    const [withArtifacts] = groupKnowledgeReferences({ references: [references[2]!], documents: [apiDocument], run, artifacts: [revised] })
    const [withoutArtifacts] = groupKnowledgeReferences({ references: [references[2]!], documents: [apiDocument], run })

    expect(withArtifacts!.citations[0]).toMatchObject({ placeTitle: '需求澄清结果', materialVersionLabel: '材料 v2' })
    expect(withoutArtifacts!.citations[0]).toMatchObject({ placeTitle: '未加载的材料', contextLabel: '步骤：需求澄清' })
    expect(withoutArtifacts!.citations[0]!.materialVersionLabel).toBeUndefined()
  })

  it('keeps citations of documents missing from the index and of other tasks', () => {
    const [missing] = groupKnowledgeReferences({
      references: [reference({ id: 'ref-other', runId: 'run-other', targetType: 'gate_decision', nodeId: 'n-x', documentId: 'doc-gone', relation: 'requires_evidence' })],
      documents: [apiDocument],
      run,
    })

    expect(missing).toMatchObject({ documentId: 'doc-gone', document: undefined, title: '当前索引中没有这份文档' })
    expect(missing!.citations[0]).toMatchObject({
      placeKindLabel: 'Gate',
      placeTitle: '未找到的步骤',
      otherTaskLabel: '来自其他开发任务',
    })
    expect(missing!.citations[0]!.details).toContainEqual({ label: '任务标识', value: 'run-other' })
  })
})
