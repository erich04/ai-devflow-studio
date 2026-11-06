import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { snapshotCodingTree } from './coding-candidate-workspace'
const exec = promisify(execFile)
export const codingExcludedPaths = ['node_modules', '.cache', 'coverage']
export async function inspectCodingInput(directory: string, baseCommitSha: string) {
  if (!/^[a-f0-9]{40,64}$/u.test(baseCommitSha)) throw new Error('Invalid input commit')
  await exec('git', ['cat-file', '-e', `${baseCommitSha}^{commit}`], { cwd: directory })
  const manifest = await snapshotCodingTree(directory, codingExcludedPaths)
  const [changed, untracked] = await Promise.all([
    exec('git', ['diff', '--name-only', '-z', baseCommitSha, '--'], { cwd: directory, maxBuffer: 16 * 1024 * 1024 }),
    exec('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: directory, maxBuffer: 16 * 1024 * 1024 }),
  ])
  const included = new Set(manifest.files.map(file => file.path))
  const dirtyPaths = [...new Set([...changed.stdout.split('\0'), ...untracked.stdout.split('\0')].filter(file => file && (included.has(file) || changed.stdout.split('\0').includes(file))))].sort()
  return { digest: manifest.digest, fileCount: manifest.files.length, dirtyPaths, excludedPaths: codingExcludedPaths }
}
