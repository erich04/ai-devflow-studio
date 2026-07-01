import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  CircleDot,
  ClipboardCheck,
  Code2,
  Database,
  FileText,
  Gauge,
  Github,
  GitBranch,
  Play,
  ShieldCheck,
  Sparkles,
  TestTube2,
  TimerReset,
  XCircle,
} from 'lucide-react'
import { cookies } from 'next/headers'
import type { CSSProperties, ReactNode } from 'react'
import {
  createDemoTeamSessionHeaders,
  createRecommendedEnforcementPreset,
  formatUsd,
  resolveDevFlowRuntimeFlags,
  type DevFlowSessionHeaders,
  type NodeStatus,
  type WorkflowNode,
  type WorkflowRun,
} from '@ai-devflow/shared'
import {
  fetchTeamOverview,
  resolveDevFlowPublicApiBaseUrl,
  runKnowledgeReview,
  saveEnforcementPolicy,
  type TeamOverviewResponse,
} from './lib/devflow-api'

type StatusTone = 'done' | 'run' | 'gate' | 'warn' | 'idle' | 'fail'

async function getDevFlowCookieHeader(): Promise<string | undefined> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('devflow_session')?.value
  return sessionCookie ? `devflow_session=${sessionCookie}` : undefined
}

function getDemoSessionHeadersIfEnabled(): DevFlowSessionHeaders | undefined {
  return resolveDevFlowRuntimeFlags({
    DEVFLOW_ENABLE_DEMO_DATA: process.env.DEVFLOW_ENABLE_DEMO_DATA,
  }).demoDataEnabled
    ? createDemoTeamSessionHeaders()
    : undefined
}

async function runKnowledgeReviewAction(formData: FormData) {
  'use server'

  const runId = String(formData.get('runId') ?? '')
  const nodeId = String(formData.get('nodeId') ?? '')
  const projectId = String(formData.get('projectId') ?? '')
  const providerId = String(formData.get('providerId') ?? '').trim()

  if (!runId || !nodeId || !projectId) return

  const cookieHeader = await getDevFlowCookieHeader()
  const sessionHeaders = cookieHeader ? undefined : getDemoSessionHeadersIfEnabled()
  await runKnowledgeReview({
    runId,
    nodeId,
    projectId,
    providerId,
    ...(cookieHeader ? { cookieHeader } : {}),
    ...(sessionHeaders ? { sessionHeaders } : {}),
  })
}

async function applyRecommendedPolicyAction(formData: FormData) {
  'use server'

  const organizationId = String(formData.get('organizationId') ?? '').trim()
  if (!organizationId) return

  const cookieHeader = await getDevFlowCookieHeader()
  const sessionHeaders = cookieHeader ? undefined : getDemoSessionHeadersIfEnabled()
  await saveEnforcementPolicy({
    policy: createRecommendedEnforcementPreset({
      organizationId,
      updatedAt: new Date().toISOString(),
    }),
    ...(cookieHeader ? { cookieHeader } : {}),
    ...(sessionHeaders ? { sessionHeaders } : {}),
  })
}

export default async function Page() {
  const apiBaseUrl = resolveDevFlowPublicApiBaseUrl()
  const cookieHeader = await getDevFlowCookieHeader()
  const sessionHeaders = cookieHeader ? undefined : getDemoSessionHeadersIfEnabled()

  let overview: TeamOverviewResponse
  try {
    overview = await fetchTeamOverview({
      ...(cookieHeader ? { cookieHeader } : {}),
      ...(sessionHeaders ? { sessionHeaders } : {}),
    })
  } catch (error) {
    return <ErrorShell message={error instanceof Error ? error.message : '无法连接 DevFlow API'} />
  }

  const activeRun = selectActiveRun(overview.runs)
  const activeProject = activeRun
    ? overview.projects.find((project) => project.id === activeRun.projectId)
    : overview.projects[0]
  const activeMember = activeRun
    ? overview.members.find((member) => member.id === activeRun.creatorId)
    : overview.members[0]
  const currentNode = activeRun?.nodes.find((node) => node.id === activeRun.currentNodeId)
  const gateNode = activeRun ? selectGateNode(activeRun, currentNode) : undefined
  const gateReview =
    overview.agentReviews.find((review) => review.runId === activeRun?.id && review.nodeId === gateNode?.id) ??
    overview.agentReviews[0]
  const currentEvidence = activeRun
    ? overview.testEvidenceSummaries.filter((item) => item.runId === activeRun.id)
    : overview.testEvidenceSummaries
  const currentCodingRuns = activeRun
    ? overview.codingAgentSummaries.filter((item) => item.runId === activeRun.id)
    : overview.codingAgentSummaries
  const knowledgeReviewProviderId = overview.agentProviders[0]?.id ?? ''
  const policySummary = activeProject
    ? overview.policyAwareDeliverySummaries.find((item) => item.projectId === activeProject.id)
    : overview.policyAwareDeliverySummaries[0]
  const budgetPolicy = activeProject
    ? overview.runtimeBudgetPolicies.find((item) => item.projectId === activeProject.id)
    : undefined
  const projectSpend = activeProject
    ? overview.projectCost.find((rollup) => rollup.key === activeProject.id)?.costUsd ?? 0
    : 0
  const budgetPercent =
    budgetPolicy?.monthlyLimitUsd != null && budgetPolicy.monthlyLimitUsd > 0
      ? Math.min(Math.round((projectSpend / budgetPolicy.monthlyLimitUsd) * 100), 999)
      : 0
  const activeRunCount = overview.runs.filter((run) => !['completed', 'failed', 'cancelled'].includes(run.status)).length
  const gateCount = overview.runs.filter((run) => run.status === 'paused_at_gate').length
  const evidenceCount =
    overview.testEvidenceSummaries.length + overview.agentReviews.length + overview.codingAgentSummaries.length
  const progress = activeRun ? calculateProgress(activeRun.nodes) : 0

  return (
    <main className="studio-shell">
      <aside className="studio-rail" aria-label="AI DevFlow navigation">
        <div className="studio-brand">
          <span aria-hidden="true">
            <Sparkles size={19} />
          </span>
          <div>
            <strong>AI DevFlow</strong>
            <small>Studio</small>
          </div>
        </div>

        <a className="studio-primary-action" href="#work-request">
          <Play size={15} />
          新建工作请求
        </a>

        <nav className="studio-nav">
          <a href="#evidence-chain">
            <CircleDot size={16} />
            Evidence Chain
          </a>
          <a href="#human-gate">
            <ShieldCheck size={16} />
            Human Gate
          </a>
          <a href="#agents">
            <Bot size={16} />
            Agents
          </a>
          <a href="#runtime">
            <Gauge size={16} />
            Runtime
          </a>
          <a href="/legacy-shell">
            <FileText size={16} />
            旧壳备份
          </a>
        </nav>

        <div className="studio-rail-footer">
          <span>{activeProject?.name ?? 'No project'}</span>
          <strong>{activeMember?.name ?? 'Waiting for sync'}</strong>
        </div>
      </aside>

      <section className="studio-workspace">
        <header className="studio-topbar">
          <div>
            <div className="studio-run-kicker">
              <span>{activeRun ? shortRunId(activeRun.id) : 'NO RUN SELECTED'}</span>
              <StatusPill tone={activeRun ? statusTone(activeRun.status) : 'idle'}>
                {activeRun ? runStatusLabel(activeRun.status) : '等待真实数据'}
              </StatusPill>
            </div>
            <h1>{activeRun?.title ?? '把 Agent 执行、证据链和人评 Gate 收束到一个产品路径'}</h1>
            <p>
              {activeRun?.request ??
                '当前没有团队 run。新壳保留真实 API 接入，同时用明确的空状态解释下一步该创建工作请求。'}
            </p>
          </div>
          <div className="studio-top-actions">
            <a className="studio-secondary-link" href={`${apiBaseUrl}/api/auth/github/start`}>
              <Github size={16} />
              Sign in with GitHub
            </a>
            <a className="studio-secondary-link" href="/legacy-shell">
              备份壳
            </a>
          </div>
        </header>

        <section className="studio-metrics" aria-label="Delivery metrics">
          <MetricCard label="Active Runs" value={String(activeRunCount)} detail={`${gateCount} awaiting gate`} />
          <MetricCard label="Evidence Items" value={String(evidenceCount)} detail="tests · reviews · coding runs" />
          <MetricCard label="Budget Used" value={`${budgetPercent}%`} detail={budgetPolicy ? formatUsd(projectSpend) : 'not configured'} />
          <MetricCard
            label="Policy Signals"
            value={String((policySummary?.warningCount ?? 0) + (policySummary?.blockedCount ?? 0))}
            detail={`${policySummary?.remainingEvidenceGapCount ?? 0} evidence gaps`}
          />
        </section>

        <section className="studio-grid">
          <section className="studio-chain-panel" id="evidence-chain">
            <div className="studio-section-heading">
              <div>
                <span>Evidence Chain</span>
                <h2>{activeRun ? '当前工作请求证据链' : '等待第一条真实工作请求'}</h2>
              </div>
              <div className="studio-progress">
                <span>{progress}%</span>
                <div>
                  <i style={{ width: `${progress}%` }} />
                </div>
              </div>
            </div>

            {activeRun ? (
              <div className="studio-chain-list">
                {activeRun.nodes.map((node) => (
                  <EvidenceStep
                    key={node.id}
                    node={node}
                    current={node.id === activeRun.currentNodeId}
                    evidenceCount={evidenceCountForNode(overview, activeRun, node)}
                  />
                ))}
              </div>
            ) : (
              <EmptyProductState
                title="没有真实 Run"
                body="连接 Desktop 或 API 创建工作请求后，这里会显示从澄清、设计、编码、测试到 PR 的证据链。"
              />
            )}
          </section>

          <aside className="studio-gate-panel" id="human-gate">
            <div className="studio-section-heading compact">
              <div>
                <span>Human Gate</span>
                <h2>{gateNode?.title ?? '暂无待审 Gate'}</h2>
              </div>
              <StatusPill tone={gateNode ? nodeTone(gateNode.status) : 'idle'}>
                {gateNode ? nodeStatusLabel(gateNode.status) : 'idle'}
              </StatusPill>
            </div>

            <dl className="studio-gate-facts">
              <div>
                <dt>项目</dt>
                <dd>{activeProject?.repository ?? '等待项目同步'}</dd>
              </div>
              <div>
                <dt>分支</dt>
                <dd>{activeRun?.branchName ?? '暂无分支'}</dd>
              </div>
              <div>
                <dt>审批角色</dt>
                <dd>{gateNode?.requiredRole ?? 'lead / owner'}</dd>
              </div>
            </dl>

            <div className="studio-advisory">
              <strong>{gateReview?.gateAdvisory.summary ?? '没有阻断性知识缺口。'}</strong>
              <p>
                {gateReview
                  ? `${gateReview.policyFindings.length} policy findings · ${gateReview.missingEvidence.length} missing evidence`
                  : '触发后端审查后，这里会显示模型、知识引用、缺失证据和建议测试。'}
              </p>
            </div>

            <form className="studio-gate-action" action={runKnowledgeReviewAction}>
              <input type="hidden" name="runId" value={activeRun?.id ?? ''} />
              <input type="hidden" name="nodeId" value={gateNode?.id ?? currentNode?.id ?? ''} />
              <input type="hidden" name="projectId" value={activeRun?.projectId ?? activeProject?.id ?? ''} />
              <input type="hidden" name="providerId" value={knowledgeReviewProviderId} />
              <button type="submit" disabled={!activeRun || !gateNode}>
                <Bot size={16} />
                触发后端审查
              </button>
            </form>

            <div className="studio-gate-buttons">
              <button type="button" disabled={!gateNode}>
                <CheckCircle2 size={16} />
                批准并继续
              </button>
              <button type="button" disabled={!gateNode}>
                <XCircle size={16} />
                驳回
              </button>
            </div>
          </aside>
        </section>

        <section className="studio-support-grid">
      <SupportPanel id="agents" icon={<Bot size={17} />} title="Active Agents" action="查看 Agents">
            {currentCodingRuns.length > 0 ? (
              currentCodingRuns.slice(0, 4).map((run) => (
                <CompactRow key={run.id} title={run.providerId} meta={run.summary} value={run.status} />
              ))
            ) : (
              <CompactRow title="Planner / Code / Test" meta="等待 Desktop 同步真实 coding agent 运行" value="idle" />
            )}
          </SupportPanel>

          <SupportPanel id="tests" icon={<TestTube2 size={17} />} title="Test Evidence" action="查看测试报告">
            {currentEvidence.length > 0 ? (
              currentEvidence.slice(0, 4).map((item) => (
                <CompactRow key={item.id} title={item.summary} meta={item.command} value={item.status} />
              ))
            ) : (
              <CompactRow title="暂无测试证据" meta="运行测试后会显示命令、状态和脱敏摘要" value="empty" />
            )}
          </SupportPanel>

          <SupportPanel id="runtime" icon={<Gauge size={17} />} title="Runtime Budget" action="预算详情">
            <div className="studio-budget-ring" style={{ '--budget-percent': `${Math.min(budgetPercent, 100)}%` } as CSSProperties}>
              <strong>{budgetPercent}%</strong>
              <span>{budgetPolicy ? `${formatUsd(projectSpend)} / ${formatUsd(budgetPolicy.monthlyLimitUsd)}` : 'not configured'}</span>
            </div>
          </SupportPanel>

          <SupportPanel id="policy" icon={<AlertTriangle size={17} />} title="Policy / Warnings" action="应用推荐策略">
            <CompactRow
              title={policySummary ? `${policySummary.blockedCount} blocking · ${policySummary.warningCount} warnings` : 'Warn-only default'}
              meta={`${policySummary?.retryAttemptCount ?? 0} retries · ${policySummary?.overrideCount ?? 0} overrides`}
              value={`${overview.enforcementPolicies.organizationPolicy.version}`}
            />
            <form action={applyRecommendedPolicyAction}>
              <input
                type="hidden"
                name="organizationId"
                value={overview.enforcementPolicies.organizationPolicy.organizationId}
              />
              <button type="submit" className="studio-small-button">
                Apply recommended enforcement
              </button>
            </form>
          </SupportPanel>
        </section>
      </section>
    </main>
  )
}

function ErrorShell({ message }: { message: string }) {
  return (
    <main className="studio-shell studio-shell--error">
      <section className="studio-error-panel">
        <AlertTriangle size={28} />
        <span>DevFlow API</span>
        <h1>团队数据暂时不可用</h1>
        <p>{message}</p>
        <a href="/legacy-shell">打开旧壳备份</a>
      </section>
    </main>
  )
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="studio-metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  )
}

function EvidenceStep({
  node,
  current,
  evidenceCount,
}: {
  node: WorkflowNode
  current: boolean
  evidenceCount: number
}) {
  return (
    <article className={`studio-evidence-step is-${nodeTone(node.status)} ${current ? 'is-current' : ''}`}>
      <div className="studio-step-marker">{nodeIcon(node)}</div>
      <div className="studio-step-body">
        <div className="studio-step-head">
          <span>{node.stage}</span>
          <StatusPill tone={nodeTone(node.status)}>{nodeStatusLabel(node.status)}</StatusPill>
        </div>
        <h3>{node.title}</h3>
        <p>{node.subtitle}</p>
        <div className="studio-step-meta">
          <span>owner: {node.ownerId}</span>
          <span>retry: {node.retryCount}</span>
          <span>evidence: {evidenceCount}</span>
        </div>
      </div>
      <code>{node.id}</code>
    </article>
  )
}

function SupportPanel({
  id,
  icon,
  title,
  action,
  children,
}: {
  id: string
  icon: ReactNode
  title: string
  action: string
  children: ReactNode
}) {
  return (
    <section className="studio-support-panel" id={id}>
      <header>
        <span>
          {icon}
          {title}
        </span>
        <a href={`#${id}`}>
          {action}
          <ArrowRight size={14} />
        </a>
      </header>
      <div className="studio-support-body">{children}</div>
    </section>
  )
}

function CompactRow({ title, meta, value }: { title: string; meta: string; value: string }) {
  return (
    <article className="studio-compact-row">
      <div>
        <strong>{title}</strong>
        <p>{meta}</p>
      </div>
      <span>{value}</span>
    </article>
  )
}

function EmptyProductState({ title, body }: { title: string; body: string }) {
  return (
    <div className="studio-empty-state" id="work-request">
      <Database size={24} />
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  )
}

function StatusPill({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return <span className={`studio-status-pill is-${tone}`}>{children}</span>
}

function selectActiveRun(runs: WorkflowRun[]) {
  const activeStatuses = new Set<WorkflowRun['status']>([
    'paused_at_gate',
    'building',
    'testing',
    'designing',
    'clarifying',
    'created',
  ])
  const byLatestUpdate = (left: WorkflowRun, right: WorkflowRun) =>
    Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
  const activeRuns = runs.filter((run) => activeStatuses.has(run.status)).sort(byLatestUpdate)

  return activeRuns[0] ?? [...runs].sort(byLatestUpdate)[0]
}

function selectGateNode(run: WorkflowRun, currentNode?: WorkflowNode) {
  if (currentNode?.kind === 'gate') return currentNode
  return run.nodes.find((node) => node.kind === 'gate' && node.status === 'blocked') ?? run.nodes.find((node) => node.kind === 'gate')
}

function calculateProgress(nodes: WorkflowNode[]) {
  if (nodes.length === 0) return 0
  const complete = nodes.filter((node) => node.status === 'success' || node.status === 'skipped').length
  return Math.round((complete / nodes.length) * 100)
}

function evidenceCountForNode(overview: TeamOverviewResponse, run: WorkflowRun, node: WorkflowNode) {
  return (
    overview.testEvidenceSummaries.filter((item) => item.runId === run.id && item.nodeId === node.id).length +
    overview.agentReviews.filter((item) => item.runId === run.id && item.nodeId === node.id).length +
    overview.codingAgentSummaries.filter((item) => item.runId === run.id && item.nodeId === node.id).length +
    node.artifactIds.length
  )
}

function shortRunId(id: string) {
  return `RUN-${id.slice(0, 8).toUpperCase()}`
}

function runStatusLabel(status: WorkflowRun['status']) {
  const labels: Record<WorkflowRun['status'], string> = {
    created: '已创建',
    clarifying: '澄清中',
    designing: '设计中',
    building: '执行中',
    testing: '测试中',
    paused_at_gate: '等待人评',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
  }
  return labels[status]
}

function nodeStatusLabel(status: NodeStatus) {
  const labels: Record<NodeStatus, string> = {
    pending: 'pending',
    running: 'running',
    blocked: 'awaiting',
    success: 'done',
    failed: 'failed',
    skipped: 'skipped',
  }
  return labels[status]
}

function statusTone(status: WorkflowRun['status']): StatusTone {
  if (status === 'paused_at_gate') return 'gate'
  if (status === 'completed') return 'done'
  if (status === 'failed' || status === 'cancelled') return 'fail'
  if (status === 'created') return 'idle'
  return 'run'
}

function nodeTone(status: NodeStatus): StatusTone {
  if (status === 'success' || status === 'skipped') return 'done'
  if (status === 'running') return 'run'
  if (status === 'blocked') return 'gate'
  if (status === 'failed') return 'fail'
  return 'idle'
}

function nodeIcon(node: WorkflowNode) {
  if (node.status === 'success') return <CheckCircle2 size={18} />
  if (node.status === 'failed') return <XCircle size={18} />
  if (node.kind === 'gate') return <ShieldCheck size={18} />
  if (node.kind === 'test') return <TestTube2 size={18} />
  if (node.kind === 'task') return <Code2 size={18} />
  if (node.kind === 'pr') return <GitBranch size={18} />
  if (node.kind === 'acceptance') return <ClipboardCheck size={18} />
  if (node.status === 'running') return <TimerReset size={18} />
  return <CircleDot size={18} />
}
