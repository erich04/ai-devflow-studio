import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import { createHindsightClient, HINDSIGHT_PROTOCOL } from '../apps/desktop/electron/hindsight-client.js'
import { HindsightService } from '../apps/desktop/electron/hindsight-service.js'
import { createLocalStore } from '../apps/desktop/electron/local-store.js'
import { createRepositoryKnowledgeService } from '../apps/desktop/electron/repository-knowledge.js'

if (process.env.HINDSIGHT_SMOKE_AUTHORIZED !== '1' || !process.env.HINDSIGHT_SMOKE_ENDPOINT) {
  throw new Error('Authorize the synthetic project, provider and budget before this live test.')
}
const endpoint = process.env.HINDSIGHT_SMOKE_ENDPOINT
const apiKey = process.env.HINDSIGHT_SMOKE_API_KEY
// Exercise the actual host client's default two-second deadline.
const client = createHindsightClient({ endpoint, ...(apiKey ? { apiKey } : {}) })
const execute = promisify(execFile)
const root = await mkdtemp(path.join(os.tmpdir(), 'devflow-hindsight-live-fixture-'))
const projectPath = path.join(root, 'project')
await mkdir(path.join(projectPath, 'docs/knowledge'), { recursive: true })
const model = JSON.parse(await readFile(new URL('../docs/examples/hindsight/model.json', import.meta.url), 'utf8'))
const refundPath = 'docs/knowledge/refund.md'
const inventoryPath = 'docs/knowledge/inventory.md'
const refund = '# 青杉订单系统退款规则\n\n这是合成验证数据。\n模块：售后模块。\n规则名称：退款原单核验。\n规则陈述：每笔退款必须关联原订单；超过七天的订单不得自动退款。\n本文只描述业务规则，不表示任何审批已完成。\n'
const inventory = '# 碧海库存系统入库规则\n\n这是合成验证数据。\n模块：仓储模块。\n规则名称：入库批次登记。\n规则陈述：每次入库必须登记供应商批次号；无批次号的货物不能入库。\n'
await writeFile(path.join(projectPath, 'docs/knowledge/model.json'), JSON.stringify(model))
await writeFile(path.join(projectPath, refundPath), refund)
await writeFile(path.join(projectPath, inventoryPath), inventory)
await execute('git', ['init', projectPath])
await execute('git', ['-C', projectPath, 'add', 'docs/knowledge'])
const dbPath = path.join(root, 'fixture.sqlite')
let store = await createLocalStore({ dbPath })
const project = { id: `df-synthetic-${randomUUID()}`, name: 'Synthetic Hindsight test', path: projectPath,
  packageManager: 'npm' as const, testCommand: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
await store.upsertProject(project)
const snapshot = await createRepositoryKnowledgeService().index(project)
const makeService = () => new HindsightService({ store, transportAvailable: true,
  client: async () => client, loadKnowledge: async () => snapshot })
let service = makeService()
const scope = { projectId: project.id, userId: 'synthetic-test-owner' }
let bank: string | undefined
const report: Record<string, unknown> = { protocol: HINDSIGHT_PROTOCOL, endpoint, fixture: root, checks: [] }
const checks: string[] = []
report.checks = checks

async function request(suffix: string) {
  assert.ok(bank)
  const response = await fetch(`${endpoint}/v1/default/banks/${encodeURIComponent(bank)}/${suffix}`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    redirect: 'error', signal: AbortSignal.timeout(10_000),
  })
  assert.ok(response.ok, `Synthetic evidence HTTP ${response.status}`)
  return response.json()
}
async function pump(ready: () => Promise<boolean>, label: string) {
  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    if (await ready()) return
    await service.tick()
    await delay(1_000)
  }
  throw new Error(`Synthetic host ${label} did not settle within 180 seconds`)
}

try {
  await service.configure(scope, { projectId: project.id, endpoint,
    selectedPaths: [refundPath, inventoryPath], includeMemories: false, enabled: true }, null)
  const config = await store.getHindsightConfiguration(project.id)
  assert.ok(config)
  bank = config.knowledgeBank
  report.bank = bank
  await pump(async () => (await service.status(scope)).counts.ready === 2, 'initial retain')
  checks.push('real-Git-SQLite-outbox-retain')

  store.close()
  store = await createLocalStore({ dbPath })
  service = makeService()
  assert.equal((await service.status(scope)).counts.ready, 2)
  checks.push('SQLite-reopen')
  const entities = await request('entities?limit=100')
  const names: string[] = entities.items.map((item: { canonical_name: string }) => item.canonical_name)
  report.entities = names
  const memories = await request('memories/list?limit=100')
  report.extractedMemories = memories.items
  // A map yields independent label paths, not an approved business-rule object.
  assert.ok(names.some((name) => name.includes('sem_module:售后模块')), 'Chinese module label missing')
  assert.ok(names.some((name) => name.includes('sem_module:仓储模块')), 'Inventory module label missing')
  assert.ok(names.some((name) => name.startsWith('sem_rule:name:')), 'Rule-name map path missing')
  assert.ok(names.some((name) => name.startsWith('sem_rule:statement:')), 'Rule-statement map path missing')
  assert.ok(memories.items.some((item: { tags?: string[] }) => item.tags?.includes('sem_kind:business_rule')), 'Business-rule tag missing')
  checks.push('Chinese-multi-text-map-enum-extraction')

  const searchEvidence = []
  for (const [query, expectedPath] of [
    ['退款需要什么凭证？', refundPath],
    ['货物没有供应商批号，可以入库吗？', inventoryPath],
    ['What is required to return money to a customer?', refundPath],
  ]) {
    const start = performance.now()
    const result = await service.search(scope, { query }, service.createSearchTurn())
    const match = result.matches.find((m) => m.path === expectedPath)
    searchEvidence.push({ query, durationMs: Math.round(performance.now() - start),
      degraded: result.degraded, paths: result.matches.map((m) => ({ path: m.path, reason: m.matchReason })) })
    assert.equal(result.degraded, false)
    assert.ok(match, 'Expected current local source missing')
    assert.ok(match.matchReason === 'semantic' || match.matchReason === 'both', 'No verified semantic candidate')
    const read = await service.read(scope, match.readArgs)
    assert.ok('content' in read)
    assert.equal(read.content, expectedPath === refundPath ? refund : inventory)
  }
  report.searches = searchEvidence
  checks.push('Chinese-English-recall-current-source-read')
  const original = await service.search(scope, { query: '退款' }, service.createSearchTurn())
  const originalMatch = original.matches.find((m) => m.path === refundPath)
  assert.ok(originalMatch)
  await assert.rejects(service.read({ ...scope, userId: 'foreign-user' }, originalMatch.readArgs))
  checks.push('foreign-user-source-read-denied')

  await writeFile(path.join(projectPath, refundPath), refund.replace('七天', '九天'))
  assert.equal((await service.read(scope, originalMatch.readArgs)).error, 'source_changed')
  await service.refresh(scope)
  await pump(async () => {
    const rows = await store.listHindsightProjections(project.id)
    return rows.filter((r) => !r.revoked && r.status === 'ready').length === 2 &&
      rows.every((r) => !r.revoked || r.status === 'cancelled')
  }, 'source revision and old-document cleanup')
  const revised = await service.search(scope, { query: '退款期限' }, service.createSearchTurn())
  assert.ok(revised.matches.find((m) => m.path === refundPath)?.content.includes('九天'))
  checks.push('revision-invalidates-old-reference-and-cleans-old-document')

  // Revoke after the real submission, before the host observes it as ready.
  await writeFile(path.join(projectPath, inventoryPath), inventory.replace('供应商批次号', '供应商批次号与到货日期'))
  await service.refresh(scope)
  await service.tick()
  const inFlight = (await store.listHindsightProjections(project.id)).find((r) =>
    !r.revoked && r.sourcePath === inventoryPath && r.status === 'submitted')
  // If the first tick cleaned the preceding revision, process the new queued row.
  if (!inFlight) {
    await service.tick()
    await service.tick()
  }
  const submitted = (await store.listHindsightProjections(project.id)).find((r) =>
    !r.revoked && r.sourcePath === inventoryPath && r.attempts > 0)
  assert.ok(submitted, 'No revised document was submitted for revocation test')
  report.revokedOperation = { documentId: submitted.documentId, operationId: submitted.operationId,
    serverStatusAtDisable: await client.operation(bank, submitted.operationId) }
  await service.disable(scope)
  assert.equal((await service.search(scope, { query: '入库' }, service.createSearchTurn())).matches.length, 0)
  checks.push('revoke-after-submission-hides-source-immediately')
} finally {
  if (bank) {
    await service.disable(scope)
    try {
      await pump(async () => (await store.listHindsightProjections(project.id))
        .every((r) => r.status === 'cancelled'), 'remote cleanup')
      // Graph maintenance runs after document deletion; wait for its observable result.
      const deadline = Date.now() + 30_000
      let stats = await request('stats')
      while (stats.pending_operations > 0 && Date.now() < deadline) { await delay(1_000); stats = await request('stats') }
      assert.equal(stats.total_documents, 0)
      assert.equal(stats.total_nodes, 0)
      assert.equal(stats.total_links, 0)
      assert.equal(stats.pending_operations, 0)
      const entities = await request('entities?limit=100')
      assert.equal(entities.total, 0)
      report.cleanup = stats
      checks.push('revoked-operations-settle-before-cleanup', 'no-documents-facts-links-entities-left')
    } catch (error) {
      report.cleanupError = error instanceof Error ? error.message : 'Cleanup failed'
      report.pendingCleanup = (await store.listHindsightProjections(project.id))
        .filter((r) => r.status !== 'cancelled').map((r) => ({ bank: r.bankId, documentId: r.documentId, operationId: r.operationId }))
      throw error
    } finally {
      await writeFile(path.join(root, 'evidence.json'), JSON.stringify(report, null, 2))
      store.close()
      console.log(`Synthetic evidence: ${path.join(root, 'evidence.json')}`)
    }
  } else store.close()
}
console.log(JSON.stringify({ status: 'passed', ...report,
  notVerified: ['30-question retrieval comparison', 'production billing statement', 'all possible in-flight cancellation races',
    'formal ontology reasoning', 'Electron live UI and active semantic memory injection'] }, null, 2))
