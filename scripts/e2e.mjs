import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { resolveE2eRuntime } from './e2e-runtime.mjs'

const corepack = process.platform === 'win32' ? 'corepack.cmd' : 'corepack'
const rootDir = fileURLToPath(new URL('..', import.meta.url))
const {
  apiPort,
  webPort,
  desktopPort,
  apiUrl,
  webUrl,
  desktopUrl,
} = await resolveE2eRuntime()

function spawnService(name, args, env = {}) {
  const child = spawn(corepack, args, {
    cwd: rootDir,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  child.devflowStopping = false
  const writeServiceOutput = (stream, chunk) => {
    const text = chunk.toString()
    const expectedShutdownNoise =
      child.devflowStopping &&
      (text.includes('ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL') || text.includes('Exit status 143'))
    if (!expectedShutdownNoise) {
      stream.write(`[${name}] ${text}`)
    }
  }

  child.stdout.on('data', (chunk) => {
    writeServiceOutput(process.stdout, chunk)
  })
  child.stderr.on('data', (chunk) => {
    writeServiceOutput(process.stderr, chunk)
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

async function canBindPort(port) {
  return new Promise((resolve) => {
    const server = createServer()

    server.once('error', () => {
      resolve(false)
    })
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, '127.0.0.1')
  })
}

async function ensureService({ name, url, port, args, env = {} }) {
  if (!(await canBindPort(port))) {
    throw new Error(
      `[${name}] Isolated E2E port ${port} became occupied before startup.`,
    )
  }

  const child = spawnService(name, args, env)
  await waitForServer(url)
  return child
}

function stop(child) {
  if (!child || child.killed) {
    return
  }

  child.devflowStopping = true
  child.kill('SIGTERM')
}

let api
let web
let desktop

try {
  api = await ensureService({
    name: 'api',
    url: `${apiUrl}/health`,
    port: apiPort,
    args: ['pnpm', '--filter', '@ai-devflow/api', 'dev'],
    env: {
      DEVFLOW_ENABLE_DEMO_DATA: 'true',
      DEV_AUTH_ENABLED: 'true',
      PORT: String(apiPort),
    },
  })
  desktop = await ensureService({
    name: 'desktop',
    url: desktopUrl,
    port: desktopPort,
    args: [
      'pnpm',
      '--filter',
      '@ai-devflow/desktop',
      'exec',
      'vite',
      '--host',
      '127.0.0.1',
      '--port',
      String(desktopPort),
      '--strictPort',
    ],
    env: {
      DEVFLOW_ENABLE_DEMO_DATA: 'true',
    },
  })
  web = await ensureService({
    name: 'web',
    url: webUrl,
    port: webPort,
    args: [
      'pnpm',
      '--filter',
      '@ai-devflow/web',
      'exec',
      'next',
      'dev',
      '-H',
      '127.0.0.1',
      '-p',
      String(webPort),
    ],
    env: {
      DEVFLOW_ENABLE_DEMO_DATA: 'true',
      DEVFLOW_API_BASE_URL: apiUrl,
      NEXT_PUBLIC_DEVFLOW_API_URL: apiUrl,
    },
  })

  await run(corepack, ['pnpm', 'exec', 'playwright', 'test'], {
    DEVFLOW_ENABLE_DEMO_DATA: 'true',
    PLAYWRIGHT_SKIP_WEBSERVER: '1',
    DEVFLOW_API_BASE_URL: apiUrl,
    NEXT_PUBLIC_DEVFLOW_API_URL: apiUrl,
    DEVFLOW_E2E_API_URL: apiUrl,
    DEVFLOW_E2E_WEB_URL: webUrl,
    DEVFLOW_E2E_DESKTOP_URL: desktopUrl,
  })
} finally {
  stop(desktop)
  stop(web)
  stop(api)
}
