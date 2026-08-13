import {
  createRemoteAgentRuntimeSummary,
  createRemoteAgentReviewSummary,
  createRemoteCodingAgentSummary,
  createRemoteRunSummary,
  createRemoteTestEvidenceSummary,
  resolveTeamProjectId,
  type AgentReviewResult,
  type AgentRuntimeState,
  type CodingAgentRun,
  type CodingDiffArtifact,
  type DesktopPairingCredential,
  type RemoteSyncUploadResult,
  type TestEvidence,
  type WorkflowRun,
} from '@ai-devflow/shared'
import { RemoteSyncHttpError, type RemoteSyncClient } from './remote-sync'

type PairingCredentialSource = {
  getDesktopPairingCredential(): Promise<DesktopPairingCredential | null>
  getAgentRuntime?(runtimeId: string): Promise<AgentRuntimeState | null>
  listRuns(): Promise<WorkflowRun[]>
  listTestEvidence(runId?: string): Promise<TestEvidence[]>
  listAgentReviews(runId?: string): Promise<AgentReviewResult[]>
  listCodingAgentRuns(runId?: string): Promise<CodingAgentRun[]>
  listCodingDiffArtifacts(runId?: string): Promise<CodingDiffArtifact[]>
}

export type CanonicalRemoteSyncEntityErrorCode =
  | 'entity_missing'
  | 'scope_mismatch'
  | 'invalid_response'
  | 'remote_error'
export type CanonicalRemoteSyncEntityKind =
  | 'workflow_run'
  | 'test_evidence'
  | 'agent_review'
  | 'agent_runtime'
  | 'coding_agent_run'
  | 'coding_diff'

export type ProjectBoundRemoteSyncScope = {
  localProjectId: string
  organizationId: string
  teamProjectId: string
}

export class CanonicalRemoteSyncEntityError extends Error {
  override readonly name = 'CanonicalRemoteSyncEntityError'

  constructor(
    readonly code: CanonicalRemoteSyncEntityErrorCode,
    readonly entityKind: CanonicalRemoteSyncEntityKind,
  ) {
    const messages: Record<CanonicalRemoteSyncEntityErrorCode, string> = {
      entity_missing: 'Canonical remote sync entity is missing.',
      scope_mismatch: 'Canonical remote sync entity scope does not match.',
      invalid_response: 'Canonical remote sync entity is invalid.',
      remote_error: 'Canonical remote sync summary was rejected.',
    }
    super(messages[code])
  }
}

export type ProjectBoundRemoteSync = Pick<
  RemoteSyncClient,
  | 'saveGateOverride'
  | 'evaluateRuntimeBudget'
> & {
  uploadCanonicalRunSummary(runId: string): Promise<RemoteSyncUploadResult>
  uploadCanonicalTestEvidenceSummary(evidenceId: string): Promise<RemoteSyncUploadResult>
  uploadCanonicalAgentReviewSummary(reviewId: string): Promise<RemoteSyncUploadResult>
  uploadCanonicalCodingAgentSummary(codingRunId: string): Promise<RemoteSyncUploadResult>
  uploadCanonicalAgentRuntimeSummary(runtimeId: string): Promise<RemoteSyncUploadResult>
}

async function bindProjectId<T extends { projectId: string }>(
  payload: T,
  credentialSource: PairingCredentialSource,
): Promise<T> {
  const credential = await credentialSource.getDesktopPairingCredential()
  const projectId = resolveTeamProjectId({ localProjectId: payload.projectId, credential })

  return { ...payload, projectId }
}

function bindCanonicalProjectId<T extends { projectId: string }>(
  payload: T,
  scope: ProjectBoundRemoteSyncScope,
  entityKind: CanonicalRemoteSyncEntityKind,
): T {
  if (payload.projectId !== scope.localProjectId) {
    throw new CanonicalRemoteSyncEntityError('scope_mismatch', entityKind)
  }
  return { ...payload, projectId: scope.teamProjectId }
}

export function createProjectBoundRemoteSync(input: {
  remoteSync: RemoteSyncClient
  credentialSource: PairingCredentialSource
  expectedScope?: ProjectBoundRemoteSyncScope
}): ProjectBoundRemoteSync {
  const configuredScope = input.expectedScope ? { ...input.expectedScope } : undefined

  async function freezeCanonicalScope(): Promise<ProjectBoundRemoteSyncScope> {
    if (configuredScope) {
      return configuredScope
    }
    const credential = await input.credentialSource.getDesktopPairingCredential()
    const localProjectId = credential?.localProjectId ?? ''
    return {
      localProjectId,
      organizationId: credential?.organizationId ?? '',
      teamProjectId: resolveTeamProjectId({ localProjectId, credential }),
    }
  }

  function isCanonicalRunRequiredError(error: unknown): boolean {
    return (
      error instanceof RemoteSyncHttpError &&
      error.status === 409 &&
      error.code === 'canonical_run_required'
    )
  }

  function requireAccepted(
    result: RemoteSyncUploadResult,
    entityKind: CanonicalRemoteSyncEntityKind,
  ): RemoteSyncUploadResult {
    if (!result.accepted) {
      throw new CanonicalRemoteSyncEntityError('remote_error', entityKind)
    }
    return result
  }

  function buildCanonicalSummary<T>(
    entityKind: CanonicalRemoteSyncEntityKind,
    build: () => T,
  ): T {
    try {
      return build()
    } catch (error) {
      if (error instanceof CanonicalRemoteSyncEntityError) {
        throw error
      }
      throw new CanonicalRemoteSyncEntityError('invalid_response', entityKind)
    }
  }

  async function uploadCanonicalRun(
    runId: string,
    scope: ProjectBoundRemoteSyncScope,
  ): Promise<RemoteSyncUploadResult> {
    const run = (await input.credentialSource.listRuns()).find(
      (candidate) => candidate.id === runId,
    )
    if (!run) {
      throw new CanonicalRemoteSyncEntityError('entity_missing', 'workflow_run')
    }

    const result = await input.remoteSync.uploadRunSummary(
      bindCanonicalProjectId(
        buildCanonicalSummary('workflow_run', () => createRemoteRunSummary(run, 'run')),
        scope,
        'workflow_run',
      ),
    )
    return requireAccepted(result, 'workflow_run')
  }

  async function uploadDependentSummary(
    runId: string,
    scope: ProjectBoundRemoteSyncScope,
    entityKind: CanonicalRemoteSyncEntityKind,
    upload: () => Promise<RemoteSyncUploadResult>,
  ): Promise<RemoteSyncUploadResult> {
    try {
      return requireAccepted(await upload(), entityKind)
    } catch (error) {
      if (!isCanonicalRunRequiredError(error)) {
        throw error
      }
      await uploadCanonicalRun(runId, scope)
      return requireAccepted(await upload(), entityKind)
    }
  }

  return {
    async uploadCanonicalRunSummary(runId) {
      return uploadCanonicalRun(runId, await freezeCanonicalScope())
    },
    async uploadCanonicalTestEvidenceSummary(evidenceId) {
      const scope = await freezeCanonicalScope()
      const evidence = (await input.credentialSource.listTestEvidence()).find(
        (candidate) => candidate.id === evidenceId,
      )
      if (!evidence) {
        throw new CanonicalRemoteSyncEntityError('entity_missing', 'test_evidence')
      }
      const canonicalRun = (await input.credentialSource.listRuns()).find(
        (candidate) => candidate.id === evidence.runId,
      )
      if (!canonicalRun) {
        throw new CanonicalRemoteSyncEntityError('entity_missing', 'workflow_run')
      }
      if (
        evidence.runId !== canonicalRun.id ||
        evidence.projectId !== canonicalRun.projectId ||
        !canonicalRun.nodes.some((node) => node.id === evidence.nodeId)
      ) {
        throw new CanonicalRemoteSyncEntityError('scope_mismatch', 'test_evidence')
      }
      const summary = bindCanonicalProjectId(
        buildCanonicalSummary('test_evidence', () => createRemoteTestEvidenceSummary(evidence)),
        scope,
        'test_evidence',
      )
      return uploadDependentSummary(evidence.runId, scope, 'test_evidence', () =>
        input.remoteSync.uploadTestEvidenceSummary(summary),
      )
    },
    async uploadCanonicalAgentReviewSummary(reviewId) {
      const scope = await freezeCanonicalScope()
      const review = (await input.credentialSource.listAgentReviews()).find(
        (candidate) => candidate.id === reviewId,
      )
      if (!review) {
        throw new CanonicalRemoteSyncEntityError('entity_missing', 'agent_review')
      }
      const canonicalRun = (await input.credentialSource.listRuns()).find(
        (candidate) => candidate.id === review.runId,
      )
      if (!canonicalRun) {
        throw new CanonicalRemoteSyncEntityError('entity_missing', 'workflow_run')
      }
      if (
        review.projectId !== canonicalRun.projectId ||
        !canonicalRun.nodes.some((node) => node.id === review.nodeId) ||
        review.gateAdvisory.runId !== review.runId ||
        review.gateAdvisory.nodeId !== review.nodeId ||
        review.policyFindings.some(
          (finding) =>
            finding.reviewId !== review.id ||
            finding.runId !== review.runId ||
            finding.nodeId !== review.nodeId,
        )
      ) {
        throw new CanonicalRemoteSyncEntityError('scope_mismatch', 'agent_review')
      }
      const summary = bindCanonicalProjectId(
        buildCanonicalSummary('agent_review', () => createRemoteAgentReviewSummary(review)),
        scope,
        'agent_review',
      )
      return uploadDependentSummary(review.runId, scope, 'agent_review', () =>
        input.remoteSync.uploadAgentReviewSummary(summary),
      )
    },
    async uploadCanonicalCodingAgentSummary(codingRunId) {
      const scope = await freezeCanonicalScope()
      const codingRun = (await input.credentialSource.listCodingAgentRuns()).find(
        (candidate) => candidate.id === codingRunId,
      )
      if (!codingRun) {
        throw new CanonicalRemoteSyncEntityError('entity_missing', 'coding_agent_run')
      }
      const canonicalRun = (await input.credentialSource.listRuns()).find(
        (candidate) => candidate.id === codingRun.runId,
      )
      if (!canonicalRun) {
        throw new CanonicalRemoteSyncEntityError('entity_missing', 'workflow_run')
      }
      if (
        codingRun.projectId !== canonicalRun.projectId ||
        !canonicalRun.nodes.some((node) => node.id === codingRun.nodeId)
      ) {
        throw new CanonicalRemoteSyncEntityError('scope_mismatch', 'coding_agent_run')
      }
      const runtimeCost = codingRun.runtimeCostSummary
      if (
        runtimeCost &&
        (runtimeCost.runId !== codingRun.runId ||
          runtimeCost.nodeId !== codingRun.nodeId ||
          runtimeCost.userId !== codingRun.requestedBy ||
          runtimeCost.projectId !== codingRun.projectId ||
          runtimeCost.providerId !== codingRun.providerId)
      ) {
        throw new CanonicalRemoteSyncEntityError('scope_mismatch', 'coding_agent_run')
      }
      const diff = codingRun.diffArtifactId
        ? (await input.credentialSource.listCodingDiffArtifacts()).find(
            (candidate) => candidate.id === codingRun.diffArtifactId,
          )
        : undefined
      if (codingRun.diffArtifactId && !diff) {
        throw new CanonicalRemoteSyncEntityError('entity_missing', 'coding_diff')
      }
      if (
        diff &&
        (diff.runId !== codingRun.runId ||
          diff.nodeId !== codingRun.nodeId ||
          diff.projectId !== codingRun.projectId)
      ) {
        throw new CanonicalRemoteSyncEntityError('scope_mismatch', 'coding_diff')
      }
      const boundSummary = bindCanonicalProjectId(
        buildCanonicalSummary('coding_agent_run', () =>
          createRemoteCodingAgentSummary(codingRun, diff),
        ),
        scope,
        'coding_agent_run',
      )
      const summary = boundSummary.costSummary
        ? {
            ...boundSummary,
            costSummary: {
              ...boundSummary.costSummary,
              projectId: scope.teamProjectId,
            },
          }
        : boundSummary
      return uploadDependentSummary(codingRun.runId, scope, 'coding_agent_run', () =>
        input.remoteSync.uploadCodingAgentSummary(summary),
      )
    },
    async uploadCanonicalAgentRuntimeSummary(runtimeId) {
      const scope = await freezeCanonicalScope()
      const runtime = await input.credentialSource.getAgentRuntime?.(runtimeId)
      if (!runtime) {
        throw new CanonicalRemoteSyncEntityError('entity_missing', 'agent_runtime')
      }
      const canonicalRun = (await input.credentialSource.listRuns()).find(
        (candidate) => candidate.id === runtime.authority.runId,
      )
      if (!canonicalRun) {
        throw new CanonicalRemoteSyncEntityError('entity_missing', 'workflow_run')
      }
      if (
        runtime.scope.kind !== 'team' ||
        runtime.scope.organizationId !== scope.organizationId ||
        runtime.scope.projectId !== scope.teamProjectId ||
        runtime.scope.localProjectId !== scope.localProjectId ||
        canonicalRun.projectId !== scope.localProjectId ||
        runtime.authority.runVersion !== canonicalRun.version ||
        !canonicalRun.nodes.some((node) => node.id === runtime.authority.nodeId)
      ) {
        throw new CanonicalRemoteSyncEntityError('scope_mismatch', 'agent_runtime')
      }
      const summary = buildCanonicalSummary('agent_runtime', () =>
        createRemoteAgentRuntimeSummary(runtime),
      )
      return uploadDependentSummary(runtime.authority.runId, scope, 'agent_runtime', () =>
        input.remoteSync.uploadAgentRuntimeSummary(summary),
      )
    },
    async saveGateOverride(override) {
      return input.remoteSync.saveGateOverride(
        await bindProjectId(override, input.credentialSource),
      )
    },
    async evaluateRuntimeBudget(request) {
      return input.remoteSync.evaluateRuntimeBudget(
        await bindProjectId(request, input.credentialSource),
      )
    },
  }
}
