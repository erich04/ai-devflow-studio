// @vitest-environment node
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeAgentProvider, createWorkflowRunFromRequest, runWorkflowStageAgent, type AgentProvider, type GitHubDeliveryIntent, type LocalProject } from '@ai-devflow/shared'
import { createLocalStore, type LocalStore } from './local-store'
import { WorkbenchConversationService } from './workbench-conversation-service'
import { parseConversationCommand } from './workbench-conversation-contract'
import { readWorkbenchRepository } from './workbench-repository'

const projectId = 'local-conversations'
const created = createWorkflowRunFromRequest({ runId: 'conversation-flow', title: '清除已完成任务', request: '清理已完成任务并持久化结果', projectId, creatorId: 'u-test', branchName: 'ai/test', now: '2026-09-16T10:00:00.000Z' })
let directory: string
let store: LocalStore
let project: LocalProject
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'devflow-conversations-'))
  store = await createLocalStore({ dbPath: path.join(directory, 'local.sqlite') })
  project = { id: projectId, name: '任务清单', path: path.join(directory, 'project'), packageManager: 'npm', testCommand: 'npm test', createdAt: created.run.createdAt, updatedAt: created.run.updatedAt }
  await mkdir(project.path)
  await writeFile(path.join(project.path, 'tasks.ts'), 'export const clearDone = (tasks) => tasks.filter(task => !task.done)\n')
  await store.upsertProject(project)
  await store.saveRun(created.run)
  for (const artifact of created.artifacts) await store.saveArtifact(artifact)
})
afterEach(async () => { await rm(directory, { force: true, recursive: true }) })

function harness(complete: NonNullable<AgentProvider['completeStructuredJson']>) {
  const calls: string[] = []
  const provider = { ...createFakeAgentProvider(), completeStructuredJson: vi.fn(async (input: Parameters<NonNullable<AgentProvider['completeStructuredJson']>>[0]) => { calls.push(input.userPrompt); return complete(input) }) }
  const inspectGate = vi.fn(async () => ({ canApprove: false, source: 'test policy', blockers: ['upstream'] }))
  const service = new WorkbenchConversationService({ store, resolveProvider: async () => provider,
    loadKnowledge: async (id) => ({ projectId: id, contentHash: 'knowledge-hash', indexedAt: '2026-09-16T10:00:00.000Z', truncated: false, warnings: [], documents: [], entities: [], relations: [], chunks: [{ id: 'chunk1', documentId: 'doc1', sourcePath: 'docs/product.md', headingPath: ['清理规则'], content: '清理操作只删除已完成项，保留未完成项。', contentHash: 'chunk-hash', tokenCount: 20, tags: [], updatedAt: '2026-09-16T10:00:00.000Z' }] }),
    changed: vi.fn(), inspectGate,
  })
  return { service, calls, provider, inspectGate }
}
async function create(service: WorkbenchConversationService, id = projectId) {
  return (await service.command({ type: 'create', projectId: id })).conversationId!
}
async function send(service: WorkbenchConversationService, id: string, text = '现在进行到哪里？', extra = {}) {
  await service.command({ type: 'send', projectId, conversationId: id, providerId: 'test', text, ...extra })
  await service.settled(id)
  return (await store.listWorkbenchConversations(projectId)).find((session) => session.id === id)!
}

describe('unified conversation execution and boundaries', () => {
  it.each(['completed', 'approval_required'] as const)('exposes actual publication facts for a %s delivery without leaking unrelated records or internal metadata', async (status) => {
    const node = created.run.nodes.find((item) => item.kind === 'pr')!
    const stamp = created.run.updatedAt
    const intent: GitHubDeliveryIntent = {
      stateVersion: 1, id: 'delivery-current', organizationId: 'org-test', teamProjectId: 'team-test',
      localProjectId: projectId, runId: created.run.id, runVersion: created.run.version, nodeId: node.id,
      repositoryBindingId: 'internal-binding', repositoryBindingVersion: 1, installationId: 'internal-installation', repositoryId: 'repository-1',
      codingRunId: 'coding-1', codingRunCompletedAt: stamp, workspaceId: 'internal-workspace',
      deliverySeriesKey: 'internal-series', deliveryAttempt: 1, repository: 'example/task-list', baseBranch: 'main', headBranch: 'devflow/task-list',
      baseCommitSha: 'a'.repeat(40), expectedCommitSha: 'b'.repeat(40), diffArtifactId: 'diff-1', diffSourceDigest: 'c'.repeat(64),
      testEvidenceId: 'test-1', testEvidenceCreatedAt: stamp, testEvidenceDigest: 'd'.repeat(64),
      prPackageArtifactId: 'pr-1', prPackageUpdatedAt: stamp, prPackageDigest: 'e'.repeat(64), changedPaths: ['tasks.ts'],
      intentDigest: 'f'.repeat(64), idempotencyKey: 'internal-idempotency-key', status, createdAt: stamp, updatedAt: stamp, redacted: true,
      ...(status === 'completed' ? { completion: {
        stateVersion: 1, remoteRequestId: 'internal-request', publicationId: 'internal-publication', pullRequestOutcomeId: 'internal-outcome',
        pullRequestId: '123', pullRequestNumber: 3, pullRequestUrl: 'https://github.com/example/task-list/pull/3',
        providerCreatedAt: stamp, recordedAt: stamp, draft: true, redacted: true,
      } } : {}),
    }
    const state = await store.loadState()
    vi.spyOn(store, 'loadState').mockResolvedValue({ ...state, githubDeliveryIntents: [
      intent,
      { ...intent, id: 'foreign-run-delivery', runId: 'foreign-run' },
      { ...intent, id: 'foreign-project-delivery', localProjectId: 'foreign-project' },
    ] })
    let step = 0
    const { service, calls } = harness(async () => ({ value: step++ === 0
      ? { tool: { name: 'node', args: { runId: created.run.id, nodeId: node.id } } }
      : { text: '已读取真实发布记录。' } }))
    await send(service, await create(service), '请查询这个项目的实际 PR 链接和交付 commit。')
    const delivery = JSON.parse(calls[1]!).toolObservations[0].result.execution.delivery
    expect(delivery).toEqual([{
      id: intent.id, nodeId: node.id, status, repository: intent.repository, baseBranch: intent.baseBranch, headBranch: intent.headBranch,
      expectedCommitSha: intent.expectedCommitSha, updatedAt: stamp,
      ...(status === 'completed' ? { completion: {
        pullRequestNumber: 3, pullRequestUrl: 'https://github.com/example/task-list/pull/3', draft: true, providerCreatedAt: stamp, recordedAt: stamp,
      } } : {}),
    }])
    expect(calls[1]).not.toMatch(/internal-|foreign-run-delivery|foreign-project-delivery/)
  })

  it.each(created.run.nodes.map((node) => [node.id, node] as const))('reads the real %s node, including every stage and node type', async (_id, node) => {
    let step = 0
    const { service, calls, inspectGate } = harness(async () => ({ value: step++ === 0 ? { tool: { name: 'node', args: { runId: created.run.id, nodeId: node.id } } } : { text: `已查询 ${node.title}`, actions: [{ label: '定位到节点', runId: created.run.id, nodeId: node.id, section: node.kind === 'test' ? '测试证据' : '状态' }] } }))
    const result = await send(service, await create(service))
    expect(result.status).toBe('idle')
    const context = JSON.parse(calls[1]!)
    expect(context.latestWorkflow.runs[0].nodes).toHaveLength(created.run.nodes.length)
    expect(context.toolObservations[0].result.node).toMatchObject({ id: node.id, kind: node.kind, status: node.status })
    expect(result.messages.at(-1)?.actions?.[0]).toMatchObject({ runId: created.run.id, nodeId: node.id })
    expect(inspectGate).toHaveBeenCalledTimes(['gate', 'acceptance'].includes(node.kind) ? 1 : 0)
  })

  it('investigates actual code and knowledge, then persists a question and resumes it', async () => {
    let step = 0
    const outputs = [
      { tool: { name: 'repo_read', args: { path: 'tasks.ts' } } },
      { tool: { name: 'knowledge', args: { query: '清理' } } },
      { text: '代码用 filter 保留未完成项，知识要求相同。需要确定撤销行为。', question: { prompt: '需要撤销吗？', options: ['需要', '不需要'] }, citationIds: ['source-1', 'source-2'] },
      { text: '已记录，本次不提供撤销。' },
    ]
    const { service, calls } = harness(async () => ({ value: outputs[step++]! }))
    const id = await create(service)
    const first = await send(service, id, '结合代码和知识澄清清理功能。')
    expect(first.status).toBe('awaiting_answer')
    expect(calls[2]).toContain('tasks.filter')
    expect(calls[2]).toContain('清理操作只删除已完成项')
    const question = first.messages.at(-1)!
    expect(question.citations).toHaveLength(2)
    const resumed = await send(service, id, '不需要', { answerToMessageId: question.id })
    expect(resumed.status).toBe('idle')
    expect(resumed.messages.find((item) => item.id === question.id)?.question?.answeredAt).toBeTruthy()
    expect(calls[3]).toContain('需要撤销吗')
  })

  it('keeps unanswered questions while the same chat asks about another node', async () => {
    let step = 0
    const { service } = harness(async () => ({ value: step++ === 0 ? { text: '请补充。', question: { prompt: '是否撤销？', options: [] } } : { text: '测试尚未执行。' } }))
    const id = await create(service)
    await send(service, id)
    const result = await send(service, id, '先告诉我测试节点的进度')
    expect(result.status).toBe('awaiting_answer')
    expect(result.messages.find((message) => message.question)?.question?.answeredAt).toBeUndefined()
  })

  it('isolates histories, memory and private drafts while querying fresh common workflow and published proposals', async () => {
    const node = created.run.nodes[0]!
    let value: Record<string, unknown> = { text: 'PRIVATE_A_REPLY', draft: { runId: created.run.id, nodeId: node.id, title: '共同提案', content: '仅删除已完成的任务。' } }
    const { service, calls } = harness(async () => ({ value }))
    const a = await create(service); const b = await create(service)
    await service.command({ type: 'update', projectId, conversationId: a, memory: 'PRIVATE_A_MEMORY' })
    const draft = await send(service, a, 'PRIVATE_A_MESSAGE')
    value = { text: '项目目前仍在需求澄清。' }
    await send(service, b, 'PRIVATE_B_MESSAGE')
    expect(calls.at(-1)).not.toMatch(/PRIVATE_A|共同提案|仅删除已完成的任务/)
    expect((await store.listArtifacts()).some((artifact) => artifact.title.includes('共同提案'))).toBe(false)
    await service.command({ type: 'publish', projectId, conversationId: a, messageId: draft.messages.at(-1)!.id })
    const artifact = (await store.listArtifacts()).find((item) => item.title.includes('共同提案'))!
    expect(artifact.kind).toBe('log')
    expect((await store.getRun(created.run.id))?.version).toBe(created.run.version)
    expect((await store.getRun(created.run.id))?.currentNodeId).toBe(created.run.currentNodeId)
    let round = 0
    const shared = harness(async () => ({ value: round++ === 0 ? { tool: { name: 'artifact', args: { runId: created.run.id, artifactId: artifact.id } } } : { text: '已查到待确认的共同提案。' } }))
    await send(shared.service, b, '查看新的共同提案。')
    expect(shared.calls[1]).toContain('仅删除已完成的任务')
    expect(shared.calls.join('')).not.toMatch(/PRIVATE_A/)
    await store.saveRun({ ...created.run, title: 'UPDATED_SHARED_TITLE', version: created.run.version + 1 })
    await send(service, b, '现在呢？')
    expect(calls.at(-1)).toContain('UPDATED_SHARED_TITLE')
    expect(JSON.stringify(await store.loadState())).not.toMatch(/PRIVATE_A|PRIVATE_B/)
  })

  it('passes only explicitly published proposals into the real stage artifact generator', async () => {
    const node = created.run.nodes[0]!
    const { service } = harness(async () => ({ value: { text: '请核对提案。', draft: { runId: created.run.id, nodeId: node.id, title: '验收补充', content: '本次不增加撤销；空列表不执行删除。' } } }))
    const id = await create(service)
    const conversation = await send(service, id, 'PRIVATE_INPUT_NOT_SHARED')
    await service.command({ type: 'publish', projectId, conversationId: id, messageId: conversation.messages.at(-1)!.id })
    const provider = createFakeAgentProvider()
    const generate = provider.generateWorkflowArtifact!
    const contexts: string[] = []
    provider.generateWorkflowArtifact = async (input) => {
      contexts.push(JSON.stringify(input.context))
      return generate(input)
    }
    const result = await runWorkflowStageAgent({ run: created.run, node, artifacts: await store.listArtifacts(created.run.id), provider, requestedBy: 'u-test', runtime: 'electron' })
    expect(result.artifact.kind).toBe('clarification')
    expect(contexts[0]).toContain('本次不增加撤销；空列表不执行删除。')
    expect(contexts[0]).toContain('待确认')
    expect(contexts[0]).not.toContain('PRIVATE_INPUT_NOT_SHARED')
  })

  it('keeps two concurrently running conversations independent', async () => {
    let entered!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => { entered = resolve })
    const hold = new Promise<void>((resolve) => { release = resolve })
    const { service } = harness(async (input) => {
      if (input.userPrompt.includes('PRIVATE_SLOW')) { entered(); await hold }
      return { value: { text: input.userPrompt.includes('PRIVATE_SLOW') ? '慢会话完成' : '快会话完成' } }
    })
    const a = await create(service); const b = await create(service)
    await service.command({ type: 'send', projectId, conversationId: a, providerId: 'test', text: 'PRIVATE_SLOW' })
    await started
    const second = await send(service, b, 'PRIVATE_FAST')
    expect(second.messages.at(-1)?.text).toBe('快会话完成')
    expect((await store.listWorkbenchConversations(projectId)).find((item) => item.id === a)?.status).toBe('running')
    release(); await service.settled(a)
    expect((await store.listWorkbenchConversations(projectId)).find((item) => item.id === a)?.messages.at(-1)?.text).toBe('慢会话完成')
    expect(second.messages.some((message) => message.role === 'notice' && message.provider && !message.usage)).toBe(true)
  })

  it('fits large history and tool observations inside the real structured Provider limit', async () => {
    const artifact = { ...created.artifacts[0]!, id: 'large-artifact', kind: 'log' as const, content: '调查记录'.repeat(5000) }
    await store.saveArtifact(artifact)
    let step = 0
    const { service, calls } = harness(async (input) => {
      expect(input.userPrompt.length).toBeLessThanOrEqual(32000)
      return { value: step++ === 0 ? { tool: { name: 'artifact', args: { runId: created.run.id, artifactId: artifact.id } } } : { text: '已读取部分依据，可以继续分段查询。' } }
    })
    const id = await create(service)
    const current = (await store.listWorkbenchConversations(projectId))[0]!
    await store.saveWorkbenchConversation({ ...current, version: 2, memory: '会话记忆'.repeat(1500), messages: Array.from({ length: 6 }, (_, index) => ({ id: `history-${index}`, role: 'user' as const, text: '历史讨论'.repeat(1300), createdAt: created.run.createdAt })) }, 1)
    const result = await send(service, id, '最新问题'.repeat(2500))
    expect(result.status).toBe('idle')
    expect(calls[1]).toContain('上下文受长度限制')
    expect(result.contextReceipt?.limited).toBe(true)
    expect(result.messages.filter((message) => message.role === 'user')).toHaveLength(7)
  })

  it('queries runs beyond the first overview page without changing project scope', async () => {
    for (let index = 0; index < 35; index++) {
      const other = createWorkflowRunFromRequest({ runId: `history-run-${index}`, title: `历史任务 ${index}`, request: '另一条真实流程', projectId, creatorId: 'u-test', branchName: `ai/history-${index}`, now: created.run.createdAt })
      await store.saveRun(other.run)
    }
    let step = 0
    const { service, calls } = harness(async () => ({ value: step++ === 0 ? { tool: { name: 'workflow', args: { offset: 30 } } } : { text: '已查询剩余流程。' } }))
    const result = await send(service, await create(service))
    expect(result.status).toBe('idle')
    const observed = JSON.parse(calls[1]!).toolObservations[0].result
    expect(observed).toMatchObject({ totalRuns: 36, offset: 30, nextOffset: null })
    expect(observed.runs).toHaveLength(6)
    expect(result.contextReceipt?.limited).toBe(true)
  })

  it('keeps credential failure actionable before any Provider request', async () => {
    const service = new WorkbenchConversationService({ store, resolveProvider: async () => { throw new Error('safeStorage decryption failed') }, loadKnowledge: async () => { throw new Error('must not run') }, changed: vi.fn() })
    const result = await send(service, await create(service))
    expect(result.status).toBe('failed')
    expect(result.error).toContain('重新保存 API Key')
    expect(result.failure).toMatchObject({ phase: 'resolve_provider', code: 'Error' })
    expect(result.messages.some((message) => message.provider)).toBe(false)
  })

  it('rejects another project’s conversation, node targets and actions', async () => {
    const { service } = harness(async () => ({ value: { text: '错误引用', actions: [{ label: '打开', runId: 'foreign', nodeId: 'secret', section: '状态' }] } }))
    await store.upsertProject({ ...project, id: 'other' })
    const id = await create(service)
    await expect(service.command({ type: 'update', projectId: 'other', conversationId: id, memory: 'leak' })).rejects.toThrow('当前项目中没有')
    const result = await send(service, id)
    expect(result.status).toBe('failed')
    expect(result.messages.some((message) => message.actions?.length)).toBe(false)
    expect(() => parseConversationCommand({ type: 'send', projectId, conversationId: id, text: 'x', providerId: 'x', localPath: '/etc' })).toThrow()
  })

  it('recovers tabs, input, isolated memory and unanswered questions across SQLite restarts', async () => {
    const { service } = harness(async () => ({ value: { text: '需要回答。', question: { prompt: '要支持撤销吗？', options: [] } } }))
    const id = await create(service)
    await send(service, id)
    await service.command({ type: 'update', projectId, conversationId: id, isOpen: false, inputDraft: '还没发出的答案', memory: '只属于本会话' })
    store = await createLocalStore({ dbPath: path.join(directory, 'local.sqlite') })
    const restarted = harness(async () => { throw new Error('must not call') })
    await restarted.service.recoverInterrupted()
    const session = (await restarted.service.command({ type: 'list', projectId })).conversations[0]!
    expect(session).toMatchObject({ id, isOpen: false, inputDraft: '还没发出的答案', memory: '只属于本会话', status: 'awaiting_answer' })
    expect(session.messages.at(-1)?.question?.prompt).toBe('要支持撤销吗？')
    expect(restarted.calls).toHaveLength(0)
    await store.saveWorkbenchConversation({ ...session, version: session.version + 1, status: 'running' }, session.version)
    await restarted.service.recoverInterrupted()
    expect((await store.listWorkbenchConversations(projectId))[0]?.status).toBe('interrupted')
    expect(restarted.calls).toHaveLength(0)
  })

  it('cancels a provider call, retains usage and retries without duplicating the user message', async () => {
    let started!: () => void
    const beginning = new Promise<void>((resolve) => { started = resolve })
    let retry = false
    const { service } = harness(async ({ signal }) => {
      if (retry) return { value: { text: '重试完成。' }, usage: { inputTokens: 12, outputTokens: 3 } }
      started()
      await new Promise<void>((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }))
      return { value: {} }
    })
    const id = await create(service)
    await service.command({ type: 'send', projectId, conversationId: id, text: '请调查', providerId: 'test' })
    await beginning
    await expect(service.command({ type: 'send', projectId, conversationId: id, text: '重复', providerId: 'test' })).rejects.toThrow('正在调查')
    await service.command({ type: 'cancel', projectId, conversationId: id })
    await service.settled(id)
    expect((await store.listWorkbenchConversations(projectId))[0]?.status).toBe('cancelled')
    retry = true
    await service.command({ type: 'retry', projectId, conversationId: id, providerId: 'test' })
    await service.settled(id)
    const result = (await store.listWorkbenchConversations(projectId))[0]!
    expect(result.status).toBe('idle')
    expect(result.messages.filter((message) => message.role === 'user')).toHaveLength(1)
    expect(result.messages.find((message) => message.usage)?.usage).toMatchObject({ inputTokens: 12, outputTokens: 3 })
  })

  it('bounds tool loops and reports malformed output without fabricating success', async () => {
    const loop = harness(async () => ({ value: { tool: { name: 'shell', args: { command: 'touch compromised' } } } }))
    const result = await send(loop.service, await create(loop.service))
    expect(loop.calls).toHaveLength(12)
    expect(result.status).toBe('failed')
    expect(result.error).toContain('12 次')
    const malformed = harness(async () => ({ value: { question: { options: 'bad' } } }))
    expect((await send(malformed.service, await create(malformed.service))).status).toBe('failed')
  })
})

describe('conversation read-only repository tools', () => {
  it('reads/searches real files and blocks traversal, symlinks and credential files', async () => {
    const signal = new AbortController().signal
    expect(await readWorkbenchRepository(project.path, { operation: 'search', query: 'clearDone' }, signal)).toMatchObject({ matches: [{ path: 'tasks.ts', line: 1 }] })
    for (const file of ['../local.sqlite', '.env', '/etc/passwd', 'C:\\secrets', '.git/config']) {
      await expect(readWorkbenchRepository(project.path, { operation: 'read', path: file }, signal)).rejects.toThrow()
    }
    await writeFile(path.join(project.path, 'large.md'), '中文需求'.repeat(5000))
    expect(await readWorkbenchRepository(project.path, { operation: 'read', path: 'large.md' }, signal)).toMatchObject({ truncated: true, content: expect.stringContaining('中文需求') })
    const outside = path.join(directory, 'outside.txt')
    await writeFile(outside, 'secret')
    await symlink(outside, path.join(project.path, 'link.txt'))
    await expect(readWorkbenchRepository(project.path, { operation: 'read', path: 'link.txt' }, signal)).rejects.toThrow('符号链接')
    expect(JSON.stringify(await readWorkbenchRepository(project.path, { operation: 'list' }, signal))).not.toContain('link.txt')
  })
})
