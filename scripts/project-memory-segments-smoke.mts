// Checks, against a real Hindsight, the behaviour long-conversation segments rely on (ADR 0030
// "长讨论分段"): a document replaced with its oldest messages trimmed loses what they held, while a
// full segment that is never sent again keeps its memories. Uses `chunks` mode, which makes no model
// calls, on a fresh test bank that is deleted at the end. Run it again after upgrading Hindsight.
import { randomUUID } from 'node:crypto'
import { buildConversationMemoryDocuments, CONVERSATION_SEGMENT_BYTES } from '../apps/desktop/electron/project-memory-capture.ts'
import { createHindsightClient } from '../apps/desktop/electron/hindsight-client.ts'

const endpoint = process.env.HINDSIGHT_SMOKE_ENDPOINT
if (!endpoint || process.env.HINDSIGHT_SMOKE_AUTHORIZED !== '1') {
  throw new Error('Set HINDSIGHT_SMOKE_ENDPOINT and HINDSIGHT_SMOKE_AUTHORIZED=1 for a Hindsight this test may write to')
}
const client = createHindsightClient({ endpoint, ...(process.env.HINDSIGHT_SMOKE_API_KEY ? { apiKey: process.env.HINDSIGHT_SMOKE_API_KEY } : {}), timeoutMs: 60_000 })
const bank = `df-segments-smoke-${randomUUID()}`
const DECISION = '决定：撤销窗口改为 8 秒，代码注释一律用英文。'
const start = Date.parse('2026-10-29T08:00:00Z')
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const conversation = (count: number) => ({ id: 'smoke', localProjectId: 'smoke', title: '长讨论', status: 'idle' as const, updatedAt: new Date(start).toISOString(),
  messages: Array.from({ length: count }, (_, index) => ({ id: `m${index}`, role: index % 2 ? 'assistant' as const : 'user' as const,
    text: `[m${index}] ${index === 0 ? DECISION : ''}${`第 ${index} 条讨论，关于列表筛选与排序的细节。`.repeat(22)}`,
    createdAt: new Date(start + index * 60_000).toISOString() })) })
async function retain(documentId: string, content: string, context: string, timestamp: string) {
  const operationId = randomUUID()
  await client.retainDocument(bank, { documentId, operationId, content, context, timestamp, tags: ['source:conversation'], metadata: { smoke: 'segments' } })
  for (let i = 0; i < 300; i++) {
    const status = await client.operation(bank, operationId)
    if (status === 'completed') return
    if (status === 'failed' || status === 'cancelled') throw new Error(`retain ${status}`)
    await sleep(1_000)
  }
  throw new Error('retain timed out')
}
async function unitIds(documentId: string) {
  const ids: string[] = []
  for (let offset = 0; ;) {
    const page = await client.listMemories(bank, { type: 'world', offset, limit: 100 })
    ids.push(...page.items.filter((item) => item.documentId === documentId).map((item) => item.id))
    offset += page.items.length
    if (!page.items.length || offset >= page.total) return ids
  }
}
const recalled = async () => (await client.recallMemories(bank, { query: '撤销窗口改成几秒？', maxTokens: 2_048 })).some((item) => item.text.includes('撤销窗口改为 8 秒'))
const checks: Array<{ name: string; passed: boolean }> = []
try {
  await client.configureBank(bank, [], 'chunks')
  // The old way: one document per conversation, replaced by its newest part once it grew too long.
  const whole = buildConversationMemoryDocuments(conversation(30), new Date(start).toISOString())[0]!
  await retain('conversation:old-way', whole.payload, whole.context, whole.occurredAt)
  const recalledBefore = await recalled()
  const messages = JSON.parse(buildConversationMemoryDocuments(conversation(52), new Date(start).toISOString()).map((segment) => segment.payload)
    .reduce((all, payload) => JSON.stringify([...JSON.parse(all), ...JSON.parse(payload)]), '[]')) as unknown[]
  const newest: unknown[] = []
  for (const message of [...messages].reverse()) {
    if (Buffer.byteLength(JSON.stringify([message, ...newest])) > CONVERSATION_SEGMENT_BYTES) break
    newest.unshift(message)
  }
  await retain('conversation:old-way', JSON.stringify(newest), whole.context, whole.occurredAt)
  checks.push({ name: 'replacing a document with its oldest messages removed drops what they held', passed: recalledBefore && !(await recalled()) })
  // Segments: the full first segment is sent once; later sends replace only the open one.
  const first = buildConversationMemoryDocuments(conversation(52), new Date(start).toISOString())
  for (const segment of first) await retain(segment.documentId, segment.payload, segment.context, segment.occurredAt)
  const closedIds = await unitIds(first[0]!.documentId)
  const grown = buildConversationMemoryDocuments(conversation(60), new Date(start).toISOString())
  for (const segment of grown.slice(1)) await retain(segment.documentId, segment.payload, segment.context, segment.occurredAt)
  const after = await unitIds(first[0]!.documentId)
  checks.push({ name: 'the conversation spans several segments', passed: first.length > 1 })
  checks.push({ name: 'a full segment keeps its memories while later segments change', passed: closedIds.length > 0 && JSON.stringify([...after].sort()) === JSON.stringify([...closedIds].sort()) })
  checks.push({ name: 'the decision in the first message is recalled', passed: await recalled() })
} finally {
  await client.deleteBank(bank).catch(() => { console.warn(`Test bank ${bank} was not deleted; delete it in Hindsight.`) })
}
console.log(JSON.stringify({ bank, mode: 'chunks (no model calls)', checks }, null, 2))
if (checks.some((check) => !check.passed)) process.exitCode = 1
