import type {
  AutomaticMemoryConfiguration, AutomaticMemoryEvent, AutomaticMemoryStatus, ConfigureAutomaticMemoryInput,
  KnowledgeRetrievalScope, RememberConversationMemoryInput, ResolveAutomaticMemoryDecisionInput,
} from '@ai-devflow/shared'
import type { LocalStore } from './local-store'
import type { HindsightClient } from './hindsight-client'
import { hindsightPairingMatches, type HindsightConfiguration } from './hindsight-store'
import { buildManualMemoryEvent, isMemoryLearningSourceCurrent, resolveProjectMemoryScope } from './automatic-memory-capture'
import { AutomaticMemoryService, type AutomaticMemoryExistingMemory } from './automatic-memory-service'
import { parseConfigureAutomaticMemoryInput, parseRememberConversationMemoryInput, parseResolveAutomaticMemoryDecisionInput } from './ipc-contract'
import { verifiedMemoryTestCommand } from './verified-memory-command'

type Dependencies = {
  store: LocalStore; transportAvailable: boolean
  client(config: HindsightConfiguration): Promise<HindsightClient>
  now?: () => string
}
const sameOwner = (left: KnowledgeRetrievalScope, right: KnowledgeRetrievalScope) => left.kind === right.kind &&
  left.localProjectId === right.localProjectId && left.organizationId === right.organizationId &&
  left.projectId === right.projectId && left.userId === right.userId && (left.kind === 'local' || left.sessionId === right.sessionId)

/** The only bridge between project UI, trusted completed sources, and the background extractor. */
export async function createAutomaticMemoryRuntime(deps: Dependencies) {
  const { store } = deps
  const now = () => deps.now?.() ?? new Date().toISOString()
  async function scopeFor(projectId: string): Promise<KnowledgeRetrievalScope> {
    if (!(await store.listProjects()).some((project) => project.id === projectId)) throw new Error('本地项目不存在。')
    const pairing = await store.getDesktopPairingCredential()
    if (pairing?.localProjectId === projectId && pairing.expiresAt &&
        (!Number.isFinite(Date.parse(pairing.expiresAt)) || Date.parse(pairing.expiresAt) <= Date.parse(now()))) {
      throw new Error('项目配对已过期，请重新配对后管理记忆。')
    }
    const scope = await resolveProjectMemoryScope(store, projectId, `memory-settings-${projectId}`)
    if (!scope) throw new Error('项目存在多个历史用户，无法自动确定记忆归属。')
    return scope
  }
  async function sourceCurrent(event: AutomaticMemoryEvent, configuration: AutomaticMemoryConfiguration): Promise<boolean> {
    const hConfig = await store.getHindsightConfiguration(configuration.projectId)
    const pairing = await store.getDesktopPairingCredential()
    if (!hConfig?.enabled || hConfig.generation !== configuration.hindsightGeneration ||
        hConfig.ownerUserId !== configuration.ownerUserId || !hindsightPairingMatches(hConfig, pairing) ||
        (event.scope.kind === 'team' ? configuration.pairingSessionId !== event.scope.sessionId : configuration.pairingSessionId !== undefined)) return false
    return isMemoryLearningSourceCurrent(store, event)
  }
  async function existingMemories(event: AutomaticMemoryEvent): Promise<AutomaticMemoryExistingMemory[]> {
    const heads = await store.listAgentMemoryHeads(event.scope.localProjectId)
    const decisions = await store.listMemoryLearningDecisions(event.scope.localProjectId)
    const candidates = new Map((await store.listAgentMemoryCandidates(event.scope.localProjectId)).map(candidate => [candidate.id, candidate]))
    const result: AutomaticMemoryExistingMemory[] = []
    for (const head of heads) {
      if (head.status !== 'active' || !sameOwner(head.scope, event.scope) || await store.getAgentMemoryTombstone(head.memoryId)) continue
      const revision = (await store.listAgentMemoryRevisions(head.memoryId)).find((item) => item.revision === head.currentRevision)
      if (!revision || revision.status !== 'active' || (revision.expiresAt && revision.expiresAt <= now())) continue
      const semanticKey = decisions.find((decision) => decision.memoryId === head.memoryId && decision.statement === revision.statement)?.semanticKey
      const verifiedCommand = verifiedMemoryTestCommand(revision, candidates.get(revision.sourceCandidateId))
      result.push({ memoryId: head.memoryId, revision: revision.revision, statement: revision.statement,
        ...(semanticKey ? { semanticKey } : {}), ...(verifiedCommand ? { semanticKey: 'practice.test_command', semanticValue: verifiedCommand } : {}) })
    }
    return result
  }
  const service = new AutomaticMemoryService({ store, now,
    client: async (configuration) => {
      if (!deps.transportAvailable) throw new Error('Hindsight transport is not verified')
      // Historical configuration is necessary to finish cleanup after disable, key rotation or rebinding.
      const hConfig = (await store.listHindsightConfigurations()).find((item) => item.generation === configuration.hindsightGeneration &&
        item.projectId === configuration.projectId && item.ownerUserId === configuration.ownerUserId)
      if (!hConfig) throw new Error('Hindsight configuration history unavailable')
      return deps.client(hConfig)
    }, isSourceCurrent: sourceCurrent, existingMemories,
    commit: async (_event, decisions) => {
      for (const decision of decisions) {
        if (decision.disposition === 'auto_save' && !decision.manual && !decision.resolution) {
          await store.commitMemoryLearningDecision({ decisionId: decision.id, mode: 'automatic' })
        }
      }
    },
  })
  await service.recover()
  async function suspendStaleConfigurations(): Promise<void> {
    for (const stored of await store.listAutomaticMemoryConfigurations()) {
      const current = await store.getAutomaticMemoryConfiguration(stored.projectId)
      if (!current?.enabled || current.generation !== stored.generation) continue
      const hConfig = await store.getHindsightConfiguration(stored.projectId)
      if (!hConfig || hConfig.ownerUserId !== stored.ownerUserId ||
          (hConfig.enabled && hConfig.generation === stored.hindsightGeneration)) continue
      try {
        await store.configureAutomaticMemory({ projectId: stored.projectId, ownerUserId: stored.ownerUserId,
          enabled: false, hindsightGeneration: hConfig.generation, maxRetainsPerDay: stored.maxRetainsPerDay })
      } catch { /* An identity change is handled by source checks; never impersonate the former owner. */ }
    }
  }
  async function status(projectId: string): Promise<AutomaticMemoryStatus> {
    const scope = await scopeFor(projectId)
    const configuration = await store.getAutomaticMemoryConfiguration(projectId)
    const hConfig = await store.getHindsightConfiguration(projectId)
    const pairing = await store.getDesktopPairingCredential()
    const own = configuration?.ownerUserId === scope.userId &&
      (scope.kind === 'team' ? configuration.pairingSessionId === scope.sessionId : configuration.pairingSessionId === undefined) ? configuration : null
    const compatible = hConfig?.ownerUserId === scope.userId && hindsightPairingMatches(hConfig, pairing)
    const authorized = !!own && own.enabled && compatible && hConfig.enabled && own.hindsightGeneration === hConfig.generation
    const visibleEvents = new Map<string, boolean>()
    const isVisible = async (eventId: string) => {
      if (!visibleEvents.has(eventId)) {
        const event = await store.getMemoryLearningEvent(eventId)
        visibleEvents.set(eventId, !!event && sameOwner(scope, event.scope))
      }
      return visibleEvents.get(eventId)!
    }
    const jobs: AutomaticMemoryStatus['jobs'] = []
    const decisions: AutomaticMemoryStatus['decisions'] = []
    for (const job of (await store.listMemoryLearningJobs(projectId)).slice(-100)) {
      if (!(await isVisible(job.eventId))) continue
      jobs.push({ id: job.id, eventId: job.eventId, status: job.status, createdAt: job.createdAt,
        ...(job.lastError ? { lastError: job.lastError } : {}) })
    }
    for (const decision of (await store.listMemoryLearningDecisions(projectId)).slice(-200)) {
      if (await isVisible(decision.eventId)) decisions.push(decision)
    }
    const unavailableReason = !deps.transportAvailable ? 'Hindsight 网络试点尚未启用；手动保存仍可使用。'
      : !compatible || !hConfig.enabled ? '请先配置并启用当前项目的 Hindsight 服务。'
        : own?.enabled && !authorized ? 'Hindsight 授权或配对已变化，请重新启用自动积累。' : undefined
    return { projectId, configuration: own ? { ...own, enabled: authorized } : null,
      endpoint: compatible ? hConfig.endpoint : null, jobs, decisions, ...(unavailableReason ? { unavailableReason } : {}) }
  }
  return {
    status,
    shutdown: () => service.shutdown(),
    async configure(value: ConfigureAutomaticMemoryInput): Promise<AutomaticMemoryStatus> {
      const input = parseConfigureAutomaticMemoryInput(value)
      const scope = await scopeFor(input.projectId)
      const config = await store.getHindsightConfiguration(input.projectId)
      if (!config || config.ownerUserId !== scope.userId || (input.enabled && !config.enabled) ||
          !hindsightPairingMatches(config, await store.getDesktopPairingCredential())) throw new Error('请先为当前用户配置 Hindsight。')
      await store.configureAutomaticMemory({ projectId: input.projectId, ownerUserId: scope.userId,
        enabled: input.enabled, hindsightGeneration: config.generation, maxRetainsPerDay: input.maxRetainsPerDay })
      return status(input.projectId)
    },
    async process(projectId: string): Promise<AutomaticMemoryStatus> {
      await scopeFor(projectId)
      await suspendStaleConfigurations()
      if (deps.transportAvailable) await service.process(2)
      return status(projectId)
    },
    async cycle(): Promise<void> {
      await suspendStaleConfigurations()
      if (deps.transportAvailable) await service.process(2)
    },
    reconcile: suspendStaleConfigurations,
    async remember(value: RememberConversationMemoryInput): Promise<AutomaticMemoryStatus> {
      const input = parseRememberConversationMemoryInput(value)
      await scopeFor(input.projectId)
      const event = await buildManualMemoryEvent(store, input)
      const statement = input.statement ?? event.materials[0]!.text
      const decision = await store.recordManualMemoryLearningEvent(event, statement, input.pin ?? false)
      if (decision.disposition !== 'rule_candidate' && !decision.resolution) {
        await store.commitMemoryLearningDecision({ decisionId: decision.id, mode: 'manual', pin: input.pin ?? false })
      }
      return status(input.projectId)
    },
    async resolve(value: ResolveAutomaticMemoryDecisionInput): Promise<AutomaticMemoryStatus> {
      const input = parseResolveAutomaticMemoryDecisionInput(value)
      const scope = await scopeFor(input.projectId)
      const decision = await store.getMemoryLearningDecision(input.decisionId)
      const event = decision && await store.getMemoryLearningEvent(decision.eventId)
      if (!decision || decision.projectId !== input.projectId || !event || !sameOwner(event.scope, scope) || event.revoked) throw new Error('记忆候选不属于当前项目用户或已撤销。')
      if (decision.resolution) return status(input.projectId)
      if (input.action === 'ignore') {
        await store.resolveMemoryLearningDecision(decision.id, 'dismissed')
        return status(input.projectId)
      }
      if (decision.disposition === 'rule_candidate' || decision.statementKind === 'business_rule') throw new Error('业务规则须进入正式需求、设计或验收流程，不能作为经验直接批准。')
      if (decision.disposition !== 'conflict') throw new Error('此候选不需要人工批准。')
      if (decision.conflictsWith?.length) {
        const displayed = decision.conflictsWith.find((item) => item.memoryId === input.targetMemoryId && item.revision === input.expectedRevision)
        if (!displayed || decision.conflictsWith.length !== 1) throw new Error('请基于当前展示的冲突记忆版本进行确认。')
      } else if (input.targetMemoryId !== undefined) throw new Error('该候选没有可替换的既有记忆。')
      if (!(await isMemoryLearningSourceCurrent(store, event))) throw new Error('记忆来源已变化，请刷新后重试。')
      await store.commitMemoryLearningDecision({ decisionId: decision.id, mode: 'manual',
        ...(input.targetMemoryId ? { targetMemoryId: input.targetMemoryId, expectedRevision: input.expectedRevision! } : {}) })
      return status(input.projectId)
    },
  }
}

export type AutomaticMemoryRuntime = Awaited<ReturnType<typeof createAutomaticMemoryRuntime>>
