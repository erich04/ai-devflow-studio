import { useState } from 'react'
import { ConversationBody } from '../ConversationBody'

const sectionTitles: Record<string, string> = {
  Goals: '目标', 'Acceptance Criteria': '验收标准', 'Non-goals': '非目标',
  'Repository Findings': '代码调查记录', Assumptions: '假设与约束',
  'Open Questions': '待确认问题', Risks: '风险', 'Unchecked Scope': '未核验范围',
  'Repository Assumptions': '仓库相关假设', 'Repository Open Questions': '仓库待确认问题',
  'Unchecked Repository Scope': '仓库未核验范围',
}

/** Presentation only: the full, unchanged source remains available through the toggle. */
export function ArtifactBody({ content }: { content: string }) {
  const [raw, setRaw] = useState(false)
  const metadata: string[] = []
  const sections: Array<{ title: string; body: string }> = [{ title: '', body: '' }]
  let fenced = false
  for (const line of content.split('\n')) {
    if (/^\s*(```|~~~)/u.test(line)) fenced = !fenced
    if (!fenced && /^> Source: .*Provider:.*Model:.*Generated:/u.test(line)) { metadata.push(line); continue }
    const heading = !fenced && /^##\s+(.+)$/u.exec(line)
    if (heading) sections.push({ title: heading[1]!, body: '' })
    else sections[sections.length - 1]!.body += `${line}\n`
  }
  const render = (text: string) => <ConversationBody showFormatToggle={false} message={{
    id: 'artifact-body', role: 'assistant', text, format: 'markdown', createdAt: '',
  }} />
  const intro = sections[0]!.body
    .replace(/^# (.+): \1\s*$/mu, '# $1')
    .replace(/^Summary:\s*/mu, '**摘要：** ')
  return <div className="artifact-body">
    <button className="text-button message-format-toggle" onClick={() => setRaw(!raw)}>{raw ? '返回排版' : '查看原文'}</button>
    {raw ? <div className="message-plain">{content}</div> : <>
      {render(intro)}
      {sections.slice(1).map((section, index) => <details className="artifact-section" key={`${index}-${section.title}`} open={/^(Acceptance Criteria|验收标准)$/iu.test(section.title)}>
        <summary>{sectionTitles[section.title] ?? section.title}</summary>{render(section.body)}
      </details>)}
      {metadata.length > 0 && <details className="material-source"><summary>生成来源与模型记录</summary><pre>{metadata.join('\n')}</pre></details>}
    </>}
  </div>
}
