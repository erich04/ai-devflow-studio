import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const maximumKeyringStartupMs = 15_000
const maximumPackagedSmokeMs = 15 * 60_000

function signalProcessGroup(child, signal) {
  if (!child?.pid) return
  try {
    process.kill(-child.pid, signal)
  } catch {
    try {
      child.kill(signal)
    } catch {
      // The process already exited.
    }
  }
}

export function runFixedProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const spawnProcess = options.spawnProcess ?? spawn
    const sendSignal = options.sendSignal ?? signalProcessGroup
    const terminationGraceMs = options.terminationGraceMs ?? 3_000
    const finalWaitMs = options.finalWaitMs ?? 8_000
    const child = spawnProcess(command, args, {
      detached: true,
      env: process.env,
      stdio: [
        options.input === undefined ? 'ignore' : 'pipe',
        options.inheritOutput ? 'inherit' : 'ignore',
        options.inheritOutput ? 'inherit' : 'ignore',
      ],
      windowsHide: true,
    })
    let settled = false
    let timedOut = false
    let forceTimer
    let finalTimer
    const settle = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      clearTimeout(forceTimer)
      clearTimeout(finalTimer)
      if (error) reject(error)
      else resolve()
    }
    const timeout = setTimeout(() => {
      timedOut = true
      sendSignal(child, 'SIGTERM')
      forceTimer = setTimeout(() => sendSignal(child, 'SIGKILL'), terminationGraceMs)
      finalTimer = setTimeout(
        () => {
          sendSignal(child, 'SIGKILL')
          settle(new Error('linux_packaged_smoke_process_timeout'))
        },
        finalWaitMs,
      )
    }, options.timeoutMs)
    child.once('error', () => settle(new Error('linux_packaged_smoke_process_failed')))
    child.once('exit', (code, signal) => {
      if (timedOut) {
        return
      }
      if (code === 0 && signal === null) settle()
      else settle(new Error('linux_packaged_smoke_process_failed'))
    })
    if (options.input !== undefined) {
      child.stdin?.end(options.input)
    }
  })
}

export async function runLinuxPackagedSmoke(options = {}) {
  const platform = options.platform ?? process.platform
  const sessionBusAddress =
    options.sessionBusAddress ?? process.env['DBUS_SESSION_BUS_ADDRESS']
  const runProcess = options.runProcess ?? runFixedProcess

  if (platform !== 'linux') {
    throw new Error('linux_packaged_smoke_requires_linux')
  }
  if (!sessionBusAddress) {
    throw new Error('linux_packaged_smoke_requires_dbus_session')
  }

  const keyringPassword = randomBytes(32).toString('base64url')
  await runProcess(
    'gnome-keyring-daemon',
    ['--unlock', '--components=secrets'],
    {
      input: `${keyringPassword}\n`,
      timeoutMs: maximumKeyringStartupMs,
      inheritOutput: false,
    },
  )
  await runProcess(
    'xvfb-run',
    ['-a', 'corepack', 'pnpm', 'test:v15-github-delivery-packaged-smoke'],
    {
      timeoutMs: maximumPackagedSmokeMs,
      inheritOutput: true,
    },
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runLinuxPackagedSmoke()
}
