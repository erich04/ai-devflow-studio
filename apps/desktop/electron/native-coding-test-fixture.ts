import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { buildCodingBrief, createFakeAgentProvider, createWorkflowRunFromRequest, type AgentProvider, type NativeToolCall } from '@ai-devflow/shared'
import { createLocalStore } from './local-store'
import { createNativeCodingExecutorV3 } from './native-coding-harness'

/** Only the model endpoint is replaced. Git, SQLite, tools, processes and approval are real. */
export async function codingHarnessFixture(model: NonNullable<AgentProvider['completeNativeConversation']>, testCommand = 'node -e "process.exit(0)"') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devflow-harness-lifecycle-'))
  const delivery = path.join(root, 'delivery'); await mkdir(delivery)
  await writeFile(path.join(delivery, 'value.ts'), 'export const value = 1\n')
  await writeFile(path.join(delivery, 'package.json'), '{"private":true}')
  const git = (args: string[]) => promisify(execFile)('git', args, { cwd: delivery })
  await git(['init', '--quiet']); await git(['add', '.']); await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'base'])
  const store = await createLocalStore({ dbPath: path.join(root, 'local.sqlite') }), now = new Date().toISOString()
  const project = { id: 'project', name: 'test', path: delivery, packageManager: 'npm' as const, testCommand, createdAt: now, updatedAt: now }
  await store.upsertProject(project)
  const { run } = createWorkflowRunFromRequest({ runId: 'workflow', title: 'Review', request: 'Inspect value', projectId: project.id, creatorId: 'user', branchName: 'test', now })
  await store.saveRun(run)
  const node = run.nodes.find(item => item.stage === 'build' && item.kind === 'task')!
  const provider = { ...createFakeAgentProvider(), supportsNativeTools: true, serializeNativeRequest: (input: unknown) => JSON.stringify(input), completeNativeConversation: model }
  const executor = createNativeCodingExecutorV3({ store, root: path.join(root, 'harness'), configVersion: 1, provider })
  const workspace = { id: 'workspace', projectId: project.id, codingRunId: 'coding', sourcePath: delivery, worktreePath: delivery, branchName: 'test', baseBranch: 'main', baseCommitSha: (await git(['rev-parse', 'HEAD'])).stdout.trim(), createdAt: now }
  const context = { id: 'coding', run, node, project, workspace, requestedBy: 'user', providerId: provider.id, userInstruction: 'Inspect value', now, upstreamArtifacts: [], knowledgeReferences: [], governanceChecks: [], gateDecisions: [], testEvidence: [], brief: buildCodingBrief({ project, worktreePath: delivery, branchName: workspace.branchName, run, node, userInstruction: 'Inspect value', upstreamArtifacts: [], knowledgeReferences: [], governanceChecks: [], gateDecisions: [], testEvidence: [] }) }
  const started = await executor.start({ request: { stateVersion: 1, id: 'coding', executor: { id: executor.descriptor.id, version: 3 }, scope: { organizationId: null, projectId: null, userId: 'user', sessionId: 'local', localProjectId: project.id, managedWorkspaceId: workspace.id }, authority: { runId: run.id, nodeId: node.id, runVersion: run.version, policyVersion: 1 }, objectiveDigest: 'b'.repeat(64), contextDigest: 'c'.repeat(64), requiredCapabilities: ['workspace_read'], budget: { maxTokens: 10000, maxCostUsd: 1 }, expectedCheckpointVersion: 0, requestedAt: now, deadline: new Date(Date.now() + 60_000).toISOString() }, runtimeContext: context })
  if (started.kind !== 'harness') throw new Error('Expected harness protocol')
  await store.saveCodingAgentRun(started.codingRun)
  const get = (codingRunId = 'coding') => executor.harness!.command({ protocolVersion: 2, type: 'get', codingRunId }, async () => {})
  const authorize = async () => executor.harness!.command({ protocolVersion: 2, type: 'authorize', codingRunId: 'coding', commandId: 'authorize', expectedVersion: (await get()).snapshot.version, profile: 'trusted_local' }, async () => {})
  return { root, delivery, store, executor, get, authorize, provider, context }
}

export function codingToolReply(id: string, name: string, args: unknown) {
  const toolCalls: NativeToolCall[] = [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }]
  return { kind: 'tools' as const, toolCalls, assistantMessage: { role: 'assistant' as const, content: null, tool_calls: toolCalls }, usage: { inputTokens: 10, outputTokens: 5 } }
}
