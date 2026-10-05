'use client'

import { useRef, useState, type FormEvent } from 'react'
import { formatUsd, modelCostStatusLabels, type ModelCostRecoveryOverview, type ModelCostReconciliationInput } from '@ai-devflow/shared'

export type ModelCostRecoveryResult = { ok: true; overview: ModelCostRecoveryOverview } | { ok: false; error: string }

export function ModelCostRecoveryPanel({ initialOverview, userId, canManage, readAction, retryAction, reconcileAction }: {
  initialOverview: ModelCostRecoveryOverview; userId: string | undefined; canManage: boolean
  readAction: (projectId: string) => Promise<ModelCostRecoveryResult>
  retryAction: (projectId: string) => Promise<ModelCostRecoveryResult>
  reconcileAction: (input: ModelCostReconciliationInput) => Promise<ModelCostRecoveryResult>
}) {
  const [overview, setOverview] = useState(initialOverview)
  const [selected, setSelected] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const inFlight = useRef(false)
  const lastRequest = useRef<{ fingerprint: string; key: string } | null>(null)
  const record = overview.records.find(row => `${row.sourceKind}:${row.sourceId}` === selected)
  async function perform(action: () => Promise<ModelCostRecoveryResult>, success: string) {
    if (inFlight.current) return
    inFlight.current = true; setPending(true); setMessage('')
    try {
      const result = await action()
      if (result.ok) { setOverview(result.overview); setSelected(null); setMessage(success) }
      else setMessage(result.error)
    } catch { setMessage('费用记录操作未完成，已保留原记录；请重试或刷新。') }
    finally { inFlight.current = false; setPending(false) }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!record || !canManage) return
    const form = new FormData(event.currentTarget)
    const amount = String(form.get('costUsd') ?? '').trim()
    const inputTokens = String(form.get('inputTokens') ?? '').trim(), outputTokens = String(form.get('outputTokens') ?? '').trim()
    const cacheRead = String(form.get('cacheReadTokens') ?? '').trim()
    const executionStatus = String(form.get('executionStatus')) as ModelCostReconciliationInput['executionStatus']
    const values = { projectId: overview.projectId, sourceKind: record.sourceKind, sourceId: record.sourceId, expectedVersion: record.version,
      ...(amount ? { costUsd: Number(amount) } : {}),
      ...(inputTokens || outputTokens ? { usage: { inputTokens: Number(inputTokens || NaN), outputTokens: Number(outputTokens || NaN),
        ...(cacheRead ? { cacheReadTokens: Number(cacheRead), cacheMissTokens: Number(inputTokens) - Number(cacheRead), cacheStatus: 'complete' as const } : {}) } } : {}),
      reason: String(form.get('reason')), evidence: String(form.get('evidence')),
      evidenceKind: executionStatus === 'not_sent' ? 'not_sent' as const : String(form.get('evidenceKind')) as ModelCostReconciliationInput['evidenceKind'], executionStatus }
    const fingerprint = JSON.stringify(values)
    if (lastRequest.current?.fingerprint !== fingerprint) lastRequest.current = { fingerprint, key: crypto.randomUUID() }
    await perform(() => reconcileAction({ ...values, idempotencyKey: lastRequest.current!.key }), '已更新费用记录并重新计算预算；不会自动重跑任务。其他未知费用或预算超限仍会阻断。')
  }
  return <section aria-label="费用核对与恢复" className="runtime-budget-group runtime-budget-full-row">
    <h3>费用记录与恢复</h3>
    <p>{overview.month}（UTC） · 已确认花费 {formatUsd(overview.actualCostUsd)} · 实际费用待确认 {overview.actualUnknownCount} 笔</p>
    <p>执行中预计占用 {formatUsd(overview.reservedCostUsd)} · 预留金额待确认 {overview.reservedUnknownCount} 笔 · 待处理 {overview.reviewCount} 笔</p>
    <p>重新同步只处理服务端已保存、属于当前身份的最终结果。原桌面仍未上传的用量，需要回原设备同步。这里不会重新调用模型。</p>
    <button disabled={pending} onClick={() => void perform(() => readAction(overview.projectId), '已刷新费用记录。')}>刷新费用记录</button>
    <button disabled={pending || !userId} onClick={() => void perform(() => retryAction(overview.projectId), '已同步现有最终结果并刷新预算；不会自动重跑任务。')}>重新同步已保存用量</button>
    {message && <p role="status">{message}</p>}
    {overview.records.filter(row => row.status !== 'settled' || row.events.length).map(row => <article key={`${row.sourceKind}:${row.sourceId}`}>
      <h4>{row.model} · {modelCostStatusLabels[row.status]}</h4>
      <p><code>{row.sourceId}</code> · {row.createdAt} · {row.affectsCurrentBudget ? '本月预算' : '历史月份，不计入本月预算'}</p>
      <p>原调用者：{row.originalUserId} · {row.costUsd === null ? '费用待确认' : `${row.isReservation ? '预计占用' : '有效费用'} ${formatUsd(row.costUsd)}`} · {row.usageKnown ? `Token ${(row.usage?.inputTokens ?? 0) + (row.usage?.outputTokens ?? 0)}` : 'Token 仍未知'}</p>
      {row.status === 'upload_pending' && <p>{row.originalUserId === userId ? '可同步服务端保存的最终结果。' : '请原调用者同步；负责人可凭可靠依据核对费用。'}</p>}
      {row.isReservation && <p>预留时间不能证明调用已经结束或未收费，需核实执行状态。</p>}
      {canManage && row.canReconcile && <button disabled={pending} onClick={() => setSelected(`${row.sourceKind}:${row.sourceId}`)}>核对费用</button>}
      {!!row.events.length && <details><summary>核对与冲突记录（{row.events.length}）</summary>{row.events.map(event => <p key={event.id}>
        {event.createdAt} · 操作者 {event.actorId} · {event.kind === 'reconciliation'
          ? `核定 ${formatUsd(event.costUsd)}；${event.reason}；依据：${event.evidence}`
          : `${event.kind === 'settlement_confirmation' ? '迟到结果与核对一致' : '迟到结果已保存'}：${event.settlement.state}；输入 ${event.settlement.usage?.inputTokens ?? '未知'} / 输出 ${event.settlement.usage?.outputTokens ?? '未知'} Token`}
      </p>)}</details>}
    </article>)}
    {!overview.reviewCount && <p>当前没有待处理费用。预算仍按本月实际费用和预留占用检查。</p>}
    {record && canManage && <form aria-label="费用核对" onSubmit={submit} key={record.version}>
      <h4>核对 {record.sourceId}</h4>
      <p>原记录保留。只有金额确定时可只填写金额，Token 保持未知；核定零费用也必须有可靠依据。</p>
      <label>核定金额（USD）<input name="costUsd" type="number" min="0" step="any" /></label>
      <label>核定输入 Token（可选）<input name="inputTokens" type="number" min="0" step="1" /></label>
      <label>核定输出 Token（可选）<input name="outputTokens" type="number" min="0" step="1" /></label>
      <label>缓存命中 Token（可选）<input name="cacheReadTokens" type="number" min="0" step="1" /></label>
      <label>执行状态依据<select name="executionStatus" defaultValue="" required><option value="" disabled>请选择已核实的状态</option><option value="ended">有依据确认调用已结束</option><option value="not_sent">有依据确认请求未发送</option></select></label>
      <label>依据类型<select name="evidenceKind" defaultValue="provider_bill"><option value="provider_bill">提供方账单</option><option value="provider_usage">提供方用量记录</option></select></label>
      <label>核对原因<input name="reason" required maxLength={500} /></label>
      <label>非敏感依据<textarea name="evidence" required maxLength={1000} placeholder="账单或用量引用；不要填写密钥、提示词、响应正文或本地路径" /></label>
      <button type="submit" disabled={pending}>保存费用核对</button><button type="button" disabled={pending} onClick={() => setSelected(null)}>取消</button>
    </form>}
  </section>
}
