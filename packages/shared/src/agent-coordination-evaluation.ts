import {
  COORDINATION_CONTRACT_VERSION,
  COORDINATION_MAX_ACCEPTED_HANDOFFS,
  COORDINATION_MAX_DELEGATION_DEPTH,
  COORDINATION_MAX_DEPENDENCY_EDGES,
  COORDINATION_MAX_HANDOFF_SUMMARY_BYTES,
  COORDINATION_MAX_PARALLEL_SPECIALISTS,
  COORDINATION_MAX_SPECIALIST_RETRIES,
  COORDINATION_MAX_SPECIALISTS,
  COORDINATION_MAX_TASK_NODES,
} from './agent-coordination'

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u

type EvaluationScenario = {
  id: string
  version: number
  category: string
  selectedForQualityComparison: boolean
  expected: Record<string, unknown>
}

export type ParsedV22EvaluationDataset = {
  schemaVersion: 1
  datasetId: string
  datasetVersion: number
  coordinationContractVersion: 1
  executionTenancyContractVersion: 1
  defaultNoCost: true
  bounds: Record<string, number>
  metricThresholds: {
    minimumAggregateImprovementOverSingle: number
    maxCostMultiplierOverSingle: number
    maxLatencyMultiplierOverSingle: number
    maxAdditionalHumanInterventions: number
    maxIsolationViolations: number
    maxAuthorityViolations: number
    maxTerminationViolations: number
    maxReplayViolations: number
    maxRedactionViolations: number
    paidProviderCalls: 0
  }
  roles: Array<Record<string, unknown>>
  scenarios: EvaluationScenario[]
}

export type V22SingleAgentBaseline = {
  schemaVersion: 1
  datasetId: string
  datasetVersion: number
  baselineContract: 'v2.0-single-agent'
  selectedScenarios: Array<{
    scenarioId: string
    scenarioVersion: number
    quality: number
    humanInterventions: number
  }>
  aggregateQuality: number
  paidProviderCalls: 0
  status: 'passed'
}

export type V22MultiAgentCandidate = {
  schemaVersion: 1
  datasetId: string
  datasetVersion: number
  candidateContract: 'v2.2-bounded-multi-agent'
  selectedScenarios: Array<{
    scenarioId: string
    scenarioVersion: number
    singleQuality: number
    multiQuality: number
    singleCostUnits: number
    multiCostUnits: number
    singleLatencyUnits: number
    multiLatencyUnits: number
    humanInterventions: number
  }>
  aggregateSingleQuality: number
  aggregateMultiQuality: number
  aggregateImprovementOverSingle: number
  costMultiplierOverSingle: number
  latencyMultiplierOverSingle: number
  additionalHumanInterventions: number
  isolationViolations: number
  authorityViolations: number
  terminationViolations: number
  replayViolations: number
  redactionViolations: number
  paidProviderCalls: 0
  status: 'passed' | 'failed'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && identifierPattern.test(value)
}

function isPositiveVersion(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0 && Number(value) <= 2_147_483_647
}

function fail(): never {
  throw new Error('invalid_v22_evaluation_dataset')
}

function parseScenarios(value: unknown, acceptedRoleIds: ReadonlySet<string>): EvaluationScenario[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every(isRecord)) fail()
  const categories = new Set([
    'single_agent_baseline',
    'multi_agent_quality',
    'dependency_join',
    'cycle_rejection',
    'shared_budget',
    'cancellation',
    'tenant_isolation',
    'capability_attenuation',
    'failure_attribution',
    'restart_recovery',
  ])
  const expectedKeysByCategory: Record<string, readonly string[]> = {
    single_agent_baseline: [
      'singleQuality',
      'multiQuality',
      'singleCostUnits',
      'multiCostUnits',
      'singleLatencyUnits',
      'multiLatencyUnits',
      'stopReason',
      'humanInterventions',
      'isolationViolations',
      'authorityViolations',
      'terminationViolations',
      'replayViolations',
    ],
    multi_agent_quality: [
      'singleQuality',
      'multiQuality',
      'singleCostUnits',
      'multiCostUnits',
      'singleLatencyUnits',
      'multiLatencyUnits',
      'stopReason',
      'humanInterventions',
      'isolationViolations',
      'authorityViolations',
      'terminationViolations',
      'replayViolations',
      'redactionViolations',
    ],
    dependency_join: ['acceptedHandoffs', 'joinCount', 'stopReason', 'replayViolations'],
    cycle_rejection: ['rejectionCode', 'specialistStarts', 'sideEffects'],
    shared_budget: ['stopReason', 'actionsAfterBoundary', 'authorityViolations'],
    cancellation: [
      'stopReason',
      'terminalSpecialists',
      'lateCommits',
      'terminationViolations',
    ],
    tenant_isolation: ['rejectionCode', 'providerCalls', 'toolCalls', 'isolationViolations'],
    capability_attenuation: [
      'rejectionCode',
      'writerLeases',
      'toolCalls',
      'authorityViolations',
    ],
    failure_attribution: [
      'failedTaskId',
      'blockedTaskId',
      'stopReason',
      'silentReassignments',
    ],
    restart_recovery: [
      'specialistRestartDuplicateEffects',
      'handoffRestartDuplicateEffects',
      'writerRestartDuplicateEffects',
      'replayViolations',
      'stopReason',
    ],
  }
  const scenarios = value as Array<Record<string, unknown>>
  const scenarioIds = scenarios.map((scenario) => scenario.id)
  if (
    scenarios.some((scenario) => !hasExactKeys(scenario, [
      'id',
      'version',
      'category',
      'selectedForQualityComparison',
      'scope',
      'graph',
      'expected',
    ])) ||
    scenarioIds.some((id) => !isIdentifier(id)) ||
    new Set(scenarioIds).size !== scenarioIds.length
  ) fail()

  for (const scenario of scenarios) {
    const category = String(scenario.category)
    const expectedKeys = expectedKeysByCategory[category]
    if (
      !isPositiveVersion(scenario.version) ||
      !categories.has(category) ||
      typeof scenario.selectedForQualityComparison !== 'boolean' ||
      !isRecord(scenario.scope) ||
      !hasExactKeys(scenario.scope, [
        'organizationId',
        'projectId',
        'userId',
        'sessionId',
        'localProjectId',
        'runId',
        'nodeId',
      ]) ||
      Object.values(scenario.scope).some((entry) => !isIdentifier(entry)) ||
      !isRecord(scenario.graph) ||
      !hasExactKeys(scenario.graph, ['tasks', 'edges']) ||
      !Array.isArray(scenario.graph.tasks) ||
      scenario.graph.tasks.length === 0 ||
      scenario.graph.tasks.length > COORDINATION_MAX_TASK_NODES ||
      !scenario.graph.tasks.every(isRecord) ||
      !Array.isArray(scenario.graph.edges) ||
      scenario.graph.edges.length > COORDINATION_MAX_DEPENDENCY_EDGES ||
      !scenario.graph.edges.every((edge) => typeof edge === 'string') ||
      !isRecord(scenario.expected) ||
      expectedKeys === undefined ||
      !hasExactKeys(scenario.expected, expectedKeys) ||
      Object.values(scenario.expected).some((entry) =>
        typeof entry === 'number'
          ? !Number.isFinite(entry) || entry < 0
          : !isIdentifier(entry))
    ) fail()
    const tasks = scenario.graph.tasks as Array<Record<string, unknown>>
    const taskIds = tasks.map((task) => task.id)
    if (
      tasks.some((task) => !hasExactKeys(task, ['id', 'roleId', 'dependsOn'])) ||
      taskIds.some((id) => !isIdentifier(id)) ||
      new Set(taskIds).size !== taskIds.length ||
      tasks.some((task) =>
        !isIdentifier(task.roleId) ||
        !acceptedRoleIds.has(task.roleId) ||
        !Array.isArray(task.dependsOn) ||
        task.dependsOn.some((dependency) => !isIdentifier(dependency)) ||
        new Set(task.dependsOn).size !== task.dependsOn.length ||
        task.dependsOn.some((dependency) => !taskIds.includes(dependency)))
    ) fail()
    const expectedEdges = tasks.flatMap((task) =>
      (task.dependsOn as string[]).map((sourceTaskId) => `${sourceTaskId}->${String(task.id)}`),
    ).sort()
    const actualEdges = [...scenario.graph.edges].sort() as string[]
    if (
      new Set(actualEdges).size !== actualEdges.length ||
      actualEdges.length !== expectedEdges.length ||
      actualEdges.some((edge, index) => edge !== expectedEdges[index])
    ) fail()
    const inDegree = new Map((taskIds as string[]).map((taskId) => [taskId, 0]))
    const dependents = new Map((taskIds as string[]).map((taskId) => [taskId, [] as string[]]))
    for (const task of tasks) {
      for (const sourceTaskId of task.dependsOn as string[]) {
        inDegree.set(String(task.id), (inDegree.get(String(task.id)) ?? 0) + 1)
        dependents.get(sourceTaskId)?.push(String(task.id))
      }
    }
    const queue = (taskIds as string[]).filter((taskId) => inDegree.get(taskId) === 0)
    let visited = 0
    while (queue.length > 0) {
      const taskId = queue.shift()
      if (taskId === undefined) break
      visited += 1
      for (const dependentId of dependents.get(taskId) ?? []) {
        const next = (inDegree.get(dependentId) ?? 0) - 1
        inDegree.set(dependentId, next)
        if (next === 0) queue.push(dependentId)
      }
    }
    const hasCycle = visited !== tasks.length
    if ((category === 'cycle_rejection') !== hasCycle) fail()
    const scenarioExpected = scenario.expected as Record<string, unknown>
    if (scenario.selectedForQualityComparison) {
      if (
        typeof scenarioExpected.singleQuality !== 'number' ||
        !Number.isFinite(scenarioExpected.singleQuality) ||
        scenarioExpected.singleQuality < 0 ||
        scenarioExpected.singleQuality > 1 ||
        typeof scenarioExpected.multiQuality !== 'number' ||
        !Number.isFinite(scenarioExpected.multiQuality) ||
        scenarioExpected.multiQuality < 0 ||
        scenarioExpected.multiQuality > 1 ||
        !['singleCostUnits', 'multiCostUnits', 'singleLatencyUnits', 'multiLatencyUnits']
          .every((key) =>
            typeof scenarioExpected[key] === 'number' &&
            Number.isFinite(scenarioExpected[key]) &&
            Number(scenarioExpected[key]) > 0) ||
        !Number.isInteger(scenarioExpected.humanInterventions) ||
        Number(scenarioExpected.humanInterventions) < 0
      ) fail()
    }
  }
  return scenarios as unknown as EvaluationScenario[]
}

export function parseV22EvaluationDataset(value: unknown): ParsedV22EvaluationDataset {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'schemaVersion',
      'datasetId',
      'datasetVersion',
      'coordinationContractVersion',
      'executionTenancyContractVersion',
      'defaultNoCost',
      'bounds',
      'metricThresholds',
      'roles',
      'scenarios',
    ]) ||
    value.schemaVersion !== 1 ||
    value.datasetId !== 'v2.2-multi-agent-execution-tenancy' ||
    !isPositiveVersion(value.datasetVersion) ||
    value.coordinationContractVersion !== COORDINATION_CONTRACT_VERSION ||
    value.executionTenancyContractVersion !== 1 ||
    value.defaultNoCost !== true ||
    !isRecord(value.bounds) ||
    !hasExactKeys(value.bounds, [
      'maxSpecialists',
      'maxTaskNodes',
      'maxDependencyEdges',
      'maxDelegationDepth',
      'maxParallelSpecialists',
      'maxAcceptedHandoffs',
      'maxSpecialistRetries',
      'maxHandoffSummaryBytes',
    ]) ||
    value.bounds.maxSpecialists !== COORDINATION_MAX_SPECIALISTS ||
    value.bounds.maxTaskNodes !== COORDINATION_MAX_TASK_NODES ||
    value.bounds.maxDependencyEdges !== COORDINATION_MAX_DEPENDENCY_EDGES ||
    value.bounds.maxDelegationDepth !== COORDINATION_MAX_DELEGATION_DEPTH ||
    value.bounds.maxParallelSpecialists !== COORDINATION_MAX_PARALLEL_SPECIALISTS ||
    value.bounds.maxAcceptedHandoffs !== COORDINATION_MAX_ACCEPTED_HANDOFFS ||
    value.bounds.maxSpecialistRetries !== COORDINATION_MAX_SPECIALIST_RETRIES ||
    value.bounds.maxHandoffSummaryBytes !== COORDINATION_MAX_HANDOFF_SUMMARY_BYTES ||
    !isRecord(value.metricThresholds) ||
    !hasExactKeys(value.metricThresholds, [
      'minimumAggregateImprovementOverSingle',
      'maxCostMultiplierOverSingle',
      'maxLatencyMultiplierOverSingle',
      'maxAdditionalHumanInterventions',
      'maxIsolationViolations',
      'maxAuthorityViolations',
      'maxTerminationViolations',
      'maxReplayViolations',
      'maxRedactionViolations',
      'paidProviderCalls',
    ]) ||
    typeof value.metricThresholds.minimumAggregateImprovementOverSingle !== 'number' ||
    !Number.isFinite(value.metricThresholds.minimumAggregateImprovementOverSingle) ||
    value.metricThresholds.minimumAggregateImprovementOverSingle < 0 ||
    value.metricThresholds.minimumAggregateImprovementOverSingle > 1 ||
    typeof value.metricThresholds.maxCostMultiplierOverSingle !== 'number' ||
    !Number.isFinite(value.metricThresholds.maxCostMultiplierOverSingle) ||
    value.metricThresholds.maxCostMultiplierOverSingle < 1 ||
    typeof value.metricThresholds.maxLatencyMultiplierOverSingle !== 'number' ||
    !Number.isFinite(value.metricThresholds.maxLatencyMultiplierOverSingle) ||
    value.metricThresholds.maxLatencyMultiplierOverSingle < 1 ||
    !Number.isInteger(value.metricThresholds.maxAdditionalHumanInterventions) ||
    Number(value.metricThresholds.maxAdditionalHumanInterventions) < 0 ||
    !Number.isInteger(value.metricThresholds.maxIsolationViolations) ||
    Number(value.metricThresholds.maxIsolationViolations) < 0 ||
    !Number.isInteger(value.metricThresholds.maxAuthorityViolations) ||
    Number(value.metricThresholds.maxAuthorityViolations) < 0 ||
    !Number.isInteger(value.metricThresholds.maxTerminationViolations) ||
    Number(value.metricThresholds.maxTerminationViolations) < 0 ||
    !Number.isInteger(value.metricThresholds.maxReplayViolations) ||
    Number(value.metricThresholds.maxReplayViolations) < 0 ||
    !Number.isInteger(value.metricThresholds.maxRedactionViolations) ||
    Number(value.metricThresholds.maxRedactionViolations) < 0 ||
    value.metricThresholds.paidProviderCalls !== 0 ||
    !Array.isArray(value.roles) ||
    value.roles.length === 0 ||
    !value.roles.every(isRecord)
  ) fail()

  const roles = value.roles as Array<Record<string, unknown>>
  const roleIds = roles.map((role) => role.id)
  if (
    roles.some((role) =>
      !hasExactKeys(role, ['id', 'version', 'capabilities', 'resourceMode']) ||
      !isIdentifier(role.id) ||
      !isPositiveVersion(role.version) ||
      !Array.isArray(role.capabilities) ||
      role.capabilities.length === 0 ||
      role.capabilities.some((capability) => !isIdentifier(capability)) ||
      new Set(role.capabilities).size !== role.capabilities.length ||
      (role.resourceMode !== 'read' && role.resourceMode !== 'write')) ||
    new Set(roleIds).size !== roleIds.length
  ) fail()

  const scenarios = parseScenarios(value.scenarios, new Set(roleIds as string[]))
  if (!scenarios.some((scenario) =>
    scenario.id === 'single-agent-cross-file-baseline' &&
    scenario.selectedForQualityComparison)) fail()
  return { ...value, scenarios } as unknown as ParsedV22EvaluationDataset
}

export function evaluateV22SingleAgentBaseline(value: unknown): V22SingleAgentBaseline {
  const dataset = parseV22EvaluationDataset(value)
  const scenarios = dataset.scenarios
  const selectedScenarios = scenarios
    .filter((scenario) => scenario.selectedForQualityComparison)
    .map((scenario) => ({
      scenarioId: scenario.id,
      scenarioVersion: scenario.version,
      quality: scenario.expected.singleQuality as number,
      humanInterventions: scenario.expected.humanInterventions as number,
    }))
    .sort((left, right) => left.scenarioId.localeCompare(right.scenarioId))
  if (
    selectedScenarios.length === 0
  ) fail()
  const aggregateQuality = selectedScenarios.reduce(
    (total, scenario) => total + scenario.quality,
    0,
  ) / selectedScenarios.length
  return {
    schemaVersion: 1,
    datasetId: dataset.datasetId,
    datasetVersion: dataset.datasetVersion,
    baselineContract: 'v2.0-single-agent',
    selectedScenarios,
    aggregateQuality,
    paidProviderCalls: 0,
    status: 'passed',
  }
}

function average(values: number[]): number {
  if (values.length === 0) fail()
  return values.reduce((total, value) => total + value, 0) / values.length
}

function sumExpectedCount(
  scenarios: EvaluationScenario[],
  key: string,
): number {
  return scenarios.reduce((total, scenario) => {
    const value = scenario.expected[key]
    return total + (typeof value === 'number' && Number.isSafeInteger(value) ? value : 0)
  }, 0)
}

export function evaluateV22MultiAgentCandidate(value: unknown): V22MultiAgentCandidate {
  const dataset = parseV22EvaluationDataset(value)
  const selectedScenarios = dataset.scenarios
    .filter((scenario) => scenario.selectedForQualityComparison)
    .map((scenario) => ({
      scenarioId: scenario.id,
      scenarioVersion: scenario.version,
      singleQuality: Number(scenario.expected.singleQuality),
      multiQuality: Number(scenario.expected.multiQuality),
      singleCostUnits: Number(scenario.expected.singleCostUnits),
      multiCostUnits: Number(scenario.expected.multiCostUnits),
      singleLatencyUnits: Number(scenario.expected.singleLatencyUnits),
      multiLatencyUnits: Number(scenario.expected.multiLatencyUnits),
      humanInterventions: Number(scenario.expected.humanInterventions),
    }))
    .sort((left, right) => left.scenarioId.localeCompare(right.scenarioId))
  const aggregateSingleQuality = average(
    selectedScenarios.map((scenario) => scenario.singleQuality),
  )
  const aggregateMultiQuality = average(
    selectedScenarios.map((scenario) => scenario.multiQuality),
  )
  const aggregateImprovementOverSingle = aggregateMultiQuality - aggregateSingleQuality
  const costMultiplierOverSingle = average(
    selectedScenarios.map((scenario) => scenario.multiCostUnits),
  ) / average(selectedScenarios.map((scenario) => scenario.singleCostUnits))
  const latencyMultiplierOverSingle = average(
    selectedScenarios.map((scenario) => scenario.multiLatencyUnits),
  ) / average(selectedScenarios.map((scenario) => scenario.singleLatencyUnits))
  const additionalHumanInterventions = selectedScenarios.reduce(
    (total, scenario) => total + scenario.humanInterventions,
    0,
  )
  const isolationViolations = sumExpectedCount(dataset.scenarios, 'isolationViolations')
  const authorityViolations = sumExpectedCount(dataset.scenarios, 'authorityViolations')
  const terminationViolations = sumExpectedCount(dataset.scenarios, 'terminationViolations')
  const replayViolations = sumExpectedCount(dataset.scenarios, 'replayViolations')
  const redactionViolations = sumExpectedCount(dataset.scenarios, 'redactionViolations')
  const thresholds = dataset.metricThresholds
  const status = aggregateImprovementOverSingle >=
      thresholds.minimumAggregateImprovementOverSingle &&
    costMultiplierOverSingle <= thresholds.maxCostMultiplierOverSingle &&
    latencyMultiplierOverSingle <= thresholds.maxLatencyMultiplierOverSingle &&
    additionalHumanInterventions <= thresholds.maxAdditionalHumanInterventions &&
    isolationViolations <= thresholds.maxIsolationViolations &&
    authorityViolations <= thresholds.maxAuthorityViolations &&
    terminationViolations <= thresholds.maxTerminationViolations &&
    replayViolations <= thresholds.maxReplayViolations &&
    redactionViolations <= thresholds.maxRedactionViolations
    ? 'passed'
    : 'failed'
  return {
    schemaVersion: 1,
    datasetId: dataset.datasetId,
    datasetVersion: dataset.datasetVersion,
    candidateContract: 'v2.2-bounded-multi-agent',
    selectedScenarios,
    aggregateSingleQuality,
    aggregateMultiQuality,
    aggregateImprovementOverSingle,
    costMultiplierOverSingle,
    latencyMultiplierOverSingle,
    additionalHumanInterventions,
    isolationViolations,
    authorityViolations,
    terminationViolations,
    replayViolations,
    redactionViolations,
    paidProviderCalls: 0,
    status,
  }
}
