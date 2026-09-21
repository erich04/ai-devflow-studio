import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { AgentProviderConfig, ProviderCredentialMetadata, UpdateProviderThinkingInput } from '@ai-devflow/shared'
import { SavedProviderThinkingSettings, ProviderThinkingFields } from './ProviderThinkingSettings'
afterEach(cleanup)
const provider: AgentProviderConfig = { id: 'p', name: 'DeepSeek', model: 'deepseek-v4-flash', baseUrl: 'https://api.deepseek.com', kind: 'openai-compatible', enabled: true, updatedAt: '2026-09-19T00:00:00Z' }

it('edits existing thinking without reading or resubmitting a credential and keeps conflict errors visible', async () => {
  const updateProviderThinking = vi.fn(async (input: UpdateProviderThinkingInput): Promise<ProviderCredentialMetadata> => ({ providerId: 'p', model: provider.model, maskedCredential: '***', updatedAt: '2026-09-19T01:00:00Z', thinking: input.thinking }))
  render(<SavedProviderThinkingSettings provider={provider} api={{ updateProviderThinking }} />)
  fireEvent.click(screen.getByText('思考模式与推理强度'))
  expect(screen.getByText(/保存后使用/)).toHaveTextContent('low（应用默认）')
  fireEvent.change(screen.getByLabelText('思考模式'), { target: { value: 'enabled' } })
  fireEvent.change(screen.getByLabelText('推理强度'), { target: { value: 'high' } })
  expect(screen.getByRole('status')).toHaveTextContent('尚未保存')
  fireEvent.click(screen.getByText('保存思考设置'))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('已保存'))
  expect(updateProviderThinking).toHaveBeenCalledWith({ providerId: 'p', expectedUpdatedAt: provider.updatedAt, thinking: { mode: 'enabled', effort: 'high' } })
  updateProviderThinking.mockRejectedValueOnce(new Error('Provider 已变更，请重新加载后再保存。'))
  fireEvent.change(screen.getByLabelText('思考模式'), { target: { value: 'disabled' } })
  fireEvent.click(screen.getByText('保存思考设置'))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('重新加载'))
  expect(updateProviderThinking.mock.calls[1]?.[0]).toMatchObject({ expectedUpdatedAt: '2026-09-19T01:00:00Z', thinking: { mode: 'disabled' } })
})

it('does not offer DeepSeek parameters for an unrecognized endpoint', () => {
  render(<ProviderThinkingFields model={provider.model} baseUrl="https://gateway.example.invalid" value={{ mode: 'default' }} onChange={() => {}} />)
  expect(screen.getByRole('option', { name: '开启' })).toBeDisabled()
  expect(screen.getByRole('option', { name: '关闭' })).toBeDisabled()
  expect(screen.queryByLabelText('推理强度')).not.toBeInTheDocument()
})
