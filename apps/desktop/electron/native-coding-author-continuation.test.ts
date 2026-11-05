// @vitest-environment node
import { expect, it } from 'vitest'
import { validateNativeHistory, type NativeToolMessage } from '@ai-devflow/shared'
import {
  capturePrivateAuthorTurn,
  continuePrivateAuthor,
  validPrivateAuthorTurn,
} from './native-coding-author-continuation'
import type { IndependentCheckSource, IndependentVerificationState } from './native-coding-independent-verification'
import { codingToolReply } from './native-coding-test-fixture'

it('keeps one exact private turn, including empty reasoning, within the same approved source', () => {
  const source: IndependentCheckSource = {
    objectiveVersion: 1,
    sourceDigest: 'a'.repeat(64),
    baselineDigest: 'b'.repeat(64),
    criteria: [],
  }
  const old: NativeToolMessage[] = [{ role: 'user', content: 'original immutable baseline' }]
  const reply = codingToolReply('private-call', 'submit_fixture_cases', { cases: [] })
  const assistant = { ...reply.assistantMessage, reasoning_content: '' }
  const turn = capturePrivateAuthorTurn(source.baselineDigest, old, assistant)!
  const state: IndependentVerificationState = {
    plans: [],
    humanInputs: [],
    drafts: [
      {
        attemptId: 'attempt-1',
        objectiveVersion: 1,
        sourceDigest: source.sourceDigest,
        feedback: 'The prior setup failed before the observation',
        authorTurn: turn,
      },
    ],
  }
  const current: NativeToolMessage[] = [{ role: 'user', content: 'current baseline and pending correction' }]
  const request = continuePrivateAuthor(source, current, JSON.parse(JSON.stringify(state)))
  expect(request.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'user'])
  expect(request[1]).toEqual(assistant)
  expect(request[2]).toMatchObject({ tool_call_id: 'private-call' })
  expect(request.at(-1)).toEqual(current[0])
  expect(() => validateNativeHistory(request)).not.toThrow()
  expect(continuePrivateAuthor({ ...source, objectiveVersion: 2 }, current, state)).toBe(current)
  expect(continuePrivateAuthor({ ...source, baselineDigest: 'c'.repeat(64) }, current, state)).toBe(current)
  expect(continuePrivateAuthor({ ...source, sourceDigest: 'c'.repeat(64) }, current, state)).toBe(current)
  expect(continuePrivateAuthor(source, current, { plans: [], humanInputs: [] })).toBe(current)
  expect(continuePrivateAuthor(source, current, state, 'submit_fixture_cases')).toEqual(request)
  expect(continuePrivateAuthor(source, current, state, 'select_behavior_contract')).toBe(current)
  const advanced = structuredClone(state)
  advanced.drafts![0]!.progress = true
  expect(continuePrivateAuthor(source, current, advanced, 'submit_fixture_cases')).toBe(current)
  delete advanced.drafts![0]!.progress
  advanced.drafts![0]!.selection = { scenarios: [], contextOnly: [] }
  expect(continuePrivateAuthor(source, current, advanced, 'submit_fixture_cases')).toBe(current)
  old[0] = { role: 'user', content: 'mutated caller object' }
  expect(turn.messages[0]?.content).toBe('original immutable baseline')
  expect(capturePrivateAuthorTurn(source.baselineDigest, request, assistant)).toBeUndefined()
})

it('bounds the stored turn and rejects malformed or altered private history', () => {
  const brief: NativeToolMessage[] = [{ role: 'user', content: 'B' }]
  const reply = codingToolReply('one', 'submit_fixture_cases', { cases: [] })
  expect(
    capturePrivateAuthorTurn('b'.repeat(64), brief, {
      ...reply.assistantMessage,
      reasoning_content: 'a'.repeat(1024 * 1024),
    }),
  ).toBeUndefined()
  const foreign = codingToolReply('other', 'run_command', { command: 'untrusted' })
  expect(capturePrivateAuthorTurn('b'.repeat(64), brief, foreign.assistantMessage)).toBeUndefined()
  const turn = capturePrivateAuthorTurn('b'.repeat(64), brief, reply.assistantMessage)!
  turn.assistant.content = 'changed after capture'
  expect(validPrivateAuthorTurn(turn)).toBe(false)
})
