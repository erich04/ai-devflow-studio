import type { ConversationResponse } from '../../electron/workbench-conversation-contract'
import type { DiscussionReference } from './discussion-reference'
const KEY = 'devflow-discussed-cards'
export const DISCUSSED_CARDS_CHANGED = 'devflow-discussed-cards-changed'
export function readDiscussedCards(): Record<string, string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter(([key, id]) => key.length <= 600 && typeof id === 'string' && id.length <= 240).slice(-500))
  } catch { return {} }
}
export const discussedCardKey = (projectId: string, materialId: string) => `${projectId}:${materialId}`
/** Only the actual persisted user message counts as discussed; adding a reference does not. */
export function recordDiscussedCards(projectId: string, conversationId: string, text: string, references: readonly DiscussionReference[], result: ConversationResponse) {
  const message = result.conversations.find(c => c.id === conversationId && c.localProjectId === projectId)?.messages.filter(m => m.role === 'user' && m.text === text).at(-1)
  if (!message) return
  const entries = readDiscussedCards()
  for (const reference of references.filter(r => r.materialId.includes('#finding:'))) entries[discussedCardKey(projectId, reference.materialId)] = message.id
  try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(Object.entries(entries).slice(-500)))); window.dispatchEvent(new Event(DISCUSSED_CARDS_CHANGED)) } catch { /* advisory local receipt; the persisted message remains available */ }
}
export function discussionPlaceholder(references: readonly DiscussionReference[]): string | undefined {
  const opinion = references.find(r => r.materialId.includes('#finding:'))?.label?.match(/意见 \d+/u)?.[0]
  return opinion ? `问问${opinion}……` : undefined
}
