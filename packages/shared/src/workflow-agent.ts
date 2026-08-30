import {
  estimateAgentTokenUsage,
  type AgentProvider,
  type WorkflowArtifactProviderContext,
  type WorkflowArtifactProviderRequest,
  type WorkflowArtifactProviderOutput,
} from './agent-review'
import {
  createClarificationRevisionDigest,
  listClarificationRevisions,
  sha256Text,
} from './clarification'
import type {
  AgentProviderUsage,
  AgentTokenUsage,
  AgentTrace,
  Artifact,
  ClarificationRepositoryFindings,
  StageAgentCapabilityGrant,
  StageAgentExecutionBounds,
  StageAgentExecutorKind,
  StageAgentExecutorProvenance,
  StageAgentTerminalReason,
  WorkflowNode,
  WorkflowRun,
} from './domain'
import { redactSensitiveText } from './redaction'

export type WorkflowStageAgentSource = 'model' | 'fake_template' | 'local_agent'

export const DEFAULT_STAGE_AGENT_EXECUTION_BOUNDS: StageAgentExecutionBounds = {
  timeoutMs: 120_000,
  maxInputBytes: 96 * 1024,
  maxOutputBytes: 64 * 1024,
  maxToolCalls: 64,
  maxCitations: 64,
}

export const READ_ONLY_STAGE_AGENT_CAPABILITY: StageAgentCapabilityGrant = {
  version: 1,
  profile: 'repository-read-only-v1',
  repositoryRead: true,
  repositoryWrite: false,
  shell: false,
  network: false,
  workflowMutation: false,
  allowedTools: ['read', 'glob', 'grep', 'list'],
}

export type StageAgentExecutorInput = {
  request: WorkflowArtifactProviderRequest
  context: WorkflowArtifactProviderContext
  prompt: string
  capability: StageAgentCapabilityGrant
  bounds: StageAgentExecutionBounds
  signal?: AbortSignal
}

export type StageAgentExecutorOutput = {
  value: WorkflowArtifactProviderOutput
  terminalReason: 'success'
  toolCalls: number
  durationMs?: number
}

export type StageAgentExecutor = {
  kind: StageAgentExecutorKind
  id: string
  version: string
  providerId?: string
  model: string
  execute(input: StageAgentExecutorInput): Promise<StageAgentExecutorOutput>
}

export class StageAgentExecutionError extends Error {
  override readonly name = 'StageAgentExecutionError'

  constructor(
    readonly terminalReason: Exclude<StageAgentTerminalReason, 'success'>,
    message: string,
  ) {
    super(redactSensitiveText(message).value)
  }
}

export type RunWorkflowStageAgentInput = {
  run: WorkflowRun
  node: WorkflowNode
  artifacts: Artifact[]
  provider?: AgentProvider
  executor?: StageAgentExecutor
  requestedBy: string
  runtime: WorkflowArtifactProviderRequest['runtime']
  capability?: StageAgentCapabilityGrant
  bounds?: StageAgentExecutionBounds
  signal?: AbortSignal
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
  trace: AgentTrace
  tokenUsage?: AgentTokenUsage
  provenance: StageAgentExecutorProvenance
  terminalReason: 'success'
}

export function createDirectProviderStageAgentExecutor(provider: AgentProvider): StageAgentExecutor {
  return {
    kind: 'direct-provider',
    id: `direct-provider:${provider.id}`,
    version: '1',
    providerId: provider.id,
    model: provider.model,
    async execute(input) {
      if (!provider.generateWorkflowArtifact) {
        throw new StageAgentExecutionError(
          'cli_unavailable',
          `Agent provider ${provider.id} does not support workflow artifact generation`,
        )
      }
      if (input.signal?.aborted) {
        throw new StageAgentExecutionError('cancelled', 'Workflow stage Agent was cancelled')
      }
      const started = Date.now()
      const value = await provider.generateWorkflowArtifact({
        request: input.request,
        context: input.context,
        prompt: input.prompt,
      })
      return {
        value,
        terminalReason: 'success',
        toolCalls: 0,
        durationMs: Math.max(0, Date.now() - started),
      }
    },
  }
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
  const sanitize = (value: string) => redactSensitiveText(value).value
  return {
    run: {
      id: input.run.id,
      title: sanitize(input.run.title),
      request: sanitize(input.run.request),
      projectId: input.run.projectId,
      status: input.run.status,
      branchName: sanitize(input.run.branchName),
    },
    node: {
      id: input.node.id,
      stage: input.node.stage,
      title: sanitize(input.node.title),
      subtitle: sanitize(input.node.subtitle),
      kind: input.node.kind,
      status: input.node.status,
    },
    artifacts: input.artifacts.map((artifact) => ({
      id: artifact.id,
      kind: artifact.kind,
      title: sanitize(artifact.title),
      summary: sanitize(artifact.summary),
      content: sanitize(artifact.content),
      redacted: artifact.redacted,
      updatedAt: artifact.updatedAt,
      ...(artifact.clarificationRevision
        ? { clarificationRevision: artifact.clarificationRevision }
        : {}),
      ...(artifact.clarificationFeedback
        ? { clarificationFeedback: artifact.clarificationFeedback }
        : {}),
    })),
  }
}

function createWorkflowArtifactPrompt(input: {
  request: WorkflowArtifactProviderRequest
  context: WorkflowArtifactProviderContext
  executorKind: StageAgentExecutorKind
}): string {
  const upstreamArtifacts = input.context.artifacts
    .map((artifact) => `- ${artifact.kind}: ${artifact.title} (${artifact.id})\n  Summary: ${artifact.summary}`)
    .join('\n')
  const previousRevision = [...input.context.artifacts]
    .filter((artifact) => artifact.kind === 'clarification')
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
  const reviewerFeedback = input.context.artifacts
    .filter((artifact) => artifact.kind === 'clarification_feedback')
    .map((artifact) => `- ${artifact.content}`)
    .join('\n')
  const stageInstruction = input.request.stage === 'clarify'
    ? [
        'Generate a requirements clarification artifact.',
        'Separate verified facts, assumptions, open questions, acceptance criteria, and non-goals.',
        'Do not design implementation details, modify the repository, or advance a Workflow/Gate.',
      ]
    : [
        'Generate a design artifact based on the clarified request.',
        'Focus on implementation approach, testing strategy, rollout considerations, and remaining risks.',
        'Reference the clarification artifact when available.',
      ]
  const repositoryInstruction = input.executorKind === 'local-agent'
    ? [
        'Inspect the repository only through the granted read/glob/grep/list capabilities.',
        'Every verified fact must reference at least one repo-relative citation ID.',
        'Never return source bodies, absolute paths, secrets, commands, Gate actions, or write requests.',
        'repositoryFindings must contain version, repositoryDigest, verifiedFacts, citations, assumptions, openQuestions, and uncheckedScopes.',
      ]
    : [
        'Repository inspection is not available in this executor. Do not claim repository facts as verified.',
      ]

  return [
    'You are DevFlow Workflow Stage Agent. Workflow remains the sole authority.',
    ...stageInstruction,
    ...repositoryInstruction,
    'Return JSON only. Required fields: title, summary, goals, acceptanceCriteria, nonGoals, openQuestions, assumptions, risks.',
    '',
    'RAW_REQUEST',
    input.context.run.request,
    '',
    `Run title: ${input.context.run.title}`,
    `Branch: ${input.context.run.branchName}`,
    `Current node: ${input.context.node.title} (${input.context.node.stage})`,
    '',
    'EXISTING_ARTIFACTS',
    upstreamArtifacts || '- none',
    '',
    'PREVIOUS_CLARIFICATION_REVISION',
    previousRevision?.content ?? '- none',
    '',
    'REVIEWER_FEEDBACK',
    reviewerFeedback || '- none',
  ].join('\n')
}

function listSection(title: string, values: string[]): string[] {
  return [
    `## ${title}`,
    ...(values.length ? values.map((value) => `- ${value}`) : ['- None recorded.']),
    '',
  ]
}

function findingsSections(findings: ClarificationRepositoryFindings | undefined): string[] {
  if (!findings) {
    return [
      '## Repository Findings',
      '- Repository verification was not performed by this executor.',
      '',
    ]
  }
  const citations = new Map(findings.citations.map((citation) => [citation.id, citation]))
  return [
    '## Repository Findings',
    ...findings.verifiedFacts.map((fact) => {
      const refs = fact.citationIds
        .map((id) => citations.get(id))
        .filter((citation): citation is NonNullable<typeof citation> => Boolean(citation))
        .map((citation) => `${citation.path}#${citation.contentDigest}`)
      return `- ${fact.statement} [${refs.join(', ')}]`
    }),
    '',
    ...listSection('Repository Assumptions', findings.assumptions),
    ...listSection('Repository Open Questions', findings.openQuestions),
    ...listSection('Unchecked Repository Scope', findings.uncheckedScopes),
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
  const sourceLabel = input.source === 'model'
    ? 'model generated'
    : input.source === 'local_agent'
      ? 'read-only local Agent'
      : 'fake/template'
  if (input.request.stage === 'design' && input.output.content?.trim()) {
    return redactSensitiveText([
      `> Source: ${sourceLabel} · Provider: ${input.providerId} · Model: ${input.model} · Generated: ${input.generatedAt}`,
      '',
      input.output.content.trim(),
    ].join('\n')).value
  }

  return redactSensitiveText([
    `# ${input.output.title || defaultTitleForStage(input.request.stage)}: ${input.run.title}`,
    '',
    `> Source: ${sourceLabel} · Provider: ${input.providerId} · Model: ${input.model} · Generated: ${input.generatedAt}`,
    '',
    `Summary: ${input.output.summary || defaultSummaryForStage({ stage: input.request.stage, run: input.run })}`,
    '',
    ...listSection('Goals', input.output.goals),
    ...listSection('Acceptance Criteria', input.output.acceptanceCriteria),
    ...listSection('Non-goals', input.output.nonGoals),
    ...findingsSections(input.output.repositoryFindings),
    ...listSection('Assumptions', input.output.assumptions ?? []),
    ...listSection('Risks', input.output.risks ?? []),
    ...listSection('Open Questions', input.output.openQuestions),
  ].join('\n')).value
}

function encodedBytes(value: unknown): number {
  return new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).byteLength
}

function safeString(value: unknown, label: string, maxLength: number, required = true): string {
  if (typeof value !== 'string') {
    throw new StageAgentExecutionError('schema_invalid', `${label} must be a string`)
  }
  const sanitized = redactSensitiveText(value.trim()).value
  if ((required && !sanitized) || sanitized.length > maxLength) {
    throw new StageAgentExecutionError('schema_invalid', `${label} is outside the allowed length`)
  }
  return sanitized
}

function safeStringList(
  value: unknown,
  label: string,
  options: { required?: boolean; maxItems?: number } = {},
): string[] {
  if (!Array.isArray(value)) {
    throw new StageAgentExecutionError('schema_invalid', `${label} must be an array`)
  }
  const maxItems = options.maxItems ?? 32
  if (value.length > maxItems || (options.required && value.length === 0)) {
    throw new StageAgentExecutionError('schema_invalid', `${label} has an invalid item count`)
  }
  return value.map((item, index) => safeString(item, `${label}[${index}]`, 2_000))
}

function validateRepositoryFindings(
  value: ClarificationRepositoryFindings | undefined,
  bounds: StageAgentExecutionBounds,
): ClarificationRepositoryFindings | undefined {
  if (!value) return undefined
  if (value.version !== 1 || !/^[a-f0-9]{64}$/u.test(value.repositoryDigest)) {
    throw new StageAgentExecutionError('evidence_invalid', 'Repository findings digest is invalid')
  }
  if (!Array.isArray(value.citations) || value.citations.length === 0 || value.citations.length > bounds.maxCitations) {
    throw new StageAgentExecutionError('evidence_invalid', 'Repository findings citations are missing or exceed the limit')
  }
  const citations = value.citations.map((citation, index) => {
    const citationPath = safeString(citation.path, `repositoryFindings.citations[${index}].path`, 1_024)
    if (
      citationPath.startsWith('/') ||
      citationPath.includes('\\') ||
      citationPath.split('/').some((segment) => segment === '..' || segment === '') ||
      !/^[a-f0-9]{64}$/u.test(citation.contentDigest)
    ) {
      throw new StageAgentExecutionError('evidence_invalid', 'Repository citation is not repo-relative or has an invalid digest')
    }
    if (
      citation.lineStart !== undefined &&
      (!Number.isSafeInteger(citation.lineStart) || citation.lineStart < 1)
    ) {
      throw new StageAgentExecutionError('evidence_invalid', 'Repository citation lineStart is invalid')
    }
    if (
      citation.lineEnd !== undefined &&
      (!Number.isSafeInteger(citation.lineEnd) || citation.lineEnd < (citation.lineStart ?? 1))
    ) {
      throw new StageAgentExecutionError('evidence_invalid', 'Repository citation lineEnd is invalid')
    }
    return {
      id: safeString(citation.id, `repositoryFindings.citations[${index}].id`, 256),
      path: citationPath,
      contentDigest: citation.contentDigest,
      ...(citation.lineStart === undefined ? {} : { lineStart: citation.lineStart }),
      ...(citation.lineEnd === undefined ? {} : { lineEnd: citation.lineEnd }),
    }
  })
  const citationIds = new Set(citations.map((citation) => citation.id))
  if (citationIds.size !== citations.length) {
    throw new StageAgentExecutionError('evidence_invalid', 'Repository citation IDs must be unique')
  }
  if (!Array.isArray(value.verifiedFacts) || value.verifiedFacts.length === 0 || value.verifiedFacts.length > 64) {
    throw new StageAgentExecutionError('evidence_invalid', 'At least one bounded verified repository fact is required')
  }
  const verifiedFacts = value.verifiedFacts.map((fact, index) => {
    const factCitationIds = safeStringList(
      fact.citationIds,
      `repositoryFindings.verifiedFacts[${index}].citationIds`,
      { required: true, maxItems: 16 },
    )
    if (factCitationIds.some((id) => !citationIds.has(id))) {
      throw new StageAgentExecutionError('evidence_invalid', 'Verified repository fact references an unknown citation')
    }
    return {
      id: safeString(fact.id, `repositoryFindings.verifiedFacts[${index}].id`, 256),
      statement: safeString(fact.statement, `repositoryFindings.verifiedFacts[${index}].statement`, 2_000),
      citationIds: factCitationIds,
    }
  })
  return {
    version: 1,
    repositoryDigest: value.repositoryDigest,
    verifiedFacts,
    citations,
    assumptions: safeStringList(value.assumptions, 'repositoryFindings.assumptions'),
    openQuestions: safeStringList(value.openQuestions, 'repositoryFindings.openQuestions'),
    uncheckedScopes: safeStringList(value.uncheckedScopes, 'repositoryFindings.uncheckedScopes'),
  }
}

function validateExecutorOutput(input: {
  output: WorkflowArtifactProviderOutput
  executorKind: StageAgentExecutorKind
  stage: WorkflowArtifactProviderRequest['stage']
  bounds: StageAgentExecutionBounds
  toolCalls: number
}): WorkflowArtifactProviderOutput {
  if (!Number.isSafeInteger(input.toolCalls) || input.toolCalls < 0 || input.toolCalls > input.bounds.maxToolCalls) {
    throw new StageAgentExecutionError('tool_limit', 'Stage Agent tool-call limit was exceeded')
  }
  if (encodedBytes(input.output) > input.bounds.maxOutputBytes) {
    throw new StageAgentExecutionError('output_limit', 'Stage Agent structured output exceeds the configured limit')
  }
  const repositoryFindings = validateRepositoryFindings(input.output.repositoryFindings, input.bounds)
  if (input.executorKind === 'local-agent' && input.stage === 'clarify' && !repositoryFindings) {
    throw new StageAgentExecutionError('evidence_invalid', 'Read-only local Agent returned no repository citations')
  }
  if (input.executorKind === 'local-agent' && input.stage !== 'clarify') {
    throw new StageAgentExecutionError('permission_denied', 'Local stage Agent is currently authorized only for clarification')
  }
  return {
    model: safeString(input.output.model, 'model', 256),
    title: safeString(input.output.title ?? defaultTitleForStage(input.stage), 'title', 256),
    summary: safeString(input.output.summary, 'summary', 4_000),
    ...(input.output.content === undefined
      ? {}
      : { content: safeString(input.output.content, 'content', input.bounds.maxOutputBytes, false) }),
    goals: safeStringList(input.output.goals, 'goals', { required: true }),
    acceptanceCriteria: safeStringList(input.output.acceptanceCriteria, 'acceptanceCriteria', { required: true }),
    nonGoals: safeStringList(input.output.nonGoals, 'nonGoals', { required: true }),
    openQuestions: safeStringList(input.output.openQuestions, 'openQuestions'),
    assumptions: safeStringList(input.output.assumptions ?? [], 'assumptions'),
    risks: safeStringList(input.output.risks ?? [], 'risks'),
    ...(repositoryFindings ? { repositoryFindings } : {}),
    ...(input.output.usage ? { usage: input.output.usage } : {}),
  }
}

function tokenProvider(executor: StageAgentExecutor): AgentTokenUsage['provider'] {
  if (executor.kind === 'local-agent') return 'local'
  const id = (executor.providerId ?? executor.id).toLowerCase()
  if (id.includes('anthropic')) return 'anthropic'
  if (id.includes('dash') || id.includes('doubao') || id.includes('ark')) return 'dashscope'
  return 'openai'
}

export async function runWorkflowStageAgent(input: RunWorkflowStageAgentInput): Promise<RunWorkflowStageAgentResult> {
  if (input.provider && input.executor) {
    throw new Error('Choose exactly one workflow stage Agent executor')
  }
  const executor = input.executor ?? (input.provider ? createDirectProviderStageAgentExecutor(input.provider) : undefined)
  if (!executor) throw new Error('Workflow stage Agent executor is not configured')
  const artifactKind = artifactKindForNode(input.node)
  const stage = input.node.stage as WorkflowArtifactProviderRequest['stage']
  const generatedAt = input.now?.() ?? new Date().toISOString()
  const bounds = input.bounds ?? DEFAULT_STAGE_AGENT_EXECUTION_BOUNDS
  const capability = input.capability ?? READ_ONLY_STAGE_AGENT_CAPABILITY
  const request: WorkflowArtifactProviderRequest = {
    id: `workflow-stage-request-${input.run.id}-${input.node.id}-${Date.parse(generatedAt)}`,
    runId: input.run.id,
    nodeId: input.node.id,
    projectId: input.run.projectId,
    requestedBy: input.requestedBy,
    runtime: input.runtime,
    stage,
    providerId: executor.providerId ?? executor.id,
  }
  const context = buildWorkflowArtifactContext(input)
  const prompt = createWorkflowArtifactPrompt({ request, context, executorKind: executor.kind })
  if (encodedBytes({ request, context, prompt }) > bounds.maxInputBytes) {
    throw new StageAgentExecutionError('input_limit', 'Workflow stage Agent input exceeds the configured context limit')
  }
  if (input.signal?.aborted) {
    throw new StageAgentExecutionError('cancelled', 'Workflow stage Agent was cancelled')
  }

  const started = Date.now()
  const executionController = new AbortController()
  let timedOut = false
  const cancelExecution = () => executionController.abort()
  input.signal?.addEventListener('abort', cancelExecution, { once: true })
  const timeout = setTimeout(() => {
    timedOut = true
    executionController.abort()
  }, bounds.timeoutMs)
  const aborted = new Promise<never>((_resolve, reject) => {
    executionController.signal.addEventListener('abort', () => reject(new StageAgentExecutionError(
      timedOut ? 'timeout' : 'cancelled',
      timedOut ? 'Workflow stage Agent timed out' : 'Workflow stage Agent was cancelled',
    )), { once: true })
  })
  let execution: StageAgentExecutorOutput
  try {
    execution = await Promise.race([
      executor.execute({
        request,
        context,
        prompt,
        capability,
        bounds,
        signal: executionController.signal,
      }),
      aborted,
    ])
  } finally {
    clearTimeout(timeout)
    input.signal?.removeEventListener('abort', cancelExecution)
  }
  const output = validateExecutorOutput({
    output: execution.value,
    executorKind: executor.kind,
    stage,
    bounds,
    toolCalls: execution.toolCalls,
  })
  const providerId = executor.providerId ?? executor.id
  const model = output.model || executor.model
  const source: WorkflowStageAgentSource = executor.kind === 'local-agent'
    ? 'local_agent'
    : providerId === 'fake-knowledge-review'
      ? 'fake_template'
      : 'model'
  const title = output.title || defaultTitleForStage(stage)
  const summary = output.summary || defaultSummaryForStage({ stage, run: input.run })
  const content = buildArtifactContent({
    run: input.run,
    request,
    output: { ...output, title, summary },
    providerId,
    model,
    source,
    generatedAt,
  })
  const contextDigest = await sha256Text(prompt)
  const provenance: StageAgentExecutorProvenance = {
    version: 1,
    kind: executor.kind,
    executorId: executor.id,
    executorVersion: executor.version,
    capabilityProfile: capability.profile,
    ...(executor.providerId ? { providerId: executor.providerId } : {}),
    model,
    startedAt: generatedAt,
    completedAt: generatedAt,
    durationMs: execution.durationMs ?? Math.max(0, Date.now() - started),
    terminalReason: 'success',
    contextDigest,
  }

  let clarificationRevision: Artifact['clarificationRevision']
  let artifactId = `artifact-${input.run.id}-${artifactKind}`
  if (artifactKind === 'clarification') {
    const rawRequests = input.artifacts.filter((artifact) => artifact.kind === 'raw_request' && artifact.runId === input.run.id)
    if (rawRequests.length !== 1) {
      throw new StageAgentExecutionError('schema_invalid', 'Clarification requires exactly one immutable Raw Request artifact')
    }
    const previous = listClarificationRevisions(input.run.id, input.artifacts).at(-1)
    const revision = previous ? (previous.clarificationRevision?.revision ?? 1) + 1 : 1
    artifactId = revision === 1
      ? `artifact-${input.run.id}-clarification`
      : `artifact-${input.run.id}-clarification-v${revision}`
    const feedbackArtifactIds = previous?.clarificationRevision?.feedbackArtifactIds ?? []
    const revisionDigest = await createClarificationRevisionDigest({
      title,
      summary,
      goals: output.goals,
      acceptanceCriteria: output.acceptanceCriteria,
      nonGoals: output.nonGoals,
      assumptions: output.assumptions ?? [],
      risks: output.risks ?? [],
      openQuestions: output.openQuestions,
      ...(output.repositoryFindings ? { repositoryFindings: output.repositoryFindings } : {}),
    })
    clarificationRevision = {
      version: 1,
      revision,
      status: 'review_requested',
      revisionDigest,
      rawRequestArtifactId: rawRequests[0]!.id,
      ...(previous ? { previousRevisionArtifactId: previous.id } : {}),
      feedbackArtifactIds,
      goals: output.goals,
      acceptanceCriteria: output.acceptanceCriteria,
      nonGoals: output.nonGoals,
      assumptions: output.assumptions ?? [],
      risks: output.risks ?? [],
      openQuestions: output.openQuestions,
      ...(output.repositoryFindings ? { repositoryFindings: output.repositoryFindings } : {}),
      executor: provenance,
      generatedAt,
    }
  }
  const artifact: Artifact = {
    id: artifactId,
    runId: input.run.id,
    nodeId: input.node.id,
    kind: artifactKind,
    title,
    summary,
    content,
    redacted: artifactKind === 'design' || source === 'local_agent',
    updatedAt: generatedAt,
    ...(clarificationRevision ? { clarificationRevision } : {}),
  }
  const completion = JSON.stringify(output)
  const trace: AgentTrace = {
    id: `agent-trace-${artifact.id}`,
    runId: input.run.id,
    nodeId: input.node.id,
    reviewId: artifact.id,
    runtime: input.runtime,
    createdAt: generatedAt,
    executorProvenance: provenance,
    terminalReason: 'success',
    steps: [
      {
        id: `agent-trace-${artifact.id}-context`,
        kind: 'context',
        label: 'Bind stage context',
        summary: `${encodedBytes({ request, context })} bounded bytes; ${context.artifacts.length} immutable context artifact(s).`,
        timestamp: generatedAt,
      },
      {
        id: `agent-trace-${artifact.id}-executor`,
        kind: 'provider_call',
        label: `Run ${executor.kind}`,
        summary: `${executor.id}@${executor.version}; capability=${capability.profile}; toolCalls=${execution.toolCalls}; terminal=success.`,
        timestamp: generatedAt,
      },
      {
        id: `agent-trace-${artifact.id}-validation`,
        kind: 'artifact',
        label: 'Validate structured output and repository evidence',
        summary: output.repositoryFindings
          ? `${output.repositoryFindings.verifiedFacts.length} verified fact(s), ${output.repositoryFindings.citations.length} validated citation(s).`
          : 'Structured output valid; repository verification unavailable for this executor.',
        timestamp: generatedAt,
      },
      {
        id: `agent-trace-${artifact.id}-artifact`,
        kind: 'artifact',
        label: 'Create immutable stage Artifact',
        summary: `${artifact.id}; contextDigest=${contextDigest}; revision=${clarificationRevision?.revision ?? 'n/a'}.`,
        timestamp: generatedAt,
      },
    ],
  }
  const tokenUsage = executor.kind === 'local-agent'
    ? undefined
    : estimateAgentTokenUsage({
        id: `agent-token-usage-${artifact.id}`,
        runId: input.run.id,
        nodeId: input.node.id,
        userId: input.requestedBy,
        projectId: input.run.projectId,
        provider: tokenProvider(executor),
        model,
        prompt,
        completion,
        timestamp: generatedAt,
        ...(output.usage ? { providerUsage: output.usage } : {}),
      })

  return {
    artifact,
    providerId,
    model,
    source,
    prompt,
    completion,
    ...(output.usage ? { usage: output.usage } : {}),
    trace,
    ...(tokenUsage ? { tokenUsage } : {}),
    provenance,
    terminalReason: 'success',
  }
}
