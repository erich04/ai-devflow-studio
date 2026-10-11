import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { CodingHarnessSnapshot } from '@ai-devflow/shared'
import { NativeCodingHarnessPanel } from './NativeCodingHarnessPanel'

it('shows a user question separately from permissions and sends an answer for that exact objective', async () => {
  const snapshot: CodingHarnessSnapshot = { protocolVersion: 2, codingRunId: 'coding', sessionId: 'session', status: 'waiting_input', version: 7, objectiveVersion: 2,
    steps: 4, activeMilliseconds: 1000, messages: [], question: { id: 'question', text: '保留用户原有的改动吗？', options: ['保留', '丢弃'] }, evidence: [], children: [],
    cost: { inputTokens: 100, outputTokens: 50, costUsd: null, unknownAttempts: 0, pendingSettlements: 1 } }
  const command = vi.fn(async () => snapshot)
  render(<NativeCodingHarnessPanel codingRunId="coding" api={{ codingHarness: command }} />)
  await screen.findByText('保留用户原有的改动吗？')
  expect(screen.queryByText('批准最终改动')).toBeNull()
  fireEvent.change(screen.getByLabelText('补充说明或回答'), { target: { value: '保留' } })
  fireEvent.click(screen.getByRole('button', { name: '回答并继续' }))
  await waitFor(() => expect(command).toHaveBeenCalledWith(expect.objectContaining({ protocolVersion: 2, type: 'reply', codingRunId: 'coding', expectedVersion: 7, questionId: 'question', objectiveVersion: 2, text: '保留' })))
})
