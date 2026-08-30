import {
  estimateCodingRuntimeCost,
  isActiveCodingAgentRunStatus,
  resolveDevFlowCodingExecutorSelection,
  validateTestCommandSafety,
  type BudgetGuardDecision,
  type CodingExecutorCapability,
  type CodingRuntimeConfiguration,
  type CodingRuntimeReadiness,
  type CodingRuntimeReadinessCheck,
  type RuntimeBudgetPolicy,
} from '@ai-devflow/shared'
import type { CodingExecutor } from './coding-executor.js'
import { isGitRepository } from './coding-runner.js'
import type { LocalStore } from './local-store.js'

export const NATIVE_CODING_MAX_PROVIDER_CALLS = 3
export const NATIVE_CODING_MAX_PROMPT_CHARS = 30_000
export const NATIVE_CODING_MAX_OUTPUT_TOKENS = 4_096

export type ResolvedCodingRuntimeSelection =
  | {
      source: 'environment'
      executor: 'compatibility' | 'native-deterministic' | 'native-model'
      providerId?: string
      configVersion: 0
    }
  | {
      source: 'project'
      executor: 'native-model' | 'opencode-http'
      providerId: string
      configVersion: number
      configuration: CodingRuntimeConfiguration
    }
  | {
      source: 'none'
      executor: 'unconfigured'
      configVersion: 0
    }

export async function resolveCodingRuntimeSelection(input: {
  store: Pick<LocalStore, 'getCodingRuntimeConfiguration'>
  projectId: string
  env?: NodeJS.ProcessEnv
}): Promise<ResolvedCodingRuntimeSelection> {
  const env = input.env ?? process.env
  const explicitExecutor = env.DEVFLOW_CODING_EXECUTOR?.trim()
  const explicitEngine = env.DEVFLOW_CODING_ENGINE?.trim()
  if (explicitExecutor || explicitEngine) {
    const selection = resolveDevFlowCodingExecutorSelection(env)
    return selection.executor === 'native-model'
      ? {
          source: 'environment',
          executor: selection.executor,
          providerId: selection.providerId,
          configVersion: 0,
        }
      : {
          source: 'environment',
          executor: selection.executor,
          configVersion: 0,
        }
  }
  const configuration = await input.store.getCodingRuntimeConfiguration(input.projectId)
  return configuration
    ? {
        source: 'project',
        executor: configuration.executor,
        providerId: configuration.providerId,
        configVersion: configuration.version,
        configuration,
      }
    : { source: 'none', executor: 'unconfigured', configVersion: 0 }
}

export function estimateNativeCodingWorstCaseCost(input: {
  runId: string
  nodeId: string
  projectId: string
  requestedBy: string
  providerId: string
  model: string
  billingProvider?: 'deepseek' | 'openai_compatible'
  timestamp: string
}) {
  return estimateCodingRuntimeCost({
    engine: 'native',
    providerId: input.providerId,
    model: input.model,
    ...(input.billingProvider ? { billingProvider: input.billingProvider } : {}),
    prompt: 'x'.repeat(NATIVE_CODING_MAX_PROMPT_CHARS),
    runId: input.runId,
    nodeId: input.nodeId,
    projectId: input.projectId,
    userId: input.requestedBy,
    timestamp: input.timestamp,
    maxOutputTokens: NATIVE_CODING_MAX_OUTPUT_TOKENS,
    providerCallLimit: NATIVE_CODING_MAX_PROVIDER_CALLS,
  })
}

function check(
  checks: CodingRuntimeReadinessCheck[],
  code: CodingRuntimeReadinessCheck['code'],
  ready: boolean,
  message: string,
): void {
  checks.push({ code, status: ready ? 'ready' : 'blocked', message })
}

export async function evaluateCodingRuntimeReadiness(input: {
  store: LocalStore
  selection: ResolvedCodingRuntimeSelection
  executor: CodingExecutor | null
  engineAvailable?: boolean
  projectId: string
  runId: string
  nodeId: string
  requestedBy: string
  runtimeBudgetApprovalId?: string
  getBudgetPolicy(projectId: string): Promise<RuntimeBudgetPolicy | null>
  evaluateBudget(input: {
    projectId: string
    providerId: string
    projectedCostUsd: number
    approvalId?: string
  }): Promise<BudgetGuardDecision>
  now?: () => string
}): Promise<CodingRuntimeReadiness> {
  const evaluatedAt = (input.now ?? (() => new Date().toISOString()))()
  const checks: CodingRuntimeReadinessCheck[] = []
  const [projects, runs, codingRuns, permissions, pairing, credentials] = await Promise.all([
    input.store.listProjects(),
    input.store.listRuns(),
    input.store.listCodingAgentRuns(),
    input.store.listCodingPermissionRequests(),
    input.store.getDesktopPairingCredential(),
    input.store.listProviderCredentials(),
  ])
  const project = projects.find((candidate) => candidate.id === input.projectId)
  const run = runs.find((candidate) => candidate.id === input.runId)
  const node = run?.nodes.find((candidate) => candidate.id === input.nodeId)
  const workflowReady = Boolean(
    project &&
      run &&
      run.projectId === project.id &&
      run.currentNodeId === node?.id &&
      node.stage === 'build' &&
      (node.kind === 'task' || node.kind === 'agent') &&
      (node.status === 'running' || node.status === 'failed'),
  )
  check(
    checks,
    'wrong_workflow_node',
    workflowReady,
    workflowReady
      ? '当前节点是可执行的 Implement locally 构建节点。'
      : 'Coding Agent 只能从当前 Implement locally 构建节点启动。',
  )

  const gitReady = project ? await isGitRepository(project.path) : false
  check(
    checks,
    'git_unavailable',
    gitReady,
    gitReady ? '本地项目支持 managed worktree。' : '本地项目不是可用的 Git 仓库。',
  )

  const commandSafety = project?.testCommand.trim()
    ? validateTestCommandSafety(project.testCommand)
    : null
  const testReady = Boolean(commandSafety && commandSafety.level !== 'blocked')
  check(
    checks,
    'test_command_missing',
    testReady,
    testReady ? '项目已保存安全测试命令。' : '请先为本地项目保存可识别的安全测试命令。',
  )

  const configured = input.selection.executor !== 'unconfigured' && input.executor !== null
  check(
    checks,
    'executor_unconfigured',
    configured,
    configured ? '项目已选择 Coding Agent Executor。' : '请先配置项目级 Coding Agent Executor。',
  )

  const engineReady = Boolean(
    configured &&
      input.executor?.engine !== 'not-configured' &&
      input.executor?.descriptor.availability.status === 'available' &&
      input.engineAvailable !== false,
  )
  check(
    checks,
    'engine_unavailable',
    engineReady,
    engineReady
      ? '所选 Coding Engine 可用。'
      : '所选 Coding Engine 不可用；请重新检测或选择其他 Executor。',
  )

  const requiredCapabilities: CodingExecutorCapability[] =
    input.executor?.descriptor.kind === 'opencode'
      ? ['cancellation', 'permission_relay', 'structured_diff', 'workspace_edit', 'workspace_read']
      : ['cancellation', 'structured_diff', 'workspace_edit', 'workspace_read']
  const availableCapabilities = input.executor?.descriptor.capabilities ?? []
  const capabilityReady = Boolean(
    configured && requiredCapabilities.every((capability) => availableCapabilities.includes(capability)),
  )
  check(
    checks,
    'capability_unavailable',
    capabilityReady,
    capabilityReady
      ? 'Coding Executor 满足当前运行所需能力。'
      : 'Coding Executor 缺少当前运行所需能力。',
  )

  const providerId =
    ('providerId' in input.selection ? input.selection.providerId : undefined) ??
    input.executor?.providerId
  const providerMetadata = providerId
    ? credentials.find((candidate) => candidate.providerId === providerId)
    : undefined
  const providerSecret = providerId
    ? await input.store.getProviderEncryptedSecret(providerId)
    : null
  const usesOpenCodeProvider = input.selection.executor === 'opencode-http' ||
    input.executor?.descriptor.kind === 'opencode'
  const providerReady = Boolean(
    input.selection.executor === 'native-deterministic' ||
      input.selection.executor === 'compatibility' ||
      (usesOpenCodeProvider && providerId && input.executor?.modelId) ||
      (providerMetadata && providerSecret),
  )
  check(
    checks,
    'provider_unavailable',
    providerReady,
    usesOpenCodeProvider
      ? providerReady
        ? 'OpenCode Provider 与 Model 已由用户确认；Provider credential 由 OpenCode 管理。'
        : '项目尚未确认 OpenCode Provider 与 Model。'
      : providerReady
        ? 'Native Coding Provider metadata 与本地加密 credential 可用。'
        : '项目所选 Native Coding Provider 缺少 metadata 或本地加密 credential。',
  )

  const paired = Boolean(pairing && pairing.localProjectId === input.projectId)
  check(
    checks,
    'team_project_unpaired',
    paired,
    paired ? '本地项目已绑定 Team Project。' : '请先把当前本地项目绑定到 Team Project。',
  )

  const active = codingRuns.find(
    (candidate) =>
      candidate.projectId === input.projectId && isActiveCodingAgentRunStatus(candidate.status),
  )
  check(
    checks,
    'active_run',
    !active,
    active ? `项目已有活动 Coding Run：${active.id}` : '项目当前没有其他活动 Coding Run。',
  )
  const pending = permissions.find(
    (candidate) => candidate.status === 'pending' && candidate.codingRunId === active?.id,
  )
  check(
    checks,
    'permission_pending',
    !pending,
    pending ? `已有待处理修改审批：${pending.id}` : '当前没有遗留的待处理修改审批。',
  )

  let budgetPolicy: RuntimeBudgetPolicy | null = null
  let budgetDecision: BudgetGuardDecision | undefined
  if (paired && configured && engineReady && capabilityReady && providerReady && providerId && workflowReady && project) {
    try {
      budgetPolicy = await input.getBudgetPolicy(project.id)
      check(
        checks,
        'budget_policy_missing',
        Boolean(budgetPolicy),
        budgetPolicy
          ? '项目已显式保存 Runtime Budget Policy。'
          : '请先确认并保存项目 Runtime Budget Policy。',
      )
      if (budgetPolicy) {
        const estimated = estimateNativeCodingWorstCaseCost({
          runId: input.runId,
          nodeId: input.nodeId,
          projectId: input.projectId,
          requestedBy: input.requestedBy,
          providerId,
          model: input.executor?.modelId ?? providerMetadata?.model ?? providerId,
          ...(input.executor?.billingProvider
            ? { billingProvider: input.executor.billingProvider }
            : {}),
          timestamp: evaluatedAt,
        })
        budgetDecision = await input.evaluateBudget({
          projectId: project.id,
          providerId,
          projectedCostUsd: estimated.costUsd,
          ...(input.runtimeBudgetApprovalId
            ? { approvalId: input.runtimeBudgetApprovalId }
            : {}),
        })
        check(
          checks,
          'budget_blocked',
          !budgetDecision.blocksRun,
          budgetDecision.reason,
        )
      }
    } catch {
      check(
        checks,
        'budget_policy_missing',
        false,
        '无法读取 Team Runtime Budget Policy；请检查配对和 API 连接。',
      )
    }
  } else {
    check(
      checks,
      'budget_policy_missing',
      false,
      '完成 Executor、Provider 与 Team Project 配对后才能校验预算。',
    )
  }

  return {
    projectId: input.projectId,
    runId: input.runId,
    nodeId: input.nodeId,
    status: checks.every((candidate) => candidate.status === 'ready') ? 'ready' : 'blocked',
    engine:
      input.executor?.engine && input.executor.engine !== 'not-configured'
        ? input.executor.engine
        : 'unconfigured',
    executor: input.selection.executor,
    availability: engineReady ? 'available' : 'unavailable',
    capabilities: availableCapabilities,
    providerRequirement:
      input.selection.executor === 'native-model'
        ? 'saved-provider'
        : usesOpenCodeProvider
          ? 'opencode-provider'
          : 'none',
    ...(providerId ? { providerId } : {}),
    ...(input.selection.configVersion > 0
      ? { configVersion: input.selection.configVersion }
      : {}),
    budgetPolicy,
    ...(budgetDecision ? { budgetDecision } : {}),
    checks,
    evaluatedAt,
  }
}
