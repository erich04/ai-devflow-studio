// @vitest-environment node
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterEach, expect, it, vi } from 'vitest'
import { buildCodingBrief, createFakeAgentProvider, createWorkflowRunFromRequest, parseCodingExecutorDescriptor } from '@ai-devflow/shared'
import { createLocalStore } from './local-store'
import { createNativeCodingExecutorV3 } from './native-coding-harness'

const directories: string[] = []
it('requires a real human execution grant and then exposes a frozen revision through the versioned executor', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devflow-harness-')); directories.push(root)
  const delivery = path.join(root, 'delivery'); await mkdir(delivery); await writeFile(path.join(delivery, 'value.ts'), 'export const value = 1\n')
  await writeFile(path.join(delivery, 'package.json'), '{"private":true}')
  const git = (args: string[]) => promisify(execFile)('git', args, { cwd: delivery })
  await git(['init', '--quiet']); await git(['add', '.']); await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'base'])
  const store = await createLocalStore({ dbPath: path.join(root, 'local.sqlite') }), now = new Date().toISOString()
  const project = { id: 'project', name: 'test', path: delivery, packageManager: 'npm' as const, testCommand: 'node -e "process.exit(0)"', createdAt: now, updatedAt: now }
  await store.upsertProject(project)
  const fixture = createWorkflowRunFromRequest({ runId: 'workflow', title: 'Review', request: 'Inspect existing value', projectId: project.id, creatorId: 'user', branchName: 'test', now })
  await store.saveRun(fixture.run)
  const node = fixture.run.nodes.find(item => item.stage === 'build' && item.kind === 'task')!
  const model = vi.fn(async () => {
    const toolCalls = [{ id: 'freeze', type: 'function' as const, function: { name: 'propose_changeset', arguments: '{"summary":"No change needed"}' } }]
    return { kind: 'tools' as const, toolCalls, assistantMessage: { role: 'assistant' as const, content: null, tool_calls: toolCalls } }
  })
  const executor = createNativeCodingExecutorV3({ store, root: path.join(root, 'harness'), configVersion: 1,
    provider: { ...createFakeAgentProvider(), supportsNativeTools: true, serializeNativeRequest: input => JSON.stringify(input), completeNativeConversation: model } })
  expect(parseCodingExecutorDescriptor(executor.descriptor)).toEqual(executor.descriptor)
  const workspace = { id: 'workspace', projectId: project.id, codingRunId: 'coding', sourcePath: delivery, worktreePath: delivery, branchName: 'test', baseBranch: 'main', baseCommitSha: (await git(['rev-parse', 'HEAD'])).stdout.trim(), createdAt: now }
  const context = { id: 'coding', run: fixture.run, node, project, workspace, requestedBy: 'user', providerId: 'fake', userInstruction: 'Inspect value', now, upstreamArtifacts: [], knowledgeReferences: [], governanceChecks: [], gateDecisions: [], testEvidence: [], brief: buildCodingBrief({ project, worktreePath: delivery, branchName: workspace.branchName, run: fixture.run, node, userInstruction: 'Inspect value', upstreamArtifacts: [], knowledgeReferences: [], governanceChecks: [], gateDecisions: [], testEvidence: [] }) }
  const first = await executor.start({ request: { stateVersion: 1, id: 'coding', executor: { id: executor.descriptor.id, version: 3 }, scope: { organizationId: null, projectId: null, userId: 'user', sessionId: 'local', localProjectId: project.id, managedWorkspaceId: workspace.id }, authority: { runId: fixture.run.id, nodeId: node.id, runVersion: fixture.run.version, policyVersion: 1 }, objectiveDigest: 'b'.repeat(64), contextDigest: 'c'.repeat(64), requiredCapabilities: ['workspace_read'], budget: { maxTokens: 10000, maxCostUsd: 1 }, expectedCheckpointVersion: 0, requestedAt: now, deadline: new Date(Date.now() + 60_000).toISOString() }, runtimeContext: context })
  expect(first.kind).toBe('harness'); expect(model).not.toHaveBeenCalled()
  if (first.kind !== 'harness') throw new Error('Expected harness protocol')
  await store.saveCodingAgentRun(first.codingRun)
  await executor.harness!.command({ protocolVersion: 2, type: 'authorize', codingRunId: 'coding', commandId: 'authorize-1', expectedVersion: first.snapshot.version, profile: 'trusted_local' }, async () => {})
  await executor.settled('coding')
  const ready = await executor.harness!.command({ protocolVersion: 2, type: 'get', codingRunId: 'coding' }, async () => {})
  expect(ready.snapshot.status, JSON.stringify(ready.snapshot)).toBe('review')
  expect(ready.snapshot.revision?.summary).toBe('No change needed')
  expect(ready.snapshot.messages.some(message => message.text.includes('reasoning_content'))).toBe(false)
  const approval = { protocolVersion: 2 as const, type: 'approve' as const, codingRunId: 'coding', commandId: 'approve-1', expectedVersion: ready.snapshot.version, objectiveVersion: ready.snapshot.objectiveVersion, revisionDigest: ready.snapshot.revision!.digest }
  const approved = await executor.harness!.command(approval, async () => {})
  expect(approved.snapshot.status, JSON.stringify(approved.snapshot)).toBe('completed')
  expect(approved.completion?.testEvidence?.status).toBe('passed')
  const again = await executor.harness!.command(approval, async () => {})
  expect(again.completion?.testEvidence?.id).toBe(approved.completion?.testEvidence?.id)
  expect(model).toHaveBeenCalledTimes(1)
  await store.saveCodingAgentRun({ ...approved.codingRun, status: 'completed', completedAt: now, diffArtifactId: approved.completion!.diff.id })
  await writeFile(path.join(delivery, 'value.ts'), 'external change')
  const historical = await executor.harness!.command({ protocolVersion: 2, type: 'get', codingRunId: 'coding' }, async () => {})
  expect(historical.snapshot.status).toBe('completed')
  expect(historical.snapshot.evidence.some(item => item.status === 'historical_content_changed')).toBe(true)
  expect(historical.completion).toBeUndefined()
  await store.close()
})
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))) })
