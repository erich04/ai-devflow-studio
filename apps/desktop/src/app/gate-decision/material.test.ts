import { describe, expect, it } from 'vitest'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { formatLocalTime } from '../desktop-view-model'
import { buildF1, buildF3, buildF4, buildF5, buildF6, F1_QUESTIONS } from '../../testing/gate-fixtures'
import {
  gateReadingBlocks, gfmParseOptions, indexReadingBlocks, isLooseList, locateOpenQuestions, materialHeader, newBlocks,
  rawRequestLine, recordedAtLine, remarkKeepListParagraphs,
} from './material'
// The sample of design §3.25: a top-level paragraph, a tight list with a nested item, a loose
// list, a task item, an item with a block quote and a code block, and a table after a paragraph.
const sample = [
  '这是顶层段落，用来说明下面列表的内容。', '',
  '- 第一个问题是什么？', '- 父级的条目', '  - 子级的条目', '', '',
  '* 松散条目一号是这样', '', '', '* 松散条目二号是这样', '',
  '- [ ] 完成任务条目的内容', '',
  '+ 条目里有引用', '', '  > 引用里的段落', '', '  ```', '  条目里的代码', '  ```', '',
  '表格前的一行说明', '| 列 | 值 |', '| --- | --- |', '| a | b |', '',
].join('\n')
const at = (text: string) => ({ start: sample.indexOf(text), end: sample.indexOf(text) + text.length })
describe('GFM capture and reading blocks', () => {
  it('parses a pipe table as a table node (guards the remark-gfm capture)', () => {
    const tree = fromMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |\n', gfmParseOptions())
    expect(tree.children.map((node) => node.type)).toEqual(['table'])
  })
  it('gives every paragraph, table and code block of the sample exactly its node range', () => {
    const blocks = gateReadingBlocks(sample)
    expect(blocks.map(({ kind, start, end }) => [kind, start, end])).toEqual([
      ['paragraph', 0, 19],
      ['paragraph', 23, 32],                                   // tight item, without the bullet
      ['paragraph', 35, 40],                                   // tight item with a nested list
      ['paragraph', 45, 50],                                   // the nested item
      ['paragraph', 55, 64], ['paragraph', 69, 78],            // loose items
      ['paragraph', 86, 95],                                   // task item, without "[ ] "
      ['paragraph', at('条目里有引用').start, at('条目里有引用').end],
      ['paragraph', at('引用里的段落').start, at('引用里的段落').end],  // block quote inside an item
      ['code', at('```\n  条目里的代码\n  ```').start, at('```\n  条目里的代码\n  ```').end],
      ['paragraph', at('表格前的一行说明').start, at('表格前的一行说明').end],
      ['table', at('| 列 | 值 |').start, sample.trimEnd().length],
    ])
    expect(sample.slice(23, 32)).toBe('第一个问题是什么？')
    for (let index = 1; index < blocks.length; index++) expect(blocks[index]!.start).toBeGreaterThanOrEqual(blocks[index - 1]!.end)
  })
  it('splits a table that directly follows a paragraph line into two blocks and skips evidence sections', () => {
    const content = '## Goals\n说明一行\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n## Repository Findings\n- 不算阅读块\n'
    expect(gateReadingBlocks(content).map((block) => block.kind)).toEqual(['paragraph', 'table'])
  })
  it('indexes blocks for offset and range lookups', () => {
    const index = indexReadingBlocks(gateReadingBlocks(sample))
    expect(index.blockAt(25)).toMatchObject({ start: 23, end: 32 })
    expect(index.blockAt(32)).toBeUndefined()
    expect(index.intersecting({ start: 30, end: 46 }).map((block) => block.start)).toEqual([23, 35, 45])
  })
})
describe('list paragraphs keep their own <p>', () => {
  it('classifies lists with the converter rule', () => {
    expect(isLooseList({ type: 'list', spread: false, children: [{ type: 'listItem', spread: false, children: [{ type: 'paragraph' }] }] })).toBe(false)
    expect(isLooseList({ type: 'list', spread: true, children: [] })).toBe(true)
    expect(isLooseList({ type: 'list', spread: false, children: [{ type: 'listItem', spread: true, children: [{ type: 'paragraph' }] }] })).toBe(true)
    // `spread` missing: an item with more than one child is loose.
    expect(isLooseList({ type: 'list', children: [{ type: 'listItem', children: [{ type: 'paragraph' }, { type: 'list' }] }] })).toBe(true)
    expect(isLooseList({ type: 'list', children: [{ type: 'listItem', children: [{ type: 'paragraph' }] }] })).toBe(false)
  })
  it('sets spread on every list, marks exactly the tight ones and keeps positions', () => {
    type Node = { type: string; spread?: boolean | null; children?: Node[]; data?: { hProperties?: Record<string, unknown> }; position?: unknown }
    const tree = fromMarkdown(sample, gfmParseOptions()) as unknown as Node
    const lists = (node: Node): Node[] => [...(node.type === 'list' ? [node] : []), ...(node.children ?? []).flatMap(lists)]
    const before = lists(tree).map((list) => ({ loose: isLooseList(list), position: JSON.stringify(list.position) }))
    remarkKeepListParagraphs()(tree)
    const after = lists(tree)
    expect(after.every((list) => list.spread === true)).toBe(true)
    expect(after.map((list) => list.data?.hProperties?.dataGateTight === 'true')).toEqual(before.map((item) => !item.loose))
    expect(after.map((list) => JSON.stringify(list.position))).toEqual(before.map((item) => item.position))
    expect(before.map((item) => item.loose)).toContain(true)
    expect(before.map((item) => item.loose)).toContain(false)
  })
})
describe('open questions', () => {
  it('locates each question at its item paragraph in 待确认问题, without the bullet', async () => {
    const { current } = await buildF1()
    const located = locateOpenQuestions(current.content, F1_QUESTIONS)
    expect(located.map((question) => question.number)).toEqual([1, 2])
    for (const question of located) expect(current.content.slice(question.range!.start, question.range!.end)).toBe(question.text)
    expect(current.content.slice(located[0]!.range!.start - 2, located[0]!.range!.start)).toBe('- ')
  })
  it('drops placeholders and leaves duplicated or reworded questions unlocated', () => {
    const content = '## Open Questions\n- 是否支持导出？\n- 是否支持导出？\n- 范围是什么？\n'
    const located = locateOpenQuestions(content, ['None recorded.', '是否支持导出？', '范围到底是什么？'])
    expect(located).toEqual([{ number: 1, text: '是否支持导出？' }, { number: 2, text: '范围到底是什么？' }])
  })
})
describe('new blocks', () => {
  it('marks the blocks of v2 whose text v1 does not contain (AC36)', async () => {
    const f3 = await buildF3()
    const keys = newBlocks(f3.current.content, f3.previous!.content)
    const texts = keys.map((key) => { const [start, end] = key.split(':').map(Number); return f3.current.content.slice(start, end) })
    expect(texts).toEqual(['输入多个关键词时，任务标题需包含全部关键词。', '搜索不区分大小写。'])
    expect(newBlocks(f3.current.content, undefined)).toEqual([])
  })
  it('keeps unchanged nested items and moved or renumbered items old; new tables and code blocks are new', () => {
    const v1 = '## Goals\n- 父级旧文字\n  - 子级不变\n1. 第一项\n2. 第二项\n'
    const v2 = '## Goals\n- 父级新文字\n  - 子级不变\n1. 第二项\n2. 第一项\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n```\nnew code\n```\n'
    const keys = newBlocks(v2, v1)
    const texts = keys.map((key) => { const [start, end] = key.split(':').map(Number); return v2.slice(start, end) })
    expect(texts).toEqual(['父级新文字', '| a | b |\n| --- | --- |\n| 1 | 2 |', '```\nnew code\n```'])
  })
})
describe('material header', () => {
  it('writes every requirement variant', async () => {
    const f1 = await buildF1()
    expect(materialHeader({ kind: 'requirement', artifact: f1.current, artifacts: f1.artifacts })).toBe('需求 v1 · 根据原始需求生成')
    const f3 = await buildF3()
    expect(materialHeader({ kind: 'requirement', artifact: f3.current, artifacts: f3.artifacts })).toBe('需求 v2 · 根据需求 v1 和 2 项修改生成，新加内容以绿色标出')
    const free = f3.artifacts.map((artifact) => artifact.kind === 'clarification_feedback' ? { ...artifact, content: '请补充多关键词。' } : artifact)
    expect(materialHeader({ kind: 'requirement', artifact: f3.current, artifacts: free })).toBe('需求 v2 · 根据需求 v1 和修订意见生成，新加内容以绿色标出')
    const { requirement } = await buildF6()
    expect(materialHeader({ kind: 'requirement', artifact: requirement.current, artifacts: requirement.artifacts })).toBe('需求（旧版记录）')
    expect(recordedAtLine(f1.current)).toBe(`记录于 ${formatLocalTime(f1.current.updatedAt)}`)
  })
  it('writes every design variant, with one variant for a design without evidence', async () => {
    const f4 = await buildF4()
    expect(materialHeader({ kind: 'design', artifact: f4.current, artifacts: f4.artifacts, number: 1 })).toBe('方案 v1 · 根据需求 v1 生成')
    const f5 = await buildF5()
    const numbers = new Map([[f5.previous!.id, 1], [f5.current.id, 2]])
    expect(materialHeader({ kind: 'design', artifact: f5.current, artifacts: f5.artifacts, designNumbers: numbers })).toBe('方案 v2 · 根据方案 v1 和 1 项修改生成，改动以绿色标出')
    const { design } = await buildF6()
    expect(materialHeader({ kind: 'design', artifact: design.current, artifacts: design.artifacts, number: 1 })).toBe('方案 v1 · 根据已确认的需求生成')
  })
  it('shows the first line of the raw request', () => {
    expect(rawRequestLine('给任务列表加搜索。\n保留状态筛选。')).toBe('原始需求：给任务列表加搜索。…')
    expect(rawRequestLine('只有一行')).toBe('原始需求：只有一行')
  })
})
