import { canonicalFinancialValue, isFinalModelCallSettlement, parseModelCallSettlementReceipt,
  type DesktopModelCostRecovery, type ModelCallAccountingScope, type ModelCallSettlement,
  type StoredModelCallSettlement } from '@ai-devflow/shared'
import type { LocalStore } from './local-store'
import type { RemoteSyncClient } from './remote-sync'

/** A frozen original identity; pairing changes cannot redirect pending financial data. */
export function createDesktopModelCostRecovery(input: {
  store: Pick<LocalStore, 'listModelCallSettlementRecords' | 'saveModelCallSettlement' | 'deleteModelCallSettlement' | 'recordModelCallSettlementReceipt'>
  scope: ModelCallAccountingScope; getScope(): Promise<ModelCallAccountingScope>
  remote: Pick<RemoteSyncClient, 'settleModelCall' | 'getModelCostRecovery'>
}) {
  const sameScope = (scope: ModelCallAccountingScope | undefined) => scope && canonicalFinancialValue(scope) === canonicalFinancialValue(input.scope)
  async function requireScope(projectId: string) {
    if (projectId !== input.scope.localProjectId || !sameScope(await input.getScope())) throw new Error('团队绑定已更新或属于其他项目，请刷新费用记录。')
  }
  async function records(projectId: string) { await requireScope(projectId); return input.store.listModelCallSettlementRecords(projectId) }
  async function settle(settlement: ModelCallSettlement) {
    await requireScope(settlement.projectId)
    const stored = (await records(settlement.projectId)).find(row => row.settlement.id === settlement.id)
    const unsentRelease = settlement.state === 'not_sent' && !settlement.usage && (!stored || !stored.final)
    if (!unsentRelease && (!stored || !stored.final || !sameScope(stored.scope) || stored.receipt || canonicalFinancialValue(stored.settlement) !== canonicalFinancialValue(settlement))) throw new Error('只有原身份已保存的最终用量可以重新同步。')
    const payload = { ...settlement, projectId: input.scope.teamProjectId }
    const receipt = parseModelCallSettlementReceipt(await input.remote.settleModelCall(payload), payload)
    // The frozen client sent to the original account. Retain any conflict in SQLite as well as the server.
    if (receipt.status === 'conflict_recorded') await input.store.recordModelCallSettlementReceipt(settlement.id, receipt)
    else await input.store.deleteModelCallSettlement(settlement.id)
  }
  async function load(projectId: string): Promise<DesktopModelCostRecovery> {
    const rows = await records(projectId)
    const overview = await input.remote.getModelCostRecovery(input.scope.teamProjectId)
    await requireScope(projectId)
    return { overview, local: rows.map(row => ({ id: row.settlement.id,
      state: !row.scope ? 'identity_unverified' : !sameScope(row.scope) ? 'scope_mismatch' : row.receipt ? 'conflict' : !row.final ? 'running' : 'upload_failed',
      canRetry: Boolean(row.final && !row.receipt && (sameScope(row.scope) || (!row.scope && overview.records.some(record =>
        record.sourceKind === 'model_call' && record.sourceId === row.settlement.id && record.originalUserId === input.scope.userId)))),
    })) }
  }
  return {
    load, settle,
    async pending(projectId: string) { return (await records(projectId)).filter(row => row.final && !row.receipt && sameScope(row.scope)).map(row => row.settlement) },
    async retry(projectId: string) {
      const view = await load(projectId)
      const retryable = new Set(view.local.filter(row => row.canRetry).map(row => row.id))
      for (const row of await records(projectId)) {
        if (!retryable.has(row.settlement.id)) continue
        if (!row.scope) await input.store.saveModelCallSettlement(row.settlement, { final: true, scope: input.scope })
        await settle(row.settlement)
      }
      return load(projectId)
    },
  }
}

/** Old failed/no-usage rows cannot prove dispatch ended; retain them for investigation. */
export function storedModelCallSettlement(value: StoredModelCallSettlement | ModelCallSettlement): StoredModelCallSettlement {
  if ('settlement' in value) return value
  return { settlement: value, final: isFinalModelCallSettlement(value) }
}
