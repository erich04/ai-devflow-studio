import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { createHindsightClient, HINDSIGHT_PROTOCOL } from '../apps/desktop/electron/hindsight-client.js'

// This is an explicit, potentially paid protocol experiment. It never reads project files.
if (process.env.HINDSIGHT_SMOKE_AUTHORIZED !== '1' || !process.env.HINDSIGHT_SMOKE_ENDPOINT) {
  throw new Error('Set HINDSIGHT_SMOKE_AUTHORIZED=1 and HINDSIGHT_SMOKE_ENDPOINT only after approving the server/model/budget for synthetic protocol testing.')
}
const endpoint = process.env.HINDSIGHT_SMOKE_ENDPOINT
const apiKey = process.env.HINDSIGHT_SMOKE_API_KEY
const extractionMode = process.env.HINDSIGHT_SMOKE_EXTRACTION_MODE ?? 'concise'
if (extractionMode !== 'concise' && extractionMode !== 'verbatim' && extractionMode !== 'chunks') throw new Error('Unsupported extraction mode')
const client = createHindsightClient({ endpoint, ...(apiKey ? { apiKey } : {}), timeoutMs: 10_000 })
const bank = `df-protocol-${randomUUID()}`
const documentId = `df-protocol-${randomUUID()}`
const operationId = randomUUID()
const item = { documentId, operationId, content: 'The synthetic Project Cedar requires an original order for every refund.',
  metadata: { df_test: 'synthetic-only', df_revision: '1' } }
let settled = false
try {
  await client.configureBank(bank, [{ key: 'sem_kind', type: 'multi-values', values: [{ value: 'business_rule' }] }],
    extractionMode)
  await client.retain(bank, item)
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    const status = await client.operation(bank, operationId)
    if (status === 'completed') { settled = true; break }
    if (status === 'failed') { settled = true; throw new Error('Synthetic retain failed') }
    if (status === 'cancelled') throw new Error('Synthetic retain was cancelled; late-write cleanup remains unverified')
    await delay(1_000)
  }
  if (!settled) throw new Error('Synthetic retain did not settle within 120 seconds')
  // Same operation ID, same payload: the adapter must not invent a replacement UUID.
  await client.retain(bank, item)
  const recalled = await client.recall(bank, 'What does Project Cedar require for a refund?')
  if (!recalled.some((r) => r.documentId === documentId && r.metadata.df_test === 'synthetic-only' && r.metadata.df_revision === '1')) {
    throw new Error('No recall result preserved the document identity and host metadata')
  }
  await client.deleteDocument(bank, documentId)
  if ((await client.recall(bank, 'Project Cedar refund')).some((r) => r.documentId === documentId)) {
    throw new Error('Deleted document still appeared in recall')
  }
  console.log(JSON.stringify({ status: 'passed', scope: 'synthetic basic protocol only', extractionMode, protocol: HINDSIGHT_PROTOCOL,
    bank, documentId, operationId, checks: ['version', 'bank-config', 'async-retain', 'same-operation-replay', 'recall-provenance', 'document-delete'],
    notVerified: [...(extractionMode === 'chunks' ? ['LLM extraction (chunks bypasses LLM)'] : []),
      'in-flight cancellation', 'all extraction modes', 'ontology extraction quality', '30-question value evaluation', 'billing idempotency'] }, null, 2))
} finally {
  // A timed-out/cancelled task can still write. Preserve its identifiers for reconciliation.
  if (settled) await client.deleteDocument(bank, documentId)
  else console.error(JSON.stringify({ status: 'cleanup_pending', bank, documentId, operationId }))
}
