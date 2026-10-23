import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { designRevisionFixture } from '../testing/design-revision'
import { DesignRevisionPanel } from './DesignRevisionPanel'

describe('design revision choice', () => {
  it('waits for explicit proposal selection and a click; exposes the full amendment for review', async () => {
    const f = await designRevisionFixture()
    const generate = vi.fn()
    render(<DesignRevisionPanel previous={f.design} proposals={[f.proposal]} onGenerate={generate} disabled={false} generating={false} />)
    expect(generate).not.toHaveBeenCalled()
    const button = screen.getByRole('button', { name: '根据提案生成新版方案' })
    expect(button).toBeDisabled()
    expect(screen.getByText(f.proposal.content)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: f.proposal.title }))
    expect(generate).not.toHaveBeenCalled()
    fireEvent.click(button)
    expect(generate).toHaveBeenCalledExactlyOnceWith([f.proposal.id])
  })

  it('clears a prior selection when the proposal changes and blocks writes during generation', async () => {
    const f = await designRevisionFixture()
    const generate = vi.fn()
    const props = { previous: f.design, proposals: [f.proposal], onGenerate: generate, disabled: false, generating: false }
    const { rerender } = render(<DesignRevisionPanel {...props} />)
    fireEvent.click(screen.getByRole('checkbox'))
    rerender(<DesignRevisionPanel {...props} proposals={[{ ...f.proposal, content: 'new opinion' }]} />)
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    rerender(<DesignRevisionPanel {...props} generating disabled />)
    expect(screen.getByRole('checkbox')).toBeDisabled()
    expect(screen.getByRole('button', { name: '正在生成新版方案…' })).toBeDisabled()
    expect(generate).not.toHaveBeenCalled()
  })

  it('renders a saved amendment as Markdown and exposes its exact source without selecting or generating', async () => {
    const f = await designRevisionFixture()
    const generate = vi.fn()
    const content = '# 任务编辑\n\n- 保留 **已完成** 状态\n\n```ts\nupdateTask(id, title)\n```\n'
    const { container } = render(<DesignRevisionPanel previous={f.design} proposals={[{ ...f.proposal, content }]} onGenerate={generate} disabled={false} generating={false} />)
    fireEvent.click(screen.getByText(/查看提案正文/))
    expect(screen.getByRole('heading', { name: '任务编辑', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('已完成').tagName).toBe('STRONG')
    fireEvent.click(screen.getByRole('button', { name: '查看原文' }))
    expect(container.querySelector('.message-plain')?.textContent).toBe(content)
    fireEvent.click(screen.getByRole('button', { name: '返回排版' }))
    expect(screen.getByRole('heading', { name: '任务编辑' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    expect(generate).not.toHaveBeenCalled()
  })
})
