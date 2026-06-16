import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import {
  Activity,
  BarChart3,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  Code2,
  FolderOpen,
  GitPullRequest,
  Moon,
  Network,
  Play,
  Plus,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Sun,
  TestTube2,
  Users,
  Workflow,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  validateTestCommandSafety,
  artifacts as fixtureArtifacts,
  events as fixtureEvents,
  formatUsd,
  knowledgeEntities,
  knowledgeRelations,
  mcpServers as fixtureMcpServers,
  members,
  parseThemePreference,
  projects,
  redactSecrets,
  rollupTokenUsage,
  runs as fixtureRuns,
  skills as fixtureSkills,
  tokenUsage,
  type McpServerDefinition,
  type NodeStage,
  type ThemePreference,
  type AgentEvent,
  type Artifact,
  type CommandSafetyResult,
  type DataOrigin,
  type LocalExecutionState,
  type LocalProject,
  type TestEvidence,
  type WorkflowNode,
  type WorkflowRun,
} from '@ai-devflow/shared'
import { canApproveGate, nextStatusAfterApproval } from '@ai-devflow/shared'
import { getDesktopApi } from './desktop-api'

type ViewId = 'workbench' | 'team' | 'knowledge' | 'skills' | 'mcp' | 'tests'

const stageLabels: Record<NodeStage, string> = {
  clarify: '方案澄清',
  design: '方案设计',
  build: '开发实现',
  test: '测试证据',
  pr: 'PR 交付',
  accept: '业务验收',
}

const stageX: Record<NodeStage, number> = {
  clarify: 0,
  design: 230,
  build: 460,
  test: 690,
  pr: 920,
  accept: 1150,
}

const stageTone: Record<NodeStage, string> = {
  clarify: 'cyan',
  design: 'blue',
  build: 'violet',
  test: 'green',
  pr: 'amber',
  accept: 'rose',
}

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

function AppNode({ data, selected }: NodeProps<Node<{ workflowNode: WorkflowNode }>>) {
  const workflowNode = data.workflowNode
  const statusLabel = {
    pending: 'Pending',
    running: 'Running',
    blocked: 'Gate',
    success: 'Done',
    failed: 'Failed',
    skipped: 'Skipped',
  }[workflowNode.status]

  return (
    <div
      className={`flow-node flow-node--${stageTone[workflowNode.stage]} flow-node--${workflowNode.status} ${selected ? 'is-selected' : ''}`}
      data-testid={`flow-node-${workflowNode.id}`}
    >
      <div className="flow-node__top">
        <span className="flow-node__stage">{stageLabels[workflowNode.stage]}</span>
        <span className="flow-node__status">{statusLabel}</span>
      </div>
      <strong>{workflowNode.title}</strong>
      <p>{workflowNode.subtitle}</p>
      <div className="flow-node__meta">
        <span>{workflowNode.kind}</span>
        <span>{workflowNode.retryCount} retries</span>
      </div>
    </div>
  )
}

const nodeTypes = {
  appNode: AppNode,
}

function buildFlow(run: WorkflowRun): { nodes: Node<{ workflowNode: WorkflowNode }>[]; edges: Edge[] } {
  const stageCounts = new Map<NodeStage, number>()

  const nodes: Node<{ workflowNode: WorkflowNode }>[] = run.nodes.map((workflowNode) => {
    const count = stageCounts.get(workflowNode.stage) ?? 0
    stageCounts.set(workflowNode.stage, count + 1)

    return {
      id: workflowNode.id,
      type: 'appNode',
      position: { x: stageX[workflowNode.stage], y: 72 + count * 150 },
      data: { workflowNode },
    }
  })

  const edges: Edge[] = run.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    animated: edge.kind === 'gate',
    className: `flow-edge flow-edge--${edge.kind}`,
  }))

  return { nodes, edges }
}

function mergeById<T extends { id: string }>(base: T[], incoming: T[]): T[] {
  const map = new Map(base.map((item) => [item.id, item]))
  for (const item of incoming) {
    map.set(item.id, item)
  }

  return Array.from(map.values())
}

function normalizeQuery(value: string) {
  return value.trim().toLocaleLowerCase()
}

function matchesQuery(query: string, values: Array<string | undefined | null>): boolean {
  if (!query) {
    return true
  }

  return values.some((value) => value?.toLocaleLowerCase().includes(query))
}

function runMatchesQuery(
  run: WorkflowRun,
  artifacts: Artifact[],
  events: AgentEvent[],
  query: string,
): boolean {
  if (!query) {
    return true
  }

  const runArtifacts = artifacts.filter((artifact) => artifact.runId === run.id)
  const runEvents = events.filter((event) => event.runId === run.id)

  return matchesQuery(query, [
    run.title,
    run.request,
    run.branchName,
    run.status,
    ...run.nodes.flatMap((node) => [node.title, node.subtitle, node.kind, node.stage, node.status]),
    ...runArtifacts.flatMap((artifact) => [
      artifact.title,
      artifact.summary,
      artifact.content,
      artifact.kind,
    ]),
    ...runEvents.flatMap((event) => [event.kind, event.message]),
  ])
}

function createRunningRun(run: WorkflowRun, nodeId: string): WorkflowRun {
  const timestamp = new Date().toISOString()

  return {
    ...run,
    status: 'testing',
    currentNodeId: nodeId,
    updatedAt: timestamp,
    nodes: run.nodes.map((node) =>
      node.id === nodeId ? { ...node, status: 'running' as const } : node,
    ),
  }
}

export function App() {
  const desktopApi = useMemo(() => getDesktopApi(), [])
  const [themePreference, setThemePreference] = useThemePreference()
  const [dataOrigin, setDataOrigin] = useState<DataOrigin>('seed')
  const [activeView, setActiveView] = useState<ViewId>('workbench')
  const [runs, setRuns] = useState<WorkflowRun[]>(fixtureRuns)
  const [selectedRunId, setSelectedRunId] = useState(fixtureRuns[0]?.id ?? '')
  const [selectedNodeId, setSelectedNodeId] = useState(fixtureRuns[0]?.currentNodeId ?? '')
  const [artifacts, setArtifacts] = useState<Artifact[]>(fixtureArtifacts)
  const [events, setEvents] = useState<AgentEvent[]>(fixtureEvents)
  const [testEvidence, setTestEvidence] = useState<TestEvidence[]>([])
  const [localProjects, setLocalProjects] = useState<LocalProject[]>([])
  const [selectedLocalProjectId, setSelectedLocalProjectId] = useState('')
  const [testCommandDraft, setTestCommandDraft] = useState('')
  const [commandSafety, setCommandSafety] = useState<CommandSafetyResult | null>(null)
  const [isRunningTests, setIsRunningTests] = useState(false)
  const [mcpServers, setMcpServers] = useState<McpServerDefinition[]>(fixtureMcpServers)
  const [isNewRunOpen, setIsNewRunOpen] = useState(false)
  const [draftTitle, setDraftTitle] = useState('重构 GitHub webhook 重试策略')
  const [searchQuery, setSearchQuery] = useState('')
  const [toast, setToast] = useState(desktopApi ? '本地执行代理已连接' : '浏览器预览模式')

  const normalizedSearchQuery = normalizeQuery(searchQuery)
  const visibleRuns = useMemo(
    () => runs.filter((run) => runMatchesQuery(run, artifacts, events, normalizedSearchQuery)),
    [artifacts, events, normalizedSearchQuery, runs],
  )
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? runs[0]
  const selectedNode =
    selectedRun?.nodes.find((node) => node.id === selectedNodeId) ?? selectedRun?.nodes[0]
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
  const selectedLocalProject =
    localProjects.find((project) => project.id === selectedLocalProjectId) ?? localProjects[0]
  const currentUser = members[1]
  const totalCost = tokenUsage.reduce((sum, row) => sum + row.costUsd, 0)
  const flow = useMemo(() => (selectedRun ? buildFlow(selectedRun) : { nodes: [], edges: [] }), [selectedRun])
  const runRollups = rollupTokenUsage(tokenUsage, 'runId')
  const projectRollups = rollupTokenUsage(tokenUsage, 'projectId')

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
    }

    setTestEvidence(state.testEvidence)
    if (state.mcpServers.length > 0) {
      setMcpServers(state.mcpServers)
    }
  }

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

    desktopApi
      .validateTestCommand({
        projectId: selectedLocalProject.id,
        testCommand: testCommandDraft,
      })
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

  function changeThemePreference(nextPreference: ThemePreference) {
    setThemePreference(nextPreference)
    if (!desktopApi) {
      return
    }

    void desktopApi.saveSettings({ themePreference: nextPreference }).catch((error: unknown) => {
      setToast(error instanceof Error ? error.message : '保存主题偏好失败')
    })
  }

  function approveSelectedGate() {
    if (!selectedRun || !selectedNode || !currentUser) {
      return
    }

    if (!canApproveGate(currentUser.role, selectedNode)) {
      setToast('当前角色无权通过这个 Gate')
      return
    }

    const timestamp = new Date().toISOString()
    const updatedRun: WorkflowRun = {
      ...selectedRun,
      status: 'building',
      nodes: selectedRun.nodes.map((node) =>
        node.id === selectedNode.id ? nextStatusAfterApproval(node) : node,
      ),
      updatedAt: timestamp,
    }
    const approvalEvent: AgentEvent = {
      id: `event-approval-${timestamp}`,
      runId: selectedRun.id,
      nodeId: selectedNode.id,
      sequence: events.filter((event) => event.runId === selectedRun.id).length + 1,
      kind: 'approval',
      message: `${currentUser.name} Gate 已通过：${selectedNode.title}`,
      timestamp,
    }

    setRuns((previousRuns) => previousRuns.map((run) => (run.id === selectedRun.id ? updatedRun : run)))
    setEvents((previousEvents) => mergeById(previousEvents, [approvalEvent]))
    setToast('架构 Gate 已通过，Run 进入本地实现阶段')

    if (desktopApi) {
      void Promise.all([
        desktopApi.saveRun(updatedRun),
        desktopApi.saveEvent(approvalEvent),
      ]).catch((error: unknown) => {
        setToast(error instanceof Error ? error.message : '保存 Gate 审批失败')
      })
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

    try {
      const safety = commandSafety ?? validateTestCommandSafety(testCommandDraft)
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

    const safety = commandSafety ?? validateTestCommandSafety(testCommandDraft || selectedLocalProject.testCommand)
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

  async function createRun() {
    const newRun: WorkflowRun = {
      ...fixtureRuns[0]!,
      id: `run-${Date.now()}`,
      title: draftTitle,
      request: '请先澄清 webhook retry 的失败边界，再设计实现方案。',
      status: 'clarifying',
      currentNodeId: 'n-clarify',
      branchName: 'ai/webhook-retry',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nodes: fixtureRuns[0]!.nodes.map((node, index) => ({
        ...node,
        status: index === 0 ? 'running' : 'pending',
      })),
    }

    setRuns((previousRuns) => [newRun, ...previousRuns])
    setSelectedRunId(newRun.id)
    setSelectedNodeId(newRun.currentNodeId)
    setIsNewRunOpen(false)
    setToast('新 Run 已创建，正在进行方案澄清')

    if (!desktopApi) {
      return
    }

    try {
      const persistedRun = await desktopApi.createRun(newRun)
      setRuns((previousRuns) => previousRuns.map((run) => (run.id === newRun.id ? persistedRun : run)))
      setSelectedRunId(persistedRun.id)
      setSelectedNodeId(persistedRun.currentNodeId)
      setDataOrigin('local')
    } catch (error) {
      setToast(error instanceof Error ? error.message : '保存新 Run 失败')
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
              <strong>{projects.find((project) => project.id === selectedRun?.projectId)?.name}</strong>
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
          <Metric label="Token Cost" value={formatUsd(totalCost)} icon={<CircleDollarSign />} />
          <Metric label="Tests Today" value="18 / 20" icon={<TestTube2 />} />
          <span className="toast" data-testid="toast">{toast}</span>
        </section>

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
              selectedNode={selectedNode}
              artifacts={selectedArtifacts}
              events={selectedEvents}
              canApprove={selectedNode ? canApproveGate(currentUser?.role ?? 'member', selectedNode) : false}
              onApprove={approveSelectedGate}
              onRunTests={executeTestPlan}
              isRunningTests={isRunningTests}
            />
          </section>
        )}

        {activeView === 'team' && (
          <TeamOverview projectRollups={projectRollups} runRollups={runRollups} />
        )}

        {activeView === 'knowledge' && (
          <KnowledgeView query={normalizedSearchQuery} />
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
              <textarea defaultValue="请先澄清 webhook retry 的失败边界，再设计实现方案。" />
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

function NavButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button className={`nav-button ${active ? 'is-active' : ''}`} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  )
}

function ThemeToggle({
  value,
  onChange,
}: {
  value: ThemePreference
  onChange: (value: ThemePreference) => void
}) {
  const next = value === 'system' ? 'light' : value === 'light' ? 'dark' : 'system'
  const label = value === 'system' ? '跟随系统' : value === 'light' ? '浅色' : '深色'

  return (
    <button
      className="theme-toggle"
      onClick={() => onChange(next)}
      aria-label="Toggle color theme"
      data-testid="theme-toggle"
    >
      {value === 'dark' ? <Moon size={16} /> : <Sun size={16} />}
      {label}
    </button>
  )
}

function Metric({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="metric">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function LocalProjectPanel({
  project,
  commandDraft,
  onCommandDraftChange,
  onSelectProject,
  onSaveCommand,
  desktopConnected,
  commandSafety,
}: {
  project: LocalProject | undefined
  commandDraft: string
  onCommandDraftChange: (value: string) => void
  onSelectProject: () => void
  onSaveCommand: () => void
  desktopConnected: boolean
  commandSafety: CommandSafetyResult | null
}) {
  return (
    <section className="local-project-panel" aria-label="Local project">
      <div className="section-heading">
        <span>Local Project</span>
        <strong>{project?.name ?? '未选择仓库'}</strong>
      </div>
      <p>{project?.path ?? (desktopConnected ? '选择本地仓库后，DevFlow 会识别测试命令。' : '浏览器预览模式无法打开本地目录。')}</p>
      <button className="ghost-button" onClick={onSelectProject}>
        <FolderOpen size={16} />
        选择本地仓库
      </button>
      <label>
        测试命令
        <input
          aria-label="测试命令"
          value={commandDraft}
          placeholder="例如 pnpm test"
          onChange={(event) => onCommandDraftChange(event.target.value)}
        />
      </label>
      {commandSafety && (
        <div className={`command-safety command-safety--${commandSafety.level}`}>
          <div className="compact-row">
            <span>Risk</span>
            <strong>{commandSafety.level}</strong>
          </div>
          <div className="compact-row">
            <span>Command</span>
            <code>{commandSafety.normalizedCommand || commandDraft}</code>
          </div>
          {project && (
            <div className="compact-row">
              <span>CWD</span>
              <code>{project.path}</code>
            </div>
          )}
          <div className="compact-row">
            <span>Timeout</span>
            <strong>120s</strong>
          </div>
          {commandSafety.reasons.map((reason) => (
            <p key={reason}>{reason}</p>
          ))}
        </div>
      )}
      <button className="primary-button" disabled={!project || !commandDraft.trim()} onClick={onSaveCommand}>
        <Save size={16} />
        保存测试命令
      </button>
    </section>
  )
}

function Inspector({
  selectedNode,
  artifacts,
  events,
  canApprove,
  onApprove,
  onRunTests,
  isRunningTests,
}: {
  selectedNode: WorkflowNode | undefined
  artifacts: Artifact[]
  events: AgentEvent[]
  canApprove: boolean
  onApprove: () => void
  onRunTests: () => void
  isRunningTests: boolean
}) {
  if (!selectedNode) {
    return <aside className="inspector">请选择一个节点</aside>
  }

  return (
    <aside className="inspector" data-testid="node-inspector">
      <div className="section-heading">
        <span>Selected Node</span>
        <strong>{selectedNode.title}</strong>
      </div>
      <div className="node-summary">
        <span>{stageLabels[selectedNode.stage]}</span>
        <p>{selectedNode.subtitle}</p>
      </div>

      <div className="inspector-actions">
        <button className="primary-button" disabled={!canApprove} onClick={onApprove}>
          <CheckCircle2 size={16} />
          通过 Gate
        </button>
        <button className="ghost-button" disabled={isRunningTests} onClick={onRunTests}>
          <Play size={16} />
          {isRunningTests ? '测试中' : '执行测试'}
        </button>
      </div>

      <div className="artifact-list">
        <span className="panel-label">Artifacts</span>
        {artifacts.map((artifact) => (
          <article key={artifact.id} className="artifact-card">
            <strong>{artifact.title}</strong>
            <p>{artifact.summary}</p>
            <code>{artifact.content}</code>
          </article>
        ))}
      </div>

      <div className="event-list">
        <span className="panel-label">Agent Events</span>
        {events.map((event) => (
          <div className="event-row" key={event.id}>
            <span>{event.kind}</span>
            <p>{event.message}</p>
          </div>
        ))}
      </div>
    </aside>
  )
}

function TeamOverview({
  projectRollups,
  runRollups,
}: {
  projectRollups: ReturnType<typeof rollupTokenUsage>
  runRollups: ReturnType<typeof rollupTokenUsage>
}) {
  return (
    <section className="page-grid" data-testid="team-overview">
      <div className="page-main">
        <div className="section-heading">
          <span>Team Overview</span>
          <strong>项目交付健康</strong>
        </div>
        {projects.map((project) => (
          <article key={project.id} className="wide-card">
            <div>
              <strong>{project.name}</strong>
              <p>{project.repository}</p>
            </div>
            <span className={`health health--${project.health}`}>{project.health}</span>
            <span>{project.testCommand}</span>
          </article>
        ))}
      </div>
      <aside className="page-side">
        <strong>Cost Rollup</strong>
        {projectRollups.map((rollup) => (
          <div className="compact-row" key={rollup.key}>
            <span>{rollup.key}</span>
            <strong>{formatUsd(rollup.costUsd)}</strong>
          </div>
        ))}
        {runRollups.map((rollup) => (
          <div className="compact-row" key={rollup.key}>
            <span>{rollup.key}</span>
            <strong>{rollup.totalTokens.toLocaleString()} tokens</strong>
          </div>
        ))}
      </aside>
    </section>
  )
}

function KnowledgeView({ query }: { query: string }) {
  const visibleEntities = knowledgeEntities.filter((entity) =>
    matchesQuery(query, [entity.label, entity.kind, entity.sourcePath]),
  )
  const visibleEntityIds = new Set(visibleEntities.map((entity) => entity.id))
  const visibleRelations = knowledgeRelations.filter((relation) =>
    !query ||
    visibleEntityIds.has(relation.source) ||
    visibleEntityIds.has(relation.target) ||
    matchesQuery(query, [relation.label, relation.source, relation.target]),
  )

  return (
    <section className="page-grid" data-testid="knowledge-view">
      <div className="page-main">
        <div className="section-heading">
          <span>Knowledge Graph</span>
          <strong>轻量知识图谱</strong>
        </div>
        <div className="knowledge-map">
          {visibleEntities.length === 0 ? (
            <p className="empty-note">没有匹配的知识节点</p>
          ) : (
            visibleEntities.map((entity, index) => (
              <div
                key={entity.id}
                className={`knowledge-node knowledge-node--${entity.kind}`}
                style={{ left: `${18 + index * 20}%`, top: `${24 + (index % 2) * 34}%` }}
              >
                <strong>{entity.label}</strong>
                <span>{entity.kind}</span>
              </div>
            ))
          )}
          {visibleRelations.map((relation) => (
            <div className="relation-row" key={relation.id}>
              {relation.source} {relation.label} {relation.target}
            </div>
          ))}
        </div>
      </div>
      <aside className="page-side">
        <strong>Git + Markdown 真源</strong>
        <p>知识库保留在项目仓库，平台只负责索引、图谱、检索和 Run 证据回链。</p>
      </aside>
    </section>
  )
}

function SkillView() {
  return (
    <section className="page-list" data-testid="skill-view">
      <div className="section-heading">
        <span>Skills</span>
        <strong>团队能力目录</strong>
      </div>
      {fixtureSkills.map((skill) => (
        <article className="wide-card" key={skill.id}>
          <div>
            <strong>{skill.name}</strong>
            <p>{skill.description}</p>
          </div>
          <span>{skill.stage}</span>
          <span>{skill.enabled ? 'Enabled' : 'Disabled'}</span>
        </article>
      ))}
    </section>
  )
}

function McpView({
  servers,
  onToggle,
}: {
  servers: McpServerDefinition[]
  onToggle: (id: string) => void
}) {
  return (
    <section className="page-list" data-testid="mcp-view">
      <div className="section-heading">
        <span>MCP</span>
        <strong>本机工具连接器</strong>
      </div>
      {servers.map((server) => (
        <article className="wide-card" key={server.id}>
          <div>
            <strong>{server.name}</strong>
            <p>{server.command}</p>
          </div>
          <span>{server.permission}</span>
          <button className="ghost-button" onClick={() => onToggle(server.id)}>
            {server.enabledLocally ? 'Disable' : 'Enable'}
          </button>
        </article>
      ))}
    </section>
  )
}

function TestsView({
  evidence,
  onRunTests,
  isRunningTests,
}: {
  evidence: TestEvidence[]
  onRunTests: () => void
  isRunningTests: boolean
}) {
  return (
    <section className="page-grid" data-testid="tests-view">
      <div className="page-main">
        <div className="section-heading">
          <span>Testing</span>
          <strong>测试计划与证据</strong>
        </div>
        <article className="test-report">
          <strong>Health endpoint test pack</strong>
          <p>覆盖 ok、degraded、down、Redis timeout、日志脱敏和 smoke 调用。</p>
          <div className="test-bars">
            <span style={{ inlineSize: '88%' }} />
          </div>
          <button className="primary-button" disabled={isRunningTests} onClick={onRunTests}>
            <Play size={16} />
            {isRunningTests ? '测试中' : '执行本地测试'}
          </button>
        </article>
        <div className="evidence-list">
          {evidence.length === 0 ? (
            <p className="empty-note">还没有真实测试证据。选择本地仓库后执行测试。</p>
          ) : (
            evidence.map((item) => (
              <article className="evidence-row" key={item.id}>
                <div>
                  <span className="panel-label">Local test evidence</span>
                  <strong>{item.status}</strong>
                  <p>{item.summary}</p>
                  <div className="evidence-meta">
                    <span>Exit code {item.exitCode ?? 'timeout'}</span>
                    <span>Duration {item.durationMs}ms</span>
                    <span>Redacted {item.redacted ? 'yes' : 'no'}</span>
                  </div>
                  <pre>{item.stdout || item.stderr || '(empty output)'}</pre>
                </div>
                <code>{item.command}</code>
              </article>
            ))
          )}
        </div>
      </div>
      <aside className="page-side">
        <strong>Evidence</strong>
        <div className="compact-row">
          <span>Local runs</span>
          <strong>{evidence.length}</strong>
        </div>
        <div className="compact-row">
          <span>Unit</span>
          <strong>12 passed</strong>
        </div>
        <div className="compact-row">
          <span>Smoke</span>
          <strong>3 passed</strong>
        </div>
        <div className="compact-row">
          <span>Coverage</span>
          <strong>86%</strong>
        </div>
      </aside>
    </section>
  )
}
