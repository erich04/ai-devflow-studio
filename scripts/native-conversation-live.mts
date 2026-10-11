import { app, safeStorage } from 'electron'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createCredentialAccess } from '../apps/desktop/electron/credential-access'
import { createLocalStore } from '../apps/desktop/electron/local-store'
import { WorkbenchConversationService } from '../apps/desktop/electron/workbench-conversation-service'
import { AgentProviderRequestError, createOpenAiCompatibleAgentProvider, createWorkflowRunFromRequest, governAgentProvider, verifiedModelCallBound, settledModelCallCost, type ModelCallGovernance, type ModelCallQuote, type ModelCallSettlement, type NativeToolMessage, type ProviderThinkingConfiguration } from '../packages/shared/src/index'

const output = process.env.DEVFLOW_NATIVE_LIVE_OUTPUT!, temp = process.env.DEVFLOW_NATIVE_LIVE_TEMP!
const report: { generatedAt: string; capUsd: number; maxCalls: number; cells: Record<string, unknown>[]; calls: Record<string, unknown>[]; passed?: boolean; blockedReason?: string } = { generatedAt: new Date().toISOString(), capUsd: 1, maxCalls: 64, cells: [], calls: [] }
const attempts = new Map<string, { quote: ModelCallQuote; bound: number; settlement?: ModelCallSettlement; final?: boolean }>()
const save = async () => {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 })
  await writeFile(path.join(output, 'ledger.json'), JSON.stringify([...attempts.values()], null, 2), { mode: 0o600 })
}
const governance: ModelCallGovernance = {
  pending: async () => [],
  reserve: async quote => {
    const bound = verifiedModelCallBound(quote)?.costUsd
    const spent = [...attempts.values()].reduce((sum, item) => sum + (item.final && item.settlement ? settledModelCallCost(item.quote, item.settlement) ?? item.bound : item.bound), 0)
    const accepted = bound !== undefined && spent + bound <= report.capUsd && attempts.size < report.maxCalls
    if (accepted) { attempts.set(quote.id, { quote, bound: bound! }); await save() }
    return { accepted, decision: { status: accepted ? 'allowed' : 'unavailable', blocksRun: !accepted, currentSpendUsd: spent, projectedCostUsd: bound ?? 0, limitUsd: report.capUsd, reason: 'Isolated paid verification budget; unknown usage retains its full reservation.' } }
  },
  persist: async (settlement, metadata) => { const attempt = attempts.get(settlement.id)!; attempt.settlement = settlement; attempt.final = metadata?.final === true; await save() },
  settle: async settlement => { const attempt = attempts.get(settlement.id)!; attempt.settlement = settlement; attempt.final = true; await save() },
}
const errorRecord = (error: unknown) => error instanceof AgentProviderRequestError ? { code: error.code, reason: error.sanitizedCause, ...error.responseMetadata, usage: error.usage } : { code: 'probe_assertion_or_host_failure', message: error instanceof Error && error.name === 'AssertionError' ? error.message.slice(0, 500) : 'Check the isolated probe assertion or host setup.' }

try {
  await app.whenReady()
  const require = createRequire(import.meta.url)
  const SQL = await require('sql.js')()
  const source = new SQL.Database(await readFile(process.env.DEVFLOW_WORKBENCH_LIVE_DATABASE!))
  const row = source.exec('select json, encrypted_secret from provider_credentials where provider_id = ?', [process.env.DEVFLOW_WORKBENCH_LIVE_PROVIDER_ID])[0]?.values[0]
  source.close()
  assert(row)
  const metadata = JSON.parse(String(row[0]))
  assert.equal(metadata.baseUrl.replace(/\/$/, ''), 'https://api.deepseek.com')
  assert.equal(metadata.model, 'deepseek-flash')
  const credentials = createCredentialAccess({ storage: safeStorage, timeoutMs: 60000 })
  let apiKey: string
  try { apiKey = await credentials.decrypt(String(row[1]), 'provider') }
  catch { report.blockedReason = 'Existing encrypted credential is unavailable in the isolated Electron process; zero model calls.'; throw new Error('credential_unavailable') }
  const projectId = 'native-conversation-live'
  const selectedProviderId = process.env.DEVFLOW_WORKBENCH_LIVE_PROVIDER_ID!
  function provider(thinking: ProviderThinkingConfiguration, stream: boolean) {
    const base = createOpenAiCompatibleAgentProvider({ id: selectedProviderId, name: 'DeepSeek live probe', model: metadata.model, apiKey, baseUrl: metadata.baseUrl, thinking, structuredRequestTimeoutMs: 120000,
      fetcher: async (url, init) => {
        // Exercise both existing parser branches with the exact same native request.
        const body = JSON.parse(String(init?.body))
        if (!stream) { delete body.stream; delete body.stream_options }
        const started = Date.now()
        const record: Record<string, unknown> = { mode: thinking, stream, requestedMaxOutput: body.max_tokens }
        report.calls.push(record); await save()
        try { const response = await fetch(url, { ...init, body: JSON.stringify(body) }); record.httpStatus = response.status; record.headersMs = Date.now() - started; return response }
        catch (error) { record.transportFailure = true; throw error }
      },
    })
    // Keep the paid probe small; application defaults are tested by deterministic suites.
    const governed = governAgentProvider(base, projectId, governance)
    return { ...governed, completeNativeConversation: async (input: Parameters<NonNullable<typeof base.completeNativeConversation>>[0]) => {
      const count = report.calls.length
      try {
        const result = await governed.completeNativeConversation!({ ...input, maxOutputTokens: input.maxOutputTokens ?? 8192 })
        const record = report.calls.at(-1)!
        record.kind = result.kind; record.finishReason = result.responseMetadata?.finishReason; record.usage = result.usage; await save()
        return result
      } catch (error) {
        if (report.calls.length > count) { report.calls.at(-1)!.failure = errorRecord(error); await save() }
        throw error
      }
    } }
  }
  const tools = [{ type: 'function' as const, function: { name: 'read_fixture', description: 'Read the named isolated test fixture. Use when asked.', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false } } }]
  for (const mode of (process.env.DEVFLOW_NATIVE_LIVE_PROPOSALS_ONLY === '1' ? [] : ['off', 'low', 'high', 'max']) as Array<'off' | 'low' | 'high' | 'max'>) for (const stream of [true, false]) {
    const cell: Record<string, unknown> = { mode, stream, callsBefore: report.calls.length, passed: false }
    report.cells.push(cell)
    const p = provider(mode === 'off' ? { mode: 'disabled' } : { mode: 'enabled', effort: mode }, stream)
    const messages: NativeToolMessage[] = []
    try {
      for (const round of [1, 2]) {
        messages.push({ role: 'user', content: `这是第 ${round} 次请求。请调用 read_fixture 读取名称 fixture-${round}，必须取得工具结果后再用一句中文回答值；不要猜测值。` })
        const first = await p.completeNativeConversation({ systemPrompt: '你负责隔离协议联调。遵循用户要求调用工具，获得结果后用普通 Markdown 回答，不要 JSON 外壳。', messages, tools, purpose: 'conversation', operationKey: `${mode}:${stream}:${round}` })
        assert.equal(first.kind, 'tools')
        if (first.kind !== 'tools') throw new Error('Expected tool calls')
        messages.push(first.assistantMessage)
        for (const call of first.toolCalls) { assert.equal(call.function.name, 'read_fixture'); messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ value: `verified-${round}` }) }) }
        const final = await p.completeNativeConversation({ systemPrompt: '你负责隔离协议联调。已得到工具结果时用一句普通 Markdown 回答，不要 JSON 外壳。', messages, tools, purpose: 'conversation', operationKey: `${mode}:${stream}:${round}` })
        assert.equal(final.kind, 'text'); assert.match(final.assistantMessage.content ?? '', new RegExp(`verified-${round}`)); messages.push(final.assistantMessage)
      }
      cell.passed = true
    } catch (error) { cell.failure = errorRecord(error) }
    cell.calls = report.calls.length - Number(cell.callsBefore); await save()
    console.log(JSON.stringify({ cell: `${mode}/${stream ? 'SSE' : 'non-stream'}`, passed: cell.passed, calls: cell.calls }))
  }

  const repository = path.join(temp, 'repo'); await mkdir(repository)
  const store = await createLocalStore({ dbPath: path.join(temp, 'test.sqlite') })
  const timestamp = new Date().toISOString()
  await store.upsertProject({ id: projectId, name: 'Native live fixture', path: repository, packageManager: 'npm', testCommand: 'npm test', createdAt: timestamp, updatedAt: timestamp })
  const fixture = createWorkflowRunFromRequest({ runId: 'live-run', projectId, title: '为任务清单增加关键词搜索', creatorId: 'live-probe', branchName: 'probe', now: timestamp,
    request: '1. 列表上方增加搜索任务…搜索框。\n2. 实时包含匹配，忽略英文大小写和首尾空格。\n3. 与全部、未完成、已完成叠加。\n4. 清空恢复，刷新清空搜索词但保留任务。\n5. 无匹配显示暂无匹配任务。\n6. 保留新增、完成、删除和全量清除已完成。\n7. 零新增依赖，npm test 通过，更新 README。' })
  await store.saveRun(fixture.run)
  for (const artifact of fixture.artifacts) await store.saveArtifact(artifact)
  const design = fixture.run.nodes.find(n => n.stage === 'design' && n.kind !== 'gate')!
  await store.saveArtifact({ id: 'formal-design', runId: fixture.run.id, nodeId: design.id, kind: 'design', title: '实现设计', summary: '搜索设计', content: '# 实现设计\n\n## 0. 前置核实\n确认文件路径、测试命令和任务字段。\n\n## 技术方案\n搜索框使用搜索任务…，纯函数去首尾空格并忽略大小写，与状态筛选叠加。统一 render，按 id 操作全量任务。searchTerm 仅存内存，刷新保留任务与完成状态。\n\n## 5. 空状态\ntasks.length > 0 且 visibleTasks.length === 0 且 normalizeTerm(searchTerm) !== 空字符串时显示暂无匹配任务。\n\n## 测试要求\n补充搜索、组合筛选、全量清除已完成的测试，npm test 通过。更新 README。\n\n## 非目标\n不增加依赖，不做模糊匹配。', updatedAt: timestamp, redacted: true })
  const p = provider({ mode: 'enabled', effort: 'high' }, true)
  const service = new WorkbenchConversationService({ store, nativeReadOnlyPilotEnabled: true, resolveProvider: async () => p, changed() {}, loadKnowledge: async () => ({ projectId, indexedAt: timestamp, contentHash: 'fixture', truncated: false, warnings: [], documents: [], entities: [], relations: [], chunks: [] }) })
  const requests = [
    '在开头增加方案摘要：本次在现有任务清单中增加关键词搜索，并保留原有任务管理功能。在末尾增加阅读提示：本方案需经方案评审确认后，再进入开发实现。其他内容保留。',
    '第 5 节去掉任务总数必须大于零的条件：搜索词非空且结果为空显示暂无匹配任务。第 0 节增加修改前运行 npm test 记录基线，修改后运行同一命令比较。其他内容保留。',
  ]
  for (let index = 0; index < requests.length; index++) {
    if (process.env.DEVFLOW_NATIVE_LIVE_SCENARIO !== undefined && Number(process.env.DEVFLOW_NATIVE_LIVE_SCENARIO) !== index) continue
    const cell: Record<string, unknown> = { scenario: index === 0 ? 'summary-and-reading-note' : 'empty-state-and-test-baseline', passed: false, callsBefore: report.calls.length }; report.cells.push(cell)
    try {
      const id = (await service.command({ type: 'create', projectId, executor: 'native-tools' })).conversationId!
      await service.command({ type: 'send', projectId, conversationId: id, providerId: selectedProviderId, text: `读取当前正式设计，为 Run ${fixture.run.id}、节点 ${design.id} 生成完整可保存的讨论提案。${requests[index]} 本轮不修改代码、不更新正式方案、不推进流程。` })
      await service.settled(id)
      const session = (await store.listWorkbenchConversations(projectId)).find(s => s.id === id)!
      const candidate = session.messages.find(m => m.draft)
      cell.status = session.status; cell.review = candidate?.draft?.review; cell.failure = session.failure
      assert(candidate?.draft)
      await writeFile(path.join(output, `proposal-${index + 1}.md`), candidate.draft.content)
      assert(['passed', 'needs_revision'].includes(candidate.draft.review?.status ?? ''))
      assert(candidate.draft.review?.findings?.some(f => f.criterionId.startsWith('user-request:') && f.status === 'covered'))
      assert(candidate.draft.review?.findings?.some(f => f.criterionId === 'formal-design:preserve' && f.status === 'covered'))
      if (index === 0) { assert.match(candidate.draft.content, /方案摘要/); assert.match(candidate.draft.content, /阅读提示/) }
      else { assert.match(candidate.draft.content, /npm test/); assert.match(candidate.draft.content, /基线/) }
      cell.manualAcknowledgment = candidate.draft.review?.status !== 'passed'
      const beforeSave = report.calls.length
      await service.command({ type: 'publish', projectId, conversationId: id, messageId: candidate.id, ...(cell.manualAcknowledgment ? { acknowledgeUnverified: true } : {}) })
      assert.equal(report.calls.length, beforeSave)
      assert.deepEqual((await store.listRuns())[0], fixture.run)
      cell.passed = true
      // Force a completed-history boundary using a smaller *probe* context policy.
      const originalPolicy = p.resolveRequestPolicy!
      p.resolveRequestPolicy = input => ({ ...originalPolicy(input), maxInputBytes: 16000 })
      await service.command({ type: 'send', projectId, conversationId: id, providerId: selectedProviderId, text: '请用 node 工具查询同一设计节点，然后用一句普通中文概括状态，不生成提案。' })
      await service.settled(id)
      const compacted = (await store.listWorkbenchConversations(projectId)).find(s => s.id === id)!
      cell.compaction = { state: compacted.status, boundaries: compacted.compactions?.length ?? 0, originalPreserved: (compacted.nativeTranscript?.length ?? 0) > (session.nativeTranscript?.length ?? 0), failure: compacted.failure }
      assert.equal(compacted.status, 'idle')
      assert((compacted.compactions?.length ?? 0) > 0)
      p.resolveRequestPolicy = originalPolicy
    } catch (error) { cell.passed = false; cell.failure = errorRecord(error) }
    cell.calls = report.calls.length - Number(cell.callsBefore); await save(); console.log(JSON.stringify({ scenario: cell.scenario, passed: cell.passed, calls: cell.calls }))
  }
  report.passed = report.cells.every(cell => cell.passed === true)
} catch (error) { report.passed = false; report.blockedReason ??= String(errorRecord(error).code) }
finally { await save(); console.log(JSON.stringify({ passed: report.passed, calls: report.calls.length, report: path.join(output, 'report.json') })); app.exit(report.passed ? 0 : 1) }
