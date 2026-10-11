// @vitest-environment node
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { CodingCandidateWorkspace } from './coding-candidate-workspace'
import { createNativeCodingTools } from './native-coding-tools'
import { CodingCommandRunner } from './coding-command-runner'
import { createLocalStore } from './local-store'
import { createNativeCodingSession } from './native-coding-session'

const directories: string[] = []
it('pages beyond the initial files and applies a digest-bound edit through the existing native tool authority', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devflow-tools-')); directories.push(root)
  const delivery = path.join(root, 'delivery'); await mkdir(delivery)
  for (let index = 0; index < 15; index++) await writeFile(path.join(delivery, `${index.toString().padStart(2, '0')}.txt`), `value ${index}`)
  const workspace = await CodingCandidateWorkspace.create({ root: path.join(root, 'private'), delivery, baseCommitSha: 'a'.repeat(40), excludedPaths: [] })
  const store = await createLocalStore({ dbPath: path.join(root, 'local.sqlite') }), now = new Date().toISOString()
  await store.upsertProject({ id: 'project', name: 'test', path: delivery, packageManager: 'npm', testCommand: 'npm test', createdAt: now, updatedAt: now })
  const session = createNativeCodingSession({ id: 'session', localProjectId: 'project', codingRunId: 'coding', workflowRunId: 'run', nodeId: 'build', objective: 'Edit late file', providerId: 'deepseek', model: 'deepseek-flash', now })
  await store.saveNativeCodingSession(session, 0)
  const tools = createNativeCodingTools({ store, sessionId: session.id, workspace, commands: new CodingCommandRunner(path.join(root, 'commands')),
    authority: { scope: { kind: 'local', organizationId: null, projectId: null, userId: 'user', sessionId: 'auth-session', localProjectId: 'project' }, runVersion: 1, policyVersion: 1, expiresAt: new Date(Date.now() + 60_000).toISOString(), allowCandidateEdits: true, commands: [] },
    assertAuthority: async () => {}, sources: [], testPlanDigest: 'b'.repeat(64) })
  const context = (operationId: string) => ({ session, operationId, signal: new AbortController().signal })
  const page = await tools.execute('glob_files', { pattern: '*.txt', offset: 10, limit: 5 }, context('list')) as { files: Array<{ path: string }> }
  expect(page.files.map(file => file.path)).toEqual(['10.txt', '11.txt', '12.txt', '13.txt', '14.txt'])
  const file = await tools.execute('read_file', { path: '14.txt' }, context('read')) as { hash: string }
  await tools.execute('write_file', { path: '14.txt', content: 'updated', expectedHash: file.hash }, context('write'))
  await expect(tools.execute('write_file', { path: '14.txt', content: 'stale', expectedHash: file.hash }, context('stale'))).rejects.toThrow()
  expect((await workspace.read('14.txt')).bytes.toString()).toBe('updated')
  expect((await store.getNativeCodingSession(session.id))!.toolAuthorities.some(record => record.audit.some(event => event.status === 'succeeded'))).toBe(true)
  await store.close()
})
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))) })
