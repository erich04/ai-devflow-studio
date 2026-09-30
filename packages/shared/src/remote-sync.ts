import { parseStageAgentUsage } from './stage-agent-usage'
import { parseGateReviewSubjectSnapshot } from './gate-review-subject'
import type {
  Role,
  RemoteAgentReviewSummary,
  DesktopPairingCredential,
  RemoteRunSummary,
  RemoteRunSummaryKind,
  RemoteTestEvidenceSummary,
  AgentReviewResult,
  AgentReviewContextManifest,
  TestEvidence,
  WorkflowRun,
} from './domain'
import { WORKFLOW_CONTEXT_FIELD_IDS } from './domain'
import { redactTestEvidenceForStorage } from './local-execution'
import { redactLocalAbsolutePaths, redactSecrets, redactSensitiveText } from './redaction'
import { assertCanonicalLocalNodeId } from './remote-node-identity'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function hasLocalOnlyEvidenceField(value: Record<string, unknown>): boolean {
  return 'cwd' in value || 'stdout' in value || 'stderr' in value
}

function isRunStatus(value: unknown): boolean {
  return (
    value === 'created' ||
    value === 'clarifying' ||
    value === 'designing' ||
    value === 'building' ||
    value === 'testing' ||
    value === 'paused_at_gate' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'cancelled'
  )
}

/** Upper bound for a Run's synced step list; the workflow template has eight steps. */
export const REMOTE_RUN_MAX_NODES = 64

function sameRemoteRunNode(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  return left['id'] === right['id'] && left['stage'] === right['stage'] && left['kind'] === right['kind'] &&
    left['status'] === right['status'] && left['requiredRole'] === right['requiredRole']
}

/** Optional ordered step list: bounded, exact keys, unique IDs, and it agrees with `currentNode`. */
function isRemoteRunNodeList(value: unknown, currentNode: unknown): boolean {
  if (value === undefined) return true
  if (!Array.isArray(value) || value.length === 0 || value.length > REMOTE_RUN_MAX_NODES) return false
  const ids = new Set<string>()
  for (const node of value) {
    if (!isRemoteRunNodeSummary(node)) return false
    const record = node as Record<string, unknown>
    if (Object.keys(record).some((key) => !['id', 'stage', 'kind', 'status', 'requiredRole'].includes(key))) return false
    if (ids.has(record['id'] as string)) return false
    ids.add(record['id'] as string)
  }
  const current = value.find((node) => (node as Record<string, unknown>)['id'] === (currentNode as Record<string, unknown>)['id'])
  return Boolean(current) && sameRemoteRunNode(current as Record<string, unknown>, currentNode as Record<string, unknown>)
}

function isRemoteRunNodeSummary(value: unknown): boolean {
  if (!isRecord(value)) return false
  const stage = value['stage']
  const kind = value['kind']
  const status = value['status']
  const requiredRole = value['requiredRole']
  return (
    typeof value['id'] === 'string' &&
    (stage === 'clarify' || stage === 'design' || stage === 'build' || stage === 'test' || stage === 'pr' || stage === 'accept') &&
    (kind === 'agent' || kind === 'gate' || kind === 'task' || kind === 'test' || kind === 'pr' || kind === 'acceptance') &&
    (status === 'pending' || status === 'running' || status === 'blocked' || status === 'success' || status === 'failed' || status === 'skipped') &&
    (requiredRole === undefined || requiredRole === 'member' || requiredRole === 'lead' || requiredRole === 'owner')
  )
}

function isRemoteRunSummary(value: unknown): value is RemoteRunSummary {
  return (
    isRecord(value) &&
    (value['kind'] === 'run' || value['kind'] === 'approval' || value['kind'] === 'event') &&
    typeof value['runId'] === 'string' &&
    Number.isInteger(value['version']) &&
    (value['version'] as number) >= 1 &&
    typeof value['projectId'] === 'string' &&
    typeof value['title'] === 'string' &&
    isRunStatus(value['status']) &&
    typeof value['currentNodeId'] === 'string' &&
    isRemoteRunNodeSummary(value['currentNode']) &&
    (value['currentNode'] as Record<string, unknown>)['id'] === value['currentNodeId'] &&
    isRemoteRunNodeList(value['nodes'], value['currentNode']) &&
    typeof value['branchName'] === 'string' &&
    typeof value['updatedAt'] === 'string'
  )
}

function isRemoteTestEvidenceSummary(value: unknown): value is RemoteTestEvidenceSummary {
  if (!isRecord(value) || hasLocalOnlyEvidenceField(value)) return false
  const status = value['status']
  return (
    typeof value['id'] === 'string' &&
    typeof value['runId'] === 'string' &&
    typeof value['nodeId'] === 'string' &&
    typeof value['projectId'] === 'string' &&
    typeof value['command'] === 'string' &&
    (status === 'running' || status === 'passed' || status === 'failed' || status === 'timed_out') &&
    (typeof value['exitCode'] === 'number' || value['exitCode'] === null) &&
    typeof value['durationMs'] === 'number' &&
    typeof value['summary'] === 'string' &&
    value['redacted'] === true &&
    typeof value['createdAt'] === 'string'
  )
}

function isRemoteAgentReviewSummary(value: unknown): value is RemoteAgentReviewSummary {
  if (!isRecord(value)) return false
  const policyFindingCount = value['policyFindingCount']
  const policyFindingCategories = value['policyFindingCategories']
  const policyFindings = value['policyFindings']
  const contextManifest = value['contextManifest']
  const validCount =
    policyFindingCount === undefined ||
    (Number.isInteger(policyFindingCount) && (policyFindingCount as number) >= 0)
  const validCategories =
    policyFindingCategories === undefined ||
    (Array.isArray(policyFindingCategories) && policyFindingCategories.every((category) =>
      category === 'missing_evidence' ||
      category === 'test_risk' ||
      category === 'api_contract_risk' ||
      category === 'security_risk' ||
      category === 'review_gap'))
  const validFindings =
    policyFindings === undefined
      ? policyFindingCount === undefined || policyFindingCount === 0
      : Array.isArray(policyFindings) &&
        (policyFindingCount === undefined || policyFindingCount === policyFindings.length) &&
        policyFindings.every((finding) =>
          isRecord(finding) &&
          typeof finding['id'] === 'string' &&
          finding['reviewId'] === value['id'] &&
          finding['runId'] === value['runId'] &&
          finding['nodeId'] === value['nodeId'] &&
          (finding['category'] === 'missing_evidence' ||
            finding['category'] === 'test_risk' ||
            finding['category'] === 'api_contract_risk' ||
            finding['category'] === 'security_risk' ||
            finding['category'] === 'review_gap') &&
          (finding['severity'] === 'low' || finding['severity'] === 'medium' || finding['severity'] === 'high') &&
          typeof finding['summary'] === 'string' &&
          typeof finding['createdAt'] === 'string')
  const validContextManifest =
    contextManifest === undefined || isAgentReviewContextManifest(contextManifest)

  return (
    typeof value['id'] === 'string' &&
    typeof value['runId'] === 'string' &&
    typeof value['nodeId'] === 'string' &&
    typeof value['projectId'] === 'string' &&
    (value['runtime'] === 'electron' || value['runtime'] === 'api') &&
    typeof value['providerId'] === 'string' &&
    typeof value['model'] === 'string' &&
    typeof value['conclusion'] === 'string' &&
    typeof value['summary'] === 'string' &&
    typeof value['riskCount'] === 'number' &&
    typeof value['missingEvidenceCount'] === 'number' &&
    validCount &&
    validCategories &&
    validFindings &&
    validContextManifest &&
    (value['advisoryLevel'] === 'info' || value['advisoryLevel'] === 'warn' || value['advisoryLevel'] === 'block') &&
    typeof value['blocksApproval'] === 'boolean' &&
    typeof value['confidence'] === 'number' &&
    value['redacted'] === true &&
    typeof value['createdAt'] === 'string'
  )
}

function isCoverageState(value: unknown): boolean {
  return value === 'complete' || value === 'deterministically_chunked' || value === 'incomplete'
}

function isKnowledgeLexicalMatch(value: unknown): boolean {
  return isRecord(value) &&
    typeof value['rawScore'] === 'number' &&
    Number.isFinite(value['rawScore']) &&
    value['rawScore'] >= 0 &&
    Array.isArray(value['matchedTerms']) &&
    value['matchedTerms'].every((term) => typeof term === 'string') &&
    value['normalized'] === false &&
    value['crossQueryComparable'] === false &&
    (value['source'] === 'retriever' || value['source'] === 'legacy_score')
}

function isKnowledgeSemanticRelevance(value: unknown): boolean {
  return isRecord(value) &&
    typeof value['score'] === 'number' &&
    Number.isFinite(value['score']) &&
    (value['provider'] === undefined || typeof value['provider'] === 'string') &&
    (value['model'] === undefined || typeof value['model'] === 'string') &&
    (value['source'] === 'retriever' || value['source'] === 'legacy_score')
}

function isKnowledgeGateEvidence(value: unknown): boolean {
  return isRecord(value) &&
    (value['status'] === 'retrieval_candidate' ||
      value['status'] === 'reviewed_reference' ||
      value['status'] === 'supports_finding' ||
      value['status'] === 'rejected') &&
    (value['reviewId'] === undefined || typeof value['reviewId'] === 'string') &&
    (value['findingIds'] === undefined || (
      Array.isArray(value['findingIds']) && value['findingIds'].every((id) => typeof id === 'string')
    ))
}

function isWorkflowContextProjection(value: unknown): boolean {
  if (!isRecord(value) || value['version'] !== 1 || !Array.isArray(value['fields'])) return false
  const fields = value['fields']
  return (
    (value['stage'] === 'clarify' || value['stage'] === 'design' || value['stage'] === 'build' ||
      value['stage'] === 'test' || value['stage'] === 'pr' || value['stage'] === 'accept') &&
    (value['nodeKind'] === 'agent' || value['nodeKind'] === 'gate' || value['nodeKind'] === 'task' ||
      value['nodeKind'] === 'test' || value['nodeKind'] === 'pr' || value['nodeKind'] === 'acceptance') &&
    fields.length === WORKFLOW_CONTEXT_FIELD_IDS.length &&
    fields.every((field) =>
      isRecord(field) &&
      WORKFLOW_CONTEXT_FIELD_IDS.includes(field['field'] as typeof WORKFLOW_CONTEXT_FIELD_IDS[number]) &&
      (field['applicability'] === 'not_applicable' || field['applicability'] === 'not_yet_expected' ||
        field['applicability'] === 'optional' || field['applicability'] === 'required') &&
      (field['state'] === 'not_applicable' || field['state'] === 'not_yet_expected' ||
        field['state'] === 'optional' || field['state'] === 'required' ||
        field['state'] === 'available' || field['state'] === 'missing_required') &&
      typeof field['visible'] === 'boolean' &&
      typeof field['includeInProviderPrompt'] === 'boolean' &&
      (field['role'] === 'primary' || field['role'] === 'supplemental' || field['role'] === 'historical') &&
      typeof field['reason'] === 'string' &&
      (field['expectedStage'] === undefined || field['expectedStage'] === 'clarify' ||
        field['expectedStage'] === 'design' || field['expectedStage'] === 'build' ||
        field['expectedStage'] === 'test' || field['expectedStage'] === 'pr' ||
        field['expectedStage'] === 'accept'))
  )
}

function isAgentReviewContextManifest(value: unknown): value is AgentReviewContextManifest {
  if (!isRecord(value) || value['version'] !== 1 || !isCoverageState(value['coverage'])) return false
  const runRequest = value['runRequest']
  const subjectArtifacts = value['subjectArtifacts']
  const knowledgeCriteria = value['knowledgeCriteria']
  const fieldProjection = value['fieldProjection']
  return (
    (value['stage'] === 'clarify' || value['stage'] === 'design' || value['stage'] === 'build' ||
      value['stage'] === 'test' || value['stage'] === 'pr' || value['stage'] === 'accept') &&
    isRecord(runRequest) &&
    typeof runRequest['contentDigest'] === 'string' &&
    typeof runRequest['sanitizerVersion'] === 'string' &&
    isCoverageState(runRequest['coverage']) &&
    Array.isArray(subjectArtifacts) &&
    subjectArtifacts.every((artifact) =>
      isRecord(artifact) &&
      typeof artifact['id'] === 'string' &&
      typeof artifact['runId'] === 'string' &&
      typeof artifact['nodeId'] === 'string' &&
      typeof artifact['kind'] === 'string' &&
      typeof artifact['updatedAt'] === 'string' &&
      typeof artifact['contentDigest'] === 'string' &&
      typeof artifact['sanitizerVersion'] === 'string' &&
      isCoverageState(artifact['coverage']) &&
      Array.isArray(artifact['chunks']) &&
      artifact['chunks'].every((chunk) =>
        isRecord(chunk) &&
        Number.isInteger(chunk['index']) &&
        Number.isInteger(chunk['start']) &&
        Number.isInteger(chunk['end']) &&
        typeof chunk['contentDigest'] === 'string' &&
        !('content' in chunk)),
    ) &&
    Array.isArray(knowledgeCriteria) &&
    knowledgeCriteria.every((criteria) =>
      isRecord(criteria) &&
      typeof criteria['referenceId'] === 'string' &&
      typeof criteria['documentId'] === 'string' &&
      (criteria['score'] === undefined || (
        typeof criteria['score'] === 'number' && Number.isFinite(criteria['score'])
      )) &&
      (criteria['lexicalMatch'] === undefined || isKnowledgeLexicalMatch(criteria['lexicalMatch'])) &&
      (criteria['semanticRelevance'] === undefined || isKnowledgeSemanticRelevance(criteria['semanticRelevance'])) &&
      (criteria['gateEvidence'] === undefined || isKnowledgeGateEvidence(criteria['gateEvidence']))) &&
    (fieldProjection === undefined || isWorkflowContextProjection(fieldProjection)) &&
    (value['criteriaCoverage'] === 'available' ||
      value['criteriaCoverage'] === 'unavailable' ||
      value['criteriaCoverage'] === 'empty')
  )
}

function redactAgentReviewContextManifest(
  manifest: AgentReviewContextManifest,
): AgentReviewContextManifest {
  return {
    ...manifest,
    runRequest: { ...manifest.runRequest },
    subjectArtifacts: manifest.subjectArtifacts.map((artifact) => ({
      ...artifact,
      id: redactSensitiveText(artifact.id).value,
      runId: redactSensitiveText(artifact.runId).value,
      nodeId: redactSensitiveText(artifact.nodeId).value,
      chunks: artifact.chunks.map((chunk) => ({ ...chunk })),
    })),
    knowledgeCriteria: manifest.knowledgeCriteria.map((criteria) => ({
      ...criteria,
      referenceId: redactSensitiveText(criteria.referenceId).value,
      documentId: redactSensitiveText(criteria.documentId).value,
      ...(criteria.chunkId
        ? { chunkId: redactSensitiveText(criteria.chunkId).value }
        : {}),
      ...(criteria.lexicalMatch
        ? {
            lexicalMatch: {
              ...criteria.lexicalMatch,
              matchedTerms: criteria.lexicalMatch.matchedTerms.map(
                (term) => redactSensitiveText(term).value,
              ),
            },
          }
        : {}),
      ...(criteria.semanticRelevance
        ? {
            semanticRelevance: {
              ...criteria.semanticRelevance,
              ...(criteria.semanticRelevance.provider
                ? { provider: redactSensitiveText(criteria.semanticRelevance.provider).value }
                : {}),
              ...(criteria.semanticRelevance.model
                ? { model: redactSensitiveText(criteria.semanticRelevance.model).value }
                : {}),
            },
          }
        : {}),
      ...(criteria.gateEvidence
        ? {
            gateEvidence: {
              ...criteria.gateEvidence,
              ...(criteria.gateEvidence.reviewId
                ? { reviewId: redactSensitiveText(criteria.gateEvidence.reviewId).value }
                : {}),
              ...(criteria.gateEvidence.findingIds
                ? {
                    findingIds: criteria.gateEvidence.findingIds.map(
                      (findingId) => redactSensitiveText(findingId).value,
                    ),
                  }
                : {}),
            },
          }
        : {}),
    })),
    ...(manifest.fieldProjection
      ? {
          fieldProjection: {
            ...manifest.fieldProjection,
            fields: manifest.fieldProjection.fields.map((field) => ({
              ...field,
              reason: redactSensitiveText(field.reason).value,
            })),
          },
        }
      : {}),
  }
}

export function parseRemoteRunSummary(value: unknown): RemoteRunSummary {
  if (!isRemoteRunSummary(value)) {
    throw new Error('Invalid remote run summary payload')
  }
  return redactRemoteRunSummaryForSync(value)
}

export function parseRemoteTestEvidenceSummary(value: unknown): RemoteTestEvidenceSummary {
  if (isRecord(value) && hasLocalOnlyEvidenceField(value)) {
    throw new Error('Remote test evidence summary contains local-only fields')
  }
  if (!isRemoteTestEvidenceSummary(value)) {
    throw new Error('Invalid remote test evidence summary payload')
  }
  return redactRemoteTestEvidenceSummaryForSync(value)
}

export function parseRemoteAgentReviewSummary(value: unknown): RemoteAgentReviewSummary {
  if (!isRemoteAgentReviewSummary(value)) {
    throw new Error('Invalid remote agent review summary payload')
  }
  return redactRemoteAgentReviewSummaryForSync(value)
}

export function resolveTeamProjectId(input: {
  localProjectId: string
  credential: DesktopPairingCredential | null | undefined
}): string {
  if (!input.credential) {
    throw new Error('Pair Team Project before resolving remote project state.')
  }

  if (!input.credential.localProjectId) {
    throw new Error('Paired Team Project is not bound to a local project.')
  }

  if (input.credential.localProjectId !== input.localProjectId) {
    throw new Error('Paired Team Project is bound to a different local project.')
  }

  return input.credential.projectId
}

export type DevFlowSessionHeaders = {
  'x-devflow-session-source'?: 'demo' | 'authenticated'
  'x-devflow-organization-id': string
  'x-devflow-user-id': string
  'x-devflow-user-role': Role
  'x-devflow-auth-account-id'?: string
  'x-devflow-project-roles': string
}

export type CreateAuthenticatedTeamSessionHeadersInput = {
  organizationId: string
  userId: string
  role: Role
  authAccountId: string
  projectRoles: Array<{
    projectId: string
    role: Role
  }>
}

export function createDemoTeamSessionHeaders(): DevFlowSessionHeaders {
  return {
    'x-devflow-session-source': 'demo',
    'x-devflow-organization-id': 'org-demo',
    'x-devflow-user-id': 'u-erich',
    'x-devflow-user-role': 'owner',
    'x-devflow-project-roles': 'p-payments:owner,p-admin:owner',
  }
}

export function createAuthenticatedTeamSessionHeaders(
  input: CreateAuthenticatedTeamSessionHeadersInput,
): DevFlowSessionHeaders {
  return {
    'x-devflow-session-source': 'authenticated',
    'x-devflow-organization-id': input.organizationId,
    'x-devflow-user-id': input.userId,
    'x-devflow-user-role': input.role,
    'x-devflow-auth-account-id': input.authAccountId,
    'x-devflow-project-roles': input.projectRoles
      .map((membership) => `${membership.projectId}:${membership.role}`)
      .join(','),
  }
}

export function createRemoteRunSummary(
  run: WorkflowRun,
  kind: RemoteRunSummaryKind = 'run',
): RemoteRunSummary {
  const currentNode = run.nodes.find((node) => node.id === run.currentNodeId)
  if (!currentNode) {
    throw new Error(`Canonical Run current node not found: ${run.currentNodeId}`)
  }

  const nodeSummary = (node: WorkflowRun['nodes'][number]) => ({
    id: node.id,
    stage: node.stage,
    kind: node.kind,
    status: node.status,
    ...(node.requiredRole ? { requiredRole: node.requiredRole } : {}),
  })
  return redactRemoteRunSummaryForSync({
    kind,
    runId: run.id,
    version: run.version,
    projectId: run.projectId,
    title: run.title,
    status: run.status,
    currentNodeId: run.currentNodeId,
    currentNode: nodeSummary(currentNode),
    // The whole step list lets the Team show real progress, not only the step current at upload.
    ...(run.nodes.length <= REMOTE_RUN_MAX_NODES ? { nodes: run.nodes.map(nodeSummary) } : {}),
    branchName: run.branchName,
    updatedAt: run.updatedAt,
  })
}

export function redactRemoteRunSummaryForSync(
  summary: RemoteRunSummary,
): RemoteRunSummary {
  assertCanonicalLocalNodeId(summary.runId, summary.currentNodeId)
  assertCanonicalLocalNodeId(summary.runId, summary.currentNode.id)
  const stageAgentUsage = summary.stageAgentUsage === undefined ? undefined
    : parseStageAgentUsage(summary.stageAgentUsage, summary.runId, summary.projectId)
  stageAgentUsage?.forEach((usage) => assertCanonicalLocalNodeId(summary.runId, usage.nodeId))
  if (summary.nodes !== undefined && !isRemoteRunNodeList(summary.nodes, summary.currentNode)) {
    throw new Error('Run summary step list does not match its current step.')
  }
  summary.nodes?.forEach((node) => assertCanonicalLocalNodeId(summary.runId, node.id))
  const gateReviewSubject = summary.gateReviewSubject === undefined ? undefined
    : parseGateReviewSubjectSnapshot(summary.gateReviewSubject)
  if (gateReviewSubject && (gateReviewSubject.runId !== summary.runId ||
    gateReviewSubject.runVersion !== summary.version || gateReviewSubject.nodeId !== summary.currentNodeId ||
    gateReviewSubject.stage !== summary.currentNode.stage ||
    (summary.currentNode.kind !== 'gate' && summary.currentNode.kind !== 'acceptance'))) {
    throw new Error('Gate Review subject scope does not match its Run summary.')
  }
  return {
    ...(gateReviewSubject ? { gateReviewSubject } : {}),
    ...(stageAgentUsage ? { stageAgentUsage } : {}),
    kind: summary.kind,
    runId: summary.runId,
    version: summary.version,
    projectId: summary.projectId,
    title: redactSensitiveText(summary.title).value,
    status: summary.status,
    currentNodeId: summary.currentNodeId,
    currentNode: {
      id: summary.currentNode.id,
      stage: summary.currentNode.stage,
      kind: summary.currentNode.kind,
      status: summary.currentNode.status,
      ...(summary.currentNode.requiredRole
        ? { requiredRole: summary.currentNode.requiredRole }
        : {}),
    },
    ...(summary.nodes
      ? {
          nodes: summary.nodes.map((node) => ({
            id: node.id,
            stage: node.stage,
            kind: node.kind,
            status: node.status,
            ...(node.requiredRole ? { requiredRole: node.requiredRole } : {}),
          })),
        }
      : {}),
    branchName: redactSensitiveText(summary.branchName).value,
    updatedAt: summary.updatedAt,
  }
}

/**
 * Chinese display title of a synced step. Step titles never leave the desktop, so the Team names
 * a step by its stage and kind; the same names as the desktop's template display names.
 */
export function remoteStepTitle(stage: WorkflowRun['nodes'][number]['stage'], kind: WorkflowRun['nodes'][number]['kind']): string {
  const gate = kind === 'gate' || kind === 'acceptance'
  switch (stage) {
    case 'clarify': return gate ? '需求确认 Gate' : '需求澄清'
    case 'design': return gate ? '方案评审 Gate' : '方案设计'
    case 'build': return gate ? '开发实现 Gate' : '开发实现'
    case 'test': return gate ? '测试 Gate' : '运行测试'
    case 'pr': return gate ? 'PR 交付 Gate' : '准备 PR 草稿'
    case 'accept': return '业务验收'
  }
}

/** Subtitle stored for synced steps; content stays on the desktop. */
export const REMOTE_STEP_SUBTITLE = '步骤状态由桌面端同步。'

export function createRemoteTestEvidenceSummary(
  evidence: TestEvidence,
): RemoteTestEvidenceSummary {
  const safeEvidence = redactTestEvidenceForStorage(evidence)
  return redactRemoteTestEvidenceSummaryForSync({
    id: safeEvidence.id,
    runId: safeEvidence.runId,
    nodeId: safeEvidence.nodeId,
    projectId: safeEvidence.projectId,
    command: safeEvidence.command,
    status: safeEvidence.status,
    exitCode: safeEvidence.exitCode,
    durationMs: safeEvidence.durationMs,
    summary: safeEvidence.summary,
    redacted: true,
    createdAt: safeEvidence.createdAt,
  })
}

export function redactRemoteTestEvidenceSummaryForSync(
  summary: RemoteTestEvidenceSummary,
): RemoteTestEvidenceSummary {
  assertCanonicalLocalNodeId(summary.runId, summary.nodeId)
  const command = redactSecrets(redactLocalAbsolutePaths(summary.command).value)
  const evidenceSummary = redactSecrets(redactLocalAbsolutePaths(summary.summary).value)

  return {
    id: summary.id,
    runId: summary.runId,
    nodeId: summary.nodeId,
    projectId: summary.projectId,
    command: command.value,
    status: summary.status,
    exitCode: summary.exitCode,
    durationMs: summary.durationMs,
    summary: evidenceSummary.value,
    redacted: true,
    createdAt: summary.createdAt,
  }
}

export function redactRemoteAgentReviewSummaryForSync(
  summary: RemoteAgentReviewSummary,
): RemoteAgentReviewSummary {
  assertCanonicalLocalNodeId(summary.runId, summary.nodeId)
  for (const finding of summary.policyFindings ?? []) {
    assertCanonicalLocalNodeId(finding.runId, finding.nodeId)
  }
  for (const artifact of summary.contextManifest?.subjectArtifacts ?? []) {
    assertCanonicalLocalNodeId(summary.runId, artifact.nodeId)
  }
  const policyFindings = summary.policyFindings?.map((finding) => ({
    id: finding.id,
    reviewId: finding.reviewId,
    runId: finding.runId,
    nodeId: finding.nodeId,
    category: finding.category,
    severity: finding.severity,
    summary: redactSensitiveText(finding.summary).value,
    createdAt: finding.createdAt,
  }))

  return {
    id: summary.id,
    runId: summary.runId,
    nodeId: summary.nodeId,
    projectId: summary.projectId,
    runtime: summary.runtime,
    providerId: summary.providerId,
    model: summary.model,
    conclusion: redactSensitiveText(summary.conclusion).value,
    summary: redactSensitiveText(summary.summary).value,
    riskCount: summary.riskCount,
    missingEvidenceCount: summary.missingEvidenceCount,
    ...(summary.policyFindingCount !== undefined
      ? { policyFindingCount: policyFindings?.length ?? summary.policyFindingCount }
      : {}),
    ...(summary.policyFindingCategories !== undefined
      ? {
          policyFindingCategories: policyFindings
            ? Array.from(new Set(policyFindings.map((finding) => finding.category)))
            : summary.policyFindingCategories,
        }
      : {}),
    ...(policyFindings ? { policyFindings } : {}),
    ...(summary.contextManifest
      ? { contextManifest: redactAgentReviewContextManifest(summary.contextManifest) }
      : {}),
    advisoryLevel: summary.advisoryLevel,
    blocksApproval: summary.blocksApproval,
    confidence: summary.confidence,
    redacted: true,
    createdAt: summary.createdAt,
  }
}

export function createRemoteAgentReviewSummary(
  review: AgentReviewResult,
): RemoteAgentReviewSummary {
  return redactRemoteAgentReviewSummaryForSync({
    id: review.id,
    runId: review.runId,
    nodeId: review.nodeId,
    projectId: review.projectId,
    runtime: review.runtime,
    providerId: review.providerId,
    model: review.model,
    conclusion: review.conclusion,
    summary: review.summary,
    riskCount: review.risks.length,
    missingEvidenceCount: review.missingEvidence.length,
    policyFindingCount: review.policyFindings.length,
    policyFindingCategories: Array.from(
      new Set(review.policyFindings.map((finding) => finding.category)),
    ),
    policyFindings: review.policyFindings.map((finding) => ({
      id: finding.id,
      reviewId: finding.reviewId,
      runId: finding.runId,
      nodeId: finding.nodeId,
      category: finding.category,
      severity: finding.severity,
      summary: finding.summary,
      createdAt: finding.createdAt,
    })),
    ...(review.contextManifest ? { contextManifest: review.contextManifest } : {}),
    advisoryLevel: review.gateAdvisory.level,
    blocksApproval: review.gateAdvisory.blocksApproval,
    confidence: review.confidence,
    redacted: true,
    createdAt: review.createdAt,
  })
}
