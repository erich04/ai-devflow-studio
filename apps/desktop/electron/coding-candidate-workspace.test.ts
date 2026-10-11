// @vitest-environment node
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterEach, expect, it } from 'vitest'
import { CodingCandidateWorkspace, codingRelativePath } from './coding-candidate-workspace'
import { applyAndVerifyCodingRevision, recoverCodingDelivery } from './coding-evidence-v3'

const directories: string[] = []
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devflow-candidate-')); directories.push(root)
  const delivery = path.join(root, 'delivery'); await mkdir(delivery)
  await writeFile(path.join(delivery, 'old.ts'), 'export const value = 1\n')
  await writeFile(path.join(delivery, 'remove.txt'), 'old bytes')
  const workspace = await CodingCandidateWorkspace.create({ root: path.join(root, 'private'), delivery, baseCommitSha: 'a'.repeat(40), excludedPaths: ['node_modules', 'coverage'] })
  return { root, delivery, workspace }
}
it('freezes real additions, updates and deletes without changing delivery or sharing its Git metadata', async () => {
  const { workspace, delivery } = await fixture()
  const before = await workspace.read('old.ts')
  await workspace.write('old.ts', 'export const value = 2\n', before.hash)
  await workspace.write('new.ts', 'export const created = true\n', null)
  await workspace.remove('remove.txt', (await workspace.read('remove.txt')).hash)
  const revision = await workspace.freeze({ sessionId: 's', codingRunId: 'c', objectiveVersion: 1, policyVersion: 1, testPlanDigest: 'b'.repeat(64), summary: 'Fix value', now: '2026-10-11T12:00:00.000Z' })
  expect(revision.operations.map(operation => [operation.kind, operation.path])).toEqual([['delete', 'remove.txt'], ['create', 'new.ts'], ['update', 'old.ts']])
  expect(await readFile(path.join(delivery, 'old.ts'), 'utf8')).toBe('export const value = 1\n')
  expect(await readFile(path.join(workspace.candidatePath, '.git', 'config'), 'utf8')).not.toContain('remote')
  const status = await promisify(execFile)('git', ['-C', workspace.candidatePath, 'status', '--porcelain'])
  expect(status.stdout).toContain('old.ts')
  const restored = await CodingCandidateWorkspace.open(workspace.root)
  expect((await restored.inspect()).digest).toBe(revision.target.digest)
})
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))) })

it('never redefines the bytes or identity of an already frozen revision on replay', async () => {
  const { workspace } = await fixture()
  const input = { id: 'fixed-revision', sessionId: 's', codingRunId: 'c', objectiveVersion: 1, policyVersion: 1, testPlanDigest: 'b'.repeat(64), summary: 'Review', now: '2026-10-11T12:00:00.000Z' }
  const frozen = await workspace.freeze(input)
  expect(await workspace.freeze({ ...input, now: '2026-10-11T13:00:00.000Z' })).toEqual(frozen)
  await workspace.write('new.ts', 'new bytes', null)
  await expect(workspace.freeze(input)).rejects.toThrow(/already frozen/)
})

it('preserves actual binary bytes and rename identity while applying file-to-directory changes', async () => {
  const { workspace, delivery } = await fixture()
  const old = await workspace.read('old.ts')
  await workspace.write('moved.ts', old.bytes, null, old.mode)
  await workspace.remove('old.ts', old.hash)
  await workspace.remove('remove.txt', (await workspace.read('remove.txt')).hash)
  await workspace.write('remove.txt/new.bin', Buffer.from([0, 255, 128, 13, 10]), null)
  const revision = await workspace.freeze({ sessionId: 's', codingRunId: 'c', objectiveVersion: 1, policyVersion: 1, testPlanDigest: 'b'.repeat(64), summary: 'Move and add binary', now: new Date().toISOString() })
  expect(revision.renames).toEqual([{ sourcePath: 'old.ts', path: 'moved.ts', hash: old.hash }])
  const evidence = await applyAndVerifyCodingRevision({ workspace, revision, approval: { id: 'move', revisionDigest: revision.digest, objectiveVersion: 1, policyVersion: 1, expiresAt: new Date(Date.now() + 30000).toISOString() }, assertAuthority: async () => {}, verify: async directory => {
    expect(await readFile(path.join(directory, 'remove.txt/new.bin'))).toEqual(Buffer.from([0, 255, 128, 13, 10]))
    return { exitCode: 0, status: 'passed', logId: 'move-test' }
  } })
  expect(evidence.status).toBe('technical_completed')
  expect(await readFile(path.join(delivery, 'moved.ts'))).toEqual(old.bytes)
  await expect(readFile(path.join(delivery, 'old.ts'))).rejects.toMatchObject({ code: 'ENOENT' })
})

it('rejects host paths, noncanonical Unicode and symlink traversal before reading outside the candidate', async () => {
  const { root, workspace } = await fixture()
  for (const name of ['../outside', '.git/config', 'C:\\private', 'e\u0301.txt', '/outside']) expect(() => codingRelativePath(name)).toThrow()
  const outside = path.join(root, 'outside'); await mkdir(outside); await writeFile(path.join(outside, 'private.txt'), 'outside')
  await symlink(outside, path.join(workspace.candidatePath, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
  await expect(workspace.read('linked/private.txt')).rejects.toThrow(/Unsupported/)
  await expect(workspace.capture()).rejects.toThrow()
})

it('recovers completed verification evidence without rolling back or rerunning its delivery', async () => {
  const { workspace, delivery } = await fixture()
  await workspace.write('old.ts', 'export const value = 2\n', (await workspace.read('old.ts')).hash)
  const revision = await workspace.freeze({ sessionId: 's', codingRunId: 'c', objectiveVersion: 1, policyVersion: 1, testPlanDigest: 'b'.repeat(64), summary: 'Fix', now: new Date().toISOString() })
  const evidence = await applyAndVerifyCodingRevision({ workspace, revision, approval: { id: 'completed', revisionDigest: revision.digest, objectiveVersion: 1, policyVersion: 1, expiresAt: new Date(Date.now() + 30000).toISOString() }, assertAuthority: async () => {}, verify: async () => ({ exitCode: 0, status: 'passed', logId: 'test' }) })
  expect(evidence.status).toBe('technical_completed')
  const reopened = await CodingCandidateWorkspace.open(workspace.root)
  expect(await recoverCodingDelivery(reopened)).toEqual({ status: 'clean', evidence: [evidence] })
  expect(await readFile(path.join(delivery, 'old.ts'), 'utf8')).toBe('export const value = 2\n')
  expect(await recoverCodingDelivery(reopened)).toEqual({ status: 'clean', evidence: [evidence] })
})

it('invalidates an exit-zero test that changes source and restores delivery from its durable transaction', async () => {
  const { workspace, delivery } = await fixture()
  await workspace.write('old.ts', 'export const value = 2\n', (await workspace.read('old.ts')).hash)
  const revision = await workspace.freeze({ sessionId: 's', codingRunId: 'c', objectiveVersion: 1, policyVersion: 1, testPlanDigest: 'b'.repeat(64), summary: 'Fix value', now: new Date().toISOString() })
  const result = await applyAndVerifyCodingRevision({ workspace, revision,
    approval: { id: 'approval', revisionDigest: revision.digest, objectiveVersion: 1, policyVersion: 1, expiresAt: new Date(Date.now() + 10000).toISOString() },
    assertAuthority: async () => {},
    verify: async directory => { await writeFile(path.join(directory, 'old.ts'), 'test silently rewrote source'); return { exitCode: 0, status: 'passed', logId: 'test-log' } },
  })
  expect(result.status).toBe('evidence_invalid')
  expect(await readFile(path.join(delivery, 'old.ts'), 'utf8')).toBe('export const value = 1\n')
  expect((await CodingCandidateWorkspace.open(workspace.root)).identity.base.digest).toBe(revision.base.digest)
})


it('materializes and verifies nested candidate paths beyond the Windows legacy path limit', async () => {
  const { root, workspace } = await fixture()
  const parent = path.join(root, 'nested-' + 'a'.repeat(80), 'nested-' + 'b'.repeat(80))
  await mkdir(parent, { recursive: true })
  const destination = path.join(parent, 'verification-' + 'c'.repeat(40))
  expect(path.join(destination, '.git', 'objects').length).toBeGreaterThan(260)
  const manifest = await workspace.capture()
  await workspace.materializeAtomic(manifest, destination)
  expect(await readFile(path.join(destination, 'old.ts'), 'utf8')).toBe('export const value = 1\n')
  await workspace.materializeAtomic(manifest, destination)
})
