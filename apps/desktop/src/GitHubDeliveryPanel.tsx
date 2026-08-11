import type { GitHubDeliveryIntent } from '@ai-devflow/shared'

const statusCopy: Record<GitHubDeliveryIntent['status'], string> = {
  approval_required:
    '准备已完成。等待 Web Team Console 的 lead/owner 显式批准；Desktop 不会代替审批。',
  approved:
    'Web 审批已记录，受限后台处理器会继续发布精确 commit。',
  publishing_branch:
    '正在发布精确 commit；该阶段由后台处理器自动推进。',
  branch_published:
    '精确 commit 已发布，后台处理器将继续创建 Draft PR。',
  creating_pr:
    '正在创建 Draft PR；请等待本地状态刷新。',
  completed:
    'Draft PR 已创建并记录为交付证据；Workflow 会自动推进到 Acceptance。',
  failed:
    '交付已安全停止且不会自动重试。请核对远端记录与本地证据，确认实际结果后再继续。',
  recovery_required:
    '自动恢复已停止。只有显式 Resume 才会按当前 intent updatedAt 继续。',
  revoked:
    'GitHub 授权已撤销，Desktop 不会继续远端写入；请由 owner 在 Web 重新绑定。',
}

const statusTone: Record<GitHubDeliveryIntent['status'], string> = {
  approval_required: 'warn',
  approved: 'accent',
  publishing_branch: 'accent',
  branch_published: 'accent',
  creating_pr: 'accent',
  completed: 'good',
  failed: 'bad',
  recovery_required: 'warn',
  revoked: 'bad',
}

export function GitHubDeliveryPanel({
  intent,
  hasExactPrPackage,
  surface = 'pr',
}: {
  intent: GitHubDeliveryIntent | undefined
  hasExactPrPackage: boolean
  surface?: 'pr' | 'acceptance'
}) {
  const isAcceptanceEvidenceMissing = surface === 'acceptance' && !intent

  return (
    <section className="github-delivery-panel" data-testid="github-delivery-panel">
      <div className="compact-row">
        <strong>GitHub Delivery</strong>
        <span className={`pill ${intent ? statusTone[intent.status] : 'soft'}`}>
          {intent?.status ?? (
            isAcceptanceEvidenceMissing
              ? 'evidence_unavailable'
              : hasExactPrPackage
                ? 'ready_to_prepare'
                : 'package_required'
          )}
        </span>
      </div>

      {!intent ? (
        <p className="meta">
          {isAcceptanceEvidenceMissing
            ? '无法唯一确认与当前 Run 记录的 Draft URL 对应的 completed GitHub Delivery；Acceptance 保持 fail-closed。'
            : hasExactPrPackage
            ? '精确且已脱敏的 PR Delivery Package 已附加。点击顶部 Prepare 后才会固定 commit 与测试证据。'
            : '先生成绑定到 reviewed coding source 的精确且已脱敏 PR Delivery Package。'}
        </p>
      ) : (
        <>
          <p className="meta github-delivery-status-copy">{statusCopy[intent.status]}</p>
          <dl className="github-delivery-evidence">
            <div>
              <dt>Repository</dt>
              <dd><code>{intent.repository}</code></dd>
            </div>
            <div>
              <dt>Base branch</dt>
              <dd><code>{intent.baseBranch}</code></dd>
            </div>
            <div>
              <dt>Head branch</dt>
              <dd><code>{intent.headBranch}</code></dd>
            </div>
            <div>
              <dt>Expected commit SHA</dt>
              <dd><code>{intent.expectedCommitSha}</code></dd>
            </div>
            <div>
              <dt>Run version</dt>
              <dd><code>runVersion {intent.runVersion}</code></dd>
            </div>
            <div>
              <dt>Diff source digest</dt>
              <dd><code>{intent.diffSourceDigest}</code></dd>
            </div>
            <div>
              <dt>Test evidence digest</dt>
              <dd><code>{intent.testEvidenceDigest}</code></dd>
            </div>
            <div>
              <dt>PR package digest</dt>
              <dd><code>{intent.prPackageDigest}</code></dd>
            </div>
            <div>
              <dt>Intent digest</dt>
              <dd><code>{intent.intentDigest}</code></dd>
            </div>
            <div>
              <dt>Intent updatedAt</dt>
              <dd><time dateTime={intent.updatedAt}>{intent.updatedAt}</time></dd>
            </div>
          </dl>
          {intent.status === 'completed' && intent.completion ? (
            <a
              className="inline-link-button"
              href={intent.completion.pullRequestUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open Draft PR #{intent.completion.pullRequestNumber}
            </a>
          ) : null}
        </>
      )}
    </section>
  )
}
