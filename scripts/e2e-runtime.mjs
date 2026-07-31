import { createServer } from 'node:net'

const MIN_PRIVATE_PORT = 1024
const MAX_PORT_BASE = 65533

function listen(server, port) {
  return new Promise((resolve) => {
    server.once('error', () => resolve(false))
    server.once('listening', () => resolve(true))
    server.listen(port, '127.0.0.1')
  })
}

function close(server) {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve()
      return
    }
    server.close(() => resolve())
  })
}

async function canReservePortBlock(basePort) {
  const servers = [createServer(), createServer(), createServer()]
  try {
    for (const [offset, server] of servers.entries()) {
      if (!(await listen(server, basePort + offset))) {
        return false
      }
    }
    return true
  } finally {
    await Promise.all(servers.map(close))
  }
}

export async function chooseAvailableE2ePortBase() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = 42000 + Math.floor(Math.random() * 12000)
    if (await canReservePortBlock(candidate)) {
      return candidate
    }
  }
  throw new Error('Unable to allocate an isolated E2E port block')
}

function parsePortBase(value) {
  const portBase = Number(value)
  if (
    !Number.isInteger(portBase) ||
    portBase < MIN_PRIVATE_PORT ||
    portBase > MAX_PORT_BASE
  ) {
    throw new Error(
      `DEVFLOW_E2E_PORT_BASE must be an integer between ${MIN_PRIVATE_PORT} and ${MAX_PORT_BASE}`,
    )
  }
  return portBase
}

export async function resolveE2eRuntime(
  env = process.env,
  choosePortBase = chooseAvailableE2ePortBase,
) {
  const requestedPortBase = env.DEVFLOW_E2E_PORT_BASE?.trim()
  const portBase = requestedPortBase
    ? parsePortBase(requestedPortBase)
    : await choosePortBase()
  const apiPort = portBase
  const webPort = portBase + 1
  const desktopPort = portBase + 2

  return {
    apiPort,
    webPort,
    desktopPort,
    apiUrl: `http://127.0.0.1:${apiPort}`,
    webUrl: `http://127.0.0.1:${webPort}`,
    desktopUrl: `http://127.0.0.1:${desktopPort}`,
  }
}
