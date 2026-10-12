/** Isolated process for event-driven live-model interruption experiments. */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { createOpenAiCompatibleAgentProvider, governAgentProvider, buildCodingBrief, createWorkflowRunFromRequest, type AgentProvider, type CodingHarnessCommand, type Artifact } from '../packages/shared/src/index.ts'
import { createLocalStore } from '../apps/desktop/electron/local-store.ts'
import { createNativeCodingExecutorV3 } from '../apps/desktop/electron/native-coding-harness.ts'
import { createEvaluationLedger, evaluationUsage, saveJson, digest } from './native-coding-live-support.ts'

const [configPath, keyPath, mode = 'new'] = process.argv.slice(2)
if (!configPath || !keyPath) throw new Error('Expected configuration and private credential file')
const config = JSON.parse(await readFile(configPath, 'utf8'))
const root: string = config.root, delivery = path.join(root, 'delivery'), apiKey = (await readFile(keyPath, 'utf8')).trim()
await mkdir(root, { recursive: true })
const send = (value: unknown) => { if (process.connected) process.send?.(value) }
const ledger = await createEvaluationLedger({ file: path.join(root, 'ledger.json'), projectId: 'interactive', maxCalls: 192, maxCostUsd: 100 })
const store = await createLocalStore({ dbPath: path.join(root, 'local.sqlite') })
let heldHeaders = false, announcedTools = false, announcedApplication = false
const raw = createOpenAiCompatibleAgentProvider({ id: 'deepseek-interactive', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com', apiKey, thinking: { mode: 'enabled', effort: 'high' }, structuredRequestTimeoutMs: 180000,
  fetcher: async (url, init) => {
    const response = await fetch(url, init)
    if (mode === 'new' && config.holdFirstResponse && !heldHeaders) {
      heldHeaders = true; await saveJson(path.join(root, 'fault-model-headers.json'), { at: new Date().toISOString(), status: response.status, pid: process.pid })
      send({ event: 'model_headers', httpStatus: response.status })
      await new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('Interrupted before response parsing')), { once: true }))
    }
    return response
  } })
const capped: AgentProvider = { ...raw, resolveRequestPolicy: input => raw.resolveRequestPolicy!({ ...input, maxOutputTokens: Math.min(input.maxOutputTokens ?? 16384, 16384) }) }
const governed = governAgentProvider(capped, 'interactive', ledger)
let calls = 0
const provider: AgentProvider = { ...governed, completeNativeConversation: async request => {
  const index = `${mode}-${calls++}`
  if (!announcedTools && request.messages.some(message => message.role === 'tool')) { announcedTools = true; send({ event: 'after_tools' }) }
  const file = path.join(root, `model-${index}.json`)
  await saveJson(file, { request: { ...request, signal: undefined }, startedAt: new Date().toISOString() })
  const result = await governed.completeNativeConversation!(request)
  await saveJson(file, { request: { ...request, signal: undefined }, result, completedAt: new Date().toISOString() })
  return result
} }
const executor = createNativeCodingExecutorV3({ store, provider, root: path.join(root, 'harness'), configVersion: 1, changed: id => send({ event: 'changed', codingRunId: id }) })
const authority = async () => {
  if (mode !== 'new' || !config.holdApplication || announcedApplication) return
  const session = await store.getNativeCodingSession('native-coding')
  if (!session?.binding) return
  const transactions = path.join(session.binding.workspaceRoot, 'transactions')
  let files: string[]; try { files = await readdir(transactions) } catch { return }
  for (const file of files) {
    const tx = JSON.parse(await readFile(path.join(transactions, file), 'utf8'))
    if (tx.status === 'applying') {
      announcedApplication = true
      await saveJson(path.join(root, 'fault-application.json'), { at: new Date().toISOString(), transaction: file, appliedPaths: tx.appliedPaths, pid: process.pid })
      send({ event: 'applying', transaction: file })
      await new Promise(() => {})
    }
  }
}
let persistence = Promise.resolve()
function persist() {
  persistence = persistence.then(async () => {
    const sessions = await store.listNativeCodingSessions('interactive')
    await saveJson(path.join(root, `sessions-${mode}.json`), sessions)
    await saveJson(path.join(root, 'usage.json'), evaluationUsage(ledger.records()))
  })
  return persistence
}
if (mode === 'new') {
  await mkdir(delivery)
  for (const [file, value] of Object.entries(config.files as Record<string, string | { base64: string }>)) { await mkdir(path.dirname(path.join(delivery, file)), { recursive: true }); await writeFile(path.join(delivery, file), typeof value === 'string' ? value : Buffer.from(value.base64, 'base64')) }
  const git = (args: string[]) => execFileSync('git', args, { cwd: delivery, stdio: ['ignore', 'pipe', 'pipe'] })
  for (const args of [['init', '-b', 'main'], ['config', 'user.name', 'Interactive QA'], ['config', 'user.email', 'qa@example.invalid'], ['add', '.'], ['commit', '-m', 'Isolated frozen scenario']]) git(args)
  const now = new Date().toISOString(), project = { id: 'interactive', name: 'Authorized live fault scenario', path: delivery, packageManager: 'npm' as const, testCommand: config.testCommand, createdAt: now, updatedAt: now }
  await store.upsertProject(project)
  const fixture = createWorkflowRunFromRequest({ runId: 'workflow', title: 'Live scenario', request: config.prompt, projectId: project.id, creatorId: 'operator', branchName: 'scenario', now })
  await store.saveRun(fixture.run)
  const node = fixture.run.nodes.find(item => item.stage === 'build' && item.kind === 'task')!
  const workspace = { id: 'workspace', projectId: project.id, codingRunId: 'coding', sourcePath: delivery, worktreePath: delivery, branchName: 'main', baseBranch: 'main', baseCommitSha: git(['rev-parse', 'HEAD']).toString().trim(), createdAt: now }
  const upstreamArtifacts: Artifact[] = config.criteria ? [{ id: 'operator-criteria', runId: fixture.run.id, nodeId: node.id, kind: 'clarification', title: 'Operator-authored test fixture requirements', summary: 'Predeclared human criterion for the acceptance-boundary experiment.', content: config.criteria.join('\n'), redacted: true, updatedAt: now,
    clarificationRevision: { version: 1, revision: 1, status: 'approved', revisionDigest: digest(JSON.stringify(config.criteria)), rawRequestArtifactId: 'operator-input', feedbackArtifactIds: [], goals: [], acceptanceCriteria: config.criteria, nonGoals: [], assumptions: [], risks: [], openQuestions: [], generatedAt: now,
      executor: { version: 1, kind: 'direct-provider', executorId: 'operator-authored-fixture', executorVersion: '1', capabilityProfile: 'repository-read-only-v1', model: 'none-fixture-metadata', startedAt: now, completedAt: now, durationMs: 0, terminalReason: 'success', contextDigest: digest(config.prompt) } } }] : []
  const briefInput = { project, worktreePath: delivery, branchName: 'main', run: fixture.run, node, userInstruction: config.prompt, upstreamArtifacts, knowledgeReferences: [], governanceChecks: [], gateDecisions: [], testEvidence: [] }
  const context = { ...briefInput, id: 'coding', workspace, requestedBy: 'operator', providerId: provider.id, now, brief: buildCodingBrief(briefInput) }
  const result = await executor.start({ request: { stateVersion: 1, id: 'coding', executor: { id: executor.descriptor.id, version: 3 }, scope: { organizationId: null, projectId: null, userId: 'operator', sessionId: 'isolated', localProjectId: project.id, managedWorkspaceId: 'workspace' }, authority: { runId: fixture.run.id, nodeId: node.id, runVersion: fixture.run.version, policyVersion: 1 }, objectiveDigest: digest(config.prompt), contextDigest: digest(context.brief.prompt), requiredCapabilities: ['workspace_read'], budget: { maxTokens: 10000000, maxCostUsd: 100 }, expectedCheckpointVersion: 0, requestedAt: now, deadline: new Date(Date.now() + 900000).toISOString() }, runtimeContext: context })
  if (result.kind !== 'harness') throw new Error('Expected harness')
  await store.saveCodingAgentRun(result.codingRun)
} else {
  const run = (await store.listCodingAgentRuns()).find(run => run.id === 'coding')!
  await executor.harness!.recover(run, authority)
}
process.on('message', async (value: { id: number; command: Record<string, unknown> }) => {
  try {
    const command = value.command
    let result: unknown
    if (command.type === 'settled') { await executor.settled(String(command.codingRunId ?? 'coding')); result = true }
    else if (command.type === 'dump') { result = await store.listNativeCodingSessions('interactive') }
    else if (command.type === 'close') { await executor.shutdown(); await persist(); await store.close(); send({ id: value.id, result: true }); process.disconnect(); return }
    else {
      const bundle = await executor.harness!.command(command as CodingHarnessCommand, authority)
      if (bundle.completion) await store.saveCodingAgentRun({ ...bundle.codingRun, status: 'completed', diffArtifactId: bundle.completion.diff.id, completedAt: new Date().toISOString() })
      result = { snapshot: bundle.snapshot, completion: bundle.completion }
      await persist()
    }
    send({ id: value.id, result })
  } catch (error) { send({ id: value.id, error: (error instanceof Error ? error.message : String(error)).replaceAll(apiKey, '[redacted]') }) }
})
process.on('disconnect', () => { void executor.shutdown().then(() => persist()).then(() => store.close()).finally(() => process.exit(0)) })
send({ event: 'ready', mode, pid: process.pid })
