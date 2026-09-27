import { useId, useState, type ReactNode } from 'react'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { ConversationBody } from '../ConversationBody'

type Group = 'main' | 'verification' | 'delivery' | 'questions' | 'evidence' | 'records'
export type ArtifactSection = { title: string; markdown: string; group: Group; depth: number; start: number }
const sectionTitles: Record<string, string> = {
  Implementation: '实现方案', Verification: '验证计划', 'Delivery and rollback': '交付与回退',
  Goals: '目标', 'Acceptance Criteria': '验收标准', 'Non-goals': '非目标',
  'Repository Findings': '代码调查记录', Assumptions: '假设与约束',
  'Open Questions': '待确认问题', Risks: '风险', 'Unchecked Scope': '未核验范围',
  'Repository Assumptions': '仓库相关假设', 'Repository Open Questions': '仓库待确认问题',
  'Unchecked Repository Scope': '仓库未核验范围',
}
function groupFor(title: string): Group | undefined {
  if (/^(Implementation|实现方案|Goals|目标|Non-goals|非目标|Assumptions|假设与约束|Repository Assumptions|仓库相关假设)$/iu.test(title)) return 'main'
  if (/^(Verification|验证计划|测试策略|Acceptance Criteria|验收标准|Unchecked (Repository )?Scope|仓库未核验范围|未核验范围)$/iu.test(title)) return 'verification'
  if (/^(Delivery and rollback|交付与回退|交付与风险|Risks|风险)$/iu.test(title)) return 'delivery'
  if (/^(Open Questions|待确认问题|Repository Open Questions|仓库待确认问题)$/iu.test(title)) return 'questions'
  if (/^(Repository Findings|代码调查记录|设计输入与代码核验依据)$/iu.test(title)) return 'evidence'
  if (/^(生成来源与模型记录|Generation Metadata)$/iu.test(title)) return 'records'
  return undefined
}

/** Real Markdown blocks keep fenced, quoted and list-contained headings intact. */
export function partitionArtifact(content: string): ArtifactSection[] {
  const nodes = fromMarkdown(content).children
  const sections: ArtifactSection[] = []
  const parents: Array<{ depth: number; group: Group }> = []
  let current: ArtifactSection = { title: '', markdown: '', group: 'main', depth: 0, start: 0 }
  let start = 0
  const flush = (end: number) => {
    current.markdown += content.slice(start, end)
    if (current.markdown.trim()) sections.push(current)
  }
  for (const node of nodes) {
    const offset = node.position?.start.offset
    if (offset === undefined) continue
    if (node.type === 'heading') {
      flush(offset)
      const title = content.slice(offset, node.position!.end.offset).replace(/^#{1,6}\s+/u, '').replace(/\s+#+\s*$/u, '').replace(/\n[=-]+\s*$/u, '').trim()
      while (parents.length && parents.at(-1)!.depth >= node.depth) parents.pop()
      const group = groupFor(title) ?? parents.at(-1)?.group ?? 'main'
      parents.push({ depth: node.depth, group })
      current = { title: sectionTitles[title] ?? title, markdown: '', group, depth: node.depth, start: offset }
      start = offset
    } else if (node.type === 'blockquote' && /^> Source: .*Provider:.*Model:.*Generated:/u.test(content.slice(offset, node.position?.end.offset))) {
      flush(offset)
      sections.push({ title: '生成来源与模型记录', markdown: content.slice(offset, node.position?.end.offset), group: 'records', depth: 1, start: offset })
      start = node.position!.end.offset!
      current = { title: '', markdown: '', group: parents.at(-1)?.group ?? 'main', depth: 0, start }
    }
  }
  flush(content.length)
  return sections
}

/** Only explicitly empty auxiliary prose is hidden; the complete raw source remains available. */
export function hasSectionContent(section: ArtifactSection): boolean {
  const body = fromMarkdown(section.markdown).children.filter((node) => node.type !== 'heading')
  if (!body.length) return false
  if (!['questions', 'evidence', 'records'].includes(section.group)) return true
  const text = body.map((node) => section.markdown.slice(node.position?.start.offset, node.position?.end.offset)).join('\n').trim()
  return !/^(?:[-*]\s*)?(?:无(?:待确认问题|额外问题|待确认事项|记录|内容)?|暂无(?:待确认问题|记录|内容)?|none(?: recorded)?|n\/a|not applicable)[。.!！]?$/iu.test(text)
}

/** Grouping is presentation; persisted content, versions and the raw source stay unchanged. */
export function ArtifactBody({ content, kind, section = 'all', annotateBlock, pendingContent, annotations = [] }: {
  content: string; kind?: string; section?: 'all' | 'content' | 'evidence' | 'records'
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
  const render = (item: ArtifactSection) => <ConversationBody showFormatToggle={false} headingLabel={(label) => sectionTitles[label] ?? label} annotateBlock={annotateBlock ? (start, end) => annotateBlock(item.start + start, item.start + end) : undefined} message={{ id: 'artifact-body', role: 'assistant', text: item.markdown, format: 'markdown', createdAt: '' }} />
  return <div className="artifact-body">
    <button className="text-button message-format-toggle" onClick={() => setRaw(!raw)}>{raw ? '返回排版' : '查看原文'}</button>
    {raw ? <div className="message-plain">{content}</div> : <>
      {tabs.length > 0 && !['evidence','records'].includes(section) && <div className="artifact-content-tabs" role="tablist" aria-label={design ? '设计内容' : '需求内容'} onKeyDown={(event) => {
        if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return
        event.preventDefault()
        const index = tabs.findIndex((tab) => tab.id === active)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
        setSelected(tabs[next]!.id); event.currentTarget.querySelectorAll<HTMLButtonElement>('button')[next]?.focus()
      }}>{tabs.map((tab) => <button key={tab.id} id={`${id}-${tab.id}`} role="tab" aria-selected={active === tab.id} tabIndex={active === tab.id ? 0 : -1} aria-controls={`${id}-panel`} onClick={() => setSelected(tab.id)}>{tab.label}{annotations.length > 0 && <span className="meta"> · {new Set(annotations.filter((annotation) => sections.some((item) => { const target = design && item.group === 'questions' ? 'delivery' : requirement && item.group === 'delivery' ? 'questions' : item.group; return target === tab.id && annotation.start >= item.start && annotation.end <= item.start + item.markdown.length })).map((annotation) => annotation.index)).size} 条定位意见</span>}</button>)}</div>}
      <div id={`${id}-panel`} role={tabs.length && !['evidence','records'].includes(section) ? 'tabpanel' : undefined} aria-labelledby={tabs.length && !['evidence','records'].includes(section) ? `${id}-${active}` : undefined}>
        {design && active === 'verification' && !['evidence','records'].includes(section) && <p className="meta">以下是验证计划。实际执行结果在「产物与证据」中查看，计划不等于测试已通过。</p>}
        {visible.length > 4 && <nav className="artifact-toc" aria-label="内容目录">{visible.map((item, index) => item.title && <a key={index} href={`#${id}-section-${index}`}>{item.title}</a>)}</nav>}
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
