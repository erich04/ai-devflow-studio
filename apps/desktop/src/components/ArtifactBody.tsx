import { useId, useState, type ReactNode } from 'react'
import { ConversationBody } from '../ConversationBody'
import { hasSectionContent, partitionArtifact, sectionTitles, type ArtifactSection, type ArtifactSectionGroup as Group } from '../app/artifact-sections'
export { hasSectionContent, partitionArtifact, type ArtifactSection } from '../app/artifact-sections'
/** Grouping is presentation; persisted content, versions and the raw source stay unchanged. */
export function ArtifactBody({ content, kind, section = 'all', annotateBlock, pendingContent, annotations = [], readingTools }: {
  content: string; kind?: string; section?: 'all' | 'content' | 'evidence' | 'records'
  /** Extra reading aids (e.g. review basis links) folded with the TOC and 查看原文 (plan Y6). */
  readingTools?: ReactNode
  annotateBlock?: ((start: number, end: number) => ReactNode) | undefined
  pendingContent?: ReactNode
  annotations?: Array<{ index: number; start: number; end: number }> | undefined
}) {
  const id = useId()
  const [raw, setRaw] = useState(false)
  const [selected, setSelected] = useState('main')
  const sections = partitionArtifact(content)
  const design = kind === 'design' || sections.some((item) => item.title === '实现方案')
  const requirement = kind === 'clarification' || sections.some((item) => item.title === '验收标准') && !design
  const tabs = design ? [{ id: 'main', label: '实现方案' }, { id: 'verification', label: '验证计划' }, { id: 'delivery', label: '交付与风险' }]
    : requirement ? [{ id: 'main', label: '需求范围' }, { id: 'verification', label: '验收标准' }, { id: 'questions', label: '待确认事项' }] : []
  const inContent = (group: Group) => !['evidence', 'records'].includes(group)
  const active = tabs.some((tab) => tab.id === selected) ? selected : 'main'
  const visible = sections.filter((item) => {
    if (section === 'evidence' || section === 'records') return item.group === section && hasSectionContent(item)
    if (!tabs.length) return section === 'all' || inContent(item.group)
    if (['questions', 'evidence', 'records'].includes(item.group) && !hasSectionContent(item)) return false
    const target = design && item.group === 'questions' ? 'delivery' : requirement && item.group === 'delivery' ? 'questions' : item.group
    return target === active
  })
  const toc = !raw && visible.length > 4
    ? <nav className="artifact-toc" aria-label="内容目录">{visible.map((item, index) => item.title && <a key={index} href={`#${id}-section-${index}`}>{item.title}</a>)}</nav>
    : null
  const rawToggle = <button className="text-button message-format-toggle" onClick={() => setRaw(!raw)}>{raw ? '返回排版' : '查看原文'}</button>
  // One control on the first screen: review basis, TOC and the raw source share a disclosure (plan Y6).
  const hasTools = Boolean(readingTools) || visible.length > 4
  const render = (item: ArtifactSection) => <ConversationBody showFormatToggle={false} headingLabel={(label) => sectionTitles[label] ?? label} annotateBlock={annotateBlock ? (start, end) => annotateBlock(item.start + start, item.start + end) : undefined} message={{ id: 'artifact-body', role: 'assistant', text: item.markdown, format: 'markdown', createdAt: '' }} />
  return <div className="artifact-body">
    {hasTools ? <details className="artifact-reading-tools" data-testid="artifact-reading-tools"><summary>阅读工具</summary>{readingTools}{toc}{rawToggle}</details> : rawToggle}
    {raw ? <div className="message-plain">{content}</div> : <>
      {tabs.length > 0 && !['evidence','records'].includes(section) && <div className="artifact-content-tabs" role="tablist" aria-label={design ? '设计内容' : '需求内容'} onKeyDown={(event) => {
        if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return
        event.preventDefault()
        const index = tabs.findIndex((tab) => tab.id === active)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
        setSelected(tabs[next]!.id); event.currentTarget.querySelectorAll<HTMLButtonElement>('button')[next]?.focus()
      }}>{tabs.map((tab) => <button key={tab.id} id={`${id}-${tab.id}`} role="tab" aria-selected={active === tab.id} tabIndex={active === tab.id ? 0 : -1} aria-controls={`${id}-panel`} onClick={() => setSelected(tab.id)}>{tab.label}{annotations.length > 0 && <span className="meta"> · {new Set(annotations.filter((annotation) => sections.some((item) => { const target = design && item.group === 'questions' ? 'delivery' : requirement && item.group === 'delivery' ? 'questions' : item.group; return target === tab.id && annotation.start >= item.start && annotation.end <= item.start + item.markdown.length })).map((annotation) => annotation.index)).size} 条定位意见</span>}</button>)}</div>}
      <div id={`${id}-panel`} role={tabs.length && !['evidence','records'].includes(section) ? 'tabpanel' : undefined} aria-labelledby={tabs.length && !['evidence','records'].includes(section) ? `${id}-${active}` : undefined}>
        {design && active === 'verification' && !['evidence','records'].includes(section) && <p className="meta">以下是验证计划。实际执行结果在测试步骤的「当前工作」中查看，历史证据在「材料与版本」中，计划不等于测试已通过。</p>}
        {visible.map((item, index) => <section className="artifact-reading-section" id={`${id}-section-${index}`} key={index}>
          {render(item)}
        </section>)}
        {!visible.length && <p className="meta">{active === 'questions' ? '本产物未列出待确认事项；请结合正文和审查结论核对。' : '本产物未提供此部分内容。'}</p>}
        {active === 'questions' && pendingContent}
      </div>
      {section === 'all' && tabs.length > 0 && sections.some((item) => !inContent(item.group) && hasSectionContent(item)) && <details className="material-source"><summary>来源与执行记录</summary>{sections.filter((item) => !inContent(item.group) && hasSectionContent(item)).map((item,index) => <section key={index}>{render(item)}</section>)}</details>}
    </>}
  </div>
}
