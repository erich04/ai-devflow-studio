import type { Edge, Node } from '@xyflow/react'
import {
  formatUsd,
  rollupTokenUsage,
  tokenUsage,
  type AgentEvent,
  type AgentProviderConfig,
  type Artifact,
  type CodingAgentRun,
  type NodeStage,
  type ProviderCredentialMetadata,
  type WorkflowNode,
  type WorkflowRun,
} from '@ai-devflow/shared'

export type ViewId = 'workbench' | 'team' | 'knowledge' | 'agents' | 'skills' | 'mcp' | 'tests'

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
