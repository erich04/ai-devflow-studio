import { describe, expect, it } from 'vitest'
import type {
  Artifact,
  CodingAgentRun,
  CodingDiffArtifact,
  ManagedCodingWorkspace,
  TestEvidence,
  WorkflowRun,
} from './domain'
import {
  createGitHubDeliveryIntent,
  isTerminalGitHubDeliveryStatus,
  type GitHubRepositoryBinding,
} from './github-delivery'

const run: WorkflowRun = {
  id: 'run-1',
  version: 6,
  title: 'Ship delivery intent',
  request: 'Publish the tested managed-worktree change.',
  projectId: 'local-project-1',
  creatorId: 'user-1',
  status: 'testing',
  currentNodeId: 'run-1-pr',
  branchName: 'ai/planned-branch-is-not-source',
  createdAt: '2026-08-11T10:00:00.000Z',
  updatedAt: '2026-08-11T10:30:00.000Z',
  nodes: [
    {
      id: 'run-1-build',
      stage: 'build',
      title: 'Build',
      subtitle: 'Implement',
      kind: 'task',
      status: 'success',
      ownerId: 'user-1',
      requiredRole: 'member',
      retryCount: 0,
      artifactIds: ['diff-1'],
    },
    {
      id: 'run-1-pr',
      stage: 'pr',
      title: 'PR',
      subtitle: 'Deliver',
      kind: 'pr',
      status: 'running',
      ownerId: 'user-1',
      requiredRole: 'member',
      retryCount: 0,
      artifactIds: ['artifact-run-1-pr-draft'],
    },
  ],
  edges: [],
}

const codingRun: CodingAgentRun = {
  id: 'coding-1',
  runId: run.id,
  nodeId: 'run-1-build',
  projectId: run.projectId,
  requestedBy: 'user-1',
  providerId: 'fake-coding-engine',
  engine: 'fake',
  status: 'completed',
  managedWorkspaceId: 'workspace-1',
  branchName: 'devflow/run-1-build-coding-1',
  userInstruction: 'Implement the bounded change.',
  prompt: 'redacted',
  summary: 'Completed.',
  changedPaths: ['src/z.ts', 'src/a.ts', 'src/a.ts'],
  startedAt: '2026-08-11T10:05:00.000Z',
  completedAt: '2026-08-11T10:20:00.000Z',
  diffArtifactId: 'diff-1',
  testEvidenceId: 'test-1',
  redacted: true,
}

const workspace: ManagedCodingWorkspace = {
  id: 'workspace-1',
  projectId: run.projectId,
  codingRunId: codingRun.id,
  sourcePath: '/private/local/source',
  worktreePath: '/private/local/worktree',
  branchName: 'devflow/run-1-build-coding-1',
  baseBranch: 'main',
  baseCommitSha: '0000000000000000000000000000000000000000',
  headCommitSha: '1111111111111111111111111111111111111111',
  createdAt: '2026-08-11T10:04:00.000Z',
  cleanupStatus: 'active',
}

const prPackage: Artifact = {
  id: 'artifact-run-1-pr-draft',
  runId: run.id,
  nodeId: 'run-1-pr',
  kind: 'pr',
  title: 'PR Draft: Ship delivery intent',
  summary: 'Bounded delivery package.',
  content: '# Ship delivery intent\n\nEvidence only.',
  redacted: true,
  updatedAt: '2026-08-11T10:25:00.000Z',
  githubDeliverySource: {
    stateVersion: 1,
    codingRunId: codingRun.id,
    workspaceId: workspace.id,
    diffArtifactId: 'diff-1',
    diffSourceDigest: '2222222222222222222222222222222222222222222222222222222222222222',
    testEvidenceId: codingRun.testEvidenceId!,
    headBranch: workspace.branchName,
  },
}

const testEvidence = {
  id: 'delivery-test-1',
  runId: run.id,
  nodeId: codingRun.nodeId,
  projectId: run.projectId,
  command: 'pnpm test',
  cwd: workspace.worktreePath,
  status: 'passed',
  exitCode: 0,
  durationMs: 100,
  stdout: '',
  stderr: '',
  summary: 'Tests passed in the managed worktree.',
  redacted: true,
  sourceCommitSha: '1111111111111111111111111111111111111111',
  createdAt: '2026-08-11T10:22:00.000Z',
} satisfies TestEvidence & { sourceCommitSha: string }

const diffArtifact: CodingDiffArtifact = {
  id: 'diff-1',
  runId: run.id,
  nodeId: codingRun.nodeId,
  projectId: run.projectId,
  changedPaths: ['src/a.ts', 'src/z.ts'],
  patch: '+ redacted patch',
  sourceDigest: '2222222222222222222222222222222222222222222222222222222222222222',
  truncated: false,
  redacted: true,
  createdAt: '2026-08-11T10:18:00.000Z',
}

const repositoryBinding: GitHubRepositoryBinding = {
  stateVersion: 1,
  id: 'github-binding-1',
  version: 3,
  organizationId: 'org-1',
  teamProjectId: 'team-project-1',
  installationId: '123456',
  repositoryId: '987654321',
  repository: 'Erich04/AI-DevFlow-Studio',
  defaultBranch: 'main',
  status: 'active',
  validatedAt: '2026-08-11T09:59:00.000Z',
  updatedAt: '2026-08-11T09:59:00.000Z',
  redacted: true,
}

const baseInput = {
  id: 'delivery-1',
  repositoryBinding,
  run,
  prNodeId: 'run-1-pr',
  codingRun,
  workspace,
  diffArtifact,
  prPackage,
  testEvidence,
  baseCommitSha: '0000000000000000000000000000000000000000',
  expectedCommitSha: '1111111111111111111111111111111111111111',
  now: '2026-08-11T10:31:00.000Z',
}

describe('GitHub Delivery Intent', () => {
  it('distinguishes recoverable delivery work from terminal outcomes', () => {
    expect(isTerminalGitHubDeliveryStatus('recovery_required')).toBe(false)
    expect(isTerminalGitHubDeliveryStatus('completed')).toBe(true)
    expect(isTerminalGitHubDeliveryStatus('failed')).toBe(true)
    expect(isTerminalGitHubDeliveryStatus('revoked')).toBe(true)
  })
  it('binds the managed branch, expected commit, passing test, and PR package into one stable intent', async () => {
    const intent = await createGitHubDeliveryIntent(baseInput)
    const reordered = await createGitHubDeliveryIntent({
      ...baseInput,
      id: 'delivery-another-id',
      now: '2026-08-11T12:00:00.000Z',
      codingRun: {
        ...codingRun,
        changedPaths: ['src/a.ts', 'src/z.ts'],
      },
    })

    expect(intent).toMatchObject({
      id: 'delivery-1',
      organizationId: 'org-1',
      teamProjectId: 'team-project-1',
      localProjectId: 'local-project-1',
      runId: 'run-1',
      runVersion: 6,
      nodeId: 'run-1-pr',
      repositoryBindingId: 'github-binding-1',
      repositoryBindingVersion: 3,
      installationId: '123456',
      repositoryId: '987654321',
      codingRunId: 'coding-1',
      workspaceId: 'workspace-1',
      repository: 'erich04/ai-devflow-studio',
      baseBranch: 'main',
      headBranch: 'devflow/run-1-build-coding-1',
      baseCommitSha: '0000000000000000000000000000000000000000',
      expectedCommitSha: '1111111111111111111111111111111111111111',
    diffArtifactId: 'diff-1',
    diffSourceDigest: '2222222222222222222222222222222222222222222222222222222222222222',
      testEvidenceId: 'delivery-test-1',
      prPackageArtifactId: 'artifact-run-1-pr-draft',
      changedPaths: ['src/a.ts', 'src/z.ts'],
      status: 'approval_required',
      stateVersion: 1,
      redacted: true,
    })
    expect(intent.headBranch).not.toBe(run.branchName)
    expect(intent.intentDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(intent.idempotencyKey).toMatch(/^github-delivery:[a-f0-9]{64}$/u)
    expect(reordered.intentDigest).toBe(intent.intentDigest)
    expect(reordered.idempotencyKey).toBe(intent.idempotencyKey)
  })

  it('keeps one logical delivery key when only commit-bound test execution metadata changes', async () => {
    const first = await createGitHubDeliveryIntent(baseInput)
    const retested = await createGitHubDeliveryIntent({
      ...baseInput,
      id: 'delivery-retested',
      testEvidence: {
        ...testEvidence,
        id: 'delivery-test-retry',
        durationMs: 275,
        summary: 'The same expected commit passed a repeated test execution.',
        createdAt: '2026-08-11T10:29:00.000Z',
      },
      now: '2026-08-11T10:32:00.000Z',
    })

    expect(retested.intentDigest).not.toBe(first.intentDigest)
    expect(retested.idempotencyKey).toBe(first.idempotencyKey)
  })

  it('fails closed when Test Evidence is not for the exact expected commit', async () => {
    await expect(createGitHubDeliveryIntent({
      ...baseInput,
      testEvidence: {
        ...testEvidence,
        sourceCommitSha: '2222222222222222222222222222222222222222',
      },
    })).rejects.toThrow('Test Evidence is not bound to the expected commit')
  })

  it('fails closed when the PR Delivery Package points at another coding source', async () => {
    await expect(createGitHubDeliveryIntent({
      ...baseInput,
      prPackage: {
        ...prPackage,
        githubDeliverySource: {
          ...prPackage.githubDeliverySource!,
          codingRunId: 'coding-other',
        },
      },
    })).rejects.toThrow('PR Delivery Package does not match the managed coding source')
  })

  it('changes the intent digest when commit-bound Test Evidence changes', async () => {
    const original = await createGitHubDeliveryIntent(baseInput)
    const changed = await createGitHubDeliveryIntent({
      ...baseInput,
      testEvidence: {
        ...testEvidence,
        summary: 'A different test result was persisted.',
      },
    })

    expect(changed.testEvidenceDigest).not.toBe(original.testEvidenceDigest)
    expect(changed.intentDigest).not.toBe(original.intentDigest)
  })

  it('changes the intent digest when the reviewed raw diff digest changes', async () => {
    const original = await createGitHubDeliveryIntent(baseInput)
    const changedDigest = '3333333333333333333333333333333333333333333333333333333333333333'
    const changed = await createGitHubDeliveryIntent({
      ...baseInput,
      diffArtifact: { ...diffArtifact, sourceDigest: changedDigest },
      prPackage: {
        ...prPackage,
        githubDeliverySource: {
          ...prPackage.githubDeliverySource!,
          diffSourceDigest: changedDigest,
        },
      },
    })

    expect(changed.diffSourceDigest).toBe(changedDigest)
    expect(changed.intentDigest).not.toBe(original.intentDigest)
  })

  it('rejects an unsafe repository or a non-DevFlow publication branch', async () => {
    await expect(createGitHubDeliveryIntent({
      ...baseInput,
      repositoryBinding: {
        ...repositoryBinding,
        repository: 'https://github.com/erich04/ai-devflow-studio',
      },
    })).rejects.toThrow('GitHub repository must use owner/name format')

    await expect(createGitHubDeliveryIntent({
      ...baseInput,
      workspace: { ...workspace, branchName: 'main' },
      codingRun: { ...codingRun, branchName: 'main' },
    })).rejects.toThrow('GitHub delivery branch must use the devflow/ namespace')
  })
})
