import { randomUUID } from 'node:crypto'

export type CredentialCategory = 'provider' | 'team'
export type CredentialAccessRecord = {
  id: string
  category: CredentialCategory
  operation: 'encrypt' | 'decrypt'
  state: 'waiting' | 'succeeded' | 'failed' | 'cancelled' | 'timed_out'
  startedAt: string
  durationMs: number
  code?: 'credential_unavailable' | 'credential_cancelled' | 'credential_timeout'
}

type Storage = {
  isAsyncEncryptionAvailable(): Promise<boolean>
  encryptStringAsync(value: string): Promise<Buffer>
  decryptStringAsync(value: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>
}

class CredentialAccessError extends Error {
  constructor(readonly code: NonNullable<CredentialAccessRecord['code']>, readonly diagnosticId: string) {
    const description = code === 'credential_cancelled' ? '已取消本次凭据操作。'
      : code === 'credential_timeout' ? '等待系统授权超时。请处理钥匙串窗口后重试原操作。'
        : '无法读取或保存凭据。请检查系统钥匙串授权，然后重试原操作；已保存的配置会保留。'
    super(`${description} 诊断编号：${diagnosticId}`)
  }
}

/** Keeps OS keychain waits off the main thread. Cancellation discards late results. */
export function createCredentialAccess(input: {
  storage: Storage
  changed?: (records: CredentialAccessRecord[]) => void
  timeoutMs?: number
}) {
  const records: CredentialAccessRecord[] = []
  const pending = new Map<string, () => void>()
  const starts = new Map<string, number>()
  const list = () => records.map((record) => ({ ...record,
    durationMs: record.state === 'waiting' ? Math.max(0, Date.now() - starts.get(record.id)!) : record.durationMs,
  }))
  const notify = () => { try { input.changed?.(list()) } catch { /* Diagnostics must not break credential access. */ } }

  async function perform(operation: CredentialAccessRecord['operation'], value: string, category: CredentialCategory): Promise<string> {
    const record: CredentialAccessRecord = {
      id: randomUUID(), category, operation, state: 'waiting', startedAt: new Date().toISOString(), durationMs: 0,
    }
    starts.set(record.id, Date.now())
    records.unshift(record)
    while (records.length > 100) {
      let index = records.length - 1
      while (index >= 0 && records[index]!.state === 'waiting') index -= 1
      if (index < 0) break
      starts.delete(records[index]!.id)
      records.splice(index, 1)
    }
    return new Promise<string>((resolve, reject) => {
      let done = false
      const finish = (state: CredentialAccessRecord['state'], result?: string, code?: CredentialAccessRecord['code']) => {
        if (done) return
        done = true
        clearTimeout(timer)
        pending.delete(record.id)
        record.state = state
        record.durationMs = Math.max(0, Date.now() - starts.get(record.id)!)
        if (code) record.code = code
        notify()
        if (state === 'succeeded') resolve(result!)
        else reject(new CredentialAccessError(code!, record.id))
      }
      const timer = setTimeout(() => finish('timed_out', undefined, 'credential_timeout'), input.timeoutMs ?? 120_000)
      pending.set(record.id, () => finish('cancelled', undefined, 'credential_cancelled'))
      notify()
      void (async () => {
        if (!(await input.storage.isAsyncEncryptionAvailable())) throw new Error('unavailable')
        if (done) return
        const result = operation === 'encrypt'
          ? (await input.storage.encryptStringAsync(value)).toString('base64')
          : (await input.storage.decryptStringAsync(Buffer.from(value, 'base64'))).result
        finish('succeeded', result)
      })().catch(() => finish('failed', undefined, 'credential_unavailable'))
    })
  }

  return {
    list,
    encrypt: (value: string, category: CredentialCategory) => perform('encrypt', value, category),
    decrypt: (value: string, category: CredentialCategory) => perform('decrypt', value, category),
    cancel(id: string) { const cancel = pending.get(id); cancel?.(); return Boolean(cancel) },
    cancelAll() { for (const cancel of pending.values()) cancel() },
  }
}
