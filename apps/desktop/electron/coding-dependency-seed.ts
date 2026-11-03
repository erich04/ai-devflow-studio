import { createHash, randomUUID } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import { copyFile, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { codingDigest, codingFilePath, codingRelativePath, snapshotCodingTree, type CodingCandidateWorkspace, type CodingManifest } from './coding-candidate-workspace'
import { codingDependencyStoreDirectory, type CodingDependencyPlan } from './coding-dependency-preparation'

type SeedInput = { workspace: CodingCandidateWorkspace; directory: string; plan: CodingDependencyPlan; signal?: AbortSignal }
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'
/** Registry artifacts can exceed the source-file limit. Hash them as streams;
 * retain independent bounds of 512 MiB/file, 2 GiB total and 200k files. */
async function storeManifest(root: string, signal?: AbortSignal): Promise<CodingManifest> {
  const files: CodingManifest['files'] = [], seen = new Set<string>(); let total = 0
  const walk = async (prefix: string) => {
    signal?.throwIfAborted()
    const directory = prefix ? path.dirname(await codingFilePath(root, `${prefix}/.path-check`)) : root
    const stat = await lstat(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe dependency store directory')
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = codingRelativePath(prefix ? `${prefix}/${entry.name}` : entry.name), folded = relative.toLowerCase()
      if (seen.has(folded)) throw new Error('Case-colliding dependency store path')
      seen.add(folded)
      if (entry.isDirectory()) { await walk(relative); continue }
      if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('Unsupported dependency store entry')
      const full = await codingFilePath(root, relative), before = await lstat(full)
      if (before.size > 512 * 1024 ** 2 || files.length >= 200000 || (total += before.size) > 2 * 1024 ** 3) throw new Error('Dependency store capacity exceeded')
      const hash = createHash('sha256')
      for await (const chunk of createReadStream(full)) { signal?.throwIfAborted(); hash.update(chunk) }
      const after = await lstat(full)
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino || before.mode !== after.mode) throw new Error('Dependency store changed during hashing')
      files.push({ path: relative, hash: hash.digest('hex'), mode: before.mode & 0o111 ? 0o755 : 0o644, size: before.size })
    }
  }
  await walk(''); files.sort((a, b) => a.path < b.path ? -1 : 1)
  const manifest = { schemaVersion: 1 as const, files, excludedPaths: [] }
  return { ...manifest, digest: codingDigest(JSON.stringify(manifest)) }
}
function seedIdentity({ workspace, plan }: SeedInput) {
  const identity = { version: 1, baselineDigest: workspace.identity.base.digest, dependencyPlanDigest: plan.digest, platform: process.platform, arch: process.arch, node: process.version }
  return { identity, key: codingDigest(JSON.stringify(identity)) }
}
async function readSeed(input: SeedInput) {
  const { identity, key } = seedIdentity(input), root = path.join(input.workspace.root, 'dependency-seeds', key)
  let saved: { key: string; identity: typeof identity; manifestDigest: string }
  try { saved = JSON.parse(await readFile(await codingFilePath(root, 'manifest.json'), 'utf8')) }
  catch (error) { if (missing(error)) return undefined; throw error }
  const manifest = await storeManifest(path.join(root, 'store'), input.signal)
  if (saved.key !== key || JSON.stringify(saved.identity) !== JSON.stringify(identity) || saved.manifestDigest !== manifest.digest) throw new Error('Dependency seed identity or bytes changed')
  return { root, manifest }
}
async function copyStore(source: string, destination: string, manifest: CodingManifest, signal?: AbortSignal) {
  for (const file of manifest.files) {
    signal?.throwIfAborted()
    // A byte copy, never a hard link or symlink into the immutable seed.
    await copyFile(await codingFilePath(source, file.path), await codingFilePath(destination, file.path, true), constants.COPYFILE_EXCL)
  }
  if ((await storeManifest(destination, signal)).digest !== manifest.digest) throw new Error('Dependency store copy mismatch')
}

/** Called by the host immediately after successful B dependency preparation,
 * before any generated private check executes. C is never a publishing source. */
export async function captureCodingDependencySeed(input: SeedInput & { preparationLogId: string }) {
  input.signal?.throwIfAborted()
  if (!input.plan.frozen || input.plan.storeDirectory !== codingDependencyStoreDirectory) return { status: 'unavailable' as const }
  if (path.resolve(input.directory) === path.resolve(input.workspace.candidatePath) ||
      (await snapshotCodingTree(input.directory, input.workspace.identity.base.excludedPaths)).digest !== input.workspace.identity.base.digest) throw new Error('Dependency seed requires the unchanged baseline')
  const existing = await readSeed(input)
  if (existing) return { status: 'captured' as const, manifestDigest: existing.manifest.digest }
  // Validate every parent before traversing the excluded cache directory.
  const source = path.dirname(await codingFilePath(input.directory, `${codingDependencyStoreDirectory}/.path-check`))
  let manifest: CodingManifest
  try { manifest = await storeManifest(source, input.signal) } catch (error) { if (missing(error)) return { status: 'unavailable' as const }; throw error }
  if (!manifest.files.length) return { status: 'unavailable' as const }
  const { identity, key } = seedIdentity(input), parent = path.join(input.workspace.root, 'dependency-seeds')
  await mkdir(parent, { recursive: true, mode: 0o700 })
  const staging = path.join(parent, `.preparing-${randomUUID()}`); await mkdir(staging, { mode: 0o700 })
  try {
    const destination = path.join(staging, 'store'); await mkdir(destination)
    await copyStore(source, destination, manifest, input.signal)
    if ((await snapshotCodingTree(input.directory, input.workspace.identity.base.excludedPaths)).digest !== input.workspace.identity.base.digest) throw new Error('Dependency seed baseline changed during capture')
    await writeFile(path.join(staging, 'manifest.json'), JSON.stringify({ key, identity, manifestDigest: manifest.digest, preparationLogId: input.preparationLogId, capturedBeforePrivateChecks: true }), { flag: 'wx', mode: 0o600 })
    input.signal?.throwIfAborted()
    await rename(staging, path.join(parent, key))
    return { status: 'captured' as const, manifestDigest: manifest.digest }
  } finally { await rm(staging, { recursive: true, force: true }) }
}

/** Each consumer owns a separate writable store. Final V receives the B seed,
 * never the store or node_modules modified by C or a private check. */
export async function restoreCodingDependencySeed(input: SeedInput) {
  input.signal?.throwIfAborted()
  if (!input.plan.frozen || input.plan.storeDirectory !== codingDependencyStoreDirectory) return { status: 'unavailable' as const }
  const destination = path.dirname(await codingFilePath(input.directory, `${codingDependencyStoreDirectory}/.path-check`))
  try {
    const stat = await lstat(destination)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe dependency store')
    return { status: 'already_present' as const }
  } catch (error) { if (!missing(error)) throw error }
  const seed = await readSeed(input)
  if (!seed) return { status: 'unavailable' as const }
  await codingFilePath(input.directory, '.cache/.path-check', true)
  await mkdir(destination, { mode: 0o700 })
  try {
    await copyStore(path.join(seed.root, 'store'), destination, seed.manifest, input.signal)
    return { status: 'restored' as const, manifestDigest: seed.manifest.digest }
  } catch (error) { await rm(destination, { recursive: true, force: true }); throw error }
}
