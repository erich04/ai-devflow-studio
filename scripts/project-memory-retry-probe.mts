// Compare the exact old/new clause sets on the disposable bank created by the full validation.
// Freeze both coding briefs before calling the model. Only the capped, local validation gateway may spend.
import assert from 'node:assert/strict'
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildCodingBrief, createWorkflowRunFromRequest, splitRecallIntents } from '../packages/shared/src/index.ts'
import { buildCodingMemoryQuery, recallCodingMemory, registerProjectMemoryRecall } from '../apps/desktop/electron/coding-context.ts'
import { createLocalStore } from '../apps/desktop/electron/local-store.ts'
import { createHindsightClient } from '../apps/desktop/electron/hindsight-client.ts'
import { createProjectMemoryRecall } from '../apps/desktop/electron/project-memory-recall.ts'

assert.equal(process.env.DEVFLOW_MEMORY_LIVE_AUTHORIZED, '1')
const gateway = new URL(process.env.DEVFLOW_FULLCHAIN_MODEL_ENDPOINT!)
assert(gateway.protocol === 'http:' && gateway.hostname === '127.0.0.1' && gateway.pathname === '/v1')
const budget = await (await fetch(new URL('/budget', gateway), { redirect: 'error' })).json()
assert(budget.closed === false && budget.blocked === false && budget.cap_cny > 0 && budget.cap_cny <= 20)
const dir = path.resolve(process.env.DEVFLOW_MEMORY_FULL_RESUME!)
const state = JSON.parse(await readFile(path.join(dir, 'state.json'), 'utf8'))
assert(state.createdBy.startsWith('full-') && state.repo === path.join(dir, 'repo'))
const tmp = await mkdtemp(path.join(os.tmpdir(), 'devflow-retry-read-'))
const dbPath = path.join(tmp, 'devflow.sqlite')
await copyFile(path.join(dir, 'devflow.sqlite'), dbPath)
const store = await createLocalStore({ dbPath })
try {
  const project = (await store.listProjects()).find(p => p.id === state.projectId)!
  const config = await store.getProjectMemoryConfiguration(project.id)
  assert(config?.bankId === state.initialBankId && new URL(config!.endpoint).hostname === '127.0.0.1')
  const client = createHindsightClient({ endpoint: config!.endpoint })
  registerProjectMemoryRecall(store, createProjectMemoryRecall({ store, transportAvailable: true, client: async () => client }))
  const oldClauses = ['在 src/sync.js 实现同步重试', '次数和上限按我们定好的来', '只改这个文件']
  const request = oldClauses.join('，') + '。'
  const now = new Date().toISOString()
  const { run } = createWorkflowRunFromRequest({ runId: 'retry-probe', projectId: project.id, creatorId: state.ownerUserId,
    title: '同步重试', request, branchName: 'devflow/retry-probe', now })
  const node = run.nodes.find(n => n.stage === 'build')!
  const query = buildCodingMemoryQuery({ run, node, userInstruction: request, artifacts: [] })
  async function prepare(intents: string[]) {
    const memory = await recallCodingMemory({ store, run, codingRunId: 'retry', userId: state.ownerUserId, query, intents, now })
    assert(memory.context.some(m => m.id === 'pm-devflow-essentials'))
    const brief = buildCodingBrief({ run, node, project, userInstruction: request, memoryContext: memory.context, upstreamArtifacts: [],
      knowledgeReferences: [], testEvidence: [], gateDecisions: [], governanceChecks: [], worktreePath: '<worktree>', branchName: run.branchName })
    return { prompt: brief.prompt, identities: memory.memories, statements: memory.context.map(m => m.statement), intents }
  }
  const variants = { before: await prepare(oldClauses), after: await prepare(splitRecallIntents(request)) }
  assert.equal(variants.before.identities[0]?.contentDigest, variants.after.identities[0]?.contentDigest, 'Page changed during comparison')
  const samples: Array<{ variant: string; maxRetries: number; maxBackoffMs: number }> = []
  for (let i = 0; i < 6; i++) {
    for (const variant of (i % 2 ? ['after', 'before'] : ['before', 'after']) as Array<keyof typeof variants>) {
      const response = await fetch(new URL('/v1/chat/completions', gateway), { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(90_000),
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'deepseek-flash', thinking: { type: 'disabled' },
          temperature: 0.7, max_tokens: 128, response_format: { type: 'json_object' }, messages: [{ role: 'system',
            content: '读取编码简报。给出你实际要在代码里使用的两个数值。仅输出 JSON，键为 maxRetries 和 maxBackoffMs，单位分别是次和毫秒。' },
          { role: 'user', content: variants[variant].prompt }] }) })
      assert(response.ok, `Budget gateway returned ${response.status}`)
      const result = JSON.parse((await response.json()).choices[0].message.content)
      samples.push({ variant, maxRetries: result.maxRetries, maxBackoffMs: result.maxBackoffMs })
    }
  }
  const counts = Object.fromEntries(Object.keys(variants).map(k => [k, samples.filter(s => s.variant === k && s.maxRetries === 5 && s.maxBackoffMs === 30_000).length]))
  await writeFile(path.join(dir, 'retry-comparison.json'), JSON.stringify({ variants, samples, counts }, null, 2))
  console.log(JSON.stringify({ counts, trialsPerVariant: 6 }))
} finally { store.close(); await rm(tmp, { recursive: true, force: true }) }
