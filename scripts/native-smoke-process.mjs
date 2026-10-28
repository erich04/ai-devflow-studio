import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// Call only with a process this smoke spawned. POSIX callers must use detached: true.
export async function stopNativeSmokeProcess(child) {
  if (!child?.pid) return
  const exited = () => child.exitCode !== null || child.signalCode !== null
  const closed = () => exited() && [child.stdout, child.stderr].every(stream => !stream || stream.destroyed)
  if (closed()) return
  const waitForClose = (milliseconds) => new Promise(resolve => {
    if (closed()) return resolve(true)
    const onClose = () => { clearTimeout(timer); resolve(true) }
    const timer = setTimeout(() => { child.off('close', onClose); resolve(false) }, milliseconds)
    child.once('close', onClose)
  })

  if (process.platform === 'win32') {
    // Killing cmd.exe alone leaves pnpm/node descendants holding our stdout pipes open.
    // Keep the owned parent alive until taskkill has enumerated and stopped its tree.
    if (!exited()) {
      try {
        await execFileAsync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { timeout: 5_000, windowsHide: true })
      } catch (error) {
        if (!closed()) throw error
      }
    }
  } else {
    try { process.kill(-child.pid, 'SIGTERM') } catch (error) {
      if (error.code !== 'ESRCH') throw error
    }
    if (!(await waitForClose(3_000))) {
      try { process.kill(-child.pid, 'SIGKILL') } catch (error) {
        if (error.code !== 'ESRCH') throw error
      }
    }
  }
  if (!(await waitForClose(3_000))) throw new Error(`Owned smoke process tree ${child.pid} did not close`)
}
