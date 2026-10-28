import { ProviderRemovalDialog } from './ProviderRemovalDialog'
import { ModelCostRecovery } from './ModelCostRecovery'
import { ProviderThinkingFields, SavedProviderThinkingSettings } from '../components/ProviderThinkingSettings'
import { ArrowLeft, Code2, Save, Settings2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  formatUsd,
  type AgentProviderConfig,
  type BudgetGuardDecision,
  type CodingAgentRun,
  type CodingRuntimeConfiguration,
  type CodingRuntimeDiscovery,
  type CodingRuntimeReadiness,
  type ProviderCredentialMetadata,
  type ProviderThinkingConfiguration,
  type StageAgentExecutorKind,
  type WorkflowNode,
} from '@ai-devflow/shared'
import type { DevFlowDesktopApi } from '../desktop-api'
import { buildProviderSettingsView } from '../app/agent-evidence-view-model'
import { buildCodingReadinessDisplay } from '../app/coding-runtime-readiness-view-model'
import { formatLocalTime } from '../app/desktop-view-model'
import type { ProjectRuntimeBudget } from '../app/useProjectRuntimeBudget'
import { ipcErrorMessage } from '../app/ipc-error'

/** Plain Chinese for a budget check; English check results are replaced, never shown raw (#227). */
const budgetStatusCopy: Record<BudgetGuardDecision['status'], string> = {
  allowed: '在预算内',
  warning: '已超过预警阈值',
  requires_lead_approval: '超出月上限，需要 Owner 或 Lead 一次性批准',
  approved_over_budget: '超出月上限，已使用一次性批准',
  disabled: '未启用预算检查',
  unavailable: '暂时无法读取预算，需要调用模型的操作会先暂停',
}
function budgetDecisionCopy(decision: BudgetGuardDecision): string {
  return /^[\u4e00-\u9fff]/u.test(decision.reason) ? decision.reason : budgetStatusCopy[decision.status]
}
/** “RemoteSyncHttpError: 暂时无法连接… 诊断编号：…” → the readable sentence first, the rest as diagnosis. */
function splitBudgetError(message: string): { summary: string; detail: string } {
  const withoutClass = message.replace(/^[A-Za-z]*Error:\s*/u, '')
  const summary = withoutClass.split(/\s*诊断编号[:：]/u)[0]!.trim()
  return { summary: summary || '暂时无法读取团队预算。', detail: message }
}
/** Checks that depend on the task being at its coding step, not on this page's settings. */
const runContextReadinessCodes = new Set(['wrong_workflow_node', 'active_run', 'permission_pending', 'budget_blocked', 'budget_not_evaluated', 'budget_not_checked', 'budget_fetch_failed'])

/**
 * 设置／模型与执行方式 (plan Y2): model providers and credentials (this machine), the project's
 * execution tool (local project) and the team budget with one-time approvals (team project).
 * Nothing here starts a model call, a coding run or a Gate Review; those stay in the task.
 */
export function ModelSettings({
  desktopApi,
  projectRuntimeBudget,
  modelBudget,
  localProjectId,
  requestedBy,
  providers,
  selectedProviderId,
  onProviderChange,
  reviewExecutor,
  onReviewExecutorChange,
  onProviderRemoved,
  onProviderUpdated,
  providerNameDraft,
  onProviderNameDraftChange,
  providerBaseUrlDraft,
  onProviderBaseUrlDraftChange,
  providerModelDraft,
  onProviderModelDraftChange,
  providerKeyDraft,
  onProviderKeyDraftChange,
  onSaveProviderCredential,
  onSettingsSaved,
  selectedNode,
  latestCodingRun,
  runtimeBudgetApprovalId,
  onRuntimeBudgetApprovalIdChange,
  hasSelectedRun,
  onHandleInTask,
  codingReadiness,
  codingReadinessError,
  onRefreshCodingReadiness,
  focus,
}: {
  desktopApi: DevFlowDesktopApi | null
  projectRuntimeBudget: ProjectRuntimeBudget
  modelBudget?: { providerId: string; decision: BudgetGuardDecision } | undefined
  localProjectId: string | undefined
  requestedBy: string
  providers: AgentProviderConfig[]
  selectedProviderId: string
  onProviderChange: (providerId: string) => void
  /** Gate Review execution mode (knowledge-context K2); absent hides the choice. */
  reviewExecutor?: StageAgentExecutorKind | undefined
  onReviewExecutorChange?: ((executor: StageAgentExecutorKind) => void) | undefined
  onProviderRemoved: (providerId: string) => void
  onProviderUpdated?: (metadata: ProviderCredentialMetadata) => void
  providerNameDraft: string
  onProviderNameDraftChange: (value: string) => void
  providerBaseUrlDraft: string
  onProviderBaseUrlDraftChange: (value: string) => void
  providerModelDraft: string
  onProviderModelDraftChange: (value: string) => void
  providerKeyDraft: string
  onProviderKeyDraftChange: (value: string) => void
  onSaveProviderCredential: (thinking?: ProviderThinkingConfiguration) => void
  /** Called after a save succeeds; the banner then offers 「返回任务」 (plan W9). */
  onSettingsSaved?: () => void
  selectedNode: WorkflowNode | undefined
  latestCodingRun: CodingAgentRun | undefined
  runtimeBudgetApprovalId: string
  onRuntimeBudgetApprovalIdChange: (value: string) => void
  hasSelectedRun: boolean
  /** Back to the task, where the re-run with the approval is confirmed (plan W3, W5). */
  onHandleInTask: () => void
  codingReadiness: CodingRuntimeReadiness | null
  codingReadinessError: string
  onRefreshCodingReadiness: (approvalId?: string) => Promise<CodingRuntimeReadiness | null>
  /** Opened from the task for the execution tool, or for models and budget (plan W9). */
  focus?: 'coding' | 'models' | undefined
}) {
  const [codingConfiguration, setCodingConfiguration] = useState<CodingRuntimeConfiguration | null>(null)
  const [codingExecutor, setCodingExecutor] = useState<'native-model' | 'opencode-http'>('native-model')
  const [codingProviderId, setCodingProviderId] = useState('')
  const [providerRemovalTarget, setProviderRemovalTarget] = useState<AgentProviderConfig | null>(null)
  const [newProviderThinking, setNewProviderThinking] = useState<ProviderThinkingConfiguration>({ mode: 'default' })
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId)
  const [codingDiscovery, setCodingDiscovery] = useState<CodingRuntimeDiscovery | null>(null)
  const [opencodeProviderId, setOpencodeProviderId] = useState('')
  const [opencodeModelId, setOpencodeModelId] = useState('')
  const [customOpenCodeProvider, setCustomOpenCodeProvider] = useState(false)
  const opencodeDraftEdited = useRef(false)
  const savedOpenCodeProvider = providers.find((provider) => provider.id === opencodeProviderId)
  const effectiveOpenCodeProviderId = customOpenCodeProvider ? opencodeProviderId.trim() : savedOpenCodeProvider?.id ?? ''
  const effectiveOpenCodeModelId = customOpenCodeProvider ? opencodeModelId.trim() : savedOpenCodeProvider?.model ?? ''
  const budgetPolicy = projectRuntimeBudget.policy
  const [codingConfigurationStatus, setCodingConfigurationStatus] = useState('')
  const [isSavingCodingConfiguration, setIsSavingCodingConfiguration] = useState(false)
  const runtimeSettingsRef = useRef<HTMLDetailsElement>(null)
  const budgetSettingsRef = useRef<HTMLDetailsElement>(null)
  const codingConfigurationProviderName = codingConfiguration
    ? providers.find((provider) => provider.id === codingConfiguration.providerId)?.name ?? '旧版 Provider'
    : undefined
  const providerView = buildProviderSettingsView({ providers, selectedProviderId })

  useEffect(() => {
    if (!desktopApi || !localProjectId) {
      setCodingConfiguration(null)
      return
    }
    let active = true
    setCodingConfiguration(null)
    void Promise.resolve(desktopApi.getCodingRuntimeConfiguration({ projectId: localProjectId })).then((configuration) => {
      if (!active) return
      opencodeDraftEdited.current = false
      setCodingConfiguration(configuration)
      setCodingExecutor(configuration?.executor ?? 'native-model')
      setCodingProviderId(configuration?.providerId ?? selectedProviderId)
      if (configuration?.executor === 'opencode-http') {
        setOpencodeProviderId(configuration.providerId)
        setOpencodeModelId(configuration.modelId)
      }
    }).catch((error) => {
      if (active) setCodingConfigurationStatus(ipcErrorMessage(error, '无法读取项目执行工具配置'))
    })
    return () => {
      active = false
    }
  }, [desktopApi, localProjectId, requestedBy])

  useEffect(() => {
    if (opencodeDraftEdited.current) return
    if (codingConfiguration?.executor === 'opencode-http') {
      const saved = providers.find((provider) => provider.id === codingConfiguration.providerId)
      setCustomOpenCodeProvider(!saved || saved.model !== codingConfiguration.modelId)
    } else {
      const saved = providers.find((provider) => provider.id === selectedProviderId) ?? providers[0]
      setOpencodeProviderId(saved?.id ?? '')
      setOpencodeModelId(saved?.model ?? '')
      setCustomOpenCodeProvider(false)
    }
  }, [codingConfiguration, providers, selectedProviderId])

  useEffect(() => {
    if (!codingProviderId && selectedProviderId) setCodingProviderId(selectedProviderId)
  }, [codingProviderId, selectedProviderId])

  // From the task: open and focus the part the user came to set (plan W9).
  useEffect(() => {
    const target = focus === 'coding' ? runtimeSettingsRef.current : focus === 'models' ? budgetSettingsRef.current : null
    if (!target) return
    target.open = true
    target.focus()
    target.scrollIntoView?.({ block: 'start' })
  }, [focus])

  async function saveCodingConfiguration() {
    if (!desktopApi || !localProjectId) return
    const opencode = codingDiscovery?.candidates.find((candidate) =>
      candidate.engine === 'opencode-http' && candidate.status === 'available',
    )
    if (codingExecutor === 'native-model' && !codingProviderId) return
    if (
      codingExecutor === 'opencode-http' &&
      (!opencode?.binaryPath || !opencode.version || !effectiveOpenCodeProviderId || !effectiveOpenCodeModelId)
    ) return
    setIsSavingCodingConfiguration(true)
    setCodingConfigurationStatus('正在保存项目执行工具…')
    try {
      const saved = await desktopApi.saveCodingRuntimeConfiguration(
        codingExecutor === 'native-model'
          ? {
              projectId: localProjectId,
              executor: 'native-model',
              providerId: codingProviderId,
            }
          : {
              projectId: localProjectId,
              executor: 'opencode-http',
              providerId: effectiveOpenCodeProviderId,
              modelId: effectiveOpenCodeModelId,
              binaryPath: opencode!.binaryPath!,
              detectedVersion: opencode!.version!,
            },
      )
      setCodingConfiguration(saved)
      const savedProviderName = providers.find((provider) => provider.id === saved.providerId)?.name
      setCodingConfigurationStatus(
        saved.executor === 'native-model'
          ? `已保存 DevFlow Native · ${savedProviderName ?? '已保存 Provider'} · 配置修订 ${saved.version}`
          : `已确认 OpenCode · ${saved.detectedVersion} · ${savedProviderName ?? saved.providerId} / ${saved.modelId} · 配置修订 ${saved.version}`,
      )
      onSettingsSaved?.()
      await onRefreshCodingReadiness()
    } catch (error) {
      setCodingConfigurationStatus(ipcErrorMessage(error, '保存 Coding Agent 配置失败'))
    } finally {
      setIsSavingCodingConfiguration(false)
    }
  }

  async function detectOpenCode() {
    if (!desktopApi || !localProjectId) return
    setIsSavingCodingConfiguration(true)
    setCodingConfigurationStatus('正在检测本机 OpenCode…')
    try {
      const discovery = await desktopApi.detectCodingRuntimeEngines({ projectId: localProjectId })
      setCodingDiscovery(discovery)
      const candidate = discovery.candidates[0]
      setCodingConfigurationStatus(candidate?.reason ?? '未检测到 Coding Engine')
    } catch (error) {
      setCodingDiscovery(null)
      setCodingConfigurationStatus(ipcErrorMessage(error, '检测 OpenCode 失败'))
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
        providerId: modelBudget?.providerId ?? selectedProviderId,
        maxAdditionalCostUsd: Math.max(0.01, modelBudget?.decision.projectedCostUsd ?? codingReadiness?.budgetDecision?.projectedCostUsd ?? 0.20),
        reason: 'Explicit Owner/Lead approval for model requests on this project and Provider; valid for 15 minutes.',
      })
      onRuntimeBudgetApprovalIdChange(approval.id)
      setCodingConfigurationStatus(`一次性预算批准已创建：${approval.id}`)
      onSettingsSaved?.()
      if (selectedNode?.kind === 'task' && selectedNode.stage === 'build') await onRefreshCodingReadiness(approval.id)
    } catch (error) {
      setCodingConfigurationStatus(ipcErrorMessage(error, '创建一次性预算批准失败'))
    } finally {
      setIsSavingCodingConfiguration(false)
    }
  }

  const configurationIssues = codingReadiness && codingReadiness.projectId === localProjectId
    ? codingReadiness.checks.filter((check) => check.status === 'blocked' && !runContextReadinessCodes.has(check.code))
    : []
  const codingConfigurationLabel = !codingConfiguration || codingConfiguration.projectId !== localProjectId
    ? '未配置'
    : configurationIssues.length ? '配置需处理' : '已配置'
  // Collapsed, the summary still says which tool and model the project uses (#227).
  const codingConfigurationSummary = codingConfiguration && codingConfiguration.projectId === localProjectId
    ? `${codingConfigurationLabel} · ${codingConfiguration.executor === 'native-model' ? 'DevFlow Native' : 'OpenCode'} · ${codingConfigurationProviderName === '旧版 Provider' ? codingConfiguration.providerId : codingConfigurationProviderName}`
    : codingConfigurationLabel
  const codingReadinessDisplay = codingReadiness ? buildCodingReadinessDisplay(codingReadiness) : null
  // Only what the user can fix here comes first; checks that pass or wait for the coding step fold away (#227).
  const readinessToFix = codingReadinessDisplay?.items.filter((item) => item.state === 'blocked' && !runContextReadinessCodes.has(item.code)) ?? []
  const readinessOther = codingReadinessDisplay?.items.filter((item) => !readinessToFix.includes(item)) ?? []
  const readinessHeadline = !codingReadinessDisplay ? '未读取'
    : codingReadinessDisplay.status === 'ready' ? '可以启动'
      : readinessToFix.length ? `需要处理 ${readinessToFix.length} 项` : '设置已就绪'
  const budgetDecision = modelBudget?.decision
  const budgetError = projectRuntimeBudget.error ? splitBudgetError(projectRuntimeBudget.error) : null
  const budgetNeedsAttention = Boolean(budgetDecision && (budgetDecision.blocksRun || ['warning', 'requires_lead_approval', 'unavailable'].includes(budgetDecision.status)))
  const budgetWebLocation = <p data-testid="runtime-budget-web-location">修改月上限与预警阈值：在 Web 控制端打开「设置 › 预算」，选择当前连接的团队项目。保存后回到这里点「同步云端预算策略」读取。</p>
  const requiresLeadApproval = (modelBudget?.decision ?? codingReadiness?.budgetDecision)?.status === 'requires_lead_approval'
  // The approval ID is configuration; the re-run itself is confirmed in the task (plan W5).
  const codingRunNeedsApproval = latestCodingRun?.budgetDecision?.status === 'requires_lead_approval'

  return (
    <div className="settings-model" data-testid="settings-models">
      <details className="runtime-settings project-policy-settings" ref={budgetSettingsRef} tabIndex={-1}
        open={projectRuntimeBudget.status !== 'loaded' || !projectRuntimeBudget.policy || modelBudget?.decision.blocksRun === true || focus === 'models'}>
        <summary><span>团队预算 · 团队项目</span><strong>{projectRuntimeBudget.label}</strong></summary>
        <div className="runtime-settings__body">
          <article className="agent-evidence-card runtime-settings-form">
            {/* The summary above already names the state; the card leads with the rule and the next step (#227). */}
            <p>{projectRuntimeBudget.status === 'unpaired'
              ? '先在「设置 › 团队连接」配对团队项目，才能读取预算；配对前需要付费模型的操作会暂停。'
              : '每次调用模型前按团队项目的月预算检查；超出月上限时需要 Owner 或 Lead 一次性批准。'}</p>
            {/* Amounts only once they are read; while unpaired or unreadable they are unknown, not “未配置”. */}
            {projectRuntimeBudget.status === 'loaded' ? <dl className="runtime-budget-summary" data-testid="runtime-budget-summary">
              <div><dt>月上限</dt><dd>{budgetPolicy ? `${formatUsd(budgetPolicy.monthlyLimitUsd)} / 月` : '尚未配置'}</dd></div>
              <div><dt>预警阈值</dt><dd>{budgetPolicy ? formatUsd(budgetPolicy.warningThresholdUsd) : '尚未配置'}</dd></div>
              {budgetDecision && !budgetNeedsAttention ? <div><dt>最近一次检查</dt><dd>{budgetStatusCopy[budgetDecision.status]}</dd></div> : null}
            </dl> : null}
            {budgetDecision && budgetNeedsAttention ? <p role="status" className="runtime-budget-attention">最近一次模型预算检查：{budgetDecisionCopy(budgetDecision)}</p> : null}
            {/* Team budget is a team-side setting: it is edited on the Web (plan S5, Q7; 4.3 节). */}
            {projectRuntimeBudget.status === 'loaded' && !budgetPolicy ? budgetWebLocation : null}
            {budgetError ? <div role="alert" className="runtime-budget-attention">
              <p>{budgetError.summary}需要调用模型的操作会先暂停，恢复连接后重试。</p>
              <details><summary>诊断详情</summary><code>{budgetError.detail}</code></details>
            </div> : null}
            {projectRuntimeBudget.status !== 'unpaired' ? <button className="ghost-button" onClick={() => void projectRuntimeBudget.refresh()}>
              {projectRuntimeBudget.status === 'unavailable' ? '重试读取预算' : '同步云端预算策略'}
            </button> : null}
            <details className="runtime-budget-details">
              <summary>预算说明</summary>
              <p>周期为 UTC 自然月。聊天、澄清、设计、审查和编码的每次模型请求都会检查；预估用于预警和准入，实际用量按返回记录，未知费用需核对。一次性批准不会更改 API Key。</p>
              <p>策略更新时间：{budgetPolicy?.updatedAt ? formatLocalTime(budgetPolicy.updatedAt) : '尚未同步'}</p>
              {budgetDecision && budgetDecisionCopy(budgetDecision) !== budgetDecision.reason ? <p>最近一次检查原文：<code>{budgetDecision.reason}</code></p> : null}
              {projectRuntimeBudget.status === 'loaded' && !budgetPolicy ? null : budgetWebLocation}
            </details>
            <ModelCostRecovery desktopApi={desktopApi} projectId={localProjectId} />
            {codingConfigurationStatus ? <p role="status">{codingConfigurationStatus}</p> : null}
            {requiresLeadApproval ? (
              <button className="ghost-button" disabled={isSavingCodingConfiguration} onClick={approveOverBudgetOnce}>创建 Owner/Lead 一次性批准</button>
            ) : null}
            {codingRunNeedsApproval || runtimeBudgetApprovalId ? (
              <div className="runtime-budget-retry" data-testid="runtime-budget-approval">
                <label>
                  预算批准编号
                  <input
                    aria-label="Runtime budget approval ID"
                    placeholder="runtime-budget-approval-..."
                    value={runtimeBudgetApprovalId}
                    onChange={(event) => onRuntimeBudgetApprovalIdChange(event.target.value)}
                  />
                </label>
                <p className="meta">开发执行因预算需要批准时，重新运行会使用这个编号；重新运行在任务的「当前工作」中确认。</p>
                <button className="primary-button" disabled={!runtimeBudgetApprovalId.trim() || !hasSelectedRun} onClick={onHandleInTask}>
                  <ArrowLeft size={16} />
                  在任务中重新运行
                </button>
              </div>
            ) : null}
          </article>
        </div>
      </details>

      {/* Opens when the tool is not set or needs fixing here, not merely because the task is not at its coding step (#227). */}
      <details className="runtime-settings" open={codingConfigurationLabel !== '已配置' || readinessToFix.length > 0 || focus === 'coding'} ref={runtimeSettingsRef} tabIndex={-1}>
        <summary>
          <span><Code2 size={16} />项目执行工具 · 本地项目</span>
          <strong>{codingConfigurationSummary}</strong>
        </summary>
        <div className="runtime-settings__body">
          <article className="agent-evidence-card runtime-settings-form">
            <div className="section-heading">
              <span>开发实现使用的工具</span>
              <strong>{codingExecutor === 'native-model' ? 'DevFlow Native（内置编码执行器）' : 'OpenCode'}</strong>
            </div>
            <p>只影响开发实现；需求澄清、方案设计和讨论栏在各自位置选择模型。</p>
            {/* Version and former names are reference, not part of the choice (#227). */}
            {codingExecutor === 'native-model' ? <details className="readiness-details"><summary>关于 DevFlow Native</summary><p className="empty-note">执行器版本：v2。旧称 Native Coding Agent / Native Executor，均指 DevFlow Native。</p></details> : null}
            <label>
              执行工具
              <select aria-label="执行工具" value={codingExecutor} onChange={(event) => setCodingExecutor(event.target.value as 'native-model' | 'opencode-http')}>
                <option value="native-model">DevFlow Native · 内置编码执行器</option>
                <option value="opencode-http">OpenCode · 使用 OpenCode Provider</option>
              </select>
            </label>
            {codingExecutor === 'native-model' ? (
              <label>
                DevFlow Native 使用的 Provider
                <select aria-label="Coding Agent Provider" value={codingProviderId} onChange={(event) => setCodingProviderId(event.target.value)}>
                  <option value="">请选择已保存 Provider</option>
                  {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name} · {provider.model}</option>)}
                </select>
              </label>
            ) : (
              <>
                <button className="ghost-button" disabled={isSavingCodingConfiguration} onClick={detectOpenCode}>
                  检测本机 OpenCode
                </button>
                <p className="empty-note" data-testid="opencode-discovery-status">
                  {codingDiscovery?.candidates[0]?.status === 'available'
                    ? `已检测：${codingDiscovery.candidates[0].version}；尚未确认用于当前项目。`
                    : codingDiscovery?.candidates[0]?.reason ?? '检测不会自动选择或启动 OpenCode。'}
                </p>
                <label>
                  OpenCode 使用的已保存 Provider
                  <select aria-label="OpenCode 已保存 Provider" disabled={customOpenCodeProvider} value={savedOpenCodeProvider?.id ?? ''} onChange={(event) => {
                    opencodeDraftEdited.current = true
                    const provider = providers.find((candidate) => candidate.id === event.target.value)
                    setOpencodeProviderId(provider?.id ?? '')
                    setOpencodeModelId(provider?.model ?? '')
                  }}>
                    <option value="">请选择已保存 Provider</option>
                    {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name} · {provider.model}</option>)}
                  </select>
                </label>
                <p className="empty-note">选择后复用本机已保存的凭据和模型，无需再次输入 API Key。</p>
                <details open={customOpenCodeProvider}>
                  <summary>高级：手动指定 OpenCode Provider / Model</summary>
                  <label>
                    <input type="checkbox" checked={customOpenCodeProvider} onChange={(event) => {
                      opencodeDraftEdited.current = true
                      setCustomOpenCodeProvider(event.target.checked)
                    }} />手动指定 OpenCode Provider / Model
                  </label>
                  <p className="empty-note">用于 OpenCode 中已配置的自定义 Provider；ID 必须与实际配置一致。</p>
                  <label>
                    OpenCode Provider ID
                    <input aria-label="OpenCode Provider ID" disabled={!customOpenCodeProvider} value={opencodeProviderId} onChange={(event) => { opencodeDraftEdited.current = true; setOpencodeProviderId(event.target.value) }} />
                  </label>
                  <label>
                    OpenCode Model ID
                    <input aria-label="OpenCode Model ID" disabled={!customOpenCodeProvider} value={opencodeModelId} onChange={(event) => { opencodeDraftEdited.current = true; setOpencodeModelId(event.target.value) }} />
                  </label>
                </details>
              </>
            )}
            <button
              className="ghost-button"
              disabled={
                isSavingCodingConfiguration ||
                (codingExecutor === 'native-model'
                  ? !codingProviderId
                  : codingDiscovery?.candidates[0]?.status !== 'available' || !effectiveOpenCodeProviderId || !effectiveOpenCodeModelId)
              }
              onClick={saveCodingConfiguration}
            >
              <Save size={16} />{codingExecutor === 'opencode-http' ? '确认并用于当前项目' : '保存并用于当前项目'}
            </button>
            <p className="empty-note">当前：{codingConfiguration
              ? codingConfiguration.executor === 'native-model'
                ? `Native · ${codingConfigurationProviderName} · v${codingConfiguration.version}`
                : `OpenCode ${codingConfiguration.detectedVersion} · ${codingConfigurationProviderName === '旧版 Provider' ? codingConfiguration.providerId : codingConfigurationProviderName} / ${codingConfiguration.modelId} · v${codingConfiguration.version}`
              : '未配置'}</p>
          </article>

          <article className="agent-evidence-card" data-testid="coding-readiness-summary">
            <div className="section-heading"><span>启动前检查</span><strong>{readinessHeadline}</strong></div>
            {codingReadinessDisplay ? <>
              {readinessToFix.length ? <div className="trace-list">
                {readinessToFix.map((item) => (
                  <div className="trace-step" key={item.code}>
                    <span>需要处理</span>
                    <strong>{item.label}：{item.statusLabel}</strong>
                    <p>{item.detail}</p>
                    {item.remediation ? <p>处理方式：{item.remediation}</p> : null}
                  </div>
                ))}
              </div> : codingReadinessDisplay.status === 'ready'
                ? <p className="empty-note">本项目可以开始开发实现。</p>
                : <p className="empty-note">这里的设置都已就绪；在任务的开发实现步骤启动时，还会检查运行条件和本次预算。</p>}
              {readinessOther.length ? <details className="readiness-details">
                <summary>全部检查 · {codingReadinessDisplay.items.filter((item) => item.state === 'ready').length} 项通过</summary>
                <div className="trace-list">
                  {readinessOther.map((item) => (
                    <div className="trace-step" key={item.code}>
                      <span>{item.state === 'ready' ? '通过' : '启动时检查'}</span>
                      <strong>{item.label}：{item.statusLabel}</strong>
                      <p>{item.detail}</p>
                      {item.diagnosticCode ? <code>{item.diagnosticCode}</code> : null}
                    </div>
                  ))}
                </div>
              </details> : null}
            </> : <p className="empty-note">选择开发实现步骤后会显示启动前检查。</p>}
            {codingReadinessError ? <p className="empty-note">{codingReadinessError}</p> : null}
            {codingConfigurationStatus ? <p className="empty-note">{codingConfigurationStatus}</p> : null}
          </article>
        </div>
      </details>

      <details className="runtime-settings" open={!providerView.selectedProvider || focus === 'models'}>
        <summary>
          <span>
            <Settings2 size={16} />
            模型提供方 · 本机
          </span>
          <strong>{providerView.summary}</strong>
        </summary>
        <div className="runtime-settings__body">
          <article className="agent-evidence-card">
            <div className="section-heading">
              <span>门禁审查与默认使用的模型</span>
              <strong>{providerView.providerDataSource.status}</strong>
            </div>
            <p data-testid="review-provider-mode">
              <strong>{providerView.providerDataSource.label}</strong>
              {' '}
              {providerView.providerMode}
            </p>
            {providerView.selectedProvider ? (
              <div className="provider-row">
                <div>
                  <strong>{providerView.selectedProvider.name}</strong>
                  <span>{providerView.selectedProvider.kind}</span>
                </div>
                <code>
                  {providerView.selectedProvider.maskedCredential ?? providerView.selectedProvider.model}
                </code>
              </div>
            ) : (
              <p className="empty-note">当前未选择模型提供方。请选择已保存的提供方，或在下方新增。</p>
            )}
            {providers.length > 0 ? (
              <div className="provider-picker-controls">
                <label className="runtime-provider-picker">
                  使用已保存 Provider
                  <select aria-label="Saved Agent Provider" value={selectedProviderId}
                    onChange={(event) => onProviderChange(event.target.value)}>
                    <option value="">未选择 Provider</option>
                    {providers.map((provider) => (
                      <option key={provider.id} value={provider.id}>{provider.name} · {provider.model}</option>
                    ))}
                  </select>
                </label>
                <button className="ghost-button" aria-label="管理已保存 Provider" disabled={!desktopApi || !selectedProviderId}
                  onClick={() => setProviderRemovalTarget(providers.find((item) => item.id === selectedProviderId) ?? null)}>
                  <Settings2 size={16} />管理
                </button>
              </div>
            ) : null}
            {desktopApi && selectedProvider?.kind === 'openai-compatible' ? <SavedProviderThinkingSettings key={selectedProvider.id} provider={selectedProvider} api={desktopApi} onUpdated={onProviderUpdated} /> : null}
            {reviewExecutor && onReviewExecutorChange && providers.length > 0 ? (
              <label className="runtime-provider-picker" data-testid="review-executor-setting">
                门禁审查方式
                <select
                  aria-label="门禁审查方式"
                  value={reviewExecutor}
                  onChange={(event) => onReviewExecutorChange(event.target.value as StageAgentExecutorKind)}
                >
                  <option value="direct-provider">只依据材料与知识目录</option>
                  <option value="native-agent">结合仓库只读核对 · 内置</option>
                  <option value="local-agent">结合仓库只读核对 · OpenCode</option>
                </select>
                <small>
                  {reviewExecutor === 'native-agent'
                    ? '内置只读工具结合所选模型检查实际文件，报告保留文件与版本引用；不依赖 OpenCode，不修改代码、不批准 Gate。每轮模型调用单独计量。'
                    : reviewExecutor === 'local-agent'
                    ? '用所选模型启动本机 OpenCode，只读查看仓库后给出审查意见；不修改代码、不运行命令、不批准 Gate。需要本机 OpenCode 和已保存的 Provider；模型会调用多轮，费用通常高于只依据材料的审查。'
                    : '一次模型调用，只依据待审材料、项目说明和知识目录中的规范，不读取仓库。'}
                </small>
              </label>
            ) : null}
          </article>

          <article className="agent-evidence-card runtime-settings-form">
            <div className="section-heading">
              <span>新增模型提供方</span>
              <strong>OpenAI 兼容凭据</strong>
            </div>
            <p>新增后会自动设为当前模型提供方；明文密钥只保存在本机安全存储中，界面不会读回。</p>
            <label>
              Provider 名称
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
              模型（Model）
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
            <details><summary>高级配置</summary><ProviderThinkingFields model={providerModelDraft.trim()} baseUrl={providerBaseUrlDraft.trim()} value={newProviderThinking} onChange={setNewProviderThinking} /></details>
            <button className="ghost-button" onClick={() => onSaveProviderCredential(newProviderThinking)}>
              <Save size={16} />
              保存并使用 Provider
            </button>
          </article>
        </div>
      </details>
      {providerRemovalTarget && desktopApi ? <ProviderRemovalDialog
        provider={providerRemovalTarget} api={desktopApi}
        onCancel={() => setProviderRemovalTarget(null)}
        onDeleted={(providerId) => {
          onProviderRemoved(providerId)
          if (codingProviderId === providerId) setCodingProviderId('')
          setProviderRemovalTarget(null)
        }}
      /> : null}
    </div>
  )
}
