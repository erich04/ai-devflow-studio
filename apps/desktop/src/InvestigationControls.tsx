import { useEffect, useRef, useState } from 'react'
import type { ConversationCommand, ConversationResponse, WorkbenchConversation } from '../electron/workbench-conversation-contract'
import type { InvestigationStopReason } from '../electron/investigation-policy'

type Command = (input: ConversationCommand) => Promise<ConversationResponse | undefined>
type Diagnostics = NonNullable<ConversationResponse['diagnostics']>
const stopLabels: Record<InvestigationStopReason, string> = {
  step_limit: '本批步数已用完', time_limit: '本批调查时间已用完', tool_limit: '查询次数已到边界',
  no_progress: '重复查询没有获得新证据', request_limit: '累计模型请求已到上限',
  recovery_limit: '累计自动恢复已到上限', summary_limit: '本批总结额度已用完',
}
const phaseLabels: Record<string, string> = {
  http: '模型服务拒绝请求', sse_json: '接收过程中的格式错误', response_json: '服务响应格式错误',
  stream_shape: '接收数据结构错误', stream_incomplete: '接收未完整结束', utf8: '响应字符编码错误',
  body_read: '响应读取中断', model_json: '回答格式错误', model_shape: '回答结构不符',
  model_content: '回答正文缺失或无效', model_finish: '回答提前结束', schema: '回答字段不符', semantic: '回答未通过内容核验',
}

export function InvestigationProgress({ session }: { session: WorkbenchConversation }) {
  const progress = session.investigationProgress
  if (!progress) return null
  const harness = session.executor === 'opencode'
  const hardBoundary = progress.stopReason === 'request_limit' || progress.stopReason === 'recovery_limit'
    || (progress.stopReason === 'tool_limit' && progress.totals.toolCalls >= progress.policy.maxTotalToolCalls)
  return <section className="conversation-tool" aria-label="调查进展">
    <p>{harness ? `本批执行 ${progress.batch.toolCalls} 次查询；OpenCode 每次调查最多 ${progress.policy.maxSteps} 步。` : `本批已完成 ${progress.batch.steps} / ${progress.policy.maxSteps} 步，执行 ${progress.batch.toolCalls} 次查询。`}</p>
    {harness ? <p>本问题累计启动 {progress.totals.requests} 次调查，上限 {progress.policy.maxRequests} 次。OpenCode 内部模型请求不计入此数字，用量由执行器记录。继续调查不会重置累计次数。</p>
      : <p>本问题累计 {progress.totals.requests} / {progress.policy.maxRequests} 次模型请求、{progress.totals.recoveries} / {progress.policy.maxRecoveries} 次自动恢复。继续调查不会重置累计次数。</p>}
    {progress.batch.noProgress > 0 && <p>连续 {progress.batch.noProgress} 次查询没有获得新证据。</p>}
    {progress.stopReason && <p>{harness && progress.stopReason === 'request_limit' ? '累计调查启动次数已到上限' : stopLabels[progress.stopReason] ?? '调查已暂停'}。{hardBoundary
      ? '已到累计安全边界，请缩小范围后发送一个新问题。'
      : '可继续调查；将先核实已保存的来源，再从保存的位置继续。'}</p>}
  </section>
}

export function InvestigationControls({ session, command, busy }: { session: WorkbenchConversation; command: Command; busy: boolean }) {
  const [steps, setSteps] = useState(String(session.investigationPolicy?.maxSteps ?? 12))
  const [seconds, setSeconds] = useState(String((session.investigationPolicy?.maxDurationMs ?? 180000) / 1000))
  const [pending, setPending] = useState<'settings' | 'diagnostics' | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [diagnostics, setDiagnostics] = useState<Diagnostics>()
  const lock = useRef(false)
  const currentScope = useRef('')
  const scopeKey = `${session.localProjectId}/${session.id}`
  currentScope.current = scopeKey
  useEffect(() => {
    setSteps(String(session.investigationPolicy?.maxSteps ?? 12))
    setSeconds(String((session.investigationPolicy?.maxDurationMs ?? 180000) / 1000))
  }, [scopeKey, session.investigationPolicy?.maxSteps, session.investigationPolicy?.maxDurationMs])
  useEffect(() => { setDiagnostics(undefined); setError(''); setNotice('') }, [scopeKey])
  const scope = { projectId: session.localProjectId, conversationId: session.id }
  const unavailable = busy || session.status === 'running' || pending !== null

  async function save() {
    if (unavailable || lock.current) return
    const maxSteps = Number(steps), durationSeconds = Number(seconds)
    setError(''); setNotice('')
    if (!Number.isSafeInteger(maxSteps) || maxSteps < 1 || maxSteps > 60 || !Number.isSafeInteger(durationSeconds) || durationSeconds < 30 || durationSeconds > 600) {
      setError('步数须为 1–60 的整数，时间须为 30–600 秒的整数。'); return
    }
    lock.current = true; setPending('settings')
    try {
      const result = await command({ type: 'configure_investigation', ...scope, maxSteps, maxDurationMs: durationSeconds * 1000 })
      if (currentScope.current !== scopeKey) return
      if (!result || result.error) setError('范围未保存，请重试。')
      else setNotice('已保存，下次开始或继续调查时生效。')
    } catch { if (currentScope.current === scopeKey) setError('范围未保存，请重试。') }
    finally { lock.current = false; setPending(null) }
  }
  async function loadDiagnostics() {
    if (pending || lock.current) return
    lock.current = true; setPending('diagnostics'); setDiagnostics(undefined); setError(''); setNotice('')
    try {
      const result = await command({ type: 'export_diagnostics', ...scope })
      if (currentScope.current !== scopeKey) return
      if (!result?.diagnostics || result.error) setError('无法取得诊断，请重试。')
      else setDiagnostics(result.diagnostics)
    } catch { if (currentScope.current === scopeKey) setError('无法取得诊断，请重试。') }
    finally { lock.current = false; setPending(null) }
  }
  function download() {
    if (!diagnostics || diagnostics.conversationId !== session.id) return
    setError('')
    try {
      const url = URL.createObjectURL(new Blob([JSON.stringify(diagnostics, null, 2)], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url; link.download = `devflow-diagnostics-${session.id.replace(/[^a-zA-Z0-9_-]/gu, '').slice(0, 80)}.json`
      document.body.append(link); link.click(); link.remove()
      const revoke = URL.revokeObjectURL.bind(URL)
      setTimeout(() => revoke(url), 0)
    } catch { setError('无法下载诊断文件，可以尝试复制诊断。') }
  }
  async function copy() {
    if (!diagnostics || diagnostics.conversationId !== session.id) return
    setError(''); setNotice('')
    try { await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2)); setNotice('诊断已复制。') }
    catch { setError('暂时无法复制，请下载诊断文件。') }
  }
  return <details className="conversation-tool" style={{ margin: '8px 16px' }}>
    <summary>调查范围与诊断</summary>
    <form aria-label="调查范围设置" noValidate onSubmit={event => { event.preventDefault(); void save() }}>
      <dl className="conversation-detail-facts">
        <dt><label htmlFor={`investigation-steps-${session.id}`}>每批最多步骤</label></dt>
        <dd><input id={`investigation-steps-${session.id}`} type="number" min={1} max={60} step={1} value={steps} disabled={unavailable} onChange={event => { setSteps(event.target.value); setNotice('') }} /></dd>
        <dt><label htmlFor={`investigation-seconds-${session.id}`}>每批最多秒数</label></dt>
        <dd><input id={`investigation-seconds-${session.id}`} type="number" min={30} max={600} step={1} value={seconds} disabled={unavailable} onChange={event => { setSeconds(event.target.value); setNotice('') }} /></dd>
      </dl>
      <p>设置只作用于下一批调查；累计请求与费用限制仍然有效。</p>
      {(busy || session.status === 'running') && <p>请先停止当前调查，再修改范围。</p>}
      <button type="submit" className="ghost-button" disabled={unavailable}>{pending === 'settings' ? '正在保存…' : '保存下一批范围'}</button>
    </form>
    <p>诊断文件仅含调用状态、用量与格式信息，不含聊天正文、代码、模型推理或密钥。</p>
    <button type="button" className="ghost-button" disabled={pending !== null} onClick={() => void loadDiagnostics()}>{pending === 'diagnostics' ? '正在读取…' : '查看诊断'}</button>
    {diagnostics && diagnostics.conversationId === session.id && <section aria-label="诊断预览">
      <p>生成时间：{new Date(diagnostics.generatedAt).toLocaleString()}。</p>
      <p>包含 {diagnostics.calls.length} 次调用记录{diagnostics.omittedCalls ? `，另有 ${diagnostics.omittedCalls} 次较早记录未包含` : ''}。读取诊断不会调用模型。</p>
      <p>{diagnostics.replay.reason}</p>
      <div className="inspector-actions"><button type="button" className="ghost-button" onClick={download}>下载诊断文件</button><button type="button" className="text-button" onClick={() => void copy()}>复制诊断</button></div>
      <details><summary>查看调用记录</summary>
        {!diagnostics.calls.length && <p>目前没有可导出的模型调用记录。</p>}
        {diagnostics.calls.map((call, index) => <div key={`${call.id}-${index}`}>
          <p>调用 {index + 1} · {call.provider?.model ?? '模型未记录'} · {call.attempt?.status === 'completed' ? '已完成' : call.attempt?.status === 'failed' ? '失败' : call.attempt?.status === 'running' ? '进行中' : '状态未记录'}</p>
          {call.failure && <p>{phaseLabels[call.failure.parserCategory ?? ''] ?? '调用未完成'}{call.failure.httpStatus ? `（服务状态 ${call.failure.httpStatus}）` : ''}。{call.failure.parserLine !== undefined ? `位置：第 ${call.failure.parserLine} 行、第 ${call.failure.parserColumn ?? '未知'} 列。` : ''}</p>}
          <p>用量：输入 {call.usage?.inputTokens ?? '未知'}、输出 {call.usage?.outputTokens ?? '未知'} tokens。{call.attempt?.durationMs != null ? `耗时 ${(call.attempt.durationMs / 1000).toFixed(1)} 秒。` : ''}</p>
        </div>)}
      </details>
    </section>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
  </details>
}
