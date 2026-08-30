import { CheckCircle2 } from 'lucide-react'
import type { CodingAgentRun, CodingPermissionDecision, ManagedCodingWorkspace } from '@ai-devflow/shared'
import type { CodingPermissionProjection } from '../app/coding-runtime-action-projection'

export type UnifiedDiffFile = { path: string; content: string }

export function splitUnifiedDiffByFile(diff: string): UnifiedDiffFile[] {
  const starts = [...diff.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gmu)]
  if (starts.length === 0) {
    return diff.trim() ? [{ path: 'Change Set', content: diff }] : []
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
  onDecision: (decision: CodingPermissionDecision['decision']) => void
}) {
  const preview = permission.previewVerified ? permission.preview : undefined
  const files = preview ? splitUnifiedDiffByFile(preview.unifiedDiff) : []
  const remainingSeconds = Math.ceil(permission.remainingMs / 1_000)
  const approvalDisabled = !permission.canApprove || isReplying
  const rejectionDisabled =
    permission.request.status !== 'pending' ||
    run.status !== 'waiting_permission' ||
    permission.expired ||
    Boolean(permission.staleReason) ||
    isReplying

  return (
    <section
      className="change-set-review"
      aria-labelledby="change-set-review-title"
      data-testid="coding-change-set-review"
    >
      <header className="change-set-review__header">
        <div>
          <span className="panel-label">Exact Change Set approval</span>
          <h2 id="change-set-review-title">{permission.request.title}</h2>
          <p>只审批下列已验证 diff；批准不适用于其他 Run、节点、digest 或过期请求。</p>
        </div>
        <span className={`pill ${permission.canApprove ? 'warn' : 'bad'}`} aria-live="polite">
          {permission.expired ? '已过期' : `剩余 ${remainingSeconds} 秒`}
        </span>
      </header>

      <dl className="change-set-review__facts">
        <div><dt>Coding Run</dt><dd><code>{run.id}</code></dd></div>
        <div><dt>Workflow node</dt><dd><code>{run.nodeId}</code></dd></div>
        <div><dt>Risk</dt><dd>{permission.request.risk}</dd></div>
        <div><dt>Files</dt><dd>{permission.changedPaths.length}</dd></div>
        <div><dt>Digest</dt><dd><code>{permission.changeSetDigest ?? 'unavailable'}</code></dd></div>
        <div><dt>Deadline</dt><dd>{new Date(permission.request.expiresAt).toLocaleString()}</dd></div>
        <div className="change-set-review__fact-wide"><dt>Managed worktree</dt><dd><code>{workspace?.worktreePath ?? 'unavailable'}</code></dd></div>
      </dl>

      {permission.staleReason ? (
        <div className="change-set-review__blocked" role="alert">
          <strong>不能批准</strong>
          <p>{permission.staleReason}</p>
        </div>
      ) : null}

      <div className="change-set-review__paths" aria-label="Changed files">
        {permission.changedPaths.map((path) => <code key={path}>{path}</code>)}
      </div>

      <div className="change-set-review__diffs">
        {files.length > 0 ? files.map((file) => (
          <article className="change-set-file" key={file.path}>
            <h3>{file.path}</h3>
            <pre tabIndex={0} aria-label={`${file.path} diff`}>{file.content}</pre>
          </article>
        )) : (
          <p className="empty-note">精确预览尚未通过 ID、Run、digest 与 TTL 校验。</p>
        )}
      </div>

      <div className="change-set-review__actions" aria-label="Change Set approval actions">
        <p>{permission.canApprove ? '批准后仅把这个 Change Set 写入 managed worktree。' : '审批已 fail closed；过期或失效请求不能再作任何决定。'}</p>
        <div>
          <button
            className="primary-button"
            type="button"
            disabled={approvalDisabled}
            aria-describedby={permission.staleReason ? 'change-set-review-title' : undefined}
            onClick={() => onDecision('approved')}
          >
            <CheckCircle2 size={16} />
            Approve exact Change Set
          </button>
          <button
            className="ghost-button"
            type="button"
            disabled={rejectionDisabled}
            onClick={() => onDecision('rejected')}
          >
            Reject
          </button>
        </div>
      </div>
    </section>
  )
}
