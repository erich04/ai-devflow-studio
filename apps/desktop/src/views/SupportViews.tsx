import { ArrowLeft, Play, Save } from 'lucide-react'
import {
  skills as fixtureSkills,
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
        {fixtureSkills.map((skill) => (
          <article className="mini-card" key={skill.id}>
            <div className="row">
              <strong>{skill.name}</strong>
              <span className={`pill ${skill.enabled ? 'good' : 'soft'}`}>{skill.enabled ? 'enabled' : 'disabled'}</span>
            </div>
            <p className="meta">stage: {skill.stage} · {skill.description}</p>
          </article>
        ))}
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
            {servers.map((server) => (
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
              placeholder="例如 pnpm verify --filter @devflow/desktop"
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
          <div className="test-bars">
            <span style={{ inlineSize: '88%' }} />
          </div>
          <button
            className="ghost-button"
            disabled={!project || !commandDraft.trim() || !isCommandDirty || isSavingCommand}
            onClick={onSaveCommand}
          >
            <Save size={16} />
            {isSavingCommand ? '保存中...' : project && commandDraft.trim() && !isCommandDirty ? '已保存' : '保存测试命令'}
          </button>
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
          <span>Unit</span>
          <strong>12 passed</strong>
        </div>
        <div className="compact-row">
          <span>Smoke</span>
          <strong>3 passed</strong>
        </div>
        <div className="compact-row">
          <span>Failed / timeout / skipped</span>
          <strong>saved as Evidence</strong>
        </div>
        <div className="compact-row">
          <span>Coverage</span>
          <strong>86%</strong>
        </div>
      </aside>
    </section>
  )
}
