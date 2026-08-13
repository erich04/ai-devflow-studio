const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u
const sha1Pattern = /^[a-f0-9]{40}$/u
const sha256Pattern = /^[a-f0-9]{64}$/u

const eventTypes = [
  'runtime_started',
  'context_attached',
  'runtime_resumed',
  'decision_recorded',
  'action_requested',
  'permission_decided',
  'action_result',
  'observation_recorded',
  'evaluation_recorded',
  'checkpointed',
  'runtime_stopped',
]
const stopReasons = [
  'success',
  'failure',
  'cancelled',
  'timeout',
  'step_limit',
  'budget_exhausted',
  'policy_denied',
]
const metricDimensions = [
  'quality',
  'cost',
  'latency',
  'human_intervention',
  'recovery',
  'isolation',
]
export const requiredScenarioCategories = [
  'native_tool',
  'native_coding',
  'opencode_coding',
  'local_mcp',
  'checkpoint_resume',
  'cancellation',
  'bounds',
  'schema_rejection',
  'stale_authority',
  'tenant_isolation',
]

function invalid(code) {
  throw new Error(code)
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value, keys) {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isIdentifier(value) {
  return typeof value === 'string' && identifierPattern.test(value)
}

function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0
}

function isNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0
}

function isCanonicalIso(value) {
  if (typeof value !== 'string') return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

function isUniqueStringArray(value, allowed) {
  return Array.isArray(value) &&
    value.every((item) => typeof item === 'string' && (!allowed || allowed.includes(item))) &&
    new Set(value).size === value.length
}

function parseScenario(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'stateVersion',
      'id',
      'version',
      'name',
      'objective',
      'executorKind',
      'expected',
      'metricDimensions',
    ]) ||
    value.stateVersion !== 1 ||
    !isIdentifier(value.id) ||
    !isPositiveInteger(value.version) ||
    typeof value.name !== 'string' ||
    value.name.length < 1 ||
    value.name.length > 200 ||
    typeof value.objective !== 'string' ||
    value.objective.length < 1 ||
    value.objective.length > 2_000 ||
    !['none', 'native', 'opencode'].includes(value.executorKind) ||
    !isRecord(value.expected) ||
    !hasExactKeys(value.expected, [
      'stopReason',
      'maxSteps',
      'requiredEventTypes',
      'evidenceKinds',
      'cleanupStatus',
    ]) ||
    !stopReasons.includes(value.expected.stopReason) ||
    !isPositiveInteger(value.expected.maxSteps) ||
    value.expected.maxSteps > 32 ||
    !isUniqueStringArray(value.expected.requiredEventTypes, eventTypes) ||
    !isUniqueStringArray(value.expected.evidenceKinds) ||
    !value.expected.evidenceKinds.every(isIdentifier) ||
    !['not_required', 'completed'].includes(value.expected.cleanupStatus) ||
    !Array.isArray(value.metricDimensions) ||
    value.metricDimensions.length !== metricDimensions.length ||
    !metricDimensions.every((dimension, index) => value.metricDimensions[index] === dimension)
  ) invalid('v20_evaluation_dataset_invalid')
  return value
}

function parseScenarioEntry(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['category', 'scenario', 'testFile', 'testName', 'defaultNoCost']) ||
    !requiredScenarioCategories.includes(value.category) ||
    typeof value.testFile !== 'string' ||
    !/^(?:apps|packages)\/[A-Za-z0-9._/-]+\.test\.ts$/u.test(value.testFile) ||
    value.testFile.includes('..') ||
    typeof value.testName !== 'string' ||
    value.testName.length < 1 ||
    value.testName.length > 300 ||
    value.defaultNoCost !== true
  ) invalid('v20_evaluation_dataset_invalid')
  parseScenario(value.scenario)
  return value
}

export function parseV20EvaluationDataset(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'schemaVersion',
      'datasetId',
      'datasetVersion',
      'runtimeContractVersion',
      'codingExecutorContractVersion',
      'nativeToolContractVersion',
      'scenarios',
    ]) ||
    value.schemaVersion !== 1 ||
    value.datasetId !== 'v2.0-native-agent-runtime-completion' ||
    value.datasetVersion !== 1 ||
    value.runtimeContractVersion !== 1 ||
    value.codingExecutorContractVersion !== 1 ||
    value.nativeToolContractVersion !== 1 ||
    !Array.isArray(value.scenarios) ||
    value.scenarios.length < requiredScenarioCategories.length ||
    value.scenarios.length > 64
  ) invalid('v20_evaluation_dataset_invalid')

  value.scenarios.forEach(parseScenarioEntry)
  if (new Set(value.scenarios.map((entry) => entry.scenario.id)).size !== value.scenarios.length) {
    invalid('v20_evaluation_dataset_invalid')
  }
  const categories = new Set(value.scenarios.map((entry) => entry.category))
  if (requiredScenarioCategories.some((category) => !categories.has(category))) {
    invalid('v20_evaluation_dataset_incomplete')
  }
  return value
}

function parseObservation(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'stopReason',
      'steps',
      'eventTypes',
      'evidenceKinds',
      'cleanupStatus',
      'metrics',
    ]) ||
    !stopReasons.includes(value.stopReason) ||
    !isNonNegativeInteger(value.steps) ||
    !isUniqueStringArray(value.eventTypes, eventTypes) ||
    !isUniqueStringArray(value.evidenceKinds) ||
    !value.evidenceKinds.every(isIdentifier) ||
    !['not_required', 'completed', 'failed'].includes(value.cleanupStatus) ||
    !isRecord(value.metrics) ||
    !hasExactKeys(value.metrics, [
      'qualityPassed',
      'costUsd',
      'latencyMs',
      'humanInterventions',
      'recoverySucceeded',
      'isolationViolations',
    ]) ||
    typeof value.metrics.qualityPassed !== 'boolean' ||
    typeof value.metrics.costUsd !== 'number' ||
    !Number.isFinite(value.metrics.costUsd) ||
    value.metrics.costUsd < 0 ||
    !isNonNegativeInteger(value.metrics.latencyMs) ||
    !isNonNegativeInteger(value.metrics.humanInterventions) ||
    typeof value.metrics.recoverySucceeded !== 'boolean' ||
    !isNonNegativeInteger(value.metrics.isolationViolations)
  ) invalid('v20_evaluation_record_invalid')
  return value
}

function parseScenarioResult(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['scenarioId', 'scenarioVersion', 'status', 'observation']) ||
    !isIdentifier(value.scenarioId) ||
    !isPositiveInteger(value.scenarioVersion) ||
    !['passed', 'failed'].includes(value.status)
  ) invalid('v20_evaluation_record_invalid')
  parseObservation(value.observation)
  return value
}

function parseExecutorParity(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'groupId',
      'nativeScenarioId',
      'opencodeScenarioId',
      'eventContract',
      'cancellation',
      'evidence',
      'terminalResult',
      'cleanup',
    ]) ||
    !isIdentifier(value.groupId) ||
    !isIdentifier(value.nativeScenarioId) ||
    !isIdentifier(value.opencodeScenarioId) ||
    !['eventContract', 'cancellation', 'evidence', 'terminalResult', 'cleanup'].every(
      (key) => typeof value[key] === 'boolean',
    )
  ) invalid('v20_evaluation_record_invalid')
  return value
}

export function parseV20EvaluationRecord(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'schemaVersion',
      'datasetId',
      'datasetVersion',
      'datasetSha256',
      'runtimeContractVersion',
      'codingExecutorContractVersion',
      'nativeToolContractVersion',
      'candidateSha',
      'recordedAt',
      'scenarioResults',
      'executorParity',
      'scans',
      'paidProviderCalls',
      'status',
    ]) ||
    value.schemaVersion !== 1 ||
    !isIdentifier(value.datasetId) ||
    !isPositiveInteger(value.datasetVersion) ||
    !sha256Pattern.test(String(value.datasetSha256)) ||
    !isPositiveInteger(value.runtimeContractVersion) ||
    !isPositiveInteger(value.codingExecutorContractVersion) ||
    !isPositiveInteger(value.nativeToolContractVersion) ||
    !sha1Pattern.test(String(value.candidateSha)) ||
    !isCanonicalIso(value.recordedAt) ||
    !Array.isArray(value.scenarioResults) ||
    !Array.isArray(value.executorParity) ||
    !isRecord(value.scans) ||
    !hasExactKeys(value.scans, [
      'secretLeaks',
      'absolutePathLeaks',
      'sourceLeaks',
      'rawOutputLeaks',
      'isolationViolations',
    ]) ||
    !Object.values(value.scans).every(isNonNegativeInteger) ||
    !isNonNegativeInteger(value.paidProviderCalls) ||
    !['passed', 'failed'].includes(value.status)
  ) invalid('v20_evaluation_record_invalid')

  value.scenarioResults.forEach(parseScenarioResult)
  value.executorParity.forEach(parseExecutorParity)
  if (
    new Set(value.scenarioResults.map((result) => result.scenarioId)).size !== value.scenarioResults.length ||
    new Set(value.executorParity.map((parity) => parity.groupId)).size !== value.executorParity.length
  ) invalid('v20_evaluation_record_invalid')
  return value
}

function observationFailures(scenario, observation) {
  const failures = []
  if (observation.stopReason !== scenario.expected.stopReason) failures.push('stop_reason')
  if (observation.steps > scenario.expected.maxSteps) failures.push('step_bound')
  if (scenario.expected.requiredEventTypes.some((type) => !observation.eventTypes.includes(type))) {
    failures.push('event_contract')
  }
  if (scenario.expected.evidenceKinds.some((kind) => !observation.evidenceKinds.includes(kind))) {
    failures.push('evidence_contract')
  }
  if (observation.cleanupStatus !== scenario.expected.cleanupStatus) failures.push('cleanup')
  if (!observation.metrics.qualityPassed) failures.push('quality')
  if (!observation.metrics.recoverySucceeded) failures.push('recovery')
  if (observation.metrics.isolationViolations !== 0) failures.push('isolation')
  return failures
}

export function evaluateV20CompletionRecord(input) {
  const dataset = parseV20EvaluationDataset(input.dataset)
  const record = parseV20EvaluationRecord(input.record)
  const failures = []
  const add = (failure) => {
    if (!failures.includes(failure)) failures.push(failure)
  }

  if (record.candidateSha !== input.expectedCandidateSha) add('wrong_candidate')
  if (record.datasetSha256 !== input.expectedDatasetSha256) add('wrong_dataset')
  if (record.datasetId !== dataset.datasetId || record.datasetVersion !== dataset.datasetVersion) {
    add('wrong_dataset')
  }
  if (
    record.runtimeContractVersion !== dataset.runtimeContractVersion ||
    record.codingExecutorContractVersion !== dataset.codingExecutorContractVersion ||
    record.nativeToolContractVersion !== dataset.nativeToolContractVersion
  ) add('contract_version_mismatch')

  const expectedIds = new Set(dataset.scenarios.map((entry) => entry.scenario.id))
  const resultById = new Map(record.scenarioResults.map((result) => [result.scenarioId, result]))
  for (const entry of dataset.scenarios) {
    const result = resultById.get(entry.scenario.id)
    if (!result) {
      add('missing_scenario')
      continue
    }
    if (result.scenarioVersion !== entry.scenario.version) add('scenario_version_mismatch')
    if (result.status !== 'passed') add('failed_scenario')
    if (observationFailures(entry.scenario, result.observation).length > 0) add('failed_scenario')
  }
  if (record.scenarioResults.some((result) => !expectedIds.has(result.scenarioId))) {
    add('unexpected_scenario')
  }

  const parity = record.executorParity.find((entry) => entry.groupId === 'governed-coding-repair')
  if (
    !parity ||
    parity.nativeScenarioId !== 'native-coding-repair' ||
    parity.opencodeScenarioId !== 'opencode-coding-contract' ||
    !parity.eventContract ||
    !parity.cancellation ||
    !parity.evidence ||
    !parity.terminalResult ||
    !parity.cleanup
  ) add('parity_gap')

  if (record.paidProviderCalls !== 0) add('paid_provider_call')
  if (record.scans.secretLeaks !== 0) add('secret_leak')
  if (record.scans.absolutePathLeaks !== 0) add('absolute_path_leak')
  if (record.scans.sourceLeaks !== 0) add('source_leak')
  if (record.scans.rawOutputLeaks !== 0) add('raw_output_leak')
  if (record.scans.isolationViolations !== 0) add('isolation_leak')
  if (record.status !== 'passed') add('record_not_passed')

  return { ready: failures.length === 0, failures }
}
