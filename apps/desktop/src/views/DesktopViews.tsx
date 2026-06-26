import { type Node, type NodeProps } from '@xyflow/react'
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  ClipboardCheck,
  Code2,
  GitPullRequest,
  Play,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type * as React from 'react'
import {
  canRunCodingAgentOnNode,
  formatUsd,
  knowledgeEntities,
  knowledgeRelations,
  type AgentEvent,
  type AgentReviewResult,
  type Artifact,
  type DataOrigin,
  type GateEnforcementDecision,
  type GateOverrideDecision,
  type KnowledgeDocument,
  type KnowledgeGovernanceCheck,
  type KnowledgeReference,
  type PolicySnapshot,
  type Project,
  type RemediationPlan,
  type TeamMember,
  type TestEvidence,
  type TokenUsageRollup,
  type WorkflowNode,
  type WorkflowRun,
} from '@ai-devflow/shared'
import { GateEnforcementPanel } from '../GateEnforcementPanel'
import {
  buildStatusDescriptors,
  buildWorkflowBoard,
  currentRunPhaseCopy,
  displayNodeSubtitle,
  displayNodeTitle,
  getBoardNodeKind,
  inspectorTabsByKind,
  matchesQuery,
  stageOrder,
  stageLabels,
  stageTone,
  type FieldDataSource,
  type SupportContext,
} from '../app/desktop-view-model'

export { AgentWorkbenchView } from './AgentWorkbenchView'
export { LocalProjectPanel, Metric, NavButton, ThemeToggle } from './ShellControls'
export { McpView, SkillView, TestsView } from './SupportViews'

export function AppNode({ data, selected }: NodeProps<Node<{ workflowNode: WorkflowNode }>>) {
  const workflowNode = data.workflowNode
  const statusLabel = {
    pending: 'Pending',
    running: 'Running',
    blocked: 'Gate',
    success: 'Done',
    failed: 'Failed',
    skipped: 'Skipped',
  }[workflowNode.status]

  return (
    <div
      className={`flow-node flow-node--${stageTone[workflowNode.stage]} flow-node--${workflowNode.status} ${selected ? 'is-selected' : ''}`}
      data-testid={`flow-node-${workflowNode.id}`}
    >
      <div className="flow-node__top">
        <span className="flow-node__stage">{stageLabels[workflowNode.stage]}</span>
        <span className="flow-node__status">{statusLabel}</span>
      </div>
      <strong>{displayNodeTitle(workflowNode)}</strong>
      <p>{displayNodeSubtitle(workflowNode)}</p>
      <div className="flow-node__meta">
        <span>{workflowNode.kind}</span>
        <span>{workflowNode.retryCount} retries</span>
      </div>
    </div>
  )
}


export function WorkflowBoard({
  run,
  artifacts,
  events,
  testEvidence,
  selectedNodeId,
  onSelectNode,
}: {
  run: WorkflowRun
  artifacts: Artifact[]
  events: AgentEvent[]
  testEvidence: TestEvidence[]
  selectedNodeId: string | undefined
  onSelectNode: (nodeId: string) => void
}) {
  const board = useMemo(
    () => buildWorkflowBoard({ run, artifacts, events, testEvidence }),
    [artifacts, events, run, testEvidence],
  )
  const currentNode = run.nodes.find((node) => node.id === run.currentNodeId)
  const currentCardTone =
    currentNode?.status === 'success'
      ? 'passed'
      : currentNode?.status === 'blocked' || currentNode?.status === 'failed'
        ? 'blocked'
        : 'current'

  return (
    <section className="canvas-panel workflow-panel" data-testid="workflow-canvas">
      <div className="panel-head workflow-head">
        <div>
          <span className="panel-title">Workflow Board</span>
          <span className="meta">当前 Run: {run.title}</span>
          <span className="meta">六阶段 delivery flow，节点选择会刷新右侧 Inspector</span>
        </div>
        <span className="pill warn">Gate 受 policy / review / evidence / role / budget 共同控制</span>
      </div>
      <div className="workflow-context">
        <strong>
          这个 Run 是后端 API 修改：Gate 当前卡在 Team policy snapshot、Knowledge Review 和 Test Evidence。
        </strong>
        <div className="flow-progress" aria-label="Run 流程进度">
          <div className="sequence-note">
            <strong>阶段主序列</strong>
            <p className="meta">Run 需要沿 01-06 推进；下游卡片可以先排队或准备，但阻断 Gate 没过时，不能算完成交付。</p>
            <div className="flow-rail" aria-hidden="true">
              {board.map((stage) => (
                <span key={stage.stage} className={`is-${stage.completionState}`} />
              ))}
            </div>
          </div>
          <div className={`flow-current-card flow-current-card--${currentCardTone}`}>
            <strong>当前位置</strong>
            <p className="meta">{currentRunPhaseCopy(run)}</p>
          </div>
        </div>
        <div className="board-semantics" aria-label="卡片阅读方式">
          <span className="semantic-chip"><strong>主卡片</strong>只放 Task / Gate / Review / Delivery Step</span>
          <span className="semantic-chip"><strong>卡片底部</strong>显示 Artifact / Evidence / Trace 摘要</span>
          <span className="semantic-chip"><strong>Inspector</strong>按节点类型显示不同诊断 tab</span>
        </div>
      </div>
      <div className="stage-grid" role="list" aria-label="Workflow stages">
        {board.map((stage) => (
          <section className="stage-column" key={stage.stage} aria-label={stage.label}>
            <div className="stage-heading">
              <span>{stage.index}</span>
              <strong>{stage.label}</strong>
              <em>{stage.completionLabel}</em>
            </div>
            <p className={`stage-provenance stage-provenance--${stage.completionState}`}>
              {stage.provenanceSummary}
            </p>
            <div className={`stage-progress stage-progress--${stage.completionState}`} />
            <div className="stage-cards">
              {stage.cards.map((card) => (
                <button
                  key={card.node.id}
                  className={`workflow-card workflow-card--${card.visualKind.toLowerCase()} workflow-card--${card.statusTone} ${
                    card.node.id === selectedNodeId ? 'is-selected' : ''
                  }`}
                  data-testid={`flow-node-${card.node.id}`}
                  onClick={() => onSelectNode(card.node.id)}
                >
                  <div className="row">
                    <span className="pill soft">{card.visualKind}</span>
                    <span className={`pill ${card.statusTone}`}>{card.statusLabel}</span>
                  </div>
                  <div className="card-provenance">
                    <span>{card.provenanceLabel}</span>
                  </div>
                  <strong>{displayNodeTitle(card.node)}</strong>
                  <p>{displayNodeSubtitle(card.node)}</p>
                  <div className="artifact-chip-row">
                    {card.attachmentChips.map((chip) => (
                      <span className={`artifact-chip ${chip.count > 0 ? 'is-filled' : ''}`} key={chip.kind}>
                        <strong>{chip.kind}</strong> {chip.label}
                      </span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  )
}

export function Inspector({
  selectedRun,
  selectedNode,
  isSelectedCurrentNode,
  artifacts,
  events,
  governanceChecks,
  references,
  latestAgentReview,
  supportContext,
  policySnapshot,
  gateEnforcementDecision,
  gateOverrides,
  remediationPlan,
  isLoadingGateEnforcement,
  canApprove,
  canSaveOverride,
  onApprove,
  onCompleteAgentNode,
  onSaveGateOverride,
  onStartRemediationRetry,
  pairingState,
  onSyncTeam,
  onOpenTests,
  onOpenKnowledgeReview,
  onOpenKnowledgeReference,
  onRunCodingAgent,
  onCreatePrDraft,
  onCreateAcceptanceBundle,
  isRunningTests,
  isRunningAgentReview,
  isStartingCodingAgent,
}: {
  selectedRun: WorkflowRun | undefined
  selectedNode: WorkflowNode | undefined
  isSelectedCurrentNode: boolean
  artifacts: Artifact[]
  events: AgentEvent[]
  governanceChecks: KnowledgeGovernanceCheck[]
  references: KnowledgeReference[]
  latestAgentReview: AgentReviewResult | undefined
  supportContext: SupportContext | null
  policySnapshot: PolicySnapshot | null
  gateEnforcementDecision: GateEnforcementDecision | null
  gateOverrides: GateOverrideDecision[]
  remediationPlan: RemediationPlan | null
  isLoadingGateEnforcement: boolean
  canApprove: boolean
  canSaveOverride: boolean
  onApprove: () => void
  onCompleteAgentNode: () => void
  onSaveGateOverride: (reason: string, provisional: boolean) => void
  onStartRemediationRetry: (candidateId: string) => void
  pairingState: 'unpaired' | 'paired' | 'sync_failed'
  onSyncTeam: () => void
  onOpenTests: () => void
  onOpenKnowledgeReview: () => void
  onOpenKnowledgeReference: (referenceId: string, documentId?: string) => void
  onRunCodingAgent: () => void
  onCreatePrDraft: () => void
  onCreateAcceptanceBundle: () => void
  isRunningTests: boolean
  isRunningAgentReview: boolean
  isStartingCodingAgent: boolean
}) {
  const [requestedTab, setRequestedTab] = useState('状态')

  useEffect(() => {
    if (
      !selectedRun ||
      !selectedNode ||
      !supportContext?.inspectorTab ||
      supportContext.runId !== selectedRun.id ||
      supportContext.nodeId !== selectedNode.id
    ) {
      return
    }

    setRequestedTab(supportContext.inspectorTab)
  }, [selectedNode, selectedRun, supportContext])

  if (!selectedNode) {
    return <aside className="inspector">请选择一个节点</aside>
  }

  const visualKind = getBoardNodeKind(selectedNode)
  const tabs = inspectorTabsByKind[visualKind]
  const activeTab = tabs.includes(requestedTab) ? requestedTab : tabs[0]
  const focusedArtifactId =
    supportContext?.focusTarget === 'artifact' &&
    supportContext.runId === selectedRun?.id &&
    supportContext.nodeId === selectedNode.id
      ? supportContext.artifactId
      : undefined
  const focusedEventId =
    supportContext?.focusTarget === 'event' &&
    supportContext.runId === selectedRun?.id &&
    supportContext.nodeId === selectedNode.id
      ? supportContext.eventId
      : undefined
  const statusDescriptors = buildStatusDescriptors({
    node: selectedNode,
    visualKind,
    artifacts,
    events,
    latestAgentReview,
    policySnapshot,
    gateEnforcementDecision,
    isLoadingGateEnforcement,
  })
  const hasTestArtifact = artifacts.some((artifact) => artifact.kind === 'test_report')
  const gateRequirementRows = [
    {
      label: 'Policy snapshot',
      state: isLoadingGateEnforcement
        ? 'loading'
        : policySnapshot
          ? `v${policySnapshot.version}`
          : gateEnforcementDecision?.status === 'blocked_policy_unavailable'
            ? 'unavailable'
            : 'not loaded',
      tone: policySnapshot ? 'good' : isLoadingGateEnforcement ? 'warn' : 'bad',
      summary: policySnapshot
        ? `${policySnapshot.source} · synced ${policySnapshot.syncedAt}`
        : 'Team policy snapshot 未加载时，Gate 写路径保持 hard-block。',
    },
    {
      label: 'Role permission',
      state: canApprove ? 'allowed' : 'lead required',
      tone: canApprove ? 'good' : 'warn',
      summary: canApprove ? '当前用户可执行 Gate approval。' : '当前用户无法直接 approve，需要 lead/reviewer 权限。',
    },
    {
      label: 'Knowledge Review',
      state: latestAgentReview ? 'ready' : 'missing',
      tone: latestAgentReview ? 'good' : 'bad',
      summary: latestAgentReview
        ? latestAgentReview.gateAdvisory.summary
        : '需要从 Agents 运行 review，生成 Gate Advisory 与引用来源。',
    },
    {
      label: 'Test Evidence',
      state: hasTestArtifact ? 'saved' : 'missing',
      tone: hasTestArtifact ? 'good' : 'warn',
      summary: hasTestArtifact ? '测试报告已归档为 Artifact。' : '需要从 Tests 保存 command/status/exit/duration 摘要。',
    },
    {
      label: 'Budget',
      state: selectedNode.stage === 'build' ? 'approval guarded' : 'not active',
      tone: selectedNode.stage === 'build' ? 'warn' : 'soft',
      summary: selectedNode.stage === 'build'
        ? '真实 runtime 超预算时必须等 lead approval id。'
        : '当前节点没有活跃 runtime budget 请求。',
    },
    {
      label: 'Required Artifact',
      state: artifacts.length > 0 ? `${artifacts.length} linked` : 'missing',
      tone: artifacts.length > 0 ? 'good' : 'soft',
      summary: artifacts.length > 0
        ? 'Artifact 作为 Gate / Delivery 的证据附件展示。'
        : '当前节点还没有可交付 Artifact。',
    },
  ]
  const nextActionTitle =
    selectedNode.status === 'blocked'
      ? selectedNode.kind === 'gate'
        ? '补齐设计假设、同步团队策略并运行 Knowledge Review'
        : '补齐当前节点阻断证据'
      : selectedNode.kind === 'pr'
        ? '生成 PR Draft 并核对 Evidence chain'
        : selectedNode.kind === 'acceptance'
          ? '汇总 Acceptance Bundle'
          : '推进当前 Run 的下一步'
  const nextActionCopy =
    selectedNode.kind === 'gate'
      ? 'Gate 会根据 Team policy、review、evidence、role、budget 写路径重新计算，不能只靠 UI 状态通过。'
      : '当前节点的 Artifact、Evidence 与 Trace 会在完成后回写到 Workbench Inspector。'

  const renderGovernance = () => (
    <div className="governance-list">
      <span className="panel-label">Knowledge Governance</span>
      {governanceChecks.length === 0 ? (
        <p className="empty-note">当前节点没有关联的知识治理检查。</p>
      ) : (
        governanceChecks.map((check) => {
          const supportingReference = check.referenceIds
            .map((referenceId) => references.find((reference) => reference.id === referenceId))
            .find(Boolean)

          return (
            <article
              className={`governance-card governance-card--${check.status}`}
              key={check.id}
            >
              <div className="compact-row">
                <strong>{check.title}</strong>
                <span>{check.status}</span>
              </div>
              <p>{check.summary}</p>
              <div className="knowledge-reference-meta">
                <code>{check.category}</code>
                {supportingReference?.strategy ? <span>{supportingReference.strategy}</span> : null}
                {typeof supportingReference?.score === 'number' ? (
                  <span>score {supportingReference.score}</span>
                ) : null}
                {supportingReference?.headingPath ? (
                  <span>{supportingReference.headingPath.join(' / ')}</span>
                ) : null}
                {supportingReference?.contentHash ? <code>{supportingReference.contentHash}</code> : null}
              </div>
              {supportingReference ? (
                <button
                  className="inline-link-button"
                  type="button"
                  onClick={() => onOpenKnowledgeReference(supportingReference.id, supportingReference.documentId)}
                >
                  查看引用来源
                </button>
              ) : null}
            </article>
          )
        })
      )}
    </div>
  )

  const renderArtifacts = () => (
    <div className="artifact-list">
      <span className="panel-label">Artifacts</span>
      {artifacts.length === 0 ? (
        <p className="empty-note">当前节点还没有 Artifact。</p>
      ) : (
        artifacts.map((artifact) => (
          <article
            key={artifact.id}
            className={`artifact-card ${artifact.id === focusedArtifactId ? 'is-focused' : ''}`}
            data-testid={artifact.id === focusedArtifactId ? 'focused-artifact' : undefined}
          >
            <strong>{artifact.title}</strong>
            <p>{artifact.summary}</p>
            <code>{artifact.content}</code>
          </article>
        ))
      )}
    </div>
  )

  const renderTrace = () => (
    <div className="event-list">
      <span className="panel-label">Trace</span>
      {events.length === 0 ? (
        <p className="empty-note">暂无 Event / Trace。</p>
      ) : (
        events.map((event) => (
          <div
            className={`event-row ${event.id === focusedEventId ? 'is-focused' : ''}`}
            data-testid={event.id === focusedEventId ? 'focused-event' : undefined}
            key={event.id}
          >
            <span>{event.kind}</span>
            <p>{event.message}</p>
          </div>
        ))
      )}
    </div>
  )

  const renderStatusMatrix = () => (
    <div className="status-matrix" data-testid="inspector-status-matrix">
      <span className="panel-label">状态矩阵</span>
      {statusDescriptors.map((descriptor) => (
        <article className={`status-row status-row--${descriptor.tone}`} key={descriptor.id}>
          <div>
            <strong>{descriptor.label}</strong>
            <p>{descriptor.summary}</p>
          </div>
          <div className="status-row__detail">
            <span className={`pill ${descriptor.tone}`}>{descriptor.state}</span>
            <small>{descriptor.impact}</small>
            <em>{descriptor.nextAction}</em>
          </div>
        </article>
      ))}
    </div>
  )

  const renderGateRequirementMatrix = () => (
    <div className="gate-requirement-matrix" data-testid="gate-requirement-matrix">
      <span className="panel-label">Gate 条件拆解</span>
      {gateRequirementRows.map((row) => (
        <div className="gate-requirement-row" key={row.label}>
          <strong>{row.label}</strong>
          <span className={`pill ${row.tone}`}>{row.state}</span>
          <p>{row.summary}</p>
        </div>
      ))}
    </div>
  )

  const renderDeliveryHandoff = () => (
    <div className="handoff-bundle" data-testid="delivery-handoff">
      <span className="panel-label">Delivery Handoff</span>
      <article className="mini-card">
        <div className="compact-row">
          <strong>PR Draft</strong>
          <span className="pill soft">{artifacts.some((artifact) => artifact.kind === 'pr') ? 'ready' : 'pending'}</span>
        </div>
        <p className="meta">汇总 diff、tests、policy、budget、review，作为 PR Delivery Gate 的交付摘要。</p>
      </article>
      <article className="mini-card">
        <div className="compact-row">
          <strong>Acceptance Bundle</strong>
          <span className="pill soft">{artifacts.some((artifact) => artifact.kind === 'acceptance') ? 'ready' : 'pending'}</span>
        </div>
        <p className="meta">把 request、PR、policy、budget、review、Evidence chain 和 Trace 汇总给业务验收。</p>
      </article>
      <div className="handoff-counts">
        <span><strong>{artifacts.length}</strong> artifacts</span>
        <span><strong>{events.length}</strong> trace events</span>
        <span><strong>{governanceChecks.length}</strong> governance checks</span>
      </div>
    </div>
  )

  const renderAgentReview = () => (
    <div className="agent-advisory-list">
      <span className="panel-label">Knowledge Review Agent</span>
      {latestAgentReview ? (
        <article className={`agent-advisory agent-advisory--${latestAgentReview.gateAdvisory.level}`}>
          <div className="compact-row">
            <strong>{latestAgentReview.model}</strong>
            <span>{Math.round(latestAgentReview.confidence * 100)}%</span>
          </div>
          <p>{latestAgentReview.gateAdvisory.summary}</p>
          <div className="knowledge-reference-meta">
            <span>{latestAgentReview.runtime}</span>
            <span>{latestAgentReview.providerId}</span>
            <span>{latestAgentReview.gateAdvisory.blocksApproval ? 'blocking' : 'warning-only'}</span>
          </div>
        </article>
      ) : (
        <p className="empty-note">还没有 Agent Review。运行后会生成可审计 trace 与 token cost。</p>
      )}
    </div>
  )

  return (
    <aside className="inspector" data-testid="node-inspector">
      <div className="panel-head panel-head--compact">
        <span className="panel-title">{displayNodeTitle(selectedNode)}</span>
        <span className={`pill ${selectedNode.status === 'blocked' ? 'bad' : selectedNode.status === 'success' ? 'good' : 'warn'}`}>
          {selectedNode.status}
        </span>
      </div>
      <div className="next-action">
        <p className="section-title">Next best action</p>
        <h3>{nextActionTitle}</h3>
        <p className="meta">{nextActionCopy}</p>
        <div className="row inspector-next-actions">
          <button
            className="primary-button"
            aria-label="Agent Review"
            disabled={isRunningAgentReview}
            onClick={onOpenKnowledgeReview}
          >
            <Bot size={16} />
            {isRunningAgentReview ? '审查中' : '去 Agents 运行 Review'}
          </button>
          <button className="ghost-button" aria-label="执行测试" disabled={isRunningTests} onClick={onOpenTests}>
            <Play size={16} />
            {isRunningTests ? '测试中' : '去 Tests 执行本地测试'}
          </button>
        </div>
      </div>
      <div className="tabbar" role="tablist" aria-label={`${visualKind} inspector tabs`}>
        {tabs.map((tab) => (
          <button
            key={tab}
            className={`tab ${tab === activeTab ? 'active' : ''}`}
            type="button"
            role="tab"
            aria-selected={tab === activeTab}
            onClick={() => setRequestedTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>
      <div className="inspector-scroll">
        {activeTab === '状态' ? (
          <>
            {renderStatusMatrix()}
            <div className="node-summary mini-card">
              <span>{stageLabels[selectedNode.stage]}</span>
              <strong>{visualKind}</strong>
              <p>{displayNodeSubtitle(selectedNode)}</p>
            </div>
            <GateEnforcementPanel
              policySnapshot={policySnapshot}
              decision={gateEnforcementDecision}
              overrides={gateOverrides}
              remediationPlan={remediationPlan}
              isLoading={isLoadingGateEnforcement}
              canSaveOverride={canSaveOverride}
              isStartingRetry={isStartingCodingAgent}
              onSaveOverride={onSaveGateOverride}
              onStartRetry={onStartRemediationRetry}
              pairingState={pairingState}
              onSyncTeam={onSyncTeam}
              onRunKnowledgeReview={onOpenKnowledgeReview}
              isCurrentNodeAgent={Boolean(
                selectedRun &&
                  selectedNode.kind === 'agent' &&
                  selectedRun.currentNodeId === selectedNode.id &&
                  selectedNode.status !== 'success',
              )}
            />
            {renderGovernance()}
            {renderAgentReview()}
            {renderArtifacts()}
          </>
        ) : null}
        {activeTab === 'Gate条件' || activeTab === 'Gate影响' || activeTab === 'Remediation' ? (
          <>
            {renderGateRequirementMatrix()}
            <GateEnforcementPanel
              policySnapshot={policySnapshot}
              decision={gateEnforcementDecision}
              overrides={gateOverrides}
              remediationPlan={remediationPlan}
              isLoading={isLoadingGateEnforcement}
              canSaveOverride={canSaveOverride}
              isStartingRetry={isStartingCodingAgent}
              onSaveOverride={onSaveGateOverride}
              onStartRetry={onStartRemediationRetry}
              pairingState={pairingState}
              onSyncTeam={onSyncTeam}
              onRunKnowledgeReview={onOpenKnowledgeReview}
              isCurrentNodeAgent={Boolean(
                selectedRun &&
                  selectedNode.kind === 'agent' &&
                  selectedRun.currentNodeId === selectedNode.id &&
                  selectedNode.status !== 'success',
              )}
            />
            {renderGovernance()}
          </>
        ) : null}
        {activeTab === '产物' || activeTab === 'Artifacts' ? renderArtifacts() : null}
        {activeTab === 'Evidence' || activeTab === '引用来源' ? (
          <>
            {renderGovernance()}
            {renderArtifacts()}
            {renderAgentReview()}
          </>
        ) : null}
        {activeTab === 'Knowledge Review' ? renderAgentReview() : null}
        {activeTab === 'Trace' ? renderTrace() : null}
        {activeTab === 'Handoff' ? (
          <>
            {renderDeliveryHandoff()}
            {renderTrace()}
          </>
        ) : null}

        <div className="inspector-actions">
          {selectedNode.kind === 'agent' && selectedNode.stage === 'clarify' && isSelectedCurrentNode ? (
            <button
              className="primary-button"
              data-testid="complete-clarify-agent"
              onClick={onCompleteAgentNode}
            >
              <Bot size={16} />
              生成需求澄清
            </button>
          ) : null}
          {selectedNode.kind === 'agent' && selectedNode.stage === 'design' && isSelectedCurrentNode ? (
            <button
              className="primary-button"
              data-testid="complete-design-agent"
              onClick={onCompleteAgentNode}
            >
              <Bot size={16} />
              生成设计方案
            </button>
          ) : null}
          <button className="primary-button" disabled={!canApprove} onClick={onApprove}>
            <CheckCircle2 size={16} />
            通过 Gate
          </button>
          {canRunCodingAgentOnNode(selectedNode) && (
            <button className="ghost-button" disabled={isStartingCodingAgent} onClick={onRunCodingAgent}>
              <Code2 size={16} />
              {isStartingCodingAgent ? '启动中' : 'Coding Agent'}
            </button>
          )}
          {selectedNode.kind === 'pr' && (
            <button className="ghost-button" onClick={onCreatePrDraft}>
              <GitPullRequest size={16} />
              生成 PR Draft
            </button>
          )}
          {selectedNode.kind === 'acceptance' && (
            <button className="ghost-button" onClick={onCreateAcceptanceBundle}>
              <ClipboardCheck size={16} />
              生成验收证据包
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}

export function TeamOverview({
  projects,
  members,
  projectRollups,
  memberRollups,
  totalCost,
  dataOrigin,
  runtimeDataSource,
  selectedRun,
  policySnapshot,
  gateEnforcementDecision,
  isLoadingGateEnforcement,
}: {
  projects: Project[]
  members: TeamMember[]
  projectRollups: TokenUsageRollup[]
  memberRollups: TokenUsageRollup[]
  totalCost: string
  dataOrigin: DataOrigin
  runtimeDataSource: FieldDataSource
  selectedRun: WorkflowRun | undefined
  policySnapshot: PolicySnapshot | null
  gateEnforcementDecision: GateEnforcementDecision | null
  isLoadingGateEnforcement: boolean
}) {
  const memberSummary = members.map((member) => `${member.name} ${member.role}`).join(' · ')
  const projectCostById = new Map(projectRollups.map((rollup) => [rollup.key, rollup]))
  const memberTokens = memberRollups.reduce((sum, rollup) => sum + rollup.totalTokens, 0)
  const snapshotSource = policySnapshot?.source ?? gateEnforcementDecision?.policySource ?? 'unavailable'
  const snapshotVersion = policySnapshot?.version ?? gateEnforcementDecision?.policyVersion
  const snapshotStatus = isLoadingGateEnforcement
    ? 'loading'
    : gateEnforcementDecision?.status ?? 'not loaded'
  const snapshotTone =
    snapshotStatus === 'pass' || snapshotStatus === 'overridden'
      ? 'good'
      : snapshotStatus === 'warn'
        ? 'warn'
        : snapshotStatus === 'not loaded'
          ? 'soft'
          : 'bad'

  return (
    <section className="route-page team-page" data-testid="team-overview">
      <div className="panel">
        <div className="panel-head">
            <span className="panel-title">Team Overview · redacted delivery health</span>
            <div className="row">
              <span className="pill soft">团队视图只看脱敏摘要，不展示本地 raw log</span>
              <span className={`pill ${runtimeDataSource.tone}`} title={runtimeDataSource.detail}>
                {runtimeDataSource.label}
              </span>
              <span className="pill accent">{dataOrigin}</span>
            </div>
          </div>
        <div className="panel-body">
          <strong className="sr-copy">项目交付健康</strong>
          <table className="table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Repository</th>
                <th>Health</th>
                <th>Test command</th>
                <th>Active / Latest Run</th>
                <th>Gate</th>
                <th>Rollup</th>
                <th>Members</th>
                <th>Token / Cost</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => {
                const rollup = projectCostById.get(project.id)

                return (
                  <tr key={project.id}>
                    <td><strong>{project.name}</strong></td>
                    <td className="mono">{project.repository}</td>
                    <td><span className={`pill ${project.health === 'on_track' ? 'good' : project.health === 'blocked' ? 'bad' : 'warn'}`}>{project.health}</span></td>
                    <td className="mono">{project.testCommand}</td>
                    <td>{project.id === 'p-payments' ? '为 Payments API 增加 /health 端点' : '优化空搜索结果提示文案'}</td>
                    <td>
                      <span className={`pill ${project.id === selectedRun?.projectId ? snapshotTone : project.health === 'blocked' ? 'bad' : 'good'}`}>
                        {project.id === selectedRun?.projectId ? snapshotStatus : project.health === 'blocked' ? 'blocked' : 'passed'}
                      </span>
                    </td>
                    <td>
                      {project.id === selectedRun?.projectId
                        ? `${gateEnforcementDecision?.blockingReasons.length ?? 0} block · ${gateEnforcementDecision?.warningReasons.length ?? 0} warn · ${gateEnforcementDecision?.requiredActions.length ?? 0} actions`
                        : 'policy ok · tests passed · review warn'}
                    </td>
                    <td>{memberSummary}</td>
                    <td>{rollup ? `${rollup.totalTokens.toLocaleString()} · ${formatUsd(rollup.costUsd)}` : `0 · ${totalCost}`}</td>
                    <td><span className="pill accent">{project.id === selectedRun?.projectId ? snapshotSource : 'seed'}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="member-roster" aria-label="Team members">
            {members.map((member) => (
              <span className="pill soft" key={member.id}>{member.name}</span>
            ))}
          </div>
        </div>
      </div>

      <div className="page-grid two policy-layout">
        <section className="panel">
          <div className="panel-head">
            <span className="panel-title">Team Project Settings / Policy</span>
            <span className="pill accent">admin config</span>
          </div>
          <div className="panel-body stack">
            <div className="policy-callout">
              <div className="row">
                <strong>策略归属：Team Project · Payments API</strong>
                <span className="pill warn">不是 Local Project 配置</span>
              </div>
              <p className="meta">这里定义 Gate policy、角色权限、预算和必需 Evidence。Workbench、Inspector、Agents、Tests 只读取 policy snapshot 并解释阻断原因，不能在 Run 内临时改规则。</p>
            </div>
            <div className="policy-matrix" aria-label="Gate policy matrix">
              <div className="policy-row header"><span>Stage / Gate</span><span>Review</span><span>Evidence</span><span>Approver</span></div>
              <div className="policy-row"><strong>方案评审 Gate</strong><span className="pill warn">required</span><span className="pill warn">brief</span><span>lead</span></div>
              <div className="policy-row"><strong>开发实现 Gate</strong><span className="pill soft">advisory</span><span className="pill warn">diff + trace</span><span>lead</span></div>
              <div className="policy-row"><strong>测试证据 Gate</strong><span className="pill soft">optional</span><span className="pill warn">passing / failed saved</span><span>reviewer</span></div>
              <div className="policy-row"><strong>PR Delivery Gate</strong><span className="pill warn">required</span><span className="pill warn">PR draft + tests</span><span>lead</span></div>
              <div className="policy-row"><strong>业务验收 Gate</strong><span className="pill soft">manual</span><span className="pill warn">accept bundle</span><span>owner</span></div>
            </div>
            <div className="mini-card">
              <p className="section-title">Budget Guard</p>
              <div className="row"><strong>真实 runtime 启动前审批</strong><span className="pill warn">over budget approval</span></div>
              <p className="meta">单 Run soft limit $4.00；超过时 Coding Agent 只能等待 lead approval，不能靠 Workbench UI 直接绕过。</p>
            </div>
            <button className="primary-button">保存 Team Policy 草稿</button>
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <span className="panel-title">Policy Snapshot · desktop read path</span>
            <span className={`pill ${snapshotTone}`}>{snapshotStatus}</span>
          </div>
          <div className="panel-body stack">
            <div className="policy-source-grid">
              <div className="policy-source-row">
                <strong>Source</strong>
                <span>
                  {policySnapshot
                    ? `${snapshotSource} snapshot v${snapshotVersion} · synced ${policySnapshot.syncedAt}`
                    : 'policy snapshot 尚未加载，Gate 写路径会保持只读阻断'}
                </span>
                <span className={`pill ${snapshotTone}`}>{snapshotStatus}</span>
              </div>
              <div className="policy-source-row">
                <strong>Selected Run</strong>
                <span>{selectedRun?.title ?? 'No selected Run'} · {selectedRun?.projectId ?? 'no project'}</span>
                <span className="pill soft">{snapshotVersion ? `policy v${snapshotVersion}` : 'not loaded'}</span>
              </div>
              <div className="policy-source-row"><strong>Used by</strong><span>Workbench Inspector · Agents Gate Advisory · Tests Evidence rollup</span><span className="pill soft">read only</span></div>
              <div className="policy-source-row"><strong>Not used by</strong><span>Local Project config、test command、managed worktree 设置</span><span className="pill soft">separate</span></div>
            </div>
            <div className="mini-card soft">
              <p className="section-title">同步团队后发生什么</p>
              <ul>
                <li>拉取 Team Project policy snapshot。</li>
                <li>刷新 Team Overview 的 policy / budget / Gate rollup。</li>
                <li>重新评估当前 Run 的 Gate 条件，但不会自动通过缺少 review 或 tests 的 Gate。</li>
                <li>写入 Event / Trace，说明本机使用了哪一版 policy。</li>
              </ul>
            </div>
            <button className="ghost-button">同步团队并刷新 snapshot</button>
            <div className="compact-row">
              <span>Total cost</span>
              <strong>{totalCost}</strong>
            </div>
            <div className="compact-row">
              <span>Member tokens</span>
              <strong>{memberTokens.toLocaleString()}</strong>
            </div>
          </div>
        </section>
      </div>
    </section>
  )
}

export function KnowledgeView({
  query,
  documents,
  references,
  selectedRun,
  supportContext,
  focusedDocumentId,
  focusedReferenceId,
  dataSource,
  onReturnToInspector,
}: {
  query: string
  documents: KnowledgeDocument[]
  references: KnowledgeReference[]
  selectedRun: WorkflowRun | undefined
  supportContext: SupportContext | null
  focusedDocumentId: string | undefined
  focusedReferenceId: string | undefined
  dataSource: FieldDataSource
  onReturnToInspector: () => void
}) {
  const documentById = new Map(documents.map((document) => [document.id, document]))
  const visibleDocuments = documents
    .filter((document) =>
      document.id === focusedDocumentId ||
      matchesQuery(query, [
        document.title,
        document.category,
        document.summary,
        document.sourcePath,
        ...document.tags,
      ]),
    )
    .sort((left, right) => Number(right.id === focusedDocumentId) - Number(left.id === focusedDocumentId))
  const visibleEntities = knowledgeEntities.filter((entity) =>
    matchesQuery(query, [entity.label, entity.kind, entity.sourcePath]),
  )
  const visibleEntityIds = new Set(visibleEntities.map((entity) => entity.id))
  const visibleRelations = knowledgeRelations.filter((relation) =>
    !query ||
    visibleEntityIds.has(relation.source) ||
    visibleEntityIds.has(relation.target) ||
    matchesQuery(query, [relation.label, relation.source, relation.target]),
  )

  return (
    <section className="page-grid" data-testid="knowledge-view">
      <div className="page-main">
        <div className="section-heading">
          <span>Knowledge Governance</span>
          <strong>Git Markdown Index</strong>
          <span className={`pill ${dataSource.tone}`} data-testid="knowledge-data-source" title={dataSource.detail}>
            {dataSource.label}
          </span>
        </div>
        <p className="empty-note knowledge-source-note">{dataSource.status} · {dataSource.detail}</p>
        {supportContext?.focusTarget === 'knowledge-reference' ? (
          <div className="support-context-banner" data-testid="support-context-banner">
            <div>
              <span className="panel-label">来自 Workbench Inspector</span>
              <strong>{supportContext.label}</strong>
              <p>查看引用来源后可返回当前 Run / Node，继续处理 Gate 条件。</p>
            </div>
            <button className="ghost-button" type="button" onClick={onReturnToInspector}>
              <ArrowLeft size={16} />
              返回当前 Inspector
            </button>
          </div>
        ) : null}
        {visibleDocuments.length === 0 ? (
          <p className="empty-note">没有匹配的知识文档</p>
        ) : (
          <div className="knowledge-doc-list">
            {visibleDocuments.map((document) => (
              <article
                className={`knowledge-doc-card ${document.id === focusedDocumentId ? 'is-focused' : ''}`}
                data-testid={document.id === focusedDocumentId ? 'focused-knowledge-document' : undefined}
                key={document.id}
              >
                <div>
                  <span>{document.category}</span>
                  <strong>{document.title}</strong>
                </div>
                <p>{document.summary}</p>
                <code>{document.sourcePath}</code>
                <div className="tag-list">
                  {document.tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}

        <div className="section-heading section-heading--inline">
          <span>Knowledge Graph</span>
          <strong>轻量知识图谱</strong>
        </div>
        <div className="knowledge-map">
          {visibleEntities.length === 0 ? (
            <p className="empty-note">没有匹配的知识节点</p>
          ) : (
            visibleEntities.map((entity, index) => (
              <div
                key={entity.id}
                className={`knowledge-node knowledge-node--${entity.kind}`}
                style={{ left: `${18 + index * 20}%`, top: `${24 + (index % 2) * 34}%` }}
              >
                <strong>{entity.label}</strong>
                <span>{entity.kind}</span>
              </div>
            ))
          )}
          {visibleRelations.map((relation) => (
            <div className="relation-row" key={relation.id}>
              {relation.source} {relation.label} {relation.target}
            </div>
          ))}
        </div>
      </div>
      <aside className="page-side">
        <strong>Git + Markdown 真源</strong>
        <p>知识库保留在项目仓库，平台只负责索引、图谱、检索和 Run 证据回链。</p>
        <strong>Run references</strong>
        <p>{selectedRun?.title ?? 'No selected Run'}</p>
        {references.length === 0 ? (
          <p className="empty-note">当前 Run 尚未匹配到知识引用。</p>
        ) : (
          references.slice(0, 8).map((reference) => {
            const document = documentById.get(reference.documentId)

            return (
              <article
                className={`reference-row ${reference.id === focusedReferenceId ? 'is-focused' : ''}`}
                data-testid={reference.id === focusedReferenceId ? 'focused-knowledge-reference' : undefined}
                key={reference.id}
              >
                <span>{reference.targetType}</span>
                <strong>{reference.relation}</strong>
                <p>{document?.title ?? reference.documentId}</p>
                <div className="knowledge-reference-meta">
                  {reference.strategy ? <span>{reference.strategy}</span> : null}
                  {typeof reference.score === 'number' ? <span>score {reference.score}</span> : null}
                  {reference.headingPath ? <span>{reference.headingPath.join(' / ')}</span> : null}
                </div>
                <code>{reference.artifactId ?? reference.evidenceId ?? reference.nodeId ?? reference.runId}</code>
                {reference.contentHash ? <code>{reference.contentHash}</code> : null}
              </article>
            )
          })
        )}
      </aside>
    </section>
  )
}
