import {
  AGENT_MEMORY_RETRIEVAL_LIMIT_MAX, isActiveCodingAgentRunStatus, PROJECT_MEMORY_CONVERSATION_IDLE_MS, PROJECT_MEMORY_MAX_DOCUMENT_BYTES,
  redactSensitiveText,
  type AgentEvent, type Artifact, type CodingAgentEvent, type CodingAgentRun, type DesktopPairingCredential, type DurableAgentMemoryRevision,
  type ProjectMemoryConfiguration, type ProjectMemoryDocument, type ProjectMemoryDocumentInput, type ProjectMemoryPairingBinding,
  type TestEvidence, type WorkflowRun,
} from '@ai-devflow/shared'
import type { WorkbenchConversation } from './workbench-conversation-contract'
import type { KnowledgeRetrievalScope } from '@ai-devflow/shared'
import type { LocalStore } from './local-store'

const bytes = (text: string) => Buffer.byteLength(text, 'utf8')
/** Cut at a character boundary, leaving an explicit marker rather than a silent partial sentence. */
function clip(text: string, max: number): string {
  if (bytes(text) <= max) return text
  const marker = ' …[truncated]'
  let result = text.slice(0, Math.max(0, max))
  while (result && bytes(result) + bytes(marker) > max) result = result.slice(0, -Math.max(1, Math.ceil(result.length / 64)))
  return `${result}${marker}`
}

type ScopeStore = Pick<LocalStore, 'getDesktopPairingCredential' | 'resolveLocalProjectMemoryPrincipal'>
/** The memory owner: the paired user of this project, or its single local principal. */
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

export function projectMemoryPairingBinding(pairing: DesktopPairingCredential): ProjectMemoryPairingBinding {
  if (!pairing.localProjectId) throw new Error('Paired project is missing')
  return { organizationId: pairing.organizationId, projectId: pairing.projectId, userId: pairing.userId,
    ...(pairing.authAccountId ? { authAccountId: pairing.authAccountId } : {}), localProjectId: pairing.localProjectId }
}
/** A paired project's memory is bound to that pairing; an unpaired one must still be unpaired. */
export function projectMemoryPairingMatches(config: Pick<ProjectMemoryConfiguration, 'projectId' | 'ownerUserId' | 'pairingBinding'>, pairing: DesktopPairingCredential | null): boolean {
  if (pairing?.localProjectId !== config.projectId) return !config.pairingBinding
  if (!config.pairingBinding || pairing.userId !== config.ownerUserId) return false
  if (pairing.expiresAt && (!Number.isFinite(Date.parse(pairing.expiresAt)) || Date.parse(pairing.expiresAt) <= Date.now())) return false
  return JSON.stringify(projectMemoryPairingBinding(pairing)) === JSON.stringify(config.pairingBinding)
}

type OwnerStore = Pick<LocalStore, 'getDesktopPairingCredential' | 'resolveLocalProjectMemoryPrincipal' | 'getProjectMemoryConfiguration'>
/** The project's memory configuration, if it is on and still belongs to the current user. */
export async function activeProjectMemoryConfiguration(store: OwnerStore, projectId: string): Promise<ProjectMemoryConfiguration | null> {
  const config = await store.getProjectMemoryConfiguration(projectId)
  if (!config?.enabled) return null
  const pairing = await store.getDesktopPairingCredential()
  if (!projectMemoryPairingMatches(config, pairing)) return null
  const scope = await resolveProjectMemoryScope(store, projectId, 'project-memory')
  return scope?.userId === config.ownerUserId ? config : null
}

type ConversationSource = Pick<WorkbenchConversation, 'id' | 'localProjectId' | 'title' | 'status' | 'messages' | 'updatedAt'>
/**
 * The whole public conversation as one document: user and assistant messages only, never
 * reasoning, tool output or injected memory. The oldest messages are dropped first.
 */
export function buildConversationMemoryDocument(conversation: ConversationSource, now: string): ProjectMemoryDocumentInput | null {
  const messages = conversation.messages
    .filter((message) => (message.role === 'user' || message.role === 'assistant') && message.text.trim())
    .map((message) => ({ role: message.role, content: redactSensitiveText(message.text).value, timestamp: message.createdAt }))
  if (!messages.some((message) => message.role === 'user') || !messages.some((message) => message.role === 'assistant')) return null
  const budget = PROJECT_MEMORY_MAX_DOCUMENT_BYTES - 2_048
  const kept: typeof messages = []
  for (const message of [...messages].reverse()) {
    const candidate = [{ ...message, content: clip(message.content, Math.floor(budget / 2)) }, ...kept]
    if (bytes(JSON.stringify(candidate)) > budget) break
    kept.unshift(candidate[0]!)
  }
  if (!kept.length) return null
  return {
    documentId: `conversation:${conversation.id}`, sourceKind: 'conversation', sourceId: conversation.id,
    title: clip(conversation.title.trim() || '项目讨论', 300), payload: JSON.stringify(kept),
    context: 'A discussion between the user and DevFlow\'s assistant about this software project. What the user says is their own statement; the assistant\'s statements are claims, not verified facts.',
    tags: ['source:conversation'], occurredAt: kept[0]!.timestamp,
    notBefore: new Date(Date.parse(now) + PROJECT_MEMORY_CONVERSATION_IDLE_MS).toISOString(),
  }
}

const RECORDED_EVENT_KINDS = new Set(['tool_call', 'tool_result', 'test', 'error', 'status', 'diff'])
/** One coding run, whatever its outcome. Test results are labelled HOST_VERIFIED only when DevFlow ran them. */
export function buildCodingRunMemoryDocument(input: {
  run: CodingAgentRun; workflow: Pick<WorkflowRun, 'title' | 'request' | 'nodes'>; events: readonly CodingAgentEvent[]
  testEvidence: readonly TestEvidence[]; extraActivity?: readonly string[]
}): ProjectMemoryDocumentInput | null {
  const { run, workflow } = input
  if (isActiveCodingAgentRunStatus(run.status) || run.engine === 'fake') return null
  const node = workflow.nodes.find((candidate) => candidate.id === run.nodeId)
  const tests = input.testEvidence.filter((evidence) => evidence.runId === run.runId && evidence.nodeId === run.nodeId &&
    evidence.createdAt >= run.startedAt && (!run.completedAt || evidence.createdAt <= run.completedAt))
  const header = [
    `Development task: ${workflow.title}`,
    ...(node ? [`Step: ${node.title}`] : []),
    `User request: ${clip(workflow.request, 4_000)}`,
    ...(run.userInstruction.trim() && run.userInstruction.trim() !== workflow.request.trim() ? [`Instruction to the coding agent: ${clip(run.userInstruction, 4_000)}`] : []),
    `Coding engine: ${run.engine} (${run.providerId})`,
    `Outcome: ${run.status}${run.summary ? ` - ${clip(run.summary, 2_000)}` : ''}`,
    ...(run.changedPaths.length ? [`Changed files: ${clip(run.changedPaths.join(', '), 4_000)}`] : []),
    ...tests.map((evidence) => `HOST_VERIFIED test run by DevFlow: \`${evidence.command}\` ${evidence.status}, exit code ${evidence.exitCode ?? 'unknown'}, ${evidence.createdAt}. ${clip(evidence.summary, 1_000)}`),
  ].map((line) => redactSensitiveText(line).value)
  const activity = [
    ...input.events.filter((event) => RECORDED_EVENT_KINDS.has(event.kind) && event.message.trim())
      .map((event) => `- [${event.kind}] ${clip(redactSensitiveText(event.message).value.replace(/\s+/gu, ' '), 600)}`),
    ...(input.extraActivity ?? []).map((line) => `- ${clip(redactSensitiveText(line).value.replace(/\s+/gu, ' '), 1_200)}`),
  ]
  const budget = PROJECT_MEMORY_MAX_DOCUMENT_BYTES - 1_024
  let payload = header.join('\n')
  if (activity.length) {
    const kept: string[] = []
    // The end of a run holds its conclusion; keep the latest activity when space runs out.
    for (const line of [...activity].reverse()) {
      if (bytes(`${payload}\n\nAgent activity (agent claims unless marked HOST_VERIFIED):\n${[line, ...kept].join('\n')}`) > budget) break
      kept.unshift(line)
    }
    if (kept.length) payload += `\n\nAgent activity (agent claims unless marked HOST_VERIFIED):\n${kept.length < activity.length ? '- [earlier activity omitted]\n' : ''}${kept.join('\n')}`
  }
  payload = clip(payload, budget)
  return {
    documentId: `coding-run:${run.id}`, sourceKind: 'coding_run', sourceId: run.id,
    title: clip(`${workflow.title}${node ? ` · ${node.title}` : ''}`, 300), payload,
    context: 'Record of one DevFlow coding run on this project: the user\'s request, what the coding agent did and claimed, the files it changed, and HOST_VERIFIED test results that DevFlow ran itself.',
    tags: ['source:coding', `engine:${run.engine}`], occurredAt: run.startedAt,
  }
}

/**
 * Approved workflow documents are agreed decisions; drafts are superseded by later versions and
 * stay out of memory. A Gate review result is kept when it is saved, as findings.
 */
export const PROJECT_MEMORY_APPROVED_ARTIFACT_KINDS: readonly Artifact['kind'][] = ['clarification', 'design', 'acceptance']
export function buildArtifactMemoryDocument(artifact: Artifact, run: Pick<WorkflowRun, 'title' | 'nodes'>, approved: boolean): ProjectMemoryDocumentInput | null {
  if (!artifact.content.trim() || (approved ? !PROJECT_MEMORY_APPROVED_ARTIFACT_KINDS.includes(artifact.kind) : artifact.kind !== 'agent_review')) return null
  const node = run.nodes.find((candidate) => candidate.id === artifact.nodeId)
  const status = approved ? 'approved' : 'review result'
  const header = `# ${artifact.title}\nWorkflow document: ${artifact.kind}, ${status}${node ? `, stage ${node.stage}` : ''}, task "${run.title}"\n\n`
  return {
    documentId: `artifact:${artifact.id}`, sourceKind: 'artifact', sourceId: artifact.id,
    title: clip(artifact.title.trim() || artifact.kind, 300),
    payload: clip(`${header}${redactSensitiveText(artifact.content).value}`, PROJECT_MEMORY_MAX_DOCUMENT_BYTES - 1_024),
    context: approved
      ? `An approved ${artifact.kind} document from this project's DevFlow workflow; it records what was agreed for that task.`
      : 'A Gate review result from this project\'s DevFlow workflow: a reviewer\'s findings and risks, not a decision.',
    tags: ['source:artifact', `kind:${artifact.kind}`], occurredAt: artifact.updatedAt,
  }
}

/**
 * The documents that the approvals among `events` agreed to, for nodes `run` now records as
 * approved: the clarification revision and the design named by their approval audits, and the
 * acceptance bundle attached to an approved acceptance node. Nothing else counts as approved.
 */
export function approvedWorkflowArtifacts(run: Pick<WorkflowRun, 'id' | 'nodes'>, events: readonly AgentEvent[], artifacts: readonly Artifact[]): Artifact[] {
  const approved = new Map<string, Artifact>()
  for (const event of events) {
    const node = event.kind === 'approval' && event.runId === run.id
      ? run.nodes.find((candidate) => candidate.id === event.nodeId && candidate.status === 'success') : undefined
    if (!node) continue
    for (const artifact of artifacts) {
      if (artifact.runId !== run.id) continue
      const named = (event.clarificationAudit?.action === 'approved' && event.clarificationAudit.artifactId === artifact.id &&
          artifact.kind === 'clarification' && artifact.clarificationRevision?.status === 'approved') ||
        (event.designAudit?.action === 'approved' && event.designAudit.artifactId === artifact.id &&
          event.designAudit.updatedAt === artifact.updatedAt && artifact.kind === 'design')
      const bundle = node.kind === 'acceptance' && artifact.kind === 'acceptance' && artifact.nodeId === node.id && node.artifactIds.includes(artifact.id)
      if (named || bundle) approved.set(artifact.id, artifact)
    }
  }
  return [...approved.values()]
}

type CaptureStore = OwnerStore & Pick<LocalStore, 'recordProjectMemoryDocument' | 'getRun' | 'listArtifacts' | 'listCodingAgentEvents' | 'listTestEvidence'>
/** Each capture runs inside the store's durable mutation, before it persists. */
export async function captureConversationProjectMemory(store: CaptureStore, conversation: ConversationSource, previous?: Pick<ConversationSource, 'status'>, now = new Date().toISOString()): Promise<void> {
  if (previous?.status !== 'running' || !['idle', 'awaiting_answer'].includes(conversation.status)) return
  const config = await activeProjectMemoryConfiguration(store, conversation.localProjectId)
  const document = config && buildConversationMemoryDocument(conversation, now)
  if (document) await store.recordProjectMemoryDocument(config, document)
}
export async function captureCodingRunProjectMemory(store: CaptureStore, run: CodingAgentRun, previous?: Pick<CodingAgentRun, 'status'>, extraActivity?: readonly string[]): Promise<void> {
  if (isActiveCodingAgentRunStatus(run.status) || (previous && !isActiveCodingAgentRunStatus(previous.status))) return
  const config = await activeProjectMemoryConfiguration(store, run.projectId)
  if (!config) return
  const workflow = await store.getRun(run.runId)
  if (!workflow || workflow.projectId !== run.projectId) return
  const document = buildCodingRunMemoryDocument({ run, workflow, events: await store.listCodingAgentEvents(run.id),
    testEvidence: await store.listTestEvidence(run.runId), ...(extraActivity ? { extraActivity } : {}) })
  if (document) await store.recordProjectMemoryDocument(config, document)
}
/** A saved Gate review result: kept as the reviewer's findings, not as a decision. */
export async function captureReviewResultProjectMemory(store: CaptureStore, artifact: Artifact): Promise<void> {
  if (artifact.kind !== 'agent_review') return
  const run = await store.getRun(artifact.runId)
  if (!run || !run.nodes.some((node) => node.id === artifact.nodeId)) return
  const config = await activeProjectMemoryConfiguration(store, run.projectId)
  const document = config && buildArtifactMemoryDocument(artifact, run, false)
  if (document) await store.recordProjectMemoryDocument(config, document)
}
/** Called after a commit that may contain approvals; re-recording the same approval is a no-op. */
export async function captureApprovalProjectMemory(store: CaptureStore, run: WorkflowRun, events: readonly AgentEvent[]): Promise<void> {
  if (!events.some((event) => event.kind === 'approval')) return
  const config = await activeProjectMemoryConfiguration(store, run.projectId)
  if (!config) return
  for (const artifact of approvedWorkflowArtifacts(run, events, await store.listArtifacts(run.id))) {
    const document = buildArtifactMemoryDocument(artifact, run, true)
    if (document) await store.recordProjectMemoryDocument(config, document)
  }
}

export const LEGACY_MEMORY_DOCUMENT_ID = 'legacy:agent-memory'
/**
 * The Memory an earlier DevFlow version kept locally, as one document: each statement on its own
 * line with the day it was saved, newest first. What does not fit is left out, oldest first.
 */
export function buildLegacyMemoryDocument(revisions: readonly Pick<DurableAgentMemoryRevision, 'statement' | 'createdAt'>[]): ProjectMemoryDocumentInput | null {
  const newestFirst = [...revisions].filter((revision) => revision.statement.trim())
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  const header = 'Memory that an earlier version of DevFlow kept for this project and user. One statement per line, with the day it was saved, newest first:'
  const budget = PROJECT_MEMORY_MAX_DOCUMENT_BYTES - 1_024
  const lines: string[] = []
  for (const revision of newestFirst) {
    const line = `- [${revision.createdAt.slice(0, 10)}] ${clip(redactSensitiveText(revision.statement).value.replace(/\s+/gu, ' ').trim(), 2_000)}`
    if (bytes([header, ...lines, line].join('\n')) > budget) break
    lines.push(line)
  }
  if (!lines.length) return null
  const omitted = newestFirst.length - lines.length
  return {
    documentId: LEGACY_MEMORY_DOCUMENT_ID, sourceKind: 'legacy', sourceId: 'agent-memory', title: '旧版本地记忆',
    payload: [header, ...lines, ...(omitted ? [`- [${omitted} older statements omitted]`] : [])].join('\n'),
    context: 'Statements an earlier DevFlow version remembered for this project; the user saved each one, or a narrow automatic rule did. A later decision may have replaced some of them.',
    tags: ['source:legacy'], occurredAt: newestFirst[0]!.createdAt,
  }
}

type LegacyStore = OwnerStore & Pick<LocalStore, 'listProjectMemoryDocuments' | 'recordProjectMemoryDocument' | 'retrieveAgentMemoryRevisions'>
const LEGACY_RUNTIME_ID = 'project-memory-legacy-migration'
/**
 * ADR 0030: copy the Memory the old recall would have shown this owner in this project into the
 * project's memory, once per bank. A copy the user forgot, or cleared with the rest, stays gone,
 * and local Memory itself is left in place. Returns the recorded document, if any.
 */
export async function migrateLegacyProjectMemory(store: LegacyStore, projectId: string, now = new Date().toISOString()): Promise<ProjectMemoryDocument | null> {
  const config = await activeProjectMemoryConfiguration(store, projectId)
  if (!config) return null
  const existing = (await store.listProjectMemoryDocuments(projectId))
    .find((document) => document.bankId === config.bankId && document.documentId === LEGACY_MEMORY_DOCUMENT_ID)
  if (existing) return existing
  const scope = await resolveProjectMemoryScope(store, projectId, LEGACY_RUNTIME_ID)
  if (scope?.userId !== config.ownerUserId) return null
  const revisions = await store.retrieveAgentMemoryRevisions({ stateVersion: 1, id: LEGACY_RUNTIME_ID, scope,
    runtimeId: LEGACY_RUNTIME_ID, limit: AGENT_MEMORY_RETRIEVAL_LIMIT_MAX, requestedAt: now })
  const document = buildLegacyMemoryDocument(revisions)
  return document ? store.recordProjectMemoryDocument(config, document) : null
}
