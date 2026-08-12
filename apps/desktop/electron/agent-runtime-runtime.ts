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

const DEFAULT_RUNTIME_WALL_TIME_MS = 10 * 60_000

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
  const executeFakeAction =
    input.executeFakeAction ??
    (async ({ runtimeId, actionId }: { runtimeId: string; actionId: string }) => ({
      resultDigest: sha256(`${runtimeId}:${actionId}:deterministic-fake-result`),
      evaluationSummary: 'The deterministic fake observation satisfied the scenario.',
    }))

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
      transition = requestAgentAction({
        runtime,
        expectedCheckpointVersion: runtime.checkpointVersion,
        now: canonicalNow(clock),
        action: {
          id: actionId,
          kind: 'tool',
          capabilityId: 'runtime.fake.observe',
          capabilityVersion: 1,
          requestDigest: sha256(
            `${runtime.id}:${runtime.checkpointVersion}:${runtime.lastObservationDigest}`,
          ),
          requiresPermission: false,
        },
      })
    } else if (runtime.status === 'waiting_action' && runtime.activeAction) {
      const result = await executeFakeAction({
        runtimeId: runtime.id,
        actionId: runtime.activeAction.id,
        requestDigest: runtime.activeAction.requestDigest,
      })
      transition = acceptAgentActionResult({
        runtime,
        expectedCheckpointVersion: runtime.checkpointVersion,
        actionId: runtime.activeAction.id,
        requestDigest: runtime.activeAction.requestDigest,
        result: {
          outcome: 'success',
          resultDigest: result.resultDigest,
          resultBytes: 0,
          tokens: 0,
          costUsd: 0,
          evaluation: 'success',
          evaluationSummary: result.evaluationSummary,
        },
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
        capabilitySetDigest: sha256('runtime.fake.observe@1'),
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
