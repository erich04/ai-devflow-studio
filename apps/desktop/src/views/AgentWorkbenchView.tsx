import { ArrowLeft, Bot, CheckCircle2, Code2, FolderOpen, Save, Settings2, TestTube2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  formatUsd,
  type AgentProviderConfig,
  type AgentReviewResult,
  type AgentTokenUsage,
  type AgentTrace,
  type CodingAgentEvent,
  type CodingAgentRun,
  type CodingChangeSetPreview,
  type CodingDiffArtifact,
  type CodingPermissionDecision,
  type CodingPermissionRequest,
  type CodingRuntimeConfiguration,
  type CodingRuntimeReadiness,
  type DependencyBootstrapEvidence,
  type ManagedCodingWorkspace,
  type RuntimeBudgetPolicy,
  type RetryAttempt,
  type TestEvidence,
  type WorkflowNode,
  type WorkflowRun,
} from '@ai-devflow/shared'
import {
  buildAgentConsoleViewModel,
  type AgentConsoleAction,
  type AgentConsoleEvidenceGroup,
} from '../app/agent-console-view-model'
import { AgentRuntimePanel } from '../AgentRuntimePanel'
import { AgentCoordinationPanel } from '../AgentCoordinationPanel'
import { AgentMemoryPanel } from '../AgentMemoryPanel'
import { codingRuntimeLabel, codingTerminalLabel, type SupportContext } from '../app/desktop-view-model'
import type { DevFlowDesktopApi } from '../desktop-api'
import type { PendingInspectorAction } from '../app/node-inspector-view-model'

export function AgentWorkbenchView({
  desktopApi,
  localProjectId,
  requestedBy,
  providers,
  selectedProviderId,
  onProviderChange,
  providerNameDraft,
  onProviderNameDraftChange,
  providerBaseUrlDraft,
  onProviderBaseUrlDraftChange,
  providerModelDraft,
  onProviderModelDraftChange,
  providerKeyDraft,
  onProviderKeyDraftChange,
  onSaveProviderCredential,
  onCompleteAgentNode,
  onRunKnowledgeReview,
  isRunning,
  isRunningTests,
  pendingInspectorAction,
  selectedRun,
  selectedNode,
  reviews,
  selectedReviews,
  latestReview,
  latestTrace,
  latestUsage,
  onRunCodingAgent,
  onReplyCodingPermission,
  onCancelCodingRun,
  onOpenCodingWorktree,
  onDeleteCodingWorktree,
  onOpenTests,
  isStartingCodingAgent,
  runtimeBudgetApprovalId,
  onRuntimeBudgetApprovalIdChange,
  codingRuns,
  retryAttempts,
  latestCodingRun,
  codingEvents,
  pendingCodingPermission,
  permissionRequests,
  workspace,
  diff,
  bootstrapEvidence,
  testEvidence,
  supportContext,
  onReturnToInspector,
}: {
  desktopApi: DevFlowDesktopApi | null
  localProjectId: string | undefined
  requestedBy: string
  providers: AgentProviderConfig[]
  selectedProviderId: string
  onProviderChange: (providerId: string) => void
  providerNameDraft: string
  onProviderNameDraftChange: (value: string) => void
  providerBaseUrlDraft: string
  onProviderBaseUrlDraftChange: (value: string) => void
  providerModelDraft: string
  onProviderModelDraftChange: (value: string) => void
  providerKeyDraft: string
  onProviderKeyDraftChange: (value: string) => void
  onSaveProviderCredential: () => void
  onCompleteAgentNode: () => void
  onRunKnowledgeReview: () => void
  isRunning: boolean
  isRunningTests: boolean
  pendingInspectorAction: PendingInspectorAction | null
  selectedRun: WorkflowRun | undefined
  selectedNode: WorkflowNode | undefined
  reviews: AgentReviewResult[]
  selectedReviews: AgentReviewResult[]
  latestReview: AgentReviewResult | undefined
  latestTrace: AgentTrace | undefined
  latestUsage: AgentTokenUsage | undefined
  onRunCodingAgent: () => void
  onReplyCodingPermission: (decision: CodingPermissionDecision['decision']) => void
  onCancelCodingRun: () => void
  onOpenCodingWorktree: () => void
  onDeleteCodingWorktree: () => void
  onOpenTests: () => void
  isStartingCodingAgent: boolean
  runtimeBudgetApprovalId: string
  onRuntimeBudgetApprovalIdChange: (value: string) => void
  codingRuns: CodingAgentRun[]
  retryAttempts: RetryAttempt[]
  latestCodingRun: CodingAgentRun | undefined
  codingEvents: CodingAgentEvent[]
  pendingCodingPermission: CodingPermissionRequest | undefined
  permissionRequests: CodingPermissionRequest[]
  workspace: ManagedCodingWorkspace | undefined
  diff: CodingDiffArtifact | undefined
  bootstrapEvidence: DependencyBootstrapEvidence | undefined
  testEvidence: TestEvidence | undefined
  supportContext: SupportContext | null
  onReturnToInspector: () => void
}) {
  const [codingConfiguration, setCodingConfiguration] = useState<CodingRuntimeConfiguration | null>(null)
  const [codingProviderId, setCodingProviderId] = useState('')
  const [codingReadiness, setCodingReadiness] = useState<CodingRuntimeReadiness | null>(null)
  const [pendingChangeSetPreview, setPendingChangeSetPreview] = useState<CodingChangeSetPreview | null>(null)
  const [budgetPolicy, setBudgetPolicy] = useState<RuntimeBudgetPolicy | null>(null)
  const [monthlyLimitUsd, setMonthlyLimitUsd] = useState('0.20')
  const [warningThresholdUsd, setWarningThresholdUsd] = useState('0.10')
  const [codingConfigurationStatus, setCodingConfigurationStatus] = useState('')
  const [isSavingCodingConfiguration, setIsSavingCodingConfiguration] = useState(false)
  const codingConfigurationProviderName = codingConfiguration
    ? providers.find((provider) => provider.id === codingConfiguration.providerId)?.name ?? '旧版 Provider'
    : undefined
  const latestCodingProviderName = latestCodingRun
    ? providers.find((provider) => provider.id === latestCodingRun.providerId)?.name ?? '旧版 Provider'
    : undefined

  async function refreshCodingReadiness(approvalId = runtimeBudgetApprovalId) {
    if (!desktopApi || !localProjectId || !selectedRun || !selectedNode) {
      setCodingReadiness(null)
      return
    }
    const readiness = await desktopApi.getCodingRuntimeReadiness({
      projectId: localProjectId,
      runId: selectedRun.id,
      nodeId: selectedNode.id,
      requestedBy,
      ...(approvalId.trim() ? { runtimeBudgetApprovalId: approvalId.trim() } : {}),
    })
    setCodingReadiness(readiness)
  }

  useEffect(() => {
    if (!desktopApi || !localProjectId) {
      setCodingConfiguration(null)
      setBudgetPolicy(null)
      setCodingReadiness(null)
      return
    }
    let active = true
    void Promise.all([
      desktopApi.getCodingRuntimeConfiguration({ projectId: localProjectId }),
      Promise.resolve(
        desktopApi.getCodingRuntimeBudgetPolicy({ projectId: localProjectId }),
      ).catch(() => null),
    ]).then(async ([configuration, policy]) => {
      if (!active) return
      setCodingConfiguration(configuration)
      setCodingProviderId(configuration?.providerId ?? selectedProviderId)
      setBudgetPolicy(policy)
      if (policy) {
        setMonthlyLimitUsd(policy.monthlyLimitUsd.toFixed(2))
        setWarningThresholdUsd(policy.warningThresholdUsd.toFixed(2))
      }
      try {
        await refreshCodingReadiness()
      } catch (error) {
        if (active) setCodingConfigurationStatus(error instanceof Error ? error.message : '无法读取 Coding Readiness')
      }
    })
    return () => {
      active = false
    }
  }, [desktopApi, localProjectId, selectedRun?.id, selectedNode?.id, requestedBy])

  useEffect(() => {
    if (!codingProviderId && selectedProviderId) setCodingProviderId(selectedProviderId)
  }, [codingProviderId, selectedProviderId])

  useEffect(() => {
    if (!desktopApi || !pendingCodingPermission?.changeSetId) {
      setPendingChangeSetPreview(null)
      return
    }
    let active = true
    void desktopApi.getCodingChangeSetPreview({
      changeSetId: pendingCodingPermission.changeSetId,
      codingRunId: pendingCodingPermission.codingRunId,
    }).then((preview) => {
      if (active) setPendingChangeSetPreview(preview)
    }).catch((error) => {
      if (!active) return
      setPendingChangeSetPreview(null)
      setCodingConfigurationStatus(
        error instanceof Error ? error.message : '无法读取待审批 Change Set',
      )
    })
    return () => {
      active = false
    }
  }, [desktopApi, pendingCodingPermission?.changeSetId, pendingCodingPermission?.codingRunId])

  async function saveCodingConfiguration() {
    if (!desktopApi || !localProjectId || !codingProviderId) return
    setIsSavingCodingConfiguration(true)
    setCodingConfigurationStatus('正在保存项目级 Native Executor…')
    try {
      const saved = await desktopApi.saveCodingRuntimeConfiguration({
        projectId: localProjectId,
        executor: 'native-model',
        providerId: codingProviderId,
      })
      setCodingConfiguration(saved)
      const savedProviderName = providers.find((provider) => provider.id === saved.providerId)?.name
      setCodingConfigurationStatus(`已保存 Native Executor · ${savedProviderName ?? '已保存 Provider'} · v${saved.version}`)
      await refreshCodingReadiness()
    } catch (error) {
      setCodingConfigurationStatus(error instanceof Error ? error.message : '保存 Coding Agent 配置失败')
    } finally {
      setIsSavingCodingConfiguration(false)
    }
  }

  async function saveBudgetPolicy() {
    if (!desktopApi || !localProjectId) return
    const monthly = Number(monthlyLimitUsd)
    const warning = Number(warningThresholdUsd)
    setIsSavingCodingConfiguration(true)
    setCodingConfigurationStatus('正在保存项目预算…')
    try {
      const saved = await desktopApi.saveCodingRuntimeBudgetPolicy({
        projectId: localProjectId,
        enabled: true,
        monthlyLimitUsd: monthly,
        warningThresholdUsd: warning,
      })
      setBudgetPolicy(saved)
      setCodingConfigurationStatus(`预算已保存：${formatUsd(saved.monthlyLimitUsd)} / 月`)
      await refreshCodingReadiness()
    } catch (error) {
      setCodingConfigurationStatus(error instanceof Error ? error.message : '保存 Runtime Budget 失败')
    } finally {
      setIsSavingCodingConfiguration(false)
    }
  }

  async function approveOverBudgetOnce() {
    if (!desktopApi || !localProjectId) return
    setIsSavingCodingConfiguration(true)
    try {
      const approval = await desktopApi.createCodingRuntimeBudgetApproval({
        projectId: localProjectId,
        requestedBy,
        maxAdditionalCostUsd: Math.max(0.01, codingReadiness?.budgetDecision?.projectedCostUsd ?? 0.20),
        reason: 'One-time local owner approval for this exact Native Coding run.',
      })
      onRuntimeBudgetApprovalIdChange(approval.id)
      setCodingConfigurationStatus(`一次性预算批准已创建：${approval.id}`)
      await refreshCodingReadiness(approval.id)
    } catch (error) {
      setCodingConfigurationStatus(error instanceof Error ? error.message : '创建一次性预算批准失败')
    } finally {
      setIsSavingCodingConfiguration(false)
    }
  }

  const pendingPermissionPaths = useMemo(
    () => pendingChangeSetPreview?.changedPaths ?? (pendingCodingPermission?.diffPreview
      ? [...pendingCodingPermission.diffPreview.matchAll(/^diff --git a\/(.+?) b\/.+$/gmu)].map((match) => match[1]!)
      : pendingCodingPermission?.filePath ? [pendingCodingPermission.filePath] : []),
    [pendingChangeSetPreview, pendingCodingPermission],
  )
  const viewModel = buildAgentConsoleViewModel({
    providers,
    selectedProviderId,
    selectedRun,
    selectedNode,
    reviews,
    selectedReviews,
    latestReview,
    latestTrace,
    latestUsage,
    isRunningReview: isRunning,
    isStartingCodingAgent,
    isRunningTests,
    pendingInspectorAction,
    codingRuns,
    retryAttempts,
    latestCodingRun,
    codingEvents,
    pendingCodingPermission,
    permissionRequests,
    workspace,
    diff,
    bootstrapEvidence,
    testEvidence,
  })
  const cleanupStatus = workspace?.cleanupStatus ?? (workspace?.deletedAt ? 'deleted' : workspace ? 'active' : 'none')
  const cleanupSummary =
    cleanupStatus === 'cleanup_failed'
      ? workspace?.cleanupError ?? 'Manual cleanup required.'
      : cleanupStatus === 'deleted'
        ? 'Managed workspace removed after the run.'
        : cleanupStatus === 'active'
          ? 'Managed workspace is still available for inspection.'
          : 'No managed workspace attached.'
  const budgetDecision = latestCodingRun?.budgetDecision

  function runPrimaryAction(action: AgentConsoleAction) {
    if (action.disabled) {
      return
    }

    if (action.id === 'run-review') {
      onRunKnowledgeReview()
      return
    }

    if (action.id === 'complete-agent-node') {
      onCompleteAgentNode()
      return
    }

    if (action.id === 'run-coding') {
      onRunCodingAgent()
      return
    }

    if (action.id === 'go-tests') {
      onOpenTests()
      return
    }

    if (action.id === 'return-workbench') {
      onReturnToInspector()
    }
  }

  return (
    <section className="agent-console" data-testid="agent-workbench">
      <div className="agent-console-main">
        <div className="section-heading">
          <span>Agent Workbench</span>
          <strong>{viewModel.title}</strong>
        </div>

        {supportContext && (supportContext.focusTarget === 'knowledge-review' || supportContext.focusTarget === 'coding-agent') ? (
          <div className="support-context-banner" data-testid="support-context-banner">
            <div>
              <span className="panel-label">来自 Workbench Inspector</span>
              <strong>{supportContext.label}</strong>
              <p>
                当前目标：{viewModel.currentTarget.runTitle} · {viewModel.currentTarget.nodeTitle}
              </p>
            </div>
            <button className="ghost-button" type="button" onClick={onReturnToInspector}>
              <ArrowLeft size={16} />
              返回当前 Inspector
            </button>
          </div>
        ) : null}

        <article className={`agent-current-task agent-current-task--${viewModel.primaryAction.tone}`} data-testid="agent-current-task">
          <div className="agent-current-task__body">
            <span className="panel-label">Current Task</span>
            <strong>{viewModel.currentTarget.nodeTitle}</strong>
            <p>{viewModel.currentTarget.runTitle}</p>
            <div className="knowledge-reference-meta">
              <span>{viewModel.currentTarget.stageLabel}</span>
              <span>{viewModel.currentTarget.nodeKind}</span>
              <span>{viewModel.currentTarget.nodeStatus}</span>
            </div>
          </div>
          <div className={`agent-current-task__advisory pill ${toneClass(viewModel.advisory.tone)}`}>
            <span>{viewModel.advisory.label}</span>
            <strong>{viewModel.advisory.detail}</strong>
          </div>
          <p className="agent-current-task__summary">{viewModel.advisory.summary}</p>
          <div className="agent-current-task__action">
            {viewModel.pendingPermission ? (
              <div className="permission-action-panel">
                <span className="panel-label">Permission Relay</span>
                <strong>{viewModel.pendingPermission.title}</strong>
                <p>{viewModel.pendingPermission.reasons.join(' ')}</p>
                <div className="knowledge-reference-meta">
                  <span>{viewModel.pendingPermission.permission}</span>
                  <span>{viewModel.pendingPermission.risk}</span>
                  {viewModel.pendingPermission.filePath ? <code>{viewModel.pendingPermission.filePath}</code> : null}
                </div>
                {pendingCodingPermission?.changeSetDigest ? (
                  <div className="agent-advisory agent-advisory--warn">
                    <span>精确 Change Set</span>
                    <strong>{pendingPermissionPaths.length} 个文件 · 仅写入 managed worktree</strong>
                    <div className="knowledge-reference-meta">
                      {pendingPermissionPaths.map((filePath) => <code key={filePath}>{filePath}</code>)}
                    </div>
                    <code>{pendingChangeSetPreview?.changeSetDigest ?? pendingCodingPermission.changeSetDigest}</code>
                    <p>
                      审批剩余：{formatApprovalTimeRemaining(pendingChangeSetPreview?.expiresAt ?? pendingCodingPermission.expiresAt)}
                      {' · '}
                      截止 {new Date(pendingChangeSetPreview?.expiresAt ?? pendingCodingPermission.expiresAt).toLocaleString()}
                    </p>
                    {pendingChangeSetPreview?.unifiedDiff ? (
                      <pre className="diff-preview">{pendingChangeSetPreview.unifiedDiff}</pre>
                    ) : null}
                  </div>
                ) : null}
                <div className="inspector-actions">
                  <button className="primary-button" onClick={() => onReplyCodingPermission('approved')}>
                    <CheckCircle2 size={16} />
                    Approve once
                  </button>
                  <button className="ghost-button" onClick={() => onReplyCodingPermission('rejected')}>
                    Reject
                  </button>
                </div>
              </div>
            ) : (
              <>
              <button
                className="primary-button"
                disabled={viewModel.primaryAction.disabled || (viewModel.primaryAction.id === 'run-coding' && codingReadiness?.status !== 'ready')}
                aria-busy={viewModel.primaryAction.label === '生成中' || undefined}
                title={viewModel.primaryAction.disabledReason}
                onClick={() => runPrimaryAction(viewModel.primaryAction)}
              >
                  {primaryActionIcon(viewModel.primaryAction.id)}
                  {viewModel.primaryAction.label}
                </button>
                <p>{viewModel.primaryAction.id === 'run-coding' && codingReadiness?.status !== 'ready'
                  ? 'Coding Runtime 尚未就绪，请先完成下方项目执行配置。'
                  : viewModel.primaryAction.disabledReason ?? viewModel.primaryAction.summary}</p>
              </>
            )}
          </div>
        </article>

        <section className="agent-path-grid" aria-label="Agent execution paths">
          {viewModel.pathStatuses.map((section) => (
            <article
              className={`agent-path-card agent-path-card--${section.emphasis} agent-path-card--${section.tone}`}
              data-testid={section.id === 'review' ? 'gate-review-path' : undefined}
              key={section.id}
            >
              <div>
                <span className="panel-label">{section.label}</span>
                <strong>{section.title}</strong>
                <p>{section.summary}</p>
              </div>
              <div className="agent-fact-grid">
                {section.facts.map((fact) => (
                  <div className="compact-row" key={fact.label}>
                    <span>{fact.label}</span>
                    <strong>{fact.value}</strong>
                  </div>
                ))}
              </div>
              {section.disabledReason ? <p className="empty-note">{section.disabledReason}</p> : null}
            </article>
          ))}
        </section>

        {latestCodingRun ? (
          <article className="agent-evidence-card">
            <div className="section-heading">
              <span>Coding Run Evidence</span>
              <strong>{latestCodingRun.branchName}</strong>
            </div>
            <div className="agent-fact-grid agent-fact-grid--three">
              <div className="compact-row">
                <span>Runtime</span>
                <strong>{codingRuntimeLabel(latestCodingRun.engine)}</strong>
              </div>
              <div className="compact-row">
                <span>Terminal state</span>
                <strong>{codingTerminalLabel(latestCodingRun.status)}</strong>
              </div>
              <div className="compact-row">
                <span>Provider</span>
                <strong>{latestCodingProviderName}</strong>
              </div>
              <div className="compact-row">
                <span>Changed paths</span>
                <strong>{latestCodingRun.changedPaths.length}</strong>
              </div>
              <div className="compact-row">
                <span>Bootstrap</span>
                <strong>{bootstrapEvidence?.status ?? 'pending'}</strong>
              </div>
              <div className="compact-row">
                <span>Test Evidence</span>
                <strong>{testEvidence?.status ?? 'pending'}</strong>
              </div>
            </div>
            {budgetDecision ? (
              <div className="agent-advisory agent-advisory--warn">
                <span>Runtime Budget</span>
                <strong>{budgetDecision.status}</strong>
                <p>{budgetDecision.reason}</p>
                <div className="knowledge-reference-meta">
                  <span>projected {formatUsd(budgetDecision.projectedCostUsd)}</span>
                  <span>current {formatUsd(budgetDecision.currentSpendUsd)}</span>
                  {typeof budgetDecision.limitUsd === 'number' ? (
                    <span>limit {formatUsd(budgetDecision.limitUsd)}</span>
                  ) : null}
                  {budgetDecision.approvalId ? <code>{budgetDecision.approvalId}</code> : null}
                </div>
                {budgetDecision.status === 'requires_lead_approval' ? (
                  <div className="runtime-budget-retry">
                    <label>
                      Runtime budget approval ID
                      <input
                        aria-label="Runtime budget approval ID"
                        placeholder="runtime-budget-approval-..."
                        value={runtimeBudgetApprovalId}
                        onChange={(event) => onRuntimeBudgetApprovalIdChange(event.target.value)}
                      />
                    </label>
                    <button
                      className="primary-button"
                      disabled={!runtimeBudgetApprovalId.trim() || isStartingCodingAgent}
                      onClick={onRunCodingAgent}
                    >
                      <Code2 size={16} />
                      Retry with approval
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="compact-row">
              <span>Cleanup</span>
              <strong>{cleanupStatus}</strong>
            </div>
            <p className="empty-note">{cleanupSummary}</p>
            {testEvidence ? <p className="empty-note">{testEvidence.summary}</p> : null}
            {workspace ? (
              <div className="knowledge-reference-meta">
                <span>workspace {workspace.cleanupStatus ?? 'active'}</span>
                <span>base {workspace.baseBranch}</span>
                <span>{workspace.branchName}</span>
              </div>
            ) : null}
            {latestCodingRun.changedPaths.length > 0 ? (
              <div className="knowledge-reference-meta">
                {latestCodingRun.changedPaths.slice(0, 6).map((changedPath) => (
                  <code key={changedPath}>{changedPath}</code>
                ))}
              </div>
            ) : null}
            {diff ? (
              <pre className="diff-preview">{diff.patch.slice(0, 1800)}</pre>
            ) : (
              <p className="empty-note">批准权限后会生成 Coding Diff Artifact。</p>
            )}
            <div className="inspector-actions">
              <button className="ghost-button" disabled={!workspace} onClick={onOpenCodingWorktree}>
                <FolderOpen size={16} />
                Open worktree
              </button>
              <button className="ghost-button" onClick={onCancelCodingRun}>
                Cancel
              </button>
              <button className="ghost-button" disabled={!workspace || Boolean(workspace.deletedAt)} onClick={onDeleteCodingWorktree}>
                Delete worktree
              </button>
            </div>
          </article>
        ) : null}

        <AgentRuntimePanel
          desktopApi={desktopApi}
          runId={selectedRun?.id}
          nodeId={selectedRun?.currentNodeId}
          localProjectId={localProjectId}
        />

        <AgentCoordinationPanel
          desktopApi={desktopApi}
          runId={selectedRun?.id}
          nodeId={selectedRun?.currentNodeId}
          expectedRunVersion={selectedRun?.version}
          localProjectId={localProjectId}
        />

        <AgentMemoryPanel
          desktopApi={desktopApi}
          runId={selectedRun?.id}
          localProjectId={localProjectId}
        />

        <section className="agent-console-section" aria-label="Evidence and Trace">
          <div className="section-heading section-heading--inline">
            <span>Evidence & Trace</span>
            <strong>当前节点执行证据</strong>
          </div>
          {viewModel.evidenceGroups.length === 0 ? (
            <article className="agent-evidence-card">
              <p className="empty-note">运行 Agent 后会在这里按门禁审查、Coding、Permission、Diff、Test Evidence 和 Cost 分组。</p>
            </article>
          ) : (
            <div className="agent-evidence-grid">
              {viewModel.evidenceGroups.map((group) => (
                <EvidenceGroupCard group={group} key={group.id} />
              ))}
            </div>
          )}
        </section>

        <details className="runtime-settings" open={codingReadiness?.status !== 'ready'}>
          <summary>
            <span><Code2 size={16} />Coding Agent 执行配置</span>
            <strong>{codingReadiness?.status === 'ready' ? '已就绪' : '需要配置'}</strong>
          </summary>
          <div className="runtime-settings__body">
            <article className="agent-evidence-card runtime-settings-form">
              <div className="section-heading">
                <span>项目级 Executor</span>
                <strong>Native v2 · managed worktree</strong>
              </div>
              <p>这里与门禁审查 Provider 分开配置。Renderer 只选择已保存 Provider，真正执行时由 Electron Main 重新解析项目配置。</p>
              <label>
                Coding Provider
                <select aria-label="Coding Agent Provider" value={codingProviderId} onChange={(event) => setCodingProviderId(event.target.value)}>
                  <option value="">请选择已保存 Provider</option>
                  {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name} · {provider.model}</option>)}
                </select>
              </label>
              <button className="ghost-button" disabled={!codingProviderId || isSavingCodingConfiguration} onClick={saveCodingConfiguration}>
                <Save size={16} />保存并用于当前项目
              </button>
              <p className="empty-note">当前：{codingConfiguration ? `${codingConfigurationProviderName} · v${codingConfiguration.version}` : '未配置'}</p>
            </article>

            <article className="agent-evidence-card runtime-settings-form">
              <div className="section-heading">
                <span>Runtime Budget</span>
                <strong>{budgetPolicy ? `${formatUsd(budgetPolicy.monthlyLimitUsd)} / 月` : '必须显式保存'}</strong>
              </div>
              <label>月上限（USD）<input aria-label="Coding monthly budget" inputMode="decimal" value={monthlyLimitUsd} onChange={(event) => setMonthlyLimitUsd(event.target.value)} /></label>
              <label>预警阈值（USD）<input aria-label="Coding warning budget" inputMode="decimal" value={warningThresholdUsd} onChange={(event) => setWarningThresholdUsd(event.target.value)} /></label>
              <button className="ghost-button" disabled={isSavingCodingConfiguration} onClick={saveBudgetPolicy}><Save size={16} />保存预算策略</button>
              {codingReadiness?.budgetDecision?.status === 'requires_lead_approval' ? (
                <button className="primary-button" disabled={isSavingCodingConfiguration} onClick={approveOverBudgetOnce}>创建 Owner/Lead 一次性批准</button>
              ) : null}
            </article>

            <article className="agent-evidence-card">
              <div className="section-heading"><span>启动前检查</span><strong>{codingReadiness?.status ?? '未读取'}</strong></div>
              <div className="trace-list">
                {codingReadiness?.checks.map((check) => (
                  <div className="trace-step" key={check.code}>
                    <span>{check.status === 'ready' ? '通过' : '阻塞'}</span>
                    <strong>{check.code}</strong>
                    <p>{check.message}</p>
                  </div>
                )) ?? <p className="empty-note">选择开发实现节点后会显示完整 Readiness。</p>}
              </div>
              {codingConfigurationStatus ? <p className="empty-note">{codingConfigurationStatus}</p> : null}
            </article>
          </div>
        </details>

        <details className="runtime-settings" open={!viewModel.runtimeSettings.selectedProvider}>
          <summary>
            <span>
              <Settings2 size={16} />
              Runtime Settings
            </span>
            <strong>{viewModel.runtimeSettings.summary}</strong>
          </summary>
          <div className="runtime-settings__body">
            <article className="agent-evidence-card">
              <div className="section-heading">
                <span>门禁审查 Provider</span>
                <strong>{viewModel.runtimeSettings.providerDataSource.status}</strong>
              </div>
              <p data-testid="review-provider-mode">
                <strong>{viewModel.runtimeSettings.providerDataSource.label}</strong>
                {' '}
                {viewModel.runtimeSettings.providerMode}
              </p>
              {viewModel.runtimeSettings.selectedProvider ? (
                <div className="provider-row">
                  <div>
                    <strong>{viewModel.runtimeSettings.selectedProvider.name}</strong>
                    <span>{viewModel.runtimeSettings.selectedProvider.kind}</span>
                  </div>
                  <code>
                    {viewModel.runtimeSettings.selectedProvider.maskedCredential ??
                      viewModel.runtimeSettings.selectedProvider.model}
                  </code>
                </div>
              ) : (
                <p className="empty-note">当前没有选中的 Agent Provider。请在右侧新增并保存一个 provider。</p>
              )}
              {providers.length > 0 ? (
                <label className="runtime-provider-picker">
                  Use saved provider
                  <select
                    aria-label="Saved Agent Provider"
                    value={selectedProviderId}
                    onChange={(event) => onProviderChange(event.target.value)}
                  >
                    {providers.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.name} · {provider.model}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <div className="agent-fact-grid">
                {viewModel.runtimeSettings.fields.map((field) => (
                  <div className="compact-row" key={field.label}>
                    <span>{field.label}</span>
                    <strong>{field.value}</strong>
                  </div>
                ))}
              </div>
            </article>

            <article className="agent-evidence-card runtime-settings-form">
              <div className="section-heading">
                <span>Add Agent Provider</span>
                <strong>OpenAI-compatible credential</strong>
              </div>
              <p>新增后会自动设为当前 Agent Provider；明文 key 只保存在 Electron 本地安全存储，不会回读到 renderer。</p>
              <label>
                Provider Name
                <input
                  aria-label="Agent Provider Name"
                  value={providerNameDraft}
                  placeholder="OpenAI production"
                  onChange={(event) => onProviderNameDraftChange(event.target.value)}
                />
              </label>
              <label>
                Base URL
                <input
                  aria-label="Agent Provider Base URL"
                  value={providerBaseUrlDraft}
                  placeholder="https://ark.cn-beijing.volces.com/api/coding/v3"
                  onChange={(event) => onProviderBaseUrlDraftChange(event.target.value)}
                />
              </label>
              <label>
                Model
                <input
                  aria-label="Agent Provider Model"
                  value={providerModelDraft}
                  placeholder="ark-code-latest"
                  onChange={(event) => onProviderModelDraftChange(event.target.value)}
                />
              </label>
              <label>
                API Key
                <input
                  aria-label="Agent Provider API Key"
                  type="password"
                  value={providerKeyDraft}
                  placeholder="sk-..."
                  onChange={(event) => onProviderKeyDraftChange(event.target.value)}
                />
              </label>
              <button className="ghost-button" onClick={onSaveProviderCredential}>
                <Save size={16} />
                Save and Use Provider
              </button>
            </article>
          </div>
        </details>
      </div>
    </section>
  )
}

function EvidenceGroupCard({ group }: { group: AgentConsoleEvidenceGroup }) {
  return (
    <article className={`agent-evidence-card agent-evidence-card--${group.tone}`}>
      <div className="section-heading">
        <span>{group.title}</span>
        <strong>{group.items.length}</strong>
      </div>
      <p>{group.summary}</p>
      <div className="trace-list">
        {group.items.map((item) => (
          <div className={group.id === 'diff' ? 'trace-step trace-step--diff' : 'trace-step'} key={item.id}>
            <span>{item.eyebrow}</span>
            <strong>{item.title}</strong>
            <p>{item.body}</p>
            {item.meta.length > 0 ? (
              <div className="knowledge-reference-meta">
                {item.meta.map((meta) => (
                  <span key={meta}>{meta}</span>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </article>
  )
}

function primaryActionIcon(actionId: AgentConsoleAction['id']) {
  if (actionId === 'run-review' || actionId === 'complete-agent-node') {
    return <Bot size={16} />
  }
  if (actionId === 'run-coding') {
    return <Code2 size={16} />
  }
  if (actionId === 'go-tests') {
    return <TestTube2 size={16} />
  }
  return <ArrowLeft size={16} />
}

function formatApprovalTimeRemaining(expiresAt: string): string {
  const remainingMs = Date.parse(expiresAt) - Date.now()
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return '已过期'
  const remainingSeconds = Math.ceil(remainingMs / 1_000)
  if (remainingSeconds < 60) return `${remainingSeconds} 秒`
  return `${Math.ceil(remainingSeconds / 60)} 分钟`
}

function toneClass(tone: AgentConsoleAction['tone']): string {
  if (tone === 'bad') {
    return 'bad'
  }
  if (tone === 'warn') {
    return 'warn'
  }
  if (tone === 'good') {
    return 'good'
  }
  if (tone === 'accent') {
    return 'accent'
  }
  return 'soft'
}
