import type { DesktopPairingCredential } from '@ai-devflow/shared'
import type { LocalStore } from './local-store'
import {
  CanonicalRemoteSyncEntityError,
  createProjectBoundRemoteSync,
  type ProjectBoundRemoteSync,
  type ProjectBoundRemoteSyncScope,
} from './project-bound-remote-sync'
import {
  createRemoteSyncClient,
  RemoteSyncHttpError,
  type RemoteSyncClient,
  type RemoteSyncClientOptions,
} from './remote-sync'

export type RemoteSyncOutboxClientSource = Pick<
  LocalStore,
  | 'getDesktopPairingCredentialBundle'
  | 'listRuns'
  | 'listTestEvidence'
  | 'listAgentReviews'
  | 'listCodingAgentRuns'
  | 'listCodingDiffArtifacts'
  | 'getAgentRuntime'
  | 'getAgentMemoryTeamProjectionInput'
>

export type RemoteSyncOutboxClientFactoryInput = {
  source: RemoteSyncOutboxClientSource
  expectedScope: ProjectBoundRemoteSyncScope
  signal: AbortSignal
  decryptToken(encryptedToken: string): string | Promise<string>
  createClient?: (options: RemoteSyncClientOptions) => RemoteSyncClient
}

const PAIRING_AUTH_PATH = '/api/desktop/pairing'

function unauthorizedPairingError(): RemoteSyncHttpError {
  return new RemoteSyncHttpError({
    status: 401,
    code: 'unauthorized',
    path: PAIRING_AUTH_PATH,
    retryable: false,
  })
}

function cloneCredential(
  credential: DesktopPairingCredential,
): DesktopPairingCredential {
  return {
    ...credential,
    projectMemberships: credential.projectMemberships.map((membership) => ({
      ...membership,
    })),
  }
}

function matchesScope(
  credential: DesktopPairingCredential,
  expectedScope: ProjectBoundRemoteSyncScope,
): boolean {
  return (
    credential.localProjectId === expectedScope.localProjectId &&
    credential.organizationId === expectedScope.organizationId &&
    credential.projectId === expectedScope.teamProjectId
  )
}

export async function createRemoteSyncOutboxClient(
  input: RemoteSyncOutboxClientFactoryInput,
): Promise<ProjectBoundRemoteSync> {
  const expectedScope = { ...input.expectedScope }
  const bundle = await input.source.getDesktopPairingCredentialBundle()
  if (
    !bundle?.credential ||
    typeof bundle.encryptedToken !== 'string' ||
    bundle.encryptedToken.trim().length === 0
  ) {
    throw unauthorizedPairingError()
  }

  const credential = cloneCredential(bundle.credential)
  const encryptedToken = bundle.encryptedToken
  if (!matchesScope(credential, expectedScope)) {
    throw new CanonicalRemoteSyncEntityError('scope_mismatch', 'workflow_run')
  }

  let authToken: string
  try {
    authToken = (await input.decryptToken(encryptedToken)).trim()
  } catch {
    throw unauthorizedPairingError()
  }
  if (!authToken) {
    throw unauthorizedPairingError()
  }

  const remoteSync = (input.createClient ?? createRemoteSyncClient)({
    authToken,
    signal: input.signal,
  })

  return createProjectBoundRemoteSync({
    remoteSync,
    expectedScope,
    credentialSource: {
      getDesktopPairingCredential: async () => credential,
      listRuns: () => input.source.listRuns(),
      listTestEvidence: (runId) => input.source.listTestEvidence(runId),
      listAgentReviews: (runId) => input.source.listAgentReviews(runId),
      listCodingAgentRuns: (runId) => input.source.listCodingAgentRuns(runId),
      listCodingDiffArtifacts: (runId) => input.source.listCodingDiffArtifacts(runId),
      getAgentRuntime: (runtimeId) => input.source.getAgentRuntime(runtimeId),
      getAgentMemoryTeamProjectionInput: (memoryId) =>
        input.source.getAgentMemoryTeamProjectionInput(memoryId),
    },
  })
}
