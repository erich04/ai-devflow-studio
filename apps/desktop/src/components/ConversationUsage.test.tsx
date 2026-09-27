import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { WorkbenchConversation, ConversationMessage } from '../../electron/workbench-conversation-contract'
import { ConversationUsage, summarizeConversationUsage } from './ConversationUsage'
afterEach(cleanup)
const session = (messages: ConversationMessage[]): WorkbenchConversation => ({ id: 'c', localProjectId: 'p', title: '会话', version: 1, isOpen: true, inputDraft: '保留草稿', memory: '', status: 'idle', messages, createdAt: '', updatedAt: '' })
const message = (usage?: ConversationMessage['usage']): ConversationMessage => ({ id: 'm', role: 'notice', text: '', createdAt: '', provider: { id: 'p', model: 'm' }, ...(usage ? { usage } : {}) })
it('distinguishes no call, unreported call, a real zero and partial usage without inventing missing tokens', () => {
  expect(summarizeConversationUsage(session([]))).toMatchObject({ reported: 0, status: '暂无用量记录' })
  expect(summarizeConversationUsage(session([message()]))).toMatchObject({ reported: 0, status: '模型未返回用量' })
  expect(summarizeConversationUsage(session([message({ totalTokens: 0 })]))).toMatchObject({ reported: 1, total: 0, partial: false })
  expect(summarizeConversationUsage(session([message({ inputTokens: 100 }), message({ totalTokens: 45 }), message()]))).toMatchObject({ total: 145, partial: true, input: 100, output: undefined })
})
it('opens accessible details, switches totals with the conversation and returns focus on Escape', () => {
  const { rerender } = render(<ConversationUsage session={session([message({ inputTokens: 49000, outputTokens: 78, totalTokens: 49078 }), message()])} />)
  const trigger = screen.getByRole('button', { name: /当前会话用量/ })
  expect(trigger).toHaveTextContent('用量 49.1k部分')
  fireEvent.click(trigger)
  expect(screen.getByRole('dialog')).toHaveTextContent('49,078')
  expect(screen.getByRole('dialog')).toHaveTextContent('不代表上下文窗口占用')
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(trigger).toHaveFocus()
  rerender(<ConversationUsage session={{ ...session([message({ totalTokens: 5 })]), id: 'other' }} />)
  expect(trigger).toHaveTextContent('用量 5')
})
