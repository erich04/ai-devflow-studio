import { useState, type ReactNode } from 'react'
import { BookOpen, Code2, FileText, ClipboardCheck } from 'lucide-react'
import { buildClarificationReviewBundle, type AgentReviewResult, type Artifact } from '@ai-devflow/shared'
import { ArtifactBody } from './ArtifactBody'
import { ReviewEvidenceDetails, type RecordReviewFeedback } from './ReviewEvidenceDetails'

type Material = 'clarification' | 'request' | 'repository' | 'knowledge' | 'report'

export function GateMaterialReader({ bundle, review, reports, knowledge, onFeedback }: {
  bundle: ReturnType<typeof buildClarificationReviewBundle>
  review?: AgentReviewResult | null | undefined
  reports: Artifact[]
  knowledge: ReactNode
  onFeedback?: RecordReviewFeedback | undefined
}) {
  const [selected, setSelected] = useState<Material>('clarification')
  const revision = bundle.activeRevision
  const findings = bundle.repositoryFindings
  const tabs = [
    { id: 'clarification', title: `需求澄清 v${revision?.clarificationRevision?.revision ?? '—'}`, subtitle: '本次审查对象', Icon: FileText },
    { id: 'request', title: '原始需求', subtitle: '需求来源', Icon: FileText },
    { id: 'repository', title: '代码调查', subtitle: `${findings?.verifiedFacts.length ?? 0} 条核验事实`, Icon: Code2 },
    { id: 'knowledge', title: '团队规范', subtitle: '审查依据', Icon: BookOpen },
    { id: 'report', title: 'AI 审查报告', subtitle: review ? `${review.policyFindings.length} 条审查意见` : '尚未生成', Icon: ClipboardCheck },
  ] as const
  const artifact = selected === 'clarification' ? revision : bundle.rawRequest
  return <div className="gate-material-reader">
    <div className="material-tabs" role="tablist" aria-label="需求确认材料" onKeyDown={(event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const index = tabs.findIndex((tab) => tab.id === selected)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
      setSelected(tabs[next]!.id)
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
    }}>
      {tabs.map(({ id, title, subtitle, Icon }) => <button key={id} id={`material-tab-${id}`} role="tab" aria-selected={id === selected} aria-controls={`material-panel-${id}`} tabIndex={id === selected ? 0 : -1} onClick={() => setSelected(id)}>
        <Icon size={18} /><strong>{title}</strong><small>{subtitle}</small>
      </button>)}
    </div>
    <section id={`material-panel-${selected}`} role="tabpanel" aria-labelledby={`material-tab-${selected}`} className="material-document">
      {(selected === 'clarification' || selected === 'request') && <article data-testid={selected === 'request' ? 'clarification-raw-request' : 'clarification-current-revision'}>
        <div className="compact-row"><h2>{selected === 'request' ? '原始需求' : `需求澄清 v${revision?.clarificationRevision?.revision ?? '—'}`}</h2>
          <span className="pill soft">{selected === 'request' ? '原始记录' : ({ draft: '草稿', review_requested: '待确认', revision_requested: '待修订', approved: '已确认', superseded: '已有新版本' } as Record<string, string>)[revision?.clarificationRevision?.status ?? ''] ?? '版本不可用'}</span></div>
        <ArtifactBody content={artifact?.content ?? '正文不可用，请核对源产物。'} />
        {artifact && <details className="material-source"><summary>来源与版本</summary><p>{artifact.title} · {artifact.updatedAt}</p><code>{artifact.id}</code></details>}
      </article>}
      {selected === 'repository' && <article data-testid="clarification-repository-findings"><h2>代码调查</h2>
        <p className="meta">只读核验结果，供需求与方案判断使用。</p>
        {findings ? <><ul>{findings.verifiedFacts.map((fact) => <li key={fact.id}>{fact.statement}</li>)}</ul>
          {!!findings.uncheckedScopes.length && <details><summary>尚未核验的范围 · {findings.uncheckedScopes.length}</summary><ul>{findings.uncheckedScopes.map((scope) => <li key={scope}>{scope}</li>)}</ul></details>}
          <details className="material-source"><summary>文件引用与校验信息 · {findings.citations.length}</summary>{findings.citations.map((citation) => <p key={citation.id}>{citation.path}<br /><code>{citation.contentDigest}</code></p>)}</details>
        </> : <p>尚未进行代码核验。</p>}
      </article>}
      {selected === 'knowledge' && <><h2>团队规范与引用</h2>{knowledge}</>}
      {selected === 'report' && <><h2>AI 审查报告</h2>{review ? <>
        <p>{review.conclusion}</p>
        <p className="meta">{review.gateAdvisory.blocksApproval ? '存在阻断条件' : '建议性意见，仍需人工确认 Gate'} · {review.policyFindings.length} 条意见</p>
        <ReviewEvidenceDetails key={review.id} review={review} onFeedback={onFeedback} />
        <details><summary>完整报告 · {reports.length} 份</summary>{reports.map((report) => <article key={report.id}><h3>{report.title}</h3><ArtifactBody content={report.content} /></article>)}</details>
        <details className="material-source"><summary>审查来源与诊断信息</summary><code>{review.id}</code><p>模型置信度：{Math.round(review.confidence * 100)}%（不是完成度）</p></details>
      </> : <p>尚未保存审查报告。</p>}</>}
    </section>
  </div>
}
