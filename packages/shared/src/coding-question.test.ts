import { describe, expect, it } from 'vitest'
import { parseCodingQuestions, validateCodingQuestionReply } from './coding-question'

const questions = [
  { header: 'Color', question: 'Which color?', options: [{ label: 'Blue', description: 'Blue' }], custom: false },
  { header: 'Targets', question: 'Which targets?', options: [{ label: 'Web', description: 'Web' }, { label: 'App', description: 'App' }], multiple: true },
]
describe('coding questions', () => {
  it('preserves ordered multi-question answers, multiple selections and explicit custom input', () => {
    expect(parseCodingQuestions(questions)).toEqual(questions)
    expect(validateCodingQuestionReply(questions, { kind: 'answer', answers: [['Blue'], ['Web', 'App']] })).toEqual({ kind: 'answer', answers: [['Blue'], ['Web', 'App']] })
    expect(validateCodingQuestionReply(questions, { kind: 'answer', answers: [['Blue'], ['Other target']] }).kind).toBe('answer')
    expect(validateCodingQuestionReply(questions, { kind: 'dismiss' })).toEqual({ kind: 'dismiss' })
  })
  it.each([
    { kind: 'answer', answers: [['Blue']] },
    { kind: 'answer', answers: [['Green'], ['Web']] },
    { kind: 'answer', answers: [['Blue', 'Blue'], ['Web']] },
    { kind: 'answer', answers: [['Blue'], ['Web', 'Web']] },
    { kind: 'answer', answers: [[], ['Web']] },
    { kind: 'answer', answers: [['Blue'], [' ']] },
    { kind: 'answer', answers: [['Blue'], ['x'.repeat(4001)]] },
    { kind: 'dismiss', answers: [['Blue']] },
  ])('rejects incomplete, ambiguous or oversized answers: %j', (reply) => {
    expect(() => validateCodingQuestionReply(questions, reply)).toThrow()
  })
  it('rejects oversized or ambiguous question schemas', () => {
    expect(() => parseCodingQuestions([])).toThrow()
    expect(() => parseCodingQuestions(Array(9).fill(questions[0]))).toThrow()
    expect(() => parseCodingQuestions([{ ...questions[0], options: [questions[0]!.options[0], questions[0]!.options[0]] }])).toThrow()
    expect(() => parseCodingQuestions([{ ...questions[0], custom: 'yes' }])).toThrow()
  })
})
