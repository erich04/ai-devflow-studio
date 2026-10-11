import { expect, it } from 'vitest'
import { scoreNativeCodingEvaluation } from './native-coding-evaluation.mjs'

it('does not turn missing runs, unknown costs, or claimed success with failed tests into release success', () => {
  const tasks = [{ id: 'a' }, { id: 'b' }]
  const rows = [{ taskId: 'a', engine: 'native-v3', claimedCompleted: true, independentPassed: false, costUsd: null, durationMs: 1000, model: 'fixture', provider: 'fixture' }]
  const report = scoreNativeCodingEvaluation(tasks, rows)
  expect(report.complete).toBe(false)
  expect(report.engines['native-v3'].falseSuccess).toBe(1)
  expect(report.engines['native-v3'].unknownCosts).toBe(1)
  expect(report.engines['native-v2'].missing).toBe(2)
  expect(report.engines['native-v3'].passRate).toBeNull()
  expect(report.engines['native-v3'].observedPassRate).toBe(0)
  expect(report.engines['native-v3'].metrics.inputTokens.total).toBeNull()
  expect(report.engines['native-v3'].metrics.inputTokens.missing).toBe(2)
  expect(report.releaseReady).toBe(false)
})

it('keeps incompatible models, missing repeat trials, and duplicate observations visible', () => {
  const tasks = [{ id: 'a' }]
  const row = { taskId: 'a', engine: 'native-v3', trial: 2, claimedCompleted: true, independentPassed: true, costUsd: 1, durationMs: 1000, model: 'model-b', provider: 'fixture' }
  const rows = [row, { ...row, engine: 'native-v2', model: 'model-a' }]
  const report = scoreNativeCodingEvaluation(tasks, rows)
  expect(report.engines['native-v3'].missing).toBe(1)
  expect(report.engines['native-v3'].totalCostUsd).toBeNull()
  expect(report.paired.incompatibleModels).toBe(1)
  expect(report.paired.v3OnlyPassed).toBe(0)
  expect(report.engines['native-v3'].observedPassRate).toBe(1)
  expect(report.engines['native-v3'].passRate).toBeNull()
  expect(report.engines['native-v3'].observedPassRate95[0]).toBeLessThan(0.5)
  expect(() => scoreNativeCodingEvaluation(tasks, [row, row])).toThrow(/duplicate/)
  expect(() => scoreNativeCodingEvaluation(tasks, [{ ...row, metrics: { inputTokens: -1 } }])).toThrow(/metric/)
})
