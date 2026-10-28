// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  PROJECT_MEMORY_MAX_DOCUMENT_BYTES, validateProjectMemoryDocumentInput,
  type Artifact, type CodingAgentEvent, type CodingAgentRun, type DesktopPairingCredential,
} from '@ai-devflow/shared'
import {
  buildArtifactMemoryDocument, buildCodingRunMemoryDocument, buildConversationMemoryDocument,
  projectMemoryPairingBinding, projectMemoryPairingMatches,
} from './project-memory-capture'

const now = '2026-10-28T08:00:00.000Z'
const bytes = (text: string) => Buffer.byteLength(text, 'utf8')

describe('project memory documents', () => {
  it('keeps the newest conversation messages within the document limit', () => {
    const messages = Array.from({ length: 80 }, (_, index) => ({ id: `m${index}`, role: index % 2 ? 'assistant' as const : 'user' as const,
      text: `第 ${index} 条：${'讨论内容'.repeat(400)}`, createdAt: new Date(Date.parse(now) + index * 1_000).toISOString() }))
    const document = buildConversationMemoryDocument({ id: 'chat', localProjectId: 'p', title: '', status: 'idle', messages, updatedAt: now }, now)!
    const kept = JSON.parse(document.payload) as Array<{ content: string; timestamp: string }>
    expect(bytes(document.payload)).toBeLessThanOrEqual(PROJECT_MEMORY_MAX_DOCUMENT_BYTES)
    expect(kept.at(-1)!.content).toContain('第 79 条')
    expect(kept[0]!.content).not.toContain('第 0 条')
    expect(document).toMatchObject({ title: '项目讨论', occurredAt: kept[0]!.timestamp })
    expect(() => validateProjectMemoryDocumentInput(document)).not.toThrow()
    // A conversation without an answer, or without the user's own words, has nothing to learn from.
    expect(buildConversationMemoryDocument({ id: 'chat', localProjectId: 'p', title: 'x', status: 'idle', updatedAt: now,
      messages: [{ id: 'u', role: 'user', text: '你好', createdAt: now }] }, now)).toBeNull()
  })

  it('redacts secrets and keeps the end of a long coding run', () => {
    const run: CodingAgentRun = { id: 'coding', runId: 'run', projectId: 'p', nodeId: 'build', requestedBy: 'u', providerId: 'deepseek',
      engine: 'opencode-http', status: 'completed', branchName: 'b', userInstruction: '修复登录', prompt: 'p',
      summary: '用 sk-abcdefghijklmnopqrstuvwxyz0123456789 调试后已修复', changedPaths: ['src/login.ts'], startedAt: now, completedAt: now, redacted: false }
    const events: CodingAgentEvent[] = Array.from({ length: 400 }, (_, index) => ({ id: `e${index}`, codingRunId: 'coding', runId: 'run',
      nodeId: 'build', sequence: index, kind: 'tool_call', message: `step ${index} ${'x'.repeat(300)}`, timestamp: now, redacted: true }))
    const document = buildCodingRunMemoryDocument({ run, workflow: { title: '登录', request: '修复登录', nodes: [] }, events, testEvidence: [] })!
    expect(document.payload).not.toContain('sk-abcdefghijklmnopqrstuvwxyz0123456789')
    expect(document.payload).toContain('[earlier activity omitted]')
    expect(document.payload).toContain('step 399')
    expect(document.payload).not.toContain('step 0 ')
    expect(bytes(document.payload)).toBeLessThanOrEqual(PROJECT_MEMORY_MAX_DOCUMENT_BYTES)
    expect(buildCodingRunMemoryDocument({ run: { ...run, status: 'running' }, workflow: { title: 't', request: 'r', nodes: [] }, events: [], testEvidence: [] })).toBeNull()
  })

  it('labels a review result as findings and refuses drafts', () => {
    const run = { title: '删除确认', nodes: [{ id: 'gate', stage: 'design' }] } as Parameters<typeof buildArtifactMemoryDocument>[1]
    const artifact: Artifact = { id: 'a1', runId: 'run', nodeId: 'gate', kind: 'agent_review', title: 'Gate review', summary: '',
      content: '风险：批量删除没有撤销。', redacted: true, updatedAt: now }
    expect(buildArtifactMemoryDocument(artifact, run, false)).toMatchObject({ documentId: 'artifact:a1', tags: ['source:artifact', 'kind:agent_review'],
      context: expect.stringContaining('not a decision') })
    expect(buildArtifactMemoryDocument({ ...artifact, kind: 'design' }, run, false)).toBeNull()
    expect(buildArtifactMemoryDocument(artifact, run, true)).toBeNull()
    expect(buildArtifactMemoryDocument({ ...artifact, kind: 'design' }, run, true)?.payload).toContain('design, approved, stage design')
  })

  it('stops using a paired memory when the pairing changes', () => {
    const pairing = { organizationId: 'org', projectId: 'team-project', userId: 'u1', authAccountId: 'acct', localProjectId: 'p',
      tokenId: 'token', expiresAt: '2999-01-01T00:00:00.000Z' } as DesktopPairingCredential
    const config = { projectId: 'p', ownerUserId: 'u1', pairingBinding: projectMemoryPairingBinding(pairing) }
    expect(projectMemoryPairingMatches(config, pairing)).toBe(true)
    expect(projectMemoryPairingMatches(config, { ...pairing, tokenId: 'rotated' })).toBe(true)
    expect(projectMemoryPairingMatches(config, { ...pairing, projectId: 'other-team-project' })).toBe(false)
    expect(projectMemoryPairingMatches(config, { ...pairing, expiresAt: '2000-01-01T00:00:00.000Z' })).toBe(false)
    expect(projectMemoryPairingMatches(config, null)).toBe(false)
    expect(projectMemoryPairingMatches({ projectId: 'p', ownerUserId: 'u1' }, null)).toBe(true)
    expect(projectMemoryPairingMatches({ projectId: 'p', ownerUserId: 'u1' }, pairing)).toBe(false)
  })
})
