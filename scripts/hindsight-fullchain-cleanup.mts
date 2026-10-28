/**
 * Cleanup-only helper for an explicitly identified, closed synthetic fullchain profile.
 * DEVFLOW_FULLCHAIN_ELECTRON_CLOSED=1
 * DEVFLOW_FULLCHAIN_REPORT=<isolated fullchain report.json>
 * DEVFLOW_HINDSIGHT_CLEANUP_BANK=<exact df-k-... bank from the authorized run>
 * HINDSIGHT_SMOKE_ENDPOINT=http://127.0.0.1:8890
 * node --import tsx scripts/hindsight-fullchain-cleanup.mts
 *
 * No refresh, recall, configure or retain is allowed. The transport can only inspect
 * existing operations and delete their exact projected documents in the expected bank.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createHindsightClient } from '../apps/desktop/electron/hindsight-client.ts'
import { HindsightService } from '../apps/desktop/electron/hindsight-service.ts'
import { createLocalStore, type LocalStore } from '../apps/desktop/electron/local-store.ts'
import {
  HINDSIGHT_TODO_KNOWLEDGE_PATHS, HINDSIGHT_TODO_SOURCE_COMMIT,
} from './hindsight-todo-fixture.ts'

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const inside = (root: string, candidate: string) => {
  const relative = path.relative(root, candidate)
  return Boolean(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

assert.equal(process.env.DEVFLOW_FULLCHAIN_ELECTRON_CLOSED, '1', 'The isolated Electron process must already be closed')
assert(process.env.DEVFLOW_FULLCHAIN_REPORT, 'Specify the exact synthetic fullchain report')
assert(process.env.DEVFLOW_HINDSIGHT_CLEANUP_BANK, 'Specify the exact authorized bank')
const expectedBank = process.env.DEVFLOW_HINDSIGHT_CLEANUP_BANK
assert(/^df-k-[0-9a-f-]{36}$/u.test(expectedBank))
const evidencePath = path.resolve(process.env.DEVFLOW_FULLCHAIN_REPORT)
const prior = JSON.parse(await readFile(evidencePath, 'utf8'))
assert(prior.finishedAt && prior.projectId && prior.runId)
assert.equal(prior.evidence?.sourceCommit, HINDSIGHT_TODO_SOURCE_COMMIT)
const root = await realpath(prior.workspace.tempRoot)
assert(inside(await realpath(os.tmpdir()), root) && path.basename(root).startsWith('devflow-hindsight-fullchain-'))
const repositoryPath = await realpath(prior.workspace.repoDir)
const userDataPath = await realpath(prior.workspace.userDataDir)
assert(inside(root, repositoryPath) && inside(root, userDataPath))
const databasePath = path.join(userDataPath, 'devflow.sqlite')
assert((await lstat(databasePath)).isFile())
const endpoint = new URL(process.env.HINDSIGHT_SMOKE_ENDPOINT ?? 'http://127.0.0.1:8890')
assert(endpoint.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname))
assert(endpoint.pathname === '/' && !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash)
const baseUrl = endpoint.origin
const documentDigests = async () => Object.fromEntries(await Promise.all(
  HINDSIGHT_TODO_KNOWLEDGE_PATHS.map(async (file) => {
    const sourcePath = await realpath(path.join(repositoryPath, file))
    assert(inside(repositoryPath, sourcePath))
    return [file, digest(await readFile(sourcePath))]
  }),
))
const sourceDigestsBefore = await documentDigests()
const report: Record<string, unknown> = {
  startedAt: new Date().toISOString(), priorReport: evidencePath, projectId: prior.projectId,
  bank: expectedBank, sourceCommit: HINDSIGHT_TODO_SOURCE_COMMIT, sourceDigestsBefore,
  status: 'started', cleanupOnly: true, modelRequestsAllowed: false, ledgerModified: false,
}
const output = path.join(path.dirname(evidencePath), 'cleanup-report.json')
const save = () => writeFile(output, `${JSON.stringify(report, null, 2)}\n`)
let store: LocalStore | undefined
try {
  store = await createLocalStore({ dbPath: databasePath })
  const project = (await store.listProjects()).find((item) => item.id === prior.projectId)
  assert(project && await realpath(project.path) === repositoryPath)
  const configurations = await store.listHindsightConfigurations()
  assert(configurations.length > 0 && configurations.every((item) =>
    item.projectId === prior.projectId && item.knowledgeBank === expectedBank &&
    item.endpoint.replace(/\/$/u, '') === baseUrl && !item.includeMemories),
  'The profile must contain only the explicitly authorized project/bank/endpoint')
  const config = await store.getHindsightConfiguration(prior.projectId)
  assert(config && config.knowledgeBank === expectedBank)
  const scope = { projectId: config.projectId, userId: config.ownerUserId }
  const originalRows = await store.listHindsightProjections()
  assert(originalRows.length > 0 && originalRows.every((row) =>
    row.projectId === scope.projectId && row.ownerUserId === scope.userId &&
    row.bankId === expectedBank && row.kind === 'knowledge'),
  'All durable jobs must belong to this one authorized synthetic knowledge bank')
  const bankPath = `/v1/default/banks/${encodeURIComponent(expectedBank)}`
  const operationPaths = new Set(originalRows.map((row) => `${bankPath}/operations/${encodeURIComponent(row.operationId)}`))
  const documentPaths = new Set(originalRows.map((row) => `${bankPath}/documents/${encodeURIComponent(row.documentId)}`))
  const requests: Array<{ method: string; path: string }> = []
  const guardedFetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const method = (init?.method ?? 'GET').toUpperCase()
    assert.equal(url.origin, baseUrl)
    assert(!url.search && !url.hash && !url.username && !url.password)
    assert((method === 'GET' && operationPaths.has(url.pathname)) ||
      (method === 'DELETE' && documentPaths.has(url.pathname)), 'Cleanup transport rejected a non-cleanup request')
    requests.push({ method, path: url.pathname })
    return fetch(input, init)
  }
  const client = createHindsightClient({ endpoint: baseUrl, fetcher: guardedFetch })
  const service = new HindsightService({
    store, transportAvailable: true,
    client: async (selected) => {
      assert.equal(selected.projectId, scope.projectId)
      assert.equal(selected.knowledgeBank, expectedBank)
      return client
    },
    loadKnowledge: async () => { throw new Error('Cleanup must never refresh or read knowledge for extraction') },
  })
  report.projectionsBefore = originalRows.map((row) => ({
    id: row.id, bank: row.bankId, documentId: row.documentId, operationId: row.operationId, status: row.status,
  }))
  await service.disable(scope)
  assert.equal((await service.status(scope)).enabled, false)
  await save()
  const deadline = Date.now() + 5 * 60_000
  while (Date.now() < deadline) {
    const remaining = (await store.listHindsightProjections(scope.projectId)).filter((row) => row.status !== 'cancelled')
    if (!remaining.length) break
    assert(remaining.every((row) => row.revoked && row.bankId === expectedBank))
    await service.tick()
    await delay(1_000)
  }
  const finalRows = await store.listHindsightProjections(scope.projectId)
  report.pendingCleanup = finalRows.filter((row) => row.status !== 'cancelled').map((row) => ({
    id: row.id, bank: row.bankId, status: row.status,
  }))
  assert(finalRows.every((row) => row.status === 'cancelled'), 'Durable cleanup jobs did not settle')
  const inspect = async (suffix: string) => {
    const response = await fetch(`${baseUrl}${bankPath}/${suffix}`, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10_000),
    })
    assert(response.ok, `Cleanup evidence HTTP ${response.status}`)
    return response.json() as Promise<Record<string, unknown>>
  }
  let stats = await inspect('stats')
  const graphDeadline = Date.now() + 30_000
  while (Number(stats.pending_operations) > 0 && Date.now() < graphDeadline) {
    await delay(1_000)
    stats = await inspect('stats')
  }
  const entities = await inspect('entities?limit=1')
  for (const field of ['total_documents', 'total_nodes', 'total_links', 'pending_operations']) assert.equal(stats[field], 0)
  assert.equal(entities.total, 0)
  const sourceDigestsAfter = await documentDigests()
  assert.deepEqual(sourceDigestsAfter, sourceDigestsBefore, 'Cleanup changed synthetic knowledge bytes')
  report.status = 'verified'
  report.configurationEnabled = (await service.status(scope)).enabled
  report.sourceDigestsAfter = sourceDigestsAfter
  report.knowledgeBytesUnchanged = true
  report.bankEvidence = { ...stats, entityCount: entities.total }
  report.transportRequests = requests
  report.projectionCount = finalRows.length
} catch (error) {
  report.status = 'incomplete'
  report.failure = error instanceof Error ? error.message : String(error)
  process.exitCode = 1
} finally {
  store?.close()
  report.finishedAt = new Date().toISOString()
  await save()
  console.log(JSON.stringify({ status: report.status, bank: expectedBank, output,
    bankEvidence: report.bankEvidence, failure: report.failure }))
}
