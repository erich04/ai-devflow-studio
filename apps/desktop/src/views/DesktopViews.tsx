import { type Node, type NodeProps } from '@xyflow/react'
import {
  Bot,
  CheckCircle2,
  ClipboardCheck,
  Code2,
  FolderOpen,
  GitPullRequest,
  Moon,
  Play,
  Save,
  Sun,
} from 'lucide-react'
import type * as React from 'react'
import {
  canRunCodingAgentOnNode,
  formatUsd,
  knowledgeEntities,
  knowledgeRelations,
  skills as fixtureSkills,
  type McpServerDefinition,
  type ThemePreference,
  type AgentEvent,
  type AgentProviderConfig,
  type AgentReviewResult,
  type AgentTokenUsage,
  type AgentTrace,
  type Artifact,
  type CodingAgentEvent,
  type CodingAgentRun,
  type CodingDiffArtifact,
  type CodingPermissionDecision,
  type CodingPermissionRequest,
  type CommandSafetyResult,
  type DataOrigin,
  type DependencyBootstrapEvidence,
  type GateEnforcementDecision,
  type GateOverrideDecision,
  type LocalProject,
  type KnowledgeDocument,
  type KnowledgeGovernanceCheck,
  type KnowledgeReference,
  type ManagedCodingWorkspace,
  type PolicySnapshot,
  type Project,
  type RemediationPlan,
  type RetryAttempt,
  type TeamMember,
  type TestEvidence,
  type TokenUsageRollup,
  type WorkflowNode,
  type WorkflowRun,
} from '@ai-devflow/shared'
import { GateEnforcementPanel } from '../GateEnforcementPanel'
import {
  codingRuntimeLabel,
  codingTerminalLabel,
  codingTraceMetadataString,
  codingTraceSourceLabel,
  displayNodeSubtitle,
  displayNodeTitle,
  matchesQuery,
  stageLabels,
  stageTone,
} from '../app/desktop-view-model'

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


export function NavButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button className={`nav-button ${active ? 'is-active' : ''}`} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  )
}

export function ThemeToggle({
  value,
  onChange,
}: {
  value: ThemePreference
  onChange: (value: ThemePreference) => void
}) {
  const next = value === 'system' ? 'light' : value === 'light' ? 'dark' : 'system'
  const label = value === 'system' ? '跟随系统' : value === 'light' ? '浅色' : '深色'

  return (
    <button
      className="theme-toggle"
      onClick={() => onChange(next)}
      aria-label="Toggle color theme"
      data-testid="theme-toggle"
    >
      {value === 'dark' ? <Moon size={16} /> : <Sun size={16} />}
      {label}
    </button>
  )
}

export function Metric({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="metric">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

export function LocalProjectPanel({
  project,
  commandDraft,
  onCommandDraftChange,
  onSelectProject,
  onSaveCommand,
  desktopConnected,
  commandSafety,
  isCommandDirty,
  isSavingCommand,
}: {
  project: LocalProject | undefined
  commandDraft: string
  onCommandDraftChange: (value: string) => void
  onSelectProject: () => void
  onSaveCommand: () => void
  desktopConnected: boolean
  commandSafety: CommandSafetyResult | null
  isCommandDirty: boolean
  isSavingCommand: boolean
}) {
  const saveLabel = isSavingCommand
    ? '保存中...'
    : project && commandDraft.trim() && !isCommandDirty
      ? '已保存'
      : '保存测试命令'

  return (
    <section className="local-project-panel" aria-label="Local project">
      <div className="section-heading">
        <span>Local Project</span>
        <strong>{project?.name ?? '未选择仓库'}</strong>
      </div>
      <p>{project?.path ?? (desktopConnected ? '选择本地仓库后，DevFlow 会识别测试命令。' : '浏览器预览模式无法打开本地目录。')}</p>
      <button className="ghost-button" onClick={onSelectProject}>
        <FolderOpen size={16} />
        选择本地仓库
      </button>
      <label>
        测试命令
        <input
          aria-label="测试命令"
          value={commandDraft}
          placeholder="例如 pnpm test"
          onChange={(event) => onCommandDraftChange(event.target.value)}
        />
      </label>
      {commandSafety && (
        <div className={`command-safety command-safety--${commandSafety.level}`}>
          <div className="compact-row">
            <span>Risk</span>
            <strong>{commandSafety.level}</strong>
          </div>
          <div className="compact-row">
            <span>Command</span>
            <code>{commandSafety.normalizedCommand || commandDraft}</code>
          </div>
          {project && (
            <div className="compact-row">
              <span>CWD</span>
              <code>{project.path}</code>
            </div>
          )}
          <div className="compact-row">
            <span>Timeout</span>
            <strong>120s</strong>
          </div>
          {commandSafety.reasons.map((reason) => (
            <p key={reason}>{reason}</p>
          ))}
        </div>
      )}
      <button
        className="primary-button"
        disabled={!project || !commandDraft.trim() || !isCommandDirty || isSavingCommand}
        onClick={onSaveCommand}
      >
        <Save size={16} />
        {saveLabel}
      </button>
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
  onRunTests,
  onRunKnowledgeReview,
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
  onRunTests: () => void
  onRunKnowledgeReview: () => void
  onRunCodingAgent: () => void
  onCreatePrDraft: () => void
  onCreateAcceptanceBundle: () => void
  isRunningTests: boolean
  isRunningAgentReview: boolean
  isStartingCodingAgent: boolean
}) {
  if (!selectedNode) {
    return <aside className="inspector">请选择一个节点</aside>
  }

  return (
    <aside className="inspector" data-testid="node-inspector">
      <div className="section-heading">
        <span>Selected Node</span>
        <strong>{displayNodeTitle(selectedNode)}</strong>
      </div>
      <div className="node-summary">
        <span>{stageLabels[selectedNode.stage]}</span>
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
        onRunKnowledgeReview={onRunKnowledgeReview}
        isCurrentNodeAgent={Boolean(
          selectedRun &&
            selectedNode.kind === 'agent' &&
            selectedRun.currentNodeId === selectedNode.id &&
            selectedNode.status !== 'success',
        )}
      />

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
              </article>
            )
          })
        )}
      </div>

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
        <button className="ghost-button" disabled={isRunningAgentReview} onClick={onRunKnowledgeReview}>
          <Bot size={16} />
          {isRunningAgentReview ? '审查中' : 'Agent Review'}
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
        <button className="ghost-button" disabled={isRunningTests} onClick={onRunTests}>
          <Play size={16} />
          {isRunningTests ? '测试中' : '执行测试'}
        </button>
      </div>

      <div className="artifact-list">
        <span className="panel-label">Artifacts</span>
        {artifacts.map((artifact) => (
          <article key={artifact.id} className="artifact-card">
            <strong>{artifact.title}</strong>
            <p>{artifact.summary}</p>
            <code>{artifact.content}</code>
          </article>
        ))}
      </div>

      <div className="event-list">
        <span className="panel-label">Agent Events</span>
        {events.map((event) => (
          <div className="event-row" key={event.id}>
            <span>{event.kind}</span>
            <p>{event.message}</p>
          </div>
        ))}
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
}: {
  projects: Project[]
  members: TeamMember[]
  projectRollups: TokenUsageRollup[]
  memberRollups: TokenUsageRollup[]
  totalCost: string
  dataOrigin: DataOrigin
}) {
  return (
    <section className="page-grid" data-testid="team-overview">
      <div className="page-main">
        <div className="section-heading">
          <span>Team Overview · {dataOrigin}</span>
          <strong>项目交付健康</strong>
        </div>
        {projects.map((project) => (
          <article key={project.id} className="wide-card">
            <div>
              <strong>{project.name}</strong>
              <p>{project.repository}</p>
            </div>
            <span className={`health health--${project.health}`}>{project.health}</span>
            <span>{project.testCommand}</span>
          </article>
        ))}
      </div>
      <aside className="page-side">
        <strong>Cost Rollup</strong>
        <div className="compact-row">
          <span>Total</span>
          <strong>{totalCost}</strong>
        </div>
        {projectRollups.map((rollup) => (
          <div className="compact-row" key={rollup.key}>
            <span>{rollup.key}</span>
            <strong>{formatUsd(rollup.costUsd)}</strong>
          </div>
        ))}
        <strong>Members</strong>
        {members.map((member) => (
          <div className="compact-row" key={member.id}>
            <span>{member.name}</span>
            <strong>{member.role}</strong>
          </div>
        ))}
        {memberRollups.map((rollup) => (
          <div className="compact-row" key={rollup.key}>
            <span>{rollup.key}</span>
            <strong>{rollup.totalTokens.toLocaleString()} tokens</strong>
          </div>
        ))}
      </aside>
    </section>
  )
}

export function KnowledgeView({
  query,
  documents,
  references,
  selectedRun,
}: {
  query: string
  documents: KnowledgeDocument[]
  references: KnowledgeReference[]
  selectedRun: WorkflowRun | undefined
}) {
  const documentById = new Map(documents.map((document) => [document.id, document]))
  const visibleDocuments = documents.filter((document) =>
    matchesQuery(query, [
      document.title,
      document.category,
      document.summary,
      document.sourcePath,
      ...document.tags,
    ]),
  )
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
        </div>
        {visibleDocuments.length === 0 ? (
          <p className="empty-note">没有匹配的知识文档</p>
        ) : (
          <div className="knowledge-doc-list">
            {visibleDocuments.map((document) => (
              <article className="knowledge-doc-card" key={document.id}>
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
              <article className="reference-row" key={reference.id}>
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
}) {
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId) ?? providers[0]
  const selectedProviderMode =
    selectedProvider?.kind === 'fake'
      ? 'Deterministic fake · no model cost'
      : 'Live OpenAI-compatible · may spend provider tokens'
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
            {selectedProviderMode}
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

export function SkillView() {
  return (
    <section className="page-list" data-testid="skill-view">
      <div className="section-heading">
        <span>Skills</span>
        <strong>团队能力目录</strong>
      </div>
      {fixtureSkills.map((skill) => (
        <article className="wide-card" key={skill.id}>
          <div>
            <strong>{skill.name}</strong>
            <p>{skill.description}</p>
          </div>
          <span>{skill.stage}</span>
          <span>{skill.enabled ? 'Enabled' : 'Disabled'}</span>
        </article>
      ))}
    </section>
  )
}

export function McpView({
  servers,
  onToggle,
}: {
  servers: McpServerDefinition[]
  onToggle: (id: string) => void
}) {
  return (
    <section className="page-list" data-testid="mcp-view">
      <div className="section-heading">
        <span>MCP</span>
        <strong>本机工具连接器</strong>
      </div>
      {servers.map((server) => (
        <article className="wide-card" key={server.id}>
          <div>
            <strong>{server.name}</strong>
            <p>{server.command}</p>
          </div>
          <span>{server.permission}</span>
          <button className="ghost-button" onClick={() => onToggle(server.id)}>
            {server.enabledLocally ? 'Disable' : 'Enable'}
          </button>
        </article>
      ))}
    </section>
  )
}

export function TestsView({
  evidence,
  onRunTests,
  isRunningTests,
}: {
  evidence: TestEvidence[]
  onRunTests: () => void
  isRunningTests: boolean
}) {
  return (
    <section className="page-grid" data-testid="tests-view">
      <div className="page-main">
        <div className="section-heading">
          <span>Testing</span>
          <strong>测试计划与证据</strong>
        </div>
        <article className="test-report">
          <strong>Health endpoint test pack</strong>
          <p>覆盖 ok、degraded、down、Redis timeout、日志脱敏和 smoke 调用。</p>
          <div className="test-bars">
            <span style={{ inlineSize: '88%' }} />
          </div>
          <button className="primary-button" disabled={isRunningTests} onClick={onRunTests}>
            <Play size={16} />
            {isRunningTests ? '测试中' : '执行本地测试'}
          </button>
        </article>
        <div className="evidence-list">
          {evidence.length === 0 ? (
            <p className="empty-note">还没有真实测试证据。选择本地仓库后执行测试。</p>
          ) : (
            evidence.map((item) => (
              <article className="evidence-row" key={item.id}>
                <div>
                  <span className="panel-label">Local test evidence</span>
                  <strong>{item.status}</strong>
                  <p>{item.summary}</p>
                  <div className="evidence-meta">
                    <span>Exit code {item.exitCode ?? 'timeout'}</span>
                    <span>Duration {item.durationMs}ms</span>
                    <span>Redacted {item.redacted ? 'yes' : 'no'}</span>
                  </div>
                  <pre>{item.stdout || item.stderr || '(empty output)'}</pre>
                </div>
                <code>{item.command}</code>
              </article>
            ))
          )}
        </div>
      </div>
      <aside className="page-side">
        <strong>Evidence</strong>
        <div className="compact-row">
          <span>Local runs</span>
          <strong>{evidence.length}</strong>
        </div>
        <div className="compact-row">
          <span>Unit</span>
          <strong>12 passed</strong>
        </div>
        <div className="compact-row">
          <span>Smoke</span>
          <strong>3 passed</strong>
        </div>
        <div className="compact-row">
          <span>Coverage</span>
          <strong>86%</strong>
        </div>
      </aside>
    </section>
  )
}
