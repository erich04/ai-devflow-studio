import { ProviderRemovalDialog } from './ProviderRemovalDialog'
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
  type WorkflowNode,
} from '@ai-devflow/shared'
import type { DevFlowDesktopApi } from '../desktop-api'
import { buildProviderSettingsView } from '../app/agent-evidence-view-model'
import { buildCodingReadinessDisplay } from '../app/coding-runtime-readiness-view-model'
import type { ProjectRuntimeBudget } from '../app/useProjectRuntimeBudget'

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
      if (active) setCodingConfigurationStatus(error instanceof Error ? error.message : '无法读取项目执行工具配置')
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
      setCodingConfigurationStatus(error instanceof Error ? error.message : '保存 Coding Agent 配置失败')
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
      setCodingConfigurationStatus(error instanceof Error ? error.message : '检测 OpenCode 失败')
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
      setCodingConfigurationStatus(error instanceof Error ? error.message : '创建一次性预算批准失败')
    } finally {
      setIsSavingCodingConfiguration(false)
    }
  }

  const configurationIssues = codingReadiness && codingReadiness.projectId === localProjectId
    ? codingReadiness.checks.filter((check) => check.status === 'blocked' && !['wrong_workflow_node', 'active_run', 'permission_pending', 'budget_blocked'].includes(check.code))
    : []
  const codingConfigurationLabel = !codingConfiguration || codingConfiguration.projectId !== localProjectId
    ? '未配置'
    : configurationIssues.length ? '配置需处理' : '已配置'
  const codingReadinessDisplay = codingReadiness ? buildCodingReadinessDisplay(codingReadiness) : null
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
            <div className="section-heading">
              <span>云端团队预算</span>
              <strong>{projectRuntimeBudget.label}</strong>
            </div>
            <p>作用于整个团队项目的月度美元预算；一次性批准需要 Owner 或 Lead 权限，不会更改 API Key。</p>
            <p>聊天、澄清、设计、审查和编码的每次模型请求都会重新检查。预估用于预警和准入，实际用量按返回记录；未知费用需核对。</p>
            <dl className="runtime-budget-summary" data-testid="runtime-budget-summary">
              <div><dt>月上限</dt><dd>{budgetPolicy ? `${formatUsd(budgetPolicy.monthlyLimitUsd)} / 月` : '尚未配置'}</dd></div>
              <div><dt>预警阈值</dt><dd>{budgetPolicy ? formatUsd(budgetPolicy.warningThresholdUsd) : '尚未配置'}</dd></div>
              <div><dt>策略更新时间</dt><dd>{budgetPolicy?.updatedAt ?? '尚未同步'}</dd></div>
            </dl>
            <p className="meta">周期：UTC 自然月 · 超限：需额外批准。</p>
            {/* Team budget is a team-side setting: it is edited on the Web (plan S5, Q7; 4.3 节). */}
            <p data-testid="runtime-budget-web-location">修改月上限与预警阈值：在 Web 控制端打开「设置 › 预算」，选择当前连接的团队项目。保存后回到这里点「同步云端预算策略」读取。</p>
            <button className="ghost-button" onClick={() => void projectRuntimeBudget.refresh()}>同步云端预算策略</button>
            {modelBudget && <p role="status">最近一次模型预算检查：{modelBudget.decision.reason}</p>}
            {codingConfigurationStatus ? <p role="status">{codingConfigurationStatus}</p> : null}
            {projectRuntimeBudget.error ? <p role="alert">{projectRuntimeBudget.error}</p> : null}
            {projectRuntimeBudget.status === 'unavailable' ? <button className="ghost-button" onClick={() => void projectRuntimeBudget.refresh()}>重试读取预算</button> : null}
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

      <details className="runtime-settings" open={codingReadiness?.status !== 'ready' || focus === 'coding'} ref={runtimeSettingsRef} tabIndex={-1}>
        <summary>
          <span><Code2 size={16} />项目执行工具 · 本地项目</span>
          <strong>{codingConfigurationLabel}</strong>
        </summary>
        <div className="runtime-settings__body">
          <article className="agent-evidence-card runtime-settings-form">
            <div className="section-heading">
              <span>开发实现使用的工具</span>
              <strong>{codingExecutor === 'native-model' ? 'DevFlow Native（内置编码执行器）' : 'OpenCode'}</strong>
            </div>
            <p>这里设置开发实现使用的工具和模型。需求澄清、方案设计可在各自步骤选择 Direct Provider 或只读 OpenCode；讨论栏单独选择，不随这里切换。</p>
            {codingExecutor === 'native-model' ? <p className="empty-note">执行器版本：v2。旧称 Native Coding Agent / Native Executor，均指 DevFlow Native。</p> : null}
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

          <article className="agent-evidence-card">
            <div className="section-heading"><span>启动前检查</span><strong>{codingReadinessDisplay?.statusLabel ?? '未读取'}</strong></div>
            <div className="trace-list">
              {codingReadinessDisplay?.items.map((item) => (
                <div className="trace-step" key={item.code}>
                  <span>{item.state === 'ready' ? '通过' : '阻塞'}</span>
                  <strong>{item.label}：{item.statusLabel}</strong>
                  <p>{item.detail}</p>
                  {item.remediation ? <p>处理方式：{item.remediation}</p> : null}
                  {item.diagnosticCode ? <details><summary>诊断详情</summary><code>{item.diagnosticCode}</code></details> : null}
                </div>
              )) ?? <p className="empty-note">选择开发实现步骤后会显示完整的启动前检查。</p>}
            </div>
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
