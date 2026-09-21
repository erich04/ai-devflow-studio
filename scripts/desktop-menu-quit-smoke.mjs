import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { resolveDesktopExecutablePath } from './desktop-pilot-artifact.mjs'

if (process.platform !== 'darwin') throw new Error('This native menu test requires macOS.')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const artifact = path.join(root, 'out/desktop-pilot')
const index = JSON.parse(await readFile(path.join(artifact, 'artifact-index.json'), 'utf8'))
const executable = resolveDesktopExecutablePath(path.resolve(artifact, index.appDirectory), index.platform)
const manifest = JSON.parse(await readFile(path.join(artifact, index.manifest), 'utf8'))
const data = await mkdtemp(path.join(os.tmpdir(), 'devflow-native-menu-quit-'))
const output = path.join(root, 'out/desktop-menu-quit-smoke')
await mkdir(output, { recursive: true })
const report = { electron: manifest.artifact.electronVersion, profile: data, launches: [], passed: false }

try {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    // No debugger or CDP flags: exercise the actual macOS application menu.
    const child = spawn(executable, [], { env: {
      ...process.env, DEVFLOW_USER_DATA_DIR: data,
      DEVFLOW_DATA_PROFILE_REGISTRY_PATH: path.join(data, 'profiles.json'),
      DEVFLOW_API_BASE_URL: 'http://127.0.0.1:1', DEVFLOW_ENABLE_DEMO_DATA: 'false',
      DEVFLOW_ENABLE_FAKE_RUNTIME: 'false',
    }, stdio: 'ignore' })
    const observation = { attempt, pid: child.pid }
    report.launches.push(observation)
    const exited = new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => resolve({ code, signal, at: Date.now() }))
    })
    try {
      // The operator (or the authorized CUA tool) selects the native Quit menu.
      // This observer never synthesizes OS events or calls app.quit through CDP.
      observation.readyAt = Date.now()
      console.log(JSON.stringify({ nativeQuitRequired: true, attempt, pid: child.pid, executable }))
      let timer
      observation.exit = await Promise.race([exited, new Promise((resolve) => { timer = setTimeout(() => resolve(null), 120_000) })])
      clearTimeout(timer)
      assert.ok(observation.exit, 'Menu Quit did not terminate the candidate within two minutes')
      observation.observedLifetimeMs = observation.exit.at - observation.readyAt
      assert.equal(observation.exit.code, 0)
      assert.equal(observation.exit.signal, null)
    } finally {
      if (child.exitCode === null) { observation.cleanupRequired = true; child.kill('SIGTERM'); await exited }
    }
  }
  report.passed = true
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
}
