import { useRef, type FormEvent } from 'react'
import {
  buildClarificationReviewBundle,
  canRunCodingAgentOnNode,
  canApproveGate,
  createWorkflowRunFromRequest,
  normalizeWorkflowRunProgress,
  redactSecrets,
  validateAgentProviderName,
  validateTestCommandSafety,
  type CodingPermissionDecision,
  type GateEnforcementDecision,
  type GitHubDeliveryIntent,
  type ManagedCodingWorkspace,
  type TeamMember,
  type ThemePreference,
  type WorkflowNode,
  type WorkflowRun,
  type StageAgentExecutorKind,
} from '@ai-devflow/shared'
import type { DevFlowDesktopApi } from '../desktop-api'
import {
  displayNodeTitle,
  mergeById,
  mergeLocalAndRemoteSnapshot,
  reviewProviderFromMetadata,
  slugifyBranchName,
} from './desktop-view-model'
import type { DesktopWorkspaceSetters, DesktopWorkspaceState } from './useDesktopWorkspace'
import type { PendingInspectorAction, PendingInspectorActionId } from './node-inspector-view-model'

const prDraftBindingFailureMessage =
  '当前 Local Project 与 Team Project 的绑定已失效，请重新绑定后再生成 PR Delivery Package'
const prDraftMissingBindingMessage =
  '请先将当前 Local Project 绑定到 Team Project，再生成 PR Delivery Package'
const browserPreviewWorkflowWriteMessage =
  '浏览器预览不执行工作流推进，请在 Electron 应用中继续'

const safePublisherOutcomeCopy = {
  content_scan_blocked: 'outbound content contains blocked credential material',
  content_scan_incomplete: 'outbound content scan did not complete safely',
  invalid_delivery_source: 'approved delivery source is invalid',
  operation_cancelled: 'publication was cancelled safely',
  publisher_cleanup_failed: 'credential cleanup failed safely',
  remote_branch_diverged: 'remote delivery branch points to another commit',
  remote_unavailable: 'remote GitHub branch is unavailable',
  repository_mismatch: 'local Git remote does not match the approved repository',
  push_result_unknown: 'exact push result requires reconciliation',
  workspace_dirty: 'managed workspace changed after approval',
  workspace_mismatch: 'managed workspace HEAD does not match the approved commit',
} as const

function formatSafePublisherOutcome(value: string | null): string {
  if (
    value &&
    Object.prototype.hasOwnProperty.call(safePublisherOutcomeCopy, value)
  ) {
    const code = value as keyof typeof safePublisherOutcomeCopy
    return `${code}: ${safePublisherOutcomeCopy[code]}`
  }
  return 'publisher_outcome_unavailable'
}

const safeStopOutcomes = new Set([
  'intent_not_found',
  'intent_terminal',
  'operation_cancelled',
  'stale_intent',
  'stop_unavailable',
])

function formatSafeStopOutcome(value: unknown): string {
  return typeof value === 'string' && safeStopOutcomes.has(value)
    ? value
    : 'stop_outcome_unavailable'
}

function prDraftFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  const knownBindingFailures = [
    'The workflow project is not bound to the paired Team project',
    'Pair Team Project before resolving remote project state.',
    'Paired Team Project is not bound to a local project.',
    'Paired Team Project is bound to a different local project.',
  ]

  return knownBindingFailures.some((failure) => message.includes(failure))
    ? prDraftBindingFailureMessage
    : message || '保存 PR Draft 失败'
}

export function useDesktopActions(input: {
  desktopApi: DevFlowDesktopApi | null
  state: DesktopWorkspaceState
  setters: DesktopWorkspaceSetters
  derived: {
    selectedLocalProject: DesktopWorkspaceState['localProjects'][number] | undefined
    isTestCommandDirty: boolean
  }
  selectedRun: WorkflowRun | undefined
  selectedNode: WorkflowNode | undefined
  currentUser: TeamMember | undefined
  pendingCodingPermission: DesktopWorkspaceState['codingPermissionRequests'][number] | undefined
  latestCodingRun: DesktopWorkspaceState['codingRuns'][number] | undefined
  selectedManagedWorkspace: ManagedCodingWorkspace | undefined
  selectedGitHubDeliveryIntent?: GitHubDeliveryIntent
  canVerifyGitHubDeliveryRevocation?: boolean
  gateEnforcementDecision: GateEnforcementDecision | null
  stageAgentExecutorKind?: StageAgentExecutorKind
  applyLocalExecutionState: (state: import('@ai-devflow/shared').LocalExecutionState) => void
}) {
  const {
    desktopApi,
    state,
    setters,
    derived,
    selectedRun,
    selectedNode,
    currentUser,
    pendingCodingPermission,
    latestCodingRun,
    selectedManagedWorkspace,
    selectedGitHubDeliveryIntent,
    canVerifyGitHubDeliveryRevocation = false,
    stageAgentExecutorKind = 'direct-provider',
    applyLocalExecutionState,
  } = input
  const {
    artifacts,
    events,
    testEvidence,
    runs,
    selectedRunId,
    teamProjects,
    testCommandDraft,
    commandSafety,
    desktopPairing,
    pairingCodeDraft,
    mcpServers,
    selectedAgentProviderId,
    providerNameDraft,
    providerBaseUrlDraft,
    providerModelDraft,
    providerKeyDraft,
    runtimeBudgetApprovalId,
    draftTitle,
    draftRequest,
    pendingInspectorAction,
    isRunningAgentReview,
    isStartingCodingAgent,
    isRunningTests,
  } = state
  const {
    setThemePreference,
    setDataOrigin,
    setActiveView,
    setRuns,
    setRemoteRunIds,
    setSelectedRunId,
    setSelectedNodeId,
    setArtifacts,
    setEvents,
    setTestEvidence,
    setLocalProjects,
    setTeamProjects,
    setTeamMembers,
    setTeamProjectCost,
    setTeamMemberCost,
    setTeamTotalCost,
    setSelectedLocalProjectId,
    setTestCommandDraft,
    setCommandSafety,
    setIsSavingTestCommand,
    setIsRunningTests,
    setIsSyncingRemote,
    setDesktopPairing,
    setPairingCodeDraft,
    setIsPairingDesktop,
    setMcpServers,
    setAgentProviders,
    setSelectedAgentProviderId,
    setAgentReviews,
    setAgentTraces,
    setAgentTokenUsage,
    setCodingRuns,
    setCodingEvents,
    setCodingPermissionRequests,
    setCodingPermissionDecisions,
    setManagedCodingWorkspaces,
    setDependencyBootstrapEvidence,
    setCodingDiffArtifacts,
    setRetryAttempts,
    setProviderKeyDraft,
    setRuntimeBudgetApprovalId,
    setIsRunningAgentReview,
    setIsStartingCodingAgent,
    setPendingInspectorAction,
    setIsNewRunOpen,
    setToast,
  } = setters
  const { selectedLocalProject, isTestCommandDirty } = derived
  const eventsRef = useRef(events)
  eventsRef.current = events
  const pendingInspectorActionRef = useRef(pendingInspectorAction)
  pendingInspectorActionRef.current = pendingInspectorAction
  const desktopPairingExpired = Boolean(
    desktopPairing?.expiresAt &&
      Number.isFinite(Date.parse(desktopPairing.expiresAt)) &&
      Date.parse(desktopPairing.expiresAt) <= Date.now(),
  )
  const activeDesktopPairing = desktopPairingExpired ? undefined : desktopPairing

  function samePendingInspectorAction(
    current: PendingInspectorAction | null,
    expected: PendingInspectorAction,
  ): boolean {
    return Boolean(
      current &&
        current.actionId === expected.actionId &&
        current.runId === expected.runId &&
        current.nodeId === expected.nodeId,
    )
  }

  function startPendingInspectorAction(
    actionId: PendingInspectorActionId,
    run: WorkflowRun,
    node: WorkflowNode,
    message: string,
  ): PendingInspectorAction {
    const pending: PendingInspectorAction = { actionId, runId: run.id, nodeId: node.id }
    pendingInspectorActionRef.current = pending
    setPendingInspectorAction(pending)
    setToast(message)
    return pending
  }

  function clearPendingInspectorAction(pending: PendingInspectorAction) {
    if (samePendingInspectorAction(pendingInspectorActionRef.current, pending)) {
      pendingInspectorActionRef.current = null
    }
    setPendingInspectorAction((current) => (samePendingInspectorAction(current, pending) ? null : current))
  }

  function hasInspectorWriteInFlight(): boolean {
    return Boolean(pendingInspectorActionRef.current) || isRunningAgentReview || isStartingCodingAgent || isRunningTests
  }

  function blockIfInspectorWriteInFlight(): boolean {
    if (!hasInspectorWriteInFlight()) {
      return false
    }

    setToast('其他 Inspector 操作正在进行中，请稍后再试')
    return true
  }

  function changeThemePreference(nextPreference: ThemePreference) {
    setThemePreference(nextPreference)
    if (!desktopApi) {
      return
    }

    void desktopApi.saveSettings({ themePreference: nextPreference }).catch((error: unknown) => {
      setToast(error instanceof Error ? error.message : '保存主题偏好失败')
    })
  }

  async function syncRemoteTeamState() {
    if (!desktopApi) {
      setToast('请在 Electron 应用中同步团队状态')
      return
    }

    if (!activeDesktopPairing?.organizationId) {
      setToast('请先 Pair Team Project 后再同步团队远端状态')
      return
    }

    setIsSyncingRemote(true)
    setToast('正在同步团队远端状态...')

    try {
      const snapshot = await desktopApi.loadRemoteSnapshot({
        organizationId: activeDesktopPairing.organizationId,
      })
      const remoteRuns = snapshot.runs.map(normalizeWorkflowRunProgress)
      const mergedSnapshot = mergeLocalAndRemoteSnapshot({
        localRuns: runs.map(normalizeWorkflowRunProgress),
        remoteRuns,
        localArtifacts: artifacts,
        remoteArtifacts: snapshot.artifacts,
        localEvents: eventsRef.current,
        remoteEvents: snapshot.events,
      })
      const nextRuns = mergedSnapshot.runs
      const nextRun =
        nextRuns.find((run) => run.id === selectedRunId) ??
        remoteRuns[0] ??
        nextRuns[0]

      setRuns(nextRuns)
      setRemoteRunIds(mergedSnapshot.remoteRunIds)
      setArtifacts(mergedSnapshot.artifacts)
      setEvents(mergedSnapshot.events)
      eventsRef.current = mergedSnapshot.events
      setTestEvidence(testEvidence)
      setTeamProjects(snapshot.projects)
      setTeamMembers(snapshot.members)
      setTeamProjectCost(snapshot.projectCost)
      setTeamMemberCost(snapshot.memberCost)
      setTeamTotalCost(snapshot.totalCost || '$0.00')
      setDataOrigin(
        snapshot.runs.length > 0 || snapshot.projects.length > 0 || snapshot.members.length > 0
          ? 'remote'
          : 'local',
      )

      if (nextRun) {
        setSelectedRunId(nextRun.id)
        setSelectedNodeId(nextRun.currentNodeId)
        setActiveView('workbench')
      }

      setToast('团队远端状态已同步，本地 Run 已保留并重新评估 Gate')
    } catch (error) {
      setToast(error instanceof Error ? error.message : '同步团队远端状态失败')
    } finally {
      setIsSyncingRemote(false)
    }
  }

  async function pairDesktopWithTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!desktopApi) {
      setToast('请在 Electron 应用中配对团队项目')
      return
    }

    if (!selectedLocalProject) {
      setToast('请先选择要绑定的本地仓库')
      return
    }

    const code = pairingCodeDraft.trim()
    if (!code) {
      setToast('请输入 Web Team Console 生成的 Desktop pairing code')
      return
    }

    setIsPairingDesktop(true)
    setToast('正在配对团队项目...')

    try {
      const result = await desktopApi.pairDesktop({
        code,
        localProjectId: selectedLocalProject.id,
      })
      setDesktopPairing(result.credential)
      setPairingCodeDraft('')
      setToast(
        `已绑定 ${result.credential.userName ?? result.credential.userId} / ${result.credential.role} 到 ${result.credential.projectName ?? result.credential.projectId}`,
      )
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Desktop 配对失败')
    } finally {
      setIsPairingDesktop(false)
    }
  }

  async function approveSelectedGate() {
    if (!selectedRun || !selectedNode || !currentUser) {
      return
    }

    if (!canApproveGate(currentUser.role, selectedNode)) {
      setToast('当前角色无权通过这个 Gate')
      return
    }

    if (blockIfInspectorWriteInFlight()) {
      return
    }

    if (!desktopApi) {
      setToast(browserPreviewWorkflowWriteMessage)
      return
    }

    const pending = startPendingInspectorAction('approveGate', selectedRun, selectedNode, '正在通过 Gate...')
    try {
      const clarificationBundle =
        selectedNode.kind === 'gate' && selectedNode.stage === 'clarify'
          ? buildClarificationReviewBundle({
              run: selectedRun,
              gateNode: selectedNode,
              artifacts,
            })
          : undefined
      const clarificationMetadata = clarificationBundle?.activeRevision?.clarificationRevision
      const result = await desktopApi.approveGate({
        runId: selectedRun.id,
        nodeId: selectedNode.id,
        ...(clarificationBundle?.state === 'ready' && clarificationBundle.activeRevision && clarificationMetadata
          ? {
              expectedClarificationRevision: {
                artifactId: clarificationBundle.activeRevision.id,
                revision: clarificationMetadata.revision,
                revisionDigest: clarificationMetadata.revisionDigest,
              },
            }
          : {}),
      })
      applyLocalExecutionState(result.state)
      const nextNode = result.run.nodes.find((node) => node.id === result.run.currentNodeId)
      setToast(
        result.run.status === 'completed'
          ? `${displayNodeTitle(selectedNode)} 已通过，Run 已完成`
          : nextNode?.stage === 'build'
            ? `${displayNodeTitle(selectedNode)} 已通过，Run 进入本地实现阶段`
            : `${displayNodeTitle(selectedNode)} 已通过，流程已推进`,
      )
    } catch (error) {
      setToast(error instanceof Error ? error.message : '保存 Gate 审批失败')
    } finally {
      clearPendingInspectorAction(pending)
    }
  }

  async function completeSelectedWorkflowAgentNode() {
    if (!selectedRun || !selectedNode || !currentUser) {
      return
    }
    if (selectedNode.kind !== 'agent') {
      setToast('只有 Agent 节点可以生成阶段产物')
      return
    }
    if (selectedRun.currentNodeId !== selectedNode.id) {
      setToast('只能完成当前运行中的 Agent 节点')
      return
    }

    const successToast =
      selectedNode.stage === 'clarify'
        ? '需求澄清已生成，进入需求确认 Gate'
        : '设计方案已生成，进入方案评审 Gate'

    if (!desktopApi) {
      setToast(browserPreviewWorkflowWriteMessage)
      return
    }
    if (stageAgentExecutorKind === 'direct-provider' && !selectedAgentProviderId) {
      setToast('请先在 Agents 的 Runtime Settings 配置 Agent Provider：Provider Name、Base URL、Model 和 API Key')
      return
    }
    if (blockIfInspectorWriteInFlight()) {
      return
    }
    const pending = startPendingInspectorAction(
      'completeAgent',
      selectedRun,
      selectedNode,
      selectedNode.stage === 'clarify' ? '正在生成需求澄清...' : '正在生成设计方案...',
    )
    try {
      const result = await desktopApi.completeWorkflowAgentNode({
        runId: selectedRun.id,
        nodeId: selectedNode.id,
        userId: currentUser.id,
        userName: currentUser.name,
        executor: stageAgentExecutorKind,
        ...(stageAgentExecutorKind === 'direct-provider'
          ? { providerId: selectedAgentProviderId }
          : {}),
      })
      applyLocalExecutionState(result.state)
      setSelectedRunId(result.run.id)
      setSelectedNodeId(result.run.currentNodeId)
      setActiveView('workbench')
      setToast(successToast)
    } catch (error) {
      setToast(error instanceof Error ? error.message : '生成阶段产物失败')
    } finally {
      clearPendingInspectorAction(pending)
    }
  }

  async function requestSelectedClarificationChanges(reason: string) {
    if (
      !desktopApi?.requestClarificationChanges || !selectedRun || !selectedNode ||
      selectedNode.kind !== 'gate' || selectedNode.stage !== 'clarify'
    ) {
      return
    }
    const bundle = buildClarificationReviewBundle({
      run: selectedRun,
      gateNode: selectedNode,
      artifacts,
    })
    const metadata = bundle.activeRevision?.clarificationRevision
    if (bundle.state !== 'ready' || !bundle.activeRevision || !metadata) {
      setToast(bundle.message)
      return
    }
    if (blockIfInspectorWriteInFlight()) return
    const pending = startPendingInspectorAction(
      'approveGate',
      selectedRun,
      selectedNode,
      '正在提交澄清修订意见...',
    )
    try {
      const result = await desktopApi.requestClarificationChanges({
        runId: selectedRun.id,
        nodeId: selectedNode.id,
        artifactId: bundle.activeRevision.id,
        revision: metadata.revision,
        revisionDigest: metadata.revisionDigest,
        reason,
      })
      applyLocalExecutionState(result.state)
      setSelectedRunId(result.run.id)
      setSelectedNodeId(result.run.currentNodeId)
      setToast(`已请求修订 Clarification v${metadata.revision}，流程返回需求澄清`)
    } catch (error) {
      setToast(error instanceof Error ? error.message : '提交澄清修订意见失败')
    } finally {
      clearPendingInspectorAction(pending)
    }
  }

  async function selectLocalProject() {
    if (!desktopApi) {
      setToast('请在 Electron 应用中选择本地仓库')
      return
    }

    try {
      const project = await desktopApi.selectLocalProject()
      if (!project) {
        setToast('已取消选择本地仓库')
        return
      }

      setLocalProjects((previous) => mergeById(previous, [project]))
      setSelectedLocalProjectId(project.id)
      setTestCommandDraft(project.testCommand)
      setToast(`已连接本地仓库：${project.name}`)
    } catch (error) {
      setToast(error instanceof Error ? error.message : '选择本地仓库失败')
    }
  }

  async function saveTestCommand() {
    if (!desktopApi || !selectedLocalProject) {
      setToast('请先选择本地仓库')
      return
    }
    if (!isTestCommandDirty) {
      setToast('测试命令已是最新')
      return
    }

    try {
      setIsSavingTestCommand(true)
      const localSafety = validateTestCommandSafety(testCommandDraft)
      const safety =
        commandSafety?.normalizedCommand === localSafety.normalizedCommand
          ? commandSafety
          : localSafety
      if (safety.level === 'blocked') {
        setCommandSafety(safety)
        setToast(`测试命令已阻断：${safety.reasons.join(' ')}`)
        return
      }

      const project = await desktopApi.saveProjectTestCommand({
        projectId: selectedLocalProject.id,
        testCommand: safety.normalizedCommand,
      })
      setLocalProjects((previous) => mergeById(previous, [project]))
      setSelectedLocalProjectId(project.id)
      setToast(safety.level === 'warn' ? '测试命令已保存，运行前请确认风险提示' : '测试命令已保存')
    } catch (error) {
      setToast(error instanceof Error ? error.message : '保存测试命令失败')
    } finally {
      setIsSavingTestCommand(false)
    }
  }

  async function executeTestPlan() {
    if (!selectedRun) {
      return
    }

    if (!desktopApi) {
      setToast('请在 Electron 应用中执行本地测试')
      return
    }

    if (!selectedLocalProject) {
      setToast('请先选择本地仓库')
      return
    }

    const testNode = selectedRun.nodes.find((node) => node.id === selectedRun.currentNodeId)
    if (
      !testNode ||
      testNode.kind !== 'test' ||
      testNode.stage !== 'test' ||
      (testNode.status !== 'running' && testNode.status !== 'failed')
    ) {
      setToast('只能执行当前运行中或失败的测试节点')
      return
    }

    const commandDraft = testCommandDraft || selectedLocalProject.testCommand
    const localSafety = validateTestCommandSafety(commandDraft)
    const safety =
      commandSafety?.normalizedCommand === localSafety.normalizedCommand
        ? commandSafety
        : localSafety
    if (safety.level === 'blocked') {
      setCommandSafety(safety)
      setToast(`测试命令已阻断：${safety.reasons.join(' ')}`)
      return
    }

    setIsRunningTests(true)
    setToast('正在执行本地测试命令...')

    try {
      const result = await desktopApi.runProjectTests({
        projectId: selectedLocalProject.id,
        runId: selectedRun.id,
        nodeId: testNode.id,
      })
      applyLocalExecutionState(result.state)
      setSelectedRunId(selectedRun.id)
      setSelectedNodeId(testNode.id)
      setActiveView('tests')
      setToast(result.evidence.status === 'passed' ? '测试通过，证据已归档' : '测试失败，证据已归档')
    } catch (error) {
      setToast(error instanceof Error ? error.message : '本地测试执行失败')
    } finally {
      setIsRunningTests(false)
    }
  }

  async function saveAgentProviderCredential() {
    if (!desktopApi) {
      setToast('请在 Electron 应用中保存 Review Model Credential')
      return
    }

    const providerNameValidation = validateAgentProviderName(providerNameDraft)
    const baseUrl = providerBaseUrlDraft.trim()
    const model = providerModelDraft.trim()

    if (!providerKeyDraft.trim()) {
      setToast('请输入 API Key')
      return
    }
    if (!providerNameValidation.ok) {
      setToast(providerNameValidation.message)
      return
    }
    if (!model) {
      setToast('请输入 Model')
      return
    }

    try {
      const metadata = await desktopApi.saveAgentProviderCredential({
        name: providerNameValidation.name,
        apiKey: providerKeyDraft,
        model,
        ...(baseUrl ? { baseUrl } : {}),
      })
      const providers = await desktopApi.listAgentProviders()
      setAgentProviders(mergeById(providers, [reviewProviderFromMetadata(metadata)]))
      setSelectedAgentProviderId(metadata.providerId)
      setProviderKeyDraft('')
      setToast(`已保存并选择 Provider：${reviewProviderFromMetadata(metadata).name} · ${metadata.maskedCredential}`)
    } catch (error) {
      setToast(error instanceof Error ? error.message : '保存 Agent Provider 失败')
    }
  }

  async function runKnowledgeReview() {
    if (!selectedRun || !selectedNode || !currentUser) {
      return
    }

    if (!desktopApi) {
      setToast('请在 Electron 应用中运行基于知识的门禁审查')
      return
    }
    if (!selectedAgentProviderId) {
      setToast('请先在 Runtime Settings 配置 Agent Provider：Provider Name、Base URL、Model 和 API Key')
      return
    }

    setIsRunningAgentReview(true)
    setToast('基于知识的门禁审查正在生成审查意见...')

    try {
      const result = await desktopApi.runKnowledgeReview({
        runId: selectedRun.id,
        nodeId: selectedNode.id,
        projectId: selectedRun.projectId,
        requestedBy: currentUser.id,
        runtime: 'electron',
        providerId: selectedAgentProviderId,
        ...(runtimeBudgetApprovalId.trim()
          ? { runtimeBudgetApprovalId: runtimeBudgetApprovalId.trim() }
          : {}),
      })
      applyLocalExecutionState(result.state)
      setSelectedRunId(result.review.runId)
      setSelectedNodeId(result.review.nodeId)
      setActiveView('agents')
      setToast('基于知识的门禁审查已归档，Gate Advisory 已生成')
    } catch (error) {
      setToast(error instanceof Error ? error.message : '基于知识的门禁审查运行失败')
    } finally {
      setIsRunningAgentReview(false)
    }
  }

  async function runCodingAgent() {
    if (!selectedRun || !selectedNode || !currentUser) {
      return
    }
    if (blockIfInspectorWriteInFlight()) {
      return
    }
    if (!desktopApi) {
      setToast('请在 Electron 应用中运行 Coding Agent')
      return
    }
    if (!selectedLocalProject) {
      setToast('请先选择本地 Git 仓库')
      return
    }
    if (!canRunCodingAgentOnNode(selectedNode)) {
      setToast('Coding Agent 只能从开发实现任务节点启动')
      return
    }

    setIsStartingCodingAgent(true)
    setToast('正在创建 managed worktree 并启动 Coding Agent...')

    try {
      const result = await desktopApi.runCodingAgent({
        runId: selectedRun.id,
        nodeId: selectedNode.id,
        projectId: selectedLocalProject.id,
        requestedBy: currentUser.id,
        userInstruction: `Implement ${displayNodeTitle(selectedNode)} with the existing DevFlow context.`,
        ...(runtimeBudgetApprovalId.trim() ? { runtimeBudgetApprovalId: runtimeBudgetApprovalId.trim() } : {}),
      })
      applyLocalExecutionState(result.state)
      setSelectedRunId(result.codingRun.runId)
      setSelectedNodeId(result.codingRun.nodeId)
      setActiveView('agents')
      setToast('Coding Agent 已请求权限，请在 Agents 视图批准或拒绝')
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Coding Agent 启动失败')
    } finally {
      setIsStartingCodingAgent(false)
    }
  }

  async function startRemediationRetry(candidateId: string) {
    if (!selectedRun || !selectedNode || !currentUser) {
      return
    }
    if (blockIfInspectorWriteInFlight()) {
      return
    }
    if (!desktopApi) {
      setToast('请在 Electron 应用中启动 remediation retry')
      return
    }
    if (!selectedLocalProject) {
      setToast('请先选择本地 Git 仓库')
      return
    }

    setIsStartingCodingAgent(true)
    setToast('正在按 Remediation Plan 启动 Coding Retry...')

    try {
      const result = await desktopApi.startRetryAttempt({
        runId: selectedRun.id,
        nodeId: selectedNode.id,
        projectId: selectedLocalProject.id,
        requestedBy: currentUser.id,
        candidateIds: [candidateId],
        userInstruction: 'Apply the selected remediation candidate with the smallest safe change.',
      })
      applyLocalExecutionState(result.state)
      setRetryAttempts((previous) => mergeById(previous, [result.retryAttempt]))
      setSelectedRunId(result.codingRun.runId)
      setSelectedNodeId(result.codingRun.nodeId)
      setActiveView('agents')
      setToast('Remediation retry 已启动，请在 Agents 视图处理权限请求')
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Remediation retry 启动失败')
    } finally {
      setIsStartingCodingAgent(false)
    }
  }

  async function replyCodingPermission(decision: CodingPermissionDecision['decision']) {
    if (!desktopApi || !pendingCodingPermission || !currentUser) {
      return
    }

    const isBootstrapPermission = pendingCodingPermission.origin === 'dependency_bootstrap'
    try {
      await desktopApi.replyCodingPermission({
        requestId: pendingCodingPermission.id,
        codingRunId: pendingCodingPermission.codingRunId,
        decidedBy: currentUser.id,
        decision,
        comment: decision === 'approved' ? 'Approved from DevFlow Agent Workbench.' : 'Rejected from DevFlow Agent Workbench.',
      })
      applyLocalExecutionState(await desktopApi.loadState())
      setToast(
        decision === 'approved'
          ? isBootstrapPermission
            ? '依赖安装已批准，Coding Agent 正在继续运行'
            : 'Coding Agent 已完成 diff 归档'
          : isBootstrapPermission
            ? '依赖安装已拒绝，Coding Agent 已安全停止'
            : 'Coding Agent 权限已拒绝',
      )
    } catch (error) {
      setToast(error instanceof Error ? error.message : '权限回复失败')
    }
  }

  async function cancelCodingRun() {
    if (!desktopApi || !latestCodingRun) {
      return
    }

    try {
      await desktopApi.cancelCodingAgentRun({ codingRunId: latestCodingRun.id })
      applyLocalExecutionState(await desktopApi.loadState())
      setToast('Coding Agent Run 已中断')
    } catch (error) {
      setToast(error instanceof Error ? error.message : '中断 Coding Agent 失败')
    }
  }

  async function openCodingWorktree() {
    if (!desktopApi || !selectedManagedWorkspace) {
      return
    }

    try {
      await desktopApi.openManagedWorktree({ workspaceId: selectedManagedWorkspace.id })
      setToast('Managed worktree 已打开')
    } catch (error) {
      setToast(error instanceof Error ? error.message : '打开 managed worktree 失败')
    }
  }

  async function deleteCodingWorktree() {
    if (!desktopApi || !selectedManagedWorkspace) {
      return
    }

    try {
      await desktopApi.deleteManagedWorktree({ workspaceId: selectedManagedWorkspace.id })
      applyLocalExecutionState(await desktopApi.loadState())
      setToast('Managed worktree 已删除')
    } catch (error) {
      setToast(error instanceof Error ? error.message : '删除 managed worktree 失败')
    }
  }

  async function createRun() {
    const title = draftTitle.trim()
    const request = draftRequest.trim()
    if (!title || !request) {
      setToast('请输入真实 Run 标题和需求描述')
      return
    }

    const createInput = {
      title,
      request,
      projectId:
        selectedLocalProject?.id ??
        teamProjects[0]?.id ??
        'local-unassigned',
      creatorId: currentUser?.id ?? 'local-user',
      branchName: `ai/${slugifyBranchName(title) || 'new-run'}`,
    }

    setIsNewRunOpen(false)
    setToast('新 Run 已创建，正在进行需求澄清')

    if (desktopApi) {
      try {
        const persistedRun = await desktopApi.createRun(createInput)
        const nextState = await desktopApi.loadState()
        applyLocalExecutionState(nextState)
        setRuns((previousRuns) =>
          previousRuns.some((run) => run.id === persistedRun.id)
            ? previousRuns.map((run) => (run.id === persistedRun.id ? persistedRun : run))
            : [persistedRun, ...previousRuns],
        )
        setSelectedRunId(persistedRun.id)
        setSelectedNodeId(persistedRun.currentNodeId)
      } catch (error) {
        setToast(error instanceof Error ? error.message : '保存新 Run 失败')
      }
      return
    }

    const created = createWorkflowRunFromRequest({
      ...createInput,
      runId: `run-${Date.now()}`,
      now: new Date().toISOString(),
    })
    setRuns((previousRuns) => [created.run, ...previousRuns])
    setArtifacts((previousArtifacts) => mergeById(previousArtifacts, created.artifacts))
    setEvents((previousEvents) => mergeById(previousEvents, created.events))
    setSelectedRunId(created.run.id)
    setSelectedNodeId(created.run.currentNodeId)
  }

  async function deleteRun(targetRun: WorkflowRun, options: { deleteRemote: boolean }): Promise<boolean> {
    if (!desktopApi) {
      setToast('请在 Electron 应用中删除 Run')
      return false
    }

    try {
      const result = await desktopApi.deleteRun({
        runId: targetRun.id,
        deleteRemote: options.deleteRemote,
      })
      applyLocalExecutionState(result.state)
      setToast(options.deleteRemote ? 'Run 已删除，远端和本地状态已刷新' : '本地 Run 已删除')
      return true
    } catch (error) {
      setToast(error instanceof Error ? error.message : '删除 Run 失败')
      return false
    }
  }

  async function generatePrDraft() {
    if (!selectedRun) {
      return
    }

    const node = selectedRun.nodes.find((candidate) => candidate.id === selectedRun.currentNodeId)
    if (
      !node ||
      node.kind !== 'pr' ||
      node.stage !== 'pr' ||
      node.status !== 'running'
    ) {
      setToast('只能为当前 PR 节点生成 PR Delivery Package')
      return
    }
    if (!desktopApi) {
      setToast(browserPreviewWorkflowWriteMessage)
      return
    }
    if (activeDesktopPairing?.localProjectId !== selectedRun.projectId) {
      setToast(prDraftMissingBindingMessage)
      return
    }
    if (blockIfInspectorWriteInFlight()) {
      return
    }

    const pending = startPendingInspectorAction('createPrDraft', selectedRun, node, '正在生成 PR Delivery Package...')
    try {
      const result = await desktopApi.createPrDraft({
        runId: selectedRun.id,
        nodeId: node.id,
      })
      applyLocalExecutionState(result.state)
      setSelectedRunId(result.run.id)
      setSelectedNodeId(result.run.currentNodeId)
      setToast('PR Delivery Package 已生成；请显式 Prepare GitHub Delivery')
    } catch (error) {
      setToast(prDraftFailureMessage(error))
    } finally {
      clearPendingInspectorAction(pending)
    }
  }

  async function prepareSelectedGitHubDelivery() {
    if (!selectedRun) {
      return
    }
    const node = selectedRun.nodes.find((candidate) => candidate.id === selectedRun.currentNodeId)
    if (!node || node.kind !== 'pr' || node.stage !== 'pr' || node.status !== 'running') {
      setToast('只能为当前运行中的 PR 节点准备 GitHub Delivery')
      return
    }
    const exactPackage = artifacts.find((artifact) => (
      artifact.runId === selectedRun.id &&
      artifact.nodeId === node.id &&
      artifact.kind === 'pr' &&
      artifact.redacted === true &&
      artifact.githubDeliverySource?.stateVersion === 1 &&
      node.artifactIds.includes(artifact.id)
    ))
    if (!exactPackage) {
      setToast('请先生成并附加精确且已脱敏的 PR Delivery Package')
      return
    }
    if (!desktopApi) {
      setToast(browserPreviewWorkflowWriteMessage)
      return
    }
    if (activeDesktopPairing?.localProjectId !== selectedRun.projectId) {
      setToast('请先将当前 Local Project 绑定到 Team Project，再准备 GitHub Delivery')
      return
    }
    if (blockIfInspectorWriteInFlight()) {
      return
    }

    const pending = startPendingInspectorAction(
      'prepareGitHubDelivery',
      selectedRun,
      node,
      '正在准备精确 GitHub Delivery...',
    )
    let prepared = false
    try {
      const result = await desktopApi.prepareGitHubDelivery({
        runId: selectedRun.id,
        nodeId: node.id,
      })
      prepared = true
      if (result.status === 'tests_failed') {
        setToast('GitHub Delivery 准备测试未通过；未开始远端交付')
      } else if (result.replayed) {
        setToast('已复核现有 GitHub Delivery Intent；不会重复创建远端请求')
      } else {
        setToast('GitHub Delivery 已准备，等待 Web lead/owner 显式审批')
      }
    } catch {
      setToast('GitHub Delivery 准备失败；未开始新的远端交付，请检查绑定、交付包与测试证据')
    } finally {
      try {
        applyLocalExecutionState(await desktopApi.loadState())
      } catch {
        if (prepared) {
          setToast('GitHub Delivery 命令已返回，但本地状态刷新失败；请等待状态推送或重新打开当前 Run')
        }
      }
      clearPendingInspectorAction(pending)
    }
  }

  async function replaceSelectedGitHubDelivery(kind: 'revise' | 'retry') {
    if (!selectedRun || !selectedGitHubDeliveryIntent) {
      return
    }
    const node = selectedRun.nodes.find((candidate) => candidate.id === selectedRun.currentNodeId)
    const eligible = kind === 'revise'
      ? selectedGitHubDeliveryIntent.status === 'approval_required' ||
        selectedGitHubDeliveryIntent.status === 'approved'
      : selectedGitHubDeliveryIntent.status === 'failed' ||
        selectedGitHubDeliveryIntent.status === 'revoked'
    if (
      !node ||
      node.kind !== 'pr' ||
      node.stage !== 'pr' ||
      node.status !== 'running' ||
      selectedGitHubDeliveryIntent.runId !== selectedRun.id ||
      selectedGitHubDeliveryIntent.nodeId !== node.id ||
      !eligible
    ) {
      setToast(kind === 'revise'
        ? '只有当前 approval_required/approved GitHub Delivery 才能显式 Revise'
        : '只有当前 failed/revoked GitHub Delivery 才能显式 Retry')
      return
    }
    if (!desktopApi) {
      setToast(browserPreviewWorkflowWriteMessage)
      return
    }
    if (activeDesktopPairing?.localProjectId !== selectedRun.projectId) {
      setToast('当前 Local Project 与 Team Project 未绑定，不能修改 GitHub Delivery')
      return
    }
    if (blockIfInspectorWriteInFlight()) {
      return
    }

    const actionId = kind === 'revise'
      ? 'reviseGitHubDelivery' as const
      : 'retryGitHubDelivery' as const
    const pending = startPendingInspectorAction(
      actionId,
      selectedRun,
      node,
      kind === 'revise'
        ? '正在重新提交、复验并创建不可变 GitHub Delivery revision...'
        : '正在重新提交、复验并创建新的 GitHub Delivery attempt...',
    )
    let replaced = false
    try {
      const input = {
        intentId: selectedGitHubDeliveryIntent.id,
        expectedUpdatedAt: selectedGitHubDeliveryIntent.updatedAt,
      }
      const result = kind === 'revise'
        ? await desktopApi.reviseGitHubDelivery(input)
        : await desktopApi.retryGitHubDelivery(input)
      if (result.status === 'tests_failed') {
        setToast('GitHub Delivery 复验失败；旧 intent 状态保持不变，不会提交新审批')
      } else {
        replaced = true
        setToast(kind === 'revise'
          ? 'GitHub Delivery revision 已创建；旧审批不可复用，请在 Web 重新审批'
          : '新的 GitHub Delivery attempt 已创建；不会复用旧审批')
      }
    } catch {
      setToast(kind === 'revise'
        ? 'GitHub Delivery Revise 未完成；不会自动重试，请以刷新后的状态为准'
        : 'GitHub Delivery Retry 未完成；若当前 pairing 无法证明旧终态，请重新认领新的 Work Request/Run')
    } finally {
      try {
        applyLocalExecutionState(await desktopApi.loadState())
      } catch {
        if (replaced) {
          setToast('GitHub Delivery 操作已返回，但本地状态刷新失败；请等待状态推送后再操作')
        }
      }
      clearPendingInspectorAction(pending)
    }
  }

  async function reviseSelectedGitHubDelivery() {
    return replaceSelectedGitHubDelivery('revise')
  }

  async function retrySelectedGitHubDelivery() {
    return replaceSelectedGitHubDelivery('retry')
  }

  async function resumeSelectedGitHubDelivery() {
    if (!selectedRun || !selectedGitHubDeliveryIntent) {
      return
    }
    const node = selectedRun.nodes.find((candidate) => candidate.id === selectedRun.currentNodeId)
    if (
      !node ||
      node.kind !== 'pr' ||
      node.stage !== 'pr' ||
      node.status !== 'running' ||
      selectedGitHubDeliveryIntent.runId !== selectedRun.id ||
      selectedGitHubDeliveryIntent.nodeId !== node.id ||
      selectedGitHubDeliveryIntent.status !== 'recovery_required'
    ) {
      setToast('只有当前 recovery_required GitHub Delivery 才能显式 Resume')
      return
    }
    if (!desktopApi) {
      setToast(browserPreviewWorkflowWriteMessage)
      return
    }
    if (activeDesktopPairing?.localProjectId !== selectedRun.projectId) {
      setToast('当前 Local Project 与 Team Project 未绑定，不能恢复 GitHub Delivery')
      return
    }
    if (blockIfInspectorWriteInFlight()) {
      return
    }

    const pending = startPendingInspectorAction(
      'resumeGitHubDelivery',
      selectedRun,
      node,
      '正在按精确 intent 版本恢复 GitHub Delivery...',
    )
    let resumed = false
    try {
      const result = await desktopApi.resumeGitHubDelivery({
        intentId: selectedGitHubDeliveryIntent.id,
        expectedUpdatedAt: selectedGitHubDeliveryIntent.updatedAt,
      })
      resumed = true
      if (result.disposition === 'recovery_required') {
        setToast(
          `GitHub Delivery 仍需恢复；自动处理保持停止（${formatSafePublisherOutcome(result.outcomeCode)}）`,
        )
      } else if (result.disposition === 'local_conflict') {
        setToast('GitHub Delivery 本地状态已变化（stale/local conflict）；Resume 未被接受，请以刷新后的状态为准')
      } else if (result.disposition === 'failed' || result.disposition === 'revoked') {
        setToast('GitHub Delivery 已安全停止，不会自动重试')
      } else {
        setToast('GitHub Delivery Resume 已接受，后续状态将由本地处理器刷新')
      }
    } catch {
      setToast('GitHub Delivery Resume 响应未完成；不会自动重试，请以刷新后的本地持久化状态为准')
    } finally {
      try {
        applyLocalExecutionState(await desktopApi.loadState())
      } catch {
        if (resumed) {
          setToast('GitHub Delivery Resume 已返回，但本地状态刷新失败；请等待状态推送后再操作')
        }
      }
      clearPendingInspectorAction(pending)
    }
  }

  async function stopSelectedGitHubDelivery() {
    if (!selectedRun || !selectedGitHubDeliveryIntent) {
      return
    }
    const node = selectedRun.nodes.find((candidate) => candidate.id === selectedRun.currentNodeId)
    const stoppableStatuses: ReadonlySet<GitHubDeliveryIntent['status']> = new Set([
      'approval_required',
      'approved',
      'publishing_branch',
      'branch_published',
      'creating_pr',
    ])
    if (
      !node ||
      node.kind !== 'pr' ||
      node.stage !== 'pr' ||
      node.status !== 'running' ||
      selectedGitHubDeliveryIntent.runId !== selectedRun.id ||
      selectedGitHubDeliveryIntent.nodeId !== node.id ||
      !stoppableStatuses.has(selectedGitHubDeliveryIntent.status)
    ) {
      setToast('只有当前活动 GitHub Delivery 才能显式 Stop')
      return
    }
    if (!desktopApi) {
      setToast(browserPreviewWorkflowWriteMessage)
      return
    }
    if (blockIfInspectorWriteInFlight()) {
      return
    }

    const pending = startPendingInspectorAction(
      'stopGitHubDelivery',
      selectedRun,
      node,
      '正在按精确 intent 版本停止 GitHub Delivery...',
    )
    let stopped = false
    try {
      const result = await desktopApi.stopGitHubDelivery({
        intentId: selectedGitHubDeliveryIntent.id,
        expectedUpdatedAt: selectedGitHubDeliveryIntent.updatedAt,
      })
      stopped = result.disposition === 'stopped'
      if (result.disposition === 'stopped') {
        setToast('GitHub Delivery 已安全停止（operation_cancelled）；scheduler 不会自动续跑')
      } else if (result.disposition === 'already_terminal') {
        setToast('GitHub Delivery 已是终态（intent_terminal）；Stop 未改变状态')
      } else {
        setToast(
          `GitHub Delivery Stop 未被接受（${formatSafeStopOutcome(result.outcomeCode)}）；请以刷新后的状态为准`,
        )
      }
    } catch {
      setToast('GitHub Delivery Stop 响应未完成；请以刷新后的本地持久化状态为准')
    } finally {
      try {
        applyLocalExecutionState(await desktopApi.loadState())
      } catch {
        if (stopped) {
          setToast('GitHub Delivery Stop 已返回，但本地状态刷新失败；请等待状态推送后再操作')
        }
      }
      clearPendingInspectorAction(pending)
    }
  }

  async function verifySelectedGitHubDeliveryRevocation() {
    if (!selectedRun || !selectedNode || !selectedGitHubDeliveryIntent) {
      return
    }
    const prNodes = selectedRun.nodes.filter(
      (node) => node.kind === 'pr' && node.stage === 'pr',
    )
    const isExactDeliverySurface = selectedNode.kind === 'pr'
      ? selectedGitHubDeliveryIntent.nodeId === selectedNode.id
      : selectedNode.kind === 'acceptance' &&
        prNodes.length === 1 &&
        selectedGitHubDeliveryIntent.nodeId === prNodes[0]!.id &&
        Boolean(selectedRun.pullRequestUrl) &&
        selectedGitHubDeliveryIntent.completion?.pullRequestUrl === selectedRun.pullRequestUrl
    if (
      selectedGitHubDeliveryIntent.runId !== selectedRun.id ||
      selectedGitHubDeliveryIntent.status !== 'completed' ||
      !isExactDeliverySurface ||
      !canVerifyGitHubDeliveryRevocation
    ) {
      setToast('Credential revocation 未验证；授权阻断证明不可用')
      return
    }
    if (!desktopApi) {
      setToast(browserPreviewWorkflowWriteMessage)
      return
    }
    if (blockIfInspectorWriteInFlight()) {
      return
    }

    const pending = startPendingInspectorAction(
      'verifyGitHubDeliveryRevocation',
      selectedRun,
      selectedNode,
      '正在验证 credential revocation...',
    )
    try {
      const result = await desktopApi.verifyGitHubDeliveryRevocation({
        intentId: selectedGitHubDeliveryIntent.id,
        expectedUpdatedAt: selectedGitHubDeliveryIntent.updatedAt,
      })
      setToast(
        result.intentId === selectedGitHubDeliveryIntent.id &&
        result.disposition === 'blocked' &&
        result.outcomeCode === 'binding_inactive'
          ? 'Credential revocation 已验证：binding_inactive'
          : result.outcomeCode === 'credential_revocation_pending'
            ? 'Credential revocation 仍在安全隔离，请稍后重试'
          : 'Credential revocation 未验证；授权阻断证明不可用',
      )
    } catch {
      setToast('Credential revocation 未验证；授权阻断证明不可用')
    } finally {
      try {
        applyLocalExecutionState(await desktopApi.loadState())
      } catch {
        // The fixed proof result stays safe; a later state push or reload may recover the evidence.
      }
      clearPendingInspectorAction(pending)
    }
  }

  async function generateAcceptanceBundle() {
    if (!selectedRun) {
      return
    }
    const node = selectedRun.nodes.find((candidate) => candidate.id === selectedRun.currentNodeId)
    if (
      !node ||
      node.kind !== 'acceptance' ||
      node.stage !== 'accept' ||
      (node.status !== 'running' && node.status !== 'blocked')
    ) {
      setToast('只能为当前验收节点生成验收证据包')
      return
    }
    if (!desktopApi) {
      setToast(browserPreviewWorkflowWriteMessage)
      return
    }
    if (blockIfInspectorWriteInFlight()) {
      return
    }

    const pending = startPendingInspectorAction(
      'createAcceptanceBundle',
      selectedRun,
      node,
      '正在生成验收证据包...',
    )
    try {
      const result = await desktopApi.createAcceptanceBundle({
        runId: selectedRun.id,
        nodeId: node.id,
      })
      applyLocalExecutionState(result.state)
      setSelectedRunId(result.run.id)
      setSelectedNodeId(result.run.currentNodeId)
      setToast('验收证据包已生成')
    } catch (error) {
      setToast(error instanceof Error ? error.message : '保存验收证据包失败')
    } finally {
      clearPendingInspectorAction(pending)
    }
  }

  function toggleMcp(serverId: string) {
    setMcpServers((servers) => {
      const updatedServers = servers.map((server) =>
        server.id === serverId ? { ...server, enabledLocally: !server.enabledLocally } : server,
      )

      if (desktopApi) {
        void desktopApi.saveMcpServers(updatedServers).catch((error: unknown) => {
          setToast(error instanceof Error ? error.message : '保存 MCP 状态失败')
        })
      }

      return updatedServers
    })
  }

  function redactPreview() {
    const sample = 'ANTHROPIC_API_KEY=sk-ant-1234567890abcdefghijklmnop'
    setToast(redactSecrets(sample).value)
  }

  return {
    changeThemePreference,
    syncRemoteTeamState,
    pairDesktopWithTeam,
    approveSelectedGate,
    completeSelectedWorkflowAgentNode,
    requestSelectedClarificationChanges,
    selectLocalProject,
    saveTestCommand,
    executeTestPlan,
    saveAgentProviderCredential,
    runKnowledgeReview,
    runCodingAgent,
    startRemediationRetry,
    replyCodingPermission,
    cancelCodingRun,
    openCodingWorktree,
    deleteCodingWorktree,
    createRun,
    deleteRun,
    generatePrDraft,
    prepareSelectedGitHubDelivery,
    reviseSelectedGitHubDelivery,
    retrySelectedGitHubDelivery,
    resumeSelectedGitHubDelivery,
    stopSelectedGitHubDelivery,
    verifySelectedGitHubDeliveryRevocation,
    generateAcceptanceBundle,
    toggleMcp,
    redactPreview,
  }
}
