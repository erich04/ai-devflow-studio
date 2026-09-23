/** Opt-in, isolated Electron/Main verification. No business Run or source database writes. */
import { app, safeStorage } from 'electron'
import { mkdtemp, copyFile, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createOpenAiCompatibleAgentProvider, createWorkflowRunFromRequest } from '../packages/shared/src/index'
import { createLocalStore } from '../apps/desktop/electron/local-store'
import { createKnowledgeReviewRuntime } from '../apps/desktop/electron/knowledge-review-runtime'
import { createRepositoryKnowledgeService } from '../apps/desktop/electron/repository-knowledge'
import { WorkbenchConversationService } from '../apps/desktop/electron/workbench-conversation-service'

async function main() {
const source = process.env.DEVFLOW_LIVE_DB
const output = process.env.DEVFLOW_QA_OUTPUT_DIR
if (!source || !output) throw new Error('Set DEVFLOW_LIVE_DB and DEVFLOW_QA_OUTPUT_DIR for this opt-in check.')
const temporary = await mkdtemp(path.join(os.tmpdir(), 'devflow-gate-live-'))
app.setName('AI DevFlow Studio')
app.setPath('userData', path.join(temporary, 'electron'))
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const report: Record<string, unknown> = { startedAt: new Date().toISOString() }
let store: Awaited<ReturnType<typeof createLocalStore>> | undefined
try {
  const originalHash = hash(await readFile(source))
  await app.whenReady()
  await copyFile(source, path.join(temporary, 'data.sqlite'))
  store = await createLocalStore({ dbPath: path.join(temporary, 'data.sqlite') })
  const metadata = (await store.listProviderCredentials()).find((item) => item.model === 'deepseek-flash')
  assert(metadata?.baseUrl && new URL(metadata.baseUrl).hostname === 'api.deepseek.com', 'Expected the existing official DeepSeek provider')
  const encrypted = await store.getProviderEncryptedSecret(metadata.providerId)
  assert(encrypted)
  console.log('Reading saved credential asynchronously; source database stays read-only.')
  const key = (await safeStorage.decryptStringAsync(Buffer.from(encrypted, 'base64'))).result
  let phase = 'review'
  const requests: Array<Record<string, unknown>> = []
  report.requests = requests
  const provider = createOpenAiCompatibleAgentProvider({
    id: metadata.providerId, name: metadata.name ?? 'DeepSeek', model: metadata.model, baseUrl: metadata.baseUrl,
    apiKey: key, ...(metadata.thinking ? { thinking: metadata.thinking } : {}),
    structuredRequestTimeoutMs: 300_000,
    fetcher: async (url, options) => {
      const body = JSON.parse(String(options?.body))
      const userPrompt = String(body.messages?.at(-1)?.content ?? '')
      const context = (() => { try { return JSON.parse(userPrompt) } catch { return null } })()
      requests.push({ phase, promptCharacters: userPrompt.length, promptDigest: hash(userPrompt),
        outputLimit: body.max_tokens ?? 'provider_default', thinking: body.thinking ?? null,
        criticalDocuments: context?.criticalProposalInput?.documents?.map((d: { id: string; content: string; digest: string }) => ({ id: d.id, characters: d.content.length, digest: d.digest, actualDigest: hash(d.content) })) ?? [],
        verification: Boolean(context?.proposalVerification),
      })
      return fetch(url, options)
    },
  })
  const run = (await store.listRuns())[0]!
  const beforeRun = JSON.stringify(run)
  const project = (await store.listProjects()).find((p) => p.id === run.projectId)!
  const knowledge = await createRepositoryKnowledgeService().index(project)
  const pairing = await store.getDesktopPairingCredential()
  const runtime = createKnowledgeReviewRuntime({ store, knowledgeDocuments: knowledge.documents, knowledgeChunks: knowledge.chunks,
    resolveProviderMetadata: async () => provider, resolveProvider: async () => provider,
    loadPolicySnapshot: async () => store!.getPolicySnapshot(pairing!.projectId),
    // Isolated smoke authorization only; production admission is verified separately against PostgreSQL.
    budgetGuard: async (input) => ({ status: 'allowed', blocksRun: false, currentSpendUsd: 0, projectedCostUsd: input.projectedCostUsd, limitUsd: 50, reason: 'Isolated opt-in live verification' }),
  })
  const previous = (await store.listAgentReviews(run.id)).at(-1)
  const result = await runtime.run({ runId: run.id, nodeId: run.currentNodeId, projectId: run.projectId,
    requestedBy: pairing!.userId, providerId: provider.id, ...(previous ? { previousReviewId: previous.id } : {}) })
  assert(result.review.conclusion && result.review.summary)
  assert.equal(JSON.stringify((await store.listRuns()).find((r) => r.id === run.id)), beforeRun)
  report.review = { passed: true, model: provider.model, outputLimit: requests[0]!.outputLimit,
    inputTokens: result.tokenUsage.inputTokens, outputTokens: result.tokenUsage.outputTokens,
    conclusionCharacters: result.review.conclusion.length, reportCount: (await store.listAgentReviews(run.id)).length,
    businessGateUnchanged: true,
  }
  console.log('Provider-default review passed; starting long requirement proposal check.')
  phase = 'long_proposal'
  const id = 'isolated-long-coverage'
  const longBody = '首段验收：默认显示全部任务，筛选项必须高亮。\n' +
    '# 业务背景一：' + '这是长正文传递的背景材料，用来检查分页边界与中文字符。'.repeat(120) + '\n' +
    '中段验收：切换筛选不得修改任务，保留备注中的特殊文本 "A\\B" 与 emoji 🧭。\n' +
    '# 业务背景二：' + '这是长正文中后段的背景材料，保持来源版本与传递范围可核对。'.repeat(120) + '\n' +
    '末段验收：刷新恢复全部但任务数据保留，清除已完成按钮按所有任务判断启用状态。'
  assert(longBody.length > 6000)
  const fixtureProject = { ...project, id, name: '隔离长正文验证', path: temporary }
  await store.upsertProject(fixtureProject)
  const fixture = createWorkflowRunFromRequest({ runId: id, projectId: id, creatorId: 'qa', title: '长需求完整提案', request: longBody, branchName: 'ai/qa', now: new Date().toISOString() })
  await store.saveRun(fixture.run)
  for (const artifact of fixture.artifacts) await store.saveArtifact(artifact)
  const conversations = new WorkbenchConversationService({ store, resolveProvider: async () => provider, changed() {},
    loadKnowledge: async () => ({ ...knowledge, projectId: id, documents: [], chunks: [], entities: [], relations: [] }),
  })
  const created = await conversations.command({ type: 'create', projectId: id })
  await conversations.command({ type: 'send', projectId: id, conversationId: created.conversationId!, providerId: provider.id,
    text: `请为 ${id} 的需求澄清节点生成可保存的完整讨论提案。原始正文的首段、中段和末段验收约定都必须保留，背景段不新增要求，无须再追问；请生成 draft 并完成逐项对照。不要保存或推进节点。` })
  await conversations.settled(created.conversationId!)
  const conversation = (await store.listWorkbenchConversations(id))[0]!
  const draft = conversation.messages.findLast((m) => m.draft)?.draft
  report.proposal = { status: conversation.status, error: conversation.error ?? null,
    characters: longBody.length, requestDigest: hash(longBody),
    passed: Boolean(draft?.inputReceipt), coverageCount: draft?.inputReceipt?.coverage.length ?? 0,
    requiredClauses: ['默认', 'A\\B', '🧭', '清除已完成'].map((text) => ({ text, present: draft?.content.includes(text) ?? false })),
    savedArtifacts: (await store.listArtifacts(id)).length,
    workflowUnchanged: JSON.stringify((await store.listRuns()).find((r) => r.id === id)) === JSON.stringify(fixture.run),
  }
  assert(draft?.inputReceipt, 'Live long proposal was not accepted with a verified input receipt')
  assert(draft.content.includes('清除已完成') && draft.content.includes('🧭') && draft.content.includes('默认'))
  assert.equal((await store.listArtifacts(id)).length, fixture.artifacts.length)
  report.sourceDatabaseUnchanged = hash(await readFile(source)) === originalHash
  assert(report.sourceDatabaseUnchanged)
  report.passed = true
} catch (error) {
  report.passed = false
  report.failure = { name: error instanceof Error ? error.name : 'Unknown',
    code: (error as { code?: string }).code ?? null,
    reason: (error as { sanitizedCause?: string }).sanitizedCause ?? (error instanceof Error ? error.message.slice(0, 220) : 'unknown') }
  process.exitCode = 1
} finally {
  report.finishedAt = new Date().toISOString()
  // Metadata only: no credential, prompt, response or reasoning text in the result.
  await mkdir(output, { recursive: true })
  await writeFile(path.join(output, 'live-provider.json'), JSON.stringify(report, null, 2))
  store?.close()
  await rm(temporary, { recursive: true, force: true })
  console.log(JSON.stringify(report))
  app.exit(process.exitCode ?? 0)
}

}
void main().catch(() => { console.error('Live verification setup failed.'); app.exit(1) })
