import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { createAgentRuntime, resumeAgentRuntime, requestAgentAction, validateNativeToolValue } from '@ai-devflow/shared'
import type { LocalStore } from './local-store'
import { createLocalMcpClient, createLocalMcpToolRegistrations } from './local-mcp-client'
import { createLocalMcpInstallationRegistry } from './local-mcp-installation-registry'
import { createNativeToolRegistry, digestNativeToolValue, type NativeToolRegistryPersistence } from './native-tool-registry'
import { atomicCodingFile, codingDigest, type CodingCandidateWorkspace } from './coding-candidate-workspace'
import { mutateNativeCodingSession, type CodingToolReceipt } from './native-coding-session'
import type { CodingTaskAuthority } from './native-coding-tools'
import type { CodingLoopTools } from './native-coding-loop'
import { requireCodingPermission } from './native-coding-permissions'
import { codingDocumentUrl, fetchCodingDocument } from './coding-public-documents'
import type { CodingNetworkProfile } from './native-coding-profile'
import type { CodingCommandRunner } from './coding-command-runner'

export const codingExtensionNames = ['list_skills', 'read_skill', 'list_mcp', 'mcp_tools', 'call_mcp', 'web_search', 'fetch_document']
export function createCodingExtensions(host: { store: LocalStore; sessionId: string; workspace: CodingCandidateWorkspace; commands: CodingCommandRunner; authority: CodingTaskAuthority; network?: CodingNetworkProfile; assertAuthority(): Promise<void> }) {
  const change = (mutate: Parameters<typeof mutateNativeCodingSession>[2]) => mutateNativeCodingSession(host.store, host.sessionId, mutate)
  const receiptFile = (id: string) => path.join(host.workspace.root, 'extensions', `${codingDigest(id)}.json`)
  const persistence: NativeToolRegistryPersistence = {
    reserveGrant: async grant => { await change(draft => { const record = draft.toolAuthorities.find(item => item.runtime.id === grant.runtimeId); if (!record || record.grant) throw new Error('MCP grant is not reservable'); record.grant = grant }); return { reserved: true } },
    beginExecution: async ({ expectedGrant, audit }) => { await change(draft => { const record = draft.toolAuthorities.find(item => item.grant?.id === expectedGrant.id); if (!record || record.consumed) throw new Error('MCP grant consumed'); record.consumed = true; record.audit.push(audit) }); return { consumed: true } },
    appendAudit: async audit => { await change(draft => { const record = draft.toolAuthorities.find(item => item.runtime.id === audit.runtimeId); if (!record) throw new Error('Missing MCP audit identity'); record.audit.push(audit) }) },
  }
  async function installation(id: string) {
    const value = await host.store.getLocalMcpInstallation(id)
    if (!value?.enabled) throw new Error('MCP must first be installed and enabled through the existing installation authority')
    return value
  }
  return {
    async authorize(name: string, input: Record<string, unknown>, operationId: string) {
      if (name === 'web_search' || name === 'fetch_document') {
        if (!host.network) throw new Error('Public-document networking is not configured; ask the user or use local evidence')
        const url = codingDocumentUrl(host.network, name === 'web_search' ? { query: String(input.query) } : { url: String(input.url) })
        await requireCodingPermission(host.store, host.sessionId, { id: operationId, kind: 'network', value: { origin: url.origin, method: 'GET', searchEndpoint: host.network.searchEndpoint ?? null }, details: `只读查询公开文档：${url.origin}\n本次地址：${url.href}\n限 GET；不携带项目文件或本地凭据。搜索接口仅使用宿主配置的服务凭据。` })
      }
      if (name === 'mcp_tools' || name === 'call_mcp') {
        const installed = await installation(String(input.installationId)), session = (await host.store.getNativeCodingSession(host.sessionId))!
        if (session.binding?.profile.kind === 'container') throw new Error('This local MCP installation has no managed-container transport; no local fallback')
        if (session.parent?.mode === 'read_only') throw new Error('Read-only child cannot start an MCP process')
        await requireCodingPermission(host.store, host.sessionId, { id: operationId, kind: 'mcp', value: { installation: installed, tool: name === 'call_mcp' ? input.tool : 'tools/list', arguments: input.arguments ?? null }, details: `本地 MCP：${installed.name} v${installed.version}\n启动已登记程序；工作目录为本次候选目录；仅继承登记的环境变量。\n工具：${String(input.tool ?? '列出工具')}\n参数：${String(input.arguments ?? '{}')}` })
      }
    },
    async execute(name: string, input: Record<string, unknown>, context: Parameters<CodingLoopTools['execute']>[2]): Promise<unknown> {
      const offset = Number(input.offset ?? 0), limit = Math.min(16000, Math.max(1, Number(input.limit ?? 8000)))
      if (name === 'list_skills' || name === 'read_skill') {
        const manifest = await host.workspace.inspect()
        const skills = manifest.files.filter(file => /^(?:\.agents|\.devflow)\/skills\/.+\/SKILL\.md$/u.test(file.path))
        if (name === 'list_skills') return { skills: skills.map(file => ({ path: file.path, digest: file.hash })), authority: 'instructions_only' }
        const skill = skills.find(file => file.path === input.path)
        if (!skill) throw new Error('Skill is outside the project skill catalog')
        const content = (await host.workspace.read(skill.path)).bytes.toString('utf8')
        return { path: skill.path, digest: skill.hash, authority: 'instructions_only', content: content.slice(offset, offset + limit), nextOffset: offset + limit < content.length ? offset + limit : null }
      }
      if (name === 'list_mcp') return { installations: (await host.store.listLocalMcpInstallations()).filter(item => item.enabled).map(item => ({ id: item.id, name: item.name, version: item.version, tools: item.expectedTools })) }
      await host.assertAuthority(); context.signal.throwIfAborted()
      await mkdir(path.dirname(receiptFile(context.operationId)), { recursive: true, mode: 0o700 })
      if (name === 'web_search' || name === 'fetch_document') {
        const file = path.join(host.workspace.root, 'extensions', `document-${codingDigest(JSON.stringify({ name, url: input.url, query: input.query }))}.json`)
        let document: Awaited<ReturnType<typeof fetchCodingDocument>>
        try { document = JSON.parse(await readFile(file, 'utf8')) as typeof document }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          const url = codingDocumentUrl(host.network!, name === 'web_search' ? { query: String(input.query) } : { url: String(input.url) })
          document = await fetchCodingDocument(host.network!, url, context.signal, name === 'web_search'); await atomicCodingFile(file, Buffer.from(JSON.stringify(document)))
        }
        return { ...document, content: document.content.slice(offset, offset + limit), nextOffset: offset + limit < document.content.length ? offset + limit : null }
      }
      const installed = await installation(String(input.installationId)), registry = createLocalMcpInstallationRegistry({ store: host.store })
      // This intent precedes process start. Unknown calls are never replayed on recovery.
      await atomicCodingFile(receiptFile(context.operationId), Buffer.from(JSON.stringify({ inputDigest: codingDigest(JSON.stringify(input)), status: 'started' })))
      const client = await createLocalMcpClient({ installation: installed, localProjectPath: host.workspace.candidatePath,
        environment: Object.fromEntries(installed.allowedEnvironmentNames.map(key => [key, process.env[key]])), authorizeCall: value => registry.authorizeCall(value),
        spawnProcess: (executable, args, options) => host.commands.startStdio(`${host.sessionId}:mcp:${context.operationId}`, executable, args, options.cwd, options.env, context.signal) })
      try {
        let result: unknown
        if (name === 'mcp_tools') result = { installationId: installed.id, installationVersion: installed.version, tools: client.tools }
        else {
          const registration = createLocalMcpToolRegistrations(client).find(item => item.definition.id === input.tool)
          if (!registration) throw new Error('Tool is not in the verified MCP catalog')
          const args: unknown = JSON.parse(String(input.arguments))
          if (!validateNativeToolValue(registration.definition.inputSchema, args)) throw new Error('MCP arguments do not match the verified schema')
          const tools = createNativeToolRegistry({ tools: [registration], capabilitySetDigest: client.capabilitySetDigest, persistence })
          const session = (await host.store.getNativeCodingSession(host.sessionId))!, now = new Date().toISOString(), deadline = new Date(Math.min(Date.now() + 120000, Date.parse(host.authority.expiresAt))).toISOString()
          const created = createAgentRuntime({ stateVersion: 1, id: `coding-mcp-${codingDigest(`${host.sessionId}:${context.operationId}:${session.toolAuthorities.length}`)}`, scope: host.authority.scope,
            authority: { runId: session.workflowRunId, nodeId: session.nodeId, runVersion: host.authority.runVersion, policyVersion: host.authority.policyVersion }, contextDigest: codingDigest(session.objective), capabilitySetDigest: tools.capabilitySetDigest(),
            bounds: { maxSteps: 1, maxWallTimeMs: 120000, maxToolCalls: 1, maxToolResultBytes: registration.definition.maxResultBytes, maxTrajectoryMetadataBytes: 4096, maxCheckpointBytes: 16384, maxTokens: 1, maxCostUsd: 1 }, requestedAt: now, deadline })
          const running = resumeAgentRuntime({ runtime: created.runtime, expectedCheckpointVersion: created.checkpoint.version, authority: created.runtime.authority, contextDigest: created.runtime.contextDigest, capabilitySetDigest: created.runtime.capabilitySetDigest, now })
          const requested = requestAgentAction({ runtime: running.runtime, expectedCheckpointVersion: running.checkpoint.version, now, action: { id: `${context.operationId}-mcp`, kind: 'tool', capabilityId: registration.definition.id, capabilityVersion: registration.definition.version, requestDigest: digestNativeToolValue(args), requiresPermission: false } })
          await change(draft => { draft.toolAuthorities.push({ runtime: requested.runtime, consumed: false, audit: [] }) })
          const grant = await tools.issueGrant({ runtime: requested.runtime, toolId: registration.definition.id, toolVersion: registration.definition.version, permission: { decision: 'approved', permissionClass: registration.definition.permissionClass, decidedAt: now, expiresAt: deadline }, resourceScope: { kind: 'managed_workspace', localProjectId: session.localProjectId, workspaceId: host.sessionId }, callLimit: 1 })
          result = (await tools.execute({ grant, runtime: requested.runtime, actionId: `${context.operationId}-mcp`, input: args, signal: context.signal })).value
        }
        await client.shutdown()
        const stopped = await host.commands.wait(`${host.sessionId}:mcp:${context.operationId}`)
        if (['unknown', 'starting', 'running'].includes(stopped.status)) throw new Error('MCP process termination is not confirmed')
        await atomicCodingFile(receiptFile(context.operationId), Buffer.from(JSON.stringify({ inputDigest: codingDigest(JSON.stringify(input)), status: 'completed', result })))
        return result
      } finally { await client.shutdown() }
    },
    async reconcile(receipt: CodingToolReceipt): Promise<Awaited<ReturnType<NonNullable<CodingLoopTools['reconcile']>>>> {
      try {
        const saved = JSON.parse(await readFile(receiptFile(receipt.id), 'utf8')) as { inputDigest: string; status: string; result?: unknown }
        return saved.inputDigest === receipt.inputDigest && saved.status === 'completed' ? { state: 'completed', result: saved.result } : { state: 'unknown' }
      } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'not_executed' }; throw error }
    },
  }
}
