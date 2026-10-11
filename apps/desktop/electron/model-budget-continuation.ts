import { modelBudgetPurposeLabels, type ModelBudgetContinuation } from '@ai-devflow/shared'

import type { WorkbenchConversation } from './workbench-conversation-contract'

export type PendingBudgetContinuation = ModelBudgetContinuation & { localProjectId: string; localContext?: { operationTitle: string; records: Array<{ sourceId: string; title: string; result: string; state: string }> } }

/** Local display only: never upload chat text as billing evidence; reasoning is never a result. */
export function describeBudgetContinuation(card: ModelBudgetContinuation, conversations: WorkbenchConversation[]): NonNullable<PendingBudgetContinuation['localContext']> {
  const active = conversations.filter(conversation => conversation.status === 'running' && conversation.messages.at(-1)?.provider?.model === card.model)
  const records = card.records.map(ref => {
    for (const conversation of conversations) {
      const index = conversation.messages.findIndex(message => message.usage?.budgetAttemptIds?.includes(ref.sourceId))
      if (index < 0) continue
      const call = conversation.messages[index]!
      const following = conversation.messages.slice(index + 1)
      const boundary = following.findIndex(message => message.role === 'notice' || message.role === 'user')
      const answer = following.slice(0, boundary < 0 ? undefined : boundary).find(message => message.role === 'assistant')
      return { sourceId: ref.sourceId, title: conversation.title, state: call.attempt?.status === 'failed' ? '调用未完成' : call.attempt?.status === 'completed' ? '调用已返回' : '执行状态待核实', result: answer ? answer.text.slice(0, 240) + (answer.text.length > 240 ? '…（完整答复保留在原会话）' : '') : '未收到完整答复；已保存的查询仍保留。' }
    }
    return { sourceId: ref.sourceId, title: '历史模型调用', state: '执行状态待核实', result: '此设备没有可展示的完整答复，请查看原操作记录。' }
  })
  return { operationTitle: active.length === 1 ? active[0]!.title : modelBudgetPurposeLabels[card.operation.purpose] ?? '本次模型操作', records }
}
/** In-memory consent belongs to this running operation. A restart never recreates a waiting call. */
export function createBudgetContinuationPrompts(changed: (cards: PendingBudgetContinuation[]) => void) {
  const pending = new Map<string, { card: PendingBudgetContinuation; scope: string; confirm: () => Promise<unknown>; resolve: (id: string) => void; reject: (error: Error) => void; dispose: () => void; confirming: boolean }>()
  const accepted = new Map<string, string>()
  const list = () => [...pending.values()].map(row => row.card)
  const publish = () => changed(list())
  return {
    list,
    accepted: (scope: string, operationId: string) => accepted.get(`${scope}:${operationId}`),
    wait(card: PendingBudgetContinuation, scope: string, confirm: () => Promise<unknown>, signal?: AbortSignal): Promise<string> {
      signal?.throwIfAborted()
      if (pending.has(card.id)) throw new Error('当前操作已经在等待预算确认。')
      return new Promise((resolve, reject) => {
        const stop = (message: string) => { const row = pending.get(card.id); if (!row) return; row.dispose(); pending.delete(card.id); publish(); reject(new Error(message)) }
        const cancel = () => stop('已取消本次模型操作，尚未发送新请求。')
        const timer = setTimeout(() => stop('继续授权已过期，请手动继续本次操作。'), Math.max(0, Date.parse(card.expiresAt) - Date.now()))
        timer.unref?.()
        const dispose = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel) }
        pending.set(card.id, { card, scope, confirm, resolve, reject, dispose, confirming: false })
        signal?.addEventListener('abort', cancel, { once: true }); publish()
      })
    },
    async respond(input: { id: string; expectedVersion: string; confirmed: boolean }, scope: string) {
      const row = pending.get(input.id)
      if (!row || row.scope !== scope || row.card.version !== input.expectedVersion) throw new Error('操作或团队身份已变化，请重新发起操作。')
      if (row.confirming) return
      if (!input.confirmed) { row.dispose(); pending.delete(input.id); publish(); row.reject(new Error('已取消本次模型操作。')); return }
      row.confirming = true
      try {
        await row.confirm()
        // Cancellation during confirmation must not send the pending request.
        if (pending.get(input.id) !== row) return
        accepted.set(`${scope}:${row.card.operation.id}`, row.card.id)
        row.dispose(); pending.delete(input.id); publish(); row.resolve(row.card.id)
      } finally { row.confirming = false }
    },
  }
}
