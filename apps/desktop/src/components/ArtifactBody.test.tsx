import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { ArtifactBody, partitionArtifact } from './ArtifactBody'
afterEach(cleanup)
const source = '# Implementation\n\n## 影响范围\n\n实现正文。\n\n```md\n# Verification\n不是章节\n```\n\n> # 引用的标题\n\n- ### 列表中的标题\n\n# Verification\n\n## 测试计划\n\n|场景|预期|\n|---|---|\n|刷新|全部|\n\n# Delivery and rollback\n\n回退正文。\n\n## 未知旧版字段\n\n不能丢失的原文。\n\n## Repository Findings\n\n核验记录。\n\n> Source: local-agent · Provider: p · Model: m · Generated: today\n'
it('partitions Markdown headings without splitting fences, quotes or lists and retains every source byte', () => {
  const sections = partitionArtifact(source)
  expect(sections.map((section) => section.title)).toEqual(['实现方案', '影响范围', '验证计划', '测试计划', '交付与回退', '未知旧版字段', '代码调查记录', '生成来源与模型记录'])
  expect(sections.map((section) => section.markdown).join('')).toBe(source.trimEnd())
  for (const section of sections) expect(source.slice(section.start, section.start + section.markdown.length)).toBe(section.markdown)
  expect(sections.find((section) => section.title === '未知旧版字段')?.group).toBe('delivery')
})
it('shows implementation, verification and rollback as sibling reading groups, with exact raw text available', () => {
  render(<ArtifactBody content={source} kind="design" section="content" />)
  expect(screen.getByText('实现正文。')).toBeVisible()
  expect(screen.queryByText('回退正文。')).toBeNull()
  fireEvent.click(screen.getByRole('tab', { name: '验证计划' }))
  expect(screen.getByRole('table')).toBeVisible()
  expect(screen.getByText(/计划不等于测试已通过/)).toBeVisible()
  fireEvent.keyDown(screen.getByRole('tab', { name: '验证计划' }), { key: 'ArrowRight' })
  expect(screen.getByText('回退正文。')).toBeVisible()
  expect(screen.getByText('不能丢失的原文。')).toBeVisible()
  expect(screen.queryByText('核验记录。')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '查看原文' }))
  expect(document.querySelector('.message-plain')?.textContent).toBe(source)
})
it('keeps unknown legacy sections readable and isolates evidence without rewriting stored content', () => {
  const { rerender } = render(<ArtifactBody content={'Legacy text\n\nUnknown heading\n---\n\n完整正文'} />)
  expect(screen.getByText('完整正文')).toBeVisible()
  rerender(<ArtifactBody content={source} kind="design" section="evidence" />)
  expect(screen.getByText('核验记录。')).toBeVisible()
  expect(screen.queryByText('实现正文。')).toBeNull()
})
it('omits explicitly empty auxiliary headings but retains them in the exact source', () => {
  const content = '# Implementation\n\n实现正文。\n\n## Repository Open Questions\n\n- None recorded.\n\n## Repository Findings\n\n\n# Delivery and rollback\n\n回退方法。'
  render(<ArtifactBody content={content} kind="design" section="content" />)
  fireEvent.click(screen.getByRole('tab', { name: '交付与风险' }))
  expect(screen.queryByRole('heading', { name: '仓库待确认问题' })).toBeNull()
  expect(screen.getByText('回退方法。')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '查看原文' }))
  expect(document.querySelector('.message-plain')?.textContent).toBe(content)
})
