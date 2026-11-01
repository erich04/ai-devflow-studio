import { realpath } from 'node:fs/promises'
import {
  indexKnowledgeSources, knowledgeDocumentAppliesToStage, knowledgeModelLabels, parseHindsightSetup,
  parseKnowledgeModel, parseKnowledgeSearchArgs, rankMemoryByRelevance, redactSensitiveText, truncateUtf8,
  type HindsightSetupInput, type HindsightStatus, type RepositoryKnowledgeSnapshot,
  type RetrievedKnowledgeManifest,
} from '@ai-devflow/shared'
import type { LocalStore } from './local-store'
import { hindsightDigest, hindsightPairingBinding, hindsightPairingMatches, type HindsightConfiguration, type HindsightProjection } from './hindsight-store'
import { type HindsightCandidate, type HindsightClient, HindsightError } from './hindsight-client'
import { readSelectedKnowledgeModel, readSelectedKnowledgeSource } from './repository-knowledge'
import { conversationContentPage } from './workbench-requirement-context'

export type HindsightScope = { projectId: string; userId: string }
export type HindsightSearchTurn = {
  calls: number; candidates: Map<string, Promise<{ values: HindsightCandidate[]; degraded: boolean }>>
}
type Dependencies = {
  store: LocalStore; transportAvailable: boolean
  client(config: HindsightConfiguration): Promise<HindsightClient>
  loadKnowledge(projectId: string): Promise<RepositoryKnowledgeSnapshot>
  now?: () => string
}
type KnowledgeMatch = {
  path: string; title: string; content: string; contentDigest: string; modelVersion: string
  matchReason: 'lexical' | 'semantic' | 'both'; readWith: 'knowledge_read'
  truncated: boolean
  readArgs: { path: string; sourceRef: string; expectedDigest: string }
}
const NOTE = '知识是调查上下文，不代表 Gate 批准。远端候选仅用于定位；正文来自当前本地文件。'
const keyFor = (root: string, sourcePath: string) => `knowledge:${root}:${sourcePath}`
const sourceId = (config: HindsightConfiguration, sourcePath: string) =>
  hindsightDigest(JSON.stringify([config.projectId, config.ownerUserId, config.rootGeneration, sourcePath]))

/** Main-owned coordinator. Store mutations are short; all HTTP happens outside the SQL queue. */
export class HindsightService {
  private running = false
  private refreshCursor = 0
  private readonly now: () => string
  constructor(private readonly deps: Dependencies) { this.now = deps.now ?? (() => new Date().toISOString()) }
  createSearchTurn(): HindsightSearchTurn { return { calls: 0, candidates: new Map() } }

  private async client(config: HindsightConfiguration) {
    try { return await this.deps.client(config) }
    catch (error) { throw error instanceof HindsightError ? error : new HindsightError('transport') }
  }
  /** One project refresh and one durable job per background cycle. */
  async cycle(): Promise<{ refreshDeferred: boolean }> {
    if (!this.deps.transportAvailable) return { refreshDeferred: false }
    const configs = (await this.deps.store.listHindsightConfigurations()).filter((c) => c.enabled)
    const config = configs.length ? configs[this.refreshCursor++ % configs.length] : undefined
    let refreshDeferred = false
    if (config) {
      try { await this.refresh({ projectId: config.projectId, userId: config.ownerUserId }) }
      catch { refreshDeferred = true }
    }
    // A missing or corrupt repository must not starve an unrelated cleanup job.
    await this.tick()
    return { refreshDeferred }
  }
  private async activeGeneration(scope: HindsightScope, generation: string) {
    const pairing = await this.deps.store.getDesktopPairingCredential()
    const latest = await this.deps.store.getHindsightConfiguration(scope.projectId)
    return Boolean(latest?.enabled && latest.ownerUserId === scope.userId && latest.generation === generation && hindsightPairingMatches(latest, pairing))
  }
  async status(scope: HindsightScope): Promise<HindsightStatus> {
    const config = await this.deps.store.getHindsightConfiguration(scope.projectId)
    const pairing = await this.deps.store.getDesktopPairingCredential()
    const own = config?.ownerUserId === scope.userId ? config : null
    const rows = own ? await this.deps.store.listHindsightProjections(scope.projectId) : []
    const counts: Record<string, number> = {}
    for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1
    return { configured: Boolean(own), enabled: Boolean(own?.enabled && hindsightPairingMatches(own, pairing)),
      pairedProject: pairing?.localProjectId === scope.projectId, transportAvailable: this.deps.transportAvailable,
      endpoint: own?.endpoint ?? 'http://127.0.0.1:8888', selectedPaths: own?.selectedPaths ?? [], includeMemories: own?.includeMemories ?? false,
      ...(own ? { modelVersion: own.model.version } : {}), counts,
      note: this.deps.transportAvailable ? '已允许网络试点；本机 Hindsight 也可能调用远程模型。正式记忆使用影子召回。'
        : '网络试点尚未启用；只保存选择、核验本地来源并提供本地搜索。' }
  }
  async configure(scope: HindsightScope, value: HindsightSetupInput, encryptedApiKey: string | null) {
    const input = parseHindsightSetup(value)
    if (scope.projectId !== input.projectId) throw new Error('Hindsight 项目范围不一致。')
    const pairing = await this.deps.store.getDesktopPairingCredential()
    const paired = pairing?.localProjectId === scope.projectId
    if (input.enabled && paired && (!input.pairedProjectConsent || pairing.userId !== scope.userId)) throw new Error('配对项目需要当前用户重新授权本机私有知识投影。')
    if (input.enabled && paired && input.includeMemories) throw new Error('配对项目仅支持知识投影，不能启用团队或本地正式记忆投影。')
    const project = (await this.deps.store.listProjects()).find((p) => p.id === scope.projectId)
    if (!project) throw new Error('本地项目不存在。')
    const snapshot = await this.deps.loadKnowledge(scope.projectId)
    if (snapshot.projectId !== scope.projectId || snapshot.knowledgeRoot == null) throw new Error('无法核实知识目录。')
    const root = await realpath(project.path)
    const file = await readSelectedKnowledgeModel(root, snapshot.knowledgeRoot)
    if (file.status !== 'current') throw new Error('请先在知识目录添加并 git add 声明式 model.json。')
    const model = parseKnowledgeModel(JSON.parse(file.markdown))
    for (const sourcePath of input.selectedPaths) {
      if ((await readSelectedKnowledgeSource(root, snapshot.knowledgeRoot, sourcePath)).status !== 'current') throw new Error('所选知识文件无法核实。')
    }
    const config = await this.deps.store.configureHindsight({
      projectId: scope.projectId, ownerUserId: scope.userId, projectPath: root, knowledgeRoot: snapshot.knowledgeRoot,
      rootGeneration: hindsightDigest(JSON.stringify([root, snapshot.knowledgeRoot])),
      endpoint: input.endpoint, encryptedApiKey, enabled: input.enabled, includeMemories: input.includeMemories,
      selectedPaths: input.selectedPaths, model, modelDigest: file.contentDigest,
      ...(paired ? { pairingBinding: hindsightPairingBinding(pairing) } : {}),
    })
    if (config.enabled) await this.refresh(scope)
    return this.status(scope)
  }
  async disable(scope: HindsightScope) {
    const config = await this.deps.store.getHindsightConfiguration(scope.projectId)
    if (config && config.ownerUserId !== scope.userId) throw new Error('Hindsight 用户范围不一致。')
    await this.deps.store.disableHindsightProject(scope.projectId, 'disabled')
    return this.status(scope)
  }
  private async current(scope: HindsightScope, generation?: string): Promise<HindsightConfiguration | null> {
    const config = await this.deps.store.getHindsightConfiguration(scope.projectId)
    if (!config?.enabled || config.ownerUserId !== scope.userId || (generation && config.generation !== generation)) return null
    const pairing = await this.deps.store.getDesktopPairingCredential()
    if (!hindsightPairingMatches(config, pairing)) {
      await this.deps.store.disableHindsightProject(scope.projectId, 'pairing_changed')
      return null
    }
    const project = (await this.deps.store.listProjects()).find((p) => p.id === scope.projectId)
    const snapshot = await this.deps.loadKnowledge(scope.projectId)
    if (!project || snapshot.projectId !== scope.projectId) return null
    const currentPath = await realpath(project.path).catch(() => '')
    if (snapshot.knowledgeRoot !== config.knowledgeRoot || (currentPath && currentPath !== config.projectPath)) {
      await this.deps.store.disableHindsightProject(scope.projectId, 'knowledge_root_changed')
      return null
    }
    if (!currentPath) return null
    const model = await readSelectedKnowledgeModel(config.projectPath, config.knowledgeRoot)
    if (model.status === 'missing' || model.status === 'untracked' || (model.status === 'current' && model.contentDigest !== config.modelDigest)) {
      await this.deps.store.disableHindsightProject(scope.projectId, 'model_changed')
      return null
    }
    return model.status === 'current' && model.contentDigest === config.modelDigest &&
      await this.activeGeneration(scope, config.generation) ? config : null
  }
  /** Minimal host-only identity: never pass bank credentials to a model or renderer. */
  async contextIdentity(scope: HindsightScope) {
    const stored = await this.deps.store.getHindsightConfiguration(scope.projectId)
    if (!stored?.enabled || stored.ownerUserId !== scope.userId) return undefined
    const config = await this.current(scope, stored.generation)
    if (!config) throw new Error('知识授权或来源已变化，请重新准备上下文。')
    return { configGeneration: config.generation, modelVersion: config.model.version }
  }
  async assertContextCurrent(manifest: RetrievedKnowledgeManifest): Promise<void> {
    const invalid = () => new Error('知识来源或授权已变化，本次上下文失效，请重新运行。')
    const config = await this.current(manifest.scope, manifest.configGeneration)
    if (!config || config.generation !== manifest.configGeneration || config.model.version !== manifest.modelVersion) throw invalid()
    const rows = await this.deps.store.listHindsightProjections(config.projectId)
    for (const reference of manifest.references) {
      const row = rows.find((candidate) => candidate.id === reference.sourceRef)
      if (!row || row.revoked || row.kind !== 'knowledge' || row.configGeneration !== config.generation ||
          row.ownerUserId !== manifest.scope.userId || row.sourcePath !== reference.path ||
          row.contentDigest !== reference.contentDigest || !config.selectedPaths.includes(reference.path)) throw invalid()
      const file = await readSelectedKnowledgeSource(config.projectPath, config.knowledgeRoot, reference.path)
      if (file.status !== 'current' || file.contentDigest !== reference.contentDigest) throw invalid()
      const document = indexKnowledgeSources([{ sourcePath: reference.path, markdown: file.markdown, updatedAt: this.now() }]).documents[0]
      if (!document || !knowledgeDocumentAppliesToStage(document, manifest.stage)) throw invalid()
    }
    if (!await this.current(manifest.scope, config.generation)) throw invalid()
  }
  async refresh(scope: HindsightScope) {
    const config = await this.current(scope)
    if (!config) return this.status(scope)
    for (const sourcePath of config.selectedPaths) {
      const file = await readSelectedKnowledgeSource(config.projectPath, config.knowledgeRoot, sourcePath)
      const sourceKey = keyFor(config.rootGeneration, sourcePath)
      if (file.status === 'missing' || file.status === 'untracked') {
        await this.deps.store.revokeHindsightSource(config.generation, sourceKey, file.status)
      } else if (file.status === 'current') {
        await this.deps.store.reconcileHindsightSource(config.generation, {
          kind: 'knowledge', sourceKey, sourceId: sourceId(config, sourcePath), sourceRevision: file.contentDigest,
          contentDigest: file.contentDigest, sourcePath, payload: file.markdown,
        })
      }
    }
    // This lookup expires the entire bounded scope before applying its result limit.
    // Promotion/revision/deletion already enqueue changes atomically; individual jobs use exact hydration.
    if (config.includeMemories) await this.deps.store.retrieveAgentMemoryRevisions({
      stateVersion: 1, id: `hindsight-refresh-${config.generation}`, runtimeId: 'hindsight-projection', requestedAt: this.now(), limit: 1,
      scope: { kind: 'local', organizationId: null, projectId: null, localProjectId: config.projectId, userId: config.ownerUserId, sessionId: 'hindsight-projection' },
    })
    return this.status(scope)
  }
  private async verify(row: HindsightProjection, config: HindsightConfiguration): Promise<boolean> {
    if (row.revoked || row.configGeneration !== config.generation || row.ownerUserId !== config.ownerUserId) return false
    let valid = false; let revoke = false
    if (row.kind === 'knowledge' && row.sourcePath && config.selectedPaths.includes(row.sourcePath)) {
      const file = await readSelectedKnowledgeSource(config.projectPath, config.knowledgeRoot, row.sourcePath)
      valid = file.status === 'current' && file.contentDigest === row.contentDigest
      revoke = ['missing', 'untracked', 'current'].includes(file.status) && !valid
    } else if (row.kind === 'memory' && row.memoryId && config.includeMemories) {
      const memory = await this.deps.store.hydrateAgentMemoryRevisions({
        stateVersion: 1, id: `hindsight-${row.id}`, runtimeId: 'hindsight-projection', requestedAt: this.now(), limit: 1,
        scope: { kind: 'local', organizationId: null, projectId: null, localProjectId: config.projectId, userId: config.ownerUserId, sessionId: 'hindsight-projection' },
      }, [row.memoryId])
      valid = memory.some((m) => m.visibility === 'user_project' && m.sensitivity === 'private' &&
        m.revision === row.memoryRevision && m.contentDigest === row.contentDigest)
      revoke = !valid
    } else revoke = true
    if (revoke) await this.deps.store.revokeHindsightSource(config.generation, row.sourceKey, 'source_changed')
    return valid
  }
  async tick(): Promise<void> {
    if (this.running || !this.deps.transportAvailable) return
    this.running = true
    try {
      const claim = await this.deps.store.claimHindsightProjection(this.now())
      if (!claim) return
      const { record: row, config, leaseToken } = claim
      const settle = (result: Parameters<LocalStore['settleHindsightProjection']>[2], error?: string) =>
        this.deps.store.settleHindsightProjection(row.id, leaseToken, result, this.now(), error)
      try {
        if (!row.revoked) {
          const current = await this.current({ projectId: row.projectId, userId: row.ownerUserId }, config.generation)
          if (!current || !await this.verify(row, config)) {
            await settle(claim.canSubmit && row.attempts === 1 ? 'not_sent' : 'unknown', 'source_unverified'); return
          }
        }
        const client = await this.client(config)
        const status = await client.operation(row.bankId, row.operationId)
        if (row.revoked) {
          // Cancelled/not_found does not prove that an old worker has stopped writing.
          if (status === 'completed' || status === 'failed') { await client.deleteDocument(row.bankId, row.documentId); await settle('removed') }
          else await settle('pending', 'awaiting_remote_settlement')
        } else if (status === 'completed') {
          if (await this.current({ projectId: row.projectId, userId: row.ownerUserId }, config.generation) && await this.verify(row, config)) await settle('ready')
          else await settle('unknown', 'source_changed')
        } else if (status === 'not_found' && claim.canSubmit) {
          await client.configureBank(row.bankId, knowledgeModelLabels(config.model), 'concise')
          // Configuration requests may take time; recheck revocation just before sending.
          const latest = (await this.deps.store.listHindsightProjections(row.projectId)).find((r) => r.id === row.id)
          if (!latest || latest.revoked || !await this.current({ projectId: row.projectId, userId: row.ownerUserId }, config.generation) ||
              !await this.verify(row, config)) {
            await settle(claim.canSubmit && row.attempts === 1 ? 'not_sent' : 'unknown', 'source_changed'); return
          }
          await client.retain(row.bankId, { documentId: row.documentId, operationId: row.operationId, content: row.payload, metadata: row.metadata })
          await settle('pending')
        } else await settle(status === 'not_found' ? 'retry' : status === 'pending' || status === 'processing' ? 'pending' : 'unknown')
      } catch (error) {
        await settle('unknown', error instanceof HindsightError ? error.message : 'provider_unavailable')
      }
    } finally { this.running = false }
  }
  private async candidates(config: HindsightConfiguration, query: string, turn: HindsightSearchTurn, signal?: AbortSignal) {
    const safeQuery = truncateUtf8(redactSensitiveText(query).value, 2048).value
    const key = `${config.generation}:${safeQuery}`
    const cached = turn.candidates.get(key)
    if (cached) return cached
    if (!this.deps.transportAvailable || turn.calls >= 2) return { values: [], degraded: true }
    turn.calls++
    const pending = (async () => {
      try { return { values: await (await this.client(config)).recall(config.knowledgeBank, safeQuery, signal), degraded: false } }
      catch { return { values: [], degraded: true } }
    })()
    turn.candidates.set(key, pending)
    return pending
  }
  async search(scope: HindsightScope, raw: Record<string, unknown>, turn: HindsightSearchTurn, signal?: AbortSignal) {
    const args = parseKnowledgeSearchArgs(raw)
    const config = await this.current(scope)
    if (!config) return { matches: [] as KnowledgeMatch[], degraded: true, note: 'Hindsight 未启用或来源已变化；可继续使用 knowledge_list/read 和 repo_search。' }
    await this.refresh(scope)
    const rows = (await this.deps.store.listHindsightProjections(scope.projectId)).filter((r) =>
      r.kind === 'knowledge' && r.configGeneration === config.generation && !r.revoked)
    const corpus: { row: HindsightProjection; text: string }[] = []
    for (const row of rows) {
      const file = await readSelectedKnowledgeSource(config.projectPath, config.knowledgeRoot, row.sourcePath!)
      if (file.status !== 'current' || file.contentDigest !== row.contentDigest) continue
      const document = indexKnowledgeSources([{ sourcePath: row.sourcePath!, markdown: file.markdown, updatedAt: this.now() }]).documents[0]!
      if (!args.stage || knowledgeDocumentAppliesToStage(document, args.stage)) corpus.push({ row, text: file.markdown })
    }
    const lexical = rankMemoryByRelevance(corpus, args.query, (entry) => entry.text).map((entry) => entry.item.row)
    const remote = await this.candidates(config, args.query, turn, signal)
    signal?.throwIfAborted()
    const semantic: HindsightProjection[] = []
    for (const hit of remote.values) {
      const match = corpus.find(({ row }) => row.status === 'ready' && row.documentId === hit.documentId &&
        Object.entries(row.metadata).every(([key, value]) => hit.metadata[key] === value))?.row
      if (match && !semantic.some((r) => r.sourceId === match.sourceId)) semantic.push(match)
    }
    const scored = new Map<string, { row: HindsightProjection; score: number; lexical: boolean; semantic: boolean }>()
    for (const [list, kind] of [[lexical, 'lexical'], [semantic, 'semantic']] as const) {
      list.forEach((row, index) => {
        const entry = scored.get(row.sourceId) ?? { row, score: 0, lexical: false, semantic: false }
        entry.score += 1 / (60 + index + 1); entry[kind] = true; scored.set(row.sourceId, entry)
      })
    }
    const matches: KnowledgeMatch[] = []; let remaining = 6144
    if (!await this.current(scope, config.generation)) return { matches, degraded: true, note: NOTE }
    const latestRows = await this.deps.store.listHindsightProjections(scope.projectId)
    for (const entry of [...scored.values()].sort((a, b) => b.score - a.score || a.row.sourceId.localeCompare(b.row.sourceId))) {
      if (matches.length >= args.limit || remaining <= 0) break
      const row = latestRows.find((r) => r.id === entry.row.id && !r.revoked)
      if (!row || !config.selectedPaths.includes(row.sourcePath!)) continue
      const file = await readSelectedKnowledgeSource(config.projectPath, config.knowledgeRoot, row.sourcePath!)
      if (file.status !== 'current' || file.contentDigest !== row.contentDigest) continue
      const doc = indexKnowledgeSources([{ sourcePath: row.sourcePath!, markdown: file.markdown, updatedAt: this.now() }]).documents[0]!
      const safeText = redactSensitiveText(file.markdown).value
      const content = truncateUtf8(safeText, Math.min(remaining, 2048)).value
      remaining -= Buffer.byteLength(content)
      matches.push({ path: row.sourcePath!, title: truncateUtf8(redactSensitiveText(doc.title).value, 240).value, content, contentDigest: file.contentDigest,
        truncated: content !== safeText,
        modelVersion: config.model.version, matchReason: entry.lexical && entry.semantic ? 'both' : entry.semantic ? 'semantic' : 'lexical',
        readWith: 'knowledge_read', readArgs: { path: row.sourcePath!, sourceRef: row.id, expectedDigest: file.contentDigest } })
    }
    if (!await this.activeGeneration(scope, config.generation)) return { matches: [], degraded: true, note: NOTE }
    return { matches, degraded: remote.degraded, note: NOTE }
  }
  async read(scope: HindsightScope, args: Record<string, unknown>) {
    if (typeof args.sourceRef !== 'string' || typeof args.expectedDigest !== 'string') throw new Error('知识回读需要来源句柄和摘要。')
    const config = await this.current(scope)
    const row = (await this.deps.store.listHindsightProjections(scope.projectId)).find((r) => r.id === args.sourceRef)
    if (!config || !row || row.kind !== 'knowledge' || row.configGeneration !== config.generation || row.ownerUserId !== scope.userId ||
        !row.sourcePath || !config.selectedPaths.includes(row.sourcePath) || (args.path !== undefined && args.path !== row.sourcePath)) throw new Error('知识引用不在当前授权范围。')
    const file = await readSelectedKnowledgeSource(config.projectPath, config.knowledgeRoot, row.sourcePath)
    if (file.status !== 'current') throw new Error('知识来源当前无法核实。')
    if (file.contentDigest !== args.expectedDigest || row.contentDigest !== args.expectedDigest || row.revoked) return { error: 'source_changed', currentDigest: file.contentDigest }
    // Check consent again after I/O; source content and digest come from the same read.
    if (!await this.current(scope, config.generation)) throw new Error('知识授权已变化。')
    return { path: row.sourcePath, contentDigest: file.contentDigest,
      ...conversationContentPage(redactSensitiveText(file.markdown).value, args.offset, args.limit), note: NOTE }
  }

}
