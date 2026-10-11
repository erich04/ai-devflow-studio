import { useCallback, useEffect, useState } from 'react'
import type { CodingHarnessCommand, CodingHarnessSnapshot, CodingHarnessStatus, CodingHarnessDetail } from '@ai-devflow/shared'
import type { DevFlowDesktopApi } from '../desktop-api'

type Action<T> = T extends CodingHarnessCommand ? Omit<T, 'protocolVersion' | 'codingRunId' | 'commandId' | 'expectedVersion'> : never
const labels: Record<CodingHarnessStatus, string> = { ready: '准备继续', running: '正在调查与实现', waiting_input: '等待你的回答', waiting_task: '等待子任务（可在下方回答其问题）', waiting_permission: '等待执行授权', review: '等待最终改动审查', paused: '已暂停', reconciling: '需要核对中断的操作', applying: '正在应用已批准修订', verifying: '正在独立验证', completed: '技术验证完成', cancelled: '已取消', failed: '执行失败', delivery_conflict: '交付内容有冲突' }

export function NativeCodingHarnessPanel({ codingRunId, api }: { codingRunId: string; api: Pick<DevFlowDesktopApi, 'codingHarness' | 'onCodingHarnessUpdated'> }) {
  const [snapshot, setSnapshot] = useState<CodingHarnessSnapshot | null>(null), [text, setText] = useState(''), [error, setError] = useState(''), [pending, setPending] = useState(0)
  const [confirmedCriteria, setConfirmedCriteria] = useState<string[]>([])
  const [manualMode, setManualMode] = useState(false), [manualPlan, setManualPlan] = useState(''), [manualEvidence, setManualEvidence] = useState('')
  const busy = pending > 0
  useEffect(() => { setConfirmedCriteria([]); setManualEvidence('') }, [snapshot?.revision?.digest])
  const [profile, setProfile] = useState<'trusted_local' | 'container'>('trusted_local')
  const accept = useCallback((next: CodingHarnessSnapshot) => setSnapshot(previous => previous?.codingRunId === next.codingRunId && previous.version > next.version ? previous : next), [])
  const refresh = useCallback(async () => {
    if (!api.codingHarness) return
    try { accept(await api.codingHarness({ protocolVersion: 2, type: 'get', codingRunId })) } catch (failure) { setError(failure instanceof Error ? failure.message : '无法读取任务') }
  }, [api, codingRunId, accept])
  useEffect(() => {
    setSnapshot(null); setError(''); void refresh()
    const unsubscribe = api.onCodingHarnessUpdated?.(id => { if (id === codingRunId) void refresh() })
    return () => unsubscribe?.()
  }, [api, codingRunId, refresh])
  const command = async (action: Action<CodingHarnessCommand>) => {
    if (!snapshot || !api.codingHarness || (busy && !['cancel', 'pause', 'steer'].includes(action.type))) return
    setPending(value => value + 1); setError('')
    try {
      const input = { protocolVersion: 2, codingRunId, commandId: crypto.randomUUID(), expectedVersion: snapshot.version, ...action } as CodingHarnessCommand
      accept(await api.codingHarness(input)); if (action.type === 'reply' || action.type === 'steer') setText('')
    } catch (failure) { setError(failure instanceof Error ? failure.message : '操作未完成'); await refresh() }
    finally { setPending(value => value - 1) }
  }
  const page = async (kind: 'historyOffset' | 'revisionOffset', offset: number | null) => {
    if (offset === null || !api.codingHarness) return
    try { accept(await api.codingHarness({ protocolVersion: 2, codingRunId, type: 'get', [kind]: offset })) } catch (failure) { setError(String(failure)) }
  }
  const detail = async (value: CodingHarnessDetail) => {
    if (!api.codingHarness) return
    const { kind, id, offset, revisionDigest } = value
    try { accept(await api.codingHarness({ protocolVersion: 2, codingRunId, type: 'get', ...(snapshot?.historyPage ? { historyOffset: snapshot.historyPage.offset } : {}), ...(snapshot?.revisionPage ? { revisionOffset: snapshot.revisionPage.offset } : {}), detail: { kind, id, offset, ...(revisionDigest ? { revisionDigest } : {}) } })) } catch (failure) { setError(String(failure)) }
  }
  if (!snapshot) return <div aria-live="polite">{error || '正在读取 Native 任务…'}</div>
  const finished = ['completed', 'cancelled', 'failed'].includes(snapshot.status)
  return <section className="agent-evidence-card native-coding-harness" aria-label="Native 多轮任务">
    <div className="section-heading"><strong>Native v3 · {snapshot.status === 'completed' && snapshot.manualValidationPlan ? '人工验收完成（无自动测试）' : labels[snapshot.status]}</strong><span>{snapshot.steps} 轮 · 活跃 {Math.ceil(snapshot.activeMilliseconds / 1000)} 秒</span></div>
    {error ? <p role="alert">{error}</p> : null}
    {snapshot.pauseReason ? <p>{snapshot.pauseReason}</p> : null}
    <p className="meta">输入 {snapshot.cost.inputTokens ?? '未知'} / 输出 {snapshot.cost.outputTokens ?? '未知'} tokens · 费用 {snapshot.cost.costUsd === null ? '待权威账本核定' : `$${snapshot.cost.costUsd.toFixed(4)}`} · {snapshot.cost.pendingSettlements} 笔待结算 · {snapshot.cost.unknownAttempts} 笔用量待核对</p>
    {snapshot.cost.costUsd === null && snapshot.cost.knownCostUsd !== undefined ? <p>已确认费用小计 ${snapshot.cost.knownCostUsd.toFixed(4)}；另有 {snapshot.cost.unknownCostCount} 笔金额未确认。</p> : null}
    {snapshot.status === 'waiting_permission' && !snapshot.permission ? <div className="coding-permission-card">
      <h4>允许这次任务在候选目录中工作</h4>
      <p>基线：{snapshot.execution?.baseline}。授权搜索、读取、编辑候选文件，以及运行下面保存的测试；可委派最多 3 个并行子任务，子任务费用计入总额度，编码子任务使用独立候选目录。最终改动另行批准。</p>
      <p>本任务总上限：{snapshot.execution?.maxTokens ?? '未知'} tokens / ${snapshot.execution?.maxCostUsd ?? '未知'}；子任务和上下文压缩共用此额度。</p>
      <p>输入快照包含当前目录中的源文件与新增文件，依赖和缓存目录排除。摘要：{snapshot.execution?.inputDigest}</p>
      {snapshot.execution?.dirtyPaths?.length ? <details open><summary>这次一并纳入的现有改动（授权即确认此输入）</summary><pre>{snapshot.execution.dirtyPaths.join('\n')}</pre></details> : null}
      <label><input type="checkbox" checked={manualMode} onChange={event => setManualMode(event.target.checked)} />本任务没有适用的自动测试，事先选择人工验收</label>
      {manualMode ? <label>人工验收计划<textarea aria-label="人工验收计划" value={manualPlan} onChange={event => setManualPlan(event.target.value)} /><small>写明检查步骤与预期结果。最终需填写实际检查依据；不会产生自动测试通过记录，工作流的测试门禁仍保留。</small></label> : <pre>{snapshot.execution?.testCommand || '尚无自动测试命令；请选择明确的人工验收计划。'}</pre>}
      {snapshot.execution?.dependencyCommand ? <p>依赖准备（可能联网并运行安装脚本）：<code>{snapshot.execution.dependencyCommand}</code>。候选和最终验证各自安装。</p> : null}
      <label>命令执行方式 <select value={profile} onChange={event => setProfile(event.target.value as typeof profile)}>
        {snapshot.execution?.profiles.map(item => <option key={item.kind} value={item.kind} disabled={!item.available}>{item.kind === 'trusted_local' ? '本机可信执行' : '受管容器'}</option>)}
      </select></label>
      <p>{snapshot.execution?.profiles.find(item => item.kind === profile)?.reason}</p>
      <button disabled={busy || (manualMode ? !manualPlan.trim() : !snapshot.execution?.testCommand.trim())} onClick={() => void command({ type: 'authorize', profile, ...(manualMode ? { manualValidationPlan: manualPlan } : {}) })}>授权并开始</button>
    </div> : null}
    {snapshot.permission ? <div className="coding-permission-card"><h4>{snapshot.permission.title}</h4><pre>{snapshot.permission.details}</pre>
      <button disabled={busy} onClick={() => void command({ type: 'permission', permissionId: snapshot.permission!.id, decision: 'approved' })}>允许这次操作</button>
      <button disabled={busy} onClick={() => void command({ type: 'permission', permissionId: snapshot.permission!.id, decision: 'rejected' })}>拒绝</button>
    </div> : null}
    {snapshot.question ? <div className="agent-evidence-card"><h4>需要你的回答</h4><p>{snapshot.question.text}</p>
      {snapshot.question.options.map(option => <button key={option} disabled={busy} onClick={() => setText(option)}>{option}</button>)}
    </div> : null}
    {snapshot.revision ? <div className="coding-changeset-review"><h4>候选修订：{snapshot.revision.summary}</h4><p className="meta">{snapshot.revision.digest}</p>
      {snapshot.revision.files.length ? snapshot.revision.files.map(file => <details key={file.path}><summary>{file.kind} · {file.sourcePath ? `${file.sourcePath} → ` : ''}{file.path}{file.binary ? ' · 二进制' : ''}</summary><pre>{file.diff}</pre>{file.truncated ? <button onClick={() => void detail({ kind: 'diff', id: file.path, revisionDigest: snapshot.revision!.digest, offset: 0 })}>改动较长，逐页查看全文</button> : null}</details>) : <p>无需代码变更，仍需批准并运行验证。</p>}
      {snapshot.status === 'review' && !snapshot.parent ? <div>
        {snapshot.acceptance?.length ? <fieldset><legend>核对已确认需求中的验收条目</legend>{snapshot.acceptance.map(criterion => <label key={criterion.id}><input type="checkbox" checked={confirmedCriteria.includes(criterion.id)} onChange={event => setConfirmedCriteria(current => event.target.checked ? [...current, criterion.id] : current.filter(id => id !== criterion.id))} />{criterion.text}<small>来源：{criterion.sourceRef}</small></label>)}</fieldset> : <p>未结构化验收：自动测试之外的业务正确性仍需后续人工验收门禁确认。</p>}
        {snapshot.manualValidationPlan ? <div><p>事先选定的人工验收计划：{snapshot.manualValidationPlan}</p><label>实际人工检查依据<textarea aria-label="实际人工检查依据" value={manualEvidence} onChange={event => setManualEvidence(event.target.value)} /></label><p>确认你已检查这份冻结修订；宿主仍会核对交付字节，不会运行或伪造自动测试。</p></div> : null}
        <button disabled={busy || (snapshot.acceptance?.length ?? 0) !== confirmedCriteria.length || Boolean(snapshot.manualValidationPlan && !manualEvidence.trim())} onClick={() => void command({ type: 'approve', revisionDigest: snapshot.revision!.digest, objectiveVersion: snapshot.objectiveVersion, confirmedCriteria, ...(snapshot.manualValidationPlan ? { manualValidationEvidence: manualEvidence } : {}) })}>{snapshot.manualValidationPlan ? '确认人工验收并批准' : '批准最终改动'}</button>
        <button disabled={busy} onClick={() => void command({ type: 'reject', revisionDigest: snapshot.revision!.digest, objectiveVersion: snapshot.objectiveVersion })}>退回继续改进</button>
      </div> : null}
      {snapshot.revisionPage && snapshot.revisionPage.total > 30 ? <p>文件 {snapshot.revisionPage.offset + 1}–{snapshot.revisionPage.offset + snapshot.revision.files.length} / {snapshot.revisionPage.total} <button disabled={snapshot.revisionPage.previous === null} onClick={() => void page('revisionOffset', snapshot.revisionPage!.previous)}>上一页文件</button><button disabled={snapshot.revisionPage.next === null} onClick={() => void page('revisionOffset', snapshot.revisionPage!.next)}>下一页文件</button></p> : null}
    </div> : null}
    {snapshot.evidence.map(evidence => <p key={evidence.id}>{evidence.status} · {evidence.summary}</p>)}
    {snapshot.children.map(child => <details key={child.id}><summary>{child.title} · {child.status}</summary><NativeCodingHarnessPanel codingRunId={child.id} api={api} /></details>)}
    {snapshot.diagnostics ? <details><summary>恢复诊断与资料保留</summary><p>检查点 {snapshot.diagnostics.checkpoint} · 目标版本 {snapshot.diagnostics.objectiveVersion} · {snapshot.diagnostics.profile === 'container' ? '受管容器' : '本机可信执行'} · {snapshot.diagnostics.writerActive ? '执行单元尚未退出' : '当前无执行单元'}</p><p>未确定操作：{snapshot.diagnostics.uncertainTotal}。未知请求不会自动重发，未知工具效果须先对账。</p>{snapshot.diagnostics.uncertainOperations.map(item => <p key={item.id}>{item.kind} · {item.id} · {item.status}</p>)}<p>{snapshot.storage?.reason}</p>{snapshot.storage?.cleanupAllowed ? <button disabled={busy} onClick={() => void command({ type: 'cleanup_scratch' })}>清理可重建工作副本，保留全部证据</button> : null}</details> : null}
    <details><summary>任务对话与工具记录（{snapshot.historyPage?.total ?? snapshot.messages.length}）</summary>{snapshot.messages.map(message => <div key={message.id}><strong>{message.role === 'user' ? '你' : message.role === 'assistant' ? 'Native' : '工具结果'}</strong><pre>{message.text}</pre>{message.truncated ? <button onClick={() => void detail({ kind: 'message', id: message.id, offset: 0 })}>记录较长，逐页查看全文</button> : null}</div>)}
      {snapshot.historyPage ? <p><button disabled={snapshot.historyPage.previous === null} onClick={() => void page('historyOffset', snapshot.historyPage!.previous)}>更早记录</button><button disabled={snapshot.historyPage.next === null} onClick={() => void page('historyOffset', snapshot.historyPage!.next)}>后续记录</button></p> : null}
    </details>
    {snapshot.detail ? <section aria-label="完整内容分页"><h4>{snapshot.detail.kind === 'diff' ? '改动全文' : '记录全文'} · {snapshot.detail.id}</h4><pre>{snapshot.detail.text}</pre><p>字符 {snapshot.detail.offset}–{snapshot.detail.offset + snapshot.detail.text.length} / {snapshot.detail.total}</p><button disabled={snapshot.detail.previous === null} onClick={() => void detail({ ...snapshot.detail!, offset: snapshot.detail!.previous! })}>上页内容</button><button disabled={snapshot.detail.next === null} onClick={() => void detail({ ...snapshot.detail!, offset: snapshot.detail!.next! })}>下页内容</button></section> : null}
    {!finished ? <>
      <label>补充说明或回答<textarea aria-label="补充说明或回答" value={text} onChange={event => setText(event.target.value)} /></label>
      {snapshot.status === 'reconciling' && snapshot.pauseReason === 'model_delivery_unknown' ? <p>上一次请求可能已经产生费用，无法确认是否收到完整结果。<button disabled={busy} onClick={() => void command({ type: 'retry_unknown' })}>知情授权一次新请求（可能重复计费）</button></p> : null}
      {snapshot.status === 'paused' && snapshot.pauseReason === 'task_limit' && snapshot.limits && !snapshot.parent ? <p>金额与 token 总额度保持原授权。<button disabled={busy} onClick={() => void command({ type: 'extend_limits', maxSteps: Math.min(10000, snapshot.limits!.maxSteps + 40), maxActiveMilliseconds: Math.min(24 * 60 * 60_000, snapshot.limits!.maxActiveMilliseconds + 30 * 60_000) })}>增加 40 步与 30 分钟</button></p> : null}
      {snapshot.status === 'paused' && snapshot.pauseReason === 'authorization_expired' && !snapshot.parent ? <p>原有工具范围和金额上限不变。<button disabled={busy} onClick={() => void command({ type: 'renew_authorization' })}>续签 24 小时执行授权</button></p> : null}
      <div><button disabled={!text.trim() || (busy && Boolean(snapshot.question))} onClick={() => void command(snapshot.question ? { type: 'reply', questionId: snapshot.question.id, objectiveVersion: snapshot.objectiveVersion, text } : { type: 'steer', text })}>{snapshot.question ? '回答并继续' : '补充任务说明'}</button>
        {snapshot.status === 'paused' ? <button disabled={busy} onClick={() => void command({ type: 'resume' })}>继续</button> : <button disabled={!['running', 'applying', 'verifying'].includes(snapshot.status)} onClick={() => void command({ type: 'pause' })}>暂停</button>}
        <button onClick={() => void command({ type: 'cancel' })}>取消任务</button>
      </div>
    </> : <p>{snapshot.status === 'completed' ? snapshot.manualValidationPlan ? '已保存人工验收依据，未执行自动测试；后续测试与业务门禁仍按工作流规则执行。' : '代码技术验证已完成；业务验收仍由工作流的人工门禁决定。' : '已保留任务记录与恢复证据。'}</p>}
  </section>
}
