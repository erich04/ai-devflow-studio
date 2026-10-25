import { useEffect, useState } from 'react'
import type { HindsightStatus } from '@ai-devflow/shared'
import { getDesktopApi, type DevFlowDesktopApi } from '../desktop-api'

type Api = Pick<DevFlowDesktopApi, 'getHindsightStatus' | 'configureHindsight' | 'refreshHindsight' | 'disableHindsight'>
export function HindsightPanel({ projectId, documents, api: injected }: {
  projectId: string; documents: { sourcePath: string; title: string }[]; api?: Api
}) {
  const api = injected ?? getDesktopApi()
  const [status, setStatus] = useState<HindsightStatus>()
  const [endpoint, setEndpoint] = useState('http://127.0.0.1:8888')
  const [apiKey, setApiKey] = useState('')
  const [paths, setPaths] = useState<string[]>([])
  const [enabled, setEnabled] = useState(false)
  const [includeMemories, setIncludeMemories] = useState(false)
  const [pairedConsent, setPairedConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    setStatus(undefined); setError(''); setApiKey(''); setPaths([]); setEnabled(false); setIncludeMemories(false)
    setPairedConsent(false)
    void api?.getHindsightStatus?.({ projectId }).then((value) => {
      if (cancelled) return
      setStatus(value); setEndpoint(value.endpoint); setPaths(value.selectedPaths)
      setEnabled(value.enabled); setIncludeMemories(value.includeMemories)
    }).catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : '无法读取 Hindsight 配置。') })
    return () => { cancelled = true }
  }, [api, projectId])
  if (!api?.getHindsightStatus || !api.configureHindsight || !api.refreshHindsight || !api.disableHindsight) return null
  async function action(operation: () => Promise<HindsightStatus>) {
    setBusy(true); setError('')
    try {
      const next = await operation()
      setStatus(next); setPaths(next.selectedPaths); setEnabled(next.enabled); setIncludeMemories(next.includeMemories); setApiKey('')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Hindsight 操作未完成。') }
    finally { setBusy(false) }
  }
  const allDocuments = [...documents.filter((doc) => !/^(AGENTS|CLAUDE)\.md$/iu.test(doc.sourcePath)),
    ...paths.filter((p) => !documents.some((doc) => doc.sourcePath === p)).map((p) => ({ sourcePath: p, title: `${p}（需核实）` }))]
  return <section className="card stack" aria-label="Hindsight 知识与记忆">
    <div className="section-heading"><strong>Hindsight 知识与记忆</strong><span className="pill">{status?.enabled ? '已选择启用' : '默认关闭'}</span></div>
    <p>{status?.note ?? '读取项目配置…'}</p>
    <p>仅同步你选中的 Git Markdown 和明确启用的私有正式记忆。原文件与本地记忆仍是权威来源；关闭后会停止使用并排队清理远端投影。</p>
    <details>
      <summary>配置来源与模型</summary>
      <div className="stack">
        <p>先在当前知识目录提交 <code>model.json</code>，定义 <code>sem_</code> 抽取标签。最多选择 20 份文档；源文件和模型变化会重新核验。</p>
        <label>Hindsight 服务地址<input aria-label="Hindsight 服务地址" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} disabled={busy} /></label>
        <label>Hindsight API Key<input aria-label="Hindsight API Key" type="password" autoComplete="new-password"
          value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="留空保留已有密钥" disabled={busy} /></label>
        <fieldset disabled={busy}><legend>选择知识文档（{paths.length}/20）</legend>
          {allDocuments.map((doc) => <label key={doc.sourcePath} className="checkbox-label">
            <input type="checkbox" aria-label={doc.title} checked={paths.includes(doc.sourcePath)}
              disabled={!paths.includes(doc.sourcePath) && paths.length >= 20}
              onChange={(e) => setPaths(e.target.checked ? [...paths, doc.sourcePath] : paths.filter((p) => p !== doc.sourcePath))} />
            {doc.title} <small>{doc.sourcePath}</small>
          </label>)}
          {allDocuments.length === 0 && <p>知识目录暂无可选文档。</p>}
        </fieldset>
        <label><input type="checkbox" checked={includeMemories} disabled={busy || status?.pairedProject} onChange={(e) => setIncludeMemories(e.target.checked)} />加入已晋升的本人项目私有记忆（影子评估）</label>
        <label><input type="checkbox" checked={enabled} disabled={busy} onChange={(e) => setEnabled(e.target.checked)} />允许此项目同步以上来源及脱敏搜索查询</label>
        {status?.pairedProject && <label><input type="checkbox" checked={pairedConsent} disabled={busy} onChange={(e) => setPairedConsent(e.target.checked)} />
          授权当前配对身份使用本机私有知识：选中文档发送到上述 Hindsight 服务，核验后的摘录进入需求、评审、设计和编码模型提示；此配置不向团队共享知识。
        </label>}
        <p>本机服务可能使用远程抽取、Embedding 或重排模型。启用网络试点前需确认提供方、协议验证结果和费用上限。</p>
        <button type="button" disabled={busy || !status || Boolean(enabled && status.pairedProject && !pairedConsent)} onClick={() => void action(() => api!.configureHindsight!({
          projectId, endpoint, selectedPaths: paths, includeMemories: status?.pairedProject ? false : includeMemories, enabled,
          ...(status?.pairedProject ? { pairedProjectConsent: pairedConsent } : {}), ...(apiKey ? { apiKey } : {}),
        }))}>保存选择</button>
      </div>
    </details>
    {status?.configured && <div className="button-row">
      <button type="button" disabled={busy} onClick={() => void action(() => api!.refreshHindsight!({ projectId }))}>核验来源与同步状态</button>
      <button type="button" disabled={busy || !status.enabled} onClick={() => void action(() => api!.disableHindsight!({ projectId }))}>停止使用并清理投影</button>
    </div>}
    {status?.configured && <p>远端已处理 {status.counts.ready ?? 0} · 等待处理 {(status.counts.queued ?? 0) + (status.counts.submitted ?? 0)} · 待核实 {status.counts.unknown ?? 0} · 待清理 {status.counts.cleanup_pending ?? 0}。每次引用仍会核验本地来源。</p>}
    {error && <p role="alert">{error}</p>}
  </section>
}
