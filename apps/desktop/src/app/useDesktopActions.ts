import { useRef, type FormEvent } from 'react'
import {
  advanceWorkflowAfterGateApproval,
  canRunCodingAgentOnNode,
  canApproveGate,
  completeWorkflowAgentNode,
  createAcceptanceEvidenceBundleArtifact,
  createPrDraftArtifact,
  createRemoteRunSummary,
  createRemoteTestEvidenceSummary,
  createWorkflowRunFromRequest,
  members,
  projects,
  redactSecrets,
  runs as fixtureRuns,
  validateTestCommandSafety,
  type Artifact,
  type AgentEvent,
  type CodingPermissionDecision,
  type GateEnforcementDecision,
  type ManagedCodingWorkspace,
  type TeamMember,
  type ThemePreference,
  type WorkflowNode,
  type WorkflowRun,
} from '@ai-devflow/shared'
import type { DevFlowDesktopApi } from '../desktop-api'
import {
  appendArtifactToNode,
  createRunningRun,
  displayNodeTitle,
  fakeAgentProvider,
  mergeById,
  nextEventSequence,
  reviewProviderFromMetadata,
  slugifyBranchName,
} from './desktop-view-model'
import type { DesktopWorkspaceSetters, DesktopWorkspaceState } from './useDesktopWorkspace'

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
  gateEnforcementDecision: GateEnforcementDecision | null
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
    gateEnforcementDecision,
    applyLocalExecutionState,
  } = input
  const {
    artifacts,
    events,
    testEvidence,
    teamProjects,
    testCommandDraft,
    commandSafety,
    desktopPairing,
    pairingCodeDraft,
    mcpServers,
    selectedAgentProviderId,
    providerIdDraft,
    providerBaseUrlDraft,
    providerModelDraft,
    providerKeyDraft,
    runtimeBudgetApprovalId,
    draftTitle,
    draftRequest,
    codingDiffArtifacts,
    agentReviews,
  } = state
  const {
    setThemePreference,
    setDataOrigin,
    setActiveView,
    setRuns,
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
    setIsNewRunOpen,
    setToast,
  } = setters
  const { selectedLocalProject, isTestCommandDirty } = derived
  const eventsRef = useRef(events)
  eventsRef.current = events

  function appendSequencedEvent(event: Omit<AgentEvent, 'sequence'>): AgentEvent {
    let sequencedEvent = {
      ...event,
      sequence: nextEventSequence(eventsRef.current, event.runId),
    }
    eventsRef.current = mergeById(eventsRef.current, [sequencedEvent])
    setEvents((previousEvents) => {
      sequencedEvent = {
        ...event,
        sequence: Math.max(nextEventSequence(previousEvents, event.runId), sequencedEvent.sequence),
      }
      const nextEvents = mergeById(previousEvents, [sequencedEvent])
      eventsRef.current = nextEvents
      return nextEvents
    })
    return sequencedEvent
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

    setIsSyncingRemote(true)
    setToast('正在同步团队远端状态...')

    try {
      const snapshot = await desktopApi.loadRemoteSnapshot({
        organizationId: desktopPairing?.organizationId ?? 'org-demo',
      })
      const nextRun = snapshot.runs[0]

      setRuns(snapshot.runs.length > 0 ? snapshot.runs : fixtureRuns)
      setArtifacts(snapshot.artifacts)
      setEvents(snapshot.events)
      setTestEvidence([])
      setAgentReviews([])
      setAgentTraces([])
      setAgentTokenUsage([])
      setCodingRuns([])
      setCodingEvents([])
      setCodingPermissionRequests([])
      setCodingPermissionDecisions([])
      setManagedCodingWorkspaces([])
      setDependencyBootstrapEvidence([])
      setCodingDiffArtifacts([])
      setTeamProjects(snapshot.projects.length > 0 ? snapshot.projects : projects)
      setTeamMembers(snapshot.members.length > 0 ? snapshot.members : members)
      setTeamProjectCost(snapshot.projectCost)
      setTeamMemberCost(snapshot.memberCost)
      setTeamTotalCost(snapshot.totalCost)
      setDataOrigin(snapshot.runs.length > 0 ? 'remote' : 'seed')

      if (nextRun) {
        setSelectedRunId(nextRun.id)
        setSelectedNodeId(nextRun.currentNodeId)
        setActiveView('workbench')
      }

      setToast('团队远端状态已同步')
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

    const code = pairingCodeDraft.trim()
    if (!code) {
      setToast('请输入 Web Team Console 生成的 Desktop pairing code')
      return
    }

    setIsPairingDesktop(true)
    setToast('正在配对团队项目...')

    try {
      const result = await desktopApi.pairDesktop({ code })
      setDesktopPairing(result.credential)
      setPairingCodeDraft('')
      setToast(`已配对团队项目 ${result.credential.projectId}`)
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

    if (desktopApi) {
      try {
        const result = await desktopApi.approveGate({
          runId: selectedRun.id,
          nodeId: selectedNode.id,
          userId: currentUser.id,
          userName: currentUser.name,
          role: currentUser.role,
        })
        applyLocalExecutionState(result.state)
        setToast(`${displayNodeTitle(selectedNode)} 已通过，Run 进入本地实现阶段`)
        void desktopApi
          .uploadRunSummary(createRemoteRunSummary(result.run, 'run'))
          .catch(() => undefined)
      } catch (error) {
        setToast(error instanceof Error ? error.message : '保存 Gate 审批失败')
      }
      return
    }

    const timestamp = new Date().toISOString()
    const { run: updatedRun } = advanceWorkflowAfterGateApproval({
      run: selectedRun,
      approvedNodeId: selectedNode.id,
      now: timestamp,
    })
    const approvalEvent: Omit<AgentEvent, 'sequence'> = {
      id: `event-approval-${timestamp}`,
      runId: selectedRun.id,
      nodeId: selectedNode.id,
      kind: 'approval',
      message: `${currentUser.name} Gate 已通过：${displayNodeTitle(selectedNode)}`,
      timestamp,
    }

    setRuns((previousRuns) => previousRuns.map((run) => (run.id === selectedRun.id ? updatedRun : run)))
    appendSequencedEvent(approvalEvent)
    setToast('Gate 已通过，流程已推进')
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

    if (desktopApi) {
      try {
        const result = await desktopApi.completeWorkflowAgentNode({
          runId: selectedRun.id,
          nodeId: selectedNode.id,
          userId: currentUser.id,
          userName: currentUser.name,
        })
        applyLocalExecutionState(result.state)
        setSelectedRunId(result.run.id)
        setSelectedNodeId(result.run.currentNodeId)
        setActiveView('workbench')
        setToast(successToast)
      } catch (error) {
        setToast(error instanceof Error ? error.message : '生成阶段产物失败')
      }
      return
    }

    try {
      const completed = completeWorkflowAgentNode({
        run: selectedRun,
        nodeId: selectedNode.id,
        artifacts: artifacts.filter((artifact) => artifact.runId === selectedRun.id),
        existingEvents: events.filter((event) => event.runId === selectedRun.id),
        actorName: currentUser.name,
        now: new Date().toISOString(),
      })

      setRuns((previousRuns) =>
        previousRuns.map((run) => (run.id === completed.run.id ? completed.run : run)),
      )
      setArtifacts((previousArtifacts) => mergeById(previousArtifacts, completed.artifacts))
      setEvents((previousEvents) => mergeById(previousEvents, [completed.event]))
      setSelectedRunId(completed.run.id)
      setSelectedNodeId(completed.run.currentNodeId)
      setToast(successToast)
    } catch (error) {
      setToast(error instanceof Error ? error.message : '生成阶段产物失败')
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

    const testNode = selectedRun.nodes.find((node) => node.stage === 'test') ?? selectedNode
    if (!testNode) {
      setToast('当前 Run 没有测试节点')
      return
    }

    const runningRun = createRunningRun(selectedRun, testNode.id)
    setSelectedNodeId(testNode.id)
    setRuns((previousRuns) =>
      previousRuns.map((run) => (run.id === runningRun.id ? runningRun : run)),
    )
    setIsRunningTests(true)
    setToast('正在执行本地测试命令...')

    try {
      const result = await desktopApi.runProjectTests({
        projectId: selectedLocalProject.id,
        runId: runningRun.id,
        nodeId: testNode.id,
        run: runningRun,
      })
      applyLocalExecutionState(result.state)
      void desktopApi
        .uploadTestEvidenceSummary({
          ...createRemoteTestEvidenceSummary(result.evidence),
          projectId: runningRun.projectId,
        })
        .catch(() => undefined)
      setSelectedRunId(runningRun.id)
      setSelectedNodeId(testNode.id)
      setActiveView('tests')
      setToast(result.evidence.status === 'passed' ? '测试通过，证据已归档' : '测试失败，证据已归档')
    } catch (error) {
      setRuns((previousRuns) =>
        previousRuns.map((run) =>
          run.id === runningRun.id
            ? {
                ...runningRun,
                status: 'failed',
                nodes: runningRun.nodes.map((node) =>
                  node.id === testNode.id ? { ...node, status: 'failed' as const } : node,
                ),
              }
            : run,
        ),
      )
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

    const providerId = providerIdDraft.trim()
    const baseUrl = providerBaseUrlDraft.trim()
    const model = providerModelDraft.trim()

    if (!providerKeyDraft.trim()) {
      setToast('请输入 Review Model API Key')
      return
    }
    if (!providerId) {
      setToast('请输入 Review Model Provider ID')
      return
    }
    if (!model) {
      setToast('请输入 Review Model')
      return
    }

    try {
      const metadata = await desktopApi.saveAgentProviderCredential({
        providerId,
        apiKey: providerKeyDraft,
        model,
        ...(baseUrl ? { baseUrl } : {}),
      })
      const providers = await desktopApi.listAgentProviders()
      setAgentProviders(mergeById(providers.length > 0 ? providers : [fakeAgentProvider], [reviewProviderFromMetadata(metadata)]))
      setSelectedAgentProviderId(metadata.providerId)
      setProviderKeyDraft('')
      setToast(`Review model credential saved: ${metadata.maskedCredential}`)
    } catch (error) {
      setToast(error instanceof Error ? error.message : '保存 Review Model Credential 失败')
    }
  }

  async function runKnowledgeReview() {
    if (!selectedRun || !selectedNode || !currentUser) {
      return
    }

    if (!desktopApi) {
      setToast('请在 Electron 应用中运行 Knowledge Review Agent')
      return
    }

    setIsRunningAgentReview(true)
    setToast('Knowledge Review Agent 正在生成审查意见...')

    try {
      const result = await desktopApi.runKnowledgeReview({
        runId: selectedRun.id,
        nodeId: selectedNode.id,
        projectId: selectedRun.projectId,
        requestedBy: currentUser.id,
        runtime: 'electron',
        providerId: selectedAgentProviderId,
      })
      applyLocalExecutionState(result.state)
      setSelectedRunId(result.review.runId)
      setSelectedNodeId(result.review.nodeId)
      setActiveView('agents')
      setToast('Knowledge Review 已归档，Gate Advisory 已生成')
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Knowledge Review Agent 运行失败')
    } finally {
      setIsRunningAgentReview(false)
    }
  }

  async function runCodingAgent() {
    if (!selectedRun || !selectedNode || !currentUser) {
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
    setToast('正在创建 managed worktree 并启动 fake Coding Agent...')

    try {
      await desktopApi.ensureCodingEngine({ projectId: selectedLocalProject.id })
      const result = await desktopApi.runCodingAgent({
        runId: selectedRun.id,
        nodeId: selectedNode.id,
        projectId: selectedLocalProject.id,
        requestedBy: currentUser.id,
        providerId: 'fake-coding-engine',
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
      await desktopApi.ensureCodingEngine({ projectId: selectedLocalProject.id })
      const result = await desktopApi.startRetryAttempt({
        runId: selectedRun.id,
        nodeId: selectedNode.id,
        projectId: selectedLocalProject.id,
        requestedBy: currentUser.id,
        providerId: 'fake-coding-engine',
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

    try {
      await desktopApi.replyCodingPermission({
        requestId: pendingCodingPermission.id,
        codingRunId: pendingCodingPermission.codingRunId,
        decidedBy: currentUser.id,
        decision,
        comment: decision === 'approved' ? 'Approved from DevFlow Agent Workbench.' : 'Rejected from DevFlow Agent Workbench.',
      })
      applyLocalExecutionState(await desktopApi.loadState())
      setToast(decision === 'approved' ? 'Coding Agent 已完成 fake diff 归档' : 'Coding Agent 权限已拒绝')
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
    const createInput = {
      title: draftTitle,
      request: draftRequest,
      projectId: selectedRun?.projectId ?? teamProjects[0]?.id ?? 'p-payments',
      creatorId: currentUser?.id ?? 'u-wang',
      branchName: `ai/${slugifyBranchName(draftTitle) || 'new-run'}`,
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

  async function persistDeliveryArtifact(nextRun: WorkflowRun, artifact: Artifact, message: string) {
    const timestamp = artifact.updatedAt
    const event: Omit<AgentEvent, 'sequence'> = {
      id: `event-${artifact.id}`,
      runId: artifact.runId,
      nodeId: artifact.nodeId,
      kind: 'thinking',
      message,
      timestamp,
    }

    setRuns((previousRuns) => previousRuns.map((run) => (run.id === nextRun.id ? nextRun : run)))
    setArtifacts((previousArtifacts) => mergeById(previousArtifacts, [artifact]))
    const sequencedEvent = appendSequencedEvent(event)

    if (!desktopApi) {
      return
    }

    await desktopApi.saveRun(nextRun)
    await desktopApi.saveArtifact(artifact)
    await desktopApi.saveEvent(sequencedEvent)
  }

  async function generatePrDraft() {
    if (!selectedRun) {
      return
    }

    const project = teamProjects.find((candidate) => candidate.id === selectedRun.projectId) ?? teamProjects[0]
    if (!project) {
      setToast('当前 Run 缺少项目仓库映射，无法生成 PR Draft')
      return
    }

    const timestamp = new Date().toISOString()
    const artifact = createPrDraftArtifact({
      run: selectedRun,
      project: {
        repository: project.repository,
        defaultBranch: project.defaultBranch,
      },
      artifacts: artifacts.filter((candidate) => candidate.runId === selectedRun.id),
      codingDiffs: codingDiffArtifacts.filter((candidate) => candidate.runId === selectedRun.id),
      testEvidence: testEvidence.filter((candidate) => candidate.runId === selectedRun.id),
      agentReviewSummaries: agentReviews
        .filter((review) => review.runId === selectedRun.id)
        .map((review) => review.summary),
      now: timestamp,
      ...(gateEnforcementDecision ? { enforcement: gateEnforcementDecision } : {}),
      ...(latestCodingRun?.budgetDecision ? { budgetDecision: latestCodingRun.budgetDecision } : {}),
    })
    const nextRun = appendArtifactToNode(selectedRun, artifact.nodeId, artifact.id)

    try {
      await persistDeliveryArtifact(nextRun, artifact, 'PR draft artifact generated from delivery evidence.')
      setToast('PR Draft 已生成')
    } catch (error) {
      setToast(error instanceof Error ? error.message : '保存 PR Draft 失败')
    }
  }

  async function generateAcceptanceBundle() {
    if (!selectedRun) {
      return
    }

    const timestamp = new Date().toISOString()
    const runArtifacts = artifacts.filter((candidate) => candidate.runId === selectedRun.id)
    const artifact = createAcceptanceEvidenceBundleArtifact({
      run: selectedRun,
      artifacts: runArtifacts,
      codingDiffs: codingDiffArtifacts.filter((candidate) => candidate.runId === selectedRun.id),
      testEvidence: testEvidence.filter((candidate) => candidate.runId === selectedRun.id),
      agentReviewSummaries: agentReviews
        .filter((review) => review.runId === selectedRun.id)
        .map((review) => review.summary),
      now: timestamp,
      ...(gateEnforcementDecision ? { enforcement: gateEnforcementDecision } : {}),
      ...(latestCodingRun?.budgetDecision ? { budgetDecision: latestCodingRun.budgetDecision } : {}),
    })
    const nextRun = appendArtifactToNode(selectedRun, artifact.nodeId, artifact.id)

    try {
      await persistDeliveryArtifact(nextRun, artifact, 'Acceptance evidence bundle generated from delivery evidence.')
      setToast('验收证据包已生成')
    } catch (error) {
      setToast(error instanceof Error ? error.message : '保存验收证据包失败')
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
    generatePrDraft,
    generateAcceptanceBundle,
    toggleMcp,
    redactPreview,
  }
}
