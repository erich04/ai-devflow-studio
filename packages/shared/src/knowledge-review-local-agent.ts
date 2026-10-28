import {
  AgentProviderRequestError,
  normalizeKnowledgeReviewProviderOutput,
  type KnowledgeReviewProviderOutput,
} from './agent-review'
import type {
  AgentProviderUsage,
  ClarificationRepositoryFindings,
  StageAgentExecutionBounds,
} from './domain'
import { DEFAULT_STAGE_AGENT_EXECUTION_BOUNDS, StageAgentExecutionError, validateRepositoryFindings } from './workflow-agent'

/**
 * Gate Review through a read-only local Agent (OpenCode), knowledge-context plan K2 / ADR 0025 L2.
 * The Agent receives the same review prompt as a direct model call plus instructions for
 * repository access. Its answer passes the same review schema; repository citations are digested
 * by the desktop executor and validated here. They are supplementary notes, never Gate evidence,
 * and the review stays advisory.
 */

export const LOCAL_AGENT_KNOWLEDGE_REVIEW_BOUNDS: StageAgentExecutionBounds = {
  ...DEFAULT_STAGE_AGENT_EXECUTION_BOUNDS,
  // Reading the repository takes several model rounds; each round is admitted by the budget relay.
  timeoutMs: 240_000,
}

const LOCAL_AGENT_REVIEW_SYSTEM_PROMPT =
  'Return only valid JSON with conclusion, summary, risks, missingEvidence, missingEvidenceDetails, suggestedTests, confidence and optionally repositoryFindings. conclusion and summary must be non-empty strings. risks, missingEvidence and suggestedTests must be arrays of strings; missingEvidenceDetails must be an array. confidence must be a JSON number between 0 and 1 inclusive. Review the Subject; use Criteria only as grounding. Do not approve the Gate. Do not wrap the response in Markdown.'

export function createLocalAgentKnowledgeReviewPrompt(
  reviewPrompt: string,
  options: { knowledgeRoot?: string | null; toolProtocol?: 'native-json' } = {},
): string {
  const root = options.knowledgeRoot === '' ? 'the repository' : options.knowledgeRoot ?? 'docs/knowledge'
  const native = options.toolProtocol === 'native-json'
  return [
    ...(native ? [
      'Return exactly one JSON object per turn. A turn is either ONE tool request or ONE final review, never both. Do not concatenate JSON objects, return an array or batch of tools, or wrap the object in prose or Markdown.',
      'For a tool turn, return only {"tool":{"name":"repo_read","args":{"path":"<repo-relative-file>"}}}. The host executes this one request and includes its result in observations in the next turn. Stop after this one object and wait for that observation before choosing another tool.',
      'The only tools are repo_list (args: optional path, use "." for root), repo_read (args: required path), and repo_search (args: required query, optional path). For several files, read one file per turn. Reuse earlier observations; do not repeat a completed read without a reason.',
      'For the final-review turn, omit tool and follow this review schema: ' + LOCAL_AGENT_REVIEW_SYSTEM_PROMPT,
      'You run as a read-only local Agent inside the selected Git repository. Never edit files, run shell commands, request permissions, or change the workflow.',
    ] : [
      LOCAL_AGENT_REVIEW_SYSTEM_PROMPT,
      'You run as a read-only local Agent inside the selected Git repository. Use only the read, glob, grep and list tools. Never edit files, run shell commands, request permissions, or change the workflow.',
    ]),
    'Use the repository to check statements in REVIEW_SUBJECT about existing code, configuration and documents before reporting them as gaps or risks. Do not report something as missing when the repository shows it exists.',
    `Project knowledge lives in ${root}. REVIEW_CRITERIA already contains the standards for this stage; read other documents there only when they are relevant.`,
    'When you verified something in the repository, add repositoryFindings with this exact nested shape (arrays of OBJECTS, not strings):',
    JSON.stringify({ repositoryFindings: {
      version: 1, repositoryDigest: '',
      verifiedFacts: [{ id: 'fact-1', statement: '<fact verified by a read tool>', citationIds: ['citation-1'] }],
      citations: [{ id: 'citation-1', path: '<repo-relative-file>', contentDigest: '', lineStart: 1, lineEnd: 1 }],
      assumptions: [], openQuestions: [], uncheckedScopes: [],
    } }),
    'Cite only files you actually read. Paths are relative to the repository root without line suffixes; lineStart/lineEnd are 1-based. Leave repositoryDigest and contentDigest empty: DevFlow computes them from the repository bytes. Never include source bodies, absolute paths or secrets.',
    native
      ? 'Before the final review, read at least one relevant file with repo_read. Final repositoryFindings must include at least one citation to a file in those observations. Repository findings are supplementary notes: they are not Gate evidence and never satisfy or approve the Gate.'
      : 'Omit repositoryFindings when the review did not need the repository. Repository findings are supplementary notes: they are not Gate evidence and never satisfy or approve the Gate.',
    '',
    reviewPrompt,
  ].join('\n')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasNoFindings(value: Record<string, unknown>): boolean {
  const empty = (field: unknown) => field === undefined || (Array.isArray(field) && field.length === 0)
  return empty(value.citations) && empty(value.verifiedFacts)
}

/**
 * Review output of a read-only local Agent: the direct-call review schema, plus repository
 * findings whose digests the executor has already computed from local bytes.
 */
export function readLocalAgentKnowledgeReviewOutput(
  value: unknown,
  meta: { model: string; usage?: AgentProviderUsage; toolCalls: number; bounds?: StageAgentExecutionBounds },
): KnowledgeReviewProviderOutput {
  const bounds = meta.bounds ?? LOCAL_AGENT_KNOWLEDGE_REVIEW_BOUNDS
  const invalid = (sanitizedCause: string) => new AgentProviderRequestError({
    code: 'invalid_model_output', sanitizedCause, deliveryState: 'response_received',
    billingState: meta.usage ? 'confirmed' : 'unknown', retryable: true, ...(meta.usage ? { usage: meta.usage } : {}),
  })
  if (!Number.isSafeInteger(meta.toolCalls) || meta.toolCalls < 0 || meta.toolCalls > bounds.maxToolCalls ||
    new TextEncoder().encode(JSON.stringify(value ?? null)).byteLength > bounds.maxOutputBytes) {
    throw invalid('local_agent_tool_limit')
  }
  const output = normalizeKnowledgeReviewProviderOutput(value, {
    model: meta.model,
    ...(meta.usage ? { usage: meta.usage } : {}),
  })
  const findings = isRecord(value) ? value.repositoryFindings : undefined
  if (findings === undefined || findings === null || (isRecord(findings) && hasNoFindings(findings))) return output
  if (!isRecord(findings)) throw invalid('local_agent_invalid_findings')
  let repositoryFindings: ClarificationRepositoryFindings | undefined
  try {
    repositoryFindings = validateRepositoryFindings(findings as unknown as ClarificationRepositoryFindings, bounds)
  } catch (error) {
    if (error instanceof StageAgentExecutionError) throw invalid('local_agent_invalid_findings')
    throw error
  }
  return { ...output, ...(repositoryFindings ? { repositoryFindings } : {}) }
}
