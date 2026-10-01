import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const GIT_TIMEOUT_MS = 15_000
const MAX_DIFF_BYTES = 32 * 1024 * 1024
const MAX_UNTRACKED_FILES = 5_000

export type SourceTreeDigest = {
  /** HEAD plus every tracked change against it (staged or not). */
  tracked: string
  /** `tracked` plus the paths and content of untracked, non-ignored files. */
  full: string
}

/** Read-only: never takes the index lock or writes objects into the repository. */
const gitEnv = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }

async function git(cwd: string, args: string[], maxBuffer = 4 * 1024 * 1024): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], {
    timeout: GIT_TIMEOUT_MS, maxBuffer, windowsHide: true, env: gitEnv, encoding: 'utf8',
  })
  return stdout
}

/** Blob IDs of the given files, computed without `-w`. */
async function hashFiles(cwd: string, paths: string[]): Promise<string[]> {
  if (paths.length === 0) return []
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-C', cwd, 'hash-object', '--no-filters', '--stdin-paths'], {
      env: gitEnv, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
    })
    const timer = setTimeout(() => child.kill('SIGKILL'), GIT_TIMEOUT_MS)
    let output = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { output += chunk })
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('close', (code) => {
      clearTimeout(timer)
      const ids = output.split('\n').filter(Boolean)
      if (code !== 0 || ids.length !== paths.length) reject(new Error('git hash-object failed'))
      else resolve(ids)
    })
    child.stdin.end(`${paths.join('\n')}\n`)
  })
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

/**
 * Fingerprint of the code a test command sees in `cwd`: HEAD, tracked changes and untracked
 * files. Returns null outside a Git checkout or when the tree is too large to fingerprint, so a
 * caller records nothing rather than a fingerprint it cannot reproduce (hardening H3, X6).
 */
export async function computeSourceTreeDigest(cwd: string): Promise<SourceTreeDigest | null> {
  try {
    const head = (await git(cwd, ['rev-parse', '--verify', 'HEAD'])).trim()
    if (!/^[a-f0-9]{40,64}$/u.test(head)) return null
    const diff = await git(cwd, ['diff', 'HEAD', '--binary', '--no-ext-diff', '--no-textconv', '--no-color', '--no-renames'], MAX_DIFF_BYTES)
    const tracked = sha256(JSON.stringify(['source-tree-v1', head, diff]))
    const untracked = (await git(cwd, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean).sort()
    if (untracked.length > MAX_UNTRACKED_FILES || untracked.some((file) => file.includes('\n'))) return null
    const blobs = await hashFiles(cwd, untracked)
    const full = sha256(JSON.stringify([tracked, untracked.map((file, index) => [file, blobs[index]])]))
    return { tracked, full }
  } catch {
    return null
  }
}

/**
 * Runs a test and returns the fingerprint of the tree it stood for. Nothing is recorded when the
 * run changed tracked code; untracked output the test leaves behind belongs to the recorded state.
 */
export async function withSourceTreeDigest<T>(cwd: string, run: () => Promise<T>): Promise<{ value: T; digest: string | undefined }> {
  const before = await computeSourceTreeDigest(cwd)
  const value = await run()
  const after = before ? await computeSourceTreeDigest(cwd) : null
  return { value, digest: before && after && before.tracked === after.tracked ? after.full : undefined }
}
