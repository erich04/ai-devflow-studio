import { useEffect, useRef, type ReactNode } from 'react'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import type {
  Artifact,
  KnowledgeDocument,
  KnowledgeEntity,
  KnowledgeReference,
  KnowledgeRelation,
  RepositoryKnowledgeWarning,
  WorkflowRun,
} from '@ai-devflow/shared'
import { matchesQuery, type FieldDataSource, type SupportContext } from '../app/desktop-view-model'
import {
  groupKnowledgeReferences,
  type KnowledgeCitation,
  type KnowledgeReferenceGroup,
} from '../app/knowledge-reference-groups'
import {
  describeKnowledgeIndex,
  knowledgeCategoryLabel,
  knowledgeEntityKindLabel,
  knowledgeIndexWarningLabel,
  knowledgeRelationLabel,
  type RawDetail,
} from '../app/knowledge-view-copy'

function RawDetails({ details, testId }: { details: RawDetail[]; testId?: string }) {
  return (
    <details className="gate-technical-details" data-testid={testId}>
      <summary>详情</summary>
      <div className="knowledge-reference-meta">
        {details.map((detail) => (
          <code key={`${detail.label}:${detail.value}`}>{detail.label}：{detail.value}</code>
        ))}
      </div>
    </details>
  )
}

export function KnowledgeView({
  query,
  documents,
  entities,
  relations,
  references,
  selectedRun,
  artifacts,
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
  memoryPanel,
}: {
  query: string
  documents: KnowledgeDocument[]
  entities: KnowledgeEntity[]
  relations: KnowledgeRelation[]
  references: KnowledgeReference[]
  selectedRun: WorkflowRun | undefined
  /** Optional: gives citing materials their titles and revisions; without it they read “未加载的材料”. */
  artifacts?: readonly Artifact[] | undefined
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
  /** Rendered under 「记忆管理」 near the end of the page (plan §4.1). */
  memoryPanel?: ReactNode
}) {
  const maxVisibleEntities = 12
  const maxVisibleRelations = 16
  const entityById = new Map(entities.map((entity) => [entity.id, entity]))
  const groups = groupKnowledgeReferences({ references, documents, run: selectedRun, artifacts })
  const groupByDocumentId = new Map(groups.map((group) => [group.documentId, group]))
  const focusedGroupDocumentId = focusedReferenceId
    ? groups.find((group) => group.citations.some((citation) => citation.referenceId === focusedReferenceId))?.documentId
    : undefined
  const focusDocumentId = focusedDocumentId ?? focusedGroupDocumentId
  const isFocusDocument = (documentId: string) =>
    documentId === focusDocumentId || documentId === focusedGroupDocumentId
  const visibleDocuments = documents
    .filter((document) =>
      isFocusDocument(document.id) ||
      matchesQuery(query, [
        document.title,
        document.category,
        document.summary,
        document.sourcePath,
        ...document.tags,
      ]),
    )
    .sort((left, right) => Number(isFocusDocument(right.id)) - Number(isFocusDocument(left.id)))
  // Cited documents that are not in the current index still appear once, after the indexed ones.
  const unindexedGroups = groups.filter((group) =>
    !group.document && (
      isFocusDocument(group.documentId) ||
      matchesQuery(query, [group.documentId, ...group.citations.map((citation) => citation.placeTitle)])
    ))
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
  const indexCopy = describeKnowledgeIndex({ dataSource, documentCount: documents.length, indexedAt, isLoading })
  const citedPlaceCount = groups.reduce((sum, group) => sum + group.citations.length, 0)

  // Support context from the task page: the cited place is highlighted and scrolled into view.
  const focusedReferenceRef = useRef<HTMLElement | null>(null)
  const focusedDocumentRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const target = focusedReferenceRef.current ?? focusedDocumentRef.current
    target?.scrollIntoView?.({ block: 'nearest' })
  }, [focusedReferenceId, focusDocumentId, focusedGroupDocumentId])

  const renderCitation = (citation: KnowledgeCitation) => {
    const isFocused = citation.referenceId === focusedReferenceId
    return (
      <article
        className={`reference-row ${isFocused ? 'is-focused' : ''}`}
        data-testid={isFocused ? 'focused-knowledge-reference' : 'knowledge-run-reference'}
        key={citation.referenceId}
        ref={isFocused ? focusedReferenceRef : undefined}
      >
        <span>{citation.placeKindLabel}</span>
        <strong>{citation.placeTitle}</strong>
        {citation.contextLabel || citation.otherTaskLabel ? (
          <p>{[citation.otherTaskLabel, citation.contextLabel].filter(Boolean).join(' · ')}</p>
        ) : null}
        <div className="knowledge-reference-meta">
          <span>{citation.relationLabel}</span>
          <span>{citation.reviewStatusLabel}</span>
          {citation.retrievalLabel ? <span>{citation.retrievalLabel}</span> : null}
          {citation.sectionLabel ? <span>章节：{citation.sectionLabel}</span> : null}
          <span>{citation.versionLabel}</span>
          {citation.materialVersionLabel ? <span>{citation.materialVersionLabel}</span> : null}
        </div>
        <RawDetails details={citation.details} />
      </article>
    )
  }

  const renderCitations = (group: KnowledgeReferenceGroup | undefined) =>
    group ? (
      <section className="stack" aria-label={`引用「${group.title}」的位置`} data-testid="knowledge-citation-list">
        <strong>当前任务中有 {group.citations.length} 处引用</strong>
        {group.citations.map(renderCitation)}
      </section>
    ) : null

  const bannerLabel = supportContext?.label ?? ''
  const bannerSource = supportContext?.label.startsWith('搜索结果') ? '来自搜索结果' : '来自任务'

  return (
    <section className="page-grid" data-testid="knowledge-view">
      <div className="page-main">
        <div className="section-heading">
          <span>知识治理</span>
          <strong>仓库 Markdown 索引</strong>
          <span
            className={`pill ${dataSource.tone}`}
            data-testid="knowledge-data-source"
            title={`${dataSource.label} · ${dataSource.detail}`}
          >
            {indexCopy.badge}
          </span>
        </div>
        <p className="empty-note knowledge-source-note">{indexCopy.note}</p>
        <div className="compact-row" data-testid="knowledge-index-metadata">
          <span title={indexedAt}>{indexCopy.indexedAtLabel}</span>
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
        <RawDetails details={indexCopy.details} testId="knowledge-index-details" />
        {truncated || warnings.length > 0 ? (
          <div className="mini-card soft" data-testid="knowledge-index-warnings">
            <strong>{truncated ? '索引结果已截断' : '索引警告'}</strong>
            {warnings.map((warning) => (
              <span key={warning} title={warning}>{knowledgeIndexWarningLabel(warning)}</span>
            ))}
            {warnings.length > 0 ? (
              <RawDetails details={warnings.map((warning) => ({ label: '警告代码', value: warning }))} />
            ) : null}
          </div>
        ) : null}
        {supportContext?.focusTarget === 'knowledge-reference' ? (
          <div className="support-context-banner" data-testid="support-context-banner">
            <div>
              <span className="panel-label">{bannerSource}</span>
              <strong>{bannerLabel}</strong>
              <p>查看引用来源后可以返回任务，继续处理当前步骤；返回不会改变任务进度。</p>
            </div>
            <button className="ghost-button" type="button" onClick={onReturnToInspector}>
              <ArrowLeft size={16} />
              返回任务
            </button>
          </div>
        ) : null}
        {visibleDocuments.length === 0 && unindexedGroups.length === 0 ? (
          <p className="empty-note">没有匹配的知识文档</p>
        ) : (
          <div className="knowledge-doc-list">
            {visibleDocuments.map((document) => (
              <article
                className={`knowledge-doc-card ${isFocusDocument(document.id) ? 'is-focused' : ''}`}
                data-testid={isFocusDocument(document.id) ? 'focused-knowledge-document' : 'knowledge-document'}
                key={document.id}
                ref={document.id === focusDocumentId ? focusedDocumentRef : undefined}
              >
                <div>
                  <span title={document.category}>{knowledgeCategoryLabel(document.category)}</span>
                  <strong>{document.title}</strong>
                </div>
                <p>{document.summary}</p>
                <code>{document.sourcePath}</code>
                <div className="tag-list">
                  {document.tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
                {renderCitations(groupByDocumentId.get(document.id))}
              </article>
            ))}
            {unindexedGroups.map((group) => (
              <article
                className={`knowledge-doc-card ${isFocusDocument(group.documentId) ? 'is-focused' : ''}`}
                data-testid={isFocusDocument(group.documentId) ? 'focused-knowledge-document' : 'knowledge-document'}
                key={group.documentId}
                ref={group.documentId === focusDocumentId ? focusedDocumentRef : undefined}
              >
                <div>
                  <span>未索引</span>
                  <strong>{group.title}</strong>
                </div>
                <p>引用记录仍然保留；刷新索引后如果文档仍存在，会显示完整信息。</p>
                {renderCitations(group)}
              </article>
            ))}
          </div>
        )}

        <div className="section-heading section-heading--inline">
          <span>知识图谱</span>
          <strong>文档中的概念与关系</strong>
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
                <span title={entity.kind}>{knowledgeEntityKindLabel(entity.kind)}</span>
              </div>
            ))
          )}
          {visibleRelations.map((relation) => (
            <div className="relation-row" data-testid="knowledge-graph-relation" key={relation.id}>
              {entityById.get(relation.source)?.label ?? relation.source}{' '}
              <span title={relation.label}>{knowledgeRelationLabel(relation.label)}</span>{' '}
              {entityById.get(relation.target)?.label ?? relation.target}
            </div>
          ))}
          {graphSelectionTruncated ? (
            <p className="empty-note knowledge-graph-limit-note">
              图谱较大，当前显示与搜索最相关的 {visibleEntities.length} 个节点。
            </p>
          ) : null}
        </div>

        {memoryPanel ? (
          <section aria-labelledby="knowledge-memory-heading" data-testid="knowledge-memory-section">
            <div className="section-heading section-heading--inline">
              <span>记忆</span>
              <strong id="knowledge-memory-heading">记忆管理</strong>
            </div>
            {memoryPanel}
          </section>
        ) : null}
      </div>
      <aside className="page-side">
        <strong>知识来源</strong>
        <p>知识文档保存在项目仓库的 Git Markdown 中；这里只负责索引、图谱和检索，并列出引用它们的任务位置。</p>
        <strong>当前任务的引用</strong>
        <p>{selectedRun?.title ?? '尚未选择任务'}</p>
        {references.length === 0 ? (
          <p className="empty-note">当前任务尚未匹配到知识引用。</p>
        ) : (
          <p className="empty-note" data-testid="knowledge-reference-summary">
            {groups.length} 份文档被引用 {citedPlaceCount} 处，引用位置列在各文档下方。
          </p>
        )}
      </aside>
    </section>
  )
}
