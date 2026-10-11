import { expect, it } from 'vitest'
import { parseCodingHarnessCommand } from './coding-harness'

it('accepts versioned human answers while rejecting injected execution paths or authority', () => {
  const answer = { protocolVersion: 2, type: 'reply', codingRunId: 'coding-1', commandId: 'answer-1', expectedVersion: 5, questionId: 'question-1', objectiveVersion: 2, text: 'Preserve edits' }
  expect(parseCodingHarnessCommand(answer)).toEqual(answer)
  expect(() => parseCodingHarnessCommand({ ...answer, cwd: '/tmp/other', approved: true })).toThrow()
  expect(() => parseCodingHarnessCommand({ ...answer, protocolVersion: 1 })).toThrow()
})

it('allows explicit bounded content pages without accepting a host file path', () => {
  const command = { protocolVersion: 2, type: 'get', codingRunId: 'coding', detail: { kind: 'message', id: 'message-41', offset: 16000 } }
  expect(parseCodingHarnessCommand(command)).toEqual(command)
  expect(() => parseCodingHarnessCommand({ ...command, detail: { ...command.detail, file: '/etc/passwd' } })).toThrow()
  expect(() => parseCodingHarnessCommand({ ...command, detail: { ...command.detail, offset: -1 } })).toThrow()
})
