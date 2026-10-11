import { canApproveGate, type CodingAgentRun, type Role, type WorkflowRun, type WorkRequest } from '@ai-devflow/shared'
export type TaskFilter = 'all' | 'unclaimed' | 'active' | 'attention' | 'completed'
export type TaskCenterRow = { id: string; title: string; request?: WorkRequest; run?: WorkflowRun; status: string; filter: TaskFilter; action: 'claim' | 'continue' | 'delivery' | 'preview' | 'sync'; source: string; updatedAt: string }
type CodingTaskState = Pick<CodingAgentRun, 'runId' | 'nodeId' | 'status' | 'startedAt' | 'requestedBy' | 'changeAcceptanceDecisionId'>
export function taskCenterRows(runs: WorkflowRun[], requests: WorkRequest[], role?: Role, codingRuns: CodingTaskState[] = [], actorId?: string): TaskCenterRow[] {
  const claimed = new Set<string>()
  const forRun = (run: WorkflowRun, request?: WorkRequest): TaskCenterRow => {
    const node = run.nodes.find(item => item.id === run.currentNodeId)
    const complete = run.status === 'completed' && run.nodes.some(item => item.kind === 'acceptance' && item.status === 'success')
    const gate = node && ['gate', 'acceptance'].includes(node.kind) && ['running', 'blocked'].includes(node.status)
    const coding = codingRuns.filter(item => item.runId === run.id && item.nodeId === run.currentNodeId).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]
    const codingReason = coding?.status === 'waiting_permission' ? '等待工具权限确认'
      : coding?.status === 'completed' && !coding.changeAcceptanceDecisionId ? '等待接收改动'
      : coding && ['failed', 'timed_out', 'interrupted'].includes(coding.status) ? '开发执行需要恢复' : undefined
    const failure = run.status === 'failed' || node?.status === 'failed' ? '执行失败' : node?.status === 'blocked' && !gate ? '当前步骤被阻断' : undefined
    const attention = Boolean(failure || (codingReason && coding?.requestedBy === actorId) || (gate && role && canApproveGate(role, node)))
    return { id: request ? `request:${request.id}` : run.id, title: run.title, run, ...(request ? { request } : {}), source: request ? '团队请求 · 本地任务' : '本地任务',
      status: complete ? '业务验收已完成' : run.status === 'cancelled' ? '已取消' : failure ? `${failure} · ${node?.title ?? '待核对'}` : codingReason ?? (gate ? attention ? '待你确认' : '等待有权限的成员确认' : node?.title ?? '状态待同步'),
      filter: complete ? 'completed' : run.status === 'cancelled' || !node ? 'all' : attention ? 'attention' : 'active', action: complete ? 'delivery' : run.status === 'cancelled' ? 'preview' : 'continue', updatedAt: run.updatedAt }
  }
  const rows = requests.map((request): TaskCenterRow => {
    const run = request.claim ? runs.find(item => item.id === request.claim!.runId) : undefined
    if (run) { claimed.add(run.id); return forRun(run, request) }
    const status = { open: '待领取', claim_pending: '领取待恢复', materialized: '待同步本地任务', expired: '已过期', cancelled: '已取消' }[request.status]
    return { id: `request:${request.id}`, title: request.title, request, source: '团队请求', status, updatedAt: request.updatedAt,
      filter: request.status === 'open' ? 'unclaimed' : request.status === 'claim_pending' ? 'attention' : 'all',
      action: ['open', 'claim_pending'].includes(request.status) ? 'claim' : request.status === 'materialized' ? 'sync' : 'preview' }
  })
  return [...rows, ...runs.filter(run => !claimed.has(run.id)).map(run => forRun(run))].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
}
