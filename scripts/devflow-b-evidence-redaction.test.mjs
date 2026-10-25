import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sanitizeEvidence } from './devflow-b-evidence-redaction.mjs'
test('nested prompts, business requests, answers and credentials retain only digests', () => {
  const input = { run: { request: 'PRIVATE_REQUEST', prompt: 'PRIVATE_PROMPT', userInstruction: 'PRIVATE_INSTRUCTION' },
    question: { id: 'q1', sessionId: 'child1', questions: [{ question: 'PRIVATE_QUESTION', options: [{ label: 'PRIVATE_CHOICE' }] }] },
    metadata: { answers: [['PRIVATE_ANSWER']], apiKey: 'PRIVATE_CREDENTIAL', headers: { Authorization: 'Bearer PRIVATE_HEADER' } } }
  const result = sanitizeEvidence(input)
  assert(!JSON.stringify(result).includes('PRIVATE_'))
  assert.equal(result.question.id, 'q1'); assert.equal(result.question.sessionId, 'child1')
  assert.equal(result.run.request.omitted, true); assert.match(result.run.request.sha256, /^[a-f0-9]{64}$/)
})
test('request identity, prompt counts/digests and usage remain auditable', () => {
  const input = { requestId: 'r1', promptDigest: 'abc', promptBytes: 42, inputTokens: 10, outputTokens: 2,
    request: { id: 'r2', payload: 'PRIVATE_PAYLOAD' }, detail: 'Bearer fixture-secret-value', other: 'sk-fixture1234567890' }
  const result = sanitizeEvidence(input)
  assert.equal(result.requestId, 'r1'); assert.equal(result.promptBytes, 42);assert.equal(result.promptDigest, 'abc')
  assert.equal(result.request.id, 'r2');assert.equal(result.inputTokens, 10);assert.equal(result.outputTokens, 2)
  assert(!JSON.stringify(result).includes('PRIVATE_'));assert(!JSON.stringify(result).includes('fixture-secret-value'))
  assert(!JSON.stringify(result).includes('sk-fixture'))
})
