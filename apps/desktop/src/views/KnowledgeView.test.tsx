import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import type {
  KnowledgeDocument,
  KnowledgeEntity,
  KnowledgeReference,
  KnowledgeRelation,
} from '@ai-devflow/shared'
import { artifacts as fixtureArtifacts, runs as fixtureRuns } from '@ai-devflow/shared/fixtures'
import { buildKnowledgeDataSource, formatLocalTime, type SupportContext } from '../app/desktop-view-model'
import { KnowledgeView } from './KnowledgeView'

const run = fixtureRuns[0]!
const indexedAt = '2026-08-01T00:00:00.000Z'

const apiDocument: KnowledgeDocument = {
  id: 'doc-api',
  title: 'API 健康端点规范',
  category: 'api_contract',
  sourcePath: 'docs/knowledge/standards/api-health.md',
  summary: '健康端点的响应格式与错误模型。',
  tags: ['api'],
  updatedAt: indexedAt,
  markdown: '# API 健康端点规范',
}

const testDocument: KnowledgeDocument = {
  id: 'doc-test',
  title: '本地测试证据规范',
  category: 'testing_standard',
  sourcePath: 'docs/knowledge/standards/testing.md',
  summary: '测试证据要求。',
  tags: ['test'],
  updatedAt: indexedAt,
  markdown: '# 本地测试证据规范',
}

const responseSection = ['API 健康端点规范', '响应格式']
const base = { runId: run.id, reason: 'Matched api health guidance.', contentHash: 'kh-aaa111', chunkId: 'chunk-api-response', headingPath: responseSection }

const references: KnowledgeReference[] = [
  {
    ...base,
    id: 'knowledge-ref-run-run-health-001-doc-api-cites',
    targetType: 'run',
    documentId: 'doc-api',
    relation: 'cites',
    strategy: 'lexical',
    lexicalMatch: { rawScore: 3, matchedTerms: ['health'], normalized: false, crossQueryComparable: false, source: 'retriever' },
  },
  { ...base, id: 'ref-clarify-material', targetType: 'artifact', artifactId: 'art-clarify', nodeId: 'n-clarify', documentId: 'doc-api', relation: 'cites', strategy: 'lexical' },
  { ...base, id: 'ref-design-material', targetType: 'artifact', artifactId: 'art-design', nodeId: 'n-design', documentId: 'doc-api', relation: 'cites' },
  {
    ...base,
    id: 'ref-design-gate',
    targetType: 'gate_decision',
    nodeId: 'n-design-gate',
    documentId: 'doc-api',
    relation: 'requires_evidence',
  },
  { ...base, id: 'ref-test-run', targetType: 'run', documentId: 'doc-test', relation: 'cites', contentHash: 'kh-ttt000', chunkId: 'chunk-test', headingPath: ['本地测试证据规范'] },
]

const entities: KnowledgeEntity[] = [
  { id: 'entity-api', label: 'Health API', kind: 'standard', sourcePath: apiDocument.sourcePath },
  { id: 'entity-route', label: 'health route', kind: 'module', sourcePath: apiDocument.sourcePath },
]
const relations: KnowledgeRelation[] = [
  { id: 'relation-1', source: 'entity-api', target: 'entity-route', label: 'defines' },
]

const snapshot = {
  projectId: 'local-project',
  contentHash: 'repository-hash',
  documents: [apiDocument, testDocument],
  chunks: [],
  entities,
  relations,
  indexedAt,
  truncated: true,
  warnings: ['file_count_limit_exceeded' as const],
}

function renderView(overrides: Partial<Parameters<typeof KnowledgeView>[0]> = {}) {
  const props: Parameters<typeof KnowledgeView>[0] = {
    query: '',
    documents: [apiDocument, testDocument],
    entities,
    relations,
    references,
    selectedRun: run,
    artifacts: fixtureArtifacts,
    supportContext: null,
    focusedDocumentId: undefined,
    focusedReferenceId: undefined,
    dataSource: buildKnowledgeDataSource({ desktopConnected: true, dataOrigin: 'local', snapshot }),
    indexedAt,
    truncated: true,
    warnings: ['file_count_limit_exceeded'],
    isLoading: false,
    onRefresh: vi.fn(),
    onReturnToInspector: vi.fn(),
    ...overrides,
  }
  render(<KnowledgeView {...props} />)
  return props
}

/** Every element whose own text matches is inside a closed 详情 disclosure. */
function expectOnlyInClosedDetails(pattern: RegExp) {
  const matches = screen.queryAllByText(pattern)
  expect(matches.length).toBeGreaterThan(0)
  for (const element of matches) {
    const details = element.closest('details')
    expect(details, `${element.textContent} is on the first layer`).not.toBeNull()
    expect(details).not.toHaveAttribute('open')
    expect(details!.querySelector('summary')).toHaveTextContent('详情')
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('KnowledgeView', () => {
  it('shows each cited document once with the places that cite it beneath', () => {
    renderView()

    const cards = screen.getAllByTestId('knowledge-document')
    expect(cards).toHaveLength(2)
    expect(screen.getAllByText('API 健康端点规范')).toHaveLength(1)
    const apiCard = cards[0]!
    const citations = within(apiCard).getAllByTestId('knowledge-run-reference')
    expect(citations).toHaveLength(4)
    expect(within(apiCard).getByText('当前任务中有 4 处引用')).toBeInTheDocument()
    expect(citations.map((citation) => citation.querySelector('strong')?.textContent)).toEqual([
      run.title,
      '需求澄清结果',
      '方案设计',
      '方案评审 Gate',
    ])
    expect(citations[1]).toHaveTextContent('步骤：需求澄清')
    expect(citations[3]).toHaveTextContent('审查依据')
    for (const citation of citations) {
      expect(citation).toHaveTextContent('章节：API 健康端点规范 / 响应格式')
      expect(citation).toHaveTextContent('内容版本已记录')
      expect(citation).toHaveTextContent('检索候选，尚未经审查确认')
    }
    expect(citations[0]).toHaveTextContent('关键词检索')
    expect(within(cards[1]!).getAllByTestId('knowledge-run-reference')).toHaveLength(1)
    expect(screen.getByTestId('knowledge-reference-summary')).toHaveTextContent('2 份文档被引用 5 处')
  })

  it('keeps hashes, retrieval scores and ids in 详情 only', () => {
    renderView()

    expectOnlyInClosedDetails(/kh-aaa111/)
    expectOnlyInClosedDetails(/关键词匹配分/)
    expectOnlyInClosedDetails(/run-health-001/)
    expectOnlyInClosedDetails(/retrieval_candidate/)
    expectOnlyInClosedDetails(/chunk-api-response/)
    expect(screen.queryByText(/LEXICAL/i, { ignore: 'details *' })).not.toBeInTheDocument()
    // The raw values stay reachable for copying.
    const firstCitation = screen.getAllByTestId('knowledge-run-reference')[0]!
    fireEvent.click(within(firstCitation).getByText('详情'))
    expect(within(firstCitation).getByText('内容哈希：kh-aaa111')).toBeVisible()
    expect(within(firstCitation).getByText('检索方法：lexical')).toBeInTheDocument()
    expect(within(firstCitation).getByText('来源路径：docs/knowledge/standards/api-health.md')).toBeInTheDocument()
  })

  it('highlights and scrolls to the reference opened from the task, with a way back', () => {
    const scrollIntoView = vi.fn()
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, writable: true, value: scrollIntoView })
    onTestFinished(() => {
      if (original) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', original)
      else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView
    })
    const supportContext: SupportContext = {
      runId: run.id,
      nodeId: 'n-design-gate',
      sourceView: 'workbench',
      returnView: 'workbench',
      focusTarget: 'knowledge-reference',
      label: '知识引用来源',
      referenceId: 'ref-design-gate',
      documentId: 'doc-api',
      createdAt: indexedAt,
    }
    const props = renderView({
      // The focused document is listed second and does not match the query.
      documents: [testDocument, apiDocument],
      query: '测试证据',
      supportContext,
      focusedDocumentId: 'doc-api',
      focusedReferenceId: 'ref-design-gate',
    })

    const focusedDocument = screen.getByTestId('focused-knowledge-document')
    expect(focusedDocument).toHaveTextContent('API 健康端点规范')
    expect(screen.getByTestId('knowledge-view').querySelector('.knowledge-doc-card')).toBe(focusedDocument)
    const focusedReference = within(focusedDocument).getByTestId('focused-knowledge-reference')
    expect(focusedReference).toHaveClass('is-focused')
    expect(focusedReference).toHaveTextContent('Gate')
    expect(focusedReference).toHaveTextContent('方案评审 Gate')
    expect(focusedReference).toBeVisible()
    expect(scrollIntoView).toHaveBeenCalled()
    expect(scrollIntoView.mock.contexts).toContain(focusedReference)
    // The other citations of the same document stay listed around it.
    expect(within(focusedDocument).getAllByTestId('knowledge-run-reference')).toHaveLength(3)

    const banner = screen.getByTestId('support-context-banner')
    expect(banner).toHaveTextContent('来自任务')
    expect(banner).toHaveTextContent('知识引用来源')
    fireEvent.click(within(banner).getByRole('button', { name: '返回任务' }))
    expect(props.onReturnToInspector).toHaveBeenCalledTimes(1)
  })

  it('uses Chinese headings and labels while the raw values stay reachable', () => {
    renderView()

    const view = screen.getByTestId('knowledge-view')
    expect(view).toHaveTextContent('知识治理')
    expect(view).toHaveTextContent('仓库 Markdown 索引')
    expect(view).toHaveTextContent('知识图谱')
    expect(view).toHaveTextContent('当前任务的引用')
    for (const english of ['Knowledge Governance', 'Git Markdown Index', 'Knowledge Graph', 'Run references', 'No selected Run']) {
      expect(view).not.toHaveTextContent(english)
    }

    const badge = screen.getByTestId('knowledge-data-source')
    expect(badge).toHaveTextContent('知识索引已更新 · 结果不完整')
    expect(badge.getAttribute('title')).toContain('indexed · truncated')
    expect(screen.getByTestId('knowledge-index-metadata')).toHaveTextContent(`更新于 ${formatLocalTime(indexedAt)}`)
    expect(screen.getByTestId('knowledge-index-details')).toHaveTextContent(`索引时间：${indexedAt}`)
    expect(screen.getByTestId('knowledge-index-details')).toHaveTextContent('local indexed · indexed · truncated')
    expectOnlyInClosedDetails(/2026-08-01T00:00:00\.000Z/)

    const warnings = screen.getByTestId('knowledge-index-warnings')
    expect(within(warnings).getByText('文件数量超出上限')).toHaveAttribute('title', 'file_count_limit_exceeded')
    expectOnlyInClosedDetails(/file_count_limit_exceeded/)

    expect(screen.getByText('接口契约')).toHaveAttribute('title', 'api_contract')
    expect(screen.getByText('规范')).toHaveAttribute('title', 'standard')
    const relation = screen.getByTestId('knowledge-graph-relation')
    expect(relation).toHaveTextContent('Health API 定义 health route')
    expect(within(relation).getByTitle('defines')).toHaveTextContent('定义')
  })

  it('renders the memory panel under 记忆管理 only when provided', () => {
    renderView({ memoryPanel: <div data-testid="memory-panel-stub">记忆面板</div> })

    const section = screen.getByRole('region', { name: '记忆管理' })
    expect(within(section).getByTestId('memory-panel-stub')).toBeInTheDocument()
  })

  it('omits the memory section and shows Chinese empty states without data', () => {
    renderView({
      documents: [],
      references: [],
      entities: [],
      relations: [],
      selectedRun: undefined,
      truncated: false,
      warnings: [],
      indexedAt: undefined,
      dataSource: buildKnowledgeDataSource({ desktopConnected: false, dataOrigin: 'local' }),
    })

    expect(screen.queryByRole('region', { name: '记忆管理' })).not.toBeInTheDocument()
    const view = screen.getByTestId('knowledge-view')
    expect(view).toHaveTextContent('没有匹配的知识文档')
    expect(view).toHaveTextContent('没有匹配的知识节点')
    expect(view).toHaveTextContent('尚未选择任务')
    expect(view).toHaveTextContent('当前任务尚未匹配到知识引用。')
    expect(screen.getByTestId('knowledge-data-source')).toHaveTextContent('尚未建立知识索引')
    expect(screen.getByTestId('knowledge-index-metadata')).toHaveTextContent('尚未索引')
  })
})
