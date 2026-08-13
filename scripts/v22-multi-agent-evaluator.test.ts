import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  createV22EvaluationRecord,
  evaluateV22CompletionRecord,
  parseV22EvaluationRecord,
  V22_SCENARIO_TESTS,
} from './v22-multi-agent-evaluator'

const datasetBytes = readFileSync('scripts/fixtures/v2.2-multi-agent-evaluation.json')
const candidateSha = '1234567890abcdef1234567890abcdef12345678'
const contractSha256 = 'a'.repeat(64)

function passingRecord() {
  return createV22EvaluationRecord({
    datasetBytes,
    candidateSha,
    contractSha256,
    recordedAt: '2026-08-13T22:00:00.000Z',
    scenarioExecutions: V22_SCENARIO_TESTS.map((scenario, index) => ({
      scenarioId: scenario.scenarioId,
      passed: true,
      durationMs: index + 1,
    })),
  })
}

describe('V2.2 Multi-Agent completion evaluator', () => {
  it('binds every frozen scenario and exact comparison metric to one candidate record', () => {
    const record = passingRecord()
    expect(record).toMatchObject({
      schemaVersion: 1,
      datasetId: 'v2.2-multi-agent-execution-tenancy',
      datasetVersion: 1,
      datasetSha256: createHash('sha256').update(datasetBytes).digest('hex'),
      contractSha256,
      coordinationContractVersion: 1,
      executionTenancyContractVersion: 1,
      candidateSha,
      paidProviderCalls: 0,
      status: 'passed',
      baseline: { aggregateQuality: 0.5, status: 'passed' },
      candidate: {
        aggregateSingleQuality: 0.5,
        aggregateMultiQuality: 0.75,
        aggregateImprovementOverSingle: 0.25,
        costMultiplierOverSingle: 1.25,
        latencyMultiplierOverSingle: 1.25,
        additionalHumanInterventions: 0,
        status: 'passed',
      },
      scans: {
        secretLeaks: 0,
        absolutePathLeaks: 0,
        sourceContentLeaks: 0,
        rawOutputLeaks: 0,
        isolationViolations: 0,
        authorityViolations: 0,
        terminationViolations: 0,
        replayViolations: 0,
        redactionViolations: 0,
      },
    })
    expect(record.scenarioResults).toHaveLength(10)
    expect(evaluateV22CompletionRecord({
      datasetBytes,
      record,
      expectedCandidateSha: candidateSha,
      expectedContractSha256: contractSha256,
    })).toEqual({ ready: true, failures: [] })
  })

  it.each([
    ['wrong_candidate', (record: ReturnType<typeof passingRecord>) => ({ ...record, candidateSha: 'b'.repeat(40) })],
    ['wrong_contract', (record: ReturnType<typeof passingRecord>) => ({ ...record, contractSha256: 'b'.repeat(64) })],
    ['failed_scenario', (record: ReturnType<typeof passingRecord>) => ({
      ...record,
      scenarioResults: record.scenarioResults.map((result, index) =>
        index === 0 ? { ...result, status: 'failed' as const } : result),
    })],
    ['paid_provider_call', (record: ReturnType<typeof passingRecord>) => ({ ...record, paidProviderCalls: 1 })],
    ['redaction_violation', (record: ReturnType<typeof passingRecord>) => ({
      ...record,
      scans: { ...record.scans, redactionViolations: 1 },
    })],
  ])('fails closed for %s', (failure, mutate) => {
    const result = evaluateV22CompletionRecord({
      datasetBytes,
      record: parseV22EvaluationRecord(mutate(passingRecord())),
      expectedCandidateSha: candidateSha,
      expectedContractSha256: contractSha256,
    })
    expect(result.ready).toBe(false)
    expect(result.failures).toContain(failure)
  })

  it('rejects extra record fields and a missing scenario before evaluation', () => {
    expect(() => parseV22EvaluationRecord({ ...passingRecord(), rawOutput: 'forbidden' }))
      .toThrow('v22_evaluation_record_invalid')
    expect(() => createV22EvaluationRecord({
      datasetBytes,
      candidateSha,
      contractSha256,
      recordedAt: '2026-08-13T22:00:00.000Z',
      scenarioExecutions: V22_SCENARIO_TESTS.slice(1).map((scenario) => ({
        scenarioId: scenario.scenarioId,
        passed: true,
        durationMs: 1,
      })),
    })).toThrow('v22_evaluation_scenarios_invalid')
  })

  it('rejects duplicate scenario evidence even when every required scenario is present', () => {
    const record = passingRecord()
    const duplicated = {
      ...record,
      scenarioResults: [...record.scenarioResults, record.scenarioResults[0]!],
    }
    expect(evaluateV22CompletionRecord({
      datasetBytes,
      record: parseV22EvaluationRecord(duplicated),
      expectedCandidateSha: candidateSha,
      expectedContractSha256: contractSha256,
    })).toEqual({ ready: false, failures: ['scenario_contract'] })
  })
})
