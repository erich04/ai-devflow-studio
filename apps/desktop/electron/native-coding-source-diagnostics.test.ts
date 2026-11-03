// @vitest-environment node
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { CodingCandidateWorkspace, codingDigest } from './coding-candidate-workspace'
import { CodingCommandRunner } from './coding-command-runner'
import { createLocalStore } from './local-store'
import { createNativeCodingSession } from './native-coding-session'
import { createNativeCodingTools } from './native-coding-tools'
import { codingSourceDiagnostics } from './coding-source-diagnostics'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

it('reports a real candidate syntax error immediately after writing and preserves the same feedback on recovery', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devflow-source-feedback-')); roots.push(root)
  const delivery = path.join(root, 'delivery'); await mkdir(delivery)
  const original = 'export function unixTimestampMilliseconds() { return Date.now() }\n'
  await writeFile(path.join(delivery, 'clock.ts'), original)
  const workspace = await CodingCandidateWorkspace.create({ root: path.join(root, 'private'), delivery, baseCommitSha: 'a'.repeat(40), excludedPaths: [] })
  const store = await createLocalStore({ dbPath: path.join(root, 'store.sqlite') }), now = new Date().toISOString()
  const commands = new CodingCommandRunner(path.join(root, 'commands')), start = vi.spyOn(commands, 'start')
  try {
    await store.upsertProject({ id: 'project', name: 'test', path: delivery, packageManager: 'npm', testCommand: '', createdAt: now, updatedAt: now })
    const session = createNativeCodingSession({ id: 'syntax-session', localProjectId: 'project', codingRunId: 'coding', workflowRunId: 'run', nodeId: 'build', objective: 'Edit clock', providerId: 'fake', model: 'test', now })
    session.status = 'running'; await store.saveNativeCodingSession(session, 0)
    const tools = createNativeCodingTools({ store, sessionId: session.id, workspace, commands,
      authority: { scope: { kind: 'local', organizationId: null, projectId: null, userId: 'user', sessionId: 'auth', localProjectId: 'project' }, runVersion: 1, policyVersion: 1, expiresAt: new Date(Date.now() + 60000).toISOString(), allowCandidateEdits: true, commands: [] }, assertAuthority: async () => {}, sources: [], testPlanDigest: 'b'.repeat(64) })
    const input = { path: 'clock.ts', expectedHash: codingDigest(original), before: 'unixTimestampMilliseconds', after: 'unixTimestamp Millisecond' }, operationId = 'break-clock'
    const result = await tools.execute('apply_patch', input, { session, operationId, signal: new AbortController().signal })
    const written = await workspace.read('clock.ts')
    expect(written.bytes.toString()).toContain('unixTimestamp Millisecond')
    expect(result).toMatchObject({ sourceDiagnostics: [{ path: 'clock.ts', hash: written.hash, status: 'syntax_error', scope: 'syntax_only', diagnostics: expect.arrayContaining([expect.objectContaining({ line: 1, column: expect.any(Number), code: expect.any(Number) })]) }] })
    const recovered = await tools.reconcile!({ id: operationId, name: 'apply_patch', input, inputDigest: codingDigest(JSON.stringify(input)), objectiveVersion: session.objectiveVersion, effect: 'write', status: 'started' }, (await store.getNativeCodingSession(session.id))!)
    expect(recovered).toEqual({ state: 'completed', result })
    const repaired = await tools.execute('apply_patch', { path: 'clock.ts', expectedHash: written.hash, before: 'unixTimestamp Millisecond', after: 'unixTimestampMilliseconds' }, { session, operationId: 'repair-clock', signal: new AbortController().signal })
    expect(repaired).toMatchObject({ sourceDiagnostics: [{ path: 'clock.ts', hash: codingDigest(original), status: 'no_syntax_errors', diagnostics: [] }] })

    const marker = path.join(root, 'must-not-execute')
    const content = `import { writeFileSync } from 'node:fs'; import value from './missing-dependency'; writeFileSync(${JSON.stringify(marker)}, 'bad'); const x: MissingType = value; export const View = () => <div>{x}</div>;`
    const valid = await tools.execute('write_file', { path: 'view.tsx', expectedHash: '', content }, { session, operationId: 'write-view', signal: new AbortController().signal })
    expect(valid).toMatchObject({ sourceDiagnostics: [{ path: 'view.tsx', status: 'no_syntax_errors', scope: 'syntax_only', diagnostics: [] }] })
    await expect(access(marker)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(start).not.toHaveBeenCalled()
    expect((await workspace.blob(workspace.identity.base.files.find(file => file.path === 'clock.ts')!.hash)).toString()).toBe(original)
  } finally { start.mockRestore(); await store.close() }
})

it('returns bounded source locations without parser snippets or pretending unsupported bytes were checked', () => {
  const source = 'const API_TOKEN = "fixture-private-value";\nexport function broken name() {}'
  const result = codingSourceDiagnostics('secret.ts', Buffer.from(source), codingDigest(source))
  expect(result).toMatchObject({ status: 'syntax_error', diagnostics: expect.arrayContaining([expect.objectContaining({ line: 2 })]) })
  expect(JSON.stringify(result)).not.toContain('fixture-private-value')
  expect(JSON.stringify(result)).not.toContain('broken name')
  expect(codingSourceDiagnostics('blob.ts', Buffer.from([0, 255]), 'a'.repeat(64))).toMatchObject({ status: 'not_checked', reason: 'binary_or_non_utf8' })
  expect(codingSourceDiagnostics('large.ts', Buffer.alloc(1024 * 1024 + 1, ' '), 'b'.repeat(64))).toMatchObject({ status: 'not_checked', reason: 'size_limit' })
  expect(codingSourceDiagnostics('other.py', Buffer.from('not Python'), 'c'.repeat(64))).toBeUndefined()
})
