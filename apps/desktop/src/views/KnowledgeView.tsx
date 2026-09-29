import { ArrowLeft, RefreshCw } from 'lucide-react'
import {
  resolveKnowledgeReferenceSemantics,
  type KnowledgeDocument,
  type KnowledgeEntity,
  type KnowledgeReference,
  type KnowledgeRelation,
  type RepositoryKnowledgeWarning,
  type WorkflowRun,
} from '@ai-devflow/shared'
import { matchesQuery, type FieldDataSource, type SupportContext } from '../app/desktop-view-model'

export function KnowledgeView({
  query,
  documents,
  entities,
  relations,
  references,
  selectedRun,
  supportContext,
  focusedDocumentId,
  focusedReferenceId,
  dataSource,
  indexedAt,
  truncated,
  warnings,
  isLoading,
  onRefresh,
  onReturnToInspector,
}: {
  query: string
  documents: KnowledgeDocument[]
  entities: KnowledgeEntity[]
  relations: KnowledgeRelation[]
  references: KnowledgeReference[]
  selectedRun: WorkflowRun | undefined
  supportContext: SupportContext | null
  focusedDocumentId: string | undefined
  focusedReferenceId: string | undefined
  dataSource: FieldDataSource
  indexedAt: string | undefined
  truncated: boolean
  warnings: RepositoryKnowledgeWarning[]
  isLoading: boolean
  onRefresh: () => void
  onReturnToInspector: () => void
}) {
  const maxVisibleEntities = 12
  const maxVisibleRelations = 16
  const documentById = new Map(documents.map((document) => [document.id, document]))
  const entityById = new Map(entities.map((entity) => [entity.id, entity]))
  const visibleDocuments = documents
    .filter((document) =>
      document.id === focusedDocumentId ||
      matchesQuery(query, [
        document.title,
        document.category,
        document.summary,
        document.sourcePath,
        ...document.tags,
      ]),
    )
    .sort((left, right) => Number(right.id === focusedDocumentId) - Number(left.id === focusedDocumentId))
  const directlyMatchedEntityIds = new Set(
    entities
      .filter((entity) => matchesQuery(query, [entity.label, entity.kind, entity.sourcePath]))
      .map((entity) => entity.id),
  )
  const matchedRelations = relations.filter((relation) =>
    matchesQuery(query, [
      relation.label,
      entityById.get(relation.source)?.label,
      entityById.get(relation.target)?.label,
    ]) ||
    directlyMatchedEntityIds.has(relation.source) ||
    directlyMatchedEntityIds.has(relation.target),
  )
  const orderedEntityIds: string[] = []
  const candidateEntityIds = new Set<string>()
  function addEntity(entityId: string) {
    if (!candidateEntityIds.has(entityId) && entityById.has(entityId)) {
      candidateEntityIds.add(entityId)
      orderedEntityIds.push(entityId)
    }
  }
  for (const relation of matchedRelations) {
    addEntity(relation.source)
    addEntity(relation.target)
  }
  for (const entityId of directlyMatchedEntityIds) addEntity(entityId)
  const visibleEntities = orderedEntityIds
    .slice(0, maxVisibleEntities)
    .map((entityId) => entityById.get(entityId)!)
  const visibleEntityIds = new Set(visibleEntities.map((entity) => entity.id))
  const visibleRelations = matchedRelations
    .filter((relation) =>
      visibleEntityIds.has(relation.source) && visibleEntityIds.has(relation.target),
    )
    .slice(0, maxVisibleRelations)
  const graphSelectionTruncated =
    orderedEntityIds.length > visibleEntities.length || matchedRelations.length > visibleRelations.length

  return (
    <section className="page-grid" data-testid="knowledge-view">
      <div className="page-main">
        <div className="section-heading">
          <span>Knowledge Governance</span>
          <strong>Git Markdown Index</strong>
          <span className={`pill ${dataSource.tone}`} data-testid="knowledge-data-source" title={dataSource.detail}>
            {dataSource.label}
          </span>
        </div>
        <p className="empty-note knowledge-source-note">{dataSource.status} · {dataSource.detail}</p>
        <div className="compact-row" data-testid="knowledge-index-metadata">
          <span>{indexedAt ? `indexed ${indexedAt}` : isLoading ? 'indexing repository knowledge' : 'not indexed'}</span>
          <button
            aria-label="刷新仓库知识"
            className="ghost-button"
            disabled={isLoading}
            onClick={onRefresh}
            type="button"
          >
            <RefreshCw size={16} />
            {isLoading ? '索引中' : '刷新索引'}
          </button>
        </div>
        {truncated || warnings.length > 0 ? (
          <div className="mini-card soft" data-testid="knowledge-index-warnings">
            <strong>{truncated ? '索引结果已截断' : '索引警告'}</strong>
            {warnings.map((warning) => <code key={warning}>{warning}</code>)}
          </div>
        ) : null}
        {supportContext?.focusTarget === 'knowledge-reference' ? (
          <div className="support-context-banner" data-testid="support-context-banner">
            <div>
              <span className="panel-label">来自 Workbench Inspector</span>
              <strong>{supportContext.label}</strong>
              <p>查看引用来源后可返回当前 Run / Node，继续处理 Gate 条件。</p>
            </div>
            <button className="ghost-button" type="button" onClick={onReturnToInspector}>
              <ArrowLeft size={16} />
              返回当前 Inspector
            </button>
          </div>
        ) : null}
        {visibleDocuments.length === 0 ? (
          <p className="empty-note">没有匹配的知识文档</p>
        ) : (
          <div className="knowledge-doc-list">
            {visibleDocuments.map((document) => (
              <article
                className={`knowledge-doc-card ${document.id === focusedDocumentId ? 'is-focused' : ''}`}
                data-testid={document.id === focusedDocumentId ? 'focused-knowledge-document' : undefined}
                key={document.id}
              >
                <div>
                  <span>{document.category}</span>
                  <strong>{document.title}</strong>
                </div>
                <p>{document.summary}</p>
                <code>{document.sourcePath}</code>
                <div className="tag-list">
                  {document.tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}

        <div className="section-heading section-heading--inline">
          <span>Knowledge Graph</span>
          <strong>轻量知识图谱</strong>
        </div>
        <div className="knowledge-map">
          {visibleEntities.length === 0 ? (
            <p className="empty-note">没有匹配的知识节点</p>
          ) : (
            visibleEntities.map((entity) => (
              <div
                key={entity.id}
                className={`knowledge-node knowledge-node--${entity.kind}`}
                data-testid="knowledge-graph-node"
              >
                <strong>{entity.label}</strong>
                <span>{entity.kind}</span>
              </div>
            ))
          )}
          {visibleRelations.map((relation) => (
            <div className="relation-row" data-testid="knowledge-graph-relation" key={relation.id}>
              {entityById.get(relation.source)?.label ?? relation.source} {relation.label}{' '}
              {entityById.get(relation.target)?.label ?? relation.target}
            </div>
          ))}
          {graphSelectionTruncated ? (
            <p className="empty-note knowledge-graph-limit-note">
              图谱较大，当前显示与搜索最相关的 {visibleEntities.length} 个节点。
            </p>
          ) : null}
        </div>
      </div>
      <aside className="page-side">
        <strong>Git + Markdown 真源</strong>
        <p>知识库保留在项目仓库，平台只负责索引、图谱、检索和 Run 证据回链。</p>
        <strong>Run references</strong>
        <p>{selectedRun?.title ?? 'No selected Run'}</p>
        {references.length === 0 ? (
          <p className="empty-note">当前 Run 尚未匹配到知识引用。</p>
        ) : (
          references.slice(0, 8).map((reference) => {
            const document = documentById.get(reference.documentId)
            const semantics = resolveKnowledgeReferenceSemantics(reference)

            return (
              <article
                className={`reference-row ${reference.id === focusedReferenceId ? 'is-focused' : ''}`}
                data-testid={reference.id === focusedReferenceId
                  ? 'focused-knowledge-reference'
                  : 'knowledge-run-reference'}
                key={reference.id}
              >
                <span>{reference.targetType}</span>
                <strong>{reference.relation}</strong>
                <p>{document?.title ?? reference.documentId}</p>
                <div className="knowledge-reference-meta">
                  {reference.strategy ? <span>检索策略：{reference.strategy}</span> : null}
                  {semantics.lexicalMatch ? (
                    <span title="原始关键词累加分；无固定满分，不能跨查询比较。">
                      关键词匹配分 {semantics.lexicalMatch.rawScore}
                    </span>
                  ) : null}
                  {semantics.lexicalMatch?.matchedTerms.length ? (
                    <span>命中词：{semantics.lexicalMatch.matchedTerms.join('、')}</span>
                  ) : null}
                  {semantics.semanticRelevance ? (
                    <span>语义相关性：{semantics.semanticRelevance.score}</span>
                  ) : (
                    <span>未进行语义相关性判断</span>
                  )}
                  <span>Gate 状态：{semantics.gateEvidence.status}</span>
                  {reference.headingPath ? <span>{reference.headingPath.join(' / ')}</span> : null}
                </div>
                <code>{reference.artifactId ?? reference.evidenceId ?? reference.nodeId ?? reference.runId}</code>
                {reference.sourcePath ?? document?.sourcePath ? (
                  <code>{reference.sourcePath ?? document?.sourcePath}</code>
                ) : null}
                {reference.contentHash ? <code>{reference.contentHash}</code> : null}
              </article>
            )
          })
        )}
      </aside>
    </section>
  )
}
