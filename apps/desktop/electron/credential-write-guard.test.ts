import { expect, it, vi } from 'vitest'
import { createCredentialWriteGuard } from './credential-write-guard'

it('rejects a duplicate during authorization without queuing a stale write, then permits retry', async () => {
  const write = createCredentialWriteGuard()
  let cancel!: (reason: Error) => void
  const first = write('team', () => new Promise<void>((_, reject) => { cancel = reject }))
  const duplicate = vi.fn()
  await expect(write('team', duplicate)).rejects.toThrow('已有配置操作')
  expect(duplicate).not.toHaveBeenCalled()
  await expect(write('provider', async () => 'independent')).resolves.toBe('independent')
  cancel(new Error('cancelled'))
  await expect(first).rejects.toThrow('cancelled')
  await expect(write('team', async () => 'retry')).resolves.toBe('retry')
})
