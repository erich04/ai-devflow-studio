import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { CredentialAccessRecord } from '../../electron/credential-access'
import { CredentialAccessStatus } from './CredentialAccessStatus'

afterEach(cleanup)
const waiting: CredentialAccessRecord = {
  id: 'credential-operation-1', category: 'provider', operation: 'decrypt', state: 'waiting',
  startedAt: '2026-09-19T00:00:00.000Z', durationMs: 500,
}

it('shows system authorization guidance and cancellation, then recovers after a successful retry', async () => {
  let update!: (items: CredentialAccessRecord[]) => void
  const api = {
    listCredentialAccess: vi.fn(async () => [waiting]),
    onCredentialAccessUpdated: vi.fn((listener: (items: CredentialAccessRecord[]) => void) => { update = listener; return () => {} }),
    cancelCredentialAccess: vi.fn(async () => true),
  }
  render(<CredentialAccessStatus api={api} detailed={false} />)
  await screen.findByText('正在等待系统凭据访问')
  expect(screen.getByRole('status')).toHaveTextContent('其他页面仍可使用')
  fireEvent.click(screen.getByRole('button', { name: '取消本次等待' }))
  await waitFor(() => expect(api.cancelCredentialAccess).toHaveBeenCalledWith(waiting.id))
  act(() => update([{ ...waiting, state: 'cancelled', code: 'credential_cancelled' }]))
  expect(screen.getByRole('status')).toHaveTextContent('已保存的配置会保留')
  act(() => update([{ ...waiting, id: 'retry', state: 'succeeded' }, { ...waiting, state: 'cancelled' }]))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

it('keeps safe operation diagnostics available for failed and completed attempts', async () => {
  const api = { listCredentialAccess: async () => [{ ...waiting, state: 'failed' as const, code: 'credential_unavailable' as const }] }
  render(<CredentialAccessStatus api={api} detailed />)
  await screen.findByText('模型 Provider · 读取凭据')
  expect(screen.getByRole('region', { name: '凭据访问记录' })).toHaveTextContent('500 ms')
  expect(screen.getByRole('region', { name: '凭据访问记录' })).toHaveTextContent(waiting.id)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})
