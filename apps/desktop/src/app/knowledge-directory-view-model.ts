import {
  checkKnowledgeDirectory,
  KNOWLEDGE_STAGES,
  PROJECT_INSTRUCTIONS_MAX_BYTES,
  resolveKnowledgeDocumentStages,
  type AgentTrace,
  type CodingAgentRun,
  type KnowledgeCheckFinding,
  type KnowledgeDocument,
  type NodeStage,
  type RecordedKnowledgeContextManifest,
  type RepositoryKnowledgeSnapshot,
} from '@ai-devflow/shared'
import { formatLocalTime } from './desktop-view-model'
import type { RawDetail } from './knowledge-view-copy'
import { stageLabels } from './node-inspector-view-model'

/**
 * Knowledge page: the knowledge directory as the stage prompts use it and the deterministic
 * checks (knowledge-context plan §4.2, K4). Checks only inform; nothing here blocks a step.
 */

export type KnowledgeDirectoryStageRow = {
  stage: NodeStage
  label: string
  documentCount: number
  gateCount: number
  usageLabel: string
  overBudgetCount: number
}

export type KnowledgeDirectoryFindingRow = {
  id: string
  code: KnowledgeCheckFinding['code']
  kindLabel: string
  location: string
  message: string
  details: RawDetail[]
}

export type KnowledgeDocumentStageCopy = {
  stagesLabel: string
  gateLabel: string
}

export type KnowledgeDirectoryView = {
  rootLabel: string
  documentCount: number
  budgetLabel: string
  instructions: { label: string; tone: 'good' | 'warn' | 'soft'; details: RawDetail[] }
  stages: KnowledgeDirectoryStageRow[]
  findings: KnowledgeDirectoryFindingRow[]
  summary: string
  notes: string[]
  /** Keyed by document id. */
  documentStages: Record<string, KnowledgeDocumentStageCopy>
}

export function formatKnowledgeBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1).replace(/\.0$/u, '')} KiB`
}

function stageList(stages: readonly NodeStage[]): string {
  return stages.map((stage) => stageLabels[stage]).join('、')
}

export function describeKnowledgeDocumentStages(
  document: Pick<KnowledgeDocument, 'stages' | 'gateStages' | 'category'>,
): KnowledgeDocumentStageCopy {
  const stages = resolveKnowledgeDocumentStages(document)
  const stagesLabel = stages.length === 0
    ? '不注入任何阶段'
    : document.stages
      ? `适用阶段：${stageList(stages)}`
      : `适用阶段：${stageList(stages)}（未声明，按分类推定）`
  const gateStages = document.gateStages ?? []
  return {
    stagesLabel,
    gateLabel: gateStages.length ? `Gate 依据：${stageList(gateStages)}` : '不作为 Gate 依据',
  }
}

const validStageValues = KNOWLEDGE_STAGES.join('、')

function describeFinding(finding: KnowledgeCheckFinding, index: number): KnowledgeDirectoryFindingRow {
  const base = { id: `${finding.code}-${index}`, code: finding.code }
  switch (finding.code) {
    case 'missing_front_matter':
      return {
        ...base,
        kindLabel: '缺少 front matter',
        location: finding.sourcePath,
        message: finding.reason === 'missing'
          ? '文件开头没有 front matter：适用阶段按分类推定，也不会作为 Gate 依据。'
          : 'front matter 缺少结束的 --- 行，整段按正文处理。',
        details: [{ label: '检查代码', value: `${finding.code}:${finding.reason}` }],
      }
    case 'invalid_stage_value':
      return {
        ...base,
        kindLabel: '阶段取值无效',
        location: finding.sourcePath,
        message: finding.field === 'stages'
          ? `stages 中的 ${finding.values.join('、')} 不是有效阶段，已被忽略。有效取值：${validStageValues}。`
          : `gate 只接受 true、false 或阶段列表，${finding.values.join('、')} 已被忽略。`,
        details: [{ label: '检查代码', value: `${finding.code}:${finding.field}` }],
      }
    case 'broken_link':
      return {
        ...base,
        kindLabel: '断链',
        location: `${finding.sourcePath} 第 ${finding.line} 行`,
        message: finding.reason === 'missing'
          ? `链接目标 ${finding.target} 不存在。`
          : `链接目标 ${finding.target} 指向仓库之外。`,
        details: [{ label: '检查代码', value: `${finding.code}:${finding.reason}` }],
      }
    case 'broken_anchor':
      return {
        ...base,
        kindLabel: '锚点失效',
        location: `${finding.sourcePath} 第 ${finding.line} 行`,
        message: `链接 ${finding.target} 指向的锚点「${finding.anchor}」不存在。`,
        details: [{ label: '检查代码', value: finding.code }],
      }
    case 'stage_over_budget':
      return {
        ...base,
        kindLabel: '超出预算',
        location: `${stageLabels[finding.stage]}阶段`,
        message: `适用文档共 ${formatKnowledgeBytes(finding.requiredBytes)}，超过每个阶段 ${formatKnowledgeBytes(finding.budgetBytes)} 的上限；${finding.sourcePaths.length} 份只列入目录：${finding.sourcePaths.join('、')}。`,
        details: [
          { label: '检查代码', value: `${finding.code}:${finding.stage}` },
          { label: '字节数', value: `${finding.requiredBytes} / ${finding.budgetBytes}` },
        ],
      }
    case 'instructions_truncated':
      return {
        ...base,
        kindLabel: '超出预算',
        location: finding.sourcePath,
        message: `项目说明有 ${formatKnowledgeBytes(finding.bytes)}，超过 ${formatKnowledgeBytes(finding.maxBytes)} 的上限，超出部分不会进入模型调用。`,
        details: [
          { label: '检查代码', value: finding.code },
          { label: '字节数', value: `${finding.bytes} / ${finding.maxBytes}` },
        ],
      }
    case 'manifest_file_missing':
      return {
        ...base,
        kindLabel: '文件已删除',
        location: finding.sourcePath,
        message: `${finding.manifestCount} 份上下文清单包含这个文件（${stageList(finding.stages)}），当前已找不到。最近一次记录于 ${formatLocalTime(finding.lastRecordedAt)}。`,
        details: [
          { label: '检查代码', value: finding.code },
          { label: '最近记录时间', value: finding.lastRecordedAt },
        ],
      }
  }
}

function describeInstructions(snapshot: RepositoryKnowledgeSnapshot): KnowledgeDirectoryView['instructions'] {
  const instructions = snapshot.projectInstructions ?? null
  if (!instructions) {
    return { label: '未找到仓库根目录的 AGENTS.md 或 CLAUDE.md', tone: 'soft', details: [] }
  }
  const details: RawDetail[] = [
    { label: '文件', value: instructions.sourcePath },
    { label: '字节数', value: String(instructions.bytes) },
    { label: '内容摘要', value: instructions.contentDigest },
    { label: '加载方式', value: 'Direct Provider 与知识审查由 DevFlow 注入；OpenCode 自行加载，DevFlow 只记录摘要' },
  ]
  if (instructions.truncated && !instructions.content) {
    return { label: `${instructions.sourcePath} 过大，未能读取`, tone: 'warn', details }
  }
  const limit = formatKnowledgeBytes(PROJECT_INSTRUCTIONS_MAX_BYTES)
  return instructions.truncated
    ? { label: `${instructions.sourcePath} · ${formatKnowledgeBytes(instructions.bytes)}，超过 ${limit} 上限，已截断`, tone: 'warn', details }
    : { label: `${instructions.sourcePath} · ${formatKnowledgeBytes(instructions.bytes)}（上限 ${limit}）`, tone: 'good', details }
}

/**
 * Manifests recorded for the given runs (ADR 0025 §5): stage agent calls, and since K3 the
 * coding brief receipt of each Coding Run.
 */
export function recordedKnowledgeManifests(
  traces: readonly AgentTrace[],
  runIds: ReadonlySet<string>,
  codingRuns: readonly Pick<CodingAgentRun, 'runId' | 'startedAt' | 'contextReceipt'>[] = [],
): RecordedKnowledgeContextManifest[] {
  return [
    ...traces.flatMap((trace) => {
      const manifest = trace.executorProvenance?.knowledgeContext
      return manifest && runIds.has(trace.runId) ? [{ manifest, recordedAt: trace.createdAt }] : []
    }),
    ...codingRuns.flatMap((codingRun) => {
      const manifest = codingRun.contextReceipt?.knowledgeContext
      return manifest && runIds.has(codingRun.runId) ? [{ manifest, recordedAt: codingRun.startedAt }] : []
    }),
  ]
}

export function buildKnowledgeDirectoryView(input: {
  snapshot: RepositoryKnowledgeSnapshot | null | undefined
  recordedManifests: readonly RecordedKnowledgeContextManifest[]
}): KnowledgeDirectoryView | undefined {
  const { snapshot } = input
  if (!snapshot) return undefined
  const report = checkKnowledgeDirectory({
    documents: snapshot.documents,
    knowledgeRoot: snapshot.knowledgeRoot ?? null,
    projectInstructions: snapshot.projectInstructions ?? null,
    linkTargets: snapshot.linkTargets ?? [],
    indexTruncated: snapshot.truncated,
    recordedManifests: input.recordedManifests,
  })
  const budgetBytes = report.budgets[0]?.budgetBytes ?? 0
  const findings = report.findings.map(describeFinding)
  const notes = [
    ...(report.uncheckedLinkCount > 0
      ? [`有 ${report.uncheckedLinkCount} 处链接指向符号链接、特殊文件或超出检查上限的位置，未核实。`]
      : []),
    report.manifestCheck === 'checked'
      ? `已对照 ${report.checkedManifestCount} 份上下文清单检查文件是否已删除。`
      : report.manifestCheck === 'index_truncated'
        ? '索引不完整，未检查上下文清单中的文件是否已删除。'
        : '本项目的阶段生成和开发执行还没有记录上下文清单，未检查已删除的文件。',
  ]
  return {
    rootLabel: snapshot.knowledgeRoot === '' ? '整个仓库' : snapshot.knowledgeRoot ?? 'docs/knowledge',
    documentCount: snapshot.documents.length,
    budgetLabel: `每个阶段上限 ${formatKnowledgeBytes(budgetBytes)}`,
    instructions: describeInstructions(snapshot),
    stages: report.budgets.map((budget) => ({
      stage: budget.stage,
      label: stageLabels[budget.stage],
      documentCount: budget.applicablePaths.length,
      gateCount: budget.gatePaths.length,
      usageLabel: `${formatKnowledgeBytes(budget.usedBytes)} / ${formatKnowledgeBytes(budget.budgetBytes)}`,
      overBudgetCount: budget.overBudgetPaths.length,
    })),
    findings,
    summary: findings.length === 0
      ? `没有发现问题：已检查 ${snapshot.documents.length} 份文档的 front matter、${report.checkedLinkCount} 处链接和 ${report.budgets.length} 个阶段的用量。`
      : `发现 ${findings.length} 项需要处理的问题。`,
    notes,
    documentStages: Object.fromEntries(snapshot.documents.map((document) => [
      document.id,
      describeKnowledgeDocumentStages(document),
    ])),
  }
}
