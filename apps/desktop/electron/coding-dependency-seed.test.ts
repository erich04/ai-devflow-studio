// @vitest-environment node
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { CodingCandidateWorkspace } from './coding-candidate-workspace'
import { codingDependencyPlan } from './coding-dependency-preparation'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

it('restores the pinned package manager from B without importing candidate or post-bootstrap changes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devflow-toolchain-seed-')); roots.push(root)
  const delivery = path.join(root, 'delivery'); await mkdir(delivery)
  await writeFile(path.join(delivery, 'package.json'), '{"packageManager":"pnpm@9.15.0","private":true}')
  await writeFile(path.join(delivery, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')
  const workspace = await CodingCandidateWorkspace.create({ root: path.join(root, 'workspace'), delivery, baseCommitSha: 'a'.repeat(40), excludedPaths: ['node_modules', '.cache'] })
  const options = { isolatedStore: true, corepackCache: true }
  const plan = await codingDependencyPlan(delivery, { kind: 'trusted_local' }, workspace.identity.base.excludedPaths, options)
  const baseline = path.join(root, 'baseline'); await workspace.materialize(workspace.identity.base, baseline)
  const manager = '.cache/devflow-corepack/v1/pnpm/9.15.0/bin/pnpm.cjs'
  const packageFile = '.cache/devflow-pnpm-store/v3/files/package'
  for (const [file, content] of [[manager, 'baseline manager'], [packageFile, 'baseline package']]) {
    await mkdir(path.dirname(path.join(baseline, file!)), { recursive: true })
    await writeFile(path.join(baseline, file!), content!)
  }
  const { captureCodingDependencySeed, restoreCodingDependencySeed } = await import('./coding-dependency-seed')
  await captureCodingDependencySeed({ workspace, directory: baseline, plan, preparationLogId: 'baseline-install' })
  await restoreCodingDependencySeed({ workspace, directory: workspace.candidatePath, plan })
  // The same source used for final verification must survive candidate poisoning.
  await mkdir(path.dirname(path.join(workspace.candidatePath, manager)), { recursive: true })
  await writeFile(path.join(workspace.candidatePath, manager), 'candidate manager')
  await writeFile(path.join(baseline, manager), 'post-bootstrap check changed manager')
  const verification = path.join(root, 'verification'); await workspace.materialize(workspace.identity.base, verification)
  await restoreCodingDependencySeed({ workspace: await CodingCandidateWorkspace.open(workspace.root), directory: verification, plan })
  expect(await readFile(path.join(verification, manager), 'utf8')).toBe('baseline manager')
  expect(await readFile(path.join(verification, packageFile), 'utf8')).toBe('baseline package')
  const seed = path.join(workspace.root, 'dependency-seeds', (await readdir(path.join(workspace.root, 'dependency-seeds')))[0]!)
  await writeFile(path.join(seed, 'corepack/v1/pnpm/9.15.0/bin/pnpm.cjs'), 'corrupt seed manager')
  const fresh = path.join(root, 'fresh'); await workspace.materialize(workspace.identity.base, fresh)
  await expect(restoreCodingDependencySeed({ workspace, directory: fresh, plan })).rejects.toThrow('identity or bytes changed')
})

it('keeps historical plans unchanged and copies only a baseline dependency store into independent consumers', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devflow-dependency-seed-')); roots.push(root)
  const delivery = path.join(root, 'delivery'); await mkdir(delivery)
  await writeFile(path.join(delivery, 'package.json'), '{"packageManager":"pnpm@9.15.0","dependencies":{"example":"1.0.0"}}')
  await writeFile(path.join(delivery, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')
  const workspace = await CodingCandidateWorkspace.create({ root: path.join(root, 'workspace'), delivery, baseCommitSha: 'a'.repeat(40), excludedPaths: ['node_modules', '.cache'] })
  const profile = { kind: 'os_sandbox' as const, network: 'none' as const }
  const legacy = await codingDependencyPlan(delivery, profile, workspace.identity.base.excludedPaths)
  const plan = await codingDependencyPlan(delivery, profile, workspace.identity.base.excludedPaths, { isolatedStore: true })
  expect(legacy.command).toBe('corepack pnpm install --frozen-lockfile')
  expect(plan.command).toContain('--store-dir .cache/devflow-pnpm-store')
  expect(plan.inputDigest).toBe(legacy.inputDigest); expect(plan.digest).not.toBe(legacy.digest)
  const { captureCodingDependencySeed, restoreCodingDependencySeed } = await import('./coding-dependency-seed')
  const baseline = path.join(root, 'baseline'); await workspace.materialize(workspace.identity.base, baseline)
  const packageFile = '.cache/devflow-pnpm-store/v3/files/ab/package-content'
  await mkdir(path.dirname(path.join(baseline, packageFile)), { recursive: true })
  await writeFile(path.join(baseline, packageFile), 'registry package bytes')
  const large = path.join(baseline, '.cache/devflow-pnpm-store/v3/files/ab/large-native-artifact')
  await writeFile(large, ''); await truncate(large, 33 * 1024 * 1024)
  // The candidate already differs from B. It must never become the seed source.
  await workspace.write('candidate-only.txt', 'untrusted', null)
  await expect(captureCodingDependencySeed({ workspace, directory: workspace.candidatePath, plan, preparationLogId: 'candidate' })).rejects.toThrow('baseline')
  const saved = await captureCodingDependencySeed({ workspace, directory: baseline, plan, preparationLogId: 'baseline-install' })
  expect(saved).toMatchObject({ status: 'captured' })
  await restoreCodingDependencySeed({ workspace, directory: workspace.candidatePath, plan })
  await writeFile(path.join(workspace.candidatePath, packageFile), 'candidate-poison')
  await writeFile(path.join(baseline, packageFile), 'private-check-after-bootstrap')
  const verification = path.join(root, 'verification'); await workspace.materialize(workspace.identity.base, verification)
  const reopened = await CodingCandidateWorkspace.open(workspace.root)
  expect(await restoreCodingDependencySeed({ workspace: reopened, directory: verification, plan })).toMatchObject({ status: 'restored' })
  expect(await readFile(path.join(verification, packageFile), 'utf8')).toBe('registry package bytes')
  expect(await restoreCodingDependencySeed({ workspace, directory: verification, plan: legacy })).toMatchObject({ status: 'unavailable' })
  // Restore cannot follow an existing candidate cache link outside its workspace.
  await rm(path.join(workspace.candidatePath, '.cache'), { recursive: true })
  const outside = path.join(root, 'outside'); await mkdir(outside)
  await symlink(outside, path.join(workspace.candidatePath, '.cache'), process.platform === 'win32' ? 'junction' : 'dir')
  await expect(restoreCodingDependencySeed({ workspace, directory: workspace.candidatePath, plan })).rejects.toThrow()
  const seedDirectory = path.join(workspace.root, 'dependency-seeds', (await readdir(path.join(workspace.root, 'dependency-seeds')))[0]!)
  await writeFile(path.join(seedDirectory, 'store/v3/files/ab/package-content'), 'corrupt seed')
  const fresh = path.join(root, 'fresh'); await workspace.materialize(workspace.identity.base, fresh)
  await expect(restoreCodingDependencySeed({ workspace, directory: fresh, plan })).rejects.toThrow('identity or bytes changed')
}, 15000)
