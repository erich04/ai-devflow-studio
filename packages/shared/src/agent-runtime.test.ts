import { describe, expect, it } from 'vitest'
import {
  AGENT_RUNTIME_CONTRACT_VERSION,
  AGENT_RUNTIME_MAX_STEPS,
  AGENT_RUNTIME_MAX_TOOL_CALLS,
  acceptAgentActionResult,
  accumulateAgentScenarioMetrics,
  cancelAgentRuntime,
  createAgentRuntime,
  evaluateAgentScenario,
  parseAgentEvaluationScenario,
  parseAgentRuntimeStartRequest,
  parseAgentRuntimeTransition,
  parseAgentScenarioObservation,
  recordAgentPermissionDecision,
  requestAgentAction,
  resumeAgentRuntime,
  type AgentRuntimeTransition,
  type AgentRuntimeStartRequest,
} from './agent-runtime'

const digestA = 'a'.repeat(64)
const digestB = 'b'.repeat(64)
const digestC = 'c'.repeat(64)

const authority = {
  runId: 'run-1',
  nodeId: 'node-1',
  runVersion: 7,
  policyVersion: 3,
}

const validRequest: AgentRuntimeStartRequest = {
  stateVersion: 1,
  id: 'agent-runtime-1',
  scope: {
    kind: 'team',
    organizationId: 'org-1',
    projectId: 'project-1',
    userId: 'user-1',
    sessionId: 'session-1',
    localProjectId: 'local-project-1',
  },
  authority,
  contextDigest: digestA,
  capabilitySetDigest: digestB,
  bounds: {
    maxSteps: 12,
    maxWallTimeMs: 10 * 60_000,
    maxToolCalls: 16,
    maxToolResultBytes: 64 * 1_024,
    maxTrajectoryMetadataBytes: 16 * 1_024,
    maxCheckpointBytes: 128 * 1_024,
    maxTokens: 50_000,
    maxCostUsd: 5,
  },
  requestedAt: '2026-08-12T20:30:00.000Z',
  deadline: '2026-08-12T20:40:00.000Z',
}

function beginRuntime(request: AgentRuntimeStartRequest = validRequest) {
  const created = createAgentRuntime(request)
  return resumeAgentRuntime({
    runtime: created.runtime,
    expectedCheckpointVersion: created.checkpoint.version,
    authority: request.authority,
    contextDigest: request.contextDigest,
    capabilitySetDigest: request.capabilitySetDigest,
    now: '2026-08-12T20:30:01.000Z',
  })
}

function expectJsonRoundTrip(transition: AgentRuntimeTransition) {
  expect(parseAgentRuntimeTransition(JSON.parse(JSON.stringify(transition)))).toEqual(transition)
}

describe('Agent Runtime request contract', () => {
  it('parses an exact canonical team-scoped request', () => {
    expect(parseAgentRuntimeStartRequest(validRequest)).toEqual(validRequest)
    expect(AGENT_RUNTIME_CONTRACT_VERSION).toBe(1)
  })

  it('parses an exact local-only scope without inventing Team authority', () => {
    const localRequest = {
      ...validRequest,
      scope: {
        kind: 'local',
        organizationId: null,
        projectId: null,
        userId: 'local-user',
        sessionId: 'local-session',
        localProjectId: 'local-project-1',
      },
    }

    expect(parseAgentRuntimeStartRequest(localRequest)).toEqual(localRequest)
  })

  it.each([
    ['extra top-level key', { ...validRequest, extra: true }],
    ['noncanonical timestamp', { ...validRequest, requestedAt: '2026-08-12T20:30:00Z' }],
    ['uppercase digest', { ...validRequest, contextDigest: digestA.toUpperCase() }],
    ['zero version', { ...validRequest, authority: { ...authority, runVersion: 0 } }],
    [
      'mixed local/team scope',
      { ...validRequest, scope: { ...validRequest.scope, kind: 'local', projectId: null } },
    ],
    [
      'deadline beyond wall bound',
      { ...validRequest, deadline: '2026-08-12T21:00:00.001Z' },
    ],
    [
      'step hard maximum',
      { ...validRequest, bounds: { ...validRequest.bounds, maxSteps: AGENT_RUNTIME_MAX_STEPS + 1 } },
    ],
    [
      'tool hard maximum',
      {
        ...validRequest,
        bounds: { ...validRequest.bounds, maxToolCalls: AGENT_RUNTIME_MAX_TOOL_CALLS + 1 },
      },
    ],
    ['zero cost bound', { ...validRequest, bounds: { ...validRequest.bounds, maxCostUsd: 0 } }],
  ])('rejects %s', (_label, value) => {
    expect(() => parseAgentRuntimeStartRequest(value)).toThrowError('invalid_agent_runtime_request')
  })
})

describe('Agent Runtime deterministic kernel', () => {
  it('creates a versioned initial checkpoint and observable start event', () => {
    const transition = createAgentRuntime(validRequest)

    expect(transition.runtime).toMatchObject({
      id: validRequest.id,
      status: 'checkpointed',
      stopReason: null,
      version: 1,
      checkpointVersion: 1,
      nextSequence: 4,
      counters: { steps: 0, toolCalls: 0, tokens: 0, costUsd: 0 },
    })
    expect(transition.events.map((event) => [event.sequence, event.type])).toEqual([
      [1, 'runtime_started'],
      [2, 'context_attached'],
      [3, 'checkpointed'],
    ])
    expect(transition.checkpoint).toMatchObject({
      stateVersion: 1,
      runtimeId: validRequest.id,
      version: 1,
      runtimeVersion: 1,
      nextSequence: 4,
    })
  })

  it('round-trips an exact transition and rejects corrupt persisted state', () => {
    const transition = createAgentRuntime(validRequest)
    const serialized = JSON.parse(JSON.stringify(transition)) as Record<string, unknown>

    expect(parseAgentRuntimeTransition(serialized)).toEqual(transition)

    for (const corrupt of [
      {
        ...serialized,
        events: transition.events.map((event, index) =>
          index === 1 ? { ...event, sequence: event.sequence + 1 } : event,
        ),
      },
      {
        ...serialized,
        events: transition.events.map((event, index) =>
          index === 0 ? { ...event, type: 'unknown_event' } : event,
        ),
      },
      {
        ...serialized,
        runtime: { ...transition.runtime, status: 'terminal', stopReason: 'unknown_reason' },
      },
      {
        ...serialized,
        checkpoint: { ...transition.checkpoint, contextDigest: digestC },
      },
      {
        ...serialized,
        runtime: {
          ...transition.runtime,
          bounds: { ...transition.runtime.bounds, maxTrajectoryMetadataBytes: 1 },
        },
        checkpoint: {
          ...transition.checkpoint,
          bounds: { ...transition.checkpoint.bounds, maxTrajectoryMetadataBytes: 1 },
        },
      },
      {
        ...serialized,
        runtime: {
          ...transition.runtime,
          bounds: { ...transition.runtime.bounds, maxCheckpointBytes: 1 },
        },
        checkpoint: {
          ...transition.checkpoint,
          bounds: { ...transition.checkpoint.bounds, maxCheckpointBytes: 1 },
        },
      },
    ]) {
      expect(() => parseAgentRuntimeTransition(corrupt)).toThrowError(
        'invalid_agent_runtime_transition',
      )
    }
  })

  it('resumes only the exact checkpoint and unchanged authority', () => {
    const created = createAgentRuntime(validRequest)
    const resumed = resumeAgentRuntime({
      runtime: created.runtime,
      expectedCheckpointVersion: 1,
      authority,
      contextDigest: digestA,
      capabilitySetDigest: digestB,
      now: '2026-08-12T20:30:01.000Z',
    })

    expect(resumed.runtime).toMatchObject({ status: 'running', version: 2, checkpointVersion: 2 })
    expect(resumed.events.map((event) => event.type)).toEqual(['runtime_resumed', 'checkpointed'])
    expectJsonRoundTrip(resumed)

    for (const mismatch of [
      { expectedCheckpointVersion: 0 },
      { authority: { ...authority, runVersion: 8 } },
      { contextDigest: digestC },
      { capabilitySetDigest: digestC },
    ]) {
      expect(() =>
        resumeAgentRuntime({
          runtime: created.runtime,
          expectedCheckpointVersion: 1,
          authority,
          contextDigest: digestA,
          capabilitySetDigest: digestB,
          now: '2026-08-12T20:30:01.000Z',
          ...mismatch,
        }),
      ).toThrowError('stale_agent_checkpoint')
    }
  })

  it('permits one action at a time and binds permission to the exact action', () => {
    const resumed = beginRuntime()
    const requested = requestAgentAction({
      runtime: resumed.runtime,
      expectedCheckpointVersion: resumed.checkpoint.version,
      now: '2026-08-12T20:30:02.000Z',
      action: {
        id: 'action-1',
        kind: 'tool',
        capabilityId: 'workspace.read',
        capabilityVersion: 1,
        requestDigest: digestC,
        requiresPermission: true,
      },
    })

    expect(requested.runtime).toMatchObject({
      status: 'waiting_permission',
      counters: { steps: 1, toolCalls: 1, tokens: 0, costUsd: 0 },
      activeAction: { id: 'action-1', requestDigest: digestC },
    })
    expect(requested.events.map((event) => event.type)).toEqual([
      'decision_recorded',
      'action_requested',
      'checkpointed',
    ])
    expectJsonRoundTrip(requested)

    expect(() =>
      requestAgentAction({
        runtime: requested.runtime,
        expectedCheckpointVersion: requested.checkpoint.version,
        now: '2026-08-12T20:30:03.000Z',
        action: {
          id: 'action-2',
          kind: 'tool',
          capabilityId: 'workspace.read',
          capabilityVersion: 1,
          requestDigest: digestA,
          requiresPermission: false,
        },
      }),
    ).toThrowError('agent_action_in_progress')

    const approved = recordAgentPermissionDecision({
      runtime: requested.runtime,
      expectedCheckpointVersion: requested.checkpoint.version,
      actionId: 'action-1',
      requestDigest: digestC,
      decision: 'approved_once',
      now: '2026-08-12T20:30:04.000Z',
    })

    expect(approved.runtime.status).toBe('waiting_action')
    expect(approved.events.map((event) => event.type)).toEqual([
      'permission_decided',
      'checkpointed',
    ])
    expectJsonRoundTrip(approved)

    expect(() =>
      recordAgentPermissionDecision({
        runtime: requested.runtime,
        expectedCheckpointVersion: requested.checkpoint.version,
        actionId: 'action-other',
        requestDigest: digestC,
        decision: 'approved_once',
        now: '2026-08-12T20:30:04.000Z',
      }),
    ).toThrowError('agent_action_mismatch')
  })

  it('stops at the deadline before an approved action can begin', () => {
    const resumed = beginRuntime()
    const requested = requestAgentAction({
      runtime: resumed.runtime,
      expectedCheckpointVersion: resumed.checkpoint.version,
      now: '2026-08-12T20:30:02.000Z',
      action: {
        id: 'action-1',
        kind: 'tool',
        capabilityId: 'workspace.read',
        capabilityVersion: 1,
        requestDigest: digestC,
        requiresPermission: true,
      },
    })

    const timedOut = recordAgentPermissionDecision({
      runtime: requested.runtime,
      expectedCheckpointVersion: requested.checkpoint.version,
      actionId: 'action-1',
      requestDigest: digestC,
      decision: 'approved_once',
      now: validRequest.deadline,
    })

    expect(timedOut.runtime).toMatchObject({ status: 'terminal', stopReason: 'timeout' })
    expect(timedOut.events.map((event) => event.type)).toEqual(['runtime_stopped'])
  })

  it('checkpoints a successful result and resumes without replaying the action', () => {
    const resumed = beginRuntime()
    const requested = requestAgentAction({
      runtime: resumed.runtime,
      expectedCheckpointVersion: resumed.checkpoint.version,
      now: '2026-08-12T20:30:02.000Z',
      action: {
        id: 'action-1',
        kind: 'coding_executor',
        capabilityId: 'coding.native',
        capabilityVersion: 1,
        requestDigest: digestC,
        requiresPermission: false,
      },
    })
    const accepted = acceptAgentActionResult({
      runtime: requested.runtime,
      expectedCheckpointVersion: requested.checkpoint.version,
      actionId: 'action-1',
      requestDigest: digestC,
      result: {
        outcome: 'success',
        resultDigest: digestA,
        resultBytes: 1_024,
        tokens: 400,
        costUsd: 0.01,
        evaluation: 'continue',
        evaluationSummary: 'Tests exposed one bounded follow-up.',
      },
      now: '2026-08-12T20:30:05.000Z',
    })

    expect(accepted.runtime).toMatchObject({
      status: 'checkpointed',
      stopReason: null,
      activeAction: null,
      counters: { steps: 1, toolCalls: 0, tokens: 400, costUsd: 0.01 },
      acceptedActionIds: ['action-1'],
      lastObservationDigest: digestA,
      lastResultDigest: digestA,
    })
    expect(accepted.events.map((event) => event.type)).toEqual([
      'action_result',
      'observation_recorded',
      'evaluation_recorded',
      'checkpointed',
    ])
    expectJsonRoundTrip(accepted)

    const continued = resumeAgentRuntime({
      runtime: accepted.runtime,
      expectedCheckpointVersion: accepted.checkpoint.version,
      authority,
      contextDigest: digestA,
      capabilitySetDigest: digestB,
      now: '2026-08-12T20:30:06.000Z',
    })
    expect(continued.runtime.activeAction).toBeNull()
    expect(continued.runtime.counters.steps).toBe(1)
    expect(continued.checkpoint).toMatchObject({
      scope: validRequest.scope,
      bounds: validRequest.bounds,
      acceptedActionIds: ['action-1'],
      lastObservationDigest: digestA,
      lastResultDigest: digestA,
    })
    expect(() =>
      requestAgentAction({
        runtime: continued.runtime,
        expectedCheckpointVersion: continued.checkpoint.version,
        now: '2026-08-12T20:30:07.000Z',
        action: {
          id: 'action-1',
          kind: 'coding_executor',
          capabilityId: 'coding.native',
          capabilityVersion: 1,
          requestDigest: digestC,
          requiresPermission: false,
        },
      }),
    ).toThrowError('agent_action_replay')
  })

  it.each([
    ['success', 'success'],
    ['failure', 'failure'],
  ] as const)('records the %s terminal evaluation without changing Workflow authority', (_label, evaluation) => {
    const resumed = beginRuntime()
    const requested = requestAgentAction({
      runtime: resumed.runtime,
      expectedCheckpointVersion: resumed.checkpoint.version,
      now: '2026-08-12T20:30:02.000Z',
      action: {
        id: 'action-1',
        kind: 'tool',
        capabilityId: 'workspace.read',
        capabilityVersion: 1,
        requestDigest: digestC,
        requiresPermission: false,
      },
    })
    const terminal = acceptAgentActionResult({
      runtime: requested.runtime,
      expectedCheckpointVersion: requested.checkpoint.version,
      actionId: 'action-1',
      requestDigest: digestC,
      result: {
        outcome: evaluation === 'success' ? 'success' : 'failure',
        resultDigest: digestA,
        resultBytes: 128,
        tokens: 0,
        costUsd: 0,
        evaluation,
        evaluationSummary: evaluation === 'success' ? 'Scenario satisfied.' : 'Scenario failed.',
      },
      now: '2026-08-12T20:30:03.000Z',
    })

    expect(terminal.runtime).toMatchObject({ status: 'terminal', stopReason: evaluation })
    expect(terminal.runtime.authority).toEqual(authority)
    expect(terminal.events.at(-1)?.type).toBe('runtime_stopped')
    expectJsonRoundTrip(terminal)
    expect(() =>
      resumeAgentRuntime({
        runtime: terminal.runtime,
        expectedCheckpointVersion: terminal.checkpoint.version,
        authority,
        contextDigest: digestA,
        capabilitySetDigest: digestB,
        now: '2026-08-12T20:30:04.000Z',
      }),
    ).toThrowError('terminal_agent_runtime')
  })

  it('stops before another action at the exact deadline or step/tool bound', () => {
    const exactDeadline = {
      ...validRequest,
      bounds: { ...validRequest.bounds, maxSteps: 1, maxToolCalls: 1 },
    }
    const created = createAgentRuntime(exactDeadline)
    const timedOut = resumeAgentRuntime({
      runtime: created.runtime,
      expectedCheckpointVersion: created.checkpoint.version,
      authority,
      contextDigest: digestA,
      capabilitySetDigest: digestB,
      now: exactDeadline.deadline,
    })
    expect(timedOut.runtime).toMatchObject({ status: 'terminal', stopReason: 'timeout' })

    const resumed = beginRuntime(exactDeadline)
    const requested = requestAgentAction({
      runtime: resumed.runtime,
      expectedCheckpointVersion: resumed.checkpoint.version,
      now: '2026-08-12T20:30:02.000Z',
      action: {
        id: 'action-1',
        kind: 'tool',
        capabilityId: 'workspace.read',
        capabilityVersion: 1,
        requestDigest: digestC,
        requiresPermission: false,
      },
    })
    const limited = acceptAgentActionResult({
      runtime: requested.runtime,
      expectedCheckpointVersion: requested.checkpoint.version,
      actionId: 'action-1',
      requestDigest: digestC,
      result: {
        outcome: 'success',
        resultDigest: digestA,
        resultBytes: 20,
        tokens: 0,
        costUsd: 0,
        evaluation: 'continue',
        evaluationSummary: 'Another action would be needed.',
      },
      now: '2026-08-12T20:30:03.000Z',
    })
    expect(limited.runtime).toMatchObject({ status: 'terminal', stopReason: 'step_limit' })
  })

  it('accepts the result but stops when observed usage exhausts the budget', () => {
    const request = {
      ...validRequest,
      bounds: { ...validRequest.bounds, maxTokens: 10, maxCostUsd: 0.01 },
    }
    const resumed = beginRuntime(request)
    const requested = requestAgentAction({
      runtime: resumed.runtime,
      expectedCheckpointVersion: resumed.checkpoint.version,
      now: '2026-08-12T20:30:02.000Z',
      action: {
        id: 'action-1',
        kind: 'coding_executor',
        capabilityId: 'coding.native',
        capabilityVersion: 1,
        requestDigest: digestC,
        requiresPermission: false,
      },
    })
    const exhausted = acceptAgentActionResult({
      runtime: requested.runtime,
      expectedCheckpointVersion: requested.checkpoint.version,
      actionId: 'action-1',
      requestDigest: digestC,
      result: {
        outcome: 'success',
        resultDigest: digestA,
        resultBytes: 64,
        tokens: 11,
        costUsd: 0.011,
        evaluation: 'continue',
        evaluationSummary: 'Usage crossed the exact approved budget.',
      },
      now: '2026-08-12T20:30:03.000Z',
    })

    expect(exhausted.runtime).toMatchObject({
      status: 'terminal',
      stopReason: 'budget_exhausted',
      counters: { steps: 1, toolCalls: 0, tokens: 11, costUsd: 0.011 },
    })
  })

  it('stops at an exact consumed budget before another action', () => {
    const request = {
      ...validRequest,
      bounds: { ...validRequest.bounds, maxTokens: 10, maxCostUsd: 0.01 },
    }
    const resumed = beginRuntime(request)
    const requested = requestAgentAction({
      runtime: resumed.runtime,
      expectedCheckpointVersion: resumed.checkpoint.version,
      now: '2026-08-12T20:30:02.000Z',
      action: {
        id: 'action-1',
        kind: 'coding_executor',
        capabilityId: 'coding.native',
        capabilityVersion: 1,
        requestDigest: digestC,
        requiresPermission: false,
      },
    })
    const exhausted = acceptAgentActionResult({
      runtime: requested.runtime,
      expectedCheckpointVersion: requested.checkpoint.version,
      actionId: 'action-1',
      requestDigest: digestC,
      result: {
        outcome: 'success',
        resultDigest: digestA,
        resultBytes: 64,
        tokens: 10,
        costUsd: 0.01,
        evaluation: 'continue',
        evaluationSummary: 'The exact budget has been consumed.',
      },
      now: '2026-08-12T20:30:03.000Z',
    })

    expect(exhausted.runtime).toMatchObject({ status: 'terminal', stopReason: 'budget_exhausted' })
  })

  it('redacts secrets and absolute paths before persisting an evaluation event', () => {
    const resumed = beginRuntime()
    const requested = requestAgentAction({
      runtime: resumed.runtime,
      expectedCheckpointVersion: resumed.checkpoint.version,
      now: '2026-08-12T20:30:02.000Z',
      action: {
        id: 'action-1',
        kind: 'tool',
        capabilityId: 'workspace.read',
        capabilityVersion: 1,
        requestDigest: digestC,
        requiresPermission: false,
      },
    })
    const accepted = acceptAgentActionResult({
      runtime: requested.runtime,
      expectedCheckpointVersion: requested.checkpoint.version,
      actionId: 'action-1',
      requestDigest: digestC,
      result: {
        outcome: 'success',
        resultDigest: digestA,
        resultBytes: 64,
        tokens: 0,
        costUsd: 0,
        evaluation: 'continue',
        evaluationSummary: 'Read /Users/alice/private.txt with TOKEN=super-secret-value.',
      },
      now: '2026-08-12T20:30:03.000Z',
    })

    const serialized = JSON.stringify(accepted.events)
    expect(serialized).toContain('[REDACTED:local_absolute_path]')
    expect(serialized).toContain('[REDACTED:env_secret_assignment]')
    expect(serialized).not.toContain('/Users/alice/private.txt')
    expect(serialized).not.toContain('super-secret-value')
  })

  it('fails closed on an oversized result without persisting the result metadata', () => {
    const resumed = beginRuntime()
    const requested = requestAgentAction({
      runtime: resumed.runtime,
      expectedCheckpointVersion: resumed.checkpoint.version,
      now: '2026-08-12T20:30:02.000Z',
      action: {
        id: 'action-1',
        kind: 'tool',
        capabilityId: 'workspace.read',
        capabilityVersion: 1,
        requestDigest: digestC,
        requiresPermission: false,
      },
    })
    const failed = acceptAgentActionResult({
      runtime: requested.runtime,
      expectedCheckpointVersion: requested.checkpoint.version,
      actionId: 'action-1',
      requestDigest: digestC,
      result: {
        outcome: 'success',
        resultDigest: digestA,
        resultBytes: validRequest.bounds.maxToolResultBytes + 1,
        tokens: 0,
        costUsd: 0,
        evaluation: 'success',
        evaluationSummary: 'This summary must not be accepted.',
      },
      now: '2026-08-12T20:30:03.000Z',
    })

    expect(failed.runtime).toMatchObject({ status: 'terminal', stopReason: 'failure' })
    expect(failed.events.at(-1)).toMatchObject({
      type: 'runtime_stopped',
      metadata: { failureCode: 'result_too_large' },
    })
    expect(JSON.stringify(failed.events)).not.toContain('This summary must not be accepted.')
  })

  it('cancels monotonically and fences all later work', () => {
    const resumed = beginRuntime()
    const cancelled = cancelAgentRuntime({
      runtime: resumed.runtime,
      expectedCheckpointVersion: resumed.checkpoint.version,
      now: '2026-08-12T20:30:02.000Z',
    })

    expect(cancelled.runtime).toMatchObject({ status: 'terminal', stopReason: 'cancelled' })
    expect(cancelled.events.at(-1)?.type).toBe('runtime_stopped')
    expect(() =>
      cancelAgentRuntime({
        runtime: cancelled.runtime,
        expectedCheckpointVersion: cancelled.checkpoint.version,
        now: '2026-08-12T20:30:03.000Z',
      }),
    ).toThrowError('terminal_agent_runtime')

    expect(() =>
      acceptAgentActionResult({
        runtime: cancelled.runtime,
        expectedCheckpointVersion: cancelled.checkpoint.version,
        actionId: 'action-1',
        requestDigest: digestC,
        result: {
          outcome: 'success',
          resultDigest: digestA,
          resultBytes: 0,
          tokens: 0,
          costUsd: 0,
          evaluation: 'success',
          evaluationSummary: 'This late result must never commit.',
        },
        now: '2026-08-12T20:30:03.000Z',
      }),
    ).toThrowError('terminal_agent_runtime')
  })

  it('rejects stale checkpoint ownership on every mutation', () => {
    const resumed = beginRuntime()
    expect(() =>
      requestAgentAction({
        runtime: resumed.runtime,
        expectedCheckpointVersion: resumed.checkpoint.version - 1,
        now: '2026-08-12T20:30:02.000Z',
        action: {
          id: 'action-1',
          kind: 'tool',
          capabilityId: 'workspace.read',
          capabilityVersion: 1,
          requestDigest: digestC,
          requiresPermission: false,
        },
      }),
    ).toThrowError('stale_agent_checkpoint')
  })
})

describe('Agent evaluation scenarios', () => {
  const scenario = {
    stateVersion: 1,
    id: 'scenario-native-read-1',
    version: 1,
    name: 'Native read succeeds within bounds',
    objective: 'Read one bounded file and cite its digest.',
    executorKind: 'native',
    expected: {
      stopReason: 'success',
      maxSteps: 2,
      requiredEventTypes: [
        'runtime_started',
        'context_attached',
        'decision_recorded',
        'action_requested',
        'action_result',
        'observation_recorded',
        'runtime_stopped',
      ],
      evidenceKinds: ['agent_trajectory'],
      cleanupStatus: 'not_required',
    },
    metricDimensions: [
      'quality',
      'cost',
      'latency',
      'human_intervention',
      'recovery',
      'isolation',
    ],
  }

  it('parses an exact versioned scenario and rejects unknown fields', () => {
    expect(parseAgentEvaluationScenario(scenario)).toEqual(scenario)
    expect(() => parseAgentEvaluationScenario({ ...scenario, surprise: true })).toThrowError(
      'invalid_agent_evaluation_scenario',
    )
  })

  it('evaluates every required outcome and metric dimension', () => {
    const passingObservation = {
      stopReason: 'success' as const,
      steps: 1,
      eventTypes: [
        'runtime_started' as const,
        'context_attached' as const,
        'checkpointed' as const,
        'runtime_resumed' as const,
        'decision_recorded' as const,
        'action_requested' as const,
        'action_result' as const,
        'observation_recorded' as const,
        'evaluation_recorded' as const,
        'runtime_stopped' as const,
      ],
      evidenceKinds: ['agent_trajectory'],
      cleanupStatus: 'not_required' as const,
      metrics: {
        qualityPassed: true,
        costUsd: 0,
        latencyMs: 12,
        humanInterventions: 0,
        recoverySucceeded: true,
        isolationViolations: 0,
      },
    }
    const result = evaluateAgentScenario({
      scenario: parseAgentEvaluationScenario(scenario),
      observed: passingObservation,
    })

    expect(result).toEqual({ passed: true, failures: [] })

    expect(
      evaluateAgentScenario({
        scenario: parseAgentEvaluationScenario(scenario),
        observed: {
          stopReason: 'failure',
          steps: 3,
          eventTypes: ['runtime_started'],
          evidenceKinds: [],
          cleanupStatus: 'failed',
          metrics: {
            qualityPassed: false,
            costUsd: 1,
            latencyMs: 100,
            humanInterventions: 2,
            recoverySucceeded: false,
            isolationViolations: 1,
          },
        },
      }).failures,
    ).toEqual([
      'unexpected_stop_reason',
      'step_bound_exceeded',
      'missing_event:context_attached',
      'missing_event:decision_recorded',
      'missing_event:action_requested',
      'missing_event:action_result',
      'missing_event:observation_recorded',
      'missing_event:runtime_stopped',
      'missing_evidence:agent_trajectory',
      'unexpected_cleanup_status',
      'quality_failed',
      'recovery_failed',
      'isolation_violation',
    ])

    expect(parseAgentScenarioObservation(passingObservation)).toEqual(passingObservation)
    expect(() =>
      parseAgentScenarioObservation({
        ...passingObservation,
        metrics: { ...passingObservation.metrics, latencyMs: Number.NaN },
      }),
    ).toThrowError('invalid_agent_scenario_observation')

    expect(accumulateAgentScenarioMetrics([passingObservation, passingObservation])).toEqual({
      scenarioCount: 2,
      qualityPassCount: 2,
      totalCostUsd: 0,
      totalLatencyMs: 24,
      totalHumanInterventions: 0,
      recoveryPassCount: 2,
      isolationViolations: 0,
    })
  })
})
