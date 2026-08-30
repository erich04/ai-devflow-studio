import type {
  Artifact,
  CodingAgentRun,
  CodingDiffArtifact,
  CodingRuntimeCostSummary,
  DependencyBootstrapDecision,
  DependencyBootstrapSnapshot,
  GateDecision,
  KnowledgeChunk,
  KnowledgeGovernanceCheck,
  KnowledgeReference,
  LocalProject,
  PackageManager,
  RemoteCodingAgentSummary,
  TestEvidence,
  WorkflowNode,
  WorkflowRun,
} from './domain'
import type { RemediationPlan, RetryAttempt } from './remediation'
import { detectPackageManager } from './local-execution'
import {
  countCanonicalSecretRedactionMarkers,
  redactSecrets,
  redactSensitiveText,
} from './redaction'
import { assertCanonicalLocalNodeId } from './remote-node-identity'
import { parseBudgetGuardDecision } from './cost'

export const MAX_DIFF_CHARS = 50_000
export const CURRENT_CODING_DIFF_SANITIZER_VERSION = 2
export const SUPPORTED_CODING_DIFF_SANITIZER_VERSIONS = Object.freeze([2] as const)
export const MAX_REMOTE_CHANGED_PATHS = 50
export const MAX_CODING_KNOWLEDGE_REFERENCES = 8
export const MAX_CODING_KNOWLEDGE_EXCERPT_CHARS = 1_200
export const MAX_CODING_KNOWLEDGE_TOTAL_EXCERPT_CHARS = 6_000
export const activeCodingAgentRunStatuses: readonly CodingAgentRun['status'][] = [
  'queued',
  'preparing',
  'waiting_permission',
  'bootstrapping',
  'running',
  'applying',
  'testing',
]

export function hasSupportedCodingDiffSanitization(
  artifact: CodingDiffArtifact,
): boolean {
  const sanitizedAt = artifact.sanitizedAt
  return (
    typeof artifact.sanitizerVersion === 'number' &&
    SUPPORTED_CODING_DIFF_SANITIZER_VERSIONS.some(
      (version) => version === artifact.sanitizerVersion,
    ) &&
    typeof sanitizedAt === 'string' &&
    Number.isFinite(Date.parse(sanitizedAt)) &&
    new Date(sanitizedAt).toISOString() === sanitizedAt &&
    Date.parse(sanitizedAt) >= Date.parse(artifact.createdAt) &&
    Number.isSafeInteger(artifact.secretReplacementCount) &&
    artifact.secretReplacementCount! >= 0 &&
    artifact.secretReplacementCount! <= MAX_DIFF_CHARS
  )
}

export function isActiveCodingAgentRunStatus(status: CodingAgentRun['status']): boolean {
  return activeCodingAgentRunStatuses.includes(status)
}

export type CodingBriefInput = {
  run: WorkflowRun
  node: WorkflowNode
  project: LocalProject
  upstreamArtifacts: Artifact[]
  knowledgeReferences: KnowledgeReference[]
  knowledgeChunks?: KnowledgeChunk[]
  governanceChecks: KnowledgeGovernanceCheck[]
  gateDecisions: GateDecision[]
  testEvidence: TestEvidence[]
  remediationPlan?: RemediationPlan | undefined
  retryAttempt?: RetryAttempt | undefined
  userInstruction: string
  worktreePath: string
  branchName: string
}

export type CodingBrief = {
  runId: string
  nodeId: string
  projectId: string
  testCommand: string
  branchName: string
  worktreePath: string
  userInstruction: string
  prompt: string
}

export type RawCodingDiffArtifact = {
  id: string
  runId: string
  nodeId: string
  projectId: string
  changedPaths: string[]
  patch: string
  sourceDigest?: string
  sanitizedAt?: string
  createdAt: string
}

export function canRunCodingAgentOnNode(node: WorkflowNode): boolean {
  // DevFlow models implementation work as build-stage task nodes.
  return node.stage === 'build' && node.kind === 'task'
}

export function buildCodingBrief(input: CodingBriefInput): CodingBrief {
  const userInstruction = input.userInstruction.trim()
  const artifactLines = input.upstreamArtifacts.length
    ? input.upstreamArtifacts.map((artifact) => {
        return `- ${artifact.title} (${artifact.kind}): ${artifact.summary}\n  ${artifact.content}`
      })
    : ['- No upstream artifacts are available.']
  let remainingKnowledgeExcerptChars = MAX_CODING_KNOWLEDGE_TOTAL_EXCERPT_CHARS
  const knowledgeLines = input.knowledgeReferences.length
    ? input.knowledgeReferences.slice(0, MAX_CODING_KNOWLEDGE_REFERENCES).map((reference) => {
        const chunk = input.knowledgeChunks?.find(
          (candidate) =>
            candidate.id === reference.chunkId &&
            candidate.documentId === reference.documentId &&
            (!reference.contentHash || candidate.contentHash === reference.contentHash),
        )
        const sourcePath = safeKnowledgeSourcePath(reference.sourcePath ?? chunk?.sourcePath)
        const section = reference.headingPath?.length ? ` section="${reference.headingPath.join(' > ')}"` : ''
        const score = typeof reference.score === 'number' ? ` score=${reference.score.toFixed(2)}` : ''
        const strategy = reference.strategy ? ` strategy=${reference.strategy}` : ''
        const contentHash = reference.contentHash ? ` contentHash=${reference.contentHash}` : ''
        const excerptLimit = Math.min(MAX_CODING_KNOWLEDGE_EXCERPT_CHARS, remainingKnowledgeExcerptChars)
        const excerpt = chunk && excerptLimit > 0
          ? redactSensitiveText(chunk.content).value.slice(0, excerptLimit)
          : ''
        remainingKnowledgeExcerptChars -= excerpt.length
        return `- ${reference.documentId}${sourcePath ? ` source=${sourcePath}` : ''}${section}${strategy}${score}${contentHash}: ${redactSensitiveText(reference.reason).value}${excerpt ? `\n  Excerpt: ${excerpt}` : ''}`
      })
    : ['- No knowledge references are attached.']
  const governanceLines = input.governanceChecks.length
    ? input.governanceChecks.map((check) => {
        return `- ${check.title} [${check.status}]: ${check.summary}`
      })
    : ['- No governance checks are attached.']
  const gateLines = input.gateDecisions.length
    ? input.gateDecisions.map((decision) => {
        return `- ${decision.decision} by ${decision.approverId}: ${decision.comment}`
      })
    : ['- No gate decisions have been recorded.']
  const testEvidenceLines = input.testEvidence.length
    ? input.testEvidence.map((evidence) => {
        return `- ${evidence.command} [${evidence.status}]: ${evidence.summary}`
      })
    : ['- No test evidence has been recorded.']
  const remediationLines =
    input.remediationPlan && input.retryAttempt
      ? [
          `Plan: ${input.remediationPlan.id} [${input.remediationPlan.status}] policyVersion=${input.remediationPlan.policyVersion}`,
          `Retry Attempt: ${input.retryAttempt.id} [${input.retryAttempt.status}]`,
          `Retry requested by: ${input.retryAttempt.requestedBy}`,
          ...input.remediationPlan.candidates
            .filter((candidate) => input.retryAttempt?.candidateIds.includes(candidate.id))
            .map((candidate) => {
              const reasons = candidate.sourceReasonIds.map((reasonId) => `Policy reason: ${reasonId}`).join('; ')
              return `- ${candidate.title} [${candidate.priority}]: ${candidate.summary}${reasons ? `\n  ${reasons}` : ''}`
            }),
        ]
      : []

  const prompt = [
    'DevFlow Coding Brief',
    '',
    'You are the DevFlow managed coding adapter. Work only inside the managed worktree.',
    '',
    `Run: ${input.run.title}`,
    `Request: ${input.run.request}`,
    `Node: ${input.node.title}`,
    `Node details: ${input.node.subtitle}`,
    `Managed worktree: ${input.worktreePath}`,
    `Branch: ${input.branchName}`,
    `Test command: ${input.project.testCommand || '(none configured)'}`,
    '',
    'Upstream Artifacts',
    artifactLines.join('\n'),
    '',
    'Knowledge References',
    knowledgeLines.join('\n'),
    '',
    'Governance Checks',
    governanceLines.join('\n'),
    '',
    'Gate Decisions',
    gateLines.join('\n'),
    '',
    'Existing Test Evidence',
    testEvidenceLines.join('\n'),
    '',
    ...(remediationLines.length
      ? ['Remediation Plan', remediationLines.join('\n'), '']
      : []),
    'User Instruction',
    userInstruction || 'Implement the node using the upstream context. Keep changes minimal and testable.',
    '',
    'Constraints',
    '- Do not read or write outside the managed worktree.',
    '- Ask permission before bash, edit, install, patch, or external-directory actions.',
    '- Do not include secrets, raw local paths, stdout, stderr, or provider keys in summaries.',
    '- Produce a minimal diff and leave test evidence for the configured test command.',
  ].join('\n')

  return {
    runId: input.run.id,
    nodeId: input.node.id,
    projectId: input.project.id,
    testCommand: input.project.testCommand,
    branchName: input.branchName,
    worktreePath: input.worktreePath,
    userInstruction,
    prompt,
  }
}

function safeKnowledgeSourcePath(sourcePath: string | undefined): string | undefined {
  if (!sourcePath) {
    return undefined
  }
  const normalized = sourcePath.replace(/\\/g, '/')
  if (
    normalized.startsWith('/') ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split('/').some((segment) => segment === '..')
  ) {
    return undefined
  }
  return redactSensitiveText(normalized).value.slice(0, 1_024)
}

export function selectDependencyBootstrap(
  snapshot: DependencyBootstrapSnapshot,
): DependencyBootstrapDecision {
  const packageManager = detectPackageManager(snapshot.files)
  const dependencyHash = hashDependencyInputs(snapshot.files)

  if (
    snapshot.nodeModulesPresent &&
    snapshot.previousDependencyHash &&
    snapshot.previousDependencyHash === dependencyHash
  ) {
    return {
      status: 'skipped',
      packageManager,
      command: '',
      dependencyHash,
      risk: 'safe',
      reason: 'node_modules exists and dependency manifest hash is unchanged.',
    }
  }

  const command = frozenInstallCommand(snapshot.files, packageManager)
  if (command) {
    return {
      status: 'required',
      packageManager,
      command,
      dependencyHash,
      risk: 'safe',
      reason: 'Dependency lockfile requires a frozen bootstrap before tests run in the managed worktree.',
    }
  }

  return {
    status: 'needs_approval',
    packageManager,
    command: packageManager === 'bun' ? 'bun install' : 'npm install --package-lock=false',
    dependencyHash,
    risk: 'warn',
    reason: 'No package-manager lockfile found; non-frozen dependency install requires human approval.',
  }
}

export function sanitizeCodingDiffArtifact(input: RawCodingDiffArtifact): CodingDiffArtifact {
  if (input.sourceDigest !== undefined && !/^[a-f0-9]{64}$/.test(input.sourceDigest)) {
    throw new Error('Coding Diff source digest must be a lowercase SHA-256 digest')
  }
  const filteredPaths = input.changedPaths.filter(isRepoRelativePath).slice(0, MAX_REMOTE_CHANGED_PATHS)
  const sanitizedAt = input.sanitizedAt ?? input.createdAt
  if (!Number.isFinite(Date.parse(sanitizedAt)) || new Date(sanitizedAt).toISOString() !== sanitizedAt) {
    throw new Error('Coding Diff sanitization timestamp must be canonical ISO-8601')
  }
  const redactedPatch = redactDiffLines(input.patch)
  const truncationMarker = `\n[TRUNCATED:diff_exceeded_${MAX_DIFF_CHARS}_chars]`
  const exceedsDiffLimit = redactedPatch.value.length > MAX_DIFF_CHARS
  const truncated =
    exceedsDiffLimit || redactedPatch.value.endsWith(truncationMarker)
  const patch = exceedsDiffLimit
    ? `${redactedPatch.value.slice(0, Math.max(0, MAX_DIFF_CHARS - truncationMarker.length))}${truncationMarker}`
    : redactedPatch.value

  return {
    id: input.id,
    runId: input.runId,
    nodeId: input.nodeId,
    projectId: input.projectId,
    changedPaths: filteredPaths,
    patch,
    ...(input.sourceDigest ? { sourceDigest: input.sourceDigest } : {}),
    truncated,
    redacted: redactedPatch.replacementCount > 0,
    sanitizerVersion: CURRENT_CODING_DIFF_SANITIZER_VERSION,
    sanitizedAt,
    secretReplacementCount: redactedPatch.replacementCount,
    createdAt: input.createdAt,
  }
}

export function createRemoteCodingAgentSummary(
  run: CodingAgentRun,
  diff?: CodingDiffArtifact,
): RemoteCodingAgentSummary {
  const changedPaths = (diff?.changedPaths ?? run.changedPaths).filter(isRepoRelativePath).slice(0, MAX_REMOTE_CHANGED_PATHS)

  return redactRemoteCodingAgentSummaryForSync({
    id: run.id,
    runId: run.runId,
    nodeId: run.nodeId,
    projectId: run.projectId,
    requestedBy: run.requestedBy,
    providerId: run.providerId,
    engine: run.engine,
    status: run.status,
    branchName: run.branchName,
    summary: run.summary,
    changedPaths,
    startedAt: run.startedAt,
    ...(run.completedAt ? { completedAt: run.completedAt } : {}),
    ...(run.runtimeCostSummary ? { costSummary: run.runtimeCostSummary } : {}),
    ...(run.budgetDecision ? { budgetDecision: run.budgetDecision } : {}),
    redacted: true,
  })
}

function redactRemoteCodingCostSummaryForSync(
  summary: NonNullable<RemoteCodingAgentSummary['costSummary']>,
): NonNullable<RemoteCodingAgentSummary['costSummary']> {
  return {
    id: summary.id,
    runId: summary.runId,
    nodeId: summary.nodeId,
    userId: summary.userId,
    projectId: summary.projectId,
    provider: summary.provider,
    providerId: summary.providerId,
    model: redactSensitiveText(summary.model).value,
    inputTokens: summary.inputTokens,
    outputTokens: summary.outputTokens,
    cacheReadTokens: summary.cacheReadTokens,
    ...(summary.cacheMissTokens !== undefined
      ? { cacheMissTokens: summary.cacheMissTokens }
      : {}),
    ...(summary.totalTokens !== undefined ? { totalTokens: summary.totalTokens } : {}),
    ...(summary.cacheHitRate !== undefined ? { cacheHitRate: summary.cacheHitRate } : {}),
    ...(summary.usageStatus !== undefined ? { usageStatus: summary.usageStatus } : {}),
    ...(summary.costStatus !== undefined ? { costStatus: summary.costStatus } : {}),
    ...(summary.phase !== undefined ? { phase: summary.phase } : {}),
    costUsd: summary.costUsd,
    ...(summary.pricingSnapshot !== undefined
      ? {
          pricingSnapshot: summary.pricingSnapshot
            ? {
                providerId: redactSensitiveText(summary.pricingSnapshot.providerId).value,
                model: redactSensitiveText(summary.pricingSnapshot.model).value,
                tier: summary.pricingSnapshot.tier,
                effectiveAt: summary.pricingSnapshot.effectiveAt,
                source: redactSensitiveText(summary.pricingSnapshot.source).value,
                sourceVersion: redactSensitiveText(summary.pricingSnapshot.sourceVersion).value,
                currency: summary.pricingSnapshot.currency,
                unit: summary.pricingSnapshot.unit,
                cacheHitInputUsdPerMillion: summary.pricingSnapshot.cacheHitInputUsdPerMillion,
                cacheMissInputUsdPerMillion: summary.pricingSnapshot.cacheMissInputUsdPerMillion,
                outputUsdPerMillion: summary.pricingSnapshot.outputUsdPerMillion,
              }
            : null,
        }
      : {}),
    ...(summary.breakdown !== undefined
      ? {
          breakdown: summary.breakdown
            ? {
                cacheHitInputUsd: summary.breakdown.cacheHitInputUsd,
                cacheMissInputUsd: summary.breakdown.cacheMissInputUsd,
                outputUsd: summary.breakdown.outputUsd,
                totalUsd: summary.breakdown.totalUsd,
              }
            : null,
        }
      : {}),
    ...(summary.providerCallSettlements !== undefined
      ? {
          providerCallSettlements: summary.providerCallSettlements.map((settlement) => ({
            requestPhase: settlement.requestPhase,
            providerId: redactSensitiveText(settlement.providerId).value,
            model: redactSensitiveText(settlement.model).value,
            inputTokens: settlement.inputTokens,
            outputTokens: settlement.outputTokens,
            cacheReadTokens: settlement.cacheReadTokens,
            cacheMissTokens: settlement.cacheMissTokens,
            totalTokens: settlement.totalTokens,
            cacheHitRate: settlement.cacheHitRate,
            usageStatus: settlement.usageStatus,
            costStatus: settlement.costStatus,
            costUsd: settlement.costUsd,
            pricingSnapshot: settlement.pricingSnapshot
              ? {
                  providerId: redactSensitiveText(settlement.pricingSnapshot.providerId).value,
                  model: redactSensitiveText(settlement.pricingSnapshot.model).value,
                  tier: settlement.pricingSnapshot.tier,
                  effectiveAt: settlement.pricingSnapshot.effectiveAt,
                  source: redactSensitiveText(settlement.pricingSnapshot.source).value,
                  sourceVersion: redactSensitiveText(settlement.pricingSnapshot.sourceVersion).value,
                  currency: settlement.pricingSnapshot.currency,
                  unit: settlement.pricingSnapshot.unit,
                  cacheHitInputUsdPerMillion:
                    settlement.pricingSnapshot.cacheHitInputUsdPerMillion,
                  cacheMissInputUsdPerMillion:
                    settlement.pricingSnapshot.cacheMissInputUsdPerMillion,
                  outputUsdPerMillion: settlement.pricingSnapshot.outputUsdPerMillion,
                }
              : null,
            breakdown: settlement.breakdown
              ? {
                  cacheHitInputUsd: settlement.breakdown.cacheHitInputUsd,
                  cacheMissInputUsd: settlement.breakdown.cacheMissInputUsd,
                  outputUsd: settlement.breakdown.outputUsd,
                  totalUsd: settlement.breakdown.totalUsd,
                }
              : null,
            timestamp: settlement.timestamp,
            source: settlement.source,
            redacted: true,
          })),
        }
      : {}),
    timestamp: summary.timestamp,
    source: summary.source,
    redacted: true,
  }
}

function redactRemoteBudgetDecisionForSync(
  decision: NonNullable<RemoteCodingAgentSummary['budgetDecision']>,
): NonNullable<RemoteCodingAgentSummary['budgetDecision']> {
  return {
    status: decision.status,
    blocksRun: decision.blocksRun,
    currentSpendUsd: decision.currentSpendUsd,
    projectedCostUsd: decision.projectedCostUsd,
    ...(decision.limitUsd !== undefined ? { limitUsd: decision.limitUsd } : {}),
    ...(decision.approvalRequiredRole !== undefined
      ? { approvalRequiredRole: decision.approvalRequiredRole }
      : {}),
    ...(decision.approvalId !== undefined ? { approvalId: decision.approvalId } : {}),
    reason: redactSensitiveText(decision.reason).value,
  }
}

export function redactRemoteCodingAgentSummaryForSync(
  summary: RemoteCodingAgentSummary,
): RemoteCodingAgentSummary {
  assertCanonicalLocalNodeId(summary.runId, summary.nodeId)
  if (summary.costSummary) {
    assertCanonicalLocalNodeId(
      summary.costSummary.runId,
      summary.costSummary.nodeId,
    )
    if (
      summary.costSummary.runId !== summary.runId ||
      summary.costSummary.nodeId !== summary.nodeId ||
      summary.costSummary.projectId !== summary.projectId
    ) {
      throw new Error(
        'Remote coding cost scope must match its coding summary.',
      )
    }
  }
  return {
    id: summary.id,
    runId: summary.runId,
    nodeId: summary.nodeId,
    projectId: summary.projectId,
    requestedBy: summary.requestedBy,
    providerId: summary.providerId,
    engine: summary.engine,
    status: summary.status,
    branchName: redactSensitiveText(summary.branchName).value,
    summary: redactSensitiveText(summary.summary).value,
    changedPaths: summary.changedPaths
      .filter(isRepoRelativePath)
      .slice(0, MAX_REMOTE_CHANGED_PATHS),
    startedAt: summary.startedAt,
    ...(summary.completedAt ? { completedAt: summary.completedAt } : {}),
    ...(summary.costSummary
      ? { costSummary: redactRemoteCodingCostSummaryForSync(summary.costSummary) }
      : {}),
    ...(summary.budgetDecision
      ? { budgetDecision: redactRemoteBudgetDecisionForSync(summary.budgetDecision) }
      : {}),
    redacted: true,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function hasLocalOnlyCodingField(value: Record<string, unknown>): boolean {
  return (
    'cwd' in value ||
    'stdout' in value ||
    'stderr' in value ||
    'prompt' in value ||
    'patch' in value ||
    'rawTrace' in value ||
    'providerSecret' in value ||
    'secret' in value
  )
}

function isRemoteCodingCostSummary(value: unknown): boolean {
  if (!isRecord(value) || hasLocalOnlyCodingField(value)) return false
  return (
    typeof value['id'] === 'string' &&
    typeof value['runId'] === 'string' &&
    typeof value['nodeId'] === 'string' &&
    typeof value['userId'] === 'string' &&
    typeof value['projectId'] === 'string' &&
    (value['provider'] === 'openai' || value['provider'] === 'anthropic' || value['provider'] === 'dashscope' || value['provider'] === 'local') &&
    typeof value['providerId'] === 'string' &&
    typeof value['model'] === 'string' &&
    typeof value['inputTokens'] === 'number' &&
    typeof value['outputTokens'] === 'number' &&
    (typeof value['cacheReadTokens'] === 'number' || value['cacheReadTokens'] === null) &&
    (typeof value['costUsd'] === 'number' || value['costUsd'] === null) &&
    typeof value['timestamp'] === 'string' &&
    (value['source'] === 'provider_reported' || value['source'] === 'estimated') &&
    value['redacted'] === true &&
    isOptionalRuntimeCostDetails(value)
  )
}

export function parseCodingRuntimeCostSummary(value: unknown): CodingRuntimeCostSummary {
  if (!isRemoteCodingCostSummary(value)) {
    throw new Error('Invalid coding runtime cost summary')
  }
  return redactRemoteCodingCostSummaryForSync(value as CodingRuntimeCostSummary)
}

function isOptionalRuntimeCostDetails(value: Record<string, unknown>): boolean {
  const optionalNumberOrNull = (entry: unknown) =>
    entry === undefined || entry === null || (typeof entry === 'number' && Number.isFinite(entry) && entry >= 0)
  if (
    !Number.isSafeInteger(value['inputTokens']) ||
    Number(value['inputTokens']) < 0 ||
    !Number.isSafeInteger(value['outputTokens']) ||
    Number(value['outputTokens']) < 0 ||
    (value['cacheReadTokens'] !== null &&
      (!Number.isSafeInteger(value['cacheReadTokens']) || Number(value['cacheReadTokens']) < 0)) ||
    !optionalNumberOrNull(value['cacheMissTokens']) ||
    !optionalNumberOrNull(value['cacheHitRate']) ||
    (value['totalTokens'] !== undefined &&
      (!Number.isSafeInteger(value['totalTokens']) || Number(value['totalTokens']) < 0)) ||
    (value['usageStatus'] !== undefined &&
      !['estimated', 'complete', 'incomplete', 'legacy_unknown'].includes(String(value['usageStatus']))) ||
    (value['costStatus'] !== undefined &&
      !['estimated', 'settled', 'unknown', 'legacy_unverified'].includes(String(value['costStatus']))) ||
    (value['phase'] !== undefined &&
      value['phase'] !== 'preflight_estimate' &&
      value['phase'] !== 'provider_settlement')
  ) {
    return false
  }
  if (value['pricingSnapshot'] !== undefined && value['pricingSnapshot'] !== null) {
    const snapshot = value['pricingSnapshot']
    if (
      !isRecord(snapshot) ||
      typeof snapshot['providerId'] !== 'string' ||
      typeof snapshot['model'] !== 'string' ||
      !['peak', 'off_peak', 'legacy_estimate'].includes(String(snapshot['tier'])) ||
      typeof snapshot['effectiveAt'] !== 'string' ||
      !Number.isFinite(Date.parse(snapshot['effectiveAt'])) ||
      new Date(Date.parse(snapshot['effectiveAt'])).toISOString() !== snapshot['effectiveAt'] ||
      typeof snapshot['source'] !== 'string' ||
      typeof snapshot['sourceVersion'] !== 'string' ||
      snapshot['currency'] !== 'USD' ||
      snapshot['unit'] !== 'per_1m_tokens' ||
      !['cacheHitInputUsdPerMillion', 'cacheMissInputUsdPerMillion', 'outputUsdPerMillion'].every(
        (key) => typeof snapshot[key] === 'number' && Number.isFinite(snapshot[key]) && Number(snapshot[key]) >= 0,
      )
    ) {
      return false
    }
  }
  if (value['breakdown'] !== undefined && value['breakdown'] !== null) {
    const breakdown = value['breakdown']
    if (
      !isRecord(breakdown) ||
      !['cacheHitInputUsd', 'cacheMissInputUsd', 'outputUsd', 'totalUsd'].every(
        (key) => typeof breakdown[key] === 'number' && Number.isFinite(breakdown[key]) && Number(breakdown[key]) >= 0,
      )
    ) {
      return false
    }
  }
  if (value['providerCallSettlements'] !== undefined) {
    const calls = value['providerCallSettlements']
    if (
      !Array.isArray(calls) ||
      calls.length < 1 ||
      calls.length > 32 ||
      !calls.every((call) =>
        isRecord(call) &&
        ['analysis', 'initial', 'repair'].includes(String(call['requestPhase'])) &&
        typeof call['providerId'] === 'string' &&
        typeof call['model'] === 'string' &&
        typeof call['timestamp'] === 'string' &&
        Number.isFinite(Date.parse(call['timestamp'])) &&
        new Date(Date.parse(call['timestamp'])).toISOString() === call['timestamp'] &&
        (call['source'] === 'provider_reported' || call['source'] === 'estimated') &&
        call['redacted'] === true &&
        isOptionalRuntimeCostDetails(call),
      )
    ) {
      return false
    }
  }
  const usageStatus = value['usageStatus']
  const costStatus = value['costStatus']
  if (usageStatus === 'complete') {
    if (
      !Number.isSafeInteger(value['cacheReadTokens']) ||
      !Number.isSafeInteger(value['cacheMissTokens']) ||
      Number(value['cacheReadTokens']) + Number(value['cacheMissTokens']) !== Number(value['inputTokens']) ||
      (value['totalTokens'] !== undefined &&
        Number(value['totalTokens']) !== Number(value['inputTokens']) + Number(value['outputTokens']))
    ) {
      return false
    }
  }
  if (
    (usageStatus === 'incomplete' || usageStatus === 'legacy_unknown') &&
    value['cacheReadTokens'] !== null
  ) {
    return false
  }
  if (costStatus === 'settled') {
    const calls = value['providerCallSettlements']
    const hasAuditableCallPricing = Array.isArray(calls) && calls.length > 0 && calls.every(
      (call) => isRecord(call) && call['costStatus'] === 'settled' && isRecord(call['pricingSnapshot']),
    )
    if (
      typeof value['costUsd'] !== 'number' ||
      (!isRecord(value['pricingSnapshot']) && !hasAuditableCallPricing) ||
      !isRecord(value['breakdown']) ||
      Math.abs(Number(value['breakdown']['totalUsd']) - value['costUsd']) > 1e-9
    ) {
      return false
    }
  }
  if (costStatus === 'unknown' && (value['costUsd'] !== null || value['breakdown'] !== null)) {
    return false
  }
  return true
}

function isRemoteBudgetDecision(value: unknown): boolean {
  if (!isRecord(value) || hasLocalOnlyCodingField(value)) return false
  try {
    parseBudgetGuardDecision(value)
    return true
  } catch {
    return false
  }
}

export function parseRemoteCodingAgentSummary(value: unknown): RemoteCodingAgentSummary {
  if (isRecord(value) && hasLocalOnlyCodingField(value)) {
    throw new Error('Remote coding agent summary contains local-only fields')
  }
  if (!isRecord(value)) {
    throw new Error('Invalid remote coding agent summary payload')
  }
  const status = value['status']
  const validStatus =
    status === 'queued' ||
    status === 'preparing' ||
    status === 'waiting_permission' ||
    status === 'bootstrapping' ||
    status === 'running' ||
    status === 'applying' ||
    status === 'testing' ||
    status === 'completed' ||
    status === 'failed' ||
    status === 'timed_out' ||
    status === 'interrupted' ||
    status === 'cancelled'
  if (!(
    typeof value['id'] === 'string' &&
    typeof value['runId'] === 'string' &&
    typeof value['nodeId'] === 'string' &&
    typeof value['projectId'] === 'string' &&
    typeof value['requestedBy'] === 'string' &&
    typeof value['providerId'] === 'string' &&
    (value['engine'] === 'fake' || value['engine'] === 'native' || value['engine'] === 'opencode-http' || value['engine'] === 'opencode-acp') &&
    validStatus &&
    typeof value['branchName'] === 'string' &&
    typeof value['summary'] === 'string' &&
    Array.isArray(value['changedPaths']) &&
    value['changedPaths'].length <= MAX_REMOTE_CHANGED_PATHS &&
    value['changedPaths'].every(isRepoRelativePath) &&
    typeof value['startedAt'] === 'string' &&
    (value['completedAt'] === undefined || typeof value['completedAt'] === 'string') &&
    (value['costSummary'] === undefined || isRemoteCodingCostSummary(value['costSummary'])) &&
    (value['budgetDecision'] === undefined || isRemoteBudgetDecision(value['budgetDecision'])) &&
    value['redacted'] === true
  )) {
    throw new Error('Invalid remote coding agent summary payload')
  }
  return redactRemoteCodingAgentSummaryForSync(value as unknown as RemoteCodingAgentSummary)
}

function frozenInstallCommand(files: Record<string, string>, packageManager: PackageManager): string {
  if ('pnpm-lock.yaml' in files) {
    return 'corepack pnpm install --frozen-lockfile'
  }
  if ('package-lock.json' in files || 'npm-shrinkwrap.json' in files) {
    return 'npm ci'
  }
  if ('yarn.lock' in files) {
    return 'corepack yarn install --immutable'
  }
  if ('bun.lock' in files || 'bun.lockb' in files) {
    return 'bun install --frozen-lockfile'
  }
  return packageManager === 'unknown' ? '' : ''
}

function hashDependencyInputs(files: Record<string, string>): string {
  const relevant = [
    'package.json',
    'pnpm-lock.yaml',
    'package-lock.json',
    'npm-shrinkwrap.json',
    'yarn.lock',
    'bun.lock',
    'bun.lockb',
  ]
  let hash = 2166136261
  for (const fileName of relevant) {
    const content = files[fileName]
    if (content === undefined) {
      continue
    }
    const line = `${fileName}\0${content}\0`
    for (let index = 0; index < line.length; index += 1) {
      hash ^= line.charCodeAt(index)
      hash = Math.imul(hash, 16777619)
    }
  }
  return `fnv1a-${(hash >>> 0).toString(16)}`
}

function redactDiffLines(patch: string): { value: string; replacementCount: number } {
  let replacementCount = 0
  const lines = patch.split('\n').map((line) => {
    replacementCount += countCanonicalSecretRedactionMarkers(line)
    const result = redactSecrets(line)
    replacementCount += result.replacementCount
    return result.value
  })

  return {
    value: lines.join('\n'),
    replacementCount,
  }
}

function isRepoRelativePath(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const normalized = value.replace(/\\/g, '/').trim()
  if (!normalized || normalized.startsWith('/') || normalized.startsWith('../') || normalized.includes('/../')) {
    return false
  }
  if (/^[A-Za-z]:\//.test(normalized)) {
    return false
  }
  return true
}
