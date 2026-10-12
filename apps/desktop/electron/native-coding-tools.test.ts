// @vitest-environment node
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { CodingCandidateWorkspace, codingDigest } from './coding-candidate-workspace'
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

it('lets a task stop its running command while denying another task command and records the real cancelled result', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devflow-tool-command-cancel-')); directories.push(root)
  const delivery = path.join(root, 'delivery'); await mkdir(delivery); await writeFile(path.join(delivery, 'value.txt'), 'before')
  const workspace = await CodingCandidateWorkspace.create({ root: path.join(root, 'private'), delivery, baseCommitSha: 'a'.repeat(40), excludedPaths: [] })
  const store = await createLocalStore({ dbPath: path.join(root, 'local.sqlite') }), now = new Date().toISOString()
  const commands = new CodingCommandRunner(path.join(root, 'commands'))
  try {
    await store.upsertProject({ id: 'project', name: 'test', path: delivery, packageManager: 'npm', testCommand: '', createdAt: now, updatedAt: now })
    const session = createNativeCodingSession({ id: 'session', localProjectId: 'project', codingRunId: 'coding', workflowRunId: 'run', nodeId: 'build', objective: 'Stop my slow command', providerId: 'fake', model: 'test', now })
    await store.saveNativeCodingSession(session, 0)
    const tools = createNativeCodingTools({ store, sessionId: session.id, workspace, commands,
      authority: { scope: { kind: 'local', organizationId: null, projectId: null, userId: 'user', sessionId: 'auth', localProjectId: 'project' }, runVersion: 1, policyVersion: 1, expiresAt: new Date(Date.now() + 60000).toISOString(), allowCandidateEdits: true, commands: [] }, assertAuthority: async () => {}, sources: [], testPlanDigest: 'b'.repeat(64) })
    const plan = { executable: process.execPath, args: ['-e', 'setInterval(()=>{},100)'], timeoutMs: 15000, profile: { kind: 'trusted_local' as const } }
    const owned = await commands.start('session:owned', plan, workspace.candidatePath)
    const other = await commands.start('another-session:owned', plan, workspace.candidatePath)
    const call = (id: string, operationId: string) => tools.execute('cancel_command', { id }, { session, operationId, signal: new AbortController().signal })
    await expect(call(other.id, 'reject-other')).rejects.toThrow('outside this task')
    expect(commands.isActive(other.id)).toBe(true)
    expect(await call(owned.id, 'cancel-owned')).toMatchObject({ id: owned.id, status: 'cancelled' })
    expect(() => process.kill(owned.pid!, 0)).toThrow()
    expect(commands.isActive(other.id)).toBe(true)
    expect((await store.getNativeCodingSession(session.id))!.toolAuthorities.some(record => record.audit.some(event => event.status === 'succeeded'))).toBe(true)
    const pendingReceipt = (id: string) => ({ id: 'cancel-recovery', name: 'cancel_command', input: { id }, inputDigest: codingDigest(JSON.stringify({ id })), objectiveVersion: session.objectiveVersion, effect: 'command' as const, status: 'started' as const })
    expect(await tools.reconcile!(pendingReceipt(owned.id), session)).toMatchObject({ state: 'completed', result: { id: owned.id, status: 'cancelled' } })
    expect(await tools.reconcile!(pendingReceipt(other.id), session)).toEqual({ state: 'not_executed' })
  } finally { await commands.cancelAll(); await store.close() }
})

it('distinguishes an empty file scope from no text matches and exposes the actual search page limit', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devflow-search-scope-')); directories.push(root)
  const delivery = path.join(root, 'delivery'); await mkdir(path.join(delivery, 'src'), { recursive: true })
  await writeFile(path.join(delivery, 'src/example.ts'), Array.from({ length: 45 }, (_, index) => `needle ${index}`).join('\n'))
  await writeFile(path.join(delivery, 'binary.bin'), Buffer.from([0, 1, 2]))
  const workspace = await CodingCandidateWorkspace.create({ root: path.join(root, 'private'), delivery, baseCommitSha: 'a'.repeat(40), excludedPaths: [] })
  const store = await createLocalStore({ dbPath: path.join(root, 'local.sqlite') }), now = new Date().toISOString()
  try {
    await store.upsertProject({ id: 'project', name: 'test', path: delivery, packageManager: 'npm', testCommand: '', createdAt: now, updatedAt: now })
    const session = createNativeCodingSession({ id: 'search-session', localProjectId: 'project', codingRunId: 'coding', workflowRunId: 'run', nodeId: 'build', objective: 'Find source', providerId: 'fake', model: 'test', now })
    await store.saveNativeCodingSession(session, 0)
    const tools = createNativeCodingTools({ store, sessionId: session.id, workspace, commands: new CodingCommandRunner(path.join(root, 'commands')),
      authority: { scope: { kind: 'local', organizationId: null, projectId: null, userId: 'user', sessionId: 'auth', localProjectId: 'project' }, runVersion: 1, policyVersion: 1, expiresAt: new Date(Date.now() + 60000).toISOString(), allowCandidateEdits: true, commands: [] }, assertAuthority: async () => {}, sources: [], testPlanDigest: 'b'.repeat(64) })
    const call = (name: string, input: Record<string, unknown>, operationId: string) => tools.execute(name, input, { session, operationId, signal: new AbortController().signal })
    expect(await call('search_text', { query: 'needle', glob: '*.ts' }, 'root-only')).toMatchObject({ matches: [], matchedFiles: 0, emptyReason: 'no_matching_files', totalMatches: 0 })
    expect(await call('search_text', { query: 'absent', glob: '**/*.ts' }, 'no-text')).toMatchObject({ matches: [], matchedFiles: 1, scannedTextFiles: 1, emptyReason: 'no_text_matches' })
    expect(await call('search_text', { query: 'needle', limit: 200 }, 'first-page')).toMatchObject({ totalMatches: 45, returned: 30, pageSize: 30, matchedFiles: 2, scannedTextFiles: 1, binaryFilesSkipped: 1, nextOffset: 30 })
    expect(await call('search_text', { query: 'needle', offset: 30, limit: 200 }, 'last-page')).toMatchObject({ totalMatches: 45, returned: 15, nextOffset: null })
    expect(await call('glob_files', { pattern: '*.ts' }, 'glob-root')).toMatchObject({ files: [], totalFiles: 0, emptyReason: 'no_matching_files' })
    expect(await call('glob_files', { pattern: '**/*.ts' }, 'glob-recursive')).toMatchObject({ totalFiles: 1, returned: 1, nextOffset: null })
  } finally { await store.close() }
})

it('authorizes a legitimate read when separate clock observations straddle a millisecond', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devflow-tool-clock-')); directories.push(root)
  const delivery = path.join(root, 'delivery'); await mkdir(delivery)
  await writeFile(path.join(delivery, 'value.txt'), 'real content')
  const workspace = await CodingCandidateWorkspace.create({ root: path.join(root, 'private'), delivery, baseCommitSha: 'a'.repeat(40), excludedPaths: [] })
  const store = await createLocalStore({ dbPath: path.join(root, 'local.sqlite') }), instant = Date.now(), now = new Date(instant).toISOString()
  try {
    await store.upsertProject({ id: 'project', name: 'test', path: delivery, packageManager: 'npm', testCommand: '', createdAt: now, updatedAt: now })
    const session = createNativeCodingSession({ id: 'clock-session', localProjectId: 'project', codingRunId: 'coding', workflowRunId: 'run', nodeId: 'build', objective: 'Read file', providerId: 'deepseek', model: 'deepseek-flash', now })
    await store.saveNativeCodingSession(session, 0)
    const tools = createNativeCodingTools({ store, sessionId: session.id, workspace, commands: new CodingCommandRunner(path.join(root, 'commands')),
      authority: { scope: { kind: 'local', organizationId: null, projectId: null, userId: 'user', sessionId: 'auth-session', localProjectId: 'project' }, runVersion: 1, policyVersion: 1, expiresAt: new Date(instant + 3600000).toISOString(), allowCandidateEdits: true, commands: [] },
      assertAuthority: async () => {}, sources: [], testPlanDigest: 'b'.repeat(64) })
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(instant)
    // Reproduce a clock tick between new Date() and Date.now(), without sleeps
    // or changing real filesystem scheduling.
    vi.spyOn(Date, 'now').mockReturnValue(instant + 1)
    expect(await tools.execute('read_file', { path: 'value.txt' }, { session, operationId: 'clock-read', signal: new AbortController().signal })).toMatchObject({ content: 'real content' })
    const runtime = (await store.getNativeCodingSession(session.id))!.toolAuthorities[0]!.runtime
    expect(Date.parse(runtime.deadline) - Date.parse(runtime.requestedAt)).toBe(runtime.bounds.maxWallTimeMs)
  } finally { vi.restoreAllMocks(); vi.useRealTimers(); await store.close() }
})
