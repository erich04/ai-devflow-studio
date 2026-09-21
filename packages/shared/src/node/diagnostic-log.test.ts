// @vitest-environment node
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { createDiagnosticLog } from './diagnostic-log'

it('serializes concurrent writes, upserts correlation IDs, and preserves safe history after reopen', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'devflow-log-'))
  try {
    const file = path.join(directory, 'diagnostics.json')
    const log = createDiagnosticLog(file)
    const record = { id: '00000000-0000-4000-8000-000000000001', timestamp: '2026-09-19T00:00:00Z', source: 'api' as const,
      operation: 'api_request' as const, phase: 'response' as const, reason: 'ok' as const, outcome: 'succeeded' as const, durationMs: 0, retryable: false, token: 'PRIVATE' }
    await Promise.all([log.append(record), log.append({ ...record, id: '00000000-0000-4000-8000-000000000002' })])
    await log.append({ ...record, reason: 'internal_error', outcome: 'failed' })
    expect(await createDiagnosticLog(file).list()).toHaveLength(2)
    expect((await createDiagnosticLog(file).list())[1]?.reason).toBe('internal_error')
    expect(await readFile(file, 'utf8')).not.toContain('PRIVATE')
    if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
