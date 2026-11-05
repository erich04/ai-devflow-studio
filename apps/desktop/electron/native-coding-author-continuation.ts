import { validateNativeHistory, type NativeConversationResponse, type NativeToolMessage } from '@ai-devflow/shared'
import { codingDigest } from './coding-candidate-workspace'
import type { IndependentCheckSource, IndependentVerificationState } from './native-coding-independent-verification'

export type PrivateAuthorTurn = {
  baselineDigest: string
  messages: NativeToolMessage[]
  assistant: NativeConversationResponse['assistantMessage']
  digest: string
}
const authorTools = new Set(['select_behavior_contract', 'submit_fixture_cases', 'submit_independent_checks'])
const maxTurnBytes = 1024 * 1024

function receipt(turn: Pick<PrivateAuthorTurn, 'messages' | 'assistant'>, feedback: string): NativeToolMessage[] {
  return [
    ...turn.messages,
    turn.assistant,
    ...(turn.assistant.tool_calls ?? []).map((call) => ({
      role: 'tool' as const,
      tool_call_id: call.id,
      content: JSON.stringify({ status: 'private-author-feedback', feedback }),
    })),
  ]
}

export function validPrivateAuthorTurn(turn: PrivateAuthorTurn): boolean {
  if (
    !turn ||
    !/^[a-f0-9]{64}$/u.test(turn.baselineDigest) ||
    !Array.isArray(turn.messages) ||
    turn.messages.length !== 1 ||
    turn.messages[0]?.role !== 'user' ||
    !turn.assistant ||
    turn.assistant.role !== 'assistant' ||
    (turn.assistant.tool_calls &&
      (turn.assistant.tool_calls.length !== 1 || !authorTools.has(turn.assistant.tool_calls[0]?.function?.name ?? '')))
  )
    return false
  const serialized = JSON.stringify({
    baselineDigest: turn.baselineDigest,
    messages: turn.messages,
    assistant: turn.assistant,
  })
  if (Buffer.byteLength(serialized) > maxTurnBytes || codingDigest(serialized) !== turn.digest) return false
  try {
    validateNativeHistory(receipt(turn, 'recorded'))
    return true
  } catch {
    return false
  }
}

/** Keep the original single-turn brief, not the composed continuation request.
 * Otherwise every retry would copy its own prior history into the next record. */
export function capturePrivateAuthorTurn(
  baselineDigest: string,
  messages: NativeToolMessage[],
  assistant: NativeConversationResponse['assistantMessage'],
): PrivateAuthorTurn | undefined {
  const value = structuredClone({ baselineDigest, messages, assistant })
  const turn = { ...value, digest: codingDigest(JSON.stringify(value)) }
  return validPrivateAuthorTurn(turn) ? turn : undefined
}

/** The continuation is private to the author, bound to the same approved source
 * and immutable B. The implementer's transcript never receives these messages. */
export function continuePrivateAuthor(
  source: IndependentCheckSource,
  messages: NativeToolMessage[],
  state?: IndependentVerificationState,
  toolName?: string,
): NativeToolMessage[] {
  const last = [...(state?.drafts ?? [])].reverse().find(
    (d) => d.objectiveVersion === source.objectiveVersion && d.sourceDigest === source.sourceDigest,
  )
  if (!last?.authorTurn || last.authorTurn.baselineDigest !== source.baselineDigest) return messages
  // The current brief already carries an accepted selection and retained cases.
  // Continue reasoning for corrections, not across completed phases or batches.
  if (last.selection || last.progress || (toolName && last.authorTurn.assistant.tool_calls?.[0]?.function.name !== toolName)) return messages
  const continued = [...receipt(last.authorTurn, last.feedback), ...messages]
  return Buffer.byteLength(JSON.stringify(continued)) <= 2 * maxTurnBytes ? structuredClone(continued) : messages
}
