import type {
  AgentProvider,
  WorkflowArtifactProviderContext,
  WorkflowArtifactProviderRequest,
  WorkflowArtifactProviderOutput,
} from './agent-review'
import type { AgentProviderUsage, Artifact, WorkflowNode, WorkflowRun } from './domain'
import { redactSecrets } from './redaction'

export type WorkflowStageAgentSource = 'model' | 'fake_template'

export type RunWorkflowStageAgentInput = {
  run: WorkflowRun
  node: WorkflowNode
  artifacts: Artifact[]
  provider: AgentProvider
  requestedBy: string
  runtime: WorkflowArtifactProviderRequest['runtime']
  now?: () => string
}

export type RunWorkflowStageAgentResult = {
  artifact: Artifact
  providerId: string
  model: string
  source: WorkflowStageAgentSource
  prompt: string
  completion: string
  usage?: AgentProviderUsage
}

function artifactKindForNode(node: WorkflowNode): 'clarification' | 'design' {
  if (node.kind !== 'agent' || (node.stage !== 'clarify' && node.stage !== 'design')) {
    throw new Error(`Workflow stage agent does not support node ${node.id}`)
  }

  return node.stage === 'clarify' ? 'clarification' : 'design'
}

function defaultTitleForStage(stage: WorkflowArtifactProviderRequest['stage']): string {
  return stage === 'clarify' ? '需求澄清结果' : '方案设计'
}

function defaultSummaryForStage(input: {
  stage: WorkflowArtifactProviderRequest['stage']
  run: WorkflowRun
}): string {
  return input.stage === 'clarify'
    ? `Clarified scope for ${input.run.title}`
    : `Implementation and test strategy for ${input.run.title}`
}

function buildWorkflowArtifactContext(input: {
  run: WorkflowRun
  node: WorkflowNode
  artifacts: Artifact[]
}): WorkflowArtifactProviderContext {
  return {
    run: {
      id: input.run.id,
      title: input.run.title,
      request: input.run.request,
      projectId: input.run.projectId,
      status: input.run.status,
      branchName: input.run.branchName,
    },
    node: {
      id: input.node.id,
      stage: input.node.stage,
      title: input.node.title,
      subtitle: input.node.subtitle,
      kind: input.node.kind,
      status: input.node.status,
    },
    artifacts: input.artifacts.map((artifact) => ({
      id: artifact.id,
      kind: artifact.kind,
      title: artifact.title,
      summary: artifact.summary,
      content: artifact.content,
      redacted: artifact.redacted,
    })),
  }
}

function createWorkflowArtifactPrompt(input: {
  request: WorkflowArtifactProviderRequest
  context: WorkflowArtifactProviderContext
}): string {
  const upstreamArtifacts = input.context.artifacts
    .map((artifact) => `- ${artifact.kind}: ${artifact.title} (${artifact.id})\n  Summary: ${artifact.summary}`)
    .join('\n')
  const stageInstruction = input.request.stage === 'clarify'
    ? [
        'Generate a requirements clarification artifact.',
        'Focus on goals, acceptance criteria, non-goals, assumptions, and open questions.',
        'Do not design implementation details yet.',
      ]
    : [
        'Generate a design artifact based on the clarified request.',
        'Focus on implementation approach, testing strategy, rollout considerations, and remaining risks.',
        'Reference the clarification artifact when available.',
      ]

  return [
    'You are DevFlow Workflow Stage Agent.',
    ...stageInstruction,
    'Return JSON only. The JSON fields must be title, summary, goals, acceptanceCriteria, nonGoals, openQuestions, assumptions, risks.',
    '',
    `Run title: ${input.context.run.title}`,
    `Run request: ${input.context.run.request}`,
    `Branch: ${input.context.run.branchName}`,
    `Current node: ${input.context.node.title} (${input.context.node.stage})`,
    '',
    'Existing artifacts:',
    upstreamArtifacts || '- none',
  ].join('\n')
}

function listSection(title: string, values: string[]): string[] {
  return [
    `## ${title}`,
    ...(values.length ? values.map((value) => `- ${value}`) : ['- None recorded.']),
    '',
  ]
}

function buildArtifactContent(input: {
  run: WorkflowRun
  request: WorkflowArtifactProviderRequest
  output: WorkflowArtifactProviderOutput
  providerId: string
  model: string
  source: WorkflowStageAgentSource
  generatedAt: string
}): string {
  const sourceLabel = input.source === 'model' ? 'model generated' : 'fake/template'
  const redactMarkdown = (markdown: string) => redactSecrets(markdown).value
  if (input.output.content?.trim()) {
    return redactMarkdown([
      `> Source: ${sourceLabel} · Provider: ${input.providerId} · Model: ${input.model} · Generated: ${input.generatedAt}`,
      '',
      input.output.content.trim(),
    ].join('\n'))
  }

  return redactMarkdown([
    `# ${input.output.title || defaultTitleForStage(input.request.stage)}: ${input.run.title}`,
    '',
    `> Source: ${sourceLabel} · Provider: ${input.providerId} · Model: ${input.model} · Generated: ${input.generatedAt}`,
    '',
    `Summary: ${input.output.summary || defaultSummaryForStage({ stage: input.request.stage, run: input.run })}`,
    '',
    ...listSection('Goals', input.output.goals),
    ...listSection('Acceptance Criteria', input.output.acceptanceCriteria),
    ...listSection('Non-goals', input.output.nonGoals),
    ...listSection('Assumptions', input.output.assumptions ?? []),
    ...listSection('Risks', input.output.risks ?? []),
    ...listSection('Open Questions', input.output.openQuestions),
  ].join('\n'))
}

export async function runWorkflowStageAgent(input: RunWorkflowStageAgentInput): Promise<RunWorkflowStageAgentResult> {
  const artifactKind = artifactKindForNode(input.node)
  const stage = input.node.stage as WorkflowArtifactProviderRequest['stage']
  const generatedAt = input.now?.() ?? new Date().toISOString()
  const request: WorkflowArtifactProviderRequest = {
    id: `workflow-stage-request-${input.run.id}-${input.node.id}-${Date.parse(generatedAt)}`,
    runId: input.run.id,
    nodeId: input.node.id,
    projectId: input.run.projectId,
    requestedBy: input.requestedBy,
    runtime: input.runtime,
    stage,
    providerId: input.provider.id,
  }
  const context = buildWorkflowArtifactContext(input)
  const prompt = createWorkflowArtifactPrompt({ request, context })
  if (!input.provider.generateWorkflowArtifact) {
    throw new Error(`Agent provider ${input.provider.id} does not support workflow artifact generation`)
  }

  const output = await input.provider.generateWorkflowArtifact({ request, context, prompt })
  const source: WorkflowStageAgentSource = input.provider.id === 'fake-knowledge-review' ? 'fake_template' : 'model'
  const title = output.title || defaultTitleForStage(stage)
  const summary = output.summary || defaultSummaryForStage({ stage, run: input.run })
  const content = buildArtifactContent({
    run: input.run,
    request,
    output: { ...output, title, summary },
    providerId: input.provider.id,
    model: output.model || input.provider.model,
    source,
    generatedAt,
  })
  const artifact: Artifact = {
    id: `artifact-${input.run.id}-${artifactKind}`,
    runId: input.run.id,
    nodeId: input.node.id,
    kind: artifactKind,
    title,
    summary,
    content,
    redacted: artifactKind === 'design',
    updatedAt: generatedAt,
  }

  return {
    artifact,
    providerId: input.provider.id,
    model: output.model || input.provider.model,
    source,
    prompt,
    completion: JSON.stringify(output),
    ...(output.usage ? { usage: output.usage } : {}),
  }
}
