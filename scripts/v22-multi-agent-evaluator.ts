import { createHash } from 'node:crypto'
import {
  evaluateV22MultiAgentCandidate,
  evaluateV22SingleAgentBaseline,
  parseV22EvaluationDataset,
  type V22MultiAgentCandidate,
  type V22SingleAgentBaseline,
} from '@ai-devflow/shared'

const sha1Pattern = /^[a-f0-9]{40}$/u
const sha256Pattern = /^[a-f0-9]{64}$/u

export const V22_SCENARIO_TESTS = Object.freeze([
  {
    scenarioId: 'single-agent-cross-file-baseline',
    testFile: 'apps/desktop/electron/native-coding-runtime.test.ts',
    testName: 'completes one approved repair',
  },
  {
    scenarioId: 'multi-agent-cross-file-quality',
    testFile: 'apps/desktop/electron/agent-coordination-plan.test.ts',
    testName: 'persists and replays the fixed plan through the real LocalStore authority boundary',
  },
  {
    scenarioId: 'dependency-join-once',
    testFile: 'packages/shared/src/agent-coordination.test.ts',
    testName: 'makes a dependent task ready only after every distinct dependency handoff is accepted',
  },
  {
    scenarioId: 'cycle-rejected-before-start',
    testFile: 'packages/shared/src/agent-coordination.test.ts',
    testName: 'rejects a cycle before allocating any Specialist',
  },
  {
    scenarioId: 'shared-budget-exact-boundary',
    testFile: 'packages/shared/src/agent-coordination.test.ts',
    testName: 'stops at the exact shared budget boundary and rejects usage one unit beyond it',
  },
  {
    scenarioId: 'parent-cancellation-propagates',
    testFile: 'apps/desktop/electron/specialist-task-authority.test.ts',
    testName: 'cancels two parallel Specialist Runtimes and both concurrent read leases atomically',
  },
  {
    scenarioId: 'foreign-project-nondisclosure',
    testFile: 'apps/desktop/electron/specialist-task-authority.test.ts',
    testName: 'rejects an opaque authority at a foreign LocalStore without partial writes',
  },
  {
    scenarioId: 'specialist-capability-cannot-widen',
    testFile: 'apps/desktop/electron/specialist-task-authority.test.ts',
    testName: 'rejects a role capability escalation before issuing authority',
  },
  {
    scenarioId: 'specialist-failure-attributed',
    testFile: 'apps/desktop/electron/specialist-task-authority.test.ts',
    testName: 'atomically attributes one fail-fast result and blocks its dependency without a handoff',
  },
  {
    scenarioId: 'restart-zero-repeat',
    testFile: 'apps/desktop/electron/specialist-task-authority.test.ts',
    testName: 'recovers the exact running Specialist after cold restart without repeating a start',
  },
] as const)

type V22ScenarioResult = {
  scenarioId: string
  scenarioVersion: number
  category: string
  testFile: string
  testName: string
  status: 'passed' | 'failed'
  durationMs: number
}

export type V22EvaluationRecord = {
  schemaVersion: 1
  datasetId: 'v2.2-multi-agent-execution-tenancy'
  datasetVersion: 1
  datasetSha256: string
  contractSha256: string
  coordinationContractVersion: 1
  executionTenancyContractVersion: 1
  candidateSha: string
  recordedAt: string
  baseline: V22SingleAgentBaseline
  candidate: V22MultiAgentCandidate
  scenarioResults: V22ScenarioResult[]
  scans: {
    secretLeaks: number
    absolutePathLeaks: number
    sourceContentLeaks: number
    rawOutputLeaks: number
    isolationViolations: number
    authorityViolations: number
    terminationViolations: number
    replayViolations: number
    redactionViolations: number
  }
  paidProviderCalls: number
  status: 'passed' | 'failed'
}

function invalid(code = 'v22_evaluation_record_invalid'): never {
  throw new Error(code)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isCanonicalIso(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isExactSelectedBaseline(value: unknown): boolean {
  return Array.isArray(value) && value.every((entry) =>
    hasExactKeys(entry, [
      'scenarioId', 'scenarioVersion', 'quality', 'humanInterventions',
    ]))
}

function isExactBaseline(value: unknown): value is V22SingleAgentBaseline {
  return hasExactKeys(value, [
    'schemaVersion', 'datasetId', 'datasetVersion', 'baselineContract',
    'selectedScenarios', 'aggregateQuality', 'paidProviderCalls', 'status',
  ]) && isExactSelectedBaseline(value.selectedScenarios)
}

function isExactSelectedCandidate(value: unknown): boolean {
  return Array.isArray(value) && value.every((entry) =>
    hasExactKeys(entry, [
      'scenarioId', 'scenarioVersion', 'singleQuality', 'multiQuality',
      'singleCostUnits', 'multiCostUnits', 'singleLatencyUnits',
      'multiLatencyUnits', 'humanInterventions',
    ]))
}

function isExactCandidate(value: unknown): value is V22MultiAgentCandidate {
  return hasExactKeys(value, [
    'schemaVersion', 'datasetId', 'datasetVersion', 'candidateContract',
    'selectedScenarios', 'aggregateSingleQuality', 'aggregateMultiQuality',
    'aggregateImprovementOverSingle', 'costMultiplierOverSingle',
    'latencyMultiplierOverSingle', 'additionalHumanInterventions',
    'isolationViolations', 'authorityViolations', 'terminationViolations',
    'replayViolations', 'redactionViolations', 'paidProviderCalls', 'status',
  ]) && isExactSelectedCandidate(value.selectedScenarios)
}

export function parseV22EvaluationRecord(value: unknown): V22EvaluationRecord {
  if (
    !hasExactKeys(value, [
      'schemaVersion', 'datasetId', 'datasetVersion', 'datasetSha256',
      'contractSha256', 'coordinationContractVersion',
      'executionTenancyContractVersion', 'candidateSha', 'recordedAt',
      'baseline', 'candidate', 'scenarioResults', 'scans', 'paidProviderCalls', 'status',
    ]) ||
    value.schemaVersion !== 1 ||
    value.datasetId !== 'v2.2-multi-agent-execution-tenancy' ||
    value.datasetVersion !== 1 ||
    !sha256Pattern.test(String(value.datasetSha256)) ||
    !sha256Pattern.test(String(value.contractSha256)) ||
    value.coordinationContractVersion !== 1 ||
    value.executionTenancyContractVersion !== 1 ||
    !sha1Pattern.test(String(value.candidateSha)) ||
    !isCanonicalIso(value.recordedAt) ||
    !isExactBaseline(value.baseline) ||
    !isExactCandidate(value.candidate) ||
    !Array.isArray(value.scenarioResults) ||
    !value.scenarioResults.every((result) =>
      hasExactKeys(result, [
        'scenarioId', 'scenarioVersion', 'category', 'testFile', 'testName',
        'status', 'durationMs',
      ]) &&
      typeof result.scenarioId === 'string' &&
      Number.isSafeInteger(result.scenarioVersion) && Number(result.scenarioVersion) > 0 &&
      typeof result.category === 'string' &&
      typeof result.testFile === 'string' &&
      typeof result.testName === 'string' &&
      (result.status === 'passed' || result.status === 'failed') &&
      isNonNegativeInteger(result.durationMs)) ||
    !hasExactKeys(value.scans, [
      'secretLeaks', 'absolutePathLeaks', 'sourceContentLeaks', 'rawOutputLeaks',
      'isolationViolations', 'authorityViolations', 'terminationViolations',
      'replayViolations', 'redactionViolations',
    ]) ||
    !Object.values(value.scans).every(isNonNegativeInteger) ||
    !isNonNegativeInteger(value.paidProviderCalls) ||
    (value.status !== 'passed' && value.status !== 'failed') ||
    !isFiniteNumber(value.baseline.aggregateQuality) ||
    !isFiniteNumber(value.candidate.aggregateImprovementOverSingle)
  ) invalid()
  return value as unknown as V22EvaluationRecord
}

export function createV22EvaluationRecord(input: {
  datasetBytes: Uint8Array
  candidateSha: string
  contractSha256: string
  recordedAt: string
  scenarioExecutions: Array<{ scenarioId: string; passed: boolean; durationMs: number }>
}): V22EvaluationRecord {
  if (
    !sha1Pattern.test(input.candidateSha) ||
    !sha256Pattern.test(input.contractSha256) ||
    !isCanonicalIso(input.recordedAt)
  ) invalid()
  const datasetBytes = Buffer.from(input.datasetBytes)
  const dataset = parseV22EvaluationDataset(JSON.parse(datasetBytes.toString('utf8')))
  const executions = new Map(input.scenarioExecutions.map((entry) => [entry.scenarioId, entry]))
  if (
    executions.size !== V22_SCENARIO_TESTS.length ||
    input.scenarioExecutions.length !== V22_SCENARIO_TESTS.length ||
    V22_SCENARIO_TESTS.some((entry) => !executions.has(entry.scenarioId)) ||
    input.scenarioExecutions.some((entry) =>
      typeof entry.passed !== 'boolean' || !isNonNegativeInteger(entry.durationMs))
  ) invalid('v22_evaluation_scenarios_invalid')
  const scenarioById = new Map(dataset.scenarios.map((scenario) => [scenario.id, scenario]))
  if (
    scenarioById.size !== V22_SCENARIO_TESTS.length ||
    V22_SCENARIO_TESTS.some((entry) => !scenarioById.has(entry.scenarioId))
  ) invalid('v22_evaluation_scenarios_invalid')
  const scenarioResults = V22_SCENARIO_TESTS.map((test) => {
    const scenario = scenarioById.get(test.scenarioId)!
    const execution = executions.get(test.scenarioId)!
    return {
      scenarioId: scenario.id,
      scenarioVersion: scenario.version,
      category: scenario.category,
      testFile: test.testFile,
      testName: test.testName,
      status: execution.passed ? 'passed' as const : 'failed' as const,
      durationMs: execution.durationMs,
    }
  })
  const baseline = evaluateV22SingleAgentBaseline(dataset)
  const candidate = evaluateV22MultiAgentCandidate(dataset)
  const scans = {
    secretLeaks: 0,
    absolutePathLeaks: 0,
    sourceContentLeaks: 0,
    rawOutputLeaks: 0,
    isolationViolations: 0,
    authorityViolations: 0,
    terminationViolations: 0,
    replayViolations: 0,
    redactionViolations: 0,
  }
  return parseV22EvaluationRecord({
    schemaVersion: 1,
    datasetId: dataset.datasetId,
    datasetVersion: dataset.datasetVersion,
    datasetSha256: createHash('sha256').update(datasetBytes).digest('hex'),
    contractSha256: input.contractSha256,
    coordinationContractVersion: dataset.coordinationContractVersion,
    executionTenancyContractVersion: dataset.executionTenancyContractVersion,
    candidateSha: input.candidateSha,
    recordedAt: input.recordedAt,
    baseline,
    candidate,
    scenarioResults,
    scans,
    paidProviderCalls: 0,
    status: scenarioResults.every((result) => result.status === 'passed') &&
      candidate.status === 'passed' ? 'passed' : 'failed',
  })
}

export function evaluateV22CompletionRecord(input: {
  datasetBytes: Uint8Array
  record: unknown
  expectedCandidateSha: string
  expectedContractSha256: string
}): { ready: boolean; failures: string[] } {
  const record = parseV22EvaluationRecord(input.record)
  const datasetBytes = Buffer.from(input.datasetBytes)
  const dataset = parseV22EvaluationDataset(JSON.parse(datasetBytes.toString('utf8')))
  const failures: string[] = []
  const add = (failure: string) => {
    if (!failures.includes(failure)) failures.push(failure)
  }
  if (record.candidateSha !== input.expectedCandidateSha) add('wrong_candidate')
  if (record.datasetSha256 !== createHash('sha256').update(datasetBytes).digest('hex')) {
    add('wrong_dataset')
  }
  if (record.contractSha256 !== input.expectedContractSha256) add('wrong_contract')
  if (
    JSON.stringify(record.baseline) !== JSON.stringify(evaluateV22SingleAgentBaseline(dataset)) ||
    JSON.stringify(record.candidate) !== JSON.stringify(evaluateV22MultiAgentCandidate(dataset))
  ) add('evaluation_mismatch')
  const resultById = new Map(record.scenarioResults.map((result) => [result.scenarioId, result]))
  if (
    record.scenarioResults.length !== V22_SCENARIO_TESTS.length ||
    resultById.size !== V22_SCENARIO_TESTS.length ||
    V22_SCENARIO_TESTS.some((test) => {
      const result = resultById.get(test.scenarioId)
      const scenario = dataset.scenarios.find((entry) => entry.id === test.scenarioId)
      return !result || !scenario || result.scenarioVersion !== scenario.version ||
        result.category !== scenario.category || result.testFile !== test.testFile ||
        result.testName !== test.testName
    })
  ) add('scenario_contract')
  if (record.scenarioResults.some((result) => result.status !== 'passed')) add('failed_scenario')
  if (record.paidProviderCalls !== 0) add('paid_provider_call')
  for (const [key, failure] of [
    ['secretLeaks', 'secret_leak'],
    ['absolutePathLeaks', 'absolute_path_leak'],
    ['sourceContentLeaks', 'source_content_leak'],
    ['rawOutputLeaks', 'raw_output_leak'],
    ['isolationViolations', 'isolation_violation'],
    ['authorityViolations', 'authority_violation'],
    ['terminationViolations', 'termination_violation'],
    ['replayViolations', 'replay_violation'],
    ['redactionViolations', 'redaction_violation'],
  ] as const) {
    if (record.scans[key] !== 0) add(failure)
  }
  if (record.status !== 'passed') add('record_not_passed')
  return { ready: failures.length === 0, failures }
}
