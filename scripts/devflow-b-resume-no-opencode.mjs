// Resume only the existing no-OpenCode Electron, preserving its database, team services and ledger.
import assert from 'node:assert/strict'
import { readFile, access, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from '@playwright/test'
const root = fileURLToPath(new URL('..', import.meta.url))
const requireDesktop = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
const ready = JSON.parse(await readFile(process.argv[2], 'utf8'))
assert(ready.scenario === 'no-opencode' && ready.schema.startsWith('b_live_'))
assert(ready.output.startsWith(path.join(root, '.tmp/devflow-b-20261023/no-opencode-')))
try { await fetch(new URL('/json/version', ready.cdpUrl), { signal: AbortSignal.timeout(1000) }); throw Error('Existing Electron must stop first') }
catch (error) { if (error.message === 'Existing Electron must stop first') throw error }
assert((await fetch(new URL('/ready', ready.apiUrl))).ok, 'Existing B API must remain running')
const env = { ...process.env, DEVFLOW_B_HARNESS: '1', DEVFLOW_B_GATEWAY_CONFIG: ready.gatewayConfig,
  DEVFLOW_API_BASE_URL: ready.apiUrl, DEVFLOW_USER_DATA_DIR: ready.profile,
  DEVFLOW_DATA_PROFILE_REGISTRY_PATH: path.join(ready.output, 'profiles.json'),
  DEVFLOW_OPENCODE_BIN: path.join(ready.output, 'opencode-not-installed'),
  DEVFLOW_ENABLE_FAKE_RUNTIME: 'false', DEVFLOW_ENABLE_DEMO_DATA: 'false', DEVFLOW_B_RESPONSE_DIAGNOSTICS: '1' }
delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL
let desktop, stopRequested = false
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { stopRequested = true })
try {
  await rm(path.join(ready.output, 'STOP'), { force: true })
  desktop = await electron.launch({ executablePath: requireDesktop('electron'), cwd: path.join(root, 'apps/desktop'),
    args: [path.join(root, 'scripts/devflow-b-electron-bootstrap.cjs'), `--remote-debugging-port=${new URL(ready.cdpUrl).port}`], env })
  const page = await desktop.firstWindow(); await page.waitForLoadState('domcontentloaded')
  const result = await page.evaluate(async ready => {
    const api = window.aiDevFlowDesktop, state = await api.loadState()
    return { found: state.runs.some(run => run.id === ready.runId),
      discovery: await api.detectCodingRuntimeEngines({ projectId: ready.projectId }) }
  }, ready)
  assert(result.found, 'Original no-OpenCode Run must survive restart')
  assert(result.discovery.candidates.every(candidate => candidate.status === 'unavailable'))
  console.log(JSON.stringify({ resumed: true, cdpUrl: ready.cdpUrl, runId: ready.runId, modelCallsStarted: 0, responseShapeDiagnostics: true }))
  while (!stopRequested) {
    try { await access(path.join(ready.output, 'STOP')); break } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
} finally { await desktop?.close().catch(() => {}) }
