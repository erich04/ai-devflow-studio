import { useEffect, useState } from 'react'
import { codingSessionPermissionRule, describeCodingSessionRule, type CodingPermissionRequest, type CodingSessionGrant } from '@ai-devflow/shared'
import { getDesktopApi } from '../desktop-api'

export function SessionPermissionChoice({ request, disabled, onAllow }: {
  request: CodingPermissionRequest; disabled: boolean; onAllow: () => void
}) {
  const rule = codingSessionPermissionRule(request)
  if (!rule) return null
  return <details className="session-permission-choice">
    <summary>在本次编码会话中复用授权</summary>
    <p>{describeCodingSessionRule(rule)}</p>
    <p>仅限当前编码运行和受管工作区，最长两小时。运行结束、工作区或配置变化、撤销或退出应用后失效。最终修改接收仍需单独确认。</p>
    <button type="button" className="secondary-button" disabled={disabled} onClick={onAllow}>允许本次并在此范围内复用</button>
  </details>
}

export function CodingSessionPermissions(props: { codingRunId: string; status: string }) {
  return <ScopedCodingSessionPermissions key={props.codingRunId} {...props} />
}

function ScopedCodingSessionPermissions({ codingRunId, status }: { codingRunId: string; status: string }) {
  const [grants, setGrants] = useState<CodingSessionGrant[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    const api = getDesktopApi()
    const refresh = () => { void api?.codingSessionPermissions?.({ codingRunId }).then((next) => {
      if (live) { setGrants(next); setError('') }
    }).catch(() => { if (live) setError('暂时无法读取会话授权') }) }
    refresh()
    const off = api?.onCodingEventAppended?.((event) => { if (event.codingRunId === codingRunId) refresh() })
    const timer = setInterval(refresh, 30_000)
    return () => { live = false; off?.(); clearInterval(timer) }
  }, [codingRunId, status])
  if (!grants.length && !error) return null
  return <section className="task-work-panel" aria-label="当前会话授权">
    <strong>当前会话授权</strong>
    {error && <p role="alert">{error}</p>}
    {grants.map((grant) => <div key={grant.id}>
      <p>{describeCodingSessionRule(grant.rule)} · 到期 {new Date(grant.expiresAt).toLocaleTimeString()}</p>
      <button type="button" disabled={busy} onClick={() => {
        setBusy(true)
        void getDesktopApi()?.codingSessionPermissions({ codingRunId, revokeId: grant.id })
          .then(setGrants).catch(() => setError('撤销失败，请重试')).finally(() => setBusy(false))
      }}>撤销授权</button>
    </div>)}
  </section>
}
