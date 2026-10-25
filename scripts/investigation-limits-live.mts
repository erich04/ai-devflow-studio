// Opt-in real-provider comparison. Only a separately authorized loopback budget gateway is accepted.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createOpenAiCompatibleAgentProvider, createWorkflowRunFromRequest } from '../packages/shared/src/index.ts'
import { createLocalStore } from '../apps/desktop/electron/local-store.ts'
import { WorkbenchConversationService } from '../apps/desktop/electron/workbench-conversation-service.ts'

assert.equal(process.env.DEVFLOW_INVESTIGATION_LIVE_AUTHORIZED, '1', 'Explicit real-model authorization is required')
const output = path.resolve(process.env.DEVFLOW_INVESTIGATION_LIVE_OUTPUT ?? '.tmp/investigation-limits-live')
const gateway = new URL(process.env.DEVFLOW_INVESTIGATION_LIVE_GATEWAY ?? 'http://127.0.0.1:8893')
assert.equal(gateway.hostname, '127.0.0.1')
assert.equal(gateway.protocol, 'http:')
const budget = async () => {
  const response = await fetch(new URL('/budget', gateway), { signal: AbortSignal.timeout(5000) })
  assert(response.ok)
  return response.json() as Promise<{ budget_cny: number; closed: boolean; calls: number; unknown_calls: number; committed_upper_bound_cny: number }>
}
const initial = await budget()
assert(initial.budget_cny > 0 && initial.budget_cny <= 1 && !initial.closed && initial.calls === 0)
await mkdir(output, { recursive: true })
await writeFile(path.join(output, 'started.json'), JSON.stringify({ at: new Date().toISOString(), initial }), { flag: 'wx', mode: 0o600 })
const projectPath = path.join(output, 'synthetic-project')
await mkdir(projectPath)
const files = Array.from({ length: 14 }, (_, i) => `evidence-${String(i + 1).padStart(2, '0')}.md`)
const codes = files.map(file => createHash('sha256').update(`investigation-comparison:${file}`).digest('hex').slice(0, 10))
for (const [i, file] of files.entries()) await writeFile(path.join(projectPath, file), `# 独立验收材料 ${i + 1}\n本材料的核验码：${codes[i]}。\n`)
const prompt = `只读核对这个合成项目的 14 个文件：${files.join('、')}。每个正常调查步骤只读取一个文件，不要合并查询或先列目录。依次读取全部文件后，按文件名列出其中的核验码并给出引用；不得推测未读文件。若达到批次边界，说明尚缺哪些文件，等待我点继续。不要生成提案或修改文件。`
const results: unknown[] = []
for (const maxSteps of [12, 30]) {
  const current = await budget()
  assert.equal(current.unknown_calls, 0, 'Unknown paid delivery stops this comparison')
  assert(!current.closed && current.committed_upper_bound_cny < current.budget_cny)
  const store = await createLocalStore({ dbPath: path.join(output, `limits-${maxSteps}.sqlite`) })
  const projectId = `limits-${maxSteps}`
  const stamp = new Date().toISOString()
  await store.upsertProject({ id: projectId, name: '合成调查对照', path: projectPath, packageManager: 'npm', testCommand: 'npm test', createdAt: stamp, updatedAt: stamp })
  const flow = createWorkflowRunFromRequest({ runId: `run-${maxSteps}`, title: '材料核验', request: '只读合成材料核验；不执行开发、Gate 或发布。', projectId, creatorId: 'synthetic-user', branchName: 'test/limits', now: stamp })
  await store.saveRun(flow.run)
  for (const artifact of flow.artifacts) await store.saveArtifact(artifact)
  // Unknown loopback endpoints use provider defaults. The authorized gateway itself forces non-thinking/non-streaming.
  const provider = createOpenAiCompatibleAgentProvider({ id: 'deepseek-bounded', model: 'deepseek-flash', apiKey: 'gateway-placeholder-only', baseUrl: new URL('/v1', gateway).href })
  const service = new WorkbenchConversationService({ store, resolveProvider: async () => provider, changed: () => {}, loadKnowledge: async () => ({ projectId, contentHash: 'empty', indexedAt: stamp, truncated: false, warnings: [], documents: [], entities: [], relations: [], chunks: [] }) })
  const id = (await service.command({ type: 'create', projectId })).conversationId!
  await service.command({ type: 'configure_investigation', projectId, conversationId: id, maxSteps, maxDurationMs: 180000 })
  const started = performance.now()
  await service.command({ type: 'send', projectId, conversationId: id, providerId: provider.id, text: prompt })
  await service.settled(id)
  const first = (await store.listWorkbenchConversations(projectId))[0]!
  const firstBatchDurationMs = Math.round(performance.now() - started)
  if (first.status === 'paused') {
    assert.equal((await budget()).unknown_calls, 0)
    await service.command({ type: 'retry', projectId, conversationId: id, providerId: provider.id })
    await service.settled(id)
  }
  const final = (await store.listWorkbenchConversations(projectId))[0]!
  const answer = final.messages.filter(m => m.role === 'assistant').at(-1)?.text ?? ''
  const diagnostics = (await service.command({ type: 'export_diagnostics', projectId, conversationId: id })).diagnostics!
  const toolRequests = final.toolEvents?.filter(e => e.kind === 'tool_request') ?? []
  const usage = final.messages.reduce((total, m) => ({ input: total.input + (m.usage?.inputTokens ?? 0), output: total.output + (m.usage?.outputTokens ?? 0) }), { input: 0, output: 0 })
  const record = { maxSteps, firstBatchStatus: first.status, firstBatchDurationMs, firstBatchCounters: first.investigationProgress,
    finalStatus: final.status, durationMs: Math.round(performance.now() - started), counters: final.investigationProgress,
    toolRequests: toolRequests.length, userMessages: final.messages.filter(m => m.role === 'user').length,
    verifiedCodes: codes.filter(code => answer.includes(code)).length, totalCodes: codes.length, usage,
    formalStateUnchanged: JSON.stringify(await store.listRuns()) === JSON.stringify([flow.run]), budget: await budget() }
  results.push(record)
  await writeFile(path.join(output, `diagnostics-${maxSteps}.json`), JSON.stringify(diagnostics, null, 2), { mode: 0o600 })
  await writeFile(path.join(output, 'comparison.json'), JSON.stringify({ protocol: 'structured-v1; real provider via bounded gateway; no UI automation in this script', prompt, results }, null, 2), { mode: 0o600 })
  console.log(JSON.stringify(record))
  assert.equal(final.status, 'idle')
  assert.equal(record.verifiedCodes, 14)
  assert.equal(record.userMessages, 1)
  assert(record.formalStateUnchanged)
  for (const [i, file] of files.entries()) assert.equal(await readFile(path.join(projectPath, file), 'utf8'), `# 独立验收材料 ${i + 1}\n本材料的核验码：${codes[i]}。\n`)
}
