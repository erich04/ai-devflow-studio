import { spawn } from 'node:child_process'
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const corepack = process.platform === 'win32' ? 'corepack.cmd' : 'corepack'

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: 'inherit',
      ...options,
    })

    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`${command} ${args.join(' ')} exited with ${code}`))
    })
  })
}

function runAndCapture(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    })
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }
      reject(
        new Error(
          `${command} ${args.join(' ')} exited with ${code}.\n${stdout}${stderr}`,
        ),
      )
    })
  })
}

function findOpenPort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (typeof address === 'object' && address) {
          resolve(address.port)
          return
        }
        reject(new Error('Unable to allocate an API smoke port.'))
      })
    })
  })
}

async function waitForApiHealth(url, child, readOutput) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`API dist exited before health check passed.\n${readOutput()}`)
    }

    try {
      const response = await fetch(url)
      if (response.ok) {
        const body = await response.json()
        if (body.status === 'ok') {
          return
        }
      }
    } catch {
      // Keep polling until the process starts or exits.
    }

    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  throw new Error(`Timed out waiting for API dist health.\n${readOutput()}`)
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return
  }

  child.kill('SIGTERM')
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ])
}

async function smokeApiDist(tempRoot) {
  const apiDir = path.join(rootDir, 'apps/api')
  const apiDist = path.join(apiDir, 'dist')
  const isolatedApiDist = path.join(tempRoot, 'api')

  await rm(apiDist, { recursive: true, force: true })
  await rm(path.join(apiDir, 'tsconfig.tsbuildinfo'), { force: true })
  await run(corepack, ['pnpm', '--filter', '@ai-devflow/api', 'build'])
  await cp(apiDist, isolatedApiDist, { recursive: true })

  const port = await findOpenPort()
  const child = spawn(process.execPath, ['server.js'], {
    cwd: isolatedApiDist,
    env: {
      ...process.env,
      DEVFLOW_ENABLE_DEMO_DATA: 'true',
      HOST: '127.0.0.1',
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
  })

  try {
    await waitForApiHealth(
      `http://127.0.0.1:${port}/health`,
      child,
      () => `${stdout}${stderr}`,
    )
  } finally {
    await stopProcess(child)
  }
}

async function smokeWorkerDist(tempRoot) {
  const workerDir = path.join(rootDir, 'apps/worker')
  const workerDist = path.join(workerDir, 'dist')
  const isolatedWorkerDist = path.join(tempRoot, 'worker')

  await rm(workerDist, { recursive: true, force: true })
  await rm(path.join(workerDir, 'tsconfig.tsbuildinfo'), { force: true })
  await run(corepack, ['pnpm', '--filter', '@ai-devflow/worker', 'build'])
  await cp(workerDist, isolatedWorkerDist, { recursive: true })

  const entryPath = path.join(isolatedWorkerDist, 'index.js')
  const entrySource = await readFile(entryPath, 'utf8')
  if (
    entrySource.includes('packages/shared/src/') ||
    entrySource.includes('@ai-devflow/shared')
  ) {
    throw new Error('Worker dist still references workspace shared source at runtime.')
  }

  const { stdout } = await runAndCapture(process.execPath, ['index.js'], {
    cwd: isolatedWorkerDist,
  })
  const result = JSON.parse(stdout)
  if (
    !Array.isArray(result.projectCost) ||
    result.projectCost.length !== 0 ||
    !Array.isArray(result.memberCost) ||
    result.memberCost.length !== 0
  ) {
    throw new Error(`Unexpected Worker dist output: ${stdout}`)
  }
}

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'devflow-build-output-smoke-'))

try {
  await smokeApiDist(tempRoot)
  await smokeWorkerDist(tempRoot)
  console.log(
    'Build output smoke passed: API and Worker dist run without workspace source fallback.',
  )
} finally {
  await rm(tempRoot, { recursive: true, force: true })
}
