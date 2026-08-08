import { describe, expect, it, vi } from 'vitest'
import type { DesktopPairingCredential, WorkflowRun } from '@ai-devflow/shared'
import {
  createRemoteSyncOutboxClient,
  type RemoteSyncOutboxClientSource,
} from './remote-sync-outbox-client'
import type { RemoteSyncClient, RemoteSyncClientOptions } from './remote-sync'

const OLD_SCOPE = {
  localProjectId: 'local-old-sensitive-id',
  organizationId: 'org-old-sensitive-id',
  teamProjectId: 'team-old-sensitive-id',
}

const OLD_ENCRYPTED_TOKEN = 'encrypted-old-sensitive-token'

function makeCredential(
  overrides: Partial<DesktopPairingCredential> = {},
): DesktopPairingCredential {
  return {
    tokenId: 'token-id-sensitive',
    organizationId: OLD_SCOPE.organizationId,
    projectId: OLD_SCOPE.teamProjectId,
    localProjectId: OLD_SCOPE.localProjectId,
    userId: 'user-id-sensitive',
    role: 'lead',
    authAccountId: 'account-id-sensitive',
    projectMemberships: [
      {
        projectId: OLD_SCOPE.teamProjectId,
        userId: 'user-id-sensitive',
        role: 'lead',
      },
    ],
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeRun(): WorkflowRun {
  return {
    id: 'run-old',
    version: 1,
    title: 'Captured run',
    request: 'Test immutable outbox scope.',
    projectId: OLD_SCOPE.localProjectId,
    creatorId: 'user-id-sensitive',
    status: 'building',
    currentNodeId: 'node-build',
    branchName: 'codex/immutable-scope',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:01:00.000Z',
    nodes: [
      {
        id: 'node-build',
        stage: 'build',
        title: 'Build',
        subtitle: 'Build the slice.',
        kind: 'task',
        status: 'running',
        ownerId: 'user-id-sensitive',
        retryCount: 0,
        artifactIds: [],
      },
    ],
    edges: [],
  }
}

function makeSource(
  getBundle: RemoteSyncOutboxClientSource['getDesktopPairingCredentialBundle'],
): RemoteSyncOutboxClientSource {
  return {
    getDesktopPairingCredentialBundle: getBundle,
    listRuns: async () => [makeRun()],
    listTestEvidence: async () => [],
    listAgentReviews: async () => [],
    listCodingAgentRuns: async () => [],
    listCodingDiffArtifacts: async () => [],
  }
}

describe('remote sync outbox client factory', () => {
  it.each([
    ['missing bundle', null],
    [
      'missing encrypted token',
      { credential: makeCredential(), encryptedToken: '   ' },
    ],
  ])('returns a fixed unauthorized error for %s', async (_label, bundle) => {
    const createClient = vi.fn()
    const decryptToken = vi.fn()

    const error = await createRemoteSyncOutboxClient({
      source: makeSource(async () => bundle),
      expectedScope: OLD_SCOPE,
      signal: new AbortController().signal,
      decryptToken,
      createClient,
    }).catch((caught: unknown) => caught)

    expect(error).toMatchObject({
      name: 'RemoteSyncHttpError',
      status: 401,
      code: 'unauthorized',
      retryable: false,
    })
    expect(String(error)).toBe(
      'RemoteSyncHttpError: Remote sync request failed (HTTP 401, unauthorized).',
    )
    expect(decryptToken).not.toHaveBeenCalled()
    expect(createClient).not.toHaveBeenCalled()
  })

  it.each([
    ['local project', { localProjectId: 'different-local-sensitive-id' }],
    ['organization', { organizationId: 'different-org-sensitive-id' }],
    ['team project', { projectId: 'different-team-sensitive-id' }],
  ])('rejects a %s mismatch before decrypting or creating a client', async (_label, override) => {
    const credential = makeCredential(override)
    const createClient = vi.fn()
    const decryptToken = vi.fn()

    const error = await createRemoteSyncOutboxClient({
      source: makeSource(async () => ({
        credential,
        encryptedToken: OLD_ENCRYPTED_TOKEN,
      })),
      expectedScope: OLD_SCOPE,
      signal: new AbortController().signal,
      decryptToken,
      createClient,
    }).catch((caught: unknown) => caught)

    expect(error).toMatchObject({
      name: 'CanonicalRemoteSyncEntityError',
      code: 'scope_mismatch',
    })
    expect(String(error)).toBe(
      'CanonicalRemoteSyncEntityError: Canonical remote sync entity scope does not match.',
    )
    const serializedError = `${String(error)} ${JSON.stringify(error)}`
    for (const sensitiveValue of [
      OLD_ENCRYPTED_TOKEN,
      credential.localProjectId,
      credential.organizationId,
      credential.projectId,
    ]) {
      expect(serializedError).not.toContain(sensitiveValue)
    }
    expect(decryptToken).not.toHaveBeenCalled()
    expect(createClient).not.toHaveBeenCalled()
  })

  it('keeps the captured token and expected scope when pairing changes mid-factory', async () => {
    let currentBundle = {
      credential: makeCredential(),
      encryptedToken: OLD_ENCRYPTED_TOKEN,
    }
    const getDesktopPairingCredentialBundle = vi.fn(async () => currentBundle)
    let releaseDecrypt!: () => void
    const decryptPaused = new Promise<void>((resolve) => {
      releaseDecrypt = resolve
    })
    const decryptToken = vi.fn(async (encryptedToken: string) => {
      await decryptPaused
      return `decrypted:${encryptedToken}`
    })
    const uploadRunSummary = vi.fn(async () => ({
      accepted: true,
      syncedAt: '2026-08-01T00:02:00.000Z',
      message: 'accepted',
    }))
    const createClient = vi.fn((_options: RemoteSyncClientOptions) => ({
      uploadRunSummary,
    }) as unknown as RemoteSyncClient)
    const signal = new AbortController().signal

    const clientPromise = createRemoteSyncOutboxClient({
      source: makeSource(getDesktopPairingCredentialBundle),
      expectedScope: OLD_SCOPE,
      signal,
      decryptToken,
      createClient,
    })
    await vi.waitFor(() => expect(decryptToken).toHaveBeenCalledWith(OLD_ENCRYPTED_TOKEN))

    currentBundle = {
      credential: makeCredential({
        localProjectId: 'local-new',
        organizationId: 'org-new',
        projectId: 'team-new',
      }),
      encryptedToken: 'encrypted-new-token',
    }
    releaseDecrypt()

    const client = await clientPromise
    expect(getDesktopPairingCredentialBundle).toHaveBeenCalledTimes(1)
    expect(createClient).toHaveBeenCalledWith({
      authToken: `decrypted:${OLD_ENCRYPTED_TOKEN}`,
      signal,
    })

    await client.uploadCanonicalRunSummary('run-old')
    expect(uploadRunSummary).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: OLD_SCOPE.teamProjectId }),
    )
  })

  it('sanitizes token decryption failures', async () => {
    const leakingMessage = [
      OLD_ENCRYPTED_TOKEN,
      OLD_SCOPE.localProjectId,
      OLD_SCOPE.organizationId,
      OLD_SCOPE.teamProjectId,
    ].join(' ')

    const error = await createRemoteSyncOutboxClient({
      source: makeSource(async () => ({
        credential: makeCredential(),
        encryptedToken: OLD_ENCRYPTED_TOKEN,
      })),
      expectedScope: OLD_SCOPE,
      signal: new AbortController().signal,
      decryptToken: async () => {
        throw new Error(leakingMessage)
      },
      createClient: vi.fn(),
    }).catch((caught: unknown) => caught)

    expect(error).toMatchObject({ code: 'unauthorized' })
    expect(`${String(error)} ${JSON.stringify(error)}`).not.toContain(leakingMessage)
  })
})
