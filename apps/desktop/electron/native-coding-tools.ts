import { mkdir, readFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { createAgentRuntime, resumeAgentRuntime, requestAgentAction, validateNativeToolValue, type AgentRuntimeScope, type NativeToolDefinition, type NativeToolJsonSchema } from '@ai-devflow/shared'
import { createNativeToolRegistry, digestNativeToolValue, type NativeToolRegistration } from './native-tool-registry'
import { CodingCandidateWorkspace, atomicCodingFile, codingDigest, codingFilePath, codingRelativePath } from './coding-candidate-workspace'
import { CodingCommandRunner, type CodingCommandPlan } from './coding-command-runner'
import type { LocalStore } from './local-store'
import { mutateNativeCodingSession, type CodingToolReceipt } from './native-coding-session'
import type { CodingLoopTools } from './native-coding-loop'
import { codingDependencyPlan } from './coding-dependency-preparation'
import { requireCodingPermission } from './native-coding-permissions'
import { codingMatchingLines, queryCodingSymbols } from './coding-repository-query'
import { codingExtensionNames, type createCodingExtensions } from './native-coding-extensions'

export type CodingTaskAuthority = { scope: AgentRuntimeScope; runVersion: number; policyVersion: number; expiresAt: string; allowCandidateEdits: boolean; commands: CodingCommandPlan[] }
export type CodingSource = { id: string; version: string; title: string; content: string }
type Edit = { path: string; beforeHash: string | null; afterHash: string | null; content?: string; encoding?: 'base64'; beforeMode: number | null; mode: number }
type Effect = { id: string; objectiveVersion: number; inputDigest: string; edits: Edit[]; result?: unknown }
const string = (maxLength = 16000): NativeToolJsonSchema => ({ type: 'string', maxLength })
const integer = (maximum: number): NativeToolJsonSchema => ({ type: 'integer', minimum: 0, maximum })
function definition(name: string, description: string, properties: Record<string, NativeToolJsonSchema>, required: string[], effect: CodingToolReceipt['effect'] = 'read'): NativeToolDefinition {
  return { stateVersion: 1, id: name, version: 1, source: 'native', description,
    inputSchema: { type: 'object', properties, required, additionalProperties: false },
    outputSchema: { type: 'object', properties: { data: string(200000) }, required: ['data'], additionalProperties: false },
    permissionClass: effect === 'read' ? 'read' : effect === 'write' ? 'edit' : 'execute', sideEffectClass: effect === 'read' ? 'none' : effect === 'write' ? 'workspace_write' : 'local_process',
    defaultDeadlineMs: 120000, maxResultBytes: 256000, idempotency: effect === 'read' ? 'idempotent' : 'reconcilable', auditPolicy: 'redacted_metadata_only' }
}
const builtinDefinitions = [
  definition('list_directory', '分页发现目录及文件；不受初始文件清单限制。', { path: string(1000), offset: integer(200000), limit: integer(200) }, []),
  definition('glob_files', '按 glob 分页查找仓库文件。', { pattern: string(1000), offset: integer(200000), limit: integer(200) }, ['pattern']),
  definition('read_file', '按行读取文本，返回实际字节摘要；二进制不冒充文本。', { path: string(1000), startLine: integer(10000000), limit: integer(400) }, ['path']),
  definition('read_ranges', '一次读取同一文件的多组行范围，返回当前内容身份。', { path: string(1000), ranges: { type: 'array', maxItems: 16, items: { type: 'object', properties: { startLine: integer(10000000), limit: integer(400) }, required: ['startLine', 'limit'], additionalProperties: false } } }, ['path', 'ranges']),
  definition('search_text', '分页检索文字/正则及上下文，可指定路径 glob。正则在独立线程中有界运行。', { query: string(2000), regex: { type: 'boolean' }, contextLines: integer(5), glob: string(1000), offset: integer(200000), limit: integer(200) }, ['query']),
  definition('find_symbol', '查询带版本的 TypeScript/JavaScript 语义索引；其他语言会说明不可用。', { query: string(500), offset: integer(200000), limit: integer(100) }, ['query']),
  definition('find_references', '按已读文件摘要及行列定位 TypeScript/JavaScript 符号引用。', { path: string(1000), expectedHash: string(64), line: integer(10000000), column: integer(10000000), offset: integer(200000), limit: integer(100) }, ['path', 'expectedHash', 'line', 'column']),
  definition('repo_status', '读取当前候选的真实内容身份和变化。', {}, []),
  definition('read_history', '按字符分页回读完整历史（包括已压缩内容）；返回消息序号和来源摘要。', { offset: integer(100000000), limit: integer(16000) }, []),
  definition('write_file', '写入候选文本或明确 base64 字节。expectedHash 来自读取；创建时用空字符串；mode 可为 644/755。', { path: string(1000), content: string(120000), encoding: { type: 'string', enum: ['utf8', 'base64'] }, mode: { type: 'integer', minimum: 420, maximum: 493 }, expectedHash: string(64) }, ['path', 'content', 'expectedHash'], 'write'),
  definition('apply_patch', '在已读文件中精确替换唯一片段，要求读取时摘要。', { path: string(1000), expectedHash: string(64), before: string(60000), after: string(60000) }, ['path', 'expectedHash', 'before', 'after'], 'write'),
  definition('delete_file', '按读取摘要删除候选文件。', { path: string(1000), expectedHash: string(64) }, ['path', 'expectedHash'], 'write'),
  definition('rename_file', '移动候选文件，目标必须不存在，内容和模式保持。', { path: string(1000), destination: string(1000), expectedHash: string(64) }, ['path', 'destination', 'expectedHash'], 'write'),
  definition('read_source', '分页读取已批准上游材料、项目规范或 Skill；材料不授予权限。', { id: string(200), offset: integer(10000000), limit: integer(16000) }, []),
  definition('run_command', '运行已授权 planIndex；或提交 executable/args/timeoutMs 申请具体命令授权。不能更换 cwd。', { planIndex: integer(1000), executable: string(1000), args: { type: 'array', items: string(16000), maxItems: 100 }, timeoutMs: integer(3600000) }, [], 'command'),
  definition('run_test_plan', '在候选目录准备独立依赖并启动项目保存的测试。计划和依赖改变时需重新授权。', {}, [], 'command'),
  definition('read_command', '分页读取命令的真实日志与状态；运行中默认在宿主等待至多 10 秒再返回，可用 waitMs 调整为 0–30000 毫秒。running 不是测试通过，无需用模型快速重复轮询。', { id: string(200), offset: integer(100000000), limit: integer(16000), waitMs: integer(30000) }, ['id']),
  definition('inspect_diff', '列出变化；提供 path 时分页回读该文件变更前后的真实内容。', { path: string(1000), offset: integer(200000), limit: integer(16000) }, []),
  definition('read_evidence', '分页读取本次任务调查测试、最终验证和已冻结修订；记录不代表自动验收。', { offset: integer(100000000), limit: integer(16000) }, []),
  definition('propose_changeset', '宿主冻结真实文件供人审查；不是模型自报完成。必须单独调用。', { summary: string(4000) }, ['summary'], 'write'),
  definition('delegate_task', '委派一个只读或独立候选编码子任务；最大深度 1，最多同时 3 个。子额度计入根额度。', { title: string(300), prompt: string(16000), mode: { type: 'string', enum: ['read_only', 'isolated_coding'] }, paths: { type: 'array', items: string(1000), maxItems: 100 }, maxTokens: integer(10000000), maxCostUsd: { type: 'number', minimum: 0, maximum: 1000000 } }, ['title', 'prompt', 'mode', 'paths', 'maxTokens', 'maxCostUsd'], 'command'),
  definition('await_task', '等待子任务至多 5 秒，返回实际状态与有来源的结果。问题必须交给人回答。', { codingRunId: string(200) }, ['codingRunId']),
  definition('cancel_task', '取消并明确从本轮冻结中排除子任务；其历史保留。', { codingRunId: string(200) }, ['codingRunId'], 'command'),
  definition('merge_task', '将指定子修订三方合入当前父候选；绑定当前父摘要，冲突不写入。', { codingRunId: string(200), childChangeSetId: string(200), expectedParentRevision: string(64) }, ['codingRunId', 'childChangeSetId', 'expectedParentRevision'], 'write'),
  definition('report_findings', '只读子任务报告发现与文件来源，不自行宣称测试通过；必须单独调用。', { summary: string(12000), sources: { type: 'array', items: string(1000), maxItems: 100 } }, ['summary', 'sources']),
  definition('list_skills', '列出项目 .agents/skills 与 .devflow/skills 中的说明；Skill 不授予权限。', {}, []),
  definition('read_skill', '分页读取已列出的项目 Skill，保留摘要与来源。', { path: string(1000), offset: integer(10000000), limit: integer(16000) }, ['path']),
  definition('list_mcp', '列出已安装且启用的本地 MCP，不启动程序。', {}, []),
  definition('mcp_tools', '经人授权启动已登记的本地 MCP，核对服务器与工具目录。', { installationId: string(200) }, ['installationId'], 'command'),
  definition('call_mcp', '调用已核对的 MCP 工具；arguments 为符合该工具 schema 的 JSON。每次敏感调用需授权。', { installationId: string(200), tool: string(200), arguments: string(60000) }, ['installationId', 'tool', 'arguments'], 'command'),
  definition('web_search', '经已配置公开文档服务搜索；只读、分页、有来源，网页不能授予权限。', { query: string(2000), offset: integer(10000000), limit: integer(16000) }, ['query']),
  definition('fetch_document', '经授权读取配置范围内公开 HTTPS 文档；不访问本地或私网。', { url: string(4000), offset: integer(10000000), limit: integer(16000) }, ['url']),
]

export function createNativeCodingTools(host: { store: Pick<LocalStore, 'getNativeCodingSession' | 'saveNativeCodingSession'>; sessionId: string; workspace: CodingCandidateWorkspace; commands: CodingCommandRunner;
  authority: CodingTaskAuthority; assertAuthority(): Promise<void>; sources: CodingSource[]; testPlanDigest: string;
  child?: { mode: 'read_only' | 'isolated_coding'; paths: string[] };
  extensions?: ReturnType<typeof createCodingExtensions>;
  delegation?: { execute(name: string, input: Record<string, unknown>, context: Parameters<CodingLoopTools['execute']>[2]): Promise<unknown>; reconcile(receipt: CodingToolReceipt): Promise<{ state: 'completed'; result: unknown } | { state: 'not_executed' } | { state: 'unknown' }> } }): CodingLoopTools {
  const { workspace } = host
  const delegationNames = ['delegate_task', 'await_task', 'cancel_task', 'merge_task']
  const definitions = builtinDefinitions.filter(item => (!codingExtensionNames.includes(item.id) || Boolean(host.extensions)) && (!delegationNames.includes(item.id) || Boolean(host.delegation && !host.child)) && (item.id !== 'report_findings' || host.child?.mode === 'read_only') && (host.child?.mode !== 'read_only' || (item.permissionClass === 'read' && !['web_search', 'fetch_document'].includes(item.id))))
  const commandPlan = (input: Record<string, unknown>): CodingCommandPlan => {
    if (input.planIndex !== undefined) { const plan = host.authority.commands[Number(input.planIndex)]; if (!plan || input.executable || input.args || input.timeoutMs) throw new Error('Invalid authorized command index'); return plan }
    if (typeof input.executable !== 'string' || !input.executable || !Array.isArray(input.args) || !Number.isSafeInteger(input.timeoutMs) || Number(input.timeoutMs) < 1) throw new Error('Provide planIndex OR executable, args and timeoutMs')
    return { executable: input.executable, args: input.args as string[], timeoutMs: Number(input.timeoutMs), profile: host.authority.commands[0]?.profile ?? { kind: 'trusted_local' } }
  }
  const change = (update: Parameters<typeof mutateNativeCodingSession>[2]) => mutateNativeCodingSession(host.store, host.sessionId, update)
  const readable = (relative: string) => {
    codingRelativePath(relative)
    if (relative.split('/').some(part => /^\.env(?:\.|$)|^\.ssh$|^\.aws$|^credentials$/iu.test(part)) || workspace.identity.base.excludedPaths.some(item => relative === item || relative.startsWith(`${item}/`))) throw new Error('Path is outside authorized source scope')
  }
  const effectFile = (id: string) => path.join(workspace.root, 'effects', `${codingDigest(id)}.json`)
  const fileHash = async (relative: string) => { try { return (await workspace.read(relative)).hash } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error } }
  const saveEffect = (effect: Effect) => atomicCodingFile(effectFile(effect.id), Buffer.from(JSON.stringify(effect)))
  const finishEffect = async (effect: Effect, signal?: AbortSignal): Promise<unknown> => {
    for (const edit of effect.edits) {
      signal?.throwIfAborted()
      const session = await host.store.getNativeCodingSession(host.sessionId)
      if (session?.binding && (session.status !== 'running' || session.objectiveVersion !== effect.objectiveVersion)) throw new Error('Candidate writer was revoked')
      readable(edit.path)
      const actual = await fileHash(edit.path)
      const actualMode = actual ? (await workspace.read(edit.path)).mode : null
      if (actual === edit.afterHash && (actual === null || actualMode === edit.mode)) continue
      if (actual !== edit.beforeHash) throw new Error('Edit receipt conflicts with current bytes')
      if (actualMode !== edit.beforeMode) throw new Error('File mode changed after observation')
      await host.assertAuthority()
      if (edit.afterHash === null) await workspace.remove(edit.path, edit.beforeHash!)
      else await workspace.write(edit.path, edit.encoding === 'base64' ? Buffer.from(edit.content!, 'base64') : edit.content!, edit.beforeHash, edit.mode)
    }
    effect.result = { changedPaths: effect.edits.map(edit => edit.path), revision: (await workspace.inspect()).digest }
    await saveEffect(effect); return effect.result
  }
  let activeContext: Parameters<CodingLoopTools['execute']>[2] | undefined
  const run = async (name: string, input: Record<string, unknown>, signal: AbortSignal): Promise<unknown> => {
    const ctx = { ...activeContext!, signal }
    if (codingExtensionNames.includes(name)) return host.extensions!.execute(name, input, ctx)
    if (delegationNames.includes(name)) return host.delegation!.execute(name, input, ctx)
    if (name === 'report_findings') {
      for (const source of input.sources as string[]) { readable(source); await workspace.read(source) }
      return { summary: input.summary, sources: await Promise.all((input.sources as string[]).map(async relative => ({ path: relative, hash: (await workspace.read(relative)).hash }))), baseDigest: workspace.identity.base.digest }
    }
    const offset = Number(input.offset ?? 0), limit = Math.max(1, Number(input.limit ?? 100))
    if (name === 'find_symbol' || name === 'find_references') return queryCodingSymbols(workspace, readable, name, input)
    if (name === 'read_evidence') {
      const session = (await host.store.getNativeCodingSession(host.sessionId))!
      const content = JSON.stringify({ final: session.deliveryEvidence, revisions: session.revisions.map(({ id, digest, objectiveVersion, testPlanDigest }) => ({ id, digest, objectiveVersion, testPlanDigest })), commands: session.toolReceipts.filter(receipt => ['run_command', 'run_test_plan', 'read_command'].includes(receipt.name)) })
      return { content: content.slice(offset, offset + Math.min(limit, 16000)), nextOffset: offset + limit < content.length ? offset + limit : null, sourceDigest: codingDigest(content) }
    }
    if (name === 'inspect_diff' && input.path) {
      const relative = String(input.path); readable(relative)
      const before = workspace.identity.base.files.find(file => file.path === relative)
      let after: Awaited<ReturnType<typeof workspace.read>> | undefined
      try { after = await workspace.read(relative) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      const beforeBytes = before ? await workspace.blob(before.hash) : Buffer.alloc(0), afterBytes = after?.bytes ?? Buffer.alloc(0)
      if (beforeBytes.includes(0) || afterBytes.includes(0)) return { path: relative, binary: true, beforeHash: before?.hash, afterHash: after?.hash, beforeBytes: beforeBytes.length, afterBytes: afterBytes.length }
      const content = JSON.stringify({ before: beforeBytes.toString('utf8'), after: afterBytes.toString('utf8'), beforeMode: before?.mode, afterMode: after?.mode })
      return { path: relative, beforeHash: before?.hash, afterHash: after?.hash, content: content.slice(offset, offset + Math.min(limit, 16000)), nextOffset: offset + limit < content.length ? offset + limit : null }
    }
    if (name === 'read_history') {
      const current = await host.store.getNativeCodingSession(host.sessionId)
      const history = JSON.stringify(current!.transcript.map((message, index) => ({ index, message })))
      return { sourceDigest: codingDigest(history), content: history.slice(offset, offset + limit), nextOffset: offset + limit < history.length ? offset + limit : null }
    }
    if (name === 'read_source') {
      if (!input.id) return { sources: host.sources.map(({ id, title, version }) => ({ id, title, version })) }
      const source = host.sources.find(item => item.id === input.id); if (!source) throw new Error('Unknown source')
      const count = Math.min(limit, 16000)
      return { id: source.id, version: source.version, content: source.content.slice(offset, offset + count), nextOffset: offset + count < source.content.length ? offset + count : null }
    }
    if (name === 'read_file' || name === 'read_ranges') {
      const relative = String(input.path); readable(relative)
      const file = await workspace.read(relative)
      if (file.bytes.includes(0)) return { path: relative, hash: file.hash, binary: true, bytes: file.bytes.length }
      const text = new TextDecoder('utf-8', { fatal: true }).decode(file.bytes), lines = text.split('\n'), start = Math.max(1, Number(input.startLine ?? 1))
      const count = Math.min(limit, 400)
      if (name === 'read_ranges') {
        const ranges = (input.ranges as Array<{ startLine: number; limit: number }>).map(range => ({ startLine: Math.max(1, range.startLine), content: lines.slice(Math.max(0, range.startLine - 1), Math.max(0, range.startLine - 1) + range.limit).join('\n') }))
        if (Buffer.byteLength(JSON.stringify(ranges)) > 120000) throw new Error('Read ranges exceed one page; request smaller ranges')
        return { path: relative, hash: file.hash, mode: file.mode, ranges, revision: (await workspace.inspect()).digest }
      }
      const content = lines.slice(start - 1, start - 1 + count).join('\n')
      if (Buffer.byteLength(content) > 120000) throw new Error('Read page too large; request fewer lines')
      return { path: relative, hash: file.hash, mode: file.mode, startLine: start, content, nextLine: start - 1 + count < lines.length ? start + count : null, revision: (await workspace.inspect()).digest }
    }
    if (['write_file', 'apply_patch', 'delete_file', 'rename_file'].includes(name)) {
      const relative = String(input.path); readable(relative)
      if (host.child && !host.child.paths.some(scope => relative === scope || relative.startsWith(`${scope}/`))) throw new Error('Write is outside delegated paths')
      const beforeHash = String(input.expectedHash) || null
      if (await fileHash(relative) !== beforeHash) throw new Error('File changed since observation')
      const existing = beforeHash ? await workspace.read(relative) : null
      let content = String(input.content ?? '')
      if (name === 'apply_patch') {
        if (!existing || !input.before) throw new Error('Patch requires an existing file and nonempty context')
        const text = new TextDecoder('utf-8', { fatal: true }).decode(existing.bytes), needle = String(input.before), first = text.indexOf(needle)
        if (first < 0 || text.indexOf(needle, first + needle.length) >= 0) throw new Error('Patch context is absent or ambiguous')
        content = text.slice(0, first) + String(input.after) + text.slice(first + needle.length)
      }
      if (input.encoding === 'base64' && Buffer.from(content, 'base64').toString('base64') !== content) throw new Error('Non-canonical base64 content')
      const bytes = input.encoding === 'base64' ? Buffer.from(content, 'base64') : Buffer.from(content)
      const mode = input.mode === undefined ? existing?.mode ?? 0o644 : Number(input.mode)
      if (![0o644, 0o755].includes(mode)) throw new Error('Supported file modes are 644 and 755')
      const edits: Edit[] = [{ path: relative, beforeHash, beforeMode: existing?.mode ?? null, afterHash: name === 'delete_file' || name === 'rename_file' ? null : codingDigest(bytes), ...(name === 'delete_file' || name === 'rename_file' ? {} : { content, ...(input.encoding === 'base64' ? { encoding: 'base64' as const } : {}) }), mode }]
      if (name === 'rename_file') {
        if (!existing) throw new Error('Rename requires an existing file')
        const destination = String(input.destination); readable(destination)
        if (host.child && !host.child.paths.some(scope => destination === scope || destination.startsWith(`${scope}/`))) throw new Error('Rename is outside delegated paths')
        if (await fileHash(destination) !== null) throw new Error('Rename destination exists')
        edits.unshift({ path: destination, beforeHash: null, beforeMode: null, afterHash: existing.hash, content: existing.bytes.toString('base64'), encoding: 'base64', mode: existing.mode })
      }
      await mkdir(path.join(workspace.root, 'effects'), { recursive: true, mode: 0o700 })
      const effect: Effect = { id: ctx.operationId, objectiveVersion: ctx.session.objectiveVersion, inputDigest: codingDigest(JSON.stringify(input)), edits }
      await saveEffect(effect); return finishEffect(effect, signal)
    }
    if (name === 'run_command' || name === 'run_test_plan') {
      if ((name === 'run_test_plan' || input.planIndex === 0) && ctx.session.binding?.manualValidationPlan) throw new Error('本任务使用事先选择的人工验收；没有自动测试计划。额外命令需要单独授权，其结果不替代人工验收。')
      let plan = commandPlan(name === 'run_test_plan' ? { planIndex: 0 } : input)
      if (name === 'run_test_plan' || input.planIndex === 0) {
        const dependencies = await codingDependencyPlan(workspace.candidatePath, plan.profile, workspace.identity.base.excludedPaths)
        if (dependencies.plan) plan = { ...plan, preparation: { executable: dependencies.plan.executable, args: dependencies.plan.args, timeoutMs: dependencies.plan.timeoutMs } }
      }
      return host.commands.start(`${host.sessionId}:${ctx.operationId}`, plan, workspace.candidatePath, ctx.signal)
    }
    if (name === 'read_command') {
      if (!String(input.id).startsWith(`${host.sessionId}:`)) throw new Error('Command is outside this task')
      return host.commands.read(String(input.id), offset, Math.min(limit, 16000), { waitMs: Number(input.waitMs ?? 10000), signal: ctx.signal })
    }
    if (name === 'propose_changeset') {
      if (host.commands.hasActiveCommands) throw new Error('Commands are still running; wait before freezing')
      if (host.child) {
        const observed = await workspace.inspect(), baseline = new Map(workspace.identity.base.files.map(file => [file.path, file]))
        const changed = [...observed.files.filter(file => baseline.get(file.path)?.hash !== file.hash || baseline.get(file.path)?.mode !== file.mode), ...workspace.identity.base.files.filter(file => !observed.files.some(current => current.path === file.path))]
        if (changed.some(file => !host.child!.paths.some(scope => file.path === scope || file.path.startsWith(`${scope}/`)))) throw new Error('Child command changed a file outside delegated scope')
      }
      const dependencies = await codingDependencyPlan(workspace.candidatePath, ctx.session.binding?.profile ?? { kind: 'trusted_local' }, workspace.identity.base.excludedPaths)
      const revision = await workspace.freeze({ id: `changeset-${codingDigest(`${host.sessionId}:${ctx.operationId}`)}`, sessionId: host.sessionId, codingRunId: ctx.session.codingRunId, objectiveVersion: ctx.session.objectiveVersion, policyVersion: host.authority.policyVersion, testPlanDigest: codingDigest(JSON.stringify({ testPlan: host.testPlanDigest, dependencies: dependencies.digest })), summary: String(input.summary), now: new Date().toISOString() })
      await change(draft => { if (!draft.revisions.some(item => item.id === revision.id)) draft.revisions.push(revision) })
      return { revisionId: revision.id, digest: revision.digest, summary: revision.summary, fileCount: revision.operations.length }
    }
    const manifest = await workspace.inspect()
    const files = manifest.files.filter(file => { try { readable(file.path); return true } catch { return false } })
    if (name === 'glob_files') {
      const selected = files.filter(file => path.matchesGlob(file.path, String(input.pattern)))
      return { files: selected.slice(offset, offset + limit), nextOffset: offset + limit < selected.length ? offset + limit : null, revision: manifest.digest }
    }
    if (name === 'list_directory') {
      const directory = input.path ? `${codingRelativePath(String(input.path))}/` : ''
      const entries = [...new Set(files.filter(file => file.path.startsWith(directory)).map(file => file.path.slice(directory.length).split('/')[0]!))].sort()
      return { entries: entries.slice(offset, offset + limit), nextOffset: offset + limit < entries.length ? offset + limit : null, revision: manifest.digest }
    }
    if (name === 'search_text') {
      if (!input.query) throw new Error('Search query is empty')
      const matches: Array<{ path: string; line: number; text: string; hash: string; contextStart: number; context: string[] }> = []
      let total = 0
      for (const file of files) {
        if (input.glob && !path.matchesGlob(file.path, String(input.glob))) continue
        ctx.signal.throwIfAborted()
        const value = await workspace.read(file.path)
        if (value.bytes.includes(0)) continue
        const text = value.bytes.toString('utf8'), lines = text.split('\n'), contextLines = Number(input.contextLines ?? 0)
        for (const line of await codingMatchingLines(text, String(input.query), Boolean(input.regex), signal)) {
          if (total++ >= offset && matches.length < Math.min(limit, 30)) matches.push({ path: file.path, line: line + 1, text: lines[line]!.slice(0, 500), hash: value.hash, contextStart: Math.max(1, line + 1 - contextLines), context: lines.slice(Math.max(0, line - contextLines), line + 1 + contextLines).map(value => value.slice(0, 500)) })
        }
      }
      return { matches, nextOffset: offset + matches.length < total ? offset + matches.length : null, revision: manifest.digest }
    }
    const base = new Map(workspace.identity.base.files.map(file => [file.path, file]))
    const changed = manifest.files.filter(file => base.get(file.path)?.hash !== file.hash || base.get(file.path)?.mode !== file.mode)
    const removed = workspace.identity.base.files.filter(file => !manifest.files.some(current => current.path === file.path))
    return { revision: manifest.digest, changed: changed.slice(offset, offset + limit), removed: removed.slice(offset, offset + limit), nextOffset: offset + limit < Math.max(changed.length, removed.length) ? offset + limit : null }
  }
  const handlers = new Set<Promise<unknown>>()
  const registrations: NativeToolRegistration[] = definitions.map(item => ({ definition: item, resourceKinds: ['managed_workspace'], handler: async ({ input, signal }) => {
    const invocation = run(item.id, input as Record<string, unknown>, signal); handlers.add(invocation)
    try { return { data: JSON.stringify(await invocation) } } finally { handlers.delete(invocation) }
  } }))
  const registry = createNativeToolRegistry({ tools: registrations, persistence: {
    reserveGrant: async grant => {
      await change(draft => {
        const record = draft.toolAuthorities.find(item => item.runtime.id === grant.runtimeId)
        if (!record || record.grant) throw new Error('Tool authority is not reservable')
        record.grant = grant
      }); return { reserved: true }
    },
    beginExecution: async ({ expectedGrant, audit }) => {
      await change(draft => {
        const record = draft.toolAuthorities.find(item => item.grant?.id === expectedGrant.id)
        if (!record || record.consumed || record.grant?.requestDigest !== expectedGrant.requestDigest) throw new Error('Tool grant already consumed')
        record.consumed = true; record.audit.push(audit)
      }); return { consumed: true }
    },
    appendAudit: async audit => { await change(draft => { const record = draft.toolAuthorities.find(item => item.runtime.id === audit.runtimeId); if (!record) throw new Error('Missing tool authority'); record.audit.push(audit) }) },
  } })
  let queue: Promise<unknown> = Promise.resolve()
  const tools: CodingLoopTools = {
    definitions: definitions.map(item => ({ type: 'function', function: { name: item.id, description: item.description, parameters: item.inputSchema } })),
    effects: Object.fromEntries(definitions.map(item => [item.id, item.permissionClass === 'read' ? 'read' : item.permissionClass === 'edit' ? 'write' : 'command'])),
    async drain() { await queue.catch(() => undefined); await Promise.allSettled([...handlers]) },
    execute(name, input, context) {
      // Serial writes and authority commits; the loop may fan out separate read-only sessions.
      const invocation = queue.then(async () => {
        await host.assertAuthority(); context.signal.throwIfAborted()
        const item = definitions.find(value => value.id === name)
        if (!item || !validateNativeToolValue(item.inputSchema, input)) throw new Error('Invalid tool arguments')
        if (Date.now() >= Date.parse(host.authority.expiresAt) || (item.permissionClass === 'edit' && !host.authority.allowCandidateEdits)) throw new Error('Coding tool is not authorized')
        if (item.permissionClass !== 'read' && host.commands.hasActiveCommands) throw new Error('Wait for the running command before another candidate writer')
        if (codingExtensionNames.includes(name)) await host.extensions!.authorize(name, input, context.operationId)
        if (name === 'run_command' && input.planIndex === undefined) {
          const plan = commandPlan(input)
          await requireCodingPermission(host.store, host.sessionId, { id: context.operationId, kind: 'command', value: plan, details: `命令：${plan.executable}\n参数：${JSON.stringify(plan.args)}\n目录：本次私有候选目录\n超时：${plan.timeoutMs / 1000} 秒\n执行方式：${plan.profile.kind}` })
        }
        if (name === 'run_test_plan' || (name === 'run_command' && input.planIndex === 0) || name === 'propose_changeset') {
          const session = await host.store.getNativeCodingSession(host.sessionId)
          if (name === 'propose_changeset' && session?.children.some(child => child.state === 'active')) throw new Error('Collect, merge or explicitly cancel every child before freezing')
          const profile = session?.binding?.profile ?? host.authority.commands[0]?.profile ?? { kind: 'trusted_local' as const }
          const dependencies = await codingDependencyPlan(workspace.candidatePath, profile, workspace.identity.base.excludedPaths)
          if (dependencies.command && session?.binding?.dependencyPlan?.digest !== dependencies.digest) await requireCodingPermission(host.store, host.sessionId, { id: context.operationId, kind: 'dependencies', value: dependencies, details: `为当前依赖输入准备候选及独立验证目录：\n${dependencies.command}\n输入摘要：${dependencies.inputDigest}\n可能下载依赖并执行安装脚本，使用已选执行方式。` })
          if (name === 'propose_changeset' && !dependencies.frozen) throw new Error('Generate a lockfile in the candidate before freezing final verification')
        }
        activeContext = context
        const current = await host.store.getNativeCodingSession(host.sessionId)
        // Long commands run in the durable worker; the registry only authorizes and starts them.
        const duration = 120000
        const now = new Date().toISOString(), deadline = new Date(Math.min(Date.parse(host.authority.expiresAt), Date.parse(now) + duration)).toISOString()
        const created = createAgentRuntime({ stateVersion: 1, id: `coding-tool-${codingDigest(`${host.sessionId}:${context.operationId}:${current!.toolAuthorities.length}`)}`, scope: host.authority.scope,
          authority: { runId: context.session.workflowRunId, nodeId: context.session.nodeId, runVersion: host.authority.runVersion, policyVersion: host.authority.policyVersion },
          contextDigest: codingDigest(context.session.objective), capabilitySetDigest: registry.capabilitySetDigest(),
          bounds: { maxSteps: 1, maxWallTimeMs: duration, maxToolCalls: 1, maxToolResultBytes: 256000, maxTrajectoryMetadataBytes: 4096, maxCheckpointBytes: 16384, maxTokens: 1, maxCostUsd: 1 }, requestedAt: now, deadline })
        const running = resumeAgentRuntime({ runtime: created.runtime, expectedCheckpointVersion: created.checkpoint.version, authority: created.runtime.authority, contextDigest: created.runtime.contextDigest, capabilitySetDigest: created.runtime.capabilitySetDigest, now })
        const requested = requestAgentAction({ runtime: running.runtime, expectedCheckpointVersion: running.checkpoint.version, now, action: { id: context.operationId, kind: 'tool', capabilityId: name, capabilityVersion: 1, requestDigest: digestNativeToolValue(input), requiresPermission: false } })
        await change(draft => { draft.toolAuthorities.push({ runtime: requested.runtime, consumed: false, audit: [] }) })
        const grant = await registry.issueGrant({ runtime: requested.runtime, toolId: name, toolVersion: 1, permission: { decision: 'approved', permissionClass: item.permissionClass, decidedAt: now, expiresAt: deadline }, resourceScope: { kind: 'managed_workspace', localProjectId: context.session.localProjectId, workspaceId: host.sessionId }, callLimit: 1 })
        const output = await registry.execute({ grant, runtime: requested.runtime, actionId: context.operationId, input, signal: context.signal })
        return JSON.parse((output.value as { data: string }).data) as unknown
      })
      queue = invocation.catch(() => undefined); return invocation
    },
    async reconcile(receipt, session) {
      if (codingExtensionNames.includes(receipt.name)) return host.extensions!.reconcile(receipt)
      if (delegationNames.includes(receipt.name)) return host.delegation!.reconcile(receipt)
      if (receipt.name === 'propose_changeset') {
        const id = `changeset-${codingDigest(`${host.sessionId}:${receipt.id}`)}`
        const revision = session.revisions.find(item => item.id === id) ?? await workspace.revision(id)
        if (revision && (revision.sessionId !== session.id || revision.objectiveVersion !== session.objectiveVersion || revision.policyVersion !== host.authority.policyVersion)) return { state: 'unknown', reason: 'Frozen revision authority changed before publication' }
        if (revision && !session.revisions.some(item => item.id === id)) await change(draft => { if (!draft.revisions.some(item => item.id === id)) draft.revisions.push(revision) })
        return revision ? { state: 'completed', result: { revisionId: revision.id, digest: revision.digest, summary: revision.summary, fileCount: revision.operations.length } } : { state: 'not_executed' }
      }
      if (receipt.name === 'run_command' || receipt.name === 'run_test_plan') {
        const command = await host.commands.get(`${host.sessionId}:${receipt.id}`)
        return command ? ['starting', 'running', 'unknown'].includes(command.status) && !host.commands.isActive(command.id) ? { state: 'unknown' } : { state: 'completed', result: command } : { state: 'not_executed' }
      }
      let effect: Effect
      try { effect = JSON.parse(await readFile(effectFile(receipt.id), 'utf8')) as Effect }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'not_executed' }; throw error }
      if (effect.inputDigest !== receipt.inputDigest || effect.objectiveVersion !== session.objectiveVersion) return { state: 'unknown' }
      if (effect.result) return { state: 'completed', result: effect.result }
      try { return { state: 'completed', result: await finishEffect(effect) } } catch { return { state: 'unknown' } }
    },
  }
  return tools
}
