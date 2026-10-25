import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkbenchConversation } from '../electron/workbench-conversation-contract'
import { InvestigationControls, InvestigationProgress } from './InvestigationControls'

const session: WorkbenchConversation = { id: 'chat-1', localProjectId: 'project-1', version: 1, title: 'PRIVATE_CHAT_TITLE', isOpen: true, inputDraft: 'PRIVATE_DRAFT', status: 'idle', messages: [], createdAt: '2026-10-23T00:00:00.000Z', updatedAt: '2026-10-23T00:00:00.000Z' }
const progress: NonNullable<WorkbenchConversation['investigationProgress']> = {
  version: 1, policy: { maxSteps: 12, maxDurationMs: 180000, source: 'default', maxToolCalls: 192, maxRequests: 240, maxRecoveries: 24, maxTotalToolCalls: 3840, noProgressLimit: 4, summaryRequests: 2, summaryDurationMs: 30000 },
  totals: { requests: 17, recoveries: 2, toolCalls: 11, summaryRequests: 1 },
  batch: { id: 'batch-1', startedAt: 1, steps: 12, requests: 17, recoveries: 2, toolCalls: 11, summaryRequests: 1, noProgress: 3, repeatedQueries: 3, reusedQueries: 2 }, stopReason: 'step_limit',
}
const diagnostics = { version: 1, generatedAt: '2026-10-23T00:00:00.000Z', conversationId: 'chat-1', status: 'idle', retention: { maxCalls: 200, maxAgeDays: 30, maxBytes: 524288 }, replay: { available: false, reason: '仅保留结构与摘要；没有原始响应正文，不能重放历史失败。' }, investigation: null, calls: [], omittedCalls: 0 }
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
function openControls() { fireEvent.click(screen.getByText('调查范围与诊断')) }

describe('InvestigationControls', () => {
  it('starts collapsed and saves valid settings for the next batch with exact scope', async () => {
    const command = vi.fn().mockResolvedValue({ conversations: [session] })
    render(<InvestigationControls session={session} command={command} busy={false} />)
    expect(screen.getByText('调查范围与诊断').closest('details')).not.toHaveAttribute('open')
    expect(command).not.toHaveBeenCalled()
    openControls()
    expect(screen.getByLabelText('每批最多步骤')).toHaveValue(12)
    expect(screen.getByLabelText('每批最多秒数')).toHaveValue(180)
    fireEvent.change(screen.getByLabelText('每批最多步骤'), { target: { value: '18' } })
    fireEvent.change(screen.getByLabelText('每批最多秒数'), { target: { value: '90' } })
    fireEvent.click(screen.getByRole('button', { name: '保存下一批范围' }))
    await waitFor(() => expect(command).toHaveBeenCalledWith({ type: 'configure_investigation', projectId: 'project-1', conversationId: 'chat-1', maxSteps: 18, maxDurationMs: 90000 }))
    expect(await screen.findByText('已保存，下次开始或继续调查时生效。')).toBeInTheDocument()
  })

  it('rejects invalid ranges without sending and disables settings while running', async () => {
    const command = vi.fn()
    const view = render(<InvestigationControls session={session} command={command} busy={false} />)
    openControls()
    fireEvent.change(screen.getByLabelText('每批最多步骤'), { target: { value: '61' } })
    fireEvent.submit(screen.getByRole('form', { name: '调查范围设置' }))
    expect(screen.getByRole('alert')).toHaveTextContent('步数须为 1–60 的整数，时间须为 30–600 秒的整数。')
    expect(command).not.toHaveBeenCalled()
    view.rerender(<InvestigationControls session={{ ...session, status: 'running' }} command={command} busy />)
    expect(screen.getByLabelText('每批最多步骤')).toBeDisabled()
    expect(screen.getByRole('button', { name: '保存下一批范围' })).toBeDisabled()
  })

  it('does not report success after an unsuccessful host command', async () => {
    const command = vi.fn().mockResolvedValue(undefined)
    render(<InvestigationControls session={session} command={command} busy={false} />)
    openControls()
    fireEvent.click(screen.getByRole('button', { name: '保存下一批范围' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('范围未保存，请重试。')
    expect(screen.queryByText('已保存，下次开始或继续调查时生效。')).not.toBeInTheDocument()
  })

  it('requests a safe diagnostic package without triggering any investigation and downloads that package only', async () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:safe-fixture')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const command = vi.fn().mockResolvedValue({ conversations: [session], diagnostics })
    render(<InvestigationControls session={session} command={command} busy={false} />)
    openControls()
    fireEvent.click(screen.getByRole('button', { name: '查看诊断' }))
    await waitFor(() => expect(command).toHaveBeenCalledWith({ type: 'export_diagnostics', projectId: 'project-1', conversationId: 'chat-1' }))
    expect(await screen.findByText(/没有原始响应正文，不能重放历史失败/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '下载诊断文件' }))
    expect(click).toHaveBeenCalledOnce()
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
    expect(createObjectURL.mock.calls[0]?.[0].size).toBe(new Blob([JSON.stringify(diagnostics, null, 2)]).size)
    expect(command).toHaveBeenCalledOnce()
    expect(screen.queryByText('PRIVATE_DRAFT')).not.toBeInTheDocument()
  })
})

it('shows batch progress and cumulative limits without promising reset on continuation', () => {
  const view = render(<InvestigationProgress session={{ ...session, status: 'paused', investigationProgress: progress }} />)
  expect(screen.getByText(/本批已完成 12 \/ 12 步/)).toBeInTheDocument()
  expect(screen.getByText(/累计 17 \/ 240 次模型请求/)).toBeInTheDocument()
  expect(screen.getByText(/连续 3 次查询没有获得新证据/)).toBeInTheDocument()
  expect(screen.getByText(/可继续调查/)).toBeInTheDocument()
  view.rerender(<InvestigationProgress session={{ ...session, status: 'paused', investigationProgress: { ...progress, stopReason: 'request_limit' } }} />)
  expect(screen.getByText(/已到累计安全边界/)).toBeInTheDocument()
  expect(screen.queryByText(/可继续调查/)).not.toBeInTheDocument()
})

it('distinguishes OpenCode investigation starts from its internally measured model requests', () => {
  render(<InvestigationProgress session={{ ...session, executor: 'opencode', status: 'paused', investigationProgress: { ...progress, stopReason: 'request_limit' } }} />)
  expect(screen.getByText(/累计启动 17 次调查/)).toBeInTheDocument()
  expect(screen.getByText(/OpenCode 内部模型请求不计入此数字，用量由执行器记录/)).toBeInTheDocument()
  expect(screen.queryByText(/次模型请求/)).not.toBeInTheDocument()
  expect(screen.getByText(/累计调查启动次数已到上限/)).toBeInTheDocument()
})

it('copies only the host diagnostic package and reports unavailable clipboard access', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  const command = vi.fn().mockResolvedValue({ conversations: [session], diagnostics })
  render(<InvestigationControls session={session} command={command} busy={false} />)
  openControls()
  fireEvent.click(screen.getByRole('button', { name: '查看诊断' }))
  fireEvent.click(await screen.findByRole('button', { name: '复制诊断' }))
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(JSON.stringify(diagnostics, null, 2)))
  expect(writeText.mock.calls[0]?.[0]).not.toMatch(/PRIVATE_DRAFT|PRIVATE_CHAT_TITLE/u)
  writeText.mockRejectedValue(new Error('clipboard unavailable'))
  fireEvent.click(screen.getByRole('button', { name: '复制诊断' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法复制，请下载诊断文件。')
})
