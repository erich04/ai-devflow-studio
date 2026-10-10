import { SessionPermissionChoice } from '../components/CodingSessionPermissions'
import { CheckCircle2 } from 'lucide-react'
import type { CodingAgentRun, CodingPermissionDecision, CommandRiskLevel, ManagedCodingWorkspace } from '@ai-devflow/shared'
import { codingPermissionDecisionState, type CodingPermissionProjection } from '../app/coding-runtime-action-projection'
import { formatLocalTime } from '../app/desktop-view-model'
import { formatStatusState } from '../app/node-inspector-view-model'

export type UnifiedDiffFile = { path: string; content: string }
/** Command risk as shown to the reviewer; the stored value stays unchanged. */
export const commandRiskLabels: Record<CommandRiskLevel, string> = { safe: '低', warn: '需注意', blocked: '已阻止' }

export function splitUnifiedDiffByFile(diff: string): UnifiedDiffFile[] {
  const starts = [...diff.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gmu)]
  if (starts.length === 0) {
    return diff.trim() ? [{ path: '全部改动', content: diff }] : []
  }
  return starts.map((match, index) => ({
    path: match[2] ?? match[1] ?? `file-${index + 1}`,
    content: diff.slice(match.index!, starts[index + 1]?.index ?? diff.length),
  }))
}

export function CodingChangeSetReview({
  permission,
  run,
  workspace,
  isReplying,
  onDecision,
}: {
  permission: CodingPermissionProjection
  run: CodingAgentRun
  workspace: ManagedCodingWorkspace | undefined
  isReplying: boolean
  onDecision: (decision: CodingPermissionDecision['decision'], scope?: 'once' | 'session') => void
}) {
  const isAcceptance = permission.kind === 'change-acceptance'
  const preview = permission.previewVerified ? permission.preview : undefined
  const unifiedDiff = isAcceptance
    ? permission.diffArtifact?.patch
    : preview?.unifiedDiff
  const files = unifiedDiff ? splitUnifiedDiffByFile(unifiedDiff) : []
  const remainingSeconds = Math.ceil(permission.remainingMs / 1_000)
  // Approval needs the exact diff on screen (plan W3); rejection follows the shared rule.
  const { approveDisabled: approvalDisabled, rejectDisabled: rejectionDisabled } = codingPermissionDecisionState({
    permission,
    runStatus: run.status,
    isReplying,
    diffShown: files.length > 0,
  })

  return (
    <section
      className="change-set-review"
      aria-labelledby="change-set-review-title"
      data-testid="coding-change-set-review"
    >
      <header className="change-set-review__header">
        <div>
          <span className="panel-label">
            {isAcceptance ? '最终变更接收（Change Acceptance）' : '代码改动审批（Change Set）'}
          </span>
          <h2 id="change-set-review-title">{permission.request.title}</h2>
          <p>
            {isAcceptance
              ? 'DevFlow 已重新捕获 Git Diff 并运行项目保存的权威测试；只有接收后才推进 Workflow。'
              : '只审批下列已验证 diff；批准不适用于其他 Run、节点、digest 或过期请求。'}
          </p>
        </div>
        <span className={`pill ${permission.canApprove ? 'warn' : 'bad'}`} aria-live="polite">
          {permission.expired ? '已过期' : `剩余 ${remainingSeconds} 秒`}
        </span>
      </header>

      <dl className="change-set-review__facts">
        <div><dt>编码运行</dt><dd><code>{run.id}</code></dd></div>
        <div><dt>步骤</dt><dd><code>{run.nodeId}</code></dd></div>
        <div><dt>风险</dt><dd>{commandRiskLabels[permission.request.risk] ?? permission.request.risk}</dd></div>
        <div><dt>文件数</dt><dd>{permission.changedPaths.length}</dd></div>
        <div><dt>改动指纹</dt><dd><code>{permission.changeSetDigest ?? permission.request.diffSourceDigest ?? '不可用'}</code></dd></div>
        {isAcceptance ? (
          <div><dt>权威测试</dt><dd>{permission.testEvidence ? formatStatusState(permission.testEvidence.status) : '不可用'}</dd></div>
        ) : null}
        <div><dt>审批截止</dt><dd>{formatLocalTime(permission.request.expiresAt)}</dd></div>
        <div className="change-set-review__fact-wide"><dt>受管工作树</dt><dd><code>{workspace?.worktreePath ?? '不可用'}</code></dd></div>
      </dl>

      {permission.staleReason ? (
        <div className="change-set-review__blocked" role="alert">
          <strong>不能批准</strong>
          <p>{permission.staleReason}</p>
        </div>
      ) : null}

      <div className="change-set-review__paths" aria-label="改动文件">
        {permission.changedPaths.map((path) => <code key={path}>{path}</code>)}
      </div>

      <div className="change-set-review__diffs">
        {files.length > 0 ? files.map((file) => (
          <article className="change-set-file" key={file.path}>
            <h3>{file.path}</h3>
            <pre tabIndex={0} aria-label={`${file.path} 的改动`}>{file.content}</pre>
          </article>
        )) : (
          <p className="empty-note">
            {isAcceptance
              ? '最终 Diff、权威测试或受管工作树尚未通过精确校验。'
              : '精确预览尚未通过 ID、Run、digest 与 TTL 校验。'}
          </p>
        )}
      </div>

      <div className="change-set-review__actions" aria-label="改动审批操作">
        <p>
          {permission.canApprove
            ? isAcceptance
              ? '接收后只推进当前 Workflow；不会 commit、push、发布、合并或写入原始 checkout。'
              : '批准后仅把这些改动写入受管工作树。'
            : '审批已失效；过期或失效的请求不能再作任何决定。'}
        </p>
        <div>
          <button
            className="primary-button"
            type="button"
            disabled={approvalDisabled}
            aria-describedby={permission.staleReason ? 'change-set-review-title' : undefined}
            onClick={() => onDecision('approved')}
          >
            <CheckCircle2 size={16} />
            {isAcceptance ? '接收最终修改' : '批准这些改动'}
          </button>
          <button
            className="ghost-button"
            type="button"
            disabled={rejectionDisabled}
            onClick={() => onDecision('rejected')}
          >
            {isAcceptance ? '拒绝并保留工作树' : '拒绝改动'}
          </button>
        </div>
      </div>
      {!isAcceptance && <SessionPermissionChoice request={permission.request} disabled={approvalDisabled}
        onAllow={() => onDecision('approved', 'session')} />}
    </section>
  )
}
