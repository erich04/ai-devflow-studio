// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import initSqlJs from 'sql.js'
import { expect, it } from 'vitest'
import { createWorkflowRunFromRequest } from '@ai-devflow/shared'
import { createLocalStore, getLocalStoreRevision } from './local-store'

it('keeps the shipped WASM stack stable across a million successful, empty and failing queries', async () => {
  const require = createRequire(import.meta.url)
  const directory = path.dirname(require.resolve('sql.js/dist/sql-wasm.js'))
  const sql = await initSqlJs({ locateFile: (name) => path.join(directory, name) })
  // These are actual exported Emscripten functions, omitted by @types/sql.js.
  const stack = (sql as typeof sql & { stackSave(): number }).stackSave
  const db = new sql.Database()
  const before = stack()
  try {
    for (let index = 0; index < 1_000_000; index++) {
      if (index % 100 === 0) {
        try { db.exec('select * from missing_table') } catch { /* expected SQL error */ }
      } else if (index % 10 === 0) db.exec('select 1 where 0; -- empty result')
      else db.exec('select 1; select $value', { $value: index })
      if (index % 10_000 === 0) expect(stack()).toBe(before)
    }
    expect(stack()).toBe(before)
    expect(db.exec('select 42')[0]?.values).toEqual([[42]])
  } finally { db.close() }
}, 120_000)

it('preserves a real workflow through a million LocalStore reads and a durable reopen', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devflow-store-soak-'))
  const dbPath = path.join(root, 'devflow.sqlite')
  let store = await createLocalStore({ dbPath })
  const now = '2026-09-26T00:00:00.000Z'
  const { run } = createWorkflowRunFromRequest({ runId: 'soak', title: '查询耐久验证', request: '保持当前进度',
    projectId: 'soak-project', creatorId: 'soak-user', branchName: 'devflow/soak', now })
  try {
    await store.upsertProject({ id: run.projectId, name: '耐久验证', path: root, packageManager: 'npm', testCommand: 'npm test', createdAt: now, updatedAt: now })
    await store.saveRun(run)
    const before = getLocalStoreRevision(store)
    for (let index = 0; index < 1_000_000; index++) {
      const observed = await store.getRun(run.id)
      if (index % 10_000 === 0) expect(observed).toEqual(run)
    }
    expect(getLocalStoreRevision(store)).toBe(before)
    await store.saveSettings({ themePreference: 'dark' })
    expect(getLocalStoreRevision(store)).toBeGreaterThan(before!)
    store.close()
    store = await createLocalStore({ dbPath })
    expect(await store.getRun(run.id)).toEqual(run)
    expect((await store.getSettings()).themePreference).toBe('dark')
  } finally { store.close(); await rm(root, { recursive: true, force: true }) }
}, 180_000)
