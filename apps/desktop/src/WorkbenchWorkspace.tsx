import { ConversationBody } from './ConversationBody'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowUp, BookOpen, Brain, ChevronDown, History, MessageCircle, Pin, Plus, RotateCcw, Square, X } from 'lucide-react'
import { describeProviderThinking, type WorkflowRun } from '@ai-devflow/shared'
import type { DevFlowDesktopApi } from './desktop-api'
import type { ConversationAction, ConversationCommand, ConversationMessage, WorkbenchConversation } from '../electron/workbench-conversation-contract'

export type WorkbenchOpenRequest = { serial: number; type: 'details' | 'discussion'; prompt?: string }
const statusCopy: Record<WorkbenchConversation['status'], string> = {
  idle: '可以继续提问', running: '正在调查', awaiting_answer: '等待你的回答', failed: '需要重试', interrupted: '上次调查已中断', cancelled: '已停止',
}

export function WorkbenchWorkspace({ api, projectId, projectName, runs, providerId, providerName, request, onNavigate, onConfigure, children }: {
  api: Pick<DevFlowDesktopApi, 'workbenchConversation' | 'onWorkbenchConversationUpdated'> | null
  projectId: string | undefined
  projectName: string | undefined
  runs: WorkflowRun[]
  providerId: string
  providerName: string
  request: WorkbenchOpenRequest
  onNavigate: (action: ConversationAction) => void
  onConfigure: () => void
  children: ReactNode
}) {
  const [sessions, setSessions] = useState<WorkbenchConversation[]>([])
  const [active, setActive] = useState('details')
  const [showHistory, setShowHistory] = useState(false)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const generation = useRef(0)
  const activeRef = useRef(active)
  activeRef.current = active
  const visibleProject = useRef(projectId)
  visibleProject.current = projectId
  const tabbar = useRef<HTMLDivElement>(null)
  const lastRequest = useRef(request.serial)
  const activate = useCallback((id: string) => {
    setActive(id)
    if (projectId) { try { localStorage.setItem(`devflow-workbench-tab:${projectId}`, id) } catch { /* storage unavailable; durable conversation records are unaffected */ } }
  }, [projectId])
  const call = useCallback(async (command: ConversationCommand) => {
    if (!api?.workbenchConversation) throw new Error('会话需要更新后的 Electron 桌面端。')
    const requestedGeneration = generation.current
    const result = await api.workbenchConversation(command)
    if (requestedGeneration !== generation.current || command.projectId !== visibleProject.current) return undefined
    if (result.error) throw new Error(result.error)
    if (command.type === 'list' && !['details', 'new-pending'].includes(activeRef.current) && !result.conversations.some((item) => item.id === activeRef.current && item.isOpen)) setActive('details')
    setSessions((current) => result.conversations.map((incoming) => {
      const existing = current.find((item) => item.id === incoming.id)
      return existing && existing.version > incoming.version ? existing : incoming
    }))
    return result
  }, [api])
  const runCommand = useCallback(async (command: ConversationCommand) => {
    try { setError(''); return await call(command) }
    catch (failure) { if (command.projectId === visibleProject.current) setError(failure instanceof Error ? failure.message : '会话操作未完成，请重试。'); return undefined }
  }, [call])

  useEffect(() => {
    generation.current++
    setSessions([]); setShowHistory(false); setError('')
    let restored = 'details'
    try { restored = projectId ? localStorage.getItem(`devflow-workbench-tab:${projectId}`) ?? 'details' : 'details' } catch { /* optional UI preference */ }
    setActive(restored)
    if (!projectId || !api?.workbenchConversation) return
    let disposed = false
    const refresh = () => { if (!disposed) void runCommand({ type: 'list', projectId }) }
    refresh()
    const unsubscribe = api.onWorkbenchConversationUpdated?.((changedId) => { if (changedId === projectId) refresh() })
    // Also recover an event missed while this view was hidden or the renderer was suspended.
    const interval = window.setInterval(refresh, 4000)
    return () => { disposed = true; generation.current++; unsubscribe?.(); window.clearInterval(interval) }
  }, [api, projectId, runCommand])

  const create = useCallback(async (prompt = '') => {
    if (!projectId || creating) return
    const currentGeneration = generation.current
    const previousActive = active
    setCreating(true)
    setActive('new-pending')
    const result = await runCommand({ type: 'create', projectId, inputDraft: prompt })
    if (currentGeneration === generation.current) {
      if (result?.conversationId) { activate(result.conversationId); setShowHistory(false) }
      else setActive(previousActive)
    }
    setCreating(false)
  }, [active, activate, creating, projectId, runCommand])

  useEffect(() => {
    if (lastRequest.current === request.serial) return
    lastRequest.current = request.serial
    if (request.type === 'details') { activate('details'); setShowHistory(false) }
    else void create(request.prompt)
  }, [activate, create, request])

  useEffect(() => {
    tabbar.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [active])
  const projectSessions = sessions.filter((session) => session.localProjectId === projectId)
  const visible = projectSessions.filter((session) => session.isOpen).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  const session = projectSessions.find((item) => item.id === active)
  function navigate(action: ConversationAction) {
    const run = runs.find((candidate) => candidate.id === action.runId)
    if (!run?.nodes.some((node) => node.id === action.nodeId)) { setError('目标节点已不存在，或不在当前项目中。请重新查询最新流程。'); return }
    activate('details'); setShowHistory(false); onNavigate(action)
  }

  return <aside className="workbench-workspace" data-testid="workbench-workspace" aria-label="节点详情与对话">
    <div className="workspace-tab-strip">
      <div ref={tabbar} className="workspace-tabs" role="tablist" aria-label="节点详情与独立会话" onKeyDown={(event) => {
        if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return
        const tabs = Array.from(tabbar.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])
        const index = tabs.indexOf(document.activeElement as HTMLButtonElement)
        if (index < 0) return
        event.preventDefault()
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
        tabs[next]?.focus(); tabs[next]?.click()
      }}>
        <button id="details-tab" role="tab" aria-controls="details-panel" aria-selected={active === 'details'} tabIndex={active === 'details' ? 0 : -1} onClick={() => { activate('details'); setShowHistory(false) }}><Pin size={15} />节点详情</button>
        {visible.map((item) => <div className="conversation-tab" key={item.id}>
          <button id={`chat-tab-${item.id}`} role="tab" aria-controls={`chat-panel-${item.id}`} aria-selected={active === item.id} tabIndex={active === item.id ? 0 : -1} onClick={() => { activate(item.id); setShowHistory(false) }} title={item.title}>
            <MessageCircle size={15} /><span>{item.title}</span>{item.status === 'awaiting_answer' && <i aria-label="待回答">•</i>}{item.status === 'running' && <i aria-label="调查中" className="conversation-running-dot" />}
          </button>
          <button className="close-tab" aria-label={`关闭会话 Tab：${item.title}`} onClick={async () => {
            if (!projectId) return
            const result = await runCommand({ type: 'update', projectId, conversationId: item.id, isOpen: false })
            if (result && active === item.id) activate('details')
          }}><X size={13} /></button>
        </div>)}
      </div>
      <button className="workspace-icon" aria-label="新建对话" title="新建独立对话，可以询问整个项目" disabled={!projectId || !api?.workbenchConversation || creating} onClick={() => void create()}><Plus size={19} /></button>
      <button className="workspace-icon" aria-label="会话历史" title="会话历史" aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)}><History size={18} /></button>
    </div>
    {error && <div className="conversation-error" role="alert">{error}<button aria-label="关闭会话提示" onClick={() => setError('')}><X size={14} /></button></div>}
    {showHistory && <section className="conversation-history" aria-label="会话历史记录">
      <div className="row"><strong>会话历史</strong><button className="workspace-icon" onClick={() => setShowHistory(false)} aria-label="关闭会话历史"><X size={16} /></button></div>
      <p className="meta">{projectName ?? '当前项目'} · 关闭 Tab 后仍可从这里继续。</p>
      {projectSessions.length === 0 && <p>还没有对话。点击 ＋ 开始。</p>}
      {projectSessions.map((item) => <button className="history-item" key={item.id} onClick={async () => {
        if (!projectId) return
        const result = await runCommand({ type: 'update', projectId, conversationId: item.id, isOpen: true })
        if (result) { activate(item.id); setShowHistory(false) }
      }}><span>{item.title}</span><small>{statusCopy[item.status]} · {new Date(item.updatedAt).toLocaleString()}</small></button>)}
    </section>}
    <div id="details-panel" role="tabpanel" aria-labelledby="details-tab" hidden={active !== 'details' || showHistory} className="workspace-details">
      {children}
      {api?.workbenchConversation && <div className="details-conversation-entry"><button className="ghost-button" onClick={() => void create('当前项目进行到哪里了？为什么卡住，下一步应该做什么？')}><MessageCircle size={16} />向项目提问</button></div>}
    </div>
    {active !== 'details' && !session && !showHistory && <p className="conversation-loading" role="status">{creating ? '正在创建独立对话…' : '正在恢复会话…'}</p>}
    {session && <div id={`chat-panel-${session.id}`} role="tabpanel" aria-labelledby={`chat-tab-${session.id}`} hidden={showHistory} className="workspace-conversation">
      <ConversationView key={session.id} session={session} runs={runs} projectName={projectName ?? '当前项目'} providerId={providerId} providerName={providerName} onConfigure={onConfigure} onNavigate={navigate} command={runCommand} />
    </div>}
  </aside>
}

function ConversationView({ session, runs, projectName, providerId, providerName, command, onNavigate, onConfigure }: {
  session: WorkbenchConversation; runs: WorkflowRun[]; projectName: string; providerId: string; providerName: string
  command: (input: ConversationCommand) => Promise<unknown>
  onNavigate: (action: ConversationAction) => void; onConfigure: () => void
}) {
  const [input, setInput] = useState(session.inputDraft)
  const [contextOpen, setContextOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [answerTo, setAnswerTo] = useState<string | null>(null)
  const inputRef = useRef(input)
  const messagesEnd = useRef<HTMLDivElement>(null)
  const followLatest = useRef(true)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const busy = session.status === 'running'
  const scope = { projectId: session.localProjectId, conversationId: session.id }
  useEffect(() => {
    if (followLatest.current) messagesEnd.current?.scrollIntoView?.({ block: 'nearest' })
  }, [session.messages.length, session.status, session.messages.at(-1)?.reasoning?.text])
  useEffect(() => {
    const timer = window.setTimeout(() => { void command({ type: 'update', projectId: session.localProjectId, conversationId: session.id, inputDraft: input }) }, 450)
    return () => window.clearTimeout(timer)
  }, [command, input, session.id, session.localProjectId])
  useEffect(() => () => { void command({ type: 'update', projectId: session.localProjectId, conversationId: session.id, inputDraft: inputRef.current }) }, [command, session.id, session.localProjectId])
  const updateInput = (value: string) => { inputRef.current = value; setInput(value) }
  async function send(text = input) {
    if (!text.trim() || !providerId || busy || sending) return
    setSending(true)
    // Save the exact pending input first, so a rejected send never loses the draft.
    await command({ type: 'update', ...scope, inputDraft: text })
    const result = await command({ type: 'send', ...scope, providerId, text, ...(answerTo ? { answerToMessageId: answerTo } : {}) })
    if (result) { updateInput(''); setAnswerTo(null) }
    setSending(false)
    textarea.current?.focus()
  }
  const unreportedCalls = session.messages.filter((message) => message.role === 'notice' && message.provider && !message.usage && message.reasoning?.status !== 'streaming').length
  const visibleMessages = session.messages.filter((message) => message.role !== 'notice' || message.reasoning)
  const usages = session.messages.flatMap((message) => message.usage ? [message.usage] : [])
  const tokenCount = usages.reduce((sum, usage) => sum + (usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)), 0)
  return <>
    <header className="conversation-head">
      <div className="row"><strong>{session.title}</strong><span className={`pill ${session.status === 'awaiting_answer' ? 'blocked' : 'soft'}`}>{statusCopy[session.status]}</span></div>
      <p>{projectName} · 可查询全部 Run 与节点</p>
      <button className="conversation-context-toggle" onClick={() => setContextOpen(!contextOpen)} aria-expanded={contextOpen}><BookOpen size={15} />会话信息<span>{contextOpen ? '收起' : '查看'}</span></button>
      {contextOpen && <div className="conversation-context">
        <label>会话名称<input aria-label="会话名称" key={session.id} defaultValue={session.title} maxLength={100} onBlur={(event) => { if (event.target.value.trim() && event.target.value !== session.title) void command({ type: 'update', ...scope, title: event.target.value }) }} /></label>
        <p>共享：最新流程、已保存产物与证据、项目代码和知识。<br />独立：此会话的聊天、问题和草稿。</p>
        {session.memory && <details className="conversation-legacy-note"><summary>旧版会话备注（已停用）</summary><p className="meta">已停用，不会发送给模型；如需继续使用其中的要求，请在聊天中说明。</p><pre>{session.memory}</pre></details>}
        <p className="meta">{session.contextReceipt ? `上次使用 ${session.contextReceipt.includedMessages} 条本会话消息；${session.contextReceipt.omittedMessages} 条较早消息未进入模型上下文，历史仍保留。` : '每次调查按需读取最新流程；不会读取其他会话的聊天。'}</p>
        {session.contextReceipt?.limited && <p className="meta">本次上下文达到容量限制，部分查询内容未全部附带。可以缩小问题范围后继续调查。</p>}
        <p className="meta">当前工具：流程查询、节点与产物、只读代码检索、项目知识检索。没有连接业务数据库。</p>
        <details><summary>模型调用设置记录</summary>{session.messages.filter((message) => message.provider).map((message) => <p className="meta" key={message.id}>{message.createdAt} · {message.provider!.model} · {message.provider!.effectiveThinking ? describeProviderThinking(message.provider!.effectiveThinking!) : '旧记录未保存思考参数'}</p>)}</details>
      </div>}
    </header>
    <div className="conversation-messages" aria-label="当前会话消息" aria-busy={busy} onScroll={(event) => { const element = event.currentTarget; followLatest.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80 }}>
      {visibleMessages.length === 0 && <div className="conversation-welcome">
        <div className="conversation-avatar"><MessageCircle /></div><h3>从一个问题开始</h3><p>讨论整个项目，也可以深入任意节点。每个 Tab 保留自己的聊天历史。</p>
        {['现在进行到哪里了，下一步做什么？', '结合项目代码，帮我澄清这次需求。', '哪些测试或审批还没有完成？'].map((suggestion) => <button key={suggestion} onClick={() => { updateInput(suggestion); textarea.current?.focus() }}>{suggestion}<ArrowUp size={14} /></button>)}
      </div>}
      {visibleMessages.map((message) => <ConversationMessageView key={message.id} message={message} busy={busy} targetLabel={message.draft ? (() => { const run = runs.find((item) => item.id === message.draft!.runId); const node = run?.nodes.find((item) => item.id === message.draft!.nodeId); return run && node ? `${run.title} · ${node.title}` : '目标节点已不存在，请重新调查' })() : ''} onNavigate={onNavigate} onAnswer={(answer) => { setAnswerTo(message.id); updateInput(answer); textarea.current?.focus() }} onPublish={() => void command({ type: 'publish', ...scope, messageId: message.id })} />)}
      {busy && <p className="conversation-activity" role="status"><span className="conversation-running-dot" />正在调用 {providerName || 'Provider'} 调查；可以停止。</p>}
      {session.error && <div className="conversation-error" role="status">{session.error}{['failed', 'cancelled', 'interrupted'].includes(session.status) && <button className="ghost-button" disabled={!providerId || sending} onClick={() => void command({ type: 'retry', ...scope, providerId })}><RotateCcw size={14} />重试调查</button>}</div>}
      {session.failure && <details className="conversation-tool"><summary>本次失败诊断</summary><p>阶段：{session.failure.phase} · 代码：{session.failure.code}{session.failure.httpStatus ? ` · HTTP ${session.failure.httpStatus}` : ''}</p></details>}
      <div ref={messagesEnd} />
    </div>
    <form className="conversation-composer" onSubmit={(event) => { event.preventDefault(); void send() }}>
      {!providerId && <p>先配置模型才能开始调查。<button type="button" className="text-button" onClick={onConfigure}>配置 Provider</button></p>}
      <div className="conversation-answer-target" hidden={!answerTo}>回答：{session.messages.find((message) => message.id === answerTo)?.question?.prompt}<button type="button" className="text-button" onClick={() => setAnswerTo(null)}>取消关联</button></div>
      <label className="sr-only" htmlFor={`compose-${session.id}`}>对话内容</label>
      <textarea ref={textarea} id={`compose-${session.id}`} aria-label="对话内容" value={input} maxLength={12000} onChange={(event) => updateInput(event.target.value)} placeholder="问进度、查代码、讨论需求或回答问题…" onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send() } }} />
      <div className="conversation-composer-footer"><span title="仅展示 Provider 实际返回的 token；未提供时不估算费用">{providerName || '未配置模型'} · {usages.length ? `${tokenCount.toLocaleString()} tokens${unreportedCalls ? '（部分调用未返回用量）' : ''}` : unreportedCalls ? '模型未返回用量' : '暂无用量记录'}</span>
        {busy ? <button type="button" className="ghost-button" aria-label="停止调查" onClick={() => void command({ type: 'cancel', ...scope })}><Square size={15} />停止</button> : <button className="primary-button" type="submit" aria-label="发送消息" disabled={!input.trim() || !providerId || sending}><ArrowUp size={18} /></button>}
      </div><small>Enter 发送 · Shift+Enter 换行 · 调用模型可能产生费用</small>
    </form>
  </>
}

function ReasoningView({ message }: { message: ConversationMessage }) {
  const reasoning = message.reasoning!
  const [expanded, setExpanded] = useState<boolean | undefined>()
  const content = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  const streaming = reasoning.status === 'streaming'
  const open = expanded ?? streaming
  useEffect(() => {
    if (content.current && follow.current) content.current.scrollTop = content.current.scrollHeight
  }, [reasoning.text, open])
  const status = streaming ? '生成中' : reasoning.status === 'interrupted' ? '已中断' : '已结束'
  return <section className="conversation-reasoning" aria-label={`${message.text}的推理过程`}>
    <button className="reasoning-toggle" aria-expanded={open} aria-controls={`reasoning-${message.id}`} onClick={() => setExpanded(!open)}>
      <Brain size={15} /><strong>推理过程</strong><span className="reasoning-status">{streaming && <i className="conversation-running-dot" />}{status}</span><small>{{ low: '低强度', high: '高强度', max: '最高强度' }[reasoning.effort]}</small><ChevronDown size={14} className={open ? 'expanded' : ''} />
    </button>
    <div id={`reasoning-${message.id}`} hidden={!open}>
      <div ref={content} className="reasoning-content" onScroll={(event) => { const element = event.currentTarget; follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40 }}>
        {reasoning.text || (streaming ? '已发起请求，等待模型返回推理内容…' : reasoning.status === 'interrupted' ? '本次调用已中断，尚未收到可展示的推理内容。' : '模型未返回可展示的推理内容。')}
      </div>
      <p className="reasoning-note">模型生成时的推理记录；最终结论以回答为准。</p>
    </div>
  </section>
}

function ConversationMessageView({ message, busy, targetLabel, onAnswer, onNavigate, onPublish }: {
  message: ConversationMessage; busy: boolean; targetLabel: string; onAnswer: (answer: string) => void; onNavigate: (action: ConversationAction) => void; onPublish: () => void
}) {
  if (message.reasoning) return <ReasoningView message={message} />
  if (message.role === 'tool') return <details className="conversation-tool"><summary>{message.text}</summary>{message.citations?.map((source) => <pre key={source.id}>{source.excerpt}</pre>)}</details>
  return <article className={`conversation-message conversation-message--${message.role}`}>
    <span className="message-author">{message.role === 'user' ? '你' : 'DevFlow'}</span>
    <ConversationBody message={message} />
    {message.question && <div className="conversation-question"><span className="meta">{message.question.resolvedBy === 'proposal_saved' ? '已保存提案' : message.question.answeredAt ? '已收到后续回复' : '需要你补充'}</span><strong>{message.question.prompt}</strong>
      {!message.question.answeredAt && <><div className="question-options">{message.question.options.map((option) => <button className="ghost-button" key={option} disabled={busy} onClick={() => onAnswer(option)}>{option}</button>)}</div><button className="text-button" disabled={busy} onClick={() => onAnswer('')}>输入回答</button><small>点击选项填入输入框，也可以直接输入自己的回答。</small></>}
    </div>}
    {!!message.actions?.length && <div className="conversation-actions">{message.actions.map((action, index) => <button className="ghost-button" key={`${action.runId}-${action.nodeId}-${index}`} onClick={() => onNavigate(action)}>{action.label} ↗</button>)}</div>}
    {message.draft && <div className="conversation-proposal"><span className="pill soft">{message.draft.publishedArtifactId ? '已保存 · 待确认' : '仅本会话草稿'}</span><strong>{message.draft.title}</strong><pre>{message.draft.content}</pre><p className="meta">目标：{targetLabel}。保存后其他会话可以查询；仍需在节点形成正式产物。</p>
      <button className="ghost-button" disabled={!!message.draft.publishedArtifactId} onClick={onPublish}>{message.draft.publishedArtifactId ? '已保存为节点提案' : '保存为节点提案'}</button>
    </div>}
    {!!message.citations?.length && <details className="conversation-sources"><summary>查询依据 · {message.citations.length}</summary>{message.citations.map((citation) => <div key={citation.id}><strong>{citation.label}</strong><small>读取于 {new Date(citation.observedAt).toLocaleString()}</small><pre>{citation.excerpt}</pre></div>)}</details>}
  </article>
}
