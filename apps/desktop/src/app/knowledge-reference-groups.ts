import {
  resolveKnowledgeReferenceSemantics,
  type Artifact,
  type KnowledgeDocument,
  type KnowledgeGateEvidenceStatus,
  type KnowledgeReference,
  type KnowledgeReferenceRelation,
  type KnowledgeReferenceTargetType,
  type KnowledgeRetrievalStrategy,
  type WorkflowRun,
} from '@ai-devflow/shared'
import { displayNodeTitle } from './node-inspector-view-model'
import type { RawDetail } from './knowledge-view-copy'

/**
 * Knowledge references grouped by document (plan Y8, T3). Presentation only: every stored field
 * stays on the reference; identifiers such as `kh-…` hashes, retrieval ids and run ids move to
 * `details`, and the first-layer labels are Chinese (plan §6.3).
 */

export type KnowledgeCitationPlaceKind = 'task' | 'step' | 'material' | 'test_evidence' | 'gate'

export type KnowledgeCitation = {
  referenceId: string
  placeKind: KnowledgeCitationPlaceKind
  /** 开发任务 / 步骤 / 材料 / 测试证据 / Gate */
  placeKindLabel: string
  /** Task, step, material or Gate title; never an identifier. */
  placeTitle: string
  /** “步骤：…” for materials; omitted when the place already is the step or the task. */
  contextLabel?: string
  /** Set when the citation belongs to a task other than the selected one. */
  otherTaskLabel?: string
  /** 章节路径, e.g. “API 健康端点规范 / 响应格式”. */
  sectionLabel?: string
  /** Knowledge content version without the hash (the hash is in `details`). */
  versionLabel: string
  /** “材料 v2” when the cited material records a revision. */
  materialVersionLabel?: string
  /** 审查依据 / 引用 / 已满足此规范 / 与此规范冲突 */
  relationLabel: string
  isReviewBasis: boolean
  /** Review status of the reference itself (not a Gate conclusion). */
  reviewStatusLabel: string
  /** 关键词检索 / 语义检索 / …; the score and matched terms are in `details`. */
  retrievalLabel?: string
  details: RawDetail[]
}

export type KnowledgeReferenceGroup = {
  documentId: string
  document: KnowledgeDocument | undefined
  /** Document title, or a placeholder when the document is not in the current index. */
  title: string
  citations: KnowledgeCitation[]
}

const placeKindByTarget: Record<KnowledgeReferenceTargetType, KnowledgeCitationPlaceKind> = {
  run: 'task',
  node: 'step',
  artifact: 'material',
  test_evidence: 'test_evidence',
  gate_decision: 'gate',
}

const placeKindLabels: Record<KnowledgeCitationPlaceKind, string> = {
  task: '开发任务',
  step: '步骤',
  material: '材料',
  test_evidence: '测试证据',
  gate: 'Gate',
}

const relationLabels: Record<KnowledgeReferenceRelation, string> = {
  cites: '引用',
  requires_evidence: '审查依据',
  satisfies: '已满足此规范',
  violates: '与此规范冲突',
}

/** User-facing name of a reference relation; the stored value stays in the technical details. */
export function knowledgeReferenceRelationLabel(relation: string): string {
  return relationLabels[relation as KnowledgeReferenceRelation] ?? '关系待核实'
}

const reviewStatusLabels: Record<KnowledgeGateEvidenceStatus, string> = {
  retrieval_candidate: '检索候选，尚未经审查确认',
  reviewed_reference: '已经审查确认',
  supports_finding: '支持审查结论',
  rejected: '审查未采用',
}

const retrievalLabels: Record<KnowledgeRetrievalStrategy, string> = {
  lexical: '关键词检索',
  heuristic: '启发式检索',
  vector: '语义检索',
  hybrid: '混合检索',
  stage: '按阶段适用',
}

type CitableArtifact = Pick<Artifact, 'id' | 'title' | 'nodeId'> & Partial<Pick<Artifact, 'clarificationRevision'>>

function sectionKey(reference: KnowledgeReference): string {
  return reference.chunkId ?? reference.headingPath?.join('\u0000') ?? ''
}

/**
 * Content versions are numbered per section: two citations of different sections of one
 * unchanged document are not two versions. With one recorded hash per section the label only
 * says a version was recorded; the hash itself is in the details.
 */
function versionLabels(references: readonly KnowledgeReference[]): Map<string, string> {
  const hashesBySection = new Map<string, string[]>()
  for (const reference of references) {
    if (!reference.contentHash) continue
    const key = sectionKey(reference)
    const hashes = hashesBySection.get(key) ?? []
    if (!hashes.includes(reference.contentHash)) hashes.push(reference.contentHash)
    hashesBySection.set(key, hashes)
  }
  const labels = new Map<string, string>()
  for (const reference of references) {
    if (!reference.contentHash) {
      labels.set(reference.id, '未记录内容版本')
      continue
    }
    const hashes = hashesBySection.get(sectionKey(reference)) ?? []
    labels.set(
      reference.id,
      hashes.length > 1
        ? `内容版本 ${hashes.indexOf(reference.contentHash) + 1}/${hashes.length}`
        : '内容版本已记录',
    )
  }
  return labels
}

function buildCitation(input: {
  reference: KnowledgeReference
  document: KnowledgeDocument | undefined
  run: WorkflowRun | undefined
  artifactById: ReadonlyMap<string, CitableArtifact>
  versionLabel: string
}): KnowledgeCitation {
  const { reference, document, run } = input
  const semantics = resolveKnowledgeReferenceSemantics(reference)
  const placeKind = placeKindByTarget[reference.targetType] ?? 'task'
  const sameRun = Boolean(run && run.id === reference.runId)
  const taskTitle = sameRun && run ? run.title : '其他开发任务'
  const node = sameRun && reference.nodeId ? run?.nodes.find((candidate) => candidate.id === reference.nodeId) : undefined
  const stepTitle = node ? displayNodeTitle(node) : reference.nodeId ? '未找到的步骤' : undefined
  const artifact = reference.artifactId ? input.artifactById.get(reference.artifactId) : undefined

  const placeTitle = (() => {
    switch (placeKind) {
      case 'task':
        return taskTitle
      case 'material':
        return artifact?.title ?? '未加载的材料'
      case 'step':
      case 'gate':
      case 'test_evidence':
        return stepTitle ?? '未找到的步骤'
    }
  })()
  const contextLabel = placeKind === 'material' && stepTitle ? `步骤：${stepTitle}` : undefined
  const revision = artifact?.clarificationRevision?.revision
  const strategy = reference.strategy
  const lexical = semantics.lexicalMatch

  const details: RawDetail[] = [
    { label: '引用原因', value: reference.reason },
    ...((reference.sourcePath ?? document?.sourcePath)
      ? [{ label: '来源路径', value: (reference.sourcePath ?? document?.sourcePath)! }]
      : []),
    ...(reference.chunkId ? [{ label: '分段标识', value: reference.chunkId }] : []),
    ...(reference.contentHash ? [{ label: '内容哈希', value: reference.contentHash }] : []),
    ...(strategy ? [{ label: '检索方法', value: strategy }] : []),
    ...(lexical
      ? [{
          label: '关键词匹配分',
          value: `${lexical.rawScore}（原始累加分，没有固定满分，不能跨查询比较）`,
        }]
      : []),
    ...(lexical?.matchedTerms.length ? [{ label: '命中词', value: lexical.matchedTerms.join('、') }] : []),
    {
      label: '语义相关性',
      value: semantics.semanticRelevance ? String(semantics.semanticRelevance.score) : '未进行语义相关性判断',
    },
    {
      label: '审查状态',
      value: `${semantics.gateEvidence.status}（这是引用的审查状态，不是 Gate 结论）`,
    },
    ...(semantics.gateEvidence.reviewId ? [{ label: '审查记录', value: semantics.gateEvidence.reviewId }] : []),
    { label: '引用关系', value: reference.relation },
    { label: '引用对象类型', value: reference.targetType },
    { label: '引用标识', value: reference.id },
    { label: '任务标识', value: reference.runId },
    ...(reference.nodeId ? [{ label: '步骤标识', value: reference.nodeId }] : []),
    ...(reference.artifactId ? [{ label: '材料标识', value: reference.artifactId }] : []),
    ...(reference.evidenceId ? [{ label: '证据标识', value: reference.evidenceId }] : []),
    { label: '文档标识', value: reference.documentId },
  ]

  return {
    referenceId: reference.id,
    placeKind,
    placeKindLabel: placeKindLabels[placeKind],
    placeTitle,
    ...(contextLabel ? { contextLabel } : {}),
    ...(!sameRun ? { otherTaskLabel: '来自其他开发任务' } : {}),
    ...(reference.headingPath?.length ? { sectionLabel: reference.headingPath.join(' / ') } : {}),
    versionLabel: input.versionLabel,
    ...(typeof revision === 'number' ? { materialVersionLabel: `材料 v${revision}` } : {}),
    relationLabel: relationLabels[reference.relation] ?? '关系待核实',
    isReviewBasis: reference.relation === 'requires_evidence',
    reviewStatusLabel: reviewStatusLabels[semantics.gateEvidence.status] ?? '审查状态待核实',
    ...(strategy ? { retrievalLabel: retrievalLabels[strategy] ?? '检索方法待核实' } : {}),
    details,
  }
}

/**
 * One group per cited document, in order of the document's first citation; citations keep the
 * order of `references`. Documents missing from the index still get a group, titled as such.
 */
export function groupKnowledgeReferences(input: {
  references: readonly KnowledgeReference[]
  documents: readonly KnowledgeDocument[]
  run: WorkflowRun | undefined
  artifacts?: readonly CitableArtifact[] | undefined
}): KnowledgeReferenceGroup[] {
  const documentById = new Map(input.documents.map((document) => [document.id, document]))
  const artifactById = new Map((input.artifacts ?? []).map((artifact) => [artifact.id, artifact]))
  const referencesByDocument = new Map<string, KnowledgeReference[]>()
  for (const reference of input.references) {
    const list = referencesByDocument.get(reference.documentId)
    if (list) list.push(reference)
    else referencesByDocument.set(reference.documentId, [reference])
  }

  return [...referencesByDocument].map(([documentId, references]) => {
    const document = documentById.get(documentId)
    const versions = versionLabels(references)
    return {
      documentId,
      document,
      title: document?.title ?? '当前索引中没有这份文档',
      citations: references.map((reference) =>
        buildCitation({
          reference,
          document,
          run: input.run,
          artifactById,
          versionLabel: versions.get(reference.id) ?? '未记录内容版本',
        }),
      ),
    }
  })
}
