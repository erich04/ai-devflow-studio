import { useCallback, useEffect, useState } from 'react'
import {
  PROJECT_KNOWLEDGE_PAGES,
  type AgentProviderConfig, type ProjectKnowledgePageId, type ProjectKnowledgePages, type ProjectMemoryDocumentStatus, type ProjectMemoryKind,
  type ProjectMemoryPage, type ProjectMemorySourceKind, type ProjectMemoryStatus,
} from '@ai-devflow/shared'
import { getDesktopApi, type DevFlowDesktopApi } from '../desktop-api'
import { ConversationBody } from '../ConversationBody'

type Api = Pick<DevFlowDesktopApi, 'getProjectMemoryStatus' | 'configureProjectMemory' | 'listProjectMemories' | 'updateProjectMemory' |
  'forgetProjectMemory' | 'forgetProjectMemorySource' | 'clearProjectMemory'> &
  Partial<Pick<DevFlowDesktopApi, 'listAgentProviders' | 'listProjectKnowledgePages' | 'refreshProjectKnowledgePage'>>

const KINDS: Array<{ kind: ProjectMemoryKind; label: string; empty: string }> = [
  { kind: 'observation', label: '观察', empty: '还没有归纳出观察。写入几次讨论或编码记录后会出现。' },
  { kind: 'world', label: '事实', empty: '还没有抽取到项目事实。' },
  { kind: 'experience', label: '经历', empty: '还没有记录 Agent 的经历。' },
]
const SOURCE_LABEL: Record<ProjectMemorySourceKind, string> = { conversation: '讨论', coding_run: '编码记录', artifact: '流程文档', legacy: '旧版记忆', commit: '提交记录' }
const STATUS_LABEL: Record<ProjectMemoryDocumentStatus, string> = {
  queued: '等待写入', submitted: '写入中', retained: '已写入', failed: '写入失败', delete_pending: '正在忘记', deleted: '已忘记',
}
const DEFAULT_ENDPOINT = 'http://127.0.0.1:8890'
const time = (iso: string) => new Date(iso).toLocaleString('zh-CN', { hour12: false })
const message = (reason: unknown, fallback: string) => reason instanceof Error && reason.message ? reason.message.replace(/^Error invoking remote method '[^']+': (Error: )?/u, '') : fallback

/** ADR 0030: one place to switch project memory on or off and to see, edit, delete or clear what it learned. */
export function ProjectMemoryPanel({ projectId, api: injected }: { projectId: string; api?: Api }) {
  const api = injected ?? getDesktopApi()
  const [status, setStatus] = useState<ProjectMemoryStatus>()
  const [providers, setProviders] = useState<AgentProviderConfig[]>([])
  const [endpoint, setEndpoint] = useState(DEFAULT_ENDPOINT)
  const [providerId, setProviderId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [kind, setKind] = useState<ProjectMemoryKind>('observation')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [offset, setOffset] = useState(0)
  const [page, setPage] = useState<ProjectMemoryPage>()
  const [editing, setEditing] = useState<{ id: string; text: string }>()
  const [confirmClear, setConfirmClear] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [listError, setListError] = useState('')
  const [pages, setPages] = useState<ProjectKnowledgePages>()
  const [pageId, setPageId] = useState<ProjectKnowledgePageId>('conventions')
  const [pagesError, setPagesError] = useState('')
  const [pageNotice, setPageNotice] = useState('')

  useEffect(() => {
    let cancelled = false
    setStatus(undefined); setPage(undefined); setError(''); setListError(''); setApiKey(''); setEditing(undefined); setConfirmClear(false)
    setKind('observation'); setSearch(''); setQuery(''); setOffset(0)
    setPages(undefined); setPagesError(''); setPageNotice(''); setPageId('conventions')
    void api?.getProjectMemoryStatus?.({ projectId }).then((value) => {
      if (cancelled) return
      setStatus(value); setEndpoint(value.endpoint || DEFAULT_ENDPOINT)
      if (value.providerId) setProviderId(value.providerId)
    }).catch((reason: unknown) => { if (!cancelled) setError(message(reason, '无法读取项目记忆状态。')) })
    void api?.listAgentProviders?.().then((value) => {
      if (cancelled) return
      const saved = value.filter((provider) => provider.kind !== 'fake' && provider.maskedCredential)
      setProviders(saved)
      setProviderId((current) => current || saved[0]?.id || '')
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [api, projectId])

  const configured = Boolean(status?.configured)
  const loadPage = useCallback(async () => {
    if (!api?.listProjectMemories || !configured) return
    try {
      setListError('')
      setPage(await api.listProjectMemories({ projectId, kind, ...(query ? { query } : {}), ...(offset ? { offset } : {}) }))
    } catch (reason) { setPage(undefined); setListError(message(reason, '无法读取记忆列表。')) }
  }, [api, configured, projectId, kind, query, offset])
  useEffect(() => { void loadPage() }, [loadPage])
  const loadPages = useCallback(async () => {
    if (!api?.listProjectKnowledgePages || !configured) return
    try { setPagesError(''); setPages(await api.listProjectKnowledgePages({ projectId })) }
    catch (reason) { setPages(undefined); setPagesError(message(reason, '无法读取知识页。')) }
  }, [api, configured, projectId])
  useEffect(() => { void loadPages() }, [loadPages])

  if (!api?.getProjectMemoryStatus || !api.configureProjectMemory) return null

  async function act(operation: () => Promise<ProjectMemoryStatus | undefined>, reload = true) {
    setBusy(true); setError('')
    try {
      const next = await operation()
      if (next) { setStatus(next); if (next.providerId) setProviderId(next.providerId) }
      setApiKey(''); setEditing(undefined); setConfirmClear(false)
      if (reload) { await loadPage(); await loadPages() }
    } catch (reason) { setError(message(reason, '项目记忆操作未完成。')) }
    finally { setBusy(false) }
  }
  const configure = (enabled: boolean) => act(() => api.configureProjectMemory!({ projectId, enabled, endpoint, providerId,
    ...(apiKey ? { apiKey } : {}) }))
  const counts = status?.counts ?? {}
  const kindInfo = KINDS.find((item) => item.kind === kind)!
  const pageEnd = page ? page.offset + page.items.length : 0
  const knowledge = pages?.pages.find((item) => item.id === pageId)
  async function refreshKnowledgePage(id: ProjectKnowledgePageId) {
    setBusy(true); setPagesError(''); setPageNotice('')
    try {
      setPages(await api!.refreshProjectKnowledgePage!({ projectId, pageId: id }))
      setPageNotice('已开始整理，通常需要几十秒；完成后点「重新读取」查看。')
    } catch (reason) { setPagesError(message(reason, '知识页没有开始整理。')) }
    finally { setBusy(false) }
  }

  return <section className="card stack project-memory-panel" aria-label="项目记忆">
    <div className="row">
      <strong>项目记忆</strong>
      <span className={`pill ${status?.enabled ? 'good' : 'soft'}`}>{status?.enabled ? '已开启' : configured ? '已关闭' : '未开启'}</span>
    </div>
    <p>DevFlow 自动把讨论、编码记录和已批准的流程文档交给 Hindsight 学习，不需要逐条确认。编码、阶段 Agent、Gate 评审和讨论会带上相关记忆作为背景参考；记忆不能代替审批或测试。</p>
    {status?.unavailableReason && <p className="error-note" role="status">{status.unavailableReason}</p>}

    {status && !status.enabled && <details open={!configured}>
      <summary>{configured ? '重新开启' : '开启设置'}</summary>
      <div className="stack">
        <label className="field"><span>Hindsight 服务地址</span>
          <input className="input" aria-label="Hindsight 服务地址" value={endpoint} disabled={busy} onChange={(event) => setEndpoint(event.target.value)} /></label>
        <label className="field"><span>抽取用的模型 Provider</span>
          <select className="select" aria-label="抽取用的模型 Provider" value={providerId} disabled={busy} onChange={(event) => setProviderId(event.target.value)}>
            {providers.length === 0 && <option value="">请先在设置中保存 Provider</option>}
            {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name} · {provider.model}</option>)}
          </select>
        </label>
        <label className="field"><span>Hindsight API Key（可选）</span>
          <input className="input" aria-label="项目记忆 Hindsight API Key" type="password" autoComplete="new-password" value={apiKey}
            disabled={busy} placeholder="本机服务留空即可" onChange={(event) => setApiKey(event.target.value)} /></label>
        <p className="empty-note">Hindsight 抽取和归纳时的模型调用经本机中继计入团队项目预算，通常每个来源不到 0.1 美分。需要先把本地项目配对到团队项目。</p>
        <div className="project-memory-actions">
          <button type="button" className="primary-button" disabled={busy || !providerId || !endpoint.trim()} onClick={() => void configure(true)}>开启项目记忆</button>
          {!providerId && <span className="project-memory-meta">先在「设置／模型与执行方式」保存一个 Provider。</span>}
        </div>
      </div>
    </details>}
    {status?.enabled && <div className="project-memory-actions">
      <button type="button" className="ghost-button" disabled={busy} onClick={() => void configure(false)}>关闭项目记忆</button>
      <button type="button" className="ghost-button" disabled={busy} onClick={() => setConfirmClear(true)}>清空记忆…</button>
    </div>}
    {confirmClear && <div className="agent-advisory" role="alertdialog" aria-label="确认清空项目记忆">
      <span>清空后，已学到的记忆全部删除，已写入过的讨论和记录不会再写入；之后的新内容照常学习。不能撤销。</span>
      <div className="project-memory-actions">
        <button type="button" className="ghost-button" disabled={busy}
          onClick={() => void act(() => api.clearProjectMemory!({ projectId, confirm: 'clear' }))}>确认清空</button>
        <button type="button" className="ghost-button" disabled={busy} onClick={() => setConfirmClear(false)}>取消</button>
      </div>
    </div>}
    {configured && <p className="project-memory-meta">来源：已写入 {counts.retained ?? 0} · 等待 {(counts.queued ?? 0) + (counts.submitted ?? 0)} · 写入失败 {counts.failed ?? 0} · 已忘记 {(counts.deleted ?? 0) + (counts.delete_pending ?? 0)}</p>}

    {configured && api.listProjectKnowledgePages && <div className="stack" aria-label="知识页">
      <div className="row"><strong>知识页</strong><span className="project-memory-meta">Hindsight 根据记忆自动整理，有新记忆后最多每小时更新一次</span></div>
      <div className="project-memory-actions" role="tablist" aria-label="知识页列表">
        {PROJECT_KNOWLEDGE_PAGES.map((item) => <button key={item.id} type="button" role="tab" aria-selected={pageId === item.id}
          className={pageId === item.id ? 'primary-button' : 'ghost-button'} onClick={() => { setPageId(item.id); setPageNotice('') }}>{item.title}</button>)}
      </div>
      {pagesError && <p className="error-note" role="alert">{pagesError}</p>}
      {knowledge && <article className="agent-evidence-card" aria-label={knowledge.title}>
        {knowledge.content.trim()
          ? <ConversationBody message={{ id: `knowledge-${knowledge.id}`, role: 'assistant', text: knowledge.content, format: 'markdown', createdAt: knowledge.refreshedAt ?? '' }} showFormatToggle={false} />
          : <p className="empty-note">还没有内容。积累了相关记忆后会自动整理；删除或修改记忆后会先清空，再重新整理。</p>}
        <small className="project-memory-meta">{[knowledge.refreshedAt ? `整理于 ${time(knowledge.refreshedAt)}` : '', knowledge.stale ? '有新记忆，稍后更新' : '',
          knowledge.failedAt ? '最近一次整理失败，保留上一版' : ''].filter(Boolean).join(' · ')}</small>
        <div className="project-memory-actions">
          {api.refreshProjectKnowledgePage && <button type="button" className="ghost-button" disabled={busy || !status?.enabled}
            onClick={() => void refreshKnowledgePage(knowledge.id)}>立即整理</button>}
          <button type="button" className="ghost-button" disabled={busy} onClick={() => { setPageNotice(''); void loadPages() }}>重新读取</button>
          <span className="project-memory-meta">整理会调用模型，计入团队预算。</span>
        </div>
        {pageNotice && <p className="project-memory-meta" role="status">{pageNotice}</p>}
      </article>}
      {pages?.unavailableReason && <p className="project-memory-meta">{pages.unavailableReason}</p>}
    </div>}

    {configured && <div className="stack" aria-label="已学到的记忆">
      <div className="project-memory-actions" role="tablist" aria-label="记忆类型">
        {KINDS.map((item) => <button key={item.kind} type="button" role="tab" aria-selected={kind === item.kind}
          className={kind === item.kind ? 'primary-button' : 'ghost-button'} onClick={() => { setKind(item.kind); setOffset(0); setEditing(undefined) }}>{item.label}</button>)}
      </div>
      <form className="project-memory-search" role="search" onSubmit={(event) => { event.preventDefault(); setQuery(search.trim()); setOffset(0) }}>
        <input className="input" aria-label="搜索记忆" type="search" value={search} placeholder="按文字搜索" onChange={(event) => setSearch(event.target.value)} />
        <button type="submit" className="ghost-button">搜索</button>
      </form>
      {listError && <p className="error-note" role="alert">{listError}</p>}
      {page && page.items.length === 0 && <p className="empty-note">{query ? '没有匹配的记忆。' : kindInfo.empty}</p>}
      {page && page.items.length > 0 && <ul className="project-memory-list" aria-label="记忆列表">
        {page.items.map((item) => <li key={item.id} className="agent-evidence-card">
          {editing?.id === item.id ? <>
            <textarea className="input" aria-label="编辑记忆内容" value={editing.text} rows={3} disabled={busy} onChange={(event) => setEditing({ id: item.id, text: event.target.value })} />
            <div className="project-memory-actions">
              <button type="button" className="ghost-button" disabled={busy || !editing.text.trim()}
                onClick={() => void act(() => api.updateProjectMemory!({ projectId, memoryId: item.id, text: editing.text }))}>保存修改</button>
              <button type="button" className="ghost-button" disabled={busy} onClick={() => setEditing(undefined)}>取消</button>
            </div>
          </> : <p>{item.text}</p>}
          <small className="project-memory-meta">{[item.date, item.source ? `${SOURCE_LABEL[item.source.sourceKind]}：${item.source.title}` : '', item.editedAt ? '已手动修改' : '']
            .filter(Boolean).join(' · ')}</small>
          {editing?.id !== item.id && <div className="project-memory-actions">
            <button type="button" className="ghost-button" disabled={busy} onClick={() => setEditing({ id: item.id, text: item.text })}>编辑</button>
            <button type="button" className="ghost-button" disabled={busy}
              onClick={() => void act(() => api.forgetProjectMemory!({ projectId, memoryId: item.id }))}>删除</button>
          </div>}
        </li>)}
      </ul>}
      {page && (page.offset > 0 || pageEnd < page.total) && <div className="project-memory-actions">
        <button type="button" className="ghost-button" disabled={page.offset === 0} onClick={() => setOffset(Math.max(0, page.offset - page.limit))}>上一页</button>
        <span>{page.offset + 1}–{pageEnd} / {page.total}</span>
        <button type="button" className="ghost-button" disabled={pageEnd >= page.total} onClick={() => setOffset(pageEnd)}>下一页</button>
      </div>}
    </div>}

    {status && status.recent.length > 0 && <details>
      <summary>最近的来源（{status.recent.length}）</summary>
      <ul className="project-memory-list" aria-label="最近的记忆来源">
        {status.recent.map((document) => <li key={document.id} className="project-memory-actions">
          <span>{SOURCE_LABEL[document.sourceKind]}：{document.title} · {STATUS_LABEL[document.status]}</span>
          {document.lastError && <small className="project-memory-meta">{document.lastError}</small>}
          {document.status !== 'deleted' && document.status !== 'delete_pending' && <button type="button" className="ghost-button" disabled={busy}
            onClick={() => void act(() => api.forgetProjectMemorySource!({ projectId, documentId: document.id }))}>忘记此来源</button>}
        </li>)}
      </ul>
    </details>}

    {status?.transportAvailable && <details>
      <summary>Hindsight 部署设置</summary>
      <p className="project-memory-meta">
        Hindsight 的模型地址设为 <code>{status.relay.hindsightBaseUrl}</code>，并把 <code>deploy/hindsight/.env</code> 的 <code>DEVFLOW_MEMORY_RELAY_TOKEN</code>
        设为{status.relay.tokenFile ? <> <code>{status.relay.tokenFile}</code> 中的令牌</> : '启动桌面端时使用的同一个令牌'}。
        中继{status.relay.running ? '运行中' : '未运行'}，端口 {status.relay.port}。
      </p>
    </details>}
    {error && <p className="error-note" role="alert">{error}</p>}
  </section>
}
