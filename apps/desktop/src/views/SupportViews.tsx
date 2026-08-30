import { ArrowLeft, Play, Save } from 'lucide-react'
import {
  type CommandSafetyResult,
  type LocalProject,
  type McpServerDefinition,
  type TestEvidence,
  type WorkflowNode,
  type WorkflowRun,
} from '@ai-devflow/shared'
import {
  displayNodeTitle,
  type SupportContext,
} from '../app/desktop-view-model'

export function SkillView() {
  return (
    <section className="page-list skill-view" data-testid="skill-view">
      <div className="panel-head">
        <span className="panel-title">团队能力目录</span>
        <span className="pill soft">Skills 不能绕过 Gate / policy / evidence requirements</span>
      </div>
      <div className="panel-body page-grid three">
        <p className="empty-note">未加载真实团队 Skills。同步团队配置后再显示能力目录。</p>
      </div>
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
      <div className="panel-head">
        <span className="panel-title">本机工具连接器 MCP</span>
        <span className="pill soft">本地执行边界，不是云端集成市场</span>
      </div>
      <div className="panel-body">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Command</th>
              <th>Permission</th>
              <th>enabledLocally</th>
              <th>Security state</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {servers.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <p className="empty-note">未加载本地 MCP 连接器。</p>
                </td>
              </tr>
            ) : servers.map((server) => (
              <tr key={server.id}>
                <td><strong>{server.name}</strong></td>
                <td className="mono">{server.command}</td>
                <td>{server.permission}</td>
                <td><span className={`pill ${server.enabledLocally ? 'good' : 'warn'}`}>{String(server.enabledLocally)}</span></td>
                <td>{server.enabledLocally ? 'confined to local project' : 'requires explicit enable'}</td>
                <td>
                  <button className="ghost-button" onClick={() => onToggle(server.id)}>
                    {server.enabledLocally ? 'Disable' : 'Enable'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function TestsView({
  evidence,
  onRunTests,
  isRunningTests,
  commandDraft,
  onCommandDraftChange,
  onSaveCommand,
  project,
  commandSafety,
  isCommandDirty,
  isSavingCommand,
  supportContext,
  selectedRun,
  selectedNode,
  onReturnToInspector,
}: {
  evidence: TestEvidence[]
  onRunTests: () => void
  isRunningTests: boolean
  commandDraft: string
  onCommandDraftChange: (value: string) => void
  onSaveCommand: () => void
  project: LocalProject | undefined
  commandSafety: CommandSafetyResult | null
  isCommandDirty: boolean
  isSavingCommand: boolean
  supportContext: SupportContext | null
  selectedRun: WorkflowRun | undefined
  selectedNode: WorkflowNode | undefined
  onReturnToInspector: () => void
}) {
  const passedEvidenceCount = evidence.filter((item) => item.status === 'passed').length
  const failedEvidenceCount = evidence.filter((item) => item.status === 'failed').length
  const timedOutEvidenceCount = evidence.filter((item) => item.status === 'timed_out').length
  const testNode = selectedNode && (selectedNode.kind === 'test' || selectedNode.stage === 'test')
    ? selectedNode
    : selectedRun?.nodes.find((node) => node.kind === 'test' || node.stage === 'test')
  const latestEvidence = evidence.reduce<TestEvidence | undefined>((latest, item) => {
    if (item.runId !== selectedRun?.id || item.nodeId !== testNode?.id) {
      return latest
    }
    return !latest || item.createdAt > latest.createdAt ? item : latest
  }, undefined)
  const commandState = !project
    ? { label: '未选择仓库', tone: 'soft', detail: '选择本地仓库后才能保存测试命令。' }
    : !commandDraft.trim()
      ? { label: '未配置', tone: 'soft', detail: '当前项目还没有可执行的测试命令。' }
      : isSavingCommand
        ? { label: '保存中', tone: 'warn', detail: '正在把命令保存到当前本地项目。' }
        : isCommandDirty
          ? { label: '有未保存修改', tone: 'warn', detail: '当前输入尚未保存，不代表测试已经执行。' }
          : { label: '已保存', tone: 'good', detail: '命令已保存到本地项目；这不代表测试已经完成。' }
  const executionState = isRunningTests || latestEvidence?.status === 'running'
    ? { label: '执行中', tone: 'warn', detail: '本地测试命令正在执行。' }
    : latestEvidence?.status === 'passed'
      ? { label: '已通过', tone: 'good', detail: latestEvidence.summary }
      : latestEvidence?.status === 'failed'
        ? { label: '失败', tone: 'bad', detail: latestEvidence.summary }
        : latestEvidence?.status === 'timed_out'
          ? { label: '已超时', tone: 'bad', detail: latestEvidence.summary }
          : { label: '待执行', tone: 'soft', detail: '尚未产生当前 Run 的测试结果。' }
  const workflowState = !selectedRun
    ? { label: '未选择 Run', tone: 'soft', detail: '选择 Run 后显示 Workflow 测试节点状态。' }
    : !testNode
      ? { label: '无测试节点', tone: 'soft', detail: '当前 Workflow 没有测试节点。' }
      : testNode.status === 'success'
        ? { label: '测试节点已完成', tone: 'good', detail: 'Workflow 的测试节点已经完成。' }
        : testNode.status === 'failed'
          ? { label: '测试节点失败', tone: 'bad', detail: 'Workflow 的测试节点执行失败。' }
          : testNode.status === 'blocked'
            ? { label: '测试节点已阻断', tone: 'bad', detail: 'Workflow 的测试节点正在等待阻断条件解除。' }
            : testNode.status === 'skipped'
              ? { label: '测试节点已跳过', tone: 'soft', detail: 'Workflow 的测试节点已被跳过。' }
              : testNode.status === 'running' || selectedRun.currentNodeId === testNode.id
                ? { label: '当前测试节点', tone: 'warn', detail: 'Workflow 当前正在测试阶段。' }
                : { label: '等待测试', tone: 'soft', detail: 'Workflow 尚未进入测试节点。' }

  return (
    <section className="page-grid" data-testid="tests-view">
      <div className="page-main">
        <div className="panel-head">
          <span className="panel-title">测试计划与证据</span>
          <button className="primary-button" aria-label="执行测试" disabled={isRunningTests} onClick={onRunTests}>
            <Play size={16} />
            {isRunningTests ? '测试中' : '执行本地测试'}
          </button>
        </div>
        {supportContext?.focusTarget === 'local-tests' ? (
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
        <article className="test-report">
          <div className="row">
            <strong>Test package</strong>
            <span className="pill soft">local execution</span>
          </div>
          <p>执行本地测试命令，保存 command、status、exit code、duration、redacted stdout/stderr 摘要，并回写 Workbench Inspector。失败、超时、跳过都必须成为 Gate 可读的 Evidence 状态。</p>
          <label className="field">
            <span>测试命令</span>
            <input
              aria-label="测试命令"
              className="input mono"
              value={commandDraft}
              placeholder="例如 npm test"
              onChange={(event) => onCommandDraftChange(event.target.value)}
            />
          </label>
          <div className="knowledge-reference-meta">
            <span>{project ? project.name : '未选择仓库'}</span>
            <span>{commandSafety?.level ?? 'pending safety check'}</span>
            {commandSafety?.normalizedCommand ? <code>{commandSafety.normalizedCommand}</code> : null}
          </div>
          {commandSafety && commandSafety.reasons.length > 0 ? (
            <div className={`command-safety command-safety--${commandSafety.level}`}>
              {commandSafety.reasons.map((reason) => (
                <p key={reason}>{reason}</p>
              ))}
            </div>
          ) : null}
          <button
            className="ghost-button"
            disabled={!project || !commandDraft.trim() || !isCommandDirty || isSavingCommand}
            onClick={onSaveCommand}
          >
            <Save size={16} />
            {isSavingCommand ? '保存中...' : project && commandDraft.trim() && !isCommandDirty ? '已保存' : '保存测试命令'}
          </button>
          <div className="test-state-list" aria-label="测试状态">
            <div className="test-state-row" data-testid="test-command-status">
              <span>命令配置</span>
              <strong className={`pill ${commandState.tone}`}>{commandState.label}</strong>
              <small>{commandState.detail}</small>
            </div>
            <div className="test-state-row" data-testid="test-execution-status">
              <span>本次执行</span>
              <strong className={`pill ${executionState.tone}`}>{executionState.label}</strong>
              <small>{executionState.detail}</small>
            </div>
            <div className="test-state-row" data-testid="test-workflow-status">
              <span>Workflow</span>
              <strong className={`pill ${workflowState.tone}`}>{workflowState.label}</strong>
              <small>{workflowState.detail}</small>
            </div>
          </div>
        </article>
        <div className="evidence-list">
          {evidence.length === 0 ? (
            <p className="empty-note">还没有真实测试证据。选择本地仓库后执行测试。</p>
          ) : (
            evidence.map((item) => (
              <article className={`evidence-row evidence-row--${item.status}`} key={item.id}>
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
          <span>Passed</span>
          <strong>{passedEvidenceCount}</strong>
        </div>
        <div className="compact-row">
          <span>Failed</span>
          <strong>{failedEvidenceCount}</strong>
        </div>
        <div className="compact-row">
          <span>Timed out</span>
          <strong>{timedOutEvidenceCount}</strong>
        </div>
        <div className="compact-row">
          <span>Coverage</span>
          <strong>not loaded</strong>
        </div>
      </aside>
    </section>
  )
}
