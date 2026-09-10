import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { resolveAgentProviderDisplayName, type AgentProviderConfig, type ProviderRemovalCheck } from '@ai-devflow/shared'
import type { DevFlowDesktopApi } from '../desktop-api'

export function ProviderRemovalDialog({ provider, api, onCancel, onDeleted }: {
  provider: AgentProviderConfig
  api: Pick<DevFlowDesktopApi, 'inspectAgentProviderRemoval' | 'removeAgentProviderCredential'>
  onCancel: () => void
  onDeleted: (providerId: string) => void
}) {
  const [check, setCheck] = useState<ProviderRemovalCheck | null>(null)
  const [error, setError] = useState('')
  const [removing, setRemoving] = useState(false)
  const inFlight = useRef(false)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  useEffect(() => { if (removing) dialogRef.current?.focus() }, [removing])

  useEffect(() => {
    let disposed = false
    const previousFocus = document.activeElement
    cancelRef.current?.focus()
    void api.inspectAgentProviderRemoval({ providerId: provider.id }).then((result) => {
      if (!disposed) setCheck(result)
    }).catch(() => {
      if (!disposed) setError('无法检查 Provider 引用，请关闭后重试。')
    })
    return () => {
      disposed = true
      if (previousFocus instanceof HTMLButtonElement && previousFocus.isConnected && !previousFocus.disabled) {
        previousFocus.focus()
      } else {
        const fallback = document.querySelector<HTMLElement>('[aria-label="Saved Agent Provider"]') ??
          document.querySelector<HTMLElement>('[aria-label="Agent Provider Name"]')
        fallback?.focus()
      }
    }
  }, [api, provider.id])

  async function remove() {
    if (inFlight.current || !check?.credential || check.references.length > 0) return
    inFlight.current = true
    setRemoving(true)
    setError('')
    try {
      const result = await api.removeAgentProviderCredential({
        providerId: provider.id, expectedUpdatedAt: check.credential.updatedAt,
      })
      if (result.status === 'deleted') {
        onDeleted(result.providerId)
        return
      }
      setCheck(result.check)
      setError(result.status === 'changed' ? 'Provider 已更新，请核对最新配置后再确认。' :
        result.status === 'not_found' ? '该 Provider 已不存在，请关闭后刷新。' : 'Provider 仍被引用，请先处理下列引用。')
    } catch {
      setError('删除未完成，请重试；若结果不确定，可关闭后重新检查。')
    } finally {
      inFlight.current = false
      setRemoving(false)
    }
  }

  return createPortal(
    <div className="modal-backdrop" role="presentation">
      <section ref={dialogRef} tabIndex={-1} className="modal provider-removal-modal" role="dialog" aria-modal="true" aria-labelledby="provider-removal-title"
        aria-describedby="provider-removal-impact" onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            if (!removing) onCancel()
          } else if (event.key === 'Tab') {
            if (removing) { event.preventDefault(); return }
            const first = cancelRef.current
            const last = confirmRef.current?.disabled ? first : confirmRef.current
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
          }
        }}>
        <h2 id="provider-removal-title">管理已保存 Provider</h2>
        <dl>
          <div><dt>Provider</dt><dd>{check?.credential ? resolveAgentProviderDisplayName(check.credential) : provider.name}</dd></div>
          <div><dt>ID</dt><dd><code>{provider.id}</code></dd></div>
          <div><dt>Model</dt><dd>{check?.credential?.model ?? provider.model}</dd></div>
          <div><dt>本机凭据</dt><dd>{check?.credential?.maskedCredential ?? provider.maskedCredential ?? '无本机凭据'}</dd></div>
        </dl>
        <p id="provider-removal-impact">删除会移除 DevFlow 本机保存的配置和加密凭据，保留历史审查、用量和执行证据。第三方平台上的 API Key 不受影响。</p>
        {!check && !error ? <p role="status">正在检查引用…</p> : null}
        {check ? (
          <>
            <p>保留历史记录：{check.historicalRecordCount} 条。</p>
            {check.references.length > 0 ? <ul className="provider-removal-references">{check.references.map((reference, index) => (
              <li key={`${reference.kind}:${reference.id}:${index}`}>{reference.label ? <p>{reference.label}</p> : null}<code>{reference.id}</code><p>{reference.remediation}</p></li>
            ))}</ul> : check.credential ? <p>未发现项目配置或活动执行引用。删除后将保持“未选择 Provider”。</p> : <p>该 Provider 没有可删除的本机凭据。</p>}
          </>
        ) : null}
        {error ? <p className="bad" role="alert">{error}</p> : null}
        <div className="modal-actions">
          <button ref={cancelRef} className="ghost-button" disabled={removing} onClick={onCancel}>取消</button>
          <button ref={confirmRef} className="danger-button" disabled={removing || !check?.credential || check.references.length > 0} onClick={() => void remove()}>
            {removing ? '删除中…' : '确认删除 Provider'}
          </button>
        </div>
      </section>
    </div>, document.body,
  )
}
