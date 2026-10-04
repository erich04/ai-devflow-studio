import { useEffect, useRef, useState } from 'react'
import { formatUsd, modelCostStatusLabels, type DesktopModelCostRecovery } from '@ai-devflow/shared'
import type { DevFlowDesktopApi } from '../desktop-api'
import { ipcErrorMessage } from '../app/ipc-error'

const localLabels = { running: '执行占位，不能重传', upload_failed: '最终用量待上传', conflict: '冲突已保存，请在 Web 核对',
  scope_mismatch: '属于其他团队或身份，不能重传', identity_unverified: '旧记录身份待核验' }

export function ModelCostRecovery({ desktopApi, projectId }: { desktopApi: DevFlowDesktopApi | null; projectId: string | undefined }) {
  const [data, setData] = useState<DesktopModelCostRecovery | null>(null)
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)
  const epoch = useRef(0), busy = useRef(false)
  useEffect(() => {
    setData(null); setMessage(''); setPending(false); busy.current = false
    return () => { epoch.current++ }
  }, [projectId, desktopApi])
  async function load(retry: boolean) {
    if (!desktopApi || !projectId || busy.current) return
    const current = epoch.current
    busy.current = true; setPending(true); setMessage('')
    try {
      const result = await (retry ? desktopApi.retryModelCostSettlements({ projectId }) : desktopApi.getModelCostRecovery({ projectId }))
      if (current === epoch.current) { setData(result); setMessage(retry ? '已有最终用量已重新同步。预算已刷新，不会自动重跑任务。' : '') }
    } catch (error) { if (current === epoch.current) setMessage(ipcErrorMessage(error, '费用记录操作失败，已保留本地用量。')) }
    finally { if (current === epoch.current) { busy.current = false; setPending(false) } }
  }
  return <section aria-label="项目费用记录">
    <h3>费用记录与恢复</h3>
    <button disabled={pending || !desktopApi?.getModelCostRecovery || !projectId} onClick={() => void load(false)}>查看项目费用记录</button>
    {data && <>
      <p>团队项目 {data.overview.projectId} · {data.overview.month}（UTC）</p>
      <p>已确认花费 {formatUsd(data.overview.actualCostUsd)} · 实际费用待确认 {data.overview.actualUnknownCount} 笔</p>
      <p>执行中预计占用 {formatUsd(data.overview.reservedCostUsd)} · 预留金额待确认 {data.overview.reservedUnknownCount} 笔</p>
      <button disabled={pending || !data.local.some(row => row.canRetry)} onClick={() => void load(true)}>重新同步用量</button>
      <p>仅上传本设备已保存的最终结果，不调用模型。占位、其他身份和已收到回执的冲突不会自动重传。</p>
      {data.local.map(row => <p key={row.id}><code>{row.id}</code> · {localLabels[row.state]}</p>)}
      {data.overview.records.filter(row => row.status !== 'settled' || row.events.length).map(row => <article key={`${row.sourceKind}:${row.sourceId}`}>
        <strong>{row.model} · {modelCostStatusLabels[row.status]}</strong>
        <p><code>{row.sourceId}</code> · {row.createdAt} · {row.affectsCurrentBudget ? '本月预算' : '历史月份，不计入本月预算'}</p>
        <p>{row.costUsd === null ? '费用待确认' : `${row.isReservation ? '预计占用' : '有效费用'} ${formatUsd(row.costUsd)}`} · {row.usageKnown ? '用量已记录' : 'Token 仍未知'}</p>
      </article>)}
      <p>需要人工核对时，请在 Web 控制端打开此团队项目的「设置 › 预算 › 费用记录与恢复」。负责人须提供执行已结束或未发送的依据；超过十分钟不代表免费。</p>
    </>}
    {message && <p role="status">{message}</p>}
  </section>
}
