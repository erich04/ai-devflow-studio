import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createWorkflowRunFromRequest } from '@ai-devflow/shared'
import { WorkbenchWorkspace } from './WorkbenchWorkspace'
import type { ConversationCommand, WorkbenchConversation } from '../electron/workbench-conversation-contract'

const run = createWorkflowRunFromRequest({ runId: 'run-ui', title: '清理任务', request: '实现清理', projectId: 'local-1', creatorId: 'user-1', branchName: 'ai/clear', now: '2026-09-16T10:00:00Z' }).run
function fixture() {
  let sessions: WorkbenchConversation[] = []
  const commands: ConversationCommand[] = []
  let listener: ((projectId: string) => void) | undefined
  const api = {
    onWorkbenchConversationUpdated: (fn: (projectId: string) => void) => { listener = fn; return () => { listener = undefined } },
    workbenchConversation: vi.fn(async (input: ConversationCommand) => {
      commands.push(input)
      if (input.type === 'create') {
        const session: WorkbenchConversation = { id: `chat-${sessions.length + 1}`, localProjectId: input.projectId, title: input.title ?? `对话 ${sessions.length + 1}`, version: 1, isOpen: true, inputDraft: input.inputDraft ?? '', memory: '', status: 'idle', messages: [], createdAt: run.createdAt, updatedAt: run.updatedAt }
        sessions.push(session)
        return { conversations: structuredClone(sessions), conversationId: session.id }
      }
      const session = 'conversationId' in input ? sessions.find((item) => item.id === input.conversationId) : undefined
      if (input.type === 'update' && session) {
        if (input.isOpen !== undefined) session.isOpen = input.isOpen
        if (input.inputDraft !== undefined) session.inputDraft = input.inputDraft
        if (input.title !== undefined) session.title = input.title
        if (input.memory !== undefined) session.memory = input.memory
        session.version++
      }
      if (input.type === 'send' && session) {
        session.inputDraft = ''; session.status = 'awaiting_answer'; session.version++
        session.messages.push({ id: 'user-' + session.id + '-' + session.version, role: 'user', text: input.text, createdAt: run.createdAt }, { id: 'answer-' + session.id + '-' + session.version, role: 'assistant', text: '可以查询其他阶段。测试尚未执行。', createdAt: run.createdAt,
          actions: [{ label: '查看测试节点', runId: run.id, nodeId: run.nodes.find((node) => node.kind === 'test')!.id, section: '测试证据' }],
          question: { prompt: '需要支持撤销吗？', options: ['需要', '不需要'] } })
      }
      if (input.type === 'cancel' && session) { session.status = 'cancelled'; session.version++ }
      return { conversations: structuredClone(sessions.filter((item) => item.localProjectId === input.projectId)) }
    }),
  }
  const onNavigate = vi.fn()
  const props = { api, projectId: run.projectId, projectName: '任务清单', runs: [run], providerId: 'provider', providerName: 'DeepSeek', request: { serial: 0, type: 'details' as const }, onNavigate, onConfigure: vi.fn(), children: <div data-testid="preserved-inspector"><label>节点原有表单<input aria-label="节点原有表单" defaultValue="待确认" /></label></div> }
  return { api, props, commands, onNavigate, get sessions() { return sessions }, push: () => listener?.(run.projectId) }
}

describe('workbench tabs and independent conversation interaction', () => {
  it('keeps the existing inspector mounted, with separate conversations and close/reopen history', async () => {
    const f = fixture()
    const view = render(<WorkbenchWorkspace {...f.props} />)
    fireEvent.change(screen.getByLabelText('节点原有表单'), { target: { value: '尚未提交的节点编辑' } })
    fireEvent.click(screen.getByRole('button', { name: '新建对话' }))
    await screen.findByRole('tab', { name: '对话 1' })
    fireEvent.change(screen.getByRole('textbox', { name: '对话内容' }), { target: { value: '仅第一条会话的输入' } })
    fireEvent.click(screen.getByRole('button', { name: '新建对话' }))
    await screen.findByRole('tab', { name: '对话 2' })
    expect(screen.getByRole('textbox', { name: '对话内容' })).toHaveValue('')
    fireEvent.click(screen.getByRole('tab', { name: '对话 1' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: '对话内容' })).toHaveValue('仅第一条会话的输入'))
    fireEvent.click(screen.getByRole('button', { name: '关闭会话 Tab：对话 1' }))
    await waitFor(() => expect(screen.queryByRole('tab', { name: '对话 1' })).toBeNull())
    expect(screen.getByLabelText('节点原有表单')).toHaveValue('尚未提交的节点编辑')
    fireEvent.click(screen.getByRole('button', { name: '会话历史' }))
    fireEvent.click(await screen.findByRole('button', { name: /对话 1.*可以继续提问/ }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: '对话内容' })).toHaveValue('仅第一条会话的输入'))
    view.rerender(<WorkbenchWorkspace {...f.props} request={{ serial: 1, type: 'details' }} />)
    expect(screen.getByRole('tab', { name: '节点详情' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('tab', { name: '对话 1' }))
    expect(screen.getByRole('textbox', { name: '对话内容' })).toHaveValue('仅第一条会话的输入')
  })

  it('starts a discussion without sending or binding it and navigates to another node from a rich response', async () => {
    const f = fixture()
    const view = render(<WorkbenchWorkspace {...f.props} />)
    view.rerender(<WorkbenchWorkspace {...f.props} request={{ serial: 1, type: 'discussion', prompt: '讨论需求节点，也可以问整个项目。' }} />)
    const composer = await screen.findByRole('textbox', { name: '对话内容' })
    expect(composer).toHaveValue('讨论需求节点，也可以问整个项目。')
    expect(f.commands.some((command) => command.type === 'send')).toBe(false)
    fireEvent.change(composer, { target: { value: '测试阶段进展如何？' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
    fireEvent.click(await screen.findByRole('button', { name: '查看测试节点 ↗' }))
    expect(f.onNavigate).toHaveBeenCalledWith(expect.objectContaining({ runId: run.id, nodeId: run.nodes.find((node) => node.kind === 'test')!.id, section: '测试证据' }))
    expect(screen.getByRole('tab', { name: '节点详情' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('tab', { name: /对话 1/ }))
    expect(screen.getByText('测试阶段进展如何？')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '不需要' }))
    expect(screen.getByRole('textbox', { name: '对话内容' })).toHaveValue('不需要')
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
    await waitFor(() => expect(f.commands).toContainEqual(expect.objectContaining({ type: 'send', text: '不需要', answerToMessageId: expect.stringContaining('answer-chat-1-') })))
  })

  it('persists private memory and does not expose one project’s sessions after switching projects', async () => {
    const f = fixture()
    const view = render(<WorkbenchWorkspace {...f.props} />)
    fireEvent.click(screen.getByRole('button', { name: '新建对话' }))
    await screen.findByRole('tab', { name: '对话 1' })
    fireEvent.click(screen.getByRole('button', { name: /上下文与会话记忆/ }))
    const memory = screen.getByRole('textbox', { name: '仅本会话记忆' })
    fireEvent.change(memory, { target: { value: '私有约束' } }); fireEvent.blur(memory)
    await waitFor(() => expect(f.sessions[0]?.memory).toBe('私有约束'))
    view.rerender(<WorkbenchWorkspace {...f.props} projectId="other-project" projectName="另一个项目" />)
    await waitFor(() => expect(screen.queryByRole('tab', { name: '对话 1' })).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: '会话历史' }))
    expect(screen.queryByText('私有约束')).toBeNull()
    expect(within(screen.getByRole('region', { name: '会话历史记录' })).getByText('还没有对话。点击 ＋ 开始。')).toBeVisible()
  })

  it('shows live busy state and cancellation without sending an extra user message', async () => {
    const f = fixture()
    render(<WorkbenchWorkspace {...f.props} />)
    fireEvent.click(screen.getByRole('button', { name: '新建对话' }))
    await screen.findByRole('tab', { name: '对话 1' })
    f.sessions[0]!.status = 'running'; f.sessions[0]!.version++
    await act(async () => f.push())
    fireEvent.click(await screen.findByRole('button', { name: '停止调查' }))
    await waitFor(() => expect(f.sessions[0]?.status).toBe('cancelled'))
    expect(f.commands.filter((command) => command.type === 'send')).toHaveLength(0)
  })
})
