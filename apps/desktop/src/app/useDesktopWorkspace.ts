import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import {
  artifacts as fixtureArtifacts,
  events as fixtureEvents,
  mcpServers as fixtureMcpServers,
  members,
  parseThemePreference,
  projects,
  runs as fixtureRuns,
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
  fakeAgentProvider,
  getToastDisplayDurationMs,
  mergeById,
  seedMemberRollups,
  seedProjectRollups,
  seedTotalCost,
} from './desktop-view-model'

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
  activeView: 'workbench' | 'team' | 'knowledge' | 'agents' | 'skills' | 'mcp' | 'tests'
  runs: WorkflowRun[]
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
  isNewRunOpen: boolean
  draftTitle: string
  draftRequest: string
  searchQuery: string
  toast: string
}

export type DesktopWorkspaceSetters = {
  setThemePreference: (value: ThemePreference) => void
  setDataOrigin: (value: DataOrigin) => void
  setActiveView: (value: DesktopWorkspaceState['activeView']) => void
  setRuns: Dispatch<SetStateAction<WorkflowRun[]>>
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
  setIsNewRunOpen: Dispatch<SetStateAction<boolean>>
  setDraftTitle: Dispatch<SetStateAction<string>>
  setDraftRequest: Dispatch<SetStateAction<string>>
  setSearchQuery: Dispatch<SetStateAction<string>>
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
  const [activeView, setActiveView] = useState<DesktopWorkspaceState['activeView']>('workbench')
  const [runs, setRuns] = useState<WorkflowRun[]>(fixtureRuns)
  const [selectedRunId, setSelectedRunId] = useState(fixtureRuns[0]?.id ?? '')
  const [selectedNodeId, setSelectedNodeId] = useState(fixtureRuns[0]?.currentNodeId ?? '')
  const [artifacts, setArtifacts] = useState<Artifact[]>(fixtureArtifacts)
  const [events, setEvents] = useState<AgentEvent[]>(fixtureEvents)
  const [testEvidence, setTestEvidence] = useState<TestEvidence[]>([])
  const [localProjects, setLocalProjects] = useState<LocalProject[]>([])
  const [teamProjects, setTeamProjects] = useState<Project[]>(projects)
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>(members)
  const [teamProjectCost, setTeamProjectCost] = useState<TokenUsageRollup[]>(seedProjectRollups)
  const [teamMemberCost, setTeamMemberCost] = useState<TokenUsageRollup[]>(seedMemberRollups)
  const [teamTotalCost, setTeamTotalCost] = useState(seedTotalCost)
  const [selectedLocalProjectId, setSelectedLocalProjectId] = useState('')
  const [testCommandDraft, setTestCommandDraft] = useState('')
  const [commandSafety, setCommandSafety] = useState<CommandSafetyResult | null>(null)
  const [isSavingTestCommand, setIsSavingTestCommand] = useState(false)
  const [isRunningTests, setIsRunningTests] = useState(false)
  const [isSyncingRemote, setIsSyncingRemote] = useState(false)
  const [desktopPairing, setDesktopPairing] = useState<DesktopPairingCredential | null>(null)
  const [pairingCodeDraft, setPairingCodeDraft] = useState('')
  const [isPairingDesktop, setIsPairingDesktop] = useState(false)
  const [mcpServers, setMcpServers] = useState<McpServerDefinition[]>(fixtureMcpServers)
  const [agentProviders, setAgentProviders] = useState<AgentProviderConfig[]>([fakeAgentProvider])
  const [selectedAgentProviderId, setSelectedAgentProviderId] = useState(fakeAgentProvider.id)
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
  const [isNewRunOpen, setIsNewRunOpen] = useState(false)
  const [draftTitle, setDraftTitle] = useState('重构 GitHub webhook 重试策略')
  const [draftRequest, setDraftRequest] = useState('请先澄清 webhook retry 的失败边界，再设计实现方案。')
  const [searchQuery, setSearchQuery] = useState('')
  const [toast, setToast] = useState(desktopApi ? '本地执行代理已连接' : '浏览器预览模式')

  const selectedLocalProject =
    localProjects.find((project) => project.id === selectedLocalProjectId) ?? localProjects[0]
  const isTestCommandDirty = Boolean(
    selectedLocalProject &&
      testCommandDraft.trim() &&
      testCommandDraft.trim() !== selectedLocalProject.testCommand.trim(),
  )

  function resetTeamSnapshot() {
    setTeamProjects(projects)
    setTeamMembers(members)
    setTeamProjectCost(seedProjectRollups)
    setTeamMemberCost(seedMemberRollups)
    setTeamTotalCost(seedTotalCost)
  }

  function applyLocalExecutionState(state: LocalExecutionState) {
    setLocalProjects(state.projects)
    setThemePreference(state.settings.themePreference)
    if (state.projects[0] && !selectedLocalProjectId) {
      setSelectedLocalProjectId(state.projects[0].id)
    }

    if (state.runs.length > 0) {
      const nextRunId = state.runs.some((run) => run.id === selectedRunId)
        ? selectedRunId
        : state.runs[0]!.id
      const nextRun = state.runs.find((run) => run.id === nextRunId) ?? state.runs[0]!

      setRuns(state.runs)
      setSelectedRunId(nextRunId)
      setSelectedNodeId((current) => {
        return nextRun.nodes.some((node) => node.id === current) ? current : nextRun.currentNodeId
      })
      setArtifacts(state.artifacts)
      setEvents(state.events)
      setDataOrigin('local')
      resetTeamSnapshot()
    } else {
      setRuns(fixtureRuns)
      setSelectedRunId((current) => fixtureRuns.some((run) => run.id === current) ? current : fixtureRuns[0]!.id)
      setSelectedNodeId((current) => {
        const run = fixtureRuns.find((candidate) => candidate.id === selectedRunId) ?? fixtureRuns[0]
        return run?.nodes.some((node) => node.id === current) ? current : (run?.currentNodeId ?? current)
      })
      setArtifacts(fixtureArtifacts)
      setEvents(fixtureEvents)
      setDataOrigin('seed')
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
        setToast(error instanceof Error ? error.message : '加载本地状态失败')
      })

    desktopApi
      .listAgentProviders()
      .then((providers) => {
        if (disposed || providers.length === 0) {
          return
        }

        setAgentProviders(providers)
        setSelectedAgentProviderId((current) =>
          providers.some((provider) => provider.id === current) ? current : providers[0]!.id,
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
    activeView,
    runs,
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
    isNewRunOpen,
    draftTitle,
    draftRequest,
    searchQuery,
    toast,
  }

  const setters: DesktopWorkspaceSetters = {
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
