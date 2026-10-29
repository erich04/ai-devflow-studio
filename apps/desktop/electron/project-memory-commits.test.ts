// @vitest-environment node
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { createLocalStore, type LocalStore } from './local-store'
import {
  buildCommitMemoryDocuments, captureCommitProjectMemory, COMMIT_MEMORY_SETTLE_MS, parseCommitLog, readRecentCommits, type CommitRecord,
} from './project-memory-commits'

const exec = promisify(execFile)
const directories: string[] = []
const stores: LocalStore[] = []
afterEach(async () => {
  stores.splice(0).forEach((store) => store.close())
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})
async function directory(prefix: string) {
  const created = await mkdtemp(path.join(os.tmpdir(), prefix)); directories.push(created)
  return created
}
const git = (cwd: string, ...args: string[]) => exec('git', ['-C', cwd, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
  '-c', 'commit.gpgsign=false', ...args], { env: { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' } })
const sha = (seed: string) => seed.repeat(40).slice(0, 40)
const commit = (seed: string, committedAt: string, subject: string, body = ''): CommitRecord => ({ sha: sha(seed), committedAt, subject, body })

describe('commit history as project memory (ADR 0030)', () => {
  it('reads non-merge commits of HEAD with their messages and nothing else', async () => {
    const repository = await directory('devflow-commits-')
    await git(repository, 'init', '-q', '-b', 'main')
    await writeFile(path.join(repository, 'a.txt'), 'a')
    await git(repository, 'add', '.'); await git(repository, 'commit', '-q', '-m', 'feat: 删除前二次确认', '-m', '因为误删投诉太多。')
    await git(repository, 'checkout', '-q', '-b', 'side')
    await writeFile(path.join(repository, 'b.txt'), 'b')
    await git(repository, 'add', '.'); await git(repository, 'commit', '-q', '-m', 'fix: 撤销窗口改为 5 秒')
    await git(repository, 'checkout', '-q', 'main')
    await writeFile(path.join(repository, 'c.txt'), 'c')
    await git(repository, 'add', '.'); await git(repository, 'commit', '-q', '-m', 'docs: 说明')
    await git(repository, 'merge', '-q', '--no-ff', 'side', '-m', 'Merge branch side')
    const commits = await readRecentCommits(repository, '30.days.ago')
    expect(commits.map((item) => item.subject).sort()).toEqual(['docs: 说明', 'feat: 删除前二次确认', 'fix: 撤销窗口改为 5 秒'].sort())
    expect(commits.find((item) => item.subject.startsWith('feat'))).toMatchObject({ body: '因为误删投诉太多。', sha: expect.stringMatching(/^[0-9a-f]{40}$/u) })
    expect(await readRecentCommits(await directory('devflow-not-git-'), '30.days.ago')).toEqual([])
  })

  it('parses only well-formed records', () => {
    const good = `${sha('a')}\u001f2026-10-28T10:00:00+08:00\u001ffeat: x\u001fbody\u001e`
    expect(parseCommitLog(`${good}\nnot-a-sha\u001f2026-10-28\u001fy\u001f\u001e${sha('b')}\u001fnot a date\u001fz\u001f\u001e`))
      .toEqual([{ sha: sha('a'), committedAt: '2026-10-28T10:00:00+08:00', subject: 'feat: x', body: 'body' }])
  })

  it('makes one document per day, newest first, and lets today settle before it is sent', () => {
    const now = '2026-10-28T12:00:00.000Z'
    const documents = buildCommitMemoryDocuments([
      commit('a', '2026-10-28T11:50:00.000Z', 'fix: 撤销窗口改为 5 秒'),
      commit('b', '2026-10-28T09:00:00.000Z', 'feat: 删除前二次确认', '因为误删投诉太多。\n第二行'),
      commit('c', '2026-10-27T18:00:00.000Z', 'docs: 说明'),
    ], now)
    expect(documents.map((item) => item.documentId)).toEqual(['commits:2026-10-28', 'commits:2026-10-27'])
    const today = documents[0]!
    expect(today).toMatchObject({ sourceKind: 'commit', sourceId: '2026-10-28', title: '提交记录 2026-10-28', tags: ['source:commit'],
      occurredAt: '2026-10-28T11:50:00.000Z', notBefore: new Date(Date.parse('2026-10-28T11:50:00.000Z') + COMMIT_MEMORY_SETTLE_MS).toISOString() })
    expect(today.payload.split('\n').slice(1)).toEqual([
      `- ${sha('a').slice(0, 10)} 2026-10-28T11:50:00.000Z: fix: 撤销窗口改为 5 秒`,
      `- ${sha('b').slice(0, 10)} 2026-10-28T09:00:00.000Z: feat: 删除前二次确认`, '  因为误删投诉太多。', '  第二行',
    ])
    expect(documents[1]!.notBefore).toBe(now)
    const many = Array.from({ length: 80 }, (_, index) => commit('d', `2026-10-20T${String(Math.floor(index / 4)).padStart(2, '0')}:${String(index % 4 * 10).padStart(2, '0')}:00.000Z`,
      `change ${index}`, '很长的说明'.repeat(200)))
    const [bounded] = buildCommitMemoryDocuments(many, now)
    expect(Buffer.byteLength(bounded!.payload)).toBeLessThanOrEqual(48 * 1024)
    expect(bounded!.payload).toContain('change 79')
    expect(bounded!.payload).toMatch(/- \[\d+ earlier commits omitted\]$/u)
  })

  it('records history only while memory is on, never resends an unchanged day and keeps a forgotten day forgotten', async () => {
    const store = await createLocalStore({ dbPath: path.join(await directory('devflow-commits-store-'), 'db.sqlite') }); stores.push(store)
    const now = '2026-10-28T12:00:00.000Z'
    await store.upsertProject({ id: 'project', name: 'Synthetic', path: '/repository', packageManager: 'pnpm', testCommand: 'pnpm test', createdAt: now, updatedAt: now })
    const history = [commit('a', '2026-10-27T18:00:00.000Z', 'docs: 说明'), commit('b', '2026-10-26T09:00:00.000Z', 'feat: 删除前二次确认')]
    const reads: string[] = []
    const read = async (repository: string, since: string) => { reads.push(`${repository} ${since}`); return history }
    await captureCommitProjectMemory(store, { id: 'project', path: '/repository' }, now, read)
    expect(reads).toEqual([])
    const owner = await store.resolveLocalProjectMemoryPrincipal('project')
    if (owner.status !== 'resolved') throw new Error('No principal')
    await store.configureProjectMemory({ projectId: 'project', ownerUserId: owner.userId, enabled: true, endpoint: 'http://127.0.0.1:8890',
      encryptedApiKey: null, providerId: 'deepseek' })
    await captureCommitProjectMemory(store, { id: 'project', path: '/repository' }, now, read)
    expect(reads).toEqual(['/repository 2026-09-28T12:00:00.000Z'])
    const first = await store.listProjectMemoryDocuments('project')
    expect(first.map((item) => [item.documentId, item.sourceKind, item.status])).toEqual([
      ['commits:2026-10-27', 'commit', 'queued'], ['commits:2026-10-26', 'commit', 'queued']])
    await captureCommitProjectMemory(store, { id: 'project', path: '/repository' }, now, read)
    expect((await store.listProjectMemoryDocuments('project')).map((item) => item.operationId)).toEqual(first.map((item) => item.operationId))
    await store.forgetProjectMemoryDocument('project', first[0]!.id)
    history.unshift(commit('c', '2026-10-27T19:00:00.000Z', 'fix: 撤销窗口改为 5 秒'))
    await captureCommitProjectMemory(store, { id: 'project', path: '/repository' }, now, read)
    expect((await store.listProjectMemoryDocuments('project'))[0]).toMatchObject({ documentId: 'commits:2026-10-27', status: 'delete_pending', payload: '' })
  })
})
