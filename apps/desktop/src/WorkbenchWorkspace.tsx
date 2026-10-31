import { InvestigationControls, InvestigationProgress } from './InvestigationControls'
import { ConversationUsage } from './components/ConversationUsage'
import { WorkbenchSplitter } from './WorkbenchSplitter'
import { ConversationBody } from './ConversationBody'
import { ProposalBody } from './components/ProposalBody'
import { NewConversationDialog } from './ConversationDialogs'
import { PendingComposer, ReferenceChips, type PendingDraft } from './PendingComposer'
import { ConversationDetailsDialog, ConversationTabMenu, type ConversationMenuTarget, type ConversationTabTarget } from './ConversationDetails'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowUp, Brain, ChevronDown, History, MessageCircle, MoreHorizontal, PanelRightClose, Pin, Plus, RotateCcw, Square, X } from 'lucide-react'
import { type WorkflowRun } from '@ai-devflow/shared'
import type { DevFlowDesktopApi } from './desktop-api'
import type { ConversationAction, ConversationCommand, ConversationMessage, WorkbenchConversation } from '../electron/workbench-conversation-contract'
import {
  MAX_CONVERSATION_TEXT,
  addDiscussionReference,
  composeMessageWithReferences,
  loadDiscussionReferences,
  referenceChipLabel,
  saveDiscussionReferences,
  type DiscussionReference,
} from './app/discussion-reference'
import { ipcErrorMessage } from './app/ipc-error'
import type { RevisionLink } from './app/gate-decision/chat-link'

/** `reference` adds a card to the current discussion without sending anything (plan W7). */
export type WorkbenchOpenRequest = { serial: number; type: 'details' | 'discussion' | 'reference'; prompt?: string; reference?: DiscussionReference }
/** The 「加入修订清单」 state of a chat answer's draft (design §5.10, `revisionLinkForDraft`). */
export type RevisionLinkFor = (message: ConversationMessage) => RevisionLink
export type AddedRevisionLink = Extract<RevisionLink, { state: 'added' }>
export type ReAddRevisionLink = Extract<RevisionLink, { state: 'readd' }>

type DiscussionPaneState = { open: boolean; toggle: () => void; attention: boolean }
/** Lets the task title row toggle the project discussion without owning its state (plan §5.4). */
const DiscussionPaneContext = createContext<DiscussionPaneState | null>(null)

export function DiscussionToggle() {
  const pane = useContext(DiscussionPaneContext)
  if (!pane) return null
  return <button type="button" className="ghost-button discussion-toggle" aria-expanded={pane.open} aria-controls="workbench-discussion" onClick={pane.toggle}>
    <MessageCircle size={16} aria-hidden="true" />{pane.open ? '收起答疑' : '答疑'}{pane.attention && !pane.open ? <i className="discussion-attention" aria-label="有待回答的讨论" /> : null}
  </button>
}

const discussionPreferenceKey = (projectId: string) => `devflow-workbench-discussion:${projectId}`
const statusCopy: Record<WorkbenchConversation['status'], string> = {
  paused: '已暂停，可继续',
  idle: '可以继续提问', running: '正在调查', awaiting_answer: '等待你的回答', failed: '需要重试', interrupted: '上次调查已中断', cancelled: '已停止',
}

export function WorkbenchWorkspace({ api, projectId, projectName, runs, providerId, providerName, request, onNavigate, onConfigure, children, splitDetails = false, modelReadinessError, viewContext, revisionLinkFor, onOpenRevisionItem, onReAddChatItem, focusMessage }: {
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
  modelReadinessError?: string | undefined
  splitDetails?: boolean
  /** "当前：任务 · 步骤 · 版本" / "正在查看：…" (design §5.10). */
  viewContext?: { label: string } | undefined
  revisionLinkFor?: RevisionLinkFor | undefined
  onOpenRevisionItem?: ((link: AddedRevisionLink, message: ConversationMessage) => void) | undefined
  onReAddChatItem?: ((link: ReAddRevisionLink) => void) | undefined
  /** A 来自答疑 source label: open the conversation that holds this message and flash it. */
  focusMessage?: { serial: number; messageId: string } | undefined
}) {
  const reader = useRef<HTMLElement>(null)
  const [sessions, setSessions] = useState<WorkbenchConversation[]>([])
  const [active, setActive] = useState('details')
  const [nativeConversationsEnabled, setNativeConversationsEnabled] = useState(false)
  const [nativeReadOnlyPilotEnabled, setNativeReadOnlyPilotEnabled] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [tabMenu, setTabMenu] = useState<ConversationMenuTarget | null>(null)
  const [detailsTarget, setDetailsTarget] = useState<ConversationTabTarget | null>(null)
  const closeMenu = useCallback(() => setTabMenu(null), [])
  const [creationRequest, setCreationRequest] = useState<{ projectId: string; prompt: string } | null>(null)
  // Reference cards per conversation: local UI state, persisted best-effort (plan W7).
  const [referenceStore, setReferenceStore] = useState<Record<string, DiscussionReference[]>>({})
  // 「讨论」 without an open conversation (design §5.10, amendment 34). The ref is read by the
  // send sequence and the request effect, so a reference that arrives mid-send is not lost.
  const [pendingDraft, setPendingDraftState] = useState<PendingDraft | null>(null)
  const pendingDraftRef = useRef<PendingDraft | null>(null)
  const setPendingDraft = useCallback((next: PendingDraft | null) => { pendingDraftRef.current = next; setPendingDraftState(next) }, [])
  const [flashMessageId, setFlashMessageId] = useState<{ id: string; serial: number }>()
  const lastFocusMessage = useRef(focusMessage?.serial)
  const creatingRef = useRef(false)
  const generation = useRef(0)
  const activeRef = useRef(active)
  activeRef.current = active
  const visibleProject = useRef(projectId)
  visibleProject.current = projectId
  const tabbar = useRef<HTMLDivElement>(null)
  const lastRequest = useRef(request.serial)
  // Only a validated UI preference is stored, scoped to the project (plan §3).
  const [discussionPreference, setDiscussionPreference] = useState<'open' | 'closed' | null>(null)
  const [autoOpened, setAutoOpened] = useState(false)
  useEffect(() => {
    setAutoOpened(false)
    let stored: string | null = null
    try { stored = projectId ? localStorage.getItem(discussionPreferenceKey(projectId)) : null } catch { /* optional UI preference */ }
    setDiscussionPreference(stored === 'open' || stored === 'closed' ? stored : null)
  }, [projectId])
  const rememberDiscussion = useCallback((next: 'open' | 'closed') => {
    setDiscussionPreference(next)
    if (projectId) { try { localStorage.setItem(discussionPreferenceKey(projectId), next) } catch { /* optional UI preference */ } }
  }, [projectId])
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
    if (result.nativeConversationsEnabled !== undefined) setNativeConversationsEnabled(result.nativeConversationsEnabled)
    if (result.nativeReadOnlyPilotEnabled !== undefined) setNativeReadOnlyPilotEnabled(result.nativeReadOnlyPilotEnabled)
    if (command.type === 'list' && !['details', 'new-pending'].includes(activeRef.current) && !result.conversations.some((item) => item.id === activeRef.current && item.isOpen)) setActive('details')
    if (splitDetails && activeRef.current === 'details') {
      const lastOpen = result.conversations.filter((item) => item.isOpen).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
      if (lastOpen) setActive(lastOpen.id)
    }
    if (command.type === 'read_content' || command.type === 'export_diagnostics') return result
    setSessions((current) => result.conversations.map((incoming) => {
      const existing = current.find((item) => item.id === incoming.id)
      return existing && existing.version > incoming.version ? existing : incoming
    }))
    return result
  }, [api, splitDetails])
  const runCommand = useCallback(async (command: ConversationCommand) => {
    try { setError(''); return await call(command) }
    catch (failure) { if (command.projectId === visibleProject.current) setError(ipcErrorMessage(failure, '会话操作未完成，请重试。')); return undefined }
  }, [call])

  const referencesFor = useCallback((conversationId: string) =>
    referenceStore[conversationId] ?? (projectId ? loadDiscussionReferences(projectId, conversationId) : []), [projectId, referenceStore])
  const setReferencesFor = useCallback((conversationId: string, next: DiscussionReference[]) => {
    setReferenceStore((current) => ({ ...current, [conversationId]: next }))
    if (projectId && !saveDiscussionReferences(projectId, conversationId, next)) {
      setError('引用只保留在本次窗口中，未能写入本机界面状态。')
    }
  }, [projectId])

  useEffect(() => {
    generation.current++
    setNativeReadOnlyPilotEnabled(false); setSessions([]); setShowHistory(false); setError(''); setCreationRequest(null); setTabMenu(null); setDetailsTarget(null)
    setReferenceStore({}); setPendingDraft(null)
    let restored = 'details'
    try { restored = projectId ? localStorage.getItem(`devflow-workbench-tab:${projectId}`) ?? 'details' : 'details' } catch { /* optional UI preference */ }
    setActive(restored)
    if (!projectId || !api?.workbenchConversation) return
    let disposed = false
    let refreshing = false
    let pending = false
    const refresh = async () => {
      if (disposed) return
      if (refreshing) { pending = true; return }
      refreshing = true
      do {
        pending = false
        await runCommand({ type: 'list', projectId })
      } while (pending && !disposed)
      refreshing = false
    }
    refresh()
    const unsubscribe = api.onWorkbenchConversationUpdated?.((changedId) => { if (changedId === projectId) refresh() })
    // Push events are primary. Recover missed events on focus/visibility and
    // with a low-frequency fallback; a hidden conversation needs no list poll.
    const recover = () => { if (document.visibilityState !== 'hidden') void refresh() }
    const interval = window.setInterval(recover, 60_000)
    window.addEventListener('focus', recover)
    document.addEventListener('visibilitychange', recover)
    return () => {
      disposed = true; generation.current++; unsubscribe?.(); window.clearInterval(interval)
      window.removeEventListener('focus', recover)
      document.removeEventListener('visibilitychange', recover)
    }
  }, [api, projectId, runCommand, setPendingDraft])

  const beginCreate = useCallback((prompt = '') => {
    if (!projectId || !api?.workbenchConversation || creatingRef.current) return
    setError('')
    setCreationRequest({ projectId, prompt })
  }, [api, projectId])
  const create = async (executor: 'direct-provider' | 'opencode' | 'native-tools') => {
    if (!projectId || creationRequest?.projectId !== projectId || creatingRef.current) return
    const currentGeneration = generation.current
    const previousActive = active
    creatingRef.current = true
    setCreating(true)
    setActive('new-pending')
    const result = await runCommand({ type: 'create', projectId, inputDraft: creationRequest.prompt, executor })
    if (currentGeneration === generation.current) {
      if (result?.conversationId) { setCreationRequest(null); activate(result.conversationId); setShowHistory(false) }
      else setActive(previousActive)
    }
    creatingRef.current = false
    setCreating(false)
  }

  useEffect(() => {
    if (lastRequest.current === request.serial) return
    lastRequest.current = request.serial
    if (request.type === 'details') {
      if (splitDetails && reader.current) { reader.current.scrollTop = 0; reader.current.focus({ preventScroll: true }) }
      else { activate('details'); setShowHistory(false); setCreationRequest(null) }
    }
    else if (request.type === 'reference' && request.reference) {
      if (splitDetails) rememberDiscussion('open')
      // A pending composer takes the reference first, also while its first send is in flight (amendment 34).
      const pending = pendingDraftRef.current
      if (pending) {
        setPendingDraft(pending.sending
          ? { ...pending, queued: [...pending.queued, request.reference] }
          : { ...pending, references: addDiscussionReference(pending.references, request.reference) })
        setShowHistory(false)
        return
      }
      const open = sessions.filter((item) => item.localProjectId === projectId && item.isOpen)
      const target = open.find((item) => item.id === activeRef.current) ??
        [...open].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
      if (target) {
        setReferencesFor(target.id, addDiscussionReference(referencesFor(target.id), request.reference))
        activate(target.id); setShowHistory(false)
      } else {
        // No conversation yet: the chip waits in a pending composer; no dialog, nothing sent.
        setPendingDraft({ references: [request.reference], executor: 'direct-provider', text: '', sending: false, queued: [] })
        setCreationRequest(null); setShowHistory(false)
      }
    }
    else { if (splitDetails) rememberDiscussion('open'); beginCreate(request.prompt) }
  }, [activate, beginCreate, projectId, referencesFor, rememberDiscussion, request, sessions, setPendingDraft, setReferencesFor, splitDetails])

  /**
   * The pending composer's 发送 (design §5.10): keep the new conversation closed, create it with
   * the typed text as its stored draft, send, and only then open it with its stored draft.
   */
  async function sendPending() {
    const draft = pendingDraftRef.current
    if (!projectId || !draft || draft.sending || !draft.text.trim() || !providerId || modelReadinessError) return
    const typed = draft.text
    const outgoing = composeMessageWithReferences(draft.references, typed)
    if (outgoing.length > MAX_CONVERSATION_TEXT) {
      setError(`引用与输入合计超过 ${MAX_CONVERSATION_TEXT} 字，请移除部分引用或缩短输入。草稿已保留。`)
      return
    }
    const currentGeneration = generation.current
    const previousActive = activeRef.current
    // 1. While the pane shows `new-pending`, neither the create response nor a pushed list opens a conversation.
    setActive('new-pending'); activeRef.current = 'new-pending'
    setPendingDraft({ ...draft, sending: true, queued: [] })
    // 2. The typed text becomes the stored draft at creation; no separate update.
    const created = await runCommand({ type: 'create', projectId, inputDraft: typed, executor: draft.executor })
    if (currentGeneration !== generation.current) return
    if (!created?.conversationId) {
      setActive(previousActive); activeRef.current = previousActive
      const latest = pendingDraftRef.current ?? draft
      setPendingDraft({ ...latest, sending: false, references: latest.queued.reduce(addDiscussionReference, latest.references), queued: [] })
      return
    }
    const id = created.conversationId
    // 3. The model still gets the full reference block; the bubble and the title use `display`.
    const sent = await runCommand({ type: 'send', projectId, conversationId: id, providerId, text: outgoing,
      ...(draft.references.length ? { display: { text: typed, references: draft.references.map(referenceChipLabel) } } : {}) })
    if (currentGeneration !== generation.current) return
    // 4. Open it: an empty box and no chip after a success; the typed draft and the chip after a failure.
    const queued = pendingDraftRef.current?.queued ?? []
    setReferencesFor(id, sent ? queued.reduce(addDiscussionReference, [] as DiscussionReference[]) : queued.reduce(addDiscussionReference, draft.references))
    setPendingDraft(null)
    activate(id); setShowHistory(false)
  }

  useEffect(() => {
    if (!focusMessage || lastFocusMessage.current === focusMessage.serial) return
    lastFocusMessage.current = focusMessage.serial
    const holder = sessions.find((item) => item.localProjectId === projectId && item.messages.some((message) => message.id === focusMessage.messageId))
    if (splitDetails) rememberDiscussion('open')
    if (!holder || !projectId) { setError('这条答疑记录不在本机的对话里。'); return }
    void (async () => {
      if (!holder.isOpen && !(await runCommand({ type: 'update', projectId, conversationId: holder.id, isOpen: true }))) return
      activate(holder.id); setShowHistory(false)
      setFlashMessageId({ id: focusMessage.messageId, serial: focusMessage.serial })
    })()
  }, [activate, focusMessage, projectId, rememberDiscussion, runCommand, sessions, splitDetails])

  useEffect(() => {
    tabbar.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [active])
  const projectSessions = sessions.filter((session) => session.localProjectId === projectId)
  const visible = projectSessions.filter((session) => session.isOpen).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  const session = projectSessions.find((item) => item.id === active)
  const detailsSession = detailsTarget && detailsTarget.projectId === projectId ? visible.find((item) => item.id === detailsTarget.conversationId) : undefined
  const menuSession = tabMenu && tabMenu.projectId === projectId ? visible.find((item) => item.id === tabMenu.conversationId) : undefined
  function openTabMenu(item: WorkbenchConversation, trigger: HTMLElement, point?: { x: number; y: number }) {
    const bounds = trigger.getBoundingClientRect()
    setTabMenu({ projectId: item.localProjectId, conversationId: item.id, trigger, x: point?.x ?? bounds.left, y: point?.y ?? bounds.bottom })
  }
  function navigate(action: ConversationAction) {
    const run = runs.find((candidate) => candidate.id === action.runId)
    if (!run?.nodes.some((node) => node.id === action.nodeId)) { setError('目标节点已不存在，或不在当前项目中。请重新查询最新流程。'); return }
    if (!splitDetails) { activate('details'); setShowHistory(false) }
    onNavigate(action)
  }

  // Empty discussion starts collapsed unless the user chose otherwise (plan L3). Once it has
  // shown sessions, closing the last tab keeps the pane (empty state and history) until the
  // user collapses it, so the column does not vanish under the pointer.
  const hasOpenSessions = visible.length > 0
  useEffect(() => { if (hasOpenSessions) setAutoOpened(true) }, [hasOpenSessions])
  const discussionOpen = !splitDetails || (discussionPreference ? discussionPreference === 'open' : autoOpened || hasOpenSessions)
  const discussionAttention = visible.some((item) => item.status === 'awaiting_answer')
  const conversationPane = <aside id="workbench-discussion" className="workbench-workspace" data-testid="workbench-workspace" aria-label={splitDetails ? '答疑' : '节点详情与对话'} hidden={!discussionOpen}>
    {splitDetails && <h2 className="workspace-pane-heading">答疑</h2>}
    <div className="workspace-tab-strip">
      <div ref={tabbar} className="workspace-tabs" role="tablist" aria-label={splitDetails ? '独立会话' : '节点详情与独立会话'} onKeyDown={(event) => {
        if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return
        const tabs = Array.from(tabbar.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])
        const index = tabs.indexOf(document.activeElement as HTMLButtonElement)
        if (index < 0) return
        event.preventDefault()
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
        tabs[next]?.focus(); tabs[next]?.click()
      }}>
        {!splitDetails && <button id="details-tab" role="tab" aria-controls="details-panel" aria-selected={active === 'details'} tabIndex={active === 'details' ? 0 : -1} onClick={() => { activate('details'); setShowHistory(false) }}><Pin size={15} />节点详情</button>}
        {visible.map((item) => <div className="conversation-tab" key={item.id}>
          <button id={`chat-tab-${item.id}`} role="tab" aria-controls={`chat-panel-${item.id}`} aria-selected={active === item.id} tabIndex={active === item.id ? 0 : -1} onClick={() => { activate(item.id); setShowHistory(false) }} title={item.title}
            aria-haspopup="menu" aria-expanded={menuSession?.id === item.id}
            onContextMenu={(event) => { event.preventDefault(); openTabMenu(item, event.currentTarget, { x: event.clientX, y: event.clientY }) }}
            onKeyDown={(event) => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); event.stopPropagation(); openTabMenu(item, event.currentTarget) } }}>
            <MessageCircle size={15} /><span>{item.title}</span>{item.status === 'awaiting_answer' && <i aria-label="待回答">•</i>}{item.status === 'running' && <i aria-label="调查中" className="conversation-running-dot" />}
          </button>
          <button className="conversation-tab-options" aria-label={`会话菜单：${item.title}`} title="会话菜单（也可右键 Tab）" aria-haspopup="menu" aria-expanded={menuSession?.id === item.id} onClick={(event) => openTabMenu(item, event.currentTarget)}><MoreHorizontal size={14} /></button>
          <button className="close-tab" aria-label={`关闭会话 Tab：${item.title}`} onClick={async () => {
            if (!projectId) return
            const result = await runCommand({ type: 'update', projectId, conversationId: item.id, isOpen: false })
            if (result) {
              if (active === item.id) activate('details')
              setTabMenu(null)
              if (detailsTarget?.conversationId === item.id) setDetailsTarget(null)
            }
          }}><X size={13} /></button>
        </div>)}
      </div>
      {session && <ConversationUsage key={session.id} session={session} />}
      <button className="workspace-icon" aria-label="新建对话" title="新建独立对话，可以询问整个项目" disabled={!projectId || !api?.workbenchConversation || creating || Boolean(pendingDraft)} onClick={() => beginCreate()}><Plus size={19} /></button>
      <button className="workspace-icon" aria-label="会话历史" title="会话历史" aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)}><History size={18} /></button>
      {splitDetails && <button className="workspace-icon" aria-label="收起答疑" title="收起答疑；会话、草稿与阅读位置都会保留" onClick={() => rememberDiscussion('closed')}><PanelRightClose size={18} /></button>}
    </div>
    {viewContext && <p className="conversation-context-chip" data-testid="conversation-context-chip">{viewContext.label}</p>}
    {tabMenu && menuSession && <ConversationTabMenu key={menuSession.id} target={tabMenu} onClose={closeMenu} onDetails={() => { setDetailsTarget(tabMenu); setTabMenu(null) }} />}
    {detailsTarget && detailsSession && <ConversationDetailsDialog key={detailsSession.id} session={detailsSession} projectName={projectName ?? '当前项目'} providerName={providerName} statusLabel={statusCopy[detailsSession.status]} returnFocus={detailsTarget.trigger} onClose={() => setDetailsTarget(null)} onRename={(title) => runCommand({ type: 'update', projectId: detailsSession.localProjectId, conversationId: detailsSession.id, title })} />}
    {creationRequest && creationRequest.projectId === projectId && <NewConversationDialog nativeReadOnlyPilotEnabled={nativeReadOnlyPilotEnabled && !nativeConversationsEnabled} prompt={creationRequest.prompt} providerName={providerName} creating={creating} error={error} onClose={() => { if (!creatingRef.current) { setCreationRequest(null); setError('') } }} onCreate={(executor) => void create(executor)} />}
    {error && !creationRequest && !pendingDraft && <div className="conversation-error" role="alert">{error}<button aria-label="关闭会话提示" onClick={() => setError('')}><X size={14} /></button></div>}
    {showHistory && <section className="conversation-history" aria-label="会话历史记录">
      <div className="row"><strong>会话历史</strong><button className="workspace-icon" onClick={() => setShowHistory(false)} aria-label="关闭会话历史"><X size={16} /></button></div>
      <p className="meta">{projectName ?? '当前项目'} · 关闭 Tab 后仍可从这里继续。</p>
      {projectSessions.length === 0 && <p>还没有对话。点击 ＋ 开始。</p>}
      {projectSessions.map((item) => <button className="history-item" key={item.id} onClick={async () => {
        if (!projectId) return
        const result = await runCommand({ type: 'update', projectId, conversationId: item.id, isOpen: true })
        if (result) { activate(item.id); setShowHistory(false) }
      }}><span>{item.title}</span><small>{statusCopy[item.status]} · {item.executor === 'opencode' ? 'OpenCode' : item.executor === 'native-tools' ? 'Direct Provider · 原生工具试点' : 'Direct Provider'} · {new Date(item.updatedAt).toLocaleString()}</small></button>)}
    </section>}
    <div id={splitDetails ? 'conversation-empty' : 'details-panel'} role={splitDetails ? 'region' : 'tabpanel'} aria-label={splitDetails ? '对话空状态' : undefined} aria-labelledby={splitDetails ? undefined : 'details-tab'} hidden={active !== 'details' || showHistory || (splitDetails && Boolean(pendingDraft))} className="workspace-details">
      {splitDetails ? <p className="empty-note">点击 ＋ 新建对话，或从历史继续。浏览节点不会切换会话。</p> : children}
      {api?.workbenchConversation && <div className="details-conversation-entry"><button className="ghost-button" disabled={!projectId || creating} onClick={() => beginCreate('当前项目进行到哪里了？为什么卡住，下一步应该做什么？')}><MessageCircle size={16} />向项目提问</button></div>}
    </div>
    {pendingDraft && !showHistory && <PendingComposer draft={pendingDraft} providerId={providerId} providerName={providerName} modelReadinessError={modelReadinessError}
      nativeReadOnlyPilotEnabled={nativeReadOnlyPilotEnabled && !nativeConversationsEnabled} error={error} onConfigure={onConfigure}
      onChange={(next) => { const current = pendingDraftRef.current; if (current && !current.sending) setPendingDraft({ ...current, ...next }) }}
      onSend={() => void sendPending()} />}
    {active !== 'details' && !session && !showHistory && !pendingDraft && <p className="conversation-loading" role="status">{creating ? '正在创建独立对话…' : '正在恢复会话…'}</p>}
    {session && <div id={`chat-panel-${session.id}`} role="tabpanel" aria-labelledby={`chat-tab-${session.id}`} hidden={showHistory} className="workspace-conversation">
      <ConversationView modelReadinessError={modelReadinessError} key={session.id} session={session} runs={runs} providerId={providerId} providerName={providerName} onConfigure={onConfigure} onNavigate={navigate} command={runCommand}
        references={referencesFor(session.id)} onReferencesChange={(next) => setReferencesFor(session.id, next)}
        revisionLinkFor={revisionLinkFor} onOpenRevisionItem={onOpenRevisionItem} onReAddChatItem={onReAddChatItem}
        flashMessageId={flashMessageId?.id} flashSerial={flashMessageId?.serial} />
    </div>}
  </aside>
  return splitDetails ? <DiscussionPaneContext.Provider value={{ open: discussionOpen, attention: discussionAttention, toggle: () => rememberDiscussion(discussionOpen ? 'closed' : 'open') }}>
    <div className={`workspace-split ${discussionOpen ? 'is-discussion-open' : 'is-discussion-collapsed'}`}>
      <section ref={reader} id="workbench-node-reader" className="node-reader" tabIndex={-1} aria-label="当前查看的节点详情">{children}</section>
      {discussionOpen && <WorkbenchSplitter initialWidth={480} />}
      {conversationPane}
    </div>
  </DiscussionPaneContext.Provider> : conversationPane
}

function ConversationView({ session, runs, providerId, providerName, command, onNavigate, onConfigure, modelReadinessError, references, onReferencesChange, revisionLinkFor, onOpenRevisionItem, onReAddChatItem, flashMessageId, flashSerial }: {
  modelReadinessError?: string | undefined
  session: WorkbenchConversation; runs: WorkflowRun[]; providerId: string; providerName: string
  command: (input: ConversationCommand) => Promise<import('../electron/workbench-conversation-contract').ConversationResponse | undefined>
  onNavigate: (action: ConversationAction) => void; onConfigure: () => void
  references: DiscussionReference[]; onReferencesChange: (next: DiscussionReference[]) => void
  revisionLinkFor?: RevisionLinkFor | undefined
  onOpenRevisionItem?: ((link: AddedRevisionLink, message: ConversationMessage) => void) | undefined
  onReAddChatItem?: ((link: ReAddRevisionLink) => void) | undefined
  flashMessageId?: string | undefined
  flashSerial?: number | undefined
}) {
  const [input, setInput] = useState(session.inputDraft)
  const [flashing, setFlashing] = useState<string>()
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
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
  useEffect(() => {
    if (!flashMessageId || flashSerial === undefined) return
    document.getElementById(`message-${flashMessageId}`)?.scrollIntoView?.({ block: 'center' })
    setFlashing(flashMessageId)
    const timer = window.setTimeout(() => setFlashing(undefined), 1700)
    return () => window.clearTimeout(timer)
  }, [flashMessageId, flashSerial])
  const updateInput = (value: string) => { inputRef.current = value; setInput(value) }
  async function send(text = input) {
    if (!text.trim() || !providerId || busy || sending || modelReadinessError) return
    // References are prepended as plain text; the contract's text bound still applies (W7).
    const outgoing = composeMessageWithReferences(references, text)
    if (outgoing.length > MAX_CONVERSATION_TEXT) {
      setSendError(`引用与输入合计超过 ${MAX_CONVERSATION_TEXT} 字，请移除部分引用或缩短输入。草稿已保留。`)
      return
    }
    setSendError('')
    setSending(true)
    // Save the exact pending input first, so a rejected send never loses the draft.
    await command({ type: 'update', ...scope, inputDraft: text })
    const result = await command({ type: 'send', ...scope, providerId, text: outgoing, ...(answerTo ? { answerToMessageId: answerTo } : {}),
      ...(references.length ? { display: { text, references: references.map(referenceChipLabel) } } : {}) })
    if (result) { updateInput(''); setAnswerTo(null); if (references.length) onReferencesChange([]) }
    setSending(false)
    textarea.current?.focus()
  }
  const visibleMessages = session.messages.filter((message) => message.role !== 'notice' || message.reasoning || message.failure || !message.provider)
  return <>
    <div className="conversation-messages" aria-label="当前会话消息" aria-busy={busy} onScroll={(event) => { const element = event.currentTarget; followLatest.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80 }}>
      {visibleMessages.length === 0 && <div className="conversation-welcome">
        <div className="conversation-avatar"><MessageCircle /></div><h3>从一个问题开始</h3><p>讨论整个项目，也可以深入任意节点。每个 Tab 保留自己的聊天历史。</p>
        {['现在进行到哪里了，下一步做什么？', '结合项目代码，帮我澄清这次需求。', '哪些测试或审批还没有完成？'].map((suggestion) => <button key={suggestion} onClick={() => { updateInput(suggestion); textarea.current?.focus() }}>{suggestion}<ArrowUp size={14} /></button>)}
      </div>}
      {visibleMessages.map((message) => <ConversationMessageView key={message.id} message={message} busy={busy} flashing={flashing === message.id}
        revisionLink={message.draft && revisionLinkFor ? revisionLinkFor(message) : undefined}
        onOpenRevisionItem={(link) => onOpenRevisionItem?.(link, message)} onReAddChatItem={(link) => onReAddChatItem?.(link)} targetLabel={message.draft ? (() => { const run = runs.find((item) => item.id === message.draft!.runId); const node = run?.nodes.find((item) => item.id === message.draft!.nodeId); return run && node ? `${run.title} · ${node.title}` : '目标节点已不存在，请重新调查' })() : ''} onNavigate={onNavigate} onAnswer={(answer) => { setAnswerTo(message.id); updateInput(answer); textarea.current?.focus() }} readContent={async (field, offset) => (await command({ type: 'read_content', ...scope, messageId: message.id, field, offset }))?.contentPage} onRetryReview={() => void command({ type: 'retry_review', ...scope, messageId: message.id, providerId })} onPublish={(acknowledgeUnverified) => void command({ type: 'publish', ...scope, messageId: message.id, ...(acknowledgeUnverified ? { acknowledgeUnverified: true } : {}) })} />)}

      {busy && <p className="conversation-activity" role="status"><span className="conversation-running-dot" />正在调用 {providerName || 'Provider'} 调查；可以停止。</p>}
      {modelReadinessError && <div className="conversation-error" role="status">{modelReadinessError}<button className="text-button" onClick={onConfigure}>打开项目模型设置</button></div>}
      {session.error && <div className="conversation-error" role="status">{session.error}{['failed', 'cancelled', 'interrupted', 'paused'].includes(session.status) && <button className="ghost-button" disabled={!providerId || sending || Boolean(modelReadinessError)} onClick={() => void command({ type: 'retry', ...scope, providerId })}><RotateCcw size={14} />{session.status === 'paused' ? '继续当前步骤' : '重试这一步'}</button>}</div>}
      <InvestigationProgress session={session} />
      {session.failure && <details className="conversation-tool"><summary>本次失败诊断</summary><p>阶段：{session.failure.phase} · 代码：{session.failure.code}{session.failure.reason ? ` · 原因：${session.failure.reason}` : ''}{session.failure.httpStatus ? ` · HTTP ${session.failure.httpStatus}` : ''}</p></details>}
      <div ref={messagesEnd} />
    </div>
    <InvestigationControls session={session} command={command} busy={busy || sending} />
    <form className="conversation-composer" onSubmit={(event) => { event.preventDefault(); void send() }}>
      {!providerId && <p>先配置模型才能开始调查。<button type="button" className="text-button" onClick={onConfigure}>配置 Provider</button></p>}
      <div className="conversation-answer-target" hidden={!answerTo}>回答：{session.messages.find((message) => message.id === answerTo)?.question?.prompt}<button type="button" className="text-button" onClick={() => setAnswerTo(null)}>取消关联</button></div>
      <ReferenceChips references={references} onRemove={(id) => onReferencesChange(references.filter((item) => item.id !== id))} />
      {sendError && <p className="conversation-error" role="alert">{sendError}</p>}
      <label className="sr-only" htmlFor={`compose-${session.id}`}>对话内容</label>
      <textarea ref={textarea} id={`compose-${session.id}`} aria-label="对话内容" value={input} maxLength={12000} onChange={(event) => updateInput(event.target.value)} placeholder="问进度、查代码、讨论需求或回答问题…" onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send() } }} />
      <div className="conversation-composer-footer"><span title="本会话所选模型；调用可能产生费用，用量可在顶栏查看">{providerName || '未配置模型'}</span>
        {busy ? <button type="button" className="ghost-button" aria-label="停止调查" onClick={() => void command({ type: 'cancel', ...scope })}><Square size={15} />停止</button> : <button className="primary-button" type="submit" aria-label="发送消息" title="Enter 发送 · Shift+Enter 换行" aria-description="Enter 发送；Shift+Enter 换行" disabled={!input.trim() || !providerId || sending || Boolean(modelReadinessError)}><ArrowUp size={18} /></button>}
      </div>
    </form>
  </>
}

function ReasoningView({ message, readContent }: { message: ConversationMessage; readContent: ContentReader }) {
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
      <Brain size={15} /><strong>推理过程</strong><span className="reasoning-status">{streaming && <i className="conversation-running-dot" />}{status}</span><small>{reasoning.effort ? { low: '低强度', high: '高强度', max: '最高强度' }[reasoning.effort] : '执行器未提供强度'}</small><ChevronDown size={14} className={open ? 'expanded' : ''} />
    </button>
    <div id={`reasoning-${message.id}`} hidden={!open}>
      <div ref={content} className="reasoning-content" onScroll={(event) => { const element = event.currentTarget; follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40 }}>
        {reasoning.text || (streaming ? '已发起请求，等待模型返回推理内容…' : reasoning.status === 'interrupted' ? '本次调用已中断，尚未收到可展示的推理内容。' : '模型未返回可展示的推理内容。')}
      </div>
      {message.contentLengths?.reasoning && <ContentPages field="reasoning" readContent={readContent} />}
      <p className="reasoning-note">模型生成时的推理记录；最终结论以回答为准。</p>
    </div>
  </section>
}

function ConversationMessageView({ message, busy, targetLabel, onAnswer, onNavigate, onPublish, onRetryReview, readContent, memoryAction, flashing = false, revisionLink, onOpenRevisionItem, onReAddChatItem }: {
  message: ConversationMessage; readContent: ContentReader; busy: boolean; targetLabel: string; onAnswer: (answer: string) => void; onNavigate: (action: ConversationAction) => void; onPublish: (acknowledgeUnverified?: boolean) => void; onRetryReview: () => void
  memoryAction?: ReactNode
  flashing?: boolean
  /** Clarify and design drafts: the 「加入修订清单」 state; `none` keeps today's 「保存为节点提案」. */
  revisionLink?: RevisionLink | undefined
  onOpenRevisionItem?: ((link: AddedRevisionLink) => void) | undefined
  onReAddChatItem?: ((link: ReAddRevisionLink) => void) | undefined
}) {
  const [showFull, setShowFull] = useState(false)
  // Saving a proposal first shows where it goes and what is saved (plan W8).
  const [confirmingPublish, setConfirmingPublish] = useState(false)
  const [acknowledgeUnverified, setAcknowledgeUnverified] = useState(false)
  const review = message.draft?.review
  const needsAcknowledgement = Boolean(review && review.status !== 'passed')
  const stale = review?.status === 'stale'
  const reviewCopy = { pending: 'AI 核对待开始', running: 'AI 正在核对', passed: 'AI 核对通过', needs_revision: 'AI 发现待处理问题', unavailable: 'AI 核对未完成', stale: '来源已更新' }
  if (message.reasoning) return <>{message.failure && <p className="meta">{message.text}</p>}<ReasoningView message={message} readContent={readContent} /></>
  if (message.role === 'tool') return <details className="conversation-tool"><summary>{message.text}</summary>{message.citations?.map((source) => <pre key={source.id}>{source.excerpt}</pre>)}</details>
  const link = revisionLink && revisionLink.state !== 'none' ? revisionLink : undefined
  const display = message.role === 'user' ? message.display : undefined
  return <article id={`message-${message.id}`} className={`conversation-message conversation-message--${message.role}${flashing ? ' is-flashing' : ''}`}>
    <span className="message-author">{message.role === 'user' ? '你' : 'DevFlow'}</span>
    {display ? <>
      {display.references.map((line, index) => <p className="conversation-reference-line" key={`${index}-${line}`}>引用：{line}</p>)}
      <ConversationBody message={{ ...message, text: display.text }} />
      <button type="button" className="text-button" aria-expanded={showFull} onClick={() => setShowFull(!showFull)}>发送给助手的完整内容</button>
      {showFull && <div className="message-plain">{message.text}</div>}
    </> : <ConversationBody message={message} />}
    {memoryAction}
    {message.contentLengths?.text && <ContentPages field="text" readContent={readContent} />}
    {message.question && <div className="conversation-question"><span className="meta">{message.question.resolvedBy === 'proposal_saved' ? '已保存提案' : message.question.answeredAt ? '已收到后续回复' : '需要你补充'}</span><strong>{message.question.prompt}</strong>
      {!message.question.answeredAt && <><div className="question-options">{message.question.options.map((option) => <button className="ghost-button" key={option} disabled={busy} onClick={() => onAnswer(option)}>{option}</button>)}</div><button className="text-button" disabled={busy} onClick={() => onAnswer('')}>输入回答</button><small>点击选项填入输入框，也可以直接输入自己的回答。</small></>}
    </div>}
    {!!message.actions?.length && <div className="conversation-actions">{message.actions.map((action, index) => <button className="ghost-button" key={`${action.runId}-${action.nodeId}-${index}`} onClick={() => onNavigate(action)}>{action.label} ↗</button>)}</div>}
    {message.draft && <div className="conversation-proposal"><span className="pill soft">{message.draft.publishedArtifactId ? '已保存 · 待确认' : '仅本会话草稿'}</span><ProposalBody title={message.draft.title} content={message.draft.content} />{message.contentLengths?.draft && <ContentPages field="draft" readContent={readContent} />}<p className="meta">目标：{targetLabel}。保存后其他会话可以查询；仍需在节点形成正式产物。</p>
      {review && <div className="conversation-proposal-review" role="status"><strong>{reviewCopy[review.status]}</strong>{review.error && <p>{review.error}</p>}
        {review.findings?.filter(item => item.status !== 'covered').map(item => <p key={item.criterionId}>{item.reason}</p>)}
        {!message.draft.publishedArtifactId && !stale && review.status !== 'passed' && <><p>可以重新核对，或阅读提案后明确确认，保存为尚未通过 AI 核对的待评审提案。</p><button className="ghost-button" type="button" disabled={busy} onClick={onRetryReview}>重新核对提案</button><small>重新核对会调用模型，可能产生费用。</small></>}
      </div>}
      {message.draft.inputReceipt && message.draft.inputReceipt.coverage.length > 0 && <details><summary>正文与验收覆盖 · {message.draft.inputReceipt.coverage.length} 项</summary><p className="meta">关键正文已完整送达本次模型调用。以下是模型给出的对应关系，请核对含义是否准确。</p>{message.draft.inputReceipt.coverage.map((row) => <div key={row.criterionId}><blockquote>{row.sourceQuote}</blockquote><p>提案对应：{row.proposalQuote}</p></div>)}</details>}
      {link ? <RevisionLinkControl link={link} busy={busy} stale={stale} needsAcknowledgement={needsAcknowledgement} onPublish={onPublish}
        onOpen={(added) => onOpenRevisionItem?.(added)} onReAdd={(readd) => onReAddChatItem?.(readd)} />
      : message.draft.publishedArtifactId ? (
        <p className="meta" role="status" data-testid="proposal-saved-note">提案已保存，尚未更新正式需求；流程不会推进。它在目标步骤的「材料与版本」中标为「讨论提案（待确认）」。</p>
      ) : confirmingPublish ? (
        <div className="conversation-publish-preview" role="group" aria-label="保存提案前确认" data-testid="proposal-publish-preview">
          <p>将保存到：<strong>{targetLabel}</strong></p>
          <p>保存内容：上方「{message.draft.title}」全文，作为「讨论提案（待确认）」。保存后其他会话可以查询；不会更新正式需求，也不会推进流程。</p>
          {needsAcknowledgement && <label><input type="checkbox" checked={acknowledgeUnverified} onChange={event => setAcknowledgeUnverified(event.target.checked)} />我已阅读提案和核对状态，确认按尚未通过 AI 核对的待评审提案保存。</label>}
          <div className="inspector-actions">
            <button className="primary-button" type="button" disabled={busy || stale || (needsAcknowledgement && !acknowledgeUnverified)} onClick={() => { setConfirmingPublish(false); onPublish(needsAcknowledgement && acknowledgeUnverified) }}>确认保存提案</button>
            <button className="text-button" type="button" onClick={() => setConfirmingPublish(false)}>取消</button>
          </div>
        </div>
      ) : (
        <button className="ghost-button" type="button" disabled={busy || stale} onClick={() => setConfirmingPublish(true)}>保存为节点提案</button>
      )}
    </div>}
    {!!message.citations?.length && <details className="conversation-sources"><summary>查询依据 · {message.citations.length}</summary>{message.citations.map((citation) => <div key={citation.id}><strong>{citation.label}</strong><small>读取于 {new Date(citation.observedAt).toLocaleString()}</small><pre>{citation.excerpt}</pre></div>)}</details>}
  </article>
}


/** The chat answer's 「加入修订清单」 (design §5.10 rows 1–8); saving still goes through `publish`. */
function RevisionLinkControl({ link, busy, stale, needsAcknowledgement, onPublish, onOpen, onReAdd }: {
  link: Exclude<RevisionLink, { state: 'none' }>; busy: boolean; stale: boolean; needsAcknowledgement: boolean
  onPublish: (acknowledgeUnverified?: boolean) => void; onOpen: (link: AddedRevisionLink) => void; onReAdd: (link: ReAddRevisionLink) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  if (link.state === 'written' || link.state === 'submitted' || link.state === 'saved') return <p className="meta" role="status" data-testid="revision-link-status">{link.text}</p>
  if (link.state === 'disabled') return <div className="conversation-revision-link" data-testid="revision-link"><button type="button" className="ghost-button" disabled>{link.label}</button><p className="meta">{link.reason}</p></div>
  if (link.state === 'added') return <div className="conversation-revision-link" data-testid="revision-link"><button type="button" className="ghost-button" onClick={() => onOpen(link)}>{link.text}</button></div>
  if (link.state === 'readd') return <div className="conversation-revision-link" data-testid="revision-link"><button type="button" className="ghost-button" disabled={busy} onClick={() => onReAdd(link)}>{link.label}</button></div>
  if (!confirming) return <div className="conversation-revision-link" data-testid="revision-link"><button type="button" className="ghost-button" disabled={busy || stale} onClick={() => setConfirming(true)}>{link.label}</button></div>
  return <div className="conversation-publish-preview" role="group" aria-label="保存提案前确认" data-testid="proposal-publish-preview">
    <p>{link.preview}</p>
    {needsAcknowledgement && <label><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />我已阅读提案和核对状态，确认按尚未通过 AI 核对的待评审提案保存。</label>}
    <div className="inspector-actions">
      <button className="primary-button" type="button" disabled={busy || stale || (needsAcknowledgement && !acknowledged)} onClick={() => { setConfirming(false); onPublish(needsAcknowledgement && acknowledged) }}>确认保存提案</button>
      <button className="text-button" type="button" onClick={() => setConfirming(false)}>取消</button>
    </div>
  </div>
}

type ContentReader = (field: 'text' | 'draft' | 'reasoning', offset: number) => Promise<import('../electron/workbench-conversation-contract').ConversationResponse['contentPage']>
function ContentPages({ field, readContent }: { field: 'text' | 'draft' | 'reasoning'; readContent: ContentReader }) {
  const [page, setPage] = useState<Awaited<ReturnType<ContentReader>>>()
  const [loading, setLoading] = useState(false)
  async function read(offset: number) { setLoading(true); try { setPage(await readContent(field, offset)) } finally { setLoading(false) } }
  return <details className="conversation-content-pages"><summary onClick={() => { if (!page && !loading) void read(0) }}>预览已省略部分内容 · 分页阅读完整原文</summary>
    {page && <><p>{page.offset + 1}–{page.offset + page.text.length} / {page.total} 字符</p><pre>{page.text}</pre><button disabled={loading || page.offset === 0} onClick={() => void read(Math.max(0, page.offset - 16_384))}>上一页</button><button disabled={loading || page.nextOffset === null} onClick={() => { if (page.nextOffset !== null) void read(page.nextOffset) }}>下一页</button></>}
  </details>
}
