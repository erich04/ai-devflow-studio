// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { createWorkflowRunFromRequest, type Artifact, type CodingAgentRun, type LocalProject } from '@ai-devflow/shared'
import { createLocalStore } from './local-store'
import type { WorkbenchConversation } from './workbench-conversation-contract'
const directories: string[] = []
const now = new Date().toISOString()
afterEach(async () => { await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true }))) })
async function fixture(enabled = true) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'devflow-auto-capture-')); directories.push(directory)
  const dbPath = path.join(directory, 'db.sqlite')
  const store = await createLocalStore({ dbPath })
  const project: LocalProject = { id: 'project', name: 'Synthetic', path: directory, packageManager: 'pnpm', detectedTestCommand: 'pnpm test', testCommand: 'pnpm test', createdAt: now, updatedAt: now }
  await store.upsertProject(project)
  const owner = await store.resolveLocalProjectMemoryPrincipal(project.id)
  if (owner.status !== 'resolved') throw new Error('No principal')
  const hindsight = await store.configureHindsight({ projectId: project.id, ownerUserId: owner.userId, projectPath: directory,
    knowledgeRoot: 'docs', rootGeneration: 'fixture', endpoint: 'http://127.0.0.1:8888', encryptedApiKey: null,
    enabled: true, includeMemories: false, selectedPaths: [], modelDigest: 'model', model: { version: 'v1', dimensions: [{ key: 'sem_kind', type: 'text' }] } })
  if (enabled) await store.configureAutomaticMemory({ projectId: project.id, ownerUserId: owner.userId, hindsightGeneration: hindsight.generation, enabled: true, maxRetainsPerDay: 10 })
  const conversation: WorkbenchConversation = { id: 'chat', localProjectId: project.id, version: 1, title: 'Synthetic', isOpen: true,
    inputDraft: '', status: 'running', messages: [{ id: 'user', role: 'user', text: '请用中文回答。', createdAt: now }], createdAt: now, updatedAt: now }
  return { store, dbPath, owner, project, conversation }
}
describe('durable host completion capture', () => {
  it('atomically enqueues a completed chat once and keeps it after restart', async () => {
    const { store, dbPath, conversation } = await fixture()
    await store.saveWorkbenchConversation(conversation, 0)
    expect(await store.listMemoryLearningJobs()).toEqual([])
    const completed = { ...conversation, version: 2, status: 'idle' as const, messages: [...conversation.messages, { id: 'reply', role: 'assistant' as const, text: '好的。', createdAt: now }] }
    await store.saveWorkbenchConversation(completed, 1)
    expect(await store.listMemoryLearningJobs()).toHaveLength(1)
    await store.saveWorkbenchConversation({ ...completed, version: 3 }, 2)
    expect(await store.listMemoryLearningJobs()).toHaveLength(1)
    store.close()
    const reopened = await createLocalStore({ dbPath })
    expect(await reopened.listMemoryLearningJobs()).toHaveLength(1)
    reopened.close()
  })
  it('does not inherit ordinary Hindsight consent for new chat sources', async () => {
    const { store, conversation } = await fixture(false)
    await store.saveWorkbenchConversation(conversation, 0)
    await store.saveWorkbenchConversation({ ...conversation, version: 2, status: 'idle', messages: [...conversation.messages,
      { id: 'reply', role: 'assistant', text: '好的。', createdAt: now }] }, 1)
    expect(await store.listMemoryLearningJobs()).toEqual([])
    store.close()
  })
  it('captures formal stage writes without granting them business approval', async () => {
    const { store, owner, project } = await fixture()
    const creation = createWorkflowRunFromRequest({ runId: 'run', title: 'Synthetic', request: 'Todo fixture', projectId: project.id, creatorId: owner.userId, branchName: 'devflow/fixture', now })
    await store.createWorkflow(creation)
    const artifact: Artifact = { id: 'design', runId: creation.run.id, nodeId: creation.run.nodes[0]!.id, kind: 'design', title: 'Design', summary: 'Synthetic', redacted: false, content: '删除任务必须支持撤销。', updatedAt: now }
    await store.saveArtifact(artifact)
    const jobs = await store.listMemoryLearningJobs()
    expect(jobs).toHaveLength(1)
    const event = await store.getMemoryLearningEvent(jobs[0]!.eventId)
    expect(event?.sourceKind).toBe('stage_completion')
    expect(event?.materials[0]?.evidence).toBeUndefined()
    store.close()
  })
  it.each(['native', 'opencode-http'] as const)('captures verified %s coding completion once through the atomic mutation path', async (engine) => {
    const { store, owner, project } = await fixture()
    const creation = createWorkflowRunFromRequest({ runId: 'run', title: 'Synthetic', request: 'Todo fixture', projectId: project.id, creatorId: owner.userId, branchName: 'devflow/fixture', now })
    await store.createWorkflow(creation)
    const nodeId = creation.run.nodes.find(node => node.stage === 'build' && node.kind === 'task')!.id
    const coding: CodingAgentRun = { id: 'coding', runId: creation.run.id, projectId: project.id, nodeId, requestedBy: owner.userId,
      providerId: 'synthetic', engine, status: 'testing', branchName: 'devflow/fixture', userInstruction: 'Fixture', prompt: 'Fixture',
      summary: 'Fixture', changedPaths: ['tasks.js'], startedAt: now, redacted: false }
    await store.saveCodingAgentRun(coding)
    await store.saveTestEvidence({ id: 'passed', runId: creation.run.id, projectId: project.id, nodeId, command: project.testCommand,
      cwd: project.path, status: 'passed', exitCode: 0, durationMs: 1, stdout: 'Synthetic success', stderr: '', summary: 'Passed', redacted: false, createdAt: now })
    const completed = { ...coding, status: 'completed' as const, completedAt: now, testEvidenceId: 'passed', diffArtifactId: 'diff' }
    expect(await store.commitCodingAgentMutation({ expectedRun: coding, expectedPendingPermissionRequestIds: [], run: completed,
      diffArtifacts: [{ id: 'diff', runId: creation.run.id, projectId: project.id, nodeId, changedPaths: ['tasks.js'], patch: '+ok', truncated: false, redacted: false, sanitizerVersion: 2, sanitizedAt: now, secretReplacementCount: 0, createdAt: now }] })).toMatchObject({ committed: true })
    const jobs = await store.listMemoryLearningJobs()
    expect(jobs).toHaveLength(1)
    expect((await store.getMemoryLearningEvent(jobs[0]!.eventId))?.materials[0]).toMatchObject({ role: 'tool', text: 'command: pnpm test\nexitCode: 0' })
    await store.saveCodingAgentRun(completed)
    expect(await store.listMemoryLearningJobs()).toHaveLength(1)
    store.close()
  })
})
