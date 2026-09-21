'use client'
import { useState } from 'react'
import { diagnosticUserMessage, type DiagnosticRecord } from '@ai-devflow/shared'

export function PairingDiagnosticHistory({ records }: { records: DiagnosticRecord[] }) {
  const [query, setQuery] = useState('')
  const [feedback, setFeedback] = useState('')
  const filtered = records.filter((record) => [record.id, record.timestamp, record.operation, record.reason, record.projectId].some((value) => value?.includes(query)))
  return <details><summary>配对操作诊断 · {records.length}</summary>
    <p>当前账号在此项目的最近操作；诊断编号可与 API 日志对应。</p>
    <input aria-label="筛选配对诊断" placeholder="时间、编号、操作或原因" value={query} onChange={(event) => setQuery(event.target.value)} />
    <button onClick={async () => { try { await navigator.clipboard.writeText(JSON.stringify(filtered, null, 2)); setFeedback('已复制脱敏诊断。') } catch { setFeedback('复制失败，请导出诊断。') } }}>复制诊断</button>
    <button onClick={() => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json' }))
      const link = document.createElement('a'); link.href = url; link.download = 'pairing-diagnostics.json'; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }}>导出诊断</button>
    {feedback ? <small role="status">{feedback}</small> : null}
    <ul>{filtered.map((record) => <li key={record.id}><details><summary>{record.timestamp} · {record.reason}</summary>
      <p>{diagnosticUserMessage(record.reason)}</p><pre>{JSON.stringify(record, null, 2)}</pre>
    </details></li>)}</ul>
  </details>
}
