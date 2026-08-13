import { describe, expect, it } from 'vitest'
import {
  parseCodingExecutorRequest,
  parseCodingExecutorTurn,
  selectCodingExecutor,
  type CodingExecutorDescriptor,
} from './coding-executor'

function permissionTurn() {
  return {
    stateVersion: 1,
    requestId: 'coding-executor-request-2',
    status: 'waiting_permission',
    checkpointVersion: 1,
    events: [
      {
        stateVersion: 1,
        requestId: 'coding-executor-request-2',
        sequence: 1,
        checkpointVersion: 0,
        type: 'started',
        createdAt: '2026-08-12T23:10:00.000Z',
        metadata: {},
      },
      {
        stateVersion: 1,
        requestId: 'coding-executor-request-2',
        sequence: 2,
        checkpointVersion: 1,
        type: 'permission_request',
        createdAt: '2026-08-12T23:10:01.000Z',
        metadata: { permissionRequestId: 'executor-permission-1' },
      },
    ],
    permissionRequest: {
      stateVersion: 1,
      requestId: 'coding-executor-request-2',
      id: 'executor-permission-1',
      capability: 'workspace_edit',
      requestDigest: 'c'.repeat(64),
      requestedAt: '2026-08-12T23:10:01.000Z',
      expiresAt: '2026-08-12T23:11:01.000Z',
    },
  }
}

describe('Coding Executor contract', () => {
  it('selects one available executor that advertises every immutable required capability', () => {
    const descriptor: CodingExecutorDescriptor = {
      stateVersion: 1,
      id: 'coding-executor-opencode',
      version: 1,
      kind: 'opencode',
      availability: { status: 'available', reasonCode: null },
      capabilities: [
        'cancellation',
        'permission_relay',
        'structured_diff',
        'workspace_edit',
      ],
    }

    expect(
      selectCodingExecutor({
        descriptors: [descriptor],
        executorId: descriptor.id,
        executorVersion: descriptor.version,
        requiredCapabilities: ['cancellation', 'structured_diff', 'workspace_edit'],
      }),
    ).toEqual(descriptor)
  })

  it('denies selection before execution when one required capability is missing', () => {
    const descriptor: CodingExecutorDescriptor = {
      stateVersion: 1,
      id: 'coding-executor-opencode',
      version: 1,
      kind: 'opencode',
      availability: { status: 'available', reasonCode: null },
      capabilities: ['cancellation', 'permission_relay', 'workspace_edit'],
    }

    expect(() =>
      selectCodingExecutor({
        descriptors: [descriptor],
        executorId: descriptor.id,
        executorVersion: descriptor.version,
        requiredCapabilities: ['cancellation', 'structured_diff', 'workspace_edit'],
      }),
    ).toThrow('coding_executor_capability_unavailable')
  })

  it('denies an unavailable executor even when its declared capabilities match', () => {
    const descriptor: CodingExecutorDescriptor = {
      stateVersion: 1,
      id: 'coding-executor-opencode',
      version: 1,
      kind: 'opencode',
      availability: { status: 'unavailable', reasonCode: 'runtime_unavailable' },
      capabilities: ['cancellation', 'structured_diff', 'workspace_edit'],
    }

    expect(() =>
      selectCodingExecutor({
        descriptors: [descriptor],
        executorId: descriptor.id,
        executorVersion: descriptor.version,
        requiredCapabilities: ['cancellation', 'structured_diff', 'workspace_edit'],
      }),
    ).toThrow('coding_executor_unavailable')
  })

  it('represents a successful terminal turn without fabricating a permission request', () => {
    const turn = parseCodingExecutorTurn(
      {
        stateVersion: 1,
        requestId: 'coding-executor-request-1',
        status: 'terminal',
        checkpointVersion: 1,
        events: [
          {
            stateVersion: 1,
            requestId: 'coding-executor-request-1',
            sequence: 1,
            checkpointVersion: 0,
            type: 'started',
            createdAt: '2026-08-12T23:00:00.000Z',
            metadata: {},
          },
          {
            stateVersion: 1,
            requestId: 'coding-executor-request-1',
            sequence: 2,
            checkpointVersion: 1,
            type: 'evidence',
            createdAt: '2026-08-12T23:00:01.000Z',
            metadata: { diffArtifactId: 'coding-diff-1', testEvidenceCount: 1 },
          },
          {
            stateVersion: 1,
            requestId: 'coding-executor-request-1',
            sequence: 3,
            checkpointVersion: 1,
            type: 'terminal',
            createdAt: '2026-08-12T23:00:02.000Z',
            metadata: { stopReason: 'success' },
          },
        ],
        terminalResult: {
          stateVersion: 1,
          requestId: 'coding-executor-request-1',
          stopReason: 'success',
          executor: { id: 'coding-executor-native-fixture', version: 1, kind: 'native' },
          finalCheckpointVersion: 1,
          changedPaths: ['src/index.ts'],
          diffArtifactId: 'coding-diff-1',
          testEvidenceIds: ['evidence-1'],
          usage: { tokens: 0, costUsd: 0 },
          cleanup: { status: 'completed', reasonCode: null },
          completedAt: '2026-08-12T23:00:02.000Z',
        },
      },
      {
        expectedRequestId: 'coding-executor-request-1',
        previousCheckpointVersion: 0,
        previousSequence: 0,
      },
    )

    expect(turn.status).toBe('terminal')
    if (turn.status !== 'terminal') throw new Error('expected terminal turn')
    expect('permissionRequest' in turn).toBe(false)
    expect(turn.terminalResult.stopReason).toBe('success')
  })

  it('accepts only main-owned scope, authority, digests, bounds, and capability references', () => {
    const input = {
      stateVersion: 1,
      id: 'coding-executor-request-1',
      executor: { id: 'coding-executor-opencode', version: 1 },
      scope: {
        organizationId: null,
        projectId: null,
        userId: 'user-1',
        sessionId: 'session-1',
        localProjectId: 'local-project-1',
        managedWorkspaceId: 'managed-workspace-1',
      },
      authority: { runId: 'run-1', nodeId: 'node-1', runVersion: 3, policyVersion: 2 },
      objectiveDigest: 'a'.repeat(64),
      contextDigest: 'b'.repeat(64),
      requiredCapabilities: ['cancellation', 'structured_diff', 'workspace_edit'],
      budget: { maxTokens: 10_000, maxCostUsd: 5 },
      expectedCheckpointVersion: 0,
      requestedAt: '2026-08-12T23:00:00.000Z',
      deadline: '2026-08-12T23:10:00.000Z',
    }
    const request = parseCodingExecutorRequest(input)

    expect(request.scope.managedWorkspaceId).toBe('managed-workspace-1')
    expect(request).not.toHaveProperty('worktreePath')
    expect(request).not.toHaveProperty('command')
    expect(() =>
      parseCodingExecutorRequest({ ...input, worktreePath: '/tmp/untrusted' }),
    ).toThrow('invalid_coding_executor_request')
  })

  it('represents one bounded permission wait without exposing a command or local path', () => {
    const turn = parseCodingExecutorTurn(
      permissionTurn(),
      {
        expectedRequestId: 'coding-executor-request-2',
        previousCheckpointVersion: 0,
        previousSequence: 0,
      },
    )

    expect(turn.status).toBe('waiting_permission')
    if (turn.status !== 'waiting_permission') throw new Error('expected permission wait')
    expect(turn.permissionRequest.capability).toBe('workspace_edit')
    expect(turn.permissionRequest).not.toHaveProperty('command')
    expect(turn.permissionRequest).not.toHaveProperty('filePath')
  })

  it('rejects a repeated settled permission id and out-of-order events', () => {
    expect(() =>
      parseCodingExecutorTurn(permissionTurn(), {
        expectedRequestId: 'coding-executor-request-2',
        previousCheckpointVersion: 0,
        previousSequence: 0,
        settledPermissionRequestIds: ['executor-permission-1'],
      }),
    ).toThrow('invalid_coding_executor_turn')

    const outOfOrder = permissionTurn()
    outOfOrder.events[1]!.sequence = 3
    expect(() =>
      parseCodingExecutorTurn(outOfOrder, {
        expectedRequestId: 'coding-executor-request-2',
        previousCheckpointVersion: 0,
        previousSequence: 0,
      }),
    ).toThrow('invalid_coding_executor_event_order')
  })

  it('rejects raw paths and non-allowlisted metadata at the shared event boundary', () => {
    const unsafe = permissionTurn()
    ;(unsafe.events[0]!.metadata as Record<string, unknown>).cwd = '/tmp/private-worktree'

    expect(() =>
      parseCodingExecutorTurn(unsafe, {
        expectedRequestId: 'coding-executor-request-2',
        previousCheckpointVersion: 0,
        previousSequence: 0,
      }),
    ).toThrow('invalid_coding_executor_event')
  })
})
