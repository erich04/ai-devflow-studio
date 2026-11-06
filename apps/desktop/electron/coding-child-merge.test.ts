// @vitest-environment node
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { CodingCandidateWorkspace } from './coding-candidate-workspace'
import { mergeCodingChild } from './coding-child-merge'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'coding-merge-')); roots.push(root)
  const delivery = path.join(root, 'delivery'); await mkdir(delivery)
  await writeFile(path.join(delivery, 'main.txt'), 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\n')
  const parent = await CodingCandidateWorkspace.create({ root: path.join(root, 'parent'), delivery, baseCommitSha: 'a'.repeat(40), excludedPaths: [] })
  const child = await CodingCandidateWorkspace.create({ root: path.join(root, 'child'), delivery: parent.candidatePath, baseCommitSha: 'a'.repeat(40), excludedPaths: [] })
  const change = async (workspace: CodingCandidateWorkspace, from: string, to: string) => { const file = await workspace.read('main.txt'); await workspace.write('main.txt', file.bytes.toString().replace(from, to), file.hash) }
  const freeze = () => child.freeze({ sessionId: 'child', codingRunId: 'child', objectiveVersion: 1, policyVersion: 1, testPlanDigest: 'b'.repeat(64), summary: 'Child change', now: new Date().toISOString() })
  return { parent, child, change, freeze }
}
it('merges against current parent bytes and does not reapply the child after subsequent parent edits', async () => {
  const { parent, child, change, freeze } = await fixture()
  await change(child, 'nine', 'NINE'); const revision = await freeze()
  await change(parent, 'one', 'ONE')
  const input = { parent, child, revision, expectedParentRevision: (await parent.inspect()).digest, objectiveVersion: 1, assertWriter: async () => {} }
  expect(await mergeCodingChild(input)).toMatchObject({ childChangeSetId: revision.id, changedPaths: ['main.txt'] })
  expect((await parent.read('main.txt')).bytes.toString()).toContain('ONE\ntwo')
  expect((await parent.read('main.txt')).bytes.toString()).toContain('NINE')
  await change(parent, 'NINE', 'parent-after-merge')
  await mergeCodingChild({ ...input, expectedParentRevision: (await parent.inspect()).digest })
  expect((await parent.read('main.txt')).bytes.toString()).toContain('parent-after-merge')
})
it('returns a conflict without changing parent files', async () => {
  const { parent, child, change, freeze } = await fixture()
  await change(child, 'one', 'CHILD'); await change(parent, 'one', 'PARENT')
  const revision = await freeze(), before = await parent.inspect()
  expect(await mergeCodingChild({ parent, child, revision, expectedParentRevision: before.digest, objectiveVersion: 1, assertWriter: async () => {} })).toMatchObject({ merged: false, conflicts: ['main.txt'] })
  expect((await parent.inspect()).digest).toBe(before.digest)
})
it('finishes a journal after interruption between file writes without applying the first file again', async () => {
  const { parent, child, freeze } = await fixture()
  await child.write('a.txt', 'A', null); await child.write('b.txt', 'B', null)
  const revision = await freeze(), before = await parent.inspect()
  let checks = 0
  const input = { parent, child, revision, expectedParentRevision: before.digest, objectiveVersion: 1, assertWriter: async () => { if (++checks === 3) throw new Error('simulated stop') } }
  await expect(mergeCodingChild(input)).rejects.toThrow('simulated stop')
  expect((await parent.read('a.txt')).bytes.toString()).toBe('A')
  expect(await mergeCodingChild({ ...input, assertWriter: async () => {} })).toMatchObject({ childChangeSetId: revision.id })
  expect((await parent.read('b.txt')).bytes.toString()).toBe('B')
})
