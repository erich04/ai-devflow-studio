import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const desktopDir = path.join(rootDir, 'apps', 'desktop')
const devServerUrl = 'http://127.0.0.1:5173'
const corepack = process.platform === 'win32' ? 'corepack.cmd' : 'corepack'
const electronBin = path.join(
  desktopDir,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron.cmd' : 'electron',
)
const electronArgs = process.argv.slice(2)

function spawnLogged(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    ...options,
  })

  return child
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawnLogged(command, args)
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with ${code}`))
      }
    })
  })
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        return
      }
    } catch {
      // keep waiting
    }

    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  throw new Error(`Timed out waiting for ${url}`)
}

await run(corepack, ['pnpm', '--filter', '@ai-devflow/desktop', 'build:electron'])

const vite = spawnLogged(corepack, [
  'pnpm',
  '--filter',
  '@ai-devflow/desktop',
  'dev',
  '--',
  '--host',
  '127.0.0.1',
  '--port',
  '5173',
  '--strictPort',
])

const cleanup = () => {
  vite.kill('SIGTERM')
}

process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)
process.on('exit', cleanup)

await waitForServer(devServerUrl)

const electron = spawnLogged(electronBin, [...electronArgs, desktopDir], {
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: devServerUrl,
  },
})

electron.on('exit', (code) => {
  cleanup()
  process.exit(code ?? 0)
})
