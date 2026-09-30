import { AlertTriangle, Bot, Database, Gauge, ShieldCheck, TestTube2 } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import {
  canApproveGate,
  formatUsd,
  type GateCommand,
  type Project,
  type WorkflowNode,
  type WorkflowRun,
} from '@ai-devflow/shared'
import type {
  BrowserAuthSessionResponse,
  GateCommandEvaluationSnapshot,
  TeamOverviewResponse,
} from './lib/devflow-api'
import { CopyValue } from './CopyValue'
import { GateCommandPanel } from './GateCommandPanel'
import { selectGateCommandTarget } from './gate-command-view-model'
import { studioHref } from './studio-navigation'
import { CompactRow, EvidenceStep, StatusPill, SupportPanel, nodeTone, statusTone } from './studio-ui'
import {
  describeGateMaterial,
  effectiveProjectRole,
  formatWebTime,
  gateDecisionLabel,
  nodeStatusLabel,
  requiredRoleLabel,
  roleLabel,
  runStatusLabel,
  shortIdentifier,
  stepTitle,
} from './web-labels'

function calculateProgress(nodes: WorkflowNode[]) {
  if (nodes.length === 0) return 0
  const complete = nodes.filter((node) => node.status === 'success' || node.status === 'skipped').length
  return Math.round((complete / nodes.length) * 100)
}

function evidenceCountForNode(overview: TeamOverviewResponse, run: WorkflowRun, node: WorkflowNode) {
  const scoped = <T extends { projectId: string; runId: string; nodeId: string }>(items: T[]) =>
    items.filter((item) => item.projectId === run.projectId && item.runId === run.id && item.nodeId === node.id).length
  return (
    scoped(overview.testEvidenceSummaries) +
    scoped(overview.agentReviews) +
    scoped(overview.codingAgentSummaries) +
    scoped(overview.agentRuntimeSummaries) +
    node.artifactIds.length
  )
}

/**
 * 任务详情 (plan S5, Q3–Q4). First screen: where the task stands, the decision waiting on it and
 * the delivery request, then progress, execution summary, budget and policy. Management forms
 * (pairing, repository binding) live in settings.
 */
export function WebTaskDetail({
  project,
  run,
  overview,
  session,
  hasBrowserSession,
  gateCommands,
  gateEvaluation,
  deliverySection,
  knowledgeReviewAction,
}: {
  project: Project
  run: WorkflowRun
  overview: TeamOverviewResponse
  session: BrowserAuthSessionResponse | null
  hasBrowserSession: boolean
  gateCommands: GateCommand[]
  gateEvaluation: GateCommandEvaluationSnapshot | null
  deliverySection: ReactNode
  knowledgeReviewAction: (formData: FormData) => Promise<void>
}) {
  const currentNode = run.nodes.find((node) => node.id === run.currentNodeId)
  const target = selectGateCommandTarget(run)
  const awaitingDecision =
    target !== null &&
    run.status === 'paused_at_gate' &&
    (target.node.status === 'running' || target.node.status === 'blocked')
  const role = effectiveProjectRole(session, project.id)
  const reviews = overview.agentReviews.filter((review) => review.projectId === project.id && review.runId === run.id)
  const gateReview = target ? reviews.find((review) => review.nodeId === target.node.id) : undefined
  const scoped = <T extends { projectId: string; runId: string }>(items: T[]) =>
    items.filter((item) => item.projectId === project.id && item.runId === run.id)
  const evidence = scoped(overview.testEvidenceSummaries)
  const codingRuns = scoped(overview.codingAgentSummaries)
  const runtimes = scoped(overview.agentRuntimeSummaries)
  const memories = scoped(overview.agentMemorySummaries)
  const coordinations = scoped(overview.agentCoordinationSummaries)
  const providerNameById = new Map(overview.agentProviders.map((provider) => [provider.id, provider.name]))
  const knowledgeReviewProviderId = overview.agentProviders[0]?.id ?? ''
  const policySummary = overview.policyAwareDeliverySummaries.find((item) => item.projectId === project.id)
  const budgetPolicy = overview.runtimeBudgetPolicies.find((item) => item.projectId === project.id)
  const projectSpend = overview.projectCost.find((rollup) => rollup.key === project.id)?.costUsd ?? 0
  const budgetPercent =
    budgetPolicy?.monthlyLimitUsd != null && budgetPolicy.monthlyLimitUsd > 0
      ? Math.min(Math.round((projectSpend / budgetPolicy.monthlyLimitUsd) * 100), 999)
      : 0
  const progress = calculateProgress(run.nodes)

  return (
    <section className="studio-task-detail" aria-label="任务详情">
      <dl className="studio-task-facts">
        <div><dt>状态</dt><dd><StatusPill tone={statusTone(run.status)}>{runStatusLabel(run.status)}</StatusPill></dd></div>
        <div><dt>当前步骤</dt><dd>{currentNode ? `${stepTitle(currentNode)} · ${nodeStatusLabel(currentNode.status)}` : '未记录'}</dd></div>
        <div><dt>进度</dt><dd>{progress}%</dd></div>
        <div><dt>分支</dt><dd>{run.branchName || '暂无分支'}</dd></div>
        <div><dt>数据时效</dt><dd>桌面端最近一次上传：{formatWebTime(run.updatedAt)}</dd></div>
      </dl>

      <section className="studio-gate-panel" id="human-gate" aria-label="审批">
        {awaitingDecision && target ? (() => {
          const node = target.node
          const material = describeGateMaterial(run, node)
          const canApprove = role !== null && canApproveGate(role, node)
          const canReject = role === 'lead' || role === 'owner'
          return (
            <>
              <div className="studio-section-heading compact">
                <div>
                  <span>审批 · {gateDecisionLabel(node)}</span>
                  <h2>{stepTitle(node)}</h2>
                </div>
                <StatusPill tone={nodeTone(node.status)}>{nodeStatusLabel(node.status)}</StatusPill>
              </div>
              <dl className="studio-gate-facts">
                <div>
                  <dt>所审材料</dt>
                  <dd>
                    {material.label}
                    {material.status === 'current' ? (
                      <details className="studio-gate-material-details">
                        <summary>技术详情</summary>
                        <p>材料标识 <CopyValue value={material.artifactId} short={shortIdentifier(material.artifactId, 16)} label="材料标识" /></p>
                        <p>内容摘要 <CopyValue value={material.digest} short={shortIdentifier(material.digest, 12)} label="内容摘要" /></p>
                      </details>
                    ) : null}
                  </dd>
                </div>
                <div><dt>审批角色</dt><dd>{requiredRoleLabel(node)}</dd></div>
                <div><dt>你的角色</dt><dd>{role ? roleLabel(role) : hasBrowserSession ? '不是该项目的成员' : '未建立浏览器身份'}</dd></div>
              </dl>
              <div className="studio-advisory">
                <strong>{gateReview?.gateAdvisory.summary ?? '此任务尚未运行基于知识的门禁审查。'}</strong>
                <p>
                  {gateReview
                    ? `${gateReview.policyFindings.length} 条策略发现 · ${gateReview.missingEvidence.length} 项缺失证据`
                    : '运行后会以知识与规范为依据，审查当前 Gate 条件和阶段材料，并列出引用、缺失证据和建议测试。'}
                </p>
              </div>
              <form className="studio-gate-action" action={knowledgeReviewAction}>
                <input type="hidden" name="runId" value={run.id} />
                <input type="hidden" name="nodeId" value={node.id} />
                <input type="hidden" name="projectId" value={run.projectId} />
                <input type="hidden" name="providerId" value={knowledgeReviewProviderId} />
                <button type="submit">
                  <Bot size={16} />
                  运行门禁审查
                </button>
              </form>
              {hasBrowserSession ? (
                <GateCommandPanel
                  projectId={project.id}
                  runId={run.id}
                  nodeId={target.commandNodeId}
                  expectedRunVersion={run.version}
                  evaluation={gateEvaluation}
                  initialCommands={gateCommands}
                  authority={{
                    canApprove,
                    canReject,
                    waitingLabel: `等待负责人审批（需要 ${requiredRoleLabel(node)}）。`,
                  }}
                  {...(material.status === 'missing' || material.status === 'stale'
                    ? { approvalUnavailableReason: `${material.label}；桌面端同步当前材料后刷新此页面` }
                    : {})}
                />
              ) : (
                <p className="studio-notice" role="note">登录浏览器身份后才能在 Web 上审批；审批权限也要登录后才能核实。</p>
              )}
            </>
          )
        })() : (
          <>
            <div className="studio-section-heading compact">
              <div>
                <span>审批</span>
                <h2>当前没有待审批的步骤</h2>
              </div>
            </div>
            <p>实际进度：{currentNode ? `${stepTitle(currentNode)}（${nodeStatusLabel(currentNode.status)}）` : '未记录'}。轮到审批时，这里会显示所审材料与审批入口。</p>
          </>
        )}
      </section>

      {deliverySection}

      <section className="studio-chain-panel" id="evidence-chain" aria-label="进度与材料">
        <div className="studio-section-heading">
          <div>
            <span>进度与材料</span>
            <h2>六个阶段的步骤</h2>
          </div>
          <div className="studio-progress">
            <span>{progress}%</span>
            <div>
              <i style={{ width: `${progress}%` }} />
            </div>
          </div>
        </div>
        <div className="studio-chain-list">
          {run.nodes.map((node) => (
            <EvidenceStep
              key={node.id}
              node={node}
              current={node.id === run.currentNodeId}
              evidenceCount={evidenceCountForNode(overview, run, node)}
            />
          ))}
        </div>
      </section>

      <section className="studio-support-grid" aria-label="执行摘要">
        <SupportPanel id="agents" icon={<Bot size={17} />} title="执行记录" action="只读摘要">
          {runtimes.length > 0 ? (
            runtimes.slice(0, 4).map((runtime) => (
              <CompactRow
                key={runtime.runtimeId}
                title={`Agent 执行 · ${runtime.nodeId}`}
                meta={`${runtime.counters.steps} 步 · ${runtime.counters.toolCalls} 次工具调用 · v${runtime.runtimeVersion}`}
                value={runtime.stopReason ?? runtime.status}
              />
            ))
          ) : codingRuns.length > 0 ? (
            codingRuns.slice(0, 4).map((codingRun) => (
              <CompactRow
                key={codingRun.id}
                title={providerNameById.get(codingRun.providerId) ?? '已保存的模型提供方'}
                meta={codingRun.summary}
                value={codingRun.status}
              />
            ))
          ) : (
            <CompactRow title="暂无执行记录" meta="桌面端上传开发执行后，这里显示脱敏的摘要" value="—" />
          )}
        </SupportPanel>

        <SupportPanel id="reviews" icon={<ShieldCheck size={17} />} title="门禁审查" action="只读摘要">
          {reviews.length > 0 ? (
            reviews.slice(0, 4).map((review) => (
              <CompactRow
                key={review.id}
                title={review.gateAdvisory.summary}
                meta={`${review.policyFindings.length} 条策略发现 · ${review.missingEvidence.length} 项缺失证据`}
                value={review.gateAdvisory.blocksApproval ? '阻断审批' : review.gateAdvisory.level === 'info' ? '提示' : '仅警告'}
              />
            ))
          ) : (
            <CompactRow title="暂无门禁审查" meta="运行门禁审查后，这里显示结论与缺失证据的数量" value="—" />
          )}
        </SupportPanel>

        <SupportPanel id="tests" icon={<TestTube2 size={17} />} title="测试证据" action="只读摘要">
          {evidence.length > 0 ? (
            evidence.slice(0, 4).map((item) => (
              <CompactRow key={item.id} title={item.summary} meta={item.command} value={item.status} />
            ))
          ) : (
            <CompactRow title="暂无测试证据" meta="运行测试后会显示命令、状态和脱敏摘要" value="—" />
          )}
        </SupportPanel>

        <SupportPanel id="memory" icon={<Database size={17} />} title="团队记忆" action="只读元数据">
          {memories.length > 0 ? (
            memories.slice(0, 4).map((memory) => (
              <CompactRow
                key={memory.memoryId}
                title={`记忆 · ${memory.nodeId}`}
                meta={`${memory.citationIds.length} 个引用 · ${memory.acceptedContextCount} 条已采纳上下文 · 质量 v${memory.qualityVersion} · 修订 ${memory.currentRevision}`}
                value={`${memory.visibility} · ${memory.sensitivity} · ${memory.retentionClass}`}
              />
            ))
          ) : (
            <CompactRow title="暂无团队记忆" meta="桌面端上传后只显示脱敏元数据与质量计数" value="—" />
          )}
        </SupportPanel>

        <SupportPanel id="coordination" icon={<Bot size={17} />} title="多 Agent 协作" action="只读元数据">
          {coordinations.length > 0 ? (
            coordinations.slice(0, 4).map((coordination) => (
              <CompactRow
                key={coordination.coordinationId}
                title={`协作 · ${coordination.nodeId}`}
                meta={`${coordination.taskCount} 个任务 · ${coordination.acceptedHandoffCount} 次交接 · ${coordination.latencyMs} ms · ${coordination.humanInterventionCount} 次人工介入`}
                value={coordination.stopReason ?? coordination.status}
              />
            ))
          ) : (
            <CompactRow title="暂无多 Agent 协作" meta="桌面端上传后只显示脱敏的生命周期、计数与比较指标" value="—" />
          )}
        </SupportPanel>

        <SupportPanel
          id="runtime"
          icon={<Gauge size={17} />}
          title="项目预算"
          action="预算设置"
          actionHref={studioHref(project.id, 'settings', 'budget')}
        >
          <div className="studio-budget-ring" style={{ '--budget-percent': `${Math.min(budgetPercent, 100)}%` } as CSSProperties}>
            <strong>{budgetPercent}%</strong>
            <span>{budgetPolicy ? `${formatUsd(projectSpend)} / ${formatUsd(budgetPolicy.monthlyLimitUsd)}` : '尚未配置'}</span>
          </div>
        </SupportPanel>

        <SupportPanel
          id="policy"
          icon={<AlertTriangle size={17} />}
          title="策略与警告"
          action="策略设置"
          actionHref={studioHref(project.id, 'settings', 'policy')}
        >
          <CompactRow
            title={
              policySummary
                ? `交付评估：${policySummary.blockedCount} 项阻断 · ${policySummary.warningCount} 条警告`
                : '所选项目还没有交付评估'
            }
            meta={`${policySummary?.retryAttemptCount ?? 0} 次重试 · ${policySummary?.overrideCount ?? 0} 次例外批准`}
            value=""
          />
          <strong>{overview.enforcementPolicies.organizationPolicy.name}</strong>
          <p>团队策略 v{overview.enforcementPolicies.organizationPolicy.version} · 桌面端更新团队数据后生效</p>
        </SupportPanel>
      </section>
    </section>
  )
}
