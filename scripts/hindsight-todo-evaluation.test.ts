import { describe, expect, it } from 'vitest'
import { scoreHindsightTodoRetrieval } from './hindsight-todo-evaluation'
import type { HindsightTodoQuestion } from './hindsight-todo-fixture'

function question(id: string, expectedPaths: string[]): HindsightTodoQuestion {
  return { id, query: id, phase: 'baseline', kind: expectedPaths.length ? 'direct' : 'no-answer',
    expectedPaths, expectedAnswerTerms: [] }
}

describe('Todo retrieval evidence scoring', () => {
  it('distinguishes a relevant second result from top one and requires every cross-document source', () => {
    const report = scoreHindsightTodoRetrieval({
      mode: 'hindsight-hybrid',
      questions: [question('rank-two', ['rules.md']), question('cross', ['rules.md', 'storage.md'])],
      observations: [
        { questionId: 'rank-two', matches: [{ path: 'noise.md' }, { path: 'rules.md' }], elapsedMs: 10 },
        { questionId: 'cross', matches: [{ path: 'rules.md' }, { path: 'rules.md' }], elapsedMs: 20 },
      ],
    })
    expect(report.metrics).toMatchObject({ top1Rate: 0.5, top5HitRate: 1, allRequiredTop5Rate: 0.5, sourceRecallAt5: 2 / 3 })
    expect(report.rows[0]).toMatchObject({ top1: false, top5: true, missingExpectedPaths: [] })
    expect(report.rows[1]).toMatchObject({ duplicatePaths: ['rules.md'], missingExpectedPaths: ['storage.md'] })
    expect(report.answerQualityEvaluated).toBe(false)
    expect(report.baselines.investigation.status).toBe('not-evaluated')
  })

  it('counts false positives, missing observations and provider errors without calling them correct abstentions', () => {
    const report = scoreHindsightTodoRetrieval({
      mode: 'local-lexical',
      questions: [question('absent', ['rules.md']), question('sixth', ['rules.md']),
        question('empty', []), question('noise', []), question('not-run', []), question('failed', [])],
      observations: [
        { questionId: 'sixth', matches: ['a', 'b', 'c', 'd', 'e', 'rules.md'].map((path) => ({ path })), elapsedMs: 1 },
        { questionId: 'empty', matches: [], elapsedMs: 2 },
        { questionId: 'noise', matches: [{ path: 'rules.md' }], elapsedMs: 3 },
        { questionId: 'failed', matches: [], elapsedMs: 4, error: 'timeout' },
      ],
    })
    expect(report.complete).toBe(false)
    expect(report.missingQuestionIds).toEqual(['absent', 'not-run'])
    expect(report.failedQuestionIds).toEqual(['failed'])
    expect(report.metrics).toMatchObject({ top1Rate: 0, top5HitRate: 0,
      noAnswerCorrectRate: 0.25, noAnswerFalsePositiveRate: 0.25, noAnswerUnresolved: 2 })
    expect(report.rows.find((row) => row.id === 'sixth')?.missingExpectedPaths).toEqual(['rules.md'])
    expect(report.rows.find((row) => row.id === 'failed')?.correctAbstention).toBe(false)
  })

  it('does not count a matching path with a stale digest or an unauthorized source as valid knowledge', () => {
    const report = scoreHindsightTodoRetrieval({
      mode: 'hindsight-hybrid',
      questions: [question('stale', ['rules.md']), question('current', ['rules.md'])],
      allowedSourcesByPhase: { baseline: { 'rules.md': 'sha256:current' } },
      observations: [
        { questionId: 'stale', matches: [{ path: 'rules.md', digest: 'sha256:old' }], elapsedMs: 10 },
        { questionId: 'current', matches: [{ path: 'other-project.md', digest: 'sha256:other' },
          { path: 'rules.md', digest: 'sha256:current' }], elapsedMs: 100 },
      ],
    })
    expect(report.metrics).toMatchObject({ top1Rate: 0, top5HitRate: 0.5, invalidSourceCount: 2,
      latencyP50Ms: 10, latencyP95Ms: 100 })
    expect(report.rows[0]).toMatchObject({ currentnessChecked: true,
      invalidSources: [{ path: 'rules.md', reason: 'digest-mismatch' }] })
    expect(report.rows[1]).toMatchObject({ invalidSources: [{ path: 'other-project.md', reason: 'unauthorized-source' }] })
    expect(report.rows[1]?.paths).toEqual(['other-project.md', 'rules.md'])
  })

  it('rejects ambiguous or malformed evidence instead of silently selecting the last result', () => {
    const observation = { questionId: 'one', matches: [], elapsedMs: 1 }
    const score = (observations: typeof observation[]) => scoreHindsightTodoRetrieval({
      mode: 'local-lexical', questions: [question('one', ['rules.md'])], observations,
    })
    expect(() => score([observation, observation])).toThrow('Duplicate observation')
    expect(() => score([{ ...observation, questionId: 'unknown' }])).toThrow('Unknown question')
    expect(() => score([{ ...observation, elapsedMs: Number.NaN }])).toThrow('Invalid elapsed')
    expect(() => score([{ ...observation, elapsedMs: -1 }])).toThrow('Invalid elapsed')
    expect(() => scoreHindsightTodoRetrieval({ mode: 'local-lexical',
      questions: [question('one', []), question('one', [])], observations: [] })).toThrow('Duplicate question')
  })

  it('reports unmeasured metrics as null when there are no questions', () => {
    const report = scoreHindsightTodoRetrieval({ mode: 'local-lexical', questions: [], observations: [] })
    expect(report.complete).toBe(false)
    expect(report.metrics).toMatchObject({ top1Rate: null, top5HitRate: null,
      noAnswerCorrectRate: null, latencyP50Ms: null, latencyP95Ms: null })
  })
})
