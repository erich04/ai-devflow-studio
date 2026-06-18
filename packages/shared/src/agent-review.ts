import type {
  AgentEvent,
  AgentPolicyFinding,
  AgentProviderUsage,
  AgentReviewArtifact,
  AgentReviewContext,
  AgentReviewExecutionResult,
  AgentReviewRequest,
  AgentReviewResult,
  AgentReviewRuntime,
  AgentTrace,
  AgentTraceStep,
  AgentTokenUsage,
  Artifact,
  GateAdvisory,
  KnowledgeChunk,
  KnowledgeDocument,
  TestEvidence,
  WorkflowNode,
  WorkflowRun,
} from './domain'
import { buildKnowledgeReferences } from './knowledge'
import { redactSecrets } from './redaction'

export type KnowledgeReviewProviderInput = {
  request: AgentReviewRequest
  context: AgentReviewContext
  prompt: string
}

export type KnowledgeReviewProviderOutput = {
  model: string
  conclusion: string
  summary: string
  risks: string[]
  missingEvidence: string[]
  suggestedTests: string[]
  confidence: number
  usage?: AgentProviderUsage
  policyFindings?: Array<
    Pick<AgentPolicyFinding, 'category' | 'severity' | 'summary'> & {
      evidenceIds?: string[]
      knowledgeReferenceIds?: string[]
    }
  >
}

export type AgentProvider = {
  id: string
  name: string
  model: string
  reviewKnowledge: (input: KnowledgeReviewProviderInput) => Promise<KnowledgeReviewProviderOutput>
}

export type BuildAgentReviewContextInput = {
  run: WorkflowRun
  node: WorkflowNode
  artifacts: Artifact[]
  testEvidence: TestEvidence[]
  knowledgeDocuments: KnowledgeDocument[]
  knowledgeChunks: KnowledgeChunk[]
}

export type RunKnowledgeReviewAgentInput = {
  request: AgentReviewRequest
  context: AgentReviewContext
  provider: AgentProvider
  now?: () => string
}

export type EstimateAgentTokenUsageInput = {
  id: string
  runId: string
  nodeId: string
  userId: string
  projectId: string
  provider: AgentTokenUsage['provider']
  model: string
  prompt: string
  completion: string
  timestamp: string
  providerUsage?: AgentProviderUsage
}

const MODEL_PRICES_PER_1K: Record<string, { input: number; output: number }> = {
  'gpt-4.1-mini': { input: 0.0004, output: 0.0016 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  fake: { input: 0, output: 0 },
}

function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4))
}

function jsonSize(value: unknown): number {
  return JSON.stringify(value).length
}

function createId(prefix: string, seed: string): string {
  return `${prefix}-${seed.replace(/[^a-zA-Z0-9_-]+/gu, '-').replace(/^-|-$/gu, '')}`
}

function readableReferenceList(context: AgentReviewContext): string {
  return context.knowledgeReferences
    .slice(0, 5)
    .map((reference) => `${reference.relation}:${reference.documentId}`)
    .join(', ')
}

function redactedSummary(value: string): string {
  return redactSecrets(value).value
}

function toProviderName(providerId: string): AgentTokenUsage['provider'] {
  if (providerId.includes('anthropic')) {
    return 'anthropic'
  }
  if (providerId.includes('dashscope')) {
    return 'dashscope'
  }
  if (providerId.includes('fake')) {
    return 'local'
  }

  return 'openai'
}

export function buildAgentReviewContext({
  run,
  node,
  artifacts,
  testEvidence,
  knowledgeDocuments,
  knowledgeChunks,
}: BuildAgentReviewContextInput): AgentReviewContext {
  const runArtifacts = artifacts.filter((artifact) => artifact.runId === run.id)
  const relevantArtifactIds = new Set(node.artifactIds)
  const selectedArtifacts = runArtifacts.filter(
    (artifact) => relevantArtifactIds.has(artifact.id) || artifact.nodeId === node.id,
  )
  const references = buildKnowledgeReferences({
    run,
    artifacts: runArtifacts,
    documents: knowledgeDocuments,
    chunks: knowledgeChunks,
    testEvidence,
  })
  const referencedChunkIds = new Set(references.flatMap((reference) => reference.chunkId ?? []))

  return {
    run: {
      id: run.id,
      title: run.title,
      request: redactedSummary(run.request),
      projectId: run.projectId,
      status: run.status,
      branchName: run.branchName,
    },
    node: {
      id: node.id,
      stage: node.stage,
      title: node.title,
      subtitle: node.subtitle,
      kind: node.kind,
      status: node.status,
    },
    artifacts: selectedArtifacts.map((artifact) => ({
      id: artifact.id,
      kind: artifact.kind,
      title: artifact.title,
      summary: redactedSummary(artifact.summary),
      content: redactedSummary(artifact.content),
      redacted: artifact.redacted || redactSecrets(`${artifact.summary}\n${artifact.content}`).redacted,
    })),
    testEvidence: testEvidence
      .filter((evidence) => evidence.runId === run.id)
      .map((evidence) => ({
        id: evidence.id,
        command: evidence.command,
        status: evidence.status,
        exitCode: evidence.exitCode,
        durationMs: evidence.durationMs,
        summary: redactedSummary(evidence.summary),
        redacted: true,
      })),
    knowledgeReferences: references,
    knowledgeChunks: knowledgeChunks
      .filter((chunk) => referencedChunkIds.has(chunk.id))
      .slice(0, 8)
      .map((chunk) => ({
        id: chunk.id,
        documentId: chunk.documentId,
        sourcePath: chunk.sourcePath,
        headingPath: chunk.headingPath,
        contentHash: chunk.contentHash,
        content: chunk.content,
      })),
  }
}

export function createKnowledgeReviewPrompt(context: AgentReviewContext): string {
  return [
    'You are DevFlow Knowledge Review Agent.',
    'Review the selected workflow node using only the provided redacted context.',
    'Return structured review JSON with conclusion, risks, missingEvidence, suggestedTests, confidence.',
    `Run: ${context.run.title}`,
    `Node: ${context.node.title} (${context.node.stage})`,
    `Artifacts: ${context.artifacts.map((artifact) => `${artifact.kind}:${artifact.summary}`).join(' | ')}`,
    `Evidence: ${context.testEvidence.map((evidence) => `${evidence.status}:${evidence.summary}`).join(' | ')}`,
    `Knowledge: ${context.knowledgeChunks
      .map((chunk) => `${chunk.sourcePath}#${chunk.headingPath.join('/')} ${chunk.content}`)
      .join(' | ')}`,
  ].join('\n')
}

export function createFakeAgentProvider(): AgentProvider {
  return {
    id: 'fake-knowledge-review',
    name: 'Deterministic Fake Provider',
    model: 'fake',
    async reviewKnowledge(input) {
      const hasEvidence = input.context.testEvidence.some((evidence) => evidence.status === 'passed')
      const missingEvidence = hasEvidence ? [] : ['Attach passing local test evidence before final approval.']
      const risks = input.context.knowledgeReferences.some((reference) => reference.relation === 'requires_evidence')
        ? ['Gate requires reviewer evidence before moving to implementation.']
        : []

      return {
        model: 'fake',
        conclusion: `Knowledge Review ready for ${input.context.node.title}.`,
        summary: `Reviewed ${input.context.knowledgeReferences.length} knowledge references: ${readableReferenceList(input.context)}.`,
        risks,
        missingEvidence,
        suggestedTests: ['Run the local test command and archive redacted evidence.'],
        confidence: 0.82,
        usage: {
          inputTokens: estimateTokens(input.prompt),
          outputTokens: 72,
          cacheReadTokens: 0,
        },
      }
    },
  }
}

export function estimateAgentTokenUsage(input: EstimateAgentTokenUsageInput): AgentTokenUsage {
  const source = input.providerUsage ? 'provider_reported' : 'estimated'
  const inputTokens = input.providerUsage?.inputTokens ?? estimateTokens(input.prompt)
  const outputTokens = input.providerUsage?.outputTokens ?? estimateTokens(input.completion)
  const cacheReadTokens = input.providerUsage?.cacheReadTokens ?? 0
  const price = MODEL_PRICES_PER_1K[input.model] ?? MODEL_PRICES_PER_1K['gpt-4.1-mini']!
  const costUsd = (inputTokens / 1000) * price.input + (outputTokens / 1000) * price.output

  return {
    id: input.id,
    runId: input.runId,
    nodeId: input.nodeId,
    userId: input.userId,
    projectId: input.projectId,
    provider: input.provider,
    model: input.model,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    costUsd,
    timestamp: input.timestamp,
    source,
  }
}

function createTraceStep(
  reviewId: string,
  index: number,
  kind: AgentTraceStep['kind'],
  label: string,
  summary: string,
  timestamp: string,
): AgentTraceStep {
  return {
    id: `${reviewId}-trace-step-${index}`,
    kind,
    label,
    summary,
    timestamp,
  }
}

function createGateAdvisory(
  reviewId: string,
  request: AgentReviewRequest,
  output: KnowledgeReviewProviderOutput,
  createdAt: string,
): GateAdvisory {
  return {
    id: createId('gate-advisory', reviewId),
    runId: request.runId,
    nodeId: request.nodeId,
    level: output.risks.length > 0 || output.missingEvidence.length > 0 ? 'warn' : 'info',
    blocksApproval: false,
    summary:
      output.missingEvidence.length > 0
        ? `${output.missingEvidence.length} evidence gap(s) need reviewer attention.`
        : 'No blocking knowledge gaps found by the review agent.',
    missingEvidence: output.missingEvidence,
    riskCount: output.risks.length,
    createdAt,
  }
}

function createPolicyFinding(
  reviewId: string,
  request: AgentReviewRequest,
  index: number,
  input: Pick<AgentPolicyFinding, 'category' | 'severity' | 'summary'> & {
    evidenceIds?: string[]
    knowledgeReferenceIds?: string[]
  },
  createdAt: string,
): AgentPolicyFinding {
  return {
    id: createId('agent-policy-finding', `${reviewId}-${index}-${input.category}-${input.severity}`),
    reviewId,
    runId: request.runId,
    nodeId: request.nodeId,
    category: input.category,
    severity: input.severity,
    summary: redactedSummary(input.summary),
    evidenceIds: input.evidenceIds ?? [],
    knowledgeReferenceIds: input.knowledgeReferenceIds ?? [],
    createdAt,
  }
}

function derivePolicyFindings(
  reviewId: string,
  request: AgentReviewRequest,
  context: AgentReviewContext,
  output: KnowledgeReviewProviderOutput,
  createdAt: string,
): AgentPolicyFinding[] {
  const providerFindings = output.policyFindings ?? []
  const derivedFindings: Array<
    Pick<AgentPolicyFinding, 'category' | 'severity' | 'summary'> & {
      evidenceIds?: string[]
      knowledgeReferenceIds?: string[]
    }
  > = []

  for (const missing of output.missingEvidence) {
    derivedFindings.push({
      category: 'missing_evidence',
      severity: 'medium',
      summary: missing,
      knowledgeReferenceIds: context.knowledgeReferences.map((reference) => reference.id),
    })
  }

  for (const evidence of context.testEvidence) {
    if (evidence.status === 'failed' || evidence.status === 'timed_out') {
      derivedFindings.push({
        category: 'test_risk',
        severity: 'high',
        summary: `Test evidence ${evidence.id} is ${evidence.status}: ${evidence.summary}`,
        evidenceIds: [evidence.id],
      })
    }
  }

  for (const risk of output.risks) {
    if (risk.toLocaleLowerCase().includes('api')) {
      derivedFindings.push({
        category: 'api_contract_risk',
        severity: 'high',
        summary: risk,
        knowledgeReferenceIds: context.knowledgeReferences.map((reference) => reference.id),
      })
    }
  }

  const allFindings = providerFindings.length > 0 ? providerFindings : derivedFindings

  if (allFindings.length === 0) {
    return [
      createPolicyFinding(
        reviewId,
        request,
        1,
        {
          category: 'review_gap',
          severity: 'low',
          summary: 'No blocking policy finding was produced by the review.',
        },
        createdAt,
      ),
    ]
  }

  return allFindings.map((finding, index) =>
    createPolicyFinding(reviewId, request, index + 1, finding, createdAt),
  )
}

export async function runKnowledgeReviewAgent({
  request,
  context,
  provider,
  now = () => new Date().toISOString(),
}: RunKnowledgeReviewAgentInput): Promise<AgentReviewExecutionResult> {
  const createdAt = now()
  const reviewId = createId('agent-review', `${request.id}-${request.runtime}`)
  const prompt = createKnowledgeReviewPrompt(context)
  const providerOutput = await provider.reviewKnowledge({ request, context, prompt })
  const completion = JSON.stringify(providerOutput)
  const gateAdvisory = createGateAdvisory(reviewId, request, providerOutput, createdAt)
  const policyFindings = derivePolicyFindings(reviewId, request, context, providerOutput, createdAt)
  const review: AgentReviewResult = {
    id: reviewId,
    requestId: request.id,
    runId: request.runId,
    nodeId: request.nodeId,
    projectId: request.projectId,
    runtime: request.runtime,
    providerId: provider.id,
    model: providerOutput.model,
    conclusion: providerOutput.conclusion,
    summary: providerOutput.summary,
    risks: providerOutput.risks,
    missingEvidence: providerOutput.missingEvidence,
    suggestedTests: providerOutput.suggestedTests,
    knowledgeReferences: context.knowledgeReferences,
    policyFindings,
    confidence: providerOutput.confidence,
    gateAdvisory,
    createdAt,
  }
  const trace: AgentTrace = {
    id: createId('agent-trace', reviewId),
    runId: request.runId,
    nodeId: request.nodeId,
    reviewId,
    runtime: request.runtime,
    createdAt,
    steps: [
      createTraceStep(
        reviewId,
        1,
        'context',
        'Build redacted context',
        `${jsonSize(context)} bytes prepared for ${request.runtime}.`,
        createdAt,
      ),
      createTraceStep(
        reviewId,
        2,
        'retrieval',
        'Attach knowledge references',
        `${context.knowledgeReferences.length} knowledge reference(s) attached.`,
        createdAt,
      ),
      createTraceStep(
        reviewId,
        3,
        'provider_call',
        `Call ${provider.name}`,
        `${providerOutput.model} returned structured review output.`,
        createdAt,
      ),
      createTraceStep(
        reviewId,
        4,
        'artifact',
        'Create review artifact',
        gateAdvisory.summary,
        createdAt,
      ),
    ],
  }
  const tokenUsage = estimateAgentTokenUsage({
    id: createId('agent-token-usage', reviewId),
    runId: request.runId,
    nodeId: request.nodeId,
    userId: request.requestedBy,
    projectId: request.projectId,
    provider: toProviderName(provider.id),
    model: providerOutput.model,
    prompt,
    completion,
    timestamp: createdAt,
    ...(providerOutput.usage ? { providerUsage: providerOutput.usage } : {}),
  })

  return { review, trace, tokenUsage }
}

export function createAgentReviewArtifacts(result: AgentReviewExecutionResult): {
  artifact: AgentReviewArtifact
  event: AgentEvent
  gateAdvisory: GateAdvisory
} {
  const artifact: AgentReviewArtifact = {
    id: `artifact-${result.review.id}`,
    runId: result.review.runId,
    nodeId: result.review.nodeId,
    kind: 'agent_review',
    title: 'Knowledge Review Agent report',
    summary: result.review.summary,
    content: [
      result.review.conclusion,
      '',
      'Risks:',
      ...(result.review.risks.length > 0 ? result.review.risks : ['No major risk found.']),
      '',
      'Missing evidence:',
      ...(result.review.missingEvidence.length > 0
        ? result.review.missingEvidence
        : ['No missing evidence found.']),
      '',
      'Suggested tests:',
      ...result.review.suggestedTests,
      '',
      'Policy findings:',
      ...result.review.policyFindings.map((finding) => {
        return `${finding.severity} ${finding.category}: ${finding.summary}`
      }),
    ].join('\n'),
    redacted: true,
    updatedAt: result.review.createdAt,
  }
  const event: AgentEvent = {
    id: `event-${result.review.id}`,
    runId: result.review.runId,
    nodeId: result.review.nodeId,
    sequence: 1,
    kind: 'agent_review',
    message: result.review.summary,
    timestamp: result.review.createdAt,
  }

  return { artifact, event, gateAdvisory: result.review.gateAdvisory }
}

export function createOpenAiCompatibleAgentProvider({
  id = 'openai-compatible',
  name = 'OpenAI Compatible',
  model,
  apiKey,
  baseUrl = 'https://api.openai.com/v1',
  fetcher = fetch,
}: {
  id?: string
  name?: string
  model: string
  apiKey: string
  baseUrl?: string
  fetcher?: typeof fetch
}): AgentProvider {
  return {
    id,
    name,
    model,
    async reviewKnowledge({ prompt }) {
      const response = await fetcher(`${baseUrl.replace(/\/$/u, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                'Return JSON with conclusion, summary, risks, missingEvidence, suggestedTests, confidence.',
            },
            { role: 'user', content: prompt },
          ],
        }),
      })

      if (!response.ok) {
        throw new Error(`Agent provider failed with ${response.status}`)
      }

      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>
        usage?: { prompt_tokens?: number; completion_tokens?: number; cached_tokens?: number }
      }
      const raw = body.choices?.[0]?.message?.content
      if (!raw) {
        throw new Error('Agent provider returned empty review output')
      }
      const parsed = JSON.parse(raw) as Partial<KnowledgeReviewProviderOutput>
      const usage = body.usage
        ? {
            ...(typeof body.usage.prompt_tokens === 'number' ? { inputTokens: body.usage.prompt_tokens } : {}),
            ...(typeof body.usage.completion_tokens === 'number'
              ? { outputTokens: body.usage.completion_tokens }
              : {}),
            ...(typeof body.usage.cached_tokens === 'number' ? { cacheReadTokens: body.usage.cached_tokens } : {}),
          }
        : undefined

      return {
        model,
        conclusion: parsed.conclusion ?? 'Knowledge review completed.',
        summary: parsed.summary ?? parsed.conclusion ?? 'Knowledge review completed.',
        risks: Array.isArray(parsed.risks) ? parsed.risks : [],
        missingEvidence: Array.isArray(parsed.missingEvidence) ? parsed.missingEvidence : [],
        suggestedTests: Array.isArray(parsed.suggestedTests) ? parsed.suggestedTests : [],
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
        ...(usage ? { usage } : {}),
      }
    },
  }
}
