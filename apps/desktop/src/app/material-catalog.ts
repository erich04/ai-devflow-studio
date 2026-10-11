import {
  listDesignApprovals,
  type AgentEvent,
  type Artifact,
  type ClarificationReviewBundle,
  type WorkflowRun,
} from '@ai-devflow/shared'

/**
 * Material labels, groups and the default reading choice (plan §9.1, S4 Z4–Z5, Issue #181).
 * Presentation only: stored artifacts, versions and approvals are never changed, and a status
 * that is not recorded is never shown as confirmed.
 */

export type MaterialGroup = 'pending' | 'confirmed' | 'step' | 'input' | 'proposal' | 'history'

export const materialGroupOrder: readonly MaterialGroup[] = ['pending', 'confirmed', 'step', 'input', 'proposal', 'history']

export const materialGroupLabels: Record<MaterialGroup, string> = {
  pending: '当前待处理',
  confirmed: '已确认依据',
  step: '本步骤材料',
  input: '原始输入与参考',
  proposal: '讨论提案',
  history: '历史记录',
}

export type MaterialEntry = {
  artifact: Artifact
  group: MaterialGroup
  /** 需求澄清 / 方案设计 / 原始需求 / 讨论提案 … */
  typeLabel: string
  /** “v2” for tracked clarifications; otherwise the recorded time, never an invented number. */
  versionLabel: string
  /** 待确认 / 已确认 / 已被替代（历史）/ 旧版记录，状态未记录 … empty when there is no status. */
  statusLabel: string
  /** The recorded time, formatted by the caller. */
  timeLabel: string
  /** One line for selectors: type, version, status and time. */
  label: string
}

export function isDiscussionProposalArtifact(artifact: Artifact): boolean {
  return artifact.kind === 'log' && artifact.id.startsWith('conversation-proposal-')
}

const typeLabels: Record<Artifact['kind'], string> = {
  raw_request: '原始需求',
  clarification: '需求澄清',
  clarification_feedback: '修订意见',
  design: '方案设计',
  diff: '代码差异',
  test_report: '测试报告',
  agent_review: '门禁审查报告',
  log: '执行记录',
  pr: 'PR 交付包',
  acceptance: '验收材料',
}

const clarificationStatusLabels: Record<string, { label: string; group: MaterialGroup }> = {
  draft: { label: '草稿', group: 'pending' },
  review_requested: { label: '待确认', group: 'pending' },
  revision_requested: { label: '已请求修订', group: 'history' },
  approved: { label: '已确认', group: 'confirmed' },
  superseded: { label: '已被替代（历史）', group: 'history' },
}

export type MaterialContext = {
  run: WorkflowRun | undefined
  artifacts?: readonly Artifact[]
  events: readonly AgentEvent[]
  formatTime: (iso: string) => string
}

function clarificationDescription(artifact: Artifact, context: MaterialContext): Pick<MaterialEntry, 'group' | 'statusLabel' | 'versionLabel'> {
  const metadata = artifact.clarificationRevision
  if (metadata) {
    const status = clarificationStatusLabels[metadata.status] ?? { label: '状态未知', group: 'history' as const }
    return { versionLabel: `v${metadata.revision}`, statusLabel: status.label, group: status.group }
  }
  // Legacy clarifications carry no version metadata; the Gate state is the only honest source.
  const gate = context.run?.nodes.find((node) => node.stage === 'clarify' && node.kind === 'gate' && node.artifactIds.includes(artifact.id))
  return gate?.status === 'success'
    ? { versionLabel: `记录于 ${context.formatTime(artifact.updatedAt)}`, statusLabel: '需求确认 Gate 已通过（旧版记录，未记录版本状态）', group: 'confirmed' }
    : { versionLabel: `记录于 ${context.formatTime(artifact.updatedAt)}`, statusLabel: '旧版记录，状态未记录', group: 'pending' }
}

function designDescription(artifact: Artifact, context: MaterialContext): Pick<MaterialEntry, 'group' | 'statusLabel'> {
  if (context.artifacts?.some((item) => item.runId === artifact.runId && item.kind === 'design' &&
    item.designRevision?.previous.artifactId === artifact.id)) return { statusLabel: '已被替代（历史）', group: 'history' }
  const gate = context.run?.nodes.find((node) => node.stage === 'design' && node.kind === 'gate' && node.artifactIds.includes(artifact.id))
  if (!gate) return { statusLabel: '尚未进入方案评审', group: 'step' }
  if (gate.status !== 'success') return { statusLabel: '待评审', group: 'pending' }
  const approval = context.run ? listDesignApprovals(context.events, context.run.id).find((event) => event.designAudit?.artifactId === artifact.id) : undefined
  if (!approval?.designAudit) return { statusLabel: '方案评审 Gate 已通过（旧记录未绑定版本）', group: 'confirmed' }
  return approval.designAudit.updatedAt === artifact.updatedAt
    ? { statusLabel: '已确认', group: 'confirmed' }
    : { statusLabel: '确认后已变化，与审批记录不一致', group: 'history' }
}

export function describeMaterial(artifact: Artifact, context: MaterialContext): MaterialEntry {
  const timeLabel = context.formatTime(artifact.updatedAt)
  const recorded = `记录于 ${timeLabel}`
  let typeLabel = typeLabels[artifact.kind] ?? '材料'
  let versionLabel = recorded
  let statusLabel = ''
  let group: MaterialGroup = 'step'
  if (artifact.kind === 'clarification') {
    ({ versionLabel, statusLabel, group } = clarificationDescription(artifact, context))
  } else if (artifact.kind === 'design') {
    ({ statusLabel, group } = designDescription(artifact, context))
  } else if (artifact.kind === 'raw_request') {
    versionLabel = '原始输入'
    group = 'input'
  } else if (artifact.kind === 'clarification_feedback') {
    versionLabel = artifact.clarificationFeedback ? `针对 v${artifact.clarificationFeedback.targetRevision}` : recorded
    group = 'history'
  } else if (artifact.kind === 'agent_review') {
    group = 'input'
  } else if (isDiscussionProposalArtifact(artifact)) {
    typeLabel = '讨论提案'
    statusLabel = context.artifacts?.some((item) => item.runId === artifact.runId && item.kind === 'design' &&
      item.designRevision?.proposals.some((proposal) => proposal.artifactId === artifact.id))
      ? '已用于方案修订，保留讨论记录' : '待确认，不是正式材料'
    group = 'proposal'
  }
  const label = [`${typeLabel} ${versionLabel}`, statusLabel, versionLabel === recorded ? '' : timeLabel].filter(Boolean).join(' · ')
  return { artifact, group, typeLabel, versionLabel, statusLabel, timeLabel, label }
}

/** Entries grouped in display order; within a group the given order is kept. */
export function groupMaterials(entries: readonly MaterialEntry[]): Array<{ group: MaterialGroup; label: string; entries: MaterialEntry[] }> {
  return materialGroupOrder
    .map((group) => ({ group, label: materialGroupLabels[group], entries: entries.filter((entry) => entry.group === group) }))
    .filter((section) => section.entries.length > 0)
}

/**
 * Default reading (plan §9.1): an explicit choice, then what waits for a decision, then the
 * confirmed basis, then this step's own material, then inputs. Never array order or newest time
 * alone, and a proposal is only read when chosen explicitly.
 */
export function selectDefaultMaterial(entries: readonly MaterialEntry[], requestedId?: string): MaterialEntry | undefined {
  const requested = requestedId ? entries.find((entry) => entry.artifact.id === requestedId) : undefined
  if (requested) return requested
  for (const group of ['pending', 'confirmed', 'step', 'input', 'history'] as const) {
    const match = entries.find((entry) => entry.group === group)
    if (match) return match
  }
  return undefined
}

/**
 * The requirement version to read (plan S4, Z4): an explicit choice, then the version the Gate
 * binds (pending or confirmed), then the confirmed one, then the latest with its real status.
 * Undefined means there is no formal version yet and the raw request is shown instead.
 */
export function selectRequirementReading(bundle: ClarificationReviewBundle, requestedId?: string): Artifact | undefined {
  const readable = [...bundle.revisions, ...(bundle.rawRequest ? [bundle.rawRequest] : [])]
  const requested = requestedId ? readable.find((artifact) => artifact.id === requestedId) : undefined
  if (requested) return requested
  if (bundle.state === 'ready' && bundle.activeRevision) return bundle.activeRevision
  const approved = [...bundle.revisions].reverse().find((revision) => revision.clarificationRevision?.status === 'approved')
  return approved ?? bundle.revisions.at(-1)
}

/** The requirement version a pending Gate would confirm, if any. */
export function pendingRequirementTarget(bundle: ClarificationReviewBundle): Artifact | undefined {
  return bundle.state === 'ready' && bundle.activeRevision?.clarificationRevision?.status === 'review_requested'
    ? bundle.activeRevision
    : undefined
}
