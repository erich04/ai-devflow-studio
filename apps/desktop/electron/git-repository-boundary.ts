import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Git discovers ancestor repositories; a Local Project must own the selected root. */
export async function isGitWorkingTreeRoot(directory: string): Promise<boolean> {
  try {
    const selectedRoot = await realpath(directory)
    const { stdout } = await execFileAsync('git', ['-C', selectedRoot, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      timeout: 5_000,
      windowsHide: true,
    })
    const gitRoot = await realpath(stdout.replace(/\r?\n$/u, ''))
    return path.relative(selectedRoot, gitRoot) === ''
  } catch {
    return false
  }
}
