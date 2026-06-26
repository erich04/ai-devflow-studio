import type { Edge, Node } from '@xyflow/react'
import {
  formatUsd,
  rollupTokenUsage,
  tokenUsage,
  type AgentEvent,
  type AgentProviderConfig,
  type Artifact,
  type CodingAgentRun,
  type DataOrigin,
  type KnowledgeDocument,
  type KnowledgeReference,
  type NodeStage,
  type GateEnforcementDecision,
  type PolicySnapshot,
  type ProviderCredentialMetadata,
  type TestEvidence,
  type WorkflowNode,
  type WorkflowRun,
} from '@ai-devflow/shared'

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

export const stageLabels: Record<NodeStage, string> = {
  clarify: '需求澄清',
  design: '方案设计',
  build: '开发实现',
  test: '测试证据',
  pr: 'PR 交付',
  accept: '业务验收',
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

export type BoardNodeKind = 'Task' | 'Gate' | 'Review' | 'Delivery'

export type BoardCardProvenance = 'template' | 'policy' | 'runtime' | 'folded-output'

export type StageCompletionState = 'passed' | 'current' | 'blocked' | 'waiting'

export type BoardAttachmentChip = {
  kind: 'ART' | 'EVD' | 'TRC'
  label: string
  count: number
}

export type WorkflowBoardCard = {
  node: WorkflowNode
  visualKind: BoardNodeKind
  statusLabel: string
  statusTone: 'good' | 'warn' | 'bad' | 'soft' | 'neutral'
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

export type StatusDescriptor = {
  id: string
  label: string
  state: 'default' | 'loading' | 'empty' | 'blocked' | 'failed' | 'success' | 'policy unavailable' | 'missing agent review' | 'over budget approval'
  tone: 'good' | 'warn' | 'bad' | 'soft' | 'neutral'
  summary: string
  nextAction: string
  impact: string
}

export type BackendReadinessStatus =
  | 'real IPC/API'
  | 'local persisted'
  | 'fixture fallback'
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
      status: 'fixture fallback',
      label: 'browser preview',
      detail: 'Vite/browser preview cannot read Electron IPC or local SQLite, so it shows seed runs only.',
      tone: 'warn',
    }
  }

  if (!input.hasLoadedLocalState) {
    return {
      status: 'real IPC/API',
      label: 'loading local IPC',
      detail: 'Electron renderer is waiting for loadState() before replacing seed UI state.',
      tone: 'warn',
    }
  }

  if (input.dataOrigin === 'local') {
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
    status: 'fixture fallback',
    label: 'seed fallback',
    detail: 'Electron loadState() returned no persisted runs; seed runs remain visible until a local Run exists.',
    tone: 'soft',
  }
}

export function buildKnowledgeDataSource(input: {
  desktopConnected: boolean
  dataOrigin: DataOrigin
}): FieldDataSource {
  if (!input.desktopConnected || input.dataOrigin === 'seed') {
    return {
      status: 'fixture fallback',
      label: 'shared knowledge index',
      detail: 'Knowledge uses bundled shared documents and Run references in browser/seed preview.',
      tone: 'soft',
    }
  }

  return {
    status: 'desktop-only adapter',
    label: 'shared index adapter',
    detail: 'Current Electron path builds knowledge references from shared docs; arbitrary repo source query is a future contract.',
    tone: 'warn',
  }
}

export function buildAgentProviderDataSource(provider: AgentProviderConfig | undefined): FieldDataSource {
  if (!provider || provider.kind === 'fake') {
    return {
      status: 'fixture fallback',
      label: 'fake provider fallback',
      detail: 'No persisted live provider is selected; review runs are deterministic and spend no provider tokens.',
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

export const inspectorTabsByKind: Record<BoardNodeKind, string[]> = {
  Task: ['状态', '产物', 'Trace', 'Gate影响'],
  Gate: ['状态', 'Gate条件', 'Evidence', 'Remediation'],
  Review: ['状态', 'Knowledge Review', '引用来源', 'Evidence'],
  Delivery: ['状态', 'Artifacts', 'Evidence', 'Handoff'],
}

export function getBoardNodeKind(node: WorkflowNode): BoardNodeKind {
  if (node.kind === 'gate') {
    return 'Gate'
  }
  if (node.kind === 'pr' || node.kind === 'acceptance') {
    return 'Delivery'
  }
  if (node.kind === 'agent' && node.stage === 'design') {
    return 'Review'
  }
  return 'Task'
}

export function getNodeStatusTone(status: WorkflowNode['status']): WorkflowBoardCard['statusTone'] {
  if (status === 'success') {
    return 'good'
  }
  if (status === 'blocked' || status === 'failed') {
    return 'bad'
  }
  if (status === 'running') {
    return 'warn'
  }
  if (status === 'skipped') {
    return 'soft'
  }
  return 'neutral'
}

export function getNodeStatusLabel(status: WorkflowNode['status']): string {
  return {
    pending: 'waiting',
    running: 'ready',
    blocked: 'blocked',
    success: 'success',
    failed: 'failed',
    skipped: 'skipped',
  }[status]
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
    { kind: 'ART', label: nodeArtifacts.length > 0 ? `${nodeArtifacts.length} artifact` : '0 artifact', count: nodeArtifacts.length },
    { kind: 'EVD', label: nodeEvidence.length > 0 ? `${nodeEvidence.length} evidence` : '0 evidence', count: nodeEvidence.length },
    { kind: 'TRC', label: nodeEvents.length > 0 ? `${nodeEvents.length} trace` : '0 trace', count: nodeEvents.length },
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

export const seedProjectRollups = rollupTokenUsage(tokenUsage, 'projectId')
export const seedMemberRollups = rollupTokenUsage(tokenUsage, 'userId')
export const seedTotalCost = formatUsd(tokenUsage.reduce((sum, row) => sum + row.costUsd, 0))

export const fakeAgentProvider: AgentProviderConfig = {
  id: 'fake-knowledge-review',
  name: 'Deterministic Fake Provider',
  kind: 'fake',
  model: 'fake',
  enabled: true,
  updatedAt: new Date(0).toISOString(),
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

const legacyNodeTitleLabels: Record<string, string> = {
  '方案澄清': '需求澄清',
  '澄清 Gate': '需求确认 Gate',
  '架构 Gate': '方案评审 Gate',
  'Clarify request': '需求澄清',
  'Clarification Gate': '需求确认 Gate',
  'Design solution': '方案设计',
  'Design Gate': '方案评审 Gate',
}

const legacyNodeSubtitleLabels: Record<string, string> = {
  'Capture acceptance criteria and non-goals': '补齐验收口径与非目标',
  'Confirm the request is ready for design': '确认需求已准备进入方案设计',
  'Define implementation and test strategy': '定义实现方案与测试策略',
  'Approve architecture before implementation': '审批方案后进入实现',
  'Lead 审批后进入实现': 'Lead 审批方案后进入实现',
}

export function displayNodeTitle(node: WorkflowNode): string {
  return legacyNodeTitleLabels[node.title] ?? node.title
}

export function displayNodeSubtitle(node: WorkflowNode): string {
  return legacyNodeSubtitleLabels[node.subtitle] ?? node.subtitle
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
    if (matchesQuery(query, [run.title, run.request, run.branchName, run.status])) {
      results.push({
        id: `run:${run.id}`,
        type: 'run',
        title: run.title,
        subtitle: `${run.status} · ${run.branchName}`,
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

export function buildStatusDescriptors(input: {
  node: WorkflowNode
  visualKind: BoardNodeKind
  artifacts: Artifact[]
  events: AgentEvent[]
  latestAgentReview?: { gateAdvisory: { blocksApproval: boolean } } | undefined
  policySnapshot: PolicySnapshot | null
  gateEnforcementDecision: GateEnforcementDecision | null
  isLoadingGateEnforcement: boolean
}): StatusDescriptor[] {
  const descriptors: StatusDescriptor[] = []
  const decision = input.gateEnforcementDecision

  descriptors.push({
    id: 'node-status',
    label: 'Node status',
    state: input.node.status === 'success' ? 'success' : input.node.status === 'failed' ? 'failed' : input.node.status === 'blocked' ? 'blocked' : 'default',
    tone: getNodeStatusTone(input.node.status),
    summary: `${displayNodeTitle(input.node)} 当前为 ${getNodeStatusLabel(input.node.status)}。`,
    nextAction: input.node.status === 'blocked' ? '查看阻断条件并补齐 Evidence。' : '按当前节点类型推进下一步。',
    impact: `${stageLabels[input.node.stage]} · ${input.visualKind}`,
  })

  descriptors.push({
    id: 'policy-snapshot',
    label: 'Policy snapshot',
    state: input.isLoadingGateEnforcement
      ? 'loading'
      : decision?.status === 'blocked_policy_unavailable'
        ? 'policy unavailable'
        : input.policySnapshot
          ? 'success'
          : 'empty',
    tone: input.isLoadingGateEnforcement
      ? 'warn'
      : decision?.status === 'blocked_policy_unavailable'
        ? 'bad'
        : input.policySnapshot
          ? 'good'
          : 'soft',
    summary: input.policySnapshot
      ? `${input.policySnapshot.source} v${input.policySnapshot.version} · synced ${input.policySnapshot.syncedAt}`
      : '当前环境尚未加载 Team policy snapshot。',
    nextAction: input.policySnapshot ? '使用该 snapshot 解释 Gate 条件。' : '先同步团队策略，再重新评估 Gate。',
    impact: 'Team policy / Gate enforcement',
  })

  if (decision?.blockingReasons.some((reason) => reason.target === 'missing_agent_review')) {
    descriptors.push({
      id: 'missing-agent-review',
      label: 'Knowledge Review',
      state: 'missing agent review',
      tone: 'bad',
      summary: 'Gate 缺少 Knowledge Review 结果。',
      nextAction: '从 Inspector 跳到 Agents 运行 Knowledge Review。',
      impact: 'Gate Advisory / Review Evidence',
    })
  } else {
    descriptors.push({
      id: 'knowledge-review',
      label: 'Knowledge Review',
      state: input.latestAgentReview ? 'success' : 'empty',
      tone: input.latestAgentReview ? 'good' : 'soft',
      summary: input.latestAgentReview ? '已有 Knowledge Review advisory。' : '还没有当前节点的 Knowledge Review。',
      nextAction: input.latestAgentReview ? '在 Inspector 中核对 advisory。' : '需要时从 Inspector 进入 Agents。',
      impact: 'Review input for Gate',
    })
  }

  descriptors.push({
    id: 'test-evidence',
    label: 'Test Evidence',
    state: input.artifacts.some((artifact) => artifact.kind === 'test_report') ? 'success' : 'empty',
    tone: input.artifacts.some((artifact) => artifact.kind === 'test_report') ? 'good' : 'soft',
    summary: input.artifacts.some((artifact) => artifact.kind === 'test_report')
      ? '当前节点已有测试报告 Artifact。'
      : '当前节点尚未归档 Test Evidence。',
    nextAction: '从 Inspector 进入 Tests 执行或查看证据。',
    impact: 'Testing Gate / Evidence rollup',
  })

  descriptors.push({
    id: 'budget',
    label: 'Budget guard',
    state: input.node.stage === 'build' ? 'over budget approval' : 'default',
    tone: input.node.stage === 'build' ? 'warn' : 'soft',
    summary: input.node.stage === 'build'
      ? '真实 runtime 可能需要 lead approval 后才能继续。'
      : '当前节点没有活跃 runtime budget 请求。',
    nextAction: input.node.stage === 'build' ? '在 Agents 中填写 approval id 后重试。' : '无需预算动作。',
    impact: 'Coding Agent runtime',
  })

  return descriptors
}

export function createRunningRun(run: WorkflowRun, nodeId: string): WorkflowRun {
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
  return 'deterministic fake engine'
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
