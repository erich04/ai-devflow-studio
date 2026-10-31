import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ConversationBody, type DecorateBlock } from './ConversationBody'
import { gateReadingBlocks } from './app/gate-decision/material'
afterEach(cleanup)
// The sample of design §3.25 (same as material.test.ts).
const sample = [
  '这是顶层段落，用来说明下面列表的内容。', '',
  '- 第一个问题是什么？', '- 父级的条目', '  - 子级的条目', '', '',
  '* 松散条目一号是这样', '', '', '* 松散条目二号是这样', '',
  '- [ ] 完成任务条目的内容', '',
  '+ 条目里有引用', '', '  > 引用里的段落', '', '  ```', '  条目里的代码', '  ```', '',
  '表格前的一行说明', '| 列 | 值 |', '| --- | --- |', '| a | b |', '',
].join('\n')
const message = { id: 'm', role: 'assistant' as const, text: sample, format: 'markdown' as const, createdAt: '' }
const blocks = gateReadingBlocks(sample)
const keys = new Set(blocks.map((block) => `${block.start}:${block.end}`))
const decorated = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>('[data-block-start]'))
const paragraphOf = (container: HTMLElement, text: string) => Array.from(container.querySelectorAll('p')).find((p) => p.textContent?.includes(text))!
describe('ConversationBody with decorateBlock (design §3.25)', () => {
  const recording: DecorateBlock = (start, end) => (keys.has(`${start}:${end}`) ? {} : undefined)
  it('shows every reading block by exactly one decorated element with its range, never nested and never an li', () => {
    const { container } = render(<ConversationBody showFormatToggle={false} message={message} decorateBlock={recording} />)
    const ranges = decorated(container).map((element) => [Number(element.dataset.blockStart), Number(element.dataset.blockEnd)])
    expect(ranges).toEqual(blocks.map((block) => [block.start, block.end]))
    for (const element of decorated(container)) expect(element.querySelector('[data-block-start]')).toBeNull()
    expect(container.querySelectorAll('li[data-block-start]')).toHaveLength(0)
    expect(container.querySelector('div.gate-block > table')).not.toBeNull()
    expect(container.querySelector('div.gate-block > pre')).not.toBeNull()
  })
  it('keeps a p for every item paragraph, the nested list after the parent p, and marks only tight lists', () => {
    const { container } = render(<ConversationBody showFormatToggle={false} message={message} decorateBlock={recording} />)
    for (const item of Array.from(container.querySelectorAll('li'))) expect(item.querySelector(':scope > p')).not.toBeNull()
    const parent = paragraphOf(container, '父级的条目')
    expect(parent.parentElement?.tagName).toBe('LI')
    expect(parent.nextElementSibling?.tagName).toBe('UL')
    expect(paragraphOf(container, '第一个问题是什么？').closest('ul')).toHaveAttribute('data-gate-tight', 'true')
    expect(paragraphOf(container, '子级的条目').closest('ul')).toHaveAttribute('data-gate-tight', 'true')
    const tasks = paragraphOf(container, '完成任务条目的内容').closest('ul')!
    expect(tasks).toHaveAttribute('data-gate-tight', 'true')
    expect(tasks).toHaveClass('contains-task-list')
    expect(paragraphOf(container, '松散条目一号是这样').closest('ul')).not.toHaveAttribute('data-gate-tight')
    expect(paragraphOf(container, '条目里有引用').closest('ul')).not.toHaveAttribute('data-gate-tight')
  })
  it('renders `after` inside the parent item p, before its nested list, and the description on wrappers', () => {
    const parentKey = `${sample.indexOf('父级的条目')}:${sample.indexOf('父级的条目') + '父级的条目'.length}`
    const tableStart = sample.indexOf('| 列 | 值 |')
    const decorate: DecorateBlock = (start, end) => {
      if (`${start}:${end}` === parentKey) return { className: 'is-new', description: '新加内容', after: <button type="button" data-testid="marker" /> }
      if (start === tableStart) return { className: 'is-new', description: '新加内容' }
      return keys.has(`${start}:${end}`) ? {} : undefined
    }
    const { container, getByTestId } = render(<ConversationBody showFormatToggle={false} message={message} decorateBlock={decorate} />)
    const parent = paragraphOf(container, '父级的条目')
    expect(getByTestId('marker').parentElement).toBe(parent)
    expect(parent).toHaveClass('is-new')
    expect(parent).toHaveAttribute('aria-description', '新加内容')
    expect(parent.nextElementSibling?.tagName).toBe('UL')
    const wrapper = container.querySelector('table')!.parentElement!
    expect(wrapper).toHaveClass('gate-block', 'is-new')
    expect(wrapper).toHaveAttribute('role', 'group')
    expect(wrapper).toHaveAttribute('aria-description', '新加内容')
    expect(container.querySelector('pre')!.parentElement).not.toHaveAttribute('role')
  })
  it('renders a range that is not a block as today', () => {
    const { container } = render(<ConversationBody showFormatToggle={false} message={message} decorateBlock={() => undefined} />)
    expect(decorated(container)).toHaveLength(0)
    expect(container.querySelector('.gate-block')).toBeNull()
  })
})
describe('ConversationBody without decorateBlock', () => {
  it('renders today\'s DOM: no p inside tight items, no gate attributes', () => {
    const { container } = render(<ConversationBody showFormatToggle={false} message={message} />)
    const tight = Array.from(container.querySelectorAll('li')).find((item) => item.textContent === '第一个问题是什么？')!
    expect(tight.querySelector('p')).toBeNull()
    expect(container.querySelector('[data-gate-tight]')).toBeNull()
    expect(decorated(container)).toHaveLength(0)
    expect(container.querySelector('.gate-block')).toBeNull()
    expect(container.querySelector('table')!.parentElement).toHaveClass('message-markdown')
    expect(container.querySelector('ul.contains-task-list')).not.toBeNull()
  })
})
