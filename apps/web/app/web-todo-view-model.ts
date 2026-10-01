import { canApproveGate, type Project, type TeamMember, type WorkflowRun } from '@ai-devflow/shared'
import type { BrowserAuthSessionResponse, GitHubDeliveryRequestView } from './lib/devflow-api'
import { selectGateCommandTarget } from './gate-command-view-model'
import { taskHref } from './studio-navigation'
import {
  deliveryStatusLabel,
  describeGateMaterial,
  effectiveProjectRole,
  formatWebTime,
  gateDecisionLabel,
  requiredRoleLabel,
  shortIdentifier,
  stepTitle,
} from './web-labels'

/**
 * “我的待办” for the selected project (plan S5, Q2). A pure adapter over the facts the Web page
 * already loaded; it grants nothing and never turns missing data into an empty list.
 */

export type DeliveryFacts =
  | { status: 'loaded'; items: GitHubDeliveryRequestView[] }
  | { status: 'not_loaded' }
  | { status: 'failed' }

export type TodoResponsibility = 'mine' | 'others' | 'unknown'

export type TodoItem = {
  id: string
  kind: 'gate' | 'delivery' | 'anomaly'
  label: string
  taskTitle: string
  runId: string
  requester: string
  material: string
  updatedAt: string
  responsibility: TodoResponsibility
  responsibilityLabel: string
  href: string
}

export type WebTodo = {
  items: TodoItem[]
  notices: string[]
  /** Only true when every source loaded; an empty list is then a real “nothing to do”. */
  complete: boolean
  readAt: string
}

function memberName(members: readonly TeamMember[], userId: string): string {
  return members.find((member) => member.id === userId)?.name ?? '未知成员'
}

const decisionRoles = new Set(['lead', 'owner'])

export function buildWebTodo(input: {
  project: Project
  runs: readonly WorkflowRun[]
  members: readonly TeamMember[]
  session: BrowserAuthSessionResponse | null
  deliveries: DeliveryFacts
  readAt: string
}): WebTodo {
  const role = effectiveProjectRole(input.session, input.project.id)
  const projectRuns = input.runs.filter((run) => run.projectId === input.project.id)
  const items: TodoItem[] = []
  const notices: string[] = []

  for (const run of projectRuns) {
    const requester = `任务发起人 ${memberName(input.members, run.creatorId)}`
    const target = run.status === 'paused_at_gate' ? selectGateCommandTarget(run) : null
    if (target && (target.node.status === 'running' || target.node.status === 'blocked')) {
      const material = describeGateMaterial(run, target.node)
      // A signed-in user without a role in this project cannot approve here: the server refuses.
      const allowed = role ? canApproveGate(role, target.node) : input.session ? false : undefined
      const responsibility: TodoResponsibility = allowed === undefined ? 'unknown' : allowed ? 'mine' : 'others'
      const materialPending = material.status === 'missing' || material.status === 'stale'
      items.push({
        id: `gate:${run.id}:${target.commandNodeId}`,
        kind: 'gate',
        label: gateDecisionLabel(target.node),
        taskTitle: run.title,
        runId: run.id,
        requester,
        material: material.label,
        updatedAt: run.updatedAt,
        responsibility,
        responsibilityLabel: responsibility === 'mine'
          ? materialPending ? '需要你审批 · 材料版本未同步，暂不能批准' : '需要你审批'
          : responsibility === 'others'
            ? `等待负责人审批（需要 ${requiredRoleLabel(target.node)}）`
            : '权限待核实',
        href: taskHref(input.project.id, run.id, 'human-gate'),
      })
    }
    const currentNode = run.nodes.find((node) => node.id === run.currentNodeId)
    if (run.status === 'failed' || currentNode?.status === 'failed') {
      items.push({
        id: `anomaly:${run.id}`,
        kind: 'anomaly',
        label: run.status === 'failed' ? '任务执行失败' : `步骤失败：${currentNode ? stepTitle(currentNode) : '当前步骤'}`,
        taskTitle: run.title,
        runId: run.id,
        requester,
        material: '在桌面端查看失败位置与已保留的结果',
        updatedAt: run.updatedAt,
        responsibility: 'unknown',
        responsibilityLabel: '需要任务负责人处理',
        href: taskHref(input.project.id, run.id, 'evidence-chain'),
      })
    }
  }

  if (input.deliveries.status === 'loaded') {
    for (const delivery of input.deliveries.items.filter((item) => item.projectId === input.project.id)) {
      const run = projectRuns.find((candidate) => candidate.id === delivery.runId)
      const common = {
        taskTitle: run?.title ?? `任务 ${shortIdentifier(delivery.runId)}`,
        runId: delivery.runId,
        requester: run ? `任务发起人 ${memberName(input.members, run.creatorId)}` : '桌面端',
        material: `请求 v${delivery.stateVersion} · 提交 ${shortIdentifier(delivery.expectedCommitSha, 12)}`,
        updatedAt: delivery.updatedAt,
        href: taskHref(input.project.id, delivery.runId, 'github-delivery'),
      }
      if (delivery.status === 'approval_required') {
        const responsibility: TodoResponsibility = role === null
          ? input.session ? 'others' : 'unknown'
          : decisionRoles.has(role) ? 'mine' : 'others'
        items.push({
          ...common,
          id: `delivery:${delivery.id}`,
          kind: 'delivery',
          label: '交付审批',
          responsibility,
          responsibilityLabel: responsibility === 'mine'
            ? '需要你审批'
            : responsibility === 'others'
              ? '等待负责人审批（需要 Lead 或 Owner）'
              : '权限待核实',
        })
      } else if (delivery.status === 'failed' || delivery.status === 'recovery_required') {
        items.push({
          ...common,
          id: `delivery-anomaly:${delivery.id}`,
          kind: 'anomaly',
          label: deliveryStatusLabel(delivery.status),
          responsibility: 'unknown',
          responsibilityLabel: '在桌面端处理交付',
        })
      }
    }
  } else if (input.deliveries.status === 'not_loaded') {
    notices.push('未建立浏览器身份，交付审批与审批权限没有读取，列表不完整。')
  } else {
    notices.push('交付请求暂时无法读取，列表可能不完整。')
  }
  if (!input.session && input.deliveries.status !== 'not_loaded') {
    notices.push('未读取当前身份，暂时无法判断哪些事项需要你处理。')
  }

  const order: Record<TodoResponsibility, number> = { mine: 0, unknown: 1, others: 2 }
  items.sort((left, right) =>
    order[left.responsibility] - order[right.responsibility] ||
    right.updatedAt.localeCompare(left.updatedAt) ||
    left.id.localeCompare(right.id),
  )
  return { items, notices, complete: notices.length === 0, readAt: input.readAt }
}

export function describeTodoFreshness(todo: WebTodo): string {
  return `团队数据读取于 ${formatWebTime(todo.readAt)}。任务状态来自桌面端最近一次上传，以各行的更新时间为准。`
}
