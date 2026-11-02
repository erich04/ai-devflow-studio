import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { CodingHarnessSnapshot, CodingHarnessCommand } from '@ai-devflow/shared'
import { NativeCodingHarnessPanel } from './NativeCodingHarnessPanel'

it('surfaces a child permission on the parent and sends a task grant to that exact child', async () => {
  const parent: CodingHarnessSnapshot = { protocolVersion: 2, codingRunId: 'parent', sessionId: 'parent-session', status: 'waiting_task', version: 4, objectiveVersion: 1, steps: 1, activeMilliseconds: 0, messages: [], evidence: [], children: [{ id: 'child', title: 'Check source', status: 'waiting_permission' }], cost: { inputTokens: 0, outputTokens: 0, costUsd: 0, unknownAttempts: 0, pendingSettlements: 0 } }
  const child: CodingHarnessSnapshot = { ...parent, codingRunId: 'child', sessionId: 'child-session', version: 7, status: 'waiting_permission', children: [], parent: { codingRunId: 'parent', mode: 'isolated_coding' }, permission: { id: 'child-permission', title: 'Child needs permission', details: 'Run the extra test' } }
  const api = vi.fn(async (command: CodingHarnessCommand) => command.codingRunId === 'child' ? child : parent)
  render(<NativeCodingHarnessPanel codingRunId="parent" api={{ codingHarness: api }} />)
  expect(await screen.findByText('子任务需要授权，请在下方核对并处理。')).toBeTruthy()
  const button = await screen.findByRole('button', { name: '本子任务内允许' })
  expect(button.closest('details')?.open).toBe(true)
  fireEvent.click(button)
  await waitFor(() => expect(api).toHaveBeenCalledWith(expect.objectContaining({ type: 'permission', codingRunId: 'child', expectedVersion: 7, permissionId: 'child-permission', decision: 'approved', scope: 'task' })))
})

it('selects the system sandbox by default without implicitly enabling networking', async () => {
  const snapshot: CodingHarnessSnapshot = { protocolVersion: 2, codingRunId: 'coding', sessionId: 'session', status: 'waiting_permission', version: 1, objectiveVersion: 1,
    steps: 0, activeMilliseconds: 0, messages: [], evidence: [], children: [], cost: { inputTokens: 0, outputTokens: 0, costUsd: 0, unknownAttempts: 0, pendingSettlements: 0 },
    execution: { testCommand: 'node test.js', baseline: 'base', profiles: [{ kind: 'os_sandbox', available: true, reason: '默认断网' }, { kind: 'trusted_local', available: true, reason: '没有隔离' }] } }
  const command = vi.fn(async () => snapshot)
  render(<NativeCodingHarnessPanel codingRunId="coding" api={{ codingHarness: command }} />)
  expect(await screen.findByLabelText('命令执行方式')).toHaveValue('os_sandbox')
  expect(screen.getByRole('checkbox', { name: /允许本任务沙箱命令联网/ })).not.toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: '授权并开始' }))
  await waitFor(() => expect(command).toHaveBeenCalledWith(expect.objectContaining({ type: 'authorize', profile: 'os_sandbox', network: 'none' })))
})

it('shows an unavailable executor reason with readable history and no actionable approval controls', async () => {
  const snapshot: CodingHarnessSnapshot = { protocolVersion: 2, codingRunId: 'coding', sessionId: 'session', status: 'waiting_permission', version: 1, objectiveVersion: 1,
    steps: 0, activeMilliseconds: 0, messages: [{ id: 'm', role: 'user', text: 'Keep my task', truncated: false }], evidence: [], children: [],
    controlUnavailableReason: '请切回 Native v3 继续恢复。', cost: { inputTokens: 0, outputTokens: 0, costUsd: 0, unknownAttempts: 0, pendingSettlements: 0 } }
  render(<NativeCodingHarnessPanel codingRunId="coding" api={{ codingHarness: async () => snapshot }} />)
  await screen.findByText('请切回 Native v3 继续恢复。')
  expect(screen.getByText('Keep my task')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '授权并开始' })).toBeNull()
  expect(screen.queryByRole('button', { name: '取消任务' })).toBeNull()
})

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
it.each([
  ['provider_insufficient_balance', '模型服务账户余额不足（HTTP 402），任务已暂停。请到模型服务商充值后点“继续”。'],
  ['provider_authentication_failed', '模型服务拒绝了当前 API Key（HTTP 401），任务已暂停。请在「设置／模型与执行方式」中检查这个 Provider 的 API Key，更新后重启应用，再点“继续”。'],
])('explains the %s pause instead of showing its code', async (pauseReason, text) => {
  const snapshot: CodingHarnessSnapshot = { protocolVersion: 2, codingRunId: 'coding', sessionId: 'session', status: 'paused', pauseReason, version: 3, objectiveVersion: 1,
    steps: 6, activeMilliseconds: 1000, messages: [], evidence: [], children: [], cost: { inputTokens: null, outputTokens: null, costUsd: null, unknownAttempts: 0, pendingSettlements: 0 } }
  render(<NativeCodingHarnessPanel codingRunId="coding" api={{ codingHarness: async () => snapshot }} />)
  await screen.findByText(text)
  expect(screen.queryByText(pauseReason)).toBeNull()
  expect(screen.getByRole('button', { name: '继续' })).toBeTruthy()
})
it('shows a scheduled re-send and the retry history', async () => {
  const snapshot: CodingHarnessSnapshot = { protocolVersion: 2, codingRunId: 'coding', sessionId: 'session', status: 'running', version: 9, objectiveVersion: 1,
    steps: 3, activeMilliseconds: 4000, messages: [], evidence: [], children: [], cost: { inputTokens: null, outputTokens: null, costUsd: null, unknownAttempts: 0, pendingSettlements: 0 },
    modelRetries: { total: 2, recent: [
      { attemptId: 'model-call-1', step: 2, number: 1, limit: 2, reason: 'server_error', delayMs: 1040, pending: false },
      { attemptId: 'model-call-3', step: 3, number: 1, limit: 5, reason: 'rate_limited', delayMs: 7000, retryAfterMs: 7000, pending: true },
    ] } }
  render(<NativeCodingHarnessPanel codingRunId="coding" api={{ codingHarness: async () => snapshot }} />)
  await screen.findByText('模型服务限流（HTTP 429）。约 7 秒后自动重新发送（第 1/5 次，等待时间由模型服务指定；重试不计入步数）。')
  expect(screen.getByText('模型请求自动重试（2 次）')).toBeTruthy()
  expect(screen.getByText('第 2 步 · 模型服务出错（HTTP 5xx） · 第 1/2 次 · 等待 2 秒')).toBeTruthy()
})
