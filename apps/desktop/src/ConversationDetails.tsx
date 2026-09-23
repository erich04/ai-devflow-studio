import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BookOpen } from 'lucide-react'
import { describeProviderThinking } from '@ai-devflow/shared'
import type { WorkbenchConversation } from '../electron/workbench-conversation-contract'
import { ConversationDialog, ConversationHelpButton } from './ConversationDialogs'

export type ConversationTabTarget = { projectId: string; conversationId: string; trigger: HTMLElement }
export type ConversationMenuTarget = ConversationTabTarget & { x: number; y: number }

export function ConversationTabMenu({ target, onClose, onDetails }: {
  target: ConversationMenuTarget; onClose: () => void; onDetails: () => void
}) {
  const menu = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: target.x, top: target.y })
  useLayoutEffect(() => {
    const box = menu.current?.getBoundingClientRect()
    setPosition({ left: Math.max(8, Math.min(target.x, window.innerWidth - (box?.width ?? 180) - 8)), top: Math.max(8, Math.min(target.y, window.innerHeight - (box?.height ?? 50) - 8)) })
    menu.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
  }, [target])
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !menu.current?.contains(event.target)) onClose() }
    document.addEventListener('pointerdown', outside)
    window.addEventListener('resize', onClose)
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', onClose) }
  }, [onClose])
  const dismiss = () => { onClose(); if (target.trigger.isConnected) target.trigger.focus({ preventScroll: true }) }
  return createPortal(<div ref={menu} className="conversation-tab-menu" role="menu" aria-label="会话操作" style={position} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) onClose() }} onKeyDown={(event) => {
    if (['Escape', 'Tab'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); dismiss() }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); menu.current?.querySelector('button')?.focus() }
  }}><button type="button" role="menuitem" onClick={onDetails}><BookOpen size={16} />会话详情</button></div>, document.body)
}

export function ConversationDetailsDialog({ session, projectName, providerName, statusLabel, returnFocus, onClose, onRename }: {
  session: WorkbenchConversation; projectName: string; providerName: string; statusLabel: string
  returnFocus: HTMLElement; onClose: () => void; onRename: (title: string) => Promise<unknown>
}) {
  const [title, setTitle] = useState(session.title)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const savingRef = useRef(false)
  const calls = session.messages.filter((message) => message.provider)
  const receipt = session.contextReceipt
  const rename = async () => {
    if (!title.trim() || title.trim() === session.title || savingRef.current) return
    savingRef.current = true; setSaving(true); setError('')
    try {
      if (!await onRename(title.trim())) setError('名称未保存，请重试。')
    } catch { setError('名称未保存，请重试。') }
    finally { savingRef.current = false; setSaving(false) }
  }
  return <ConversationDialog title="会话详情" onClose={onClose} returnFocus={returnFocus} busy={saving}>
    <div className="conversation-dialog-body conversation-details-content">
      <form className="conversation-rename" onSubmit={(event) => { event.preventDefault(); void rename() }}>
        <label>会话名称<input aria-label="会话名称" value={title} maxLength={100} disabled={saving} onChange={(event) => setTitle(event.target.value)} /></label>
        <button type="submit" className="ghost-button" disabled={saving || !title.trim() || title.trim() === session.title}>{saving ? '正在保存…' : '保存名称'}</button>
        {error && <p role="alert">{error}</p>}
      </form>
      <dl className="conversation-detail-facts">
        <dt>所属项目</dt><dd>{projectName}</dd>
        <dt>会话状态</dt><dd>{statusLabel}</dd>
        <dt>执行方式</dt><dd>{session.executor === 'opencode' ? 'OpenCode' : 'Direct Provider'}</dd>
        <dt>下次发送使用的模型</dt><dd>{providerName || '尚未选择'}（Agents 当前配置）</dd>
        <dt>最近记录的模型</dt><dd>{calls.at(-1)?.provider?.model ?? '尚无调用记录'}</dd>
      </dl>
      <div className="conversation-details-help"><strong>了解会话资料和权限</strong><ConversationHelpButton /></div>
      <section aria-label="上下文与历史记录">
        <h3>上下文与历史记录</h3>
        <p>本地保留 {session.messages.length} 条会话记录，包含消息、工具查询和调用通知。完整聊天仍在原会话中。</p>
        {receipt ? <>
          <p>上次上下文记录时间：{receipt.observedAt}。</p>
          <p>纳入 {receipt.includedMessages} 条本会话消息；{receipt.omittedMessages} 条较早消息未纳入，历史仍保留。</p>
          {receipt.limited && <p className="meta">本次上下文达到容量限制，部分查询内容未全部附带。可以缩小问题范围后继续调查。</p>}
          <p className="meta">这里只记录消息数量和容量限制，没有保存逐条模型输入或完整来源明细。</p>
        </> : <p className="meta">尚无上下文使用记录，不代表历史消息已被删除。</p>}
        {session.memory && <details className="conversation-legacy-note"><summary>旧版会话备注（已停用）</summary><p className="meta">已停用，不会发送给模型；如需继续使用其中的要求，请在聊天中说明。</p><pre>{session.memory}</pre></details>}
      </section>
      <details className="conversation-call-records"><summary>模型调用设置记录</summary>
        {calls.length === 0 && <p className="meta">尚无模型调用记录。</p>}
        {calls.map((message) => <div className="conversation-call-record" key={message.id}>
          <p>{message.createdAt} · {message.provider!.executor === 'opencode' ? 'OpenCode' : 'Direct Provider'} · {message.provider!.model}</p>
          <p className="meta">{message.provider!.effectiveThinking ? describeProviderThinking(message.provider!.effectiveThinking!) : '未提供或未记录思考参数'}</p>
          <p className="meta">{message.usage ? `已记录用量：输入 ${message.usage.inputTokens ?? '未返回'} tokens，输出 ${message.usage.outputTokens ?? '未返回'} tokens，总计 ${message.usage.totalTokens ?? '未返回'} tokens。` : '此条记录未包含用量，不估算费用。'}</p>
          {message.failure && <p className="meta">诊断：{message.failure.phase} · {message.failure.code}{message.failure.httpStatus ? ` · HTTP ${message.failure.httpStatus}` : ''}{message.failure.reason ? ` · ${message.failure.reason}` : ''}</p>}
        </div>)}
      </details>
    </div>
    <footer className="conversation-dialog-actions"><button type="button" className="primary-button" disabled={saving} onClick={onClose}>关闭详情</button></footer>
  </ConversationDialog>
}
