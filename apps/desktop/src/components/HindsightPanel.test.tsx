import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { HindsightPanel } from './HindsightPanel'
import type { HindsightStatus } from '@ai-devflow/shared'

it('starts with no selected sources, sends only explicit selection and never redisplays a credential', async () => {
  const status: HindsightStatus = { configured: false, enabled: false, transportAvailable: false,
    endpoint: 'http://127.0.0.1:8888', selectedPaths: [], includeMemories: false, counts: {}, note: '网络未启用。' }
  const save = vi.fn(async () => ({ ...status, configured: true }))
  const api = { getHindsightStatus: vi.fn(async () => status), configureHindsight: save,
    refreshHindsight: vi.fn(async () => status), disableHindsight: vi.fn(async () => status) }
  render(<HindsightPanel projectId="p1" documents={[{ sourcePath: 'docs/knowledge/rules.md', title: '规则' }]} api={api} />)
  await screen.findByText('网络未启用。')
  expect(screen.getByRole('checkbox', { name: '规则' })).not.toBeChecked()
  fireEvent.click(screen.getByRole('checkbox', { name: '规则' }))
  fireEvent.change(screen.getByLabelText('Hindsight API Key'), { target: { value: 'fixture-secret' } })
  fireEvent.click(screen.getByRole('button', { name: '保存选择' }))
  await waitFor(() => expect(save).toHaveBeenCalledWith({ projectId: 'p1', endpoint: 'http://127.0.0.1:8888',
    apiKey: 'fixture-secret', selectedPaths: ['docs/knowledge/rules.md'], includeMemories: false, enabled: false }))
  await waitFor(() => expect(screen.getByLabelText('Hindsight API Key')).toHaveValue(''))
  expect(screen.queryByText('fixture-secret')).not.toBeInTheDocument()
})

it('requires a fresh paired knowledge consent and disables memory projection', async () => {
  const status: HindsightStatus = { configured: true, enabled: false, pairedProject: true, transportAvailable: true,
    endpoint: 'http://127.0.0.1:8890', selectedPaths: [], includeMemories: false, counts: {}, note: '已配对。' }
  const save = vi.fn(async () => status)
  render(<HindsightPanel projectId="p1" documents={[]} api={{
    getHindsightStatus: async () => status, configureHindsight: save,
    refreshHindsight: async () => status, disableHindsight: async () => status,
  }} />)
  await screen.findByText('已配对。')
  expect(screen.getByRole('checkbox', { name: /本人项目私有记忆/ })).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox', { name: '允许此项目同步以上来源及脱敏搜索查询' }))
  expect(screen.getByRole('button', { name: '保存选择' })).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox', { name: /授权当前配对身份/ }))
  fireEvent.click(screen.getByRole('button', { name: '保存选择' }))
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ pairedProjectConsent: true, includeMemories: false })))
})
