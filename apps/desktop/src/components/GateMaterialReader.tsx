import { useState, type ReactNode } from 'react'
import { buildClarificationReviewBundle, type AgentReviewResult, type Artifact } from '@ai-devflow/shared'
import { ArtifactBody } from './ArtifactBody'
import { ArtifactReviewReader } from './ArtifactReviewReader'
import { type RecordReviewFeedback } from './ReviewEvidenceDetails'
import type { DiscussionMaterial } from '../app/discussion-reference'
import { formatLocalTime } from '../app/desktop-view-model'
import {
  describeMaterial,
  groupMaterials,
  pendingRequirementTarget,
  selectRequirementReading,
  type MaterialContext,
} from '../app/material-catalog'

/**
 * The one requirement reader for the clarification step and the requirement Gate (plan S4, Z4,
 * Issue #181). Reading another version or the raw request never moves the approval target.
 */
export function GateMaterialReader({ bundle, review, reports, knowledge, onFeedback, onToggleRevision, revisionSelected = [], onDiscuss, readingId: controlledReadingId, onReadingChange, materialContext }: {
  /** Adds a reference card to the discussion; never sends or calls a model (plan W7). */
  onDiscuss?: ((material: DiscussionMaterial) => void) | undefined
  bundle: ReturnType<typeof buildClarificationReviewBundle>
  review?: AgentReviewResult | null | undefined
  reports: Artifact[]
  knowledge: ReactNode
  onFeedback?: RecordReviewFeedback | undefined
  onToggleRevision?: ((index: number) => void) | undefined
  revisionSelected?: number[] | undefined
  /** Controlled by the task page so explicit links and the W9 return can open a version. */
  readingId?: string | undefined
  onReadingChange?: ((artifactId: string) => void) | undefined
  materialContext?: MaterialContext | undefined
}) {
  const [reference, setReference] = useState<'request' | 'repository' | 'knowledge' | null>(null)
  const [localReadingId, setLocalReadingId] = useState('')
  const requestedId = controlledReadingId ?? localReadingId
  const setReadingId = (id: string) => (onReadingChange ?? setLocalReadingId)(id)
  const context: MaterialContext = materialContext ?? { run: undefined, events: [], formatTime: formatLocalTime }
  const target = pendingRequirementTarget(bundle)
  // “Current” is what a pending Gate would confirm, else the version the Gate binds or the latest.
  const anchor = target ?? selectRequirementReading(bundle)
  const reading = selectRequirementReading(bundle, requestedId) ?? bundle.rawRequest
  const readingRaw = Boolean(reading && reading.kind === 'raw_request')
  const readingCurrent = !reading || reading.id === anchor?.id || (!anchor && readingRaw)
  const toggleRevision = reading && reading.id === bundle.activeRevision?.id ? onToggleRevision : undefined
  const entry = reading ? describeMaterial(reading, context) : undefined
  const anchorEntry = anchor ? describeMaterial(anchor, context) : undefined
  const versionOf = (artifact: Artifact | undefined) => artifact?.clarificationRevision ? `v${artifact.clarificationRevision.revision}` : artifact ? `（${describeMaterial(artifact, context).versionLabel}）` : '—'
  // The selector appears only when there is more than one version, or to leave the raw request.
  const selectable = [
    ...bundle.revisions,
    ...(bundle.rawRequest && (bundle.revisions.length > 1 || readingRaw) ? [bundle.rawRequest] : []),
  ]
  const showSelector = bundle.revisions.length > 1 || (readingRaw && bundle.revisions.length > 0)
  // Review basis sits in the body's 阅读工具 disclosure with the TOC and 查看原文 (plan Y6).
  const reviewBasis = <>
    <div className="material-reference-links"><span>审查依据</span>
      <button className="text-button" aria-pressed={reference === 'request'} onClick={() => setReference(reference === 'request' ? null : 'request')}>原始需求</button>
      <button className="text-button" aria-pressed={reference === 'repository'} onClick={() => setReference(reference === 'repository' ? null : 'repository')}>代码调查</button>
      <button className="text-button" aria-pressed={reference === 'knowledge'} onClick={() => setReference(reference === 'knowledge' ? null : 'knowledge')}>团队规范</button>
    </div>
    {reference && <section className="material-reference-preview"><button className="text-button" onClick={() => setReference(null)}>收起参考资料</button>
      {reference === 'request' && <article data-testid="clarification-raw-request"><h3>原始需求</h3><ArtifactBody content={bundle.rawRequest?.content ?? '原文不可用'} /></article>}
      {reference === 'repository' && <article data-testid="clarification-repository-findings"><h3>代码调查</h3>{bundle.repositoryFindings ? <><ul>{bundle.repositoryFindings.verifiedFacts.map((fact) => <li key={fact.id}>{fact.statement}</li>)}</ul><details><summary>代码引用与核验摘要</summary><p>{bundle.repositoryFindings.repositoryDigest}</p><ul>{bundle.repositoryFindings.citations.map((citation) => <li key={citation.id}>{citation.path}{citation.lineStart ? `:${citation.lineStart}` : ''} · {citation.contentDigest}</li>)}</ul></details><p>未核验范围：{bundle.repositoryFindings.uncheckedScopes.join('；') || '未报告'}</p></> : <p>尚未进行代码核验。</p>}</article>}
      {reference === 'knowledge' && knowledge}
    </section>}
  </>
  const returnLabel = target ? '返回待确认版本' : anchorEntry?.statusLabel === '已确认' ? '返回已确认版本' : '返回当前版本'
  return <div className="gate-material-reader">
    {showSelector && <label>阅读版本<select aria-label="阅读需求版本" value={reading?.id ?? ''} onChange={(event) => setReadingId(event.target.value)}>
      {groupMaterials(selectable.map((artifact) => describeMaterial(artifact, context))).map((section) => (
        <optgroup key={section.group} label={section.label}>
          {section.entries.map((item) => <option key={item.artifact.id} value={item.artifact.id}>{item.label}</option>)}
        </optgroup>
      ))}
    </select></label>}
    {/* Reading another version never moves the approval target: the notice names it (plan V1, §6.2, Z6). */}
    {!readingCurrent && reading ? <p role="status" className="material-history-notice">
      {readingRaw
        ? `正在阅读原始需求；${target ? `确认与修订仍针对需求 ${versionOf(target)}。` : '原始需求不是审批对象。'}`
        : target
          ? `正在阅读历史版本 ${versionOf(reading)}；确认与修订仍针对需求 ${versionOf(target)}。`
          : `正在阅读需求 ${versionOf(reading)}（${entry?.statusLabel || '状态未记录'}）；当前${anchorEntry?.statusLabel === '已确认' ? '已确认' : '最新'}的是需求 ${versionOf(anchor)}。`}
      {anchor ? <button type="button" className="text-button" onClick={() => setReadingId(anchor.id)}>{returnLabel}</button> : null}
    </p> : null}
    <article className="material-document" data-testid="clarification-current-revision">
      <div className="compact-row">
        <h2>{readingRaw ? '原始需求' : reading ? `需求澄清 ${versionOf(reading)}` : '需求澄清'}</h2>
        <span>{readingRaw ? '原始输入，不是审批对象' : entry?.statusLabel || '版本不可用'}</span>
        {reading ? <span className="meta">{entry?.timeLabel}</span> : null}
        {reading && onDiscuss ? <button type="button" className="text-button" onClick={() => onDiscuss({
          materialId: reading.id,
          materialTitle: readingRaw ? '原始需求' : reading.title,
          version: reading.clarificationRevision ? `需求 v${reading.clarificationRevision.revision}` : `记录于 ${formatLocalTime(reading.updatedAt)}`,
        })}>讨论此材料</button> : null}
      </div>
      {reading && !readingRaw ? <p className="meta material-business-title">{reading.title}</p> : null}
      {readingRaw && reading
        ? <ArtifactBody content={reading.content} readingTools={reviewBasis} />
        : reading
          ? <ArtifactReviewReader artifact={reading} review={review} reports={reports} requirement onFeedback={onFeedback} onToggleRevision={toggleRevision} revisionSelected={revisionSelected} onDiscuss={onDiscuss} readingTools={reviewBasis} />
          : <>{reviewBasis}<p>正文不可用，请核对源产物。</p></>}
    </article>
  </div>
}
