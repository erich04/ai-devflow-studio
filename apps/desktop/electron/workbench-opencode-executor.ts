import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { ConversationExecutorError, type ConversationExecutor } from './conversation-executor.js'
import { buildOpencodeDiscoveryEnv } from './opencode-discovery.js'
import { abortOpencodeSession, createOpencodeSession, listOpencodeMessages, listOpencodePermissions, sendOpencodeMessage, type OpencodeMessage } from './opencode-http-adapter.js'
import { createOpencodeProcessManager, type EnsureManagedOpencodeServerInput } from './opencode-process.js'
import { opencodeProviderBindingEnv, type OpencodeProviderBinding } from './opencode-provider-binding.js'
import { reportedUsage } from './stage-agent-opencode-output.js'
import { createWorkbenchMcpBridge } from './workbench-mcp-bridge.js'

type Manager = {
  ensure(input: EnsureManagedOpencodeServerInput): Promise<{ baseUrl: string }>
  stopAll(): Promise<void>
}
const permission = { '*': 'deny', question: 'deny', task: 'deny', 'devflow_*': 'allow' } as const
const permissionRules = Object.entries(permission).map(([permission, action]) => ({ permission, pattern: '*', action }))
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

/** One owned runtime per turn. OpenCode never receives the user's repository path or another conversation. */
export async function createWorkbenchOpencodeExecutor(input: {
  binaryPath: string
  binding: OpencodeProviderBinding
  signal: AbortSignal
  query(name: string, args: Record<string, unknown>): Promise<unknown>
  baseEnv?: NodeJS.ProcessEnv
  deps?: { manager?: Manager; fetcher?: typeof fetch; pollMs?: number }
}): Promise<ConversationExecutor> {
  input.signal.throwIfAborted()
  const root = await mkdtemp(join(tmpdir(), 'devflow-conversation-'))
  const directory = join(root, 'workspace')
  const password = randomBytes(32).toString('hex')
  const request: typeof fetch = (url, options) => (input.deps?.fetcher ?? fetch)(url, {
    ...options, headers: { ...Object.fromEntries(new Headers(options?.headers)), Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` },
  })
  const manager = input.deps?.manager ?? createOpencodeProcessManager({
    spawnProcess: (command, args, options) => spawn(command, [...args, '--pure'], options),
    waitUntilReady: async (baseUrl) => {
      const deadline = Date.now() + 25_000
      while (Date.now() < deadline) {
        input.signal.throwIfAborted()
        try { await listOpencodePermissions({ baseUrl, fetcher: request, signal: AbortSignal.any([input.signal, AbortSignal.timeout(1500)]) }); return } catch { input.signal.throwIfAborted() }
        await delay(250, undefined, { signal: input.signal })
      }
      throw new Error('本机 OpenCode 启动超时，请检查安装后重试。')
    },
  })
  let bridge: Awaited<ReturnType<typeof createWorkbenchMcpBridge>> | undefined
  let baseUrl: string | undefined
  let sessionId: string | undefined
  let closing: Promise<void> | undefined
  const abortOwnSession = async () => {
    if (baseUrl && sessionId) {
      try { await abortOpencodeSession({ baseUrl, sessionId, directory, fetcher: request, signal: AbortSignal.timeout(1500) }) } catch { /* Process termination below remains authoritative. */ }
    }
  }
  const close = () => {
    closing ??= (async () => {
      input.signal.removeEventListener('abort', onAbort)
      if (input.signal.aborted) await abortOwnSession()
      await bridge?.close()
      // A failed stop is surfaced, never reported as successful cleanup.
      try { await manager.stopAll() } catch { await manager.stopAll() }
      await rm(root, { recursive: true, force: true })
    })()
    return closing
  }
  const onAbort = () => { void close().catch(() => undefined) }
  try {
    await mkdir(directory)
    bridge = await createWorkbenchMcpBridge({ query: input.query, signal: input.signal })
    input.signal.throwIfAborted()
    const bindingEnv = opencodeProviderBindingEnv(input.binding)
    const providerConfig = JSON.parse(bindingEnv.OPENCODE_CONFIG_CONTENT!) as Record<string, unknown>
    const model = `${input.binding.providerId}/${input.binding.modelId}`
    const env: NodeJS.ProcessEnv = {
      ...buildOpencodeDiscoveryEnv(input.baseEnv ?? process.env), ...bindingEnv,
      XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'), XDG_CACHE_HOME: join(root, 'cache'), XDG_STATE_HOME: join(root, 'state'),
      OPENCODE_SERVER_PASSWORD: password, OPENCODE_SERVER_USERNAME: 'opencode',
      OPENCODE_DISABLE_AUTOUPDATE: 'true', OPENCODE_DISABLE_DEFAULT_PLUGINS: 'true',
      OPENCODE_DISABLE_CLAUDE_CODE: 'true', OPENCODE_DISABLE_MODELS_FETCH: 'true', OPENCODE_DISABLE_LSP_DOWNLOAD: 'true',
      OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX: '3500',
      OPENCODE_CONFIG_CONTENT: JSON.stringify({ ...providerConfig, model, small_model: model,
        enabled_providers: [input.binding.providerId], share: 'disabled', snapshot: false, autoupdate: false,
        permission, default_agent: 'devflow', plugin: [], lsp: false, formatter: false,
        agent: { devflow: { description: 'DevFlow 项目只读调查', mode: 'primary', steps: 12, permission,
          prompt: 'You investigate project facts only through the supplied devflow MCP tools. Follow the application response contract.' },
          title: { disable: true }, summary: { disable: true } },
        mcp: { devflow: { type: 'remote', url: bridge.url, headers: bridge.headers, oauth: false } },
      }),
    }
    const server = await manager.ensure({ projectId: 'conversation-turn', binaryPath: input.binaryPath, env, configurationFingerprint: input.binding.fingerprint })
    baseUrl = server.baseUrl
    input.signal.throwIfAborted()
    const session = await createOpencodeSession({ baseUrl, directory, title: 'DevFlow conversation turn',
      model: { providerID: input.binding.providerId, id: input.binding.modelId }, permissionRules, fetcher: request, signal: input.signal })
    if (typeof session.id !== 'string' || !/^[\w-]{1,200}$/u.test(session.id)) throw new Error('会话执行器返回了无效会话。')
    sessionId = session.id
    input.signal.throwIfAborted()
    // Install only after initialization owns every resource. Aborted startup is
    // cleaned by the catch below, avoiding a bridge created after close() ran.
    input.signal.addEventListener('abort', onAbort, { once: true })
    let called = false
    return {
      id: input.binding.providerId, model: input.binding.modelId, supportsReasoning: true, close,
      async completeStructuredJson(call) {
        if (called || closing) throw new Error('本轮执行器已结束，请重新发起对话。')
        called = true
        const signal = call.signal ? AbortSignal.any([input.signal, call.signal]) : input.signal
        signal.throwIfAborted()
        const target = { baseUrl: baseUrl!, sessionId: sessionId!, directory, fetcher: request, signal }
        let messages: OpencodeMessage[] = []
        const seen = new Map<string, string>()
        const collect = async (candidates: OpencodeMessage[]) => {
          for (const message of candidates) {
            if (!object(message?.info) || message.info.role !== 'assistant') continue
            if (message.info.providerID !== input.binding.providerId || message.info.modelID !== input.binding.modelId) throw new Error('会话执行器返回的模型与所选模型不一致。')
            if (!Array.isArray(message.parts)) throw new Error('会话执行器返回的消息格式无效。')
            for (const [index, part] of message.parts.entries()) {
              if (!object(part) || part.type !== 'reasoning' || typeof part.text !== 'string') continue
              const key = `${message.info.id}:${typeof part.id === 'string' ? part.id : index}`
              const previous = seen.get(key) ?? ''
              if (!part.text.startsWith(previous)) continue
              seen.set(key, part.text)
              if (part.text.length > previous.length) await call.reasoning?.onDelta?.(part.text.slice(previous.length))
            }
          }
        }
        const polling = new AbortController()
        const observe = (async () => {
          while (!polling.signal.aborted && !signal.aborted) {
            try {
              const fetched = await listOpencodeMessages({ ...target, signal: AbortSignal.any([signal, polling.signal, AbortSignal.timeout(1500)]) })
              if (Array.isArray(fetched)) { messages = fetched; await collect(messages) }
            } catch { /* Final collection below validates the authoritative completed response. */ }
            try { await delay(input.deps?.pollMs ?? 800, undefined, { signal: polling.signal }) } catch { return }
          }
        })()
        try {
          const response = await sendOpencodeMessage({ ...target, agent: 'devflow', system: call.systemPrompt,
            model: { providerID: input.binding.providerId, modelID: input.binding.modelId }, text: call.userPrompt })
          polling.abort(); await observe
          const fetched = await listOpencodeMessages(target)
          if (!Array.isArray(fetched) || !object(response) || !object(response.info) || response.info.role !== 'assistant' || typeof response.info.id !== 'string' || !Array.isArray(response.parts)) throw new Error('会话执行器返回的消息格式无效。')
          messages = fetched
          const final = response as OpencodeMessage
          if (!messages.some((item) => item.info.id === final.info.id)) messages.push(final)
          await collect(messages)
          const text = final.parts.filter((part): part is { type: string; text: string } => object(part) && part.type === 'text' && typeof part.text === 'string').map((part) => part.text).join('\n').trim()
          const json = /^```json\s*\n([\s\S]*?)\n```$/iu.exec(text)?.[1] ?? text
          let value: unknown
          try { value = JSON.parse(json) } catch { throw new Error('会话执行器未返回有效答复，请重试。') }
          if (!object(value)) throw new Error('会话执行器未返回有效答复，请重试。')
          const assistantMessages = [...new Map(messages.filter((message) => message.info.role === 'assistant').map((message) => [message.info.id, message])).values()]
          const usage = reportedUsage(assistantMessages)
          return { value, ...(usage ? { usage } : {}), reasoningContent: [...seen.values()].join('\n\n') }
        } catch (error) {
          const measured = [...new Map(messages.filter((message) => object(message?.info) && message.info.role === 'assistant'
            && message.info.providerID === input.binding.providerId && message.info.modelID === input.binding.modelId).map((message) => [message.info.id, message])).values()]
          throw new ConversationExecutorError(error instanceof Error && /^[\u4e00-\u9fff]/u.test(error.message)
            ? error.message : '会话执行器请求未完成，请检查所选模型和网络后重试。', reportedUsage(measured))
        } finally { polling.abort(); await observe }
      },
    }
  } catch (error) {
    await close()
    throw error
  }
}
