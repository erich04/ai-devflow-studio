import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AgentProviderConfig, ProviderRemovalCheck } from '@ai-devflow/shared'
import { ProviderRemovalDialog } from './ProviderRemovalDialog'

const provider: AgentProviderConfig = { id: 'test-provider', name: 'QA', kind: 'openai-compatible', model: 'fixture', maskedCredential: 'fi...ure', enabled: true, updatedAt: '2026-09-10T12:00:00.000Z' }
const check: ProviderRemovalCheck = { providerId: provider.id, credential: { ...provider, providerId: provider.id, maskedCredential: 'fi...ure' }, references: [], historicalRecordCount: 2 }

describe('Provider removal confirmation', () => {
  it('shows the exact identity and references, blocks removal, and handles Escape with focus return', async () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const api = { inspectAgentProviderRemoval: vi.fn().mockResolvedValue({ ...check, references: [{ kind: 'coding_configuration', id: 'project-one', remediation: 'Replace the project Provider first.' }] }), removeAgentProviderCredential: vi.fn() }
    const cancel = vi.fn()
    const { unmount } = render(<ProviderRemovalDialog provider={provider} api={api} onCancel={cancel} onDeleted={vi.fn()} />)
    await screen.findByText('Replace the project Provider first.')
    expect(screen.getByRole('button', { name: '确认删除 Provider' })).toBeDisabled()
    expect(screen.getByText(provider.maskedCredential!)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab', shiftKey: true })
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(api.removeAgentProviderCredential).not.toHaveBeenCalled()
    unmount()
    expect(opener).toHaveFocus()
    opener.remove()
  })

  it('requires an explicit confirmation, suppresses repeated clicks, and returns only the deleted ID', async () => {
    let finish!: (result: { status: 'deleted'; providerId: string }) => void
    const api = { inspectAgentProviderRemoval: vi.fn().mockResolvedValue(check), removeAgentProviderCredential: vi.fn(() => new Promise<{ status: 'deleted'; providerId: string }>((done) => { finish = done })) }
    const removed = vi.fn()
    render(<ProviderRemovalDialog provider={provider} api={api} onCancel={vi.fn()} onDeleted={removed} />)
    const confirm = screen.getByRole('button', { name: '确认删除 Provider' })
    await waitFor(() => expect(confirm).toBeEnabled())
    expect(api.removeAgentProviderCredential).not.toHaveBeenCalled()
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(api.removeAgentProviderCredential).toHaveBeenCalledExactlyOnceWith({ providerId: provider.id, expectedUpdatedAt: provider.updatedAt })
    expect(screen.getByRole('dialog')).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' })
    expect(screen.getByRole('dialog')).toHaveFocus()
    await act(async () => { finish({ status: 'deleted', providerId: provider.id }) })
    expect(removed).toHaveBeenCalledExactlyOnceWith(provider.id)
  })
})
