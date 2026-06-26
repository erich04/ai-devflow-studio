import { ArrowLeft, Bot, CheckCircle2, Code2, FolderOpen, Save } from 'lucide-react'
import {
  formatUsd,
  type AgentProviderConfig,
  type AgentReviewResult,
  type AgentTokenUsage,
  type AgentTrace,
  type CodingAgentEvent,
  type CodingAgentRun,
  type CodingDiffArtifact,
  type CodingPermissionDecision,
  type CodingPermissionRequest,
  type DependencyBootstrapEvidence,
  type ManagedCodingWorkspace,
  type RetryAttempt,
  type TestEvidence,
  type WorkflowNode,
  type WorkflowRun,
} from '@ai-devflow/shared'
import {
  buildAgentProviderDataSource,
  codingRuntimeLabel,
  codingTerminalLabel,
  codingTraceMetadataString,
  codingTraceSourceLabel,
  displayNodeTitle,
  type SupportContext,
} from '../app/desktop-view-model'

export function AgentWorkbenchView({
  providers,
  selectedProviderId,
  onProviderChange,
  providerIdDraft,
  onProviderIdDraftChange,
  providerBaseUrlDraft,
  onProviderBaseUrlDraftChange,
  providerModelDraft,
  onProviderModelDraftChange,
  providerKeyDraft,
  onProviderKeyDraftChange,
  onSaveProviderCredential,
  onRunKnowledgeReview,
  isRunning,
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
  providers: AgentProviderConfig[]
  selectedProviderId: string
  onProviderChange: (providerId: string) => void
  providerIdDraft: string
  onProviderIdDraftChange: (value: string) => void
  providerBaseUrlDraft: string
  onProviderBaseUrlDraftChange: (value: string) => void
  providerModelDraft: string
  onProviderModelDraftChange: (value: string) => void
  providerKeyDraft: string
  onProviderKeyDraftChange: (value: string) => void
  onSaveProviderCredential: () => void
  onRunKnowledgeReview: () => void
  isRunning: boolean
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
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId) ?? providers[0]
  const providerDataSource = buildAgentProviderDataSource(selectedProvider)
  const selectedProviderMode =
    selectedProvider?.kind === 'fake'
      ? `${providerDataSource.label} · deterministic fake · no model cost`
      : `${providerDataSource.label} · live OpenAI-compatible · may spend provider tokens`
  const runtimeLabel = latestCodingRun ? codingRuntimeLabel(latestCodingRun.engine) : 'No runtime'
  const terminalLabel = latestCodingRun ? codingTerminalLabel(latestCodingRun.status) : 'No terminal state'
  const cleanupStatus = workspace?.cleanupStatus ?? (workspace?.deletedAt ? 'deleted' : workspace ? 'active' : 'none')
  const budgetDecision = latestCodingRun?.budgetDecision
  const cleanupSummary =
    cleanupStatus === 'cleanup_failed'
      ? workspace?.cleanupError ?? 'Manual cleanup required.'
      : cleanupStatus === 'deleted'
        ? 'Managed workspace removed after the run.'
        : cleanupStatus === 'active'
          ? 'Managed workspace is still available for inspection.'
          : 'No managed workspace attached.'
  const toolTraceEvents = codingEvents.filter((event) => event.kind === 'tool_call' || event.kind === 'tool_result')

  return (
    <section className="page-grid" data-testid="agent-workbench">
      <div className="page-main">
        <div className="section-heading">
          <span>Agent Workbench</span>
          <strong>Knowledge Review Agent</strong>
        </div>
        {supportContext && (supportContext.focusTarget === 'knowledge-review' || supportContext.focusTarget === 'coding-agent') ? (
          <div className="support-context-banner" data-testid="support-context-banner">
            <div>
              <span className="panel-label">来自 Workbench Inspector</span>
              <strong>{supportContext.label}</strong>
              <p>
                当前目标：{selectedRun?.title ?? supportContext.runId} · {selectedNode ? displayNodeTitle(selectedNode) : supportContext.nodeId}
              </p>
            </div>
            <button className="ghost-button" type="button" onClick={onReturnToInspector}>
              <ArrowLeft size={16} />
              返回当前 Inspector
            </button>
          </div>
        ) : null}

        <article className="agent-run-card">
          <div>
            <span className="panel-label">Current Review Target</span>
            <strong>{selectedNode?.title ?? 'No selected node'}</strong>
            <p>{selectedRun?.title ?? 'No selected run'}</p>
          </div>
          <label>
            Review Model Provider
            <select
              aria-label="Review Model Provider"
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
          <div className="provider-mode-pill" data-testid="review-provider-mode">
            <strong>{providerDataSource.status}</strong>
            <span>{selectedProviderMode}</span>
          </div>
          <button className="primary-button" disabled={!selectedRun || !selectedNode || isRunning} onClick={onRunKnowledgeReview}>
            <Bot size={16} />
            {isRunning ? 'Review running' : 'Run Knowledge Review'}
          </button>
        </article>

        <article className="agent-provider-card">
          <div className="section-heading">
            <span>Review Model Credential</span>
            <strong>OpenAI-compatible / Volcengine Ark</strong>
          </div>
          <p>DevFlow Review Agent 会组装 review prompt 并调用这里配置的模型；明文 key 不会回读到 renderer。</p>
          <label>
            Provider ID
            <input
              aria-label="Review Provider ID"
              value={providerIdDraft}
              placeholder="doubao-review"
              onChange={(event) => onProviderIdDraftChange(event.target.value)}
            />
          </label>
          <label>
            Base URL
            <input
              aria-label="Review Provider Base URL"
              value={providerBaseUrlDraft}
              placeholder="https://ark.cn-beijing.volces.com/api/coding/v3"
              onChange={(event) => onProviderBaseUrlDraftChange(event.target.value)}
            />
          </label>
          <label>
            Model
            <input
              aria-label="Review Provider Model"
              value={providerModelDraft}
              placeholder="ark-code-latest"
              onChange={(event) => onProviderModelDraftChange(event.target.value)}
            />
          </label>
          <label>
            API Key
            <input
              aria-label="Review Provider API Key"
              type="password"
              value={providerKeyDraft}
              placeholder="sk-..."
              onChange={(event) => onProviderKeyDraftChange(event.target.value)}
            />
          </label>
          <button className="ghost-button" onClick={onSaveProviderCredential}>
            <Save size={16} />
            Save Credential
          </button>
        </article>

        <article className="agent-run-card" data-testid="coding-agent-panel">
          <div>
            <span className="panel-label">Coding Agent Adapter</span>
            <strong>{latestCodingRun ? latestCodingRun.status : 'No coding run yet'}</strong>
            <p>{latestCodingRun?.summary ?? 'DevFlow 会组装上下文、创建 worktree、转发权限并归档 diff。'}</p>
          </div>
          <button
            className="primary-button"
            disabled={!selectedRun || !selectedNode || isStartingCodingAgent}
            onClick={onRunCodingAgent}
          >
            <Code2 size={16} />
            {isStartingCodingAgent ? 'Starting Coding Agent' : 'Run Coding Agent'}
          </button>
        </article>

        <article className="agent-run-card">
          <div>
            <span className="panel-label">Policy Retry Attempts</span>
            <strong>{retryAttempts.length}</strong>
            <p>Human-approved retries launched from remediation candidates.</p>
          </div>
          {retryAttempts.slice(0, 3).map((attempt) => (
            <div className="compact-row" key={attempt.id}>
              <code>{attempt.status}</code>
              <span>{attempt.candidateIds.join(', ')}</span>
            </div>
          ))}
        </article>

        {pendingCodingPermission ? (
          <article className="agent-advisory agent-advisory--warn">
            <span>Permission Relay</span>
            <strong>{pendingCodingPermission.title}</strong>
            <p>{pendingCodingPermission.reasons.join(' ')}</p>
            <div className="knowledge-reference-meta">
              <span>{pendingCodingPermission.permission}</span>
              <span>{pendingCodingPermission.risk}</span>
              {pendingCodingPermission.filePath ? <code>{pendingCodingPermission.filePath}</code> : null}
            </div>
            <div className="inspector-actions">
              <button className="primary-button" onClick={() => onReplyCodingPermission('approved')}>
                <CheckCircle2 size={16} />
                Approve once
              </button>
              <button className="ghost-button" onClick={() => onReplyCodingPermission('rejected')}>
                Reject
              </button>
            </div>
          </article>
        ) : null}

        {latestCodingRun ? (
          <article className="agent-provider-card">
            <div className="section-heading">
              <span>Coding Run Evidence</span>
              <strong>{latestCodingRun.branchName}</strong>
            </div>
            <div className="compact-row">
              <span>Runtime</span>
              <strong>{runtimeLabel}</strong>
            </div>
            <div className="compact-row">
              <span>Terminal state</span>
              <strong>{terminalLabel}</strong>
            </div>
            <div className="compact-row">
              <span>Provider</span>
              <strong>{latestCodingRun.providerId}</strong>
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
            {testEvidence ? (
              <p className="empty-note">{testEvidence.summary}</p>
            ) : null}
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

        <div className="section-heading section-heading--inline">
          <span>Review History</span>
          <strong>当前节点审查记录</strong>
        </div>
        <div className="agent-review-list">
          {selectedReviews.length === 0 ? (
            <p className="empty-note">还没有 Knowledge Review。选择节点后运行一次审查。</p>
          ) : (
            selectedReviews.map((review) => (
              <article className="agent-review-card" key={review.id}>
                <div>
                  <span className="panel-label">{review.runtime}</span>
                  <strong>{review.conclusion}</strong>
                  <p>{review.summary}</p>
                </div>
                <div className="knowledge-reference-meta">
                  <span>{review.providerId}</span>
                  <span>{review.model}</span>
                  <span>{review.gateAdvisory.level}</span>
                  <span>{Math.round(review.confidence * 100)}%</span>
                </div>
                {review.risks.length > 0 && (
                  <ul>
                    {review.risks.map((risk) => (
                      <li key={risk}>{risk}</li>
                    ))}
                  </ul>
                )}
                {review.missingEvidence.length > 0 && (
                  <ul>
                    {review.missingEvidence.map((gap) => (
                      <li key={gap}>{gap}</li>
                    ))}
                  </ul>
                )}
              </article>
            ))
          )}
        </div>
      </div>

      <aside className="page-side">
        <strong>Provider Status</strong>
        {providers.map((provider) => (
          <div className="provider-row" key={provider.id}>
            <div>
              <strong>{provider.name}</strong>
              <span>{provider.kind}</span>
            </div>
            <code>{provider.maskedCredential ?? provider.model}</code>
          </div>
        ))}
        <div className="compact-row">
          <span>Provider source</span>
          <strong>{providerDataSource.label}</strong>
        </div>
        <strong>Selected Runtime</strong>
        <div className="compact-row">
          <span>Provider</span>
          <strong>{selectedProvider?.id ?? 'none'}</strong>
        </div>
        <div className="compact-row">
          <span>Total reviews</span>
          <strong>{reviews.length}</strong>
        </div>
        <div className="compact-row">
          <span>Latest cost</span>
          <strong>{latestUsage ? formatUsd(latestUsage.costUsd) : '$0.000'}</strong>
        </div>
        <div className="compact-row">
          <span>Usage source</span>
          <strong>{latestUsage?.source ?? 'none'}</strong>
        </div>

        <strong>Gate Advisory</strong>
        {latestReview ? (
          <article className={`agent-advisory agent-advisory--${latestReview.gateAdvisory.level}`}>
            <span>{latestReview.gateAdvisory.level}</span>
            <p>{latestReview.gateAdvisory.summary}</p>
            <small>{latestReview.gateAdvisory.blocksApproval ? 'blocking' : 'warning-only'}</small>
            <div className="compact-row">
              <span>Blocks approval</span>
              <strong>{latestReview.gateAdvisory.blocksApproval ? 'yes' : 'no'}</strong>
            </div>
          </article>
        ) : (
          <p className="empty-note">暂无 advisory。</p>
        )}

        <strong>Trace</strong>
        {latestTrace ? (
          <div className="trace-list">
            {latestTrace.steps.map((step) => (
              <div className="trace-step" key={step.id}>
                <span>{step.kind}</span>
                <strong>{step.label}</strong>
                <p>{step.summary}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-note">运行 Agent 后会显示 context、retrieval、provider_call、artifact trace。</p>
        )}

        <strong>Coding Trace</strong>
        {permissionRequests.length > 0 ? (
          <>
            <strong>Permission Timeline</strong>
            <div className="trace-list">
              {permissionRequests.map((request) => (
                <div className="trace-step" key={request.id}>
                  <span>{request.status}</span>
                  <strong>{request.title}</strong>
                  <p>{[request.permission, request.command, request.filePath].filter(Boolean).join(' · ')}</p>
                </div>
              ))}
            </div>
          </>
        ) : null}
        {toolTraceEvents.length > 0 ? (
          <>
            <strong>Tool / Skill Timeline</strong>
            <div className="trace-list">
              {toolTraceEvents.map((event) => {
                const toolName = codingTraceMetadataString(event.metadata, 'toolName') ?? event.kind
                const skillName = codingTraceMetadataString(event.metadata, 'skillName') ?? 'Unknown skill'
                const source = codingTraceSourceLabel(codingTraceMetadataString(event.metadata, 'source'))
                const summary =
                  codingTraceMetadataString(event.metadata, 'outputSummary') ??
                  codingTraceMetadataString(event.metadata, 'inputSummary') ??
                  event.message
                const commandSummary = codingTraceMetadataString(event.metadata, 'commandSummary')
                const filePath = codingTraceMetadataString(event.metadata, 'filePath')
                const redactionApplied = event.metadata?.redactionApplied === true
                return (
                  <div className="trace-step" key={event.id}>
                    <span>{source}</span>
                    <strong>{toolName}</strong>
                    <p>{skillName}</p>
                    <p>{summary}</p>
                    {(commandSummary || filePath || redactionApplied) && (
                      <p>{[commandSummary, filePath, redactionApplied ? 'Redacted' : undefined].filter(Boolean).join(' · ')}</p>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        ) : null}
        {codingEvents.length > 0 ? (
          <div className="trace-list">
            {codingEvents.map((event) => (
              <div className="trace-step" key={event.id}>
                <span>{event.kind}</span>
                <strong>{event.message}</strong>
                <p>{event.timestamp}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-note">运行 Coding Agent 后会显示 brief、permission、diff、bootstrap trace。</p>
        )}
        <div className="compact-row">
          <span>Coding runs</span>
          <strong>{codingRuns.length}</strong>
        </div>
        <div className="compact-row">
          <span>Permission requests</span>
          <strong>{permissionRequests.length}</strong>
        </div>
      </aside>
    </section>
  )
}
