import { utf8ByteLength } from './knowledge-context'

/**
 * Project memory stored in Hindsight (ADR 0030). Hindsight owns extraction, consolidation and
 * recall; DevFlow owns capture, scope, budget and the user's controls. There are no memory
 * candidates and no per-item approval.
 */
export const PROJECT_MEMORY_POLICY_VERSION = 'hindsight-project-memory-v1' as const
/** A document larger than this is trimmed from the oldest part, never cut mid-message. */
export const PROJECT_MEMORY_MAX_DOCUMENT_BYTES = 48 * 1024
/** A conversation is retained once it has been idle this long, then again after each later turn. */
export const PROJECT_MEMORY_CONVERSATION_IDLE_MS = 3 * 60_000
export const PROJECT_MEMORY_MAX_RETAIN_ATTEMPTS = 3

/** `legacy`: the Memory an earlier DevFlow version kept locally, copied in once per bank. `commit`: one day of Git commit messages. */
export type ProjectMemorySourceKind = 'conversation' | 'coding_run' | 'artifact' | 'legacy' | 'commit'
export const PROJECT_MEMORY_SOURCE_KINDS: readonly ProjectMemorySourceKind[] = ['conversation', 'coding_run', 'artifact', 'legacy', 'commit']
export type ProjectMemoryDocumentStatus = 'queued' | 'submitted' | 'retained' | 'failed' | 'delete_pending' | 'deleted'

export type ProjectMemoryPairingBinding = {
  organizationId: string; projectId: string; userId: string; authAccountId?: string; localProjectId: string
}
export type ProjectMemoryConfiguration = {
  projectId: string
  /** The memory owner: the paired user, or the local project's principal. */
  ownerUserId: string
  pairingBinding?: ProjectMemoryPairingBinding
  enabled: boolean
  endpoint: string
  encryptedApiKey: string | null
  /** Saved Agent Provider whose credential pays for Hindsight's extraction calls. */
  providerId: string
  bankId: string
  /** Raised by "clear": later memory goes to a new, empty bank and the old bank is deleted. */
  generation?: number
  /** Memory recalled before this time is stale: the project's memory was cleared. */
  clearedAt?: string
  /** Hindsight memory id → when the user edited or deleted it; earlier recalls of it are stale. */
  changedMemories?: Record<string, string>
  /** Banks of earlier generations that still have to be deleted in Hindsight. */
  pendingBankDeletions?: string[]
  createdAt: string
  updatedAt: string
}
export type ProjectMemoryDocument = {
  id: string
  projectId: string
  ownerUserId: string
  bankId: string
  /** Stable per source; a later revision replaces the earlier one in Hindsight. */
  documentId: string
  sourceKind: ProjectMemorySourceKind
  sourceId: string
  title: string
  contentDigest: string
  /** Empty after deletion; the source itself stays in its own record. */
  payload: string
  context: string
  tags: string[]
  occurredAt: string
  status: ProjectMemoryDocumentStatus
  /** Fixed per submitted revision, so a resend after a crash replays the same operation. */
  operationId: string
  attempts: number
  /** Earliest time the worker may send it (conversations wait until idle). */
  notBefore: string
  leaseToken?: string
  leaseUntil?: string
  lastError?: string
  retainedAt?: string
  createdAt: string
  updatedAt: string
}
export type ProjectMemoryDocumentInput = Pick<ProjectMemoryDocument,
  'documentId' | 'sourceKind' | 'sourceId' | 'title' | 'payload' | 'context' | 'tags' | 'occurredAt'> & { notBefore?: string }

export type ProjectMemoryStatus = {
  projectId: string
  configured: boolean
  enabled: boolean
  transportAvailable: boolean
  pairedProject: boolean
  endpoint: string
  providerId: string | null
  bankId: string | null
  /**
   * Hindsight's model calls come back through this loopback relay. The token is never sent to
   * the renderer; `tokenFile` is where the user copies it from for the Hindsight deployment.
   */
  relay: { port: number; running: boolean; tokenFile: string | null; hindsightBaseUrl: string }
  counts: Partial<Record<ProjectMemoryDocumentStatus, number>>
  recent: Array<Pick<ProjectMemoryDocument, 'id' | 'sourceKind' | 'title' | 'status' | 'updatedAt' | 'lastError'>>
  unavailableReason?: string
}
/** Hindsight's memory types: consolidated observations, facts about the project, and what agents did. */
export type ProjectMemoryKind = 'observation' | 'world' | 'experience'
export const PROJECT_MEMORY_KINDS: readonly ProjectMemoryKind[] = ['observation', 'world', 'experience']
export const PROJECT_MEMORY_PAGE_SIZE = 50
export const PROJECT_MEMORY_MAX_EDIT_BYTES = 4_000
export type ProjectMemoryItem = {
  /** Hindsight's memory id. */
  id: string
  kind: ProjectMemoryKind
  text: string
  date?: string
  editedAt?: string
  source?: { documentId: string; sourceKind: ProjectMemorySourceKind; title: string }
}
export type ProjectMemoryPage = { items: ProjectMemoryItem[]; total: number; offset: number; limit: number }
export type ListProjectMemoriesInput = { projectId: string; kind: ProjectMemoryKind; query?: string; offset?: number }
export type UpdateProjectMemoryInput = { projectId: string; memoryId: string; text: string }
export type ForgetProjectMemoryInput = { projectId: string; memoryId: string }
/** `documentId` is DevFlow's local document id, as listed in the status. */
export type ForgetProjectMemorySourceInput = { projectId: string; documentId: string }
export type ClearProjectMemoryInput = { projectId: string; confirm: 'clear' }
export type ConfigureProjectMemoryInput = {
  projectId: string; enabled: boolean; endpoint: string; providerId: string
  /** Omitted keeps the saved key; an empty string removes it. */
  apiKey?: string
}

/**
 * Knowledge pages: Hindsight mental models that summarize what the project's memory holds. Hindsight
 * rewrites each page after consolidation (at most hourly, editing only what changed) or when the
 * user refreshes it; each rewrite is a model call charged like extraction. Editing or forgetting
 * memory empties the pages first, so they never show what was removed. Pages are for the user to
 * read; prompts keep using recalled memories.
 */
export type ProjectKnowledgePageId = 'conventions' | 'decisions' | 'pitfalls' | 'preferences'
export const PROJECT_KNOWLEDGE_PAGE_REFRESH_SECONDS = 60 * 60
export const PROJECT_KNOWLEDGE_PAGES: ReadonlyArray<{ id: ProjectKnowledgePageId; title: string; query: string }> = [
  { id: 'conventions', title: '约定与命令',
    query: '总结本项目的编码约定、目录与模块分工、构建/测试/运行命令和环境要求。按主题分节，用中文。只写记忆中有依据的内容，没有依据的不写。' },
  { id: 'decisions', title: '决策与原因',
    query: '列出本项目已经做出的技术和产品决策，每条写明原因。已被后来的决定取代的，写明新决定并标注旧决定已取代。用中文，只写记忆中有依据的内容。' },
  { id: 'pitfalls', title: '问题与解决办法',
    query: '总结本项目遇到过的问题、失败和陷阱，以及解决或避免的办法。区分 DevFlow 运行验证过的结果（HOST_VERIFIED）和 Agent 自己的说法。用中文，只写记忆中有依据的内容。' },
  { id: 'preferences', title: '用户偏好',
    query: '总结用户明确表达过的偏好：沟通方式（答复语言、详略、说明顺序）、工作方式和代码风格。只写用户自己说过的，用中文。' },
]
export type ProjectKnowledgePage = {
  id: ProjectKnowledgePageId
  title: string
  /** Markdown written by Hindsight; empty until the first refresh that found memories. */
  content: string
  refreshedAt?: string
  /** The latest refresh failed; the previous content is kept. */
  failedAt?: string
  /** New memories arrived after the last refresh. */
  stale: boolean
}
export type ProjectKnowledgePages = { projectId: string; pages: ProjectKnowledgePage[]; unavailableReason?: string }
export type RefreshProjectKnowledgePageInput = { projectId: string; pageId: ProjectKnowledgePageId }

/** Instructions written into the project's memory bank (Hindsight best practice: specific missions). */
export const PROJECT_MEMORY_MISSIONS = {
  retain: [
    'This bank is the long-term memory of one software project developed with DevFlow.',
    'Extract durable, reusable knowledge: project conventions and coding patterns, technical and product decisions with their reasons,',
    'build, test and run commands, environment facts, pitfalls and how they were resolved, the user\'s stated preferences,',
    'and what changed in each development task. Keep the conditions and the outcome of every lesson.',
    'Ignore greetings, small talk, progress chatter and one-off transient states.',
    'In discussions, keep what the user asks, decides and prefers; skip the assistant\'s acknowledgements and restatements.',
    'When the user changes an earlier decision, record the new decision and that it replaces the old one.',
    'A coding agent saying it "fixed" something or that "tests pass" is a claim: record it as that agent\'s claim.',
    'Only results marked HOST_VERIFIED are facts verified by DevFlow.',
    'Commit messages record what a change did and why, in its author\'s words; keep the reason and the date.',
    'Write each fact in the language of its source; keep Chinese text in Chinese.',
  ].join(' '),
  observations: [
    'Consolidate durable project knowledge: conventions, decisions and their rationale, recurring pitfalls, verified commands and user preferences.',
    'Prefer facts verified by DevFlow over agent claims. When newer evidence or a later user decision contradicts an older belief, update that belief to the newer one instead of keeping both.',
    'Ignore transient task states.',
  ].join(' '),
  reflect: 'You are a senior engineer on this project. Answer from past decisions, conventions and verified results; say when memory is uncertain or may be outdated.',
} as const

const DOCUMENT_ID = /^[a-z][a-z0-9_-]{0,40}:[A-Za-z0-9._:-]{1,200}$/u
export function isValidProjectMemoryDocumentInput(input: ProjectMemoryDocumentInput): boolean {
  return DOCUMENT_ID.test(input.documentId) && PROJECT_MEMORY_SOURCE_KINDS.includes(input.sourceKind) &&
    Boolean(input.sourceId) && input.sourceId.length <= 200 && Boolean(input.title.trim()) && input.title.length <= 300 &&
    Boolean(input.payload.trim()) && utf8ByteLength(input.payload) <= PROJECT_MEMORY_MAX_DOCUMENT_BYTES &&
    Boolean(input.context.trim()) && input.context.length <= 1_000 && input.tags.length <= 8 &&
    input.tags.every((tag) => /^[a-z][a-z0-9_-]{0,30}:[A-Za-z0-9._-]{1,120}$/u.test(tag)) &&
    Number.isFinite(Date.parse(input.occurredAt)) &&
    (input.notBefore === undefined || Number.isFinite(Date.parse(input.notBefore)))
}
export function validateProjectMemoryDocumentInput(input: ProjectMemoryDocumentInput): void {
  if (!isValidProjectMemoryDocumentInput(input)) throw new Error('Invalid project memory document')
}
