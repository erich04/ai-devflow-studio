import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AgentProviderConfig, ProjectMemoryPage, ProjectMemoryStatus } from '@ai-devflow/shared'
import { ProjectMemoryPanel } from './ProjectMemoryPanel'

const status = (overrides: Partial<ProjectMemoryStatus> = {}): ProjectMemoryStatus => ({
  projectId: 'project-1', configured: true, enabled: true, transportAvailable: true, pairedProject: true,
  endpoint: 'http://127.0.0.1:8890', providerId: 'deepseek', bankId: 'df-memory-1',
  relay: { port: 8891, running: true, tokenFile: '/tmp/user-data/memory-relay-token', hindsightBaseUrl: 'http://host.docker.internal:8891/v1' },
  counts: { retained: 3, queued: 1, failed: 1 },
  recent: [{ id: 'doc-1', sourceKind: 'conversation', title: '删除确认', status: 'retained', updatedAt: '2026-10-28T08:00:00.000Z' }],
  ...overrides,
})
const page = (overrides: Partial<ProjectMemoryPage> = {}): ProjectMemoryPage => ({ total: 1, offset: 0, limit: 50, items: [
  { id: 'o1', kind: 'observation', text: '删除前必须弹出二次确认框。', date: '2026-10-28',
    source: { documentId: 'doc-1', sourceKind: 'conversation', title: '删除确认' } },
], ...overrides })
const providers: AgentProviderConfig[] = [
  { id: 'deepseek', name: 'DeepSeek', kind: 'openai-compatible', model: 'deepseek-v4-flash', enabled: true, maskedCredential: 'sk-...1234', updatedAt: '2026-10-28T00:00:00.000Z' },
  { id: 'fake', name: 'Fake', kind: 'fake', model: 'fake', enabled: true, updatedAt: '2026-10-28T00:00:00.000Z' },
]
function api(initial: ProjectMemoryStatus) {
  return {
    getProjectMemoryStatus: vi.fn(async () => initial),
    configureProjectMemory: vi.fn(async (input: { enabled: boolean }) => status({ enabled: input.enabled })),
    listProjectMemories: vi.fn(async () => page()),
    updateProjectMemory: vi.fn(async () => status()),
    forgetProjectMemory: vi.fn(async () => status()),
    forgetProjectMemorySource: vi.fn(async () => status()),
    clearProjectMemory: vi.fn(async () => status({ counts: { deleted: 1 } })),
    listAgentProviders: vi.fn(async () => providers),
  }
}

describe('ProjectMemoryPanel', () => {
  it('turns project memory on with a saved Provider and then lists what it learned', async () => {
    const memory = api(status({ configured: false, enabled: false, endpoint: '', providerId: null, bankId: null, counts: {}, recent: [] }))
    render(<ProjectMemoryPanel projectId="project-1" api={memory} />)
    const panel = await screen.findByRole('region', { name: '项目记忆' })
    expect(within(panel).getByText('未开启')).toBeInTheDocument()
    const provider = await within(panel).findByRole('combobox', { name: '抽取用的模型 Provider' })
    await waitFor(() => expect(within(provider).getAllByRole('option').map((option) => option.textContent)).toEqual(['DeepSeek · deepseek-v4-flash']))
    expect(within(panel).getByRole('textbox', { name: 'Hindsight 服务地址' })).toHaveValue('http://127.0.0.1:8890')
    expect(memory.listProjectMemories).not.toHaveBeenCalled()
    fireEvent.click(within(panel).getByRole('button', { name: '开启项目记忆' }))
    await waitFor(() => expect(memory.configureProjectMemory).toHaveBeenCalledWith({ projectId: 'project-1', enabled: true,
      endpoint: 'http://127.0.0.1:8890', providerId: 'deepseek' }))
    expect(await within(panel).findByText('已开启')).toBeInTheDocument()
    expect(await within(panel).findByText('删除前必须弹出二次确认框。')).toBeInTheDocument()
    expect(memory.listProjectMemories).toHaveBeenCalledWith({ projectId: 'project-1', kind: 'observation' })
  })

  it('edits, deletes, filters and searches memories', async () => {
    const memory = api(status())
    render(<ProjectMemoryPanel projectId="project-1" api={memory} />)
    const panel = await screen.findByRole('region', { name: '项目记忆' })
    const item = (await within(panel).findByText('删除前必须弹出二次确认框。')).closest('li')!
    expect(item).toHaveTextContent('2026-10-28 · 讨论：删除确认')
    fireEvent.click(within(item).getByRole('button', { name: '编辑' }))
    fireEvent.change(within(item).getByRole('textbox', { name: '编辑记忆内容' }), { target: { value: '删除前必须确认，撤销窗口 10 秒。' } })
    fireEvent.click(within(item).getByRole('button', { name: '保存修改' }))
    await waitFor(() => expect(memory.updateProjectMemory).toHaveBeenCalledWith({ projectId: 'project-1', memoryId: 'o1', text: '删除前必须确认，撤销窗口 10 秒。' }))
    fireEvent.click(within(await within(panel).findByRole('list', { name: '记忆列表' })).getByRole('button', { name: '删除' }))
    await waitFor(() => expect(memory.forgetProjectMemory).toHaveBeenCalledWith({ projectId: 'project-1', memoryId: 'o1' }))
    fireEvent.click(within(panel).getByRole('tab', { name: '事实' }))
    await waitFor(() => expect(memory.listProjectMemories).toHaveBeenLastCalledWith({ projectId: 'project-1', kind: 'world' }))
    fireEvent.change(within(panel).getByRole('searchbox', { name: '搜索记忆' }), { target: { value: ' 撤销 ' } })
    fireEvent.click(within(panel).getByRole('button', { name: '搜索' }))
    await waitFor(() => expect(memory.listProjectMemories).toHaveBeenLastCalledWith({ projectId: 'project-1', kind: 'world', query: '撤销' }))
  })

  it('asks before clearing, forgets a single source, and shows how to deploy the relay', async () => {
    const memory = api(status())
    render(<ProjectMemoryPanel projectId="project-1" api={memory} />)
    const panel = await screen.findByRole('region', { name: '项目记忆' })
    expect(within(panel).getByText(/已写入 3 · 等待 1 · 写入失败 1/u)).toBeInTheDocument()
    fireEvent.click(within(panel).getByRole('button', { name: '清空记忆…' }))
    const confirm = within(panel).getByRole('alertdialog', { name: '确认清空项目记忆' })
    expect(memory.clearProjectMemory).not.toHaveBeenCalled()
    fireEvent.click(within(confirm).getByRole('button', { name: '确认清空' }))
    await waitFor(() => expect(memory.clearProjectMemory).toHaveBeenCalledWith({ projectId: 'project-1', confirm: 'clear' }))
    fireEvent.click(within(within(panel).getByRole('list', { name: '最近的记忆来源' })).getByRole('button', { name: '忘记此来源' }))
    await waitFor(() => expect(memory.forgetProjectMemorySource).toHaveBeenCalledWith({ projectId: 'project-1', documentId: 'doc-1' }))
    expect(within(panel).getByText('http://host.docker.internal:8891/v1')).toBeInTheDocument()
    expect(within(panel).getByText('/tmp/user-data/memory-relay-token')).toBeInTheDocument()
  })

  it('shows why memory is unavailable and keeps a list error visible', async () => {
    const memory = api(status({ unavailableReason: '记忆模型中继未运行：端口 8891 已被占用。' }))
    memory.listProjectMemories.mockRejectedValueOnce(new Error("Error invoking remote method 'devflow:project-memory:list': Error: 当前构建未启用 Hindsight 传输。"))
    render(<ProjectMemoryPanel projectId="project-1" api={memory} />)
    const panel = await screen.findByRole('region', { name: '项目记忆' })
    expect(await within(panel).findByRole('status')).toHaveTextContent('端口 8891 已被占用')
    expect(await within(panel).findByRole('alert')).toHaveTextContent('当前构建未启用 Hindsight 传输。')
  })
})
