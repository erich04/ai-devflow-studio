import { execFile, spawn } from 'node:child_process'
import { createHash, createHmac, generateKeyPairSync, randomBytes } from 'node:crypto'
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { createRequire } from 'node:module'
import { connect as connectNet, createServer as createNetServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { _electron as electron } from '@playwright/test'
import { resolveDesktopExecutablePath } from './desktop-pilot-artifact.mjs'

const execFileAsync = promisify(execFile)
const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const artifactDirectory = path.join(rootDirectory, 'out', 'desktop-pilot')
const requireFromApi = createRequire(
  path.join(rootDirectory, 'apps', 'api', 'package.json'),
)
const requireFromDesktop = createRequire(
  path.join(rootDirectory, 'apps', 'desktop', 'package.json'),
)
const { Client } = requireFromApi('pg')
const initSqlJs = requireFromDesktop('sql.js')
const corepack = process.platform === 'win32' ? 'corepack.cmd' : 'corepack'
const githubRepository = 'example/project'
const githubInstallationId = '12345'
const githubRepositoryId = '98765'
const sessionSecret = 'v15-packaged-smoke-session-secret-32-bytes-minimum'
const ephemeralGitHubCredential =
  'ghs_v15_packaged_smoke_ephemeral_credential_1234567890'
const maximumBufferedOutput = 256 * 1_024

if (
  process.env['DEVFLOW_PACKAGED_SMOKE_NETWORK_MODE'] !== undefined &&
  process.env['DEVFLOW_PACKAGED_SMOKE_NETWORK_MODE'] !== 'offline'
) {
  throw new Error('V1.5 packaged GitHub Delivery smoke only supports offline mode.')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function createPostgresClient(connectionString) {
  return new Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
    query_timeout: 15_000,
    statement_timeout: 15_000,
  })
}

function appendBounded(previous, chunk, label) {
  const next = previous + chunk.toString('utf8')
  if (next.length > maximumBufferedOutput) {
    throw new Error(`${label} exceeded its bounded diagnostic output.`)
  }
  return next
}

async function run(command, args, options = {}) {
  try {
    const result = await execFileAsync(command, args, {
      cwd: options.cwd ?? rootDirectory,
      env: { ...process.env, ...(options.env ?? {}) },
      timeout: options.timeoutMs ?? 120_000,
      windowsHide: true,
      maxBuffer: maximumBufferedOutput,
    })
    return { stdout: result.stdout, stderr: result.stderr }
  } catch (error) {
    const code = typeof error?.code === 'number' ? String(error.code) : 'spawn_error'
    const signal = typeof error?.signal === 'string' ? `, signal ${error.signal}` : ''
    throw new Error(
      `Packaged smoke ${path.basename(command)} command failed (exit ${code}${signal}).`,
    )
  }
}

function spawnService(command, args, env) {
  const child = spawn(command, args, {
    cwd: rootDirectory,
    env: { ...process.env, ...env },
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const diagnostics = { stdout: '', stderr: '' }
  child.stdout?.on('data', (chunk) => {
    diagnostics.stdout = appendBounded(diagnostics.stdout, chunk, 'API stdout')
  })
  child.stderr?.on('data', (chunk) => {
    diagnostics.stderr = appendBounded(diagnostics.stderr, chunk, 'API stderr')
  })
  return { child, diagnostics }
}

function sendSignal(child, signal) {
  if (!child?.pid) return
  try {
    if (process.platform !== 'win32') {
      process.kill(-child.pid, signal)
      return
    }
  } catch {
    // Fall through to the wrapper process.
  }
  try {
    child.kill(signal)
  } catch {
    // It already exited.
  }
}

async function stopService(service) {
  const child = service?.child
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  await new Promise((resolve) => {
    let settled = false
    const settle = () => {
      if (settled) return
      settled = true
      clearTimeout(forceTimer)
      clearTimeout(finalTimer)
      resolve()
    }
    child.once('exit', settle)
    sendSignal(child, 'SIGTERM')
    const forceTimer = setTimeout(() => sendSignal(child, 'SIGKILL'), 3_000)
    const finalTimer = setTimeout(settle, 8_000)
  })
}

async function listen(server, host = '127.0.0.1') {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, host, resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Unable to allocate a packaged smoke port.')
  }
  return address.port
}

async function closeServer(server) {
  if (!server?.listening) return
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Packaged smoke server cleanup timed out.')),
      5_000,
    )
    server.close((error) => {
      clearTimeout(timer)
      if (error) reject(error)
      else resolve()
    })
    server.closeIdleConnections?.()
    server.closeAllConnections?.()
  })
}

async function waitFor(label, operation, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const result = await operation()
      if (result !== undefined && result !== false && result !== null) return result
    } catch (error) {
      if (error && typeof error === 'object' && error.packagedSmokeFatal === true) {
        throw error
      }
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out waiting for ${label}.`, { cause: lastError })
}

function createSessionCookie(authAccountId) {
  const claims = {
    v: 1,
    authAccountId,
    expiresAt: Math.floor(Date.now() / 1_000) + 60 * 60,
  }
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')
  const signature = createHmac('sha256', sessionSecret)
    .update(payload)
    .digest('base64url')
  return `devflow_session=${payload}.${signature}`
}

async function requestJson(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method ?? 'GET',
    headers: {
      accept: 'application/json',
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(options.headers ?? {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })
  const text = await response.text()
  let body
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  if (!response.ok && options.allowError !== true) {
    throw new Error(`${pathname} failed with ${response.status}.`)
  }
  return { status: response.status, body }
}

async function provisionDatabase(temporaryDirectory) {
  const configured =
    process.env['DEVFLOW_PACKAGED_SMOKE_DATABASE_ADMIN_URL']?.trim() ||
    process.env['DEVFLOW_DATABASE_URL']?.trim()
  const databaseName = `devflow_packaged_${randomBytes(8).toString('hex')}`
  if (configured) {
    const adminUrl = new URL(configured)
    const admin = createPostgresClient(adminUrl.href)
    await admin.connect()
    try {
      await admin.query(`CREATE DATABASE ${databaseName}`)
    } finally {
      await admin.end()
    }
    const databaseUrl = new URL(adminUrl.href)
    databaseUrl.pathname = `/${databaseName}`
    return {
      databaseUrl: databaseUrl.href,
      async cleanup() {
        const cleanupClient = createPostgresClient(adminUrl.href)
        await cleanupClient.connect()
        try {
          await cleanupClient.query(
            'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
            [databaseName],
          )
          await cleanupClient.query(`DROP DATABASE IF EXISTS ${databaseName}`)
        } finally {
          await cleanupClient.end()
        }
      },
    }
  }

  if (process.platform === 'win32') {
    throw new Error(
      'Set DEVFLOW_PACKAGED_SMOKE_DATABASE_ADMIN_URL on Windows for the packaged smoke.',
    )
  }
  await run('docker', ['version', '--format', '{{.Server.Version}}'], {
    timeoutMs: 15_000,
  })
  const portProbe = createNetServer()
  const postgresPort = await listen(portProbe)
  await closeServer(portProbe)
  const containerName = `devflow-v15-packaged-${randomBytes(6).toString('hex')}`
  const password = randomBytes(24).toString('hex')
  let containerStarted = false
  try {
    await run(
      'docker',
      [
        'run',
        '--detach',
        '--name',
        containerName,
        '--publish',
        `127.0.0.1:${postgresPort}:5432`,
        '--env',
        `POSTGRES_DB=${databaseName}`,
        '--env',
        'POSTGRES_USER=postgres',
        '--env',
        `POSTGRES_PASSWORD=${password}`,
        'postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777',
      ],
      { timeoutMs: 120_000 },
    )
    containerStarted = true
    await waitFor('disposable Postgres 16', async () => {
      try {
        await run('docker', ['exec', containerName, 'pg_isready', '-U', 'postgres', '-d', databaseName], {
          timeoutMs: 5_000,
        })
        return true
      } catch {
        return false
      }
    }, 60_000)
  } catch (error) {
    if (containerStarted) {
      try {
        await run('docker', ['rm', '--force', containerName], { timeoutMs: 15_000 })
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'Disposable Postgres failed and could not be cleaned up.',
        )
      }
    }
    throw error
  }
  const databaseUrl =
    `postgresql://postgres:${password}@127.0.0.1:${postgresPort}/${databaseName}`
  await writeFile(
    path.join(temporaryDirectory, 'postgres-owner.json'),
    `${JSON.stringify({ schemaVersion: 1, container: true })}\n`,
    { mode: 0o600 },
  )
  return {
    databaseUrl,
    async cleanup() {
      await run('docker', ['rm', '--force', containerName], { timeoutMs: 15_000 })
    },
  }
}

async function createGitFixture(temporaryDirectory) {
  const sourceRepository = path.join(temporaryDirectory, 'source-repository')
  const gitRoot = path.join(temporaryDirectory, 'git-http-root')
  const bareRepository = path.join(gitRoot, 'example', 'project.git')
  await mkdir(sourceRepository, { recursive: true })
  await mkdir(path.dirname(bareRepository), { recursive: true })
  await run('git', ['init', '--initial-branch=main', sourceRepository])
  await writeFile(
    path.join(sourceRepository, 'package.json'),
    `${JSON.stringify(
      {
        name: 'v15-packaged-smoke-fixture',
        private: true,
        type: 'module',
        scripts: { test: 'node --test smoke.test.mjs' },
      },
      null,
      2,
    )}\n`,
  )
  await writeFile(
    path.join(sourceRepository, 'smoke.test.mjs'),
    "import assert from 'node:assert/strict'\nimport test from 'node:test'\ntest('fixture', () => assert.equal(1, 1))\n",
  )
  await run('git', ['-C', sourceRepository, 'add', '--', 'package.json', 'smoke.test.mjs'])
  await run('git', [
    '-C',
    sourceRepository,
    '-c',
    'user.name=V1.5 Packaged Smoke',
    '-c',
    'user.email=packaged-smoke@example.invalid',
    'commit',
    '--no-gpg-sign',
    '-m',
    'Initialize packaged delivery fixture',
  ])
  await run('git', ['init', '--bare', bareRepository])
  await run('git', ['--git-dir', bareRepository, 'config', 'http.receivepack', 'true'])
  await run('git', ['--git-dir', bareRepository, 'config', 'receive.denyNonFastForwards', 'true'])
  await run('git', [
    '-C',
    sourceRepository,
    'push',
    `file://${bareRepository}`,
    'main:refs/heads/main',
  ])
  await run('git', ['--git-dir', bareRepository, 'symbolic-ref', 'HEAD', 'refs/heads/main'])
  await run('git', [
    '-C',
    sourceRepository,
    'remote',
    'add',
    'origin',
    `https://github.com/${githubRepository}.git`,
  ])
  const { stdout } = await run('git', ['-C', sourceRepository, 'rev-parse', 'HEAD'])
  return {
    sourceRepository,
    gitRoot,
    bareRepository,
    baseCommitSha: stdout.trim().toLowerCase(),
  }
}

async function runGitHttpBackend(input) {
  const child = spawn('git', ['http-backend'], {
    env: {
      PATH: process.env['PATH'] ?? '',
      LANG: 'C',
      LC_ALL: 'C',
      GIT_PROJECT_ROOT: input.gitRoot,
      GIT_HTTP_EXPORT_ALL: '1',
      REQUEST_METHOD: input.method,
      PATH_INFO: input.pathname,
      QUERY_STRING: input.query,
      CONTENT_TYPE: input.contentType,
      CONTENT_LENGTH: String(input.body.length),
      REMOTE_USER: 'x-access-token',
      AUTH_TYPE: 'Basic',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let stdout = Buffer.alloc(0)
  let stderr = ''
  child.stdout.on('data', (chunk) => {
    stdout = Buffer.concat([stdout, chunk])
    if (stdout.length > 16 * 1_024 * 1_024) child.kill('SIGKILL')
  })
  child.stderr.on('data', (chunk) => {
    stderr = appendBounded(stderr, chunk, 'git http-backend stderr')
  })
  child.stdin.end(input.body)
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })
  if (code !== 0) throw new Error('The offline Git smart-HTTP boundary failed.')
  const separator = stdout.indexOf(Buffer.from('\r\n\r\n'))
  const alternateSeparator = stdout.indexOf(Buffer.from('\n\n'))
  const headerEnd = separator >= 0 ? separator + 4 : alternateSeparator + 2
  const headerLength = separator >= 0 ? separator : alternateSeparator
  if (headerLength < 0) throw new Error('git http-backend returned malformed CGI output.')
  const rawHeaders = stdout.subarray(0, headerLength).toString('utf8')
  const headers = {}
  let status = 200
  for (const line of rawHeaders.split(/\r?\n/u)) {
    const colon = line.indexOf(':')
    if (colon < 1) continue
    const name = line.slice(0, colon).trim()
    const value = line.slice(colon + 1).trim()
    if (name.toLowerCase() === 'status') status = Number(value.split(' ')[0])
    else headers[name] = value
  }
  return { status, headers, body: stdout.subarray(headerEnd) }
}

async function createOfflineGitHubGitBoundary(temporaryDirectory, gitFixture) {
  const certificateDirectory = path.join(temporaryDirectory, 'git-boundary-certificate')
  await mkdir(certificateDirectory, { recursive: true })
  const caKey = path.join(certificateDirectory, 'ca.key')
  const caCertificate = path.join(certificateDirectory, 'ca.pem')
  const serverKey = path.join(certificateDirectory, 'server.key')
  const serverRequest = path.join(certificateDirectory, 'server.csr')
  const serverCertificate = path.join(certificateDirectory, 'server.pem')
  const extensions = path.join(certificateDirectory, 'server.ext')
  await writeFile(
    extensions,
    'subjectAltName=DNS:github.com\nextendedKeyUsage=serverAuth\n',
    { mode: 0o600 },
  )
  await run('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '1',
    '-subj', '/CN=AI DevFlow V1.5 Packaged Smoke CA',
    '-keyout', caKey, '-out', caCertificate,
  ])
  await run('openssl', [
    'req', '-newkey', 'rsa:2048', '-nodes', '-sha256',
    '-subj', '/CN=github.com', '-keyout', serverKey, '-out', serverRequest,
  ])
  await run('openssl', [
    'x509', '-req', '-sha256', '-days', '1', '-in', serverRequest,
    '-CA', caCertificate, '-CAkey', caKey, '-CAcreateserial',
    '-extfile', extensions, '-out', serverCertificate,
  ])
  assert(process.platform !== 'win32', 'The packaged Git boundary requires a POSIX git wrapper.')
  const realGitPath = (await run('which', ['git'])).stdout.trim().split('\n')[0]
  assert(path.isAbsolute(realGitPath), 'The packaged Git boundary could not resolve real git.')
  const gitWrapperDirectory = path.join(temporaryDirectory, 'git-wrapper')
  const gitAuditPath = path.join(temporaryDirectory, 'git-audit.log')
  await mkdir(gitWrapperDirectory, { recursive: true })
  await writeFile(gitAuditPath, '', { mode: 0o600, flag: 'wx' })
  const quotedRealGitPath = `'${realGitPath.replaceAll("'", "'\\''")}'`
  const quotedGitAuditPath = `'${gitAuditPath.replaceAll("'", "'\\''")}'`
  await writeFile(
    path.join(gitWrapperDirectory, 'git'),
    [
      '#!/bin/sh',
      'push_command=0',
      'for argument in "$@"; do',
      '  if [ "$argument" = "push" ]; then push_command=1; fi',
      '  case "$argument" in',
      '    -f|--force*|+*)',
      `      printf '%s\\n' 'force-attempt' >> ${quotedGitAuditPath}`,
      '      exit 86',
      '      ;;',
      '  esac',
      'done',
      `if [ "$push_command" -eq 1 ]; then printf '%s\\n' 'push-attempt' >> ${quotedGitAuditPath}; fi`,
      `exec ${quotedRealGitPath} -c http.sslCAInfo="$SSL_CERT_FILE" "$@"`,
      '',
    ].join('\n'),
    { mode: 0o700, flag: 'wx' },
  )

  const expectedAuthorization = `Basic ${Buffer.from(
    `x-access-token:${ephemeralGitHubCredential}`,
    'utf8',
  ).toString('base64')}`
  const metrics = {
    connectRequests: 0,
    authenticatedRequests: 0,
    uploadPackRequests: 0,
    receivePackRequests: 0,
    rejectedHosts: 0,
    rejectedAuthorities: [],
    backendFailures: 0,
    backendStatuses: [],
    tlsClientErrorCodes: [],
  }
  let activeRequests = 0
  const sockets = new Set()
  const secureServer = createHttpsServer(
    {
      key: await readFile(serverKey),
      cert: await readFile(serverCertificate),
      minVersion: 'TLSv1.2',
    },
    async (request, response) => {
      activeRequests += 1
      try {
        if (request.headers.authorization !== expectedAuthorization) {
          response.writeHead(401, {
            'www-authenticate': 'Basic realm="AI DevFlow packaged smoke"',
            connection: 'close',
          })
          response.end()
          return
        }
        metrics.authenticatedRequests += 1
        const chunks = []
        let size = 0
        for await (const chunk of request) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          size += buffer.length
          if (size > 16 * 1_024 * 1_024) {
            throw new Error('Offline Git request body exceeded its limit.')
          }
          chunks.push(buffer)
        }
        const url = new URL(request.url ?? '/', 'https://github.com')
        if (url.pathname.includes('git-upload-pack')) metrics.uploadPackRequests += 1
        if (url.pathname.includes('git-receive-pack')) metrics.receivePackRequests += 1
        const result = await runGitHttpBackend({
          gitRoot: gitFixture.gitRoot,
          method: request.method ?? 'GET',
          pathname: url.pathname,
          query: url.searchParams.toString(),
          contentType: request.headers['content-type'] ?? '',
          body: Buffer.concat(chunks),
        })
        metrics.backendStatuses.push(result.status)
        response.writeHead(result.status, result.headers)
        response.end(result.body)
      } catch {
        metrics.backendFailures += 1
        response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
        response.end('Offline Git boundary failure')
      } finally {
        activeRequests -= 1
      }
    },
  )
  secureServer.on('connection', (socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  secureServer.on('tlsClientError', (error) => {
    metrics.tlsClientErrorCodes.push(error.code ?? 'unknown')
  })
  const securePort = await listen(secureServer)

  const proxyServer = createHttpServer((_request, response) => {
    response.writeHead(502)
    response.end()
  })
  proxyServer.on('connect', (request, socket, head) => {
    if (request.url !== 'github.com:443') {
      metrics.rejectedHosts += 1
      const authority =
        typeof request.url === 'string' &&
        request.url.length <= 255 &&
        /^[a-z0-9.-]+:\d{1,5}$/iu.test(request.url)
          ? request.url.toLowerCase()
          : 'invalid'
      if (
        metrics.rejectedAuthorities.length < 8 &&
        !metrics.rejectedAuthorities.includes(authority)
      ) {
        metrics.rejectedAuthorities.push(authority)
      }
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n')
      return
    }
    metrics.connectRequests += 1
    const upstream = connectNet(securePort, '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length > 0) upstream.write(head)
      socket.pipe(upstream)
      upstream.pipe(socket)
    })
    sockets.add(socket)
    sockets.add(upstream)
    socket.once('close', () => sockets.delete(socket))
    upstream.once('close', () => sockets.delete(upstream))
    socket.once('error', () => upstream.destroy())
    upstream.once('error', () => socket.destroy())
  })
  const proxyPort = await listen(proxyServer)
  return {
    caCertificate,
    gitAuditPath,
    gitWrapperDirectory,
    proxyUrl: `http://127.0.0.1:${proxyPort}`,
    metrics,
    async waitForIdle() {
      const deadline = Date.now() + 5_000
      let previousSnapshot = null
      let stableSince = null
      while (Date.now() < deadline) {
        const currentSnapshot = stableJson({
          activeRequests,
          effects: snapshotGitBoundaryEffects(metrics),
        })
        if (activeRequests === 0 && currentSnapshot === previousSnapshot) {
          stableSince ??= Date.now()
          if (Date.now() - stableSince >= 250) return
        } else {
          stableSince = null
        }
        previousSnapshot = currentSnapshot
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      throw new Error('Offline Git boundary did not become idle.')
    },
    async close() {
      for (const socket of sockets) socket.destroy()
      await closeServer(proxyServer)
      await closeServer(secureServer)
    },
  }
}

async function createApiProxy(internalApiUrl) {
  let capturedDesktopToken = null
  const proxy = createHttpServer(async (request, response) => {
    try {
      const chunks = []
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }
      const headers = {}
      for (const [name, value] of Object.entries(request.headers)) {
        if (
          value !== undefined &&
          !['connection', 'content-length', 'host', 'transfer-encoding'].includes(name)
        ) {
          headers[name] = value
        }
      }
      const upstream = await fetch(`${internalApiUrl}${request.url ?? '/'}`, {
        method: request.method,
        headers,
        ...(chunks.length === 0 ? {} : { body: Buffer.concat(chunks) }),
      })
      const body = Buffer.from(await upstream.arrayBuffer())
      if (
        request.url === '/api/desktop/pairing/exchange' &&
        upstream.ok
      ) {
        const parsed = JSON.parse(body.toString('utf8'))
        if (typeof parsed?.token === 'string') capturedDesktopToken = parsed.token
      }
      response.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') ?? 'application/json',
      })
      response.end(body)
    } catch {
      response.writeHead(502, { 'content-type': 'application/json' })
      response.end('{"error":"packaged_smoke_proxy_failed"}')
    }
  })
  const port = await listen(proxy)
  return {
    url: `http://127.0.0.1:${port}`,
    getCapturedDesktopToken: () => capturedDesktopToken,
    close: () => closeServer(proxy),
  }
}

async function callDesktop(page, method, input) {
  return page.evaluate(
    async ({ method: methodName, input: methodInput }) => {
      const api = window.aiDevFlowDesktop
      if (!api) throw new Error('Packaged preload bridge is unavailable.')
      const operation = api[methodName]
      if (typeof operation !== 'function') {
        throw new Error(`Packaged preload operation is unavailable: ${methodName}`)
      }
      return methodInput === undefined
        ? operation()
        : operation(methodInput)
    },
    { method, input },
  )
}

async function launchPackagedDesktop(input) {
  const diagnostics = []
  const electronApp = await electron.launch({
    executablePath: input.executablePath,
    cwd: input.appDirectory,
    args:
      process.platform === 'linux'
        ? [
            '--disable-background-networking',
            '--password-store=gnome-libsecret',
            '--no-sandbox',
          ]
        : ['--disable-background-networking', '--password-store=basic'],
    env: input.env,
    timeout: 30_000,
  })
  electronApp.process().stderr?.on('data', (chunk) => {
    if (diagnostics.join('').length < maximumBufferedOutput) {
      diagnostics.push(chunk.toString('utf8'))
    }
  })
  try {
    const credentialStorage = await electronApp.evaluate(async ({ app, safeStorage }) => {
      await app.whenReady()
      return {
        available: safeStorage.isEncryptionAvailable(),
        backend:
          typeof safeStorage.getSelectedStorageBackend === 'function'
            ? safeStorage.getSelectedStorageBackend()
            : null,
      }
    })
    assert(
      credentialStorage.available,
      'Packaged Desktop credential encryption is unavailable.',
    )
    if (process.platform === 'linux') {
      assert(
        credentialStorage.backend === 'gnome_libsecret',
        'Packaged Linux Desktop did not select the Secret Service backend.',
      )
    }
    const page = await electronApp.firstWindow({ timeout: 30_000 })
    await page.waitForURL((url) => url.protocol !== 'about:', { timeout: 30_000 })
    await page.locator('#root').waitFor({ state: 'attached', timeout: 30_000 })
    assert(page.url().startsWith('file://'), 'Packaged Desktop did not load a file:// renderer.')
    return { electronApp, page }
  } catch (error) {
    await electronApp.close().catch(() => undefined)
    throw new Error('Packaged Desktop failed to launch.', {
      cause: diagnostics.length > 0 ? new Error('Electron emitted diagnostics.') : error,
    })
  }
}

function findRun(state, runId) {
  const run = state.runs?.find((candidate) => candidate.id === runId)
  assert(run, 'Packaged renderer projection lost the materialized Run.')
  return run
}

function currentNode(run) {
  const node = run.nodes.find((candidate) => candidate.id === run.currentNodeId)
  assert(node, 'Packaged workflow has no current node.')
  return node
}

async function advanceToPr(page, materialized, localProjectId, userId) {
  let run = materialized.run
  let node = currentNode(run)
  assert(node.kind === 'agent' && node.stage === 'clarify', 'Workflow did not start at Clarify.')
  run = (
    await callDesktop(page, 'completeWorkflowAgentNode', {
      runId: run.id,
      nodeId: node.id,
      userId,
      userName: 'Packaged Smoke Owner',
      providerId: 'fake-knowledge-review',
    })
  ).run
  node = currentNode(run)
  assert(node.kind === 'gate', 'Clarify completion did not reach its Gate.')
  run = (await callDesktop(page, 'approveGate', { runId: run.id, nodeId: node.id })).run
  node = currentNode(run)
  assert(node.kind === 'agent' && node.stage === 'design', 'Workflow did not reach Design.')
  run = (
    await callDesktop(page, 'completeWorkflowAgentNode', {
      runId: run.id,
      nodeId: node.id,
      userId,
      userName: 'Packaged Smoke Owner',
      providerId: 'fake-knowledge-review',
    })
  ).run
  node = currentNode(run)
  assert(node.kind === 'gate' && node.stage === 'design', 'Workflow did not reach Design Gate.')
  await callDesktop(page, 'runKnowledgeReview', {
    runId: run.id,
    nodeId: node.id,
    projectId: localProjectId,
    requestedBy: userId,
    runtime: 'electron',
    providerId: 'fake-knowledge-review',
  })
  run = (await callDesktop(page, 'approveGate', { runId: run.id, nodeId: node.id })).run
  node = currentNode(run)
  assert(node.kind === 'task' && node.stage === 'build', 'Workflow did not reach Build.')
  await callDesktop(page, 'ensureCodingEngine', { projectId: localProjectId })
  const coding = await callDesktop(page, 'runCodingAgent', {
    runId: run.id,
    nodeId: node.id,
    projectId: localProjectId,
    requestedBy: userId,
    providerId: 'fake-coding-engine',
    userInstruction:
      'Create the one reviewed packaged smoke marker with {"token":""} as an empty redaction canary.',
  })
  const pendingPermission = coding.state.codingPermissionRequests?.find(
    (candidate) =>
      candidate.codingRunId === coding.codingRun.id && candidate.status === 'pending',
  )
  assert(pendingPermission, 'Fake Coding Agent did not request edit permission.')
  await callDesktop(page, 'replyCodingPermission', {
    requestId: pendingPermission.id,
    codingRunId: coding.codingRun.id,
    decidedBy: userId,
    decision: 'approved',
    comment: 'Approve the bounded deterministic fixture edit.',
  })
  let state = await callDesktop(page, 'loadState')
  run = findRun(state, run.id)
  node = currentNode(run)
  assert(node.kind === 'test' && node.stage === 'test', 'Workflow did not reach Test.')
  const tested = await callDesktop(page, 'runProjectTests', {
    projectId: localProjectId,
    runId: run.id,
    nodeId: node.id,
  })
  assert(tested.evidence.status === 'passed', 'Packaged project tests did not pass.')
  state = tested.state
  run = findRun(state, run.id)
  node = currentNode(run)
  assert(node.kind === 'pr' && node.stage === 'pr', 'Workflow did not reach PR.')
  await callDesktop(page, 'createPrDraft', { runId: run.id, nodeId: node.id })
  return { runId: run.id, prNodeId: node.id }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function snapshotGitBoundaryEffects(metrics) {
  return {
    connectRequests: metrics.connectRequests,
    authenticatedRequests: metrics.authenticatedRequests,
    uploadPackRequests: metrics.uploadPackRequests,
    receivePackRequests: metrics.receivePackRequests,
    rejectedHosts: metrics.rejectedHosts,
    rejectedAuthorities: [...metrics.rejectedAuthorities],
    backendFailures: metrics.backendFailures,
    backendStatuses: [...metrics.backendStatuses],
  }
}

function assertNoLeaks(value, needles, label) {
  const serialized = JSON.stringify(value)
  const lower = serialized.toLowerCase()
  for (const needle of needles) {
    assert(!needle || !serialized.includes(needle), `${label} retained a copy-once secret or local path.`)
  }
  for (const fragment of [
    '-----begin private key-----',
    'x-access-token:',
    '"stdout"',
    '"stderr"',
    '"worktreepath"',
    '"sourcepath"',
    'enumerating objects:',
    'to https://github.com/',
    '[new branch]',
  ]) {
    assert(!lower.includes(fragment), `${label} retained forbidden delivery data.`)
  }
  assert(
    !/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/u.test(serialized),
    `${label} retained a GitHub credential.`,
  )
  assert(
    !/(?:\/Users\/|\/home\/|\/tmp\/|\/private\/|\/var\/folders\/|(?<![A-Za-z])[A-Za-z]:[\\/])/u.test(
      serialized,
    ),
    `${label} retained a local absolute path.`,
  )
}

function assertNoSecretMaterial(value, needles, label) {
  const serialized = Buffer.isBuffer(value) ? value.toString('utf8') : JSON.stringify(value)
  const lower = serialized.toLowerCase()
  for (const needle of needles) {
    assert(!needle || !serialized.includes(needle), `${label} retained plaintext secret material.`)
  }
  assert(
    !/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/u.test(serialized),
    `${label} retained a GitHub credential.`,
  )
  assert(
    !lower.includes('-----begin private key-----'),
    `${label} retained private key material.`,
  )
}

async function readLocalDeliveryRecords(storePath) {
  const SQL = await initSqlJs({
    locateFile: (file) => requireFromDesktop.resolve(`sql.js/dist/${file}`),
  })
  const database = new SQL.Database(await readFile(storePath))
  try {
    const result = database.exec(`
      SELECT 'intent' AS kind, json FROM github_delivery_intents
      UNION ALL
      SELECT 'outcome' AS kind, json FROM github_delivery_operator_outcomes
      UNION ALL
      SELECT 'revocation_check' AS kind, json FROM github_delivery_revocation_checks
      UNION ALL
      SELECT 'binding' AS kind, json FROM github_repository_bindings
      ORDER BY kind, json
    `)
    const table = result[0]
    if (!table) return []
    return table.values.map(([kind, json]) => ({ kind, record: JSON.parse(String(json)) }))
  } finally {
    database.close()
  }
}

async function readRemoteDeliveryEvidence(databaseUrl, requestId, bindingId) {
  const client = createPostgresClient(databaseUrl)
  await client.connect()
  try {
    const counts = await client.query(
      `SELECT
         (SELECT count(*)::integer FROM github_repository_bindings WHERE id = $1) AS bindings,
         (SELECT count(*)::integer FROM github_delivery_requests WHERE id = $2) AS requests,
         (SELECT count(*)::integer FROM github_delivery_approvals WHERE request_id = $2) AS approvals,
         (SELECT count(*)::integer FROM github_delivery_credential_grants WHERE request_id = $2) AS grants,
         (SELECT count(*)::integer FROM github_branch_publications WHERE request_id = $2) AS publications,
         (SELECT count(*)::integer FROM github_pull_request_outcomes WHERE request_id = $2) AS pull_requests`,
      [bindingId, requestId],
    )
    const records = await client.query(
      `SELECT 'binding' AS kind, to_jsonb(binding) AS record
       FROM github_repository_bindings AS binding WHERE binding.id = $1
       UNION ALL
       SELECT 'request', to_jsonb(delivery)
       FROM github_delivery_requests AS delivery WHERE delivery.id = $2
       UNION ALL
       SELECT 'approval', to_jsonb(approval)
       FROM github_delivery_approvals AS approval WHERE approval.request_id = $2
       UNION ALL
       SELECT 'grant', to_jsonb(grant_record)
       FROM github_delivery_credential_grants AS grant_record WHERE grant_record.request_id = $2
       UNION ALL
       SELECT 'publication', to_jsonb(publication)
       FROM github_branch_publications AS publication WHERE publication.request_id = $2
       UNION ALL
       SELECT 'pull_request', to_jsonb(pull_request)
       FROM github_pull_request_outcomes AS pull_request WHERE pull_request.request_id = $2`,
      [bindingId, requestId],
    )
    return { counts: counts.rows[0], records: records.rows }
  } finally {
    await client.end()
  }
}

const cleanup = []
let primaryError
let result

try {
  const artifactIndex = JSON.parse(
    await readFile(path.join(artifactDirectory, 'artifact-index.json'), 'utf8'),
  )
  const appDirectory = path.resolve(artifactDirectory, artifactIndex.appDirectory)
  const executablePath = resolveDesktopExecutablePath(appDirectory, artifactIndex.platform)
  await access(executablePath)

  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'devflow-v15-packaged-delivery-'),
  )
  cleanup.push(() => rm(temporaryDirectory, { recursive: true, force: true }))
  const runtimeTemporaryDirectory = path.join(temporaryDirectory, 'runtime-tmp')
  const userDataDirectory = path.join(temporaryDirectory, 'user-data')
  await mkdir(runtimeTemporaryDirectory, { recursive: true })

  const database = await provisionDatabase(temporaryDirectory)
  cleanup.push(database.cleanup)
  await run(corepack, ['pnpm', '--filter', '@ai-devflow/api', 'db:setup'], {
    env: { DEVFLOW_DATABASE_URL: database.databaseUrl },
  })
  await run(corepack, ['pnpm', '--filter', '@ai-devflow/api', 'db:seed'], {
    env: {
      DEVFLOW_DATABASE_URL: database.databaseUrl,
      DEVFLOW_ENABLE_DEMO_DATA: 'true',
    },
  })

  const gitFixture = await createGitFixture(temporaryDirectory)
  const gitBoundary = await createOfflineGitHubGitBoundary(
    temporaryDirectory,
    gitFixture,
  )
  cleanup.push(gitBoundary.close)

  const metricsPath = path.join(temporaryDirectory, 'fake-github-metrics.json')
  const { privateKey: githubAppPrivateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2_048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  const githubAppPrivateKeyBase64 = Buffer.from(
    githubAppPrivateKey,
    'utf8',
  ).toString('base64')
  const apiPortProbe = createNetServer()
  const internalApiPort = await listen(apiPortProbe)
  await closeServer(apiPortProbe)
  const internalApiUrl = `http://127.0.0.1:${internalApiPort}`
  const apiService = spawnService(
    corepack,
    ['pnpm', 'exec', 'tsx', 'scripts/v15-github-delivery-packaged-api.mjs'],
    {
      DEVFLOW_PACKAGED_SMOKE: 'true',
      DEVFLOW_PACKAGED_SMOKE_NETWORK_MODE: 'offline',
      DEVFLOW_PACKAGED_SMOKE_GITHUB_INSTALLATION_ID: githubInstallationId,
      DEVFLOW_PACKAGED_SMOKE_GITHUB_REPOSITORY_ID: githubRepositoryId,
      DEVFLOW_PACKAGED_SMOKE_GITHUB_REPOSITORY: githubRepository,
      DEVFLOW_PACKAGED_SMOKE_GIT_BARE_REPOSITORY: gitFixture.bareRepository,
      DEVFLOW_PACKAGED_SMOKE_GITHUB_EPHEMERAL_CREDENTIAL:
        ephemeralGitHubCredential,
      DEVFLOW_PACKAGED_SMOKE_GITHUB_APP_PRIVATE_KEY_BASE64:
        githubAppPrivateKeyBase64,
      DEVFLOW_PACKAGED_SMOKE_METRICS_PATH: metricsPath,
      DEVFLOW_DATABASE_URL: database.databaseUrl,
      DEVFLOW_ENABLE_FAKE_RUNTIME: 'true',
      DEVFLOW_REQUIRE_AUTH: 'true',
      DEVFLOW_SESSION_SECRET: sessionSecret,
      DEV_AUTH_ENABLED: 'true',
      HOST: '127.0.0.1',
      PORT: String(internalApiPort),
    },
  )
  cleanup.push(() => stopService(apiService))
  await waitFor('fresh packaged smoke API', async () => {
    if (
      apiService.child.exitCode !== null ||
      apiService.child.signalCode !== null
    ) {
      const diagnostic = `${apiService.diagnostics.stderr}\n${apiService.diagnostics.stdout}`
        .trim()
        .replaceAll(database.databaseUrl, '<database-url>')
        .replaceAll(ephemeralGitHubCredential, '<credential>')
        .replaceAll(githubAppPrivateKeyBase64, '<private-key>')
        .replaceAll(githubAppPrivateKey, '<private-key>')
        .replaceAll(sessionSecret, '<session-secret>')
        .replaceAll(temporaryDirectory, '<temporary>')
        .replaceAll(rootDirectory, '<workspace>')
        .slice(-4_000)
      const serviceError = new Error(
        `Packaged smoke API exited before readiness (${apiService.child.exitCode ?? apiService.child.signalCode}).${diagnostic ? ` ${diagnostic}` : ''}`,
      )
      serviceError.packagedSmokeFatal = true
      throw serviceError
    }
    const response = await fetch(`${internalApiUrl}/ready`)
    return response.ok
  })
  const apiProxy = await createApiProxy(internalApiUrl)
  cleanup.push(apiProxy.close)

  const hostileRenderer = { requests: 0 }
  const hostileServer = createHttpServer((_request, response) => {
    hostileRenderer.requests += 1
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<main>wrong renderer</main>')
  })
  const hostilePort = await listen(hostileServer)
  cleanup.push(() => closeServer(hostileServer))

  const sessionCookie = createSessionCookie('acct-demo-u-erich')
  const browserHeaders = { cookie: sessionCookie }
  const bindingResponse = await requestJson(
    internalApiUrl,
    '/api/team/projects/p-payments/github-repository-binding',
    {
      method: 'PUT',
      headers: browserHeaders,
      body: {
        installationId: githubInstallationId,
        repositoryId: githubRepositoryId,
        expectedStateVersion: 0,
      },
    },
  )
  const binding = bindingResponse.body.binding
  assert(binding?.status === 'active', 'Browser session did not create the repository binding.')
  const pairingResponse = await requestJson(
    internalApiUrl,
    '/api/team/projects/p-payments/pairing-codes',
    { method: 'POST', headers: browserHeaders, body: {} },
  )
  const pairingCode = pairingResponse.body.code
  assert(typeof pairingCode === 'string', 'Browser session did not create a pairing code.')
  const workRequestResponse = await requestJson(
    internalApiUrl,
    '/api/team/projects/p-payments/work-requests',
    {
      method: 'POST',
      headers: browserHeaders,
      body: {
        projectId: 'p-payments',
        title: 'V1.5 packaged GitHub Delivery',
        request: 'Publish one exact reviewed commit through the offline packaged gate.',
        idempotencyKey: `v15-packaged:${randomBytes(12).toString('hex')}`,
        expiresAt: null,
      },
    },
  )
  const workRequest = workRequestResponse.body.workRequest
  assert(workRequest?.status === 'open', 'Browser session did not create a Work Request.')

  const desktopEnvironment = {
    ...process.env,
    DEVFLOW_USER_DATA_DIR: userDataDirectory,
    DEVFLOW_API_BASE_URL: apiProxy.url,
    DEVFLOW_CODING_ENGINE: 'fake',
    DEVFLOW_ENABLE_FAKE_RUNTIME: 'true',
    DEVFLOW_ENABLE_DEMO_DATA: 'false',
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    VITE_DEV_SERVER_URL: `http://127.0.0.1:${hostilePort}/must-not-load`,
    HTTPS_PROXY: gitBoundary.proxyUrl,
    HTTP_PROXY: gitBoundary.proxyUrl,
    NO_PROXY: '127.0.0.1,localhost',
    SSL_CERT_FILE: gitBoundary.caCertificate,
    PATH: `${gitBoundary.gitWrapperDirectory}${path.delimiter}${process.env['PATH'] ?? ''}`,
    TMPDIR: runtimeTemporaryDirectory,
    TEMP: runtimeTemporaryDirectory,
    TMP: runtimeTemporaryDirectory,
  }

  let firstLaunch = await launchPackagedDesktop({
    executablePath,
    appDirectory,
    env: desktopEnvironment,
  })
  cleanup.push(async () => firstLaunch?.electronApp?.close().catch(() => undefined))
  await firstLaunch.electronApp.evaluate(async ({ dialog }, selectedPath) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [selectedPath],
    })
  }, gitFixture.sourceRepository)
  const localProject = await callDesktop(firstLaunch.page, 'selectLocalProject')
  assert(localProject?.id, 'Packaged main process did not import the local repository.')
  await callDesktop(firstLaunch.page, 'saveProjectTestCommand', {
    projectId: localProject.id,
    testCommand: 'node --test smoke.test.mjs',
  })
  const pairing = await callDesktop(firstLaunch.page, 'pairDesktop', {
    code: pairingCode,
    localProjectId: localProject.id,
  })
  assert(
    pairing.credential?.projectId === 'p-payments',
    'Packaged preload did not bind Desktop pairing authority.',
  )
  const desktopBearer = await waitFor(
    'captured in-memory Desktop bearer authority',
    async () => apiProxy.getCapturedDesktopToken(),
  )
  const inbox = await callDesktop(firstLaunch.page, 'listWorkRequests', {
    localProjectId: localProject.id,
  })
  const listedRequest = inbox.find((candidate) => candidate.id === workRequest.id)
  assert(listedRequest?.version === 1, 'Packaged Desktop did not list the Work Request.')
  const materialized = await callDesktop(firstLaunch.page, 'materializeWorkRequest', {
    localProjectId: localProject.id,
    workRequestId: listedRequest.id,
    expectedVersion: listedRequest.version,
  })
  const workflow = await advanceToPr(
    firstLaunch.page,
    materialized,
    localProject.id,
    pairing.credential.userId,
  )

  await waitFor('remote PR-node authority projection', async () => {
    const overview = await requestJson(internalApiUrl, '/api/team/overview', {
      headers: browserHeaders,
    })
    const remoteRun = overview.body.runs?.find(
      (candidate) => candidate.id === workflow.runId,
    )
    return remoteRun?.currentNodeId?.endsWith(workflow.prNodeId) ? remoteRun : false
  })
  let prepared
  try {
    prepared = await callDesktop(firstLaunch.page, 'prepareGitHubDelivery', {
      runId: workflow.runId,
      nodeId: workflow.prNodeId,
    })
  } catch (cause) {
    const diagnosticState = await callDesktop(firstLaunch.page, 'loadState')
    const diagnosticRun = findRun(diagnosticState, workflow.runId)
    const diagnosticCodingRuns = diagnosticState.codingRuns?.filter(
      (candidate) => candidate.runId === workflow.runId,
    ) ?? []
    const diagnosticWorkspaces = diagnosticState.managedCodingWorkspaces?.filter(
      (candidate) => candidate.projectId === localProject.id,
    ) ?? []
    const workspace = diagnosticWorkspaces[0]
    const codingRun = diagnosticCodingRuns[0]
    const diff = diagnosticState.codingDiffArtifacts?.find(
      (candidate) => candidate.id === codingRun?.diffArtifactId,
    )
    const diagnosticPrNode = currentNode(diagnosticRun)
    const expectedPackageId =
      `artifact-${diagnosticRun.id}-pr-draft-v${diagnosticRun.version - 1}`
    const prPackage = diagnosticState.artifacts?.find(
      (candidate) => candidate.id === expectedPackageId,
    )
    const packageSource = prPackage?.githubDeliverySource
    const selectedTests = diagnosticState.testEvidence?.find(
      (candidate) => candidate.id === packageSource?.testEvidenceId,
    )
    const localBinding = diagnosticState.githubRepositoryBindings?.find(
      (candidate) => candidate.teamProjectId === 'p-payments',
    )
    const sourceChecks = {
      runCurrentPr:
        diagnosticRun.currentNodeId === diagnosticPrNode.id &&
        diagnosticPrNode.kind === 'pr' &&
        diagnosticPrNode.stage === 'pr' &&
        diagnosticPrNode.status === 'running',
      packageId: Boolean(prPackage),
      packageOnNode:
        Boolean(prPackage && diagnosticPrNode.artifactIds.includes(prPackage.id)) &&
        prPackage?.runId === diagnosticRun.id &&
        prPackage?.nodeId === diagnosticPrNode.id &&
        prPackage?.kind === 'pr',
      packageRedacted: prPackage?.redacted === true,
      packageSource: Boolean(packageSource),
      pairingProject:
        pairing.credential?.localProjectId === localProject.id &&
        pairing.credential?.projectId === 'p-payments',
      bindingActive:
        localBinding?.status === 'active' &&
        localBinding?.organizationId === pairing.credential?.organizationId &&
        localBinding?.teamProjectId === pairing.credential?.projectId,
      codingCompleted:
        codingRun?.status === 'completed' &&
        Boolean(codingRun?.completedAt) &&
        codingRun?.runId === diagnosticRun.id &&
        codingRun?.projectId === localProject.id,
      buildNode:
        diagnosticRun.nodes.find((candidate) => candidate.id === codingRun?.nodeId)?.kind ===
          'task' &&
        diagnosticRun.nodes.find((candidate) => candidate.id === codingRun?.nodeId)?.stage ===
          'build' &&
        diagnosticRun.nodes.find((candidate) => candidate.id === codingRun?.nodeId)?.status ===
          'success',
      codingSource:
        codingRun?.managedWorkspaceId === workspace?.id &&
        codingRun?.diffArtifactId === diff?.id,
      workspaceSource:
        workspace?.projectId === localProject.id &&
        workspace?.codingRunId === codingRun?.id &&
        workspace?.sourcePath === localProject.path &&
        workspace?.baseBranch === localBinding?.defaultBranch &&
        workspace?.cleanupStatus === 'active' &&
        !workspace?.deletedAt &&
        Boolean(workspace?.baseCommitSha),
      packageWorkspace:
        packageSource?.workspaceId === workspace?.id &&
        packageSource?.headBranch === workspace?.branchName,
      packageDiff:
        packageSource?.diffArtifactId === diff?.id &&
        packageSource?.diffSourceDigest === diff?.sourceDigest &&
        diff?.runId === diagnosticRun.id &&
        diff?.nodeId === codingRun?.nodeId &&
        diff?.projectId === localProject.id &&
        diff?.truncated === false &&
        diff?.redacted === true &&
        /^[a-f0-9]{64}$/.test(diff?.sourceDigest ?? ''),
      diffPackageId: packageSource?.diffArtifactId === diff?.id,
      diffPackageDigest: packageSource?.diffSourceDigest === diff?.sourceDigest,
      diffRun: diff?.runId === diagnosticRun.id,
      diffNode: diff?.nodeId === codingRun?.nodeId,
      diffProject: diff?.projectId === localProject.id,
      diffComplete: diff?.truncated === false,
      diffRedacted: diff?.redacted === true,
      packageTests:
        Boolean(selectedTests) &&
        selectedTests?.runId === diagnosticRun.id &&
        selectedTests?.nodeId === codingRun?.nodeId &&
        selectedTests?.projectId === localProject.id,
      commitInput:
        workspace?.cleanupStatus === 'active' &&
        !workspace?.deletedAt &&
        /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(workspace?.baseCommitSha ?? '') &&
        diff?.runId === diagnosticRun.id &&
        diff?.projectId === workspace?.projectId &&
        diff?.truncated === false &&
        /^[a-f0-9]{64}$/.test(diff?.sourceDigest ?? ''),
    }
    let gitSummary = null
    if (workspace && diff) {
      const [head, branch, status, patch] = await Promise.all([
        run('git', ['-C', workspace.worktreePath, 'rev-parse', 'HEAD']),
        run('git', ['-C', workspace.worktreePath, 'branch', '--show-current']),
        run('git', ['-C', workspace.worktreePath, 'status', '--porcelain=v1']),
        run('git', [
          '-C', workspace.worktreePath,
          'diff', '--no-ext-diff', 'HEAD', '--', ...diff.changedPaths,
        ]),
      ])
      gitSummary = {
        headMatchesBase: head.stdout.trim().toLowerCase() === workspace.baseCommitSha,
        branchMatches: branch.stdout.trim() === workspace.branchName,
        statusCodes: status.stdout
          .split('\n')
          .filter(Boolean)
          .map((line) => line.slice(0, 2)),
        patchDigestMatches:
          createHash('sha256').update(patch.stdout, 'utf8').digest('hex') ===
          diff.sourceDigest,
        changedPathCount: diff.changedPaths.length,
      }
    }
    throw new Error(
      `Packaged preparation failed with safe source summary: ${JSON.stringify({
        runVersion: diagnosticRun.version,
        currentNode: currentNode(diagnosticRun).kind,
        artifactKinds: diagnosticState.artifacts
          ?.filter((candidate) => candidate.runId === workflow.runId)
          .map((candidate) => candidate.kind),
        codingRuns: diagnosticCodingRuns.map((candidate) => ({
          status: candidate.status,
          hasDiff: Boolean(candidate.diffArtifactId),
          hasTests: Boolean(candidate.testEvidenceId),
        })),
        workspaces: diagnosticWorkspaces.map((candidate) => ({
          status: candidate.cleanupStatus,
          hasBase: Boolean(candidate.baseCommitSha),
          hasHead: Boolean(candidate.headCommitSha),
        })),
        git: gitSummary,
        sourceChecks,
      })}`,
      { cause },
    )
  }
  assert(prepared.status === 'prepared', 'Packaged main did not prepare exact delivery evidence.')
  const remoteRequest = await waitFor('remote approval-required Delivery Request', async () => {
    const response = await requestJson(
      internalApiUrl,
      '/api/team/projects/p-payments/github-deliveries',
      { headers: browserHeaders },
    )
    return response.body.requests?.find(
      (candidate) =>
        candidate.localIntentId === prepared.intent.id &&
        candidate.status === 'approval_required',
    )
  })
  const approval = await requestJson(
    internalApiUrl,
    `/api/team/projects/p-payments/github-deliveries/${remoteRequest.id}/approve`,
    {
      method: 'POST',
      headers: browserHeaders,
      body: { expectedStateVersion: remoteRequest.stateVersion },
    },
  )
  assert(
    approval.body.approval?.authenticationKind === 'session_cookie',
    'GitHub Delivery was not approved by the separate signed Web session.',
  )
  let state = await callDesktop(firstLaunch.page, 'loadState')
  let localIntent = state.githubDeliveryIntents.find(
    (candidate) => candidate.id === prepared.intent.id,
  )
  const resumed = await callDesktop(firstLaunch.page, 'resumeGitHubDelivery', {
    intentId: localIntent.id,
    expectedUpdatedAt: localIntent.updatedAt,
  })
  let failedPublicationSummary = null
  if (
    resumed.disposition !== 'workflow_advanced' ||
    resumed.outcomeCode !== 'draft_pr_created'
  ) {
    let remoteHead = null
    try {
      remoteHead = (
        await run('git', [
          '--git-dir',
          gitFixture.bareRepository,
          'rev-parse',
          '--verify',
          `refs/heads/${prepared.intent.headBranch}`,
        ])
      ).stdout.trim().toLowerCase()
    } catch {
      // A missing remote branch is itself safe diagnostic evidence.
    }
    failedPublicationSummary = {
      remoteBranchPresent: Boolean(remoteHead),
      remoteHeadMatches: remoteHead === prepared.intent.expectedCommitSha,
      gitBoundary: gitBoundary.metrics,
      provider: JSON.parse(await readFile(metricsPath, 'utf8')),
    }
  }
  assert(
    resumed.disposition === 'workflow_advanced' && resumed.outcomeCode === 'draft_pr_created',
    `Packaged GitHub Delivery did not publish and create its Draft PR (${resumed.disposition}/${resumed.outcomeCode}): ${JSON.stringify(failedPublicationSummary)}.`,
  )
  state = await callDesktop(firstLaunch.page, 'loadState')
  localIntent = state.githubDeliveryIntents.find(
    (candidate) => candidate.id === prepared.intent.id,
  )
  assert(localIntent?.status === 'completed', 'Packaged delivery did not persist completion.')
  const deliveryProjection = {
    intents: state.githubDeliveryIntents,
    outcomes: state.githubDeliveryOperatorOutcomes,
  }
  assertNoLeaks(
    deliveryProjection,
    [
      pairingCode,
      desktopBearer,
      sessionCookie,
      ephemeralGitHubCredential,
      githubAppPrivateKey,
      githubAppPrivateKeyBase64,
      temporaryDirectory,
      gitFixture.sourceRepository,
    ],
    'Packaged renderer GitHub Delivery projection',
  )

  await gitBoundary.waitForIdle()
  const providerEffectsBeforeClose = JSON.parse(await readFile(metricsPath, 'utf8'))
  const remoteEffectsBeforeClose = await readRemoteDeliveryEvidence(
    database.databaseUrl,
    remoteRequest.id,
    binding.id,
  )
  const gitEffectsBeforeClose = snapshotGitBoundaryEffects(gitBoundary.metrics)
  await firstLaunch.electronApp.close()
  firstLaunch = null
  await gitBoundary.waitForIdle()
  const gitEffectsAfterClose = snapshotGitBoundaryEffects(gitBoundary.metrics)
  assert(
    stableJson(gitEffectsAfterClose) === stableJson(gitEffectsBeforeClose),
    `Packaged shutdown performed a late Git credential, push, or remote inspection effect (${stableJson({ before: gitEffectsBeforeClose, after: gitEffectsAfterClose })}).`,
  )

  const remoteBeforeRestart = await readRemoteDeliveryEvidence(
    database.databaseUrl,
    remoteRequest.id,
    binding.id,
  )
  assert(
    stableJson(remoteBeforeRestart) === stableJson(remoteEffectsBeforeClose),
    'Packaged shutdown mutated durable GitHub Delivery evidence.',
  )
  assert(
    stableJson(remoteBeforeRestart.counts) ===
      stableJson({ bindings: 1, requests: 1, approvals: 1, grants: 1, publications: 1, pull_requests: 1 }),
    'Remote durable GitHub Delivery chain was not exact.',
  )
  const metricsBeforeRestart = JSON.parse(await readFile(metricsPath, 'utf8'))
  assert(
    stableJson(metricsBeforeRestart) === stableJson(providerEffectsBeforeClose),
    'Packaged shutdown repeated a GitHub provider effect.',
  )
  const gitEffectsBeforeRestart = snapshotGitBoundaryEffects(gitBoundary.metrics)
  const branchBeforeRestart = (
    await run('git', [
      '--git-dir',
      gitFixture.bareRepository,
      'rev-parse',
      '--verify',
      `refs/heads/${localIntent.headBranch}`,
    ])
  ).stdout.trim().toLowerCase()
  assert(
    branchBeforeRestart === localIntent.expectedCommitSha,
    'Offline bare remote did not receive the exact approved commit.',
  )
  const gitAuditEvents = (await readFile(gitBoundary.gitAuditPath, 'utf8'))
    .split('\n')
    .filter(Boolean)
  assert(
    gitAuditEvents.filter((event) => event === 'force-attempt').length === 0,
    'Packaged branch publication attempted a force push.',
  )
  assert(
    gitAuditEvents.filter((event) => event === 'push-attempt').length === 1,
    'Packaged branch publication did not execute one exact push command.',
  )
  assert(
    gitBoundary.metrics.receivePackRequests === 1,
    'Exact branch publication was not one bounded non-force receive-pack.',
  )
  assert(
    hostileRenderer.requests === 0,
    'Packaged Desktop honored the hostile development renderer URL.',
  )

  const secondLaunch = await launchPackagedDesktop({
    executablePath,
    appDirectory,
    env: desktopEnvironment,
  })
  cleanup.push(() => secondLaunch.electronApp.close().catch(() => undefined))
  const restartSnapshot = await waitFor('completed delivery after packaged restart', async () => {
    const nextState = await callDesktop(secondLaunch.page, 'loadState')
    const intent = nextState.githubDeliveryIntents.find(
      (candidate) => candidate.id === prepared.intent.id,
    )
    return intent?.status === 'completed' ? nextState : false
  })
  await new Promise((resolve) => setTimeout(resolve, 2_000))
  await gitBoundary.waitForIdle()
  const metricsAfterRestart = JSON.parse(await readFile(metricsPath, 'utf8'))
  assert(
    stableJson(metricsAfterRestart) === stableJson(metricsBeforeRestart),
    'Packaged restart repeated a GitHub provider effect.',
  )
  assert(
    stableJson(snapshotGitBoundaryEffects(gitBoundary.metrics)) ===
      stableJson(gitEffectsBeforeRestart),
    `Packaged restart repeated a Git credential, push, or remote inspection effect (${stableJson({ before: gitEffectsBeforeRestart, after: snapshotGitBoundaryEffects(gitBoundary.metrics) })}).`,
  )
  const gitAuditEventsAfterRestart = (await readFile(gitBoundary.gitAuditPath, 'utf8'))
    .split('\n')
    .filter(Boolean)
  assert(
    stableJson(gitAuditEventsAfterRestart) === stableJson(gitAuditEvents),
    'Packaged restart repeated a Git push command.',
  )
  const remoteAfterRestart = await readRemoteDeliveryEvidence(
    database.databaseUrl,
    remoteRequest.id,
    binding.id,
  )
  assert(
    stableJson(remoteAfterRestart.counts) === stableJson(remoteBeforeRestart.counts),
    'Packaged restart duplicated durable GitHub Delivery effects.',
  )

  let restartedRun = findRun(restartSnapshot, workflow.runId)
  let acceptanceNode = currentNode(restartedRun)
  assert(acceptanceNode.kind === 'acceptance', 'Completed Draft PR did not reach Acceptance.')
  const bundle = await callDesktop(secondLaunch.page, 'createAcceptanceBundle', {
    runId: restartedRun.id,
    nodeId: acceptanceNode.id,
  })
  restartedRun = bundle.run
  acceptanceNode = currentNode(restartedRun)
  await callDesktop(secondLaunch.page, 'runKnowledgeReview', {
    runId: restartedRun.id,
    nodeId: acceptanceNode.id,
    projectId: localProject.id,
    requestedBy: pairing.credential.userId,
    runtime: 'electron',
    providerId: 'fake-knowledge-review',
  })
  const accepted = await callDesktop(secondLaunch.page, 'approveGate', {
    runId: restartedRun.id,
    nodeId: acceptanceNode.id,
  })
  assert(accepted.run.status === 'completed', 'Packaged Acceptance did not complete the Run.')

  const revocation = await requestJson(
    internalApiUrl,
    '/api/team/projects/p-payments/github-repository-binding/revoke',
    {
      method: 'POST',
      headers: browserHeaders,
      body: { expectedStateVersion: binding.version },
    },
  )
  assert(revocation.body.binding?.status === 'revoked', 'Browser session did not revoke binding.')
  const completedIntent = restartSnapshot.githubDeliveryIntents.find(
    (candidate) => candidate.id === prepared.intent.id,
  )
  await waitFor('packaged Desktop revoked binding convergence', async () => {
    const nextState = await callDesktop(secondLaunch.page, 'loadState')
    return nextState.githubRepositoryBindings?.some(
      (candidate) =>
        candidate.id === binding.id &&
        candidate.version === revocation.body.binding.version &&
        candidate.status === 'revoked',
    )
  })
  await gitBoundary.waitForIdle()
  const providerBeforeRevocationProbe = JSON.parse(await readFile(metricsPath, 'utf8'))
  const gitBeforeRevocationProbe = snapshotGitBoundaryEffects(gitBoundary.metrics)
  const remoteBeforeRevocationProbe = await readRemoteDeliveryEvidence(
    database.databaseUrl,
    remoteRequest.id,
    binding.id,
  )
  const verifyRevocationButton = secondLaunch.page.getByRole('button', {
    name: 'Verify credential revocation',
    exact: true,
  })
  await verifyRevocationButton.waitFor({ state: 'visible', timeout: 30_000 })
  await verifyRevocationButton.click()
  const revokedState = await waitFor(
    'packaged Desktop persisted revocation proof',
    async () => {
      const nextState = await callDesktop(secondLaunch.page, 'loadState')
      return nextState.githubDeliveryRevocationChecks?.some(
        (candidate) =>
          candidate.intentId === completedIntent.id &&
          candidate.intentUpdatedAt === completedIntent.updatedAt &&
          candidate.bindingId === binding.id &&
          candidate.bindingVersion === revocation.body.binding.version &&
          candidate.outcomeCode === 'binding_inactive' &&
          candidate.redacted === true,
      )
        ? nextState
        : false
    },
  )
  await waitFor('packaged Desktop revocation success message', async () => {
    const copy = await secondLaunch.page.getByTestId('toast').textContent()
    return copy?.includes(
      'Credential revocation 已验证：binding_inactive',
    )
  })
  const revocationProbe = {
    intentId: completedIntent.id,
    disposition: 'blocked',
    outcomeCode: 'binding_inactive',
  }
  await gitBoundary.waitForIdle()
  assert(
    revokedState.githubRepositoryBindings?.some(
      (candidate) =>
        candidate.id === binding.id &&
        candidate.version === revocation.body.binding.version &&
        candidate.status === 'revoked',
    ),
    'Packaged renderer did not converge the revoked binding.',
  )
  assert(
    revokedState.githubDeliveryRevocationChecks?.some(
      (candidate) =>
        candidate.intentId === completedIntent.id &&
        candidate.intentUpdatedAt === completedIntent.updatedAt &&
        candidate.bindingId === binding.id &&
        candidate.bindingVersion === revocation.body.binding.version &&
        candidate.outcomeCode === 'binding_inactive' &&
        candidate.redacted === true,
    ),
    'Packaged renderer did not expose the exact redacted revocation proof.',
  )
  assertNoSecretMaterial(
    revokedState,
    [
      pairingCode,
      desktopBearer,
      sessionCookie,
      ephemeralGitHubCredential,
      githubAppPrivateKey,
      githubAppPrivateKeyBase64,
    ],
    'Complete packaged renderer state',
  )
  const remoteAfterRevocation = await readRemoteDeliveryEvidence(
    database.databaseUrl,
    remoteRequest.id,
    binding.id,
  )
  const providerAfterRevocationProbe = JSON.parse(await readFile(metricsPath, 'utf8'))
  const gitAfterRevocationProbe = snapshotGitBoundaryEffects(gitBoundary.metrics)
  assert(
    stableJson(providerAfterRevocationProbe) ===
      stableJson(providerBeforeRevocationProbe),
    'Revocation verification called the GitHub provider.',
  )
  assert(
    stableJson(gitAfterRevocationProbe) === stableJson(gitBeforeRevocationProbe),
    'Revocation verification performed a Git credential, push, or remote inspection effect.',
  )
  assert(
    stableJson(remoteAfterRevocation) === stableJson(remoteBeforeRevocationProbe),
    'Revocation verification mutated the completed remote delivery chain.',
  )
  assert(
    remoteAfterRevocation.counts.grants === 1,
    'Binding revocation allowed a duplicate credential grant.',
  )

  await secondLaunch.electronApp.close()
  const storePath = path.join(userDataDirectory, 'devflow.sqlite')
  assertNoSecretMaterial(
    await readFile(storePath),
    [
      pairingCode,
      desktopBearer,
      sessionCookie,
      ephemeralGitHubCredential,
      githubAppPrivateKey,
      githubAppPrivateKeyBase64,
    ],
    'Complete packaged local database',
  )
  const localRecords = await readLocalDeliveryRecords(storePath)
  assertNoLeaks(
    localRecords,
    [
      pairingCode,
      desktopBearer,
      sessionCookie,
      ephemeralGitHubCredential,
      githubAppPrivateKey,
      githubAppPrivateKeyBase64,
      temporaryDirectory,
      gitFixture.sourceRepository,
    ],
    'Packaged durable local GitHub Delivery records',
  )
  assertNoLeaks(
    remoteAfterRevocation.records,
    [
      pairingCode,
      desktopBearer,
      sessionCookie,
      ephemeralGitHubCredential,
      githubAppPrivateKey,
      githubAppPrivateKeyBase64,
      temporaryDirectory,
      gitFixture.sourceRepository,
    ],
    'Packaged durable remote GitHub Delivery records',
  )
  const finalMetrics = JSON.parse(await readFile(metricsPath, 'utf8'))
  assert(finalMetrics.unexpectedOutboundRequests === 0, 'Fake GitHub boundary saw outbound drift.')
  assert(finalMetrics.installationTokens.contentsWrite === 1, 'Provider credential was not issued exactly once.')
  assert(finalMetrics.pullRequestCreates === 1, 'Draft PR was not created exactly once.')
  assert(gitBoundary.metrics.rejectedHosts === 0, 'Git boundary rejected unexpected internet egress.')

  result = {
    status: 'ok',
    gate: 'v15-github-delivery-packaged-smoke',
    packagedRenderer: 'file:',
    postgres: 'fresh-disposable',
    githubBoundary: 'offline-fake',
    branchPublication: 'exact-non-force-once',
    draftPullRequests: finalMetrics.pullRequestCreates,
    restartDuplicateEffects: 0,
    acceptance: 'completed',
    bindingRevocation: 'passed',
    typedOutcomes: {
      preparation: prepared.status,
      replayed: prepared.replayed,
       approvalAuthentication: approval.body.approval.authenticationKind,
       resumeDisposition: resumed.disposition,
       resumeOutcomeCode: resumed.outcomeCode,
       revocationDisposition: revocationProbe.disposition,
       revocationOutcomeCode: revocationProbe.outcomeCode,
     },
    durableSecretLeaks: 0,
    cleanup: 'pending',
  }
} catch (error) {
  primaryError = error
}

const cleanupErrors = []
for (const operation of cleanup.reverse()) {
  try {
    await operation()
  } catch (error) {
    cleanupErrors.push(error)
  }
}

if (primaryError || cleanupErrors.length > 0) {
  throw new AggregateError(
    [primaryError, ...cleanupErrors].filter(Boolean),
    'V1.5 packaged GitHub Delivery smoke failed or cleanup was incomplete.',
  )
}

result.cleanup = 'passed'
console.log(JSON.stringify(result, null, 2))
