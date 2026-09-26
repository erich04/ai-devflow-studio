import { useState, type ReactNode } from 'react'
import { buildClarificationReviewBundle, type AgentReviewResult, type Artifact } from '@ai-devflow/shared'
import { ArtifactBody } from './ArtifactBody'
import { ArtifactReviewReader } from './ArtifactReviewReader'
import { type RecordReviewFeedback } from './ReviewEvidenceDetails'

export function GateMaterialReader({ bundle, review, reports, knowledge, onFeedback, onToggleRevision, revisionSelected = [], onDiscuss }: {
  onDiscuss?: ((prompt: string) => void) | undefined
  bundle: ReturnType<typeof buildClarificationReviewBundle>
  review?: AgentReviewResult | null | undefined
  reports: Artifact[]
  knowledge: ReactNode
  onFeedback?: RecordReviewFeedback | undefined
  onToggleRevision?: ((index: number) => void) | undefined
  revisionSelected?: number[] | undefined
}) {
  const [reference, setReference] = useState<'request' | 'repository' | 'knowledge' | null>(null)
  const [readingId, setReadingId] = useState('')
  const revision = bundle.revisions.find((item) => item.id === readingId) ?? bundle.activeRevision
  const readingCurrent = revision?.id === bundle.activeRevision?.id
  const toggleRevision = readingCurrent ? onToggleRevision : undefined
  return <div className="gate-material-reader">
    <div className="material-reference-links"><span>审查依据</span>
      <button className="text-button" onClick={() => setReference(reference === 'request' ? null : 'request')}>原始需求</button>
      <button className="text-button" onClick={() => setReference(reference === 'repository' ? null : 'repository')}>代码调查</button>
      <button className="text-button" onClick={() => setReference(reference === 'knowledge' ? null : 'knowledge')}>团队规范</button>
    </div>
    {reference && <section className="material-reference-preview"><button className="text-button" onClick={() => setReference(null)}>收起参考资料</button>
      {reference === 'request' && <article data-testid="clarification-raw-request"><h3>原始需求</h3><ArtifactBody content={bundle.rawRequest?.content ?? '原文不可用'} /></article>}
      {reference === 'repository' && <article data-testid="clarification-repository-findings"><h3>代码调查</h3>{bundle.repositoryFindings ? <><ul>{bundle.repositoryFindings.verifiedFacts.map((fact) => <li key={fact.id}>{fact.statement}</li>)}</ul><details><summary>代码引用与核验摘要</summary><p>{bundle.repositoryFindings.repositoryDigest}</p><ul>{bundle.repositoryFindings.citations.map((citation) => <li key={citation.id}>{citation.path}{citation.lineStart ? `:${citation.lineStart}` : ''} · {citation.contentDigest}</li>)}</ul></details><p>未核验范围：{bundle.repositoryFindings.uncheckedScopes.join('；') || '未报告'}</p></> : <p>尚未进行代码核验。</p>}</article>}
      {reference === 'knowledge' && knowledge}
    </section>}
    {bundle.revisions.length > 1 && <label>阅读版本<select aria-label="阅读需求版本" value={revision?.id} onChange={(event) => setReadingId(event.target.value)}>{bundle.revisions.map((item) => <option key={item.id} value={item.id}>需求澄清 v{item.clarificationRevision?.revision ?? '—'} · {item.id === bundle.activeRevision?.id ? '当前版本' : '历史版本'}</option>)}</select></label>}
    {!readingCurrent && <p role="status">正在阅读历史版本；当前修订与审批仍以最新版本为准。</p>}
    <article className="material-document" data-testid="clarification-current-revision">
      <div className="compact-row"><h2>需求澄清 v{revision?.clarificationRevision?.revision ?? '—'}</h2><span>{({ draft: '草稿', review_requested: '待确认', revision_requested: '待修订', approved: '已确认', superseded: '已有新版本' } as Record<string, string>)[revision?.clarificationRevision?.status ?? ''] ?? '版本不可用'}</span></div>
      {revision ? <ArtifactReviewReader artifact={revision} review={review} reports={reports} requirement onFeedback={onFeedback} onToggleRevision={toggleRevision} revisionSelected={revisionSelected} onDiscuss={onDiscuss} /> : <p>正文不可用，请核对源产物。</p>}
    </article>
  </div>
}
