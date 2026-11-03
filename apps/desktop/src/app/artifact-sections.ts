import { fromMarkdown } from 'mdast-util-from-markdown'
/**
 * Section split of a stage material (requirement or design). Pure code shared by `ArtifactBody`
 * and the gate decision page; it must not live in a `.tsx` file (gate-decision no-UI rule).
 */
export type ArtifactSectionGroup = 'main' | 'verification' | 'delivery' | 'questions' | 'evidence' | 'records'
export type ArtifactSection = { title: string; markdown: string; group: ArtifactSectionGroup; depth: number; start: number }
export const sectionTitles: Record<string, string> = {
  Implementation: '实现方案', Verification: '验证计划', 'Delivery and rollback': '交付与回退',
  Goals: '目标', 'Acceptance Criteria': '验收标准', 'Non-goals': '非目标',
  'Repository Findings': '代码调查记录', Assumptions: '假设与约束',
  'Open Questions': '待确认问题', Risks: '风险', 'Unchecked Scope': '未核验范围',
  'Repository Assumptions': '仓库相关假设', 'Repository Open Questions': '仓库待确认问题',
  'Unchecked Repository Scope': '仓库未核验范围',
}
export function groupFor(title: string): ArtifactSectionGroup | undefined {
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
  const parents: Array<{ depth: number; group: ArtifactSectionGroup }> = []
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
/** Explicitly empty auxiliary prose such as "None recorded." or "无待确认问题". */
export const PLACEHOLDER_TEXT_PATTERN = /^(?:[-*]\s*)?(?:无(?:待确认问题|额外问题|待确认事项|记录|内容)?|暂无(?:待确认问题|记录|内容)?|none(?: recorded)?|n\/a|not applicable)[。.!！]?$/iu
/** Only explicitly empty auxiliary prose is hidden; the complete raw source remains available. */
export function hasSectionContent(section: ArtifactSection): boolean {
  const body = fromMarkdown(section.markdown).children.filter((node) => node.type !== 'heading')
  if (!body.length) return false
  if (!['questions', 'evidence', 'records'].includes(section.group)) return true
  const text = body.map((node) => section.markdown.slice(node.position?.start.offset, node.position?.end.offset)).join('\n').trim()
  return !PLACEHOLDER_TEXT_PATTERN.test(text)
}
