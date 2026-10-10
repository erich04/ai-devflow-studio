import { useEffect, useState, type ReactNode } from 'react'
import type { Artifact } from '@ai-devflow/shared'
import { formatLocalTime } from '../app/desktop-view-model'

export function DesignRevisionPanel({ previous, proposals, onGenerate, disabled, generating, settings }: {
  previous: Artifact
  proposals: Artifact[]
  onGenerate: (proposalIds: string[]) => void
  disabled: boolean
  generating: boolean
  settings?: ReactNode
}) {
  const [selected, setSelected] = useState<string[]>([])
  const snapshot = JSON.stringify([previous.id, previous.updatedAt, previous.content,
    proposals.map((item) => [item.id, item.updatedAt, item.content])])
  useEffect(() => { setSelected([]) }, [snapshot])
  return <section className="design-revision-panel" aria-label="修订方案">
    <h3>根据讨论提案修订方案</h3>
    <p>以当前方案为基础，合入你选中的修改意见，生成完整新版。旧版保留，生成后仍需你评审。</p>
    <p className="meta">当前方案：{previous.title} · {formatLocalTime(previous.updatedAt)}</p>
    {proposals.length ? <fieldset disabled={disabled || generating}>
      <legend>选择本次要采用的已保存提案</legend>
      {proposals.map((proposal) => <div key={proposal.id} className="design-revision-proposal">
        <label><input type="checkbox" checked={selected.includes(proposal.id)} onChange={(event) => {
          setSelected((current) => event.target.checked ? [...current, proposal.id] : current.filter((id) => id !== proposal.id))
        }} />{proposal.title}</label>
        <details><summary>查看提案正文 · {formatLocalTime(proposal.updatedAt)}</summary><pre>{proposal.content}</pre></details>
      </div>)}
    </fieldset> : <p>先在右侧讨论中说明修改意见，并点击“保存为节点提案”，关联到“方案设计”步骤。保存后会在这里列出。</p>}
    {proposals.length > 0 && <>
      {settings}
      <p className="meta">本次生成会调用所选模型，可能产生费用。</p>
      <button className="primary-button" disabled={disabled || generating || selected.length === 0 || selected.length > 20}
        onClick={() => onGenerate(selected)}>{generating ? '正在生成新版方案…' : '根据提案生成新版方案'}</button>
    </>}
  </section>
}
