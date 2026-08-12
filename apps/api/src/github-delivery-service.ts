import {
  GitHubAppClientError,
  type GitHubAppClient,
  type GitHubAppClientErrorCode,
} from './github-app-client'
import type {
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

export type GitHubDeliveryServiceErrorCode =
  | GitHubAppClientErrorCode
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
      throw new GitHubDeliveryServiceError({
        code: 'github_delivery_state_conflict',
        retryable: reserved.grant.status === 'issuing' ||
          reserved.grant.status === 'recovery_required',
        phase: 'credential',
      })
    }

    let access: Awaited<ReturnType<GitHubAppClient['issueContentsWriteToken']>>
    try {
      access = await input.client.issueContentsWriteToken({
        installationId: reserved.request.installationId,
        repositoryId: reserved.request.repositoryId,
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
    try {
      if (
        access.installationId !== reserved.request.installationId ||
        access.repositoryId !== reserved.request.repositoryId ||
        access.permissions.contents !== 'write'
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
              credentialExpiresAt: access.expiresAt,
              repositoryId: access.repositoryId,
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
              token: access.token,
              expiresAt: access.expiresAt,
              repositoryId: access.repositoryId,
              canonicalHttpsUrl: `https://github.com/${finalized.request.repository}.git`,
            },
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

    await revokeMintedCredential(access.token)
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

  async function createDraftPullRequest(
    pullRequestInput: CreateGitHubDraftPullRequestServiceInput,
    principal: GitHubDeliveryDesktopPrincipal,
  ): Promise<GitHubPullRequestMutationResult> {
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

    let resolved: Awaited<
      ReturnType<GitHubAppClient['findOrCreateDraftPullRequest']>
    > | null = null
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
      if (reserved.replayed) {
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
              status: safe.retryable ? 'recovery_required' : 'failed',
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
    createDraftPullRequest,
  }
}
