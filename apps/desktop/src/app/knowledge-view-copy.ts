import type {
  KnowledgeEntity,
  KnowledgeRelation,
  RepositoryKnowledgeWarning,
} from '@ai-devflow/shared'
import { formatLocalTime, type FieldDataSource } from './desktop-view-model'

/**
 * First-layer Chinese copy for the knowledge page (plan §6.3, T1/T2). Stored values never change;
 * callers keep the raw value in a title attribute or a 详情 disclosure.
 */

export type RawDetail = { label: string; value: string }

const knowledgeCategoryLabels: Record<string, string> = {
  development_standard: '开发规范',
  testing_standard: '测试规范',
  review_checklist: '审查清单',
  adr: '架构决策记录',
  api_contract: '接口契约',
  onboarding: '上手指南',
  skill_rule: 'Skill 规则',
  mcp_rule: 'MCP 规则',
}

/** Undefined when the category is not a known knowledge document category. */
export function knownKnowledgeCategoryLabel(category: string | undefined): string | undefined {
  return category ? knowledgeCategoryLabels[category] : undefined
}

export function knowledgeCategoryLabel(category: string): string {
  return knowledgeCategoryLabels[category] ?? '其他文档'
}

const entityKindLabels: Record<KnowledgeEntity['kind'], string> = {
  system: '系统',
  module: '模块',
  standard: '规范',
  term: '术语',
  decision: '决策',
  template: '模板',
  skill: 'Skill',
  owner: '负责人',
}

export function knowledgeEntityKindLabel(kind: string): string {
  return entityKindLabels[kind as KnowledgeEntity['kind']] ?? '其他'
}

const relationLabels: Record<KnowledgeRelation['label'], string> = {
  depends_on: '依赖',
  owned_by: '归属于',
  uses: '使用',
  defines: '定义',
  tests: '测试',
  approves: '审批',
}

export function knowledgeRelationLabel(label: string): string {
  return relationLabels[label as KnowledgeRelation['label']] ?? '关联'
}

const warningLabels: Record<RepositoryKnowledgeWarning, string> = {
  unsafe_path_skipped: '跳过了不安全的路径',
  path_limit_exceeded: '路径数量超出上限',
  depth_limit_exceeded: '目录层级超出上限',
  file_count_limit_exceeded: '文件数量超出上限',
  file_size_limit_exceeded: '有文件超出单个文件大小上限',
  total_size_limit_exceeded: '文档总大小超出上限',
  character_limit_exceeded: '字符数超出上限',
  chunk_limit_exceeded: '分段数量超出上限',
  metadata_limit_exceeded: '元数据超出上限',
}

export function knowledgeIndexWarningLabel(warning: string): string {
  return warningLabels[warning as RepositoryKnowledgeWarning] ?? '索引警告待核实'
}

export type KnowledgeIndexCopy = {
  /** Badge text; replaces labels such as `indexed · truncated`. */
  badge: string
  /** One sentence under the heading; replaces the English data-source detail. */
  note: string
  /** “更新于 YYYY-MM-DD HH:mm”, or the loading / not-indexed state. */
  indexedAtLabel: string
  /** Raw data-source status, label, detail and ISO time for 详情. */
  details: RawDetail[]
}

/**
 * Maps the labels produced by `buildKnowledgeDataSource` (desktop-view-model.ts). An unknown label
 * is shown as “待核实” rather than as an English token; the raw value stays in the details.
 */
export function describeKnowledgeIndex(input: {
  dataSource: FieldDataSource
  documentCount: number
  indexedAt: string | undefined
  isLoading: boolean
}): KnowledgeIndexCopy {
  const { dataSource, documentCount } = input
  const copyByLabel: Record<string, { badge: string; note: string }> = {
    indexing: { badge: '正在索引', note: '正在读取所选仓库中由 Git 跟踪的 Markdown 文档。' },
    indexed: { badge: '知识索引已更新', note: `已索引 ${documentCount} 份 Git Markdown 文档。` },
    'indexed · truncated': {
      badge: '知识索引已更新 · 结果不完整',
      note: `已索引 ${documentCount} 份文档；部分内容超出上限，没有进入索引。`,
    },
    'indexed · no documents': {
      badge: '知识索引已更新 · 没有文档',
      note: '所选仓库中没有可索引的 Markdown 文档。',
    },
    'indexed · refresh failed': {
      badge: '刷新失败 · 显示上次结果',
      note: '最近一次刷新失败，当前显示上次成功的索引。',
    },
    'index unavailable': { badge: '知识索引不可用', note: '无法为所选本地项目建立知识索引。' },
    'not indexed': { badge: '尚未建立知识索引', note: '尚未为所选本地项目建立知识索引。' },
  }
  const copy = copyByLabel[dataSource.label] ?? { badge: '索引状态待核实', note: '索引状态待核实。' }
  const indexedAtLabel = input.indexedAt
    ? `更新于 ${formatLocalTime(input.indexedAt)}`
    : input.isLoading
      ? '正在索引仓库知识'
      : '尚未索引'
  const details: RawDetail[] = [
    { label: '数据来源', value: `${dataSource.status} · ${dataSource.label}` },
    { label: '说明', value: dataSource.detail },
    ...(input.indexedAt ? [{ label: '索引时间', value: input.indexedAt }] : []),
    { label: '文档数量', value: String(documentCount) },
    { label: '提示', value: '索引完成不代表内容已审查。' },
  ]

  return { ...copy, indexedAtLabel, details }
}
