import { createHash, randomUUID } from 'node:crypto'
import {
  acceptAgentActionResult,
  canRunAgentRuntimeOnNode,
  cancelAgentRuntime,
  createAgentRuntime,
  requestAgentAction,
  resumeAgentRuntime,
  type AgentRuntimeState,
  type AgentRuntimeTransition,
} from '@ai-devflow/shared'
import type {
  AgentRuntimeTerminalSummary,
  LocalStore,
} from './local-store.js'
import {
  createNativeToolRegistry,
  digestNativeToolValue,
  type NativeToolAuditRecord,
  type NativeToolRegistry,
} from './native-tool-registry.js'
import { createAcceptedNativeToolRegistrations } from './native-tools.js'

const DEFAULT_RUNTIME_WALL_TIME_MS = 10 * 60_000
const CODING_OWNED_RUNTIME_PREFIX = 'agent-runtime-coding-'
const NATIVE_RUNTIME_TOOL_ID = 'scenario.evaluate'
const NATIVE_RUNTIME_SCENARIO_INPUT = {
  scenarioJson: JSON.stringify({
    stateVersion: 1,
    id: 'desktop-native-tool-runtime',
    version: 1,
    name: 'Desktop Native Tool Runtime',
    objective: 'Evaluate one bounded, isolated Native Tool action.',
    executorKind: 'native',
    expected: {
      stopReason: 'success',
      maxSteps: 1,
      requiredEventTypes: ['runtime_started', 'runtime_stopped'],
      evidenceKinds: ['native_tool_audit'],
      cleanupStatus: 'completed',
    },
    metricDimensions: [
      'quality',
      'cost',
      'latency',
      'human_intervention',
      'recovery',
      'isolation',
    ],
  }),
  observationJson: JSON.stringify({
    stopReason: 'success',
    steps: 1,
    eventTypes: ['runtime_started', 'runtime_stopped'],
    evidenceKinds: ['native_tool_audit'],
    cleanupStatus: 'completed',
    metrics: {
      qualityPassed: true,
      costUsd: 0,
      latencyMs: 0,
      humanInterventions: 0,
      recoverySucceeded: true,
      isolationViolations: 0,
    },
  }),
}

export type DesktopAgentRuntimeSnapshot = {
  runtime: AgentRuntimeState
  events: Awaited<ReturnType<LocalStore['listAgentRuntimeEvents']>>
  terminalSummary: AgentRuntimeTerminalSummary | null
}

export type DesktopAgentRuntime = {
  start(input: { runId: string; nodeId: string }): Promise<DesktopAgentRuntimeSnapshot>
  advance(runtimeId: string): Promise<DesktopAgentRuntimeSnapshot>
  recover(): Promise<DesktopAgentRuntimeSnapshot[]>
  cancel(runtimeId: string): Promise<DesktopAgentRuntimeSnapshot>
}

export type CreateDesktopAgentRuntimeInput = {
  store: LocalStore
  clock?: () => string
  createId?: () => string
  nativeToolRegistry?: NativeToolRegistry
  executeFakeAction?: (input: {
    runtimeId: string
    actionId: string
    requestDigest: string
  }) => Promise<{ resultDigest: string; evaluationSummary: string }>
  fault?: (point: 'before_commit' | 'after_commit') => void
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function canonicalNow(clock: () => string): string {
  const value = clock()
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new Error('Desktop Agent Runtime clock is invalid')
  }
  return value
}

export function createDesktopAgentRuntime(
  input: CreateDesktopAgentRuntimeInput,
): DesktopAgentRuntime {
  const clock = input.clock ?? (() => new Date().toISOString())
  const createId = input.createId ?? (() => `agent-runtime-${randomUUID()}`)
  const executeFakeAction = input.executeFakeAction
  const nativeToolRegistry = executeFakeAction
    ? null
    : input.nativeToolRegistry ?? createNativeToolRegistry({
        tools: createAcceptedNativeToolRegistrations({
          resolveLocalProject: async (localProjectId) =>
            (await input.store.listProjects()).find((project) => project.id === localProjectId) ?? null,
          resolveManagedWorkspace: async (workspaceId) =>
            (await input.store.listManagedCodingWorkspaces()).find(
              (workspace) => workspace.id === workspaceId,
            ) ?? null,
        }),
        clock,
        persistence: {
          reserveGrant: async (grant) => {
            const result = await input.store.reserveAgentRuntimeCapabilityGrant(grant)
            return { reserved: result.reserved }
          },
          beginExecution: async (execution) => {
            const result = await input.store.beginAgentRuntimeToolExecution(execution)
            return { consumed: result.consumed }
          },
          appendAudit: (audit) => input.store.appendAgentRuntimeToolAudit(audit),
        },
      })
  const nativeCapabilitySetDigest = nativeToolRegistry
    ? nativeToolRegistry.capabilitySetDigest()
    : sha256('runtime.fake.observe@1')
  const nativeRuntimeToolVersion = nativeToolRegistry
    ?.listDefinitions()
    .find((definition) => definition.id === NATIVE_RUNTIME_TOOL_ID)?.version ?? 1

  function failureResult(code: string) {
    return {
      outcome: 'failure' as const,
      resultDigest: sha256(`native-tool-failure:${code}`),
      resultBytes: 0,
      tokens: 0,
      costUsd: 0,
      evaluation: 'failure' as const,
      evaluationSummary: `The bounded Native Tool action failed closed: ${code}.`,
    }
  }

  async function executeNativeAction(runtime: AgentRuntimeState) {
    const action = runtime.activeAction
    if (!nativeToolRegistry || action?.kind !== 'tool') {
      return failureResult('invalid_native_tool_action')
    }
    const audits = await input.store.listAgentRuntimeToolAudits(runtime.id)
    const actionAudits = audits.filter(
      (audit) =>
        audit.actionId === action.id &&
        audit.toolId === action.capabilityId &&
        audit.toolVersion === action.capabilityVersion &&
        audit.inputDigest === action.requestDigest,
    )
    const terminalAudit = actionAudits.find((audit) => audit.status !== 'started')
    if (terminalAudit?.status === 'succeeded') {
      return {
        outcome: 'success' as const,
        resultDigest: terminalAudit.resultDigest!,
        resultBytes: terminalAudit.resultBytes!,
        tokens: 0,
        costUsd: 0,
        evaluation: 'success' as const,
        evaluationSummary: 'Recovered the exact durable Native Tool result.',
      }
    }
    if (terminalAudit) return failureResult(terminalAudit.code ?? terminalAudit.status)

    const startedAudit = actionAudits.find((audit) => audit.status === 'started')
    if (startedAudit) {
      const interrupted: NativeToolAuditRecord = {
        ...startedAudit,
        id: `native-tool-audit-${randomUUID()}`,
        status: 'failed',
        code: 'handler_failed',
        resultDigest: null,
        resultBytes: null,
        redactionState: 'not_recorded',
        createdAt: canonicalNow(clock),
      }
      await input.store.appendAgentRuntimeToolAudit(interrupted)
      return failureResult('interrupted_after_durable_start')
    }

    const durableGrants = await input.store.listAgentRuntimeCapabilityGrants(runtime.id)
    const activeGrant = durableGrants.find(
      (grant) =>
        grant.status === 'active' &&
        grant.capabilityId === action.capabilityId &&
        grant.capabilityVersion === action.capabilityVersion &&
        grant.requestDigest === action.requestDigest,
    )
    const resourceScope = {
      kind: 'local_project' as const,
      localProjectId: runtime.scope.localProjectId,
    }
    try {
      const grant = activeGrant
        ? nativeToolRegistry.restoreGrant({ runtime, durableGrant: activeGrant })
        : await nativeToolRegistry.issueGrant({
            runtime,
            toolId: action.capabilityId,
            toolVersion: action.capabilityVersion,
            permission: {
              decision: 'approved',
              permissionClass: 'execute',
              decidedAt: canonicalNow(clock),
              expiresAt: runtime.deadline,
            },
            resourceScope,
            callLimit: 1,
          })
      const result = await nativeToolRegistry.execute({
        grant,
        runtime,
        actionId: action.id,
        input: NATIVE_RUNTIME_SCENARIO_INPUT,
      })
      const value = result.value as { passed?: unknown }
      if (value.passed !== true) return failureResult('scenario_failed')
      return {
        outcome: 'success' as const,
        resultDigest: result.resultDigest,
        resultBytes: result.resultBytes,
        tokens: 0,
        costUsd: 0,
        evaluation: 'success' as const,
        evaluationSummary: 'The deterministic Native Tool scenario satisfied every bound.',
      }
    } catch {
      return failureResult('execution_failed')
    }
  }

  async function snapshot(runtime: AgentRuntimeState): Promise<DesktopAgentRuntimeSnapshot> {
    return {
      runtime,
      events: await input.store.listAgentRuntimeEvents(runtime.id),
      terminalSummary: await input.store.getAgentRuntimeTerminalSummary(runtime.id),
    }
  }

  async function commit(
    expectedRuntime: AgentRuntimeState | null,
    transition: AgentRuntimeTransition,
  ): Promise<AgentRuntimeState> {
    input.fault?.('before_commit')
    const result = await input.store.commitAgentRuntimeTransition({ expectedRuntime, transition })
    if (!result.committed) {
      if (result.reason === 'stale_checkpoint' || result.reason === 'runtime_exists') {
        const current = await input.store.getAgentRuntime(transition.runtime.id)
        if (current) return current
      }
      throw new Error(`Desktop Agent Runtime commit failed: ${result.reason}`)
    }
    input.fault?.('after_commit')
    return result.runtime
  }

  async function assertCurrentAuthority(runtime: AgentRuntimeState): Promise<void> {
    const [run, projects] = await Promise.all([
      input.store.getRun(runtime.authority.runId),
      input.store.listProjects(),
    ])
    const project = projects.find((candidate) => candidate.id === runtime.scope.localProjectId)
    const node = run?.nodes.find((candidate) => candidate.id === runtime.authority.nodeId)
    if (
      !run ||
      !project ||
      run.projectId !== project.id ||
      run.version !== runtime.authority.runVersion ||
      run.currentNodeId !== runtime.authority.nodeId ||
      !node ||
      !canRunAgentRuntimeOnNode(node)
    ) {
      throw new Error('Desktop Agent Runtime authority is stale')
    }
    const policy = await input.store.getPolicySnapshot(project.id)
    if ((policy?.version ?? 1) !== runtime.authority.policyVersion) {
      throw new Error('Desktop Agent Runtime policy is stale')
    }
  }

  async function advance(runtimeId: string): Promise<DesktopAgentRuntimeSnapshot> {
    const runtime = await input.store.getAgentRuntime(runtimeId)
    if (!runtime) throw new Error('Desktop Agent Runtime was not found')
    if (runtime.status === 'terminal') return snapshot(runtime)
    await assertCurrentAuthority(runtime)

    let transition: AgentRuntimeTransition
    if (runtime.status === 'checkpointed') {
      transition = resumeAgentRuntime({
        runtime,
        expectedCheckpointVersion: runtime.checkpointVersion,
        authority: runtime.authority,
        contextDigest: runtime.contextDigest,
        capabilitySetDigest: runtime.capabilitySetDigest,
        now: canonicalNow(clock),
      })
    } else if (runtime.status === 'running') {
      const actionId = `${runtime.id}-step-${runtime.counters.steps + 1}`
      const nativeAction = nativeToolRegistry !== null
      transition = requestAgentAction({
        runtime,
        expectedCheckpointVersion: runtime.checkpointVersion,
        now: canonicalNow(clock),
        action: {
          id: actionId,
          kind: 'tool',
          capabilityId: nativeAction ? NATIVE_RUNTIME_TOOL_ID : 'runtime.fake.observe',
          capabilityVersion: nativeAction ? nativeRuntimeToolVersion : 1,
          requestDigest: nativeAction
            ? digestNativeToolValue(NATIVE_RUNTIME_SCENARIO_INPUT)
            : sha256(`${runtime.id}:${runtime.checkpointVersion}:${runtime.lastObservationDigest}`),
          requiresPermission: false,
        },
      })
    } else if (runtime.status === 'waiting_action' && runtime.activeAction) {
      const result = executeFakeAction
        ? await executeFakeAction({
            runtimeId: runtime.id,
            actionId: runtime.activeAction.id,
            requestDigest: runtime.activeAction.requestDigest,
          }).then((value) => ({
            outcome: 'success' as const,
            resultDigest: value.resultDigest,
            resultBytes: 0,
            tokens: 0,
            costUsd: 0,
            evaluation: 'success' as const,
            evaluationSummary: value.evaluationSummary,
          }))
        : await executeNativeAction(runtime)
      transition = acceptAgentActionResult({
        runtime,
        expectedCheckpointVersion: runtime.checkpointVersion,
        actionId: runtime.activeAction.id,
        requestDigest: runtime.activeAction.requestDigest,
        result,
        now: canonicalNow(clock),
      })
    } else {
      throw new Error('Desktop Agent Runtime is waiting for an unsupported permission transition')
    }

    const committed = await commit(runtime, transition)
    return snapshot(committed)
  }

  return {
    async start({ runId, nodeId }) {
      const now = canonicalNow(clock)
      const [run, projects, pairing] = await Promise.all([
        input.store.getRun(runId),
        input.store.listProjects(),
        input.store.getDesktopPairingCredential(),
      ])
      const project = run
        ? projects.find((candidate) => candidate.id === run.projectId)
        : undefined
      const node = run?.nodes.find((candidate) => candidate.id === nodeId)
      if (
        !run ||
        !project ||
        run.currentNodeId !== nodeId ||
        !node ||
        !canRunAgentRuntimeOnNode(node)
      ) {
        throw new Error('Desktop Agent Runtime start authority is invalid')
      }
      const policy = await input.store.getPolicySnapshot(project.id)
      const scope = pairing?.localProjectId === project.id
        ? {
            kind: 'team' as const,
            organizationId: pairing.organizationId,
            projectId: pairing.projectId,
            userId: pairing.userId,
            sessionId: pairing.tokenId,
            localProjectId: project.id,
          }
        : {
            kind: 'local' as const,
            organizationId: null,
            projectId: null,
            userId: run.creatorId,
            sessionId: `desktop-${sha256(`${run.id}:${nodeId}:${now}`).slice(0, 32)}`,
            localProjectId: project.id,
          }
      const transition = createAgentRuntime({
        stateVersion: 1,
        id: createId(),
        scope,
        authority: {
          runId: run.id,
          nodeId,
          runVersion: run.version,
          policyVersion: policy?.version ?? 1,
        },
        contextDigest: sha256(
          JSON.stringify({ runId: run.id, nodeId, runVersion: run.version }),
        ),
        capabilitySetDigest: nativeCapabilitySetDigest,
        bounds: {
          maxSteps: 1,
          maxWallTimeMs: DEFAULT_RUNTIME_WALL_TIME_MS,
          maxToolCalls: 1,
          maxToolResultBytes: 64 * 1_024,
          maxTrajectoryMetadataBytes: 16 * 1_024,
          maxCheckpointBytes: 128 * 1_024,
          maxTokens: 1,
          maxCostUsd: Number.EPSILON,
        },
        requestedAt: now,
        deadline: new Date(Date.parse(now) + DEFAULT_RUNTIME_WALL_TIME_MS).toISOString(),
      })
      const committed = await commit(null, transition)
      return snapshot(committed)
    },

    advance,

    async recover() {
      const recoverable = await input.store.listRecoverableAgentRuntimes()
      const recovered: DesktopAgentRuntimeSnapshot[] = []
      for (const original of recoverable) {
        if (original.id.startsWith(CODING_OWNED_RUNTIME_PREFIX)) continue
        let current = await snapshot(original)
        for (let iteration = 0; iteration <= original.bounds.maxSteps * 3 + 3; iteration += 1) {
          if (current.runtime.status === 'terminal') break
          current = await advance(original.id)
        }
        if (current.runtime.status !== 'terminal') {
          throw new Error('Desktop Agent Runtime recovery exceeded its deterministic transition bound')
        }
        recovered.push(current)
      }
      return recovered
    },

    async cancel(runtimeId) {
      const runtime = await input.store.getAgentRuntime(runtimeId)
      if (!runtime) throw new Error('Desktop Agent Runtime was not found')
      if (runtime.status === 'terminal') return snapshot(runtime)
      nativeToolRegistry?.cancelRuntime(runtimeId)
      const transition = cancelAgentRuntime({
        runtime,
        expectedCheckpointVersion: runtime.checkpointVersion,
        now: canonicalNow(clock),
      })
      const committed = await commit(runtime, transition)
      return snapshot(committed)
    },
  }
}
