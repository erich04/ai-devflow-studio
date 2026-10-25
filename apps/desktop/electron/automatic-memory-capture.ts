import { createHash } from 'node:crypto'
import {
  AUTOMATIC_MEMORY_MAX_EVENT_BYTES, redactSensitiveText,
  type AgentReviewResult, type Artifact, type AutomaticMemoryEventInput, type AutomaticMemoryMaterial,
  type CodingAgentRun, type KnowledgeRetrievalScope, type TestEvidence,
} from '@ai-devflow/shared'
import type { WorkbenchConversation, ConversationMessage } from './workbench-conversation-contract'
import type { LocalStore } from './local-store'
import { hindsightPairingMatches } from './hindsight-store'

const hash = (text: string) => `sha256:${createHash('sha256').update(text).digest('hex')}`
type ConversationSource = Pick<WorkbenchConversation, 'id' | 'localProjectId' | 'status' | 'messages' | 'updatedAt'>
type CodingSource = Pick<CodingAgentRun, 'id' | 'projectId' | 'runId' | 'nodeId' | 'status' | 'engine' | 'completedAt' | 'testEvidenceId' | 'diffArtifactId'>
type TestSource = Pick<TestEvidence, 'id' | 'projectId' | 'runId' | 'nodeId' | 'status' | 'command' | 'exitCode' | 'createdAt'>
type ArtifactSource = Pick<Artifact, 'id' | 'runId' | 'nodeId' | 'kind' | 'content' | 'updatedAt'>

function bounded(event: AutomaticMemoryEventInput): AutomaticMemoryEventInput | null {
  if (!event.materials.length || event.materials.some(m => !m.text.trim() || redactSensitiveText(m.text).value !== m.text) ||
      Buffer.byteLength(JSON.stringify(event), 'utf8') > AUTOMATIC_MEMORY_MAX_EVENT_BYTES) return null
  return event
}

/** A completed public reply is the boundary, not each model/tool step or reasoning flush. */
export function buildConversationLearningEvent(
  conversation: ConversationSource,
  previous: Pick<WorkbenchConversation, 'status' | 'messages'> | undefined,
  scope: KnowledgeRetrievalScope,
): AutomaticMemoryEventInput | null {
  if (scope.localProjectId !== conversation.localProjectId || previous?.status !== 'running' ||
      !['idle', 'awaiting_answer'].includes(conversation.status)) return null
  const assistant = conversation.messages.at(-1)
  if (assistant?.role !== 'assistant' || previous.messages.some(m => m.id === assistant.id)) return null
  const user = conversation.messages.slice(0, -1).reverse().find(m => m.role === 'user')
  if (!user) return null
  return bounded({ sourceKind: 'conversation_turn', sourceId: conversation.id, sourceRevision: assistant.id,
    scope, outcome: 'completed', createdAt: assistant.createdAt,
    materials: [publicMaterial(user), publicMaterial(assistant)] })
}
function publicMaterial(message: ConversationMessage): AutomaticMemoryMaterial {
  return { id: message.id, role: message.role === 'user' ? 'user' : 'assistant', text: message.text,
    ...(message.role === 'user' ? { evidence: { kind: 'user_statement' as const, sourceId: message.id, sourceRevision: hash(message.text) } } : {}) }
}

export function buildCodingLearningEvent(run: CodingSource, evidence: TestSource | undefined, canonicalCommand: string, scope: KnowledgeRetrievalScope): AutomaticMemoryEventInput | null {
  if (run.status !== 'completed' || run.engine === 'fake' || !run.completedAt || !run.diffArtifactId ||
      scope.localProjectId !== run.projectId || !evidence || evidence.id !== run.testEvidenceId || evidence.runId !== run.runId ||
      evidence.nodeId !== run.nodeId || evidence.projectId !== run.projectId || evidence.status !== 'passed' ||
      evidence.exitCode !== 0 || evidence.command.trim() !== canonicalCommand.trim() || !canonicalCommand.trim()) return null
  const text = `command: ${canonicalCommand.trim()}\nexitCode: 0`
  return bounded({ sourceKind: 'coding_completion', sourceId: run.id, sourceRevision: run.completedAt,
    scope, outcome: 'completed', createdAt: run.completedAt,
    materials: [{ id: evidence.id, role: 'tool', text,
      evidence: { kind: 'verified_tool_result', sourceId: evidence.id, sourceRevision: hash(JSON.stringify(evidence)) } }] })
}

export function buildArtifactLearningEvent(artifact: ArtifactSource, scope: KnowledgeRetrievalScope): AutomaticMemoryEventInput | null {
  if (!['clarification', 'design', 'agent_review', 'acceptance', 'test_report'].includes(artifact.kind)) return null
  return bounded({ sourceKind: 'stage_completion', sourceId: artifact.id, sourceRevision: hash(artifact.content),
    scope, outcome: 'completed', createdAt: artifact.updatedAt,
    materials: [{ id: artifact.id, role: 'artifact', text: artifact.content }] })
}

type ScopeStore = Pick<LocalStore, 'getDesktopPairingCredential' | 'resolveLocalProjectMemoryPrincipal'>
export async function resolveProjectMemoryScope(store: ScopeStore, projectId: string, sessionId: string): Promise<KnowledgeRetrievalScope | null> {
  const pairing = await store.getDesktopPairingCredential()
  if (pairing?.localProjectId === projectId && pairing.expiresAt &&
      (!Number.isFinite(Date.parse(pairing.expiresAt)) || Date.parse(pairing.expiresAt) <= Date.now())) return null
  if (pairing?.localProjectId === projectId) return { kind: 'team', organizationId: pairing.organizationId,
    projectId: pairing.projectId, userId: pairing.userId, sessionId: pairing.tokenId, localProjectId: projectId }
  const principal = await store.resolveLocalProjectMemoryPrincipal(projectId)
  return principal.status === 'resolved' ? { kind: 'local', organizationId: null, projectId: null,
    userId: principal.userId, sessionId, localProjectId: projectId } : null
}
type CaptureStore = ScopeStore & Pick<LocalStore, 'getAutomaticMemoryConfiguration' | 'getHindsightConfiguration' | 'enqueueMemoryLearningEvent' | 'listProjects' | 'listTestEvidence' | 'getRun'>
async function captureScope(store: CaptureStore, projectId: string, sourceId: string) {
  const configuration = await store.getAutomaticMemoryConfiguration(projectId)
  if (!configuration?.enabled) return null
  const hindsight = await store.getHindsightConfiguration(projectId)
  if (!hindsight?.enabled || hindsight.generation !== configuration.hindsightGeneration ||
      hindsight.ownerUserId !== configuration.ownerUserId ||
      !hindsightPairingMatches(hindsight, await store.getDesktopPairingCredential())) return null
  return resolveProjectMemoryScope(store, projectId, `memory-source-${hash(sourceId).slice(7, 39)}`)
}
/** Called within the store's durable mutation, so enqueue and source commit roll back together. */
export async function captureConversationMemory(store: CaptureStore, conversation: ConversationSource, previous?: ConversationSource): Promise<void> {
  if (previous?.status !== 'running' || !['idle', 'awaiting_answer'].includes(conversation.status)) return
  const scope = await captureScope(store, conversation.localProjectId, conversation.id)
  if (!scope) return
  const event = buildConversationLearningEvent(conversation, previous, scope)
  if (event) await store.enqueueMemoryLearningEvent(event)
}
export async function captureCodingMemory(store: CaptureStore, run: CodingAgentRun, previous?: CodingAgentRun): Promise<void> {
  if (run.status !== 'completed' || previous?.status === 'completed') return
  const scope = await captureScope(store, run.projectId, run.id)
  if (!scope) return
  const project = (await store.listProjects()).find(p => p.id === run.projectId)
  const evidence = (await store.listTestEvidence(run.runId)).find(e => e.id === run.testEvidenceId)
  const event = project && buildCodingLearningEvent(run, evidence, project.testCommand, scope)
  if (event) await store.enqueueMemoryLearningEvent(event)
}
export async function captureArtifactMemory(store: CaptureStore, artifact: Artifact): Promise<void> {
  if (!['clarification', 'design', 'agent_review', 'acceptance', 'test_report'].includes(artifact.kind)) return
  const run = await store.getRun(artifact.runId)
  if (!run || !run.nodes.some(n => n.id === artifact.nodeId)) return
  const scope = await captureScope(store, run.projectId, artifact.id)
  if (!scope) return
  const event = buildArtifactLearningEvent(artifact, scope)
  if (event) await store.enqueueMemoryLearningEvent(event)
}
export async function captureReviewMemory(store: CaptureStore, review: AgentReviewResult): Promise<void> {
  const run = await store.getRun(review.runId)
  if (!run || run.projectId !== review.projectId) return
  const scope = await captureScope(store, run.projectId, review.id)
  if (!scope) return
  const text = JSON.stringify({ summary: review.summary, risks: review.risks, suggestedTests: review.suggestedTests })
  const event = bounded({ sourceKind: 'stage_completion', sourceId: review.id, sourceRevision: hash(text),
    scope, outcome: 'completed', createdAt: review.createdAt,
    materials: [{ id: review.id, role: 'artifact', text }] })
  if (event) await store.enqueueMemoryLearningEvent(event)
}

type SourceReadStore = ScopeStore & Pick<LocalStore, 'listWorkbenchConversations' | 'listCodingAgentRuns' | 'listCodingDiffArtifacts' | 'listTestEvidence' | 'listProjects' | 'listArtifacts' | 'listAgentReviews' | 'getRun'>
/** Reconstruct only public durable source fields; injected Memory, reasoning and summaries are never evidence. */
export async function isMemoryLearningSourceCurrent(store: SourceReadStore, event: AutomaticMemoryEventInput): Promise<boolean> {
  const currentScope = await resolveProjectMemoryScope(store, event.scope.localProjectId, event.scope.sessionId)
  if (!currentScope || JSON.stringify(currentScope) !== JSON.stringify(event.scope)) return false
  if (event.sourceKind === 'conversation_turn' || event.sourceKind === 'manual_remember') {
    const conversation = (await store.listWorkbenchConversations(event.scope.localProjectId)).find(c => c.id === event.sourceId)
    if (!conversation) return false
    if (event.sourceKind === 'manual_remember') {
      if (event.materials.length !== 1) return false
      const source = event.materials[0]!
      const message = conversation.messages.find(m => m.id === source.id && (m.role === 'user' || m.role === 'assistant'))
      return Boolean(message && JSON.stringify(publicMaterial(message)) === JSON.stringify(source) &&
        event.sourceRevision === hash(JSON.stringify(publicMaterial(message))))
    }
    const index = conversation.messages.findIndex(m => m.id === event.sourceRevision && m.role === 'assistant')
    if (index < 1) return false
    const assistant = conversation.messages[index]!
    const user = conversation.messages.slice(0, index).reverse().find(m => m.role === 'user')
    return Boolean(user && event.outcome === 'completed' && event.createdAt === assistant.createdAt &&
      JSON.stringify(event.materials) === JSON.stringify([publicMaterial(user), publicMaterial(assistant)]))
  }
  if (event.sourceKind === 'coding_completion') {
    const run = (await store.listCodingAgentRuns()).find(r => r.id === event.sourceId && r.projectId === event.scope.localProjectId)
    if (!run || run.requestedBy !== event.scope.userId) return false
    const workflow = await store.getRun(run.runId)
    const diff = (await store.listCodingDiffArtifacts(run.runId)).find(d => d.id === run.diffArtifactId)
    if (!workflow || workflow.projectId !== run.projectId || !workflow.nodes.some(n => n.id === run.nodeId) ||
        !diff || diff.projectId !== run.projectId || diff.runId !== run.runId || diff.nodeId !== run.nodeId) return false
    const project = (await store.listProjects()).find(p => p.id === run.projectId)
    const evidence = (await store.listTestEvidence(run.runId)).find(e => e.id === run.testEvidenceId)
    if (!evidence || !run.completedAt || evidence.createdAt < run.startedAt || evidence.createdAt > run.completedAt) return false
    const rebuilt = project && buildCodingLearningEvent(run, evidence, project.testCommand, event.scope)
    return Boolean(rebuilt && rebuilt.sourceRevision === event.sourceRevision && JSON.stringify(rebuilt.materials) === JSON.stringify(event.materials))
  }
  const artifacts = await store.listArtifacts()
  const artifact = artifacts.find(a => a.id === event.sourceId)
  if (artifact) {
    const run = await store.getRun(artifact.runId)
    const rebuilt = run?.projectId === event.scope.localProjectId ? buildArtifactLearningEvent(artifact, event.scope) : null
    return Boolean(rebuilt && rebuilt.sourceRevision === event.sourceRevision && JSON.stringify(rebuilt.materials) === JSON.stringify(event.materials))
  }
  const review = (await store.listAgentReviews()).find(r => r.id === event.sourceId && r.projectId === event.scope.localProjectId)
  if (!review) return false
  const text = JSON.stringify({ summary: review.summary, risks: review.risks, suggestedTests: review.suggestedTests })
  return event.sourceRevision === hash(text) && JSON.stringify(event.materials) === JSON.stringify([{ id: review.id, role: 'artifact', text }])
}

export async function buildManualMemoryEvent(store: SourceReadStore, input: { projectId: string; conversationId: string; messageId: string }): Promise<AutomaticMemoryEventInput> {
  const conversation = (await store.listWorkbenchConversations(input.projectId)).find(c => c.id === input.conversationId)
  const message = conversation?.messages.find(m => m.id === input.messageId && (m.role === 'user' || m.role === 'assistant'))
  const scope = await resolveProjectMemoryScope(store, input.projectId, `manual-${input.conversationId}`)
  if (!message || !scope || !conversation || conversation.status === 'running') throw new Error('请等待回合完成后选择当前项目的公开消息。')
  const material = publicMaterial(message)
  const event = bounded({ sourceKind: 'manual_remember', sourceId: conversation.id, sourceRevision: hash(JSON.stringify(material)),
    scope, outcome: 'completed', materials: [material], createdAt: new Date().toISOString() })
  if (!event) throw new Error('消息过长或包含敏感内容，请先整理为不含敏感信息的公开消息。')
  return event
}
