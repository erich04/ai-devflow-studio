import { type Node, type NodeProps } from '@xyflow/react'
import { ReviewEvidenceDetails, type RecordReviewFeedback } from '../components/ReviewEvidenceDetails'
import {
  Bot,
  CheckCircle2,
  ClipboardCheck,
  ChevronDown,
  Code2,
  GitPullRequest,
  Play,
  MoreHorizontal,
  RefreshCw,
  Square,
  X,
} from 'lucide-react'
import { ArtifactReviewReader } from '../components/ArtifactReviewReader'
import { ArtifactBody, partitionArtifact, hasSectionContent } from '../components/ArtifactBody'
import { GateMaterialReader } from '../components/GateMaterialReader'
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type * as React from 'react'
import {
  buildClarificationReviewBundle,
  resolveDesignGateMaterial,
  canRunCodingAgentOnNode,
  projectKnowledgeReferencesForNode,
  resolveKnowledgeReferenceSemantics,
  type AgentEvent,
  type AgentReviewResult,
  type Artifact,
  type CodingAgentRun,
  type CodingRuntimeReadiness,
  type ManagedCodingWorkspace,
  type GateEnforcementDecision,
  type GateOverrideDecision,
  type GitHubDeliveryIntent,
  type GitHubDeliveryOperatorOutcome,
  type GitHubDeliveryRevocationCheck,
  type KnowledgeGovernanceCheck,
  type KnowledgeReference,
  type PolicySnapshot,
  type RemediationPlan,
  type TestEvidence,
  type WorkflowNode,
  type WorkflowRun,
  type StageAgentExecutorKind,
} from '@ai-devflow/shared'
import { GateEnforcementPanel, GateRemediationPanel } from '../GateEnforcementPanel'
import { GitHubDeliveryPanel } from '../GitHubDeliveryPanel'
import { buildCodingReadinessDisplay } from '../app/coding-runtime-readiness-view-model'
import { codingPermissionDecisionState, type CodingRuntimeActionProjection } from '../app/coding-runtime-action-projection'
import { buildGateRemediationViewModel, withoutStatusRowActions, hasRemediationContent, type GateRemediationCtaKind } from '../app/gate-remediation-view-model'
import type { TestRunReadiness } from '../app/test-run-readiness'
import type { DiscussionMaterial } from '../app/discussion-reference'
import { CodingRetryDialog, CodingWorkPanel, CodingWorkspaceRecords, GateReviewRunPanel, TestRunPanel } from './TaskWorkPanel'
import {
  buildWorkflowNodePresentation,
  buildWorkflowBoard,
  currentRunPhaseCopy,
  displayNodeSubtitle,
  displayNodeTitle,
  formatLocalTime,
  getNodeStatusTone,
  stageOrder,
  stageLabels,
  stageTone,
  type InspectorReadingPosition,
  type SupportContext,
} from '../app/desktop-view-model'
import {
  CURRENT_WORK_TAB,
  MATERIALS_TAB,
  RECORDS_TAB,
  buildNodeInspectorViewModel,
  formatStatusState,
  getInspectorNodeType,
  inspectorTabPlansByNodeType,
  resolveInspectorTabName,
  selectInspectorPrPackage,
  type InspectorAction,
  type InspectorActionDisabledReason,
  type InspectorActionId,
  type InspectorApprovalTarget,
  type InspectorSectionId,
  type PendingInspectorAction,
} from '../app/node-inspector-view-model'
import { buildWorkflowGateImpact } from '../app/workflow-gate-impact'
import {
  describeMaterial,
  groupMaterials,
  pendingRequirementTarget,
  selectDefaultMaterial,
  selectRequirementReading,
  type MaterialContext,
} from '../app/material-catalog'


export { LocalProjectPanel, Metric, NavButton, ThemeToggle } from './ShellControls'
export { McpView, SkillView } from './SupportViews'
export { TeamOverview } from './TeamOverview'
export { KnowledgeView } from './KnowledgeView'

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


export type WorkflowBoardView = 'compact' | 'flow' | 'list'

export function WorkflowBoard({
  view: boardView = 'compact',
  run,
  artifacts,
  events,
  testEvidence,
  selectedNodeId,
  onSelectNode,
  onSelectAttachment,
  onDiscuss,
}: {
  /** Chosen in the task menu (plan Y6); the stage row keeps only the six stage items. */
  view?: WorkflowBoardView
  run: WorkflowRun
  artifacts: Artifact[]
  events: AgentEvent[]
  testEvidence: TestEvidence[]
  selectedNodeId: string | undefined
  onSelectNode: (nodeId: string) => void
  onSelectAttachment: (nodeId: string, tab: string) => void
  onDiscuss?: (node: WorkflowNode) => void
}) {
  const [subStepsOpen, setSubStepsOpen] = useState(false)
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
    <section className={`canvas-panel workflow-panel unified-workflow workflow-view--${boardView}`} data-testid="workflow-canvas" aria-label={`任务阶段：${run.title}`}>
      <div className="workflow-stage-bar">
      <div className="workflow-navigation-scroll" tabIndex={0} aria-label="浏览流程导航">
      <nav className="workflow-stage-navigation" aria-label="六阶段导航" data-testid="stage-navigation">
        {board.map((stage, index) => {
          // The browsed stage item is also the sub-step disclosure (plan §5.1, Y6): no separate button.
          const togglesSubSteps = boardView === 'compact' && browsingStage === stage.stage
          return <div className="workflow-stage-step" key={stage.stage}>
          <button className={`stage-nav--${stage.completionState}`} data-testid="stage-item" aria-current={currentNode?.stage === stage.stage ? 'step' : undefined}
            aria-pressed={browsingStage === stage.stage} aria-expanded={togglesSubSteps ? subStepsOpen : undefined}
            aria-controls={`${boardView === 'compact' ? 'workflow-stage-nodes' : `workflow-stage-${stage.stage}`} workbench-node-reader`} disabled={!stage.cards.length}
            title={`${stage.label}：${stage.completionLabel}，${stage.completedNodeCount}/${stage.cards.length} 个子步骤已完成；${togglesSubSteps ? (subStepsOpen ? '点击收起子步骤' : '点击展开子步骤') : '点击查看本阶段'}`}
            onClick={() => {
              if (togglesSubSteps) {
                setSubStepsOpen(!subStepsOpen)
                return
              }
              const target = stage.cards.find((card) => card.node.id === run.currentNodeId) ?? stage.cards[0]
              if (target) onSelectNode(target.node.id)
            }}>
            <span className="stage-nav-index">{stage.index}</span><strong>{stage.label}</strong>
            {/* Sub-steps are folded into the stage item (plan L2): count on the actual stage, state elsewhere. */}
            <small>
              {currentNode?.stage === stage.stage && stage.completionState === 'current' ? `${stage.completedNodeCount}/${stage.cards.length}` : stage.completionLabel}
              {togglesSubSteps ? <ChevronDown size={12} aria-hidden="true" className={`stage-substeps-chevron ${subStepsOpen ? 'expanded' : ''}`} /> : null}
            </small>
          </button>
          {index < board.length - 1 && <div className="stage-progress-link" role="progressbar" aria-label={`${stage.label}阶段进度`}
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={stage.progressPercent}
            aria-valuetext={`${stage.completedNodeCount}/${stage.cards.length} 个节点已完成${currentNode?.stage === stage.stage ? `，当前：${displayNodeTitle(currentNode)}` : ''}`}>
            <span style={{ width: `${stage.progressPercent}%` }} />
          </div>}
        </div>
        })}
      </nav>
      </div>
      </div>
      {boardView === 'compact' && <div id="workflow-stage-nodes" className="workflow-node-navigation" role="region" aria-label="当前查看阶段的节点" hidden={!subStepsOpen}>
        <div className="workflow-viewed-stage"><small>子步骤</small><strong>{viewedStage?.index} · {viewedStage?.label}</strong></div>
        <div className="workflow-node-buttons">
          {viewedStage?.cards.map((card) => <button key={card.node.id}
            data-testid={`flow-node-${card.node.id}`} aria-pressed={card.node.id === selectedNodeId} aria-controls="workbench-node-reader"
            onClick={() => onSelectNode(card.node.id)}><strong>{displayNodeTitle(card.node)}</strong><span>{card.statusLabel}</span></button>)}
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
    </section>
  )
}

/** A proposal saved from a discussion (`publish` in workbench-conversation-service); not a formal material. */
export function isDiscussionProposal(artifact: Artifact): boolean {
  return artifact.kind === 'log' && artifact.id.startsWith('conversation-proposal-')
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
  onDiscussMaterial,
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
  onRunKnowledgeReview,
  onCancelKnowledgeReview,
  isRunningKnowledgeReviewHere = false,
  latestReviewFailure,
  reviewProviderLabel,
  reviewRunBlockedReason,
  onRunTests,
  testRunReadiness,
  onOpenSettings,
  readingPositionRef,
  onOpenKnowledgeReference,
  onRunCodingAgent,
  onRenewCodingPermission,
  isReplyingCodingPermission = false,
  latestCodingRun,
  codingWorkspace,
  codingProviderName,
  runtimeBudgetApprovalId = '',
  onOpenCodingWorktree,
  onDeleteCodingWorktree,
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
  codingActionProjection,
  upstreamCodingDiffReady,
  onCancelCodingRun,
  onReplyCodingPermission,
  codingRecords,
  executionEvidence,
  runEvents,
}: {
  /** All events of the run: approval records decide which design was confirmed (plan S4, Z5). */
  runEvents?: AgentEvent[] | undefined
  /** Coding Run evidence for the build step's 执行记录 (plan Y3). */
  codingRecords?: React.ReactNode
  /** Remaining execution evidence groups, folded at the end of 执行记录 (plan Y3). */
  executionEvidence?: React.ReactNode
  onCancelCodingRun?: (() => void) | undefined
  onReplyCodingPermission?: ((decision: 'approved' | 'rejected') => void) | undefined
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
  /** Adds a reference card to the current discussion (plan W7); sends nothing. */
  onDiscussMaterial?: ((material: DiscussionMaterial) => void) | undefined
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
  /** Runs the existing Gate Review in place; a re-run passes the previous review (plan W2). */
  onRunKnowledgeReview: (previousReviewId?: string) => void
  onCancelKnowledgeReview?: (() => void) | undefined
  isRunningKnowledgeReviewHere?: boolean
  latestReviewFailure?: string | undefined
  reviewProviderLabel?: string | undefined
  reviewRunBlockedReason?: string | undefined
  onRunTests: () => void
  testRunReadiness: TestRunReadiness
  /** Opens the matching settings section; the reading position is kept for the return (W9, Y1). */
  onOpenSettings: (target: 'coding' | 'tests' | 'models', position: InspectorReadingPosition | null) => void
  readingPositionRef?: React.MutableRefObject<(() => InspectorReadingPosition | null) | null> | undefined
  onOpenKnowledgeReference: (referenceId: string, documentId?: string) => void
  onRunCodingAgent: (additionalAttemptAfterCount?: number) => void
  onRenewCodingPermission?: (() => void) | undefined
  isReplyingCodingPermission?: boolean
  latestCodingRun?: CodingAgentRun | undefined
  codingWorkspace?: ManagedCodingWorkspace | undefined
  codingProviderName?: string | undefined
  runtimeBudgetApprovalId?: string
  onOpenCodingWorktree?: (() => void) | undefined
  onDeleteCodingWorktree?: (() => void) | undefined
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
  codingActionProjection?: CodingRuntimeActionProjection
  upstreamCodingDiffReady?: boolean
}) {
  const [requestedTab, setRequestedTab] = useState(CURRENT_WORK_TAB)
  const [revisionDraftError, setRevisionDraftError] = useState('')
  const [documentId, setDocumentId] = useState('')
  const [revisionFormOpen, setRevisionFormOpen] = useState(false)
  // Retry confirmation opened from the status row; the attempt count is fixed when it opens (W3).
  const [retryDialog, setRetryDialog] = useState<{ additionalAttemptAfterCount: number | undefined } | null>(null)
  const [codingFocusRequest, setCodingFocusRequest] = useState(0)
  const codingFocusRef = useRef<HTMLDivElement | null>(null)
  const tabPanelRef = useRef<HTMLDivElement | null>(null)
  const pendingScrollRestore = useRef<{ tab: string; scrollTop: number } | null>(null)
  // Action armed by a first click that needs a reminder before submitting (plan §6.1).
  const [armedActionKey, setArmedActionKey] = useState('')
  const [revisionDrafts, setRevisionDrafts] = useState<Record<string, string>>(() => {
    try { const parsed: unknown = JSON.parse(localStorage.getItem('devflow-revision-drafts') ?? '{}'); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === 'string')) as Record<string, string> : {} } catch { return {} }
  })
  // Reset the node workspace before paint so a newly visible tab cannot lose its first click.
  useLayoutEffect(() => {
    setRequestedTab(CURRENT_WORK_TAB); setDocumentId(''); setRevisionFormOpen(false); setArmedActionKey(''); setRetryDialog(null)
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
    // Returning from settings restores the material and scroll position too (plan W9).
    if (supportContext.focusTarget === 'inspector-tab') {
      if (supportContext.materialId) setDocumentId(supportContext.materialId)
      if (typeof supportContext.scrollTop === 'number') {
        pendingScrollRestore.current = { tab: supportContext.inspectorTab, scrollTop: supportContext.scrollTop }
      }
    }
    onConsumeSupportContext?.()
  }, [onConsumeSupportContext, selectedNode, selectedRun, supportContext])

  useEffect(() => {
    if (!codingFocusRequest) return
    codingFocusRef.current?.focus()
    codingFocusRef.current?.scrollIntoView?.({ block: 'start' })
  }, [codingFocusRequest])

  // Restore the scroll position once the restored tab has rendered (plan W9).
  useEffect(() => {
    const pending = pendingScrollRestore.current
    if (!pending || !tabPanelRef.current || !selectedNode) return
    if (resolveInspectorTabName(selectedNode, requestedTab) !== pending.tab) return
    tabPanelRef.current.scrollTop = pending.scrollTop
    pendingScrollRestore.current = null
  })

  // Lets App capture where the user was reading before it opens a settings page (plan W9).
  useEffect(() => {
    if (!readingPositionRef) return
    readingPositionRef.current = () => {
      if (!selectedRun || !selectedNode) return null
      const tabs = inspectorTabPlansByNodeType[getInspectorNodeType(selectedNode)]
      const resolved = resolveInspectorTabName(selectedNode, requestedTab)
      const tab = tabs.find((candidate) => candidate.tabId === resolved || candidate.label === resolved) ?? tabs[0]!
      return {
        runId: selectedRun.id,
        nodeId: selectedNode.id,
        inspectorTab: tab.tabId,
        ...(documentId ? { materialId: documentId } : {}),
        scrollTop: tabPanelRef.current?.scrollTop ?? 0,
      }
    }
    return () => {
      readingPositionRef.current = null
    }
  }, [documentId, readingPositionRef, requestedTab, selectedNode, selectedRun])

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
  const clarificationReview =
    selectedRun && selectedNode.kind === 'gate' && selectedNode.stage === 'clarify'
      ? buildClarificationReviewBundle({
          run: selectedRun,
          gateNode: selectedNode,
          artifacts: workflowArtifacts,
        })
      : undefined
  // One requirement reader for the clarify stage (plan S4, Z4): the task and the Gate read the same versions.
  const clarifyGateNode = selectedRun?.nodes.find((node) => node.stage === 'clarify' && node.kind === 'gate')
  const requirementReader = clarificationReview ?? (selectedRun && clarifyGateNode && selectedNode.stage === 'clarify'
    ? buildClarificationReviewBundle({ run: selectedRun, gateNode: clarifyGateNode, artifacts: workflowArtifacts })
    : undefined)
  const materialContext: MaterialContext = { run: selectedRun, events: runEvents ?? events, formatTime: formatLocalTime }
  const requirementReading = requirementReader ? selectRequirementReading(requirementReader, documentId || undefined) ?? requirementReader.rawRequest : undefined
  const requirementTarget = clarificationReview ? pendingRequirementTarget(clarificationReview) : undefined
  // Reading something other than the version to confirm arms a reminder before approval (plan S4, Z6).
  const readingElsewhere = requirementTarget && requirementReading && requirementReading.id !== requirementTarget.id
    ? requirementReading.kind === 'raw_request' ? '原始需求' : `历史版本 v${requirementReading.clarificationRevision?.revision ?? '—'}`
    : undefined
  // The design under review is the one design linked to the Gate, never the newest by time (plan S4, Z1).
  const designGateMaterial = selectedRun && selectedNode.kind === 'gate' && selectedNode.stage === 'design'
    ? resolveDesignGateMaterial({ run: selectedRun, gateNode: selectedNode, artifacts: workflowArtifacts })
    : undefined
  const approvalTarget: InspectorApprovalTarget | undefined = selectedNode.kind !== 'gate'
    ? undefined
    : selectedNode.stage === 'clarify'
      ? clarificationReview?.state === 'ready' && clarificationReview.activeRevision?.clarificationRevision
        ? {
            kind: 'requirement',
            determinable: true,
            revision: clarificationReview.activeRevision.clarificationRevision.revision,
            title: clarificationReview.activeRevision.title,
            generatedAt: clarificationReview.activeRevision.updatedAt,
          }
        : { kind: 'requirement', determinable: false, reason: clarificationReview?.message ?? '无法读取待确认的需求版本。' }
      : selectedNode.stage === 'design'
        ? designGateMaterial?.state === 'ready'
          ? { kind: 'design', determinable: true, title: designGateMaterial.artifact.title, generatedAt: designGateMaterial.artifact.updatedAt }
          : { kind: 'design', determinable: false, reason: designGateMaterial?.message ?? '无法读取待评审的方案。' }
        : { kind: 'other', determinable: true }
  const pendingMatchesSelectedNode = Boolean(
    pendingInspectorAction &&
      selectedRun &&
      pendingInspectorAction.runId === selectedRun.id &&
      pendingInspectorAction.nodeId === selectedNode.id,
  )
  const stageProvider = stageProviders.find((provider) => provider.id === stageProviderId)
  const viewModel = buildNodeInspectorViewModel({
    node: selectedNode,
    requestedTab,
    isSelectedCurrentNode,
    artifacts,
    events,
    ...(approvalTarget ? { approvalTarget } : {}),
    isGeneratingStageAgent: pendingMatchesSelectedNode && pendingInspectorAction?.actionId === 'completeAgent',
    ...(stageProvider ? { stageProviderLabel: `${stageProvider.name} · ${stageProvider.model}` } : {}),
    isRunningKnowledgeReview: isRunningKnowledgeReviewHere,
    ...(reviewProviderLabel ? { reviewProviderLabel } : {}),
    isRunningTests,
    ...(readingElsewhere ? { readingElsewhere } : {}),
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
  // Discussion proposals are not the step's body; they are listed in 材料与版本 (plan W8).
  const contentArtifacts = (selectedNode.kind === 'gate'
    ? [...workflowArtifacts.filter((artifact) => selectedNode.artifactIds.includes(artifact.id)), ...nodeArtifacts]
    : nodeArtifacts).filter((artifact, index, all) => all.findIndex((other) => other.id === artifact.id) === index && !isDiscussionProposal(artifact))
  const contentEntries = contentArtifacts.map((artifact) => describeMaterial(artifact, materialContext))
  const selectedEntry = selectDefaultMaterial(contentEntries, documentId || undefined)
  const selectedDocument = selectedEntry?.artifact
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
  const readingPosition = (): InspectorReadingPosition | null => selectedRun ? {
    runId: selectedRun.id,
    nodeId: selectedNode.id,
    inspectorTab: viewModel.activeTab.tabId,
    ...(documentId ? { materialId: documentId } : {}),
    scrollTop: tabPanelRef.current?.scrollTop ?? 0,
  } : null
  const openSettings = (target: 'coding' | 'tests' | 'models') => onOpenSettings(target, readingPosition())
  const testStepNode = selectedRun?.nodes.find((node) => node.kind === 'test' || node.stage === 'test')
  // Code changes are reviewed in 当前工作; focus the exact diff there (plan W3).
  const focusCodingPanel = () => {
    setRequestedTab(CURRENT_WORK_TAB)
    setCodingFocusRequest((value) => value + 1)
  }
  const actionHandlers: Record<InspectorActionId, () => void> = {
    runKnowledgeReview: () => onRunKnowledgeReview(),
    cancelKnowledgeReview: () => onCancelKnowledgeReview?.(),
    runTests: onRunTests,
    openTestStep: () => { if (testStepNode) onSelectWorkflowNode(testStepNode.id) },
    completeAgent: onCompleteAgentNode,
    approveGate: onApprove,
    runCodingAgent: () => onRunCodingAgent(),
    reviewCodingChangeSet: focusCodingPanel,
    viewCodingPermission: focusCodingPanel,
    renewCodingPermission: () => onRenewCodingPermission?.(),
    retryCodingRun: () => setRetryDialog({ additionalAttemptAfterCount: codingActionProjection?.additionalAttemptAfterCount }),
    configureCodingRuntime: () => openSettings('coding'),
    viewCodingRecords: () => setRequestedTab(RECORDS_TAB),
    createPrDraft: onCreatePrDraft,
    prepareGitHubDelivery: onPrepareGitHubDelivery,
    reviseGitHubDelivery: onReviseGitHubDelivery,
    retryGitHubDelivery: onRetryGitHubDelivery,
    resumeGitHubDelivery: onResumeGitHubDelivery,
    stopGitHubDelivery: onStopGitHubDelivery,
    verifyGitHubDeliveryRevocation: onVerifyGitHubDeliveryRevocation,
    createAcceptanceBundle: onCreateAcceptanceBundle,
    stopCodingRun: () => onCancelCodingRun?.(),
    approveCodingPermission: () => onReplyCodingPermission?.('approved'),
    rejectCodingPermission: () => onReplyCodingPermission?.('rejected'),
    cancelStageAgent: () => onCancelStageAgent?.(),
    syncTeam: onSyncTeam,
  }
  // Stop, cancel and reject stay usable while other writes are in flight (plan §3).
  const actionAvailable: Partial<Record<InspectorActionId, boolean>> = {
    stopCodingRun: Boolean(onCancelCodingRun),
    approveCodingPermission: Boolean(onReplyCodingPermission),
    rejectCodingPermission: Boolean(onReplyCodingPermission),
    cancelStageAgent: Boolean(onCancelStageAgent),
    cancelKnowledgeReview: Boolean(onCancelKnowledgeReview),
    renewCodingPermission: Boolean(onRenewCodingPermission),
    openTestStep: Boolean(testStepNode),
  }
  // The status row follows the exact diff review's rule for approve and reject (plan W3).
  const pendingPermission = codingActionProjection?.action.id === 'review-permission' ? codingActionProjection.permission : undefined
  const permissionDecision = pendingPermission
    ? codingPermissionDecisionState({ permission: pendingPermission, runStatus: codingActionProjection?.activeRun?.status, isReplying: isReplyingCodingPermission })
    : undefined
  const writeActionIds = new Set<InspectorActionId>([
    'approveCodingPermission',
    'runKnowledgeReview',
    'runTests',
    'retryCodingRun',
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
      review_unavailable: Boolean(reviewRunBlockedReason),
      tests_unavailable: Boolean(testRunReadiness.blockedReason),
      coding_retry_unavailable: codingActionProjection?.action.id === 'retry' && codingActionProjection.action.disabled,
      replying_coding_permission: isReplyingCodingPermission,
    }[reason]
  }
  const isActionWriteLocked = (action: InspectorAction) => writeActionIds.has(action.id) && hasInspectorWriteLock
  const isActionDisabled = (action: InspectorAction) =>
    action.disabledReasons.some((reason) => isDisabledReasonActive(reason)) ||
    isActionWriteLocked(action) ||
    (action.id === 'runCodingAgent' && codingReadiness?.status !== 'ready') ||
    (action.id === 'approveCodingPermission' && Boolean(permissionDecision?.approveDisabled)) ||
    (action.id === 'rejectCodingPermission' && Boolean(permissionDecision?.rejectDisabled))
  const actionTitle = (action: InspectorAction) => {
    if (isActionWriteLocked(action) && !action.disabledReasons.some((reason) => isDisabledReasonActive(reason))) {
      return pendingMatchesSelectedNode ? '当前节点操作正在进行中' : '其他 Inspector 操作正在进行中'
    }
    if (action.disabledReasons.includes('team_project_binding_missing') && !hasDeliveryProjectBinding) {
      return '先把当前本地项目连接到团队项目'
    }
    if (action.id === 'runKnowledgeReview' && reviewRunBlockedReason) return reviewRunBlockedReason
    if (action.id === 'runTests' && testRunReadiness.blockedReason) return testRunReadiness.blockedReason
    if (action.id === 'retryCodingRun' && codingActionProjection?.action.disabledReason) return codingActionProjection.action.disabledReason
    if ((action.id === 'approveCodingPermission' || action.id === 'rejectCodingPermission') && pendingPermission?.staleReason) {
      return pendingPermission.staleReason
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
    if (action.id === 'runKnowledgeReview' && isRunningAgentReview) {
      return '门禁审查中'
    }
    if (action.id === 'runTests' && isRunningTests) {
      return '测试中'
    }
    if (action.id === 'runCodingAgent' && isStartingCodingAgent) {
      return '启动中'
    }
    if ((action.id === 'approveCodingPermission' || action.id === 'rejectCodingPermission' || action.id === 'renewCodingPermission') && isReplyingCodingPermission) {
      return '提交中'
    }
    return action.label
  }
  const renderActionIcon = (actionId: InspectorActionId) => {
    switch (actionId) {
      case 'runKnowledgeReview':
      case 'completeAgent':
        return <Bot size={16} />
      case 'runTests':
        return <Play size={16} />
      case 'openTestStep':
        return <ClipboardCheck size={16} />
      case 'approveGate':
        return <CheckCircle2 size={16} />
      case 'runCodingAgent':
      case 'reviewCodingChangeSet':
      case 'viewCodingPermission':
        return <Code2 size={16} />
      case 'renewCodingPermission':
      case 'retryCodingRun':
        return <RefreshCw size={16} />
      case 'cancelKnowledgeReview':
        return <Square size={16} />
      case 'createPrDraft':
        return <GitPullRequest size={16} />
      case 'prepareGitHubDelivery':
      case 'reviseGitHubDelivery':
      case 'retryGitHubDelivery':
      case 'resumeGitHubDelivery':
      case 'verifyGitHubDeliveryRevocation':
        return <RefreshCw size={16} />
      case 'stopGitHubDelivery':
      case 'stopCodingRun':
      case 'cancelStageAgent':
        return <Square size={16} />
      case 'createAcceptanceBundle':
        return <ClipboardCheck size={16} />
      case 'approveCodingPermission':
        return <CheckCircle2 size={16} />
      case 'rejectCodingPermission':
        return <X size={16} />
      case 'syncTeam':
        return <RefreshCw size={16} />
    }
  }
  const renderActionButton = (action: InspectorAction, variant: InspectorAction['variant'] = action.variant) => (
    <button
      className={`${variant}-button`}
      data-testid={action.testId}
      aria-busy={pendingMatchesSelectedNode && pendingInspectorAction?.actionId === action.id ? true : undefined}
      disabled={isActionDisabled(action) || (Boolean(modelReadinessError) && ['completeAgent','runCodingAgent'].includes(action.id))}
      key={action.id}
      title={actionTitle(action)}
      data-confirm-armed={armedActionKey === `${selectedNode.id}:${action.id}` ? 'true' : undefined}
      onClick={() => {
        const confirmation = viewModel.nextAction.confirmBefore
        const key = `${selectedNode.id}:${action.id}`
        if (confirmation?.actionId === action.id && armedActionKey !== key) {
          setArmedActionKey(key)
          return
        }
        setArmedActionKey('')
        actionHandlers[action.id]()
      }}
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
  const persistentNextActions = viewModel.nextAction.persistentActionIds
    .filter((actionId) => actionAvailable[actionId] !== false)
    .map((actionId) => viewModel.actionCatalog[actionId])
  const canRequestRevision = Boolean(
    clarificationReview?.state === 'ready' && clarificationReview.activeRevision?.clarificationRevision,
  )
  const visibleSecondaryActions = secondaryNextActions.slice(0, 2)
  const overflowActions = [
    ...secondaryNextActions.slice(2),
    ...viewModel.actions.filter((action) =>
      action.id !== primaryNextAction?.id &&
      !secondaryNextActions.some((other) => other.id === action.id) &&
      !persistentNextActions.some((other) => other.id === action.id)),
  ]
  const revisionInStatusRow = canRequestRevision && visibleSecondaryActions.length < 2
  const armedConfirmation = viewModel.nextAction.confirmBefore &&
    armedActionKey === `${selectedNode.id}:${viewModel.nextAction.confirmBefore.actionId}`
    ? viewModel.nextAction.confirmBefore.message
    : ''
  const currentRunNode = selectedRun?.nodes.find((node) => node.id === selectedRun.currentNodeId)
  // The approval binds this exact design (plan S4, Z3); the time is how the user tells versions apart.
  const statusTarget = approvalTarget?.kind === 'design' && approvalTarget.title
    ? `所审方案：${approvalTarget.title}${approvalTarget.generatedAt ? ` · 记录于 ${formatLocalTime(approvalTarget.generatedAt)}` : ''}`
    : ''
  const renderRevisionToggle = () => (
    <button className="ghost-button" key="request-revision" disabled={!isSelectedCurrentNode || !onRequestClarificationChanges || hasInspectorWriteLock} title={!onRequestClarificationChanges ? '当前桌面版本未提供修订能力' : !isSelectedCurrentNode ? '只能修订实际当前节点' : undefined} onClick={() => setRevisionFormOpen(!revisionFormOpen)}>请求修订当前版本</button>
  )
  // Recovery items the status row already offers are not repeated in the recovery plan (W6).
  const statusRowActionIds = [primaryNextAction?.id, ...viewModel.nextAction.secondaryActionIds]
  const hiddenRemediationCtas: GateRemediationCtaKind[] = [
    ...(statusRowActionIds.includes('runKnowledgeReview') ? ['knowledge_review' as const] : []),
    ...(statusRowActionIds.includes('openTestStep') ? ['tests' as const] : []),
    ...(statusRowActionIds.includes('syncTeam') ? ['sync_policy' as const] : []),
  ]

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

  const renderDiscussMaterial = (artifact: Artifact) => onDiscussMaterial ? (
    <button type="button" className="text-button" onClick={() => onDiscussMaterial({
      materialId: artifact.id,
      materialTitle: artifact.title,
      version: artifact.clarificationRevision ? `需求 v${artifact.clarificationRevision.revision}` : `记录于 ${formatLocalTime(artifact.updatedAt)}`,
    })}>讨论此材料</button>
  ) : null
  // A material is read in 当前工作 when it is that step's body; anything else (review reports,
  // discussion proposals) is read here, so each text has exactly one home (plan W1).
  // Requirement versions and the raw request are read in the one requirement reader (plan S4, Z4).
  const readsInCurrentWork = (artifact: Artifact) => requirementReader
    ? artifact.kind === 'clarification' || artifact.kind === 'raw_request'
    : contentArtifacts.some((other) => other.id === artifact.id)
  const upstreamEntries = contentEntries.filter((entry) => entry.artifact.nodeId !== selectedNode.id)
  // Grouped by role (plan §9.1, S4 Z5): 当前待处理, 已确认依据, 本步骤材料, 原始输入与参考, 讨论提案, 历史记录.
  const renderArtifacts = () => (
    <div className="artifact-list" data-testid="node-artifacts">
      <span className="panel-label">当前步骤的材料 · {nodeArtifacts.length}</span>
      {selectedNode.kind === 'gate' && upstreamEntries.length > 0 && <section aria-label="关联的上游产物"><h3>关联的上游材料（不计入本步骤数量）</h3>{upstreamEntries.map((entry) => <p key={entry.artifact.id}><button className="text-button" onClick={() => { setDocumentId(entry.artifact.id); setRequestedTab(CURRENT_WORK_TAB) }}>{entry.label}</button> <span className="meta material-business-title">{entry.artifact.title}</span></p>)}</section>}
      {nodeArtifacts.length === 0 ? (
        <p className="empty-note">当前步骤尚未归档材料。</p>
      ) : (
        groupMaterials(nodeArtifacts.map((artifact) => describeMaterial(artifact, materialContext))).map((section) => <section key={section.group} className="material-group" aria-label={section.label}>
          <h3 className="material-group-title">{section.label} · {section.entries.length}</h3>
          {section.entries.map(({ artifact, ...entry }) => (
          <article
            key={artifact.id}
            className={`artifact-card ${artifact.id === focusedArtifactId ? 'is-focused' : ''}`}
            data-testid={artifact.id === focusedArtifactId ? 'focused-artifact' : 'material-card'}
          >
            <div className="compact-row"><strong>{entry.typeLabel} {entry.versionLabel}</strong>{renderDiscussMaterial(artifact)}</div>
            {/* Type, version, status and time on the first layer; the business title below (plan S4, Z5). */}
            <p className="material-card-status">
              {entry.group === 'proposal' ? <span className="pill warn">讨论提案（待确认）</span> : entry.statusLabel ? <span className={`pill ${entry.group === 'confirmed' ? 'good' : 'soft'}`}>{entry.statusLabel}</span> : null}
              <span className="meta">{entry.timeLabel}</span>
            </p>
            <p className="meta material-business-title">{artifact.title}</p>
            <p>{artifact.summary}</p>
            {readsInCurrentWork(artifact)
              ? <button className="text-button" onClick={() => { setDocumentId(artifact.id); setRequestedTab(CURRENT_WORK_TAB) }}>在「当前工作」中阅读</button>
              : <details className="material-source"><summary>阅读原文</summary><ArtifactBody content={artifact.content} kind={artifact.kind} /></details>}
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
          ))}
        </section>)
      )}
      {latestAgentReview && <section aria-label="已归档的审查报告"><h3>审查报告</h3><p className="meta">{formatLocalTime(latestAgentReview.createdAt)} · {latestAgentReview.model}。结论与意见逐条列在「当前工作」中。</p><button className="text-button" onClick={() => setRequestedTab(CURRENT_WORK_TAB)}>在「当前工作」中查看审查意见</button></section>}
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
          审查结论与被审查的上游产物供核对，不另计入当前节点产物数量；知识依据保留在「材料与版本」。
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
              <span className={`pill ${evidence.status === 'passed' ? 'good' : evidence.status === 'running' ? 'warn' : 'bad'}`} title={evidence.status}>
                {formatStatusState(evidence.status)}
              </span>
            </div>
            <p>{evidence.summary}</p>
            {/* Evidence does not record the tested commit (plan §6.4, X6): never shown as still valid. */}
            {evidence.status === 'passed' ? <p className="meta">执行于 {formatLocalTime(evidence.createdAt)}。证据没有记录所测代码的提交，适用性无法核实。</p> : null}
            <div className="knowledge-reference-meta">
              <code>{evidence.id}</code><code>{evidence.command}</code>
              <span>{evidence.durationMs}ms</span><span>退出码 {evidence.exitCode ?? '未知'}</span>
            </div>
            <button className="text-button" onClick={() => setRequestedTab(RECORDS_TAB)}>查看测试日志</button>
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
      {/* Coding Run evidence moved here from the Agents page (plan Y3); the diff stays in 当前工作. */}
      {codingRecords}
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
      {executionEvidence}
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
                      <span className={`pill ${descriptor.tone}`} title={descriptor.state}>{formatStatusState(descriptor.state)}</span>
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
              <span className={`pill ${descriptor.tone}`} title={descriptor.state}>{formatStatusState(descriptor.state)}</span>
              <small>{descriptor.impact}</small>
              <em>{descriptor.nextAction}</em>
            </div>
          </article>
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
      <span className="panel-label">交付交接</span>
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
          <strong>PR 交付包</strong>
          <span className="pill soft">{handoffPrPackage ? '已生成' : '尚未生成'}</span>
        </div>
        <p className="meta">汇总差异、测试、策略、预算与审查，作为 PR 交付 Gate 的交付摘要。</p>
      </article>
      <article className="mini-card">
        <div className="compact-row">
          <strong>验收材料包</strong>
          <span className="pill soft">{artifacts.some((artifact) => artifact.kind === 'acceptance') ? '已生成' : '尚未生成'}</span>
        </div>
        <p className="meta">汇总需求、PR、策略、预算、审查、证据链与执行记录，供业务验收。</p>
      </article>
      <div className="handoff-counts">
        <span><strong>{artifacts.length}</strong> 份材料</span>
        <span><strong>{events.length}</strong> 条执行记录</span>
        <span><strong>{governanceChecks.length}</strong> 项规范检查</span>
      </div>
    </div>
  )

  const renderGateImpactSummary = () => (
    <div className="gate-impact-summary" data-testid="gate-impact-summary">
      <span className="panel-label">对后续 Gate 的影响</span>
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
            <strong>已提供给该 Gate 的材料</strong>
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
                  ? '当前步骤尚未生成材料。'
                  : '当前步骤的材料尚未关联到该 Gate。'}
              </p>
            )}
            {gateImpact.unconsumedArtifactCount > 0 ? (
              <p className="meta">另有 {gateImpact.unconsumedArtifactCount} 份本步骤材料尚未关联到该 Gate。</p>
            ) : null}
          </div>
          <button
            className="ghost-button"
            type="button"
            data-testid="open-downstream-gate"
            onClick={() => onSelectWorkflowNode(gateImpact.gateId)}
          >
            查看该 Gate
          </button>
          <p className="meta">这里只说明对后续 Gate 的影响；审批与例外处理在该 Gate 步骤中进行。</p>
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

  // The requirement Gate and the clarification step share this reader (plan S4, Z4).
  const renderClarificationReview = () => requirementReader ? (
    <section className="clarification-review" data-testid="clarification-review">
      <span className="panel-label">{clarificationReview ? '需求确认 · 按版本审查' : '需求澄清 · 版本'}</span>
      {clarificationReview ? <p className={`empty-note ${clarificationReview.state === 'ready' ? '' : 'bad'}`}>
        {clarificationReview.message}
      </p> : null}
      <GateMaterialReader key={`${selectedNode.id}:${requirementReader.activeRevision?.id}`} bundle={requirementReader}
        review={clarificationReview ? latestAgentReview : undefined} reports={[]} onFeedback={onRecordAgentReviewFeedback}
        onDiscuss={onDiscussMaterial}
        readingId={documentId || undefined}
        onReadingChange={setDocumentId}
        materialContext={materialContext}
        revisionSelected={selectedReviewItems}
        onToggleRevision={clarificationReview && isSelectedCurrentNode && clarificationReview.state === 'ready' ? (index) => {
          const line = revisionLine(index)
          const removing = selectedReviewItems.includes(index)
          const text = removing ? clarificationFeedbackDraft.replace(line, '').trim() : [clarificationFeedbackDraft, line].filter(Boolean).join('\n\n')
          if (text.length > 4000) { setRevisionFormOpen(true); setRevisionDraftError('加入后将超过 4000 字，请先整理草稿再添加。原草稿已保留。'); return }
          setClarificationFeedbackDraft(text)
        } : undefined}
        knowledge={<p className="meta" data-testid="knowledge-reference-pointer">
          团队规范引用 {scopedReferences.length} 条，完整列表与来源在「材料与版本」中；审查报告原文也在那里。
          <button className="text-button" type="button" onClick={() => setRequestedTab(MATERIALS_TAB)}>查看引用来源</button>
        </p>} />
      {clarificationReview && !clarificationReview.activeRevision && latestAgentReview && <><p className="empty-note">审查对象正文不可用；以下仅保留已归档报告，不能据此认定当前版本已完成审查。</p>{renderReviewEvidence()}</>}
      {/* Chinese status and local time on the first layer; the stored status stays in the title (plan S4, Z7). */}
      {requirementReader.revisions.length > 1 || requirementReader.feedback.length ? (
        <details data-testid="clarification-revision-history">
          <summary>版本与修订意见历史</summary>
          {requirementReader.revisions.map((revision) => (
            <p key={revision.id} title={revision.clarificationRevision?.status ?? 'legacy'}>{describeMaterial(revision, materialContext).label}</p>
          ))}
          {requirementReader.feedback.map((feedback) => (
            <p key={feedback.id}>{feedback.clarificationFeedback?.actorName ?? '审查人'} · {formatLocalTime(feedback.updatedAt)} · {describeMaterial(feedback, materialContext).versionLabel} · {feedback.content}</p>
          ))}
        </details>
      ) : null}

    </section>
  ) : null

  const remediationViewModel = withoutStatusRowActions(buildGateRemediationViewModel({
    decision: gateEnforcementDecision,
    remediationPlan,
    overrides: gateOverrides,
    canSaveOverride,
    isStartingRetry: isStartingCodingAgent,
  }), hiddenRemediationCtas)
  // Only recovery steps the status row does not already offer; nothing left means no panel (W6).
  const renderRemediationActions = () => isLoadingGateEnforcement || !hasRemediationContent(remediationViewModel) ? null : (
    <details className="secondary-policy-details"><summary>查看恢复计划</summary><GateRemediationPanel
      decision={gateEnforcementDecision}
      remediationPlan={remediationPlan}
      overrides={gateOverrides}
      isLoading={isLoadingGateEnforcement}
      canSaveOverride={canSaveOverride}
      pairingState={pairingState}
      isStartingRetry={isStartingCodingAgent}
      isInspectorWriteBlocked={hasInspectorWriteLock}
      hiddenCtaKinds={hiddenRemediationCtas}
      onSyncTeam={onSyncTeam}
      onOpenTests={() => { if (testStepNode) onSelectWorkflowNode(testStepNode.id) }}
      onOpenOverride={() => setRequestedTab(CURRENT_WORK_TAB)}
      onRunKnowledgeReview={() => onRunKnowledgeReview()}
      onStartRetry={onStartRemediationRetry}
    /></details>
  )

  const renderWorkPanel = () => {
    const isStageAgent = selectedNode.kind === 'agent' && ['clarify', 'design'].includes(selectedNode.stage)
    const isTestStep = selectedNode.kind === 'test' || selectedNode.stage === 'test'
    return <>
      {/* Executor and model only for the actual current step (plan W1). */}
      {isStageAgent && isSelectedCurrentNode && selectedNode.status !== 'success' ? (
        <div className="next-action task-work-panel"><label className="stage-agent-executor" htmlFor="stage-agent-executor">
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
        </div>
      ) : null}
      {canRunCodingAgentOnNode(selectedNode) ? (
        <CodingWorkPanel
          projection={codingActionProjection}
          readinessDisplay={codingReadinessDisplay}
          readinessError={codingReadinessError}
          latestCodingRun={latestCodingRun}
          workspace={codingWorkspace}
          isReplying={isReplyingCodingPermission}
          onDecision={(decision) => { if (decision === 'approved' || decision === 'rejected') onReplyCodingPermission?.(decision) }}
          focusRef={codingFocusRef}
        />
      ) : null}
      {isTestStep && isSelectedCurrentNode && selectedNode.status !== 'success' ? (
        <TestRunPanel readiness={testRunReadiness} isRunning={isRunningTests} onOpenTestSettings={() => openSettings('tests')} />
      ) : null}
    </>
  }

  const renderReviewRun = () => isSelectedCurrentNode && selectedNode.status !== 'success' ? (
    <GateReviewRunPanel
      latestReview={latestAgentReview}
      failure={latestReviewFailure}
      isRunning={isRunningKnowledgeReviewHere}
      providerLabel={reviewProviderLabel}
      blockedReason={reviewRunBlockedReason}
      isWriteLocked={hasInspectorWriteLock}
      target={`${selectedRun?.title ?? ''} · ${viewModel.header.title}`}
      onRun={onRunKnowledgeReview}
    />
  ) : null

  const renderCodingWorkspace = () => (
    <CodingWorkspaceRecords
      workspace={codingWorkspace}
      canOpen={codingActionProjection?.terminal
        ? codingActionProjection.terminal.canOpenWorkspace
        : Boolean(codingWorkspace && !codingWorkspace.deletedAt && (codingWorkspace.cleanupStatus ?? 'active') === 'active')}
      onOpen={onOpenCodingWorktree}
      onDelete={onDeleteCodingWorktree}
    />
  )

  // The requirement stage reads versions; other steps list materials with one set of labels (plan S4, Z4–Z5).
  const renderWorkspaceContent = () => requirementReader && requirementReader.revisions.length > 0 ? renderClarificationReview() : <div className="workspace-document">
    {contentEntries.length > 1 && <label>选择材料<select aria-label="选择材料" value={selectedDocument?.id ?? ''} onChange={(event) => setDocumentId(event.target.value)}>
      {groupMaterials(contentEntries).map((section) => <optgroup key={section.group} label={section.label}>
        {section.entries.map((entry) => <option key={entry.artifact.id} value={entry.artifact.id}>{entry.label}</option>)}
      </optgroup>)}
    </select></label>}
    {selectedDocument && selectedEntry ? <article><div className="compact-row"><h2>{selectedDocument.title}</h2>{renderDiscussMaterial(selectedDocument)}</div>
      {/* The same identity as the selector: type, version or recorded time, status (plan S4, Z5). */}
      <p className="material-identity" data-testid="material-identity">
        <span>{selectedEntry.typeLabel} · {selectedEntry.versionLabel}</span>
        {selectedEntry.statusLabel ? <span className={`pill ${selectedEntry.group === 'confirmed' ? 'good' : 'soft'}`}>{selectedEntry.statusLabel}</span> : null}
      </p>
      <p>{selectedDocument.summary}</p>
      <ArtifactReviewReader key={selectedDocument.id} artifact={selectedDocument} review={latestAgentReview} onFeedback={onRecordAgentReviewFeedback} onDiscuss={onDiscussMaterial} />
    </article> : <p>当前步骤尚无可阅读的正文；请按状态行的操作继续。</p>}
    {!selectedDocument && latestAgentReview && renderReviewEvidence()}
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
    {/* The stage value is `accept`, not `acceptance`; the handoff shows once on both steps (plan W1). */}
    {['pr', 'accept'].includes(selectedNode.stage) && renderDeliveryHandoff()}
    {selectedNode.stage === 'design' && <p className="meta">当前设计节点尚不支持直接提交修订；如需修改，应先保留具体意见并核对当前流程，不会通过此阅读页面自动重新生成或批准。</p>}

  </div>
  const renderArtifactRecords = () => <div>{contentArtifacts.filter((artifact) => partitionArtifact(artifact.content).some((section) => section.group === 'records' && hasSectionContent(section))).map((artifact) => <article key={artifact.id}><h3>{artifact.title} · 生成详情</h3><p className="meta">{artifact.updatedAt}</p><ArtifactBody content={artifact.content} kind={artifact.kind} section="records" /></article>)}</div>
  const sectionRenderers: Record<InspectorSectionId, () => React.ReactNode> = {
    workPanel: renderWorkPanel,
    workspaceContent: renderWorkspaceContent,
    reviewRun: renderReviewRun,
    artifactRecords: renderArtifactRecords,
    statusMatrix: renderStatusMatrix,
    gateImpactSummary: renderGateImpactSummary,
    gateEnforcementPanel: renderGateEnforcementPanel,
    governance: renderGovernance,
    knowledgeReferences: renderKnowledgeReferences,
    reviewEvidence: renderReviewEvidence,
    testEvidence: renderTestEvidence,
    remediationActions: renderRemediationActions,
    artifacts: renderArtifacts,
    trace: renderTrace,
    codingWorkspace: renderCodingWorkspace,
  }

  return (
    <aside className="inspector" data-testid="node-inspector">
      {!isSelectedCurrentNode && currentRunNode ? (
        <div className="task-browsing-row" data-testid="task-browsing-row">
          <span>
            {viewModel.nextAction.kind === 'waiting_upstream' ? '正在查看尚未开始的步骤' : '正在查看历史步骤'}
            {' · '}实际进度：{stageLabels[currentRunNode.stage]} · {displayNodeTitle(currentRunNode)}
          </span>
          <button className="text-button" type="button" onClick={() => onSelectWorkflowNode(currentRunNode.id)}>返回当前工作</button>
        </div>
      ) : null}
      <section
        className={`task-status-row task-status-row--${viewModel.nextAction.tone}`}
        data-testid="task-status-row"
        data-status-kind={viewModel.nextAction.kind}
        aria-label="当前状态"
      >
        <div className="task-status-text">
          <p className="task-status-headline" role="status" aria-live="polite">
            <strong>{viewModel.nextAction.title}</strong>
            {viewModel.nextAction.qualifier ? <span className="task-status-qualifier"> · {viewModel.nextAction.qualifier}</span> : null}
          </p>
          <p className="task-status-detail" title={[viewModel.header.title, statusTarget, viewModel.nextAction.copy].filter(Boolean).join(' · ')}>
            <span className="task-status-step">{viewModel.header.title}</span>
            {statusTarget ? <span className="task-status-target">{statusTarget}</span> : null}
            <span>{viewModel.nextAction.copy}</span>
          </p>
        </div>
        <div className="task-status-actions">
          {primaryNextAction ? renderActionButton(primaryNextAction, 'primary') : null}
          {visibleSecondaryActions.map((action) => renderActionButton(action, 'ghost'))}
          {revisionInStatusRow ? renderRevisionToggle() : null}
          {persistentNextActions.map((action) => (
            <span className="task-status-persistent" key={action.id}>{renderActionButton(action, 'ghost')}</span>
          ))}
          <details className="task-status-more">
            <summary aria-label="更多操作与详情"><MoreHorizontal size={16} aria-hidden="true" /></summary>
            <div className="task-status-more-panel">
              {overflowActions.length || (canRequestRevision && !revisionInStatusRow) ? (
                <div className="task-status-more-actions">
                  {canRequestRevision && !revisionInStatusRow ? renderRevisionToggle() : null}
                  {overflowActions.map((action) => renderActionButton(action, 'ghost'))}
                </div>
              ) : null}
              <dl className="task-status-facts" data-testid={viewModel.gateReadinessSummary ? 'gate-readiness-summary' : undefined}>
                <dt>步骤</dt><dd>{String(stageOrder.indexOf(selectedNode.stage) + 1).padStart(2, '0')} · {stageLabels[selectedNode.stage]} · {viewModel.header.title}（{viewModel.header.statusLabel}）</dd>
                <dt>类型与来源</dt><dd>{viewModel.header.presentation.nodeKindLabel} · {viewModel.header.presentation.sourceLabel}{viewModel.header.presentation.displayMode === 'folded' ? ` · ${viewModel.header.presentation.displayModeLabel}` : ''}</dd>
                <dt>任务版本</dt><dd>v{selectedRun?.version ?? '—'} · {isSelectedCurrentNode ? '实际当前步骤' : '正在查看其他步骤'}</dd>
                <dt>材料与记录</dt><dd>材料 {nodeArtifacts.length} · 执行记录 {events.length}</dd>
                {/* Counts only: the status row is the one conclusion (plan W6). */}
                {viewModel.gateReadinessSummary ? <>
                  <dt>审批核对</dt><dd>已通过 {viewModel.gateReadinessSummary.counts.passed} · 警告 {viewModel.gateReadinessSummary.counts.warning} · 缺失 {viewModel.gateReadinessSummary.counts.missing} · 阻断 {viewModel.gateReadinessSummary.counts.blocked}</dd>
                  <dt>人工审批</dt><dd>{selectedNode.status === 'success' ? '已通过' : '尚未通过'}</dd>
                </> : null}
              </dl>
            </div>
          </details>
        </div>
        {armedConfirmation ? <p className="task-status-reminder" role="alert">{armedConfirmation}</p> : null}
      </section>
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
      <div className="inspector-document-scroll" id="workspace-content" data-testid="workspace-tabpanel" role="tabpanel" ref={tabPanelRef} aria-labelledby={`workspace-tab-${viewModel.tabs.indexOf(viewModel.activeTab)}`}>
      {modelReadinessError && primaryNextAction && ['completeAgent','runCodingAgent'].includes(primaryNextAction.id) && <p role="status">{modelReadinessError}<button className="text-button" onClick={() => openSettings('models')}>打开模型与执行方式设置</button></p>}
      {viewModel.activeTab.sections.map((sectionId) => <Fragment key={sectionId}>{sectionRenderers[sectionId]()}</Fragment>)}
      </div>
      {retryDialog && codingActionProjection?.action.id === 'retry' ? (
        <CodingRetryDialog
          additionalAttemptAfterCount={retryDialog.additionalAttemptAfterCount}
          providerName={codingProviderName}
          lastRun={latestCodingRun}
          runtimeBudgetApprovalId={runtimeBudgetApprovalId}
          disabled={isStartingCodingAgent || codingActionProjection.action.disabled}
          onCancel={() => setRetryDialog(null)}
          onConfirm={() => {
            const count = retryDialog.additionalAttemptAfterCount
            setRetryDialog(null)
            onRunCodingAgent(count)
          }}
        />
      ) : null}
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
      </footer>
    </aside>
  )
}
