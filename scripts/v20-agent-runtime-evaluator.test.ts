import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  evaluateV20CompletionRecord,
  parseV20EvaluationDataset,
  parseV20EvaluationRecord,
  requiredScenarioCategories,
} from './v20-agent-runtime-evaluator.mjs'

const datasetPath = 'scripts/fixtures/v2.0-agent-runtime-scenarios.json'
const datasetBytes = readFileSync(datasetPath)
const dataset = parseV20EvaluationDataset(JSON.parse(datasetBytes.toString('utf8')))
const datasetSha256 = createHash('sha256').update(datasetBytes).digest('hex')
const candidateSha = '1234567890abcdef1234567890abcdef12345678'

function passingRecord() {
  return {
    schemaVersion: 1,
    datasetId: dataset.datasetId,
    datasetVersion: dataset.datasetVersion,
    datasetSha256,
    runtimeContractVersion: dataset.runtimeContractVersion,
    codingExecutorContractVersion: dataset.codingExecutorContractVersion,
    nativeToolContractVersion: dataset.nativeToolContractVersion,
    candidateSha,
    recordedAt: '2026-08-13T05:00:00.000Z',
    scenarioResults: dataset.scenarios.map((entry) => ({
      scenarioId: entry.scenario.id,
      scenarioVersion: entry.scenario.version,
      status: 'passed',
      observation: {
        stopReason: entry.scenario.expected.stopReason,
        steps: Math.min(1, entry.scenario.expected.maxSteps),
        eventTypes: entry.scenario.expected.requiredEventTypes,
        evidenceKinds: entry.scenario.expected.evidenceKinds,
        cleanupStatus: entry.scenario.expected.cleanupStatus,
        metrics: {
          qualityPassed: true,
          costUsd: 0,
          latencyMs: 10,
          humanInterventions: entry.scenario.id === 'native-coding-repair' ? 1 : 0,
          recoverySucceeded: true,
          isolationViolations: 0,
        },
      },
    })),
    executorParity: [
      {
        groupId: 'governed-coding-repair',
        nativeScenarioId: 'native-coding-repair',
        opencodeScenarioId: 'opencode-coding-contract',
        eventContract: true,
        cancellation: true,
        evidence: true,
        terminalResult: true,
        cleanup: true,
      },
    ],
    scans: {
      secretLeaks: 0,
      absolutePathLeaks: 0,
      sourceLeaks: 0,
      rawOutputLeaks: 0,
      isolationViolations: 0,
    },
    paidProviderCalls: 0,
    status: 'passed',
  }
}

describe('V2.0 Agent Runtime completion evaluator', () => {
  it('freezes one exact no-cost dataset covering every V2.0 completion category', () => {
    expect(dataset).toMatchObject({
      schemaVersion: 1,
      datasetId: 'v2.0-native-agent-runtime-completion',
      datasetVersion: 1,
      runtimeContractVersion: 1,
      codingExecutorContractVersion: 1,
      nativeToolContractVersion: 1,
    })
    expect(new Set(dataset.scenarios.map((entry) => entry.category))).toEqual(
      new Set(requiredScenarioCategories),
    )
    expect(dataset.scenarios.map((entry) => entry.scenario.id)).toEqual([
      'native-tool-no-side-effect',
      'native-coding-repair',
      'opencode-coding-contract',
      'local-mcp-discovery-call',
      'checkpoint-resume',
      'tool-cancellation',
      'executor-cancellation',
      'step-limit',
      'deadline-timeout',
      'tool-call-limit',
      'budget-exhaustion',
      'malformed-tool-schema',
      'oversized-tool-result',
      'stale-authority',
      'tenant-scope-isolation',
    ])
    expect(dataset.scenarios.every((entry) => entry.defaultNoCost)).toBe(true)
    expect(dataset.scenarios.every((entry) => entry.testFile.endsWith('.test.ts'))).toBe(true)
  })

  it('rejects unknown fields, duplicate scenarios, and incomplete category coverage', () => {
    expect(() => parseV20EvaluationDataset({ ...dataset, surprise: true })).toThrow(
      'v20_evaluation_dataset_invalid',
    )
    expect(() => parseV20EvaluationDataset({
      ...dataset,
      scenarios: [...dataset.scenarios, dataset.scenarios[0]],
    })).toThrow('v20_evaluation_dataset_invalid')
    expect(() => parseV20EvaluationDataset({
      ...dataset,
      scenarios: dataset.scenarios.filter((entry) => entry.category !== 'tenant_isolation'),
    })).toThrow('v20_evaluation_dataset_incomplete')
  })

  it('accepts only an exact candidate-bound, no-leak, no-paid-call completion record', () => {
    const record = parseV20EvaluationRecord(passingRecord())
    expect(evaluateV20CompletionRecord({
      dataset,
      record,
      expectedCandidateSha: candidateSha,
      expectedDatasetSha256: datasetSha256,
    })).toEqual({ ready: true, failures: [] })
  })

  it.each([
    ['wrong_candidate', (record: ReturnType<typeof passingRecord>) => ({ ...record, candidateSha: 'a'.repeat(40) })],
    ['wrong_dataset', (record: ReturnType<typeof passingRecord>) => ({ ...record, datasetSha256: 'b'.repeat(64) })],
    ['paid_provider_call', (record: ReturnType<typeof passingRecord>) => ({ ...record, paidProviderCalls: 1 })],
    ['secret_leak', (record: ReturnType<typeof passingRecord>) => ({ ...record, scans: { ...record.scans, secretLeaks: 1 } })],
    ['parity_gap', (record: ReturnType<typeof passingRecord>) => ({ ...record, executorParity: [{ ...record.executorParity[0], evidence: false }] })],
    ['missing_scenario', (record: ReturnType<typeof passingRecord>) => ({ ...record, scenarioResults: record.scenarioResults.slice(1) })],
    ['failed_scenario', (record: ReturnType<typeof passingRecord>) => ({
      ...record,
      scenarioResults: record.scenarioResults.map((result, index) => index === 0 ? { ...result, status: 'failed' } : result),
    })],
  ])('fails closed for %s', (failure, mutate) => {
    const result = evaluateV20CompletionRecord({
      dataset,
      record: parseV20EvaluationRecord(mutate(passingRecord())),
      expectedCandidateSha: candidateSha,
      expectedDatasetSha256: datasetSha256,
    })
    expect(result.ready).toBe(false)
    expect(result.failures).toContain(failure)
  })

  it('rejects extra completion-record fields before evaluation', () => {
    expect(() => parseV20EvaluationRecord({ ...passingRecord(), rawOutput: 'forbidden' })).toThrow(
      'v20_evaluation_record_invalid',
    )
  })
})
