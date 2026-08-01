import { spawn } from 'node:child_process'
import { cp, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertSelfContainedDirectory } from './standalone-boundary.mjs'

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

async function waitForJsonStatus(
  url,
  child,
  readOutput,
  expectedStatus,
  serviceName,
) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `${serviceName} exited before ${expectedStatus} check passed.\n${readOutput()}`,
      )
    }

    try {
      const response = await fetch(url)
      if (response.ok) {
        const body = await response.json()
        if (body.status === expectedStatus) {
          return
        }
      }
    } catch {
      // Keep polling until the process starts or exits.
    }

    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  throw new Error(
    `Timed out waiting for ${serviceName} ${expectedStatus}.\n${readOutput()}`,
  )
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

async function startApiDist(tempRoot) {
  const apiDir = path.join(rootDir, 'apps/api')
  const apiDist = path.join(apiDir, 'dist')
  const isolatedApiDist = path.join(tempRoot, 'api')

  await rm(apiDist, { recursive: true, force: true })
  await rm(path.join(apiDir, 'tsconfig.tsbuildinfo'), { force: true })
  await run(corepack, ['pnpm', '--filter', '@ai-devflow/api', 'build'])

  for (const entryName of ['server.js', 'migrate.js', 'seed-demo.js']) {
    const source = await readFile(path.join(apiDist, entryName), 'utf8')
    if (
      source.includes('@ai-devflow/shared') ||
      source.includes('tsx src/')
    ) {
      throw new Error(`${entryName} still depends on workspace source or tsx.`)
    }
  }
  const migrationSourceDir = path.join(apiDir, 'src/db/migrations')
  const migrationDistDir = path.join(apiDist, 'migrations')
  const migrationNames = (await readdir(migrationSourceDir))
    .filter((name) => name.endsWith('.sql'))
    .sort()
  for (const migrationName of migrationNames) {
    const [sourceSql, distSql] = await Promise.all([
      readFile(path.join(migrationSourceDir, migrationName)),
      readFile(path.join(migrationDistDir, migrationName)),
    ])
    if (!sourceSql.equals(distSql)) {
      throw new Error(`API dist migration changed bytes: ${migrationName}`)
    }
  }

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
    await waitForJsonStatus(
      `http://127.0.0.1:${port}/health`,
      child,
      () => `${stdout}${stderr}`,
      'ok',
      'API dist',
    )
    await waitForJsonStatus(
      `http://127.0.0.1:${port}/ready`,
      child,
      () => `${stdout}${stderr}`,
      'ready',
      'API dist',
    )
    return {
      baseUrl: `http://127.0.0.1:${port}`,
      child,
    }
  } catch (error) {
    await stopProcess(child)
    throw error
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

async function directoryExists(directoryPath) {
  try {
    return (await stat(directoryPath)).isDirectory()
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false
    }
    throw error
  }
}

async function smokeWebStandalone(tempRoot, apiBaseUrl) {
  const webDir = path.join(rootDir, 'apps/web')
  const nextDir = path.join(webDir, '.next')
  const isolatedWebDir = path.join(tempRoot, 'web')

  await rm(nextDir, { recursive: true, force: true })
  await run(corepack, ['pnpm', '--filter', '@ai-devflow/web', 'build'])

  const standaloneServer = path.join(
    nextDir,
    'standalone/apps/web/server.js',
  )
  const serverSource = await readFile(standaloneServer, 'utf8')
  if (serverSource.includes('next start')) {
    throw new Error('Web standalone server still depends on a development launcher.')
  }

  await cp(path.join(nextDir, 'standalone'), isolatedWebDir, {
    recursive: true,
    verbatimSymlinks: true,
  })
  await cp(
    path.join(nextDir, 'static'),
    path.join(isolatedWebDir, 'apps/web/.next/static'),
    { recursive: true },
  )
  const publicDir = path.join(webDir, 'public')
  if (await directoryExists(publicDir)) {
    await cp(publicDir, path.join(isolatedWebDir, 'apps/web/public'), {
      recursive: true,
    })
  }
  await assertSelfContainedDirectory(isolatedWebDir)

  const port = await findOpenPort()
  const child = spawn(process.execPath, ['apps/web/server.js'], {
    cwd: isolatedWebDir,
    env: {
      ...process.env,
      DEVFLOW_INTERNAL_API_BASE_URL: apiBaseUrl,
      HOSTNAME: '127.0.0.1',
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

  const baseUrl = `http://127.0.0.1:${port}`
  const readOutput = () => `${stdout}${stderr}`
  try {
    await waitForJsonStatus(
      `${baseUrl}/health`,
      child,
      readOutput,
      'ok',
      'Web standalone',
    )
    await waitForJsonStatus(
      `${baseUrl}/ready`,
      child,
      readOutput,
      'ready',
      'Web standalone',
    )

    const pageResponse = await fetch(baseUrl)
    if (!pageResponse.ok) {
      throw new Error(`Web standalone page returned ${pageResponse.status}.`)
    }
    const pageHtml = await pageResponse.text()
    const staticAssetPath = Array.from(
      pageHtml.matchAll(/(?:src|href)="(\/_next\/static\/[^"?#]+)"/g),
      (match) => match[1],
    ).find((assetPath) => /(?:^|[-/])[a-f0-9]{8,}\.(?:css|js)$/.test(assetPath))
    if (!staticAssetPath) {
      throw new Error('Web standalone page did not reference a hashed static asset.')
    }

    const assetResponse = await fetch(`${baseUrl}${staticAssetPath}`)
    const assetBytes = await assetResponse.arrayBuffer()
    if (!assetResponse.ok || assetBytes.byteLength === 0) {
      throw new Error(
        `Web standalone static asset failed: ${staticAssetPath} (${assetResponse.status}).`,
      )
    }
  } finally {
    await stopProcess(child)
  }
}

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'devflow-build-output-smoke-'))
let apiRuntime

try {
  apiRuntime = await startApiDist(tempRoot)
  await smokeWebStandalone(tempRoot, apiRuntime.baseUrl)
  await smokeWorkerDist(tempRoot)
  console.log(
    'Build output smoke passed: API, Web, and Worker production artifacts are source-free.',
  )
} finally {
  if (apiRuntime) {
    await stopProcess(apiRuntime.child)
  }
  await rm(tempRoot, { recursive: true, force: true })
}
