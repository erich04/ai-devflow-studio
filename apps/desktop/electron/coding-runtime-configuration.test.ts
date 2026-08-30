import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LocalProject, WorkflowRun } from '@ai-devflow/shared'
import type { CodingExecutor } from './coding-executor.js'
import {
  evaluateCodingRuntimeReadiness,
  resolveCodingRuntimeSelection,
} from './coding-runtime-configuration.js'
import { createLocalStore } from './local-store.js'

const execFileAsync = promisify(execFile)
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
  )
  temporaryDirectories.length = 0
})

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), `${prefix}-`))
  temporaryDirectories.push(directory)
  return directory
}

const openCodeReadinessDefaults = {
  binaryAvailable: true,
  versionCompatible: true,
  authAvailable: true,
  profileAvailable: true,
  modelAvailable: true,
}

async function createOpenCodeReadinessFixture() {
  const repositoryPath = await temporaryDirectory('devflow-opencode-readiness-repository')
  const storeDirectory = await temporaryDirectory('devflow-opencode-readiness-store')
  await execFileAsync('git', ['-C', repositoryPath, 'init', '-b', 'main'])

  const project: LocalProject = {
    id: 'opencode-readiness-project',
    name: 'opencode-readiness-project',
    path: repositoryPath,
    packageManager: 'pnpm',
    detectedTestCommand: 'pnpm test',
    testCommand: 'pnpm test',
    createdAt: '2026-08-30T18:00:00.000Z',
    updatedAt: '2026-08-30T18:00:00.000Z',
  }
  const run: WorkflowRun = {
    id: 'opencode-readiness-run',
    version: 1,
    title: 'OpenCode readiness',
    request: 'Implement the approved design with OpenCode.',
    projectId: project.id,
    creatorId: 'u-local-owner',
    status: 'building',
    currentNodeId: 'opencode-readiness-build',
    branchName: 'devflow/opencode-readiness',
    createdAt: '2026-08-30T18:00:00.000Z',
    updatedAt: '2026-08-30T18:00:00.000Z',
    nodes: [{
      id: 'opencode-readiness-build',
      stage: 'build',
      title: 'Implement locally',
      subtitle: 'Run OpenCode in a managed worktree.',
      kind: 'task',
      status: 'running',
      ownerId: 'u-local-owner',
      retryCount: 0,
      artifactIds: [],
    }],
    edges: [],
  }
  const configuration = {
    projectId: project.id,
    executor: 'opencode-http' as const,
    providerId: 'openai',
    modelId: 'gpt-4.1-mini',
    binaryPath: '/opt/devflow/bin/opencode',
    detectedVersion: '1.2.3',
    version: 1,
    updatedAt: '2026-08-30T18:00:00.000Z',
  }
  const store = await createLocalStore({
    dbPath: path.join(storeDirectory, 'devflow.sqlite'),
  })
  await store.upsertProject(project)
  await store.saveRun(run)
  await store.saveDesktopPairingCredential({
    tokenId: 'opencode-pairing-token',
    organizationId: 'org-local',
    projectId: 'team-project-opencode',
    userId: run.creatorId,
    role: 'owner',
    authAccountId: 'acct-local-owner',
    projectMemberships: [{
      projectId: 'team-project-opencode',
      userId: run.creatorId,
      role: 'owner',
    }],
    createdAt: '2026-08-30T18:00:00.000Z',
    localProjectId: project.id,
  }, 'encrypted-pairing-token')
  await store.saveCodingRuntimeConfiguration(configuration)

  const selection = await resolveCodingRuntimeSelection({
    store,
    projectId: project.id,
    env: {},
  })
  const executor = {
    descriptor: {
      stateVersion: 1,
      id: 'coding-executor-opencode-http',
      version: 1,
      kind: 'opencode',
      availability: { status: 'available', reasonCode: null },
      capabilities: [
        'cancellation',
        'permission_relay',
        'structured_diff',
        'workspace_edit',
        'workspace_read',
      ],
    },
    engine: 'opencode-http',
    providerId: configuration.providerId,
    modelId: configuration.modelId,
    billing: 'opaque',
  } as CodingExecutor
  const evaluateBudget = vi.fn(async () => ({
    status: 'allowed' as const,
    blocksRun: false,
    currentSpendUsd: 8,
    projectedCostUsd: 1,
    limitUsd: 20,
    reason: 'A metered provider is within budget.',
  }))

  return {
    store,
    project,
    run,
    selection,
    executor,
    evaluateBudget,
    evaluate: (opencodeReadiness: typeof openCodeReadinessDefaults) =>
      evaluateCodingRuntimeReadiness({
        store,
        selection,
        executor,
        opencodeReadiness,
        engineAvailable: true,
        projectId: project.id,
        runId: run.id,
        nodeId: run.currentNodeId,
        requestedBy: run.creatorId,
        getBudgetPolicy: async () => ({
          projectId: project.id,
          enabled: true,
          monthlyLimitUsd: 20,
          warningThresholdUsd: 15,
          currency: 'USD',
          updatedAt: '2026-08-30T18:00:00.000Z',
        }),
        evaluateBudget,
        now: () => '2026-08-30T18:01:00.000Z',
      }),
  }
}

describe('project Coding Runtime configuration', () => {
  it('uses a saved project configuration with no DEVFLOW_CODING_* override and becomes ready', async () => {
    const repositoryPath = await temporaryDirectory('devflow-coding-readiness-repository')
    const storeDirectory = await temporaryDirectory('devflow-coding-readiness-store')
    await execFileAsync('git', ['-C', repositoryPath, 'init', '-b', 'main'])

    const project: LocalProject = {
      id: 'coding-readiness-project',
      name: 'coding-readiness-project',
      path: repositoryPath,
      packageManager: 'npm',
      detectedTestCommand: 'npm test',
      testCommand: 'npm test',
      createdAt: '2026-08-29T10:00:00.000Z',
      updatedAt: '2026-08-29T10:00:00.000Z',
    }
    const run: WorkflowRun = {
      id: 'coding-readiness-run',
      version: 1,
      title: 'Coding readiness',
      request: 'Implement the approved design.',
      projectId: project.id,
      creatorId: 'u-local-owner',
      status: 'building',
      currentNodeId: 'coding-readiness-build',
      branchName: 'devflow/coding-readiness',
      createdAt: '2026-08-29T10:00:00.000Z',
      updatedAt: '2026-08-29T10:00:00.000Z',
      nodes: [{
        id: 'coding-readiness-build',
        stage: 'build',
        title: 'Implement locally',
        subtitle: 'Run Coding Agent in a managed worktree.',
        kind: 'task',
        status: 'running',
        ownerId: 'u-local-owner',
        retryCount: 0,
        artifactIds: [],
      }],
      edges: [],
    }
    const store = await createLocalStore({
      dbPath: path.join(storeDirectory, 'devflow.sqlite'),
    })
    try {
      await store.upsertProject(project)
      await store.saveRun(run)
      await store.saveProviderCredential({
        providerId: 'deepseek',
        model: 'deepseek-v4-flash',
        baseUrl: 'https://api.deepseek.com',
        maskedCredential: 'sk-...bc92',
        updatedAt: '2026-08-29T10:00:00.000Z',
      }, 'encrypted-provider-secret')
      await store.saveDesktopPairingCredential({
        tokenId: 'local-pairing-token',
        organizationId: 'org-local',
        projectId: 'team-project-local',
        userId: run.creatorId,
        role: 'owner',
        authAccountId: 'acct-local-owner',
        projectMemberships: [{
          projectId: 'team-project-local',
          userId: run.creatorId,
          role: 'owner',
        }],
        createdAt: '2026-08-29T10:00:00.000Z',
        localProjectId: project.id,
      }, 'encrypted-pairing-token')
      await store.saveCodingRuntimeConfiguration({
        projectId: project.id,
        executor: 'native-model',
        providerId: 'deepseek',
        version: 1,
        updatedAt: '2026-08-29T10:00:00.000Z',
      })

      const selection = await resolveCodingRuntimeSelection({
        store,
        projectId: project.id,
        env: {},
      })
      expect(selection).toMatchObject({
        source: 'project',
        executor: 'native-model',
        providerId: 'deepseek',
        configVersion: 1,
      })

      const executor = {
        descriptor: {
          stateVersion: 1,
          id: 'coding-executor-native',
          version: 2,
          kind: 'native',
          availability: { status: 'available', reasonCode: null },
          capabilities: ['cancellation', 'structured_diff', 'workspace_edit', 'workspace_read'],
        },
        engine: 'native',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
      } as CodingExecutor
      const readiness = await evaluateCodingRuntimeReadiness({
        store,
        selection,
        executor,
        projectId: project.id,
        runId: run.id,
        nodeId: run.currentNodeId,
        requestedBy: run.creatorId,
        getBudgetPolicy: async () => ({
          projectId: project.id,
          enabled: true,
          monthlyLimitUsd: 0.20,
          warningThresholdUsd: 0.10,
          currency: 'USD',
          updatedAt: '2026-08-29T10:00:00.000Z',
        }),
        evaluateBudget: async ({ providerId }) => ({
          status: 'allowed',
          blocksRun: false,
          currentSpendUsd: 0,
          projectedCostUsd: 0.01,
          limitUsd: 0.20,
          reason: `Provider ${providerId} is within the saved project budget.`,
        }),
        now: () => '2026-08-29T10:01:00.000Z',
      })

      expect(readiness).toMatchObject({
        status: 'ready',
        engine: 'native',
        executor: 'native-model',
        availability: 'available',
        providerRequirement: 'saved-provider',
        providerId: 'deepseek',
        configVersion: 1,
        budgetPolicy: { monthlyLimitUsd: 0.20, warningThresholdUsd: 0.10 },
      })
      expect(readiness.checks.every((check) => check.status === 'ready')).toBe(true)
    } finally {
      store.close()
    }
  })

  it('keeps an explicit environment executor above the saved project configuration', async () => {
    const selection = await resolveCodingRuntimeSelection({
      store: {
        getCodingRuntimeConfiguration: async () => ({
          projectId: 'project-1',
          executor: 'native-model',
          providerId: 'project-provider',
          version: 7,
          updatedAt: '2026-08-29T10:00:00.000Z',
        }),
      },
      projectId: 'project-1',
      env: {
        DEVFLOW_CODING_EXECUTOR: 'native-model',
        DEVFLOW_NATIVE_CODING_PROVIDER_ID: 'operator-provider',
      },
    })

    expect(selection).toEqual({
      source: 'environment',
      executor: 'native-model',
      providerId: 'operator-provider',
      configVersion: 0,
    })
  })

  it('resolves an explicitly confirmed project OpenCode configuration without environment flags', async () => {
    const configuration = {
      projectId: 'project-1',
      executor: 'opencode-http' as const,
      providerId: 'openai',
      modelId: 'gpt-4.1-mini',
      binaryPath: '/opt/devflow/bin/opencode',
      detectedVersion: '1.2.3',
      version: 3,
      updatedAt: '2026-08-30T18:00:00.000Z',
    }

    await expect(resolveCodingRuntimeSelection({
      store: { getCodingRuntimeConfiguration: async () => configuration },
      projectId: configuration.projectId,
      env: {},
    })).resolves.toEqual({
      source: 'project',
      executor: 'opencode-http',
      providerId: 'openai',
      configVersion: 3,
      configuration,
    })
  })

  it.each([
    ['binary_missing', 'binaryAvailable'],
    ['version_incompatible', 'versionCompatible'],
    ['auth_unavailable', 'authAvailable'],
    ['profile_unavailable', 'profileAvailable'],
    ['model_unavailable', 'modelAvailable'],
  ] as const)('distinguishes the OpenCode %s readiness blocker', async (blockedCode, readinessField) => {
    const fixture = await createOpenCodeReadinessFixture()
    try {
      const readiness = await fixture.evaluate({
        ...openCodeReadinessDefaults,
        [readinessField]: false,
      })
      const openCodeChecks = new Map(
        readiness.checks
          .filter((candidate) => [
            'binary_missing',
            'version_incompatible',
            'auth_unavailable',
            'profile_unavailable',
            'model_unavailable',
          ].includes(candidate.code))
          .map((candidate) => [candidate.code, candidate.status]),
      )

      expect(readiness.status).toBe('blocked')
      expect(openCodeChecks.get(blockedCode)).toBe('blocked')
      expect([...openCodeChecks.entries()].filter(([, status]) => status === 'blocked'))
        .toEqual([[blockedCode, 'blocked']])
    } finally {
      fixture.store.close()
    }
  })

  it('becomes ready when every OpenCode prerequisite is available without inventing metered USD budget data', async () => {
    const fixture = await createOpenCodeReadinessFixture()
    try {
      expect(fixture.selection).toMatchObject({
        source: 'project',
        executor: 'opencode-http',
        providerId: 'openai',
        configVersion: 1,
      })

      const readiness = await fixture.evaluate(openCodeReadinessDefaults)
      const categoryChecks = readiness.checks.filter((candidate) => [
        'binary_missing',
        'version_incompatible',
        'auth_unavailable',
        'profile_unavailable',
        'model_unavailable',
      ].includes(candidate.code))

      expect(readiness).toMatchObject({
        status: 'ready',
        engine: 'opencode-http',
        executor: 'opencode-http',
        availability: 'available',
        providerRequirement: 'opencode-provider',
        providerId: 'openai',
        configVersion: 1,
        budgetDecision: {
          status: 'disabled',
          blocksRun: false,
          reason: 'OpenCode usage is subscription/opaque; dollar cost is unknown and non-dollar runtime limits apply.',
        },
      })
      expect(categoryChecks).toHaveLength(5)
      expect(categoryChecks.every((candidate) => candidate.status === 'ready')).toBe(true)
      expect(readiness.checks.every((candidate) => candidate.status === 'ready')).toBe(true)
      expect(fixture.evaluateBudget).not.toHaveBeenCalled()
      expect(readiness.budgetDecision?.status).not.toBe('allowed')
      expect(readiness.budgetDecision?.reason).toContain('dollar cost is unknown')
    } finally {
      fixture.store.close()
    }
  })
})
