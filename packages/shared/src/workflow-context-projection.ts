import type {
  KnowledgeGateEvidence,
  KnowledgeLexicalMatch,
  KnowledgeReference,
  KnowledgeSemanticRelevance,
  NodeStage,
  WorkflowContextApplicability,
  WorkflowContextFieldId,
  WorkflowContextFieldProjection,
  WorkflowContextProjection,
  WorkflowNode,
} from './domain'
import type { EffectiveEnforcementPolicy } from './enforcement'
import { WORKFLOW_CONTEXT_FIELD_IDS } from './domain'

export type WorkflowContextAvailability = Partial<Record<WorkflowContextFieldId, boolean | number>>

export type WorkflowContextPolicyRequirements = Partial<Record<WorkflowContextFieldId, boolean>>

type DefaultRule = {
  applicability: WorkflowContextApplicability
  reason: string
  expectedStage?: NodeStage
  role?: WorkflowContextFieldProjection['role']
}

const stageOrder: Record<NodeStage, number> = {
  clarify: 0,
  design: 1,
  build: 2,
  test: 3,
  pr: 4,
  accept: 5,
}

function unavailableUntil(expectedStage: NodeStage, reason: string): DefaultRule {
  return { applicability: 'not_yet_expected', expectedStage, reason, role: 'historical' }
}

function isGateLike(node: WorkflowNode): boolean {
  return node.kind === 'gate' || node.kind === 'acceptance'
}

export function canRunKnowledgeReviewOnNode(node: Pick<WorkflowNode, 'kind'>): boolean {
  return node.kind === 'gate' || node.kind === 'acceptance'
}

function defaultRule(node: WorkflowNode, field: WorkflowContextFieldId): DefaultRule {
  const gateLike = isGateLike(node)

  switch (field) {
    case 'raw_request':
      return { applicability: 'required', reason: 'The original request anchors every workflow stage.' }
    case 'artifacts':
      return gateLike
        ? { applicability: 'required', reason: 'A Gate reviews its exact associated stage Artifact.' }
        : { applicability: 'optional', reason: 'The current task may produce or consume stage Artifacts.' }
    case 'knowledge_references':
      return gateLike
        ? { applicability: 'optional', reason: 'Knowledge references are Gate review criteria, not evidence.' }
        : { applicability: 'not_applicable', reason: 'Gate-review references belong to Gate or Acceptance nodes.' }
    case 'generation_references':
      return node.kind === 'agent' && (node.stage === 'clarify' || node.stage === 'design')
        ? { applicability: 'optional', reason: 'Generation references may explain inputs used by this workflow Agent.' }
        : { applicability: 'not_applicable', reason: 'Generation references apply only to workflow generation Agents.' }
    case 'agent_review':
      return gateLike
        ? { applicability: 'optional', reason: 'Knowledge-grounded review is scoped to Gate and Acceptance nodes.' }
        : { applicability: 'not_applicable', reason: 'This node cannot execute a Gate Review.' }
    case 'test_evidence':
      if (node.stage === 'clarify' || (node.stage === 'design' && node.kind !== 'gate')) {
        return {
          applicability: 'not_applicable',
          reason: 'Executed tests are not required during clarification or design generation.',
        }
      }
      if (node.stage === 'design' || node.stage === 'build') {
        return {
          applicability: 'optional',
          reason: 'Existing baseline or local validation may be shown as supplemental evidence.',
          role: 'supplemental',
        }
      }
      return {
        applicability: 'required',
        reason: 'Test, delivery, and acceptance stages require auditable Test Evidence.',
      }
    case 'trace':
      return node.kind === 'pr' || node.kind === 'acceptance'
        ? { applicability: 'optional', reason: 'Execution Trace is supplementary after delivery begins.', role: 'supplemental' }
        : { applicability: 'optional', reason: 'Trace records execution performed by the current node.' }
    case 'coding_result':
      if (node.stage === 'build') {
        return { applicability: 'optional', reason: 'Coding diff and result are produced by the build task.' }
      }
      if (stageOrder[node.stage] > stageOrder.build) {
        return { applicability: 'optional', reason: 'The reviewed coding result is historical input to downstream stages.', role: 'historical' }
      }
      return unavailableUntil('build', 'Coding output is produced after design approval.')
    case 'budget':
      return node.kind === 'agent' || node.kind === 'gate' || node.kind === 'task' || node.kind === 'acceptance'
        ? { applicability: 'optional', reason: 'Budget applies only when this node can invoke a provider or coding runtime.' }
        : { applicability: 'not_applicable', reason: 'This node has no provider action requiring a runtime budget.' }
    case 'policy':
      return gateLike
        ? { applicability: 'required', reason: 'Gate and Acceptance decisions require an effective policy snapshot.' }
        : { applicability: 'not_applicable', reason: 'Policy enforcement is evaluated at Gate boundaries.' }
    case 'github_delivery':
      if (node.stage === 'pr' || node.stage === 'accept') {
        return {
          applicability: node.kind === 'pr' ? 'required' : 'optional',
          reason: node.kind === 'pr'
            ? 'The PR node owns GitHub Delivery.'
            : 'Acceptance consumes the completed delivery as historical evidence.',
          role: node.kind === 'pr' ? 'primary' : 'historical',
        }
      }
      return unavailableUntil('pr', 'GitHub Delivery is created only after tests pass.')
    case 'acceptance_evidence':
      return node.stage === 'accept' || node.kind === 'acceptance'
        ? { applicability: 'required', reason: 'Acceptance owns the final evidence bundle.' }
        : unavailableUntil('accept', 'Acceptance evidence is produced only at the final stage.')
  }
}

function hasAvailableValue(value: boolean | number | undefined): boolean {
  return value === true || (typeof value === 'number' && value > 0)
}

const providerPromptFields = new Set<WorkflowContextFieldId>([
  'raw_request',
  'artifacts',
  'knowledge_references',
  'test_evidence',
  'policy',
])

export function projectWorkflowContext(input: {
  node: WorkflowNode
  availability?: WorkflowContextAvailability
  requiredByPolicy?: WorkflowContextPolicyRequirements
}): WorkflowContextProjection {
  return {
    version: 1,
    stage: input.node.stage,
    nodeKind: input.node.kind,
    fields: WORKFLOW_CONTEXT_FIELD_IDS.map((field): WorkflowContextFieldProjection => {
      const base = defaultRule(input.node, field)
      const policyRequired = input.requiredByPolicy?.[field] === true
      const applicability = policyRequired ? 'required' : base.applicability
      const available = hasAvailableValue(input.availability?.[field])
      const state = available
        ? 'available'
        : applicability === 'required'
          ? 'missing_required'
          : applicability
      const visible = available || state === 'missing_required'
      const role = available && (base.applicability === 'not_applicable' || base.applicability === 'not_yet_expected')
        ? 'supplemental'
        : (base.role ?? 'primary')

      return {
        field,
        applicability,
        state,
        visible,
        includeInProviderPrompt:
          providerPromptFields.has(field) && (available || state === 'missing_required'),
        role,
        reason: policyRequired
          ? `Effective policy requires this field. ${base.reason}`
          : base.reason,
        ...(base.expectedStage ? { expectedStage: base.expectedStage } : {}),
      }
    }),
  }
}

export function workflowContextField(
  projection: WorkflowContextProjection | undefined,
  field: WorkflowContextFieldId,
): WorkflowContextFieldProjection | undefined {
  return projection?.fields.find((candidate) => candidate.field === field)
}

export function deriveWorkflowContextPolicyRequirements(
  policy: EffectiveEnforcementPolicy | null | undefined,
): WorkflowContextPolicyRequirements {
  if (!policy) return {}

  const requiresTestEvidence = policy.rules.some((rule) =>
    rule.target === 'governance_check' &&
    rule.category === 'testing_standard' &&
    rule.statusOrSeverity === 'needs_evidence' &&
    rule.action === 'block')
  const requiresAgentReview = policy.rules.some((rule) =>
    rule.target === 'missing_agent_review' && rule.action === 'block')

  return {
    ...(requiresTestEvidence ? { test_evidence: true } : {}),
    ...(requiresAgentReview ? { agent_review: true } : {}),
  }
}

export type KnowledgeReferenceSemantics = {
  lexicalMatch?: KnowledgeLexicalMatch
  semanticRelevance?: KnowledgeSemanticRelevance
  gateEvidence: KnowledgeGateEvidence
  legacyScore?: number
}

/**
 * Reads typed relevance fields first and interprets legacy `score` only through
 * its recorded strategy. A lexical legacy score is never promoted to semantic
 * relevance or Gate Evidence.
 */
export function resolveKnowledgeReferenceSemantics(
  reference: KnowledgeReference,
): KnowledgeReferenceSemantics {
  const legacyScore = typeof reference.score === 'number' && Number.isFinite(reference.score)
    ? reference.score
    : undefined
  const lexicalMatch = reference.lexicalMatch ?? (
    legacyScore !== undefined && reference.strategy === 'lexical'
      ? {
          rawScore: legacyScore,
          matchedTerms: [],
          normalized: false as const,
          crossQueryComparable: false as const,
          source: 'legacy_score' as const,
        }
      : undefined
  )
  const semanticRelevance = reference.semanticRelevance ?? (
    legacyScore !== undefined && reference.strategy === 'vector'
      ? {
          score: legacyScore,
          source: 'legacy_score' as const,
        }
      : undefined
  )

  return {
    ...(lexicalMatch ? { lexicalMatch } : {}),
    ...(semanticRelevance ? { semanticRelevance } : {}),
    gateEvidence: reference.gateEvidence ?? { status: 'retrieval_candidate' },
    ...(legacyScore !== undefined ? { legacyScore } : {}),
  }
}
