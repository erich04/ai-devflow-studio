import {
  GitHubAppClientError,
  type GitHubAppClient,
  type GitHubAppClientErrorCode,
} from './github-app-client'
import {
  inspectHighConfidenceOutboundSecrets,
  isGitHubCredentialToken,
} from '@ai-devflow/shared'
import type {
  AdoptGitHubVerifiedBranchPublicationInput,
  GitHubBranchPublicationAdoptionResult,
  GitHubBranchPublicationFinalizationResult,
  GitHubCredentialGrantMutationResult,
  GitHubDeliveryDesktopPrincipal,
  GitHubDeliveryRepository,
  GitHubDeliverySessionPrincipal,
  GitHubPullRequestMutationResult,
  GitHubRepositoryBindingMutationResult,
  RecordGitHubBranchPublicationReportInput,
  ReserveGitHubDraftPullRequestInput,
} from './repositories/github-delivery-contract'
import {
  GITHUB_CREDENTIAL_ISSUANCE_LEASE_MS,
} from './repositories/github-delivery-contract'

export type GitHubDeliveryServiceErrorCode =
  | GitHubAppClientErrorCode
  | 'github_delivery_content_blocked'
  | 'github_delivery_state_conflict'
  | 'github_delivery_unavailable'

const safeMessages: Record<GitHubDeliveryServiceErrorCode, string> = {
  github_credential_revocation_unconfirmed: 'GitHub credential revocation could not be confirmed.',
  github_authentication_failed: 'GitHub App authentication failed.',
  github_conflict: 'GitHub remote state conflicts with the approved delivery.',
  github_forbidden: 'GitHub denied the approved delivery operation.',
  github_invalid_request: 'The GitHub delivery request is invalid.',
  github_malformed_response: 'GitHub returned an invalid delivery response.',
  github_not_found: 'The approved GitHub resource was not found.',
  github_pull_request_conflict: 'The GitHub pull request conflicts with the approved delivery.',
  github_rate_limited: 'GitHub temporarily rate limited the delivery operation.',
  github_repository_mismatch: 'The GitHub repository does not match the approved binding.',
  github_request_rejected: 'GitHub rejected the approved delivery operation.',
  github_response_too_large: 'GitHub returned an oversized delivery response.',
  github_scope_mismatch: 'GitHub returned authority outside the approved repository.',
  github_timeout: 'GitHub did not complete the delivery operation before its deadline.',
  github_unauthorized: 'GitHub did not accept the configured App authority.',
  github_unavailable: 'GitHub is temporarily unavailable.',
  github_validation_failed: 'GitHub could not validate the approved delivery operation.',
  github_delivery_content_blocked: 'The approved GitHub delivery text contains blocked credential material.',
  github_delivery_state_conflict: 'The durable GitHub delivery state changed before completion.',
  github_delivery_unavailable: 'The GitHub delivery operation could not be completed safely.',
}

export class GitHubDeliveryServiceError extends Error {
  readonly code: GitHubDeliveryServiceErrorCode
  readonly retryable: boolean
  readonly phase: 'binding' | 'credential' | 'publication' | 'pull_request'

  constructor(input: {
    code: GitHubDeliveryServiceErrorCode
    retryable: boolean
    phase: GitHubDeliveryServiceError['phase']
  }) {
    super(safeMessages[input.code])
    this.name = 'GitHubDeliveryServiceError'
    this.code = input.code
    this.retryable = input.retryable
    this.phase = input.phase
  }

  toJSON(): {
    name: string
    code: GitHubDeliveryServiceErrorCode
    retryable: boolean
    phase: GitHubDeliveryServiceError['phase']
  } {
    return {
      name: this.name,
      code: this.code,
      retryable: this.retryable,
      phase: this.phase,
    }
  }
}

export type ConfigureGitHubRepositoryBindingInput = {
  projectId: string
  installationId: string
  repositoryId: string
  expectedStateVersion: number
}

export type IssueGitHubCredentialGrantInput = {
  projectId: string
  requestId: string
  expectedStateVersion: number
}

export type GitHubEphemeralCredential = {
  grantId: string
  username: 'x-access-token'
  token: string
  expiresAt: string
  repositoryId: string
  canonicalHttpsUrl: string
}

export type IssueGitHubCredentialGrantResult =
  | (Extract<GitHubCredentialGrantMutationResult, { ok: true }> & {
      credential: GitHubEphemeralCredential
    })
  | Exclude<GitHubCredentialGrantMutationResult, { ok: true }>

export type VerifyGitHubBranchPublicationInput =
  RecordGitHubBranchPublicationReportInput

export type AdoptVerifiedGitHubBranchPublicationInput =
  AdoptGitHubVerifiedBranchPublicationInput

export type CreateGitHubDraftPullRequestServiceInput =
  ReserveGitHubDraftPullRequestInput

export type CreateGitHubDeliveryServiceInput = {
  repository: GitHubDeliveryRepository
  client: GitHubAppClient
  clock: () => Date
}

export type GitHubDeliveryService = {
  configureRepositoryBinding(
    input: ConfigureGitHubRepositoryBindingInput,
    principal: GitHubDeliverySessionPrincipal,
  ): Promise<GitHubRepositoryBindingMutationResult>
  issueCredentialGrant(
    input: IssueGitHubCredentialGrantInput,
    principal: GitHubDeliveryDesktopPrincipal,
  ): Promise<IssueGitHubCredentialGrantResult>
  verifyBranchPublication(
    input: VerifyGitHubBranchPublicationInput,
    principal: GitHubDeliveryDesktopPrincipal,
  ): Promise<GitHubBranchPublicationFinalizationResult>
  adoptVerifiedBranchPublication(
    input: AdoptVerifiedGitHubBranchPublicationInput,
    principal: GitHubDeliveryDesktopPrincipal,
  ): Promise<GitHubBranchPublicationAdoptionResult>
  createDraftPullRequest(
    input: CreateGitHubDraftPullRequestServiceInput,
    principal: GitHubDeliveryDesktopPrincipal,
  ): Promise<GitHubPullRequestMutationResult>
}

function serviceError(
  phase: GitHubDeliveryServiceError['phase'],
  error: unknown,
): GitHubDeliveryServiceError {
  if (error instanceof GitHubDeliveryServiceError) return error
  if (error instanceof GitHubAppClientError) {
    return new GitHubDeliveryServiceError({
      code: error.code,
      retryable: error.retryable,
      phase,
    })
  }
  return new GitHubDeliveryServiceError({
    code: 'github_delivery_unavailable',
    retryable: true,
    phase,
  })
}

export function createGitHubDeliveryService(
  input: CreateGitHubDeliveryServiceInput,
): GitHubDeliveryService {
  if (
    !input.repository ||
    !input.client ||
    typeof input.clock !== 'function'
  ) {
    throw new GitHubDeliveryServiceError({
      code: 'github_delivery_state_conflict',
      retryable: false,
      phase: 'binding',
    })
  }

  async function configureRepositoryBinding(
    configureInput: ConfigureGitHubRepositoryBindingInput,
    principal: GitHubDeliverySessionPrincipal,
  ): Promise<GitHubRepositoryBindingMutationResult> {
    try {
      const verified = await input.client.verifyRepository({
        installationId: configureInput.installationId,
        repositoryId: configureInput.repositoryId,
      })
      return input.repository.upsertGitHubRepositoryBinding(
        {
          projectId: configureInput.projectId,
          installationId: verified.installationId,
          repositoryId: verified.repositoryId,
          repository: verified.repository,
          defaultBranch: verified.defaultBranch,
          verifiedAt: verified.verifiedAt,
          expectedStateVersion: configureInput.expectedStateVersion,
        },
        principal,
      )
    } catch (error) {
      throw serviceError('binding', error)
    }
  }

  async function revokeMintedCredential(token: string): Promise<void> {
    try {
      await input.client.revokeInstallationAccessToken(token)
    } catch {
      throw new GitHubDeliveryServiceError({
        code: 'github_credential_revocation_unconfirmed',
        retryable: false,
        phase: 'credential',
      })
    }
  }

  async function confirmCredentialClearance(
    grantInput: IssueGitHubCredentialGrantInput,
    requestId: string,
    grantId: string,
    outcomeCode:
      | 'credential_mint_absent_confirmed'
      | 'credential_revocation_confirmed',
    authority: Extract<
      Awaited<ReturnType<GitHubDeliveryRepository['reserveGitHubCredentialGrant']>>,
      { ok: true }
    >['clearanceAuthority'],
    organizationId: string,
  ): Promise<void> {
    try {
      const confirmed =
        await input.repository.confirmGitHubCredentialClearance(
          {
            organizationId,
            projectId: grantInput.projectId,
            requestId,
            grantId,
            outcomeCode,
          },
          authority,
        )
      if (
        !confirmed.ok ||
        confirmed.outcomeCode !== outcomeCode ||
        confirmed.request.id !== requestId ||
        confirmed.request.projectId !== grantInput.projectId ||
        confirmed.grant.id !== grantId ||
        confirmed.grant.requestId !== requestId ||
        (confirmed.grant.status !== 'failed' &&
          confirmed.grant.status !== 'revoked') ||
        (outcomeCode === 'credential_mint_absent_confirmed' &&
          (confirmed.grant.issuedAt !== null ||
            confirmed.grant.credentialExpiresAt !== null)) ||
        (outcomeCode === 'credential_revocation_confirmed' &&
          (confirmed.grant.consumedAt !== null ||
            ((confirmed.grant.issuedAt === null) !==
              (confirmed.grant.credentialExpiresAt === null)))) ||
        confirmed.grant.outcomeCode !== outcomeCode ||
        confirmed.request.redacted !== true ||
        confirmed.grant.redacted !== true
      ) {
        throw new Error('credential clearance confirmation failed')
      }
    } catch {
      throw new GitHubDeliveryServiceError({
        code: 'github_credential_revocation_unconfirmed',
        retryable: false,
        phase: 'credential',
      })
    }
  }

  async function settleCompensatedGrant(
    grantInput: IssueGitHubCredentialGrantInput,
    requestId: string,
    grantId: string,
    expectedStateVersion: number,
    expectedGrantVersion: number,
    outcomeCode:
      | 'credential_mint_absent_confirmed'
      | 'credential_revocation_confirmed',
    principal: GitHubDeliveryDesktopPrincipal,
    authority: Extract<
      Awaited<ReturnType<GitHubDeliveryRepository['reserveGitHubCredentialGrant']>>,
      { ok: true }
    >['clearanceAuthority'],
    organizationId: string,
  ): Promise<void> {
    try {
      await input.repository.finalizeGitHubCredentialGrant(
        {
          projectId: grantInput.projectId,
          requestId,
          grantId,
          expectedStateVersion,
          expectedGrantVersion,
          outcome: {
            status: 'failed',
            outcomeCode: 'credential_issue_failed',
          },
        },
        principal,
      )
    } catch {
      // The strict confirmation below is the authority: it succeeds only when
      // this exact unissued grant is already failed/revoked and compensable.
    }
    await confirmCredentialClearance(
      grantInput,
      requestId,
      grantId,
      outcomeCode,
      authority,
      organizationId,
    )
  }

  async function issueCredentialGrant(
    grantInput: IssueGitHubCredentialGrantInput,
    principal: GitHubDeliveryDesktopPrincipal,
  ): Promise<IssueGitHubCredentialGrantResult> {
    let reserved: Awaited<
      ReturnType<GitHubDeliveryRepository['reserveGitHubCredentialGrant']>
    >
    try {
      reserved = await input.repository.reserveGitHubCredentialGrant(
        grantInput,
        principal,
      )
    } catch (error) {
      throw serviceError('credential', error)
    }
    if (!reserved.ok) return reserved
    if (reserved.replayed) {
      if (
        reserved.grant.status === 'issued' &&
        reserved.grant.providerExpiryContractVersion === 1 &&
        reserved.grant.providerCredentialExpiresAt !== null &&
        reserved.grant.providerExpiryObservedAt === null &&
        reserved.grant.consumedAt === null &&
        reserved.grant.outcomeCode === null
      ) {
        try {
          const observed = await input.client.observeProviderCredentialExpiry({
            installationId: reserved.request.installationId,
            providerExpiresAt: reserved.grant.providerCredentialExpiresAt,
          })
          if (
            observed.installationId !== reserved.request.installationId ||
            observed.providerExpiresAt !==
              reserved.grant.providerCredentialExpiresAt
          ) {
            throw new Error('provider expiry observation mismatch')
          }
          const confirmed =
            await input.repository.confirmGitHubCredentialProviderExpiry(
              {
                organizationId: reserved.request.organizationId,
                projectId: reserved.request.projectId,
                requestId: reserved.request.id,
                grantId: reserved.grant.id,
                providerCredentialExpiresAt: observed.providerExpiresAt,
                providerExpiryObservedAt: observed.providerObservedAt,
              },
              reserved.clearanceAuthority,
            )
          if (
            !confirmed.ok ||
            confirmed.outcomeCode !== 'credential_provider_expiry_confirmed' ||
            confirmed.request.id !== reserved.request.id ||
            confirmed.request.status !== 'recovery_required' ||
            confirmed.grant.id !== reserved.grant.id ||
            confirmed.grant.status !== 'expired' ||
            confirmed.grant.providerExpiryContractVersion !== 1 ||
            confirmed.grant.providerCredentialExpiresAt !==
              observed.providerExpiresAt ||
            confirmed.grant.providerExpiryObservedAt !==
              observed.providerObservedAt ||
            confirmed.grant.outcomeCode !==
              'credential_provider_expiry_confirmed'
          ) {
            throw new Error('provider expiry confirmation failed')
          }
        } catch (error) {
          throw serviceError('credential', error)
        }
        throw new GitHubDeliveryServiceError({
          code: 'github_delivery_state_conflict',
          retryable: true,
          phase: 'credential',
        })
      }
      throw new GitHubDeliveryServiceError({
        code: 'github_delivery_state_conflict',
        retryable: reserved.grant.status === 'issuing' ||
          reserved.grant.status === 'recovery_required',
        phase: 'credential',
      })
    }

    const requestedAt = Date.parse(reserved.grant.requestedAt)
    if (
      !Number.isFinite(requestedAt) ||
      new Date(requestedAt).toISOString() !== reserved.grant.requestedAt
    ) {
      await settleCompensatedGrant(
        grantInput,
        reserved.request.id,
        reserved.grant.id,
        reserved.request.stateVersion,
        reserved.grant.version,
        'credential_mint_absent_confirmed',
        principal,
        reserved.clearanceAuthority,
        reserved.request.organizationId,
      )
      throw new GitHubDeliveryServiceError({
        code: 'github_delivery_state_conflict',
        retryable: false,
        phase: 'credential',
      })
    }
    let issuanceStartedAt = Number.NaN
    try {
      issuanceStartedAt = input.clock().getTime()
    } catch {
      issuanceStartedAt = Number.NaN
    }
    if (
      !Number.isFinite(issuanceStartedAt) ||
      issuanceStartedAt >= requestedAt + GITHUB_CREDENTIAL_ISSUANCE_LEASE_MS
    ) {
      await settleCompensatedGrant(
        grantInput,
        reserved.request.id,
        reserved.grant.id,
        reserved.request.stateVersion,
        reserved.grant.version,
        'credential_mint_absent_confirmed',
        principal,
        reserved.clearanceAuthority,
        reserved.request.organizationId,
      )
      throw new GitHubDeliveryServiceError({
        code: 'github_delivery_state_conflict',
        retryable: false,
        phase: 'credential',
      })
    }

    let access: Awaited<ReturnType<GitHubAppClient['issueContentsWriteToken']>>
    try {
      access = await input.client.issueContentsWriteToken({
        installationId: reserved.request.installationId,
        repositoryId: reserved.request.repositoryId,
        issuanceDeadline: new Date(
          requestedAt + GITHUB_CREDENTIAL_ISSUANCE_LEASE_MS,
        ).toISOString(),
      })
    } catch (error) {
      const safe = serviceError('credential', error)
      let failureRecorded = false
      try {
        const finalized = await input.repository.finalizeGitHubCredentialGrant(
          {
            projectId: grantInput.projectId,
            requestId: reserved.request.id,
            grantId: reserved.grant.id,
            expectedStateVersion: reserved.request.stateVersion,
            expectedGrantVersion: reserved.grant.version,
            outcome: {
              status: safe.retryable ? 'recovery_required' : 'failed',
              outcomeCode: 'credential_issue_failed',
            },
          },
          principal,
        )
        failureRecorded = finalized.ok
      } catch {
        failureRecorded = false
      }
      if (safe.code === 'github_credential_revocation_unconfirmed') {
        throw safe
      }
      if (error instanceof GitHubAppClientError &&
        (error.credentialRevocationConfirmed ||
          error.providerCredentialAbsentConfirmed)) {
        await settleCompensatedGrant(
          grantInput,
          reserved.request.id,
          reserved.grant.id,
          reserved.request.stateVersion,
          reserved.grant.version,
          error.credentialRevocationConfirmed
            ? 'credential_revocation_confirmed'
            : 'credential_mint_absent_confirmed',
          principal,
          reserved.clearanceAuthority,
          reserved.request.organizationId,
        )
        throw safe
      }
      if (!failureRecorded) {
        throw new GitHubDeliveryServiceError({
          code: 'github_delivery_state_conflict',
          retryable: false,
          phase: 'credential',
        })
      }
      throw safe
    }

    let finalizationRejection: Exclude<
      GitHubCredentialGrantMutationResult,
      { ok: true }
    > | null = null
    let postMintFailure: GitHubDeliveryServiceError | null = null
    let mintedToken: string | null = null
    let accessSnapshot: {
      installationId: string
      repositoryId: string
      token: string
      expiresAt: string
      providerExpiresAt: string
      contentsPermission: string | undefined
    } | null = null
    try {
      const candidateToken = access.token
      if (isGitHubCredentialToken(candidateToken)) {
        mintedToken = candidateToken
      }
      accessSnapshot = {
        installationId: access.installationId,
        repositoryId: access.repositoryId,
        token: candidateToken,
        expiresAt: access.expiresAt,
        providerExpiresAt: access.providerExpiresAt,
        contentsPermission: access.permissions.contents,
      }
      if (
        mintedToken === null ||
        accessSnapshot.installationId !== reserved.request.installationId ||
        accessSnapshot.repositoryId !== reserved.request.repositoryId ||
        accessSnapshot.contentsPermission !== 'write'
      ) {
        postMintFailure = new GitHubDeliveryServiceError({
          code: 'github_scope_mismatch',
          retryable: false,
          phase: 'credential',
        })
        const finalized = await input.repository.finalizeGitHubCredentialGrant(
          {
            projectId: grantInput.projectId,
            requestId: reserved.request.id,
            grantId: reserved.grant.id,
            expectedStateVersion: reserved.request.stateVersion,
            expectedGrantVersion: reserved.grant.version,
            outcome: {
              status: 'failed',
              outcomeCode: 'credential_issue_failed',
            },
          },
          principal,
        )
        if (!finalized.ok) finalizationRejection = finalized
      } else {
        const issuedAt = input.clock().toISOString()
        if (
          Date.parse(issuedAt) >=
            Date.parse(reserved.grant.requestedAt) +
              GITHUB_CREDENTIAL_ISSUANCE_LEASE_MS
        ) {
          postMintFailure = new GitHubDeliveryServiceError({
            code: 'github_delivery_state_conflict',
            retryable: false,
            phase: 'credential',
          })
          const finalized = await input.repository.finalizeGitHubCredentialGrant(
            {
              projectId: grantInput.projectId,
              requestId: reserved.request.id,
              grantId: reserved.grant.id,
              expectedStateVersion: reserved.request.stateVersion,
              expectedGrantVersion: reserved.grant.version,
              outcome: {
                status: 'failed',
                outcomeCode: 'credential_issue_failed',
              },
            },
            principal,
          )
          if (!finalized.ok) finalizationRejection = finalized
        } else {
          const finalized = await input.repository.finalizeGitHubCredentialGrant(
            {
              projectId: grantInput.projectId,
              requestId: reserved.request.id,
              grantId: reserved.grant.id,
              expectedStateVersion: reserved.request.stateVersion,
              expectedGrantVersion: reserved.grant.version,
              outcome: {
                status: 'issued',
                issuedAt,
                credentialExpiresAt: accessSnapshot.expiresAt,
                providerCredentialExpiresAt:
                  accessSnapshot.providerExpiresAt,
                repositoryId: accessSnapshot.repositoryId,
                permission: 'contents:write',
                repositoryCount: 1,
              },
            },
            principal,
          )
          if (!finalized.ok) {
            finalizationRejection = finalized
          } else {
            return {
              ...finalized,
              credential: {
                grantId: finalized.grant.id,
                username: 'x-access-token',
                token: accessSnapshot.token,
                expiresAt: accessSnapshot.expiresAt,
                repositoryId: accessSnapshot.repositoryId,
                canonicalHttpsUrl: `https://github.com/${finalized.request.repository}.git`,
              },
            }
          }
        }
      }
    } catch {
      postMintFailure = new GitHubDeliveryServiceError({
        code: 'github_delivery_state_conflict',
        retryable: false,
        phase: 'credential',
      })
    }

    if (mintedToken === null) {
      throw new GitHubDeliveryServiceError({
        code: 'github_credential_revocation_unconfirmed',
        retryable: false,
        phase: 'credential',
      })
    }
    await revokeMintedCredential(mintedToken)
    await settleCompensatedGrant(
      grantInput,
      reserved.request.id,
      reserved.grant.id,
      reserved.request.stateVersion,
      reserved.grant.version,
      'credential_revocation_confirmed',
      principal,
      reserved.clearanceAuthority,
      reserved.request.organizationId,
    )
    if (finalizationRejection !== null) {
      if (finalizationRejection.outcomeCode === 'binding_inactive') {
        return finalizationRejection
      }
      throw new GitHubDeliveryServiceError({
        code: 'github_delivery_state_conflict',
        retryable: false,
        phase: 'credential',
      })
    }
    throw postMintFailure ?? new GitHubDeliveryServiceError({
      code: 'github_delivery_state_conflict',
      retryable: false,
      phase: 'credential',
    })
  }

  async function verifyBranchPublication(
    publicationInput: VerifyGitHubBranchPublicationInput,
    principal: GitHubDeliveryDesktopPrincipal,
  ): Promise<GitHubBranchPublicationFinalizationResult> {
    let reported: Awaited<
      ReturnType<GitHubDeliveryRepository['recordGitHubBranchPublicationReport']>
    >
    try {
      reported = await input.repository.recordGitHubBranchPublicationReport(
        publicationInput,
        principal,
      )
    } catch (error) {
      throw serviceError('publication', error)
    }
    if (!reported.ok) return reported

    if (reported.publication.status !== 'verifying') {
      return {
        ok: true,
        responseStatus: 200,
        outcomeCode:
          reported.publication.status === 'verified'
            ? 'publication_verified'
            : 'publication_failed',
        replayed: true,
        request: reported.request,
        publication: reported.publication,
      }
    }

    let verification:
      | {
          status: 'verified'
          verifiedHeadSha: string
          verifiedAt: string
          outcomeCode: 'branch_verified'
        }
      | {
          status: 'conflict'
          verifiedHeadSha: string
          verifiedAt: string
          outcomeCode: 'branch_conflict'
        }
    try {
      const head = await input.client.getBranchHead({
        installationId: reported.request.installationId,
        repositoryId: reported.request.repositoryId,
        repository: reported.request.repository,
        branch: reported.request.headBranch,
      })
      verification =
        head.sha === reported.request.expectedCommitSha
          ? {
              status: 'verified',
              verifiedHeadSha: head.sha,
              verifiedAt: head.verifiedAt,
              outcomeCode: 'branch_verified',
            }
          : {
              status: 'conflict',
              verifiedHeadSha: head.sha,
              verifiedAt: head.verifiedAt,
              outcomeCode: 'branch_conflict',
            }
    } catch (error) {
      const safe = serviceError('publication', error)
      let finalized: GitHubBranchPublicationFinalizationResult
      try {
        finalized = await input.repository.finalizeGitHubBranchPublication(
          {
            projectId: publicationInput.projectId,
            requestId: reported.request.id,
            publicationId: reported.publication.id,
            expectedStateVersion: reported.request.stateVersion,
            expectedPublicationVersion: reported.publication.version,
            verification: {
              status: safe.retryable ? 'recovery_required' : 'failed',
              verifiedHeadSha: null,
              verifiedAt: null,
              outcomeCode: 'branch_verification_failed',
            },
          },
          principal,
        )
      } catch {
        throw new GitHubDeliveryServiceError({
          code: 'github_delivery_state_conflict',
          retryable: false,
          phase: 'publication',
        })
      }
      if (!finalized.ok) {
        throw new GitHubDeliveryServiceError({
          code: 'github_delivery_state_conflict',
          retryable: false,
          phase: 'publication',
        })
      }
      throw safe
    }

    try {
      const finalized = await input.repository.finalizeGitHubBranchPublication(
        {
          projectId: publicationInput.projectId,
          requestId: reported.request.id,
          publicationId: reported.publication.id,
          expectedStateVersion: reported.request.stateVersion,
          expectedPublicationVersion: reported.publication.version,
          verification,
        },
        principal,
      )
      if (!finalized.ok) {
        throw new GitHubDeliveryServiceError({
          code: 'github_delivery_state_conflict',
          retryable: false,
          phase: 'publication',
        })
      }
      return finalized
    } catch (error) {
      if (error instanceof GitHubDeliveryServiceError) throw error
      throw new GitHubDeliveryServiceError({
        code: 'github_delivery_state_conflict',
        retryable: false,
        phase: 'publication',
      })
    }
  }

  async function adoptVerifiedBranchPublication(
    publicationInput: AdoptVerifiedGitHubBranchPublicationInput,
    principal: GitHubDeliveryDesktopPrincipal,
  ): Promise<GitHubBranchPublicationAdoptionResult> {
    try {
      return await input.repository.adoptGitHubVerifiedBranchPublication(
        publicationInput,
        principal,
      )
    } catch (error) {
      throw serviceError('publication', error)
    }
  }

  async function createDraftPullRequest(
    pullRequestInput: CreateGitHubDraftPullRequestServiceInput,
    principal: GitHubDeliveryDesktopPrincipal,
  ): Promise<GitHubPullRequestMutationResult> {
    let preResolved: Awaited<
      ReturnType<GitHubAppClient['findOrCreateDraftPullRequest']>
    > | null = null
    let recoverySnapshot: Awaited<
      ReturnType<GitHubDeliveryRepository['getGitHubDeliveryRecoverySnapshot']>
    >
    try {
      recoverySnapshot = await input.repository.getGitHubDeliveryRecoverySnapshot(
        pullRequestInput.projectId,
        pullRequestInput.requestId,
        principal,
      )
    } catch (error) {
      throw serviceError('pull_request', error)
    }
    const retryNotBefore = recoverySnapshot?.pullRequest?.providerRetryNotBefore
    if (
      recoverySnapshot?.pullRequest?.status === 'recovery_required' &&
      retryNotBefore !== null &&
      retryNotBefore !== undefined
    ) {
      let authorization: Awaited<
        ReturnType<GitHubDeliveryRepository['authorizeGitHubDeliveryRecoveryLookup']>
      >
      try {
        authorization = await input.repository.authorizeGitHubDeliveryRecoveryLookup(
          {
            projectId: pullRequestInput.projectId,
            requestId: recoverySnapshot.request.id,
            expectedStateVersion: recoverySnapshot.request.stateVersion,
            expectedPullRequestVersion: recoverySnapshot.pullRequest.version,
          },
          principal,
        )
      } catch (error) {
        throw serviceError('pull_request', error)
      }
      if (!authorization.ok) return authorization
      try {
        const existing = await input.client.findDraftPullRequest({
          installationId: recoverySnapshot.request.installationId,
          repositoryId: recoverySnapshot.request.repositoryId,
          repository: recoverySnapshot.request.repository,
          baseBranch: recoverySnapshot.request.baseBranch,
          headBranch: recoverySnapshot.request.headBranch,
          expectedHeadSha: recoverySnapshot.request.expectedCommitSha,
          idempotencyKey: recoverySnapshot.request.logicalIdempotencyKey,
        })
        if (existing) {
          preResolved = { disposition: 'found', pullRequest: existing }
        } else {
          const retryAt = Date.parse(retryNotBefore)
          const observedAt = input.clock().valueOf()
          if (!Number.isFinite(retryAt) || !Number.isFinite(observedAt)) {
            throw new GitHubDeliveryServiceError({
              code: 'github_delivery_state_conflict',
              retryable: false,
              phase: 'pull_request',
            })
          }
          if (observedAt < retryAt) {
            throw new GitHubDeliveryServiceError({
              code: 'github_rate_limited',
              retryable: true,
              phase: 'pull_request',
            })
          }
        }
      } catch (error) {
        if (
          error instanceof GitHubAppClientError &&
          error.code === 'github_rate_limited' &&
          error.retryAfterSeconds !== undefined &&
          recoverySnapshot?.pullRequest
        ) {
          let extended: GitHubPullRequestMutationResult
          try {
            extended = await input.repository.finalizeGitHubDraftPullRequest(
              {
                projectId: pullRequestInput.projectId,
                requestId: recoverySnapshot.request.id,
                pullRequestOutcomeId: recoverySnapshot.pullRequest.id,
                expectedStateVersion: recoverySnapshot.request.stateVersion,
                expectedPullRequestVersion: recoverySnapshot.pullRequest.version,
                outcome: {
                  status: 'recovery_required',
                  outcomeCode: 'pull_request_failed',
                  providerRetryAfterSeconds: error.retryAfterSeconds,
                },
              },
              principal,
            )
          } catch {
            throw new GitHubDeliveryServiceError({
              code: 'github_delivery_state_conflict',
              retryable: false,
              phase: 'pull_request',
            })
          }
          if (!extended.ok) {
            throw new GitHubDeliveryServiceError({
              code: 'github_delivery_state_conflict',
              retryable: false,
              phase: 'pull_request',
            })
          }
        }
        throw serviceError('pull_request', error)
      }
    }
    let reserved: Awaited<
      ReturnType<GitHubDeliveryRepository['reserveGitHubDraftPullRequest']>
    >
    try {
      reserved = await input.repository.reserveGitHubDraftPullRequest(
        pullRequestInput,
        principal,
      )
    } catch (error) {
      throw serviceError('pull_request', error)
    }
    if (!reserved.ok) return reserved

    if (reserved.pullRequest.status !== 'creating') {
      return {
        ok: true,
        responseStatus: 200,
        outcomeCode:
          reserved.pullRequest.status === 'completed'
            ? 'pull_request_completed'
            : 'pull_request_failed',
        replayed: true,
        request: reserved.request,
        pullRequest: reserved.pullRequest,
      }
    }

    const providerTextInspection = inspectHighConfidenceOutboundSecrets(
      `${reserved.request.prTitle}\n${reserved.request.prBody}`,
    )
    if (providerTextInspection.matchCount > 0) {
      let finalized: GitHubPullRequestMutationResult
      try {
        finalized = await input.repository.finalizeGitHubDraftPullRequest(
          {
            projectId: pullRequestInput.projectId,
            requestId: reserved.request.id,
            pullRequestOutcomeId: reserved.pullRequest.id,
            expectedStateVersion: reserved.request.stateVersion,
            expectedPullRequestVersion: reserved.pullRequest.version,
            outcome: {
              status: 'failed',
              outcomeCode: 'pull_request_failed',
            },
          },
          principal,
        )
      } catch {
        throw new GitHubDeliveryServiceError({
          code: 'github_delivery_state_conflict',
          retryable: false,
          phase: 'pull_request',
        })
      }
      if (!finalized.ok) {
        throw new GitHubDeliveryServiceError({
          code: 'github_delivery_state_conflict',
          retryable: false,
          phase: 'pull_request',
        })
      }
      throw new GitHubDeliveryServiceError({
        code: 'github_delivery_content_blocked',
        retryable: false,
        phase: 'pull_request',
      })
    }

    let resolved: Awaited<
      ReturnType<GitHubAppClient['findOrCreateDraftPullRequest']>
    > | null = preResolved
    let replayNeedsRecovery = false
    try {
      const identity = {
        installationId: reserved.request.installationId,
        repositoryId: reserved.request.repositoryId,
        repository: reserved.request.repository,
        baseBranch: reserved.request.baseBranch,
        headBranch: reserved.request.headBranch,
        expectedHeadSha: reserved.request.expectedCommitSha,
        idempotencyKey: reserved.request.logicalIdempotencyKey,
      }
      if (resolved) {
        // A matching Draft was reconciled before a durable provider backoff gate.
      } else if (reserved.replayed) {
        const existing = await input.client.findDraftPullRequest(identity)
        if (!existing) {
          replayNeedsRecovery = true
        } else {
          resolved = { disposition: 'found', pullRequest: existing }
        }
      } else {
        resolved = await input.client.findOrCreateDraftPullRequest({
          ...identity,
          title: reserved.request.prTitle,
          body: reserved.request.prBody,
        })
      }
    } catch (error) {
      if (error instanceof GitHubDeliveryServiceError) throw error
      const safe = serviceError('pull_request', error)
      const providerRetryAfterSeconds =
        error instanceof GitHubAppClientError &&
        error.code === 'github_rate_limited' &&
        error.retryAfterSeconds !== undefined
          ? error.retryAfterSeconds
          : null
      let finalized: GitHubPullRequestMutationResult
      try {
        finalized = await input.repository.finalizeGitHubDraftPullRequest(
          {
            projectId: pullRequestInput.projectId,
            requestId: reserved.request.id,
            pullRequestOutcomeId: reserved.pullRequest.id,
            expectedStateVersion: reserved.request.stateVersion,
            expectedPullRequestVersion: reserved.pullRequest.version,
            outcome: safe.retryable
              ? {
                  status: 'recovery_required',
                  outcomeCode: 'pull_request_failed',
                  ...(providerRetryAfterSeconds === null
                    ? {}
                    : { providerRetryAfterSeconds }),
                }
              : {
                  status: 'failed',
                  outcomeCode: 'pull_request_failed',
                },
          },
          principal,
        )
      } catch {
        throw new GitHubDeliveryServiceError({
          code: 'github_delivery_state_conflict',
          retryable: false,
          phase: 'pull_request',
        })
      }
      if (!finalized.ok) {
        throw new GitHubDeliveryServiceError({
          code: 'github_delivery_state_conflict',
          retryable: false,
          phase: 'pull_request',
        })
      }
      throw safe
    }

    if (replayNeedsRecovery) {
      try {
        const finalized = await input.repository.finalizeGitHubDraftPullRequest(
          {
            projectId: pullRequestInput.projectId,
            requestId: reserved.request.id,
            pullRequestOutcomeId: reserved.pullRequest.id,
            expectedStateVersion: reserved.request.stateVersion,
            expectedPullRequestVersion: reserved.pullRequest.version,
            outcome: {
              status: 'recovery_required',
              outcomeCode: 'pull_request_failed',
            },
          },
          principal,
        )
        if (!finalized.ok) {
          throw new GitHubDeliveryServiceError({
            code: 'github_delivery_state_conflict',
            retryable: false,
            phase: 'pull_request',
          })
        }
        return finalized
      } catch (error) {
        if (error instanceof GitHubDeliveryServiceError) throw error
        throw new GitHubDeliveryServiceError({
          code: 'github_delivery_state_conflict',
          retryable: false,
          phase: 'pull_request',
        })
      }
    }

    if (!resolved) {
      throw new GitHubDeliveryServiceError({
        code: 'github_delivery_state_conflict',
        retryable: false,
        phase: 'pull_request',
      })
    }

    try {
      const pullRequest = resolved.pullRequest
      const finalized = await input.repository.finalizeGitHubDraftPullRequest(
        {
          projectId: pullRequestInput.projectId,
          requestId: reserved.request.id,
          pullRequestOutcomeId: reserved.pullRequest.id,
          expectedStateVersion: reserved.request.stateVersion,
          expectedPullRequestVersion: reserved.pullRequest.version,
          outcome: {
            status: 'completed',
            pullRequestId: pullRequest.id,
            pullRequestNumber: pullRequest.number,
            safeUrl: pullRequest.url,
            draft: true,
            repository: pullRequest.repository,
            baseBranch: pullRequest.baseBranch,
            headBranch: pullRequest.headBranch,
            headSha: pullRequest.headSha,
            providerCreatedAt: pullRequest.createdAt,
            outcomeCode: 'draft_pr_created',
          },
        },
        principal,
      )
      if (!finalized.ok) {
        throw new GitHubDeliveryServiceError({
          code: 'github_delivery_state_conflict',
          retryable: false,
          phase: 'pull_request',
        })
      }
      return finalized
    } catch (error) {
      if (error instanceof GitHubDeliveryServiceError) throw error
      throw new GitHubDeliveryServiceError({
        code: 'github_delivery_state_conflict',
        retryable: false,
        phase: 'pull_request',
      })
    }
  }

  return {
    configureRepositoryBinding,
    issueCredentialGrant,
    verifyBranchPublication,
    adoptVerifiedBranchPublication,
    createDraftPullRequest,
  }
}
