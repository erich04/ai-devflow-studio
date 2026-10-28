import { describe, expect, it } from 'vitest'
import { buildConversationLearningEvent, buildCodingLearningEvent, buildArtifactLearningEvent } from './automatic-memory-capture'

const scope = { kind: 'local', organizationId: null, projectId: null, userId: 'owner', sessionId: 'session', localProjectId: 'project' } as const
const timestamp = '2026-10-22T12:00:00.000Z'
const conversation = {
  id: 'conversation', localProjectId: 'project', status: 'idle' as const, updatedAt: timestamp,
  messages: [
    { id: 'user', role: 'user' as const, text: '解释改动时先说行为变化，再说测试。', createdAt: timestamp },
    { id: 'assistant', role: 'assistant' as const, text: '好的。', createdAt: timestamp },
  ],
}

describe('automatic learning completion capture', () => {
  it('captures one completed public turn, independent of the chat executor and later conversation versions', () => {
    const event = buildConversationLearningEvent(conversation, { status: 'running', messages: conversation.messages.slice(0, 1) }, scope)
    expect(event?.sourceRevision).toBe('assistant')
    expect(event?.materials.map(m => m.id)).toEqual(['user', 'assistant'])
    expect(event?.materials[0]?.evidence?.kind).toBe('user_statement')
    expect(event?.materials[1]?.evidence).toBeUndefined()
    expect(buildConversationLearningEvent(conversation, conversation, scope)).toBeNull()
  })
  it('does not learn partial, cancelled or failed replies, reasoning, or another project', () => {
    for (const status of ['running', 'failed', 'cancelled'] as const) {
      expect(buildConversationLearningEvent({ ...conversation, status }, { status: 'running', messages: [] }, scope)).toBeNull()
    }
    expect(buildConversationLearningEvent(conversation, { status: 'running', messages: [] }, { ...scope, localProjectId: 'other' })).toBeNull()
    const event = buildConversationLearningEvent({ ...conversation, messages: [conversation.messages[0]!, { ...conversation.messages[1]!, reasoning: { text: 'private deliberation', status: 'completed' } }] }, { status: 'running', messages: [] }, scope)
    expect(JSON.stringify(event)).not.toContain('private deliberation')
  })
  it('does not transmit a source whose public text contains a secret or exceeds the complete-material bound', () => {
    expect(buildConversationLearningEvent({ ...conversation, messages: [{ ...conversation.messages[0]!, text: 'sk-' + 'a'.repeat(48) }, conversation.messages[1]!] }, { status: 'running', messages: [] }, scope)).toBeNull()
    expect(buildConversationLearningEvent({ ...conversation, messages: [{ ...conversation.messages[0]!, text: '很'.repeat(20000) }, conversation.messages[1]!] }, { status: 'running', messages: [] }, scope)).toBeNull()
  })
  it('only treats a stored passing canonical command as verified evidence', () => {
    const coding = { id: 'coding', projectId: 'project', runId: 'run', nodeId: 'node', status: 'completed' as const, engine: 'native' as const, completedAt: timestamp, testEvidenceId: 'test', diffArtifactId: 'diff' }
    const evidence = { id: 'test', projectId: 'project', runId: 'run', nodeId: 'node', status: 'passed' as const, command: 'pnpm test', exitCode: 0, createdAt: timestamp }
    const event = buildCodingLearningEvent(coding, evidence, 'pnpm test', scope)
    expect(event?.materials[0]?.text).toBe('command: pnpm test\nexitCode: 0')
    expect(event?.materials[0]?.evidence?.kind).toBe('verified_tool_result')
    expect(buildCodingLearningEvent(coding, { ...evidence, exitCode: 1 }, 'pnpm test', scope)).toBeNull()
    expect(buildCodingLearningEvent({ ...coding, engine: 'fake' }, evidence, 'pnpm test', scope)).toBeNull()
  })
  it('keeps stage artifact content as a claim, without manufacturing approved evidence', () => {
    const event = buildArtifactLearningEvent({ id: 'artifact', runId: 'run', nodeId: 'node', kind: 'design', content: '删除应支持撤销。', updatedAt: timestamp }, scope)
    expect(event?.materials[0]?.role).toBe('artifact')
    expect(event?.materials[0]?.evidence).toBeUndefined()
    expect(event?.sourceKind).toBe('stage_completion')
  })
})
