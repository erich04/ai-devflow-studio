import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ProposalBody } from './ProposalBody'

describe('proposal reading', () => {
  it.each(['# **编辑任务**\n\n正文', '编辑任务\n===\n\n正文'])('avoids a duplicate leading title without removing it from the raw source', (content) => {
    const { container } = render(<ProposalBody title="编辑任务" content={content} />)
    expect(screen.getByRole('heading', { level: 1, name: '编辑任务' })).toBeVisible()
    expect(screen.getAllByText('编辑任务')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '查看原文' }))
    expect(container.querySelector('.message-plain')?.textContent).toBe(content)
    fireEvent.click(screen.getByRole('button', { name: '返回排版' }))
    expect(screen.getByRole('heading', { level: 1, name: '编辑任务' })).toBeVisible()
  })

  it.each(['## 编辑任务\n\n正文', '```md\n# 编辑任务\n```', '# 其他标题\n\n正文', '前言\n\n# 编辑任务'])('retains the card title when the body does not start with that document title', (content) => {
    const { container } = render(<ProposalBody title="编辑任务" content={content} />)
    expect(container.querySelector('.proposal-body-title')).toHaveTextContent('编辑任务')
  })

  it('uses the conversation link, image and HTML policies without discarding the inspectable source', () => {
    const content = '[文档](https://example.com/docs) [危险](javascript:alert%281%29) [本地文件](file:///etc/hosts)\n\n![图示](https://example.com/tracker.png)\n\n<script>alert(1)</script>'
    const { container } = render(<ProposalBody content={content} />)
    expect(screen.getByRole('link', { name: '文档' })).toHaveAttribute('href', 'https://example.com/docs')
    expect(screen.getByRole('link', { name: '文档' })).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.queryByRole('link', { name: '危险' })).toBeNull()
    expect(screen.queryByRole('link', { name: '本地文件' })).toBeNull()
    expect(screen.getByRole('link', { name: '图片：图示' })).toHaveAttribute('href', 'https://example.com/tracker.png')
    expect(container.querySelector('img, script')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '查看原文' }))
    expect(container.querySelector('.message-plain')?.textContent).toBe(content)
  })
})
