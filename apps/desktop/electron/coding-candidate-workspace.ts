import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { chmod, cp, link, lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, rmdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const exec = promisify(execFile)
export const codingDigest = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex')
export type CodingFileEntry = { path: string; hash: string; mode: number; size: number }
export type CodingManifest = { schemaVersion: 1; files: CodingFileEntry[]; excludedPaths: string[]; digest: string }
export type CodingFileOperation = { kind: 'create' | 'update' | 'delete' | 'mode_change'; path: string; before: CodingFileEntry | null; after: CodingFileEntry | null }
export type CodingRevision = {
  schemaVersion: 1; id: string; sessionId: string; codingRunId: string; objectiveVersion: number; policyVersion: number
  baseCommitSha: string; base: CodingManifest; target: CodingManifest; operations: CodingFileOperation[]
  testPlanDigest: string; summary: string; createdAt: string; digest: string
  /** Exact-content, unambiguous rename annotations. Transactions use the paired create/delete effects. */
  renames?: Array<{ sourcePath: string; path: string; hash: string }>
}
type WorkspaceIdentity = { schemaVersion: 1; delivery: string; baseCommitSha: string; base: CodingManifest }

export function codingRelativePath(value: string): string {
  if (!value || value.includes('\0') || value.includes('\\') || path.posix.isAbsolute(value) || /^[a-z]:/iu.test(value) ||
    value.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git') || value.normalize('NFC') !== value) throw new Error('Unsafe coding path')
  return value
}

/** Do not traverse symlinks, junctions, submodules, device files or host Git metadata. */
export async function codingFilePath(root: string, relative: string, createParents = false): Promise<string> {
  codingRelativePath(relative)
  const rootStat = await lstat(root)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Unsafe workspace root')
  const parts = relative.split('/')
  let current = root
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]!)
    try {
      const stat = await lstat(current)
      if (stat.isSymbolicLink() || (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())) throw new Error('Unsupported coding file type')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      if (index < parts.length - 1 && createParents) await mkdir(current)
    }
  }
  return current
}

export async function atomicCodingFile(destination: string, bytes: Uint8Array, mode = 0o600): Promise<void> {
  const temporary = `${destination}.${randomUUID()}.tmp`
  const handle = await open(temporary, 'wx', mode)
  try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
  try { await rename(temporary, destination) } finally { await rm(temporary, { force: true }) }
  // Persist the rename as well as the file contents on platforms supporting directory fsync.
  try { const directory = await open(path.dirname(destination), 'r'); try { await directory.sync() } finally { await directory.close() } }
  catch (error) { if (process.platform !== 'win32' || !['EPERM', 'EISDIR', 'EINVAL', 'EBADF'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error }
}

export async function removeCodingFile(root: string, relative: string): Promise<void> {
  const full = await codingFilePath(root, relative)
  await rm(full, { force: true })
  // Empty directories are not part of the manifest; remove only empty ancestors for file↔directory changes.
  for (let directory = path.dirname(full); directory !== root; directory = path.dirname(directory)) {
    try { await rmdir(directory) } catch (error) {
      if (['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) break
      throw error
    }
  }
}

export async function snapshotCodingTree(root: string, excludedPaths: string[], saveBlob?: (bytes: Buffer) => Promise<void>): Promise<CodingManifest> {
  const files: CodingFileEntry[] = [], seen = new Set<string>()
  let totalBytes = 0
  const excluded = (relative: string) => relative.toLowerCase() === '.git' || excludedPaths.some(item => item.includes('/') ? relative === item || relative.startsWith(`${item}/`) : relative.split('/').includes(item))
  const walk = async (directory: string, prefix: string): Promise<void> => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : 1)) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      if (excluded(relative)) continue
      codingRelativePath(relative)
      const folded = relative.normalize('NFC').toLowerCase()
      if (seen.has(folded)) throw new Error('Case-colliding coding paths')
      seen.add(folded)
      if (entry.isDirectory()) { await walk(path.join(directory, entry.name), relative); continue }
      if (!entry.isFile() || entry.isSymbolicLink()) throw new Error(`Unsupported coding file: ${relative}`)
      const fullPath = await codingFilePath(root, relative)
      const before = await lstat(fullPath)
      if (before.size > 32 * 1024 * 1024 || files.length >= 200_000 || (totalBytes += before.size) > 2 * 1024 ** 3) throw new Error('Cannot establish complete coding manifest: capacity exceeded')
      const bytes = await readFile(fullPath), after = await lstat(fullPath)
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino || before.mode !== after.mode) throw new Error('Workspace changed during snapshot')
      if (saveBlob) await saveBlob(bytes)
      files.push({ path: relative, hash: codingDigest(bytes), mode: before.mode & 0o111 ? 0o755 : 0o644, size: bytes.length })
    }
  }
  await walk(root, '')
  files.sort((a, b) => a.path < b.path ? -1 : 1)
  const manifest = { schemaVersion: 1 as const, files, excludedPaths: [...excludedPaths].sort() }
  return { ...manifest, digest: codingDigest(JSON.stringify(manifest)) }
}

/** B and blobs are immutable; C/V each have independent Git metadata. D is host-only. */
export class CodingCandidateWorkspace {
  readonly candidatePath: string
  private constructor(readonly root: string, readonly identity: WorkspaceIdentity) { this.candidatePath = path.join(root, 'candidate') }

  static async create(input: { root: string; delivery: string; baseCommitSha: string; excludedPaths: string[] }): Promise<CodingCandidateWorkspace> {
    if (!/^[a-f0-9]{40,64}$/u.test(input.baseCommitSha)) throw new Error('Invalid base commit')
    input.excludedPaths.forEach(codingRelativePath)
    const staging = `${input.root}.creating-${randomUUID()}`
    await mkdir(staging, { recursive: false, mode: 0o700 })
    try {
    await mkdir(path.join(staging, 'blobs'), { mode: 0o700 })
    const base = await snapshotCodingTree(input.delivery, input.excludedPaths, async bytes => {
      await atomicCodingFile(path.join(staging, 'blobs', codingDigest(bytes)), bytes)
    })
    const workspace = new CodingCandidateWorkspace(staging, { schemaVersion: 1, delivery: input.delivery, baseCommitSha: input.baseCommitSha, base })
    await workspace.materialize(base, workspace.candidatePath)
    await atomicCodingFile(path.join(staging, 'identity.json'), Buffer.from(JSON.stringify(workspace.identity)))
    try { await rename(staging, input.root) }
    catch (error) {
      if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
      const existing = await CodingCandidateWorkspace.open(input.root)
      if (existing.identity.baseCommitSha !== input.baseCommitSha || existing.identity.delivery !== input.delivery || existing.identity.base.digest !== base.digest || (await existing.inspect()).digest !== base.digest) throw new Error('Existing candidate requires reconciliation')
      return existing
    }
    return CodingCandidateWorkspace.open(input.root)
    } finally { await rm(staging, { recursive: true, force: true }) }
  }

  static async open(root: string): Promise<CodingCandidateWorkspace> {
    const identity = JSON.parse(await readFile(path.join(root, 'identity.json'), 'utf8')) as WorkspaceIdentity
    if (identity.schemaVersion !== 1 || !path.isAbsolute(identity.delivery)) throw new Error('Invalid candidate identity')
    const { digest, ...body } = identity.base
    if (codingDigest(JSON.stringify(body)) !== digest) throw new Error('Corrupt base manifest')
    return new CodingCandidateWorkspace(root, identity)
  }

  async blob(hash: string): Promise<Buffer> {
    if (!/^[a-f0-9]{64}$/u.test(hash)) throw new Error('Invalid blob reference')
    const bytes = await readFile(path.join(this.root, 'blobs', hash))
    if (codingDigest(bytes) !== hash) throw new Error('Corrupt coding blob')
    return bytes
  }
  private async storeBlob(bytes: Buffer): Promise<void> {
    const target = path.join(this.root, 'blobs', codingDigest(bytes))
    try { await this.blob(codingDigest(bytes)) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; await atomicCodingFile(target, bytes) }
  }
  async inspect(): Promise<CodingManifest> { return snapshotCodingTree(this.candidatePath, this.identity.base.excludedPaths) }
  async capture(): Promise<CodingManifest> { return snapshotCodingTree(this.candidatePath, this.identity.base.excludedPaths, bytes => this.storeBlob(bytes)) }
  async read(relative: string): Promise<{ hash: string; bytes: Buffer; mode: number }> {
    const full = await codingFilePath(this.candidatePath, relative)
    const bytes = await readFile(full), stat = await lstat(full)
    return { bytes, hash: codingDigest(bytes), mode: stat.mode & 0o111 ? 0o755 : 0o644 }
  }
  async write(relative: string, content: string | Buffer, expectedHash: string | null, mode = 0o644): Promise<void> {
    const full = await codingFilePath(this.candidatePath, relative, true)
    let current: string | null = null
    try { current = codingDigest(await readFile(full)) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (current !== expectedHash) throw new Error('File changed since observation')
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content)
    if (![0o644, 0o755].includes(mode) || bytes.length > 32 * 1024 * 1024) throw new Error('Invalid coding file')
    await atomicCodingFile(full, bytes, mode); await chmod(full, mode)
  }
  async remove(relative: string, expectedHash: string): Promise<void> {
    if ((await this.read(relative)).hash !== expectedHash) throw new Error('File changed since observation')
    await removeCodingFile(this.candidatePath, relative)
  }
  async materialize(manifest: CodingManifest, destination: string): Promise<void> {
    if (!path.isAbsolute(destination)) throw new Error('Snapshot destination must be absolute')
    await mkdir(destination, { mode: 0o700 })
    // Git's initialization preflight and process cwd have separate Windows
    // path limits. Build a standalone repository in a private short directory,
    // then copy it with Node's long-path-aware filesystem. No absolute gitdir,
    // worktree, object alternate, remote or host configuration survives the move.
    const staging = await mkdtemp(path.join(os.tmpdir(), 'devflow-snapshot-'))
    try {
      const tree = path.join(staging, 'tree'); await mkdir(tree, { mode: 0o700 })
      for (const file of manifest.files) {
        const full = await codingFilePath(tree, file.path, true)
        await writeFile(full, await this.blob(file.hash), { flag: 'wx', mode: file.mode })
        await chmod(full, file.mode)
      }
      const config = path.join(staging, 'empty-gitconfig'); await writeFile(config, '', { mode: 0o600 })
      const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: config,
        GIT_AUTHOR_NAME: 'DevFlow snapshot', GIT_AUTHOR_EMAIL: 'snapshot@devflow.invalid', GIT_COMMITTER_NAME: 'DevFlow snapshot', GIT_COMMITTER_EMAIL: 'snapshot@devflow.invalid', GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z' }
      const git = (args: string[]) => exec('git', ['-c', 'core.longpaths=true', ...args], { cwd: tree, env })
      await git(['-c', 'init.templateDir=', 'init', '--quiet'])
      await git(['config', '--local', 'core.longpaths', 'true'])
      await git(['-c', 'core.autocrlf=false', 'add', '--force', '--all'])
      await git(['-c', 'core.hooksPath=', 'commit', '--quiet', '--allow-empty', '-m', `Immutable input ${manifest.digest}`])
      for (const name of await readdir(tree)) await cp(path.join(tree, name), path.join(destination, name), { recursive: true, force: false, errorOnExist: true })
      if ((await snapshotCodingTree(destination, manifest.excludedPaths)).digest !== manifest.digest) throw new Error('Materialized snapshot mismatch')
    } finally { await rm(staging, { recursive: true, force: true }) }
  }

  async materializeAtomic(manifest: CodingManifest, destination: string): Promise<void> {
    try {
      if ((await snapshotCodingTree(destination, manifest.excludedPaths)).digest !== manifest.digest) throw new Error('Existing delegated base differs from its durable intent')
      return
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const staging = `${destination}.creating-${randomUUID()}`
    try {
      await this.materialize(manifest, staging)
      try { await rename(staging, destination) }
      catch (error) { if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error }
      if ((await snapshotCodingTree(destination, manifest.excludedPaths)).digest !== manifest.digest) throw new Error('Existing delegated base differs from its durable intent')
    } finally { await rm(staging, { recursive: true, force: true }) }
  }
  async freeze(input: Pick<CodingRevision, 'sessionId' | 'codingRunId' | 'objectiveVersion' | 'policyVersion' | 'testPlanDigest' | 'summary'> & { now: string; id?: string }): Promise<CodingRevision> {
    if (input.id && !/^[a-zA-Z0-9_-]{1,160}$/u.test(input.id)) throw new Error('Invalid revision identity')
    const target = await snapshotCodingTree(this.candidatePath, this.identity.base.excludedPaths, bytes => this.storeBlob(bytes))
    const before = new Map(this.identity.base.files.map(file => [file.path, file])), after = new Map(target.files.map(file => [file.path, file]))
    const operations: CodingFileOperation[] = []
    for (const relative of [...new Set([...before.keys(), ...after.keys()])].sort()) {
      const from = before.get(relative) ?? null, to = after.get(relative) ?? null
      if (from?.hash === to?.hash && from?.mode === to?.mode) continue
      operations.push({ kind: !from ? 'create' : !to ? 'delete' : from.hash === to.hash ? 'mode_change' : 'update', path: relative, before: from, after: to })
    }
    operations.sort((a, b) => Number(a.after !== null) - Number(b.after !== null) || (a.after === null ? b.path.length - a.path.length : a.path.length - b.path.length) || a.path.localeCompare(b.path))
    const deletes = operations.filter(operation => operation.kind === 'delete'), creates = operations.filter(operation => operation.kind === 'create')
    const renames = deletes.flatMap(source => {
      const targets = creates.filter(target => target.after!.hash === source.before!.hash)
      return targets.length === 1 && deletes.filter(other => other.before!.hash === source.before!.hash).length === 1 ? [{ sourcePath: source.path, path: targets[0]!.path, hash: source.before!.hash }] : []
    })
    const { now, ...binding } = input
    const body = { schemaVersion: 1 as const, ...binding, id: input.id ?? `changeset-${randomUUID()}`, baseCommitSha: this.identity.baseCommitSha, base: this.identity.base, target, operations, renames, createdAt: now }
    const revision = { ...body, digest: codingDigest(JSON.stringify(body)) }
    await mkdir(path.join(this.root, 'revisions'), { recursive: true, mode: 0o700 })
    const destination = path.join(this.root, 'revisions', `${revision.id}.json`)
    const temporary = `${destination}.${randomUUID()}.tmp`
    await atomicCodingFile(temporary, Buffer.from(JSON.stringify(revision)))
    try {
      // Publish a fully fsynced object without ever replacing an existing ID.
      await link(temporary, destination)
      try { const directory = await open(path.dirname(destination), 'r'); try { await directory.sync() } finally { await directory.close() } }
      catch (error) { if (process.platform !== 'win32' || !['EPERM', 'EISDIR', 'EINVAL', 'EBADF'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error }
      return revision
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const existing = await this.revision(revision.id)
      if (!existing || existing.digest !== codingDigest(JSON.stringify({ ...body, createdAt: existing.createdAt }))) throw new Error('Revision identity is already frozen with different content')
      return existing
    } finally { await rm(temporary, { force: true }) }
  }
  async revision(id: string): Promise<CodingRevision | null> {
    if (!/^[a-zA-Z0-9_-]{1,160}$/u.test(id)) throw new Error('Invalid revision identity')
    let revision: CodingRevision
    try { revision = JSON.parse(await readFile(path.join(this.root, 'revisions', `${id}.json`), 'utf8')) as CodingRevision }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
    const { digest, ...body } = revision
    if (revision.schemaVersion !== 1 || revision.id !== id || revision.base.digest !== this.identity.base.digest || codingDigest(JSON.stringify(body)) !== digest) throw new Error('Corrupt frozen revision')
    return revision
  }
}
