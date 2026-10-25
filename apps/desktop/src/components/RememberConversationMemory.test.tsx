import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RememberConversationMemory } from './RememberConversationMemory'

describe('RememberConversationMemory', () => {
  it('keeps manual save optional and binds edited text to the displayed message', async () => {
    const remember = vi.fn().mockResolvedValue({ projectId: 'project-1', configuration: null, endpoint: null, jobs: [], decisions: [] })
    render(<RememberConversationMemory projectId="project-1" conversationId="chat-1" messageId="message-1" text="以后先说结果。" remember={remember} />)
    expect(remember).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '记住这条' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '解释修改时先说行为变化。' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /固定保留/ }))
    fireEvent.click(screen.getByRole('button', { name: '保存这条经验' }))
    await waitFor(() => expect(remember).toHaveBeenCalledWith({ projectId: 'project-1', conversationId: 'chat-1', messageId: 'message-1', statement: '解释修改时先说行为变化。', pin: true }))
    expect(await screen.findByText(/已提交记忆请求/)).toBeInTheDocument()
    expect(screen.queryByText('已保存为有效记忆')).not.toBeInTheDocument()
  })
  it('does not offer the action when the host does not implement it', () => {
    render(<RememberConversationMemory projectId="project-1" conversationId="chat-1" messageId="message-1" text="text" remember={undefined} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
