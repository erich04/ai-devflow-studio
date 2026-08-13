import { describe, expect, it } from 'vitest'
import {
  COORDINATION_CONTRACT_VERSION,
  parseCoordinationSessionRequest,
  type CoordinationSessionRequest,
} from './agent-coordination'

const digestA = 'a'.repeat(64)
const digestB = 'b'.repeat(64)

const request: CoordinationSessionRequest = {
  stateVersion: 1,
  id: 'coordination-1',
  scope: {
    organizationId: 'org-1',
    projectId: 'project-1',
    userId: 'user-1',
    sessionId: 'session-1',
    localProjectId: 'local-project-1',
  },
  authority: {
    runId: 'run-1',
    nodeId: 'node-1',
    runVersion: 7,
    policyVersion: 3,
    supervisorRuntimeId: 'agent-runtime-1',
    supervisorRuntimeVersion: 5,
  },
  contextDigest: digestA,
  capabilitySetDigest: digestB,
  bounds: {
    maxSpecialists: 4,
    maxTaskNodes: 12,
    maxDependencyEdges: 24,
    maxDelegationDepth: 1,
    maxParallelSpecialists: 3,
    maxAcceptedHandoffs: 16,
    maxSpecialistRetries: 1,
    maxHandoffSummaryBytes: 16_384,
    maxSteps: 12,
    maxWallTimeMs: 600_000,
    maxToolCalls: 16,
    maxTokens: 50_000,
    maxCostUsd: 5,
  },
  requestedAt: '2026-08-13T15:00:00.000Z',
  deadline: '2026-08-13T15:10:00.000Z',
}

describe('Coordination Session request contract', () => {
  it('parses one exact canonical Team-scoped request within its Supervisor bounds', () => {
    expect(parseCoordinationSessionRequest(request, {
      maxSteps: 12,
      maxWallTimeMs: 600_000,
      maxToolCalls: 16,
      maxTokens: 50_000,
      maxCostUsd: 5,
    })).toEqual(request)
    expect(COORDINATION_CONTRACT_VERSION).toBe(1)
  })

  it('rejects an unknown request field instead of widening coordination authority', () => {
    expect(() => parseCoordinationSessionRequest({ ...request, unknown: true }, {
      maxSteps: 12,
      maxWallTimeMs: 600_000,
      maxToolCalls: 16,
      maxTokens: 50_000,
      maxCostUsd: 5,
    })).toThrowError('invalid_coordination_session_request')
  })

  it('rejects a noncanonical Coordination Session identity', () => {
    expect(() => parseCoordinationSessionRequest({ ...request, id: '../coordination-1' }, {
      maxSteps: 12,
      maxWallTimeMs: 600_000,
      maxToolCalls: 16,
      maxTokens: 50_000,
      maxCostUsd: 5,
    })).toThrowError('invalid_coordination_session_request')
  })

  it('rejects a mixed or incomplete execution-tenancy scope', () => {
    expect(() => parseCoordinationSessionRequest({
      ...request,
      scope: { ...request.scope, projectId: null },
    }, {
      maxSteps: 12,
      maxWallTimeMs: 600_000,
      maxToolCalls: 16,
      maxTokens: 50_000,
      maxCostUsd: 5,
    })).toThrowError('invalid_coordination_session_request')
  })

  it('rejects stale or nonpositive Supervisor authority versions', () => {
    expect(() => parseCoordinationSessionRequest({
      ...request,
      authority: { ...request.authority, supervisorRuntimeVersion: 0 },
    }, {
      maxSteps: 12,
      maxWallTimeMs: 600_000,
      maxToolCalls: 16,
      maxTokens: 50_000,
      maxCostUsd: 5,
    })).toThrowError('invalid_coordination_session_request')
  })

  it('rejects a noncanonical capability-set digest', () => {
    expect(() => parseCoordinationSessionRequest({
      ...request,
      capabilitySetDigest: digestB.toUpperCase(),
    }, {
      maxSteps: 12,
      maxWallTimeMs: 600_000,
      maxToolCalls: 16,
      maxTokens: 50_000,
      maxCostUsd: 5,
    })).toThrowError('invalid_coordination_session_request')
  })

  it('rejects a noncanonical request timestamp', () => {
    expect(() => parseCoordinationSessionRequest({
      ...request,
      requestedAt: '2026-08-13T15:00:00Z',
    }, {
      maxSteps: 12,
      maxWallTimeMs: 600_000,
      maxToolCalls: 16,
      maxTokens: 50_000,
      maxCostUsd: 5,
    })).toThrowError('invalid_coordination_session_request')
  })

  it('rejects a shared step budget wider than the authoritative Supervisor budget', () => {
    expect(() => parseCoordinationSessionRequest({
      ...request,
      bounds: { ...request.bounds, maxSteps: 13 },
    }, {
      maxSteps: 12,
      maxWallTimeMs: 600_000,
      maxToolCalls: 16,
      maxTokens: 50_000,
      maxCostUsd: 5,
    })).toThrowError('invalid_coordination_session_request')
  })

  it('rejects a shared step budget above the V2.0 Runtime hard maximum', () => {
    expect(() => parseCoordinationSessionRequest({
      ...request,
      bounds: { ...request.bounds, maxSteps: 33 },
    }, {
      maxSteps: 33,
      maxWallTimeMs: 600_000,
      maxToolCalls: 16,
      maxTokens: 50_000,
      maxCostUsd: 5,
    })).toThrowError('invalid_coordination_session_request')
  })

  it.each([
    ['wall time', 'maxWallTimeMs', 1_800_001],
    ['Tool calls', 'maxToolCalls', 65],
    ['tokens', 'maxTokens', 10_000_001],
    ['cost', 'maxCostUsd', 1_000_000.01],
  ] as const)('rejects %s above the V2.0 Runtime hard maximum', (_label, key, value) => {
    expect(() => parseCoordinationSessionRequest({
      ...request,
      bounds: { ...request.bounds, [key]: value },
    }, {
      maxSteps: 12,
      maxWallTimeMs: key === 'maxWallTimeMs' ? value : 600_000,
      maxToolCalls: key === 'maxToolCalls' ? value : 16,
      maxTokens: key === 'maxTokens' ? value : 50_000,
      maxCostUsd: key === 'maxCostUsd' ? value : 5,
    })).toThrowError('invalid_coordination_session_request')
  })

  it('rejects more than four Specialist Agents', () => {
    expect(() => parseCoordinationSessionRequest({
      ...request,
      bounds: { ...request.bounds, maxSpecialists: 5 },
    }, {
      maxSteps: 12,
      maxWallTimeMs: 600_000,
      maxToolCalls: 16,
      maxTokens: 50_000,
      maxCostUsd: 5,
    })).toThrowError('invalid_coordination_session_request')
  })

  it('rejects an unknown shared-bound field', () => {
    expect(() => parseCoordinationSessionRequest({
      ...request,
      bounds: { ...request.bounds, maxHiddenWork: 1 },
    }, {
      maxSteps: 12,
      maxWallTimeMs: 600_000,
      maxToolCalls: 16,
      maxTokens: 50_000,
      maxCostUsd: 5,
    })).toThrowError('invalid_coordination_session_request')
  })

  it('rejects a deadline outside the shared wall-time bound', () => {
    expect(() => parseCoordinationSessionRequest({
      ...request,
      deadline: '2026-08-13T15:10:00.001Z',
    }, {
      maxSteps: 12,
      maxWallTimeMs: 600_000,
      maxToolCalls: 16,
      maxTokens: 50_000,
      maxCostUsd: 5,
    })).toThrowError('invalid_coordination_session_request')
  })

  it('rejects a Tool-call allocation wider than the Supervisor budget', () => {
    expect(() => parseCoordinationSessionRequest({
      ...request,
      bounds: { ...request.bounds, maxToolCalls: 17 },
    }, {
      maxSteps: 12,
      maxWallTimeMs: 600_000,
      maxToolCalls: 16,
      maxTokens: 50_000,
      maxCostUsd: 5,
    })).toThrowError('invalid_coordination_session_request')
  })

  it('rejects a cost allocation wider than the Supervisor budget', () => {
    expect(() => parseCoordinationSessionRequest({
      ...request,
      bounds: { ...request.bounds, maxCostUsd: 5.01 },
    }, {
      maxSteps: 12,
      maxWallTimeMs: 600_000,
      maxToolCalls: 16,
      maxTokens: 50_000,
      maxCostUsd: 5,
    })).toThrowError('invalid_coordination_session_request')
  })

  it('rejects a token allocation wider than the Supervisor budget', () => {
    expect(() => parseCoordinationSessionRequest({
      ...request,
      bounds: { ...request.bounds, maxTokens: 50_001 },
    }, {
      maxSteps: 12,
      maxWallTimeMs: 600_000,
      maxToolCalls: 16,
      maxTokens: 50_000,
      maxCostUsd: 5,
    })).toThrowError('invalid_coordination_session_request')
  })

  it.each([
    ['task nodes', 'maxTaskNodes', 13],
    ['dependency edges', 'maxDependencyEdges', 25],
    ['delegation depth', 'maxDelegationDepth', 2],
    ['parallel Specialists', 'maxParallelSpecialists', 4],
    ['accepted handoffs', 'maxAcceptedHandoffs', 17],
    ['Specialist retries', 'maxSpecialistRetries', 2],
    ['handoff summary bytes', 'maxHandoffSummaryBytes', 16_385],
  ] as const)('rejects %s above the frozen hard maximum', (_label, key, value) => {
    expect(() => parseCoordinationSessionRequest({
      ...request,
      bounds: { ...request.bounds, [key]: value },
    }, {
      maxSteps: 12,
      maxWallTimeMs: 600_000,
      maxToolCalls: 16,
      maxTokens: 50_000,
      maxCostUsd: 5,
    })).toThrowError('invalid_coordination_session_request')
  })
})
