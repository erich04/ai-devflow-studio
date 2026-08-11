import { describe, expect, it, vi } from 'vitest'
import type {
  DesktopPairingCredential,
  GitHubRepositoryBinding,
} from '@ai-devflow/shared'
import { synchronizeGitHubRepositoryBinding } from './github-repository-binding-sync'

const pairing: DesktopPairingCredential = {
  tokenId: 'desktop-token-1',
  organizationId: 'org-1',
  projectId: 'team-project-1',
  localProjectId: 'local-project-1',
  userId: 'user-1',
  role: 'lead',
  authAccountId: 'auth-account-1',
  projectMemberships: [
    { projectId: 'team-project-1', userId: 'user-1', role: 'lead' },
  ],
  createdAt: '2026-08-11T09:55:00.000Z',
}

const binding: GitHubRepositoryBinding = {
  stateVersion: 1,
  id: 'github-binding-1',
  version: 3,
  organizationId: pairing.organizationId,
  teamProjectId: pairing.projectId,
  installationId: '123456',
  repositoryId: '987654321',
  repository: 'erich04/ai-devflow-studio',
  defaultBranch: 'main',
  status: 'active',
  validatedAt: '2026-08-11T09:56:00.000Z',
  updatedAt: '2026-08-11T09:56:00.000Z',
  redacted: true,
}

describe('GitHub repository binding synchronization', () => {
  it.each([
    binding,
    { ...binding, version: 4, status: 'revoked' as const },
    null,
  ])(
    'commits an exact remote observation before returning it',
    async (observation) => {
      const remote = { getRepositoryBinding: vi.fn(async () => observation) }
      const store = {
        commitGitHubRepositoryBindingObservation: vi.fn(async () => ({
          committed: true as const,
          replayed: false,
          binding: observation,
        })),
      }

      await expect(
        synchronizeGitHubRepositoryBinding({
          remote,
          store,
          expectedPairing: pairing,
        }),
      ).resolves.toEqual(observation)
      expect(remote.getRepositoryBinding).toHaveBeenCalledWith(pairing.projectId)
      expect(
        store.commitGitHubRepositoryBindingObservation,
      ).toHaveBeenCalledWith({
        expectedPairing: pairing,
        binding: observation,
      })
    },
  )

  it.each([
    'pairing_scope_mismatch',
    'binding_conflict',
    'invalid_input',
  ] as const)(
    'fails closed with a fixed error on %s',
    async (reason) => {
      const remote = { getRepositoryBinding: vi.fn(async () => binding) }
      const store = {
        commitGitHubRepositoryBindingObservation: vi.fn(async () => ({
          committed: false as const,
          reason,
        })),
      }

      const error = await synchronizeGitHubRepositoryBinding({
        remote,
        store,
        expectedPairing: pairing,
      }).catch((caught: unknown) => caught)

      expect(error).toMatchObject({
        name: 'GitHubRepositoryBindingSyncError',
        code: 'binding_observation_rejected',
        message: 'GitHub repository authority could not be synchronized safely.',
      })
      expect(JSON.stringify(error)).not.toContain(reason)
    },
  )

  it('treats the fetch-to-commit pairing race as a hard synchronization failure', async () => {
    const getRepositoryBinding = vi.fn(async () => binding)
    const commitGitHubRepositoryBindingObservation = vi.fn(async () => ({
      committed: false as const,
      reason: 'pairing_scope_mismatch' as const,
    }))

    await expect(
      synchronizeGitHubRepositoryBinding({
        remote: { getRepositoryBinding },
        store: { commitGitHubRepositoryBindingObservation },
        expectedPairing: pairing,
      }),
    ).rejects.toMatchObject({ code: 'binding_observation_rejected' })
    expect(getRepositoryBinding).toHaveBeenCalledTimes(1)
    expect(commitGitHubRepositoryBindingObservation).toHaveBeenCalledTimes(1)
  })

  it('maps an unexpected remote failure to one fixed error without retaining secrets or paths', async () => {
    const rawFailure =
      'Bearer ghs_remote_secret failed at /Users/private/repository'
    const remote = {
      getRepositoryBinding: vi.fn(async () => {
        throw new Error(rawFailure)
      }),
    }
    const store = {
      commitGitHubRepositoryBindingObservation: vi.fn(),
    }

    const error = await synchronizeGitHubRepositoryBinding({
      remote,
      store,
      expectedPairing: pairing,
    }).catch((caught: unknown) => caught)

    expect(error).toMatchObject({
      name: 'GitHubRepositoryBindingSyncError',
      code: 'binding_observation_rejected',
      message: 'GitHub repository authority could not be synchronized safely.',
    })
    expect(error).not.toHaveProperty('cause')
    expect(`${String(error)} ${JSON.stringify(error)}`).not.toMatch(
      /ghs_remote_secret|\/Users\/private\/repository/u,
    )
    expect(store.commitGitHubRepositoryBindingObservation).not.toHaveBeenCalled()
  })

  it('maps an unexpected persistence failure to one fixed error without retaining the database path', async () => {
    const rawFailure =
      'EACCES: rename /Users/private/devflow.sqlite.secret-token.tmp'
    const remote = { getRepositoryBinding: vi.fn(async () => binding) }
    const store = {
      commitGitHubRepositoryBindingObservation: vi.fn(async () => {
        throw new Error(rawFailure)
      }),
    }

    const error = await synchronizeGitHubRepositoryBinding({
      remote,
      store,
      expectedPairing: pairing,
    }).catch((caught: unknown) => caught)

    expect(error).toMatchObject({
      name: 'GitHubRepositoryBindingSyncError',
      code: 'binding_observation_rejected',
      message: 'GitHub repository authority could not be synchronized safely.',
    })
    expect(error).not.toHaveProperty('cause')
    expect(`${String(error)} ${JSON.stringify(error)}`).not.toMatch(
      /\/Users\/private\/devflow\.sqlite|secret-token/u,
    )
  })

  it('maps AbortError to the same fixed safe synchronization error', async () => {
    const abortError = Object.assign(
      new Error('request aborted with Bearer ghs_abort_secret'),
      { name: 'AbortError' },
    )
    const remote = {
      getRepositoryBinding: vi.fn(async () => {
        throw abortError
      }),
    }

    const error = await synchronizeGitHubRepositoryBinding({
      remote,
      store: { commitGitHubRepositoryBindingObservation: vi.fn() },
      expectedPairing: pairing,
    }).catch((caught: unknown) => caught)

    expect(error).toMatchObject({
      name: 'GitHubRepositoryBindingSyncError',
      code: 'binding_observation_rejected',
      message: 'GitHub repository authority could not be synchronized safely.',
    })
    expect(error).not.toHaveProperty('cause')
    expect(`${String(error)} ${JSON.stringify(error)}`).not.toMatch(
      /AbortError|ghs_abort_secret|Bearer/u,
    )
  })
})
