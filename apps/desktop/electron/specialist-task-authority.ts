import {
  canRunAgentRuntimeOnNode,
  type AgentTaskResourceRequirement,
  type CoordinationAuthority,
  type CoordinationScope,
  type SpecialistBudget,
} from '@ai-devflow/shared'
import type { LocalStore } from './local-store.js'
import {
  resolveSpecialistDescriptor,
  type SpecialistRoleId,
} from './specialist-runtime-registry.js'

declare const specialistTaskAuthorityBrand: unique symbol

export type SpecialistTaskAuthority = {
  readonly [specialistTaskAuthorityBrand]: true
}

export type SpecialistTaskAuthoritySnapshot = {
  stateVersion: 1
  coordinationId: string
  sessionVersion: number
  graphId: string
  graphVersion: number
  taskId: string
  taskVersion: number
  roleId: SpecialistRoleId
  roleVersion: 1
  scope: CoordinationScope
  authority: CoordinationAuthority
  supervisorRuntimeId: string
  supervisorRuntimeVersion: number
  contextDigest: string
  supervisorContextDigest: string
  supervisorCapabilitySetDigest: string
  capabilityIds: string[]
  resourceRequirements: AgentTaskResourceRequirement[]
  remainingBudget: SpecialistBudget
  deadline: string
}

export type SpecialistTaskAuthorization = {
  capability: SpecialistTaskAuthority
  task: SpecialistTaskAuthoritySnapshot
}

export type SpecialistTaskAuthorityBroker = {
  authorize(input: {
    coordinationId: string
    expectedSessionVersion: number
    taskId: string
    expectedTaskVersion: number
    now: string
  }): Promise<SpecialistTaskAuthorization>
  resolve(
    capability: unknown,
    now: string,
  ): Promise<SpecialistTaskAuthoritySnapshot>
}

type AuthorityStore = Pick<LocalStore,
  | 'getSpecialistTaskAuthorityStoreIdentity'
  | 'getCoordinationRecoverySnapshot'
  | 'getAgentRuntime'
  | 'getRun'
  | 'listProjects'
  | 'getPolicySnapshot'
  | 'getDesktopPairingCredential'
  | 'isAgentRuntimeContextCurrent'
>

type CreateSpecialistTaskAuthorityBrokerInput = {
  store: AuthorityStore
}

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u
const capabilities = new WeakMap<object, {
  storeIdentity: object
  task: SpecialistTaskAuthoritySnapshot
  validate: (request: {
    coordinationId: string
    expectedSessionVersion: number
    taskId: string
    expectedTaskVersion: number
    now: string
  }) => Promise<SpecialistTaskAuthoritySnapshot>
}>()

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function cloneSnapshot(
  snapshot: SpecialistTaskAuthoritySnapshot,
): SpecialistTaskAuthoritySnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as SpecialistTaskAuthoritySnapshot
}

function invalidAuthority(): never {
  throw new Error('specialist_task_authority_invalid')
}

export function createSpecialistTaskAuthorityBroker(
  input: CreateSpecialistTaskAuthorityBrokerInput,
): SpecialistTaskAuthorityBroker {
  async function validateCurrent(request: {
    coordinationId: string
    expectedSessionVersion: number
    taskId: string
    expectedTaskVersion: number
    now: string
  }): Promise<SpecialistTaskAuthoritySnapshot> {
    if (
      !identifierPattern.test(request.coordinationId) ||
      !identifierPattern.test(request.taskId) ||
      !Number.isInteger(request.expectedSessionVersion) ||
      request.expectedSessionVersion < 1 ||
      !Number.isInteger(request.expectedTaskVersion) ||
      request.expectedTaskVersion < 1 ||
      !isCanonicalTimestamp(request.now)
    ) invalidAuthority()

    const durable = await input.store.getCoordinationRecoverySnapshot(request.coordinationId)
    if (durable === null) invalidAuthority()
    const { coordination, graph, state } = durable
    const task = state.tasks.find((candidate) => candidate.id === request.taskId)
    const graphTask = graph.nodes.find((candidate) => candidate.id === request.taskId)
    if (
      state.status !== 'running' ||
      state.version !== request.expectedSessionVersion ||
      state.graphId !== graph.id ||
      state.graphVersion !== graph.version ||
      graph.coordinationId !== coordination.id ||
      task === undefined ||
      graphTask === undefined ||
      task.version !== request.expectedTaskVersion ||
      task.status !== 'ready' ||
      task.agentId !== null ||
      task.runtimeId !== null ||
      task.runtimeVersion !== null ||
      Date.parse(request.now) < Date.parse(state.startedAt) ||
      Date.parse(request.now) >= Date.parse(state.deadline)
    ) invalidAuthority()

    let descriptor
    try {
      descriptor = resolveSpecialistDescriptor(graphTask.roleId)
    } catch {
      invalidAuthority()
    }
    const descriptorCapabilityIds = new Set(descriptor.capabilityIds)
    if (
      graphTask.capabilityIds.some((capabilityId) => !descriptorCapabilityIds.has(capabilityId)) ||
      (descriptor.resourceMode === 'read' &&
        graphTask.resourceRequirements.some((resource) => resource.mode !== 'read'))
    ) invalidAuthority()

    const [supervisor, run, projects, policy, pairing, contextCurrent] = await Promise.all([
      input.store.getAgentRuntime(coordination.authority.supervisorRuntimeId),
      input.store.getRun(coordination.authority.runId),
      input.store.listProjects(),
      input.store.getPolicySnapshot(coordination.scope.localProjectId),
      input.store.getDesktopPairingCredential(),
      input.store.isAgentRuntimeContextCurrent(
        coordination.authority.supervisorRuntimeId,
        request.now,
      ),
    ])
    const project = projects.find((candidate) => candidate.id === coordination.scope.localProjectId)
    const node = run?.nodes.find((candidate) => candidate.id === coordination.authority.nodeId)
    if (
      supervisor === null ||
      supervisor.status === 'terminal' ||
      supervisor.version !== coordination.authority.supervisorRuntimeVersion ||
      supervisor.scope.kind !== 'team' ||
      supervisor.scope.organizationId !== coordination.scope.organizationId ||
      supervisor.scope.projectId !== coordination.scope.projectId ||
      supervisor.scope.userId !== coordination.scope.userId ||
      supervisor.scope.sessionId !== coordination.scope.sessionId ||
      supervisor.scope.localProjectId !== coordination.scope.localProjectId ||
      supervisor.authority.runId !== coordination.authority.runId ||
      supervisor.authority.nodeId !== coordination.authority.nodeId ||
      supervisor.authority.runVersion !== coordination.authority.runVersion ||
      supervisor.authority.policyVersion !== coordination.authority.policyVersion ||
      supervisor.contextDigest !== coordination.contextDigest ||
      supervisor.capabilitySetDigest !== coordination.capabilitySetDigest ||
      Date.parse(request.now) >= Date.parse(supervisor.deadline) ||
      run === null ||
      project === undefined ||
      run.projectId !== project.id ||
      run.version !== coordination.authority.runVersion ||
      run.currentNodeId !== coordination.authority.nodeId ||
      node === undefined ||
      !canRunAgentRuntimeOnNode(node) ||
      (policy?.version ?? 1) !== coordination.authority.policyVersion ||
      pairing === null ||
      pairing.organizationId !== coordination.scope.organizationId ||
      pairing.projectId !== coordination.scope.projectId ||
      pairing.userId !== coordination.scope.userId ||
      pairing.tokenId !== coordination.scope.sessionId ||
      pairing.localProjectId !== coordination.scope.localProjectId ||
      !contextCurrent
    ) invalidAuthority()

    const remainingBudget = {
      maxSteps: coordination.bounds.maxSteps - state.counters.steps,
      maxWallTimeMs: coordination.bounds.maxWallTimeMs,
      maxToolCalls: coordination.bounds.maxToolCalls - state.counters.toolCalls,
      maxTokens: coordination.bounds.maxTokens - state.counters.tokens,
      maxCostUsd: coordination.bounds.maxCostUsd - state.counters.costUsd,
    }
    if (
      remainingBudget.maxSteps <= 0 ||
      remainingBudget.maxWallTimeMs <= 0 ||
      remainingBudget.maxToolCalls <= 0 ||
      remainingBudget.maxTokens <= 0 ||
      remainingBudget.maxCostUsd <= 0
    ) invalidAuthority()

    return {
      stateVersion: 1,
      coordinationId: coordination.id,
      sessionVersion: state.version,
      graphId: graph.id,
      graphVersion: graph.version,
      taskId: task.id,
      taskVersion: task.version,
      roleId: descriptor.id,
      roleVersion: descriptor.version,
      scope: { ...coordination.scope },
      authority: { ...coordination.authority },
      supervisorRuntimeId: supervisor.id,
      supervisorRuntimeVersion: supervisor.version,
      contextDigest: graphTask.contextDigest,
      supervisorContextDigest: supervisor.contextDigest,
      supervisorCapabilitySetDigest: supervisor.capabilitySetDigest,
      capabilityIds: [...graphTask.capabilityIds],
      resourceRequirements: graphTask.resourceRequirements.map((resource) => ({ ...resource })),
      remainingBudget,
      deadline: new Date(Math.min(
        Date.parse(coordination.deadline),
        Date.parse(supervisor.deadline),
      )).toISOString(),
    }
  }

  const broker: SpecialistTaskAuthorityBroker = {
    async authorize(request) {
      try {
        const task = await validateCurrent(request)
        const capability = Object.freeze({}) as SpecialistTaskAuthority
        capabilities.set(capability, {
          storeIdentity: input.store.getSpecialistTaskAuthorityStoreIdentity(),
          task: cloneSnapshot(task),
          validate: validateCurrent,
        })
        return { capability, task: cloneSnapshot(task) }
      } catch {
        return invalidAuthority()
      }
    },

    async resolve(capability, now) {
      return resolveSpecialistTaskAuthority(input.store, capability, now)
    },
  }
  return broker
}

export async function resolveSpecialistTaskAuthority(
  store: AuthorityStore,
  capability: unknown,
  now: string,
): Promise<SpecialistTaskAuthoritySnapshot> {
  try {
    if (typeof capability !== 'object' || capability === null) invalidAuthority()
    const entry = capabilities.get(capability)
    if (
      entry === undefined ||
      entry.storeIdentity !== store.getSpecialistTaskAuthorityStoreIdentity()
    ) invalidAuthority()
    const expected = entry.task
    const current = await entry.validate({
      coordinationId: expected.coordinationId,
      expectedSessionVersion: expected.sessionVersion,
      taskId: expected.taskId,
      expectedTaskVersion: expected.taskVersion,
      now,
    })
    if (!sameJson(current, expected)) invalidAuthority()
    return cloneSnapshot(current)
  } catch {
    return invalidAuthority()
  }
}
