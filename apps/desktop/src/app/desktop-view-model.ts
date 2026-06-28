import type { Edge, Node } from '@xyflow/react'
import {
  type AgentEvent,
  type AgentProviderConfig,
  type Artifact,
  type CodingAgentRun,
  type DataOrigin,
  type KnowledgeDocument,
  type KnowledgeReference,
  type NodeStage,
  type ProviderCredentialMetadata,
  type RunStatus,
  type TestEvidence,
  type WorkflowNode,
  type WorkflowRun,
} from '@ai-devflow/shared'
import {
  displayNodeSubtitle,
  displayNodeTitle,
  getBoardNodeKind,
  getNodeStatusLabel,
  getNodeStatusTone,
  stageLabels,
  type BoardNodeKind,
  type StatusTone,
} from './node-inspector-view-model'

export {
  buildGateRequirementMatrix,
  buildNodeInspectorViewModel,
  buildStatusDescriptors,
  displayNodeSubtitle,
  displayNodeTitle,
  getBoardNodeKind,
  getNodeStatusLabel,
  getNodeStatusTone,
  inspectorTabPlansByKind,
  inspectorTabsByKind,
  resolveInspectorTabForSearchResult,
  stageLabels,
  type BoardNodeKind,
  type GateRequirementRow,
  type InspectorAction,
  type InspectorActionDisabledReason,
  type InspectorActionId,
  type InspectorNextAction,
  type InspectorSectionId,
  type InspectorTabPlan,
  type NodeInspectorViewModel,
  type StatusDescriptor,
  type StatusTone,
} from './node-inspector-view-model'

export type ViewId = 'workbench' | 'team' | 'knowledge' | 'agents' | 'skills' | 'mcp' | 'tests'

export type SupportFocusTarget =
  | 'knowledge-review'
  | 'local-tests'
  | 'knowledge-reference'
  | 'coding-agent'
  | 'artifact'
  | 'event'

export type SupportContext = {
  runId: string
  nodeId: string
  sourceView: ViewId
  returnView: Extract<ViewId, 'workbench'>
  focusTarget: SupportFocusTarget
  label: string
  referenceId?: string | undefined
  documentId?: string | undefined
  artifactId?: string | undefined
  eventId?: string | undefined
  inspectorTab?: string | undefined
  createdAt: string
}

export type SearchResultItem = {
  id: string
  type: 'run' | 'node' | 'artifact' | 'knowledge' | 'event'
  title: string
  subtitle: string
  runId?: string | undefined
  nodeId?: string | undefined
  artifactId?: string | undefined
  documentId?: string | undefined
  eventId?: string | undefined
  referenceId?: string | undefined
}

export const stageX: Record<NodeStage, number> = {
  clarify: 0,
  design: 230,
  build: 460,
  test: 690,
  pr: 920,
  accept: 1150,
}

export const stageTone: Record<NodeStage, string> = {
  clarify: 'cyan',
  design: 'blue',
  build: 'violet',
  test: 'green',
  pr: 'amber',
  accept: 'rose',
}

export const stageOrder: NodeStage[] = ['clarify', 'design', 'build', 'test', 'pr', 'accept']

export const runStatusLabels: Record<RunStatus, string> = {
  created: '已创建',
  clarifying: '需求澄清中',
  designing: '方案设计中',
  building: '开发实现中',
  testing: '测试证据中',
  paused_at_gate: '等待 Gate',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

export function getRunStatusLabel(status: RunStatus): string {
  return runStatusLabels[status]
}

export type BoardCardProvenance = 'template' | 'policy' | 'runtime' | 'folded-output'

export type StageCompletionState = 'passed' | 'current' | 'blocked' | 'waiting'

export type BoardAttachmentChip = {
  kind: 'artifact' | 'evidence' | 'trace'
  label: string
  count: number
}

export type WorkflowBoardCard = {
  node: WorkflowNode
  visualKind: BoardNodeKind
  statusLabel: string
  statusTone: StatusTone
  provenance: BoardCardProvenance
  provenanceLabel: string
  attachmentChips: BoardAttachmentChip[]
}

export type WorkflowBoardStage = {
  stage: NodeStage
  index: string
  label: string
  completionState: StageCompletionState
  completionLabel: string
  provenanceSummary: string
  cards: WorkflowBoardCard[]
}

export type BackendReadinessStatus =
  | 'real IPC/API'
  | 'local persisted'
  | 'development adapter'
  | 'desktop-only adapter'
  | 'missing contract'

export type FieldDataSource = {
  status: BackendReadinessStatus
  label: string
  detail: string
  tone: 'good' | 'warn' | 'bad' | 'soft' | 'neutral' | 'accent'
}

export function buildRuntimeDataSource(input: {
  desktopConnected: boolean
  hasLoadedLocalState: boolean
  dataOrigin: DataOrigin
  localRunCount: number
  remoteRunCount: number
}): FieldDataSource {
  if (!input.desktopConnected) {
    return {
      status: 'missing contract',
      label: 'browser preview',
      detail: 'Browser preview cannot read Electron IPC or local SQLite, so project data stays empty until the app runs in Electron.',
      tone: 'warn',
    }
  }

  if (!input.hasLoadedLocalState) {
    return {
      status: 'real IPC/API',
      label: 'loading local IPC',
      detail: 'Electron renderer is waiting for loadState() before showing local SQLite state.',
      tone: 'warn',
    }
  }

  if (input.dataOrigin === 'local') {
    if (input.localRunCount === 0) {
      return {
        status: 'local persisted',
        label: 'local SQLite empty',
        detail: 'Electron loadState() returned no persisted runs, so no Run data is shown.',
        tone: 'soft',
      }
    }

    return {
      status: 'local persisted',
      label: 'local SQLite',
      detail: `${input.localRunCount} local runs loaded from Electron local store.`,
      tone: 'good',
    }
  }

  if (input.dataOrigin === 'remote') {
    return {
      status: 'real IPC/API',
      label: 'remote snapshot + local merge',
      detail: `${input.localRunCount} local runs and ${input.remoteRunCount} remote runs are visible after sync.`,
      tone: 'accent',
    }
  }

  if (input.dataOrigin === 'adapter') {
    return {
      status: 'desktop-only adapter',
      label: 'desktop adapter',
      detail: 'Renderer is showing derived UI state built from loaded domain objects.',
      tone: 'soft',
    }
  }

  return {
    status: 'missing contract',
    label: 'not loaded',
    detail: 'No runtime data source is currently loaded.',
    tone: 'soft',
  }
}

export function buildKnowledgeDataSource(input: {
  desktopConnected: boolean
  dataOrigin: DataOrigin
}): FieldDataSource {
  if (!input.desktopConnected || input.dataOrigin === 'seed') {
    return {
      status: 'missing contract',
      label: 'not indexed',
      detail: 'No real repository knowledge index is loaded in this view.',
      tone: 'soft',
    }
  }

  return {
    status: 'missing contract',
    label: 'not indexed',
    detail: 'Current Electron path has not indexed the selected local repository yet.',
    tone: 'warn',
  }
}

export function buildAgentProviderDataSource(provider: AgentProviderConfig | undefined): FieldDataSource {
  if (!provider) {
    return {
      status: 'missing contract',
      label: 'not configured',
      detail: 'No persisted review provider is selected.',
      tone: 'soft',
    }
  }

  if (provider.kind === 'fake') {
    return {
      status: 'development adapter',
      label: 'development provider',
      detail: 'A persisted development provider is selected; review runs are deterministic and spend no provider tokens.',
      tone: 'warn',
    }
  }

  return {
    status: 'local persisted',
    label: 'stored provider metadata',
    detail: 'Provider credential metadata came from Electron local credential storage; the raw key stays outside renderer.',
    tone: 'good',
  }
}

function provenanceForNode(node: WorkflowNode, visualKind: BoardNodeKind): BoardCardProvenance {
  if (visualKind === 'Gate' || visualKind === 'Review') {
    return 'policy'
  }
  if (node.kind === 'test' || node.stage === 'build') {
    return 'runtime'
  }
  if (visualKind === 'Delivery') {
    return 'folded-output'
  }
  return 'template'
}

const provenanceLabels: Record<BoardCardProvenance, string> = {
  template: 'Run template',
  policy: 'Team policy 插入',
  runtime: 'Local runtime 结果',
  'folded-output': '折叠输出节点',
}

function buildAttachmentChips(input: {
  node: WorkflowNode
  artifacts: Artifact[]
  events: AgentEvent[]
  testEvidence: TestEvidence[]
}): BoardAttachmentChip[] {
  const nodeArtifacts = input.artifacts.filter((artifact) => artifact.nodeId === input.node.id)
  const nodeEvents = input.events.filter((event) => event.nodeId === input.node.id)
  const nodeEvidence = input.testEvidence.filter((evidence) => evidence.nodeId === input.node.id)

  return [
    { kind: 'artifact', label: '产物', count: nodeArtifacts.length },
    { kind: 'evidence', label: '证据', count: nodeEvidence.length },
    { kind: 'trace', label: '轨迹', count: nodeEvents.length },
  ]
}

function stageCompletion(input: {
  cards: WorkflowBoardCard[]
  currentNode: WorkflowNode | undefined
}): {
  completionState: StageCompletionState
  completionLabel: string
} {
  if (input.cards.length === 0) {
    return { completionState: 'waiting', completionLabel: '等待' }
  }

  if (input.cards.some((card) => card.node.status === 'blocked' || card.node.status === 'failed')) {
    return { completionState: 'blocked', completionLabel: '卡点' }
  }

  if (input.cards.every((card) => card.node.status === 'success' || card.node.status === 'skipped')) {
    return { completionState: 'passed', completionLabel: '已通过' }
  }

  if (input.cards.some((card) => card.node.status === 'running' || card.node.id === input.currentNode?.id)) {
    return { completionState: 'current', completionLabel: '当前位置' }
  }

  return { completionState: 'waiting', completionLabel: '等待' }
}

function stageProvenanceSummary(cards: WorkflowBoardCard[]): string {
  if (cards.length === 0) {
    return '无节点，等待 Run template 或 policy 生成。'
  }

  const counts = cards.reduce<Record<BoardCardProvenance, number>>(
    (summary, card) => ({ ...summary, [card.provenance]: summary[card.provenance] + 1 }),
    { template: 0, policy: 0, runtime: 0, 'folded-output': 0 },
  )
  return [
    counts.template ? `${counts.template} template` : '',
    counts.policy ? `${counts.policy} policy` : '',
    counts.runtime ? `${counts.runtime} runtime` : '',
    counts['folded-output'] ? `${counts['folded-output']} folded` : '',
  ].filter(Boolean).join(' · ')
}

export function buildWorkflowBoard(input: WorkflowRun | {
  run: WorkflowRun
  artifacts?: Artifact[]
  events?: AgentEvent[]
  testEvidence?: TestEvidence[]
}): WorkflowBoardStage[] {
  const run = 'nodes' in input ? input : input.run
  const artifacts = 'nodes' in input ? [] : (input.artifacts ?? [])
  const events = 'nodes' in input ? [] : (input.events ?? [])
  const testEvidence = 'nodes' in input ? [] : (input.testEvidence ?? [])
  const currentNode = run.nodes.find((node) => node.id === run.currentNodeId)

  return stageOrder.map((stage, index) => {
    const cards = run.nodes
      .filter((node) => node.stage === stage)
      .map((node) => {
        const visualKind = getBoardNodeKind(node)
        const provenance = provenanceForNode(node, visualKind)

        return {
          node,
          visualKind,
          statusLabel: getNodeStatusLabel(node.status),
          statusTone: getNodeStatusTone(node.status),
          provenance,
          provenanceLabel: provenanceLabels[provenance],
          attachmentChips: buildAttachmentChips({ node, artifacts, events, testEvidence }),
        }
      })
    const completion = stageCompletion({
      cards,
      currentNode,
    })

    return {
      stage,
      index: String(index + 1).padStart(2, '0'),
      label: stageLabels[stage],
      ...completion,
      provenanceSummary: stageProvenanceSummary(cards),
      cards,
    }
  })
}

export function currentRunPhaseCopy(run: WorkflowRun): string {
  const currentNode = run.nodes.find((node) => node.id === run.currentNodeId)
  if (!currentNode) {
    return '当前 Run 尚未定位到节点。'
  }
  return `当前卡点: ${stageLabels[currentNode.stage]} · ${displayNodeTitle(currentNode)}。`
}

export const defaultReviewProviderDraft = {
  providerId: 'doubao-review',
  baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
  model: 'ark-code-latest',
}

export function getToastDisplayDurationMs(message: string): number {
  const characterCount = message.trim().length
  return Math.max(8000, characterCount * 120)
}

export function reviewProviderFromMetadata(metadata: ProviderCredentialMetadata): AgentProviderConfig {
  return {
    id: metadata.providerId,
    name: metadata.providerId,
    kind: 'openai-compatible',
    ...(metadata.baseUrl ? { baseUrl: metadata.baseUrl } : {}),
    model: metadata.model,
    enabled: true,
    maskedCredential: metadata.maskedCredential,
    updatedAt: metadata.updatedAt,
  }
}

export function buildFlow(run: WorkflowRun): { nodes: Node<{ workflowNode: WorkflowNode }>[]; edges: Edge[] } {
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

export function mergeById<T extends { id: string }>(base: T[], incoming: T[]): T[] {
  const map = new Map(base.map((item) => [item.id, item]))
  for (const item of incoming) {
    map.set(item.id, item)
  }
  return Array.from(map.values())
}

export function nextEventSequence(events: AgentEvent[], runId: string): number {
  return (
    events
      .filter((event) => event.runId === runId)
      .reduce((highest, event) => Math.max(highest, event.sequence), 0) + 1
  )
}

export function normalizeQuery(value: string): string {
  return value.trim().toLocaleLowerCase()
}

export function slugifyBranchName(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

export function matchesQuery(query: string, values: Array<string | undefined | null>): boolean {
  if (!query) {
    return true
  }

  return values.some((value) => value?.toLocaleLowerCase().includes(query))
}

export function runMatchesQuery(
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
    getRunStatusLabel(run.status),
    ...run.nodes.flatMap((node) => [
      node.title,
      displayNodeTitle(node),
      node.subtitle,
      displayNodeSubtitle(node),
      node.kind,
      node.stage,
      node.status,
    ]),
    ...runArtifacts.flatMap((artifact) => [
      artifact.title,
      artifact.summary,
      artifact.content,
      artifact.kind,
    ]),
    ...runEvents.flatMap((event) => [event.kind, event.message]),
  ])
}

export function buildSearchResults(input: {
  query: string
  runs: WorkflowRun[]
  artifacts: Artifact[]
  events: AgentEvent[]
  knowledgeDocuments: KnowledgeDocument[]
  knowledgeReferences: KnowledgeReference[]
}): SearchResultItem[] {
  const query = normalizeQuery(input.query)
  if (!query) {
    return []
  }

  const results: SearchResultItem[] = []

  for (const run of input.runs) {
    if (matchesQuery(query, [run.title, run.request, run.branchName, run.status, getRunStatusLabel(run.status)])) {
      results.push({
        id: `run:${run.id}`,
        type: 'run',
        title: run.title,
        subtitle: `${getRunStatusLabel(run.status)} · ${run.branchName}`,
        runId: run.id,
        nodeId: run.currentNodeId,
      })
    }

    for (const node of run.nodes) {
      if (
        matchesQuery(query, [
          node.title,
          displayNodeTitle(node),
          node.subtitle,
          displayNodeSubtitle(node),
          node.kind,
          node.stage,
          node.status,
        ])
      ) {
        results.push({
          id: `node:${node.id}`,
          type: 'node',
          title: displayNodeTitle(node),
          subtitle: `${stageLabels[node.stage]} · ${getNodeStatusLabel(node.status)}`,
          runId: run.id,
          nodeId: node.id,
        })
      }
    }
  }

  for (const artifact of input.artifacts) {
    if (matchesQuery(query, [artifact.title, artifact.summary, artifact.content, artifact.kind])) {
      results.push({
        id: `artifact:${artifact.id}`,
        type: 'artifact',
        title: artifact.title,
        subtitle: `${artifact.kind} · Artifact`,
        runId: artifact.runId,
        nodeId: artifact.nodeId,
        artifactId: artifact.id,
      })
    }
  }

  for (const document of input.knowledgeDocuments) {
    if (
      matchesQuery(query, [
        document.title,
        document.category,
        document.summary,
        document.sourcePath,
        ...document.tags,
      ])
    ) {
      const reference = input.knowledgeReferences.find((candidate) => candidate.documentId === document.id)
      results.push({
        id: `knowledge:${document.id}`,
        type: 'knowledge',
        title: document.title,
        subtitle: `${document.category} · ${document.sourcePath}`,
        runId: reference?.runId,
        nodeId: reference?.nodeId,
        documentId: document.id,
        referenceId: reference?.id,
      })
    }
  }

  for (const event of input.events) {
    if (matchesQuery(query, [event.kind, event.message])) {
      results.push({
        id: `event:${event.id}`,
        type: 'event',
        title: event.kind,
        subtitle: event.message,
        runId: event.runId,
        nodeId: event.nodeId,
        eventId: event.id,
      })
    }
  }

  return results.slice(0, 12)
}

export function createRunningRun(run: WorkflowRun, nodeId: string): WorkflowRun {
  const timestamp = new Date().toISOString()
  const targetIndex = run.nodes.findIndex((node) => node.id === nodeId)

  return {
    ...run,
    status: 'testing',
    currentNodeId: nodeId,
    updatedAt: timestamp,
    nodes: run.nodes.map((node, index) => {
      if (node.id === nodeId) {
        return { ...node, status: 'running' as const }
      }
      if (targetIndex >= 0 && index < targetIndex && node.status === 'running') {
        return { ...node, status: 'success' as const }
      }
      if (targetIndex >= 0 && index > targetIndex && node.status !== 'pending') {
        return { ...node, status: 'pending' as const }
      }
      return node
    }),
  }
}

export function appendArtifactToNode(run: WorkflowRun, nodeId: string, artifactId: string): WorkflowRun {
  return {
    ...run,
    updatedAt: new Date().toISOString(),
    nodes: run.nodes.map((node) =>
      node.id === nodeId && !node.artifactIds.includes(artifactId)
        ? { ...node, artifactIds: [...node.artifactIds, artifactId] }
        : node,
    ),
  }
}

export function codingTraceMetadataString(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

export function codingTraceSourceLabel(source: string | undefined): string {
  if (source === 'opencode_metadata') {
    return 'opencode metadata'
  }
  if (source === 'opencode_event_stream') {
    return 'opencode event stream'
  }
  return 'Inferred tool'
}

export function codingRuntimeLabel(engine: CodingAgentRun['engine']): string {
  if (engine === 'opencode-http') {
    return 'real opencode'
  }
  if (engine === 'opencode-acp') {
    return 'real opencode ACP'
  }
  return 'development adapter'
}

export function codingTerminalLabel(status: CodingAgentRun['status']): string {
  if (
    status === 'completed' ||
    status === 'failed' ||
    status === 'timed_out' ||
    status === 'cancelled' ||
    status === 'interrupted'
  ) {
    return status
  }
  return `in progress · ${status}`
}
