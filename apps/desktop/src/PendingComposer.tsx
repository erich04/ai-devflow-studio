import { ArrowUp, X } from 'lucide-react'
import { referenceChipLabel, type DiscussionReference } from './app/discussion-reference'
import { formatLocalTime } from './app/desktop-view-model'

export type ConversationExecutor = 'direct-provider' | 'opencode' | 'native-tools'
/**
 * 「讨论」 without an open conversation (design §5.10): the chip waits here and the conversation
 * is created on the first 发送. `queued` holds references that arrive while it is being sent.
 */
export type PendingDraft = {
  references: DiscussionReference[]
  executor: ConversationExecutor
  text: string
  sending: boolean
  queued: DiscussionReference[]
}

/** One-line chips "引用：…"; project, task, step and read time are in the title. */
export function ReferenceChips({ references, disabled = false, onRemove }: {
  references: readonly DiscussionReference[]
  disabled?: boolean
  onRemove: (id: string) => void
}) {
  if (!references.length) return null
  return <div className="conversation-reference-cards" aria-label="引用的材料">
    {references.map((reference) => {
      const line = referenceChipLabel(reference)
      return <div className="conversation-reference-chip" key={reference.id} data-testid="conversation-reference-card"
        title={`${reference.projectName} · ${reference.runTitle} · ${reference.stageLabel} · ${reference.stepTitle} · 读取于 ${formatLocalTime(reference.readAt)}`}>
        <span>引用：{line}</span>
        <button type="button" className="workspace-icon" aria-label={`移除引用：${line}`} disabled={disabled} onClick={() => onRemove(reference.id)}><X size={13} /></button>
      </div>
    })}
    <p className="meta">引用会在发送时附在消息前；添加引用不会发送消息，也不会调用模型。</p>
  </div>
}

export function PendingComposer({ draft, providerId, providerName, nativeReadOnlyPilotEnabled, modelReadinessError, error, onChange, onSend, onConfigure }: {
  draft: PendingDraft
  providerId: string
  providerName: string
  nativeReadOnlyPilotEnabled: boolean
  modelReadinessError?: string | undefined
  error: string
  onChange: (next: Partial<Pick<PendingDraft, 'executor' | 'text' | 'references'>>) => void
  onSend: () => void
  onConfigure: () => void
}) {
  const { sending } = draft
  const canSend = Boolean(draft.text.trim()) && Boolean(providerId) && !sending && !modelReadinessError
  return <form className="conversation-composer pending-composer" data-testid="pending-composer" aria-label="新的答疑" aria-busy={sending}
    onSubmit={(event) => { event.preventDefault(); if (canSend) onSend() }}>
    <label className="conversation-executor-field">执行方式<select aria-label="新对话执行方式" value={draft.executor} disabled={sending} onChange={(event) => onChange({ executor: event.target.value as ConversationExecutor })}>
      <option value="direct-provider">Direct Provider</option><option value="opencode">OpenCode</option>{nativeReadOnlyPilotEnabled && <option value="native-tools">Direct Provider · 原生只读工具试点</option>}
    </select></label>
    <p className="meta">模型：{providerName || '尚未选择'}<button type="button" className="text-button" disabled={sending} onClick={onConfigure}>（在设置中更换）</button></p>
    <p className="meta">发送后才会创建对话并调用模型。</p>
    {modelReadinessError && <p className="conversation-error" role="status">{modelReadinessError}</p>}
    <ReferenceChips references={draft.references} disabled={sending} onRemove={(id) => onChange({ references: draft.references.filter((item) => item.id !== id) })} />
    {error && <p className="conversation-error" role="alert">{error}</p>}
    <textarea aria-label="待发送的对话内容" value={draft.text} maxLength={12000} disabled={sending} placeholder="针对引用的材料提问…"
      onChange={(event) => onChange({ text: event.target.value })}
      onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (canSend) onSend() } }} />
    <div className="conversation-composer-footer">
      <span role="status">{sending ? '正在发送…' : providerName || '未配置模型'}</span>
      <button className="primary-button" type="submit" aria-label="发送消息" disabled={!canSend}><ArrowUp size={18} /></button>
    </div>
  </form>
}
