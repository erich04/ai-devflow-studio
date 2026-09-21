import { useEffect, useState } from 'react'
import type { CredentialAccessRecord } from '../../electron/credential-access'
import type { DevFlowDesktopApi } from '../desktop-api'

const stateLabels = { waiting: '等待系统授权', succeeded: '已完成', failed: '授权未完成或凭据不可用', cancelled: '已取消', timed_out: '等待超时' }

type CredentialAccessApi = Pick<DevFlowDesktopApi, 'listCredentialAccess' | 'cancelCredentialAccess' | 'onCredentialAccessUpdated'>

export function CredentialAccessStatus({ api, detailed }: { api: CredentialAccessApi | null | undefined; detailed: boolean }) {
  const [records, setRecords] = useState<CredentialAccessRecord[]>([])
  const [dismissed, setDismissed] = useState<string | null>(null)
  useEffect(() => {
    if (!api?.listCredentialAccess) return
    let disposed = false
    let updated = false
    const stop = api.onCredentialAccessUpdated?.((items) => { updated = true; if (!disposed) setRecords(items) })
    void api.listCredentialAccess().then((items) => { if (!disposed && !updated) setRecords(items) }).catch(() => {})
    return () => { disposed = true; stop?.() }
  }, [api])
  const pending = records.filter((item) => item.state === 'waiting')
  const latest = records[0]
  const failed = latest && latest.state !== 'waiting' && latest.state !== 'succeeded' && latest.id !== dismissed ? latest : undefined
  const current = pending[0] ?? failed
  const cancel = (id: string) => { void api?.cancelCredentialAccess?.(id).catch(() => {}) }
  return <>
    {!detailed && current ? <aside className="credential-access-notice" role="status" aria-label="系统凭据状态">
      <strong>{current.state === 'waiting' ? '正在等待系统凭据访问' : stateLabels[current.state]}</strong>
      <p>{current.state === 'waiting'
        ? '如果出现 macOS 钥匙串授权窗口，请在那里选择允许或拒绝。其他页面仍可使用。'
        : '已保存的配置会保留。处理系统授权窗口后，可重新点击刚才的保存、同步或发送按钮。'}</p>
      <small>诊断编号：{current.id}</small>
      {current.state === 'waiting' ? <>
        <button type="button" onClick={() => pending.forEach((item) => cancel(item.id))}>取消本次等待</button>
        <small>取消后不会继续原操作；系统窗口如仍打开，请自行关闭。</small>
      </> : <button type="button" onClick={() => setDismissed(current.id)}>知道了</button>}
    </aside> : null}
    {detailed ? <section className="credential-access-history" aria-label="凭据访问记录">
      <h3>凭据访问记录</h3>
      <p>仅记录操作类别、状态、耗时和诊断编号；不含密钥、Token 或加密内容。</p>
      {records.length ? <ul>{records.map((item) => <li key={item.id}>
        <strong>{item.category === 'provider' ? '模型 Provider' : '团队登录'} · {item.operation === 'encrypt' ? '保存凭据' : '读取凭据'}</strong>
        <span>{stateLabels[item.state]} · {item.durationMs} ms · {item.startedAt}</span>
        <code>{item.id}</code>
      </li>)}</ul> : <p>本次启动还没有凭据访问记录。</p>}
    </section> : null}
  </>
}
