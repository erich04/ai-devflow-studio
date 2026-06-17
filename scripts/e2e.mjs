import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
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

async function probeServer(url) {
  try {
    const response = await fetch(url)
    return response.ok
  } catch {
    return false
  }
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
  if (await probeServer(url)) {
    console.log(`[${name}] Reusing existing service at ${url}`)
    return null
  }

  if (!(await canBindPort(port))) {
    throw new Error(
      `[${name}] Port ${port} is occupied but ${url} is not healthy. Stop that process or free the port before running test:e2e.`,
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
    port: 4310,
    args: ['pnpm', '--filter', '@ai-devflow/api', 'dev'],
  })
  desktop = await ensureService({
    name: 'desktop',
    url: desktopUrl,
    port: 5173,
    args: [
      'pnpm',
      '--filter',
      '@ai-devflow/desktop',
      'exec',
      'vite',
      '--host',
      '127.0.0.1',
      '--port',
      '5173',
      '--strictPort',
    ],
  })
  web = await ensureService({
    name: 'web',
    url: webUrl,
    port: 4311,
    args: ['pnpm', '--filter', '@ai-devflow/web', 'dev'],
    env: {
      DEVFLOW_API_BASE_URL: apiUrl,
      NEXT_PUBLIC_DEVFLOW_API_URL: apiUrl,
    },
  })

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
