import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCredentialAccess, type CredentialAccessRecord } from './credential-access'

afterEach(() => vi.useRealTimers())

function harness() {
  const changed = vi.fn<(records: CredentialAccessRecord[]) => void>()
  const storage = {
    isAsyncEncryptionAvailable: vi.fn(async () => true),
    encryptStringAsync: vi.fn(async (_secret: string) => Buffer.from('encrypted-fixture')),
    decryptStringAsync: vi.fn(async (_buffer: Buffer) => ({ result: 'fixture-secret', shouldReEncrypt: true })),
  }
  const access = createCredentialAccess({ storage, changed, timeoutMs: 30_000 })
  return { storage, changed, access }
}

describe('asynchronous credential access', () => {
  it('keeps authorization observable while the OS is waiting and publishes only safe diagnostics', async () => {
    vi.useFakeTimers()
    const { access, storage } = harness()
    let finish!: (value: { result: string; shouldReEncrypt: boolean }) => void
    storage.decryptStringAsync.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const result = access.decrypt('ZW5jcnlwdGVk', 'provider')
    await vi.advanceTimersByTimeAsync(1200)
    expect(access.list()[0]).toMatchObject({ category: 'provider', operation: 'decrypt', state: 'waiting', durationMs: 1200 })
    expect(JSON.stringify(access.list())).not.toContain('ZW5jcnlwdGVk')
    finish({ result: 'real-secret-must-stay-local', shouldReEncrypt: true })
    await expect(result).resolves.toBe('real-secret-must-stay-local')
    expect(access.list()[0]).toMatchObject({ state: 'succeeded', durationMs: 1200 })
    expect(JSON.stringify(access.list())).not.toContain('real-secret')
  })

  it('cancels the caller and discards a late secret so the cancelled operation cannot continue', async () => {
    const { access, storage } = harness()
    let finish!: (value: { result: string; shouldReEncrypt: boolean }) => void
    storage.decryptStringAsync.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const pending = access.decrypt('ZW5jcnlwdGVk', 'team')
    const rejection = expect(pending).rejects.toMatchObject({ code: 'credential_cancelled' })
    await vi.waitFor(() => expect(storage.decryptStringAsync).toHaveBeenCalled())
    expect(access.cancel(access.list()[0]!.id)).toBe(true)
    await rejection
    finish({ result: 'late-secret', shouldReEncrypt: false })
    await Promise.resolve()
    expect(access.list()[0]!.state).toBe('cancelled')
    await expect(access.decrypt('ZW5jcnlwdGVk', 'team')).resolves.toBe('fixture-secret')
  })

  it('redacts an OS denial and allows a new attempt without deleting saved credentials', async () => {
    const { access, storage } = harness()
    storage.decryptStringAsync.mockRejectedValueOnce(new Error('Authorization denied secret-token /Users/private/key'))
    await expect(access.decrypt('ZW5jcnlwdGVk', 'provider')).rejects.toMatchObject({ code: 'credential_unavailable' })
    expect(access.list()[0]).toMatchObject({ state: 'failed', code: 'credential_unavailable' })
    expect(JSON.stringify(access.list())).not.toMatch(/secret-token|\/Users\/|ZW5j/)
    await expect(access.decrypt('ZW5jcnlwdGVk', 'provider')).resolves.toBe('fixture-secret')
  })

  it('cancels only the credential wait belonging to the aborted conversation', async () => {
    const { access, storage } = harness()
    const controller = new AbortController()
    let finish!: (value: { result: string; shouldReEncrypt: boolean }) => void
    storage.decryptStringAsync.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const pending = access.decrypt('ZW5jcnlwdGVk', 'provider', controller.signal)
    const rejection = expect(pending).rejects.toMatchObject({ code: 'credential_cancelled' })
    await vi.waitFor(() => expect(storage.decryptStringAsync).toHaveBeenCalled())
    controller.abort()
    await rejection
    await expect(access.decrypt('ZW5jcnlwdGVk', 'team')).resolves.toBe('fixture-secret')
    finish({ result: 'discard-this-secret', shouldReEncrypt: false })
    await Promise.resolve()
    expect(access.list().map((record) => record.state)).toEqual(['succeeded', 'cancelled'])
  })

  it('bounds an unfinished authorization wait and never falls back to plaintext or synchronous storage', async () => {
    vi.useFakeTimers()
    const { access, storage } = harness()
    storage.isAsyncEncryptionAvailable.mockImplementationOnce(() => new Promise(() => {}))
    const result = access.encrypt('secret-value', 'provider')
    const rejection = expect(result).rejects.toMatchObject({ code: 'credential_timeout' })
    await vi.advanceTimersByTimeAsync(30_001)
    await rejection
    expect(storage.encryptStringAsync).not.toHaveBeenCalled()
    expect(access.list()[0]).toMatchObject({ state: 'timed_out', durationMs: 30_000 })
    storage.isAsyncEncryptionAvailable.mockResolvedValueOnce(false)
    await expect(access.encrypt('secret-value', 'provider')).rejects.toMatchObject({ code: 'credential_unavailable' })
    expect(storage.encryptStringAsync).not.toHaveBeenCalled()
  })

  it('writes encrypted buffers as base64 and does not expose input or output in history', async () => {
    const { access } = harness()
    await expect(access.encrypt('new-secret', 'team')).resolves.toBe(Buffer.from('encrypted-fixture').toString('base64'))
    expect(JSON.stringify(access.list())).not.toMatch(/new-secret|encrypted-fixture/)
  })
})
