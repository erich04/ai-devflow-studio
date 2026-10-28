import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CodingQuestionRequest } from '@ai-devflow/shared'
import { CodingQuestionPanel } from './CodingQuestionPanel'

const question: CodingQuestionRequest = { version: 1, id: 'que-1', revision: 'revision', codingRunId: 'coding-1', projectId: 'project-1', managedWorkspaceId: 'workspace-1', sessionId: 'ses-1', status: 'pending',
  requestedAt: '2026-10-16T00:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z',
  questions: [{ header: 'Color', question: 'Choose a color', options: [{ label: 'Blue', description: 'Blue color' }] },
    { header: 'Targets', question: 'Choose targets', multiple: true, options: [{ label: 'Web', description: 'Browser' }, { label: 'Desktop', description: 'App' }], custom: false }] }

describe('CodingQuestionPanel', () => {
  it('requires explicit answers, supports custom and ordered multi-select, and submits once', () => {
    const reply = vi.fn()
    render(<CodingQuestionPanel question={question} active busy={false} onReply={reply} />)
    expect(screen.getByRole('button', { name: '发送回答' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Color：自定义回答'), { target: { value: 'Green' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /Web/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Desktop/ }))
    fireEvent.click(screen.getByRole('button', { name: '发送回答' }))
    expect(reply).toHaveBeenCalledWith({ kind: 'answer', answers: [['Green'], ['Web', 'Desktop']] })
    expect(screen.queryByRole('button', { name: /批准/ })).toBeNull()
  })
  it.each(['expired', 'invalidated', 'delivery_unknown', 'sending', 'answered'] as const)('never resends a %s question', (status) => {
    const reply = vi.fn()
    render(<CodingQuestionPanel question={{ ...question, status }} active busy={false} onReply={reply} />)
    expect(screen.queryByRole('button', { name: '发送回答' })).toBeNull()
    expect(reply).not.toHaveBeenCalled()
  })
  it('lets the user dismiss all questions without approving anything', () => {
    const reply = vi.fn()
    render(<CodingQuestionPanel question={question} active busy={false} onReply={reply} />)
    fireEvent.click(screen.getByRole('button', { name: '跳过这些问题' }))
    expect(reply).toHaveBeenCalledWith({ kind: 'dismiss' })
  })
})
