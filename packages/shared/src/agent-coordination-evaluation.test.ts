import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  evaluateV22MultiAgentCandidate,
  evaluateV22SingleAgentBaseline,
  parseV22EvaluationDataset,
} from './agent-coordination-evaluation'

const dataset = JSON.parse(
  readFileSync('scripts/fixtures/v2.2-multi-agent-evaluation.json', 'utf8'),
)

describe('V2.2 single-Agent evaluation baseline', () => {
  it('computes the unchanged V2.0 baseline deterministically from the frozen dataset', () => {
    expect(parseV22EvaluationDataset(dataset).scenarios).toHaveLength(10)
    expect(evaluateV22SingleAgentBaseline(dataset)).toEqual({
      schemaVersion: 1,
      datasetId: 'v2.2-multi-agent-execution-tenancy',
      datasetVersion: 1,
      baselineContract: 'v2.0-single-agent',
      selectedScenarios: [
        {
          scenarioId: 'multi-agent-cross-file-quality',
          scenarioVersion: 1,
          quality: 0.5,
          humanInterventions: 0,
        },
        {
          scenarioId: 'single-agent-cross-file-baseline',
          scenarioVersion: 1,
          quality: 0.5,
          humanInterventions: 0,
        },
      ],
      aggregateQuality: 0.5,
      paidProviderCalls: 0,
      status: 'passed',
    })
    expect(evaluateV22SingleAgentBaseline(
      JSON.parse(JSON.stringify(dataset)),
    )).toEqual(evaluateV22SingleAgentBaseline(dataset))
    expect(evaluateV22SingleAgentBaseline({
      ...dataset,
      scenarios: [...dataset.scenarios].reverse(),
    })).toEqual(evaluateV22SingleAgentBaseline(dataset))
  })

  it('computes the bounded Multi-Agent candidate comparison from frozen observations', () => {
    expect(evaluateV22MultiAgentCandidate(dataset)).toEqual({
      schemaVersion: 1,
      datasetId: 'v2.2-multi-agent-execution-tenancy',
      datasetVersion: 1,
      candidateContract: 'v2.2-bounded-multi-agent',
      selectedScenarios: [
        {
          scenarioId: 'multi-agent-cross-file-quality',
          scenarioVersion: 1,
          singleQuality: 0.5,
          multiQuality: 1,
          singleCostUnits: 1,
          multiCostUnits: 1.5,
          singleLatencyUnits: 1,
          multiLatencyUnits: 1.5,
          humanInterventions: 0,
        },
        {
          scenarioId: 'single-agent-cross-file-baseline',
          scenarioVersion: 1,
          singleQuality: 0.5,
          multiQuality: 0.5,
          singleCostUnits: 1,
          multiCostUnits: 1,
          singleLatencyUnits: 1,
          multiLatencyUnits: 1,
          humanInterventions: 0,
        },
      ],
      aggregateSingleQuality: 0.5,
      aggregateMultiQuality: 0.75,
      aggregateImprovementOverSingle: 0.25,
      costMultiplierOverSingle: 1.25,
      latencyMultiplierOverSingle: 1.25,
      additionalHumanInterventions: 0,
      isolationViolations: 0,
      authorityViolations: 0,
      terminationViolations: 0,
      replayViolations: 0,
      redactionViolations: 0,
      paidProviderCalls: 0,
      status: 'passed',
    })

    const redactionViolation = JSON.parse(JSON.stringify(dataset))
    redactionViolation.scenarios[1].expected.redactionViolations = 1
    expect(evaluateV22MultiAgentCandidate(redactionViolation)).toMatchObject({
      redactionViolations: 1,
      status: 'failed',
    })
  })

  it('rejects dataset, metric, scenario, and graph tampering before computing a baseline', () => {
    const clone = () => JSON.parse(JSON.stringify(dataset))
    const unknownDatasetField = { ...clone(), hiddenPrompt: 'forbidden' }
    const invalidMetric = clone()
    invalidMetric.metricThresholds.maxCostMultiplierOverSingle = '1.5'
    const invalidObservation = clone()
    invalidObservation.scenarios[1].expected.multiCostUnits = 0
    const unknownExpectedField = clone()
    unknownExpectedField.scenarios[0].expected.hiddenResult = true
    const baselineNotSelected = clone()
    baselineNotSelected.scenarios[0].selectedForQualityComparison = false
    const duplicateRelation = clone()
    duplicateRelation.scenarios[1].graph.edges.push(
      duplicateRelation.scenarios[1].graph.edges[0],
    )
    const unexpectedCycle = clone()
    unexpectedCycle.scenarios[0].graph.tasks[0].dependsOn = ['baseline-task']
    unexpectedCycle.scenarios[0].graph.edges = ['baseline-task->baseline-task']
    const missingRejectionCycle = clone()
    missingRejectionCycle.scenarios[3].graph.tasks.forEach(
      (task: { dependsOn: string[] }) => { task.dependsOn = [] },
    )
    missingRejectionCycle.scenarios[3].graph.edges = []

    for (const candidate of [
      unknownDatasetField,
      invalidMetric,
      invalidObservation,
      unknownExpectedField,
      baselineNotSelected,
      duplicateRelation,
      unexpectedCycle,
      missingRejectionCycle,
    ]) {
      expect(() => evaluateV22SingleAgentBaseline(candidate)).toThrowError(
        'invalid_v22_evaluation_dataset',
      )
    }
  })
})
