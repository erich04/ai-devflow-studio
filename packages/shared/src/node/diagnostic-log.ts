import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { sanitizeDiagnosticRecord, type DiagnosticRecord } from '../diagnostics'

/** Owner-readable bounded history, separate from business/audit storage. */
export function createDiagnosticLog(filePath: string) {
  let queue = Promise.resolve()
  async function read(): Promise<DiagnosticRecord[]> {
    try {
      if ((await stat(filePath)).size > 4_000_000) throw new Error('Diagnostic history is too large')
      const data: unknown = JSON.parse(await readFile(filePath, 'utf8'))
      if (!Array.isArray(data)) return []
      return data.slice(-1000).flatMap((item) => { try { return [sanitizeDiagnosticRecord(item)] } catch { return [] } })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw new Error('Diagnostic history is unavailable')
    }
  }
  return {
    async list() { await queue; return read() },
    append(record: DiagnosticRecord) {
      const safe = sanitizeDiagnosticRecord(record)
      const task = queue.then(async () => {
        const records = await read()
        const next = [...records.filter((item) => !(item.id === safe.id && item.source === safe.source)), safe].slice(-1000)
        await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 })
        const temporary = `${filePath}.${randomUUID()}.tmp`
        try {
          await writeFile(temporary, JSON.stringify(next), { mode: 0o600 })
          await rename(temporary, filePath)
        } finally { await rm(temporary, { force: true }).catch(() => {}) }
      })
      queue = task.catch(() => {})
      return task
    },
    flush() { return queue },
  }
}
