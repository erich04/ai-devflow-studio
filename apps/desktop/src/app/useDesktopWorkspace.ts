import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import {
  normalizeWorkflowRunProgress,
  parseThemePreference,
  validateTestCommandSafety,
  type AgentEvent,
  type AgentProviderConfig,
  type AgentReviewResult,
  type AgentTokenUsage,
  type AgentTrace,
  type Artifact,
  type CodingAgentEvent,
  type CodingAgentRun,
  type CodingDiffArtifact,
  type CodingPermissionDecision,
  type CodingPermissionRequest,
  type CommandSafetyResult,
  type DataOrigin,
  type DependencyBootstrapEvidence,
  type DesktopPairingCredential,
  type LocalExecutionState,
  type LocalProject,
  type ManagedCodingWorkspace,
  type McpServerDefinition,
  type Project,
  type RetryAttempt,
  type TeamMember,
  type TestEvidence,
  type ThemePreference,
  type TokenUsageRollup,
  type WorkflowRun,
} from '@ai-devflow/shared'
import { getDesktopApi, type DevFlowDesktopApi } from '../desktop-api'
import {
  getToastDisplayDurationMs,
  mergeById,
  type SupportContext,
} from './desktop-view-model'
import type { PendingInspectorAction } from './node-inspector-view-model'

function useThemePreference() {
  const [preference, setPreference] = useState<ThemePreference>(() =>
    parseThemePreference(globalThis.localStorage?.getItem('ai-devflow-theme')),
  )

  useEffect(() => {
    const root = document.documentElement
    const media = window.matchMedia('(prefers-color-scheme: dark)')

    const apply = () => {
      const resolved = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference
      root.dataset.theme = resolved
      root.dataset.themePreference = preference
      localStorage.setItem('ai-devflow-theme', preference)
    }

    apply()
    media.addEventListener('change', apply)

    return () => media.removeEventListener('change', apply)
  }, [preference])

  return [preference, setPreference] as const
}

export type DesktopWorkspaceState = {
  themePreference: ThemePreference
  dataOrigin: DataOrigin
  hasLoadedLocalState: boolean
  activeView: 'workbench' | 'team' | 'knowledge' | 'agents' | 'skills' | 'mcp' | 'tests'
  runs: WorkflowRun[]
  remoteRunIds: string[]
  selectedRunId: string
  selectedNodeId: string
  artifacts: Artifact[]
  events: AgentEvent[]
  testEvidence: TestEvidence[]
  localProjects: LocalProject[]
  teamProjects: Project[]
  teamMembers: TeamMember[]
  teamProjectCost: TokenUsageRollup[]
  teamMemberCost: TokenUsageRollup[]
  teamTotalCost: string
  selectedLocalProjectId: string
  testCommandDraft: string
  commandSafety: CommandSafetyResult | null
  isSavingTestCommand: boolean
  isRunningTests: boolean
  isSyncingRemote: boolean
  desktopPairing: DesktopPairingCredential | null
  pairingCodeDraft: string
  isPairingDesktop: boolean
  mcpServers: McpServerDefinition[]
  agentProviders: AgentProviderConfig[]
  selectedAgentProviderId: string
  agentReviews: AgentReviewResult[]
  agentTraces: AgentTrace[]
  agentTokenUsage: AgentTokenUsage[]
  codingRuns: CodingAgentRun[]
  codingEvents: CodingAgentEvent[]
  codingPermissionRequests: CodingPermissionRequest[]
  codingPermissionDecisions: CodingPermissionDecision[]
  managedCodingWorkspaces: ManagedCodingWorkspace[]
  dependencyBootstrapEvidence: DependencyBootstrapEvidence[]
  codingDiffArtifacts: CodingDiffArtifact[]
  retryAttempts: RetryAttempt[]
  providerIdDraft: string
  providerBaseUrlDraft: string
  providerModelDraft: string
  providerKeyDraft: string
  runtimeBudgetApprovalId: string
  isRunningAgentReview: boolean
  isStartingCodingAgent: boolean
  pendingInspectorAction: PendingInspectorAction | null
  isNewRunOpen: boolean
  draftTitle: string
  draftRequest: string
  searchQuery: string
  supportContext: SupportContext | null
  toast: string
}

export type DesktopWorkspaceSetters = {
  setThemePreference: (value: ThemePreference) => void
  setDataOrigin: (value: DataOrigin) => void
  setActiveView: (value: DesktopWorkspaceState['activeView']) => void
  setRuns: Dispatch<SetStateAction<WorkflowRun[]>>
  setRemoteRunIds: Dispatch<SetStateAction<string[]>>
  setSelectedRunId: Dispatch<SetStateAction<string>>
  setSelectedNodeId: Dispatch<SetStateAction<string>>
  setArtifacts: Dispatch<SetStateAction<Artifact[]>>
  setEvents: Dispatch<SetStateAction<AgentEvent[]>>
  setTestEvidence: Dispatch<SetStateAction<TestEvidence[]>>
  setLocalProjects: Dispatch<SetStateAction<LocalProject[]>>
  setTeamProjects: Dispatch<SetStateAction<Project[]>>
  setTeamMembers: Dispatch<SetStateAction<TeamMember[]>>
  setTeamProjectCost: Dispatch<SetStateAction<TokenUsageRollup[]>>
  setTeamMemberCost: Dispatch<SetStateAction<TokenUsageRollup[]>>
  setTeamTotalCost: Dispatch<SetStateAction<string>>
  setSelectedLocalProjectId: Dispatch<SetStateAction<string>>
  setTestCommandDraft: Dispatch<SetStateAction<string>>
  setCommandSafety: Dispatch<SetStateAction<CommandSafetyResult | null>>
  setIsSavingTestCommand: Dispatch<SetStateAction<boolean>>
  setIsRunningTests: Dispatch<SetStateAction<boolean>>
  setIsSyncingRemote: Dispatch<SetStateAction<boolean>>
  setDesktopPairing: Dispatch<SetStateAction<DesktopPairingCredential | null>>
  setPairingCodeDraft: Dispatch<SetStateAction<string>>
  setIsPairingDesktop: Dispatch<SetStateAction<boolean>>
  setMcpServers: Dispatch<SetStateAction<McpServerDefinition[]>>
  setAgentProviders: Dispatch<SetStateAction<AgentProviderConfig[]>>
  setSelectedAgentProviderId: Dispatch<SetStateAction<string>>
  setAgentReviews: Dispatch<SetStateAction<AgentReviewResult[]>>
  setAgentTraces: Dispatch<SetStateAction<AgentTrace[]>>
  setAgentTokenUsage: Dispatch<SetStateAction<AgentTokenUsage[]>>
  setCodingRuns: Dispatch<SetStateAction<CodingAgentRun[]>>
  setCodingEvents: Dispatch<SetStateAction<CodingAgentEvent[]>>
  setCodingPermissionRequests: Dispatch<SetStateAction<CodingPermissionRequest[]>>
  setCodingPermissionDecisions: Dispatch<SetStateAction<CodingPermissionDecision[]>>
  setManagedCodingWorkspaces: Dispatch<SetStateAction<ManagedCodingWorkspace[]>>
  setDependencyBootstrapEvidence: Dispatch<SetStateAction<DependencyBootstrapEvidence[]>>
  setCodingDiffArtifacts: Dispatch<SetStateAction<CodingDiffArtifact[]>>
  setRetryAttempts: Dispatch<SetStateAction<RetryAttempt[]>>
  setProviderIdDraft: Dispatch<SetStateAction<string>>
  setProviderBaseUrlDraft: Dispatch<SetStateAction<string>>
  setProviderModelDraft: Dispatch<SetStateAction<string>>
  setProviderKeyDraft: Dispatch<SetStateAction<string>>
  setRuntimeBudgetApprovalId: Dispatch<SetStateAction<string>>
  setIsRunningAgentReview: Dispatch<SetStateAction<boolean>>
  setIsStartingCodingAgent: Dispatch<SetStateAction<boolean>>
  setPendingInspectorAction: Dispatch<SetStateAction<PendingInspectorAction | null>>
  setIsNewRunOpen: Dispatch<SetStateAction<boolean>>
  setDraftTitle: Dispatch<SetStateAction<string>>
  setDraftRequest: Dispatch<SetStateAction<string>>
  setSearchQuery: Dispatch<SetStateAction<string>>
  setSupportContext: Dispatch<SetStateAction<SupportContext | null>>
  setToast: Dispatch<SetStateAction<string>>
}

export function useDesktopWorkspace(input: {
  defaultReviewProviderDraft: { providerId: string; baseUrl: string; model: string }
  reviewProviderFromMetadata: (metadata: import('@ai-devflow/shared').ProviderCredentialMetadata) => AgentProviderConfig
}): {
  desktopApi: DevFlowDesktopApi | null
  state: DesktopWorkspaceState
  setters: DesktopWorkspaceSetters
  derived: {
    selectedLocalProject: LocalProject | undefined
    isTestCommandDirty: boolean
  }
  resetTeamSnapshot: () => void
  applyLocalExecutionState: (state: LocalExecutionState) => void
} {
  const desktopApi = useMemo(() => getDesktopApi(), [])
  const [themePreference, setThemePreference] = useThemePreference()
  const [dataOrigin, setDataOrigin] = useState<DataOrigin>('seed')
  const [hasLoadedLocalState, setHasLoadedLocalState] = useState(!desktopApi)
  const [activeView, setActiveView] = useState<DesktopWorkspaceState['activeView']>('workbench')
  const [runs, setRuns] = useState<WorkflowRun[]>([])
  const [remoteRunIds, setRemoteRunIds] = useState<string[]>([])
  const [selectedRunId, setSelectedRunId] = useState('')
  const [selectedNodeId, setSelectedNodeId] = useState('')
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [testEvidence, setTestEvidence] = useState<TestEvidence[]>([])
  const [localProjects, setLocalProjects] = useState<LocalProject[]>([])
  const [teamProjects, setTeamProjects] = useState<Project[]>([])
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [teamProjectCost, setTeamProjectCost] = useState<TokenUsageRollup[]>([])
  const [teamMemberCost, setTeamMemberCost] = useState<TokenUsageRollup[]>([])
  const [teamTotalCost, setTeamTotalCost] = useState('$0.00')
  const [selectedLocalProjectId, setSelectedLocalProjectId] = useState('')
  const [testCommandDraft, setTestCommandDraft] = useState('')
  const [commandSafety, setCommandSafety] = useState<CommandSafetyResult | null>(null)
  const [isSavingTestCommand, setIsSavingTestCommand] = useState(false)
  const [isRunningTests, setIsRunningTests] = useState(false)
  const [isSyncingRemote, setIsSyncingRemote] = useState(false)
  const [desktopPairing, setDesktopPairing] = useState<DesktopPairingCredential | null>(null)
  const [pairingCodeDraft, setPairingCodeDraft] = useState('')
  const [isPairingDesktop, setIsPairingDesktop] = useState(false)
  const [mcpServers, setMcpServers] = useState<McpServerDefinition[]>([])
  const [agentProviders, setAgentProviders] = useState<AgentProviderConfig[]>([])
  const [selectedAgentProviderId, setSelectedAgentProviderId] = useState('')
  const [agentReviews, setAgentReviews] = useState<AgentReviewResult[]>([])
  const [agentTraces, setAgentTraces] = useState<AgentTrace[]>([])
  const [agentTokenUsage, setAgentTokenUsage] = useState<AgentTokenUsage[]>([])
  const [codingRuns, setCodingRuns] = useState<CodingAgentRun[]>([])
  const [codingEvents, setCodingEvents] = useState<CodingAgentEvent[]>([])
  const [codingPermissionRequests, setCodingPermissionRequests] = useState<CodingPermissionRequest[]>([])
  const [codingPermissionDecisions, setCodingPermissionDecisions] = useState<CodingPermissionDecision[]>([])
  const [managedCodingWorkspaces, setManagedCodingWorkspaces] = useState<ManagedCodingWorkspace[]>([])
  const [dependencyBootstrapEvidence, setDependencyBootstrapEvidence] = useState<DependencyBootstrapEvidence[]>([])
  const [codingDiffArtifacts, setCodingDiffArtifacts] = useState<CodingDiffArtifact[]>([])
  const [retryAttempts, setRetryAttempts] = useState<RetryAttempt[]>([])
  const [providerIdDraft, setProviderIdDraft] = useState(input.defaultReviewProviderDraft.providerId)
  const [providerBaseUrlDraft, setProviderBaseUrlDraft] = useState(input.defaultReviewProviderDraft.baseUrl)
  const [providerModelDraft, setProviderModelDraft] = useState(input.defaultReviewProviderDraft.model)
  const [providerKeyDraft, setProviderKeyDraft] = useState('')
  const [runtimeBudgetApprovalId, setRuntimeBudgetApprovalId] = useState('')
  const [isRunningAgentReview, setIsRunningAgentReview] = useState(false)
  const [isStartingCodingAgent, setIsStartingCodingAgent] = useState(false)
  const [pendingInspectorAction, setPendingInspectorAction] = useState<PendingInspectorAction | null>(null)
  const [isNewRunOpen, setIsNewRunOpen] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftRequest, setDraftRequest] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [supportContext, setSupportContext] = useState<SupportContext | null>(null)
  const [toast, setToast] = useState(desktopApi ? '本地执行代理已连接' : '浏览器预览模式')

  const selectedLocalProject =
    localProjects.find((project) => project.id === selectedLocalProjectId) ?? localProjects[0]
  const isTestCommandDirty = Boolean(
    selectedLocalProject &&
      testCommandDraft.trim() &&
      testCommandDraft.trim() !== selectedLocalProject.testCommand.trim(),
  )

  function resetTeamSnapshot() {
    setTeamProjects([])
    setTeamMembers([])
    setTeamProjectCost([])
    setTeamMemberCost([])
    setTeamTotalCost('$0.00')
  }

  function applyLocalExecutionState(state: LocalExecutionState) {
    setLocalProjects(state.projects)
    setThemePreference(state.settings.themePreference)
    setHasLoadedLocalState(true)
    if (state.projects[0] && !selectedLocalProjectId) {
      setSelectedLocalProjectId(state.projects[0].id)
    }

    const normalizedRuns = state.runs.map(normalizeWorkflowRunProgress)

    if (normalizedRuns.length > 0) {
      const nextRunId = normalizedRuns.some((run) => run.id === selectedRunId)
        ? selectedRunId
        : normalizedRuns[0]!.id
      const nextRun = normalizedRuns.find((run) => run.id === nextRunId) ?? normalizedRuns[0]!

      setRuns(normalizedRuns)
      setRemoteRunIds([])
      setSelectedRunId(nextRunId)
      setSelectedNodeId((current) => {
        return nextRun.nodes.some((node) => node.id === current) ? current : nextRun.currentNodeId
      })
      setArtifacts(state.artifacts)
      setEvents(state.events)
      setDataOrigin('local')
      resetTeamSnapshot()
    } else {
      setRuns([])
      setRemoteRunIds([])
      setSelectedRunId('')
      setSelectedNodeId('')
      setArtifacts([])
      setEvents([])
      setDataOrigin('local')
      resetTeamSnapshot()
    }

    setTestEvidence(state.testEvidence)
    setAgentReviews(state.agentReviews)
    setAgentTraces(state.agentTraces)
    setAgentTokenUsage(state.agentTokenUsage)
    setCodingRuns(state.codingRuns)
    setCodingEvents(state.codingEvents)
    setCodingPermissionRequests(state.codingPermissionRequests)
    setCodingPermissionDecisions(state.codingPermissionDecisions)
    setManagedCodingWorkspaces(state.managedCodingWorkspaces)
    setDependencyBootstrapEvidence(state.dependencyBootstrapEvidence)
    setCodingDiffArtifacts(state.codingDiffArtifacts)
    setRetryAttempts(state.retryAttempts ?? [])
    setDesktopPairing(state.desktopPairingCredential ?? null)
    if (state.mcpServers.length > 0) {
      setMcpServers(state.mcpServers)
    }
  }

  useEffect(() => {
    if (!toast) {
      return undefined
    }

    const timeout = window.setTimeout(() => {
      setToast('')
    }, getToastDisplayDurationMs(toast))

    return () => {
      window.clearTimeout(timeout)
    }
  }, [toast])

  useEffect(() => {
    if (!desktopApi) {
      return
    }

    const unsubscribeRun = desktopApi.onCodingRunStatusUpdated((run) => {
      setCodingRuns((previous) => mergeById(previous, [run]))
    })
    const unsubscribeEvent = desktopApi.onCodingEventAppended((event) => {
      setCodingEvents((previous) => mergeById(previous, [event]))
    })
    const unsubscribePermission = desktopApi.onCodingPermissionUpdated((request) => {
      setCodingPermissionRequests((previous) => mergeById(previous, [request]))
    })

    return () => {
      unsubscribeRun()
      unsubscribeEvent()
      unsubscribePermission()
    }
  }, [desktopApi])

  useEffect(() => {
    if (!desktopApi) {
      return
    }

    let disposed = false

    desktopApi
      .loadState()
      .then((state) => {
        if (disposed) {
          return
        }

        applyLocalExecutionState(state)
      })
      .catch((error: unknown) => {
        setHasLoadedLocalState(true)
        setToast(error instanceof Error ? error.message : '加载本地状态失败')
      })

    desktopApi
      .listAgentProviders()
      .then((providers) => {
        if (disposed) {
          return
        }

        setAgentProviders(providers)
        setSelectedAgentProviderId((current) =>
          providers.some((provider) => provider.id === current) ? current : (providers[0]?.id ?? ''),
        )
      })
      .catch((error: unknown) => {
        setToast(error instanceof Error ? error.message : '加载 Agent Provider 失败')
      })

    return () => {
      disposed = true
    }
  }, [desktopApi])

  useEffect(() => {
    setTestCommandDraft(selectedLocalProject?.testCommand ?? '')
  }, [selectedLocalProject?.id, selectedLocalProject?.testCommand])

  useEffect(() => {
    if (!selectedLocalProject || !testCommandDraft.trim()) {
      setCommandSafety(null)
      return
    }

    let disposed = false
    const localSafety = validateTestCommandSafety(testCommandDraft)
    setCommandSafety(localSafety)

    if (!desktopApi) {
      return
    }

    Promise.resolve(
      desktopApi.validateTestCommand({
        projectId: selectedLocalProject.id,
        testCommand: testCommandDraft,
      }),
    )
      .then((safety) => {
        if (!disposed) {
          setCommandSafety(safety)
        }
      })
      .catch(() => {
        if (!disposed) {
          setCommandSafety(localSafety)
        }
      })

    return () => {
      disposed = true
    }
  }, [desktopApi, selectedLocalProject?.id, testCommandDraft])

  const state: DesktopWorkspaceState = {
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
    localProjects,
    teamProjects,
    teamMembers,
    teamProjectCost,
    teamMemberCost,
    teamTotalCost,
    selectedLocalProjectId,
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
    pendingInspectorAction,
    isNewRunOpen,
    draftTitle,
    draftRequest,
    searchQuery,
    supportContext,
    toast,
  }

  const setters: DesktopWorkspaceSetters = {
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
    setProviderIdDraft,
    setProviderBaseUrlDraft,
    setProviderModelDraft,
    setProviderKeyDraft,
    setRuntimeBudgetApprovalId,
    setIsRunningAgentReview,
    setIsStartingCodingAgent,
    setPendingInspectorAction,
    setIsNewRunOpen,
    setDraftTitle,
    setDraftRequest,
    setSearchQuery,
    setSupportContext,
    setToast,
  }

  return {
    desktopApi,
    state,
    setters,
    derived: {
      selectedLocalProject,
      isTestCommandDirty,
    },
    resetTeamSnapshot,
    applyLocalExecutionState,
  }
}
