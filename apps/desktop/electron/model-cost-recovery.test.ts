import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { modelCostRecoveryOverview, type ModelCallAccountingScope, type ModelCallSettlement, type ModelCallSettlementReceipt } from '@ai-devflow/shared'
import { createLocalStore } from './local-store'
import { createDesktopModelCostRecovery } from './model-cost-recovery'

const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))) })
async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'opencode-cost-recovery-')); dirs.push(dir)
  const store = await createLocalStore({ dbPath: path.join(dir, 'fixture.sqlite') })
  const scope: ModelCallAccountingScope = { organizationId: 'org', userId: 'caller', localProjectId: 'local', teamProjectId: 'team' }
  const settle = vi.fn(async (input: ModelCallSettlement): Promise<ModelCallSettlementReceipt> => ({ status: 'settled', id: input.id, projectId: input.projectId }))
  const getScope = vi.fn(async () => scope)
  const overview = modelCostRecoveryOverview([], [], [], 'team', '2026-10-04T12:00:00Z')
  const recovery = createDesktopModelCostRecovery({ store, scope, getScope, remote: { settleModelCall: settle, getModelCostRecovery: async () => overview } })
  return { store, scope, settle, getScope, recovery, overview, dir }
}
const settlement = (id: string): ModelCallSettlement => ({ id, projectId: 'local', state: 'completed', usage: { inputTokens: 10, outputTokens: 2 } })
describe('desktop final settlement recovery', () => {
  it('never retransmits a provisional marker or another identity, but uploads final results only once', async () => {
    const f = await fixture()
    try {
      await f.store.saveModelCallSettlement(settlement('active'), { final: false, scope: f.scope })
      await f.store.saveModelCallSettlement(settlement('ready'), { final: true, scope: f.scope })
      await f.store.saveModelCallSettlement(settlement('other'), { final: true, scope: { ...f.scope, userId: 'other' } })
      expect((await f.recovery.pending('local')).map(row => row.id)).toEqual(['ready'])
      await f.recovery.retry('local'); await f.recovery.retry('local')
      expect(f.settle).toHaveBeenCalledTimes(1)
      expect(f.settle).toHaveBeenCalledWith({ ...settlement('ready'), projectId: 'team' })
      expect((await f.recovery.load('local')).local).toEqual(expect.arrayContaining([
        { id: 'active', state: 'running', canRetry: false }, { id: 'other', state: 'scope_mismatch', canRetry: false }]))
    } finally { await f.store.close() }
  })

  it('retains full final usage and durable conflict receipts after SQLite reopen and stops automatic retry', async () => {
    const f = await fixture()
    f.settle.mockImplementation(async input => ({ status: 'conflict_recorded', id: input.id, projectId: input.projectId, conflictId: 'conflict-1' }))
    await f.store.saveModelCallSettlement(settlement('late'), { final: true, scope: f.scope })
    await f.recovery.retry('local')
    expect(await f.recovery.pending('local')).toEqual([])
    await f.store.close()
    const reopened = await createLocalStore({ dbPath: path.join(f.dir, 'fixture.sqlite') })
    try { expect(await reopened.listModelCallSettlementRecords('local')).toMatchObject([{ settlement: settlement('late'), receipt: { status: 'conflict_recorded', conflictId: 'conflict-1' } }]) }
    finally { await reopened.close() }
  })

  it('retains records for malformed acknowledgements and rejects a changed pairing before upload', async () => {
    const f = await fixture()
    try {
      await f.store.saveModelCallSettlement(settlement('ready'), { final: true, scope: f.scope })
      f.settle.mockResolvedValue({ accepted: true } as unknown as ModelCallSettlementReceipt)
      await expect(f.recovery.retry('local')).rejects.toThrow('回执')
      expect(await f.store.listModelCallSettlementRecords('local')).toHaveLength(1)
      f.getScope.mockResolvedValue({ ...f.scope, organizationId: 'another' })
      await expect(f.recovery.retry('local')).rejects.toThrow('绑定')
      expect(f.settle).toHaveBeenCalledTimes(1)
    } finally { await f.store.close() }
  })

  it('requires server identity evidence for unscoped legacy finals and never retries an ambiguous old marker', async () => {
    const f = await fixture()
    try {
      await f.store.saveModelCallSettlement(settlement('old-final'))
      await f.store.saveModelCallSettlement({ id: 'old-marker', projectId: 'local', state: 'failed' })
      expect(await f.recovery.pending('local')).toEqual([])
      await f.recovery.retry('local')
      expect(f.settle).not.toHaveBeenCalled()
      f.overview.records = modelCostRecoveryOverview([], [{ id: 'old-final', projectId: 'team', userId: 'other', providerId: 'provider', model: 'model', createdAt: f.overview.asOf,
        inputTokens: 10, maxOutputTokens: 10, billingProvider: 'openai_compatible', state: 'reserved', projectedCostUsd: null, costUsd: null }], [], 'team', f.overview.asOf).records
      await f.recovery.retry('local')
      expect(f.settle).not.toHaveBeenCalled()
      f.overview.records[0]!.originalUserId = 'caller'
      await f.recovery.retry('local')
      expect(f.settle).toHaveBeenCalledTimes(1)
      expect((await f.store.listModelCallSettlementRecords('local')).map(row => row.settlement.id)).toEqual(['old-marker'])
    } finally { await f.store.close() }
  })

  it('persists a final record before acknowledging save and removes it on a verified confirmation', async () => {
    const f = await fixture()
    try {
      await f.store.saveModelCallSettlement(settlement('confirmed'), { final: true, scope: f.scope })
      const diskReader = await createLocalStore({ dbPath: path.join(f.dir, 'fixture.sqlite') })
      try { expect(await diskReader.listModelCallSettlementRecords('local')).toMatchObject([{ settlement: settlement('confirmed'), final: true, scope: f.scope }]) }
      finally { await diskReader.close() }
      f.settle.mockImplementation(async input => ({ status: 'confirmed', id: input.id, projectId: input.projectId, confirmationId: 'confirmation-1' }))
      await f.recovery.retry('local')
      expect(await f.store.listModelCallSettlementRecords('local')).toEqual([])
    } finally { await f.store.close() }
  })
})
