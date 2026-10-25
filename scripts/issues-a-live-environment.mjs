// Explicit opt-in helpers for the A package's isolated real UI validation.
// Default/preflight is read-only. No command calls a model or touches another stack.
import { spawn, execFile } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { access, mkdir, open, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const root = fileURLToPath(new URL('..', import.meta.url))
const stateDir = path.join(root, '.tmp/issues-a-live-validation')
const manifestPath = path.join(stateDir, 'runtime.json')
const ports = { api: 15310, web: 15311, postgres: 16432, electron: 19522, gateway: 8892 }
const apiUrl = `http://127.0.0.1:${ports.api}`
const webUrl = `http://127.0.0.1:${ports.web}`
const gatewayImage = 'ghcr.io/vectorize-io/hindsight:1.0.0@sha256:a88678c038b0e4340822b02a5efc566c56d8176b5bffa731bc433fd37f978e4c'
const oldLedgers = [
  ['hindsight-deepseek-validation', 'be1fe80f44376df3f0a8342c8221074181f6648005d9bf323379e443cb8ecf54'],
  ['hindsight-fullchain-validation', '2a44c4b5ec69f741ab239df567aadce527e333bb29704909edc8a02546bbb1f7'],
  ['automatic-memory-live-validation', '6c693558997b624d959e6e5fa5ecb193ce0fa88bb652b02e962d072cac91eea4'],
]
const minimalEnv = Object.fromEntries(['PATH', 'HOME', 'USER', 'LANG', 'TMPDIR'].filter(key => process.env[key]).map(key => [key, process.env[key]]))
const command = process.argv[2] ?? 'preflight'
const exists = async (file) => access(file).then(() => true, () => false)
const writeJson = async (file, value) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
const load = async () => JSON.parse(await readFile(manifestPath, 'utf8'))
const save = async (value) => writeJson(manifestPath, value)
const run = async (name, args, options = {}) => execute(name, args, { cwd: root, env: minimalEnv, maxBuffer: 2 * 1024 * 1024, ...options })
const ledgerTotal = ledger => ledger.calls.reduce((sum, call) => sum + (call.committed_microyuan ?? call.reserved_microyuan), 0)

async function auditOldLedgers() {
  const ledgers = []
  for (const [name, expectedHash] of oldLedgers) {
    const bytes = await readFile(path.join(root, '.tmp', name, 'budget/ledger.json'))
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const ledger = JSON.parse(bytes)
    if (sha256 !== expectedHash || ledger.closed !== true) throw new Error(`Historical ledger changed or reopened: ${name}`)
    ledgers.push({ name, closed: true, sha256, committedAndReservedMicroyuan: ledgerTotal(ledger), unknownCalls: ledger.calls.filter(call => call.committed_microyuan == null).length })
  }
  const prior = ledgers.reduce((sum, ledger) => sum + ledger.committedAndReservedMicroyuan, 0)
  if (prior !== 2639110) throw new Error('Historical spending no longer matches the agreed cumulative budget')
  return { ledgers, priorMicroyuan: prior, aPackageCapMicroyuan: 8000000, bPackageReservedMicroyuan: 8000000, unallocatedMicroyuan: 20000000 - prior - 16000000 }
}

async function freePort(port) {
  const server = createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
}
async function waitHttp(url) {
  for (let index = 0; index < 120; index++) {
    if (await fetch(url, { signal: AbortSignal.timeout(1500) }).then(response => response.ok, () => false)) return
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error(`Endpoint did not become ready; inspect the private logs: ${url}`)
}
async function background(name, args, env, logName, manifest) {
  const log = await open(path.join(stateDir, logName), 'a', 0o600)
  try {
    const child = spawn(name, args, { cwd: root, env: { ...minimalEnv, ...env }, detached: true, stdio: ['ignore', log.fd, log.fd] })
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
    child.unref()
    const started = (await run('ps', ['-p', String(child.pid), '-o', 'lstart='])).stdout.trim()
    manifest.processes.push({ pid: child.pid, started, commandIncludes: args.join(' '), logName })
    await save(manifest)
  } finally { await log.close() }
}
async function checkedContainer(name, owner) {
  try {
    const data = JSON.parse((await run('docker', ['inspect', name])).stdout)[0]
    if (data.Config.Labels?.['devflow.validation'] !== owner) throw new Error(`Container ownership does not match: ${name}`)
    return true
  } catch (error) { if (error.code === 1 && /No such (object|container)/.test(error.stderr ?? '')) return false; throw error }
}

if (command === 'preflight') {
  const audit = await auditOldLedgers()
  const availability = {}
  for (const [name, port] of Object.entries(ports)) availability[name] = { port, free: await freePort(port).then(() => true, () => false) }
  console.log(JSON.stringify({ ...audit, ports: availability, stateDir, servicesStarted: false, modelCalls: 0 }, null, 2))
} else if (command === 'start-team') {
  await auditOldLedgers()
  if (await exists(manifestPath)) throw new Error('A validation manifest already exists; inspect it instead of overwriting state')
  for (const port of [ports.api, ports.web, ports.postgres]) await freePort(port)
  await mkdir(stateDir, { recursive: true, mode: 0o700 })
  const owner = `issues-a-${Date.now()}`
  const container = `devflow-${owner}-postgres`
  const password = randomBytes(24).toString('hex')
  const environment = { DEVFLOW_DATABASE_URL: `postgres://postgres:${password}@127.0.0.1:${ports.postgres}/devflow_issues_a`,
    DEVFLOW_DATABASE_APPLICATION_NAME: owner, DEVFLOW_DEPLOYMENT_PROFILE: 'development', DEVFLOW_ENABLE_DEMO_DATA: 'false',
    DEVFLOW_ENABLE_FAKE_RUNTIME: 'false', DEVFLOW_LOCAL_AUTH_ENABLED: 'true', DEVFLOW_REQUIRE_AUTH: 'true', DEV_AUTH_ENABLED: 'false',
    DEVFLOW_SESSION_SECRET: randomBytes(32).toString('hex'), DEVFLOW_WEB_APP_URL: webUrl,
    DEVFLOW_API_BASE_URL: apiUrl, DEVFLOW_PUBLIC_API_BASE_URL: apiUrl, HOST: '127.0.0.1',
    DEVFLOW_API_DIAGNOSTICS_PATH: path.join(stateDir, 'api-diagnostics.json') }
  const manifest = { owner, root, ports, apiUrl, webUrl, stateDir, container, processes: [], startedAt: new Date().toISOString() }
  await save(manifest)
  await writeJson(path.join(stateDir, 'environment.json'), environment)
  await writeFile(path.join(stateDir, 'postgres.env'), `POSTGRES_PASSWORD=${password}\nPOSTGRES_DB=devflow_issues_a\n`, { mode: 0o600 })
  await run('docker', ['run', '-d', '--name', container, '--label', `devflow.validation=${owner}`, '--env-file', path.join(stateDir, 'postgres.env'), '-p', `127.0.0.1:${ports.postgres}:5432`, 'postgres:16-alpine'])
  for (let attempt = 0; ; attempt++) {
    if (await run('docker', ['exec', container, 'pg_isready', '-U', 'postgres', '-d', 'devflow_issues_a']).then(() => true, () => false)) break
    if (attempt >= 60) throw new Error('Dedicated PostgreSQL failed readiness; use cleanup after inspecting logs')
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  const migrated = await run('corepack', ['pnpm', '--filter', '@ai-devflow/api', 'db:setup'], { env: { ...minimalEnv, ...environment } })
  await writeFile(path.join(stateDir, 'migration.log'), migrated.stdout + migrated.stderr, { mode: 0o600 })
  await background('corepack', ['pnpm', '--filter', '@ai-devflow/api', 'exec', 'tsx', 'src/server.ts'], { ...environment, PORT: String(ports.api) }, 'api.log', manifest)
  await background('corepack', ['pnpm', '--filter', '@ai-devflow/web', 'exec', 'next', 'dev', '-H', '127.0.0.1', '-p', String(ports.web)], environment, 'web.log', manifest)
  await waitHttp(`${apiUrl}/ready`); await waitHttp(webUrl)
  console.log(JSON.stringify({ apiUrl, webUrl, stateDir, container, realPostgres: true, modelCalls: 0 }))
} else if (command === 'start-electron') {
  const manifest = await load()
  if (manifest.cleanedAt) throw new Error('This validation was already cleaned')
  await freePort(ports.electron)
  await waitHttp(`${apiUrl}/ready`)
  await background(path.join(root, 'apps/desktop/node_modules/.bin/electron'), [path.join(root, 'apps/desktop'), `--remote-debugging-port=${ports.electron}`], {
    DEVFLOW_USER_DATA_DIR: path.join(stateDir, 'desktop-profile'), DEVFLOW_DATA_PROFILE_REGISTRY_PATH: path.join(stateDir, 'profile-registry.json'),
    DEVFLOW_API_BASE_URL: apiUrl, DEVFLOW_ENABLE_DEMO_DATA: 'false', DEVFLOW_ENABLE_FAKE_RUNTIME: 'false', VITE_DEV_SERVER_URL: '',
  }, 'electron.log', manifest)
  await waitHttp(`http://127.0.0.1:${ports.electron}/json/version`)
  console.log(JSON.stringify({ cdp: `http://127.0.0.1:${ports.electron}`, profile: path.join(stateDir, 'desktop-profile'), modelCalls: 0 }))
} else if (command === 'start-gateway') {
  // Requires a separate explicit command; starting the team/Electron never enables paid forwarding.
  await auditOldLedgers()
  const manifest = await load()
  if (manifest.gateway || manifest.cleanedAt) throw new Error('An A gateway already exists or this validation is closed')
  await freePort(ports.gateway)
  const key = process.env.DEVFLOW_A_DEEPSEEK_KEY_FILE
  if (!key || !path.isAbsolute(key)) throw new Error('Provide the already-authorized credential file path; never pass the key itself')
  await access(key)
  const budgetDir = path.join(stateDir, 'budget-1')
  const gatewaySource = path.join(root, 'deploy/hindsight/budget_gateway.py')
  await run('python3', [gatewaySource, '--initialize'], { env: { ...minimalEnv, GATEWAY_STATE_DIR: budgetDir, DEVFLOW_HINDSIGHT_TEST_BUDGET_MICROYUAN: '5000000', DEVFLOW_HINDSIGHT_TEST_AUTHORIZED: '1' } })
  const container = `devflow-${manifest.owner}-gateway`
  manifest.gateway = { container, budgetDir, budgetMicroyuan: 5000000 }
  await save(manifest)
  await run('docker', ['run', '-d', '--name', container, '--label', `devflow.validation=${manifest.owner}`, '--user', `${process.getuid()}:${process.getgid()}`, '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--memory', '128m', '--cpus', '0.5', '-p', `127.0.0.1:${ports.gateway}:8787`, '-e', 'GATEWAY_STATE_DIR=/state', '-e', 'DEEPSEEK_KEY_FILE=/run/secrets/deepseek_api_key', '-e', 'PYTHONDONTWRITEBYTECODE=1', '-e', 'DEVFLOW_HINDSIGHT_TEST_BUDGET_MICROYUAN=5000000', '-v', `${gatewaySource}:/integration/budget_gateway.py:ro`, '-v', `${budgetDir}:/state`, '-v', `${key}:/run/secrets/deepseek_api_key:ro`, '--entrypoint', 'python', gatewayImage, '/integration/budget_gateway.py'])
  await waitHttp(`http://127.0.0.1:${ports.gateway}/health`)
  console.log(JSON.stringify({ gatewayUrl: `http://127.0.0.1:${ports.gateway}/v1`, budgetDir, capCny: 5, modelCalls: 0, restrictions: 'thinking disabled; nonstreaming upstream; output <= 8192; request <= 128 KiB' }))
} else if (command === 'stop') {
  const manifest = await load()
  // Close the ledger before disabling the container; unresolved calls remain reserved.
  if (manifest.gateway) {
    await run('python3', [path.join(root, 'deploy/hindsight/budget_gateway.py'), '--close'], { env: { ...minimalEnv, GATEWAY_STATE_DIR: manifest.gateway.budgetDir, DEVFLOW_HINDSIGHT_TEST_BUDGET_MICROYUAN: String(manifest.gateway.budgetMicroyuan) } })
    if (await checkedContainer(manifest.gateway.container, manifest.owner)) await run('docker', ['rm', '--force', manifest.gateway.container])
  }
  for (const saved of [...manifest.processes].reverse()) {
    let actual
    try { actual = (await run('ps', ['-p', String(saved.pid), '-o', 'lstart=', '-o', 'command='])).stdout }
    catch (error) { if (error.code === 1) continue; throw error }
    if (!actual.includes(saved.started) || !actual.includes(saved.commandIncludes)) throw new Error(`PID ownership changed; will not stop ${saved.pid}`)
    try { process.kill(-saved.pid, 'SIGTERM') } catch (error) { if (error.code !== 'ESRCH') throw error }
  }
  if (await checkedContainer(manifest.container, manifest.owner)) await run('docker', ['rm', '--force', '--volumes', manifest.container])
  manifest.cleanedAt = new Date().toISOString()
  await save(manifest)
  console.log(JSON.stringify({ stoppedOwnedServices: true, evidenceRetained: stateDir, historicalLedgers: await auditOldLedgers() }))
} else {
  throw new Error('Supported commands: preflight, start-team, start-electron, start-gateway, stop')
}
