/**
 * Discussion references (plan §7.2 W7). A reference names the exact material a user wants to
 * talk about; it lives only in this window's UI state and is prepended as plain text when the
 * message is sent, so the conversation contract and IPC stay unchanged. Adding a reference never
 * sends a message or calls a model.
 */
import { formatLocalTime } from './desktop-view-model'

/** What the reading surface knows: the material and its version (or recorded time). */
export type DiscussionMaterial = {
  materialId: string
  materialTitle: string
  /** “需求 v2”, or “记录于 2026-09-28 10:15” when there is no formal revision. */
  version: string
  /** Optional quote or review opinion; bounded when stored. */
  excerpt?: string
}

export type DiscussionReference = DiscussionMaterial & {
  id: string
  projectName: string
  runTitle: string
  stageLabel: string
  stepTitle: string
  /** When the user was reading it; the card says the material may have changed since. */
  readAt: string
}

export const MAX_REFERENCES_PER_CONVERSATION = 3
const MAX_EXCERPT_CHARS = 1500
/** Same bound as the conversation contract's `text` field. */
export const MAX_CONVERSATION_TEXT = 12000

export function buildDiscussionReference(input: DiscussionMaterial & {
  projectName: string
  runTitle: string
  stageLabel: string
  stepTitle: string
  readAt: string
}): DiscussionReference {
  const excerpt = input.excerpt?.trim()
  return {
    id: `${input.materialId}:${input.version}:${excerpt ? excerpt.length : 0}`,
    materialId: input.materialId,
    materialTitle: input.materialTitle,
    version: input.version,
    ...(excerpt ? { excerpt: excerpt.length > MAX_EXCERPT_CHARS ? `${excerpt.slice(0, MAX_EXCERPT_CHARS)}…` : excerpt } : {}),
    projectName: input.projectName,
    runTitle: input.runTitle,
    stageLabel: input.stageLabel,
    stepTitle: input.stepTitle,
    readAt: input.readAt,
  }
}

/** Adds or refreshes a card; the same material and version is kept once, newest last. */
export function addDiscussionReference(current: readonly DiscussionReference[], next: DiscussionReference): DiscussionReference[] {
  return [...current.filter((item) => item.id !== next.id), next].slice(-MAX_REFERENCES_PER_CONVERSATION)
}

export function formatDiscussionReferences(references: readonly DiscussionReference[]): string {
  return references.map((reference) => [
    `【引用材料】${reference.materialTitle}（${reference.version}）`,
    `项目：${reference.projectName} · 任务：${reference.runTitle} · 阶段：${reference.stageLabel} · 步骤：${reference.stepTitle}`,
    `读取时间：${formatLocalTime(reference.readAt)}（之后材料可能已更新，请以当前版本为准）`,
    ...(reference.excerpt ? [`引用内容：\n${reference.excerpt}`] : []),
  ].join('\n')).join('\n\n')
}

/** The exact text sent: references first, then what the user typed. */
export function composeMessageWithReferences(references: readonly DiscussionReference[], text: string): string {
  return references.length ? `${formatDiscussionReferences(references)}\n\n${text}` : text
}

const storageKey = (projectId: string, conversationId: string) => `devflow-discussion-references:${projectId}:${conversationId}`

function isReference(value: unknown): value is DiscussionReference {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return ['id', 'materialId', 'materialTitle', 'version', 'projectName', 'runTitle', 'stageLabel', 'stepTitle', 'readAt']
    .every((key) => typeof item[key] === 'string') && (item['excerpt'] === undefined || typeof item['excerpt'] === 'string')
}

/** Local UI state only; invalid or unavailable storage yields no cards, never an error. */
export function loadDiscussionReferences(projectId: string, conversationId: string): DiscussionReference[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey(projectId, conversationId)) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter(isReference).slice(-MAX_REFERENCES_PER_CONVERSATION) : []
  } catch {
    return []
  }
}

export function saveDiscussionReferences(projectId: string, conversationId: string, references: readonly DiscussionReference[]): boolean {
  try {
    if (references.length) localStorage.setItem(storageKey(projectId, conversationId), JSON.stringify(references))
    else localStorage.removeItem(storageKey(projectId, conversationId))
    return true
  } catch {
    return false
  }
}
