import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ProfilerOnRenderCallback } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildDesignRevisionIdentity, type Artifact } from '@ai-devflow/shared'
import { formatLocalTime } from '../../app/desktop-view-model'
import { gateReadingBlocks, newBlocks } from '../../app/gate-decision/material'
import { clearContentDigestCacheForTests } from '../../app/useContentDigest'
import { buildF1, buildF3, buildF4, buildF5, listFor, nodeIdsOf, reviewOf, type GateFixture } from '../../testing/gate-fixtures'
import { gateActionSpies, gateFacts, GateHarness, storeRevisionLists } from '../../testing/gate-page'
import { observeGateMaterialCommitsForTests } from './MaterialColumn'

// ResizeObserver that tests can trigger; getBoundingClientRect gives `.gate-workspace` a width.
class TestResizeObserver {
  static all: TestResizeObserver[] = []
  targets = new Set<Element>()
  constructor(public callback: ResizeObserverCallback) { TestResizeObserver.all.push(this) }
  observe(target: Element) { this.targets.add(target) }
  unobserve(target: Element) { this.targets.delete(target) }
  disconnect() { this.targets.clear() }
}
function resize(element: Element, width: number) {
  act(() => {
    for (const observer of TestResizeObserver.all) {
      if (observer.targets.has(element)) observer.callback([{ target: element, contentRect: { width } } as unknown as ResizeObserverEntry], observer as unknown as ResizeObserver)
    }
  })
}
function mockWorkspaceWidth(width: number) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const value = this.classList.contains('gate-workspace') ? width : 0
    return { x: 0, y: 0, top: 0, left: 0, bottom: 0, right: value, width: value, height: 0, toJSON: () => ({}) } as DOMRect
  })
}
const OriginalResizeObserver = globalThis.ResizeObserver
beforeEach(() => {
  clearContentDigestCacheForTests()
  localStorage.clear()
  TestResizeObserver.all = []
  globalThis.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver
})
afterEach(() => {
  cleanup()
  observeGateMaterialCommitsForTests(undefined)
  globalThis.ResizeObserver = OriginalResizeObserver
  vi.restoreAllMocks()
  vi.useRealTimers()
  document.documentElement.removeAttribute('data-theme')
})
const bar = () => screen.getByTestId('gate-decision-bar')
const material = (kind: 'requirement' | 'design' = 'requirement') => screen.getByTestId(kind === 'requirement' ? 'clarification-current-revision' : 'design-current-material')
const paragraph = (text: string, kind: 'requirement' | 'design' = 'requirement') => Array.from(material(kind).querySelectorAll('p')).find((p) => p.textContent?.includes(text))!
const card = (name: string) => screen.getByRole('article', { name })
async function settled(row = '15') {
  await waitFor(() => expect(bar()).toHaveAttribute('data-row', row))
  await act(async () => {})
}
/** A design with a nested list, a table and a code block; findings 3–6 cite one block. */
const FX_CONTENT = [
  '> Source: fake/template · Provider: fake · Model: fake · Generated: 2026-10-30T08:20:00.000Z', '',
  '## Implementation', '- 在任务列表上方加入搜索框。', '  - 搜索框在窄屏下单独一行。', '- 搜索在前端完成，不新增依赖。', '',
  '| 文件 | 改动 |', '| --- | --- |', '| TaskList.tsx | 加入搜索框组件 |', '',
  '```ts', "const query = useState('')", '```', '',
  '## Verification', '- 单元测试覆盖大小写、空结果和保留状态筛选，并记录每个用例的预期。', '',
  '## Delivery and rollback', '- 出问题时移除搜索框即可回退。', '',
].join('\n')
async function buildFx(): Promise<GateFixture> {
  const f4 = await buildF4()
  const design: Artifact = { ...f4.current, content: FX_CONTENT }
  const review = await reviewOf({ id: 'review-fx', artifact: design, gateNodeId: nodeIdsOf().designGate, createdAt: f4.review!.createdAt,
    findings: ['父级条目没有说明窄屏。', '表格里的组件名需要核对。', '大小写规则未定。', '空结果文案未定。', '筛选保留未说明。', '预期记录方式未定。'],
    details: [
      { quotes: ['在任务列表上方加入搜索框。'], importance: 'important' }, { quotes: ['加入搜索框组件'], importance: 'important' },
      { quotes: ['单元测试覆盖大小写'], importance: 'suggestion' }, { quotes: ['空结果'], importance: 'suggestion' },
      { quotes: ['保留状态筛选'], importance: 'suggestion' }, { quotes: ['记录每个用例的预期'], importance: 'suggestion' },
    ] })
  return { ...f4, current: design, review, reviews: [review], artifacts: f4.artifacts.map((artifact) => (artifact.id === design.id ? design : artifact)) }
}
/** F5 with a nested list: v2 changes the parent line and keeps the nested item. */
async function buildNestedF5(): Promise<GateFixture> {
  const f5 = await buildF5()
  const v1: Artifact = { ...f5.previous!, content: '## Implementation\n- 在任务列表上方加入搜索框。\n  - 搜索框在窄屏下单独一行。\n\n## Verification\n- 单元测试覆盖大小写和空结果。\n' }
  const v2: Artifact = { ...f5.current, content: '## Implementation\n- 在任务列表上方加入搜索框，并显示结果数量。\n  - 搜索框在窄屏下单独一行。\n- 搜索结果为空时显示提示。\n\n## Verification\n- 单元测试覆盖大小写和空结果。\n',
    designRevision: { ...f5.current.designRevision!, previous: await buildDesignRevisionIdentity(v1) } }
  return { ...f5, previous: v1, current: v2, artifacts: f5.artifacts.map((artifact) => (artifact.id === v1.id ? v1 : artifact.id === v2.id ? v2 : artifact)) }
}

describe('GateWorkspace material', () => {
  it('shows the header, the recorded time and the original request line (AC2)', async () => {
    const fixture = await buildF1()
    render(<GateHarness fixture={fixture} spies={gateActionSpies()} facts={gateFacts()} />)
    await settled()
    expect(screen.getByText('需求 v1 · 根据原始需求生成')).toBeInTheDocument()
    expect(screen.getByText(`记录于 ${formatLocalTime(fixture.current.updatedAt)}`)).toBeInTheDocument()
    expect(screen.getByText('原始需求：给任务列表加搜索。…')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '展开' }))
    expect(document.querySelector('.gate-raw-request-full')).toHaveTextContent('给任务列表加搜索。 保留状态筛选，不新增依赖。')
  })
  it('renders the sections in order without a tablist and keeps the material-document class on both pages (AC3, amendment 36)', async () => {
    const f1 = await buildF1()
    const { unmount } = render(<GateHarness fixture={f1} spies={gateActionSpies()} facts={gateFacts()} />)
    await settled()
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(material()).toHaveClass('gate-material', 'material-document')
    expect(Array.from(material().querySelectorAll('.artifact-reading-section h2')).map((heading) => heading.textContent))
      .toEqual(['目标', '验收标准', '非目标', '假设与约束', '风险', '待确认问题'])
    unmount()
    render(<GateHarness fixture={await buildF4()} spies={gateActionSpies()} facts={gateFacts()} />)
    await settled()
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(material('design')).toHaveClass('gate-material', 'material-document')
    expect(within(material('design')).getByText(/以下是验证计划/)).toBeInTheDocument()
  })
  it('keeps the material text exactly the generated text after actions (AC4)', async () => {
    render(<GateHarness fixture={await buildF1()} spies={gateActionSpies()} facts={gateFacts()} />)
    await settled()
    const before = material().textContent
    fireEvent.click(within(card('意见 2 · 重要')).getByRole('button', { name: '采纳' }))
    const question = card('问题 2 · 需要你决定')
    expect(within(question).getByRole('textbox', { name: '问题 2 的回答' })).toHaveAttribute('maxLength', '1000')
    fireEvent.change(within(question).getByRole('textbox', { name: '问题 2 的回答' }), { target: { value: '允许，只读显示。' } })
    fireEvent.click(within(question).getByRole('button', { name: '保存答案' }))
    expect(card('问题 2 · 已回答：允许，只读显示。')).toBeInTheDocument()
    expect(material().textContent).toBe(before)
    expect(material().textContent).not.toContain('修订清单第')
    expect(document.querySelectorAll('.gate-change-bar').length).toBeGreaterThan(0)
  })
  it('adds neither 「新」 from a tag nor 「意见 2」 from a marker to the material text', async () => {
    const { unmount } = render(<GateHarness fixture={await buildF3()} spies={gateActionSpies()} facts={gateFacts()} />)
    await settled('10')
    expect(material().querySelectorAll('.gate-new-tag').length).toBeGreaterThan(0)
    expect(material().textContent).not.toContain('新')
    unmount()
    mockWorkspaceWidth(700)
    render(<GateHarness fixture={await buildF1()} spies={gateActionSpies()} facts={gateFacts()} />)
    await settled()
    expect(material().querySelector('.gate-marker[data-label="意见 2"]')).toHaveAttribute('aria-label', '意见 2 · 重要')
    expect(material().textContent).not.toContain('意见 2')
  })
  it.each(['light', 'dark'])('marks only new blocks with is-new, the description and one overlay tag each (%s theme)', async (theme) => {
    document.documentElement.setAttribute('data-theme', theme)
    const fixture = await buildNestedF5()
    render(<GateHarness fixture={fixture} spies={gateActionSpies()} facts={gateFacts()} />)
    await settled('13')
    const expected = newBlocks(fixture.current.content, fixture.previous!.content)
    const marked = Array.from(material('design').querySelectorAll<HTMLElement>('.is-new'))
    expect(marked.map((element) => `${element.dataset.blockStart}:${element.dataset.blockEnd}`)).toEqual(expected)
    for (const element of marked) expect(element).toHaveAttribute('aria-description', '新加内容')
    const tags = material('design').querySelectorAll('.gate-new-tag')
    expect(tags).toHaveLength(expected.length)
    for (const tag of Array.from(tags)) { expect(tag).toHaveAttribute('aria-hidden', 'true'); expect(tag.childNodes).toHaveLength(0) }
    expect(paragraph('在任务列表上方加入搜索框，并显示结果数量。', 'design')).toHaveClass('is-new')
    expect(paragraph('搜索结果为空时显示提示。', 'design')).toHaveClass('is-new')
    expect(paragraph('搜索框在窄屏下单独一行。', 'design')).not.toHaveClass('is-new')
    expect(paragraph('搜索框在窄屏下单独一行。', 'design')).not.toHaveAttribute('aria-description')
  })
  it('wraps a table and a code block in div.gate-block with the reading block ranges, and bars a table citation after 采纳', async () => {
    const fixture = await buildFx()
    render(<GateHarness fixture={fixture} spies={gateActionSpies()} facts={gateFacts()} />)
    await settled()
    const expected = gateReadingBlocks(FX_CONTENT).filter((block) => block.kind !== 'paragraph').map((block) => `${block.start}:${block.end}`)
    const wrappers = Array.from(material('design').querySelectorAll<HTMLElement>('div.gate-block'))
    expect(wrappers.map((element) => `${element.dataset.blockStart}:${element.dataset.blockEnd}`)).toEqual(expected)
    expect(wrappers[0]!.querySelector(':scope > table')).not.toBeNull()
    expect(wrappers[1]!.querySelector(':scope > pre')).not.toBeNull()
    fireEvent.click(within(card('意见 2 · 重要')).getByRole('button', { name: '采纳' }))
    const bars = Array.from(material('design').querySelectorAll('.gate-change-bar'))
    expect(bars.map((element) => element.getAttribute('data-block'))).toEqual([expected[0]])
    expect(bars[0]).toHaveAttribute('aria-label', '意见 2：已加入修订清单第 1 项')
  })
  it('puts two adopted cards of one block in slots 0 and 1 and lets the later ones share slot 2', async () => {
    render(<GateHarness fixture={await buildFx()} spies={gateActionSpies()} facts={gateFacts()} />)
    await settled()
    for (const number of [3, 4, 5, 6]) fireEvent.click(within(card(`意见 ${number} · 建议`)).getByRole('button', { name: '采纳' }))
    const block = paragraph('单元测试覆盖大小写', 'design')
    const key = `${block.dataset.blockStart}:${block.dataset.blockEnd}`
    const bars = Array.from(material('design').querySelectorAll(`.gate-change-bar[data-block="${key}"]`))
    expect(bars.map((element) => element.getAttribute('data-slot'))).toEqual(['0', '1', '2'])
    expect(bars.map((element) => element.getAttribute('aria-label'))).toEqual([
      '意见 3：已加入修订清单第 1 项', '意见 4：已加入修订清单第 2 项', '意见 5：已加入修订清单第 3 项；意见 6：已加入修订清单第 4 项'])
    for (const element of bars) expect(element.childNodes).toHaveLength(0)
  })
})

describe('GateWorkspace hover and performance', () => {
  it('links a card and its blocks both ways without a commit inside the material column (AC10, Profiler)', async () => {
    render(<GateHarness fixture={await buildF1()} spies={gateActionSpies()} facts={gateFacts()} />)
    await settled()
    const commits = vi.fn<ProfilerOnRenderCallback>()
    observeGateMaterialCommitsForTests(commits)
    const item = paragraph('输入关键词后，列表只显示标题包含关键词的任务。')
    expect(item.parentElement?.tagName).toBe('LI')
    fireEvent.mouseEnter(card('意见 2 · 重要'))
    expect(item).toHaveClass('is-linked')
    fireEvent.mouseLeave(card('意见 2 · 重要'))
    expect(item).not.toHaveClass('is-linked')
    fireEvent.mouseOver(item)
    expect(card('意见 2 · 重要')).toHaveClass('is-linked')
    expect(card('意见 3 · 建议')).not.toHaveClass('is-linked')
    fireEvent.mouseLeave(material())
    expect(card('意见 2 · 重要')).not.toHaveClass('is-linked')
    expect(commits).not.toHaveBeenCalled()
  })
  it('adopting a finding in the wide layout commits no material section and bars both cited blocks (AC15)', async () => {
    render(<GateHarness fixture={await buildF1()} spies={gateActionSpies()} facts={gateFacts()} />)
    await settled()
    const commits = vi.fn<ProfilerOnRenderCallback>()
    observeGateMaterialCommitsForTests(commits)
    fireEvent.click(within(card('意见 2 · 重要')).getByRole('button', { name: '采纳' }))
    await act(async () => {})
    expect(commits.mock.calls.map((call) => call[0])).not.toContain('gate-material-section')
    const keys = ['输入关键词后，列表只显示标题包含关键词的任务。', '没有匹配时显示「暂无匹配任务」。']
      .map((text) => paragraph(text)).map((p) => `${p.dataset.blockStart}:${p.dataset.blockEnd}`)
    const bars = Array.from(material().querySelectorAll('.gate-change-bar'))
    expect(bars.map((element) => element.getAttribute('data-block'))).toEqual(keys)
    for (const element of bars) expect(element).toHaveAttribute('aria-label', '意见 2：已加入修订清单第 1 项')
  })
})

describe('GateWorkspace cards', () => {
  it('passes distinct material ids to 「讨论」 for questions and findings', async () => {
    const fixture = await buildF1()
    const spies = gateActionSpies()
    render(<GateHarness fixture={fixture} spies={spies} facts={gateFacts()} />)
    await settled()
    fireEvent.click(within(card('问题 1 · 重要 · 需要你决定')).getByRole('button', { name: '讨论' }))
    fireEvent.click(within(card('问题 2 · 需要你决定')).getByRole('button', { name: '讨论' }))
    fireEvent.click(within(card('意见 2 · 重要')).getByRole('button', { name: '讨论' }))
    expect(spies.onDiscuss.mock.calls.map((call) => call[0].materialId)).toEqual([
      `${fixture.current.id}#question-1`, `${fixture.current.id}#question-2`, `${fixture.current.id}#review-review-f1-1`])
  })
  it('shows a history version with its read-only list and 「复制全部」', async () => {
    const fixture = await buildF3()
    storeRevisionLists([await listFor(fixture.previous!, [{ type: 'addOwn', text: '旧版本上的修改。' }])])
    const spies = gateActionSpies()
    render(<GateHarness fixture={fixture} readingArtifactId={fixture.previous!.id} spies={spies} facts={gateFacts()} />)
    await settled('10')
    expect(screen.getByText('这是历史版本 需求 v1；当前是需求 v2。这里只能查看。')).toBeInTheDocument()
    const history = screen.getByTestId('gate-history-list')
    expect(within(history).getByText('已提交（1 项），内容见「版本与修订意见历史」')).toBeInTheDocument()
    fireEvent.click(within(history).getByRole('button', { name: '复制全部' }))
    await waitFor(() => expect(spies.onCopy).toHaveBeenCalledWith('修订清单（共 1 项，针对需求 v1）：\n1. 我添加的：旧版本上的修改。'))
    expect(screen.getByText('这是需求 v1 的审查，只能查看。')).toBeInTheDocument()
    expect(within(card('意见 2 · 重要')).queryByRole('button', { name: '采纳' })).toBeNull()
  })
})

describe('GateWorkspace layout', () => {
  it('decides wide or narrow from the container width before paint', async () => {
    const fixture = await buildF1()
    mockWorkspaceWidth(700)
    const { container, unmount } = render(<GateHarness fixture={fixture} spies={gateActionSpies()} facts={gateFacts()} />)
    expect(container.querySelector('.gate-workspace')).toHaveAttribute('data-layout', 'narrow')
    expect(container.querySelector('.gate-margin')).toBeNull()
    unmount()
    vi.restoreAllMocks()
    mockWorkspaceWidth(800)
    const second = render(<GateHarness fixture={fixture} spies={gateActionSpies()} facts={gateFacts()} />)
    expect(second.container.querySelector('.gate-workspace')).toHaveAttribute('data-layout', 'wide')
    const workspace = second.container.querySelector('.gate-workspace') as HTMLElement
    expect(workspace.style.gridTemplateColumns).toBe('minmax(520px, 1fr) minmax(240px, 270px)')
    expect(workspace.style.columnGap).toBe('12px')
  })
  it('keeps a half-typed answer when the layout turns narrow, and shows it in the popover (AC37)', async () => {
    mockWorkspaceWidth(800)
    render(<GateHarness fixture={await buildF1()} spies={gateActionSpies()} facts={gateFacts()} />)
    await settled()
    fireEvent.change(within(card('问题 2 · 需要你决定')).getByRole('textbox', { name: '问题 2 的回答' }), { target: { value: '允许，但只读' } })
    const workspace = document.querySelector('.gate-workspace')!
    resize(workspace, 700)
    expect(workspace).toHaveAttribute('data-layout', 'narrow')
    fireEvent.click(material().querySelector('.gate-marker[data-card-id="question-2"]')!)
    const dialog = screen.getByRole('dialog', { name: '问题 2' })
    expect(within(dialog).getByRole('textbox', { name: '问题 2 的回答' })).toHaveValue('允许，但只读')
    resize(workspace, 800)
    expect(workspace).toHaveAttribute('data-layout', 'wide')
    expect(within(card('问题 2 · 需要你决定')).getByRole('textbox', { name: '问题 2 的回答' })).toHaveValue('允许，但只读')
  })
  it('opens marker popovers, closes them with Esc and outside clicks and returns focus (AC38)', async () => {
    mockWorkspaceWidth(700)
    render(<GateHarness fixture={await buildF1()} spies={gateActionSpies()} facts={gateFacts()} />)
    await settled()
    const marker = material().querySelector<HTMLElement>('.gate-marker[data-card-id="finding-1"]')!
    fireEvent.click(marker)
    expect(within(screen.getByRole('dialog', { name: '意见 2 · 重要' })).getByRole('button', { name: '采纳' })).toBeInTheDocument()
    // The card starts with its title, so the popover header shows only the close button (review finding 3).
    expect(within(screen.getByRole('dialog', { name: '意见 2 · 重要' })).getAllByText('意见 2 · 重要')).toHaveLength(1)
    expect(within(screen.getByRole('dialog', { name: '意见 2 · 重要' })).getByRole('button', { name: '关闭意见 2 · 重要' })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(marker).toHaveFocus()
    fireEvent.click(marker)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.pointerDown(document.body)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(marker).toHaveFocus())
  })
  it('puts the marker of a finding on a parent item inside its p, before the nested list', async () => {
    mockWorkspaceWidth(700)
    render(<GateHarness fixture={await buildFx()} spies={gateActionSpies()} facts={gateFacts()} />)
    await settled()
    const marker = material('design').querySelector('.gate-marker[data-card-id="finding-0"]')!
    const parent = marker.closest('p')!
    expect(parent).toBe(paragraph('在任务列表上方加入搜索框。', 'design'))
    expect(parent.nextElementSibling?.tagName).toBe('UL')
    expect(parent.nextElementSibling).toHaveTextContent('搜索框在窄屏下单独一行。')
  })
  it('「下一条 ↓」 in the narrow layout focuses and flashes the marker without opening it', async () => {
    mockWorkspaceWidth(700)
    render(<GateHarness fixture={await buildF1()} spies={gateActionSpies()} facts={gateFacts()} />)
    await settled()
    fireEvent.click(within(bar()).getByRole('button', { name: '下一条 ↓' }))
    // 意见 5 has no located citation, so it comes first, in the overview row above the material.
    await waitFor(() => expect(document.activeElement).toHaveAttribute('data-card-id', 'finding-4'))
    expect(document.activeElement).toHaveClass('gate-marker', 'is-flashing')
    expect(document.activeElement!.closest('.gate-margin-head')).not.toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('consumes a focus request made on another tab after the first placement pass', async () => {
    const spies = gateActionSpies()
    render(<GateHarness fixture={await buildF1()} spies={spies} facts={gateFacts()} tab="materials" />)
    await settled()
    expect(document.querySelector('.gate-workspace')).toBeNull()
    fireEvent.click(within(bar()).getByRole('button', { name: '下一条 ↓' }))
    expect(spies.showCurrentWork).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(document.activeElement).toHaveAttribute('data-card-id', 'finding-4'))
    expect(document.activeElement).toHaveClass('gate-card', 'is-flashing')
    fireEvent.click(within(bar()).getByRole('button', { name: '下一条 ↓' }))
    await waitFor(() => expect(document.activeElement).not.toHaveAttribute('data-card-id', 'finding-4'))
  })
})
