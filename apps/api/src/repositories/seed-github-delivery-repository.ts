import { createHash, randomUUID } from 'node:crypto'
import {
  assertFullGitCommitSha,
  assertSafeGitHubBranch,
  normalizeGitHubRepository,
  type GitHubDeliveryIntent,
  type GitHubRepositoryBinding,
} from '@ai-devflow/shared'
import {
  cloneGitHubBranchPublication,
  cloneGitHubCredentialGrant,
  cloneGitHubDeliveryApproval,
  cloneGitHubDeliveryRequest,
  cloneGitHubRepositoryBinding,
  cloneGitHubPullRequestOutcome,
  fingerprintGitHubDeliveryRequest,
  GITHUB_CREDENTIAL_ISSUANCE_LEASE_MS,
  githubDeliveryRejection,
  normalizeGitHubDeliveryRequestIntent,
  type CreateOrReviseGitHubDeliveryRequestInput,
  type DecideGitHubDeliveryRequestInput,
  type FinalizeGitHubCredentialGrantInput,
  type FinalizeGitHubBranchPublicationInput,
  type FinalizeGitHubDraftPullRequestInput,
  type GitHubBranchPublication,
  type GitHubBranchPublicationFinalizationResult,
  type GitHubBranchPublicationReportResult,
  type GitHubCredentialGrant,
  type GitHubCredentialGrantMutationResult,
  type GitHubDeliveryAuthorityLookup,
  type GitHubDeliveryCanonicalRunAuthority,
  type GitHubDeliveryCanonicalRunAuthorityLookup,
  type GitHubDeliveryApproval,
  type GitHubDeliveryDecisionResult,
  type GitHubDeliveryDesktopPrincipal,
  type GitHubDeliveryDesktopAuthorityLookup,
  type GitHubDeliveryProjectRole,
  type GitHubDeliveryReadPrincipal,
  type GitHubDeliveryRecoverySnapshot,
  type GitHubDeliveryRepository,
  type GitHubDeliveryRequest,
  type GitHubDeliveryRequestMutationResult,
  type GitHubDeliverySessionPrincipal,
  type GitHubPullRequestMutationResult,
  type GitHubPullRequestOutcome,
  type GitHubRepositoryBindingMutationResult,
  type RevokeGitHubRepositoryBindingInput,
  type RecordGitHubBranchPublicationReportInput,
  type ReserveGitHubDraftPullRequestInput,
  type ReserveGitHubCredentialGrantInput,
  type UpsertGitHubRepositoryBindingInput,
} from './github-delivery-contract'

type MaybePromise<T> = T | Promise<T>
const MAX_CREDENTIAL_GRANT_ATTEMPTS = 3

export type SeedGitHubDeliveryRepositoryOptions = {
  resolveProjectRole(
    input: GitHubDeliveryAuthorityLookup,
  ): MaybePromise<GitHubDeliveryProjectRole>
  desktopTokenStillAuthorized(
    input: GitHubDeliveryDesktopAuthorityLookup,
  ): MaybePromise<boolean>
  resolveCanonicalRunAuthority(
    input: GitHubDeliveryCanonicalRunAuthorityLookup,
  ): MaybePromise<GitHubDeliveryCanonicalRunAuthority | null>
  now?: () => Date | string
  id?: (
    kind:
      | 'github-binding'
      | 'github-delivery'
      | 'github-approval'
      | 'github-grant'
      | 'github-publication'
      | 'github-pr-outcome',
  ) => string
}

type InternalRepositoryBinding = GitHubRepositoryBinding & {
  configuredByUserId: string
  updatedByUserId: string
  revokedAt: string | null
}

type InternalDeliveryRequest = GitHubDeliveryRequest & {
  requestedByTokenId: string
  requestFingerprint: string
}

type InternalCredentialGrant = GitHubCredentialGrant & {
  issuedToTokenId: string
}

export type SeedGitHubDeliveryRepository = GitHubDeliveryRepository & {
  inspectForTests(): {
    bindings: InternalRepositoryBinding[]
    requests: InternalDeliveryRequest[]
    approvals: GitHubDeliveryApproval[]
    grants: InternalCredentialGrant[]
    publications: GitHubBranchPublication[]
    pullRequests: GitHubPullRequestOutcome[]
    auditEvents: SeedGitHubDeliveryAuditEvent[]
  }
}

export type SeedGitHubDeliveryAuditEvent = {
  id: string
  organizationId: string
  projectId: string
  actorUserId: string
  actorRole: string
  authenticationKind: 'session_cookie' | 'desktop_bearer'
  operationKind:
    | 'github_binding_upsert'
    | 'github_binding_revoke'
    | 'github_delivery_submit'
    | 'github_delivery_revise'
    | 'github_delivery_approve'
    | 'github_delivery_reject'
    | 'github_delivery_grant'
    | 'github_branch_publication'
    | 'github_pull_request_create'
  recordId: string
  outcomeCode: string
  fingerprint: string
  createdAt: string
}

function isSessionPrincipal(
  principal: GitHubDeliveryReadPrincipal,
): principal is GitHubDeliverySessionPrincipal {
  return principal.authentication.kind === 'session_cookie'
}

export function createSeedGitHubDeliveryRepository(
  options: SeedGitHubDeliveryRepositoryOptions,
): SeedGitHubDeliveryRepository {
  const bindingsByProject = new Map<string, InternalRepositoryBinding>()
  const requestsByLogicalKey = new Map<string, InternalDeliveryRequest>()
  const approvals = new Map<string, GitHubDeliveryApproval>()
  const grants = new Map<string, InternalCredentialGrant>()
  const publications = new Map<string, GitHubBranchPublication>()
  const pullRequests = new Map<string, GitHubPullRequestOutcome>()
  const auditEvents: SeedGitHubDeliveryAuditEvent[] = []
  const now = options.now ?? (() => new Date())
  const nextId = options.id ?? (() => `github-binding-${randomUUID()}`)

  function timestamp(value = now()): string {
    const date = value instanceof Date ? value : new Date(value)
    if (!Number.isFinite(date.valueOf())) {
      throw new Error('Seed GitHub Delivery clock returned an invalid date.')
    }
    return date.toISOString()
  }

  function scope(organizationId: string, projectId: string): string {
    return JSON.stringify([organizationId, projectId])
  }

  function audit(
    principal: GitHubDeliveryReadPrincipal,
    projectId: string,
    operationKind: SeedGitHubDeliveryAuditEvent['operationKind'],
    recordId: string,
    outcomeCode: string,
    material: readonly unknown[],
    createdAt: string,
  ): void {
    auditEvents.push({
      id: `github-audit-${randomUUID()}`,
      organizationId: principal.session.organizationId,
      projectId,
      actorUserId: principal.session.userId,
      actorRole: principal.session.role,
      authenticationKind: principal.authentication.kind,
      operationKind,
      recordId,
      outcomeCode,
      fingerprint: createHash('sha256')
        .update(JSON.stringify([operationKind, recordId, ...material]), 'utf8')
        .digest('hex'),
      createdAt,
    })
  }

  async function liveRole(
    principal: GitHubDeliveryReadPrincipal,
    projectId: string,
  ): Promise<GitHubDeliveryProjectRole> {
    return options.resolveProjectRole({
      organizationId: principal.session.organizationId,
      projectId,
      userId: principal.session.userId,
    })
  }

  async function hasReadAuthority(
    principal: GitHubDeliveryReadPrincipal,
    projectId: string,
  ): Promise<boolean> {
    if ((await liveRole(principal, projectId)) === null) return false
    if (isSessionPrincipal(principal)) return true
    return (
      principal.authentication.tokenRecordId.length > 0 &&
      options.desktopTokenStillAuthorized({
        organizationId: principal.session.organizationId,
        projectId,
        userId: principal.session.userId,
        tokenRecordId: principal.authentication.tokenRecordId,
      })
    )
  }

  async function hasDesktopAuthority(
    principal: GitHubDeliveryDesktopPrincipal,
    projectId: string,
  ): Promise<boolean> {
    return (
      principal.authentication.kind === 'desktop_bearer' &&
      principal.authentication.tokenRecordId.length > 0 &&
      (await hasReadAuthority(principal, projectId))
    )
  }

  async function canonicalRunAuthority(
    input: {
      organizationId: string
      projectId: string
      runId: string
      runVersion: number
      nodeId: string
      tokenRecordId: string
    },
  ): Promise<'authorized' | 'claimant_forbidden' | 'stale'> {
    const authority = await options.resolveCanonicalRunAuthority({
      organizationId: input.organizationId,
      projectId: input.projectId,
      runId: input.runId,
    })
    if (
      !authority ||
      authority.organizationId !== input.organizationId ||
      authority.projectId !== input.projectId ||
      authority.runId !== input.runId ||
      authority.materializedByTokenRecordId !== input.tokenRecordId
    ) {
      return 'claimant_forbidden'
    }
    return authority.runVersion === input.runVersion &&
      authority.currentNodeId === input.nodeId
      ? 'authorized'
      : 'stale'
  }

  async function canonicalRequestAuthority(
    request: InternalDeliveryRequest,
  ): Promise<'authorized' | 'claimant_forbidden' | 'stale'> {
    return canonicalRunAuthority({
      organizationId: request.organizationId,
      projectId: request.projectId,
      runId: request.runId,
      runVersion: request.runVersion,
      nodeId: request.nodeId,
      tokenRecordId: request.requestedByTokenId,
    })
  }

  async function getGitHubRepositoryBinding(
    projectId: string,
    principal: GitHubDeliveryReadPrincipal,
  ): Promise<GitHubRepositoryBinding | null> {
    if (!(await hasReadAuthority(principal, projectId))) return null
    const binding = bindingsByProject.get(
      scope(principal.session.organizationId, projectId),
    )
    return binding ? cloneGitHubRepositoryBinding(binding) : null
  }

  async function upsertGitHubRepositoryBinding(
    input: UpsertGitHubRepositoryBindingInput,
    principal: GitHubDeliverySessionPrincipal,
  ): Promise<GitHubRepositoryBindingMutationResult> {
    if (principal.authentication.kind !== 'session_cookie') {
      return githubDeliveryRejection('authentication_forbidden')
    }
    const role = await liveRole(principal, input.projectId)
    if (role === null) return githubDeliveryRejection('project_forbidden')
    if (role !== 'owner') return githubDeliveryRejection('role_forbidden')

    const bindingScope = scope(
      principal.session.organizationId,
      input.projectId,
    )
    const existing = bindingsByProject.get(bindingScope)
    const expectedVersion = existing?.version ?? 0

    const at = timestamp()
    let validatedAt: string
    let repository: string
    let defaultBranch: string
    try {
      validatedAt = timestamp(input.verifiedAt)
      repository = normalizeGitHubRepository(input.repository)
      defaultBranch = assertSafeGitHubBranch(input.defaultBranch)
    } catch {
      return githubDeliveryRejection('invalid_state')
    }
    if (
      !/^[1-9][0-9]{0,19}$/u.test(input.installationId) ||
      !/^[1-9][0-9]{0,19}$/u.test(input.repositoryId) ||
      Date.parse(validatedAt) > Date.parse(at)
    ) {
      return githubDeliveryRejection('invalid_state')
    }
    if (
      existing?.status === 'active' &&
      input.expectedStateVersion === existing.version - 1 &&
      existing.installationId === input.installationId &&
      existing.repositoryId === input.repositoryId &&
      existing.repository === repository &&
      existing.defaultBranch === defaultBranch &&
      existing.validatedAt === validatedAt
    ) {
      const replayedCreate = existing.version === 1
      return {
        ok: true,
        responseStatus: replayedCreate ? 201 : 200,
        outcomeCode: replayedCreate ? 'binding_created' : 'binding_updated',
        replayed: true,
        binding: cloneGitHubRepositoryBinding(existing),
      }
    }
    if (input.expectedStateVersion !== expectedVersion) {
      return githubDeliveryRejection('stale_version')
    }
    const repositoryConflict = [...bindingsByProject.values()].some(
      (binding) =>
        binding.organizationId === principal.session.organizationId &&
        binding.teamProjectId !== input.projectId &&
        binding.status === 'active' &&
        binding.repositoryId === input.repositoryId,
    )
    if (repositoryConflict) return githubDeliveryRejection('binding_conflict')
    if (existing) invalidateDeliveriesForBinding(existing.id, at)
    const binding: InternalRepositoryBinding = {
      stateVersion: 1,
      id: existing?.id ?? nextId('github-binding'),
      version: expectedVersion + 1,
      organizationId: principal.session.organizationId,
      teamProjectId: input.projectId,
      installationId: input.installationId,
      repositoryId: input.repositoryId,
      repository,
      defaultBranch,
      status: 'active',
      configuredByUserId:
        existing?.configuredByUserId ?? principal.session.userId,
      updatedByUserId: principal.session.userId,
      validatedAt,
      revokedAt: null,
      updatedAt: at,
      redacted: true,
    }
    bindingsByProject.set(bindingScope, binding)
    audit(
      principal,
      input.projectId,
      'github_binding_upsert',
      binding.id,
      existing ? 'binding_updated' : 'binding_created',
      [binding.version, binding.repositoryId],
      at,
    )
    return {
      ok: true,
      responseStatus: existing ? 200 : 201,
      outcomeCode: existing ? 'binding_updated' : 'binding_created',
      replayed: false,
      binding: cloneGitHubRepositoryBinding(binding),
    }
  }

  async function revokeGitHubRepositoryBinding(
    input: RevokeGitHubRepositoryBindingInput,
    principal: GitHubDeliverySessionPrincipal,
  ): Promise<GitHubRepositoryBindingMutationResult> {
    if (principal.authentication.kind !== 'session_cookie') {
      return githubDeliveryRejection('authentication_forbidden')
    }
    const role = await liveRole(principal, input.projectId)
    if (role === null) return githubDeliveryRejection('project_forbidden')
    if (role !== 'owner') return githubDeliveryRejection('role_forbidden')
    const existing = bindingsByProject.get(
      scope(principal.session.organizationId, input.projectId),
    )
    if (!existing) return githubDeliveryRejection('not_found')
    if (
      existing.status === 'revoked' &&
      input.expectedStateVersion === existing.version - 1
    ) {
      return {
        ok: true,
        responseStatus: 200,
        outcomeCode: 'binding_revoked',
        replayed: true,
        binding: cloneGitHubRepositoryBinding(existing),
      }
    }
    if (existing.version !== input.expectedStateVersion) {
      return githubDeliveryRejection('stale_version')
    }
    if (existing.status === 'revoked') {
      return githubDeliveryRejection('binding_inactive')
    }

    const at = timestamp()
    existing.version += 1
    existing.status = 'revoked'
    existing.updatedByUserId = principal.session.userId
    existing.revokedAt = at
    existing.updatedAt = at
    invalidateDeliveriesForBinding(existing.id, at)
    audit(
      principal,
      input.projectId,
      'github_binding_revoke',
      existing.id,
      'binding_revoked',
      [existing.version],
      at,
    )
    return {
      ok: true,
      responseStatus: 200,
      outcomeCode: 'binding_revoked',
      replayed: false,
      binding: cloneGitHubRepositoryBinding(existing),
    }
  }

  function requestScope(
    organizationId: string,
    projectId: string,
    logicalIdempotencyKey: string,
  ): string {
    return JSON.stringify([
      organizationId,
      projectId,
      logicalIdempotencyKey,
    ])
  }

  function invalidateDeliveriesForBinding(bindingId: string, at: string): void {
    for (const request of requestsByLogicalKey.values()) {
      if (
        request.repositoryBindingId !== bindingId ||
        ['completed', 'failed', 'revoked'].includes(request.status)
      ) {
        continue
      }
      request.stateVersion += 1
      request.status = 'revoked'
      request.outcomeCode = 'binding_revoked'
      request.updatedAt = at
      for (const grant of grants.values()) {
        if (
          grant.requestId === request.id &&
          grant.intentRevision === request.intentRevision &&
          ['issuing', 'issued', 'recovery_required'].includes(grant.status)
        ) {
          grant.version += 1
          grant.status = 'revoked'
          grant.outcomeCode = 'binding_revoked'
        }
      }
    }
  }

  function hasCurrentBinding(request: InternalDeliveryRequest): boolean {
    const binding = bindingsByProject.get(
      scope(request.organizationId, request.projectId),
    )
    return Boolean(
      binding &&
        binding.status === 'active' &&
        binding.id === request.repositoryBindingId &&
        binding.version === request.repositoryBindingVersion &&
        binding.repositoryId === request.repositoryId &&
        binding.installationId === request.installationId,
    )
  }

  function validateIntent(
    input: CreateOrReviseGitHubDeliveryRequestInput,
    principal: GitHubDeliveryDesktopPrincipal,
    binding: InternalRepositoryBinding,
  ): GitHubDeliveryIntent | null {
    return normalizeGitHubDeliveryRequestIntent(input, {
      organizationId: principal.session.organizationId,
      projectId: input.projectId,
      binding: {
        id: binding.id,
        version: binding.version,
        installationId: binding.installationId,
        repositoryId: binding.repositoryId,
        repository: binding.repository,
        defaultBranch: binding.defaultBranch,
      },
    })
  }

  function assignIntent(
    request: InternalDeliveryRequest,
    intent: GitHubDeliveryIntent,
    input: CreateOrReviseGitHubDeliveryRequestInput,
  ): void {
    request.localIntentId = intent.id
    request.localProjectId = intent.localProjectId
    request.runId = intent.runId
    request.runVersion = intent.runVersion
    request.nodeId = intent.nodeId
    request.repositoryBindingId = intent.repositoryBindingId
    request.repositoryBindingVersion = intent.repositoryBindingVersion
    request.installationId = intent.installationId
    request.repositoryId = intent.repositoryId
    request.repository = intent.repository
    request.codingRunId = intent.codingRunId
    request.workspaceId = intent.workspaceId
    request.deliverySeriesKey = intent.deliverySeriesKey
    request.deliveryAttempt = intent.deliveryAttempt
    request.diffArtifactId = intent.diffArtifactId
    request.testEvidenceId = intent.testEvidenceId
    request.prPackageArtifactId = intent.prPackageArtifactId
    request.expectedRunVersion = intent.runVersion
    request.baseBranch = intent.baseBranch
    request.headBranch = intent.headBranch
    request.baseCommitSha = intent.baseCommitSha
    request.expectedCommitSha = intent.expectedCommitSha
    request.intentDigest = intent.intentDigest
    request.logicalIdempotencyKey = intent.idempotencyKey
    request.diffDigest = intent.diffSourceDigest
    request.testEvidenceDigest = intent.testEvidenceDigest
    request.packageDigest = intent.prPackageDigest
    request.changedPaths = [...intent.changedPaths]
    request.prTitle = input.prTitle
    request.prBody = input.prBody
    request.requestFingerprint = fingerprintGitHubDeliveryRequest(input)
  }

  async function createOrReviseGitHubDeliveryRequest(
    input: CreateOrReviseGitHubDeliveryRequestInput,
    principal: GitHubDeliveryDesktopPrincipal,
  ): Promise<GitHubDeliveryRequestMutationResult> {
    if (!(await hasDesktopAuthority(principal, input.projectId))) {
      return githubDeliveryRejection('project_forbidden')
    }
    const binding = bindingsByProject.get(
      scope(principal.session.organizationId, input.projectId),
    )
    if (!binding || binding.status !== 'active') {
      return githubDeliveryRejection('binding_inactive')
    }
    const intent = validateIntent(input, principal, binding)
    if (!intent) return githubDeliveryRejection('invalid_state')
    const runAuthority = await canonicalRunAuthority({
      organizationId: principal.session.organizationId,
      projectId: input.projectId,
      runId: intent.runId,
      runVersion: intent.runVersion,
      nodeId: intent.nodeId,
      tokenRecordId: principal.authentication.tokenRecordId,
    })
    if (runAuthority === 'claimant_forbidden') {
      return githubDeliveryRejection('project_forbidden')
    }
    if (runAuthority === 'stale') {
      return githubDeliveryRejection('invalid_state')
    }
    const deliveryScope = requestScope(
      principal.session.organizationId,
      input.projectId,
      intent.idempotencyKey,
    )
    const existing = requestsByLogicalKey.get(deliveryScope)
    const fingerprint = fingerprintGitHubDeliveryRequest(input)
    if (existing) {
      if (existing.requestedByTokenId !== principal.authentication.tokenRecordId) {
        return githubDeliveryRejection('project_forbidden')
      }
      if (existing.requestFingerprint === fingerprint) {
        const replayedCreate = existing.intentRevision === 1
        return {
          ok: true,
          responseStatus: replayedCreate ? 201 : 200,
          outcomeCode: replayedCreate
            ? 'delivery_created'
            : 'delivery_revised',
          replayed: true,
          request: cloneGitHubDeliveryRequest(existing),
        }
      }
      if (existing.stateVersion !== input.expectedStateVersion) {
        return githubDeliveryRejection('stale_version')
      }
      if (
        existing.status !== 'approval_required' &&
        existing.status !== 'approved'
      ) {
        return githubDeliveryRejection('intent_conflict')
      }
      const at = timestamp()
      const maximumExpiry =
        Date.parse(existing.createdAt) + 24 * 60 * 60 * 1_000
      if (Date.parse(at) >= maximumExpiry) {
        return githubDeliveryRejection('expired')
      }
      existing.stateVersion += 1
      existing.intentRevision += 1
      existing.status = 'approval_required'
      existing.outcomeCode = null
      existing.expiresAt = new Date(maximumExpiry).toISOString()
      existing.updatedAt = at
      assignIntent(existing, intent, input)
      audit(
        principal,
        input.projectId,
        'github_delivery_revise',
        existing.id,
        'delivery_revised',
        [existing.intentRevision, existing.intentDigest],
        at,
      )
      return {
        ok: true,
        responseStatus: 200,
        outcomeCode: 'delivery_revised',
        replayed: false,
        request: cloneGitHubDeliveryRequest(existing),
      }
    }
    if (input.expectedStateVersion !== 0) {
      return githubDeliveryRejection('stale_version')
    }
    const seriesAttempts = [...requestsByLogicalKey.values()]
      .filter(
        (request) =>
          request.organizationId === principal.session.organizationId &&
          request.projectId === input.projectId &&
          request.deliverySeriesKey === intent.deliverySeriesKey,
      )
      .sort((left, right) => right.deliveryAttempt - left.deliveryAttempt)
    const previousAttempt = seriesAttempts[0]
    if (
      (intent.deliveryAttempt === 1 && previousAttempt !== undefined) ||
      (intent.deliveryAttempt > 1 &&
        (!previousAttempt ||
          previousAttempt.deliveryAttempt !== intent.deliveryAttempt - 1 ||
          (previousAttempt.status !== 'failed' &&
            previousAttempt.status !== 'revoked')))
    ) {
      return githubDeliveryRejection('intent_conflict')
    }
    const competing = [...requestsByLogicalKey.values()].some(
      (request) =>
        request.organizationId === principal.session.organizationId &&
        request.projectId === input.projectId &&
        request.runId === intent.runId &&
        request.nodeId === intent.nodeId &&
        !['failed', 'revoked'].includes(request.status),
    )
    if (competing) return githubDeliveryRejection('intent_conflict')

    const at = timestamp()
    const request: InternalDeliveryRequest = {
      id: nextId('github-delivery'),
      stateVersion: 1,
      intentRevision: 1,
      organizationId: principal.session.organizationId,
      projectId: input.projectId,
      requestedByUserId: principal.session.userId,
      requestedByTokenId: principal.authentication.tokenRecordId,
      localIntentId: intent.id,
      localProjectId: intent.localProjectId,
      runId: intent.runId,
      runVersion: intent.runVersion,
      nodeId: intent.nodeId,
      repositoryBindingId: intent.repositoryBindingId,
      repositoryBindingVersion: intent.repositoryBindingVersion,
      installationId: intent.installationId,
      repositoryId: intent.repositoryId,
      repository: intent.repository,
      codingRunId: intent.codingRunId,
      workspaceId: intent.workspaceId,
      deliverySeriesKey: intent.deliverySeriesKey,
      deliveryAttempt: intent.deliveryAttempt,
      diffArtifactId: intent.diffArtifactId,
      testEvidenceId: intent.testEvidenceId,
      prPackageArtifactId: intent.prPackageArtifactId,
      status: 'approval_required',
      outcomeCode: null,
      expectedRunVersion: intent.runVersion,
      baseBranch: intent.baseBranch,
      headBranch: intent.headBranch,
      baseCommitSha: intent.baseCommitSha,
      expectedCommitSha: intent.expectedCommitSha,
      intentDigest: intent.intentDigest,
      logicalIdempotencyKey: intent.idempotencyKey,
      diffDigest: intent.diffSourceDigest,
      testEvidenceDigest: intent.testEvidenceDigest,
      packageDigest: intent.prPackageDigest,
      changedPaths: [...intent.changedPaths],
      prTitle: input.prTitle,
      prBody: input.prBody,
      expiresAt: new Date(
        Date.parse(at) + 24 * 60 * 60 * 1_000,
      ).toISOString(),
      createdAt: at,
      updatedAt: at,
      redacted: true,
      requestFingerprint: fingerprint,
    }
    requestsByLogicalKey.set(deliveryScope, request)
    audit(
      principal,
      input.projectId,
      'github_delivery_submit',
      request.id,
      'delivery_created',
      [request.intentRevision, request.intentDigest],
      at,
    )
    return {
      ok: true,
      responseStatus: 201,
      outcomeCode: 'delivery_created',
      replayed: false,
      request: cloneGitHubDeliveryRequest(request),
    }
  }

  async function listGitHubDeliveryInbox(
    projectId: string,
    principal: GitHubDeliveryDesktopPrincipal,
  ): Promise<GitHubDeliveryRequest[]> {
    if (!(await hasDesktopAuthority(principal, projectId))) return []
    return [...requestsByLogicalKey.values()]
      .filter(
        (request) =>
          request.organizationId === principal.session.organizationId &&
          request.projectId === projectId &&
          request.requestedByTokenId === principal.authentication.tokenRecordId,
      )
      .map(cloneGitHubDeliveryRequest)
  }

  async function getGitHubDeliveryRecoverySnapshot(
    projectId: string,
    requestId: string,
    principal: GitHubDeliveryDesktopPrincipal,
  ): Promise<GitHubDeliveryRecoverySnapshot | null> {
    if (!(await hasDesktopAuthority(principal, projectId))) return null
    const request = findRequest(
      requestId,
      principal.session.organizationId,
      projectId,
    )
    if (
      !request ||
      request.requestedByTokenId !== principal.authentication.tokenRecordId
    ) {
      return null
    }
    const approval = currentApproval(request)
    const grant = currentGrant(request)
    const publication = currentPublication(request)
    const pullRequest = currentPullRequest(request)
    return {
      request: cloneGitHubDeliveryRequest(request),
      approval: approval ? cloneGitHubDeliveryApproval(approval) : null,
      grant: grant ? cloneGitHubCredentialGrant(grant) : null,
      publication: publication ? cloneGitHubBranchPublication(publication) : null,
      pullRequest: pullRequest ? cloneGitHubPullRequestOutcome(pullRequest) : null,
    }
  }

  async function listGitHubDeliveryRequests(
    projectId: string,
    principal: GitHubDeliverySessionPrincipal,
  ): Promise<GitHubDeliveryRequest[]> {
    if (
      principal.authentication.kind !== 'session_cookie' ||
      (await liveRole(principal, projectId)) === null
    ) {
      return []
    }
    return [...requestsByLogicalKey.values()]
      .filter(
        (request) =>
          request.organizationId === principal.session.organizationId &&
          request.projectId === projectId,
      )
      .map(cloneGitHubDeliveryRequest)
  }

  function findRequest(
    requestId: string,
    organizationId: string,
    projectId: string,
  ): InternalDeliveryRequest | null {
    return (
      [...requestsByLogicalKey.values()].find(
        (request) =>
          request.id === requestId &&
          request.organizationId === organizationId &&
          request.projectId === projectId,
      ) ?? null
    )
  }

  function currentApproval(
    request: InternalDeliveryRequest,
  ): GitHubDeliveryApproval | null {
    return (
      [...approvals.values()].find(
        (approval) =>
          approval.requestId === request.id &&
          approval.intentRevision === request.intentRevision,
      ) ?? null
    )
  }

  async function decideGitHubDeliveryRequest(
    input: DecideGitHubDeliveryRequestInput,
    principal: GitHubDeliverySessionPrincipal,
  ): Promise<GitHubDeliveryDecisionResult> {
    if (principal.authentication.kind !== 'session_cookie') {
      return githubDeliveryRejection('authentication_forbidden')
    }
    const role = await liveRole(principal, input.projectId)
    if (role === null) return githubDeliveryRejection('project_forbidden')
    if (role !== 'lead' && role !== 'owner') {
      return githubDeliveryRejection('role_forbidden')
    }
    const request = findRequest(
      input.requestId,
      principal.session.organizationId,
      input.projectId,
    )
    if (!request) return githubDeliveryRejection('not_found')
    const existingApproval = currentApproval(request)
    if (
      input.decision === 'reject' &&
      request.status === 'revoked' &&
      request.outcomeCode === 'approval_rejected'
    ) {
      return {
        ok: true,
        responseStatus: 200,
        outcomeCode: 'delivery_rejected',
        replayed: true,
        request: cloneGitHubDeliveryRequest(request),
        approval: null,
      }
    }
    if (
      input.decision === 'approve' &&
      request.status === 'approved' &&
      existingApproval?.approvedByUserId === principal.session.userId
    ) {
      return {
        ok: true,
        responseStatus: 200,
        outcomeCode: 'delivery_approved',
        replayed: true,
        request: cloneGitHubDeliveryRequest(request),
        approval: cloneGitHubDeliveryApproval(existingApproval),
      }
    }
    if (request.stateVersion !== input.expectedStateVersion) {
      return githubDeliveryRejection('stale_version')
    }
    if (request.status !== 'approval_required') {
      return githubDeliveryRejection('approval_conflict')
    }
    if (input.decision === 'approve') {
      const runAuthority = await canonicalRequestAuthority(request)
      if (runAuthority === 'claimant_forbidden') {
        return githubDeliveryRejection('project_forbidden')
      }
      if (runAuthority === 'stale') {
        return githubDeliveryRejection('invalid_state')
      }
    }
    if (Date.parse(timestamp()) >= Date.parse(request.expiresAt)) {
      return githubDeliveryRejection('expired')
    }
    const binding = bindingsByProject.get(
      scope(request.organizationId, request.projectId),
    )
    if (
      !binding ||
      binding.status !== 'active' ||
      binding.id !== request.repositoryBindingId ||
      binding.version !== request.repositoryBindingVersion
    ) {
      return githubDeliveryRejection('binding_inactive')
    }
    const at = timestamp()
    if (input.decision === 'reject') {
      request.stateVersion += 1
      request.status = 'revoked'
      request.outcomeCode = 'approval_rejected'
      request.updatedAt = at
      audit(
        principal,
        input.projectId,
        'github_delivery_reject',
        request.id,
        'delivery_rejected',
        [request.intentRevision, request.intentDigest],
        at,
      )
      return {
        ok: true,
        responseStatus: 200,
        outcomeCode: 'delivery_rejected',
        replayed: false,
        request: cloneGitHubDeliveryRequest(request),
        approval: null,
      }
    }

    const approval: GitHubDeliveryApproval = {
      id: nextId('github-approval'),
      requestId: request.id,
      intentRevision: request.intentRevision,
      requestStateVersion: request.stateVersion,
      intentDigest: request.intentDigest,
      repositoryBindingId: request.repositoryBindingId,
      repositoryBindingVersion: request.repositoryBindingVersion,
      runId: request.runId,
      runVersion: request.runVersion,
      nodeId: request.nodeId,
      repositoryId: request.repositoryId,
      baseBranch: request.baseBranch,
      headBranch: request.headBranch,
      expectedCommitSha: request.expectedCommitSha,
      testEvidenceDigest: request.testEvidenceDigest,
      packageDigest: request.packageDigest,
      approvedByUserId: principal.session.userId,
      approvedRole: role,
      authenticationKind: 'session_cookie',
      approvedAt: at,
      redacted: true,
    }
    approvals.set(approval.id, approval)
    request.stateVersion += 1
    request.status = 'approved'
    request.updatedAt = at
    audit(
      principal,
      input.projectId,
      'github_delivery_approve',
      request.id,
      'delivery_approved',
      [approval.id, approval.intentRevision, approval.intentDigest],
      at,
    )
    return {
      ok: true,
      responseStatus: 200,
      outcomeCode: 'delivery_approved',
      replayed: false,
      request: cloneGitHubDeliveryRequest(request),
      approval: cloneGitHubDeliveryApproval(approval),
    }
  }

  function approvalMatchesRequest(
    approval: GitHubDeliveryApproval,
    request: InternalDeliveryRequest,
  ): boolean {
    return (
      approval.requestId === request.id &&
      approval.intentRevision === request.intentRevision &&
      approval.intentDigest === request.intentDigest &&
      approval.repositoryBindingId === request.repositoryBindingId &&
      approval.repositoryBindingVersion === request.repositoryBindingVersion &&
      approval.runId === request.runId &&
      approval.runVersion === request.runVersion &&
      approval.nodeId === request.nodeId &&
      approval.repositoryId === request.repositoryId &&
      approval.baseBranch === request.baseBranch &&
      approval.headBranch === request.headBranch &&
      approval.expectedCommitSha === request.expectedCommitSha &&
      approval.testEvidenceDigest === request.testEvidenceDigest &&
      approval.packageDigest === request.packageDigest
    )
  }

  function currentGrant(
    request: InternalDeliveryRequest,
  ): InternalCredentialGrant | null {
    return (
      [...grants.values()]
        .filter(
          (grant) =>
            grant.requestId === request.id &&
            grant.intentRevision === request.intentRevision,
        )
        .sort((left, right) => right.attempt - left.attempt)[0] ?? null
    )
  }

  async function reserveGitHubCredentialGrant(
    input: ReserveGitHubCredentialGrantInput,
    principal: GitHubDeliveryDesktopPrincipal,
  ): Promise<GitHubCredentialGrantMutationResult> {
    if (!(await hasDesktopAuthority(principal, input.projectId))) {
      return githubDeliveryRejection('project_forbidden')
    }
    const request = findRequest(
      input.requestId,
      principal.session.organizationId,
      input.projectId,
    )
    if (!request) return githubDeliveryRejection('not_found')
    if (request.requestedByTokenId !== principal.authentication.tokenRecordId) {
      return githubDeliveryRejection('project_forbidden')
    }
    const runAuthority = await canonicalRequestAuthority(request)
    if (runAuthority === 'claimant_forbidden') {
      return githubDeliveryRejection('project_forbidden')
    }
    if (runAuthority === 'stale') {
      return githubDeliveryRejection('invalid_state')
    }
    const existingGrant = currentGrant(request)
    const existingPublication = currentPublication(request)
    const at = timestamp()
    const staleIssuingGrant = Boolean(
      existingGrant?.status === 'issuing' &&
        request.status === 'publishing_branch' &&
        Date.parse(at) >=
          Date.parse(existingGrant.requestedAt) +
            GITHUB_CREDENTIAL_ISSUANCE_LEASE_MS,
    )
    const replacingLostIssuedCredential = Boolean(
      existingGrant?.status === 'issued' &&
        request.status === 'publishing_branch',
    )
    const consumedPublicationRecovery = Boolean(
      existingGrant?.status === 'consumed' &&
        existingPublication?.grantId === existingGrant.id &&
        ['recovery_required', 'conflict'].includes(existingPublication.status) &&
        request.status === 'recovery_required',
    )
    const retrying = Boolean(
      existingGrant &&
        (['failed', 'recovery_required', 'expired'].includes(
          existingGrant.status,
        ) ||
          staleIssuingGrant ||
          replacingLostIssuedCredential ||
          consumedPublicationRecovery),
    )
    if (
      retrying &&
      existingGrant &&
      existingGrant.attempt >= MAX_CREDENTIAL_GRANT_ATTEMPTS
    ) {
      return githubDeliveryRejection('grant_conflict')
    }
    if (
      existingGrant &&
      !retrying &&
      existingGrant.issuedToTokenId === principal.authentication.tokenRecordId
    ) {
      return {
        ok: true,
        responseStatus: 201,
        outcomeCode: 'grant_reserved',
        replayed: true,
        request: cloneGitHubDeliveryRequest(request),
        grant: cloneGitHubCredentialGrant(existingGrant),
      }
    }
    if (request.stateVersion !== input.expectedStateVersion) {
      return githubDeliveryRejection('stale_version')
    }
    if (
      (!retrying && request.status !== 'approved') ||
      (retrying &&
        !['failed', 'recovery_required', 'publishing_branch'].includes(
          request.status,
        ))
    ) {
      return githubDeliveryRejection('approval_required')
    }
    if (Date.parse(at) >= Date.parse(request.expiresAt)) {
      return githubDeliveryRejection('expired')
    }
    const binding = bindingsByProject.get(
      scope(request.organizationId, request.projectId),
    )
    if (
      !binding ||
      binding.status !== 'active' ||
      binding.id !== request.repositoryBindingId ||
      binding.version !== request.repositoryBindingVersion ||
      binding.repositoryId !== request.repositoryId
    ) {
      return githubDeliveryRejection('binding_inactive')
    }
    const approval = currentApproval(request)
    if (!approval || !approvalMatchesRequest(approval, request)) {
      return githubDeliveryRejection('approval_required')
    }
    if (existingGrant && retrying) {
      if (staleIssuingGrant) {
        existingGrant.version += 1
        existingGrant.status = 'failed'
        existingGrant.outcomeCode = 'credential_issue_failed'
      }
      if (existingGrant.status === 'recovery_required') {
        existingGrant.version += 1
        existingGrant.status = 'failed'
      }
      if (replacingLostIssuedCredential) {
        existingGrant.version += 1
        existingGrant.status = 'failed'
        existingGrant.outcomeCode = 'credential_superseded'
      }
    }

    const grant: InternalCredentialGrant = {
      id: nextId('github-grant'),
      version: 1,
      requestId: request.id,
      intentRevision: request.intentRevision,
      approvalId: approval.id,
      attempt: (existingGrant?.attempt ?? 0) + 1,
      issuedToTokenId: principal.authentication.tokenRecordId,
      repositoryId: request.repositoryId,
      permission: 'contents:write',
      repositoryCount: 1,
      status: 'issuing',
      requestedAt: at,
      issuedAt: null,
      credentialExpiresAt: null,
      consumedAt: null,
      outcomeCode: null,
      redacted: true,
    }
    grants.set(grant.id, grant)
    request.stateVersion += 1
    request.status = 'publishing_branch'
    request.outcomeCode = null
    request.updatedAt = at
    audit(principal, input.projectId, 'github_delivery_grant', grant.id, 'grant_reserved', [request.id, grant.attempt], at)
    return {
      ok: true,
      responseStatus: 201,
      outcomeCode: 'grant_reserved',
      replayed: false,
      request: cloneGitHubDeliveryRequest(request),
      grant: cloneGitHubCredentialGrant(grant),
    }
  }

  function grantFinalizationMatches(
    grant: InternalCredentialGrant,
    input: FinalizeGitHubCredentialGrantInput,
  ): boolean {
    if (input.outcome.status === 'issued') {
      return (
        grant.status === 'issued' &&
        grant.issuedAt === new Date(input.outcome.issuedAt).toISOString() &&
        grant.credentialExpiresAt ===
          new Date(input.outcome.credentialExpiresAt).toISOString() &&
        grant.repositoryId === input.outcome.repositoryId &&
        grant.permission === input.outcome.permission &&
        grant.repositoryCount === input.outcome.repositoryCount
      )
    }
    return (
      grant.status === input.outcome.status &&
      grant.outcomeCode === input.outcome.outcomeCode
    )
  }

  async function finalizeGitHubCredentialGrant(
    input: FinalizeGitHubCredentialGrantInput,
    principal: GitHubDeliveryDesktopPrincipal,
  ): Promise<GitHubCredentialGrantMutationResult> {
    if (!(await hasDesktopAuthority(principal, input.projectId))) {
      return githubDeliveryRejection('project_forbidden')
    }
    const request = findRequest(
      input.requestId,
      principal.session.organizationId,
      input.projectId,
    )
    const grant = grants.get(input.grantId)
    if (
      !request ||
      !grant ||
      grant.requestId !== request.id ||
      grant.intentRevision !== request.intentRevision
    ) {
      return githubDeliveryRejection('not_found')
    }
    if (
      request.requestedByTokenId !== principal.authentication.tokenRecordId ||
      grant.issuedToTokenId !== principal.authentication.tokenRecordId
    ) {
      return githubDeliveryRejection('project_forbidden')
    }
    if (!hasCurrentBinding(request)) {
      return githubDeliveryRejection('binding_inactive')
    }
    const runAuthority = await canonicalRequestAuthority(request)
    if (runAuthority === 'claimant_forbidden') {
      return githubDeliveryRejection('project_forbidden')
    }
    if (runAuthority === 'stale') {
      return githubDeliveryRejection('invalid_state')
    }
    try {
      if (grant.status !== 'issuing' && grantFinalizationMatches(grant, input)) {
        return {
          ok: true,
          responseStatus: 200,
          outcomeCode: 'grant_finalized',
          replayed: true,
          request: cloneGitHubDeliveryRequest(request),
          grant: cloneGitHubCredentialGrant(grant),
        }
      }
    } catch {
      return githubDeliveryRejection('invalid_state')
    }
    if (
      request.stateVersion !== input.expectedStateVersion ||
      grant.version !== input.expectedGrantVersion
    ) {
      return githubDeliveryRejection('stale_version')
    }
    if (request.status !== 'publishing_branch' || grant.status !== 'issuing') {
      return githubDeliveryRejection('grant_conflict')
    }

    const at = timestamp()
    if (input.outcome.status === 'issued') {
      let issuedAt: string
      let credentialExpiresAt: string
      try {
        issuedAt = timestamp(input.outcome.issuedAt)
        credentialExpiresAt = timestamp(input.outcome.credentialExpiresAt)
      } catch {
        return githubDeliveryRejection('invalid_state')
      }
      if (
        input.outcome.repositoryId !== request.repositoryId ||
        input.outcome.permission !== 'contents:write' ||
        input.outcome.repositoryCount !== 1 ||
        Date.parse(issuedAt) < Date.parse(grant.requestedAt) ||
        Date.parse(credentialExpiresAt) <= Date.parse(issuedAt) ||
        Date.parse(credentialExpiresAt) > Date.parse(issuedAt) + 60 * 60 * 1_000 ||
        Date.parse(credentialExpiresAt) > Date.parse(request.expiresAt)
      ) {
        return githubDeliveryRejection('invalid_state')
      }
      grant.status = 'issued'
      grant.issuedAt = issuedAt
      grant.credentialExpiresAt = credentialExpiresAt
      grant.outcomeCode = null
    } else {
      grant.status = input.outcome.status
      grant.outcomeCode = input.outcome.outcomeCode
      request.status =
        input.outcome.status === 'failed' ? 'failed' : 'recovery_required'
      request.outcomeCode = 'credential_issue_failed'
    }
    grant.version += 1
    request.stateVersion += 1
    request.updatedAt = at
    audit(principal, input.projectId, 'github_delivery_grant', grant.id, 'grant_finalized', [request.id, grant.attempt, grant.status], at)
    return {
      ok: true,
      responseStatus: 200,
      outcomeCode: 'grant_finalized',
      replayed: false,
      request: cloneGitHubDeliveryRequest(request),
      grant: cloneGitHubCredentialGrant(grant),
    }
  }

  function currentPublication(
    request: InternalDeliveryRequest,
  ): GitHubBranchPublication | null {
    return (
      [...publications.values()].find(
        (publication) =>
          publication.requestId === request.id &&
          publication.intentRevision === request.intentRevision,
      ) ?? null
    )
  }

  async function recordGitHubBranchPublicationReport(
    input: RecordGitHubBranchPublicationReportInput,
    principal: GitHubDeliveryDesktopPrincipal,
  ): Promise<GitHubBranchPublicationReportResult> {
    if (!(await hasDesktopAuthority(principal, input.projectId))) {
      return githubDeliveryRejection('project_forbidden')
    }
    const request = findRequest(
      input.requestId,
      principal.session.organizationId,
      input.projectId,
    )
    const grant = grants.get(input.grantId)
    if (
      !request ||
      !grant ||
      grant.requestId !== request.id ||
      grant.intentRevision !== request.intentRevision
    ) {
      return githubDeliveryRejection('not_found')
    }
    if (
      request.requestedByTokenId !== principal.authentication.tokenRecordId ||
      grant.issuedToTokenId !== principal.authentication.tokenRecordId
    ) {
      return githubDeliveryRejection('project_forbidden')
    }
    if (!hasCurrentBinding(request)) {
      return githubDeliveryRejection('binding_inactive')
    }
    const runAuthority = await canonicalRequestAuthority(request)
    if (runAuthority === 'claimant_forbidden') {
      return githubDeliveryRejection('project_forbidden')
    }
    if (runAuthority === 'stale') {
      return githubDeliveryRejection('invalid_state')
    }
    const reportedAt = timestamp()
    const existing = currentPublication(request)
    if (existing) {
      if (
        existing.grantId !== grant.id ||
        existing.reportedOutcomeCode !== input.reportedOutcomeCode
      ) {
        return githubDeliveryRejection('publication_conflict')
      }
      if (
        ['failed', 'recovery_required', 'conflict'].includes(existing.status)
      ) {
        if (
          request.stateVersion !== input.expectedStateVersion ||
          grant.version !== input.expectedGrantVersion ||
          !['failed', 'recovery_required'].includes(request.status) ||
          grant.status !== 'consumed'
        ) {
          return githubDeliveryRejection('stale_version')
        }
        existing.version += 1
        existing.status = 'verifying'
        existing.reportedAt = reportedAt
        existing.verifiedHeadSha = null
        existing.verifiedAt = null
        existing.outcomeCode = null
        request.stateVersion += 1
        request.status = 'publishing_branch'
        request.outcomeCode = null
        request.updatedAt = reportedAt
        audit(principal, input.projectId, 'github_branch_publication', existing.id, 'publication_reported', [request.id, existing.version], reportedAt)
        return {
          ok: true,
          responseStatus: 201,
          outcomeCode: 'publication_reported',
          replayed: false,
          request: cloneGitHubDeliveryRequest(request),
          grant: cloneGitHubCredentialGrant(grant),
          publication: cloneGitHubBranchPublication(existing),
        }
      }
      return {
        ok: true,
        responseStatus: 201,
        outcomeCode: 'publication_reported',
        replayed: true,
        request: cloneGitHubDeliveryRequest(request),
        grant: cloneGitHubCredentialGrant(grant),
        publication: cloneGitHubBranchPublication(existing),
      }
    }
    if (
      request.stateVersion !== input.expectedStateVersion ||
      grant.version !== input.expectedGrantVersion
    ) {
      return githubDeliveryRejection('stale_version')
    }
    if (
      request.status !== 'publishing_branch' ||
      grant.status !== 'issued' ||
      grant.credentialExpiresAt === null ||
      Date.parse(reportedAt) > Date.parse(grant.credentialExpiresAt)
    ) {
      return githubDeliveryRejection('grant_conflict')
    }

    const publication: GitHubBranchPublication = {
      id: nextId('github-publication'),
      version: 1,
      requestId: request.id,
      intentRevision: request.intentRevision,
      grantId: grant.id,
      status: 'verifying',
      reportedOutcomeCode: input.reportedOutcomeCode,
      verifiedHeadSha: null,
      reportedAt,
      verifiedAt: null,
      outcomeCode: null,
      redacted: true,
    }
    publications.set(publication.id, publication)
    grant.version += 1
    grant.status = 'consumed'
    grant.consumedAt = reportedAt
    request.stateVersion += 1
    request.updatedAt = timestamp()
    audit(principal, input.projectId, 'github_branch_publication', publication.id, 'publication_reported', [request.id, publication.version], request.updatedAt)
    return {
      ok: true,
      responseStatus: 201,
      outcomeCode: 'publication_reported',
      replayed: false,
      request: cloneGitHubDeliveryRequest(request),
      grant: cloneGitHubCredentialGrant(grant),
      publication: cloneGitHubBranchPublication(publication),
    }
  }

  function publicationFinalizationMatches(
    publication: GitHubBranchPublication,
    input: FinalizeGitHubBranchPublicationInput,
  ): boolean {
    const verifiedHeadSha = input.verification.verifiedHeadSha
      ? assertFullGitCommitSha(
          input.verification.verifiedHeadSha,
          'Verified head',
        )
      : null
    const verifiedAt =
      input.verification.verifiedAt === null
        ? null
        : new Date(input.verification.verifiedAt).toISOString()
    return (
      publication.status === input.verification.status &&
      publication.verifiedHeadSha === verifiedHeadSha &&
      publication.verifiedAt === verifiedAt &&
      publication.outcomeCode === input.verification.outcomeCode
    )
  }

  async function finalizeGitHubBranchPublication(
    input: FinalizeGitHubBranchPublicationInput,
    principal: GitHubDeliveryDesktopPrincipal,
  ): Promise<GitHubBranchPublicationFinalizationResult> {
    if (!(await hasDesktopAuthority(principal, input.projectId))) {
      return githubDeliveryRejection('project_forbidden')
    }
    const request = findRequest(
      input.requestId,
      principal.session.organizationId,
      input.projectId,
    )
    const publication = publications.get(input.publicationId)
    if (
      !request ||
      !publication ||
      publication.requestId !== request.id ||
      publication.intentRevision !== request.intentRevision
    ) {
      return githubDeliveryRejection('not_found')
    }
    if (request.requestedByTokenId !== principal.authentication.tokenRecordId) {
      return githubDeliveryRejection('project_forbidden')
    }
    if (publication.status === 'verifying') {
      if (!hasCurrentBinding(request)) {
        return githubDeliveryRejection('binding_inactive')
      }
      const runAuthority = await canonicalRequestAuthority(request)
      if (runAuthority === 'claimant_forbidden') {
        return githubDeliveryRejection('project_forbidden')
      }
      if (runAuthority === 'stale') {
        return githubDeliveryRejection('invalid_state')
      }
      const approval = currentApproval(request)
      if (!approval || !approvalMatchesRequest(approval, request)) {
        return githubDeliveryRejection('approval_required')
      }
    }
    try {
      if (
        publication.status !== 'verifying' &&
        publicationFinalizationMatches(publication, input)
      ) {
        return {
          ok: true,
          responseStatus: 200,
          outcomeCode:
            publication.status === 'verified'
              ? 'publication_verified'
              : 'publication_failed',
          replayed: true,
          request: cloneGitHubDeliveryRequest(request),
          publication: cloneGitHubBranchPublication(publication),
        }
      }
    } catch {
      return githubDeliveryRejection('invalid_state')
    }
    if (
      request.stateVersion !== input.expectedStateVersion ||
      publication.version !== input.expectedPublicationVersion
    ) {
      return githubDeliveryRejection('stale_version')
    }
    if (
      request.status !== 'publishing_branch' ||
      publication.status !== 'verifying'
    ) {
      return githubDeliveryRejection('publication_conflict')
    }
    let verifiedAt: string | null
    let verifiedHeadSha: string | null
    try {
      verifiedAt =
        input.verification.verifiedAt === null
          ? null
          : timestamp(input.verification.verifiedAt)
      verifiedHeadSha = input.verification.verifiedHeadSha
        ? assertFullGitCommitSha(
            input.verification.verifiedHeadSha,
            'Verified head',
          )
        : null
    } catch {
      return githubDeliveryRejection('invalid_state')
    }
    if (
      verifiedAt !== null &&
      Date.parse(verifiedAt) < Date.parse(publication.reportedAt)
    ) {
      return githubDeliveryRejection('invalid_state')
    }
    if (
      (input.verification.status === 'verified' ||
        input.verification.status === 'conflict') &&
      verifiedAt === null
    ) {
      return githubDeliveryRejection('invalid_state')
    }
    if (
      input.verification.status === 'verified' &&
      verifiedHeadSha !== request.expectedCommitSha
    ) {
      return githubDeliveryRejection('publication_conflict')
    }

    publication.version += 1
    publication.status = input.verification.status
    publication.verifiedHeadSha = verifiedHeadSha
    publication.verifiedAt = verifiedAt
    publication.outcomeCode = input.verification.outcomeCode
    request.stateVersion += 1
    request.updatedAt = timestamp()
    if (input.verification.status === 'verified') {
      request.status = 'branch_published'
      request.outcomeCode = null
    } else {
      request.status =
        input.verification.status === 'failed'
          ? 'failed'
          : 'recovery_required'
      request.outcomeCode =
        input.verification.status === 'conflict'
          ? 'branch_conflict'
          : 'branch_verification_failed'
    }
    audit(principal, input.projectId, 'github_branch_publication', publication.id, input.verification.status === 'verified' ? 'publication_verified' : 'publication_failed', [request.id, publication.version], request.updatedAt)
    return {
      ok: true,
      responseStatus: 200,
      outcomeCode:
        input.verification.status === 'verified'
          ? 'publication_verified'
          : 'publication_failed',
      replayed: false,
      request: cloneGitHubDeliveryRequest(request),
      publication: cloneGitHubBranchPublication(publication),
    }
  }

  function currentPullRequest(
    request: InternalDeliveryRequest,
  ): GitHubPullRequestOutcome | null {
    return (
      [...pullRequests.values()].find(
        (pullRequest) =>
          pullRequest.requestId === request.id &&
          pullRequest.intentRevision === request.intentRevision,
      ) ?? null
    )
  }

  async function reserveGitHubDraftPullRequest(
    input: ReserveGitHubDraftPullRequestInput,
    principal: GitHubDeliveryDesktopPrincipal,
  ): Promise<GitHubPullRequestMutationResult> {
    if (!(await hasDesktopAuthority(principal, input.projectId))) {
      return githubDeliveryRejection('project_forbidden')
    }
    const request = findRequest(
      input.requestId,
      principal.session.organizationId,
      input.projectId,
    )
    const publication = publications.get(input.publicationId)
    if (
      !request ||
      !publication ||
      publication.requestId !== request.id ||
      publication.intentRevision !== request.intentRevision
    ) {
      return githubDeliveryRejection('not_found')
    }
    if (request.requestedByTokenId !== principal.authentication.tokenRecordId) {
      return githubDeliveryRejection('project_forbidden')
    }
    if (!hasCurrentBinding(request)) {
      return githubDeliveryRejection('binding_inactive')
    }
    const runAuthority = await canonicalRequestAuthority(request)
    if (runAuthority === 'claimant_forbidden') {
      return githubDeliveryRejection('project_forbidden')
    }
    if (runAuthority === 'stale') {
      return githubDeliveryRejection('invalid_state')
    }
    const existing = currentPullRequest(request)
    if (existing) {
      if (existing.publicationId !== publication.id) {
        return githubDeliveryRejection('pull_request_conflict')
      }
      if (['failed', 'recovery_required'].includes(existing.status)) {
        if (
          request.stateVersion !== input.expectedStateVersion ||
          !['failed', 'recovery_required'].includes(request.status) ||
          publication.status !== 'verified' ||
          publication.verifiedHeadSha !== request.expectedCommitSha
        ) {
          return githubDeliveryRejection('stale_version')
        }
        const at = timestamp()
        existing.version += 1
        existing.status = 'creating'
        existing.pullRequestId = null
        existing.pullRequestNumber = null
        existing.safeUrl = null
        existing.providerCreatedAt = null
        existing.recordedAt = at
        existing.outcomeCode = null
        request.stateVersion += 1
        request.status = 'creating_pr'
        request.outcomeCode = null
        request.updatedAt = at
        audit(principal, input.projectId, 'github_pull_request_create', existing.id, 'pull_request_reserved', [request.id, existing.version], at)
        return {
          ok: true,
          responseStatus: 200,
          outcomeCode: 'pull_request_reserved',
          replayed: false,
          request: cloneGitHubDeliveryRequest(request),
          pullRequest: cloneGitHubPullRequestOutcome(existing),
        }
      }
      return {
        ok: true,
        responseStatus: 201,
        outcomeCode: 'pull_request_reserved',
        replayed: true,
        request: cloneGitHubDeliveryRequest(request),
        pullRequest: cloneGitHubPullRequestOutcome(existing),
      }
    }
    if (request.stateVersion !== input.expectedStateVersion) {
      return githubDeliveryRejection('stale_version')
    }
    if (
      request.status !== 'branch_published' ||
      publication.status !== 'verified' ||
      publication.verifiedHeadSha !== request.expectedCommitSha
    ) {
      return githubDeliveryRejection('publication_conflict')
    }

    const pullRequest: GitHubPullRequestOutcome = {
      id: nextId('github-pr-outcome'),
      version: 1,
      requestId: request.id,
      intentRevision: request.intentRevision,
      publicationId: publication.id,
      status: 'creating',
      pullRequestId: null,
      pullRequestNumber: null,
      safeUrl: null,
      draft: true,
      headBranch: request.headBranch,
      baseBranch: request.baseBranch,
      headSha: request.expectedCommitSha,
      providerCreatedAt: null,
      recordedAt: timestamp(),
      outcomeCode: null,
      redacted: true,
    }
    pullRequests.set(pullRequest.id, pullRequest)
    request.stateVersion += 1
    request.status = 'creating_pr'
    request.updatedAt = timestamp()
    audit(principal, input.projectId, 'github_pull_request_create', pullRequest.id, 'pull_request_reserved', [request.id, pullRequest.version], request.updatedAt)
    return {
      ok: true,
      responseStatus: 201,
      outcomeCode: 'pull_request_reserved',
      replayed: false,
      request: cloneGitHubDeliveryRequest(request),
      pullRequest: cloneGitHubPullRequestOutcome(pullRequest),
    }
  }

  function validateCompletedPullRequest(
    request: InternalDeliveryRequest,
    input: Extract<
      FinalizeGitHubDraftPullRequestInput['outcome'],
      { status: 'completed' }
    >,
  ):
    | {
        pullRequestId: string
        safeUrl: string
        providerCreatedAt: string
        headSha: string
      }
    | null {
    try {
      if (
        !/^[1-9][0-9]{0,19}$/u.test(input.pullRequestId) ||
        !Number.isSafeInteger(input.pullRequestNumber) ||
        input.pullRequestNumber < 1 ||
        input.draft !== true ||
        normalizeGitHubRepository(input.repository) !== request.repository ||
        assertSafeGitHubBranch(input.baseBranch) !== request.baseBranch ||
        assertSafeGitHubBranch(input.headBranch, {
          requireDeliveryNamespace: true,
        }) !== request.headBranch
      ) {
        return null
      }
      const headSha = assertFullGitCommitSha(input.headSha, 'PR head')
      if (headSha !== request.expectedCommitSha) return null
      const url = new URL(input.safeUrl)
      if (
        url.protocol !== 'https:' ||
        url.hostname.toLowerCase() !== 'github.com' ||
        url.port ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname.toLowerCase() !==
          `/${request.repository}/pull/${input.pullRequestNumber}`
      ) {
        return null
      }
      return {
        pullRequestId: input.pullRequestId,
        safeUrl: url.toString(),
        providerCreatedAt: timestamp(input.providerCreatedAt),
        headSha,
      }
    } catch {
      return null
    }
  }

  function pullRequestFinalizationMatches(
    pullRequest: GitHubPullRequestOutcome,
    request: InternalDeliveryRequest,
    input: FinalizeGitHubDraftPullRequestInput,
  ): boolean {
    if (input.outcome.status !== pullRequest.status) return false
    if (input.outcome.status !== 'completed') {
      return pullRequest.outcomeCode === input.outcome.outcomeCode
    }
    const validated = validateCompletedPullRequest(request, input.outcome)
    return Boolean(
      validated &&
        pullRequest.pullRequestId === validated.pullRequestId &&
        pullRequest.pullRequestNumber === input.outcome.pullRequestNumber &&
        pullRequest.safeUrl === validated.safeUrl &&
        pullRequest.providerCreatedAt === validated.providerCreatedAt &&
        pullRequest.outcomeCode === input.outcome.outcomeCode,
    )
  }

  async function finalizeGitHubDraftPullRequest(
    input: FinalizeGitHubDraftPullRequestInput,
    principal: GitHubDeliveryDesktopPrincipal,
  ): Promise<GitHubPullRequestMutationResult> {
    if (!(await hasDesktopAuthority(principal, input.projectId))) {
      return githubDeliveryRejection('project_forbidden')
    }
    const request = findRequest(
      input.requestId,
      principal.session.organizationId,
      input.projectId,
    )
    const pullRequest = pullRequests.get(input.pullRequestOutcomeId)
    if (
      !request ||
      !pullRequest ||
      pullRequest.requestId !== request.id ||
      pullRequest.intentRevision !== request.intentRevision
    ) {
      return githubDeliveryRejection('not_found')
    }
    if (request.requestedByTokenId !== principal.authentication.tokenRecordId) {
      return githubDeliveryRejection('project_forbidden')
    }
    if (pullRequest.status === 'creating') {
      if (!hasCurrentBinding(request)) {
        return githubDeliveryRejection('binding_inactive')
      }
      const runAuthority = await canonicalRequestAuthority(request)
      if (runAuthority === 'claimant_forbidden') {
        return githubDeliveryRejection('project_forbidden')
      }
      if (runAuthority === 'stale') {
        return githubDeliveryRejection('invalid_state')
      }
      const approval = currentApproval(request)
      if (!approval || !approvalMatchesRequest(approval, request)) {
        return githubDeliveryRejection('approval_required')
      }
    }
    if (
      pullRequest.status !== 'creating' &&
      pullRequestFinalizationMatches(pullRequest, request, input)
    ) {
      return {
        ok: true,
        responseStatus: 200,
        outcomeCode:
          pullRequest.status === 'completed'
            ? 'pull_request_completed'
            : 'pull_request_failed',
        replayed: true,
        request: cloneGitHubDeliveryRequest(request),
        pullRequest: cloneGitHubPullRequestOutcome(pullRequest),
      }
    }
    if (
      request.stateVersion !== input.expectedStateVersion ||
      pullRequest.version !== input.expectedPullRequestVersion
    ) {
      return githubDeliveryRejection('stale_version')
    }
    if (request.status !== 'creating_pr' || pullRequest.status !== 'creating') {
      return githubDeliveryRejection('pull_request_conflict')
    }

    const at = timestamp()
    if (input.outcome.status === 'completed') {
      const validated = validateCompletedPullRequest(request, input.outcome)
      const publication = publications.get(pullRequest.publicationId)
      if (
        !validated ||
        !publication?.verifiedAt ||
        Date.parse(validated.providerCreatedAt) > Date.parse(at)
      ) {
        return githubDeliveryRejection('pull_request_conflict')
      }
      pullRequest.status = 'completed'
      pullRequest.pullRequestId = validated.pullRequestId
      pullRequest.pullRequestNumber = input.outcome.pullRequestNumber
      pullRequest.safeUrl = validated.safeUrl
      pullRequest.headSha = validated.headSha
      pullRequest.providerCreatedAt = validated.providerCreatedAt
      pullRequest.outcomeCode = 'draft_pr_created'
      request.status = 'completed'
      request.outcomeCode = 'draft_pr_created'
    } else {
      pullRequest.status = input.outcome.status
      pullRequest.outcomeCode = input.outcome.outcomeCode
      request.status = input.outcome.status
      request.outcomeCode = 'pull_request_failed'
    }
    pullRequest.recordedAt = at
    pullRequest.version += 1
    request.stateVersion += 1
    request.updatedAt = at
    audit(principal, input.projectId, 'github_pull_request_create', pullRequest.id, input.outcome.status === 'completed' ? 'pull_request_completed' : 'pull_request_failed', [request.id, pullRequest.version], request.updatedAt)
    return {
      ok: true,
      responseStatus: 200,
      outcomeCode:
        input.outcome.status === 'completed'
          ? 'pull_request_completed'
          : 'pull_request_failed',
      replayed: false,
      request: cloneGitHubDeliveryRequest(request),
      pullRequest: cloneGitHubPullRequestOutcome(pullRequest),
    }
  }

  return {
    getGitHubRepositoryBinding,
    upsertGitHubRepositoryBinding,
    revokeGitHubRepositoryBinding,
    createOrReviseGitHubDeliveryRequest,
    listGitHubDeliveryInbox,
    getGitHubDeliveryRecoverySnapshot,
    listGitHubDeliveryRequests,
    decideGitHubDeliveryRequest,
    reserveGitHubCredentialGrant,
    finalizeGitHubCredentialGrant,
    recordGitHubBranchPublicationReport,
    finalizeGitHubBranchPublication,
    reserveGitHubDraftPullRequest,
    finalizeGitHubDraftPullRequest,
    inspectForTests: () => ({
      bindings: [...bindingsByProject.values()].map((binding) => ({
        ...binding,
      })),
      requests: [...requestsByLogicalKey.values()].map((request) => ({
        ...request,
        changedPaths: [...request.changedPaths],
      })),
      approvals: [...approvals.values()].map(cloneGitHubDeliveryApproval),
      grants: [...grants.values()].map((grant) => ({ ...grant })),
      publications: [...publications.values()].map(
        cloneGitHubBranchPublication,
      ),
      pullRequests: [...pullRequests.values()].map(
        cloneGitHubPullRequestOutcome,
      ),
      auditEvents: auditEvents.map((event) => ({ ...event })),
    }),
  }
}
