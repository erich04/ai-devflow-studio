import { useEffect, useState } from 'react'
import { formatUsd, modelBudgetPurposeLabels, modelCostStatusLabels, type ModelCostRecord } from '@ai-devflow/shared'
import type { PendingBudgetContinuation } from '../../electron/model-budget-continuation'
import type { DevFlowDesktopApi } from '../desktop-api'

export function BudgetContinuationCard({ api, projectId }: { api: DevFlowDesktopApi | null | undefined; projectId?: string | undefined }) {
  const [cards, setCards] = useState<PendingBudgetContinuation[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    let updated = false
    const unsubscribe = api?.onModelBudgetContinuationUpdated?.(next => { if (alive) { updated = true; setCards(next); setError('') } })
    void api?.modelBudgetContinuation?.({ action: 'list' }).then(next => { if (alive && !updated) setCards(next) }).catch(() => {})
    return () => { alive = false; unsubscribe?.() }
  }, [api])
  const card = cards.find(item => !projectId || item.localProjectId === projectId)
  if (!card) return null
  async function respond(confirmed: boolean) {
    if (!card || !api?.modelBudgetContinuation) return
    setBusy(true); setError('')
    try { setCards(await api.modelBudgetContinuation({ action: 'respond', id: card.id, expectedVersion: card.version, confirmed })) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '确认未完成，请重试。') }
    finally { setBusy(false) }
  }
  return <section className="budget-continuation" aria-label="预算继续确认" aria-live="polite">
    <h2>{modelBudgetPurposeLabels[card.operation.purpose] ?? '继续本次模型操作'}</h2>
    <p>{card.localContext?.operationTitle ?? '当前项目 · 本次操作'} · 待确认请求尚未发送 · {new Date(card.createdAt).toISOString()}（UTC）</p>
    {card.localContext?.records[0] && <p>上次返回：{card.localContext.records[0].result}</p>}
    {card.costs && <p>已记录费用 {formatUsd(card.costs.actualUsd)} · 执行中占用 {formatUsd(card.costs.executingUsd)} · 待核对占用 {formatUsd(card.costs.pendingBoundedUsd)} · 费用未知 {card.costs.unknownCount} 笔。</p>}
    <p>{card.records.length ? `有 ${card.records.length} 笔历史费用待确认。` : '当前操作需要额外预算授权。'}原费用记录和未知 Token 会保留；本次确认只允许下面的新调用。</p>
    <p><strong>{card.model}</strong> · 下一次请求费用上界 {formatUsd(card.nextCallBoundUsd)} · 本次操作最多 {card.maxCalls} 次请求，累计费用上界 {formatUsd(card.maxCostUsd)}。</p>
    <p>本月已计入预算 {formatUsd(card.currentSpendUsd)} / 上限 {formatUsd(card.limitUsd)}。若全部用满，最多超出 {formatUsd(card.possibleExcessUsd)}；历史未知费用另行核对。</p>
    <p>有效至 {new Date(card.expiresAt).toISOString() + '（UTC）'}；仅限当前操作、当前身份和预算规则。模型仍可能失败，确认不代表完成流程审批。</p>
    {card.records.length > 0 && <details><summary>查看待确认的历史调用</summary><ul>{card.records.map(row => {
      const local = card.localContext?.records.find(item => item.sourceId === row.sourceId)
      return <li key={`${row.sourceKind}:${row.sourceId}`}><strong>{local?.title ?? '历史模型调用'}</strong> · {row.model} · {new Date(row.createdAt).toISOString()}（UTC）
        <p>{local?.state ?? '执行状态待核实'} · {modelCostStatusLabels[row.status as ModelCostRecord['status']] ?? '费用待核对'} · {row.estimatedCostUsd === null ? '暂无法估算' : `占用 ${formatUsd(row.estimatedCostUsd)}`}</p>
        <p>{local?.result ?? '此设备没有可展示的完整答复。'}</p><code>{row.sourceId}</code></li>
    })}</ul></details>}
    <label><input key={card.id} type="checkbox" checked={false} disabled={busy} onChange={() => void respond(true)} />我已了解以上费用范围，授权当前操作继续调用模型</label>
    <button type="button" disabled={busy} onClick={() => void respond(false)}>取消本次操作</button>
    {busy && <p role="status">正在确认…</p>}{error && <p role="alert">{error}</p>}
  </section>
}
