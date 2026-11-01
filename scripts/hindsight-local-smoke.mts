import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { createHindsightClient, HINDSIGHT_PROTOCOL } from '../apps/desktop/electron/hindsight-client.js'

// Infrastructure-only lifecycle check of this repository's dedicated Compose service.
// Refuse a configured LLM: restarting a live worker can resume billable operations.
const execute = promisify(execFile)
const cwd = fileURLToPath(new URL('..', import.meta.url))
const compose = ['compose', '--env-file', 'deploy/hindsight/.env', '-f', 'deploy/hindsight/compose.yaml']
async function docker(args: string[]) {
  // Do not include subprocess stdout/stderr in an error: Compose config contains credentials.
  try { return (await execute('docker', args, { cwd, timeout: 210_000, maxBuffer: 1024 * 1024 })).stdout }
  catch { throw new Error('Hindsight Docker check failed; inspect the dedicated service locally') }
}
const config = JSON.parse(await docker([...compose, 'config', '--format', 'json']))
const service = config.services.hindsight
assert.equal(config.name, 'devflow-hindsight')
// Either no reachable model, or DevFlow's memory relay without its token, which refuses every call.
const llm = service.environment
const unreachableModel = llm.HINDSIGHT_API_LLM_BASE_URL === 'http://127.0.0.1:9/v1' &&
  llm.HINDSIGHT_API_LLM_API_KEY === 'devflow-no-provider' && llm.HINDSIGHT_API_LLM_MODEL === 'devflow-unconfigured'
const relayWithoutToken = /^http:\/\/host\.docker\.internal:\d{4,5}\/v1$/u.test(llm.HINDSIGHT_API_LLM_BASE_URL) &&
  llm.HINDSIGHT_API_LLM_API_KEY === 'devflow-relay-token-not-set'
assert.ok(unreachableModel || relayWithoutToken, 'Requires an infrastructure-only model configuration (leave DEVFLOW_MEMORY_RELAY_TOKEN unset)')
const published = service.ports.find((p: { target: number }) => p.target === 8888)
assert.equal(published.host_ip, '127.0.0.1')
const endpoint = `http://127.0.0.1:${published.published}`
const containerId = (await docker([...compose, 'ps', '-q', 'hindsight'])).trim()
assert.ok(containerId)
const actual = JSON.parse(await docker(['inspect', containerId]))[0]
assert.equal(actual.Config.Image, service.image)
const actualEnvironment = Object.fromEntries(actual.Config.Env.map((v: string) => {
  const split = v.indexOf('='); return [v.slice(0, split), v.slice(split + 1)]
}))
for (const field of ['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL']) {
  const key = `HINDSIGHT_API_${field}`
  // Compare booleans so assertion failures never print credentials.
  assert.ok(actualEnvironment[key] === service.environment[key], 'Running service differs from infrastructure-only config')
}
const image = JSON.parse(await docker(['image', 'inspect', actual.Image]))[0]
assert.equal(image.Config.Labels['org.opencontainers.image.revision'], HINDSIGHT_PROTOCOL.commit)
// DevFlow's image adds the multilingual embedding model; its store is named after that model.
assert.match(image.Config.Labels['dev.devflow.hindsight.embedding-model'] ?? '', /^intfloat\/multilingual-e5-small@[0-9a-f]{40}$/u)
assert.ok(actual.Mounts.some((m: { Name?: string; Destination: string }) =>
  m.Name === 'devflow-hindsight_data-multilingual-e5-small' && m.Destination === '/home/hindsight/.pg0'))

async function request(path: string, method = 'GET') {
  const response = await fetch(`${endpoint}${path}`, { method, redirect: 'error', signal: AbortSignal.timeout(10_000) })
  assert.ok(response.ok, `Hindsight check HTTP ${response.status}`)
  return response.json()
}
async function healthy() {
  const health = await request('/health')
  assert.equal(health.status, 'healthy')
  assert.equal(health.database, 'connected')
  const version = await request('/version')
  assert.equal(version.api_version, HINDSIGHT_PROTOCOL.version)
  assert.equal(version.features.bank_config_api, true)
}

await healthy()
const bank = `df-local-check-${randomUUID()}`
const bankPath = `/v1/default/banks/${bank}`
const labels = [{ key: 'sem_kind', type: 'multi-values', values: [{ value: 'business_rule' }] }]
let created = false
try {
  created = true // Include partial bank creation in cleanup.
  await createHindsightClient({ endpoint, timeoutMs: 10_000 }).configureBank(bank, labels, 'concise')
  await docker([...compose, 'stop', 'hindsight'])
  await docker([...compose, 'up', '-d', '--wait', '--wait-timeout', '180', 'hindsight'])
  await healthy()
  const saved = await request(`${bankPath}/config`)
  assert.equal(saved.bank_id, bank)
  assert.deepEqual(saved.config.entity_labels, labels)
  assert.equal(saved.config.enable_auto_consolidation, false)
  assert.equal(saved.config.enable_observations, false)
  assert.equal(saved.config.entities_allow_free_form, false)
  assert.equal(saved.config.retain_extraction_mode, 'concise')
} finally {
  if (created) {
    const deleted = await request(bankPath, 'DELETE')
    assert.equal(deleted.success, true)
  }
}
console.log(JSON.stringify({ status: 'passed', endpoint, protocol: HINDSIGHT_PROTOCOL,
  checks: ['image-commit', 'embedding-model', 'isolated-volume', 'health', 'bank-config', 'stop-start-persistence', 'test-bank-cleanup'],
  modelCalls: 0, notVerified: ['LLM extraction', 'semantic recall', 'desktop live integration'] }, null, 2))
