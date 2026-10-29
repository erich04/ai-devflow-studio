import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual, promisify } from 'node:util'

// Copies every bank of the previous Hindsight store into the current one (deploy/hindsight).
// The previous store is the English-model volume devflow-hindsight_data, or the volume named by
// DEVFLOW_HINDSIGHT_MIGRATE_FROM. It uses Hindsight's own bank export and import: an export leaves
// the vectors out and the import embeds every memory again with the current model. No model is
// called. The previous volume keeps its memories, and each archive stays under out/hindsight-migration.
// Close the desktop first, so that nothing writes to the current store meanwhile.
const execute = promisify(execFile)
const cwd = fileURLToPath(new URL('..', import.meta.url))
const compose = ['compose', '--env-file', 'deploy/hindsight/.env', '-f', 'deploy/hindsight/compose.yaml']
// The image that wrote the English-model store, with its own models and no reachable model service.
const PREVIOUS_IMAGE = 'ghcr.io/vectorize-io/hindsight:1.0.0@sha256:a88678c038b0e4340822b02a5efc566c56d8176b5bffa731bc433fd37f978e4c'
const sourceVolume = process.env.DEVFLOW_HINDSIGHT_MIGRATE_FROM ?? 'devflow-hindsight_data'
const sourcePort = Number(process.env.DEVFLOW_HINDSIGHT_MIGRATE_PORT ?? 8896)
const sourceContainer = 'devflow-hindsight-migrate-source'
// A restore is recorded against an existing bank and writes a bank that does not exist yet.
const STAGING = 'devflow-migration-staging'

async function docker(args: string[], options: { quiet?: boolean; timeout?: number } = {}) {
  try { return (await execute('docker', args, { cwd, timeout: options.timeout ?? 120_000, maxBuffer: 16 * 1024 * 1024 })).stdout }
  catch (error) {
    // Compose config contains the relay token, so its output is never printed.
    const detail = options.quiet ? '' : `: ${String((error as { stderr?: string }).stderr ?? '').trim().slice(0, 400)}`
    throw new Error(`docker ${args[0]} failed${detail}`)
  }
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const bankPath = (bank: string) => `/v1/default/banks/${encodeURIComponent(bank)}`
async function http(endpoint: string, method: string, route: string, body?: unknown) {
  const response = await fetch(`${endpoint}${route}`, { method, redirect: 'error', signal: AbortSignal.timeout(60_000),
    ...(body instanceof FormData ? { body } : body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) })
  const text = await response.text()
  return { status: response.status, json: (text ? JSON.parse(text) : null) as any }
}
async function healthy(endpoint: string, waitMs: number, running: () => Promise<boolean> = async () => true) {
  const deadline = Date.now() + waitMs
  for (;;) {
    try {
      const health = (await http(endpoint, 'GET', '/health')).json
      if (health?.status === 'healthy' && health.database === 'connected' && (await http(endpoint, 'GET', '/version')).json?.api_version === '1.0.0') return
    } catch { /* Still starting. */ }
    if (Date.now() > deadline || !(await running())) throw new Error(`Hindsight at ${endpoint} is not healthy`)
    await sleep(2_000)
  }
}
async function settle(endpoint: string, bank: string, operationId: unknown) {
  assert.equal(typeof operationId, 'string', 'Hindsight returned no operation')
  const deadline = Date.now() + 30 * 60_000
  for (;;) {
    const { json } = await http(endpoint, 'GET', `${bankPath(bank)}/operations/${encodeURIComponent(String(operationId))}`)
    if (json?.status === 'completed') return json
    if (['failed', 'cancelled', 'not_found'].includes(json?.status)) throw new Error(`${json.operation_type ?? 'operation'} ${json.status}: ${String(json.error_message ?? '').slice(0, 300)}`)
    if (Date.now() > deadline) throw new Error(`operation ${String(operationId)} did not finish`)
    await sleep(1_000)
  }
}
type Stats = { total_documents: number; total_nodes: number; nodes_by_fact_type: Record<string, number>; pending_operations: number; pending_consolidation: number }
const counts = (stats: Stats) => ({ documents: stats.total_documents, ...stats.nodes_by_fact_type })

const config = JSON.parse(await docker([...compose, 'config', '--format', 'json'], { quiet: true }))
const service = config.services.hindsight
const target = `http://127.0.0.1:${service.ports.find((port: { target: number }) => port.target === 8888).published}`
const mount = service.volumes.find((volume: { target: string }) => volume.target === '/home/hindsight/.pg0')
const targetVolume: string = config.volumes[mount.source].name
assert.notEqual(targetVolume, sourceVolume, 'The previous store is the current one')
await healthy(target, 5_000).catch(() => { throw new Error('Start the current store first: corepack pnpm hindsight:up') })
try { await docker(['volume', 'inspect', sourceVolume]) } catch {
  console.log(JSON.stringify({ status: 'nothing to migrate', from: sourceVolume }))
  process.exit(0)
}
// Two databases on one data directory would corrupt it.
assert.equal((await docker(['ps', '-q', '--filter', `volume=${sourceVolume}`])).trim(), '', `A running container uses ${sourceVolume}; stop it first`)

const directory = path.join(cwd, 'out', 'hindsight-migration', new Date().toISOString().replace(/[:.]/gu, '-'))
await mkdir(directory, { recursive: true })
const environment = Object.entries({
  HINDSIGHT_API_LLM_PROVIDER: 'openai', HINDSIGHT_API_LLM_MODEL: 'devflow-unconfigured',
  HINDSIGHT_API_LLM_BASE_URL: 'http://127.0.0.1:9/v1', HINDSIGHT_API_LLM_API_KEY: 'devflow-no-provider',
  HINDSIGHT_API_SKIP_LLM_VERIFICATION: 'true', HINDSIGHT_API_ENABLE_BANK_LLM_HEALTH: 'false', HINDSIGHT_API_MCP_ENABLED: 'false',
  HINDSIGHT_API_ENABLE_AUTO_CONSOLIDATION: 'false', HINDSIGHT_API_LLM_MAX_RETRIES: '0',
  // Its own worker id, so the previous store's interrupted work is not resumed; the export runs in the worker.
  HINDSIGHT_API_WORKER_ID: 'devflow-hindsight-migrate', HINDSIGHT_API_WORKER_MAX_SLOTS: '1',
  HINDSIGHT_API_WORKER_CONSOLIDATION_RESERVED_SLOTS: '0', HINDSIGHT_API_WORKER_MAX_RETRIES: '0',
  HINDSIGHT_API_EMBEDDINGS_PROVIDER: 'local', HINDSIGHT_API_EMBEDDINGS_LOCAL_MODEL: 'BAAI/bge-small-en-v1.5',
  HINDSIGHT_API_RERANKER_PROVIDER: 'local', HINDSIGHT_API_RERANKER_LOCAL_MODEL: 'cross-encoder/ms-marco-MiniLM-L-6-v2',
  HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1',
}).flatMap(([key, value]) => ['-e', `${key}=${value}`])
const source = `http://127.0.0.1:${sourcePort}`
const exported: Array<{ bank: string; file: string; counts: Record<string, number>; pending: number }> = []
await docker(['rm', '-f', sourceContainer]).catch(() => undefined)
await docker(['run', '-d', '--name', sourceContainer, '--init', '--shm-size', '1g', '--memory', '3g', '--cpus', '2',
  '-p', `127.0.0.1:${sourcePort}:8888`, '-v', `${sourceVolume}:/home/hindsight/.pg0`, ...environment, PREVIOUS_IMAGE], { timeout: 600_000 })
try {
  await healthy(source, 300_000, async () => (await docker(['inspect', '--format', '{{.State.Running}}', sourceContainer])).trim() === 'true')
    .catch(async (error) => {
      // This container holds no credential, so its log can be shown.
      const logs = await execute('docker', ['logs', '--tail', '15', sourceContainer], { maxBuffer: 1024 * 1024 }).catch(() => ({ stdout: '', stderr: '' }))
      console.error(`${logs.stdout}${logs.stderr}`.trim())
      throw error
    })
  const banks: string[] = []
  for (let offset = 0; ; offset += 100) {
    const page = (await http(source, 'GET', `/v1/default/banks?limit=100&offset=${offset}`)).json
    banks.push(...page.banks.map((bank: { bank_id: string }) => bank.bank_id).filter((bank: string) => bank !== STAGING))
    if (page.banks.length === 0 || offset + page.banks.length >= page.total) break
  }
  for (const bank of banks) {
    const stats: Stats = (await http(source, 'GET', `${bankPath(bank)}/stats`)).json
    const submitted = await http(source, 'POST', `${bankPath(bank)}/transfer/export?include_data=true&include_bank_config=true&include_history=false`)
    const done = await settle(source, bank, submitted.json?.operation_id)
    const download = await fetch(`${source}${done.result_metadata.download_url}`, { redirect: 'error', signal: AbortSignal.timeout(300_000) })
    assert.ok(download.ok, `Export of ${bank}: HTTP ${download.status}`)
    const archive = Buffer.from(await download.arrayBuffer())
    assert.equal(archive.byteLength, done.result_metadata.byte_size, `Export of ${bank} is incomplete`)
    const file = path.join(directory, `${encodeURIComponent(bank)}.zip`)
    await writeFile(file, archive)
    exported.push({ bank, file, counts: counts(stats), pending: stats.pending_operations + stats.pending_consolidation })
  }
} finally {
  await docker(['stop', sourceContainer], { timeout: 120_000 }).catch(() => undefined)
  await docker(['rm', '-f', sourceContainer]).catch(() => undefined)
}

const results: Array<Record<string, unknown>> = []
await http(target, 'PUT', bankPath(STAGING), { name: STAGING })
try {
  for (const item of exported) {
    const current = await http(target, 'GET', `${bankPath(item.bank)}/stats`)
    if (current.status === 200) {
      if (current.json.total_documents !== 0 || current.json.total_nodes !== 0) {
        // Copied by an earlier run, or written here since: never merged or overwritten.
        const here = counts(current.json)
        results.push({ bank: item.bank, status: isDeepStrictEqual(here, item.counts) ? 'already here' : 'skipped: this bank already has other memories here',
          before: item.counts, here })
        continue
      }
      // The desktop creates its banks empty at start; a restore needs the id free.
      assert.equal((await http(target, 'DELETE', bankPath(item.bank))).json?.success, true, `Could not replace the empty bank ${item.bank}`)
    }
    const form = new FormData()
    form.append('file', new Blob([await readFile(item.file)], { type: 'application/zip' }), path.basename(item.file))
    const submitted = await http(target, 'POST', `${bankPath(STAGING)}/transfer/import?mode=restore&target_bank_id=${encodeURIComponent(item.bank)}` +
      '&include_data=true&include_bank_config=true&include_history=false', form)
    assert.equal(submitted.status, 202, `Import of ${item.bank}: HTTP ${submitted.status} ${JSON.stringify(submitted.json).slice(0, 300)}`)
    await settle(target, STAGING, submitted.json.operation_id)
    const after = counts((await http(target, 'GET', `${bankPath(item.bank)}/stats`)).json)
    results.push({ bank: item.bank, status: isDeepStrictEqual(after, item.counts) ? 'copied' : 'copied, but the counts differ', before: item.counts, after,
      ...(item.pending ? { pendingInPreviousStore: item.pending } : {}) })
  }
} finally {
  await http(target, 'DELETE', bankPath(STAGING)).catch(() => undefined)
}
console.log(JSON.stringify({ from: sourceVolume, to: targetVolume, archives: path.relative(cwd, directory), banks: results, modelCalls: 0 }, null, 2))
if (results.some((item) => item.status !== 'copied' && item.status !== 'already here')) process.exitCode = 1
