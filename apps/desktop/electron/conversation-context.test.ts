import { describe, expect, it } from 'vitest'
import { buildRollingSummary, appendToolEvents, validateConversationContext } from './conversation-context'
import type { ConversationMessage, WorkbenchConversation } from './workbench-conversation-contract'

const messages: ConversationMessage[] = [
  { id: 'u1', role: 'user', text: '必须保留用户数据。' + '长中文'.repeat(2000), createdAt: '2026-10-04T00:00:00Z' },
  { id: 'a1', role: 'assistant', text: '请确认存储范围', question: { prompt: '保留哪些数据？', options: [], answeredAt: '2026-10-04T00:01:00Z' }, createdAt: '2026-10-04T00:00:00Z', reasoning: { text: 'NEVER_INCLUDE_REASONING', status: 'completed' } },
  { id: 'u2', role: 'user', text: '保留所有数据，不允许删除。', createdAt: '2026-10-04T00:00:00Z' },
]
const session = (): WorkbenchConversation => ({ id: 'chat', localProjectId: 'p', version: 1, title: 'Test', isOpen: true, inputDraft: '', status: 'idle', messages, createdAt: messages[0]!.createdAt, updatedAt: messages[0]!.createdAt })

describe('persistent conversation context', () => {
  it.each(['sourceDigest', 'previousBoundaryId', 'stateVersion', 'algorithm'] as const)('retains damaged %s receipts for diagnosis while rebuilding a usable boundary', (field) => {
    const first = buildRollingSummary(session(), ['u1'], 'now')!
    const damaged = { ...first, [field]: field === 'stateVersion' ? 99 : 'damaged' } as typeof first
    const previous = { ...session(), compactions: [damaged] }
    // Unchanged derived damage cannot block saving status or retaining original facts.
    expect(() => validateConversationContext({ ...previous, status: 'running' }, previous)).not.toThrow()
    const rebuilt = buildRollingSummary(previous, ['u1'], 'recovered')!
    expect(rebuilt.id).not.toBe(damaged.id)
    expect(rebuilt.sourceDigest).toBe(first.sourceDigest)
    expect(rebuilt.stateVersion).toBe(1)
    expect(rebuilt.algorithm).toBe('extractive-v1')
    expect(rebuilt.previousBoundaryId).toBeNull()
    const recovered = { ...previous, compactions: [damaged, rebuilt] }
    expect(() => validateConversationContext(recovered, previous)).not.toThrow()
    expect(buildRollingSummary(recovered, ['u1'], 'again')).toEqual(rebuilt)
    expect(recovered.messages).toEqual(messages)
    expect(() => validateConversationContext({ ...previous, compactions: [first] }, previous)).toThrow(/receipt/)
  })

  it('creates two traceable deterministic boundaries from original facts without reasoning', () => {
    const first = buildRollingSummary(session(), ['u1'], 'now')!
    expect(first.coveredMessageIds).toEqual(['u1'])
    expect(first.summary.facts[0]!.excerpt).toContain('必须保留用户数据')
    const damaged = { ...first, summary: { ...first.summary, facts: [{ ...first.summary.facts[0]!, excerpt: 'CORRUPT_SUMMARY' }] } }
    const rebuilt = buildRollingSummary({ ...session(), compactions: [damaged] }, ['u1'], 'recovery')!
    expect(rebuilt.id).not.toBe(damaged.id)
    expect(JSON.stringify(rebuilt)).not.toContain('CORRUPT_SUMMARY')
    const after = { ...session(), compactions: [first] }
    const second = buildRollingSummary(after, ['u1', 'a1'], 'later')!
    expect(second.previousBoundaryId).toBe(first.id)
    expect(second.summary.facts.find((fact) => fact.sourceId === 'a1')?.questionStatus).toBe('answered')
    expect(second.coveredMessageIds).toEqual(['u1', 'a1'])
    expect(JSON.stringify(second)).not.toContain('NEVER_INCLUDE_REASONING')
    expect(buildRollingSummary({ ...after, compactions: [first, second] }, ['u1', 'a1'], 'again')).toEqual(second)
    expect(session().messages[0]!.text.length).toBeGreaterThan(6000)
    expect(() => validateConversationContext({ ...session(), compactions: [{ ...first, summary: { ...first.summary, facts: [] } }] }, session())).toThrow(/derived/)
    const changed = { ...session(), messages: messages.map((message) => message.id === 'a1' ? { ...message, question: { prompt: '保留哪些数据？', options: [] } } : message), compactions: [first, second] }
    expect(buildRollingSummary(changed, ['u1', 'a1'], 'changed')!.sourceDigest).not.toBe(second.sourceDigest)
  })
  it('pairs tool facts, rejects conflicting replay and marks incomplete requests explicitly', () => {
    const request = { kind: 'tool_request' as const, id: 'q1', turnId: 'u1', name: 'repo_read', args: { path: 'a.ts' }, createdAt: 'now' }
    const result = { kind: 'tool_result' as const, id: 'r1', requestId: 'q1', turnId: 'u1', outcome: 'completed' as const, value: { content: 'source' }, createdAt: 'later' }
    const events = appendToolEvents([], [request, result])
    expect(appendToolEvents(events, [request, result])).toEqual(events)
    expect(() => appendToolEvents(events, [{ ...result, value: 'changed' }])).toThrow(/replay/)
    expect(() => appendToolEvents([], [result])).toThrow(/request/)
    expect(() => validateConversationContext({ ...session(), toolEvents: [...events, ...events] }, session())).toThrow(/Duplicate tool event/)
    const summary = buildRollingSummary({ ...session(), toolEvents: events }, ['u1'], 'now')!
    expect(summary.coveredEventIds).toEqual(['q1', 'r1'])
    expect(buildRollingSummary({ ...session(), toolEvents: [request] }, ['u1'], 'now')!.summary.pendingToolRequestIds).toEqual(['q1'])
    expect(() => validateConversationContext({ ...session(), messages: messages.slice(1) }, session())).toThrow(/original/)
  })
})
