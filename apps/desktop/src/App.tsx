import {
  BookOpen,
  Bot,
  ClipboardCheck,
  Network,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  TestTube2,
  Trash2,
  Users,
  Workflow,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  buildKnowledgeGovernanceChecks,
  buildKnowledgeReferences,
  isActiveCodingAgentRunStatus,
  type KnowledgeChunk,
  type KnowledgeDocument,
  type ProjectGitStatus,
  type WorkflowRun,
} from '@ai-devflow/shared'
import { useGateEnforcement } from './useGateEnforcement'
import {
  buildSearchResults,
  buildKnowledgeDataSource,
  buildRuntimeDataSource,
  defaultReviewProviderDraft,
  getRunStatusLabel,
  normalizeQuery,
  reviewProviderFromMetadata,
  runMatchesQuery,
  type SearchResultItem,
  matchesQuery,
} from './app/desktop-view-model'
import { resolveInspectorTabForSearchResult } from './app/node-inspector-view-model'
import { useDesktopActions } from './app/useDesktopActions'
import { useDesktopWorkspace } from './app/useDesktopWorkspace'
import {
  AgentWorkbenchView,
  Inspector,
  KnowledgeView,
  LocalProjectPanel,
  McpView,
  NavButton,
  SkillView,
  TeamOverview,
  TestsView,
  ThemeToggle,
  WorkflowBoard,
} from './views/DesktopViews'

export { getToastDisplayDurationMs } from './app/desktop-view-model'

const projectKnowledgeDocuments: KnowledgeDocument[] = []
const projectKnowledgeChunks: KnowledgeChunk[] = []

export function App() {
  const workspace = useDesktopWorkspace({
    defaultReviewProviderDraft,
    reviewProviderFromMetadata,
  })
  const { desktopApi, applyLocalExecutionState } = workspace
  const {
    themePreference,
    dataOrigin,
    hasLoadedLocalState,
    activeView,
    runs,
    remoteRunIds,
    selectedRunId,
    selectedNodeId,
    artifacts,
    events,
    testEvidence,
    teamProjects,
    teamMembers,
    teamProjectCost,
    teamMemberCost,
    teamTotalCost,
    testCommandDraft,
    commandSafety,
    isSavingTestCommand,
    isRunningTests,
    isSyncingRemote,
    desktopPairing,
    pairingCodeDraft,
    isPairingDesktop,
    mcpServers,
    agentProviders,
    selectedAgentProviderId,
    agentReviews,
    agentTraces,
    agentTokenUsage,
    codingRuns,
    codingEvents,
    codingPermissionRequests,
    codingPermissionDecisions,
    managedCodingWorkspaces,
    dependencyBootstrapEvidence,
    codingDiffArtifacts,
    retryAttempts,
    providerIdDraft,
    providerBaseUrlDraft,
    providerModelDraft,
    providerKeyDraft,
    runtimeBudgetApprovalId,
    isRunningAgentReview,
    isStartingCodingAgent,
    isNewRunOpen,
    draftTitle,
    draftRequest,
    searchQuery,
    supportContext,
    toast,
  } = workspace.state
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
    setProviderIdDraft,
    setProviderBaseUrlDraft,
    setProviderModelDraft,
    setProviderKeyDraft,
    setRuntimeBudgetApprovalId,
    setIsRunningAgentReview,
    setIsStartingCodingAgent,
    setIsNewRunOpen,
    setDraftTitle,
    setDraftRequest,
    setSearchQuery,
    setSupportContext,
    setToast,
  } = workspace.setters
  const { selectedLocalProject, isTestCommandDirty } = workspace.derived
  const [projectGitStatus, setProjectGitStatus] = useState<ProjectGitStatus | null>(null)
  const [isRefreshingGitStatus, setIsRefreshingGitStatus] = useState(false)
  const [openRunMenuId, setOpenRunMenuId] = useState<string | null>(null)
  const [deleteRunTarget, setDeleteRunTarget] = useState<{
    run: WorkflowRun
    deleteRemote: boolean
  } | null>(null)
  const [isDeletingRun, setIsDeletingRun] = useState(false)

  const refreshProjectGitStatus = useCallback(async () => {
    if (!desktopApi || !selectedLocalProject) {
      setProjectGitStatus(null)
      return
    }

    try {
      setIsRefreshingGitStatus(true)
      const status = await Promise.resolve(
        desktopApi.getProjectGitStatus?.({ projectId: selectedLocalProject.id }),
      )
      if (!status) {
        throw new Error('git status unavailable')
      }
      setProjectGitStatus(status)
    } catch {
      setProjectGitStatus({
        projectId: selectedLocalProject.id,
        status: 'unavailable',
        message: 'git status unavailable',
        refreshedAt: new Date().toISOString(),
      })
    } finally {
      setIsRefreshingGitStatus(false)
    }
  }, [desktopApi, selectedLocalProject])

  useEffect(() => {
    if (!desktopApi || !selectedLocalProject) {
      setProjectGitStatus(null)
      return
    }

    let disposed = false
    setProjectGitStatus(null)

    const loadGitStatus = typeof desktopApi.watchProjectGitStatus === 'function'
      ? desktopApi.watchProjectGitStatus
      : desktopApi.getProjectGitStatus

    Promise.resolve(loadGitStatus?.({ projectId: selectedLocalProject.id }))
      .then((status) => {
        if (!disposed && status) {
          setProjectGitStatus(status)
        }
      })
      .catch(() => {
        if (!disposed) {
          setProjectGitStatus({
            projectId: selectedLocalProject.id,
            status: 'unavailable',
            message: 'git status unavailable',
            refreshedAt: new Date().toISOString(),
          })
        }
      })

    const unsubscribe = desktopApi.onProjectGitStatusUpdated?.((status) => {
      if (!disposed && status.projectId === selectedLocalProject.id) {
        setProjectGitStatus(status)
      }
    }) ?? (() => {})

    const refreshOnFocus = () => {
      void refreshProjectGitStatus()
    }
    window.addEventListener('focus', refreshOnFocus)
    document.addEventListener('visibilitychange', refreshOnFocus)

    return () => {
      disposed = true
      unsubscribe()
      window.removeEventListener('focus', refreshOnFocus)
      document.removeEventListener('visibilitychange', refreshOnFocus)
      void desktopApi.unwatchProjectGitStatus?.({ projectId: selectedLocalProject.id })
    }
  }, [desktopApi, refreshProjectGitStatus, selectedLocalProject])

  const normalizedSearchQuery = normalizeQuery(searchQuery)
  const scopedRuns = useMemo(
    () =>
      selectedLocalProject
        ? runs.filter((run) => run.projectId === selectedLocalProject.id)
        : runs,
    [runs, selectedLocalProject],
  )
  const scopedRunIdSet = useMemo(() => new Set(scopedRuns.map((run) => run.id)), [scopedRuns])
  const scopedArtifacts = useMemo(
    () => artifacts.filter((artifact) => scopedRunIdSet.has(artifact.runId)),
    [artifacts, scopedRunIdSet],
  )
  const scopedEvents = useMemo(
    () => events.filter((event) => scopedRunIdSet.has(event.runId)),
    [events, scopedRunIdSet],
  )
  const scopedTestEvidence = useMemo(
    () => testEvidence.filter((evidence) => scopedRunIdSet.has(evidence.runId)),
    [scopedRunIdSet, testEvidence],
  )
  const visibleRuns = useMemo(
    () => scopedRuns.filter((run) => runMatchesQuery(run, scopedArtifacts, scopedEvents, normalizedSearchQuery)),
    [normalizedSearchQuery, scopedArtifacts, scopedEvents, scopedRuns],
  )
  const selectedRun = scopedRuns.find((run) => run.id === selectedRunId) ?? scopedRuns[0]
  const selectedNode =
    selectedRun?.nodes.find((node) => node.id === selectedNodeId) ?? selectedRun?.nodes[0]
  const selectedTeamProject = teamProjects.find((project) => project.id === selectedRun?.projectId)
  const teamProjectLabel = selectedTeamProject?.name ?? ''
  const teamProjectSource = selectedTeamProject ? 'remote snapshot' : 'not bound'
  const teamProjectSourceLabel = teamProjectSource === 'not bound' ? '未绑定' : teamProjectSource
  const isSelectedCurrentNode = Boolean(
    selectedRun && selectedNode && selectedRun.currentNodeId === selectedNode.id,
  )
  const selectedArtifacts = scopedArtifacts
    .filter((artifact) => selectedNode?.artifactIds.includes(artifact.id))
    .filter((artifact) =>
      matchesQuery(normalizedSearchQuery, [
        artifact.title,
        artifact.summary,
        artifact.content,
        artifact.kind,
      ]),
    )
  const selectedEvents = scopedEvents.filter(
    (event) =>
      event.runId === selectedRun?.id &&
      (!selectedNode || event.nodeId === selectedNode.id) &&
      matchesQuery(normalizedSearchQuery, [event.kind, event.message]),
  )
  const pairedUser = desktopPairing
    ? {
        id: desktopPairing.userId,
        name: desktopPairing.userId,
        role: desktopPairing.role,
        avatarInitials: desktopPairing.userId.slice(0, 2).toUpperCase(),
        focus: 'Paired desktop',
      }
    : undefined
  const runCreatorUser = selectedRun?.creatorId
    ? {
        id: selectedRun.creatorId,
        name: selectedRun.creatorId,
        role: 'owner' as const,
        avatarInitials: selectedRun.creatorId.slice(0, 2).toUpperCase(),
        focus: 'Local run',
      }
    : undefined
  const currentUser =
    teamMembers.find((member) => member.id === desktopPairing?.userId || member.id === selectedRun?.creatorId) ??
    teamMembers[0] ??
    pairedUser ??
    runCreatorUser
  const knowledgeReferences = useMemo(
    () =>
      selectedRun
        ? buildKnowledgeReferences({
            run: selectedRun,
            artifacts: scopedArtifacts,
            documents: projectKnowledgeDocuments,
            chunks: projectKnowledgeChunks,
            testEvidence: scopedTestEvidence,
          })
        : [],
    [scopedArtifacts, scopedTestEvidence, selectedRun],
  )
  const selectedGovernanceChecks = useMemo(
    () =>
      selectedRun && selectedNode
        ? buildKnowledgeGovernanceChecks({
            run: selectedRun,
            node: selectedNode,
            artifacts: scopedArtifacts,
            documents: projectKnowledgeDocuments,
            chunks: projectKnowledgeChunks,
            testEvidence: scopedTestEvidence,
          })
        : [],
    [scopedArtifacts, scopedTestEvidence, selectedNode, selectedRun],
  )
  const searchResults = useMemo(
    () =>
      buildSearchResults({
        query: normalizedSearchQuery,
        runs: scopedRuns,
        artifacts: scopedArtifacts,
        events: scopedEvents,
        knowledgeDocuments: projectKnowledgeDocuments,
        knowledgeReferences,
      }),
    [knowledgeReferences, normalizedSearchQuery, scopedArtifacts, scopedEvents, scopedRuns],
  )
  const selectedAgentReviews = useMemo(
    () =>
      agentReviews
        .filter(
          (review) =>
            review.runId === selectedRun?.id &&
            (!selectedNode || review.nodeId === selectedNode.id),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [agentReviews, selectedNode, selectedRun],
  )
  const latestAgentReview = selectedAgentReviews[0]
  const latestAgentTrace = latestAgentReview
    ? agentTraces.find((trace) => trace.reviewId === latestAgentReview.id)
    : undefined
  const latestAgentUsage = latestAgentReview
    ? agentTokenUsage
        .filter(
          (usage) =>
            usage.runId === latestAgentReview.runId &&
            usage.nodeId === latestAgentReview.nodeId &&
            usage.timestamp <= latestAgentReview.createdAt,
        )
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0]
    : undefined
  const selectedCodingRuns = useMemo(
    () =>
      codingRuns
        .filter((run) => run.runId === selectedRun?.id)
        .sort((a, b) => (b.completedAt ?? b.startedAt).localeCompare(a.completedAt ?? a.startedAt)),
    [codingRuns, selectedRun],
  )
  const selectedRetryAttempts = useMemo(
    () =>
      retryAttempts
        .filter((attempt) => attempt.runId === selectedRun?.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [retryAttempts, selectedRun],
  )
  const latestCodingRun = selectedCodingRuns[0]
  const selectedCodingEvents = latestCodingRun
    ? codingEvents
        .filter((event) => event.codingRunId === latestCodingRun.id)
        .sort((a, b) => a.sequence - b.sequence)
    : []
  const selectedCodingPermissionRequests = latestCodingRun
    ? codingPermissionRequests
        .filter((request) => request.codingRunId === latestCodingRun.id)
        .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt))
    : []
  const pendingCodingPermission = selectedCodingPermissionRequests.find((request) => request.status === 'pending')
  const selectedManagedWorkspace = latestCodingRun
    ? managedCodingWorkspaces.find((workspace) => workspace.id === latestCodingRun.managedWorkspaceId)
    : undefined
  const selectedCodingDiff = latestCodingRun
    ? codingDiffArtifacts.find((artifact) => artifact.id === latestCodingRun.diffArtifactId)
    : undefined
  const selectedBootstrapEvidence = latestCodingRun
    ? dependencyBootstrapEvidence.find((evidence) => evidence.id === latestCodingRun.bootstrapEvidenceId)
    : undefined
  const selectedCodingTestEvidence = latestCodingRun
    ? scopedTestEvidence.find((evidence) => evidence.id === latestCodingRun.testEvidenceId)
    : undefined
  const remoteRunIdSet = useMemo(() => new Set(remoteRunIds), [remoteRunIds])
  const remoteRunCount = scopedRuns.filter((run) => remoteRunIdSet.has(run.id)).length
  const localRunCount = scopedRuns.length - remoteRunCount
  const activeCodingRunIdSet = useMemo(
    () =>
      new Set(
        codingRuns
          .filter((run) => isActiveCodingAgentRunStatus(run.status))
          .map((run) => run.runId),
      ),
    [codingRuns],
  )
  const pendingGateCount = scopedRuns.reduce(
    (count, run) =>
      count + run.nodes.filter((node) => node.kind === 'gate' && node.status === 'blocked').length,
    0,
  )
  const today = new Date().toISOString().slice(0, 10)
  const testsTodayCount = scopedTestEvidence.filter((evidence) => evidence.createdAt.slice(0, 10) === today).length
  const budgetStatus = latestCodingRun?.budgetDecision?.status ?? (runtimeBudgetApprovalId ? 'approval entered' : 'not loaded')
  const budgetTone =
    budgetStatus === 'allowed' || budgetStatus === 'approved_over_budget'
      ? 'good'
      : budgetStatus === 'warning' || budgetStatus === 'requires_lead_approval' || budgetStatus === 'approval entered'
        ? 'warn'
        : 'soft'
  const runtimeDataSource = useMemo(
    () =>
      buildRuntimeDataSource({
        desktopConnected: Boolean(desktopApi),
        hasLoadedLocalState,
        dataOrigin,
        localRunCount,
        remoteRunCount,
      }),
    [dataOrigin, desktopApi, hasLoadedLocalState, localRunCount, remoteRunCount],
  )
  const knowledgeDataSource = useMemo(
    () =>
      buildKnowledgeDataSource({
        desktopConnected: Boolean(desktopApi),
        dataOrigin,
      }),
    [dataOrigin, desktopApi],
  )
  const isSelectedNodeGateLike = selectedNode?.kind === 'gate' || selectedNode?.kind === 'acceptance'
  const gateEnforcement = useGateEnforcement({
    desktopApi,
    isEnabled: dataOrigin !== 'seed' && isSelectedNodeGateLike,
    selectedRun,
    selectedNode,
    currentUser,
    artifacts,
    agentReviews,
    testEvidence,
    governanceChecks: selectedGovernanceChecks,
    knowledgeReferences,
    onToast: setToast,
  })

  const {
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
    deleteRun,
    generatePrDraft,
    generateAcceptanceBundle,
    toggleMcp,
    redactPreview,
  } = useDesktopActions({
    desktopApi,
    state: workspace.state,
    setters: workspace.setters,
    derived: workspace.derived,
    selectedRun,
    selectedNode,
    currentUser,
    pendingCodingPermission,
    latestCodingRun,
    selectedManagedWorkspace,
    gateEnforcementDecision: gateEnforcement.decision,
    applyLocalExecutionState,
  })

  async function confirmDeleteRun() {
    if (!deleteRunTarget) {
      return
    }

    setIsDeletingRun(true)
    const deleted = await deleteRun(deleteRunTarget.run, {
      deleteRemote: deleteRunTarget.deleteRemote,
    })
    setIsDeletingRun(false)

    if (deleted) {
      setDeleteRunTarget(null)
      setOpenRunMenuId(null)
    }
  }

  function selectRunNode(runId: string | undefined, nodeId: string | undefined) {
    const run = scopedRuns.find((candidate) => candidate.id === runId) ?? selectedRun
    if (!run) {
      return
    }

    setSelectedRunId(run.id)
    setSelectedNodeId(
      run.nodes.some((node) => node.id === nodeId)
        ? nodeId!
        : run.currentNodeId,
    )
  }

  function openSupportContext(
    focusTarget: 'knowledge-review' | 'local-tests' | 'coding-agent',
    label: string,
  ) {
    if (!selectedRun || !selectedNode) {
      return
    }

    setSupportContext({
      runId: selectedRun.id,
      nodeId: selectedNode.id,
      sourceView: activeView,
      returnView: 'workbench',
      focusTarget,
      label,
      createdAt: new Date().toISOString(),
    })
    setActiveView(focusTarget === 'local-tests' ? 'tests' : 'agents')
  }

  function openKnowledgeReference(referenceId: string, documentId?: string) {
    const reference = knowledgeReferences.find((candidate) => candidate.id === referenceId)
    const nextRunId = reference?.runId ?? selectedRun?.id
    const nextNodeId = reference?.nodeId ?? selectedNode?.id
    if (!nextRunId || !nextNodeId) {
      return
    }

    selectRunNode(nextRunId, nextNodeId)
    setSupportContext({
      runId: nextRunId,
      nodeId: nextNodeId,
      sourceView: activeView,
      returnView: 'workbench',
      focusTarget: 'knowledge-reference',
      label: 'Knowledge Governance 引用来源',
      referenceId,
      documentId: documentId ?? reference?.documentId,
      createdAt: new Date().toISOString(),
    })
    setSearchQuery('')
    setActiveView('knowledge')
  }

  function returnToInspector() {
    if (supportContext) {
      selectRunNode(supportContext.runId, supportContext.nodeId)
      setSupportContext(null)
    }
    setActiveView('workbench')
  }

  function selectSearchResult(result: SearchResultItem) {
    if (result.type === 'knowledge') {
      const runId = result.runId ?? selectedRun?.id
      const nodeId = result.nodeId ?? selectedNode?.id
      if (runId && nodeId) {
        selectRunNode(runId, nodeId)
        setSupportContext({
          runId,
          nodeId,
          sourceView: activeView,
          returnView: 'workbench',
          focusTarget: 'knowledge-reference',
          label: 'Search result · Knowledge',
          referenceId: result.referenceId,
          documentId: result.documentId,
          createdAt: new Date().toISOString(),
        })
      }
      setActiveView('knowledge')
      return
    }

    if (result.type === 'artifact' || result.type === 'event') {
      const run = scopedRuns.find((candidate) => candidate.id === result.runId) ?? selectedRun
      const node =
        run?.nodes.find((candidate) => candidate.id === result.nodeId) ??
        run?.nodes.find((candidate) => candidate.id === run.currentNodeId)
      if (run && node) {
        setSelectedRunId(run.id)
        setSelectedNodeId(node.id)
        setSupportContext({
          runId: run.id,
          nodeId: node.id,
          sourceView: activeView,
          returnView: 'workbench',
          focusTarget: result.type,
          label: result.type === 'artifact' ? 'Search result · Artifact' : 'Search result · Event',
          artifactId: result.artifactId,
          eventId: result.eventId,
          inspectorTab: resolveInspectorTabForSearchResult(node, result.type),
          createdAt: new Date().toISOString(),
        })
      }
      setSearchQuery('')
      setActiveView('workbench')
      return
    }

    selectRunNode(result.runId, result.nodeId)
    setSupportContext(null)
    setActiveView('workbench')
  }

  const policyStatus = gateEnforcement.isLoading
    ? 'loading'
    : gateEnforcement.decision?.status ?? 'not loaded'
  const policyTone =
    policyStatus === 'pass' || policyStatus === 'overridden'
      ? 'good'
      : policyStatus === 'warn'
        ? 'warn'
        : policyStatus === 'not loaded'
          ? 'soft'
          : 'bad'
  const policySource = gateEnforcement.policySnapshot?.source ?? gateEnforcement.decision?.policySource ?? 'unavailable'
  const policyVersion = gateEnforcement.policySnapshot?.version ?? gateEnforcement.decision?.policyVersion

  return (
    <div className="app-shell" data-origin={dataOrigin}>
      <aside className="sidebar rail" aria-label="Primary navigation">
        <div className="brand mark" aria-label="DevFlow Studio">DF</div>

        <nav className="nav-list">
          <NavButton active={activeView === 'workbench'} icon={<Workflow />} label="工作台" onClick={() => setActiveView('workbench')} />
          <NavButton active={activeView === 'team'} ariaLabel="Team Overview" icon={<Users />} label="Team" onClick={() => setActiveView('team')} />
          <NavButton active={activeView === 'knowledge'} icon={<BookOpen />} label="Knowledge" onClick={() => setActiveView('knowledge')} />
          <NavButton active={activeView === 'agents'} icon={<Bot />} label="Agents" onClick={() => setActiveView('agents')} />
          <NavButton active={activeView === 'skills'} icon={<ShieldCheck />} label="Skills" onClick={() => setActiveView('skills')} />
          <NavButton active={activeView === 'mcp'} icon={<Network />} label="MCP" onClick={() => setActiveView('mcp')} />
          <NavButton active={activeView === 'tests'} icon={<TestTube2 />} label="测试" onClick={() => setActiveView('tests')} />
        </nav>

      </aside>

      <main className="workspace main-shell">
        <header className="topbar">
          <div className="project-switcher" aria-label="Project selector">
            <div className="project-line">
              <span className="project-label">Team Project</span>
              {selectedTeamProject ? <strong className="project-value">{teamProjectLabel}</strong> : null}
              <span className={`pill ${selectedTeamProject ? 'accent' : 'soft'}`}>{teamProjectSourceLabel}</span>
            </div>
            <div className="project-line">
              <span className="project-label">Local Project</span>
              <strong className="project-value project-value--local">
                {selectedLocalProject?.path ?? '未选择本地仓库'}
              </strong>
            </div>
          </div>

          <div className="search-wrap">
            <div className="search-box">
            <Search size={16} />
            <input
              aria-label="Search runs and knowledge"
              placeholder="搜索当前加载的 Run / Artifact / Knowledge / Event"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            </div>
            <span className="search-scope">不搜索本地文件系统</span>
            {normalizedSearchQuery ? (
              <div className="search-results" data-testid="search-results">
                {searchResults.length === 0 ? (
                  <p className="empty-note">没有匹配结果</p>
                ) : (
                  searchResults.map((result) => (
                    <button
                      className="search-result-row"
                      key={result.id}
                      type="button"
                      onClick={() => selectSearchResult(result)}
                    >
                      <span>{result.type}</span>
                      <strong>{result.title}</strong>
                      <small>{result.subtitle}</small>
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>

          <div className="topbar-actions">
            <ThemeToggle value={themePreference} onChange={changeThemePreference} />
            <form className="desktop-pairing-form" onSubmit={pairDesktopWithTeam}>
              <span>{desktopPairing ? '已配对 Team' : '未配对 Team'}</span>
              <input
                aria-label="Desktop pairing code"
                placeholder="输入 pairing code"
                value={pairingCodeDraft}
                onChange={(event) => setPairingCodeDraft(event.target.value)}
              />
              <button type="submit" className="ghost-button" disabled={isPairingDesktop}>
                {isPairingDesktop ? '配对中' : '绑定'}
              </button>
            </form>
            <button className="ghost-button" onClick={syncRemoteTeamState} disabled={isSyncingRemote}>
              <RefreshCw size={16} />
              {isSyncingRemote ? '同步中' : '同步团队'}
            </button>
            <button className="ghost-button" onClick={redactPreview} aria-label="Test redaction">
              <ShieldCheck size={16} />
              Redaction 开
            </button>
            <button className="primary-button" onClick={() => setIsNewRunOpen(true)}>
              <Plus size={16} />
              新建 Run
            </button>
            <div className="avatar" aria-label={currentUser ? `Current user ${currentUser.name}` : 'No current team user'}>
              {currentUser?.avatarInitials ?? '--'}
            </div>
          </div>
        </header>

        <section className="status-strip" aria-live="polite">
          <span className="stat stat--source" data-testid="runtime-source-badge" title={runtimeDataSource.detail}>
            数据源 <strong className={`pill ${runtimeDataSource.tone}`}>{runtimeDataSource.label}</strong>
            <em>{runtimeDataSource.status}</em>
          </span>
          <span className="stat">Active Runs <strong>{scopedRuns.length}</strong></span>
          <span className="stat">Run Sources <strong>{localRunCount} local · {remoteRunCount} remote</strong></span>
          <span className="stat">Pending Gates <strong>{pendingGateCount}</strong></span>
          <span className="stat">Token Cost <strong>{teamTotalCost}</strong></span>
          <span className="stat">Tests Today <strong>{testsTodayCount}</strong></span>
          <span className="stat">同步状态 <strong>local + {policySource}</strong></span>
          <span className="stat">Policy Snapshot <strong>{policyVersion ? `v${policyVersion}` : 'not loaded'}</strong></span>
          <span className="stat">策略状态 <strong className={`pill ${policyTone}`}>{policyStatus}</strong></span>
          <span className="stat">预算状态 <strong className={`pill ${budgetTone}`}>{budgetStatus}</strong></span>
        </section>

        {toast && (
          <div
            className="toast toast--floating"
            role="status"
            aria-live="polite"
            aria-atomic="true"
            data-testid="toast"
          >
            {toast}
          </div>
        )}

        {activeView === 'workbench' && (
          <section className="workbench-layout">
            <div className="run-list">
              <LocalProjectPanel
                project={selectedLocalProject}
                teamProjectLabel={teamProjectLabel}
                teamProjectSource={teamProjectSource}
                gitStatus={projectGitStatus}
                isRefreshingGitStatus={isRefreshingGitStatus}
                onRefreshGitStatus={refreshProjectGitStatus}
                onSelectProject={selectLocalProject}
                desktopConnected={Boolean(desktopApi)}
              />
              <div className="section-heading">
                <span>Runs</span>
                <strong>开发者工作台</strong>
              </div>
              {visibleRuns.length === 0 ? (
                <p className="empty-note">没有匹配的 Run</p>
              ) : (
                visibleRuns.map((run) => {
                  const isRemoteRun = remoteRunIdSet.has(run.id)
                  const isPreviewRun = dataOrigin === 'seed'
                  const isDeleteDisabled = !desktopApi || activeCodingRunIdSet.has(run.id)
                  const deleteDisabledReason = !desktopApi
                    ? '请在 Electron 应用中删除 Run'
                    : activeCodingRunIdSet.has(run.id)
                      ? '请先取消 Coding Agent'
                      : ''
                  const deleteLabel = isRemoteRun ? '删除 Run...' : '删除本地 Run...'

                  return (
                    <div
                      key={run.id}
                      className={`run-row ${run.id === selectedRun?.id ? 'is-selected' : ''}`}
                    >
                      <button
                        className="run-row-main"
                        title={run.title}
                        onClick={() => {
                          setSelectedRunId(run.id)
                          setSelectedNodeId(run.currentNodeId)
                          setOpenRunMenuId(null)
                        }}
                      >
                        <strong>{run.title}</strong>
                        <span>{run.branchName}</span>
                        <em>{getRunStatusLabel(run.status)}</em>
                        <span className={`pill ${isRemoteRun ? 'accent' : isPreviewRun ? 'soft' : 'good'}`}>
                          {isRemoteRun ? 'remote' : isPreviewRun ? 'preview' : 'local'}
                        </span>
                      </button>
                      {!isPreviewRun && (
                        <div className="run-row-actions">
                          <button
                            className="run-menu-trigger"
                            aria-label={`${run.title} actions`}
                            aria-haspopup="menu"
                            aria-expanded={openRunMenuId === run.id}
                            onClick={(event) => {
                              event.stopPropagation()
                              setOpenRunMenuId((current) => (current === run.id ? null : run.id))
                            }}
                          >
                            <MoreHorizontal aria-hidden="true" />
                          </button>
                          {openRunMenuId === run.id && (
                            <div className="run-row-menu" role="menu">
                              <button
                                role="menuitem"
                                disabled={isDeleteDisabled}
                                title={deleteDisabledReason || deleteLabel}
                                onClick={() => {
                                  if (isDeleteDisabled) {
                                    return
                                  }
                                  setDeleteRunTarget({ run, deleteRemote: isRemoteRun })
                                }}
                              >
                                <Trash2 aria-hidden="true" />
                                {deleteLabel}
                              </button>
                              {deleteDisabledReason && (
                                <span className="run-row-menu-note">{deleteDisabledReason}</span>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>

            {selectedRun ? (
              <>
                <WorkflowBoard
                  run={selectedRun}
                  artifacts={scopedArtifacts}
                  events={scopedEvents}
                  testEvidence={scopedTestEvidence}
                  selectedNodeId={selectedNode?.id}
                  onSelectNode={setSelectedNodeId}
                />

                <Inspector
                  selectedRun={selectedRun}
                  selectedNode={selectedNode}
                  isSelectedCurrentNode={isSelectedCurrentNode}
                  artifacts={selectedArtifacts}
                  events={selectedEvents}
                  governanceChecks={selectedGovernanceChecks}
                  references={knowledgeReferences}
                  latestAgentReview={latestAgentReview}
                  supportContext={supportContext}
                  policySnapshot={gateEnforcement.policySnapshot}
                  gateEnforcementDecision={gateEnforcement.decision}
                  gateOverrides={gateEnforcement.overrides.filter((override) => override.nodeId === selectedNode?.id)}
                  remediationPlan={gateEnforcement.remediationPlan}
                  isLoadingGateEnforcement={gateEnforcement.isLoading}
                  canApprove={gateEnforcement.canApprove}
                  canSaveOverride={gateEnforcement.canSaveOverride}
                  onApprove={approveSelectedGate}
                  onCompleteAgentNode={completeSelectedWorkflowAgentNode}
                  onSaveGateOverride={gateEnforcement.saveOverride}
                  onStartRemediationRetry={startRemediationRetry}
                  pairingState={desktopPairing ? 'paired' : 'unpaired'}
                  onSyncTeam={syncRemoteTeamState}
                  onOpenTests={() => openSupportContext('local-tests', '执行本地测试并生成 Test Evidence')}
                  onOpenKnowledgeReview={() => openSupportContext('knowledge-review', '运行 Knowledge Review 并补齐 Gate Advisory')}
                  onOpenKnowledgeReference={openKnowledgeReference}
                  onRunCodingAgent={runCodingAgent}
                  onCreatePrDraft={generatePrDraft}
                  onCreateAcceptanceBundle={generateAcceptanceBundle}
                  isRunningTests={isRunningTests}
                  isRunningAgentReview={isRunningAgentReview}
                  isStartingCodingAgent={isStartingCodingAgent}
                />
              </>
            ) : (
              <>
                <section className="canvas-panel workflow-panel empty-workbench" data-testid="workflow-empty-state">
                  <div className="panel-head workflow-head">
                    <div>
                      <span className="panel-title">Workflow Board</span>
                      <span className="meta">暂无 Run</span>
                    </div>
                    <span className="pill soft">no run loaded</span>
                  </div>
                  <p className="empty-note">
                    当前本地仓库没有已保存的 Run。创建 Run 或同步团队后，这里才会展示真实工作流。
                  </p>
                </section>
                <aside className="inspector" data-testid="node-inspector-empty">
                  <div className="panel-head panel-head--compact">
                    <span className="panel-title">Inspector</span>
                    <span className="pill soft">empty</span>
                  </div>
                  <p className="empty-note">选择真实 Run 后显示节点、证据、Gate 和 Review。</p>
                </aside>
              </>
            )}
          </section>
        )}

        {activeView === 'team' && (
          <TeamOverview
            projects={teamProjects}
            members={teamMembers}
            projectRollups={teamProjectCost}
            memberRollups={teamMemberCost}
            totalCost={teamTotalCost}
            dataOrigin={dataOrigin}
            runtimeDataSource={runtimeDataSource}
            selectedRun={selectedRun}
            policySnapshot={gateEnforcement.policySnapshot}
            gateEnforcementDecision={gateEnforcement.decision}
            isLoadingGateEnforcement={gateEnforcement.isLoading}
          />
        )}

        {activeView === 'knowledge' && (
          <KnowledgeView
            query={normalizedSearchQuery}
            documents={projectKnowledgeDocuments}
            references={knowledgeReferences}
            selectedRun={selectedRun}
            supportContext={supportContext}
            focusedDocumentId={
              supportContext?.focusTarget === 'knowledge-reference'
                ? supportContext.documentId
                : undefined
            }
            focusedReferenceId={
              supportContext?.focusTarget === 'knowledge-reference'
                ? supportContext.referenceId
                : undefined
            }
            dataSource={knowledgeDataSource}
            onReturnToInspector={returnToInspector}
          />
        )}

        {activeView === 'agents' && (
          <AgentWorkbenchView
            providers={agentProviders}
            selectedProviderId={selectedAgentProviderId}
            onProviderChange={setSelectedAgentProviderId}
            providerIdDraft={providerIdDraft}
            onProviderIdDraftChange={setProviderIdDraft}
            providerBaseUrlDraft={providerBaseUrlDraft}
            onProviderBaseUrlDraftChange={setProviderBaseUrlDraft}
            providerModelDraft={providerModelDraft}
            onProviderModelDraftChange={setProviderModelDraft}
            providerKeyDraft={providerKeyDraft}
            onProviderKeyDraftChange={setProviderKeyDraft}
            onSaveProviderCredential={saveAgentProviderCredential}
            onRunKnowledgeReview={runKnowledgeReview}
            isRunning={isRunningAgentReview}
            selectedRun={selectedRun}
            selectedNode={selectedNode}
            reviews={agentReviews}
            selectedReviews={selectedAgentReviews}
            latestReview={latestAgentReview}
            latestTrace={latestAgentTrace}
            latestUsage={latestAgentUsage}
            onRunCodingAgent={runCodingAgent}
            onReplyCodingPermission={replyCodingPermission}
            onCancelCodingRun={cancelCodingRun}
            onOpenCodingWorktree={openCodingWorktree}
            onDeleteCodingWorktree={deleteCodingWorktree}
            onOpenTests={() => setActiveView('tests')}
            isStartingCodingAgent={isStartingCodingAgent}
            runtimeBudgetApprovalId={runtimeBudgetApprovalId}
            onRuntimeBudgetApprovalIdChange={setRuntimeBudgetApprovalId}
            codingRuns={selectedCodingRuns}
            retryAttempts={selectedRetryAttempts}
            latestCodingRun={latestCodingRun}
            codingEvents={selectedCodingEvents}
            pendingCodingPermission={pendingCodingPermission}
            permissionRequests={selectedCodingPermissionRequests}
            workspace={selectedManagedWorkspace}
            diff={selectedCodingDiff}
            bootstrapEvidence={selectedBootstrapEvidence}
            testEvidence={selectedCodingTestEvidence}
            supportContext={supportContext}
            onReturnToInspector={returnToInspector}
          />
        )}

        {activeView === 'skills' && (
          <SkillView />
        )}

        {activeView === 'mcp' && (
          <McpView servers={mcpServers} onToggle={toggleMcp} />
        )}

        {activeView === 'tests' && (
          <TestsView
            evidence={scopedTestEvidence}
            onRunTests={executeTestPlan}
            isRunningTests={isRunningTests}
            commandDraft={testCommandDraft}
            onCommandDraftChange={setTestCommandDraft}
            onSaveCommand={saveTestCommand}
            project={selectedLocalProject}
            commandSafety={commandSafety}
            isCommandDirty={isTestCommandDirty}
            isSavingCommand={isSavingTestCommand}
            supportContext={supportContext}
            selectedRun={selectedRun}
            selectedNode={selectedNode}
            onReturnToInspector={returnToInspector}
          />
        )}
      </main>

      {isNewRunOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal" role="dialog" aria-modal="true" aria-label="Create new run">
            <div className="section-heading">
              <span>New Run</span>
              <strong>创建 AI 交付流</strong>
            </div>
            <label>
              标题
              <input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} />
            </label>
            <label>
              一句话需求
              <textarea value={draftRequest} onChange={(event) => setDraftRequest(event.target.value)} />
            </label>
            <div className="modal-actions">
              <button className="ghost-button" onClick={() => setIsNewRunOpen(false)}>
                取消
              </button>
              <button className="primary-button" onClick={createRun}>
                创建并开始澄清
              </button>
            </div>
          </section>
        </div>
      )}

      {deleteRunTarget && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal delete-run-modal" role="dialog" aria-modal="true" aria-label="Delete run">
            <div className="delete-run-header">
              <span>{deleteRunTarget.deleteRemote ? '删除远端和本地 Run' : '删除本地 Run'}</span>
              <h2>确认删除这个 Run？</h2>
            </div>
            <div className="delete-run-target">
              <span>将删除的 Run</span>
              <strong title={deleteRunTarget.run.title}>{deleteRunTarget.run.title}</strong>
              <code>{deleteRunTarget.run.branchName}</code>
            </div>
            <div className="delete-run-copy">
              <p className="modal-copy modal-copy--danger">
                删除后，这个 Run 的交付记录、产物、Trace、Review、测试证据、Coding Agent 记录和临时工作区都会从本机移除。
              </p>
              <p className="modal-copy modal-copy--safe-boundary">
                不会删除本地仓库、Local Project 绑定、模型 Provider Credential 或项目级 Policy Snapshot。
              </p>
            </div>
            <div className="modal-actions">
              <button
                className="ghost-button"
                disabled={isDeletingRun}
                onClick={() => setDeleteRunTarget(null)}
              >
                取消
              </button>
              <button className="danger-button" disabled={isDeletingRun} onClick={confirmDeleteRun}>
                {isDeletingRun
                  ? '正在删除...'
                  : deleteRunTarget.deleteRemote
                    ? '删除 Run'
                    : '删除本地 Run'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
