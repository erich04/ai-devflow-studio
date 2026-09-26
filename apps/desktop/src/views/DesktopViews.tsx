import { type Node, type NodeProps } from '@xyflow/react'
import { ReviewEvidenceDetails, type RecordReviewFeedback } from '../components/ReviewEvidenceDetails'
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  ClipboardCheck,
  ChevronDown,
  Code2,
  GitPullRequest,
  Play,
  RefreshCw,
  Square,
} from 'lucide-react'
import { ArtifactReviewReader } from '../components/ArtifactReviewReader'
import { ArtifactBody, partitionArtifact, hasSectionContent } from '../components/ArtifactBody'
import { GateMaterialReader } from '../components/GateMaterialReader'
import { Fragment, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import type * as React from 'react'
import {
  buildClarificationReviewBundle,
  formatUsd,
  formatCostRollup,
  projectKnowledgeReferencesForNode,
  resolveKnowledgeReferenceSemantics,
  type AgentEvent,
  type AgentReviewResult,
  type Artifact,
  type CodingRuntimeReadiness,
  type DataOrigin,
  type GateEnforcementDecision,
  type GateOverrideDecision,
  type GitHubDeliveryIntent,
  type GitHubDeliveryOperatorOutcome,
  type GitHubDeliveryRevocationCheck,
  type KnowledgeDocument,
  type KnowledgeEntity,
  type KnowledgeGovernanceCheck,
  type KnowledgeReference,
  type KnowledgeRelation,
  type RepositoryKnowledgeWarning,
  type PolicySnapshot,
  type Project,
  type RemediationPlan,
  type TeamMember,
  type TestEvidence,
  type TokenUsageRollup,
  type WorkflowNode,
  type WorkflowRun,
  type StageAgentExecutorKind,
} from '@ai-devflow/shared'
import { GateEnforcementPanel, GateRemediationPanel } from '../GateEnforcementPanel'
import { GitHubDeliveryPanel } from '../GitHubDeliveryPanel'
import { buildCodingReadinessDisplay } from '../app/coding-runtime-readiness-view-model'
import type { CodingRuntimeActionProjection } from '../app/coding-runtime-action-projection'
import {
  buildWorkflowNodePresentation,
  buildWorkflowBoard,
  currentRunPhaseCopy,
  displayNodeSubtitle,
  displayNodeTitle,
  getNodeStatusTone,
  matchesQuery,
  stageOrder,
  stageLabels,
  stageTone,
  type FieldDataSource,
  type SupportContext,
} from '../app/desktop-view-model'
import {
  buildNodeInspectorViewModel,
  selectInspectorPrPackage,
  type InspectorAction,
  type InspectorActionDisabledReason,
  type InspectorActionId,
  type InspectorSectionId,
  type PendingInspectorAction,
} from '../app/node-inspector-view-model'
import { buildWorkflowGateImpact } from '../app/workflow-gate-impact'

export { AgentWorkbenchView } from './AgentWorkbenchView'
export { LocalProjectPanel, Metric, NavButton, ThemeToggle } from './ShellControls'
export { McpView, SkillView, TestsView } from './SupportViews'

export function AppNode({ data, selected }: NodeProps<Node<{ workflowNode: WorkflowNode }>>) {
  const workflowNode = data.workflowNode
  const presentation = buildWorkflowNodePresentation(workflowNode)

  return (
    <div
      className={`flow-node flow-node--${stageTone[workflowNode.stage]} flow-node--${workflowNode.status} ${selected ? 'is-selected' : ''}`}
      data-testid={`flow-node-${workflowNode.id}`}
    >
      <div className="flow-node__top">
        <span className="flow-node__stage">{stageLabels[workflowNode.stage]}</span>
        <span className="flow-node__status">{presentation.statusLabel}</span>
      </div>
      <strong>{displayNodeTitle(workflowNode)}</strong>
      <p>{displayNodeSubtitle(workflowNode)}</p>
      <div className="flow-node__meta">
        <span>{presentation.nodeKindLabel}</span>
        <span>来源：{presentation.sourceLabel}</span>
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
  onSelectAttachment,
  onDiscuss,
}: {
  run: WorkflowRun
  artifacts: Artifact[]
  events: AgentEvent[]
  testEvidence: TestEvidence[]
  selectedNodeId: string | undefined
  onSelectNode: (nodeId: string) => void
  onSelectAttachment: (nodeId: string, tab: string) => void
  onDiscuss?: (node: WorkflowNode) => void
}) {
  const [boardView, setBoardView] = useState<'compact' | 'flow' | 'list'>('compact')
  const board = useMemo(
    () => buildWorkflowBoard({ run, artifacts, events, testEvidence }),
    [artifacts, events, run, testEvidence],
  )
  const currentNode = run.nodes.find((node) => node.id === run.currentNodeId)
  const browsingStage = run.nodes.find((node) => node.id === selectedNodeId)?.stage ?? currentNode?.stage
  const viewedStage = board.find((stage) => stage.stage === browsingStage)
  const currentCardTone =
    currentNode?.status === 'success'
      ? 'passed'
      : currentNode?.status === 'blocked' || currentNode?.status === 'failed'
        ? 'blocked'
        : 'current'

  return (
    <section className={`canvas-panel workflow-panel unified-workflow workflow-view--${boardView}`} data-testid="workflow-canvas">
      <div className="panel-head workflow-head">
        <div>
          <span className="panel-title">工作流看板</span>
          <span className="meta">当前 Run: {run.title}</span>
        </div>
        <div className="workflow-view-switch" role="group" aria-label="看板展示方式">
          <button aria-pressed={boardView === 'compact'} onClick={() => setBoardView('compact')}>精简导航</button>
          <button aria-pressed={boardView === 'flow'} onClick={() => setBoardView('flow')}>流程视图</button>
          <button aria-pressed={boardView === 'list'} onClick={() => setBoardView('list')}>列表视图</button>
        </div>
      </div>
      <div className="workflow-navigation-scroll" tabIndex={0} aria-label="浏览流程导航">
      <nav className="workflow-stage-navigation" aria-label="六阶段导航">
        {board.map((stage, index) => <div className="workflow-stage-step" key={stage.stage}>
          <button className={`stage-nav--${stage.completionState}`} aria-current={currentNode?.stage === stage.stage ? 'step' : undefined}
            aria-pressed={browsingStage === stage.stage} aria-controls={`${boardView === 'compact' ? 'workflow-stage-nodes' : `workflow-stage-${stage.stage}`} workbench-node-reader`} disabled={!stage.cards.length}
            title={`${stage.label}：${stage.completedNodeCount}/${stage.cards.length} 个节点已完成；点击查看本阶段`}
            onClick={() => {
              const target = stage.cards.find((card) => card.node.id === run.currentNodeId) ?? stage.cards[0]
              if (target) onSelectNode(target.node.id)
            }}>
            <span className="stage-nav-index">{stage.index}</span><strong>{stage.label}</strong>
            <small>{browsingStage === stage.stage ? '正在查看 · ' : ''}{currentNode?.stage === stage.stage && stage.completionState === 'current' ? '当前进度' : stage.completionLabel} · {stage.completedNodeCount}/{stage.cards.length}</small>
            {browsingStage === stage.stage && <ChevronDown className="stage-selection-pointer" size={14} aria-hidden="true" />}
          </button>
          {index < board.length - 1 && <div className="stage-progress-link" role="progressbar" aria-label={`${stage.label}阶段进度`}
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={stage.progressPercent}
            aria-valuetext={`${stage.completedNodeCount}/${stage.cards.length} 个节点已完成${currentNode?.stage === stage.stage ? `，当前：${displayNodeTitle(currentNode)}` : ''}`}>
            <span style={{ width: `${stage.progressPercent}%` }} />
          </div>}
        </div>)}
      </nav>
      {boardView === 'compact' && <div id="workflow-stage-nodes" className="workflow-node-navigation" role="region" aria-label="当前查看阶段的节点">
        <div className="workflow-viewed-stage"><small>正在查看</small><strong>{viewedStage?.index} · {viewedStage?.label}</strong></div>
        <div className="workflow-node-buttons">
          {viewedStage?.cards.map((card) => <button key={card.node.id}
            data-testid={`flow-node-${card.node.id}`} aria-pressed={card.node.id === selectedNodeId} aria-controls="workbench-node-reader"
            onClick={() => onSelectNode(card.node.id)}><strong>{displayNodeTitle(card.node)}</strong><span>{card.statusLabel}</span></button>)}
        </div>
        <div className="workflow-actual-progress">
          <span>{currentNode ? `实际进度：${stageLabels[currentNode.stage]} · ${displayNodeTitle(currentNode)}` : currentRunPhaseCopy(run)}</span>
          {currentNode && selectedNodeId !== currentNode.id && <button onClick={() => onSelectNode(currentNode.id)}>返回当前进度</button>}
        </div>
      </div>}
      {boardView !== 'compact' && <><div className="workflow-context">
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
        <details className="board-semantics-help"><summary>查看卡片说明</summary><div className="board-semantics" aria-label="卡片阅读方式">
          <span className="semantic-chip"><strong>节点类型</strong>Task / Gate / Test / Delivery / Acceptance</span>
          <span className="semantic-chip"><strong>节点来源</strong>与展示方式分开标注</span>
          <span className="semantic-chip"><strong>卡片底部</strong>点击产物 / 测试证据 / 轨迹计数查看当前节点内容</span>
          <span className="semantic-chip"><strong>节点详情</strong>按节点类型显示不同诊断 tab</span>
        </div></details>
      </div>
      <div className="stage-grid" role="list" aria-label="Workflow stages">
        {board.map((stage) => (
          <section id={`workflow-stage-${stage.stage}`} className="stage-column" key={stage.stage} aria-label={stage.label}>
            <div className="stage-heading">
              <span>{stage.index}</span>
              <strong>{stage.label}</strong>
              <em>{stage.completionLabel}</em>
            </div>
            <div
              className={`stage-provenance stage-provenance--${stage.completionState}`}
              data-testid={`stage-summary-${stage.stage}`}
            >
              {stage.summary.totalNodeCount === 0 ? (
                <span>当前阶段没有节点</span>
              ) : (
                <>
                  <span>
                    节点：{stage.summary.nodeKinds.map((item) => `${item.label} ${item.count}`).join(' · ')}
                  </span>
                  <span title="节点由哪个工作流来源提供">
                    来源：{stage.summary.sources.map((item) => `${item.label} ${item.count}`).join(' · ')}
                  </span>
                  {stage.summary.specialDisplayModes.length ? (
                    <span title="仅列出非标准的特殊展示方式">
                      展示：{stage.summary.specialDisplayModes.map((item) => `${item.label} ${item.count}`).join(' · ')}
                    </span>
                  ) : null}
                </>
              )}
            </div>
            <div className={`stage-progress stage-progress--${stage.completionState}`} />
            <div className="stage-cards">
              {stage.cards.map((card) => (
                <article
                  key={card.node.id}
                  className={`workflow-card workflow-card--${card.visualKind.toLowerCase()} workflow-card--${card.statusTone} ${
                    card.node.id === selectedNodeId ? 'is-selected' : ''
                  }`}
                  data-testid={`workflow-card-${card.node.id}`}
                >
                  <button
                    className="workflow-card-main"
                    type="button"
                    data-testid={`flow-node-${card.node.id}`}
                    aria-pressed={card.node.id === selectedNodeId}
                    onClick={() => onSelectNode(card.node.id)}
                  >
                    <div className="row">
                      <span className="pill soft" title="节点类型">{card.presentation.nodeKindLabel}</span>
                      <span className={`pill ${card.statusTone}`}>{card.statusLabel}</span>
                    </div>
                    <div className="card-provenance">
                      <span title="节点来源">来源：{card.presentation.sourceLabel}</span>
                      {card.presentation.displayMode === 'folded' ? (
                        <span title="展示方式">展示：{card.presentation.displayModeLabel}</span>
                      ) : null}
                    </div>
                    <strong>{displayNodeTitle(card.node)}</strong>
                    <p>{displayNodeSubtitle(card.node)}</p>
                  </button>
                  <div className="artifact-chip-row">
                    {card.attachmentChips.map((chip) => (
                      <button
                        type="button"
                        className={`artifact-chip ${chip.count > 0 ? 'is-filled' : ''}`}
                        key={chip.kind}
                        aria-label={`${displayNodeTitle(card.node)}：${chip.label} ${chip.count}`}
                        onClick={() => onSelectAttachment(card.node.id, chip.label)}
                      >
                        <strong>{chip.label}</strong> {chip.count}
                      </button>
                    ))}
                  </div>
                  {onDiscuss && <button className="workflow-discuss" aria-label={`讨论：${displayNodeTitle(card.node)}`} onClick={() => onDiscuss(card.node)}>讨论此问题 ↗</button>}
                </article>
              ))}
            </div>
          </section>
        ))}
      </div></>}
      </div>
    </section>
  )
}

export function Inspector({
  modelReadinessError,
  selectedRun,
  selectedNode,
  isSelectedCurrentNode,
  artifacts,
  workflowArtifacts,
  events,
  testEvidence,
  governanceChecks,
  references,
  latestAgentReview,
  onRecordAgentReviewFeedback,
  onDiscussReview,
  supportContext,
  onConsumeSupportContext,
  policySnapshot,
  gateEnforcementDecision,
  gateOverrides,
  remediationPlan,
  isLoadingGateEnforcement,
  canApprove,
  canSaveOverride,
  onApprove,
  onCompleteAgentNode,
  onRequestClarificationChanges,
  stageProviders = [],
  stageProviderId = '',
  onStageProviderChange = () => undefined,
  onCancelStageAgent,
  stageAgentExecutorKind = 'direct-provider',
  onStageAgentExecutorKindChange = () => undefined,
  onSaveGateOverride,
  onStartRemediationRetry,
  pairingState,
  hasDeliveryProjectBinding,
  onSyncTeam,
  onOpenTests,
  onOpenKnowledgeReview,
  onOpenKnowledgeReference,
  onRunCodingAgent,
  onOpenCodingAgent,
  onCreatePrDraft,
  onPrepareGitHubDelivery,
  onReviseGitHubDelivery,
  onRetryGitHubDelivery,
  onResumeGitHubDelivery,
  onStopGitHubDelivery,
  onVerifyGitHubDeliveryRevocation,
  onCreateAcceptanceBundle,
  onSelectWorkflowNode,
  selectedGitHubDeliveryIntent,
  selectedGitHubDeliveryOperatorOutcome,
  selectedGitHubDeliveryRevocationCheck,
  canVerifyGitHubDeliveryRevocation,
  isRunningTests,
  isRunningAgentReview,
  isStartingCodingAgent,
  pendingInspectorAction,
  codingReadiness,
  codingReadinessError,
  onOpenCodingConfiguration,
  codingActionProjection,
  upstreamCodingDiffReady,
}: {
  modelReadinessError?: string | undefined
  selectedRun: WorkflowRun | undefined
  selectedNode: WorkflowNode | undefined
  isSelectedCurrentNode: boolean
  artifacts: Artifact[]
  workflowArtifacts: Artifact[]
  events: AgentEvent[]
  testEvidence: TestEvidence[]
  governanceChecks: KnowledgeGovernanceCheck[]
  references: KnowledgeReference[]
  latestAgentReview: AgentReviewResult | undefined
  onDiscussReview?: ((prompt: string) => void) | undefined
  onRecordAgentReviewFeedback?: RecordReviewFeedback | undefined
  supportContext: SupportContext | null
  onConsumeSupportContext?: () => void
  policySnapshot: PolicySnapshot | null
  gateEnforcementDecision: GateEnforcementDecision | null
  gateOverrides: GateOverrideDecision[]
  remediationPlan: RemediationPlan | null
  isLoadingGateEnforcement: boolean
  canApprove: boolean
  canSaveOverride: boolean
  onApprove: () => void
  onCompleteAgentNode: () => void
  onRequestClarificationChanges?: (reason: string) => void
  stageProviders?: Array<{ id: string; name: string; model: string }>
  stageProviderId?: string
  onStageProviderChange?: (providerId: string) => void
  onCancelStageAgent?: (() => void) | undefined
  stageAgentExecutorKind?: StageAgentExecutorKind
  onStageAgentExecutorKindChange?: (kind: StageAgentExecutorKind) => void
  onSaveGateOverride: (reason: string) => void
  onStartRemediationRetry: (candidateId: string) => void
  pairingState: 'unpaired' | 'paired' | 'sync_failed'
  hasDeliveryProjectBinding: boolean
  onSyncTeam: () => void
  onOpenTests: () => void
  onOpenKnowledgeReview: () => void
  onOpenKnowledgeReference: (referenceId: string, documentId?: string) => void
  onRunCodingAgent: () => void
  onOpenCodingAgent?: () => void
  onCreatePrDraft: () => void
  onPrepareGitHubDelivery: () => void
  onReviseGitHubDelivery: () => void
  onRetryGitHubDelivery: () => void
  onResumeGitHubDelivery: () => void
  onStopGitHubDelivery: () => void
  onVerifyGitHubDeliveryRevocation: () => void
  onCreateAcceptanceBundle: () => void
  onSelectWorkflowNode: (nodeId: string) => void
  selectedGitHubDeliveryIntent: GitHubDeliveryIntent | undefined
  selectedGitHubDeliveryOperatorOutcome?: GitHubDeliveryOperatorOutcome
  selectedGitHubDeliveryRevocationCheck?: GitHubDeliveryRevocationCheck
  canVerifyGitHubDeliveryRevocation: boolean
  isRunningTests: boolean
  isRunningAgentReview: boolean
  isStartingCodingAgent: boolean
  pendingInspectorAction: PendingInspectorAction | null
  codingReadiness: CodingRuntimeReadiness | null
  codingReadinessError: string
  onOpenCodingConfiguration: () => void
  codingActionProjection?: CodingRuntimeActionProjection
  upstreamCodingDiffReady?: boolean
}) {
  const [requestedTab, setRequestedTab] = useState('状态')
  const [revisionDraftError, setRevisionDraftError] = useState('')
  const [documentId, setDocumentId] = useState('')
  const [revisionFormOpen, setRevisionFormOpen] = useState(false)
  const [revisionDrafts, setRevisionDrafts] = useState<Record<string, string>>(() => {
    try { const parsed: unknown = JSON.parse(localStorage.getItem('devflow-revision-drafts') ?? '{}'); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === 'string')) as Record<string, string> : {} } catch { return {} }
  })
  // Reset the node workspace before paint so a newly visible tab cannot lose its first click.
  useLayoutEffect(() => {
    setRequestedTab(selectedNode?.status === 'success' && selectedNode.kind === 'agent' ? '内容与审查' : '概览'); setDocumentId(''); setRevisionFormOpen(false)
  }, [selectedNode?.id])

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
    onConsumeSupportContext?.()
  }, [onConsumeSupportContext, selectedNode, selectedRun, supportContext])

  if (!selectedNode) {
    return <aside className="inspector">请选择一个节点</aside>
  }

  const reviewSubjectArtifactIds = latestAgentReview?.contextManifest?.subjectArtifacts.map(
    (artifact) => artifact.id,
  ) ?? selectedNode.artifactIds
  const nodeArtifacts = workflowArtifacts.filter((artifact) =>
    artifact.runId === selectedRun?.id && artifact.nodeId === selectedNode.id,
  )
  const scopedReferences = projectKnowledgeReferencesForNode({
    node: selectedNode,
    references: latestAgentReview?.knowledgeReferences ?? references,
    subjectArtifactIds: reviewSubjectArtifactIds,
    testEvidenceIds: testEvidence.map((evidence) => evidence.id),
  })
  const viewModel = buildNodeInspectorViewModel({
    node: selectedNode,
    requestedTab,
    isSelectedCurrentNode,
    artifacts,
    events,
    knowledgeReferenceCount: scopedReferences.length,
    testEvidenceCount: testEvidence.length,
    testEvidence,
    latestAgentReview,
    policySnapshot,
    gateEnforcementDecision,
    isLoadingGateEnforcement,
    canApprove,
    upstreamCodingDiffReady: upstreamCodingDiffReady ?? false,
    hasTeamProjectBinding: hasDeliveryProjectBinding,
    canVerifyGitHubDeliveryRevocation,
    ...(codingActionProjection ? { codingActionProjection } : {}),
    ...(selectedGitHubDeliveryIntent
      ? { githubDeliveryIntent: selectedGitHubDeliveryIntent }
      : {}),
    ...(selectedGitHubDeliveryOperatorOutcome
      ? { githubDeliveryOperatorOutcome: selectedGitHubDeliveryOperatorOutcome }
      : {}),
  })
  const gateImpact = selectedRun
    ? buildWorkflowGateImpact({ run: selectedRun, node: selectedNode, artifacts: workflowArtifacts })
    : { state: 'none' as const, summary: '当前节点不影响后续 Gate。' }
  const clarificationReview =
    selectedRun && selectedNode.kind === 'gate' && selectedNode.stage === 'clarify'
      ? buildClarificationReviewBundle({
          run: selectedRun,
          gateNode: selectedNode,
          artifacts: workflowArtifacts,
        })
      : undefined
  const revisionDraftKey = clarificationReview?.activeRevision?.id ?? ''
  const clarificationFeedbackDraft = revisionDrafts[revisionDraftKey] ?? ''
  const setClarificationFeedbackDraft = (text: string) => {
    setRevisionDraftError('')
    const next = { ...revisionDrafts, [revisionDraftKey]: text }
    setRevisionDrafts(next)
    try { localStorage.setItem('devflow-revision-drafts', JSON.stringify(next)) } catch { setRevisionDraftError('本地草稿保存失败，当前页面仍保留文字；请复制后再关闭应用。') }
  }
  const revisionLine = (index: number) => `审查意见 ${index + 1}（${latestAgentReview?.id}）：${latestAgentReview?.missingEvidence[index] ?? ''}`
  const selectedReviewItems = latestAgentReview?.missingEvidence.flatMap((_, index) => clarificationFeedbackDraft.includes(revisionLine(index)) ? [index] : []) ?? []
  const olderDrafts = clarificationReview?.revisions.filter((revision) => revision.id !== revisionDraftKey && revisionDrafts[revision.id]?.trim()) ?? []
  const contentArtifacts = (selectedNode.kind === 'gate'
    ? [...workflowArtifacts.filter((artifact) => selectedNode.artifactIds.includes(artifact.id)), ...nodeArtifacts]
    : nodeArtifacts).filter((artifact, index, all) => all.findIndex((other) => other.id === artifact.id) === index)
  const selectedDocument = contentArtifacts.find((artifact) => artifact.id === documentId) ?? contentArtifacts[0]
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
  const actionHandlers: Record<InspectorActionId, () => void> = {
    openKnowledgeReview: onOpenKnowledgeReview,
    openTests: onOpenTests,
    completeAgent: onCompleteAgentNode,
    approveGate: onApprove,
    runCodingAgent: onRunCodingAgent,
    openCodingAgent: onOpenCodingAgent ?? onOpenCodingConfiguration,
    createPrDraft: onCreatePrDraft,
    prepareGitHubDelivery: onPrepareGitHubDelivery,
    reviseGitHubDelivery: onReviseGitHubDelivery,
    retryGitHubDelivery: onRetryGitHubDelivery,
    resumeGitHubDelivery: onResumeGitHubDelivery,
    stopGitHubDelivery: onStopGitHubDelivery,
    verifyGitHubDeliveryRevocation: onVerifyGitHubDeliveryRevocation,
    createAcceptanceBundle: onCreateAcceptanceBundle,
  }
  const writeActionIds = new Set<InspectorActionId>([
    'completeAgent',
    'approveGate',
    'runCodingAgent',
    'createPrDraft',
    'prepareGitHubDelivery',
    'reviseGitHubDelivery',
    'retryGitHubDelivery',
    'resumeGitHubDelivery',
    'stopGitHubDelivery',
    'verifyGitHubDeliveryRevocation',
    'createAcceptanceBundle',
  ])
  const hasPendingInspectorAction = Boolean(pendingInspectorAction)
  const pendingMatchesSelectedNode = Boolean(
    pendingInspectorAction &&
      selectedRun &&
      pendingInspectorAction.runId === selectedRun.id &&
      pendingInspectorAction.nodeId === selectedNode.id,
  )
  const hasInspectorWriteLock =
    hasPendingInspectorAction ||
    isRunningAgentReview ||
    isStartingCodingAgent ||
    isRunningTests
  const isDisabledReasonActive = (reason: InspectorActionDisabledReason) => {
    return {
      running_agent_review: isRunningAgentReview,
      running_tests: isRunningTests,
      requires_current_node: !isSelectedCurrentNode,
      gate_permission_missing: !canApprove,
      starting_coding_agent: isStartingCodingAgent,
      team_project_binding_missing: !hasDeliveryProjectBinding,
    }[reason]
  }
  const isActionWriteLocked = (action: InspectorAction) => writeActionIds.has(action.id) && hasInspectorWriteLock
  const isActionDisabled = (action: InspectorAction) =>
    action.disabledReasons.some((reason) => isDisabledReasonActive(reason)) ||
    isActionWriteLocked(action) ||
    (action.id === 'runCodingAgent' && codingReadiness?.status !== 'ready')
  const actionTitle = (action: InspectorAction) => {
    if (isActionWriteLocked(action) && !action.disabledReasons.some((reason) => isDisabledReasonActive(reason))) {
      return pendingMatchesSelectedNode ? '当前节点操作正在进行中' : '其他 Inspector 操作正在进行中'
    }
    if (action.disabledReasons.includes('team_project_binding_missing') && !hasDeliveryProjectBinding) {
      return '先绑定当前 Local Project 与 Team Project'
    }
    if (action.id === 'runCodingAgent' && codingReadiness?.status !== 'ready') {
      return codingReadiness?.checks.find((check) => check.status === 'blocked')?.message ??
        codingReadinessError ??
        '正在读取 Coding Runtime Readiness'
    }
    return undefined
  }
  const actionLabel = (action: InspectorAction) => {
    if (pendingMatchesSelectedNode && pendingInspectorAction?.actionId === action.id) {
      if (action.id === 'approveGate') {
        return '审批中'
      }
      if (action.id === 'completeAgent' || action.id === 'createPrDraft' || action.id === 'createAcceptanceBundle') {
        return '生成中'
      }
      if (action.id === 'prepareGitHubDelivery') {
        return '准备中'
      }
      if (action.id === 'reviseGitHubDelivery') {
        return '修订中'
      }
      if (action.id === 'retryGitHubDelivery') {
        return '重试中'
      }
      if (action.id === 'resumeGitHubDelivery') {
        return '恢复中'
      }
      if (action.id === 'stopGitHubDelivery') {
        return '停止中'
      }
      if (action.id === 'verifyGitHubDeliveryRevocation') {
        return '验证中'
      }
    }
    if (action.id === 'openKnowledgeReview' && isRunningAgentReview) {
      return '门禁审查中'
    }
    if (action.id === 'openTests' && isRunningTests) {
      return '测试中'
    }
    if (action.id === 'runCodingAgent' && isStartingCodingAgent) {
      return '启动中'
    }
    return action.label
  }
  const actionAriaLabel = (action: InspectorAction) => {
    if (action.id === 'openKnowledgeReview') {
      return '运行门禁审查'
    }
    if (action.id === 'openTests') {
      return '执行测试'
    }
    return undefined
  }
  const renderActionIcon = (actionId: InspectorActionId) => {
    switch (actionId) {
      case 'openKnowledgeReview':
      case 'completeAgent':
        return <Bot size={16} />
      case 'openTests':
        return <Play size={16} />
      case 'approveGate':
        return <CheckCircle2 size={16} />
      case 'runCodingAgent':
      case 'openCodingAgent':
        return <Code2 size={16} />
      case 'createPrDraft':
        return <GitPullRequest size={16} />
      case 'prepareGitHubDelivery':
      case 'reviseGitHubDelivery':
      case 'retryGitHubDelivery':
      case 'resumeGitHubDelivery':
      case 'verifyGitHubDeliveryRevocation':
        return <RefreshCw size={16} />
      case 'stopGitHubDelivery':
        return <Square size={16} />
      case 'createAcceptanceBundle':
        return <ClipboardCheck size={16} />
    }
  }
  const renderActionButton = (action: InspectorAction, variant: InspectorAction['variant'] = action.variant) => (
    <button
      className={`${variant}-button`}
      data-testid={action.testId}
      aria-label={actionAriaLabel(action)}
      aria-busy={pendingMatchesSelectedNode && pendingInspectorAction?.actionId === action.id ? true : undefined}
      disabled={isActionDisabled(action) || (Boolean(modelReadinessError) && ['completeAgent','runCodingAgent'].includes(action.id))}
      key={action.id}
      title={actionTitle(action)}
      onClick={() => actionHandlers[action.id]()}
    >
      {renderActionIcon(action.id)}
      {actionLabel(action)}
    </button>
  )
  const primaryNextAction = viewModel.nextAction.primaryActionId
    ? viewModel.actionCatalog[viewModel.nextAction.primaryActionId]
    : undefined
  const secondaryNextActions = viewModel.nextAction.secondaryActionIds
    .filter((actionId) => actionId !== viewModel.nextAction.primaryActionId)
    .map((actionId) => viewModel.actionCatalog[actionId])
  const codingReadinessDisplay = codingReadiness
    ? buildCodingReadinessDisplay(codingReadiness)
    : null
  const exposesCodingAction = primaryNextAction?.id === 'runCodingAgent' ||
    primaryNextAction?.id === 'openCodingAgent' ||
    secondaryNextActions.some((action) => action.id === 'runCodingAgent' || action.id === 'openCodingAgent')

  const retrievalStrategyLabel = (reference: KnowledgeReference) => ({
    heuristic: '启发式检索',
    lexical: '词法检索',
    vector: '向量语义检索',
    hybrid: '混合检索',
  } as const)[reference.strategy ?? 'lexical']
  const renderReferenceSemantics = (reference: KnowledgeReference) => {
    const semantics = resolveKnowledgeReferenceSemantics(reference)
    const evidenceStatus = ({
      retrieval_candidate: '检索候选',
      reviewed_reference: '已审查引用',
      supports_finding: '支持审查结论',
      rejected: '审查未采用',
    } as const)[semantics.gateEvidence.status]

    return (
      <div className="knowledge-reference-meta" data-testid="knowledge-reference-semantics">
        <span>{retrievalStrategyLabel(reference)}</span>
        {semantics.lexicalMatch ? (
          <span title="原始关键词累加分；无固定满分，不能跨查询比较，也不是语义或 Gate 合规评分。">
            关键词匹配分 {semantics.lexicalMatch.rawScore}（原始累加）
          </span>
        ) : null}
        {semantics.lexicalMatch?.matchedTerms.length ? (
          <span>命中词：{semantics.lexicalMatch.matchedTerms.join('、')}</span>
        ) : null}
        {semantics.semanticRelevance ? (
          <span>语义相关性 {semantics.semanticRelevance.score}</span>
        ) : (
          <span>未进行语义相关性判断</span>
        )}
        <span>Gate 使用状态：{evidenceStatus}</span>
      </div>
    )
  }

  const renderGovernance = () => (
    <div className="governance-list">
      <span className="panel-label">Knowledge Governance</span>
      <p className="empty-note">Knowledge 是 Gate 审查依据；Gate 条件和阶段产物才是审查对象。</p>
      <ol className="knowledge-governance-flow" aria-label="Knowledge Governance 状态链" data-testid="knowledge-governance-flow">
        <li className={scopedReferences.length > 0 || governanceChecks.length > 0 ? 'is-complete' : 'is-pending'}>
          <strong>1 · 找到候选</strong>
          <span>{scopedReferences.length > 0 || governanceChecks.length > 0 ? `${Math.max(scopedReferences.length, governanceChecks.length)} 个` : '尚未找到'}</span>
        </li>
        <li className={latestAgentReview ? 'is-complete' : 'is-pending'}>
          <strong>2 · 完成审查</strong>
          <span>{latestAgentReview ? '已完成' : '尚未执行'}</span>
        </li>
        <li className={(latestAgentReview?.knowledgeReferences.length ?? 0) > 0 ? 'is-complete' : 'is-pending'}>
          <strong>3 · 可用于 Gate</strong>
          <span>{(latestAgentReview?.knowledgeReferences.length ?? 0) > 0 ? `${latestAgentReview!.knowledgeReferences.length} 条已确认引用` : '暂无已确认引用'}</span>
        </li>
      </ol>
      {governanceChecks.length === 0 ? (
        <p className="empty-note">当前节点没有关联的知识治理检查。</p>
      ) : (
        governanceChecks.map((check) => {
          const supportingReference = check.referenceIds
            .map((referenceId) => scopedReferences.find((reference) => reference.id === referenceId))
            .find(Boolean)

          return (
            <article
              className={`governance-card governance-card--${check.status}`}
              key={check.id}
            >
              <div className="compact-row">
                <strong>{check.title}</strong>
                <span>{({ satisfied: '已满足', needs_evidence: '缺少证据', violated: '不符合' } as const)[check.status]}</span>
              </div>
              <p>{check.summary}</p>
              <details className="governance-technical-details">
                <summary>查看候选详情</summary>
                <div className="knowledge-reference-meta">
                  <code>{check.category}</code>
                  {supportingReference ? renderReferenceSemantics(supportingReference) : null}
                  {supportingReference?.headingPath ? (
                    <span>{supportingReference.headingPath.join(' / ')}</span>
                  ) : null}
                  {supportingReference?.contentHash ? <code>{supportingReference.contentHash}</code> : null}
                </div>
              </details>
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
    <div className="artifact-list" data-testid="node-artifacts">
      <span className="panel-label">当前节点产物 · {nodeArtifacts.length}</span>
      {selectedNode.kind === 'gate' && contentArtifacts.some((artifact) => artifact.nodeId !== selectedNode.id) && <section aria-label="关联的上游产物"><h3>关联的上游产物（不计入本节点数量）</h3>{contentArtifacts.filter((artifact) => artifact.nodeId !== selectedNode.id).map((artifact) => <p key={artifact.id}><button className="text-button" onClick={() => { setDocumentId(artifact.id); setRequestedTab('内容与审查') }}>{artifact.title}</button> · {artifact.updatedAt}</p>)}</section>}
      {nodeArtifacts.length === 0 ? (
        <p className="empty-note">当前节点尚未归档产物。</p>
      ) : (
        nodeArtifacts.map((artifact) => (
          <article
            key={artifact.id}
            className={`artifact-card ${artifact.id === focusedArtifactId ? 'is-focused' : ''}`}
            data-testid={artifact.id === focusedArtifactId ? 'focused-artifact' : undefined}
          >
            <strong>{artifact.title}</strong>
            <p>{artifact.summary}</p>
            <button className="text-button" onClick={() => { setDocumentId(artifact.id); setRequestedTab('内容与审查') }}>阅读正文</button>
            {partitionArtifact(artifact.content).some((section) => section.group === 'evidence' && hasSectionContent(section)) && <ArtifactBody content={artifact.content} kind={artifact.kind} section="evidence" />}
            {artifact.designEvidence ? <details><summary>设计输入与代码核验依据</summary>
              <p>已批准澄清：{artifact.designEvidence.clarification.artifactId} · {artifact.designEvidence.clarification.legacy ? '旧版已审批产物' : `第 ${artifact.designEvidence.clarification.revision} 版`}</p>
              <p>执行工具：{artifact.designEvidence.executor.kind === 'local-agent' ? 'OpenCode（只读分析）' : 'Direct Provider'} · 模型：{artifact.designEvidence.executor.model}</p>
              <p>输入正文摘要：{artifact.designEvidence.clarification.contentDigest}</p>
              {artifact.designEvidence.repositoryFindings ? <>
                <p>仓库摘要：{artifact.designEvidence.repositoryFindings.repositoryDigest}</p>
                <ul>{artifact.designEvidence.repositoryFindings.verifiedFacts.map((fact) => <li key={fact.id}>{fact.statement} · 引用 {fact.citationIds.join(', ')}</li>)}</ul>
                <ul>{artifact.designEvidence.repositoryFindings.citations.map((citation) => <li key={citation.id}>{citation.path}{citation.lineStart ? `:${citation.lineStart}` : ''} · {citation.contentDigest}</li>)}</ul>
                <p>未核验范围：{artifact.designEvidence.repositoryFindings.uncheckedScopes.join('；') || '执行器未报告额外范围'}</p>
              </> : <p>本次未执行仓库代码核验。</p>}
            </details> : null}
          </article>
        ))
      )}
      {latestAgentReview && <section aria-label="已归档的审查报告"><h3>审查报告</h3><p>{latestAgentReview.conclusion}</p><p>{latestAgentReview.summary}</p><button className="text-button" onClick={() => setRequestedTab('内容与审查')}>阅读审查报告与意见</button></section>}
    </div>
  )

  const renderKnowledgeReferences = () => (
    <div className="artifact-list" data-testid="knowledge-reference-sources">
      <span className="panel-label">引用来源 · Review Criteria</span>
      <p className="empty-note">
        这里仅展示 Knowledge / Policy 来源。引用用于支持审查，不等于 Artifact、Test Evidence 或 Gate 通过结论。
      </p>
      {scopedReferences.length === 0 ? (
        <p className="empty-note">当前 Gate 尚无节点作用域内的 Knowledge 引用。</p>
      ) : (
        scopedReferences.map((reference) => (
          <article className="artifact-card" key={reference.id}>
            <div className="compact-row">
              <strong>{reference.sourcePath ?? reference.documentId}</strong>
              <span className="pill soft">{reference.relation}</span>
            </div>
            <p>{reference.reason}</p>
            {renderReferenceSemantics(reference)}
            <div className="knowledge-reference-meta">
              <code>reference {reference.id}</code>
              <code>document {reference.documentId}</code>
              {reference.chunkId ? <code>chunk {reference.chunkId}</code> : null}
              {reference.category ? <span>{reference.category}</span> : null}
              {reference.headingPath?.length ? <span>{reference.headingPath.join(' / ')}</span> : null}
              {reference.contentHash ? <code>{reference.contentHash}</code> : null}
            </div>
            <button
              className="inline-link-button"
              type="button"
              onClick={() => onOpenKnowledgeReference(reference.id, reference.documentId)}
            >
              查看引用来源
            </button>
          </article>
        ))
      )}
    </div>
  )

  const renderReviewEvidence = () => {
    const subjectManifest = latestAgentReview?.contextManifest?.subjectArtifacts ?? []
    const subjectArtifacts = reviewSubjectArtifactIds.flatMap((artifactId) => {
      const artifact = workflowArtifacts.find((candidate) => candidate.id === artifactId)
      return artifact && artifact.nodeId !== selectedNode.id ? [artifact] : []
    })
    if (!subjectArtifacts.length && !latestAgentReview) return null

    return (
      <div className="artifact-list" data-testid="review-evidence-results">
        <span className="panel-label">关联审查内容</span>
        <p className="empty-note">
          审查结论与被审查的上游产物供核对，不另计入当前节点产物数量；知识依据保留在“产物与证据”。
        </p>
        {subjectArtifacts.map((artifact) => {
          const manifest = subjectManifest.find((candidate) => candidate.id === artifact.id)
          return (
            <article className="artifact-card" key={artifact.id}>
              <div className="compact-row">
                <strong>{artifact.title}</strong>
                <span className="pill soft">Review Subject</span>
              </div>
              <p>{artifact.summary}</p>
              <div className="knowledge-reference-meta">
                <code>{artifact.id}</code>
                <span>{artifact.kind}</span>
                <span>revision {manifest?.updatedAt ?? artifact.updatedAt}</span>
                {manifest?.contentDigest ? <code>{manifest.contentDigest}</code> : <span>legacy digest unavailable</span>}
                <span>coverage {manifest?.coverage ?? 'legacy_unverifiable'}</span>
              </div>
            </article>
          )
        })}
        {latestAgentReview ? (
          <article className={`agent-advisory agent-advisory--${latestAgentReview.gateAdvisory.level}`}>
            <div className="compact-row">
              <strong>{latestAgentReview.conclusion}</strong>
              <span>{Math.round(latestAgentReview.confidence * 100)}%</span>
            </div>
            <p>{latestAgentReview.summary}</p>
            <div className="knowledge-reference-meta">
              <code>{latestAgentReview.id}</code>
              <span>{latestAgentReview.gateAdvisory.blocksApproval ? 'blocking' : 'warning-only'}</span>
              <span>{latestAgentReview.policyFindings.length} policy finding(s)</span>
            </div>
            {latestAgentReview.policyFindings.map((finding) => (
              <p key={finding.id}>{finding.severity} · {finding.category} · {finding.summary}</p>
            ))}
            <ReviewEvidenceDetails key={latestAgentReview.id} review={latestAgentReview} onFeedback={onRecordAgentReviewFeedback} />
          </article>
        ) : null}
      </div>
    )
  }

  const renderTestEvidence = () => {
    const nodeEvidence = testEvidence.filter((evidence) =>
      evidence.runId === selectedRun?.id && evidence.nodeId === selectedNode.id,
    )
    const deliveryEvidence = selectedGitHubDeliveryIntent
      ? testEvidence.find((evidence) => evidence.runId === selectedRun?.id &&
          evidence.id === selectedGitHubDeliveryIntent.testEvidenceId && evidence.nodeId !== selectedNode.id)
      : undefined
    return (
      <div className="artifact-list" data-testid="node-test-evidence">
        <span className="panel-label">当前节点测试证据 · {nodeEvidence.length}</span>
        {nodeEvidence.length === 0 ? <p className="empty-note">当前节点尚未归档测试证据。</p> : null}
        {nodeEvidence.map((evidence) => (
          <article className="artifact-card" key={evidence.id}>
            <div className="compact-row">
              <strong>测试结果</strong>
              <span className={`pill ${evidence.status === 'passed' ? 'good' : evidence.status === 'running' ? 'warn' : 'bad'}`}>
                {evidence.status}
              </span>
            </div>
            <p>{evidence.summary}</p>
            <div className="knowledge-reference-meta">
              <code>{evidence.id}</code><code>{evidence.command}</code>
              <span>{evidence.durationMs}ms</span><span>Exit code {evidence.exitCode ?? 'unknown'}</span>
            </div>
            <button className="text-button" onClick={() => setRequestedTab('执行记录')}>查看测试日志</button>
          </article>
        ))}
        {deliveryEvidence ? (
          <section className="artifact-card" data-testid="linked-delivery-test-evidence">
            <strong>本次交付引用的上游测试</strong>
            <p>{deliveryEvidence.summary}</p>
            <p className="empty-note">归档在上游节点，不计入当前节点数量。</p>
            <button type="button" className="inline-link-button" onClick={() => onSelectWorkflowNode(deliveryEvidence.nodeId)}>
              查看测试所属节点
            </button>
          </section>
        ) : null}
      </div>
    )
  }

  const renderTrace = () => (
    <div className="event-list" data-testid="node-trace">
      {codingActionProjection?.terminal && <section><h3>开发执行详情</h3><p>执行器 {codingActionProjection.terminal.providerId} · 用量 {codingActionProjection.terminal.totalTokens ?? '未提供'} · 费用 {typeof codingActionProjection.terminal.costUsd === 'number' ? formatUsd(codingActionProjection.terminal.costUsd) : '未提供'} · 工作区清理 {codingActionProjection.terminal.workspaceCleanupStatus}</p><ol aria-label="Coding Run terminal trace">{codingActionProjection.terminal.trace.map((event) => <li key={event.id}><span>{event.kind}</span> · {event.message}</li>)}</ol></section>}
      {testEvidence.filter((evidence) => evidence.runId === selectedRun?.id && evidence.nodeId === selectedNode.id).map((evidence) => <details key={evidence.id}><summary>测试日志 · {evidence.command} · {evidence.status}</summary><p>{evidence.id} · 退出码 {evidence.exitCode ?? '未提供'}</p><h4>标准输出</h4><pre>{evidence.stdout || '未提供输出'}</pre><h4>错误输出</h4><pre>{evidence.stderr || '未提供错误输出'}</pre></details>)}
      <span className="panel-label">当前节点轨迹 · {events.length}</span>
      {events.length === 0 ? (
        <p className="empty-note">当前节点尚无执行轨迹。</p>
      ) : (
        events.map((event) => (
          <div
            className={`event-row ${event.id === focusedEventId ? 'is-focused' : ''}`}
            data-testid={event.id === focusedEventId ? 'focused-event' : undefined}
            key={event.id}
          >
            <span>{event.kind}</span>
            <p>{event.message}</p><time>{event.timestamp}</time>
          </div>
        ))
      )}
    </div>
  )

  const renderStatusMatrix = () => (
    <div className="status-matrix" data-testid="inspector-status-matrix">
      <span className="panel-label">{viewModel.gateReadinessSummary ? '审批核对清单' : '节点就绪情况'}</span>
      {viewModel.gateReadinessSummary ? (
        <>
          {viewModel.gateReadinessGroups.map((group) => (
            <details
              className={`status-group status-group--${group.state}`}
              data-testid={`readiness-group-${group.id}`}
              key={group.id}
              open={group.defaultOpen}
            >
              <summary>
                <strong>{group.label}</strong>
                <span>{({ passed: '✓ 已通过', warning: '⚠ 有警告', missing: '○ 有缺失', blocked: '⛔ 已阻断' } as const)[group.state]}</span>
              </summary>
              <div className="status-group__content">
                {group.descriptors.map((descriptor) => (
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
            </details>
          ))}
        </>
      ) : viewModel.statusDescriptors.map((descriptor) => (
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
      {viewModel.gateRequirementRows.map((row) => (
        <div className="gate-requirement-row" key={row.label}>
          <strong>{row.label}</strong>
          <span className={`pill ${row.tone}`}>{row.state}</span>
          <p>{row.summary}</p>
        </div>
      ))}
    </div>
  )

  const handoffPrPackage = selectInspectorPrPackage({
    node: selectedNode,
    artifacts: workflowArtifacts,
    ...(selectedGitHubDeliveryIntent ? { githubDeliveryIntent: selectedGitHubDeliveryIntent } : {}),
  })
  const renderDeliveryHandoff = () => (
    <div className="handoff-bundle" data-testid="delivery-handoff">
      <span className="panel-label">Delivery Handoff</span>
      <GitHubDeliveryPanel
        intent={selectedGitHubDeliveryIntent}
        {...(selectedGitHubDeliveryOperatorOutcome
          ? { operatorOutcome: selectedGitHubDeliveryOperatorOutcome }
          : {})}
        {...(selectedGitHubDeliveryRevocationCheck
          ? { revocationCheck: selectedGitHubDeliveryRevocationCheck }
          : {})}
        surface={selectedNode.kind === 'acceptance' ? 'acceptance' : 'pr'}
        hasExactPrPackage={handoffPrPackage?.redacted === true && handoffPrPackage.githubDeliverySource?.stateVersion === 1}
      />
      <article className="mini-card">
        <div className="compact-row">
          <strong>PR Delivery Package</strong>
          <span className="pill soft">{handoffPrPackage ? 'ready' : 'pending'}</span>
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
      <span className="panel-label">基于知识的门禁审查</span>
      {latestAgentReview ? (
        <article className={`agent-advisory agent-advisory--${latestAgentReview.gateAdvisory.level}`}>
          <div className="compact-row">
            <strong>{latestAgentReview.model}</strong>
            <span>{Math.round(latestAgentReview.confidence * 100)}%</span>
          </div>
          <p>{latestAgentReview.gateAdvisory.summary}</p>
          <ReviewEvidenceDetails key={latestAgentReview.id} review={latestAgentReview} onFeedback={onRecordAgentReviewFeedback} />
          <div className="knowledge-reference-meta">
            <span>{latestAgentReview.runtime}</span>
            <span>已保存 Provider</span>
            <span>{latestAgentReview.gateAdvisory.blocksApproval ? 'blocking' : 'warning-only'}</span>
          </div>
        </article>
      ) : (
        <p className="empty-note">尚未运行门禁审查。系统会以 Knowledge 与规范为依据，审查当前 Gate 条件和阶段产物。</p>
      )}
    </div>
  )

  const renderNodeSummary = () => (
    <div className="node-summary mini-card">
      <span>{viewModel.header.stageLabel}</span>
      <strong>类型：{viewModel.header.presentation.nodeKindLabel}</strong>
      <span>来源：{viewModel.header.presentation.sourceLabel}</span>
      {viewModel.header.presentation.displayMode === 'folded' ? (
        <span>展示：{viewModel.header.presentation.displayModeLabel}</span>
      ) : null}
      <p>{viewModel.header.subtitle}</p>
    </div>
  )

  const renderGateImpactSummary = () => (
    <div className="gate-impact-summary" data-testid="gate-impact-summary">
      <span className="panel-label">Gate 影响</span>
      {gateImpact.state === 'none' ? (
        <p className="empty-note">{gateImpact.summary}</p>
      ) : (
        <article className="mini-card gate-impact-card">
          <div className="compact-row">
            <div>
              <span className="meta">{gateImpact.relationshipLabel}</span>
              <strong>{gateImpact.gateTitle}</strong>
            </div>
            <div className="row">
              {gateImpact.isCurrentStep ? <span className="pill warn">当前步骤</span> : null}
              <span className={`pill ${getNodeStatusTone(gateImpact.gateStatus)}`}>
                {gateImpact.gateStatusLabel}
              </span>
            </div>
          </div>
          <div className="gate-impact-artifacts">
            <strong>已向 Gate 提供的产物</strong>
            {gateImpact.linkedArtifacts.length ? (
              <ul>
                {gateImpact.linkedArtifacts.map((artifact) => (
                  <li key={artifact.id}>
                    <span>{artifact.title}</span>
                    <code>{artifact.kind}</code>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="meta">
                {gateImpact.providedArtifactCount === 0
                  ? '当前 Task 尚未生成产物。'
                  : '当前 Task 的产物尚未关联到该 Gate。'}
              </p>
            )}
            {gateImpact.unconsumedArtifactCount > 0 ? (
              <p className="meta">另有 {gateImpact.unconsumedArtifactCount} 个 Task 产物尚未被该 Gate 关联。</p>
            ) : null}
          </div>
          <button
            className="ghost-button"
            type="button"
            data-testid="open-downstream-gate"
            onClick={() => onSelectWorkflowNode(gateImpact.gateId)}
          >
            查看 Gate
          </button>
          <p className="meta">此处只展示前向影响；审批和 Override 仍只能在 Gate Inspector 中执行。</p>
        </article>
      )}
    </div>
  )

  const renderGateEnforcementPanel = () => (
    <details className="secondary-policy-details"><summary>查看策略评估与例外处理</summary><GateEnforcementPanel
      policySnapshot={policySnapshot}
      decision={gateEnforcementDecision}
      overrides={gateOverrides}
      isLoading={isLoadingGateEnforcement}
      canSaveOverride={canSaveOverride}
      onSaveOverride={onSaveGateOverride}
      isSavingOverride={pendingMatchesSelectedNode && pendingInspectorAction?.actionId === 'saveGateOverride'}
      isInspectorWriteBlocked={hasInspectorWriteLock}
    /></details>
  )

  const renderClarificationReview = () => clarificationReview ? (
    <section className="clarification-review" data-testid="clarification-review">
      <span className="panel-label">Requirement Gate · 版本化澄清审查</span>
      <p className={`empty-note ${clarificationReview.state === 'ready' ? '' : 'bad'}`}>
        {clarificationReview.message}
      </p>
      <GateMaterialReader key={`${selectedNode.id}:${clarificationReview.activeRevision?.id}`} bundle={clarificationReview}
        review={latestAgentReview} reports={nodeArtifacts} onFeedback={onRecordAgentReviewFeedback}
        onDiscuss={onDiscussReview}
        revisionSelected={selectedReviewItems}
        onToggleRevision={isSelectedCurrentNode && clarificationReview.state === 'ready' ? (index) => {
          const line = revisionLine(index)
          const removing = selectedReviewItems.includes(index)
          const text = removing ? clarificationFeedbackDraft.replace(line, '').trim() : [clarificationFeedbackDraft, line].filter(Boolean).join('\n\n')
          if (text.length > 4000) { setRevisionFormOpen(true); setRevisionDraftError('加入后将超过 4000 字，请先整理草稿再添加。原草稿已保留。'); return }
          setClarificationFeedbackDraft(text)
        } : undefined}
        knowledge={renderKnowledgeReferences()} />
      {!clarificationReview.activeRevision && latestAgentReview && <><p className="empty-note">审查对象正文不可用；以下仅保留已归档报告，不能据此认定当前版本已完成审查。</p>{renderReviewEvidence()}</>}
      {clarificationReview.revisions.length > 1 || clarificationReview.feedback.length ? (
        <details data-testid="clarification-revision-history">
          <summary>版本与修订意见历史</summary>
          {clarificationReview.revisions.map((revision) => (
            <p key={revision.id}>v{revision.clarificationRevision?.revision ?? 1} · {revision.clarificationRevision?.status ?? 'legacy'} · {revision.updatedAt}</p>
          ))}
          {clarificationReview.feedback.map((feedback) => (
            <p key={feedback.id}>{feedback.clarificationFeedback?.actorName ?? 'Reviewer'} · {feedback.updatedAt} · {feedback.content}</p>
          ))}
        </details>
      ) : null}

    </section>
  ) : null

  const renderRemediationActions = () => (
    <details className="secondary-policy-details"><summary>查看恢复计划</summary><GateRemediationPanel
      decision={gateEnforcementDecision}
      remediationPlan={remediationPlan}
      overrides={gateOverrides}
      isLoading={isLoadingGateEnforcement}
      canSaveOverride={canSaveOverride}
      pairingState={pairingState}
      isStartingRetry={isStartingCodingAgent}
      isInspectorWriteBlocked={hasInspectorWriteLock}
      onSyncTeam={onSyncTeam}
      onOpenTests={onOpenTests}
      onOpenOverride={() => setRequestedTab('Gate条件')}
      onRunKnowledgeReview={onOpenKnowledgeReview}
      onStartRetry={onStartRemediationRetry}
    /></details>
  )

  const renderWorkspaceContent = () => clarificationReview ? renderClarificationReview() : <div className="workspace-document">
    {contentArtifacts.length > 1 && <label>选择材料<select aria-label="选择材料" value={selectedDocument?.id ?? ''} onChange={(event) => setDocumentId(event.target.value)}>{contentArtifacts.map((artifact) => <option key={artifact.id} value={artifact.id}>{artifact.title}</option>)}</select></label>}
    {selectedDocument ? <article><h2>{selectedDocument.title}</h2><p>{selectedDocument.summary}</p>
      <ArtifactReviewReader key={selectedDocument.id} artifact={selectedDocument} review={latestAgentReview} onFeedback={onRecordAgentReviewFeedback} onDiscuss={onDiscussReview} />
    </article> : <p>当前节点尚无可阅读的正文；请按概览中的动作继续。</p>}
    {!selectedDocument && latestAgentReview && renderReviewEvidence()}
    {selectedNode.kind === 'test' && renderTestEvidence()}
    {codingActionProjection?.terminal && <section aria-label="开发变更与检查"><h3>开发变更与检查</h3>
            {codingActionProjection.terminal.changedPaths.length > 0 ? (
              <div className="knowledge-reference-meta" aria-label="Changed paths">
                {codingActionProjection.terminal.changedPaths.map((path) => <code key={path}>{path}</code>)}
              </div>
            ) : null}
            {codingActionProjection.terminal.testSummary ? <p>{codingActionProjection.terminal.testSummary}</p> : null}
            {codingActionProjection.terminal.diffPatch ? (
              <details open>
                <summary>Diff Artifact</summary>
                <pre className="diff-preview" tabIndex={0}>{codingActionProjection.terminal.diffPatch}</pre>
              </details>
            ) : null}
</section>}
    {['pr', 'acceptance'].includes(selectedNode.stage) && renderDeliveryHandoff()}
    {selectedNode.stage === 'design' && <p className="meta">当前设计节点尚不支持直接提交修订；如需修改，应先保留具体意见并核对当前流程，不会通过此阅读页面自动重新生成或批准。</p>}

  </div>
  const renderArtifactRecords = () => <div>{contentArtifacts.filter((artifact) => partitionArtifact(artifact.content).some((section) => section.group === 'records' && hasSectionContent(section))).map((artifact) => <article key={artifact.id}><h3>{artifact.title} · 生成详情</h3><p className="meta">{artifact.updatedAt}</p><ArtifactBody content={artifact.content} kind={artifact.kind} section="records" /></article>)}</div>
  const sectionRenderers: Record<InspectorSectionId, () => React.ReactNode> = {
    workspaceContent: renderWorkspaceContent,
    artifactRecords: renderArtifactRecords,
    statusMatrix: renderStatusMatrix,
    nodeSummary: renderNodeSummary,
    gateImpactSummary: renderGateImpactSummary,
    gateRequirementMatrix: renderGateRequirementMatrix,
    gateEnforcementPanel: renderGateEnforcementPanel,
    governance: renderGovernance,
    knowledgeReferences: renderKnowledgeReferences,
    reviewEvidence: renderReviewEvidence,
    testEvidence: renderTestEvidence,
    remediationActions: renderRemediationActions,
    agentReview: renderAgentReview,
    artifacts: renderArtifacts,
    trace: renderTrace,
    deliveryHandoff: renderDeliveryHandoff,
  }

  return (
    <aside className="inspector" data-testid="node-inspector">
      <div className="panel-head panel-head--compact">
        <div className="inspector-node-heading">
          <span className="inspector-stage-context">{String(stageOrder.indexOf(selectedNode.stage) + 1).padStart(2, '0')} · {stageLabels[selectedNode.stage]}</span>
          <span className="panel-title">{viewModel.header.title}</span>
          <span className="meta">
            类型：{viewModel.header.presentation.nodeKindLabel} · 来源：{viewModel.header.presentation.sourceLabel}
            {viewModel.header.presentation.displayMode === 'folded'
              ? ` · 展示：${viewModel.header.presentation.displayModeLabel}`
              : ''}
          </span>
        </div>
        <span className={`pill ${viewModel.header.statusTone}`}>
          {viewModel.header.statusLabel}
        </span>
      </div>
      <div className="node-status-summary" role="region" aria-label="节点状态摘要" data-testid={viewModel.gateReadinessSummary ? 'gate-readiness-summary' : undefined}>
        <span>Run v{selectedRun?.version ?? '—'} · {isSelectedCurrentNode ? '实际当前节点' : '正在查看历史/其他节点'}</span>
        <span>产物 {nodeArtifacts.length} · 轨迹 {events.length}</span>
        {viewModel.gateReadinessSummary && <><strong>{viewModel.gateReadinessSummary.headline}</strong><span>已通过 {viewModel.gateReadinessSummary.counts.passed} · 警告 {viewModel.gateReadinessSummary.counts.warning} · 缺失 {viewModel.gateReadinessSummary.counts.missing} · 阻断 {viewModel.gateReadinessSummary.counts.blocked}</span><span>人工审批：{selectedNode.status === 'success' ? '已通过' : '尚未通过'}</span></>}
      </div>
      <div className="tabbar workspace-primary-tabs" role="tablist" aria-label={`${viewModel.visualKind} inspector tabs`} onKeyDown={(event) => {
        if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return
        event.preventDefault()
        const tabs = viewModel.tabs
        const index = tabs.findIndex((tab) => tab.tabId === viewModel.activeTab.tabId)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
        setRequestedTab(tabs[next]!.tabId); event.currentTarget.querySelectorAll<HTMLButtonElement>('button')[next]?.focus()
      }}>
        {viewModel.tabs.map((tab, index) => <button key={tab.tabId} id={`workspace-tab-${index}`} role="tab" aria-controls="workspace-content" tabIndex={tab.tabId === viewModel.activeTab.tabId ? 0 : -1} aria-selected={tab.tabId === viewModel.activeTab.tabId} className={`tab ${tab.tabId === viewModel.activeTab.tabId ? 'active' : ''}`} onClick={() => setRequestedTab(tab.tabId)}>{tab.label}</button>)}
      </div>
      <div className="inspector-document-scroll" id="workspace-content" role="tabpanel" aria-labelledby={`workspace-tab-${viewModel.tabs.indexOf(viewModel.activeTab)}`}>
      {viewModel.activeTab.tabId === '概览' && <div className="next-action">

        <p className="section-title">Next best action</p>
        <h3>{viewModel.nextAction.title}</h3>
        <p className="meta">{viewModel.nextAction.copy}</p>
        {selectedNode.kind === 'agent' && selectedNode.status !== 'success' && ['clarify', 'design'].includes(selectedNode.stage) ? (
          <div><label className="stage-agent-executor" htmlFor="stage-agent-executor">
            {selectedNode.stage === 'clarify' ? '澄清执行器' : '设计执行器'}
            <select
              id="stage-agent-executor"
              value={stageAgentExecutorKind}
              disabled={hasInspectorWriteLock}
              onChange={(event) => onStageAgentExecutorKindChange(event.target.value as StageAgentExecutorKind)}
            >
              <option value="direct-provider">Direct Provider</option>
              <option value="local-agent">OpenCode（只读分析）</option>
            </select>
            <small>{stageAgentExecutorKind === 'local-agent' ? '只读查看仓库，生成后交给你评审；不修改代码、不运行测试命令、不批准 Gate。' : '直接调用所选模型生成正式产物。'}</small>
          </label>
          <label className="stage-agent-executor">本节点使用的模型
            <select aria-label="本节点使用的模型" value={stageProviderId} disabled={hasInspectorWriteLock} onChange={(event) => onStageProviderChange(event.target.value)}>
              <option value="">请选择已保存 Provider</option>
              {stageProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.name} · {provider.model}</option>)}
            </select>
          </label>
          <p className="empty-note">只影响本节点本次生成，不改变开发实现或已有聊天的选择。模型调用可能产生费用。</p>
          {pendingMatchesSelectedNode && pendingInspectorAction?.actionId === 'completeAgent' ? <div role="status">
            <p>正在生成，完成后会显示正式产物和执行记录。尚未批准任何 Gate。</p>
            {onCancelStageAgent ? <button className="ghost-button" onClick={onCancelStageAgent}>取消生成</button> : null}
          </div> : null}
          </div>
        ) : null}
        {codingActionProjection?.action.id === 'review-permission' && codingActionProjection.permission ? (
          <div className="coding-permission-summary" data-testid="workbench-coding-permission-summary">
            <strong>{codingActionProjection.permission.request.title}</strong>
            <span>{codingActionProjection.permission.changedPaths.length} 个文件</span>
            {codingActionProjection.permission.changeSetDigest ? (
              <code>{codingActionProjection.permission.changeSetDigest}</code>
            ) : null}
            <span>
              {codingActionProjection.permission.expired
                ? '已过期'
                : `剩余 ${Math.ceil(codingActionProjection.permission.remainingMs / 1_000)} 秒`}
            </span>
          </div>
        ) : null}
        {codingActionProjection?.terminal && <section className="workbench-coding-terminal" data-testid="workbench-coding-terminal"><strong>开发执行：{codingActionProjection.phase}</strong><p>{codingActionProjection.terminal.reason}</p><p>变更文件 {codingActionProjection.terminal.changedPaths.length} · 测试 {codingActionProjection.terminal.testStatus ?? '尚未归档'}</p><button className="text-button" onClick={() => setRequestedTab('内容与审查')}>阅读变更与代码差异</button><button className="text-button" onClick={() => setRequestedTab('执行记录')}>查看执行轨迹</button></section>}
        {exposesCodingAction && codingActionProjection?.action.id === 'configure' && codingReadinessDisplay?.status !== 'ready' ? (
          <div className="coding-readiness-summary" data-testid="workbench-coding-readiness">
            <strong>Coding Runtime：{codingReadinessDisplay?.statusLabel ?? '正在检查'}</strong>
            <p>{codingReadinessDisplay?.items.find((item) => item.state === 'blocked')?.detail ?? codingReadinessError ?? '读取启动前检查后才可执行；此时不会创建 worktree 或修改代码。'}</p>
            <button className="ghost-button" type="button" onClick={onOpenCodingConfiguration}>
              配置 Coding Engine / Executor
            </button>
          </div>
        ) : null}
      </div>}
      {modelReadinessError && primaryNextAction && ['completeAgent','runCodingAgent'].includes(primaryNextAction.id) && <p role="status">{modelReadinessError}<button className="text-button" onClick={onOpenCodingConfiguration}>打开项目基础设置</button></p>}
      {viewModel.activeTab.tabId === '概览' && contentArtifacts.some((artifact) => partitionArtifact(artifact.content).some((section) => hasSectionContent(section) && (section.group === 'questions' || /实施前.*核实/u.test(section.title)))) && <section className="overview-open-questions"><h3>正文中的待核对事项</h3><p className="meta">以下为产物原文中的问题或实施检查，不代表新增阻断。实际审批限制以策略评估为准。</p>{contentArtifacts.flatMap((artifact) => partitionArtifact(artifact.content).filter((section) => hasSectionContent(section) && (section.group === 'questions' || /实施前.*核实/u.test(section.title))).map((section) => <div key={`${artifact.id}:${section.start}`}><ArtifactBody content={section.markdown} section="content" /><button className="text-button" onClick={() => { setDocumentId(artifact.id); setRequestedTab('内容与审查') }}>查看相关正文</button></div>))}</section>}
      {viewModel.activeTab.sections.map((sectionId) => <Fragment key={sectionId}>{sectionRenderers[sectionId]()}</Fragment>)}
      </div>
      <footer className="node-action-footer">
      {revisionDraftError && <p role="alert">{revisionDraftError}</p>}
      {olderDrafts.length > 0 && <details><summary>其他版本有 {olderDrafts.length} 份未清除的修订草稿</summary><p>当前版本已改变；旧草稿不会自动提交到新版本，请核对后自行复制适用内容。</p>{olderDrafts.map((revision) => <div key={revision.id}><strong>需求澄清 v{revision.clarificationRevision?.revision ?? '—'}</strong><pre>{revisionDrafts[revision.id]}</pre></div>)}</details>}
      {revisionFormOpen && clarificationReview?.state === 'ready' && clarificationReview.activeRevision?.clarificationRevision ? (
        <section className="clarification-review__feedback" aria-label="请求修订当前版本"><div>
          <p>修订对象：需求澄清 v{clarificationReview.activeRevision.clarificationRevision.revision}。草稿仅在明确提交后生效。</p><label htmlFor="clarification-feedback">结构化修订意见</label>
          <textarea
            id="clarification-feedback"
            value={clarificationFeedbackDraft}
            maxLength={4000}
            onChange={(event) => setClarificationFeedbackDraft(event.target.value)}
            placeholder="说明需要修订的边界、验收条件或未解决问题"
          />
          <button
            className="ghost-button"
            type="button"
            disabled={!clarificationFeedbackDraft.trim() || !isSelectedCurrentNode || !onRequestClarificationChanges || hasInspectorWriteLock}
            onClick={() => {
              onRequestClarificationChanges?.(clarificationFeedbackDraft)
            }}
          >
            确认提交修订请求
          </button>
        <button className="text-button" onClick={() => setRevisionFormOpen(false)}>收起并保留草稿</button></div></section>
      ) : null}
        <div className="node-action-buttons">
          {clarificationReview?.state === 'ready' && clarificationReview.activeRevision?.clarificationRevision && <button className="ghost-button" disabled={!isSelectedCurrentNode || !onRequestClarificationChanges || hasInspectorWriteLock} title={!onRequestClarificationChanges ? '当前桌面版本未提供修订能力' : !isSelectedCurrentNode ? '只能修订实际当前节点' : undefined} onClick={() => setRevisionFormOpen(!revisionFormOpen)}>请求修订当前版本</button>}
        {primaryNextAction || secondaryNextActions.length ? (
          <div className="inspector-next-actions">
            {primaryNextAction ? renderActionButton(primaryNextAction, 'primary') : null}
            {secondaryNextActions.length ? (
              <div className="row inspector-secondary-actions">
                {secondaryNextActions.map((action) => renderActionButton(action, 'ghost'))}
              </div>
            ) : null}
          </div>
        ) : null}

          {onCancelStageAgent && pendingMatchesSelectedNode && pendingInspectorAction?.actionId === 'completeAgent' && viewModel.activeTab.tabId !== '概览' && <button className="ghost-button" onClick={onCancelStageAgent}>取消生成</button>}
          {viewModel.actions.filter((action) => action.id !== primaryNextAction?.id && !secondaryNextActions.some((other) => other.id === action.id)).map((action) => renderActionButton(action, 'ghost'))}
        </div>
      </footer>
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
  selectedProjectId,
  policySnapshot,
  gateEnforcementDecision,
  isLoadingGateEnforcement,
  onSyncTeam,
  isSyncingTeam,
  syncFeedback,
}: {
  projects: Project[]
  members: TeamMember[]
  projectRollups: TokenUsageRollup[]
  memberRollups: TokenUsageRollup[]
  totalCost: string
  dataOrigin: DataOrigin
  runtimeDataSource: FieldDataSource
  selectedRun: WorkflowRun | undefined
  selectedProjectId?: string | undefined
  policySnapshot: PolicySnapshot | null
  gateEnforcementDecision: GateEnforcementDecision | null
  isLoadingGateEnforcement: boolean
  onSyncTeam: () => void
  isSyncingTeam: boolean
  syncFeedback: { status: 'success' | 'error'; message: string } | null
}) {
  const memberSummary = members.length > 0
    ? members.map((member) => `${member.name} ${member.role}`).join(' · ')
    : '未加载团队成员'
  const projectCostById = new Map(projectRollups.map((rollup) => [rollup.key, rollup]))
  const selectedProject = projects.find((project) => project.id === (selectedProjectId ?? selectedRun?.projectId))
  const selectedProjectLabel = selectedProject?.name ?? '未选择 Team Project'
  const memberTokens = memberRollups.reduce((sum, rollup) => sum + rollup.totalTokens, 0)
  const snapshotSource = policySnapshot?.source ?? gateEnforcementDecision?.policySource ?? 'unavailable'
  const snapshotVersion = policySnapshot?.version ?? gateEnforcementDecision?.policyVersion
  const snapshotStatus = isLoadingGateEnforcement
    ? 'loading'
    : gateEnforcementDecision?.status ?? (policySnapshot ? 'loaded' : 'not loaded')
  const snapshotTone =
    snapshotStatus === 'pass' || snapshotStatus === 'overridden'
      ? 'good'
      : snapshotStatus === 'warn'
        ? 'warn'
        : snapshotStatus === 'not loaded' || snapshotStatus === 'loaded'
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
              {projects.length === 0 ? (
                <tr>
                  <td colSpan={10}>
                    <p className="empty-note">未加载 Team Project。拉取团队数据后才会展示远端项目、成员、策略和成本摘要。</p>
                  </td>
                </tr>
              ) : projects.map((project) => {
                const rollup = projectCostById.get(project.id)
                const isSelectedProject = project.id === selectedProject?.id

                return (
                  <tr key={project.id}>
                    <td><strong>{project.name}</strong></td>
                    <td className="mono">{project.repository}</td>
                    <td><span className={`pill ${project.health === 'on_track' ? 'good' : project.health === 'blocked' ? 'bad' : 'warn'}`}>{project.health}</span></td>
                    <td className="mono">{project.testCommand}</td>
                    <td>{isSelectedProject ? selectedRun?.title ?? '暂无 Run' : '暂无当前 Run'}</td>
                    <td>
                      <span className={`pill ${isSelectedProject ? snapshotTone : 'soft'}`}>
                        {isSelectedProject ? snapshotStatus : 'not loaded'}
                      </span>
                    </td>
                    <td>
                      {isSelectedProject
                        ? `${gateEnforcementDecision?.blockingReasons.length ?? 0} block · ${gateEnforcementDecision?.warningReasons.length ?? 0} warn · ${gateEnforcementDecision?.requiredActions.length ?? 0} actions`
                        : '无当前 Gate 数据'}
                    </td>
                    <td>{memberSummary}</td>
                    <td>{rollup ? `${rollup.totalTokens.toLocaleString()} · ${formatCostRollup([rollup])}` : `0 · ${totalCost}`}</td>
                    <td><span className={`pill ${isSelectedProject ? 'accent' : 'soft'}`}>{isSelectedProject ? snapshotSource : dataOrigin}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="member-roster" aria-label="Team members">
            {members.length === 0 ? (
              <span className="pill soft">未加载团队成员</span>
            ) : members.map((member) => (
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
                <strong>策略归属：Team Project · {selectedProjectLabel}</strong>
                <span className="pill warn">不是 Local Project 配置</span>
              </div>
              <p className="meta">这里定义 Gate policy、角色权限、预算和必需 Evidence。Workbench、Inspector、Agents、Tests 只读取 policy snapshot 并解释阻断原因，不能在 Run 内临时改规则。</p>
            </div>
            {policySnapshot?.effectivePolicy?.rules.length ? (
              <div className="policy-matrix" aria-label="Gate policy matrix">
                <div className="policy-row header"><span>Rule</span><span>Target</span><span>Action</span><span>Source</span></div>
                {policySnapshot.effectivePolicy.rules.map((rule) => (
                  <div className="policy-row" key={rule.ruleKey}>
                    <strong>{rule.ruleKey}</strong>
                    <span>{rule.target}</span>
                    <span className={`pill ${rule.action === 'block' ? 'warn' : rule.action === 'warn' ? 'soft' : 'good'}`}>
                      {rule.action}
                    </span>
                    <span>{rule.source}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-note">未加载 Team policy 规则。</p>
            )}
            <div className="mini-card">
              <p className="section-title">Budget Guard</p>
              <div className="row">
                <strong>{policySnapshot ? '远端预算策略已加载' : '预算策略未加载'}</strong>
                <span className={`pill ${policySnapshot ? 'good' : 'soft'}`}>{policySnapshot ? snapshotSource : 'not loaded'}</span>
              </div>
              <p className="meta">没有 Team policy snapshot 时，Workbench 不展示预算结论。</p>
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
                <span>{selectedRun?.title ?? 'No selected Run'} · {selectedProject?.name ?? '未绑定 Team Project'}</span>
                <span className="pill soft">{snapshotVersion ? `policy v${snapshotVersion}` : 'not loaded'}</span>
              </div>
              <div className="policy-source-row"><strong>Used by</strong><span>Workbench Inspector · Agents Gate Advisory · Tests Evidence rollup</span><span className="pill soft">read only</span></div>
              <div className="policy-source-row"><strong>Not used by</strong><span>Local Project config、test command、managed worktree 设置</span><span className="pill soft">separate</span></div>
            </div>
            <div className="mini-card soft">
              <p className="section-title">拉取团队数据后发生什么</p>
              <ul>
                <li>拉取 Team Project policy snapshot。</li>
                <li>刷新 Team Overview 的 policy / budget / Gate rollup。</li>
                <li>重新评估当前 Run 的 Gate 条件，但不会自动通过缺少 review 或 tests 的 Gate。</li>
                <li>写入 Event / Trace，说明本机使用了哪一版 policy。</li>
              </ul>
            </div>
            <button className="ghost-button" type="button" onClick={onSyncTeam} disabled={isSyncingTeam}>
              {isSyncingTeam ? '拉取中' : '拉取团队数据并刷新策略'}
            </button>
            {syncFeedback ? (
              <p className="meta" data-testid="team-sync-feedback" role={syncFeedback.status === 'error' ? 'alert' : 'status'}>
                {syncFeedback.message}
              </p>
            ) : null}
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
  entities,
  relations,
  references,
  selectedRun,
  supportContext,
  focusedDocumentId,
  focusedReferenceId,
  dataSource,
  indexedAt,
  truncated,
  warnings,
  isLoading,
  onRefresh,
  onReturnToInspector,
}: {
  query: string
  documents: KnowledgeDocument[]
  entities: KnowledgeEntity[]
  relations: KnowledgeRelation[]
  references: KnowledgeReference[]
  selectedRun: WorkflowRun | undefined
  supportContext: SupportContext | null
  focusedDocumentId: string | undefined
  focusedReferenceId: string | undefined
  dataSource: FieldDataSource
  indexedAt: string | undefined
  truncated: boolean
  warnings: RepositoryKnowledgeWarning[]
  isLoading: boolean
  onRefresh: () => void
  onReturnToInspector: () => void
}) {
  const maxVisibleEntities = 12
  const maxVisibleRelations = 16
  const documentById = new Map(documents.map((document) => [document.id, document]))
  const entityById = new Map(entities.map((entity) => [entity.id, entity]))
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
  const directlyMatchedEntityIds = new Set(
    entities
      .filter((entity) => matchesQuery(query, [entity.label, entity.kind, entity.sourcePath]))
      .map((entity) => entity.id),
  )
  const matchedRelations = relations.filter((relation) =>
    matchesQuery(query, [
      relation.label,
      entityById.get(relation.source)?.label,
      entityById.get(relation.target)?.label,
    ]) ||
    directlyMatchedEntityIds.has(relation.source) ||
    directlyMatchedEntityIds.has(relation.target),
  )
  const orderedEntityIds: string[] = []
  const candidateEntityIds = new Set<string>()
  function addEntity(entityId: string) {
    if (!candidateEntityIds.has(entityId) && entityById.has(entityId)) {
      candidateEntityIds.add(entityId)
      orderedEntityIds.push(entityId)
    }
  }
  for (const relation of matchedRelations) {
    addEntity(relation.source)
    addEntity(relation.target)
  }
  for (const entityId of directlyMatchedEntityIds) addEntity(entityId)
  const visibleEntities = orderedEntityIds
    .slice(0, maxVisibleEntities)
    .map((entityId) => entityById.get(entityId)!)
  const visibleEntityIds = new Set(visibleEntities.map((entity) => entity.id))
  const visibleRelations = matchedRelations
    .filter((relation) =>
      visibleEntityIds.has(relation.source) && visibleEntityIds.has(relation.target),
    )
    .slice(0, maxVisibleRelations)
  const graphSelectionTruncated =
    orderedEntityIds.length > visibleEntities.length || matchedRelations.length > visibleRelations.length

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
        <div className="compact-row" data-testid="knowledge-index-metadata">
          <span>{indexedAt ? `indexed ${indexedAt}` : isLoading ? 'indexing repository knowledge' : 'not indexed'}</span>
          <button
            aria-label="刷新仓库知识"
            className="ghost-button"
            disabled={isLoading}
            onClick={onRefresh}
            type="button"
          >
            <RefreshCw size={16} />
            {isLoading ? '索引中' : '刷新索引'}
          </button>
        </div>
        {truncated || warnings.length > 0 ? (
          <div className="mini-card soft" data-testid="knowledge-index-warnings">
            <strong>{truncated ? '索引结果已截断' : '索引警告'}</strong>
            {warnings.map((warning) => <code key={warning}>{warning}</code>)}
          </div>
        ) : null}
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
            visibleEntities.map((entity) => (
              <div
                key={entity.id}
                className={`knowledge-node knowledge-node--${entity.kind}`}
                data-testid="knowledge-graph-node"
              >
                <strong>{entity.label}</strong>
                <span>{entity.kind}</span>
              </div>
            ))
          )}
          {visibleRelations.map((relation) => (
            <div className="relation-row" data-testid="knowledge-graph-relation" key={relation.id}>
              {entityById.get(relation.source)?.label ?? relation.source} {relation.label}{' '}
              {entityById.get(relation.target)?.label ?? relation.target}
            </div>
          ))}
          {graphSelectionTruncated ? (
            <p className="empty-note knowledge-graph-limit-note">
              图谱较大，当前显示与搜索最相关的 {visibleEntities.length} 个节点。
            </p>
          ) : null}
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
            const semantics = resolveKnowledgeReferenceSemantics(reference)

            return (
              <article
                className={`reference-row ${reference.id === focusedReferenceId ? 'is-focused' : ''}`}
                data-testid={reference.id === focusedReferenceId
                  ? 'focused-knowledge-reference'
                  : 'knowledge-run-reference'}
                key={reference.id}
              >
                <span>{reference.targetType}</span>
                <strong>{reference.relation}</strong>
                <p>{document?.title ?? reference.documentId}</p>
                <div className="knowledge-reference-meta">
                  {reference.strategy ? <span>检索策略：{reference.strategy}</span> : null}
                  {semantics.lexicalMatch ? (
                    <span title="原始关键词累加分；无固定满分，不能跨查询比较。">
                      关键词匹配分 {semantics.lexicalMatch.rawScore}
                    </span>
                  ) : null}
                  {semantics.lexicalMatch?.matchedTerms.length ? (
                    <span>命中词：{semantics.lexicalMatch.matchedTerms.join('、')}</span>
                  ) : null}
                  {semantics.semanticRelevance ? (
                    <span>语义相关性：{semantics.semanticRelevance.score}</span>
                  ) : (
                    <span>未进行语义相关性判断</span>
                  )}
                  <span>Gate 状态：{semantics.gateEvidence.status}</span>
                  {reference.headingPath ? <span>{reference.headingPath.join(' / ')}</span> : null}
                </div>
                <code>{reference.artifactId ?? reference.evidenceId ?? reference.nodeId ?? reference.runId}</code>
                {reference.sourcePath ?? document?.sourcePath ? (
                  <code>{reference.sourcePath ?? document?.sourcePath}</code>
                ) : null}
                {reference.contentHash ? <code>{reference.contentHash}</code> : null}
              </article>
            )
          })
        )}
      </aside>
    </section>
  )
}
