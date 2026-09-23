import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createWorkflowRunFromRequest } from '@ai-devflow/shared'
import { WorkbenchWorkspace } from './WorkbenchWorkspace'
import type { ConversationCommand, WorkbenchConversation } from '../electron/workbench-conversation-contract'

const run = createWorkflowRunFromRequest({ runId: 'run-ui', title: '清理任务', request: '实现清理', projectId: 'local-1', creatorId: 'user-1', branchName: 'ai/clear', now: '2026-09-16T10:00:00Z' }).run
function fixture() {
  localStorage.clear()
  let sessions: WorkbenchConversation[] = []
  const commands: ConversationCommand[] = []
  let listener: ((projectId: string) => void) | undefined
  const api = {
    onWorkbenchConversationUpdated: (fn: (projectId: string) => void) => { listener = fn; return () => { listener = undefined } },
    workbenchConversation: vi.fn(async (input: ConversationCommand) => {
      commands.push(input)
      if (input.type === 'create') {
        const session: WorkbenchConversation = { id: `chat-${sessions.length + 1}`, localProjectId: input.projectId, title: input.title ?? `对话 ${sessions.length + 1}`, version: 1, isOpen: true, inputDraft: input.inputDraft ?? '', memory: '', status: 'idle', messages: [], createdAt: run.createdAt, updatedAt: run.updatedAt }
        session.executor = input.executor ?? 'direct-provider'
        sessions.push(session)
        return { conversations: structuredClone(sessions), conversationId: session.id }
      }
      const session = 'conversationId' in input ? sessions.find((item) => item.id === input.conversationId) : undefined
      if (input.type === 'update' && session) {
        if (input.isOpen !== undefined) session.isOpen = input.isOpen
        if (input.inputDraft !== undefined) session.inputDraft = input.inputDraft
        if (input.title !== undefined) session.title = input.title
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

function openDetails(name: string) {
  fireEvent.contextMenu(screen.getByTitle(name))
  fireEvent.click(screen.getByRole('menuitem', { name: '会话详情' }))
  return screen.getByRole('dialog', { name: '会话详情' })
}
function expectExecutor(name: string, executor: string) {
  expect(openDetails(name)).toHaveTextContent(executor)
  fireEvent.click(screen.getByRole('button', { name: '关闭详情' }))
}

describe('workbench tabs and independent conversation interaction', () => {
  it('opens an inactive tab’s details without remounting the active chat or changing its draft, scroll or calls', async () => {
    const f = fixture()
    await f.api.workbenchConversation({ type: 'create', projectId: run.projectId, title: '第一段对话' })
    await f.api.workbenchConversation({ type: 'create', projectId: run.projectId, title: '另一段对话', executor: 'opencode' })
    const other = f.sessions[1]!
    other.messages.push({ id: 'call', role: 'notice', text: '模型调用', createdAt: run.createdAt, provider: { id: 'old', model: 'historical-model', executor: 'opencode' }, usage: { inputTokens: 12, outputTokens: 3, totalTokens: 15 }, failure: { phase: 'provider', code: 'recovered', httpStatus: 502 } })
    localStorage.setItem(`devflow-workbench-tab:${run.projectId}`, 'chat-1')
    render(<WorkbenchWorkspace {...f.props} />)
    const input = await screen.findByRole('textbox', { name: '对话内容' })
    fireEvent.change(input, { target: { value: '当前还没发的草稿' } })
    const messages = screen.getByLabelText('当前会话消息')
    Object.defineProperties(messages, { scrollHeight: { configurable: true, value: 2000 }, clientHeight: { configurable: true, value: 500 } })
    messages.scrollTop = 150; fireEvent.scroll(messages)
    expect(document.querySelector('.conversation-head')).toBeNull()
    const target = screen.getByRole('tab', { name: '另一段对话' })
    const dialog = openDetails('另一段对话')
    expect(within(dialog).getByLabelText('会话名称')).toHaveValue('另一段对话')
    expect(dialog).toHaveTextContent('OpenCode')
    expect(dialog).toHaveTextContent('historical-model')
    expect(dialog).toHaveTextContent('DeepSeek（Agents 当前配置）')
    fireEvent.click(within(dialog).getByText('模型调用设置记录'))
    expect(dialog).toHaveTextContent('总计 15 tokens')
    expect(dialog).toHaveTextContent('HTTP 502')
    expect(screen.getByRole('tab', { name: '第一段对话' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(target).toHaveFocus()
    expect(screen.getByLabelText('对话内容')).toBe(input)
    expect(input).toHaveValue('当前还没发的草稿')
    expect(screen.getByLabelText('当前会话消息')).toBe(messages)
    expect(messages.scrollTop).toBe(150)
    expect(f.commands.some((command) => ['send', 'retry', 'cancel', 'publish'].includes(command.type))).toBe(false)
  })

  it('supports keyboard menus, explicit rename failure/retry and no accidental rename on close', async () => {
    const f = fixture()
    await f.api.workbenchConversation({ type: 'create', projectId: run.projectId, title: '键盘会话' })
    render(<WorkbenchWorkspace {...f.props} />)
    const tab = await screen.findByRole('tab', { name: '键盘会话' })
    tab.focus(); fireEvent.keyDown(tab, { key: 'F10', shiftKey: true })
    expect(screen.getByRole('menuitem', { name: '会话详情' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(tab).toHaveFocus()
    fireEvent.keyDown(tab, { key: 'ContextMenu' })
    fireEvent.click(screen.getByRole('menuitem'))
    fireEvent.change(screen.getByLabelText('会话名称'), { target: { value: '未保存的名称' } })
    fireEvent.click(screen.getByRole('button', { name: '关闭详情' }))
    expect(f.sessions[0]!.title).toBe('键盘会话')
    openDetails('键盘会话')
    fireEvent.change(screen.getByLabelText('会话名称'), { target: { value: '重命名后的会话' } })
    f.api.workbenchConversation.mockRejectedValueOnce(new Error('临时错误'))
    fireEvent.click(screen.getByRole('button', { name: '保存名称' }))
    await within(screen.getByRole('dialog')).findByRole('alert')
    expect(f.sessions[0]!.title).toBe('键盘会话')
    const save = screen.getByRole('button', { name: '保存名称' })
    save.focus(); fireEvent.click(save)
    await screen.findByRole('tab', { name: '重命名后的会话' })
    expect(screen.getByRole('dialog')).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(f.commands.filter((command) => command.type === 'update')).toEqual([
      { type: 'update', projectId: run.projectId, conversationId: 'chat-1', title: '重命名后的会话' },
    ])
  })

  it('keeps a live request running through details, then preserves cancellation and retry controls', async () => {
    const f = fixture()
    await f.api.workbenchConversation({ type: 'create', projectId: run.projectId, title: '正在调查' })
    f.sessions[0]!.status = 'running'
    localStorage.setItem(`devflow-workbench-tab:${run.projectId}`, 'chat-1')
    render(<WorkbenchWorkspace {...f.props} />)
    await screen.findByRole('button', { name: '停止调查' })
    openDetails('正在调查')
    f.sessions[0]!.messages.push({ id: 'progress', role: 'notice', text: '新的查询结果', createdAt: run.createdAt })
    f.sessions[0]!.version++
    await act(async () => f.push())
    expect(screen.getByRole('dialog')).toHaveTextContent('本地保留 1 条会话记录')
    fireEvent.click(screen.getByRole('button', { name: '关闭详情' }))
    expect(screen.getByText('新的查询结果')).toBeVisible()
    expect(f.commands.some((command) => ['send', 'retry', 'cancel'].includes(command.type))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '停止调查' }))
    await waitFor(() => expect(f.sessions[0]!.status).toBe('cancelled'))
    f.sessions[0]!.status = 'failed'; f.sessions[0]!.error = '需要重试'; f.sessions[0]!.version++
    await act(async () => f.push())
    openDetails('正在调查')
    fireEvent.click(screen.getByRole('button', { name: '关闭详情' }))
    fireEvent.click(screen.getByRole('button', { name: '重试调查' }))
    await waitFor(() => expect(f.commands.filter((command) => command.type === 'retry')).toHaveLength(1))
  })

  it('cancels creation without changing the active conversation, draft, executor or model calls', async () => {
    const f = fixture()
    render(<WorkbenchWorkspace {...f.props} />)
    fireEvent.click(screen.getByRole('button', { name: '新建对话' }))
    fireEvent.click(screen.getByRole('button', { name: '创建对话' }))
    await screen.findByRole('tab', { name: '对话 1' })
    fireEvent.change(screen.getByRole('textbox', { name: '对话内容' }), { target: { value: '还没发出的草稿' } })
    expect(screen.queryByLabelText('新对话执行方式')).toBeNull()
    const trigger = screen.getByRole('button', { name: '新建对话' })
    trigger.focus()
    fireEvent.click(trigger)
    fireEvent.change(screen.getByLabelText('新对话执行方式'), { target: { value: 'opencode' } })
    fireEvent.keyDown(screen.getByRole('dialog', { name: '新建对话' }), { key: 'Escape' })
    expect(trigger).toHaveFocus()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('tab', { name: '对话 1' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('textbox', { name: '对话内容' })).toHaveValue('还没发出的草稿')
    expect(f.sessions).toHaveLength(1)
    expect(f.sessions[0]!.executor).toBe('direct-provider')
    expect(f.commands.filter((command) => command.type === 'create')).toHaveLength(1)
    expect(f.commands.some((command) => command.type === 'send')).toBe(false)
  })

  it('preserves the project-question prefill and closes an unconfirmed dialog when the project changes', async () => {
    const f = fixture()
    const view = render(<WorkbenchWorkspace {...f.props} />)
    fireEvent.click(screen.getByRole('button', { name: '向项目提问' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('当前项目进行到哪里了？为什么卡住，下一步应该做什么？')
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(f.sessions).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '向项目提问' }))
    fireEvent.click(screen.getByRole('button', { name: '创建对话' }))
    await expect(screen.findByRole('textbox', { name: '对话内容' })).resolves.toHaveValue('当前项目进行到哪里了？为什么卡住，下一步应该做什么？')
    fireEvent.click(screen.getByRole('button', { name: '新建对话' }))
    view.rerender(<WorkbenchWorkspace {...f.props} projectId="other-project" />)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(f.sessions).toHaveLength(1)
    expect(f.commands.some((command) => command.type === 'send')).toBe(false)
  })

  it('keeps creation failures visible in the dialog without losing its executor or prefilled question', async () => {
    const f = fixture()
    render(<WorkbenchWorkspace {...f.props} />)
    fireEvent.click(screen.getByRole('button', { name: '向项目提问' }))
    fireEvent.change(screen.getByLabelText('新对话执行方式'), { target: { value: 'opencode' } })
    f.api.workbenchConversation.mockRejectedValueOnce(new Error('暂时无法创建，请重试'))
    fireEvent.click(screen.getByRole('button', { name: '创建对话' }))
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('暂时无法创建，请重试')
    expect(screen.getByLabelText('新对话执行方式')).toHaveValue('opencode')
    fireEvent.click(screen.getByRole('button', { name: '创建对话' }))
    await screen.findByRole('tab', { name: '对话 1' })
    expect(f.sessions[0]).toMatchObject({ executor: 'opencode', inputDraft: '当前项目进行到哪里了？为什么卡住，下一步应该做什么？' })
  })

  it('opens help on demand with focus recovery and keeps stored context and real capacity warnings', async () => {
    const f = fixture()
    render(<WorkbenchWorkspace {...f.props} />)
    fireEvent.click(screen.getByRole('button', { name: '新建对话' }))
    fireEvent.click(screen.getByRole('button', { name: '创建对话' }))
    await screen.findByRole('tab', { name: '对话 1' })
    const session = f.sessions[0]!
    session.contextReceipt = { includedMessages: 7, omittedMessages: 3, limited: true, observedAt: run.updatedAt }
    session.version++
    await act(async () => f.push())
    openDetails('对话 1')
    expect(screen.queryByText(/上次使用|较早消息未进入/)).toBeNull()
    expect(screen.getByText(/本次上下文达到容量限制/)).toBeVisible()
    expect(screen.getByText('模型调用设置记录')).toBeVisible()
    expect(screen.queryByText(/A 聊天里确认/)).toBeNull()
    const help = screen.getByRole('button', { name: '了解会话信息' })
    help.focus(); fireEvent.click(help)
    const dialog = screen.getByRole('dialog', { name: '会话说明' })
    expect(dialog).toHaveTextContent('B 聊天不会自动知道')
    expect(dialog).toHaveTextContent('保存提案不会共享整段聊天')
    expect(dialog).toHaveTextContent('业务数据库')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(help).toHaveFocus()
    fireEvent.click(help)
    fireEvent.click(screen.getByRole('button', { name: '关闭说明' }))
    expect(help).toHaveFocus()
    expect(session.contextReceipt).toMatchObject({ includedMessages: 7, omittedMessages: 3, limited: true })
    expect(f.commands.some((command) => command.type === 'send')).toBe(false)
  })

  it('chooses an executor for a new conversation and preserves each existing conversation selection', async () => {
    const f = fixture()
    const view = render(<WorkbenchWorkspace {...f.props} />)
    fireEvent.click(screen.getByRole('button', { name: '新建对话' }))
    fireEvent.click(screen.getByRole('button', { name: '创建对话' }))
    await screen.findByRole('tab', { name: '对话 1' })
    expect(f.sessions[0]!.executor).toBe('direct-provider')
    fireEvent.click(screen.getByRole('button', { name: '新建对话' }))
    fireEvent.change(screen.getByLabelText('新对话执行方式'), { target: { value: 'opencode' } })
    fireEvent.click(screen.getByRole('button', { name: '创建对话' }))
    await screen.findByRole('tab', { name: '对话 2' })
    expect(f.sessions[1]!.executor).toBe('opencode')
    expectExecutor('对话 2', 'OpenCode')
    fireEvent.click(screen.getByRole('tab', { name: '对话 1' }))
    expectExecutor('对话 1', 'Direct Provider')
    expect(f.sessions[0]!.executor).toBe('direct-provider')
    expect(f.commands.some((command) => command.type === 'send')).toBe(false)
    view.unmount()
    render(<WorkbenchWorkspace {...f.props} />)
    await screen.findByRole('tab', { name: '对话 1' })
    fireEvent.click(screen.getByRole('tab', { name: '对话 2' }))
    expectExecutor('对话 2', 'OpenCode')
    expect(screen.queryByLabelText('新对话执行方式')).toBeNull()
  })
  it('renders legacy and declared Markdown while keeping plain text, unknown formats and unsafe content readable', async () => {
    const f = fixture()
    render(<WorkbenchWorkspace {...f.props} />)
    fireEvent.click(screen.getByRole('button', { name: '新建对话' }))
    fireEvent.click(screen.getByRole('button', { name: '创建对话' }))
    await screen.findByRole('tab', { name: '对话 1' })
    f.sessions[0]!.messages.push(
      { id: 'legacy', role: 'assistant', text: '**需求澄清**\n\n1. 核对需求\n2. 再确认', createdAt: run.createdAt },
      { id: 'plain', role: 'assistant', format: 'plain_text', text: '**保持原样**', createdAt: run.createdAt },
      { id: 'unknown', role: 'assistant', format: 'unsupported', text: '<custom>未知格式原文</custom>', createdAt: run.createdAt },
      { id: 'code', role: 'assistant', format: 'markdown', text: '```json\n{"value":"**字面值**"}\n```\n\n[文档](https://example.com/docs) [危险](javascript:alert%281%29)\n\n<script>alert(1)</script>\n\n![图示](https://example.com/tracker.png)', createdAt: run.createdAt },
    )
    f.sessions[0]!.version++
    await act(async () => f.push())
    expect(screen.getByText('需求澄清').tagName).toBe('STRONG')
    expect(screen.getByRole('list')).toHaveTextContent('核对需求')
    expect(screen.getByText('**保持原样**')).toBeVisible()
    expect(screen.getByText('<custom>未知格式原文</custom>')).toBeVisible()
    expect(screen.getByText('{"value":"**字面值**"}').tagName).toBe('CODE')
    expect(screen.getByRole('link', { name: '文档' })).toHaveAttribute('href', 'https://example.com/docs')
    expect(screen.queryByRole('link', { name: '危险' })).toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
    expect(document.querySelector('.conversation-message script')).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: '查看原文' })[0]!)
    expect(screen.getByText(/\*\*需求澄清\*\*/)).toBeVisible()
  })

  it('shows reasoning while the answer is pending, then keeps both independently readable in history', async () => {
    const f = fixture()
    render(<WorkbenchWorkspace {...f.props} />)
    fireEvent.click(screen.getByRole('button', { name: '新建对话' }))
    fireEvent.click(screen.getByRole('button', { name: '创建对话' }))
    await screen.findByRole('tab', { name: '对话 1' })
    const session = f.sessions[0]!
    session.status = 'running'; session.version++
    session.messages.push({ id: 'thinking-1', role: 'notice', text: '模型调用 1', createdAt: run.createdAt,
      reasoning: { text: '我会先检查当前阶段，再核对测试记录。', effort: 'low', status: 'streaming' } })
    await act(async () => f.push())
    const reasoning = await screen.findByRole('button', { name: /推理过程.*生成中/ })
    expect(reasoning).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('我会先检查当前阶段，再核对测试记录。')).toBeVisible()
    session.messages[0]!.reasoning!.text += ' 当前测试尚未执行。'; session.version++
    await act(async () => f.push())
    expect(await screen.findByText(/我会先检查当前阶段.*当前测试尚未执行/)).toBeVisible()
    session.status = 'idle'; session.version++
    session.messages[0]!.reasoning!.status = 'completed'
    session.messages.push({ id: 'answer-1', role: 'assistant', text: '现在需要完成需求澄清。', createdAt: run.createdAt })
    await act(async () => f.push())
    expect(await screen.findByText('现在需要完成需求澄清。')).toBeVisible()
    const finished = screen.getByRole('button', { name: /推理过程.*已结束/ })
    expect(finished).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(finished)
    expect(screen.getByText(/我会先检查当前阶段.*当前测试尚未执行/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '新建对话' }))
    fireEvent.click(screen.getByRole('button', { name: '创建对话' }))
    await screen.findByRole('tab', { name: '对话 2' })
    expect(screen.queryByText(/我会先检查当前阶段/)).toBeNull()
  })

  it('keeps the existing inspector mounted, with separate conversations and close/reopen history', async () => {
    const f = fixture()
    const view = render(<WorkbenchWorkspace {...f.props} />)
    fireEvent.change(screen.getByLabelText('节点原有表单'), { target: { value: '尚未提交的节点编辑' } })
    fireEvent.click(screen.getByRole('button', { name: '新建对话' }))
    fireEvent.click(screen.getByRole('button', { name: '创建对话' }))
    await screen.findByRole('tab', { name: '对话 1' })
    fireEvent.change(screen.getByRole('textbox', { name: '对话内容' }), { target: { value: '仅第一条会话的输入' } })
    fireEvent.click(screen.getByRole('button', { name: '新建对话' }))
    fireEvent.click(screen.getByRole('button', { name: '创建对话' }))
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
    expect(f.commands.some((command) => command.type === 'create')).toBe(false)
    expect(screen.getByRole('dialog', { name: '新建对话' })).toHaveTextContent('讨论需求节点，也可以问整个项目。')
    fireEvent.change(screen.getByLabelText('新对话执行方式'), { target: { value: 'opencode' } })
    fireEvent.click(screen.getByRole('button', { name: '创建对话' }))
    const composer = await screen.findByRole('textbox', { name: '对话内容' })
    expect(f.sessions[0]?.executor).toBe('opencode')
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

  it('removes manual memory editing, explains archived notes and preserves project isolation', async () => {
    const f = fixture()
    const view = render(<WorkbenchWorkspace {...f.props} />)
    fireEvent.click(screen.getByRole('button', { name: '新建对话' }))
    fireEvent.click(screen.getByRole('button', { name: '创建对话' }))
    await screen.findByRole('tab', { name: '对话 1' })
    f.sessions[0]!.memory = '旧版私有备注'; f.sessions[0]!.version++
    await act(async () => f.push())
    openDetails('对话 1')
    expect(screen.queryByRole('textbox', { name: '仅本会话记忆' })).toBeNull()
    expect(screen.getByText('旧版私有备注')).toBeInTheDocument()
    fireEvent.click(screen.getByText('旧版会话备注（已停用）'))
    expect(screen.getByText(/已停用，不会发送给模型/)).toBeVisible()
    view.rerender(<WorkbenchWorkspace {...f.props} projectId="other-project" projectName="另一个项目" />)
    await waitFor(() => expect(screen.queryByRole('tab', { name: '对话 1' })).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: '会话历史' }))
    expect(screen.queryByText('旧版私有备注')).toBeNull()
    expect(within(screen.getByRole('region', { name: '会话历史记录' })).getByText('还没有对话。点击 ＋ 开始。')).toBeVisible()
  })

  it('shows live busy state and cancellation without sending an extra user message', async () => {
    const f = fixture()
    render(<WorkbenchWorkspace {...f.props} />)
    fireEvent.click(screen.getByRole('button', { name: '新建对话' }))
    fireEvent.click(screen.getByRole('button', { name: '创建对话' }))
    await screen.findByRole('tab', { name: '对话 1' })
    f.sessions[0]!.status = 'running'; f.sessions[0]!.version++
    await act(async () => f.push())
    fireEvent.click(await screen.findByRole('button', { name: '停止调查' }))
    await waitFor(() => expect(f.sessions[0]?.status).toBe('cancelled'))
    expect(f.commands.filter((command) => command.type === 'send')).toHaveLength(0)
  })
})
