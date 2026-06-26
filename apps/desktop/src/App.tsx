import {
  BookOpen,
  Bot,
  ClipboardCheck,
  Network,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  TestTube2,
  Users,
  Workflow,
} from 'lucide-react'
import { useMemo } from 'react'
import {
  buildKnowledgeGovernanceChecks,
  buildKnowledgeReferences,
  knowledgeChunks,
  knowledgeDocuments,
} from '@ai-devflow/shared'
import { useGateEnforcement } from './useGateEnforcement'
import {
  buildSearchResults,
  buildKnowledgeDataSource,
  buildRuntimeDataSource,
  defaultReviewProviderDraft,
  getBoardNodeKind,
  inspectorTabsByKind,
  normalizeQuery,
  reviewProviderFromMetadata,
  runMatchesQuery,
  type SearchResultItem,
  matchesQuery,
} from './app/desktop-view-model'
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

  const normalizedSearchQuery = normalizeQuery(searchQuery)
  const visibleRuns = useMemo(
    () => runs.filter((run) => runMatchesQuery(run, artifacts, events, normalizedSearchQuery)),
    [artifacts, events, normalizedSearchQuery, runs],
  )
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? runs[0]
  const selectedNode =
    selectedRun?.nodes.find((node) => node.id === selectedNodeId) ?? selectedRun?.nodes[0]
  const isSelectedCurrentNode = Boolean(
    selectedRun && selectedNode && selectedRun.currentNodeId === selectedNode.id,
  )
  const selectedArtifacts = artifacts
    .filter((artifact) => selectedNode?.artifactIds.includes(artifact.id))
    .filter((artifact) =>
      matchesQuery(normalizedSearchQuery, [
        artifact.title,
        artifact.summary,
        artifact.content,
        artifact.kind,
      ]),
    )
  const selectedEvents = events.filter(
    (event) =>
      event.runId === selectedRun?.id &&
      (!selectedNode || event.nodeId === selectedNode.id) &&
      matchesQuery(normalizedSearchQuery, [event.kind, event.message]),
  )
  const currentUser = teamMembers.find((member) => member.id === 'u-ling') ?? teamMembers[1]
  const knowledgeReferences = useMemo(
    () =>
      selectedRun
        ? buildKnowledgeReferences({
            run: selectedRun,
            artifacts,
            documents: knowledgeDocuments,
            chunks: knowledgeChunks,
            testEvidence,
          })
        : [],
    [artifacts, selectedRun, testEvidence],
  )
  const selectedGovernanceChecks = useMemo(
    () =>
      selectedRun && selectedNode
        ? buildKnowledgeGovernanceChecks({
            run: selectedRun,
            node: selectedNode,
            artifacts,
            documents: knowledgeDocuments,
            chunks: knowledgeChunks,
            testEvidence,
          })
        : [],
    [artifacts, selectedNode, selectedRun, testEvidence],
  )
  const searchResults = useMemo(
    () =>
      buildSearchResults({
        query: normalizedSearchQuery,
        runs,
        artifacts,
        events,
        knowledgeDocuments,
        knowledgeReferences,
      }),
    [artifacts, events, knowledgeReferences, normalizedSearchQuery, runs],
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
    ? testEvidence.find((evidence) => evidence.id === latestCodingRun.testEvidenceId)
    : undefined
  const remoteRunIdSet = useMemo(() => new Set(remoteRunIds), [remoteRunIds])
  const remoteRunCount = runs.filter((run) => remoteRunIdSet.has(run.id)).length
  const localRunCount = runs.length - remoteRunCount
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
  const gateEnforcement = useGateEnforcement({
    desktopApi,
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

  function selectRunNode(runId: string | undefined, nodeId: string | undefined) {
    const run = runs.find((candidate) => candidate.id === runId) ?? selectedRun
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
      const run = runs.find((candidate) => candidate.id === result.runId) ?? selectedRun
      const node =
        run?.nodes.find((candidate) => candidate.id === result.nodeId) ??
        run?.nodes.find((candidate) => candidate.id === run.currentNodeId)
      if (run && node) {
        const visualKind = getBoardNodeKind(node)
        const tabs = inspectorTabsByKind[visualKind]
        const artifactTab = tabs.includes('产物') ? '产物' : tabs.includes('Artifacts') ? 'Artifacts' : 'Evidence'
        const eventTab = tabs.includes('Trace') ? 'Trace' : tabs.includes('Handoff') ? 'Handoff' : '状态'
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
          inspectorTab: result.type === 'artifact' ? artifactTab : eventTab,
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
              <strong className="project-value">
                {teamProjects.find((project) => project.id === selectedRun?.projectId)?.name ??
                  selectedRun?.projectId ??
                  'No project'}
              </strong>
              <span className="pill accent">lead</span>
            </div>
            <div className="project-line">
              <span className="project-label">Local Project</span>
              <strong className="project-value project-value--local">
                {selectedLocalProject?.path ?? '~/File/claude/10-showcase/ai-devflow-studio'}
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
              <span>{desktopPairing ? `Paired ${desktopPairing.projectId}` : 'Unpaired'}</span>
              <input
                aria-label="Desktop pairing code"
                placeholder="Pairing code"
                value={pairingCodeDraft}
                onChange={(event) => setPairingCodeDraft(event.target.value)}
              />
              <button type="submit" className="ghost-button" disabled={isPairingDesktop}>
                {isPairingDesktop ? '配对中' : 'Pair'}
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
            <div className="avatar" aria-label={`Current user ${currentUser?.name}`}>
              {currentUser?.avatarInitials}
            </div>
          </div>
        </header>

        <section className="status-strip" aria-live="polite">
          <span className="stat stat--source" data-testid="runtime-source-badge" title={runtimeDataSource.detail}>
            数据源 <strong className={`pill ${runtimeDataSource.tone}`}>{runtimeDataSource.label}</strong>
            <em>{runtimeDataSource.status}</em>
          </span>
          <span className="stat">Active Runs <strong>{runs.length}</strong></span>
          <span className="stat">Run Sources <strong>{localRunCount} local · {remoteRunCount} remote</strong></span>
          <span className="stat">Pending Gates <strong>4</strong></span>
          <span className="stat">Token Cost <strong>{teamTotalCost}</strong></span>
          <span className="stat">Tests Today <strong>18</strong></span>
          <span className="stat">同步状态 <strong>local + {policySource}</strong></span>
          <span className="stat">Policy Snapshot <strong>{policyVersion ? `v${policyVersion}` : 'not loaded'}</strong></span>
          <span className="stat">策略状态 <strong className={`pill ${policyTone}`}>{policyStatus}</strong></span>
          <span className="stat">预算风险 <strong className="pill warn">over budget approval</strong></span>
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

        {activeView === 'workbench' && selectedRun && (
          <section className="workbench-layout">
            <div className="run-list">
              <LocalProjectPanel
                project={selectedLocalProject}
                commandDraft={testCommandDraft}
                onCommandDraftChange={setTestCommandDraft}
                onSelectProject={selectLocalProject}
                onSaveCommand={saveTestCommand}
                desktopConnected={Boolean(desktopApi)}
                commandSafety={commandSafety}
                isCommandDirty={isTestCommandDirty}
                isSavingCommand={isSavingTestCommand}
              />
              <div className="section-heading">
                <span>Runs</span>
                <strong>开发者工作台</strong>
              </div>
              {visibleRuns.length === 0 ? (
                <p className="empty-note">没有匹配的 Run</p>
              ) : (
                visibleRuns.map((run) => (
                  <button
                    key={run.id}
                    className={`run-row ${run.id === selectedRun.id ? 'is-selected' : ''}`}
                    onClick={() => {
                      setSelectedRunId(run.id)
                      setSelectedNodeId(run.currentNodeId)
                    }}
                  >
                    <strong>{run.title}</strong>
                    <span>{run.branchName}</span>
                    <em>{run.status}</em>
                    <span className={`pill ${remoteRunIdSet.has(run.id) ? 'accent' : dataOrigin === 'seed' ? 'soft' : 'good'}`}>
                      {remoteRunIdSet.has(run.id) ? 'remote' : dataOrigin === 'seed' ? 'seed' : 'local'}
                    </span>
                  </button>
                ))
              )}
            </div>

            <WorkflowBoard
              run={selectedRun}
              artifacts={artifacts}
              events={events}
              testEvidence={testEvidence}
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
            documents={knowledgeDocuments}
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
            evidence={testEvidence}
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
    </div>
  )
}
