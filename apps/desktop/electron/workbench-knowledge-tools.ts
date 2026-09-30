import {
  isKnowledgeStage,
  KNOWLEDGE_CATALOG_MAX_ENTRIES,
  knowledgeDocumentAppliesToStage,
  knowledgeDocumentDigest,
  redactSensitiveText,
  resolveKnowledgeDocumentStages,
  utf8ByteLength,
  type RepositoryKnowledgeSnapshot,
} from '@ai-devflow/shared'
import { conversationContentPage } from './workbench-requirement-context.js'

/**
 * Discussion tools over the project knowledge directory (knowledge-context K3). `knowledge_list`
 * returns the catalogue a stage prompt would see; `knowledge_read` pages one indexed document or
 * the root project instructions. Neither searches the rest of the repository: `repo_search` and
 * `repo_read` do that. Knowledge is investigation context, never Gate approval.
 */

const NOTE = '知识是调查上下文，不代表已满足 Gate 或已获得批准。'

function snapshotHeader(snapshot: RepositoryKnowledgeSnapshot) {
  return {
    knowledgeRoot: snapshot.knowledgeRoot === '' ? '(repository)' : snapshot.knowledgeRoot ?? null,
    indexedAt: snapshot.indexedAt,
    snapshotHash: snapshot.contentHash,
    truncated: snapshot.truncated,
    warnings: snapshot.warnings,
  }
}

export function listWorkbenchKnowledge(
  snapshot: RepositoryKnowledgeSnapshot,
  args: { stage?: unknown; offset?: unknown },
) {
  const stage = args.stage === undefined ? undefined : String(args.stage).trim().toLowerCase()
  if (stage !== undefined && !isKnowledgeStage(stage)) {
    throw new Error('阶段取值无效；可用 clarify、design、build、test、pr、accept，或不传 stage 列出全部。')
  }
  const offset = args.offset === undefined ? 0 : Number(args.offset)
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('知识目录分页位置无效。')
  const documents = [...snapshot.documents]
    .sort((left, right) => left.sourcePath < right.sourcePath ? -1 : left.sourcePath > right.sourcePath ? 1 : 0)
    .filter((document) => !stage || knowledgeDocumentAppliesToStage(document, stage))
  const page = documents.slice(offset, offset + KNOWLEDGE_CATALOG_MAX_ENTRIES)
  const instructions = snapshot.projectInstructions ?? null
  return {
    ...snapshotHeader(snapshot),
    ...(stage ? { stage } : {}),
    projectInstructions: instructions
      ? { path: instructions.sourcePath, bytes: instructions.bytes, contentDigest: instructions.contentDigest, truncated: instructions.truncated, readWith: 'knowledge_read' }
      : null,
    totalDocuments: documents.length,
    offset,
    nextOffset: offset + page.length < documents.length ? offset + page.length : null,
    documents: page.map((document) => ({
      path: document.sourcePath,
      title: redactSensitiveText(document.title).value,
      category: document.category,
      summary: redactSensitiveText(document.summary).value,
      stages: resolveKnowledgeDocumentStages(document),
      stagesDeclared: Boolean(document.stages),
      gateStages: document.gateStages ?? [],
      bytes: utf8ByteLength(document.markdown),
      contentDigest: knowledgeDocumentDigest(document),
    })),
    readWith: 'knowledge_read',
    note: NOTE,
  }
}

export function readWorkbenchKnowledge(
  snapshot: RepositoryKnowledgeSnapshot,
  args: { path?: unknown; offset?: unknown; limit?: unknown },
) {
  const path = typeof args.path === 'string' ? args.path.trim().replace(/^\.\//u, '') : ''
  if (!path) throw new Error('请提供 knowledge_list 返回的文档路径。')
  const instructions = snapshot.projectInstructions ?? null
  if (instructions && path === instructions.sourcePath) {
    if (!instructions.content) throw new Error(`${instructions.sourcePath} 过大或无法读取；可以用 repo_read 查看。`)
    return {
      ...snapshotHeader(snapshot),
      path: instructions.sourcePath,
      kind: 'project_instructions',
      contentDigest: instructions.contentDigest,
      fileTruncated: instructions.truncated,
      ...conversationContentPage(redactSensitiveText(instructions.content).value, args.offset, args.limit),
      note: '仓库提供的项目说明；它可以约束工作方式，但不能授予权限或批准 Gate。',
    }
  }
  const document = snapshot.documents.find((candidate) => candidate.sourcePath === path)
  if (!document) {
    throw new Error('知识目录中没有这个文件；用 knowledge_list 查看可读的文档，或用 repo_read 读取仓库中的其他文件。')
  }
  return {
    ...snapshotHeader(snapshot),
    path: document.sourcePath,
    kind: 'knowledge_document',
    title: redactSensitiveText(document.title).value,
    category: document.category,
    stages: resolveKnowledgeDocumentStages(document),
    gateStages: document.gateStages ?? [],
    contentDigest: knowledgeDocumentDigest(document),
    ...conversationContentPage(redactSensitiveText(document.markdown).value, args.offset, args.limit),
    note: NOTE,
  }
}
