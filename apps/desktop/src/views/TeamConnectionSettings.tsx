import { RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { DesktopPairingCredential, GitHubDeliveryIntent } from '@ai-devflow/shared'
import type { TeamConnectionView } from '../app/team-connection-view-model'

const deliveryStatusLabels: Partial<Record<GitHubDeliveryIntent['status'], string>> = {
  approval_required: '等待审批',
  approved: '已批准',
  publishing_branch: '发布分支中',
  branch_published: '分支已发布',
  creating_pr: '创建 PR 中',
  recovery_required: '需要恢复',
}

/**
 * 设置／团队连接 (plan Y7, §6.5): connection, team data and result uploads as three separate
 * facts, the pairing form, and per-record upload retry. Replacing an existing credential needs
 * an explicit confirmation that lists what will be revoked (plan P1).
 */
export function TeamConnectionSettings({
  view,
  pairing,
  identity,
  localProjectName,
  hasSelectedProject,
  pairingCodeDraft,
  onPairingCodeDraftChange,
  isPairing,
  onPair,
  pairingFeedback,
  revokedIntents,
  isSyncing,
  onUpdateTeamData,
  onRetryUpload,
}: {
  view: TeamConnectionView
  pairing: DesktopPairingCredential | null
  identity: string
  localProjectName: (localProjectId: string | undefined) => string
  hasSelectedProject: boolean
  pairingCodeDraft: string
  onPairingCodeDraftChange: (value: string) => void
  isPairing: boolean
  onPair: () => void
  pairingFeedback: { status: 'success' | 'error'; message: string } | null
  revokedIntents: GitHubDeliveryIntent[]
  isSyncing: boolean
  onUpdateTeamData: () => void
  onRetryUpload: (operationId: string) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const confirmation = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (confirming) confirmation.current?.focus()
  }, [confirming])
  useEffect(() => {
    if (!pairing) setConfirming(false)
  }, [pairing])
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!pairingCodeDraft.trim()) {
      onPair()
      return
    }
    // First pairing needs no confirmation; replacing a credential does (plan §6.5).
    if (pairing && !confirming) {
      setConfirming(true)
      return
    }
    setConfirming(false)
    onPair()
  }
  return (
    <div className="team-connection-settings" data-testid="team-connection-settings">
      <section className="team-connection-section" aria-label="团队连接状态">
        <h3>团队连接</h3>
        <p>{view.connectionLine}</p>
        {identity ? <p className="meta" data-testid="desktop-pairing-identity">当前身份：{identity}</p> : null}
        {pairing && view.connection !== 'local' ? (
          <dl className="team-connection-facts">
            <dt>本地项目</dt><dd>{localProjectName(pairing.localProjectId)}</dd>
            <dt>组织</dt><dd>{pairing.organizationId}</dd>
            <dt>团队项目</dt><dd>{pairing.projectName ?? pairing.projectId}</dd>
            <dt>有效期</dt><dd>{view.expiryLine}</dd>
          </dl>
        ) : null}
        <form className="team-connection-pairing" onSubmit={submit}>
          <label>
            配对码
            <input
              placeholder="粘贴 Web 端生成的配对码"
              value={pairingCodeDraft}
              disabled={!hasSelectedProject}
              onChange={(event) => { onPairingCodeDraftChange(event.target.value); setConfirming(false) }}
            />
          </label>
          <button type="submit" className="ghost-button" disabled={isPairing || !hasSelectedProject}>
            {isPairing ? '连接中' : pairing ? '重新连接' : '连接'}
          </button>
        </form>
        {!hasSelectedProject ? <p className="meta">先选择本地项目，再连接团队。</p> : null}
        {confirming && pairing ? (
          <div className="team-connection-confirm" role="alertdialog" aria-label="确认替换团队连接" tabIndex={-1} ref={confirmation}>
            <strong>重新连接会替换现有连接</strong>
            <dl>
              <dt>会被替换的连接</dt>
              <dd>本地项目 {localProjectName(pairing.localProjectId)} · 组织 {pairing.organizationId} · 团队项目 {pairing.projectName ?? pairing.projectId} · 身份 {pairing.userName ?? pairing.userId}（{pairing.role}）</dd>
              <dt>会被撤销的进行中交付</dt>
              <dd>
                {revokedIntents.length === 0 ? '没有进行中的交付请求。' : (
                  <ul>
                    {revokedIntents.map((intent) => (
                      <li key={intent.id}>{intent.repository} · {intent.headBranch} · {deliveryStatusLabels[intent.status] ?? intent.status} · 本地项目 {localProjectName(intent.localProjectId)}</li>
                    ))}
                  </ul>
                )}
              </dd>
            </dl>
            <p>即使重新连接到同一个团队项目，这些交付也会被撤销，之后需要新建交付尝试并重新取得 Web 审批。</p>
            <div className="row">
              <button type="button" className="danger-button" onClick={() => { setConfirming(false); onPair() }}>确认替换</button>
              <button type="button" className="ghost-button" onClick={() => setConfirming(false)}>取消</button>
            </div>
          </div>
        ) : null}
        {pairingFeedback ? (
          <p className={`team-connection-feedback team-connection-feedback--${pairingFeedback.status}`} role={pairingFeedback.status === 'error' ? 'alert' : 'status'}>
            {pairingFeedback.message}
          </p>
        ) : null}
      </section>

      <section className="team-connection-section" aria-label="团队数据更新">
        <h3>团队数据</h3>
        <p>项目与成员：{view.dataLine}</p>
        <p data-testid="team-policy-line">策略：{view.policyLine}</p>
        {view.connection === 'connected' ? (
          <>
            <button type="button" className="ghost-button" onClick={onUpdateTeamData} disabled={isSyncing}>
              <RefreshCw size={16} aria-hidden="true" />
              {isSyncing ? '更新中' : '更新团队数据'}
            </button>
            <p className="meta">读取有权访问的项目、成员与任务摘要，并刷新本机策略和预算；不拉取或推送代码，也不上传本地结果。最近成功时间取自团队服务的回执，不是页面刷新时间。</p>
          </>
        ) : (
          <p className="meta">{view.connection === 'reconnect' ? '重新连接后才能更新团队数据。' : '连接团队后才能更新团队数据。'}本地成果不受影响。</p>
        )}
      </section>

      <section className="team-connection-section" aria-label="结果上传" data-testid="remote-sync-operations">
        <h3>结果上传</h3>
        <p>{view.uploadLine}</p>
        <p className="meta">收到团队服务的成功回执后才显示“已上传”。连接前以“需要配对”结束的记录会在连接后自动重排；其他已结束的记录需要手动重试，原团队目标无法恢复时不提供重试。</p>
        {view.records.length ? (
          <ul className="team-upload-records">
            {view.records.map((record) => (
              <li key={record.id} className={`team-upload-record team-upload-record--${record.tone}`}>
                <div className="row">
                  <strong>{record.kindLabel}</strong>
                  <span>{record.statusLabel}</span>
                  {record.canRetry ? (
                    <button type="button" className="ghost-button" aria-label={`重试上传：${record.kindLabel}`} onClick={() => onRetryUpload(record.id)}>重试</button>
                  ) : null}
                </div>
                <p>{record.reason}</p>
                {record.code || record.target ? (
                  <details>
                    <summary>技术详情</summary>
                    {record.code ? <code>{record.code}</code> : null}
                    {record.target ? <code>{record.target}</code> : null}
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  )
}
