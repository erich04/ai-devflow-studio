import { ConversationDialog } from './ConversationDialogs'
import { useEffect, useRef, useState } from 'react'
import type { CodingAgentRun, Role, WorkflowRun, WorkRequest } from '@ai-devflow/shared'
import { taskCenterRows, type TaskCenterRow, type TaskFilter } from './app/task-center'
const tabs: Array<[TaskFilter, string]> = [['all', '全部'], ['unclaimed', '待领取'], ['active', '进行中'], ['attention', '待你处理'], ['completed', '已完成']]
export function TaskCenter({ projectId, runs, requests, role, codingRuns, actorId, paired, loading, error, materializingId, onRefresh, onOpen, onClaim, onDelete, canDelete }: {
  projectId: string; runs: WorkflowRun[]; requests: WorkRequest[]; role?: Role | undefined; paired: boolean; loading: boolean; error: string | null; materializingId: string | null;
  codingRuns?: CodingAgentRun[] | undefined; actorId?: string | undefined;
  onRefresh(): void; onOpen(run: WorkflowRun): void; onClaim(request: WorkRequest): void; onDelete?(run: WorkflowRun): void; canDelete?(run: WorkflowRun): boolean
}) {
  const key = `devflow-task-center:${projectId}`
  const [filter, setFilter] = useState<TaskFilter>(() => { try { const value = JSON.parse(sessionStorage.getItem(key) ?? '{}').filter; return tabs.some(([id]) => id === value) ? value : 'all' } catch { return 'all' } })
  const [search, setSearch] = useState(() => { try { return String(JSON.parse(sessionStorage.getItem(key) ?? '{}').search ?? '') } catch { return '' } })
  const [preview, setPreview] = useState<TaskCenterRow>()
  const [selectedId, setSelectedId] = useState(() => { try { return String(JSON.parse(sessionStorage.getItem(key) ?? '{}').selectedId ?? '') } catch { return '' } })
  const list = useRef<HTMLDivElement>(null)
  const rows = taskCenterRows(runs, requests, role, codingRuns, actorId)
  useEffect(() => { try { list.current?.scrollTo?.(0, Number(JSON.parse(sessionStorage.getItem(key) ?? '{}').scroll) || 0) } catch { /* preference only */ } }, [key])
  const remember = (scroll = list.current?.scrollTop ?? 0) => { try { sessionStorage.setItem(key, JSON.stringify({ filter, search, selectedId, scroll })) } catch { /* preference only */ } }
  useEffect(() => { remember() }, [filter, search, selectedId])
  const select = (row: TaskCenterRow) => { setSelectedId(row.id); try { sessionStorage.setItem(key, JSON.stringify({ filter, search, selectedId: row.id, scroll: list.current?.scrollTop ?? 0 })) } catch { /* preference only */ } }
  const visibleRows = rows.filter(row => (filter === 'all' || row.filter === filter) && (row.title + (row.run?.request ?? row.request?.request ?? '')).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  useEffect(() => {
    const closeMenus = (event: Event) => {
      document.querySelectorAll<HTMLDetailsElement>('.task-center-menu[open]').forEach(menu => {
        if (event instanceof KeyboardEvent ? event.key === 'Escape' : event.target instanceof Node && !menu.contains(event.target)) menu.open = false
      })
    }
    document.addEventListener('pointerdown', closeMenus); document.addEventListener('click', closeMenus); document.addEventListener('keydown', closeMenus)
    return () => { document.removeEventListener('pointerdown', closeMenus); document.removeEventListener('click', closeMenus); document.removeEventListener('keydown', closeMenus) }
  }, [])
  return <section className="task-center" aria-label="任务中心">
    <div className="task-center-heading"><h2>任务中心</h2><button className="ghost-button" disabled={loading} onClick={onRefresh}>刷新任务</button></div>
    <p>{paired ? loading ? '正在读取团队任务…' : error ? '团队任务读取失败，以下保留上次结果。' : '已读取当前项目的团队请求与本地任务。' : '本地项目。连接团队后可在这里领取请求。'}</p>
    {error && <p role="alert">{error}</p>}
    <label className="task-center-search">搜索任务<input type="search" placeholder="搜索标题或需求…" value={search} onChange={event => setSearch(event.target.value)} /></label>
    <div role="tablist" aria-label="任务状态">{tabs.map(([id, label]) => <button key={id} role="tab" aria-selected={id === filter} onClick={() => setFilter(id)}>{label} <span>{id === 'unclaimed' && paired && (loading || error) ? '未知' : rows.filter(row => id === 'all' || row.filter === id).length}</span></button>)}</div>
    <div className="task-center-list" ref={list} onScroll={() => remember()}>
      {visibleRows.map(row => <article key={row.id} className="task-center-row" aria-label={row.title} data-selected={selectedId === row.id}>
        <div><button className="text-button" onClick={() => { select(row); setPreview(row) }}>{row.title}</button><p>{row.source} · {row.status}</p></div>
        <button className="primary-button" aria-label={`${row.action === 'claim' ? '领取任务' : row.action === 'continue' ? '继续任务' : row.action === 'sync' ? '同步任务' : '查看任务'}：${row.title}`} disabled={materializingId !== null || (row.action === 'claim' && (loading || Boolean(error)))} onClick={() => { select(row); if (row.action === 'claim' && row.request) onClaim(row.request); else if ((row.action === 'continue' || row.action === 'delivery') && row.run) onOpen(row.run); else if (row.action === 'sync') onRefresh(); else setPreview(row) }}>{materializingId === row.request?.id ? '处理中…' : row.action === 'claim' ? row.request?.status === 'claim_pending' ? '恢复领取' : '领取并开始' : row.action === 'continue' ? '继续当前步骤' : row.action === 'delivery' ? '查看交付' : row.action === 'sync' ? '同步任务状态' : '查看详情'}</button>
        {row.run && onDelete && <details className="task-center-menu"><summary aria-label={`任务操作：${row.title}`}>更多操作</summary><button disabled={canDelete?.(row.run) === false} onClick={() => onDelete(row.run!)}>删除任务…</button></details>}
      </article>)}
      {!visibleRows.length && !loading && !error && <p>{rows.length ? '没有符合当前筛选的任务。' : '当前项目还没有任务。'}</p>}
    </div>
    {preview && <ConversationDialog title="任务详情" onClose={() => setPreview(undefined)}><h3>{preview.title}</h3><p>{preview.status}</p><pre className="task-center-request">{preview.run?.request ?? preview.request?.request}</pre><p>预览不会领取请求或推进流程。</p><details><summary>技术详情</summary><p>记录：{preview.id}</p>{preview.request && <p>请求：{preview.request.id} · 版本 {preview.request.version}</p>}<p>更新时间：{preview.updatedAt}</p></details>{preview.run && <button onClick={() => { onOpen(preview.run!); setPreview(undefined) }}>打开任务详情</button>}<button onClick={() => setPreview(undefined)}>关闭</button></ConversationDialog>}
  </section>
}
