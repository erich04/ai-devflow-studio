'use client'

import type { GitHubRepositoryBinding } from '@ai-devflow/shared'
import { useState } from 'react'
import {
  parseGitHubDeliveryRequestView,
  type GitHubDeliveryRequestView,
} from './lib/devflow-api'

type GitHubDeliveryPanelProps = {
  projectId: string
  projectName: string
  initialBinding: GitHubRepositoryBinding | null
  initialDeliveries: GitHubDeliveryRequestView[]
}

function isExactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join('\u0000') === [...keys].sort().join('\u0000')
  )
}

function shortFingerprint(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`
}

function statusLabel(status: GitHubDeliveryRequestView['status']): string {
  return status.replaceAll('_', ' ')
}

function hasExactActiveBinding(
  binding: GitHubRepositoryBinding | null,
  delivery: GitHubDeliveryRequestView,
): boolean {
  return binding?.status === 'active' && binding.version === delivery.repositoryBindingVersion
}

export function GitHubDeliveryPanel({
  projectId,
  projectName,
  initialBinding,
  initialDeliveries,
}: GitHubDeliveryPanelProps) {
  const [binding, setBinding] = useState(initialBinding)
  const [deliveries, setDeliveries] = useState(() =>
    initialDeliveries.filter((item) => item.projectId === projectId),
  )
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({})
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null)
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
    if (!validBindingInput || !bindingConfirmed || bindingBusy) return
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
        const code =
          typeof payload === 'object' && payload !== null && !Array.isArray(payload)
            ? (payload as { code?: unknown }).code
            : undefined
        throw new Error(code === 'provider_unavailable' ? 'provider' : response.status === 403 ? 'authority' : 'unavailable')
      }
      if (
        typeof payload !== 'object' ||
        payload === null ||
        Array.isArray(payload) ||
        Object.keys(payload).sort().join(',') !== 'binding,outcomeCode' ||
        (payload as { outcomeCode?: unknown }).outcomeCode !== expectedOutcome ||
        typeof (payload as { binding?: unknown }).binding !== 'object' ||
        (payload as { binding?: unknown }).binding === null
      ) {
        throw new Error('unavailable')
      }
      const nextBinding = (payload as { binding: GitHubRepositoryBinding }).binding
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
      setConfirmed({})
      setMessage('GitHub repository binding verified and active.')
    } catch (error) {
      setMessage(
        error instanceof Error && error.message === 'provider'
          ? 'GitHub provider is unavailable. No repository authority was changed.'
          : error instanceof Error && error.message === 'authority'
            ? 'Owner authority is required to configure this repository binding.'
            : 'GitHub repository binding could not be changed safely.',
      )
    } finally {
      setBindingBusy(false)
    }
  }

  async function revokeBinding() {
    if (!binding || binding.status === 'revoked' || !revocationConfirmed || bindingBusy) return
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
        const code =
          typeof payload === 'object' && payload !== null && !Array.isArray(payload)
            ? (payload as { code?: unknown }).code
            : undefined
        throw new Error(code === 'provider_unavailable' ? 'provider' : response.status === 403 ? 'authority' : 'unavailable')
      }
      if (
        typeof payload !== 'object' ||
        payload === null ||
        Array.isArray(payload) ||
        Object.keys(payload).sort().join(',') !== 'binding,outcomeCode' ||
        (payload as { outcomeCode?: unknown }).outcomeCode !== 'binding_revoked' ||
        typeof (payload as { binding?: unknown }).binding !== 'object' ||
        (payload as { binding?: unknown }).binding === null
      ) {
        throw new Error('unavailable')
      }
      const nextBinding = (payload as { binding: GitHubRepositoryBinding }).binding
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
      setConfirmed({})
      setMessage('Repository binding revoked. Pending delivery authority is no longer valid.')
    } catch (error) {
      setMessage(
        error instanceof Error && error.message === 'provider'
          ? 'GitHub provider is unavailable. No repository authority was changed.'
          : error instanceof Error && error.message === 'authority'
            ? 'Owner authority is required to revoke this repository binding.'
            : 'GitHub repository binding could not be revoked safely.',
      )
    } finally {
      setBindingBusy(false)
    }
  }

  async function decide(
    delivery: GitHubDeliveryRequestView,
    action: 'approve' | 'reject',
  ) {
    if (
      !confirmed[delivery.id] ||
      pendingRequestId ||
      bindingBusy ||
      !hasExactActiveBinding(binding, delivery)
    ) return
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
      const expectedOutcome = action === 'approve'
        ? 'delivery_approved'
        : 'delivery_rejected'
      if (!isExactObject(payload, ['outcomeCode', 'request'])) {
        throw new Error(response.status === 403 ? 'authority' : 'unavailable')
      }
      const nextRequest = parseGitHubDeliveryRequestView(payload.request, projectId)
      if (
        response.status !== 200 ||
        payload.outcomeCode !== expectedOutcome ||
        nextRequest.id !== delivery.id ||
        nextRequest.projectId !== projectId ||
        typeof nextRequest.stateVersion !== 'number' ||
        nextRequest.stateVersion <= delivery.stateVersion ||
        nextRequest.status !== (action === 'approve' ? 'approved' : 'revoked') ||
        (action === 'reject' && nextRequest.outcomeCode !== 'approval_rejected')
      ) {
        throw new Error(response.status === 403 ? 'authority' : 'unavailable')
      }
      setDeliveries((current) => current.map((item) =>
        item.id === delivery.id
          ? nextRequest
          : item,
      ))
      setConfirmed((current) => ({ ...current, [delivery.id]: false }))
      setMessage(
        action === 'approve'
          ? 'Delivery approved. Desktop may now publish the exact branch.'
          : 'Delivery rejected. No branch publication was authorized.',
      )
    } catch (error) {
      setMessage(
        error instanceof Error && error.message === 'authority'
          ? 'Lead or owner authority is required for this decision.'
          : 'GitHub Delivery service is unavailable. No decision was applied.',
      )
    } finally {
      setPendingRequestId(null)
    }
  }

  return (
    <section
      className="github-delivery-panel"
      id="github-delivery"
      aria-label="GitHub Delivery"
    >
      <header className="studio-section-heading compact">
        <div>
          <span>Controlled publication</span>
          <h2>GitHub Delivery</h2>
          <p className="github-project-context">{projectName} · {projectId}</p>
          <p>分支发布和 Draft PR 创建必须绑定精确版本，并由人明确批准。</p>
        </div>
      </header>

      <article className="github-binding-card">
        <div>
          <strong>{binding?.repository ?? 'No repository binding'}</strong>
          <span>{binding?.status ?? 'not configured'}</span>
        </div>
        {binding ? (
          <small>
            {binding.defaultBranch} · binding v{binding.version}
          </small>
        ) : (
          <small>Owner configuration is required before Desktop can request delivery.</small>
        )}
      </article>

      <form
        className="github-binding-form"
        aria-label="Owner repository binding controls"
        onSubmit={(event) => {
          event.preventDefault()
          void configureBinding()
        }}
      >
        <label>
          <span>GitHub App installation ID</span>
          <input
            aria-label="GitHub App installation ID"
            inputMode="numeric"
            maxLength={20}
            value={installationId}
            onChange={(event) => setInstallationId(event.target.value)}
          />
        </label>
        <label>
          <span>GitHub repository ID</span>
          <input
            aria-label="GitHub repository ID"
            inputMode="numeric"
            maxLength={20}
            value={repositoryId}
            onChange={(event) => setRepositoryId(event.target.value)}
          />
        </label>
        <label className="github-confirmation">
          <input
            type="checkbox"
            aria-label="Confirm repository binding"
            checked={bindingConfirmed}
            onChange={(event) => setBindingConfirmed(event.target.checked)}
          />
          <span>I confirm these GitHub App and repository identifiers for this Project.</span>
        </label>
        <button
          type="submit"
          disabled={!validBindingInput || !bindingConfirmed || bindingBusy}
        >
          {bindingBusy
            ? 'Validating binding...'
            : binding
              ? 'Update repository binding'
              : 'Configure repository binding'}
        </button>
      </form>

      {binding && binding.status !== 'revoked' ? (
        <div className="github-binding-revocation" role="group" aria-label="Owner revocation controls">
          <label className="github-confirmation">
            <input
              type="checkbox"
              aria-label="Confirm repository binding revocation"
              checked={revocationConfirmed}
              disabled={bindingBusy}
              onChange={(event) => setRevocationConfirmed(event.target.checked)}
            />
            <span>I confirm revocation of this exact repository binding version.</span>
          </label>
          <button
            type="button"
            disabled={!revocationConfirmed || bindingBusy}
            onClick={() => void revokeBinding()}
          >
            Revoke repository binding
          </button>
        </div>
      ) : null}

      <div className="github-delivery-list">
        {deliveries.length > 0 ? deliveries.map((delivery) => (
          <article key={delivery.id} className="github-delivery-card">
            <header>
              <div>
                <strong>{delivery.repository}</strong>
                <small>
                  Run {shortFingerprint(delivery.runId)} · request v{delivery.stateVersion}
                </small>
              </div>
              <span>{statusLabel(delivery.status)}</span>
            </header>
            <dl>
              <div>
                <dt>PR title</dt>
                <dd>{delivery.prTitle}</dd>
              </div>
              <div>
                <dt>Delivery request ID</dt>
                <dd><code>{delivery.id}</code></dd>
              </div>
              <div>
                <dt>Run</dt>
                <dd>Run version {delivery.runVersion}</dd>
              </div>
              <div>
                <dt>Run ID</dt>
                <dd><code>{delivery.runId}</code></dd>
              </div>
              <div>
                <dt>Workflow node</dt>
                <dd><code>{delivery.nodeId}</code></dd>
              </div>
              <div>
                <dt>Intent revision</dt>
                <dd>Intent revision {delivery.intentRevision}</dd>
              </div>
              <div>
                <dt>Repository binding</dt>
                <dd>Binding version {delivery.repositoryBindingVersion}</dd>
              </div>
              <div>
                <dt>Repository binding ID</dt>
                <dd><code>{delivery.repositoryBindingId}</code></dd>
              </div>
              <div>
                <dt>GitHub repository</dt>
                <dd>Repository ID {delivery.repositoryId}</dd>
              </div>
              <div>
                <dt>Base branch</dt>
                <dd>{delivery.baseBranch}</dd>
              </div>
              <div>
                <dt>Publication branch</dt>
                <dd>{delivery.headBranch}</dd>
              </div>
              <div>
                <dt>Base commit</dt>
                <dd><code>{delivery.baseCommitSha}</code></dd>
              </div>
              <div>
                <dt>Expected commit</dt>
                <dd><code>{delivery.expectedCommitSha}</code></dd>
              </div>
              <div>
                <dt>Intent digest</dt>
                <dd><code>{delivery.intentDigest}</code></dd>
              </div>
              <div>
                <dt>Diff source digest</dt>
                <dd><code>{delivery.diffDigest}</code></dd>
              </div>
              <div>
                <dt>PR package digest</dt>
                <dd><code>{delivery.packageDigest}</code></dd>
              </div>
              <div>
                <dt>Evidence version</dt>
                <dd><code>{delivery.testEvidenceId}</code></dd>
              </div>
              <div>
                <dt>Evidence digest</dt>
                <dd><code>{delivery.testEvidenceDigest}</code></dd>
              </div>
              <div>
                <dt>Changed paths</dt>
                <dd>
                  <ul className="github-delivery-changed-paths">
                    {delivery.changedPaths.map((path) => (
                      <li key={path}><code>{path}</code></li>
                    ))}
                  </ul>
                </dd>
              </div>
              <div>
                <dt>Approval expires</dt>
                <dd><time dateTime={delivery.expiresAt}>{delivery.expiresAt}</time></dd>
              </div>
            </dl>
            {delivery.status === 'approval_required' ? (
              <div className="github-delivery-decision">
                <label>
                  <input
                    type="checkbox"
                    aria-label={`Confirm delivery ${delivery.id}`}
                    checked={confirmed[delivery.id] ?? false}
                    disabled={
                      pendingRequestId === delivery.id ||
                      bindingBusy ||
                      !hasExactActiveBinding(binding, delivery)
                    }
                    onChange={(event) => setConfirmed((current) => ({
                      ...current,
                      [delivery.id]: event.target.checked,
                    }))}
                  />
                  <span>I reviewed this exact commit, intent, digests, changed paths, and evidence version.</span>
                </label>
                <div>
                  <button
                    type="button"
                    disabled={
                      !confirmed[delivery.id] ||
                      pendingRequestId !== null ||
                      bindingBusy ||
                      !hasExactActiveBinding(binding, delivery)
                    }
                    onClick={() => void decide(delivery, 'approve')}
                  >
                    Approve delivery
                  </button>
                  <button
                    type="button"
                    disabled={
                      !confirmed[delivery.id] ||
                      pendingRequestId !== null ||
                      bindingBusy ||
                      !hasExactActiveBinding(binding, delivery)
                    }
                    onClick={() => void decide(delivery, 'reject')}
                  >
                    Reject delivery
                  </button>
                </div>
                {!hasExactActiveBinding(binding, delivery) && binding?.status === 'active' ? (
                  <p className="github-delivery-authority-note">
                    Request binding v{delivery.repositoryBindingVersion} does not match active binding v{binding.version}. Reload or create a revised request.
                  </p>
                ) : !hasExactActiveBinding(binding, delivery) ? (
                  <p className="github-delivery-authority-note">
                    An active verified repository binding is required before a decision can be applied.
                  </p>
                ) : null}
              </div>
            ) : null}
          </article>
        )) : (
          <p>当前项目还没有 GitHub Delivery 请求。</p>
        )}
      </div>
      {message ? <p role="status">{message}</p> : null}
    </section>
  )
}
