import { Gauge } from 'lucide-react'
import type { WorkbenchConversation } from '../../electron/workbench-conversation-contract'
import { DetailPopover } from './DetailPopover'

export function summarizeConversationUsage(session: WorkbenchConversation) {
  const usages = session.messages.flatMap((message) => message.usage && [message.usage.totalTokens, message.usage.inputTokens, message.usage.outputTokens].some((value) => value != null) ? [message.usage] : [])
  const unreported = session.messages.filter((message) => message.role === 'notice' && message.provider && (!message.usage || [message.usage.totalTokens, message.usage.inputTokens, message.usage.outputTokens].every((value) => value == null)) && message.reasoning?.status !== 'streaming').length
  const incomplete = usages.some((usage) => usage.totalTokens == null && (usage.inputTokens == null || usage.outputTokens == null))
  const total = usages.reduce((sum, usage) => sum + (usage.totalTokens ?? ((usage.inputTokens ?? 0) + (usage.outputTokens ?? 0))), 0)
  const sum = (field: 'inputTokens' | 'outputTokens') => usages.some((usage) => usage[field] != null)
    ? usages.reduce((value, usage) => value + (usage[field] ?? 0), 0) : undefined
  return { total, input: sum('inputTokens'), output: sum('outputTokens'), partial: unreported > 0 || incomplete,
    status: usages.length ? (unreported > 0 || incomplete ? '部分调用未返回完整用量' : '已返回累计用量') : unreported ? '模型未返回用量' : '暂无用量记录',
    reported: usages.length,
    inputComplete: usages.every((usage) => usage.inputTokens != null) && !unreported,
    outputComplete: usages.every((usage) => usage.outputTokens != null) && !unreported }
}

export function ConversationUsage({ session }: { session: WorkbenchConversation }) {
  const usage = summarizeConversationUsage(session)
  const short = usage.total >= 1_000_000 ? `${(usage.total / 1_000_000).toFixed(1)}m` : usage.total >= 1000 ? `${(usage.total / 1000).toFixed(1)}k` : String(usage.total)
  return <DetailPopover className="conversation-usage-button" title={`当前会话用量 · ${usage.status}`} label={<><Gauge size={16} /><span className="usage-label">用量 {usage.reported ? short : '—'}</span>{usage.partial && <small>{usage.reported ? '部分' : '未返回'}</small>}</>}>
    <p>当前会话累计的 Provider 用量；不代表上下文窗口占用或整个 Run 的用量。</p>
    <dl className="detail-values"><dt>累计 Token</dt><dd>{usage.reported ? usage.total.toLocaleString() : '未提供'}</dd>
      <dt>输入 Token</dt><dd>{usage.input?.toLocaleString() ?? '未提供'}{usage.input != null && !usage.inputComplete ? '（部分）' : ''}</dd>
      <dt>输出 Token</dt><dd>{usage.output?.toLocaleString() ?? '未提供'}{usage.output != null && !usage.outputComplete ? '（部分）' : ''}</dd></dl>
    <p>{usage.status}。{usage.partial ? '数字仅包含实际返回的数据，缺失部分未估算。' : ''}</p>
  </DetailPopover>
}
