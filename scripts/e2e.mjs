import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const corepack = process.platform === 'win32' ? 'corepack.cmd' : 'corepack'
const rootDir = fileURLToPath(new URL('..', import.meta.url))
const desktopUrl = 'http://127.0.0.1:5173'
const apiUrl = 'http://127.0.0.1:4310'
const webUrl = 'http://127.0.0.1:4311'

function spawnService(name, args, env = {}) {
  const child = spawn(corepack, args, {
    cwd: rootDir,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[${name}] ${chunk}`)
  })
  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[${name}] ${chunk}`)
  })

  return child
}

function run(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      env: { ...process.env, ...env },
      stdio: 'inherit',
    })

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
  for (let attempt = 0; attempt < 120; attempt += 1) {
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

function stop(child) {
  if (!child || child.killed) {
    return
  }

  child.kill('SIGTERM')
}

let api
let web
let desktop

try {
  api = spawnService('api', ['pnpm', '--filter', '@ai-devflow/api', 'dev'])
  desktop = spawnService('desktop', [
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
  web = spawnService('web', ['pnpm', '--filter', '@ai-devflow/web', 'dev'], {
    DEVFLOW_API_BASE_URL: apiUrl,
    NEXT_PUBLIC_DEVFLOW_API_URL: apiUrl,
  })

  await Promise.all([
    waitForServer(`${apiUrl}/health`),
    waitForServer(desktopUrl),
    waitForServer(webUrl),
  ])

  await run(corepack, ['pnpm', 'exec', 'playwright', 'test'], {
    PLAYWRIGHT_SKIP_WEBSERVER: '1',
    DEVFLOW_API_BASE_URL: apiUrl,
    NEXT_PUBLIC_DEVFLOW_API_URL: apiUrl,
  })
} finally {
  stop(desktop)
  stop(web)
  stop(api)
}
