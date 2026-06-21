import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'

const projectName = `devflow-docker-smoke-${Date.now()}`
const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const apiPort = await findOpenPort()
const webPort = await findOpenPort()
const composeEnv = {
  ...process.env,
  DEVFLOW_API_PORT: String(apiPort),
  DEVFLOW_WEB_PORT: String(webPort),
  DEVFLOW_REQUIRE_AUTH: 'false',
  DEVFLOW_SESSION_SECRET: 'docker-smoke-session-secret',
  POSTGRES_DB: 'devflow',
  POSTGRES_PASSWORD: 'devflow',
  POSTGRES_USER: 'postgres',
}

function runDocker(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, {
      cwd: repoRoot,
      env: composeEnv,
      stdio: options.stdio ?? 'inherit',
    })

    let stdout = ''
    let stderr = ''
    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString()
      })
    }
    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString()
      })
    }

    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
      } else {
        reject(new Error(`docker ${args.join(' ')} exited with ${code}\n${stdout}${stderr}`))
      }
    })
  })
}

async function findOpenPort() {
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
        reject(new Error('Unable to allocate an open port.'))
      })
    })
  })
}

async function waitForJson(url, label) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { accept: 'application/json' } })
      if (response.ok) {
        return response.json()
      }
    } catch {
      // keep waiting
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  throw new Error(`Timed out waiting for ${label}: ${url}`)
}

async function waitForText(url, label) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        return response.text()
      }
    } catch {
      // keep waiting
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  throw new Error(`Timed out waiting for ${label}: ${url}`)
}

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(`${url} failed with ${response.status}: ${await response.text()}`)
  }

  return response.json()
}

function expect(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

try {
  await runDocker(['compose', '-p', projectName, 'up', '--build', '-d'])

  const apiUrl = `http://127.0.0.1:${apiPort}`
  const webUrl = `http://127.0.0.1:${webPort}`
  const health = await waitForJson(`${apiUrl}/health`, 'API health')
  expect(health.status === 'ok', 'API health did not return ok.')
  const webHtml = await waitForText(webUrl, 'Web console')
  expect(webHtml.includes('AI DevFlow') || webHtml.includes('__next'), 'Web console did not render.')

  const pairingCode = await postJson(`${apiUrl}/api/team/projects/p-payments/pairing-codes`, {})
  expect(pairingCode.code?.includes('.'), 'Docker smoke did not create a copy-once pairing code.')
  const desktopPairing = await postJson(`${apiUrl}/api/desktop/pairing/exchange`, {
    code: pairingCode.code,
  })
  expect(desktopPairing.token?.includes('.'), 'Docker smoke did not exchange the pairing code for a token.')

  const runId = `run-docker-smoke-${Date.now()}`
  await postJson(
    `${apiUrl}/api/sync/run-summary`,
    {
      kind: 'run',
      runId,
      projectId: 'p-payments',
      title: 'Docker smoke synced run',
      status: 'testing',
      currentNodeId: 'n-test',
      branchName: 'ai/docker-smoke',
      updatedAt: new Date().toISOString(),
    },
    { authorization: `Bearer ${desktopPairing.token}` },
  )
  const overview = await waitForJson(`${apiUrl}/api/team/overview`, 'Team overview')
  expect(
    overview.runs?.some((run) => run.id === runId),
    'Docker smoke overview did not include the bearer-token synced run.',
  )
  const serializedOverview = JSON.stringify(overview)
  expect(!serializedOverview.includes(pairingCode.code), 'Docker smoke leaked pairing code in overview.')
  expect(!serializedOverview.includes(desktopPairing.token), 'Docker smoke leaked Desktop token in overview.')

  console.log(`Docker smoke passed: API ${apiUrl}, Web ${webUrl}`)
} finally {
  await runDocker(['compose', '-p', projectName, 'down', '-v', '--remove-orphans']).catch(() => undefined)
}
