import { DiscussionToggle, WorkbenchWorkspace, type WorkbenchOpenRequest } from './WorkbenchWorkspace'
import { TeamConnectionMenu, TopbarProjectMenu } from './views/TaskShell'
import { TeamConnectionSettings } from './views/TeamConnectionSettings'
import { SettingsView } from './views/SettingsView'
import { ModelSettings } from './views/ModelSettings'
import { LocalProjectSettings } from './views/LocalProjectSettings'
import { AgentEvidenceGroups, CodingRunRecords } from './views/CodingRunRecords'
import { StageAgentFailureRecords } from './views/StageAgentFailureRecords'
import { AgentRuntimePanel } from './AgentRuntimePanel'
import { AgentCoordinationPanel } from './AgentCoordinationPanel'
import { AgentMemoryPanel } from './AgentMemoryPanel'
import { buildAgentEvidenceGroups } from './app/agent-evidence-view-model'
import { buildTeamConnectionView, deliveryIntentsRevokedByRepair } from './app/team-connection-view-model'
import { formatLocalTime, settingsSectionForTaskTarget, type InspectorReadingPosition, type SettingsSection } from './app/desktop-view-model'
import { buildRunUsageSummary } from './app/run-usage-summary'
import { buildTestRunReadiness } from './app/test-run-readiness'
import { useTestEvidenceFreshness } from './app/test-evidence-freshness'
import { runtimeSourceLabel } from './app/team-overview-copy'
import {
  BookOpen,
  ClipboardCheck,
  ChevronDown,
  Settings2,
  MoreHorizontal,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Users,
  Workflow,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  buildKnowledgeGovernanceChecks,
  buildKnowledgeReferences,
  isActiveCodingAgentRunStatus,
  type KnowledgeChunk,
  type KnowledgeDocument,
  type KnowledgeEntity,
  type KnowledgeRelation,
  type ProjectGitStatus,
  type CodingChangeSetPreview,
  type WorkflowNode,
  type WorkflowRun,
  type StageAgentExecutorKind,
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
  searchResultTypeLabels,
  runMatchesQuery,
  type SearchResultItem,
  matchesQuery,
} from './app/desktop-view-model'
import { buildKnowledgeDirectoryView, recordedKnowledgeManifests } from './app/knowledge-directory-view-model'
import {
  displayNodeTitle,
  resolveInspectorTabForSearchResult,
  selectGitHubDeliveryIntentForInspector,
  hasArchivedUpstreamCodingDiff,
  stageLabels,
} from './app/node-inspector-view-model'
import { buildDiscussionReference, type DiscussionMaterial } from './app/discussion-reference'
import { useDesktopActions } from './app/useDesktopActions'
import { useDesktopWorkspace } from './app/useDesktopWorkspace'
import { useWorkRequestInbox } from './app/useWorkRequestInbox'
import { useCodingRuntimeReadiness } from './app/useCodingRuntimeReadiness'
import { useProjectRuntimeBudget } from './app/useProjectRuntimeBudget'
import { buildCodingRuntimeActionProjection } from './app/coding-runtime-action-projection'
import type { DesktopDataProfileDiagnostics } from './desktop-api'
import { DiagnosticHistory } from './components/DiagnosticHistory'
import { CredentialAccessStatus } from './components/CredentialAccessStatus'
import { WorkRequestInbox } from './WorkRequestInbox'
import {
  Inspector,
  KnowledgeView,
  LocalProjectPanel,
  McpView,
  NavButton,
  SkillView,
  TeamOverview,
  ThemeToggle,
  WorkflowBoard,
  type WorkflowBoardView,
} from './views/DesktopViews'
import { ipcErrorMessage } from './app/ipc-error'

export { getToastDisplayDurationMs } from './app/desktop-view-model'

const emptyProjectKnowledgeDocuments: KnowledgeDocument[] = []
const emptyProjectKnowledgeChunks: KnowledgeChunk[] = []
const emptyProjectKnowledgeEntities: KnowledgeEntity[] = []
const emptyProjectKnowledgeRelations: KnowledgeRelation[] = []

export function App() {
  const [workbenchOpenRequest, setWorkbenchOpenRequest] = useState<WorkbenchOpenRequest>({ serial: 0, type: 'details' })
  const openNodeDetails = () => setWorkbenchOpenRequest((previous) => ({ serial: previous.serial + 1, type: 'details' }))
  const workspace = useDesktopWorkspace({
    defaultReviewProviderDraft,
    reviewProviderFromMetadata,
  })
  const { desktopApi, applyLocalExecutionState, refreshRepositoryKnowledge } = workspace
  const [modelBudgetEvent, setModelBudgetEvent] = useState<{ projectId: string; providerId: string; decision: import('@ai-devflow/shared').BudgetGuardDecision }>()
  useEffect(() => desktopApi?.onModelBudgetUpdated?.(setModelBudgetEvent), [desktopApi])
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
    knowledgeReviewExecutor,
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
    githubDeliveryIntents,
    githubDeliveryOperatorOutcomes,
    githubDeliveryRevocationChecks,
    githubRepositoryBindings,
    retryAttempts,
    remoteSyncOperations,
    providerNameDraft,
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
    pendingInspectorAction,
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
    setKnowledgeReviewExecutor,
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
    setProviderNameDraft,
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
    setPendingInspectorAction,
  } = workspace.setters
  const {
    selectedLocalProject,
    isTestCommandDirty,
    repositoryKnowledge,
    isLoadingRepositoryKnowledge,
    repositoryKnowledgeError,
  } = workspace.derived
  const projectKnowledgeDocuments = repositoryKnowledge?.documents ?? emptyProjectKnowledgeDocuments
  const projectKnowledgeChunks = repositoryKnowledge?.chunks ?? emptyProjectKnowledgeChunks
  const projectKnowledgeEntities = repositoryKnowledge?.entities ?? emptyProjectKnowledgeEntities
  const projectKnowledgeRelations = repositoryKnowledge?.relations ?? emptyProjectKnowledgeRelations
  const [projectGitStatus, setProjectGitStatus] = useState<ProjectGitStatus | null>(null)
  const [isRefreshingGitStatus, setIsRefreshingGitStatus] = useState(false)
  const [openRunMenuId, setOpenRunMenuId] = useState<string | null>(null)
  const openRunMenuRef = useRef<HTMLDivElement>(null)
  // Filled by the Inspector; read before a settings page opens so the return restores it (W9).
  const readingPositionRef = useRef<(() => InspectorReadingPosition | null) | null>(null)
  // Settings section (plan Y2) and the board display mode, now chosen in the task menu (Y6).
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('project')
  const [boardView, setBoardView] = useState<WorkflowBoardView>('compact')
  const [settingsFocus, setSettingsFocus] = useState<'coding' | 'models' | undefined>()
  const [deleteRunTarget, setDeleteRunTarget] = useState<{
    run: WorkflowRun
    deleteRemote: boolean
  } | null>(null)
  const [isDeletingRun, setIsDeletingRun] = useState(false)
  const [codingChangeSetPreview, setCodingChangeSetPreview] = useState<CodingChangeSetPreview | null>(null)
  const [codingRuntimeNow, setCodingRuntimeNow] = useState(() => new Date().toISOString())
  const [stageChoices, setStageChoices] = useState<Record<string, { executor: StageAgentExecutorKind; providerId: string }>>({})
  const [dataProfileDiagnostics, setDataProfileDiagnostics] =
    useState<DesktopDataProfileDiagnostics | null>(null)

  useEffect(() => {
    if (!desktopApi?.loadDataProfileDiagnostics) return
    let disposed = false
    const loadDiagnostics = async () => {
      try {
        const diagnostics = await desktopApi.loadDataProfileDiagnostics()
        if (!disposed) setDataProfileDiagnostics(diagnostics)
      } catch {
        if (!disposed) setDataProfileDiagnostics(null)
      }
    }
    void loadDiagnostics()
    return () => {
      disposed = true
    }
  }, [desktopApi, runs])

  useEffect(() => {
    if (!openRunMenuId) {
      return
    }

    const closeOnOutsideInteraction = (event: Event) => {
      const target = event.target as Node | null
      if (target && openRunMenuRef.current?.contains(target)) {
        return
      }
      setOpenRunMenuId(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenRunMenuId(null)
      }
    }

    document.addEventListener('pointerdown', closeOnOutsideInteraction)
    document.addEventListener('click', closeOnOutsideInteraction)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideInteraction)
      document.removeEventListener('click', closeOnOutsideInteraction)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [openRunMenuId])

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
  const scopedRemoteSyncOperations = useMemo(
    () =>
      selectedLocalProject
        ? remoteSyncOperations.filter(
            (operation) =>
              operation.localProjectId === selectedLocalProject.id &&
              operation.status !== 'completed',
          )
        : [],
    [remoteSyncOperations, selectedLocalProject],
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
  const stageChoiceKey = `${selectedRun?.id ?? ''}:${selectedNode?.id ?? ''}`
  const stageChoice = stageChoices[stageChoiceKey] ?? { executor: 'direct-provider' as const, providerId: selectedAgentProviderId }
  const stageAgentExecutorKind = stageChoice.executor
  const setStageAgentExecutorKind = (executor: StageAgentExecutorKind) => setStageChoices((current) => ({
    ...current, [stageChoiceKey]: { ...stageChoice, executor },
  }))
  const setStageProviderId = (providerId: string) => setStageChoices((current) => ({
    ...current, [stageChoiceKey]: { ...stageChoice, providerId },
  }))
  const selectedGitHubDeliveryIntent = useMemo(
    () => selectGitHubDeliveryIntentForInspector({
      run: selectedRun,
      node: selectedNode,
      intents: githubDeliveryIntents,
    }),
    [githubDeliveryIntents, selectedNode, selectedRun],
  )
  const selectedGitHubDeliveryOperatorOutcome = useMemo(
    () => selectedGitHubDeliveryIntent
      ? githubDeliveryOperatorOutcomes.find(
          (outcome) =>
            outcome.intentId === selectedGitHubDeliveryIntent.id &&
            outcome.intentUpdatedAt === selectedGitHubDeliveryIntent.updatedAt,
        )
      : undefined,
    [githubDeliveryOperatorOutcomes, selectedGitHubDeliveryIntent],
  )
  const selectedRevokedGitHubRepositoryBinding = useMemo(() => {
    if (!selectedGitHubDeliveryIntent || selectedGitHubDeliveryIntent.status !== 'completed') {
      return undefined
    }
    const authorities = githubRepositoryBindings.filter((binding) =>
      binding.id === selectedGitHubDeliveryIntent.repositoryBindingId &&
      binding.version > selectedGitHubDeliveryIntent.repositoryBindingVersion &&
      binding.organizationId === selectedGitHubDeliveryIntent.organizationId &&
      binding.teamProjectId === selectedGitHubDeliveryIntent.teamProjectId &&
      binding.installationId === selectedGitHubDeliveryIntent.installationId &&
      binding.repositoryId === selectedGitHubDeliveryIntent.repositoryId &&
      binding.repository === selectedGitHubDeliveryIntent.repository &&
      binding.defaultBranch === selectedGitHubDeliveryIntent.baseBranch &&
      binding.redacted === true,
    )
    return authorities.length === 1 && authorities[0]?.status === 'revoked'
      ? authorities[0]
      : undefined
  }, [githubRepositoryBindings, selectedGitHubDeliveryIntent])
  const canVerifyGitHubDeliveryRevocation = Boolean(
    selectedGitHubDeliveryIntent?.status === 'completed' &&
    selectedRevokedGitHubRepositoryBinding,
  )
  const selectedGitHubDeliveryRevocationCheck = useMemo(() => {
    if (!selectedGitHubDeliveryIntent || !selectedRevokedGitHubRepositoryBinding) {
      return undefined
    }
    const matches = githubDeliveryRevocationChecks.filter((check) =>
      check.intentId === selectedGitHubDeliveryIntent.id &&
      check.intentUpdatedAt === selectedGitHubDeliveryIntent.updatedAt &&
      check.bindingId === selectedGitHubDeliveryIntent.repositoryBindingId &&
      check.bindingVersion === selectedRevokedGitHubRepositoryBinding.version &&
      check.outcomeCode === 'binding_inactive' &&
      check.redacted === true,
    )
    return matches.length === 1 ? matches[0] : undefined
  }, [
    githubDeliveryRevocationChecks,
    selectedGitHubDeliveryIntent,
    selectedRevokedGitHubRepositoryBinding,
  ])
  const desktopPairingExpired = Boolean(
    desktopPairing?.expiresAt &&
      Number.isFinite(Date.parse(desktopPairing.expiresAt)) &&
      Date.parse(desktopPairing.expiresAt) <= Date.now(),
  )
  const hasSelectedLocalProjectBinding = Boolean(
    !desktopPairingExpired &&
      selectedLocalProject &&
      desktopPairing?.localProjectId === selectedLocalProject.id,
  )
  const handleWorkRequestMaterialized = useCallback(
    async (result: Awaited<ReturnType<NonNullable<typeof desktopApi>['materializeWorkRequest']>>) => {
      applyLocalExecutionState(result.state)
      setSelectedRunId(result.run.id)
      setSelectedNodeId(result.run.currentNodeId)
      setActiveView('workbench')
      setToast('已从团队请求创建本地任务')
    },
    [
      applyLocalExecutionState,
      setActiveView,
      setSelectedNodeId,
      setSelectedRunId,
      setToast,
    ],
  )
  const workRequestInbox = useWorkRequestInbox({
    desktopApi,
    localProjectId: selectedLocalProject?.id ?? '',
    isPaired: hasSelectedLocalProjectBinding,
    onMaterialized: handleWorkRequestMaterialized,
  })
  const hasDeliveryProjectBinding = Boolean(
    !desktopPairingExpired &&
      desktopPairing?.localProjectId &&
      desktopPairing.localProjectId === selectedRun?.projectId,
  )
  const selectedTeamProjectId = hasSelectedLocalProjectBinding
    ? desktopPairing?.projectId
    : selectedLocalProject
      ? undefined
      : selectedRun?.projectId
  const selectedTeamProject = teamProjects.find((project) => project.id === selectedTeamProjectId)
  const teamProjectLabel =
    selectedTeamProject?.name ??
    (hasSelectedLocalProjectBinding
      ? desktopPairing?.projectName ?? desktopPairing?.projectId ?? ''
      : '')
  const teamProjectSource = !hasSelectedLocalProjectBinding
    ? 'unbound'
    : selectedTeamProject
      ? 'bound_synced'
      : 'bound_unsynced'
  const isSelectedCurrentNode = Boolean(
    selectedRun && selectedNode && selectedRun.currentNodeId === selectedNode.id,
  )
  const selectedArtifacts = scopedArtifacts
    .filter((artifact) => selectedNode?.artifactIds.includes(artifact.id))
  const selectedEvents = scopedEvents.filter(
    (event) =>
      event.runId === selectedRun?.id &&
      (!selectedNode || event.nodeId === selectedNode.id),
  )
  const pairedUser = !desktopPairingExpired && desktopPairing
    ? {
        id: desktopPairing.userId,
        name: desktopPairing.userName ?? desktopPairing.userId,
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
  const pairedTeamMember = teamMembers.find((member) => member.id === desktopPairing?.userId)
  const currentUser = pairedUser
    ? { ...pairedTeamMember, ...pairedUser, role: pairedUser.role }
    : teamMembers.find((member) => member.id === selectedRun?.creatorId) ??
      teamMembers[0] ??
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
    [projectKnowledgeChunks, projectKnowledgeDocuments, scopedArtifacts, scopedTestEvidence, selectedRun],
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
    [
      projectKnowledgeChunks,
      projectKnowledgeDocuments,
      scopedArtifacts,
      scopedTestEvidence,
      selectedNode,
      selectedRun,
    ],
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
    [
      knowledgeReferences,
      normalizedSearchQuery,
      projectKnowledgeDocuments,
      scopedArtifacts,
      scopedEvents,
      scopedRuns,
    ],
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
  const latestAgentUsage = agentTokenUsage
    .filter((usage) => usage.runId === selectedRun?.id && usage.nodeId === selectedNode?.id)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0]
  const runUsage = buildRunUsageSummary(selectedRun?.id, agentTokenUsage, codingRuns, agentTraces)
  const selectedCodingRuns = useMemo(
    () =>
      codingRuns
        .filter((run) => (
          run.runId === selectedRun?.id &&
          run.projectId === selectedLocalProject?.id
        ))
        .sort((a, b) => {
          const byActive = Number(isActiveCodingAgentRunStatus(b.status)) - Number(isActiveCodingAgentRunStatus(a.status))
          return byActive || b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id)
        }),
    [codingRuns, selectedLocalProject, selectedRun],
  )
  const selectedRetryAttempts = useMemo(
    () =>
      retryAttempts
        .filter((attempt) => attempt.runId === selectedRun?.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [retryAttempts, selectedRun],
  )
  const latestCodingRun = selectedCodingRuns[0]
  // Whether each passed result still applies to the tested code (hardening H3, X6).
  const testEvidenceFreshness = useTestEvidenceFreshness(desktopApi, selectedRun?.id, scopedTestEvidence,
    selectedCodingRuns.map((run) => `${run.id}:${run.status}:${run.completedAt ?? ''}`).join('|'))
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

  useEffect(() => {
    if (!desktopApi || !pendingCodingPermission?.changeSetId) {
      setCodingChangeSetPreview(null)
      return
    }
    let active = true
    setCodingChangeSetPreview(null)
    void desktopApi.getCodingChangeSetPreview({
      changeSetId: pendingCodingPermission.changeSetId,
      codingRunId: pendingCodingPermission.codingRunId,
    }).then((preview) => {
      if (active) setCodingChangeSetPreview(preview)
    }).catch(() => {
      if (active) setCodingChangeSetPreview(null)
    })
    return () => {
      active = false
    }
  }, [desktopApi, pendingCodingPermission?.changeSetId, pendingCodingPermission?.codingRunId])

  useEffect(() => {
    setCodingRuntimeNow(new Date().toISOString())
    if (!pendingCodingPermission) return
    const timer = window.setInterval(() => setCodingRuntimeNow(new Date().toISOString()), 1_000)
    return () => window.clearInterval(timer)
  }, [pendingCodingPermission?.id])
  const selectedManagedWorkspace = latestCodingRun
    ? managedCodingWorkspaces.find((workspace) => workspace.id === latestCodingRun.managedWorkspaceId)
    : undefined
  const selectedBootstrapEvidence = latestCodingRun
    ? dependencyBootstrapEvidence.find((evidence) => evidence.id === latestCodingRun.bootstrapEvidenceId)
    : undefined
  const selectedCodingTestEvidence = latestCodingRun
    ? scopedTestEvidence.find((evidence) => evidence.id === latestCodingRun.testEvidenceId)
    : undefined
  const projectRuntimeBudget = useProjectRuntimeBudget({
    desktopApi,
    projectId: selectedLocalProject?.id,
    bindingKey: hasSelectedLocalProjectBinding
      ? `${selectedTeamProjectId}:${desktopPairing?.tokenId ?? ''}:${selectedLocalProject?.updatedAt ?? ''}`
      : '',
  })
  const modelReadinessError = !desktopApi || selectedAgentProviderId === 'fake-knowledge-review' ? undefined :
    // The conversation bar says what to do; the read error itself is shown in 设置／模型与执行方式 (H4).
    projectRuntimeBudget.status !== 'loaded' ? `云端预算${projectRuntimeBudget.label}，请先同步团队策略。` :
    !projectRuntimeBudget.policy ? '尚未配置当前项目的云端预算，请先在设置／模型与执行方式中保存团队预算。' : undefined

  const codingRuntime = useCodingRuntimeReadiness({
    desktopApi,
    projectId: selectedLocalProject?.id,
    runId: selectedRun?.id,
    nodeId: selectedNode?.id,
    requestedBy: currentUser?.id,
    runtimeBudgetApprovalId,
    refreshKey: [
      desktopPairing?.tokenId ?? '',
      selectedLocalProject?.updatedAt ?? '',
      selectedCodingRuns.map((run) => `${run.id}:${run.status}`).join(','),
      pendingCodingPermission?.status ?? '',
    ].join('|'),
  })
  const codingActionProjection = useMemo(() => {
    if (!selectedRun || !selectedNode || !selectedLocalProject) return undefined
    return buildCodingRuntimeActionProjection({
      runId: selectedRun.id,
      nodeId: selectedNode.id,
      projectId: selectedLocalProject.id,
      node: selectedNode,
      isSelectedCurrentNode,
      codingRuns,
      permissionRequests: codingPermissionRequests,
      workspaces: managedCodingWorkspaces,
      diffArtifacts: codingDiffArtifacts,
      testEvidence: scopedTestEvidence,
      events: codingEvents,
      readiness: codingRuntime.readiness,
      isStartingCodingAgent,
      changeSetPreview: codingChangeSetPreview,
      now: codingRuntimeNow,
    })
  }, [
    codingRuns,
    codingPermissionRequests,
    managedCodingWorkspaces,
    codingDiffArtifacts,
    scopedTestEvidence,
    codingEvents,
    codingChangeSetPreview,
    codingRuntime.readiness,
    codingRuntimeNow,
    isSelectedCurrentNode,
    isStartingCodingAgent,
    selectedLocalProject,
    selectedNode,
    selectedRun,
  ])
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
  const hasUnknownProjectCost = runUsage.unknownCostCount > 0 ||
    agentTokenUsage.some((usage) => usage.projectId === selectedLocalProject?.id && usage.costUsd === null) ||
    teamProjectCost.some((cost) => cost.key === selectedTeamProject?.id && (cost.unknownCostCount ?? 0) > 0)
  const currentModelBudget = modelBudgetEvent?.projectId === selectedLocalProject?.id ? modelBudgetEvent : undefined
  const effectiveBudgetDecision = currentModelBudget?.decision ?? latestCodingRun?.budgetDecision
  const budgetStatus = hasUnknownProjectCost && !effectiveBudgetDecision?.blocksRun
    ? '数据不完整 · 有金额待确认'
    : effectiveBudgetDecision?.status ?? (runtimeBudgetApprovalId ? 'approval entered' : '尚未执行')
  const budgetTone =
    budgetStatus === 'allowed' || budgetStatus === 'approved_over_budget'
      ? 'good'
      : budgetStatus === 'unavailable'
        ? 'bad'
        : budgetStatus === 'warning' || budgetStatus === 'requires_lead_approval' || budgetStatus === 'approval entered'
          ? 'warn'
          : 'soft'
  const budgetRecoveryCopy =
    budgetStatus === 'unavailable'
      ? effectiveBudgetDecision?.reason ?? '预算暂不可用，请在设置／模型与执行方式中同步云端策略。'
      : null
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
        snapshot: repositoryKnowledge,
        isLoading: isLoadingRepositoryKnowledge,
        error: repositoryKnowledgeError,
      }),
    [dataOrigin, desktopApi, isLoadingRepositoryKnowledge, repositoryKnowledge, repositoryKnowledgeError],
  )
  // Knowledge page (knowledge-context plan K4): computed only while the page is open.
  const knowledgeDirectory = useMemo(
    () => activeView === 'knowledge'
      ? buildKnowledgeDirectoryView({
          snapshot: repositoryKnowledge,
          recordedManifests: recordedKnowledgeManifests(agentTraces, scopedRunIdSet, codingRuns),
        })
      : undefined,
    [activeView, agentTraces, codingRuns, repositoryKnowledge, scopedRunIdSet],
  )
  const isSelectedNodeGateLike = selectedNode?.kind === 'gate' || selectedNode?.kind === 'acceptance'
  const gateEnforcement = useGateEnforcement({
    desktopApi: dataOrigin !== 'seed' ? desktopApi : null,
    isEnabled: dataOrigin !== 'seed' && isSelectedNodeGateLike,
    projectId: selectedRun?.projectId ?? selectedLocalProject?.id,
    selectedRun,
    selectedNode,
    currentUser,
    artifacts,
    agentReviews,
    testEvidence,
    governanceChecks: selectedGovernanceChecks,
    knowledgeReferences,
    knowledgeContentHash: repositoryKnowledge?.contentHash ?? '',
    pendingInspectorAction,
    setPendingInspectorAction,
    onToast: setToast,
  })

  const {
    changeThemePreference,
    syncRemoteTeamState,
    teamSyncFeedback,
    pairDesktopWithTeam,
    approveSelectedGate,
    completeSelectedWorkflowAgentNode,
    requestSelectedClarificationChanges,
    selectLocalProject,
    saveTestCommand,
    executeTestPlan,
    saveAgentProviderCredential,
    runKnowledgeReview,
    cancelKnowledgeReview,
    knowledgeReviewTarget,
    runCodingAgent: runCodingAgentAction,
    startRemediationRetry,
    replyCodingPermission,
    renewCodingPermission,
    isReplyingCodingPermission,
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
    pairingFeedback,
    newRunError,
    setNewRunError,
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
    ...(selectedGitHubDeliveryIntent
      ? { selectedGitHubDeliveryIntent }
      : {}),
    canVerifyGitHubDeliveryRevocation,
    gateEnforcementDecision: gateEnforcement.decision,
    onRemoteTeamSynced: async () => {
      const [policy] = await Promise.all([
        gateEnforcement.refresh(),
        projectRuntimeBudget.refresh(),
      ])
      return policy
    },
    stageAgentExecutorKind,
    stageProviderId: stageChoice.providerId,
    applyLocalExecutionState,
  })

  // Not ready: stay on the task, where 当前工作 lists the blockers and offers settings (plan W3).
  const runCodingAgent = useCallback((additionalAttemptAfterCount?: number) => {
    if (codingRuntime.readiness?.status !== 'ready') {
      setToast(
        codingRuntime.readiness?.checks.find((check) => check.status === 'blocked')?.message ??
          codingRuntime.error ??
          'Coding Runtime 尚未就绪，请先完成执行配置。',
      )
      return
    }
    void runCodingAgentAction(additionalAttemptAfterCount)
  }, [codingRuntime.error, codingRuntime.readiness, runCodingAgentAction, setToast])

  // Gate Review in the task (plan W2): model, budget and failure facts for the status row.
  const reviewProvider = agentProviders.find((provider) => provider.id === selectedAgentProviderId)
  const reviewProviderLabel = reviewProvider
    ? `${knowledgeReviewExecutor === 'local-agent' ? 'OpenCode（可读仓库）· ' : ''}${reviewProvider.name} · ${reviewProvider.model}`
    : undefined
  const reviewRunBlockedReason = !desktopApi
    ? '请在桌面应用中运行门禁审查。'
    : !selectedAgentProviderId
      ? '尚未选择门禁审查使用的模型，请先在设置／模型与执行方式中选择。'
      : knowledgeReviewExecutor === 'local-agent' && reviewProvider?.kind === 'fake'
        ? 'OpenCode 门禁审查需要已保存的模型 Provider；请在设置中更换，或把审查方式改回只依据知识目录。'
        : modelReadinessError
  const latestReviewFailure = selectedEvents
    .filter((event) => event.kind === 'error' && event.message.includes('门禁审查') && (!latestAgentReview || event.timestamp > latestAgentReview.createdAt))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0]?.message
  const isRunningKnowledgeReviewHere = isRunningAgentReview &&
    knowledgeReviewTarget?.runId === selectedRun?.id && knowledgeReviewTarget?.nodeId === selectedNode?.id
  const testRunReadiness = buildTestRunReadiness({ project: selectedLocalProject, run: selectedRun })
  const latestCodingProviderName = latestCodingRun
    ? agentProviders.find((provider) => provider.id === latestCodingRun.providerId)?.name ?? '旧版 Provider'
    : reviewProvider?.name

  const teamConnectionView = buildTeamConnectionView({
    localProjectId: selectedLocalProject?.id,
    pairing: desktopPairing ?? null,
    pairingExpired: desktopPairingExpired,
    operations: scopedRemoteSyncOperations,
    teamProjectName: teamProjectLabel,
    teamDataReadAt: teamSyncFeedback?.status === 'success' && teamSyncFeedback.at ? formatLocalTime(teamSyncFeedback.at) : null,
    teamDataError: teamSyncFeedback?.status === 'error' ? teamSyncFeedback.message : null,
    // The policy snapshot is reported on its own line (plan §6.5, Y7).
    policy: gateEnforcement.isLoading
      ? { status: 'loading' }
      : gateEnforcement.policySnapshot
        ? {
            status: gateEnforcement.loadError ? 'failed' : 'loaded',
            version: gateEnforcement.policySnapshot.version,
            syncedAt: formatLocalTime(gateEnforcement.policySnapshot.syncedAt),
            source: gateEnforcement.policySnapshot.source,
            ...(gateEnforcement.loadError ? { error: gateEnforcement.loadError } : {}),
          }
        : gateEnforcement.loadError
          ? { status: 'failed', error: gateEnforcement.loadError }
          : { status: 'unavailable' },
    formatTime: formatLocalTime,
  })

  // Execution evidence in 执行记录 (plan Y3). Coding evidence belongs to the build step; the diff,
  // test logs, permissions, coding trace and coding cost are already shown there, once (plan W1).
  const showsCodingRecords = selectedNode?.kind === 'task' && selectedNode.stage === 'build' && Boolean(latestCodingRun)
  const executionEvidenceGroups = buildAgentEvidenceGroups({
    providers: agentProviders,
    selectedReviews: selectedAgentReviews,
    latestTrace: latestAgentTrace,
    latestUsage: latestAgentUsage,
    retryAttempts: showsCodingRecords ? selectedRetryAttempts : [],
    latestCodingRun: undefined,
    codingEvents: showsCodingRecords ? selectedCodingEvents : [],
    pendingCodingPermission: undefined,
    permissionRequests: [],
    diff: undefined,
    bootstrapEvidence: showsCodingRecords ? selectedBootstrapEvidence : undefined,
    testEvidence: undefined,
  }).filter((group) => group.id !== 'coding-trace')

  // A credential the service rejected is not a current identity (plan X3).
  const teamConnectionIdentity = teamConnectionView.connection === 'connected' && desktopPairing
    ? `${desktopPairing.userName ?? desktopPairing.userId} · ${desktopPairing.role} · ${desktopPairing.projectName ?? desktopPairing.projectId}`
    : ''

  async function retryTerminalRemoteSyncOperation(operationId: string) {
    if (!desktopApi) {
      setToast('请在 Electron 应用中重试远端同步')
      return
    }

    try {
      const state = await desktopApi.retryRemoteSyncOperation({ operationId })
      applyLocalExecutionState(state)
      setToast('已重新排队上传；收到团队服务回执后才算已上传')
    } catch {
      setToast('重新上传没有排队成功，请稍后再试')
    }
  }

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
    openNodeDetails()
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

  /**
   * Opens a settings page from the task and remembers where the user was reading, so
   * 「返回任务」 restores the step, tab, material and scroll position (plan W9). Settings pages
   * never run anything on return.
   */
  function openSettingsFromTask(
    target: 'coding' | 'tests' | 'models',
    position: InspectorReadingPosition | null = readingPositionRef.current?.() ?? null,
  ) {
    // Old Agents/Tests targets now open a settings section (plan §4.3, Y1).
    setSettingsSection(settingsSectionForTaskTarget(target))
    setSettingsFocus(target === 'tests' ? undefined : target === 'coding' ? 'coding' : 'models')
    if (!selectedRun || !selectedNode || activeView !== 'workbench') {
      setActiveView('settings')
      return
    }
    setSupportContext({
      runId: position?.runId ?? selectedRun.id,
      nodeId: position?.nodeId ?? selectedNode.id,
      sourceView: activeView,
      returnView: 'workbench',
      focusTarget: target === 'tests' ? 'local-tests' : 'coding-agent',
      label: { coding: '设置执行工具', tests: '设置测试命令', models: '设置模型与预算' }[target],
      ...(position ? { inspectorTab: position.inspectorTab, scrollTop: position.scrollTop } : {}),
      ...(position?.materialId ? { materialId: position.materialId } : {}),
      createdAt: new Date().toISOString(),
    })
    setActiveView('settings')
  }

  /** Settings from the navigation or the team connection popover: no task context to return to. */
  function openSettings(section: SettingsSection) {
    setSettingsSection(section)
    setSettingsFocus(undefined)
    setSupportContext((current) => current && (current.focusTarget === 'coding-agent' || current.focusTarget === 'local-tests') ? null : current)
    setActiveView('settings')
  }

  /** A save on a settings page opened from the task: the banner then offers the way back. */
  function markSettingsSaved() {
    setSupportContext((current) => current && (current.focusTarget === 'coding-agent' || current.focusTarget === 'local-tests')
      ? { ...current, savedAt: new Date().toISOString() }
      : current)
  }

  /**
   * 「讨论此材料」, review opinions and board cards add a reference card to the current
   * discussion (plan W7). This never sends a message or calls a model.
   */
  function discussMaterial(material: DiscussionMaterial, node: WorkflowNode | undefined = selectedNode) {
    if (!selectedRun || !node) return
    const reference = buildDiscussionReference({
      ...material,
      projectName: selectedLocalProject?.name ?? '当前项目',
      runTitle: selectedRun.title,
      stageLabel: stageLabels[node.stage],
      stepTitle: displayNodeTitle(node),
      readAt: new Date().toISOString(),
    })
    setWorkbenchOpenRequest((previous) => ({ serial: previous.serial + 1, type: 'reference', reference }))
  }

  /** 「在任务中处理」 in settings: back to the task's actual step, nothing runs (W5). */
  function handleInTask() {
    if (supportContext && (supportContext.focusTarget === 'coding-agent' || supportContext.focusTarget === 'local-tests')) {
      returnToInspector()
      return
    }
    if (selectedRun) selectRunNode(selectedRun.id, selectedRun.currentNodeId)
    setActiveView('workbench')
  }

  function openKnowledgeReference(referenceId: string, documentId?: string) {
    const reference = knowledgeReferences.find((candidate) => candidate.id === referenceId)
    const nextRunId = reference?.runId ?? selectedRun?.id
    const nextNodeId = selectedNode?.id ?? reference?.nodeId
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
      label: '知识引用来源',
      referenceId,
      documentId: documentId ?? reference?.documentId,
      inspectorTab: '引用来源',
      createdAt: new Date().toISOString(),
    })
    setSearchQuery('')
    setActiveView('knowledge')
  }

  function returnToInspector() {
    if (supportContext) {
      selectRunNode(supportContext.runId, supportContext.nodeId)
      if ((supportContext.focusTarget === 'coding-agent' || supportContext.focusTarget === 'local-tests') && supportContext.inspectorTab) {
        // The Inspector restores the tab, material and scroll position, then clears this (W9).
        setSupportContext({ ...supportContext, focusTarget: 'inspector-tab', sourceView: activeView })
      } else if (supportContext.focusTarget !== 'knowledge-reference' || !supportContext.inspectorTab) {
        setSupportContext(null)
      }
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
          label: '搜索结果 · 知识',
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
          label: result.type === 'artifact' ? '搜索结果 · 材料' : '搜索结果 · 执行记录',
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


  /** 设置／高级 (plan Y2): diagnostics, then the independent Runtime and multi-agent tools. */
  const renderAdvancedSettings = () => (
    <>
        <section className="diagnostics-page" aria-label="本地诊断">
          <h2>本地诊断</h2>
          <p>用于排查当前应用的数据存储；数据环境名称不是项目或团队绑定。</p>
          <section className="diagnostics-redaction" aria-label="脱敏自检">
            <h3>脱敏自检</h3>
            <p className="meta">用一段示例密钥检查脱敏规则是否生效；不读取真实凭据。</p>
            <button className="ghost-button" onClick={redactPreview} aria-label="Test redaction">
              <ShieldCheck size={16} aria-hidden="true" />
              运行脱敏自检
            </button>
          </section>
          <CredentialAccessStatus api={desktopApi} detailed />
          <DiagnosticHistory api={desktopApi} active />
          {/* First layer in Chinese; the raw diagnostic values stay in the title (plan §1.1). */}
          <span
            className="stat stat--source"
            data-testid="runtime-source-badge"
            title={`${runtimeDataSource.label} · ${runtimeDataSource.status} · ${runtimeDataSource.detail}`}
          >
            数据源 <strong className={`pill ${runtimeDataSource.tone}`}>{runtimeSourceLabel(runtimeDataSource.label)}</strong>
          </span>
          <details open className="data-profile-diagnostics" data-testid="data-profile-diagnostics">
            <summary>
              本地数据 <strong>{dataProfileDiagnostics?.name ?? '正在读取'}</strong>
            </summary>
            {dataProfileDiagnostics ? (
              <dl>
                <div><dt>来源</dt><dd>{dataProfileDiagnostics.source}</dd></div>
                <div><dt>Schema</dt><dd>v{dataProfileDiagnostics.schemaVersion}</dd></div>
                <div><dt>项目</dt><dd>{dataProfileDiagnostics.projectCount}</dd></div>
                <div><dt>Run</dt><dd>{dataProfileDiagnostics.runCount}</dd></div>
                <div>
                  <dt>最近更新</dt>
                  <dd>{dataProfileDiagnostics.latestRunUpdatedAt ?? '暂无 Run'}</dd>
                </div>
                <div><dt>指纹</dt><dd>{dataProfileDiagnostics.pathFingerprint}</dd></div>
              </dl>
            ) : (
              <p>本地数据诊断暂不可用。</p>
            )}
          </details>
        </section>
        <details className="agent-advanced-tools" data-testid="agent-advanced-tools">
          <summary aria-describedby="agent-advanced-tools-description">
            <span>独立 Runtime 与多 Agent 诊断</span>
            <strong id="agent-advanced-tools-description">针对当前任务：{selectedRun?.title ?? '尚未选择任务'}</strong>
            <em>{hasSelectedLocalProjectBinding ? '已连接团队 · 多 Agent 入口可用' : '未连接团队 · 多 Agent 入口不可用'}</em>
          </summary>
          <div className="agent-advanced-tools__body">
            <p className="agent-advanced-tools__intro">
              这些工具用于验收与诊断，不代替任务中的操作，不批准 Gate，也不推进流程。
            </p>
            <AgentRuntimePanel
              desktopApi={desktopApi}
              runId={selectedRun?.id}
              nodeId={selectedRun?.currentNodeId}
              localProjectId={selectedLocalProject?.id}
            />
            <AgentCoordinationPanel
              desktopApi={desktopApi}
              runId={selectedRun?.id}
              nodeId={selectedRun?.currentNodeId}
              expectedRunVersion={selectedRun?.version}
              localProjectId={selectedLocalProject?.id}
              isTeamPaired={hasSelectedLocalProjectBinding}
            />
          </div>
        </details>
    </>
  )

  const policySource = gateEnforcement.policySnapshot?.source ?? gateEnforcement.decision?.policySource ?? 'unavailable'
  const policyVersion = gateEnforcement.policySnapshot?.version ?? gateEnforcement.decision?.policyVersion

  return (
    <div className="app-shell" data-origin={dataOrigin} data-runtime-source={runtimeDataSource.status}>
        <header className="topbar topbar--single-row">
          <TopbarProjectMenu projectName={selectedLocalProject?.name} projectPath={selectedLocalProject?.path}>
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
            <section className="project-overview" aria-label="项目概览" data-testid="project-overview">
              <h3>项目概览</h3>
              <dl className="detail-values"><dt>已加载任务</dt><dd>{scopedRuns.length}</dd><dt>来源</dt><dd>{localRunCount} 本地 · {remoteRunCount} 远端</dd><dt>受阻 Gate</dt><dd>{pendingGateCount}</dd><dt>今日测试证据（UTC）</dt><dd>{testsTodayCount}</dd></dl>
              <p className="meta">数量属于当前项目已加载的数据；受阻 Gate 只统计 blocked 状态，不等于全部待审批步骤。</p>
            </section>
          </TopbarProjectMenu>
          <div className="search-wrap">
            <div className="search-box">
            <Search size={16} />
            <input
              aria-label="搜索当前项目"
              placeholder="搜索当前项目的任务、材料、知识与执行记录"
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
                      <span title={result.type}>{searchResultTypeLabels[result.type]}</span>
                      <strong>{result.title}</strong>
                      <small>{result.subtitle}</small>
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>

          {/* Pairing, connection details and per-record uploads live in 设置／团队连接 (plan Y7). */}
          <TeamConnectionMenu
            view={teamConnectionView}
            identity={teamConnectionIdentity}
            isSyncing={isSyncingRemote}
            onUpdateTeamData={() => void syncRemoteTeamState()}
            onOpenDetails={() => openSettings('team')}
          />
          {/* The theme moved to 设置／外观 (plan Y5): four top bar controls. */}
          <button className="primary-button" onClick={() => { setNewRunError(''); setIsNewRunOpen(true) }}>
            <Plus size={16} aria-hidden="true" />
            新建任务
          </button>
        </header>

      <aside className="sidebar rail" aria-label="Primary navigation">
        <nav className="nav-list">
          {/* Four primary entries (plan §4.1, Y1); Agents, Skills, MCP, tests and diagnostics are settings sections. */}
          <NavButton active={activeView === 'workbench'} icon={<Workflow />} label="任务" onClick={() => setActiveView('workbench')} />
          <NavButton active={activeView === 'knowledge'} icon={<BookOpen />} label="知识" onClick={() => setActiveView('knowledge')} />
          <NavButton active={activeView === 'team'} icon={<Users />} label="团队" onClick={() => setActiveView('team')} />
          <NavButton active={activeView === 'settings'} icon={<Settings2 />} label="设置" onClick={() => openSettings(settingsSection)} />
        </nav>

      </aside>

      <main className="workspace main-shell">
        <CredentialAccessStatus api={desktopApi} detailed={false} />
        <div className="main-shell-content">

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
          <section className="workbench-layout review-workbench">
                <WorkbenchWorkspace splitDetails modelReadinessError={modelReadinessError} api={desktopApi}
                  projectId={selectedLocalProject?.id}
                  projectName={selectedLocalProject?.name}
                  runs={scopedRuns}
                  providerId={selectedAgentProviderId}
                  providerName={agentProviders.find((provider) => provider.id === selectedAgentProviderId)?.name ?? ''}
                  request={workbenchOpenRequest}
                  onConfigure={() => openSettingsFromTask('models')}
                  onNavigate={(action) => {
                    selectRunNode(action.runId, action.nodeId)
                    setSupportContext({ runId: action.runId, nodeId: action.nodeId, inspectorTab: action.section,
                      sourceView: 'workbench', returnView: 'workbench', focusTarget: 'inspector-tab', label: action.section, createdAt: new Date().toISOString() })
                  }}>

            <div className="task-title-row">
            <details className="workbench-project-menu">
              <summary title={selectedRun?.title}><span className="task-title-text">{selectedRun?.title ?? (selectedLocalProject ? '选择任务' : '先选择本地项目')}</span><ChevronDown size={14} aria-hidden="true" /></summary>
            <div className="run-list">
              {!selectedLocalProject ? <p className="empty-note">先在顶栏的项目菜单中选择本地项目。</p> : null}
              <WorkRequestInbox
                workRequests={workRequestInbox.workRequests}
                isPaired={hasSelectedLocalProjectBinding}
                isLoading={workRequestInbox.isLoading}
                materializingId={workRequestInbox.materializingId}
                error={workRequestInbox.error}
                onRefresh={() => void workRequestInbox.refresh()}
                onMaterialize={(workRequest) =>
                  void workRequestInbox.materialize(workRequest)
                }
              />
              <div className="section-heading">
                <span>任务</span>
                <strong>当前项目的任务</strong>
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
                          openNodeDetails()
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
                        <div
                          className="run-row-actions"
                          ref={openRunMenuId === run.id ? openRunMenuRef : undefined}
                        >
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
              {/* Moved from the title row and the stage row to keep the first screen small (plan Y6). */}
              {selectedRun ? (
                <section className="task-menu-section" aria-label="本任务用量与策略" data-testid="task-menu-usage">
                  <div className="section-heading"><span>本任务</span><strong>用量与策略</strong></div>
                  <div data-testid="run-token-usage"><p>Tokens：{runUsage.tokenLabel}</p><p>费用：{runUsage.costLabel}</p></div>
                  <p className="meta">只包含当前任务已记录的用量，不包含独立会话的累计用量。</p>
                  <h3>流程策略</h3><p>策略版本：{policyVersion ? `v${policyVersion}` : '尚未读取'} · 来源 {policySource}</p>
                  <p>读取状态：{gateEnforcement.loadError ? '读取失败' : gateEnforcement.isLoading ? '正在读取' : gateEnforcement.policySnapshot ? '已读取' : '不可用'}</p>
                  {gateEnforcement.loadError && <p role="status">{gateEnforcement.loadError}<button className="text-button" onClick={() => void gateEnforcement.refresh().catch(() => {})}>重试读取策略</button></p>}
                  <p className="meta">策略结论只在影响当前决定时出现在状态行；评估不代表人工审批已完成。</p>
                  <div data-testid="runtime-budget-status"><h3>项目预算规则</h3><p>{projectRuntimeBudget.label}</p><h3>相关预算评估</h3><p className={budgetTone} title={effectiveBudgetDecision?.reason}>{budgetStatus}</p>
                    <p className="meta">{currentModelBudget ? `项目最近模型调用 · Provider ${currentModelBudget.providerId}；事件未提供节点和时间，不能作为当前调用的实时许可。` : latestCodingRun?.budgetDecision ? `当前任务的开发执行 ${latestCodingRun.id} · ${latestCodingRun.startedAt}` : '尚无可用评估记录。'}</p>
                    {budgetRecoveryCopy ? <p role="status">{budgetRecoveryCopy}</p> : null}
                  </div>
                  <button className="ghost-button" onClick={() => openSettingsFromTask('models')}>打开模型与执行方式设置</button>
                  <h3>看板展示方式</h3>
                  <div className="workflow-view-switch" role="group" aria-label="看板展示方式">
                    <button type="button" aria-pressed={boardView === 'compact'} onClick={() => setBoardView('compact')}>精简导航</button>
                    <button type="button" aria-pressed={boardView === 'flow'} onClick={() => setBoardView('flow')}>流程视图</button>
                    <button type="button" aria-pressed={boardView === 'list'} onClick={() => setBoardView('list')}>列表视图</button>
                  </div>
                </section>
              ) : null}
            </div>
            </details>
            <div className="task-title-tools">
              {/* Plain text so the unknown cost stays on the first layer (plan §3); details are in the task menu (Y6). */}
              {selectedRun ? (
                <p className="task-usage-summary" data-testid="task-usage-summary" title="只包含当前任务已记录的用量；详情在任务菜单中">
                  <span>本任务用量</span><strong>{runUsage.tokenLabel} tokens · {runUsage.costLabel}</strong>
                </p>
              ) : null}
              <DiscussionToggle />
            </div>
            </div>

            {selectedRun ? (
              <>
                <WorkflowBoard
                  view={boardView}
                  run={selectedRun}
                  artifacts={scopedArtifacts}
                  events={scopedEvents}
                  testEvidence={scopedTestEvidence}
                  selectedNodeId={selectedNode?.id}
                  onSelectNode={(nodeId) => { setSelectedNodeId(nodeId); openNodeDetails() }}
                  onDiscuss={(node) => discussMaterial({
                    materialId: `step:${node.id}`,
                    materialTitle: `步骤：${displayNodeTitle(node)}`,
                    version: `任务版本 v${selectedRun.version}`,
                  }, node)}
                  onSelectAttachment={(nodeId, inspectorTab) => {
                    openNodeDetails()
                    setSelectedNodeId(nodeId)
                    setSupportContext({
                      runId: selectedRun.id, nodeId, inspectorTab,
                      sourceView: 'workbench', returnView: 'workbench', focusTarget: 'inspector-tab',
                      label: inspectorTab, createdAt: new Date().toISOString(),
                    })
                  }}
                />


                <Inspector
                  modelReadinessError={modelReadinessError}
                  selectedRun={selectedRun}
                  selectedNode={selectedNode}
                  isSelectedCurrentNode={isSelectedCurrentNode}
                  artifacts={selectedArtifacts}
                  workflowArtifacts={scopedArtifacts}
                  events={selectedEvents}
                  runEvents={scopedEvents.filter((event) => event.runId === selectedRun.id)}
                  testEvidence={scopedTestEvidence}
                  testEvidenceFreshness={testEvidenceFreshness}
                  governanceChecks={selectedGovernanceChecks}
                  references={knowledgeReferences}
                  latestAgentReview={latestAgentReview}
                  onRecordAgentReviewFeedback={desktopApi?.recordAgentReviewFeedback ? async (input) => {
                    const updated = await desktopApi.recordAgentReviewFeedback!(input)
                    setAgentReviews((current) => current.map((review) => review.id === updated.id ? updated : review))
                    return updated
                  } : undefined}
                  supportContext={supportContext}
                  onConsumeSupportContext={() => setSupportContext((current) =>
                    current?.focusTarget === 'knowledge-reference' || current?.focusTarget === 'inspector-tab' ? null : current)}
                  policySnapshot={gateEnforcement.policySnapshot}
                  gateEnforcementDecision={gateEnforcement.decision}
                  gateOverrides={gateEnforcement.overrides.filter((override) => override.nodeId === selectedNode?.id)}
                  remediationPlan={gateEnforcement.remediationPlan}
                  isLoadingGateEnforcement={gateEnforcement.isLoading}
                  canApprove={gateEnforcement.canApprove}
                  canSaveOverride={gateEnforcement.canSaveOverride}
                  onApprove={approveSelectedGate}
                  onCompleteAgentNode={completeSelectedWorkflowAgentNode}
                  onDiscussMaterial={(material) => discussMaterial(material)}
                  {...(desktopApi?.requestClarificationChanges ? { onRequestClarificationChanges: requestSelectedClarificationChanges } : {})}
                  stageProviders={agentProviders}
                  stageProviderId={stageChoice.providerId}
                  onStageProviderChange={setStageProviderId}
                  onCancelStageAgent={desktopApi?.cancelWorkflowAgentNode ? async () => {
                    if (!pendingInspectorAction) return
                    try { await desktopApi.cancelWorkflowAgentNode!({ runId: pendingInspectorAction.runId, nodeId: pendingInspectorAction.nodeId }) }
                    catch (error) { setToast(ipcErrorMessage(error, '取消失败，请重试。')) }
                  } : undefined}
                  stageAgentExecutorKind={stageAgentExecutorKind}
                  onStageAgentExecutorKindChange={setStageAgentExecutorKind}
                  onSaveGateOverride={gateEnforcement.saveOverride}
                  onStartRemediationRetry={startRemediationRetry}
                  pairingState={hasDeliveryProjectBinding ? 'paired' : 'unpaired'}
                  hasDeliveryProjectBinding={hasDeliveryProjectBinding}
                  onSyncTeam={syncRemoteTeamState}
                  onRunKnowledgeReview={(previousReviewId) => void runKnowledgeReview(previousReviewId)}
                  {...(desktopApi?.cancelKnowledgeReview ? { onCancelKnowledgeReview: () => void cancelKnowledgeReview() } : {})}
                  isRunningKnowledgeReviewHere={isRunningKnowledgeReviewHere}
                  latestReviewFailure={latestReviewFailure}
                  reviewProviderLabel={reviewProviderLabel}
                  reviewRunBlockedReason={reviewRunBlockedReason}
                  onRunTests={() => void executeTestPlan()}
                  testRunReadiness={testRunReadiness}
                  onOpenSettings={openSettingsFromTask}
                  readingPositionRef={readingPositionRef}
                  onOpenKnowledgeReference={openKnowledgeReference}
                  codingReadiness={codingRuntime.readiness}
                  codingReadinessError={codingRuntime.error}
                  upstreamCodingDiffReady={hasArchivedUpstreamCodingDiff({ run: selectedRun, node: selectedNode, codingRuns, diffs: codingDiffArtifacts })}
                  {...(codingActionProjection ? { codingActionProjection } : {})}
                  onCancelCodingRun={() => void cancelCodingRun()}
                  onReplyCodingPermission={(decision) => void replyCodingPermission(decision)}
                  onRenewCodingPermission={() => void renewCodingPermission()}
                  isReplyingCodingPermission={isReplyingCodingPermission}
                  latestCodingRun={latestCodingRun}
                  codingWorkspace={selectedManagedWorkspace}
                  codingProviderName={latestCodingProviderName}
                  runtimeBudgetApprovalId={runtimeBudgetApprovalId}
                  onOpenCodingWorktree={() => void openCodingWorktree()}
                  onDeleteCodingWorktree={() => void deleteCodingWorktree()}
                  onRunCodingAgent={runCodingAgent}
                  onCreatePrDraft={generatePrDraft}
                  onPrepareGitHubDelivery={prepareSelectedGitHubDelivery}
                  onReviseGitHubDelivery={reviseSelectedGitHubDelivery}
                  onRetryGitHubDelivery={retrySelectedGitHubDelivery}
                  onResumeGitHubDelivery={resumeSelectedGitHubDelivery}
                  onStopGitHubDelivery={stopSelectedGitHubDelivery}
                  onVerifyGitHubDeliveryRevocation={verifySelectedGitHubDeliveryRevocation}
                  onCreateAcceptanceBundle={generateAcceptanceBundle}
                  onSelectWorkflowNode={setSelectedNodeId}
                  selectedGitHubDeliveryIntent={selectedGitHubDeliveryIntent}
                  canVerifyGitHubDeliveryRevocation={canVerifyGitHubDeliveryRevocation}
                  {...(selectedGitHubDeliveryOperatorOutcome
                    ? {
                        selectedGitHubDeliveryOperatorOutcome,
                      }
                    : {})}
                  {...(selectedGitHubDeliveryRevocationCheck
                    ? {
                        selectedGitHubDeliveryRevocationCheck,
                      }
                    : {})}
                  isRunningTests={isRunningTests}
                  isRunningAgentReview={isRunningAgentReview}
                  isStartingCodingAgent={isStartingCodingAgent}
                  pendingInspectorAction={pendingInspectorAction}
                  codingRecords={showsCodingRecords && latestCodingRun ? (
                    <CodingRunRecords
                      latestCodingRun={latestCodingRun}
                      codingRuns={selectedCodingRuns}
                      codingEvents={codingEvents}
                      permissionRequests={codingPermissionRequests}
                      providers={agentProviders}
                      bootstrapEvidence={selectedBootstrapEvidence}
                      testEvidence={selectedCodingTestEvidence}
                      runtimeBudgetApprovalId={runtimeBudgetApprovalId}
                      onOpenModelSettings={() => openSettingsFromTask('models')}
                      {...(codingActionProjection ? { codingActionProjection } : {})}
                    />
                  ) : undefined}
                  executionEvidence={<>
                    <StageAgentFailureRecords traces={agentTraces} runId={selectedRun.id} {...(selectedNode ? { nodeId: selectedNode.id } : {})} />
                    <AgentEvidenceGroups groups={executionEvidenceGroups} />
                  </>}
                />
              </>
            ) : (
              <>
                <section className="canvas-panel workflow-panel empty-workbench" data-testid="workflow-empty-state">
                  <div className="panel-head workflow-head">
                    <div>
                      <span className="panel-title">任务阶段</span>
                      <span className="meta">暂无任务</span>
                    </div>
                  </div>
                  <p className="empty-note">
                    当前本地仓库还没有开发任务。新建任务或连接团队后更新团队数据，这里会显示任务流程。
                  </p>
                </section>
                <aside className="inspector" data-testid="node-inspector-empty">
                  <div className="panel-head panel-head--compact">
                    <span className="panel-title">任务详情</span>
                  </div>
                  <p className="empty-note">选择任务后显示当前步骤、材料、执行记录与审批。</p>
                </aside>
              </>
            )}
            </WorkbenchWorkspace>
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
            selectedProjectId={selectedTeamProjectId}
            policySnapshot={gateEnforcement.policySnapshot}
            gateEnforcementDecision={gateEnforcement.decision}
            isLoadingGateEnforcement={gateEnforcement.isLoading}
            onSyncTeam={() => void syncRemoteTeamState()}
            isSyncingTeam={isSyncingRemote}
            syncFeedback={teamSyncFeedback}
          />
        )}

        {activeView === 'knowledge' && (
          <KnowledgeView
            query={normalizedSearchQuery}
            documents={projectKnowledgeDocuments}
            entities={projectKnowledgeEntities}
            relations={projectKnowledgeRelations}
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
            indexedAt={repositoryKnowledge?.indexedAt}
            truncated={repositoryKnowledge?.truncated ?? false}
            warnings={repositoryKnowledge?.warnings ?? []}
            isLoading={isLoadingRepositoryKnowledge}
            onRefresh={() => void refreshRepositoryKnowledge()}
            onReturnToInspector={returnToInspector}
            artifacts={scopedArtifacts}
            directory={knowledgeDirectory}
            // Memory management moved here from the Agents page (plan §4.1, Y3).
            memoryPanel={<AgentMemoryPanel desktopApi={desktopApi} runId={selectedRun?.id} localProjectId={selectedLocalProject?.id} />}
          />
        )}

        {activeView === 'settings' && (
          <SettingsView
            section={settingsSection}
            onSectionChange={(section) => { setSettingsSection(section); setSettingsFocus(undefined) }}
            supportContext={supportContext}
            run={selectedRun}
            onReturnToTask={returnToInspector}
          >
            {settingsSection === 'project' ? (
              <LocalProjectSettings
                project={selectedLocalProject}
                gitStatus={projectGitStatus}
                evidence={scopedTestEvidence}
                evidenceFreshness={testEvidenceFreshness}
                onHandleInTask={handleInTask}
                isRunningTests={isRunningTests}
                commandDraft={testCommandDraft}
                onCommandDraftChange={setTestCommandDraft}
                onSaveCommand={() => void saveTestCommand().then((saved) => { if (saved) markSettingsSaved() })}
                commandSafety={commandSafety}
                isCommandDirty={isTestCommandDirty}
                isSavingCommand={isSavingTestCommand}
                selectedRun={selectedRun}
                selectedNode={selectedNode}
              />
            ) : settingsSection === 'models' ? (
              <ModelSettings
                key={`${selectedLocalProject?.id ?? ''}:${desktopPairing?.tokenId ?? ''}`}
                desktopApi={desktopApi}
                projectRuntimeBudget={projectRuntimeBudget}
                modelBudget={currentModelBudget}
                localProjectId={selectedLocalProject?.id}
                requestedBy={currentUser?.id ?? 'local-user'}
                providers={agentProviders}
                selectedProviderId={selectedAgentProviderId}
                onProviderChange={(providerId) => {
                  setSelectedAgentProviderId(providerId)
                  void desktopApi?.saveSettings({ selectedAgentProviderId: providerId }).catch(() => setToast('Provider 选择保存失败，请重新选择。'))
                }}
                reviewExecutor={knowledgeReviewExecutor}
                onReviewExecutorChange={(executor) => {
                  const previous = knowledgeReviewExecutor
                  setKnowledgeReviewExecutor(executor)
                  void desktopApi?.saveSettings({ knowledgeReviewExecutor: executor }).catch(() => {
                    setKnowledgeReviewExecutor(previous)
                    setToast('门禁审查方式保存失败，已恢复原来的选择。')
                  })
                }}
                onProviderRemoved={(providerId) => {
                  setAgentProviders((providers) => providers.filter((item) => item.id !== providerId))
                  setSelectedAgentProviderId('')
                  setToast('已删除本机 Provider 配置和凭据；当前未选择 Provider。')
                }}
                onProviderUpdated={(metadata) => setAgentProviders((providers) => providers.map((provider) => provider.id === metadata.providerId ? reviewProviderFromMetadata(metadata) : provider))}
                providerNameDraft={providerNameDraft}
                onProviderNameDraftChange={setProviderNameDraft}
                providerBaseUrlDraft={providerBaseUrlDraft}
                onProviderBaseUrlDraftChange={setProviderBaseUrlDraft}
                providerModelDraft={providerModelDraft}
                onProviderModelDraftChange={setProviderModelDraft}
                providerKeyDraft={providerKeyDraft}
                onProviderKeyDraftChange={setProviderKeyDraft}
                onSaveProviderCredential={(thinking) => void saveAgentProviderCredential(thinking).then((saved) => { if (saved) markSettingsSaved() })}
                onSettingsSaved={markSettingsSaved}
                selectedNode={selectedNode}
                latestCodingRun={latestCodingRun}
                runtimeBudgetApprovalId={runtimeBudgetApprovalId}
                onRuntimeBudgetApprovalIdChange={setRuntimeBudgetApprovalId}
                hasSelectedRun={Boolean(selectedRun)}
                onHandleInTask={handleInTask}
                codingReadiness={codingRuntime.readiness}
                codingReadinessError={codingRuntime.error}
                onRefreshCodingReadiness={codingRuntime.refresh}
                focus={settingsFocus}
              />
            ) : settingsSection === 'extensions' ? (
              <>
                <SkillView />
                <McpView servers={mcpServers} onToggle={toggleMcp} />
              </>
            ) : settingsSection === 'team' ? (
              <TeamConnectionSettings
                view={teamConnectionView}
                pairing={desktopPairing ?? null}
                identity={teamConnectionIdentity}
                localProjectName={(localProjectId) => localProjectId === selectedLocalProject?.id ? selectedLocalProject?.name ?? localProjectId ?? '未知' : localProjectId ?? '未知'}
                hasSelectedProject={Boolean(selectedLocalProject)}
                pairingCodeDraft={pairingCodeDraft}
                onPairingCodeDraftChange={setPairingCodeDraft}
                isPairing={isPairingDesktop}
                onPair={() => void pairDesktopWithTeam()}
                pairingFeedback={pairingFeedback}
                revokedIntents={deliveryIntentsRevokedByRepair(githubDeliveryIntents)}
                isSyncing={isSyncingRemote}
                onUpdateTeamData={() => void syncRemoteTeamState()}
                onRetryUpload={(operationId) => void retryTerminalRemoteSyncOperation(operationId)}
              />
            ) : settingsSection === 'appearance' ? (
              <section className="settings-appearance" aria-label="主题">
                <p>主题偏好只保存在本机，不影响团队或项目数据。点击切换：跟随系统 → 浅色 → 深色。</p>
                <ThemeToggle value={themePreference} onChange={changeThemePreference} />
              </section>
            ) : renderAdvancedSettings()}
          </SettingsView>
        )}
        </div>
      </main>

      {isNewRunOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal" role="dialog" aria-modal="true" aria-label="新建任务">
            <div className="section-heading">
              <span>新建任务</span>
              <strong>描述要完成的开发任务</strong>
            </div>
            <p className="meta">创建后不会立即调用模型；进入需求阶段后再选择模型并生成需求草稿。</p>
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
                创建任务
              </button>
            </div>
            {newRunError ? <p role="alert" className="modal-copy modal-copy--danger">{newRunError}</p> : null}
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
