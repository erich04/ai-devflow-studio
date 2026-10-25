import { useEffect, useRef, useState } from 'react'
import { AGENT_MEMORY_CANDIDATE_TEXT_MAX_BYTES } from '@ai-devflow/shared'
import type { DevFlowDesktopApi } from '../desktop-api'

export function RememberConversationMemory({ projectId, conversationId, messageId, text, remember }: {
  projectId: string; conversationId: string; messageId: string; text: string
  remember: DevFlowDesktopApi['rememberConversationMemory']
}) {
  const [editing, setEditing] = useState(false)
  const [statement, setStatement] = useState(text)
  const [pin, setPin] = useState(false)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')
  const generation = useRef(0)
  useEffect(() => {
    generation.current += 1
    setEditing(false); setStatement(text); setPin(false); setBusy(false); setFeedback(''); setError('')
    return () => { generation.current += 1 }
  }, [projectId, conversationId, messageId, text])
  if (!remember) return null
  const bytes = new TextEncoder().encode(statement).byteLength
  const invalid = !statement.trim() || statement.trim() !== statement || bytes > AGENT_MEMORY_CANDIDATE_TEXT_MAX_BYTES
  async function save() {
    if (!remember || invalid) return
    const version = generation.current
    setBusy(true); setError(''); setFeedback('')
    try {
      const result = await remember({ projectId, conversationId, messageId, statement, pin })
      if (version !== generation.current) return
      if (result.projectId !== projectId) throw new Error('Stale memory project')
      setEditing(false)
      setFeedback('已提交记忆请求。可在 Agent Memory 查看保存结果；业务规则和冲突仍需确认。')
    } catch { if (version === generation.current) setError('未能保存记忆，请检查项目设置或刷新后重试。') }
    finally { if (version === generation.current) setBusy(false) }
  }
  return <div className="conversation-remember">
    {!editing ? <button type="button" className="text-button" onClick={() => { setStatement(text); setEditing(true); setFeedback('') }}>记住这条</button> : <div className="form-stack" role="group" aria-label="手动记住这条消息">
      <label>要记住的经验<textarea aria-label="要记住的经验" value={statement} disabled={busy} onChange={(event) => setStatement(event.target.value)} /></label>
      <p className="meta">这是自动积累的补充。来源绑定当前公开消息；修改内容不会变成已验证的工具事实，也不会批准业务规则。</p>
      <label><input type="checkbox" checked={pin} disabled={busy} onChange={(event) => setPin(event.target.checked)} />固定保留，直到取消固定或删除</label>
      {bytes > AGENT_MEMORY_CANDIDATE_TEXT_MAX_BYTES && <p role="status">内容超过 {AGENT_MEMORY_CANDIDATE_TEXT_MAX_BYTES} 字节，请缩短后保存。</p>}
      <div className="button-row"><button type="button" disabled={busy || invalid} onClick={() => void save()}>{busy ? '正在保存…' : '保存这条经验'}</button><button type="button" className="text-button" disabled={busy} onClick={() => setEditing(false)}>取消</button></div>
    </div>}
    {feedback && <p role="status">{feedback}</p>}
    {error && <p role="alert">{error}</p>}
  </div>
}
