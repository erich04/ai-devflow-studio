import { createHash } from 'node:crypto'
export const evidenceSha = value => createHash('sha256').update(value).digest('hex')
export const opaqueEvidence = value => {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return { omitted: true, bytes: Buffer.byteLength(text), sha256: evidenceSha(text) }
}
const textFields = new Set(['prompt', 'userPrompt', 'systemPrompt', 'userInstruction', 'content', 'text', 'message', 'messages',
  'request', 'instructions', 'completion', 'reasoningContent', 'reasoning_content', 'rawOutput', 'rawResponse', 'payload',
  'toolArguments', 'arguments', 'summary', 'question', 'description', 'label', 'header', 'conclusion', 'comment', 'stdout',
  'stderr', 'patch', 'unifiedDiff', 'diffPreview', 'oldString', 'newString', 'oldText', 'newText', 'output', 'error',
  'title', 'answers', 'reply'])
const secretFields = /^(apiKey|authorization|authorizationKey|accessToken|refreshToken|credential|password|secret|headers|rawBody|body)$/i
export function sanitizeEvidence(value, key = '') {
  if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') return value
  if (secretFields.test(key) || (textFields.has(key) && (typeof value === 'string' || Array.isArray(value)))) return opaqueEvidence(value)
  if (typeof value === 'string') return value.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[redacted-key]')
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]')
  if (Array.isArray(value)) return value.map(item => sanitizeEvidence(item))
  return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, sanitizeEvidence(item, name)]))
}
