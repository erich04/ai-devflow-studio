import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { DiagnosticRecord } from '@ai-devflow/shared'
import { DiagnosticHistory } from './DiagnosticHistory'

it('queries and copies only sanitized records in the current profile', async () => {
  const records = [
    { id: '00000000-0000-4000-8000-000000000001', timestamp: '2026-09-19T00:00:00Z', source: 'desktop',
      operation: 'pairing_exchange', phase: 'response', reason: 'pairing_code_expired', outcome: 'failed', durationMs: 20, retryable: false, projectId: 'p-one', apiKey: 'PRIVATE' },
    { id: '00000000-0000-4000-8000-000000000002', timestamp: '2026-09-19T00:00:01Z', source: 'desktop',
      operation: 'remote_sync', phase: 'response', reason: 'ok', outcome: 'succeeded', durationMs: 10, retryable: false, projectId: 'p-two' },
  ] as DiagnosticRecord[]
  const writeText = vi.fn(async () => {})
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  try {
    render(<DiagnosticHistory active api={{ listDiagnosticRecords: async () => records }} />)
    await screen.findByText(/2026-09-19T00:00:00.*pairing_exchange.*pairing_code_expired/, { selector: 'summary' })
    fireEvent.change(screen.getByLabelText('查询诊断'), { target: { value: 'p-one' } })
    fireEvent.click(screen.getByRole('button', { name: '复制筛选结果' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce())
    const exported = writeText.mock.calls[0] as unknown as [string]
    expect(exported[0]).toContain('pairing_code_expired')
    expect(exported[0]).not.toMatch(/PRIVATE|apiKey|p-two/)
  } finally {
    if (original) Object.defineProperty(navigator, 'clipboard', original)
    else Reflect.deleteProperty(navigator, 'clipboard')
  }
})
