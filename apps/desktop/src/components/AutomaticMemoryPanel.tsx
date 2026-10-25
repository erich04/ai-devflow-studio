import { useEffect, useRef, useState } from 'react'
import type { AutomaticMemoryDecision, AutomaticMemoryStatus } from '@ai-devflow/shared'
import type { DevFlowDesktopApi } from '../desktop-api'

type Api = Pick<DevFlowDesktopApi, 'getAutomaticMemoryStatus' | 'configureAutomaticMemory' | 'processAutomaticMemory' | 'resolveAutomaticMemoryDecision'>
const pendingStatuses = new Set(['queued', 'submitted', 'remote_processing', 'extracted'])

export function AutomaticMemoryPanel({ projectId, api, onMemoriesChanged }: {
  projectId: string; api: Api; onMemoriesChanged?: () => void
}) {
  const [status, setStatus] = useState<AutomaticMemoryStatus | null>(null)
  const [consent, setConsent] = useState(false)
  const [limit, setLimit] = useState(20)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const lastSaved = useRef('')
  const changed = useRef(onMemoriesChanged)
  changed.current = onMemoriesChanged

  function apply(next: AutomaticMemoryStatus, version: number) {
    if (generation.current !== version) return
    if (next.projectId !== projectId) throw new Error('自动记忆返回了其他项目的数据，请重新读取。')
    setStatus(next)
    const saved = next.decisions.filter((item) => item.resolution === 'saved').map((item) => `${item.id}:${item.memoryId}`).sort().join('|')
    if (saved !== lastSaved.current) { lastSaved.current = saved; changed.current?.() }
  }

  useEffect(() => {
    const version = ++generation.current
    setStatus(null); setConsent(false); setLimit(20); setBusy(false); setError(''); lastSaved.current = ''
    let polling = false
    async function read(initial: boolean) {
      if (!api.getAutomaticMemoryStatus || polling) return
      polling = true
      try {
        const next = await api.getAutomaticMemoryStatus({ projectId })
        apply(next, version)
        if (initial && version === generation.current) setLimit(next.configuration?.maxRetainsPerDay ?? 20)
      } catch { if (version === generation.current) setError('无法读取自动记忆状态；已有记忆仍可使用。') }
      finally { polling = false }
    }
    void read(true)
    const timer = window.setInterval(() => { if (document.visibilityState !== 'hidden') void read(false) }, 5_000)
    return () => { generation.current += 1; window.clearInterval(timer) }
  }, [api, projectId])

  if (!api.getAutomaticMemoryStatus || !api.configureAutomaticMemory || !api.processAutomaticMemory || !api.resolveAutomaticMemoryDecision) return null

  async function action(operation: () => Promise<AutomaticMemoryStatus>) {
    const version = generation.current
    setBusy(true); setError('')
    try { apply(await operation(), version) }
    catch { if (version === generation.current) setError('操作未完成或来源已变化，请刷新后检查；不会覆盖未确认的记忆。') }
    finally { if (version === generation.current) setBusy(false) }
  }

  function resolve(decision: AutomaticMemoryDecision, choice: 'approve' | 'ignore') {
    const target = decision.conflictsWith?.[0]
    if (choice === 'approve' && (decision.disposition !== 'conflict' || decision.conflictsWith?.length !== 1 || !target)) return
    void action(() => api.resolveAutomaticMemoryDecision!({
      projectId, decisionId: decision.id, action: choice,
      ...(choice === 'approve' && target ? { targetMemoryId: target.memoryId, expectedRevision: target.revision } : {}),
    }))
  }

  const enabled = status?.configuration?.enabled ?? false
  const decisions = status?.decisions.filter((item) => !item.resolution && ['rule_candidate', 'conflict'].includes(item.disposition)) ?? []
  const pending = status?.jobs.filter((item) => pendingStatuses.has(item.status)).length ?? 0
  const failed = status?.jobs.filter((item) => item.status === 'retryable_failure').length ?? 0
  const cleanup = status?.jobs.filter((item) => item.status === 'cleanup_pending').length ?? 0
  const saved = status?.decisions.filter((item) => item.resolution === 'saved').length ?? 0
  const invalidLimit = !Number.isInteger(limit) || limit < 1 || limit > 100

  return <section className="agent-evidence-card" aria-label="自动积累经验">
    <div className="section-heading"><strong>自动积累经验</strong><span className="pill">{enabled ? '已启用' : '默认关闭'}</span></div>
    <p>启用一次后，聊天回合、编码验证和阶段完成时会在后台提取一般经验。普通经验自动保存；业务规则和冲突集中处理。</p>
    <p>来源中的公开消息及有界工具、阶段结果会发送到已配置的 Hindsight 服务及其模型提供方。隐藏推理不作为学习材料。</p>
    <p>服务：{status?.endpoint ?? '尚未配置 Hindsight'}。模型提供方由该服务配置；本机服务也可能调用远程模型。</p>
    {status?.unavailableReason && <p role="status">{status.unavailableReason}</p>}
    <details>
      <summary>项目自动记忆设置</summary>
      <label>每日最多提取事件数<input type="number" min={1} max={100} aria-label="每日最多提取事件数" value={limit} disabled={busy} onChange={(event) => setLimit(Number(event.target.value))} /></label>
      <p className="empty-note">1–100 次；这是调用次数上限，不是金额保证。需要在 Hindsight 模型提供方设置费用限制。只处理启用后的来源，不自动补传旧历史。</p>
      <label><input type="checkbox" checked={consent} disabled={busy} onChange={(event) => setConsent(event.target.checked)} />允许此项目将上述会话及阶段来源发送至 Hindsight 和其模型，并自动保存一般经验</label>
      <div className="button-row">
        <button type="button" disabled={busy || !status || !status.endpoint || !consent || invalidLimit || Boolean(status.unavailableReason)}
          onClick={() => void action(() => api.configureAutomaticMemory!({ projectId, enabled: true, consent: true, maxRetainsPerDay: limit }))}>
          {enabled ? '更新自动记忆设置' : '启用自动积累'}
        </button>
        {enabled && <button type="button" disabled={busy} onClick={() => void action(() => api.configureAutomaticMemory!({ projectId, enabled: false, consent: false, maxRetainsPerDay: status!.configuration!.maxRetainsPerDay }))}>关闭自动积累</button>}
      </div>
      <p className="empty-note">关闭后停止新采集，已有正式记忆保留；已发送任务仍会对账、清理。删除记忆请使用下方生命周期操作。</p>
    </details>
    {status && <>
      <p role="status">自动保存 {saved} 条 · 等待处理 {pending} 个事件 · 待确认 {decisions.length} 条 · 重试 {failed} · 远端清理中 {cleanup}</p>
      <button type="button" className="ghost-button" disabled={busy} onClick={() => void action(() => api.processAutomaticMemory!({ projectId }))}>刷新并继续后台处理</button>
    </>}
    {decisions.map((decision) => <article className="agent-evidence-card" key={decision.id} aria-label={decision.disposition === 'rule_candidate' ? '业务规则候选' : '记忆冲突'}>
      <strong>{decision.disposition === 'rule_candidate' ? '业务规则候选 · 尚未生效' : '记忆冲突 · 原版本继续有效'}</strong>
      {decision.disposition === 'conflict' && decision.conflictsWith?.map((prior) => <div key={prior.memoryId}>
        <span>原内容（修订 {prior.revision}）</span><blockquote>{prior.statement}</blockquote>
      </div>)}
      <span>{decision.disposition === 'conflict' ? '新内容' : '候选内容'}</span><blockquote>{decision.statement}</blockquote>
      <p className="empty-note">{decision.reason}</p>
      <details><summary>学习来源</summary><p>事件 {decision.eventId}</p><p>来源片段 {decision.evidenceMaterialIds.join('、') || '待核实'}</p></details>
      {decision.disposition === 'rule_candidate'
        ? <p>请在对应需求、设计或验收阶段形成正式提案并审批。此处不能把业务规则批准为长期经验。</p>
        : <p>确认后替换所展示的旧版本；不会同时保留两条互相矛盾的有效记忆。</p>}
      <div className="button-row">
        {decision.disposition === 'conflict' && decision.conflictsWith?.length === 1 && <button type="button" disabled={busy} onClick={() => resolve(decision, 'approve')}>确认采用新内容</button>}
        {decision.disposition === 'conflict' && decision.conflictsWith?.length !== 1 && <p>涉及多个或已变化的版本，请在生命周期中逐条核实和纠正。</p>}
        <button type="button" className="ghost-button" disabled={busy} onClick={() => resolve(decision, 'ignore')}>忽略此建议</button>
      </div>
    </article>)}
    {error && <p className="error-note" role="alert">{error}</p>}
  </section>
}
