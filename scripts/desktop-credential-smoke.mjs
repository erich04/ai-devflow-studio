import assert from 'node:assert/strict'
import { _electron as electron } from '@playwright/test'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { resolveDesktopExecutablePath } from './desktop-pilot-artifact.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const artifact = path.join(root, 'out/desktop-pilot')
const index = JSON.parse(await readFile(path.join(artifact, 'artifact-index.json'), 'utf8'))
const executablePath = resolveDesktopExecutablePath(path.resolve(artifact, index.appDirectory), index.platform)
const profile = await mkdtemp(path.join(os.tmpdir(), 'devflow-credential-smoke-'))
const output = path.join(root, 'out/desktop-credential-smoke')
await mkdir(output, { recursive: true })
const report = { profile, passed: false, legacyCompatibility: 'not_requested', checks: [] }
const app = await electron.launch({ executablePath, env: {
  ...process.env, DEVFLOW_USER_DATA_DIR: profile, DEVFLOW_DATA_PROFILE_REGISTRY_PATH: path.join(profile, 'profiles.json'),
  DEVFLOW_API_BASE_URL: 'http://127.0.0.1:1', DEVFLOW_ENABLE_DEMO_DATA: 'false', DEVFLOW_ENABLE_FAKE_RUNTIME: 'false',
}, timeout: 30_000 })

try {
  const page = await app.firstWindow()
  await page.getByRole('button', { name: '诊断', exact: true }).waitFor()
  report.runtime = await app.evaluate(async ({ app, safeStorage }) => {
    const available = await safeStorage.isAsyncEncryptionAvailable()
    if (!available) throw new Error('Native asynchronous credential storage unavailable')
    const cipher = await safeStorage.encryptStringAsync('fixture-native-roundtrip')
    const result = await safeStorage.decryptStringAsync(cipher)
    if (result.result !== 'fixture-native-roundtrip') throw new Error('Native round trip failed')
    return { electron: process.versions.electron, name: app.getName(), nativeRoundtrip: true }
  })
  if (process.env.DEVFLOW_LEGACY_CREDENTIAL_FIXTURE) {
    const fixture = JSON.parse(await readFile(process.env.DEVFLOW_LEGACY_CREDENTIAL_FIXTURE, 'utf8'))
    const result = await app.evaluate(async ({ safeStorage }, cipher) => {
      const value = await safeStorage.decryptStringAsync(Buffer.from(cipher, 'base64'))
      return { matches: value.result === 'devflow-compatibility-fixture-only', shouldReEncrypt: value.shouldReEncrypt }
    }, fixture.cipher)
    assert.equal(result.matches, true)
    report.legacyCompatibility = { oldElectron: fixture.electron, ...result }
  }

  // Controlled OS-port delay validates the UI without provoking or auto-answering
  // the user's real system security prompts. Native crypto is checked above.
  await app.evaluate(({ safeStorage }) => {
    globalThis.__credentialSmokeRestore = safeStorage.encryptStringAsync.bind(safeStorage)
    safeStorage.encryptStringAsync = () => new Promise((resolve) => {
      globalThis.__credentialSmokeRelease = () => resolve(Buffer.from('cancelled-result-must-not-be-saved'))
    })
  })
  const pending = page.evaluate(() => window.aiDevFlowDesktop.saveAgentProviderCredential({
    name: 'Isolated Credential QA', model: 'fixture-model', baseUrl: 'https://example.invalid/v1', apiKey: 'fixture-key-not-a-real-provider-key',
  })).then(() => ({ unexpectedSuccess: true }), (error) => ({ error: String(error) }))
  await page.getByText('正在等待系统凭据访问', { exact: true }).waitFor()
  await page.getByRole('button', { name: '诊断', exact: true }).click()
  await page.getByRole('heading', { name: '本地诊断', exact: true }).waitFor()
  await page.screenshot({ path: path.join(output, 'authorization-wait.png') })
  report.checks.push('UI navigation remains responsive while a credential operation is pending')
  await page.getByRole('button', { name: '取消本次等待', exact: true }).click()
  assert.match((await pending).error, /已取消本次凭据操作/)
  await app.evaluate(() => globalThis.__credentialSmokeRelease())
  assert.equal((await page.evaluate(() => window.aiDevFlowDesktop.listAgentProviders())).some((provider) => provider.name === 'Isolated Credential QA'), false)
  report.checks.push('Cancellation rejects the caller and a late encryption result does not save the Provider')

  await app.evaluate(({ safeStorage }) => {
    safeStorage.encryptStringAsync = async () => { throw new Error('OS denial with fixture-private-detail') }
  })
  const denied = await page.evaluate(async () => {
    try { await window.aiDevFlowDesktop.saveAgentProviderCredential({ name: 'Isolated Credential QA', model: 'fixture-model', apiKey: 'fixture-key-not-a-real-provider-key' }); return '' }
    catch (error) { return String(error) }
  })
  assert.match(denied, /诊断编号/)
  assert.doesNotMatch(denied, /fixture-private-detail|fixture-key/)
  await app.evaluate(({ safeStorage }) => { safeStorage.encryptStringAsync = globalThis.__credentialSmokeRestore })
  await page.evaluate(() => window.aiDevFlowDesktop.saveAgentProviderCredential({ name: 'Isolated Credential QA', model: 'fixture-model', apiKey: 'fixture-key-not-a-real-provider-key' }))
  await page.getByText('正在等待系统凭据访问', { exact: true }).waitFor({ state: 'hidden' })
  assert.equal((await page.evaluate(() => window.aiDevFlowDesktop.listAgentProviders())).some((provider) => provider.name === 'Isolated Credential QA'), true)
  const diagnostics = await page.evaluate(() => window.aiDevFlowDesktop.listCredentialAccess())
  assert.ok(diagnostics.some((record) => record.state === 'cancelled'))
  assert.ok(diagnostics.some((record) => record.state === 'failed'))
  assert.ok(diagnostics.some((record) => record.state === 'succeeded'))
  assert.doesNotMatch(JSON.stringify(diagnostics), /fixture-key|fixture-private-detail|cancelled-result/)
  report.checks.push('Denied authorization remains sanitized and a new native encrypted save succeeds')
  report.checks.push('Safe diagnostic history records cancellation, failure and success')
  await page.screenshot({ path: path.join(output, 'authorization-recovered.png') })
  report.passed = true
} finally {
  await app.close()
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
}
