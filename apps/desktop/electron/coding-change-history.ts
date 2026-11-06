import { buildChangeSetDiffView, markNewRows, redactSensitiveText, type ChangeFileTexts } from '@ai-devflow/shared'
import type { LocalStore } from './local-store.js'
import type { CodingChangeHistory, CodingChangeSetRecord } from './build-test-contract.js'
import { verifyCodingChangeSetDisplay } from './coding-change-set.js'

type Store = Pick<LocalStore, 'getRun' | 'listCodingAgentRuns' | 'listCodingPermissionRequests' | 'listCodingChangeSets' | 'listCodingChangeReviews'>
/** Keep cache ownership with the store/profile. Never cache failures or trust renderer text. */
export function createCodingChangeHistoryReader(store: Store, now = () => new Date().toISOString()) {
  const cache = new Map<string, CodingChangeSetRecord>()
  return async ({ runId }: { runId: string }): Promise<CodingChangeHistory> => {
    const workflow = await store.getRun(runId)
    if (!workflow) throw new Error('[change_history_unavailable] 找不到这次任务。')
    const runs = (await store.listCodingAgentRuns(runId)).filter(r => r.projectId === workflow.projectId)
    const records: CodingChangeSetRecord[] = [], reviews: CodingChangeHistory['reviews'] = []
    for (const run of runs) {
      const requests = await store.listCodingPermissionRequests(run.id)
      const changes = (await store.listCodingChangeSets(run.id)).filter(c => c.projectId === workflow.projectId && requests.some(r => r.changeSetId === c.id && r.changeSetDigest === c.changeSetDigest))
      const texts = new Map<string, ChangeFileTexts[]>()
      for (const change of changes) {
        try { texts.set(change.id, verifyCodingChangeSetDisplay(change)) } catch { /* An unverifiable record is visible, never approvable. */ }
      }
      for (const change of changes) {
        const key = `${change.id}:${change.changeSetDigest}`
        const cached = cache.get(key)
        if (cached) { records.push(cached); continue }
        const files = texts.get(change.id)
        const base: CodingChangeSetRecord = { id: change.id, codingRunId: run.id, phase: change.phase, ...(change.revision ? { revision: change.revision } : {}), createdAt: change.createdAt, expiresAt: change.expiresAt, digest: change.changeSetDigest, changedPaths: change.changes.map(f => f.path), verified: Boolean(files) }
        if (files) {
          const prior = change.revision ? texts.get(change.revision.previous.id) : undefined
          const raw = buildChangeSetDiffView(files)
          const marked = change.phase === 'repair' || change.revision ? markNewRows(raw, { current: files, ...(prior ? { previous: prior } : {}), ...(change.phase === 'repair' && !change.revision ? { all: true } : {}) }) : raw
          base.view = { ...marked, files: marked.files.map(f => ({ ...f, rows: f.rows.map(row => row.kind === 'add' || row.kind === 'del' ? { ...row, text: redactSensitiveText(row.text).value } : row) })) }
          cache.set(key, base)
        }
        records.push(base)
      }
      reviews.push(...(await store.listCodingChangeReviews(run.id)).filter(r => changes.some(c => c.id === r.changeSetId && c.changeSetDigest === r.changeSetDigest)))
    }
    return { runId, observedAt: now(), changeSets: records.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)), reviews: reviews.sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id)) }
  }
}
