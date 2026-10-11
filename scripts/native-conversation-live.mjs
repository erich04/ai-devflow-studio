import { createRequire } from 'node:module'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Paid opt-in, isolated profile and ledger. Credentials are decrypted only inside Electron.
if (!process.env.DEVFLOW_WORKBENCH_LIVE_DATABASE || !process.env.DEVFLOW_WORKBENCH_LIVE_PROVIDER_ID) throw new Error('Set the existing credential database and provider ID explicitly for this paid probe.')
const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
const desktopRequire = createRequire(path.join(root, 'apps/desktop/package.json'))
const { build } = createRequire(require.resolve('vite'))('esbuild')
const temp = await mkdtemp(path.join(os.tmpdir(), 'devflow-native-live-'))
const output = path.resolve(process.env.DEVFLOW_NATIVE_LIVE_OUTPUT ?? path.join(root, 'out/native-conversation-live'))
await mkdir(output, { recursive: true })
const bundle = path.join(root, 'apps/desktop/out/native-conversation-live.mjs')
await build({ entryPoints: [path.join(root, 'scripts/native-conversation-live.mts')], outfile: bundle, bundle: true, platform: 'node', format: 'esm', external: ['electron', 'sql.js'], logLevel: 'silent' })
const bootstrap = path.join(temp, 'bootstrap.cjs')
await writeFile(bootstrap, `const { app } = require('electron'); app.commandLine.removeSwitch('use-mock-keychain'); app.commandLine.removeSwitch('password-store'); app.setName('@ai-devflow/desktop'); app.setPath('userData', ${JSON.stringify(path.join(temp, 'profile'))}); import(${JSON.stringify(pathToFileURL(bundle).href)});`)
const child = spawn(desktopRequire('electron'), [bootstrap], { cwd: path.join(root, 'apps/desktop'), env: { ...process.env, DEVFLOW_NATIVE_LIVE_OUTPUT: output, DEVFLOW_NATIVE_LIVE_TEMP: temp }, stdio: ['ignore', 'inherit', 'inherit'] })
try { process.exitCode = await new Promise(resolve => child.on('exit', code => resolve(code ?? 1))) }
finally { await rm(temp, { recursive: true, force: true }); await rm(bundle, { force: true }) }
