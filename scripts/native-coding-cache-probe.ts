/** Isolated prefix-layout control; never imported by the desktop application. */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createOpenAiCompatibleAgentProvider, governAgentProvider, type AgentProvider, type NativeConversationRequest } from '../packages/shared/src/index.ts'
import { createLocalStore } from '../apps/desktop/electron/local-store.ts'
import { createNativeCodingSession } from '../apps/desktop/electron/native-coding-session.ts'
import { NativeCodingLoop } from '../apps/desktop/electron/native-coding-loop.ts'
import { openInteractiveRound } from './native-coding-round-budget.ts'
import { saveJson } from './native-coding-live-support.ts'

const marker = '[DevFlow runtime state]\n'
export function legacyPrefixRequest(request: NativeConversationRequest, system: string): NativeConversationRequest {
  const messages = request.messages.map(message => ({ ...message })), last = messages.at(-1)
  if (!last || last.role === 'assistant') throw new Error('Missing appended runtime state in the fixed-layout probe')
  const content = last.content
  let state: unknown
  const jsonIndex = content.lastIndexOf(',"devflowRuntimeState":')
  const textIndex = content.lastIndexOf(marker)
  if (content.startsWith('{') && jsonIndex > 0 && content.endsWith('}')) {
    state = JSON.parse(content).devflowRuntimeState
    last.content = content.slice(0, jsonIndex) + '}'
  } else if (textIndex >= 0) {
    state = JSON.parse(content.slice(textIndex + marker.length))
    if (textIndex === 0) messages.pop()
    else last.content = content.slice(0, textIndex).replace(/\n\n$/u, '')
  } else throw new Error('Missing appended runtime state in the fixed-layout probe')
  return { ...request, systemPrompt: `${system}\n${marker}${JSON.stringify(state)}`, messages }
}

const sha = (text: string) => createHash('sha256').update(text).digest('hex')
export async function runCacheProbe(input: { root: string; output: string; scope: string; layout: 'legacy' | 'fixed'; pair: string }, apiKey: string) {
  const ledger = await openInteractiveRound(input.root, input.scope)
  const oldSource = execFileSync('git', ['show', '153220124f85bec00688eb69b48726b766f72419:apps/desktop/electron/native-coding-loop.ts'], { encoding: 'utf8' })
  const legacySystem = oldSource.match(/const systemPrompt = `([^`]+)`/u)?.[1]
  if (!legacySystem) throw new Error('Cannot verify the historical system prompt')
  await mkdir(input.output)
  const store = await createLocalStore({ dbPath: path.join(input.output, 'local.sqlite') })
  const bodies: Array<{ systemHash: string; toolsHash: string; bytes: number }> = []
  const raw = createOpenAiCompatibleAgentProvider({ id: 'deepseek-evaluation', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com', apiKey,
    thinking: { mode: 'enabled', effort: 'high' }, structuredRequestTimeoutMs: 90000,
    fetcher: async (url, init) => {
      const body = JSON.parse(String(init?.body)), serial = JSON.stringify(body)
      bodies.push({ systemHash: sha(body.messages[0].content), toolsHash: sha(JSON.stringify(body.tools)), bytes: Buffer.byteLength(serial) })
      await writeFile(path.join(input.output, `request-${bodies.length}.json`), serial, { flag: 'wx', mode: 0o600 })
      const response = await fetch(url, { ...init, redirect: 'error' })
      if ([401, 402].includes(response.status)) await ledger.seal()
      return response
    } })
  const transform = (request: NativeConversationRequest) => input.layout === 'legacy' ? legacyPrefixRequest(request, legacySystem) : request
  const controlled: AgentProvider = { ...raw,
    resolveRequestPolicy: value => raw.resolveRequestPolicy!({ ...value, maxOutputTokens: Math.min(value.maxOutputTokens ?? ledger.limits.maxOutputTokens, ledger.limits.maxOutputTokens) }),
    serializeNativeRequest: value => raw.serializeNativeRequest!(transform(value)),
    completeNativeConversation: value => raw.completeNativeConversation!(transform(value)),
  }
  const provider = governAgentProvider(controlled, 'cache-probe', ledger)
  let failure: string | undefined
  try {
    const now = new Date().toISOString()
    await store.upsertProject({ id: 'cache-probe', name: 'Synthetic cache probe', path: input.output, packageManager: 'npm', testCommand: '', createdAt: now, updatedAt: now })
    const objective = `只读缓存协议探针 ${input.pair}。每轮仅调用一次 discover，读取下一条合成记录。连续读取四条；不要编辑、测试、提问或提交变更。宿主在四轮后停止。以下是稳定的合成仓库索引：\n` + Array.from({ length: 128 }, (_, i) => `record-${i}: synthetic module ${i}, checksum fixture-${i * 7}`).join('\n')
    const session = createNativeCodingSession({ id: 'probe', localProjectId: 'cache-probe', codingRunId: 'probe', workflowRunId: 'fixture', nodeId: 'read', objective, providerId: provider.id, model: provider.model, now })
    session.limits.maxSteps = 4
    await store.saveNativeCodingSession(session, 0)
    let reads = 0
    const loop = new NativeCodingLoop({ store, provider,
      tools: { definitions: [{ type: 'function', function: { name: 'discover', description: 'Read exactly one next synthetic record. Call only once per turn.', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } } }],
        effects: { discover: 'read' }, execute: async name => { if (name !== 'discover') throw new Error('Unexpected probe tool'); return { record: ++reads, evidence: `synthetic-record-${reads}`, next: reads < 4 ? 'Call discover once again.' : 'All four records were read.' } } } })
    const result = await loop.runBatch('probe')
    await saveJson(path.join(input.output, 'session.json'), result)
    if (reads !== 4 || result.pauseReason !== 'task_limit' || result.compactions.length || bodies.length !== 4) throw new Error('Probe did not follow the frozen four-read protocol')
    if (input.layout === 'fixed' && new Set(bodies.map(body => body.systemHash)).size !== 1) throw new Error('Fixed system prefix changed')
    if (new Set(bodies.map(body => body.toolsHash)).size !== 1) throw new Error('Tool definitions changed')
  } catch (error) { failure = String(error).replaceAll(apiKey, '[redacted]').slice(0, 1000) }
  finally {
    const rows = ledger.records(), usable = rows.slice(1).filter(row => row.settlement?.usage?.cacheStatus === 'complete')
    const hit = usable.reduce((sum, row) => sum + (row.settlement!.usage!.cacheReadTokens ?? 0), 0)
    const tokens = usable.reduce((sum, row) => sum + (row.settlement!.usage!.inputTokens ?? 0), 0)
    const report = { ...input, passed: !failure, failure, calls: rows.length, bodies, warmInputTokens: tokens, warmCacheHitTokens: hit,
      warmHitRate: tokens ? hit / tokens : null, completeWarmUsage: usable.length === 3, usage: ledger.scopeUsage(), ledger: rows,
      interpretation: 'Real model, production NativeCodingLoop; legacy control reconstructs only the pre-239 request layout. It is not a rerun of an old product release. AB/BA order, first call excluded; no compaction or adaptive retries.' }
    await saveJson(path.join(input.output, 'report.json'), report)
    await store.close(); ledger.close()
    return report
  }
}
