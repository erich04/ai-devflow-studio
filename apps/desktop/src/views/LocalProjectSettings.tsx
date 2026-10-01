import { Play, Save } from 'lucide-react'
import type {
  CommandSafetyResult,
  LocalProject,
  ProjectGitStatus,
  TestEvidence,
  WorkflowNode,
  WorkflowRun,
} from '@ai-devflow/shared'
import { formatLocalTime } from '../app/desktop-view-model'
import { buildTestRunReadiness } from '../app/test-run-readiness'
import { passedEvidenceApplicability, type TestEvidenceFreshnessMap } from '../app/test-evidence-freshness'
import { formatStatusState } from '../app/node-inspector-view-model'

/**
 * 设置／本地项目 (plan Y2, Y4): the repository, the test command with its safety check, and a
 * read-only history of this project's test runs. Checks run at the task's test step (plan W4).
 */
export function LocalProjectSettings({
  project,
  gitStatus,
  evidence,
  evidenceFreshness = {},
  onHandleInTask,
  isRunningTests,
  commandDraft,
  onCommandDraftChange,
  onSaveCommand,
  commandSafety,
  isCommandDirty,
  isSavingCommand,
  selectedRun,
  selectedNode,
}: {
  project: LocalProject | undefined
  gitStatus: ProjectGitStatus | null
  evidence: TestEvidence[]
  /** Whether each passed result still applies to the current code (hardening H3). */
  evidenceFreshness?: TestEvidenceFreshnessMap
  /** Back to the task's test step; nothing runs from settings (plan W5). */
  onHandleInTask: () => void
  isRunningTests: boolean
  commandDraft: string
  onCommandDraftChange: (value: string) => void
  onSaveCommand: () => void
  commandSafety: CommandSafetyResult | null
  isCommandDirty: boolean
  isSavingCommand: boolean
  selectedRun: WorkflowRun | undefined
  selectedNode: WorkflowNode | undefined
}) {
  const testNode = selectedNode && (selectedNode.kind === 'test' || selectedNode.stage === 'test')
    ? selectedNode
    : selectedRun?.nodes.find((node) => node.kind === 'test' || node.stage === 'test')
  const latestEvidence = evidence.reduce<TestEvidence | undefined>((latest, item) => {
    if (item.runId !== selectedRun?.id || item.nodeId !== testNode?.id) return latest
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
  const applicability = latestEvidence ? passedEvidenceApplicability(latestEvidence, evidenceFreshness[latestEvidence.id]) : undefined
  const executionState = isRunningTests || latestEvidence?.status === 'running'
    ? { label: '执行中', tone: 'warn', detail: '本地测试命令正在执行。' }
    : latestEvidence?.status === 'passed'
      ? { label: applicability?.stale ? '已过期' : '已通过', tone: applicability?.stale ? 'warn' : 'good', detail: `${latestEvidence.summary} · ${applicability?.text ?? ''}` }
      : latestEvidence?.status === 'failed'
        ? { label: '失败', tone: 'bad', detail: latestEvidence.summary }
        : latestEvidence?.status === 'timed_out'
          ? { label: '已超时', tone: 'bad', detail: latestEvidence.summary }
          : { label: '待执行', tone: 'soft', detail: '当前任务还没有测试结果。' }
  // Same rule as the task's 「运行检查」 (plan W4): the reason is shown before any click.
  const { blockedReason: runBlockedReason, savedCommand } = buildTestRunReadiness({ project, run: selectedRun })
  const evidenceEmptyCopy = !project
    ? '选择本地仓库后再配置或执行测试。'
    : !savedCommand
      ? '配置当前项目的测试命令后，才能产生测试证据。'
      : !latestEvidence
        ? !runBlockedReason
          ? '当前任务尚未运行测试，可以在任务的测试步骤点击「运行检查」。'
          : '当前任务尚未运行测试。命令已保存不代表测试已完成。'
        : ''
  const workflowState = !selectedRun
    ? { label: '未选择任务', tone: 'soft', detail: '选择任务后显示测试步骤的状态。' }
    : !testNode
      ? { label: '没有测试步骤', tone: 'soft', detail: '当前任务的流程没有测试步骤。' }
      : testNode.status === 'success'
        ? { label: '测试步骤已完成', tone: 'good', detail: '任务的测试步骤已经完成。' }
        : testNode.status === 'failed'
          ? { label: '测试步骤失败', tone: 'bad', detail: '任务的测试步骤执行失败。' }
          : testNode.status === 'blocked'
            ? { label: '测试步骤受阻', tone: 'bad', detail: '任务的测试步骤正在等待阻断条件解除。' }
            : testNode.status === 'skipped'
              ? { label: '测试步骤已跳过', tone: 'soft', detail: '任务的测试步骤已被跳过。' }
              : testNode.status === 'running' || selectedRun.currentNodeId === testNode.id
                ? { label: '正在测试步骤', tone: 'warn', detail: '任务当前处于测试步骤。' }
                : { label: '等待测试', tone: 'soft', detail: '任务尚未进入测试步骤。' }
  const branch = !project
    ? '未选择仓库'
    : !gitStatus || gitStatus.projectId !== project.id
      ? '正在读取'
      : gitStatus.status === 'branch'
        ? gitStatus.branch
        : gitStatus.status === 'detached'
          ? `分离头指针 · ${gitStatus.shortSha}`
          : gitStatus.status === 'not_git'
            ? '不是 Git 仓库'
            : '不可用'

  return (
    <div className="settings-local-project" data-testid="settings-project">
      <article className="mini-card" aria-label="当前仓库">
        <p className="section-title">当前仓库</p>
        <div className="row"><strong>{project?.name ?? '未选择仓库'}</strong></div>
        <p className="meta mono">{project?.path ?? '在顶栏的项目菜单中选择本地仓库。'}</p>
        {project ? <p className="meta">分支：<span className="mono">{branch}</span></p> : null}
        <p className="meta">切换本地项目请使用顶栏的项目菜单。</p>
      </article>

      <article className="test-report">
        <div className="row">
          <strong>测试命令</strong>
          <span className="pill soft">本机执行</span>
        </div>
        <p>在测试步骤点击「运行检查」时执行这条命令，记录命令、结果、退出码、耗时以及脱敏后的输出摘要。失败、超时和跳过都会作为测试证据供 Gate 读取。</p>
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
          <span title={commandSafety?.level}>{commandSafety ? `安全检查：${commandSafety.level}` : '尚未进行安全检查'}</span>
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
            <span>测试步骤</span>
            <strong className={`pill ${workflowState.tone}`}>{workflowState.label}</strong>
            <small>{workflowState.detail}</small>
          </div>
        </div>
        {/* One execution entry (plan W5): the check runs at the task's test step. */}
        <div className="row">
          <button className="ghost-button" aria-describedby={runBlockedReason ? 'tests-run-blocked-reason' : undefined} disabled={!selectedRun} onClick={onHandleInTask}>
            <Play size={16} />
            {isRunningTests ? '测试中 · 在任务中查看' : '在任务中处理'}
          </button>
          {runBlockedReason && !isRunningTests ? <p className="meta" id="tests-run-blocked-reason" data-testid="tests-run-blocked-reason">{runBlockedReason}</p> : null}
        </div>
      </article>

      <section className="evidence-list" aria-label="本项目测试记录">
        <h3>本项目测试记录 · {evidence.length}</h3>
        <p className="meta">只读。结果在对应任务的测试步骤中查看；这里的记录不代表当前代码仍然通过。</p>
        {evidenceEmptyCopy ? <p className="empty-note" data-testid="tests-empty-state">{evidenceEmptyCopy}</p> : null}
        {evidence.map((item) => (
          <article className={`evidence-row evidence-row--${item.status}`} key={item.id}>
            <div>
              <span className="panel-label">本机测试证据</span>
              <strong title={item.status}>{formatStatusState(item.status)}</strong>
              <p>{item.summary}</p>
              <div className="evidence-meta">
                <span>退出码 {item.exitCode ?? '超时'}</span>
                <span>耗时 {item.durationMs}ms</span>
                <span>执行于 {formatLocalTime(item.createdAt)}</span>
                <span>{item.redacted ? '输出已脱敏' : '输出未脱敏'}</span>
              </div>
              <pre>{item.stdout || item.stderr || '（没有输出）'}</pre>
            </div>
            <code>{item.command}</code>
          </article>
        ))}
      </section>
    </div>
  )
}
