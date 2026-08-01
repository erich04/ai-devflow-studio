import { describe, expect, it } from 'vitest'
import { createRecommendedEnforcementPreset } from '@ai-devflow/shared'
import type {
  DesktopPairingCredential,
  TeamSession,
  WorkflowRun,
} from '@ai-devflow/shared'
import { createSeedTeamRepository } from '../apps/api/src/repositories/team-repository'
import { resolveTeamRoute } from '../apps/api/src/routes/team-routes'
import { createProjectBoundRemoteSync } from '../apps/desktop/electron/project-bound-remote-sync'
import { createRemoteSyncClient } from '../apps/desktop/electron/remote-sync'

const creatorSession: TeamSession = {
  source: 'authenticated',
  organizationId: 'org-demo',
  userId: 'u-run-creator',
  role: 'member',
  authAccountId: 'acct-run-creator',
  projectMemberships: [
    { projectId: 'p-payments', userId: 'u-run-creator', role: 'member' },
  ],
}

const reviewerSession: TeamSession = {
  source: 'authenticated',
  organizationId: 'org-demo',
  userId: 'u-independent-lead',
  role: 'lead',
  authAccountId: 'acct-independent-lead',
  projectMemberships: [
    { projectId: 'p-payments', userId: 'u-independent-lead', role: 'lead' },
  ],
}

const reviewerCredential: DesktopPairingCredential = {
  tokenId: 'desktop-token-independent-lead',
  organizationId: reviewerSession.organizationId,
  projectId: 'p-payments',
  localProjectId: 'local-project-1',
  userId: reviewerSession.userId,
  role: 'lead',
  authAccountId: reviewerSession.authAccountId,
  projectMemberships: reviewerSession.projectMemberships,
  createdAt: '2026-07-31T18:00:00.000Z',
}

const remoteRun = {
  kind: 'run' as const,
  runId: 'run-independent-lead-override',
  version: 1,
  projectId: 'p-payments',
  title: 'Independent Lead override',
  status: 'building' as const,
  currentNodeId: 'node-design-gate',
  currentNode: {
    id: 'node-design-gate',
    stage: 'design' as const,
    kind: 'gate' as const,
    status: 'blocked' as const,
    requiredRole: 'lead' as const,
  },
  branchName: 'ai/independent-lead-override',
  updatedAt: '2026-07-31T18:00:00.000Z',
}

const localGateRun: WorkflowRun = {
  id: remoteRun.runId,
  version: remoteRun.version,
  title: remoteRun.title,
  request: 'Prove independent review remains independent.',
  projectId: reviewerCredential.localProjectId!,
  creatorId: creatorSession.userId,
  status: remoteRun.status,
  currentNodeId: remoteRun.currentNodeId,
  branchName: remoteRun.branchName,
  createdAt: remoteRun.updatedAt,
  updatedAt: remoteRun.updatedAt,
  nodes: [{
    id: remoteRun.currentNode.id,
    stage: remoteRun.currentNode.stage,
    title: 'Design Gate',
    subtitle: 'Independent Lead review required.',
    kind: remoteRun.currentNode.kind,
    status: remoteRun.currentNode.status,
    ownerId: creatorSession.userId,
    requiredRole: 'lead',
    retryCount: 0,
    artifactIds: [],
  }],
  edges: [],
}

function createRouteFetcher(
  repository: ReturnType<typeof createSeedTeamRepository>,
  sessions: ReadonlyMap<string, TeamSession>,
): typeof fetch {
  return async (resource, init) => {
    const url = new URL(String(resource))
    const authorization = new Headers(init?.headers).get('authorization') ?? ''
    const session = sessions.get(authorization.replace(/^Bearer /, '')) ?? null
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : undefined
    const result = await resolveTeamRoute(init?.method ?? 'GET', url.pathname, repository, {
      session,
      body,
      searchParams: url.searchParams,
    })

    return new Response(JSON.stringify(result?.body ?? { error: 'not_found' }), {
      status: result?.status ?? 404,
      headers: { 'content-type': 'application/json' },
    })
  }
}

async function createHarness(options: { uploadCanonicalRun: boolean }) {
  const repository = createSeedTeamRepository()
  const policy = createRecommendedEnforcementPreset({ organizationId: 'org-demo' })
  await repository.saveEnforcementPolicy(policy, reviewerSession)

  const fetcher = createRouteFetcher(
    repository,
    new Map<string, TeamSession>([
      ['creator-token', creatorSession],
      ['reviewer-token', reviewerSession],
    ]),
  )
  if (options.uploadCanonicalRun) {
    await createRemoteSyncClient({
      apiBaseUrl: 'http://api.test',
      authToken: 'creator-token',
      fetcher,
    }).uploadRunSummary(remoteRun)
  }

  const reviewerClient = createRemoteSyncClient({
    apiBaseUrl: 'http://api.test',
    authToken: 'reviewer-token',
    fetcher,
  })
  const boundRemoteSync = createProjectBoundRemoteSync({
    remoteSync: reviewerClient,
    credentialSource: {
      getDesktopPairingCredential: async () => reviewerCredential,
      listRuns: async () => [localGateRun],
      listTestEvidence: async () => [],
    },
  })

  return { boundRemoteSync, policy, repository }
}

describe('remote Gate override flow', () => {
  it('lets an independent Lead override an existing canonical Run without rewriting it', async () => {
    const { boundRemoteSync, policy, repository } = await createHarness({
      uploadCanonicalRun: true,
    })

    await expect(boundRemoteSync.saveGateOverride({
      runId: localGateRun.id,
      nodeId: localGateRun.currentNodeId,
      projectId: localGateRun.projectId,
      reason: 'Reviewed the canonical blocker independently.',
      blockedReasonIds: ['missing_agent_review:protected_gate:missing'],
      policyVersion: policy.version,
    })).resolves.toMatchObject({
      status: 'accepted',
      userId: reviewerSession.userId,
      role: 'lead',
    })

    const storedRun = (await repository.getRunsBundle({
      organizationId: reviewerSession.organizationId,
    })).runs.find(
      (candidate) => candidate.id === remoteRun.runId,
    )
    expect(storedRun).toMatchObject({
      creatorId: creatorSession.userId,
      nodes: [expect.objectContaining({ ownerId: creatorSession.userId })],
    })
  })

  it('does not synthesize a missing canonical Run while saving an override', async () => {
    const { boundRemoteSync, policy, repository } = await createHarness({
      uploadCanonicalRun: false,
    })

    await expect(boundRemoteSync.saveGateOverride({
      runId: localGateRun.id,
      nodeId: localGateRun.currentNodeId,
      projectId: localGateRun.projectId,
      reason: 'Do not fabricate the canonical prerequisite.',
      blockedReasonIds: ['missing_agent_review:protected_gate:missing'],
      policyVersion: policy.version,
    })).rejects.toMatchObject({
      status: 403,
      code: 'forbidden',
      retryable: false,
    })

    expect((await repository.getRunsBundle({
      organizationId: reviewerSession.organizationId,
    })).runs).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: localGateRun.id })]),
    )
  })
})
