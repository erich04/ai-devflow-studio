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
import { buildKnowledgeDirectoryView } from '../app/knowledge-directory-view-model'
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

function withFrontMatter(fields: string, body: string): string {
  return `---\ntitle: Doc\n${fields}\n---\n${body}`
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

  it('shows the knowledge directory, stage usage and non-blocking checks (K4)', () => {
    const directory = buildKnowledgeDirectoryView({
      snapshot: {
        ...snapshot,
        truncated: false,
        warnings: [],
        knowledgeRoot: 'docs/knowledge',
        projectInstructions: {
          sourcePath: 'AGENTS.md', content: '# Rules', bytes: 3_003, contentDigest: `sha256:${'a'.repeat(64)}`, truncated: false,
        },
        documents: [
          { ...apiDocument, stages: ['clarify', 'design'], gateStages: [], markdown: withFrontMatter('stages: [clarify, design]', '# API 健康端点规范') },
          {
            ...testDocument,
            stages: ['design', 'test'],
            gateStages: ['test'],
            markdown: withFrontMatter('stages: [design, test]\ngate: [test]', '# 本地测试证据规范\n[旧链接](removed.md)'),
          },
        ],
        linkTargets: [{ path: 'docs/knowledge/standards/removed.md', kind: 'missing' }],
      },
      recordedManifests: [],
    })
    renderView({ directory, truncated: false, warnings: [] })

    const section = screen.getByRole('region', { name: 'docs/knowledge' })
    expect(section).toHaveTextContent('知识目录')
    expect(within(screen.getByTestId('knowledge-project-instructions')).getByText('AGENTS.md · 2.9 KiB（上限 32 KiB）')).toBeInTheDocument()
    expectOnlyInClosedDetails(/sha256:a{64}/)

    const table = within(section).getByRole('table', { name: '各阶段整篇注入的规范（每个阶段上限 24 KiB）' })
    const rows = within(table).getAllByTestId('knowledge-stage-budget')
    expect(rows.map((row) => within(row).getByRole('rowheader').textContent)).toEqual([
      '需求澄清', '方案设计', '开发实现', '测试证据', 'PR 交付', '业务验收',
    ])
    expect(rows[1]).toHaveTextContent('2 份')
    expect(rows[3]).toHaveTextContent('1 份1 份')

    const checks = screen.getByTestId('knowledge-checks')
    expect(checks).toHaveTextContent('发现 1 项需要处理的问题。')
    expect(checks).toHaveTextContent('这些检查只用于提示，不会阻断任何步骤或 Gate。')
    const finding = within(checks).getByTestId('knowledge-check-finding')
    expect(finding).toHaveTextContent('断链')
    expect(finding).toHaveTextContent('docs/knowledge/standards/testing.md 第 7 行')
    expect(finding).toHaveTextContent('链接目标 removed.md 不存在。')
    expectOnlyInClosedDetails(/broken_link:missing/)

    const [apiCard, testCard] = screen.getAllByTestId('knowledge-document')
    expect(within(apiCard!).getByTestId('knowledge-document-stages')).toHaveTextContent('适用阶段：需求澄清、方案设计不作为 Gate 依据')
    expect(within(testCard!).getByTestId('knowledge-document-stages')).toHaveTextContent('Gate 依据：测试证据')
  })

  it('replaces the stage table with a short note while the directory is empty', () => {
    const directory = buildKnowledgeDirectoryView({
      snapshot: { ...snapshot, documents: [], truncated: false, warnings: [], knowledgeRoot: 'docs/knowledge', projectInstructions: null },
      recordedManifests: [],
    })
    renderView({ directory, documents: [], truncated: false, warnings: [] })

    expect(screen.getByTestId('knowledge-directory-empty')).toHaveTextContent('在 docs/knowledge 下提交 Markdown 规范后')
    expect(screen.queryByTestId('knowledge-stage-budgets')).not.toBeInTheDocument()
    expect(screen.getByTestId('knowledge-checks')).toHaveTextContent('没有发现问题')
  })

  it('reports a clean directory without a warning style', () => {
    const directory = buildKnowledgeDirectoryView({
      snapshot: {
        ...snapshot,
        truncated: false,
        warnings: [],
        knowledgeRoot: 'docs/knowledge',
        projectInstructions: null,
        documents: [{ ...apiDocument, markdown: withFrontMatter('stages: [design]', '# API 健康端点规范') }],
      },
      recordedManifests: [],
    })
    renderView({ directory, truncated: false, warnings: [] })

    const checks = screen.getByTestId('knowledge-checks')
    expect(checks).not.toHaveClass('soft')
    expect(checks).toHaveTextContent('没有发现问题')
    expect(within(checks).queryByTestId('knowledge-check-finding')).not.toBeInTheDocument()
    expect(screen.getByTestId('knowledge-project-instructions')).toHaveTextContent('未找到仓库根目录的 AGENTS.md 或 CLAUDE.md')
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
