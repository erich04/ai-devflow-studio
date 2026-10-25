// @vitest-environment node
import { mkdtemp, mkdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, expect, it } from 'vitest'
import { createLocalStore, type LocalStore } from './local-store'
import type { HindsightConfigurationInput, HindsightSourceInput } from './hindsight-store'

const roots: string[] = []; const stores: LocalStore[] = []
afterEach(async () => {
  stores.splice(0).forEach((s) => s.close())
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })))
})
export const configuration: HindsightConfigurationInput = {
  projectId: 'hindsight-project', ownerUserId: 'user-1', projectPath: '/test/repo', knowledgeRoot: 'docs/knowledge',
  rootGeneration: 'root-1', endpoint: 'http://127.0.0.1:8888', encryptedApiKey: null,
  enabled: true, includeMemories: true, selectedPaths: ['docs/knowledge/rule.md'],
  model: { version: 'v1', dimensions: [{ key: 'sem_kind', type: 'text' }] }, modelDigest: 'model-v1',
}
const now = '2026-10-20T00:00:00.000Z'
const source: HindsightSourceInput = { kind: 'knowledge', sourceId: 'source-1', sourceKey: 'knowledge:rule',
  sourceRevision: 'sha256:abc', contentDigest: 'sha256:abc', sourcePath: 'docs/knowledge/rule.md', payload: 'Refund rule' }

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hindsight-store-')); roots.push(root)
  const dbPath = path.join(root, 'store.db')
  const store = await createLocalStore({ dbPath }); stores.push(store)
  await store.upsertProject({ id: configuration.projectId, name: 'Hindsight', path: configuration.projectPath, packageManager: 'npm', testCommand: '', createdAt: now, updatedAt: now })
  return { root, dbPath, store }
}

it('persists a single operation across restart and makes revocation win over a late retain receipt', async () => {
  const { dbPath, store } = await fixture()
  const config = await store.configureHindsight(configuration)
  await store.reconcileHindsightSource(config.generation, source)
  const claim = await store.claimHindsightProjection(now)
  expect(claim?.record.attempts).toBe(1)
  store.close(); stores.splice(stores.indexOf(store), 1)
  const reopened = await createLocalStore({ dbPath }); stores.push(reopened)
  await reopened.recoverHindsightProjections()
  const replay = await reopened.claimHindsightProjection('2026-10-20T00:01:00.000Z')
  expect(replay?.record.operationId).toBe(claim?.record.operationId)
  await reopened.revokeHindsightSource(config.generation, source.sourceKey, 'deselected')
  await reopened.settleHindsightProjection(replay!.record.id, replay!.leaseToken, 'ready', now)
  const rows = await reopened.listHindsightProjections(configuration.projectId)
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ revoked: true, status: 'cleanup_pending', payload: '' })
})

it('rolls configuration and its cleanup outbox back together on a failed disk write', async () => {
  const { dbPath, store } = await fixture()
  const config = await store.configureHindsight(configuration)
  await store.reconcileHindsightSource(config.generation, source)
  await store.claimHindsightProjection(now)
  await rename(dbPath, `${dbPath}.saved`)
  await mkdir(dbPath)
  await expect(store.configureHindsight({ ...configuration, enabled: false })).rejects.toThrow()
  expect((await store.getHindsightConfiguration(configuration.projectId))?.generation).toBe(config.generation)
  expect((await store.listHindsightProjections(configuration.projectId))[0]?.revoked).toBe(false)
})

it('disables only affected projects on pairing/rebinding and never silently re-enables an unpaired project', async () => {
  const { store } = await fixture()
  const config = await store.configureHindsight(configuration)
  await store.reconcileHindsightSource(config.generation, source)
  await store.claimHindsightProjection(now)
  const credential = { tokenId: 'token-1', organizationId: 'org-1', projectId: 'team-1',
    localProjectId: 'unrelated', userId: 'user-1', role: 'member' as const, authAccountId: 'account-1',
    projectMemberships: [], createdAt: now }
  await store.saveDesktopPairingCredential(credential, 'fixture-encrypted-token')
  expect((await store.getHindsightConfiguration(configuration.projectId))?.enabled).toBe(true)
  await store.saveDesktopPairingCredential({ ...credential, localProjectId: configuration.projectId }, 'fixture-encrypted-token')
  expect((await store.getHindsightConfiguration(configuration.projectId))?.enabled).toBe(false)
  expect((await store.listHindsightProjections(configuration.projectId))[0]).toMatchObject({ status: 'cleanup_pending', revoked: true })
  await expect(store.configureHindsight(configuration)).rejects.toThrow('unpaired')
  await store.saveDesktopPairingCredential(credential, 'rotated-fixture-token')
  expect((await store.getHindsightConfiguration(configuration.projectId))?.enabled).toBe(false)
  const next = await store.configureHindsight(configuration)
  await store.reconcileHindsightSource(next.generation, source)
  const pending = await store.claimHindsightProjection('2026-10-20T00:02:00.000Z')
  expect(pending?.record.configGeneration).toBe(config.generation)
})
