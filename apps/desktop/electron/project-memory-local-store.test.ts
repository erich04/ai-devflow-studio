// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createWorkflowRunFromRequest, PROJECT_MEMORY_CONVERSATION_IDLE_MS,
  type AgentEvent, type Artifact, type CodingAgentRun, type LocalProject,
} from '@ai-devflow/shared'
import { createLocalStore, type LocalStore } from './local-store'
import { approvedWorkflowArtifacts } from './project-memory-capture'
import type { WorkbenchConversation } from './workbench-conversation-contract'

const directories: string[] = []
const stores: LocalStore[] = []
afterEach(async () => {
  stores.splice(0).forEach((store) => store.close())
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})
const now = new Date().toISOString()
const later = (ms: number) => new Date(Date.now() + ms).toISOString()

async function fixture(options: { memory?: boolean; legacyCandidates?: boolean } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'devflow-project-memory-')); directories.push(directory)
  const dbPath = path.join(directory, 'db.sqlite')
  const store = await createLocalStore({ dbPath }); stores.push(store)
  const project: LocalProject = { id: 'project', name: 'Synthetic', path: directory, packageManager: 'pnpm',
    detectedTestCommand: 'pnpm test', testCommand: 'pnpm test', createdAt: now, updatedAt: now }
  await store.upsertProject(project)
  const owner = await store.resolveLocalProjectMemoryPrincipal(project.id)
  if (owner.status !== 'resolved') throw new Error('No principal')
  if (options.legacyCandidates) {
    const hindsight = await store.configureHindsight({ projectId: project.id, ownerUserId: owner.userId, projectPath: directory,
      knowledgeRoot: 'docs', rootGeneration: 'fixture', endpoint: 'http://127.0.0.1:8888', encryptedApiKey: null,
      enabled: true, includeMemories: false, selectedPaths: [], modelDigest: 'model', model: { version: 'v1', dimensions: [{ key: 'sem_kind', type: 'text' }] } })
    await store.configureAutomaticMemory({ projectId: project.id, ownerUserId: owner.userId, hindsightGeneration: hindsight.generation, enabled: true, maxRetainsPerDay: 10 })
  }
  const config = options.memory === false ? null : await store.configureProjectMemory({ projectId: project.id, ownerUserId: owner.userId,
    enabled: true, endpoint: 'http://127.0.0.1:8890', encryptedApiKey: null, providerId: 'deepseek' })
  const conversation: WorkbenchConversation = { id: 'chat', localProjectId: project.id, version: 1, title: '删除确认', isOpen: true,
    inputDraft: '', status: 'running', messages: [{ id: 'u1', role: 'user', text: '删除任务前要二次确认，按钮文案用“删除”。', createdAt: now }],
    createdAt: now, updatedAt: now }
  return { store, dbPath, owner, project, config, conversation }
}
const reply = (conversation: WorkbenchConversation, version: number, extra: WorkbenchConversation['messages']): WorkbenchConversation =>
  ({ ...conversation, version, status: 'idle', messages: [...conversation.messages, ...extra] })

describe('project memory capture', () => {
  it('keeps one document per conversation with only public messages, sent after the conversation is idle', async () => {
    const { store, conversation, config } = await fixture({ legacyCandidates: true })
    await store.saveWorkbenchConversation(conversation, 0)
    expect(await store.listProjectMemoryDocuments()).toEqual([])
    const first = reply(conversation, 2, [
      { id: 't1', role: 'tool', text: 'TOOL-OUTPUT-SHOULD-NOT-BE-KEPT', createdAt: now },
      { id: 'a1', role: 'assistant', text: '好的，删除前会弹出确认框。', createdAt: now,
        reasoning: { text: 'HIDDEN-REASONING-SHOULD-NOT-BE-KEPT', status: 'completed' } },
    ])
    await store.saveWorkbenchConversation(first, 1)
    const [document] = await store.listProjectMemoryDocuments()
    expect(document).toMatchObject({ documentId: 'conversation:chat', sourceKind: 'conversation', bankId: config!.bankId,
      status: 'queued', attempts: 0, tags: ['source:conversation'] })
    expect(JSON.parse(document!.payload)).toEqual([
      { role: 'user', content: '删除任务前要二次确认，按钮文案用“删除”。', timestamp: now },
      { role: 'assistant', content: '好的，删除前会弹出确认框。', timestamp: now },
    ])
    expect(Date.parse(document!.notBefore) - Date.now()).toBeGreaterThan(PROJECT_MEMORY_CONVERSATION_IDLE_MS - 60_000)
    // The candidate pipeline no longer captures a project whose memory lives in Hindsight.
    expect(await store.listMemoryLearningJobs()).toEqual([])

    await store.saveWorkbenchConversation({ ...first, version: 3, status: 'running',
      messages: [...first.messages, { id: 'u2', role: 'user', text: '撤销保留 5 秒。', createdAt: now }] }, 2)
    await store.saveWorkbenchConversation(reply({ ...first, messages: [...first.messages, { id: 'u2', role: 'user', text: '撤销保留 5 秒。', createdAt: now }] }, 4,
      [{ id: 'a2', role: 'assistant', text: '已记录：撤销窗口 5 秒。', createdAt: now }]), 3)
    const documents = await store.listProjectMemoryDocuments()
    expect(documents).toHaveLength(1)
    expect(documents[0]!.id).toBe(document!.id)
    expect(documents[0]!.operationId).not.toBe(document!.operationId)
    expect(JSON.parse(documents[0]!.payload)).toHaveLength(4)
  })

  it('captures nothing while memory is off, and a forgotten document never comes back', async () => {
    const off = await fixture({ memory: false })
    await off.store.saveWorkbenchConversation(off.conversation, 0)
    await off.store.saveWorkbenchConversation(reply(off.conversation, 2, [{ id: 'a1', role: 'assistant', text: '好的。', createdAt: now }]), 1)
    expect(await off.store.listProjectMemoryDocuments()).toEqual([])

    const { store, conversation, project } = await fixture()
    await store.saveWorkbenchConversation(conversation, 0)
    const first = reply(conversation, 2, [{ id: 'a1', role: 'assistant', text: '好的。', createdAt: now }])
    await store.saveWorkbenchConversation(first, 1)
    const [document] = await store.listProjectMemoryDocuments()
    const forgotten = await store.forgetProjectMemoryDocument(project.id, document!.id)
    expect(forgotten).toMatchObject({ status: 'delete_pending', payload: '' })
    await store.saveWorkbenchConversation({ ...first, version: 3, status: 'running' }, 2)
    await store.saveWorkbenchConversation(reply(first, 4, [{ id: 'a2', role: 'assistant', text: '还有别的吗？', createdAt: now }]), 3)
    expect(await store.listProjectMemoryDocuments()).toEqual([expect.objectContaining({ id: document!.id, status: 'delete_pending', payload: '' })])
  })

  it('records every finished coding run with DevFlow-run tests marked HOST_VERIFIED, but not fake runs', async () => {
    const { store, owner, project } = await fixture()
    const creation = createWorkflowRunFromRequest({ runId: 'run', title: '删除确认', request: '给删除按钮加二次确认', projectId: project.id,
      creatorId: owner.userId, branchName: 'devflow/fixture', now })
    await store.createWorkflow(creation)
    const nodeId = creation.run.nodes.find((node) => node.stage === 'build')!.id
    const started = new Date(Date.now() - 60_000).toISOString()
    const coding: CodingAgentRun = { id: 'coding', runId: creation.run.id, projectId: project.id, nodeId, requestedBy: owner.userId,
      providerId: 'deepseek', engine: 'native', status: 'testing', branchName: 'devflow/fixture', userInstruction: '给删除按钮加二次确认',
      prompt: 'Fixture', summary: '', changedPaths: ['src/tasks.ts'], startedAt: started, redacted: false }
    await store.saveCodingAgentRun(coding)
    await store.saveCodingAgentEvent({ id: 'event-1', codingRunId: coding.id, runId: coding.runId, nodeId, sequence: 1, kind: 'tool_call',
      message: 'edit src/tasks.ts', timestamp: now, redacted: true })
    await store.saveCodingAgentEvent({ id: 'event-2', codingRunId: coding.id, runId: coding.runId, nodeId, sequence: 2, kind: 'brief',
      message: 'BRIEF-WITH-INJECTED-CONTEXT', timestamp: now, redacted: true })
    await store.saveTestEvidence({ id: 'failed', runId: creation.run.id, projectId: project.id, nodeId, command: 'pnpm test',
      cwd: project.path, status: 'failed', exitCode: 1, durationMs: 1, stdout: '', stderr: 'expected confirm dialog', summary: '1 failed',
      redacted: false, createdAt: now })
    await store.saveCodingAgentRun({ ...coding, status: 'failed', summary: '确认框测试失败', completedAt: later(1_000) })
    const [document] = await store.listProjectMemoryDocuments()
    expect(document).toMatchObject({ documentId: 'coding-run:coding', sourceKind: 'coding_run', tags: ['source:coding', 'engine:native'] })
    expect(document!.payload).toContain('Outcome: failed - 确认框测试失败')
    expect(document!.payload).toContain('Changed files: src/tasks.ts')
    expect(document!.payload).toContain('HOST_VERIFIED test run by DevFlow: `pnpm test` failed, exit code 1')
    expect(document!.payload).toContain('- [tool_call] edit src/tasks.ts')
    expect(document!.payload).not.toContain('BRIEF-WITH-INJECTED-CONTEXT')

    const fake = { ...coding, id: 'fake-coding', engine: 'fake' as const }
    await store.saveCodingAgentRun(fake)
    await store.saveCodingAgentRun({ ...fake, status: 'completed', completedAt: later(2_000) })
    expect(await store.listProjectMemoryDocuments()).toHaveLength(1)
  })

  it('keeps approved documents and saved review results, never drafts', async () => {
    const { store, owner, project } = await fixture()
    const creation = createWorkflowRunFromRequest({ runId: 'run', title: '删除确认', request: '给删除按钮加二次确认', projectId: project.id,
      creatorId: owner.userId, branchName: 'devflow/fixture', now })
    await store.createWorkflow(creation)
    const designNode = creation.run.nodes.find((node) => node.kind === 'agent' && node.stage === 'design')!
    const gate = creation.run.nodes.find((node) => node.kind === 'gate' && node.stage === 'design')!
    const design: Artifact = { id: 'design', runId: creation.run.id, nodeId: designNode.id, kind: 'design', title: '删除确认设计',
      summary: 'Synthetic', redacted: false, content: '删除前弹出确认框；撤销窗口 5 秒。', updatedAt: now }
    await store.saveArtifact(design)
    expect(await store.listProjectMemoryDocuments()).toEqual([])
    const review: Artifact = { ...design, id: 'review', nodeId: gate.id, kind: 'agent_review', title: 'Gate review',
      content: '风险：撤销窗口未覆盖批量删除。' }
    await store.saveArtifact(review)
    expect((await store.listProjectMemoryDocuments()).map((document) => document.documentId)).toEqual(['artifact:review'])

    const run = (await store.getRun(creation.run.id))!
    const approval: AgentEvent = { id: 'approval', runId: run.id, nodeId: gate.id, sequence: 10, kind: 'approval',
      message: 'Gate approved', timestamp: now,
      designAudit: { version: 1, action: 'approved', artifactId: design.id, updatedAt: design.updatedAt, contentDigest: 'sha256:fixture', actorId: owner.userId } }
    // Approving the design Gate completes every earlier node and starts the build.
    const gateIndex = run.nodes.findIndex((node) => node.id === gate.id)
    const approved = { ...run, version: run.version + 1, updatedAt: later(1_000), status: 'building' as const,
      currentNodeId: run.nodes[gateIndex + 1]!.id,
      nodes: run.nodes.map((node, index) => index <= gateIndex ? { ...node, status: 'success' as const }
        : index === gateIndex + 1 ? { ...node, status: 'running' as const } : node) }
    expect(await store.commitWorkflowMutation({ expectedRun: run, run: approved, events: [approval] })).toMatchObject({ committed: true })
    const documents = await store.listProjectMemoryDocuments()
    expect(documents.map((document) => document.documentId).sort()).toEqual(['artifact:design', 'artifact:review'])
    const approvedDesign = documents.find((document) => document.documentId === 'artifact:design')!
    expect(approvedDesign.tags).toEqual(['source:artifact', 'kind:design'])
    expect(approvedDesign.payload).toContain('Workflow document: design, approved')
  })

  it('treats only audited or attached documents as approved', () => {
    const run = { id: 'run', nodes: [
      { id: 'gate', kind: 'gate', stage: 'clarify', status: 'success', artifactIds: ['stale'] },
      { id: 'accept', kind: 'acceptance', stage: 'accept', status: 'success', artifactIds: ['bundle'] },
      { id: 'pending-gate', kind: 'gate', stage: 'design', status: 'pending', artifactIds: [] },
    ] } as unknown as Parameters<typeof approvedWorkflowArtifacts>[0]
    const base = { runId: 'run', title: 'Doc', summary: '', redacted: false, content: 'x', updatedAt: now }
    const artifacts = [
      { ...base, id: 'approved', nodeId: 'clarify', kind: 'clarification', clarificationRevision: { status: 'approved' } },
      { ...base, id: 'stale', nodeId: 'clarify', kind: 'clarification', clarificationRevision: { status: 'superseded' } },
      { ...base, id: 'bundle', nodeId: 'accept', kind: 'acceptance' },
      { ...base, id: 'design', nodeId: 'design', kind: 'design' },
    ] as unknown as Artifact[]
    const event = (nodeId: string, extra: Partial<AgentEvent> = {}): AgentEvent =>
      ({ id: `event-${nodeId}`, runId: 'run', nodeId, sequence: 1, kind: 'approval', message: 'approved', timestamp: now, ...extra })
    expect(approvedWorkflowArtifacts(run, [
      event('gate', { clarificationAudit: { version: 1, action: 'approved', artifactId: 'approved', revision: 1, revisionDigest: 'd', actorId: 'u' } }),
      event('accept'),
      // A Gate that is not yet approved, or an audit for a different version, approves nothing.
      event('pending-gate', { designAudit: { version: 1, action: 'approved', artifactId: 'design', updatedAt: now, contentDigest: 'd', actorId: 'u' } }),
      event('gate', { designAudit: { version: 1, action: 'approved', artifactId: 'design', updatedAt: 'other', contentDigest: 'd', actorId: 'u' } }),
    ], artifacts).map((artifact) => artifact.id)).toEqual(['approved', 'bundle'])
  })
})

describe('project memory outbox', () => {
  async function queued() {
    const context = await fixture()
    await context.store.saveWorkbenchConversation(context.conversation, 0)
    await context.store.saveWorkbenchConversation(reply(context.conversation, 2, [{ id: 'a1', role: 'assistant', text: '好的。', createdAt: now }]), 1)
    return { ...context, due: later(PROJECT_MEMORY_CONVERSATION_IDLE_MS + 1_000) }
  }
  it('waits for idle, keeps the operation id across a crash, and resends only what Hindsight never received', async () => {
    const { store, dbPath, due } = await queued()
    expect(await store.claimProjectMemoryDocument(now)).toBeNull()
    const submit = (await store.claimProjectMemoryDocument(due))!
    expect(submit).toMatchObject({ action: 'submit', document: { status: 'submitted', attempts: 1 } })
    store.close(); stores.splice(stores.indexOf(store), 1)
    const reopened = await createLocalStore({ dbPath }); stores.push(reopened)
    await reopened.recoverProjectMemoryDocuments()
    const poll = (await reopened.claimProjectMemoryDocument(due))!
    expect(poll).toMatchObject({ action: 'poll', document: { operationId: submit.document.operationId } })
    await reopened.settleProjectMemoryDocument(poll.document.id, poll.leaseToken, 'resend', due)
    const resend = (await reopened.claimProjectMemoryDocument(later(PROJECT_MEMORY_CONVERSATION_IDLE_MS + 10_000)))!
    expect(resend).toMatchObject({ action: 'submit', document: { operationId: submit.document.operationId, attempts: 1 } })
    await reopened.settleProjectMemoryDocument(resend.document.id, resend.leaseToken, 'pending', due)
    const done = (await reopened.claimProjectMemoryDocument(later(PROJECT_MEMORY_CONVERSATION_IDLE_MS + 20_000)))!
    expect(done.action).toBe('poll')
    await reopened.settleProjectMemoryDocument(done.document.id, done.leaseToken, 'retained', due)
    expect((await reopened.listProjectMemoryDocuments())[0]).toMatchObject({ status: 'retained', retainedAt: due })
  })
  it('counts rejected sends with a fresh operation id and stops after three', async () => {
    const { store, due } = await queued()
    const operations = new Set<string>()
    let at = Date.parse(due)
    for (let attempt = 1; attempt <= 3; attempt++) {
      const claim = (await store.claimProjectMemoryDocument(new Date(at).toISOString()))!
      expect(claim).toMatchObject({ action: 'submit', document: { attempts: attempt } })
      operations.add(claim.document.operationId)
      await store.settleProjectMemoryDocument(claim.document.id, claim.leaseToken, 'retry', new Date(at).toISOString(), 'hindsight_http_400')
      at += 10 * 60_000
    }
    expect(operations.size).toBe(3)
    expect((await store.listProjectMemoryDocuments())[0]).toMatchObject({ status: 'failed', lastError: 'hindsight_http_400' })
    expect(await store.claimProjectMemoryDocument(new Date(at).toISOString())).toBeNull()
  })
  it('holds new sends without the relay and when memory is off, but still deletes', async () => {
    const { store, project, config, due } = await queued()
    expect(await store.claimProjectMemoryDocument(due, { submit: false })).toBeNull()
    await store.configureProjectMemory({ ...config!, enabled: false })
    expect(await store.claimProjectMemoryDocument(due)).toBeNull()
    const [document] = await store.listProjectMemoryDocuments()
    await store.forgetProjectMemoryDocument(project.id, document!.id)
    const removal = (await store.claimProjectMemoryDocument(due, { submit: false }))!
    expect(removal.action).toBe('delete')
    await store.settleProjectMemoryDocument(removal.document.id, removal.leaseToken, 'deleted', due)
    expect((await store.listProjectMemoryDocuments())[0]).toMatchObject({ status: 'deleted', payload: '' })
  })
  it('gives each owner their own bank', async () => {
    const { store, project, config } = await fixture()
    const other = await store.configureProjectMemory({ ...config!, ownerUserId: 'someone-else' })
    expect(other.bankId).not.toBe(config!.bankId)
    expect(other.bankId).toMatch(/^df-memory-[a-f0-9]{32}$/u)
    expect((await store.configureProjectMemory({ ...config!, endpoint: 'http://localhost:8890/' })).bankId).toBe(config!.bankId)
    await expect(store.configureProjectMemory({ ...config!, projectId: 'missing' })).rejects.toThrow('Project memory project is missing')
    expect((await store.getProjectMemoryConfiguration(project.id))?.endpoint).toBe('http://localhost:8890')
  })
  it('leaves out a source that does not fit instead of failing the save', async () => {
    const { store } = await fixture()
    const config = (await store.getProjectMemoryConfiguration('project'))!
    const input = { documentId: 'artifact:a1', sourceKind: 'artifact' as const, sourceId: 'a1', title: 'Doc', payload: 'x',
      context: 'A document.', tags: ['source:artifact'], occurredAt: now }
    await expect(store.recordProjectMemoryDocument(config, { ...input, documentId: 'not a document id' })).resolves.toBeNull()
    await expect(store.recordProjectMemoryDocument(config, { ...input, title: '  ' })).resolves.toBeNull()
    await expect(store.recordProjectMemoryDocument(config, { ...input, payload: 'x'.repeat(48 * 1024 + 1) })).resolves.toBeNull()
    expect(await store.listProjectMemoryDocuments()).toEqual([])
    // A stale configuration (changed since the capture read it) records nothing either.
    await store.configureProjectMemory({ ...config, providerId: 'other' })
    await expect(store.recordProjectMemoryDocument(config, input)).resolves.toBeNull()
  })
})

describe('project memory clearing and changes', () => {
  it('clears into a new empty bank, keeps every old source forgotten and queues the old bank for deletion', async () => {
    const { store, conversation, project, config } = await fixture()
    await store.saveWorkbenchConversation(conversation, 0)
    const first = reply(conversation, 2, [{ id: 'a1', role: 'assistant', text: '好的。', createdAt: now }])
    await store.saveWorkbenchConversation(first, 1)
    const cleared = await store.clearProjectMemory(project.id)
    expect(cleared).toMatchObject({ generation: 1, pendingBankDeletions: [config!.bankId], clearedAt: expect.any(String) })
    expect(cleared.bankId).not.toBe(config!.bankId)
    expect(cleared.bankId).toMatch(/^df-memory-[a-f0-9]{32}$/u)
    const rows = await store.listProjectMemoryDocuments(project.id)
    expect(rows.map((row) => [row.bankId === cleared.bankId ? 'new' : 'old', row.documentId, row.status, row.payload]).sort())
      .toEqual([['new', 'conversation:chat', 'deleted', ''], ['old', 'conversation:chat', 'deleted', '']])
    // Continuing the old conversation does not bring its history back.
    await store.saveWorkbenchConversation({ ...first, version: 3, status: 'running' }, 2)
    await store.saveWorkbenchConversation(reply(first, 4, [{ id: 'a2', role: 'assistant', text: '还有吗？', createdAt: now }]), 3)
    expect((await store.listProjectMemoryDocuments(project.id)).filter((row) => row.status !== 'deleted')).toEqual([])
    // A new conversation is learned into the new bank.
    await store.saveWorkbenchConversation({ ...conversation, id: 'chat-2' }, 0)
    await store.saveWorkbenchConversation(reply({ ...conversation, id: 'chat-2' }, 2, [{ id: 'b1', role: 'assistant', text: '好。', createdAt: now }]), 1)
    expect(await store.listProjectMemoryDocuments(project.id)).toContainEqual(expect.objectContaining({ bankId: cleared.bankId, documentId: 'conversation:chat-2', status: 'queued' }))
    // Reconfiguring keeps the generation; the old bank stays queued until deleted.
    const reconfigured = await store.configureProjectMemory({ ...cleared, providerId: 'other' })
    expect(reconfigured).toMatchObject({ bankId: cleared.bankId, generation: 1, pendingBankDeletions: [config!.bankId] })
    await store.completeProjectMemoryBankDeletion(project.id, config!.bankId)
    expect((await store.getProjectMemoryConfiguration(project.id))?.pendingBankDeletions).toBeUndefined()
  })
  it('records edited or deleted memories without invalidating in-flight captures', async () => {
    const { store, project, config } = await fixture()
    const changed = await store.markProjectMemoryChanged(project.id, 'o1')
    expect(changed.changedMemories).toEqual({ o1: expect.any(String) })
    expect(changed.updatedAt).toBe(config!.updatedAt)
    const input = { documentId: 'artifact:a1', sourceKind: 'artifact' as const, sourceId: 'a1', title: 'Doc', payload: 'x',
      context: 'A document.', tags: ['source:artifact'], occurredAt: now }
    await expect(store.recordProjectMemoryDocument(config!, input)).resolves.toMatchObject({ status: 'queued' })
  })
})
