// @vitest-environment node
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { DIAGNOSTIC_HEADER, diagnosticDisplayError, type DiagnosticRecord } from '@ai-devflow/shared'
import { createDiagnosticLog } from '@ai-devflow/shared/node/diagnostic-log'
import { withApiDiagnostics } from '../apps/api/src/api-diagnostics'
import { createSeedTeamRepository } from '../apps/api/src/repositories/team-repository'
import { resolveTeamRoute } from '../apps/api/src/routes/team-routes'
import { createRemoteSyncClient, RemoteSyncHttpError } from '../apps/desktop/electron/remote-sync'
import { diagnosticFetch } from '../apps/desktop/electron/remote-diagnostics'

afterEach(() => vi.restoreAllMocks())

it('correlates an expired code over HTTP, persists safe diagnostics, and accepts a new single-use code', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'devflow-diagnostic-'))
  const apiLog = createDiagnosticLog(path.join(directory, 'api.json'))
  const desktopLog = createDiagnosticLog(path.join(directory, 'desktop.json'))
  const repository = createSeedTeamRepository()
  const session = (await repository.resolveBrowserSession('acct-demo-u-ling'))!
  const expired = await repository.createDesktopPairingCode({ projectId: 'p-payments' }, session)
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    const result = await withApiDiagnostics({
      id: request.headers[DIAGNOSTIC_HEADER], pathname: request.url!, method: request.method!, record: apiLog.append,
      run: () => resolveTeamRoute('POST', request.url!, repository, { body: JSON.parse(body) }),
    })
    response.writeHead(result.status, { 'content-type': 'application/json', ...result.headers })
    response.end(JSON.stringify(result.body))
  })
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as { port: number }
    const client = createRemoteSyncClient({ apiBaseUrl: `http://127.0.0.1:${address.port}`, fetcher: diagnosticFetch(fetch, desktopLog.append, 'local-fixture') })
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(expired.expiresAt) + 1)
    const error = await client.exchangeDesktopPairingCode({ code: expired.code }).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(RemoteSyncHttpError)
    expect(diagnosticDisplayError(error)).toContain('配对码已过期')
    now.mockRestore()
    const apiFailure = (await apiLog.list())[0]!
    expect(apiFailure).toMatchObject({ reason: 'pairing_code_expired', operation: 'pairing_exchange', outcome: 'failed', retryable: false })
    expect(apiFailure).not.toHaveProperty('projectId')
    expect((await desktopLog.list())[0]).toMatchObject({ id: apiFailure.id, reason: apiFailure.reason, projectId: 'local-fixture' })
    const fresh = await repository.createDesktopPairingCode({ projectId: 'p-payments' }, session)
    const bound = await client.exchangeDesktopPairingCode({ code: fresh.code })
    expect(bound).toMatchObject({ projectId: 'p-payments', userId: 'u-ling', role: 'lead' })
    await expect(client.exchangeDesktopPairingCode({ code: fresh.code })).rejects.toMatchObject({ code: 'pairing_code_invalid' })
    const restored = await createDiagnosticLog(path.join(directory, 'api.json')).list()
    expect(restored.map((record) => record.reason)).toEqual(['pairing_code_expired', 'ok', 'pairing_code_invalid'])
    const exported = await readFile(path.join(directory, 'api.json'), 'utf8')
    for (const secret of [expired.code, fresh.code, bound.token]) expect(exported).not.toContain(secret)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  }
})

it('records unexpected exceptions without arbitrary messages, headers, paths, or bodies', async () => {
  const records: DiagnosticRecord[] = []
  const result = await withApiDiagnostics({ id: 'secret-id', pathname: '/private/path?token=SECRET', method: 'POST',
    record: async (record) => { records.push(record) }, run: async () => { throw new Error('SECRET database password') },
  })
  expect(result.status).toBe(500)
  expect(records[0]).toMatchObject({ reason: 'internal_error', retryable: false })
  expect(JSON.stringify({ result, records })).not.toMatch(/SECRET|private|password|secret-id/)
  expect(result.headers?.[DIAGNOSTIC_HEADER]).toBe(records[0]?.id)
})
