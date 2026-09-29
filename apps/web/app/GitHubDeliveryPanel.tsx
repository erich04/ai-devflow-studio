'use client'

import type { GitHubRepositoryBinding } from '@ai-devflow/shared'
import { useEffect, useState } from 'react'
import { CopyValue } from './CopyValue'
import {
  parseGitHubDeliveryRequestView,
  type GitHubDeliveryRequestView,
} from './lib/devflow-api'
import { deliveryStatusLabel, formatWebTime, shortIdentifier } from './web-labels'

/**
 * GitHub delivery on the Web (plan S5, Q5): the approval card in a task and the repository
 * binding in settings are separate. Both reuse the existing proxy route and its exact payloads.
 */

type FailureKind =
  | 'provider'
  | 'authority'
  | 'binding_conflict'
  | 'repository_not_assigned'
  | 'state_conflict'
  | 'expired'
  | 'not_found'
  | 'unavailable'

function isExactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join('\u0000') === [...keys].sort().join('\u0000')
  )
}

function githubDeliveryFailureKind(status: number, payload: unknown): FailureKind {
  const code =
    typeof payload === 'object' && payload !== null && !Array.isArray(payload)
      ? (payload as { code?: unknown }).code
      : undefined

  if (status === 503 && code === 'provider_unavailable') return 'provider'
  if (status === 403 && code === 'authority_required') return 'authority'
  if (status === 403 && code === 'repository_not_assigned') return 'repository_not_assigned'
  if (status === 409 && code === 'binding_conflict') return 'binding_conflict'
  if (status === 409 && code === 'state_conflict') return 'state_conflict'
  if (status === 410 && code === 'expired') return 'expired'
  if (status === 404 && code === 'not_found') return 'not_found'
  return 'unavailable'
}

function hasExactActiveBinding(
  binding: GitHubRepositoryBinding | null,
  delivery: GitHubDeliveryRequestView,
): boolean {
  return binding?.status === 'active' && binding.version === delivery.repositoryBindingVersion
}

function bindingStatusLabel(status: GitHubRepositoryBinding['status']): string {
  if (status === 'active') return '生效中'
  if (status === 'revoked') return '已撤销'
  return '已失效，需要重新验证'
}

const decisionFailureCopy: Record<FailureKind, string> = {
  authority: '需要 Lead 或 Owner 权限才能作出决定，没有应用任何决定。',
  state_conflict: '交付请求已变化，没有应用任何决定。请刷新后重新核对。',
  expired: '交付请求已过期，没有应用任何决定。请在桌面端重新发起交付。',
  not_found: '找不到这个交付请求，可能已被撤销。请刷新页面。',
  provider: 'GitHub 服务暂时不可用，没有应用任何决定。',
  binding_conflict: 'GitHub 交付服务暂时不可用，没有应用任何决定。',
  repository_not_assigned: 'GitHub 交付服务暂时不可用，没有应用任何决定。',
  unavailable: 'GitHub 交付服务暂时不可用，没有应用任何决定。',
}

const VISIBLE_CHANGED_PATHS = 8

function DeliveryCard({
  delivery,
  binding,
  canDecide,
  confirmed,
  pending,
  onConfirm,
  onDecide,
}: {
  delivery: GitHubDeliveryRequestView
  binding: GitHubRepositoryBinding | null
  canDecide: boolean
  confirmed: boolean
  pending: boolean
  onConfirm: (value: boolean) => void
  onDecide: (action: 'approve' | 'reject') => void
}) {
  const exactBinding = hasExactActiveBinding(binding, delivery)
  const visiblePaths = delivery.changedPaths.slice(0, VISIBLE_CHANGED_PATHS)
  const hiddenPaths = delivery.changedPaths.slice(VISIBLE_CHANGED_PATHS)
  return (
    <article className="github-delivery-card" id={`delivery-${delivery.id}`} aria-label={`交付请求 ${delivery.prTitle}`}>
      <header>
        <div>
          <strong>{delivery.prTitle}</strong>
          <small>第 {delivery.deliveryAttempt} 次交付尝试 · 更新于 {formatWebTime(delivery.updatedAt)}</small>
        </div>
        <span>{deliveryStatusLabel(delivery.status)}</span>
      </header>
      <dl className="github-delivery-facts">
        <div>
          <dt>目标仓库</dt>
          <dd>{delivery.repository}</dd>
        </div>
        <div>
          <dt>分支</dt>
          <dd>{delivery.headBranch} → {delivery.baseBranch}</dd>
        </div>
        <div>
          <dt>预期提交</dt>
          <dd><CopyValue value={delivery.expectedCommitSha} short={shortIdentifier(delivery.expectedCommitSha, 12)} label="预期提交" /></dd>
        </div>
        <div>
          <dt>改动文件</dt>
          <dd>
            <span>{delivery.changedPaths.length} 个</span>
            <ul className="github-delivery-changed-paths">
              {visiblePaths.map((path) => <li key={path}><code>{path}</code></li>)}
            </ul>
            {hiddenPaths.length ? (
              <details>
                <summary>其余 {hiddenPaths.length} 个文件</summary>
                <ul className="github-delivery-changed-paths">
                  {hiddenPaths.map((path) => <li key={path}><code>{path}</code></li>)}
                </ul>
              </details>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>验证范围</dt>
          <dd>测试证据 <CopyValue value={delivery.testEvidenceId} short={shortIdentifier(delivery.testEvidenceId, 16)} label="测试证据标识" /></dd>
        </div>
        <div>
          <dt>请求修订</dt>
          <dd>第 {delivery.intentRevision} 版 · 请求版本 v{delivery.stateVersion}</dd>
        </div>
        <div>
          <dt>审批截止</dt>
          <dd><time dateTime={delivery.expiresAt}>{formatWebTime(delivery.expiresAt)}</time></dd>
        </div>
      </dl>
      <details className="github-delivery-technical">
        <summary>技术详情</summary>
        <dl>
          {/* Values that already have a copy button on the first screen are shown in full here only. */}
          {([
            ['交付请求标识', delivery.id, true],
            ['任务标识', delivery.runId, true],
            ['任务版本', String(delivery.runVersion), true],
            ['步骤标识', delivery.nodeId, true],
            ['仓库绑定标识', delivery.repositoryBindingId, true],
            ['仓库绑定版本', String(delivery.repositoryBindingVersion), true],
            ['GitHub 仓库 ID', delivery.repositoryId, true],
            ['基准提交', delivery.baseCommitSha, true],
            ['预期提交', delivery.expectedCommitSha, false],
            ['交付意图摘要', delivery.intentDigest, true],
            ['差异来源摘要', delivery.diffDigest, true],
            ['PR 包摘要', delivery.packageDigest, true],
            ['测试证据标识', delivery.testEvidenceId, false],
            ['测试证据摘要', delivery.testEvidenceDigest, true],
          ] as const).map(([label, value, copyable]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{copyable ? <CopyValue value={value} label={label} /> : <code>{value}</code>}</dd>
            </div>
          ))}
        </dl>
      </details>
      {delivery.status === 'approval_required' ? (
        canDecide ? (
          <div className="github-delivery-decision">
            <label>
              <input
                type="checkbox"
                aria-label={`确认已核对交付 ${delivery.prTitle}`}
                checked={confirmed}
                disabled={pending || !exactBinding}
                onChange={(event) => onConfirm(event.target.checked)}
              />
              <span>我已核对上面的提交、改动文件、验证范围和请求版本。</span>
            </label>
            <div>
              <button type="button" disabled={!confirmed || pending || !exactBinding} onClick={() => onDecide('approve')}>
                批准交付
              </button>
              <button type="button" disabled={!confirmed || pending || !exactBinding} onClick={() => onDecide('reject')}>
                驳回交付
              </button>
            </div>
            {!exactBinding && binding?.status === 'active' ? (
              <p className="github-delivery-authority-note">
                请求使用的仓库绑定 v{delivery.repositoryBindingVersion} 与当前生效的 v{binding.version} 不一致。请刷新页面，或在桌面端重新发起交付。
              </p>
            ) : !exactBinding ? (
              <p className="github-delivery-authority-note">
                需要一个已验证并生效的仓库绑定才能作出决定。仓库绑定在「设置 › GitHub 仓库」中管理。
              </p>
            ) : null}
            <p className="github-delivery-authority-note">需要修改时，在桌面端的 PR 交付步骤创建新的修订；这里的审批不会沿用到新修订。</p>
          </div>
        ) : (
          <p className="github-delivery-waiting" role="note">等待负责人审批（需要 Lead 或 Owner）。</p>
        )
      ) : null}
    </article>
  )
}

export function GitHubDeliveryApprovals({
  projectId,
  runId,
  binding,
  initialDeliveries,
  canDecide,
}: {
  projectId: string
  /** When set, only this task's deliveries are shown. */
  runId?: string
  binding: GitHubRepositoryBinding | null
  initialDeliveries: GitHubDeliveryRequestView[]
  canDecide: boolean
}) {
  const [deliveries, setDeliveries] = useState(() =>
    initialDeliveries.filter((item) => item.projectId === projectId && (!runId || item.runId === runId)),
  )
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({})
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  // A confirmation belongs to the binding it was given under; a changed binding needs a new one.
  useEffect(() => {
    setConfirmed({})
  }, [binding?.id, binding?.version, binding?.status])

  async function decide(delivery: GitHubDeliveryRequestView, action: 'approve' | 'reject') {
    if (!canDecide || !confirmed[delivery.id] || pendingRequestId || !hasExactActiveBinding(binding, delivery)) return
    setPendingRequestId(delivery.id)
    setMessage('')
    try {
      const response = await fetch('/api/github-delivery', {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          action,
          projectId,
          requestId: delivery.id,
          expectedStateVersion: delivery.stateVersion,
        }),
      })
      const payload = await response.json().catch(() => null)
      const expectedOutcome = action === 'approve' ? 'delivery_approved' : 'delivery_rejected'
      if (response.status !== 200) {
        throw new Error(githubDeliveryFailureKind(response.status, payload))
      }
      if (!isExactObject(payload, ['outcomeCode', 'request'])) {
        throw new Error('unavailable')
      }
      const nextRequest = parseGitHubDeliveryRequestView(payload.request, projectId)
      if (
        payload.outcomeCode !== expectedOutcome ||
        nextRequest.id !== delivery.id ||
        nextRequest.projectId !== projectId ||
        typeof nextRequest.stateVersion !== 'number' ||
        nextRequest.stateVersion <= delivery.stateVersion ||
        nextRequest.status !== (action === 'approve' ? 'approved' : 'revoked') ||
        (action === 'reject' && nextRequest.outcomeCode !== 'approval_rejected')
      ) {
        throw new Error('unavailable')
      }
      setDeliveries((current) => current.map((item) => item.id === delivery.id ? nextRequest : item))
      setConfirmed((current) => ({ ...current, [delivery.id]: false }))
      setMessage(
        action === 'approve'
          ? '已批准交付。桌面端现在可以发布这个精确版本的分支。'
          : '已驳回交付，没有授权发布任何分支。',
      )
    } catch (error) {
      const kind = error instanceof Error ? error.message as FailureKind : 'unavailable'
      setMessage(decisionFailureCopy[kind] ?? decisionFailureCopy.unavailable)
    } finally {
      setPendingRequestId(null)
    }
  }

  return (
    <section className="github-delivery-panel" id="github-delivery" aria-label="交付审批">
      <header className="studio-section-heading compact">
        <div>
          <span>交付审批</span>
          <h2>{runId ? '本任务的交付请求' : '交付请求'}</h2>
          <p>分支发布和 Draft PR 创建绑定精确版本，由人明确批准。Web 只显示脱敏信息；原始差异请在有权限的桌面端查看。</p>
        </div>
      </header>
      <div className="github-delivery-list">
        {deliveries.length > 0 ? deliveries.map((delivery) => (
          <DeliveryCard
            key={delivery.id}
            delivery={delivery}
            binding={binding}
            canDecide={canDecide}
            confirmed={confirmed[delivery.id] ?? false}
            pending={pendingRequestId !== null}
            onConfirm={(value) => setConfirmed((current) => ({ ...current, [delivery.id]: value }))}
            onDecide={(action) => void decide(delivery, action)}
          />
        )) : (
          <p>{runId ? '当前任务还没有交付请求。' : '当前项目还没有交付请求。'}</p>
        )}
      </div>
      {message ? <p role="status">{message}</p> : null}
    </section>
  )
}

export function GitHubRepositoryBindingSettings({
  projectId,
  projectName,
  initialBinding,
  canManage,
}: {
  projectId: string
  projectName: string
  initialBinding: GitHubRepositoryBinding | null
  canManage: boolean
}) {
  const [binding, setBinding] = useState(initialBinding)
  const [installationId, setInstallationId] = useState('')
  const [repositoryId, setRepositoryId] = useState('')
  const [bindingConfirmed, setBindingConfirmed] = useState(false)
  const [revocationConfirmed, setRevocationConfirmed] = useState(false)
  const [bindingBusy, setBindingBusy] = useState(false)
  const [message, setMessage] = useState('')

  const validBindingInput =
    /^[1-9][0-9]{0,19}$/u.test(installationId) &&
    /^[1-9][0-9]{0,19}$/u.test(repositoryId)

  async function configureBinding() {
    if (!canManage || !validBindingInput || !bindingConfirmed || bindingBusy) return
    setBindingBusy(true)
    setMessage('')
    try {
      const response = await fetch('/api/github-delivery', {
        method: 'PUT',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          action: 'configure',
          projectId,
          installationId,
          repositoryId,
          expectedStateVersion: binding?.version ?? 0,
        }),
      })
      const payload = await response.json().catch(() => null)
      const expectedOutcome = binding ? 'binding_updated' : 'binding_created'
      const expectedStatus = binding ? 200 : 201
      if (response.status !== expectedStatus) {
        throw new Error(githubDeliveryFailureKind(response.status, payload))
      }
      if (
        !isExactObject(payload, ['binding', 'outcomeCode']) ||
        payload.outcomeCode !== expectedOutcome ||
        typeof payload.binding !== 'object' ||
        payload.binding === null
      ) {
        throw new Error('unavailable')
      }
      const nextBinding = payload.binding as GitHubRepositoryBinding
      if (
        nextBinding.teamProjectId !== projectId ||
        nextBinding.redacted !== true ||
        nextBinding.status !== 'active' ||
        nextBinding.version <= (binding?.version ?? 0)
      ) {
        throw new Error('unavailable')
      }
      setBinding(nextBinding)
      setInstallationId('')
      setRepositoryId('')
      setBindingConfirmed(false)
      setRevocationConfirmed(false)
      setMessage('仓库绑定已验证并生效。')
    } catch (error) {
      const kind = error instanceof Error ? error.message : 'unavailable'
      setMessage(
        kind === 'provider'
          ? 'GitHub 服务暂时不可用，没有更改任何仓库权限。'
          : kind === 'authority'
            ? '需要 Owner 权限才能配置仓库绑定。'
            : kind === 'repository_not_assigned'
              ? '请联系部署管理员，将此 GitHub 仓库分配给当前组织后再配置。'
              : kind === 'binding_conflict'
                ? '此仓库已绑定其他项目，请使用独立仓库。'
                : '仓库绑定无法安全修改，没有更改任何仓库权限。',
      )
    } finally {
      setBindingBusy(false)
    }
  }

  async function revokeBinding() {
    if (!canManage || !binding || binding.status === 'revoked' || !revocationConfirmed || bindingBusy) return
    setBindingBusy(true)
    setMessage('')
    try {
      const response = await fetch('/api/github-delivery', {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          action: 'revoke',
          projectId,
          expectedStateVersion: binding.version,
        }),
      })
      const payload = await response.json().catch(() => null)
      if (response.status !== 200) {
        throw new Error(githubDeliveryFailureKind(response.status, payload))
      }
      if (
        !isExactObject(payload, ['binding', 'outcomeCode']) ||
        payload.outcomeCode !== 'binding_revoked' ||
        typeof payload.binding !== 'object' ||
        payload.binding === null
      ) {
        throw new Error('unavailable')
      }
      const nextBinding = payload.binding as GitHubRepositoryBinding
      if (
        nextBinding.teamProjectId !== projectId ||
        nextBinding.redacted !== true ||
        nextBinding.status !== 'revoked' ||
        nextBinding.version <= binding.version
      ) {
        throw new Error('unavailable')
      }
      setBinding(nextBinding)
      setBindingConfirmed(false)
      setRevocationConfirmed(false)
      setMessage('仓库绑定已撤销，待处理的交付审批随之失效。')
    } catch (error) {
      const kind = error instanceof Error ? error.message : 'unavailable'
      setMessage(
        kind === 'provider'
          ? 'GitHub 服务暂时不可用，没有更改任何仓库权限。'
          : kind === 'authority'
            ? '需要 Owner 权限才能撤销仓库绑定。'
            : '仓库绑定无法安全撤销，没有更改任何仓库权限。',
      )
    } finally {
      setBindingBusy(false)
    }
  }

  return (
    <section className="github-delivery-panel" id="github-repository" aria-label="GitHub 仓库绑定">
      <header className="studio-section-heading compact">
        <div>
          <span>GitHub 仓库</span>
          <h2>仓库绑定 · {projectName}</h2>
          <p>桌面端只能向这里绑定并生效的仓库发起交付。修改或撤销绑定会让待处理的交付审批失效。</p>
        </div>
      </header>

      <article className="github-binding-card">
        <div>
          <strong>{binding?.repository ?? '尚未绑定仓库'}</strong>
          <span>{binding ? bindingStatusLabel(binding.status) : '未配置'}</span>
        </div>
        {binding ? (
          <small>默认分支 {binding.defaultBranch} · 绑定版本 v{binding.version}</small>
        ) : (
          <small>Owner 配置仓库绑定后，桌面端才能发起交付。</small>
        )}
      </article>

      {canManage ? (
        <>
          <form
            className="github-binding-form"
            aria-label="仓库绑定设置"
            onSubmit={(event) => {
              event.preventDefault()
              void configureBinding()
            }}
          >
            <label>
              <span>GitHub App 安装 ID</span>
              <input
                aria-label="GitHub App 安装 ID"
                inputMode="numeric"
                maxLength={20}
                value={installationId}
                onChange={(event) => setInstallationId(event.target.value)}
              />
            </label>
            <label>
              <span>GitHub 仓库 ID</span>
              <input
                aria-label="GitHub 仓库 ID"
                inputMode="numeric"
                maxLength={20}
                value={repositoryId}
                onChange={(event) => setRepositoryId(event.target.value)}
              />
            </label>
            <label className="github-confirmation">
              <input
                type="checkbox"
                aria-label="确认仓库绑定"
                checked={bindingConfirmed}
                onChange={(event) => setBindingConfirmed(event.target.checked)}
              />
              <span>我确认这两个标识属于当前项目的 GitHub App 与仓库。</span>
            </label>
            <button type="submit" disabled={!validBindingInput || !bindingConfirmed || bindingBusy}>
              {bindingBusy ? '正在验证绑定…' : binding ? '更新仓库绑定' : '配置仓库绑定'}
            </button>
          </form>

          {binding && binding.status !== 'revoked' ? (
            <div className="github-binding-revocation" role="group" aria-label="撤销仓库绑定">
              <label className="github-confirmation">
                <input
                  type="checkbox"
                  aria-label="确认撤销仓库绑定"
                  checked={revocationConfirmed}
                  disabled={bindingBusy}
                  onChange={(event) => setRevocationConfirmed(event.target.checked)}
                />
                <span>我确认撤销这个版本的仓库绑定。</span>
              </label>
              <button type="button" disabled={!revocationConfirmed || bindingBusy} onClick={() => void revokeBinding()}>
                撤销仓库绑定
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <p className="github-delivery-authority-note">只有 Owner 可以修改或撤销仓库绑定。</p>
      )}
      {message ? <p role="status">{message}</p> : null}
    </section>
  )
}
