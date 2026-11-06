// @vitest-environment node
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { createLocalStore } from './local-store'
import { createNativeCodingSession, mutateNativeCodingSession } from './native-coding-session'
import { backupNativeCodingData, verifyNativeCodingBackup, restoreNativeCodingData } from './native-coding-backup'

it('backs up quiescent SQLite and content together, detects corruption, and never overwrites a live profile', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devflow-backup-')), profile = path.join(root, 'profile'), backup = path.join(root, 'backup')
  await mkdir(profile)
  const db = path.join(profile, 'devflow.sqlite'), store = await createLocalStore({ dbPath: db }), now = new Date().toISOString()
  try {
    await store.upsertProject({ id: 'p', name: 'fixture', path: root, packageManager: 'npm', testCommand: 'node --test', createdAt: now, updatedAt: now })
    const session = createNativeCodingSession({ id: 's', localProjectId: 'p', codingRunId: 'c', workflowRunId: 'r', nodeId: 'n', providerId: 'fake', model: 'fixture', objective: 'Keep evidence', now })
    await store.saveNativeCodingSession(session, 0)
    await expect(backupNativeCodingData(profile, backup)).rejects.toThrow(/暂停|停止/)
    const longMessage = 'preserved raw evidence '.repeat(2000)
    await mutateNativeCodingSession(store, 's', draft => { draft.status = 'paused'; draft.transcript.push({ role: 'user', content: longMessage }) })
    await mkdir(path.join(profile, 'native-coding-harness', 'fixture', 'blobs'), { recursive: true })
    const file = 'native-coding-harness/fixture/blobs/retained'
    await writeFile(path.join(profile, file), 'retained source')
    store.close()
    const manifest = await backupNativeCodingData(profile, backup)
    expect(manifest.files.map(file => file.path)).toContain('devflow.sqlite')
    expect(manifest.files.map(file => file.path)).toContain(file)
    expect(manifest.files.some(file => file.path.startsWith('devflow.sqlite.contents/'))).toBe(true)
    await expect(restoreNativeCodingData(backup, profile)).rejects.toThrow(/存在/)
    await rename(profile, path.join(root, 'saved-original'))
    await restoreNativeCodingData(backup, profile)
    expect(await readFile(path.join(profile, file), 'utf8')).toBe('retained source')
    const restored = await createLocalStore({ dbPath: path.join(profile, 'devflow.sqlite') })
    expect((await restored.getNativeCodingSession('s'))!.transcript.at(-1)!.content).toBe(longMessage)
    restored.close()
    await writeFile(path.join(backup, file), 'corrupted')
    await expect(verifyNativeCodingBackup(backup)).rejects.toThrow(/完整性/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
