import { useEffect, useState } from 'react'
import { diagnosticUserMessage, sanitizeDiagnosticRecord, type DiagnosticRecord } from '@ai-devflow/shared'
import type { DevFlowDesktopApi } from '../desktop-api'

export function DiagnosticHistory({ api, active }: { api: Pick<DevFlowDesktopApi, 'listDiagnosticRecords'> | null; active: boolean }) {
  const [records, setRecords] = useState<DiagnosticRecord[]>([])
  const [query, setQuery] = useState('')
  const [from, setFrom] = useState('')
  const [message, setMessage] = useState('')
  async function refresh() {
    try { setRecords((await api?.listDiagnosticRecords?.() ?? []).map(sanitizeDiagnosticRecord)); setMessage('') }
    catch { setMessage('诊断记录暂不可用，请重试。') }
  }
  useEffect(() => { if (active) void refresh() }, [active, api])
  const filtered = records.filter((record) =>
    (!from || record.timestamp >= new Date(from).toISOString()) &&
    [record.id, record.operation, record.reason, record.projectId, record.runId].some((value) => value?.toLowerCase().includes(query.toLowerCase()))
  ).reverse()
  const encoded = () => JSON.stringify(filtered, null, 2)
  return <details open className="diagnostic-history"><summary>操作诊断记录</summary>
    <p>保留最近 1,000 条本机操作记录。凭诊断编号可与团队服务日志对应；不包含密钥、配对码或聊天正文。</p>
    <label>查询编号、操作、原因或项目 / Run<input aria-label="查询诊断" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    <label>起始时间<input aria-label="诊断起始时间" type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
    <button onClick={() => void refresh()}>刷新诊断</button>
    <button onClick={async () => { try { await navigator.clipboard.writeText(encoded()); setMessage('已复制脱敏诊断。') } catch { setMessage('复制失败，可使用导出。') } }}>复制筛选结果</button>
    <button onClick={() => {
      const url = URL.createObjectURL(new Blob([encoded()], { type: 'application/json' }))
      const link = document.createElement('a'); link.href = url; link.download = 'devflow-diagnostics.json'; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }}>导出筛选结果</button>
    <p role="status">{message}</p>
    {filtered.length === 0 ? <p>没有匹配的记录。</p> : <ul>{filtered.slice(0, 100).map((record) => <li key={record.id + record.source}>
      <details><summary>{record.timestamp} · {record.operation} · {record.reason}</summary>
        <p>{diagnosticUserMessage(record.reason)}</p>
        <pre>{JSON.stringify(record, null, 2)}</pre>
      </details>
    </li>)}</ul>}
    {filtered.length > 100 ? <p>显示前 100 条；复制和导出包含全部筛选结果。</p> : null}
  </details>
}
