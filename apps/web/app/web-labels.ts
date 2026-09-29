import type {
  GateReviewSubjectSnapshot,
  NodeStatus,
  Role,
  WorkflowNode,
  WorkflowRun,
} from '@ai-devflow/shared'
import type { BrowserAuthSessionResponse, GitHubDeliveryRequestView } from './lib/devflow-api'

/** User-facing Web copy (plan S5, Q3–Q5). Stored values stay unchanged. */

export function runStatusLabel(status: WorkflowRun['status']): string {
  const labels: Record<WorkflowRun['status'], string> = {
    created: '已创建',
    clarifying: '澄清中',
    designing: '设计中',
    building: '开发中',
    testing: '测试中',
    paused_at_gate: '等待审批',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
  }
  return labels[status]
}

export function nodeStatusLabel(status: NodeStatus): string {
  const labels: Record<NodeStatus, string> = {
    pending: '未开始',
    running: '进行中',
    blocked: '等待处理',
    success: '已完成',
    failed: '失败',
    skipped: '已跳过',
  }
  return labels[status]
}

export function stageLabel(stage: WorkflowNode['stage']): string {
  const labels: Record<WorkflowNode['stage'], string> = {
    clarify: '需求澄清',
    design: '方案设计',
    build: '开发实现',
    test: '测试',
    pr: 'PR 交付',
    accept: '业务验收',
  }
  return labels[stage]
}

export function roleLabel(role: Role): string {
  return role === 'owner' ? 'Owner' : role === 'lead' ? 'Lead' : '成员'
}

/** Requirement, design, other Gates and acceptance are distinct decisions, never just “通过”. */
export function gateDecisionLabel(node: Pick<WorkflowNode, 'kind' | 'stage' | 'title'>): string {
  if (node.kind === 'acceptance') return '业务验收'
  if (node.kind === 'gate' && node.stage === 'clarify') return '需求确认'
  if (node.kind === 'gate' && node.stage === 'design') return '方案评审'
  return node.title
}

export function requiredRoleLabel(node: Pick<WorkflowNode, 'requiredRole'>): string {
  const required = node.requiredRole ?? 'member'
  return required === 'member' ? '项目成员及以上' : `${roleLabel(required)} 及以上`
}

/** Team data is shown in UTC so every reader sees the same time. */
export function formatWebTime(value: string | undefined): string {
  if (!value) return '时间未记录'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '时间未记录'
  const iso = date.toISOString()
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`
}

export function shortIdentifier(value: string, length = 8): string {
  return value.length <= length + 2 ? value : `${value.slice(0, length)}…`
}

export function canonicalNodeId(runId: string, nodeId: string): string {
  const prefix = `${runId}:`
  return nodeId.startsWith(prefix) ? nodeId.slice(prefix.length) : nodeId
}

/** The project role the server uses for Gate Commands: org Owner, else the project membership. */
export function effectiveProjectRole(session: BrowserAuthSessionResponse | null, projectId: string): Role | null {
  if (!session) return null
  if (session.user.role === 'owner') return 'owner'
  return session.projectMemberships.find((membership) =>
    membership.projectId === projectId && membership.userId === session.user.id,
  )?.role ?? null
}

export function requiresMaterialSnapshot(node: Pick<WorkflowNode, 'kind' | 'stage'>): boolean {
  return node.kind === 'gate' && (node.stage === 'clarify' || node.stage === 'design')
}

export type GateMaterialView =
  | { status: 'current'; label: string; recordedAt: string; digest: string; artifactId: string }
  | { status: 'not_required'; label: string }
  | { status: 'missing' | 'stale'; label: string }

/**
 * What a Gate approval is bound to, from the desktop-uploaded subject. Requirement and design
 * Gates need the subject for exactly this step and Run version (plan S5, Q4, Q8).
 */
export function describeGateMaterial(run: WorkflowRun, node: WorkflowNode): GateMaterialView {
  const subject: GateReviewSubjectSnapshot | undefined = run.gateReviewSubject
  const nodeId = canonicalNodeId(run.id, node.id)
  if (!requiresMaterialSnapshot(node)) {
    return { status: 'not_required', label: '由桌面端按本地证据复核' }
  }
  if (!subject) return { status: 'missing', label: '所审材料的版本尚未从桌面端同步' }
  if (subject.runId !== run.id || subject.nodeId !== nodeId || subject.runVersion !== run.version) {
    return { status: 'stale', label: '已同步的材料版本不属于当前步骤或任务版本，等待桌面端重新同步' }
  }
  const kind = node.stage === 'clarify' ? 'clarification' : 'design'
  const material = subject.artifacts.find((artifact) => artifact.kind === kind)
  if (!material) return { status: 'missing', label: '所审材料的版本尚未从桌面端同步' }
  return {
    status: 'current',
    label: `${kind === 'clarification' ? '需求澄清' : '方案'} · 记录于 ${formatWebTime(material.updatedAt)}`,
    recordedAt: material.updatedAt,
    digest: material.contentDigest,
    artifactId: material.id,
  }
}

export function deliveryStatusLabel(status: GitHubDeliveryRequestView['status']): string {
  const labels: Record<GitHubDeliveryRequestView['status'], string> = {
    approval_required: '等待审批',
    approved: '已批准，等待桌面端发布',
    publishing_branch: '正在发布分支',
    branch_published: '分支已发布',
    creating_pr: '正在创建 Draft PR',
    completed: '已创建 Draft PR',
    failed: '交付失败',
    recovery_required: '需要恢复',
    revoked: '已撤销',
  }
  return labels[status] ?? status
}
