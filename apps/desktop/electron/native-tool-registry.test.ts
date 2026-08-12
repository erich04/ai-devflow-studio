import { describe, expect, it, vi } from 'vitest'
import {
  createAgentRuntime,
  recordAgentPermissionDecision,
  requestAgentAction,
  resumeAgentRuntime,
  type AgentRuntimeState,
  type NativeToolDefinition,
} from '@ai-devflow/shared'
import {
  NativeToolExecutionError,
  createNativeToolRegistry,
  digestNativeToolValue,
} from './native-tool-registry.js'

const inputValue = { message: 'hello' }

const definition: NativeToolDefinition = {
  stateVersion: 1,
  id: 'runtime.echo',
  version: 1,
  source: 'native',
  description: 'Return one bounded message for deterministic tests.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: { message: { type: 'string', minLength: 1, maxLength: 128 } },
    required: ['message'],
  },
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: { echoed: { type: 'string', minLength: 1, maxLength: 128 } },
    required: ['echoed'],
  },
  permissionClass: 'read',
  sideEffectClass: 'none',
  defaultDeadlineMs: 25,
  maxResultBytes: 256,
  idempotency: 'idempotent',
  auditPolicy: 'redacted_metadata_only',
}

function runtimeWaitingForTool(): AgentRuntimeState {
  const created = createAgentRuntime({
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
    authority: {
      runId: 'run-1',
      nodeId: 'node-1',
      runVersion: 7,
      policyVersion: 3,
    },
    contextDigest: 'a'.repeat(64),
    capabilitySetDigest: 'b'.repeat(64),
    bounds: {
      maxSteps: 4,
      maxWallTimeMs: 60_000,
      maxToolCalls: 2,
      maxToolResultBytes: 256,
      maxTrajectoryMetadataBytes: 4_096,
      maxCheckpointBytes: 16_384,
      maxTokens: 1_000,
      maxCostUsd: 1,
    },
    requestedAt: '2026-08-12T20:30:00.000Z',
    deadline: '2026-08-12T20:31:00.000Z',
  })
  const running = resumeAgentRuntime({
    runtime: created.runtime,
    expectedCheckpointVersion: created.checkpoint.version,
    authority: created.runtime.authority,
    contextDigest: created.runtime.contextDigest,
    capabilitySetDigest: created.runtime.capabilitySetDigest,
    now: '2026-08-12T20:30:01.000Z',
  })
  const requested = requestAgentAction({
    runtime: running.runtime,
    expectedCheckpointVersion: running.checkpoint.version,
    action: {
      id: 'action-1',
      kind: 'tool',
      capabilityId: definition.id,
      capabilityVersion: definition.version,
      requestDigest: digestNativeToolValue(inputValue),
      requiresPermission: true,
    },
    now: '2026-08-12T20:30:02.000Z',
  })
  return recordAgentPermissionDecision({
    runtime: requested.runtime,
    expectedCheckpointVersion: requested.checkpoint.version,
    actionId: 'action-1',
    requestDigest: digestNativeToolValue(inputValue),
    decision: 'approved_once',
    now: '2026-08-12T20:30:02.000Z',
  }).runtime
}

function approvedGrant(registry: ReturnType<typeof createNativeToolRegistry>, runtime: AgentRuntimeState) {
  return registry.issueGrant({
    runtime,
    toolId: definition.id,
    toolVersion: definition.version,
    permission: {
      decision: 'approved',
      permissionClass: 'read',
      decidedAt: '2026-08-12T20:30:02.000Z',
      expiresAt: '2026-08-12T20:30:30.000Z',
    },
    resourceScope: {
      kind: 'local_project',
      localProjectId: 'local-project-1',
    },
    callLimit: 1,
  })
}

function expectCode(error: unknown, code: string) {
  expect(error).toBeInstanceOf(NativeToolExecutionError)
  expect((error as NativeToolExecutionError).code).toBe(code)
  expect((error as Error).message).not.toContain('hello')
}

describe('main-owned Native Tool Registry', () => {
  it('rejects duplicate or unknown Tool definitions and denied permission grants', () => {
    expect(() =>
      createNativeToolRegistry({
        tools: [
          { definition, handler: async () => ({ echoed: 'hello' }) },
          { definition, handler: async () => ({ echoed: 'hello' }) },
        ],
      }),
    ).toThrowError('duplicate_native_tool_definition')

    const registry = createNativeToolRegistry({
      tools: [{ definition, handler: async () => ({ echoed: 'hello' }) }],
      clock: () => '2026-08-12T20:30:03.000Z',
    })
    const runtime = runtimeWaitingForTool()
    expect(() =>
      registry.issueGrant({
        runtime,
        toolId: 'unknown.tool',
        toolVersion: 1,
        permission: {
          decision: 'approved',
          permissionClass: 'read',
          decidedAt: '2026-08-12T20:30:02.000Z',
          expiresAt: '2026-08-12T20:30:30.000Z',
        },
        resourceScope: { kind: 'local_project', localProjectId: 'local-project-1' },
        callLimit: 1,
      }),
    ).toThrowError('invalid_native_tool_grant')
    expect(() =>
      registry.issueGrant({
        runtime,
        toolId: definition.id,
        toolVersion: definition.version,
        permission: {
          decision: 'denied',
          permissionClass: 'read',
          decidedAt: '2026-08-12T20:30:02.000Z',
          expiresAt: '2026-08-12T20:30:30.000Z',
        } as never,
        resourceScope: { kind: 'local_project', localProjectId: 'local-project-1' },
        callLimit: 1,
      }),
    ).toThrowError('invalid_native_tool_grant')
  })

  it('executes one exact authorized call and records only redacted metadata', async () => {
    const handler = vi.fn(async ({ input }: { input: unknown }) => ({
      echoed: (input as { message: string }).message,
    }))
    const registry = createNativeToolRegistry({
      tools: [{ definition, handler }],
      clock: () => '2026-08-12T20:30:03.000Z',
    })
    const runtime = runtimeWaitingForTool()
    const grant = approvedGrant(registry, runtime)

    await expect(
      registry.execute({ grant, runtime, actionId: 'action-1', input: inputValue }),
    ).resolves.toEqual({
      value: { echoed: 'hello' },
      resultDigest: digestNativeToolValue({ echoed: 'hello' }),
      resultBytes: 18,
    })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(registry.listAuditRecords(runtime.id))).not.toContain('hello')
    expect(registry.listAuditRecords(runtime.id).map((record) => record.status)).toEqual([
      'started',
      'succeeded',
    ])

    await expect(
      registry.execute({ grant, runtime, actionId: 'action-1', input: inputValue }),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, 'grant_exhausted')
      return true
    })
  })

  it('rejects forged, expired, mismatched, and malformed authority before execution', async () => {
    const handler = vi.fn(async () => ({ echoed: 'hello' }))
    let now = '2026-08-12T20:30:03.000Z'
    const registry = createNativeToolRegistry({
      tools: [{ definition, handler }],
      clock: () => now,
    })
    const runtime = runtimeWaitingForTool()

    for (const [label, grant, currentRuntime, actionId, value, code] of [
      ['forged', {}, runtime, 'action-1', inputValue, 'invalid_grant'],
      [
        'runtime mismatch',
        approvedGrant(registry, runtime),
        { ...runtime, authority: { ...runtime.authority, runVersion: 8 } },
        'action-1',
        inputValue,
        'runtime_mismatch',
      ],
      [
        'action mismatch',
        approvedGrant(registry, runtime),
        runtime,
        'action-2',
        inputValue,
        'action_mismatch',
      ],
      [
        'invalid input',
        approvedGrant(registry, runtime),
        runtime,
        'action-1',
        { message: 'hello', command: 'cat ~/.ssh/id_rsa' },
        'invalid_input',
      ],
    ] as const) {
      await expect(
        registry.execute({ grant, runtime: currentRuntime, actionId, input: value }),
        label,
      ).rejects.toSatisfy((error: unknown) => {
        expectCode(error, code)
        return true
      })
    }

    const expiringGrant = approvedGrant(registry, runtime)
    now = '2026-08-12T20:30:30.000Z'
    await expect(
      registry.execute({ grant: expiringGrant, runtime, actionId: 'action-1', input: inputValue }),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, 'grant_expired')
      return true
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it.each([
    ['organization', { organizationId: 'org-2' }],
    ['project', { projectId: 'project-2' }],
    ['user', { userId: 'user-2' }],
    ['session', { sessionId: 'session-2' }],
    ['Local Project', { localProjectId: 'local-project-2' }],
  ])('rejects cross-%s scope use before the handler', async (_label, scopeChange) => {
    const handler = vi.fn(async () => ({ echoed: 'hello' }))
    const registry = createNativeToolRegistry({
      tools: [{ definition, handler }],
      clock: () => '2026-08-12T20:30:03.000Z',
    })
    const runtime = runtimeWaitingForTool()
    const grant = approvedGrant(registry, runtime)
    const changed = { ...runtime, scope: { ...runtime.scope, ...scopeChange } } as AgentRuntimeState
    await expect(
      registry.execute({ grant, runtime: changed, actionId: 'action-1', input: inputValue }),
    ).rejects.toMatchObject({ code: 'runtime_mismatch' })
    expect(handler).not.toHaveBeenCalled()
  })

  it.each([
    ['invalid_output', { unexpected: true }],
    ['result_too_large', { echoed: 'x'.repeat(128) }],
  ])('fails closed for %s without exposing handler output', async (expectedCode, output) => {
    const constrainedDefinition = {
      ...definition,
      maxResultBytes: expectedCode === 'result_too_large' ? 32 : definition.maxResultBytes,
    }
    const registry = createNativeToolRegistry({
      tools: [{ definition: constrainedDefinition, handler: async () => output }],
      clock: () => '2026-08-12T20:30:03.000Z',
    })
    const runtime = runtimeWaitingForTool()
    const grant = approvedGrant(registry, runtime)

    await expect(
      registry.execute({ grant, runtime, actionId: 'action-1', input: inputValue }),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, expectedCode)
      return true
    })
    expect(JSON.stringify(registry.listAuditRecords(runtime.id))).not.toContain('unexpected')
    expect(JSON.stringify(registry.listAuditRecords(runtime.id))).not.toContain('xxxx')
  })

  it('redacts sensitive output before returning or digesting it and fails closed if redaction fails', async () => {
    const runtime = runtimeWaitingForTool()
    const registry = createNativeToolRegistry({
      tools: [
        {
          definition,
          handler: async () => ({ echoed: 'Authorization: Bearer provider-secret' }),
        },
      ],
      clock: () => '2026-08-12T20:30:03.000Z',
    })
    const grant = approvedGrant(registry, runtime)
    const result = await registry.execute({
      grant,
      runtime,
      actionId: 'action-1',
      input: inputValue,
    })
    expect(result.value).toEqual({ echoed: '[REDACTED:authorization_secret]' })
    expect(result.resultDigest).toBe(
      digestNativeToolValue({ echoed: '[REDACTED:authorization_secret]' }),
    )
    expect(JSON.stringify(result)).not.toContain('provider-secret')
    expect(registry.listAuditRecords(runtime.id).at(-1)?.redactionState).toBe('applied')

    const failingRegistry = createNativeToolRegistry({
      tools: [{ definition, handler: async () => ({ echoed: 'hello' }) }],
      clock: () => '2026-08-12T20:30:03.000Z',
      redactResult: () => {
        throw new Error('redactor secret detail')
      },
    })
    const failingGrant = approvedGrant(failingRegistry, runtime)
    await expect(
      failingRegistry.execute({
        grant: failingGrant,
        runtime,
        actionId: 'action-1',
        input: inputValue,
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, 'redaction_failed')
      return true
    })
    expect(JSON.stringify(failingRegistry.listAuditRecords(runtime.id))).not.toContain(
      'redactor secret detail',
    )
  })

  it('aborts a runtime call and ignores a handler result that arrives after cancellation', async () => {
    let resolveHandler!: (value: { echoed: string }) => void
    const handlerResult = new Promise<{ echoed: string }>((resolve) => {
      resolveHandler = resolve
    })
    const registry = createNativeToolRegistry({
      tools: [{ definition, handler: async () => handlerResult }],
      clock: () => '2026-08-12T20:30:03.000Z',
    })
    const runtime = runtimeWaitingForTool()
    const grant = approvedGrant(registry, runtime)
    const execution = registry.execute({
      grant,
      runtime,
      actionId: 'action-1',
      input: inputValue,
    })

    expect(registry.cancelRuntime(runtime.id)).toBe(1)
    await expect(execution).rejects.toSatisfy((error: unknown) => {
      expectCode(error, 'cancelled')
      return true
    })
    resolveHandler({ echoed: 'late-secret-result' })
    await Promise.resolve()
    expect(registry.listAuditRecords(runtime.id).map((record) => record.status)).toEqual([
      'started',
      'cancelled',
    ])
    expect(JSON.stringify(registry.listAuditRecords(runtime.id))).not.toContain('late-secret-result')
  })

  it('enforces the Tool deadline when a handler does not settle', async () => {
    vi.useFakeTimers()
    try {
      const registry = createNativeToolRegistry({
        tools: [{ definition, handler: async () => new Promise(() => undefined) }],
        clock: () => '2026-08-12T20:30:03.000Z',
      })
      const runtime = runtimeWaitingForTool()
      const grant = approvedGrant(registry, runtime)
      const execution = registry.execute({
        grant,
        runtime,
        actionId: 'action-1',
        input: inputValue,
      })
      const rejection = expect(execution).rejects.toSatisfy((error: unknown) => {
        expectCode(error, 'deadline_exceeded')
        return true
      })

      await vi.advanceTimersByTimeAsync(definition.defaultDeadlineMs)
      await rejection
      expect(registry.listAuditRecords(runtime.id).at(-1)?.status).toBe('timeout')
    } finally {
      vi.useRealTimers()
    }
  })
})
