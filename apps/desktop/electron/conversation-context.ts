import { createHash } from 'node:crypto'
import { redactSensitiveText } from '@ai-devflow/shared'
import type { ConversationMessage, WorkbenchConversation } from './workbench-conversation-contract.js'

export type ConversationToolEvent = {
  kind: 'tool_request'; id: string; turnId: string; name: string; args: Record<string, unknown>; createdAt: string
} | {
  kind: 'tool_result'; id: string; requestId: string; turnId: string; outcome: 'completed' | 'failed' | 'interrupted'; value: unknown; createdAt: string
}
type SummaryFact = {
  sourceId: string; role: string; excerpt: string; truncated: boolean
  questionStatus?: 'answered' | 'unanswered'
  draft?: { title: string; runId: string; nodeId: string; publishedArtifactId?: string }
}
export type ConversationCompaction = {
  stateVersion: 1; id: string; algorithm: 'extractive-v1'; sourceDigest: string; createdAt: string
  previousBoundaryId: string | null
  coveredMessageIds: string[]; coveredEventIds: string[]
  summary: { trust: 'historical_context_only'; facts: SummaryFact[]; omittedFacts: number; pendingToolRequestIds: string[]; readWith: 'conversation_read' }
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

/** Explicit allowlist. Provider reasoning, usage, legacy notes and memory snapshots stay out. */
export function conversationMessageContext(message: ConversationMessage) {
  return { id: message.id, role: message.role, text: message.text,
    ...(message.toolRequestId ? { toolRequestId: message.toolRequestId } : {}),
    ...(message.question ? { question: message.question } : {}), ...(message.draft ? { draft: message.draft } : {}) }
}

export function appendToolEvents(previous: readonly ConversationToolEvent[], additions: readonly ConversationToolEvent[]): ConversationToolEvent[] {
  const events = [...previous]
  const ids = new Map(events.map((event) => [event.id, event]))
  for (const event of additions) {
    const existing = ids.get(event.id)
    if (existing) { if (JSON.stringify(existing) !== JSON.stringify(event)) throw new Error('Conflicting tool event replay'); continue }
    if (!event.id || !event.turnId || !event.createdAt) throw new Error('Invalid tool event')
    if (event.kind === 'tool_request') {
      if (!event.name || !event.args || typeof event.args !== 'object' || Array.isArray(event.args)) throw new Error('Invalid tool request')
    } else if (event.kind === 'tool_result') {
      const request = ids.get(event.requestId)
      if (request?.kind !== 'tool_request' || request.turnId !== event.turnId) throw new Error('Tool result has no matching request')
      if (!['completed', 'failed', 'interrupted'].includes(event.outcome) || events.some((item) => item.kind === 'tool_result' && item.requestId === event.requestId)) throw new Error('Tool request already has a result')
    } else throw new Error('Invalid tool event kind')
    events.push(event); ids.set(event.id, event)
  }
  return events
}

export function interruptPendingTools(events: readonly ConversationToolEvent[], createdAt: string) {
  const completed = new Set(events.flatMap((event) => event.kind === 'tool_result' ? [event.requestId] : []))
  return appendToolEvents(events, events.flatMap((event) => event.kind === 'tool_request' && !completed.has(event.id)
    ? [{ kind: 'tool_result' as const, id: `${event.id}:interrupted`, requestId: event.id, turnId: event.turnId, outcome: 'interrupted' as const, value: null, createdAt }] : []))
}

/** Damaged derived metadata is retained, but cannot be reused or link a new chain. */
function linkedCompactions(session: WorkbenchConversation): ConversationCompaction[] {
  const linked: ConversationCompaction[] = []
  const ids = new Set<string>()
  const messageIds = new Set(session.messages.map((message) => message.id))
  const eventIds = new Set((session.toolEvents ?? []).map((event) => event.id))
  for (const boundary of session.compactions ?? []) {
    if (!boundary || boundary.stateVersion !== 1 || boundary.algorithm !== 'extractive-v1' ||
      typeof boundary.sourceDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(boundary.sourceDigest) ||
      typeof boundary.id !== 'string' || !new RegExp(`^compaction-${boundary.sourceDigest}(?:-[a-f0-9]{16})?$`, 'u').test(boundary.id) || ids.has(boundary.id) ||
      typeof boundary.createdAt !== 'string' || !boundary.createdAt ||
      (boundary.previousBoundaryId !== null && !ids.has(boundary.previousBoundaryId)) ||
      !Array.isArray(boundary.coveredMessageIds) || boundary.coveredMessageIds.some((id) => !messageIds.has(id)) ||
      !Array.isArray(boundary.coveredEventIds) || boundary.coveredEventIds.some((id) => !eventIds.has(id))) continue
    linked.push(boundary); ids.add(boundary.id)
  }
  return linked
}

/** Always derives from originals, never from an earlier lossy summary. */
export function buildRollingSummary(session: WorkbenchConversation, coveredIds: readonly string[], createdAt: string): ConversationCompaction | undefined {
  if (!coveredIds.length) return undefined
  const covered = new Set(coveredIds)
  const messages = session.messages.filter((message) => covered.has(message.id)).map(conversationMessageContext)
  if (messages.length !== covered.size) throw new Error('Compaction references missing messages')
  const events = (session.toolEvents ?? []).filter((event) => covered.has(event.turnId))
  const sourceDigest = digest({ messages, events })
  const id = `compaction-${sourceDigest}`
  const existing = session.compactions?.filter((boundary) => boundary?.sourceDigest === sourceDigest || boundary?.id === id || boundary?.id?.startsWith(`${id}-`)) ?? []
  const linked = linkedCompactions(session)
  const ranked = messages.map((message, index) => ({ message, index, priority: message.question && !message.question.answeredAt ? 0 : message.draft?.publishedArtifactId ? 1 : index === 0 ? 2 : message.question ? 3 : 4 }))
    .sort((a, b) => a.priority - b.priority || b.index - a.index)
  const facts: SummaryFact[] = []
  for (const { message } of ranked) {
    const text = redactSensitiveText(message.text).value
    const fact: SummaryFact = { sourceId: message.id, role: message.role, excerpt: text.slice(0, 240), truncated: text.length > 240,
      ...(message.question ? { questionStatus: message.question.answeredAt ? 'answered' : 'unanswered' } : {}),
      ...(message.draft ? { draft: { title: message.draft.title, runId: message.draft.runId, nodeId: message.draft.nodeId,
        ...(message.draft.publishedArtifactId ? { publishedArtifactId: message.draft.publishedArtifactId } : {}) } } : {}) }
    if (JSON.stringify([...facts, fact]).length > 3000) continue
    facts.push(fact)
  }
  // Chronology is restored after selection. Truncation never implies a fact was absent.
  facts.sort((a, b) => messages.findIndex((message) => message.id === a.sourceId) - messages.findIndex((message) => message.id === b.sourceId))
  const completed = new Set(events.flatMap((event) => event.kind === 'tool_result' ? [event.requestId] : []))
  const boundary: ConversationCompaction = { stateVersion: 1, id, algorithm: 'extractive-v1', sourceDigest, createdAt,
    previousBoundaryId: linked.at(-1)?.id ?? null,
    coveredMessageIds: messages.map((message) => message.id), coveredEventIds: events.map((event) => event.id),
    summary: { trust: 'historical_context_only', facts, omittedFacts: messages.length - facts.length,
      pendingToolRequestIds: events.flatMap((event) => event.kind === 'tool_request' && !completed.has(event.id) ? [event.id] : []), readWith: 'conversation_read' } }
  const valid = linked.find((item) => item.sourceDigest === sourceDigest && JSON.stringify(item.summary) === JSON.stringify(boundary.summary) && JSON.stringify(item.coveredMessageIds) === JSON.stringify(boundary.coveredMessageIds) && JSON.stringify(item.coveredEventIds) === JSON.stringify(boundary.coveredEventIds))
  if (valid) return valid
  // A damaged derived record is retained for diagnosis; append a replacement built from facts.
  if (existing.length) boundary.id = `${id}-${digest(existing.at(-1)).slice(0, 16)}`
  return boundary
}

/** Main-owned persistence boundary; prevents summary writes from replacing original facts. */
export function validateConversationContext(next: WorkbenchConversation, previous?: WorkbenchConversation) {
  const messages = new Map(next.messages.map((message) => [message.id, message]))
  if (messages.size !== next.messages.length) throw new Error('Duplicate conversation message')
  for (const message of previous?.messages ?? []) {
    const current = messages.get(message.id)
    if (!current || (message.role !== 'notice' && (message.text !== current.text || message.role !== current.role || message.createdAt !== current.createdAt))) throw new Error('Cannot replace original conversation facts')
  }
  if (appendToolEvents([], next.toolEvents ?? []).length !== (next.toolEvents?.length ?? 0)) throw new Error('Duplicate tool event')
  for (const event of next.toolEvents ?? []) if (messages.get(event.turnId)?.role !== 'user') throw new Error('Tool event turn is missing')
  for (const event of previous?.toolEvents ?? []) {
    if (JSON.stringify(next.toolEvents?.find((item) => item.id === event.id)) !== JSON.stringify(event)) throw new Error('Cannot replace original tool events')
  }
  const saved = previous?.compactions ?? []
  const boundaries = next.compactions ?? []
  // Old receipts are an immutable diagnostic prefix. Derived corruption must not
  // prevent saving status or originals before a later step appends a replacement.
  if (JSON.stringify(boundaries.slice(0, saved.length)) !== JSON.stringify(saved)) throw new Error('Cannot replace a compaction receipt')
  const boundaryIds = new Set(saved.map((boundary) => boundary.id))
  for (let index = saved.length; index < boundaries.length; index++) {
    const boundary = boundaries[index]!
    const context = { ...next, compactions: boundaries.slice(0, index + 1) }
    if (boundaryIds.has(boundary.id) || !linkedCompactions(context).includes(boundary)) throw new Error('Invalid conversation compaction boundary')
    const derived = buildRollingSummary({ ...next, compactions: boundaries.slice(0, index) }, boundary.coveredMessageIds, boundary.createdAt)
    if (!derived || JSON.stringify(derived) !== JSON.stringify(boundary)) throw new Error('Invalid derived conversation summary')
    boundaryIds.add(boundary.id)
  }
}
