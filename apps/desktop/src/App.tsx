import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
} from '@xyflow/react'
import {
  Activity,
  BookOpen,
  Bot,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  Code2,
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
  buildFlow,
  defaultReviewProviderDraft,
  normalizeQuery,
  reviewProviderFromMetadata,
  runMatchesQuery,
  seedMemberRollups,
  seedProjectRollups,
  seedTotalCost,
  stageLabels,
  type ViewId,
  matchesQuery,
} from './app/desktop-view-model'
import { useDesktopActions } from './app/useDesktopActions'
import { useDesktopWorkspace } from './app/useDesktopWorkspace'
import {
  AgentWorkbenchView,
  AppNode,
  Inspector,
  KnowledgeView,
  LocalProjectPanel,
  McpView,
  Metric,
  NavButton,
  SkillView,
  TeamOverview,
  TestsView,
  ThemeToggle,
} from './views/DesktopViews'

export { getToastDisplayDurationMs } from './app/desktop-view-model'


const nodeTypes = {
  appNode: AppNode,
}

export function App() {
  const workspace = useDesktopWorkspace({
    defaultReviewProviderDraft,
    reviewProviderFromMetadata,
  })
  const { desktopApi, applyLocalExecutionState } = workspace
  const {
    themePreference,
    dataOrigin,
    activeView,
    runs,
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
  const flow = useMemo(() => (selectedRun ? buildFlow(selectedRun) : { nodes: [], edges: [] }), [selectedRun])
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

  return (
    <div className="app-shell" data-origin={dataOrigin}>
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand">
          <div className="brand__mark">AI</div>
          <div>
            <strong>DevFlow</strong>
            <span>Studio</span>
          </div>
        </div>

        <nav className="nav-list">
          <NavButton active={activeView === 'workbench'} icon={<Workflow />} label="工作台" onClick={() => setActiveView('workbench')} />
          <NavButton active={activeView === 'team'} icon={<Users />} label="Team Overview" onClick={() => setActiveView('team')} />
          <NavButton active={activeView === 'knowledge'} icon={<BookOpen />} label="Knowledge" onClick={() => setActiveView('knowledge')} />
          <NavButton active={activeView === 'agents'} icon={<Bot />} label="Agents" onClick={() => setActiveView('agents')} />
          <NavButton active={activeView === 'skills'} icon={<ShieldCheck />} label="Skills" onClick={() => setActiveView('skills')} />
          <NavButton active={activeView === 'mcp'} icon={<Network />} label="MCP" onClick={() => setActiveView('mcp')} />
          <NavButton active={activeView === 'tests'} icon={<TestTube2 />} label="测试" onClick={() => setActiveView('tests')} />
        </nav>

        <div className="sidebar-card">
          <span>Local Agent</span>
          <strong>Electron runner</strong>
          <p>本机仓库、终端与 MCP 调用由 Electron 执行代理接管。</p>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="project-switcher" aria-label="Project selector">
            <Code2 size={17} />
            <div>
              <span>Project</span>
              <strong>
                {teamProjects.find((project) => project.id === selectedRun?.projectId)?.name ??
                  selectedRun?.projectId ??
                  'No project'}
              </strong>
            </div>
            <ChevronRight size={16} />
          </div>

          <div className="search-box">
            <Search size={16} />
            <input
              aria-label="Search runs and knowledge"
              placeholder="Search runs, artifacts, knowledge..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
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
              Redaction
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
          <Metric label="Active Runs" value={String(runs.length)} icon={<Activity />} />
          <Metric label="Pending Gates" value="2" icon={<ClipboardCheck />} />
          <Metric label="Token Cost" value={teamTotalCost} icon={<CircleDollarSign />} />
          <Metric label="Tests Today" value="18 / 20" icon={<TestTube2 />} />
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
                  </button>
                ))
              )}
            </div>

            <div className="canvas-panel" data-testid="workflow-canvas">
              <div className="lane-header">
                {Object.entries(stageLabels).map(([stage, label]) => (
                  <span key={stage}>{label}</span>
                ))}
              </div>
              <ReactFlow
                nodes={flow.nodes}
                edges={flow.edges}
                nodeTypes={nodeTypes}
                defaultViewport={{ x: 22, y: 92, zoom: 0.82 }}
                minZoom={0.55}
                maxZoom={1.15}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable
                onNodeClick={(_, node) => setSelectedNodeId(node.id)}
              >
                <Background variant={BackgroundVariant.Dots} gap={22} size={1} />
                <Controls />
              </ReactFlow>
            </div>

            <Inspector
              selectedRun={selectedRun}
              selectedNode={selectedNode}
              isSelectedCurrentNode={isSelectedCurrentNode}
              artifacts={selectedArtifacts}
              events={selectedEvents}
              governanceChecks={selectedGovernanceChecks}
              references={knowledgeReferences}
              latestAgentReview={latestAgentReview}
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
              onRunTests={executeTestPlan}
              onRunKnowledgeReview={runKnowledgeReview}
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
          />
        )}

        {activeView === 'knowledge' && (
          <KnowledgeView
            query={normalizedSearchQuery}
            documents={knowledgeDocuments}
            references={knowledgeReferences}
            selectedRun={selectedRun}
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
          />
        )}

        {activeView === 'skills' && (
          <SkillView />
        )}

        {activeView === 'mcp' && (
          <McpView servers={mcpServers} onToggle={toggleMcp} />
        )}

        {activeView === 'tests' && (
          <TestsView evidence={testEvidence} onRunTests={executeTestPlan} isRunningTests={isRunningTests} />
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
