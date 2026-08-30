import { expect, test } from '@playwright/test'

async function installDesktopApi(
  page: import('@playwright/test').Page,
  scenario: 'empty' | 'coding-permission' | 'coding-lifecycle' | 'clarification-revision' = 'empty',
) {
  await page.addInitScript((initialScenario) => {
    let clarificationFeedbackRequested = initialScenario === 'clarification-revision'
    const clarificationRequests: unknown[] = []
    const clarificationApprovals: unknown[] = []
    ;(window as unknown as { __clarificationRequests: unknown[] }).__clarificationRequests = clarificationRequests
    ;(window as unknown as { __clarificationApprovals: unknown[] }).__clarificationApprovals = clarificationApprovals
    const codingConfigurationSaves: unknown[] = []
    ;(window as unknown as { __codingConfigurationSaves: unknown[] }).__codingConfigurationSaves = codingConfigurationSaves
    const codingPermissionReplies: unknown[] = []
    ;(window as unknown as { __codingPermissionReplies: unknown[] }).__codingPermissionReplies = codingPermissionReplies
    const localProject = {
      id: 'local-project-1',
      name: 'fixture-project',
      path: '/tmp/fixture-project',
      packageManager: 'pnpm',
      detectedTestCommand: 'pnpm test',
      testCommand: 'pnpm test',
      createdAt: '2026-06-15T00:00:00.000Z',
      updatedAt: '2026-06-15T00:00:00.000Z',
    }
    let codingLifecycleStarted = initialScenario !== 'coding-lifecycle'
    let codingPermissionApproved = false
    const codingScenarioState = () => {
      const buildNode = {
        id: 'node-build-review', stage: 'build', title: 'Implement locally', subtitle: 'Run Coding Agent in a managed worktree',
        kind: 'task', status: codingPermissionApproved ? 'success' : 'running', ownerId: 'u-ling', retryCount: 0, artifactIds: [],
      }
      const testNode = {
        id: 'node-test-review', stage: 'test', title: 'Verify the approved change', subtitle: 'Run the saved test evidence',
        kind: 'test', status: codingPermissionApproved ? 'running' : 'pending', ownerId: 'u-ling', retryCount: 0, artifactIds: [],
      }
      const codingRun = {
        id: 'coding-run-review', runId: 'run-coding-review', nodeId: 'node-build-review', projectId: localProject.id,
        requestedBy: 'u-ling', providerId: 'doubao-review', engine: 'native',
        status: codingPermissionApproved ? 'completed' : 'waiting_permission',
        managedWorkspaceId: 'workspace-review', changeSetId: 'change-set-review', branchName: 'devflow/coding-review-1',
        userInstruction: 'Apply the exact patch.', prompt: 'local redacted prompt',
        summary: codingPermissionApproved ? 'Applied two approved files and the saved test passed.' : 'Waiting for exact Change Set approval.',
        changedPaths: codingPermissionApproved ? ['src/a.ts', 'src/b.ts'] : [],
        startedAt: '2026-08-30T12:00:00.000Z',
        ...(codingPermissionApproved ? {
          completedAt: '2026-08-30T12:02:00.000Z', diffArtifactId: 'diff-review', testEvidenceId: 'test-review',
          runtimeCostSummary: {
            id: 'cost-review', runId: 'run-coding-review', nodeId: 'node-build-review', userId: 'u-ling', projectId: localProject.id,
            provider: 'openai', providerId: 'doubao-review', model: 'review-model', inputTokens: 120, outputTokens: 30,
            cacheReadTokens: 20, cacheMissTokens: 100, totalTokens: 150, cacheHitRate: 1 / 6,
            usageStatus: 'complete', costStatus: 'settled', phase: 'provider_settlement', costUsd: 0.012,
            timestamp: '2026-08-30T12:02:00.000Z', source: 'provider_reported', redacted: true,
          },
        } : {}),
        redacted: true,
      }
      const permission = {
        id: 'permission-review', codingRunId: codingRun.id, runId: 'run-coding-review', nodeId: 'node-build-review',
        origin: 'coding_executor', permission: 'patch', title: 'Apply exact Change Set', changeSetId: 'change-set-review',
        changeSetDigest: 'c'.repeat(64), risk: 'warn', reasons: ['Review the exact two-file diff.'],
        status: codingPermissionApproved ? 'approved' : 'pending', requestedAt: '2026-08-30T12:00:00.000Z',
        expiresAt: '2099-08-30T12:05:00.000Z',
      }
      return {
        projects: [localProject],
        runs: [{
          id: 'run-coding-review', version: codingPermissionApproved ? 2 : 1, title: 'Review a governed coding change', request: 'Apply the exact patch.',
          projectId: localProject.id, creatorId: 'u-ling', status: codingPermissionApproved ? 'testing' : 'building',
          currentNodeId: codingPermissionApproved ? testNode.id : buildNode.id,
          branchName: 'devflow/coding-review', createdAt: '2026-08-30T12:00:00.000Z', updatedAt: codingPermissionApproved ? '2026-08-30T12:02:00.000Z' : '2026-08-30T12:00:00.000Z',
          nodes: [buildNode, testNode], edges: [{ id: 'edge-build-test-review', source: buildNode.id, target: testNode.id, kind: 'sequence' }],
        }],
        artifacts: [], events: [],
        testEvidence: codingPermissionApproved ? [{
          id: 'test-review', runId: 'run-coding-review', nodeId: buildNode.id, projectId: localProject.id,
          command: 'pnpm test', cwd: '<workspace>', status: 'passed', exitCode: 0, durationMs: 42,
          stdout: '2 passed', stderr: '', summary: 'Saved worktree test passed.', redacted: true,
          createdAt: '2026-08-30T12:02:00.000Z',
        }] : [],
        settings: { themePreference: 'system' }, mcpServers: [], agentReviews: [], agentTraces: [], agentTokenUsage: [],
        codingRuns: codingLifecycleStarted ? [codingRun] : [],
        codingEvents: codingPermissionApproved ? [
          { id: 'event-apply', codingRunId: codingRun.id, runId: codingRun.runId, nodeId: buildNode.id, sequence: 1, kind: 'tool_result', message: 'Applied the exact approved Change Set.', timestamp: '2026-08-30T12:01:00.000Z', redacted: true },
          { id: 'event-test', codingRunId: codingRun.id, runId: codingRun.runId, nodeId: buildNode.id, sequence: 2, kind: 'test', message: 'Saved worktree test passed.', timestamp: '2026-08-30T12:02:00.000Z', redacted: true },
        ] : [],
        codingPermissionRequests: codingLifecycleStarted ? [permission] : [],
        codingPermissionDecisions: codingPermissionApproved ? [{ id: 'decision-review', requestId: permission.id, codingRunId: codingRun.id, decidedBy: 'u-ling', decision: 'approved', comment: 'Approved once.', decidedAt: '2026-08-30T12:01:00.000Z' }] : [],
        managedCodingWorkspaces: codingLifecycleStarted ? [{
          id: 'workspace-review', projectId: localProject.id, codingRunId: codingRun.id, sourcePath: localProject.path,
          worktreePath: '/tmp/devflow-review', branchName: 'devflow/coding-review-1', baseBranch: 'main',
          createdAt: '2026-08-30T12:00:00.000Z', cleanupStatus: 'active',
        }] : [],
        dependencyBootstrapEvidence: [],
        codingDiffArtifacts: codingPermissionApproved ? [{
          id: 'diff-review', runId: 'run-coding-review', nodeId: buildNode.id, projectId: localProject.id,
          changedPaths: ['src/a.ts', 'src/b.ts'], patch: 'diff --git a/src/a.ts b/src/a.ts\n+new\ndiff --git a/src/b.ts b/src/b.ts\n+second',
          truncated: false, redacted: true, createdAt: '2026-08-30T12:02:00.000Z',
        }] : [],
      }
    }

    ;(window as unknown as { aiDevFlowDesktop: unknown }).aiDevFlowDesktop = {
      platform: 'e2e',
      loadState: async () => initialScenario === 'coding-permission' || initialScenario === 'coding-lifecycle'
        ? codingScenarioState()
        : initialScenario === 'clarification-revision' ? (() => {
        const runId = 'run-clarification-e2e'
        const agentId = `${runId}-clarify`
        const gateId = `${runId}-clarify-gate`
        const raw = {
          id: `artifact-${runId}-raw-request`, runId, nodeId: agentId, kind: 'raw_request',
          title: 'Raw request', summary: 'Clarify retry behavior.',
          content: 'Clarify webhook retry boundaries before implementation.', redacted: false,
          updatedAt: '2026-08-30T12:00:00.000Z',
        }
        const clarification = {
          id: `artifact-${runId}-clarification`, runId, nodeId: agentId, kind: 'clarification',
          title: 'Clarification v1', summary: 'First reviewable revision.',
          content: '# Clarification v1\n\nRetry boundaries and acceptance criteria.', redacted: true,
          updatedAt: '2026-08-30T12:01:00.000Z',
          clarificationRevision: {
            version: 1, revision: 1, status: 'review_requested', revisionDigest: 'a'.repeat(64),
            rawRequestArtifactId: raw.id, feedbackArtifactIds: [], goals: ['Bound retries'],
            acceptanceCriteria: ['Retry boundary is explicit'], nonGoals: ['No implementation'],
            assumptions: [], risks: [], openQuestions: [],
            repositoryFindings: {
              version: 1, repositoryDigest: 'b'.repeat(64),
              verifiedFacts: [{ id: 'fact-1', statement: 'Retry handler exists.', citationIds: ['citation-1'] }],
              citations: [{ id: 'citation-1', path: 'src/retry.ts', contentDigest: 'c'.repeat(64) }],
              assumptions: [], openQuestions: [], uncheckedScopes: ['generated files'],
            },
            executor: {
              version: 1, kind: 'local-agent', executorId: 'fake-local', executorVersion: '1',
              capabilityProfile: 'repository-read-only-v1', model: 'fake',
              startedAt: '2026-08-30T12:01:00.000Z', completedAt: '2026-08-30T12:01:00.000Z',
              durationMs: 10, terminalReason: 'success', contextDigest: 'd'.repeat(64),
            }, generatedAt: '2026-08-30T12:01:00.000Z',
          },
        }
        const run = {
          id: runId, version: 2, title: 'Clarification revision E2E', request: raw.content,
          projectId: localProject.id, creatorId: 'u-ling', status: 'paused_at_gate', currentNodeId: gateId,
          branchName: 'ai/clarification-e2e', createdAt: raw.updatedAt, updatedAt: clarification.updatedAt,
          nodes: [
            { id: agentId, stage: 'clarify', title: '需求澄清', subtitle: '补齐验收口径与非目标', kind: 'agent', status: 'success', ownerId: 'u-ling', retryCount: 0, artifactIds: [raw.id, clarification.id] },
            { id: gateId, stage: 'clarify', title: '需求确认 Gate', subtitle: '确认当前澄清版本', kind: 'gate', status: 'running', ownerId: 'u-ling', requiredRole: 'member', retryCount: 0, artifactIds: [clarification.id] },
          ],
          edges: [{ id: `${runId}-edge`, source: agentId, target: gateId, kind: 'gate' }],
        }
        return {
          projects: [localProject], runs: [run], artifacts: [raw, clarification], events: [], testEvidence: [],
          settings: { themePreference: 'system' }, mcpServers: [], agentReviews: [], agentTraces: [],
          agentTokenUsage: [], codingRuns: [], codingEvents: [], codingPermissionRequests: [],
          codingPermissionDecisions: [], managedCodingWorkspaces: [], dependencyBootstrapEvidence: [],
          codingDiffArtifacts: [],
        }
      })() : ({
        projects: [localProject],
        runs: [],
        artifacts: [],
        events: [],
        testEvidence: [],
        settings: { themePreference: 'system' },
        mcpServers: [],
        agentReviews: [],
        agentTraces: [],
        agentTokenUsage: [],
        codingRuns: [],
        codingEvents: [],
        codingPermissionRequests: [],
        codingPermissionDecisions: [],
        managedCodingWorkspaces: [],
        dependencyBootstrapEvidence: [],
        codingDiffArtifacts: [],
      }),
      loadRemoteSnapshot: async () => ({
        projects: [],
        members: [],
        runs: [],
        artifacts: [],
        events: [],
        projectCost: [],
        memberCost: [],
        totalCost: '$0.000',
      }),
      selectLocalProject: async () => localProject,
      saveProjectTestCommand: async ({ testCommand }: { testCommand: string }) => ({
        ...localProject,
        testCommand,
        updatedAt: '2026-06-15T00:01:00.000Z',
      }),
      validateTestCommand: async ({ testCommand }: { testCommand: string }) => ({
        level: testCommand.includes('rm -rf') ? 'blocked' : 'safe',
        reasons: testCommand.includes('rm -rf')
          ? ['Command contains destructive recursive removal.']
          : [],
        normalizedCommand: testCommand.trim().replace(/\s+/g, ' '),
      }),
      loadEnforcementPolicy: async ({ projectId }: { projectId: string }) => ({
        projectId,
        organizationPolicy: null,
        projectOverride: null,
        effectivePolicy: null,
        version: 1,
        updatedAt: '2026-06-15T00:00:00.000Z',
        syncedAt: '2026-06-15T00:00:00.000Z',
        source: 'built_in_default',
      }),
      evaluateGateEnforcement: async () => ({
        status: 'pass',
        blocksApproval: false,
        blockingReasons: [],
        warningReasons: [],
        requiredActions: [],
        canOverride: false,
        overrideRoleRequired: 'lead',
        policySource: 'built_in_default',
        policyVersion: 1,
        provisional: false,
      }),
      createRun: async (input: {
        title: string
        request: string
        projectId: string
        creatorId: string
        branchName: string
      }) => {
        const timestamp = '2026-06-21T16:00:00.000Z'
        const runId = 'run-created-from-request'
        const nodeIds = {
          clarify: `${runId}-clarify`,
          clarifyGate: `${runId}-clarify-gate`,
          design: `${runId}-design`,
          designGate: `${runId}-design-gate`,
          build: `${runId}-build`,
          test: `${runId}-test`,
          pr: `${runId}-pr`,
          accept: `${runId}-accept`,
        }

        return {
          id: runId,
          title: input.title,
          request: input.request,
          projectId: input.projectId,
          creatorId: input.creatorId,
          status: 'clarifying',
          currentNodeId: nodeIds.clarify,
          branchName: input.branchName,
          createdAt: timestamp,
          updatedAt: timestamp,
          nodes: [
            {
              id: nodeIds.clarify,
              stage: 'clarify',
              title: '需求澄清',
              subtitle: '补齐验收口径与非目标',
              kind: 'agent',
              status: 'running',
              ownerId: input.creatorId,
              retryCount: 0,
              artifactIds: [`artifact-${runId}-raw-request`],
            },
            {
              id: nodeIds.clarifyGate,
              stage: 'clarify',
              title: '需求确认 Gate',
              subtitle: '确认需求已准备进入方案设计',
              kind: 'gate',
              status: 'pending',
              ownerId: input.creatorId,
              requiredRole: 'member',
              retryCount: 0,
              artifactIds: [],
            },
            {
              id: nodeIds.design,
              stage: 'design',
              title: '方案设计',
              subtitle: '定义实现方案与测试策略',
              kind: 'agent',
              status: 'pending',
              ownerId: input.creatorId,
              retryCount: 0,
              artifactIds: [],
            },
            {
              id: nodeIds.designGate,
              stage: 'design',
              title: '方案评审 Gate',
              subtitle: '审批方案后进入实现',
              kind: 'gate',
              status: 'pending',
              ownerId: input.creatorId,
              requiredRole: 'lead',
              retryCount: 0,
              artifactIds: [],
            },
            {
              id: nodeIds.build,
              stage: 'build',
              title: 'Implement locally',
              subtitle: 'Run Coding Agent in a managed worktree',
              kind: 'task',
              status: 'pending',
              ownerId: input.creatorId,
              retryCount: 0,
              artifactIds: [],
            },
            {
              id: nodeIds.test,
              stage: 'test',
              title: 'Run tests',
              subtitle: 'Archive local test evidence',
              kind: 'test',
              status: 'pending',
              ownerId: input.creatorId,
              retryCount: 0,
              artifactIds: [],
            },
            {
              id: nodeIds.pr,
              stage: 'pr',
              title: 'Prepare PR draft',
              subtitle: 'Summarize diff, tests, policy, and review evidence',
              kind: 'pr',
              status: 'pending',
              ownerId: input.creatorId,
              retryCount: 0,
              artifactIds: [],
            },
            {
              id: nodeIds.accept,
              stage: 'accept',
              title: 'Acceptance signoff',
              subtitle: 'Approve final delivery bundle',
              kind: 'acceptance',
              status: 'pending',
              ownerId: input.creatorId,
              requiredRole: 'lead',
              retryCount: 0,
              artifactIds: [],
            },
          ],
          edges: [
            { id: `${runId}-edge-1`, source: nodeIds.clarify, target: nodeIds.clarifyGate, kind: 'gate' },
            { id: `${runId}-edge-2`, source: nodeIds.clarifyGate, target: nodeIds.design, kind: 'normal' },
            { id: `${runId}-edge-3`, source: nodeIds.design, target: nodeIds.designGate, kind: 'gate' },
            { id: `${runId}-edge-4`, source: nodeIds.designGate, target: nodeIds.build, kind: 'normal' },
            { id: `${runId}-edge-5`, source: nodeIds.build, target: nodeIds.test, kind: 'normal' },
            { id: `${runId}-edge-6`, source: nodeIds.test, target: nodeIds.pr, kind: 'normal' },
            { id: `${runId}-edge-7`, source: nodeIds.pr, target: nodeIds.accept, kind: 'gate' },
          ],
        }
      },
      completeWorkflowAgentNode: async (input: {
        runId: string
        nodeId: string
        userName: string
      }) => {
        const revision = clarificationFeedbackRequested ? 2 : 1
        const timestamp = revision === 2 ? '2026-08-30T12:06:00.000Z' : '2026-06-21T16:05:00.000Z'
        const clarifyGateId = `${input.runId}-clarify-gate`
        const rawRequestArtifact = {
          id: `artifact-${input.runId}-raw-request`,
          runId: input.runId,
          nodeId: input.nodeId,
          kind: 'raw_request',
          title: 'Raw request',
          summary: '重构 GitHub webhook 重试策略',
          content: '请先澄清 webhook retry 的失败边界，再设计实现方案。',
          redacted: false,
          updatedAt: '2026-06-21T16:00:00.000Z',
        }
        const priorArtifact = revision === 2 ? {
          id: `artifact-${input.runId}-clarification`, runId: input.runId, nodeId: input.nodeId,
          kind: 'clarification', title: 'Clarification v1', summary: 'First reviewable revision.',
          content: '# Clarification v1\n\nRetry boundaries and acceptance criteria.', redacted: true,
          updatedAt: '2026-08-30T12:01:00.000Z',
          clarificationRevision: {
            version: 1, revision: 1, status: 'superseded', revisionDigest: 'a'.repeat(64),
            rawRequestArtifactId: rawRequestArtifact.id,
            feedbackArtifactIds: [`artifact-${input.runId}-clarification-feedback-r1`],
            goals: ['Bound retries'], acceptanceCriteria: ['Retry boundary is explicit'],
            nonGoals: ['No implementation'], assumptions: [], risks: [], openQuestions: [],
            executor: { version: 1, kind: 'local-agent', executorId: 'fake-local', executorVersion: '1', capabilityProfile: 'repository-read-only-v1', model: 'fake', startedAt: timestamp, completedAt: timestamp, durationMs: 10, terminalReason: 'success', contextDigest: 'd'.repeat(64) },
            generatedAt: '2026-08-30T12:01:00.000Z',
          },
        } : null
        const feedbackArtifact = revision === 2 ? {
          id: `artifact-${input.runId}-clarification-feedback-r1`, runId: input.runId,
          nodeId: clarifyGateId, kind: 'clarification_feedback', title: 'Clarification revision 1 feedback',
          summary: 'Changes requested for clarification revision 1.',
          content: 'State the retry boundary explicitly.', redacted: true, updatedAt: '2026-08-30T12:05:00.000Z',
          clarificationFeedback: { version: 1, targetArtifactId: priorArtifact!.id, targetRevision: 1, targetRevisionDigest: 'a'.repeat(64), actorId: 'u-ling', actorName: 'Ling', reasonDigest: 'e'.repeat(64), createdAt: '2026-08-30T12:05:00.000Z' },
        } : null
        const artifact = {
          id: revision === 1
            ? `artifact-${input.runId}-clarification`
            : `artifact-${input.runId}-clarification-v2`,
          runId: input.runId,
          nodeId: input.nodeId,
          kind: 'clarification',
          title: '需求澄清结果',
          summary: 'Clarified scope for the requested change.',
          content: '# 需求澄清结果\n\n## Acceptance Criteria\n- The request is ready for 方案评审 Gate review.',
          redacted: false,
          updatedAt: timestamp,
          clarificationRevision: {
            version: 1, revision, status: 'review_requested',
            revisionDigest: revision === 1 ? 'a'.repeat(64) : 'f'.repeat(64),
            rawRequestArtifactId: rawRequestArtifact.id,
            ...(priorArtifact ? { previousRevisionArtifactId: priorArtifact.id } : {}),
            feedbackArtifactIds: feedbackArtifact ? [feedbackArtifact.id] : [],
            goals: ['Bound retries'], acceptanceCriteria: ['Retry boundary is explicit'],
            nonGoals: ['No implementation'], assumptions: [], risks: [], openQuestions: [],
            executor: { version: 1, kind: 'direct-provider', executorId: 'fake-provider', executorVersion: '1', capabilityProfile: 'repository-read-only-v1', model: 'fake', startedAt: timestamp, completedAt: timestamp, durationMs: 10, terminalReason: 'success', contextDigest: '1'.repeat(64) },
            generatedAt: timestamp,
          },
        }
        const event = {
          id: `event-${artifact.id}`,
          runId: input.runId,
          nodeId: input.nodeId,
          sequence: 2,
          kind: 'thinking',
          message: `${input.userName} generated 需求澄清结果 and advanced to 需求确认 Gate.`,
          timestamp,
        }
        const run = {
          id: input.runId,
          title: '重构 GitHub webhook 重试策略',
          request: '请先澄清 webhook retry 的失败边界，再设计实现方案。',
          projectId: localProject.id,
          creatorId: 'u-ling',
          status: 'paused_at_gate',
          currentNodeId: clarifyGateId,
          branchName: 'ai/webhook-retry',
          createdAt: '2026-06-21T16:00:00.000Z',
          updatedAt: timestamp,
          nodes: [
            {
              id: input.nodeId,
              stage: 'clarify',
              title: '需求澄清',
              subtitle: '补齐验收口径与非目标',
              kind: 'agent',
              status: 'success',
              ownerId: 'u-ling',
              retryCount: 0,
              artifactIds: [rawRequestArtifact.id, ...(priorArtifact ? [priorArtifact.id] : []), artifact.id],
            },
            {
              id: clarifyGateId,
              stage: 'clarify',
              title: '需求确认 Gate',
              subtitle: '确认需求已准备进入方案设计',
              kind: 'gate',
              status: 'running',
              ownerId: 'u-ling',
              requiredRole: 'member',
              retryCount: 0,
              artifactIds: [artifact.id],
            },
          ],
          edges: [{
            id: `${input.runId}-edge-clarify-gate`,
            source: input.nodeId,
            target: clarifyGateId,
            kind: 'gate',
          }],
        }

        return {
          run,
          artifact,
          event,
          state: {
            projects: [localProject],
            runs: [run],
            artifacts: [rawRequestArtifact, ...(priorArtifact ? [priorArtifact] : []), ...(feedbackArtifact ? [feedbackArtifact] : []), artifact],
            events: [event],
            testEvidence: [],
            settings: { themePreference: 'system' },
            mcpServers: [],
            agentReviews: [],
            agentTraces: [],
            agentTokenUsage: [],
            codingRuns: [],
            codingEvents: [],
            codingPermissionRequests: [],
            codingPermissionDecisions: [],
            managedCodingWorkspaces: [],
            dependencyBootstrapEvidence: [],
            codingDiffArtifacts: [],
          },
        }
      },
      requestClarificationChanges: async (input: {
        runId: string
        nodeId: string
        artifactId: string
        revision: number
        revisionDigest: string
        reason: string
      }) => {
        clarificationRequests.push(input)
        if (input.revision !== 1 || input.revisionDigest !== 'a'.repeat(64)) {
          throw new Error('stale clarification revision')
        }
        clarificationFeedbackRequested = true
        const agentId = `${input.runId}-clarify`
        const raw = {
          id: `artifact-${input.runId}-raw-request`, runId: input.runId, nodeId: agentId,
          kind: 'raw_request', title: 'Raw request', summary: 'Clarify retry behavior.',
          content: 'Clarify webhook retry boundaries before implementation.', redacted: false,
          updatedAt: '2026-08-30T12:00:00.000Z',
        }
        const revision = {
          id: input.artifactId, runId: input.runId, nodeId: agentId, kind: 'clarification',
          title: 'Clarification v1', summary: 'First reviewable revision.',
          content: '# Clarification v1\n\nRetry boundaries and acceptance criteria.', redacted: true,
          updatedAt: '2026-08-30T12:01:00.000Z',
          clarificationRevision: {
            version: 1, revision: 1, status: 'revision_requested', revisionDigest: input.revisionDigest,
            rawRequestArtifactId: raw.id, feedbackArtifactIds: [`artifact-${input.runId}-clarification-feedback-r1`],
            goals: ['Bound retries'], acceptanceCriteria: ['Retry boundary is explicit'], nonGoals: ['No implementation'],
            assumptions: [], risks: [], openQuestions: [],
            executor: { version: 1, kind: 'local-agent', executorId: 'fake-local', executorVersion: '1', capabilityProfile: 'repository-read-only-v1', model: 'fake', startedAt: '2026-08-30T12:01:00.000Z', completedAt: '2026-08-30T12:01:00.000Z', durationMs: 10, terminalReason: 'success', contextDigest: 'd'.repeat(64) },
            generatedAt: '2026-08-30T12:01:00.000Z',
          },
        }
        const feedback = {
          id: `artifact-${input.runId}-clarification-feedback-r1`, runId: input.runId, nodeId: input.nodeId,
          kind: 'clarification_feedback', title: 'Clarification revision 1 feedback',
          summary: 'Changes requested for clarification revision 1.', content: input.reason, redacted: true,
          updatedAt: '2026-08-30T12:05:00.000Z',
          clarificationFeedback: { version: 1, targetArtifactId: input.artifactId, targetRevision: 1, targetRevisionDigest: input.revisionDigest, actorId: 'u-ling', actorName: 'Ling', reasonDigest: 'e'.repeat(64), createdAt: '2026-08-30T12:05:00.000Z' },
        }
        const run = {
          id: input.runId, version: 3, title: 'Clarification revision E2E', request: raw.content,
          projectId: localProject.id, creatorId: 'u-ling', status: 'clarifying', currentNodeId: agentId,
          branchName: 'ai/clarification-e2e', createdAt: raw.updatedAt, updatedAt: feedback.updatedAt,
          nodes: [
            { id: agentId, stage: 'clarify', title: '需求澄清', subtitle: '补齐验收口径与非目标', kind: 'agent', status: 'running', ownerId: 'u-ling', retryCount: 0, artifactIds: [raw.id, revision.id] },
            { id: input.nodeId, stage: 'clarify', title: '需求确认 Gate', subtitle: '确认当前澄清版本', kind: 'gate', status: 'pending', ownerId: 'u-ling', requiredRole: 'member', retryCount: 0, artifactIds: [] },
          ],
          edges: [{ id: `${input.runId}-edge`, source: agentId, target: input.nodeId, kind: 'gate' }],
        }
        const state = {
          projects: [localProject], runs: [run], artifacts: [raw, revision, feedback], events: [], testEvidence: [],
          settings: { themePreference: 'system' }, mcpServers: [], agentReviews: [], agentTraces: [], agentTokenUsage: [],
          codingRuns: [], codingEvents: [], codingPermissionRequests: [], codingPermissionDecisions: [],
          managedCodingWorkspaces: [], dependencyBootstrapEvidence: [], codingDiffArtifacts: [],
        }
        return { run, revision, feedback, event: { id: 'event-feedback', runId: input.runId, nodeId: input.nodeId, sequence: 1, kind: 'approval', message: 'Changes requested.', timestamp: feedback.updatedAt }, state }
      },
      saveRun: async (run: unknown) => run,
      saveArtifact: async (artifact: unknown) => artifact,
      approveGate: async (approvalInput: {
        runId: string
        nodeId: string
        expectedClarificationRevision?: { artifactId: string; revision: number; revisionDigest: string }
      }) => {
        const { runId, nodeId } = approvalInput
        clarificationApprovals.push(approvalInput)
        if (nodeId.endsWith('-clarify-gate') && approvalInput.expectedClarificationRevision?.revision !== 2) {
          throw new Error('Only current clarification revision v2 can be approved')
        }
        const timestamp = '2026-06-15T00:01:00.000Z'
        const run = {
          id: runId,
          title: '为 Payments API 增加 /health 端点',
          request: 'Add health endpoint to Payments API.',
          projectId: 'p-payments',
          creatorId: 'u-erich',
          status: 'building',
          currentNodeId: nodeId,
          branchName: 'ai/payments-health',
          createdAt: timestamp,
          updatedAt: timestamp,
          nodes: [
            {
              id: nodeId,
              stage: 'design',
              title: 'Architecture Gate',
              subtitle: 'Lead review',
              kind: 'gate',
              status: 'success',
              ownerId: 'u-wang',
              requiredRole: 'lead',
              retryCount: 0,
              artifactIds: [],
            },
          ],
          edges: [],
        }
        const event = {
          id: 'event-approval-e2e',
          runId,
          nodeId,
          sequence: 1,
          kind: 'approval',
          message: 'Trusted local actor Gate approved',
          timestamp,
        }

        return {
          run,
          event,
          state: {
            projects: [localProject],
            runs: [run],
            artifacts: [],
            events: [event],
            testEvidence: [],
            settings: { themePreference: 'system' },
            mcpServers: [],
            agentReviews: [],
            agentTraces: [],
            agentTokenUsage: [],
            codingRuns: [],
            codingEvents: [],
            codingPermissionRequests: [],
            codingPermissionDecisions: [],
            managedCodingWorkspaces: [],
            dependencyBootstrapEvidence: [],
            codingDiffArtifacts: [],
          },
        }
      },
      saveGateOverride: async (input: unknown) => input,
      listGateOverrides: async () => [],
      saveEvent: async (event: unknown) => event,
      saveSettings: async (settings: { themePreference?: 'light' | 'dark' | 'system' }) => ({
        themePreference: settings.themePreference ?? 'system',
      }),
      saveMcpServers: async (servers: unknown) => servers,
      runProjectTests: async ({
        run,
        nodeId,
      }: {
        run: {
          id: string
          nodes: Array<{ id: string; status: string; artifactIds: string[] }>
        }
        nodeId: string
      }) => {
        const evidence = {
          id: 'evidence-1',
          runId: run.id,
          nodeId,
          projectId: localProject.id,
          command: 'pnpm test -- --run',
          cwd: localProject.path,
          status: 'passed',
          exitCode: 0,
          durationMs: 900,
          stdout: '8 tests passed',
          stderr: '',
          summary: 'Tests passed in 900ms',
          redacted: false,
          createdAt: '2026-06-15T00:02:00.000Z',
        }
        const artifact = {
          id: 'artifact-evidence-1',
          runId: run.id,
          nodeId,
          kind: 'test_report',
          title: 'Local test evidence',
          summary: evidence.summary,
          content: '8 tests passed',
          redacted: false,
          updatedAt: evidence.createdAt,
        }
        const event = {
          id: 'event-evidence-1',
          runId: run.id,
          nodeId,
          sequence: 1,
          kind: 'test_result',
          message: evidence.summary,
          timestamp: evidence.createdAt,
        }
        const updatedRun = {
          ...run,
          status: 'testing',
          nodes: run.nodes.map((node) =>
            node.id === nodeId
              ? { ...node, status: 'success', artifactIds: [...node.artifactIds, artifact.id] }
              : node,
          ),
        }

        return {
          evidence,
          state: {
            projects: [{ ...localProject, testCommand: evidence.command }],
            runs: [updatedRun],
            artifacts: [artifact],
            events: [event],
            testEvidence: [evidence],
            settings: { themePreference: 'system' },
            mcpServers: [],
            agentReviews: [],
            agentTraces: [],
            agentTokenUsage: [],
            codingRuns: [],
            codingEvents: [],
            codingPermissionRequests: [],
            codingPermissionDecisions: [],
            managedCodingWorkspaces: [],
            dependencyBootstrapEvidence: [],
            codingDiffArtifacts: [],
          },
        }
      },
      listAgentProviders: async () => [
        {
          id: 'doubao-review',
          name: 'doubao-review',
          kind: 'openai-compatible',
          model: 'ark-code-latest',
          baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
          enabled: true,
          maskedCredential: 'e8...test',
          updatedAt: '2026-06-15T00:03:00.000Z',
        },
      ],
      saveAgentProviderCredential: async () => ({
        providerId: 'openai-default',
        model: 'gpt-4.1-mini',
        baseUrl: 'https://api.openai.com/v1',
        maskedCredential: 'sk-...test',
        updatedAt: '2026-06-15T00:03:00.000Z',
      }),
      listAgentReviews: async () => [],
      runKnowledgeReview: async ({
        runId,
        nodeId,
        projectId,
        requestedBy,
        runtime,
        providerId,
      }: {
        runId: string
        nodeId: string
        projectId: string
        requestedBy: string
        runtime: 'electron' | 'api'
        providerId?: string
      }) => {
        const createdAt = '2026-06-15T00:04:00.000Z'
        const review = {
          id: 'agent-review-1',
          requestId: 'agent-request-1',
          runId,
          nodeId,
          projectId,
          runtime,
          providerId: providerId ?? 'doubao-review',
          model: 'ark-code-latest',
          conclusion: 'Knowledge review completed for this node.',
          summary: 'Reviewed knowledge references and generated warning-only advisory.',
          risks: ['Gate requires reviewer evidence before approval.'],
          missingEvidence: ['Attach passing local test evidence before final approval.'],
          suggestedTests: ['Run the local test command and archive redacted evidence.'],
          knowledgeReferences: [],
          policyFindings: [],
          confidence: 0.82,
          gateAdvisory: {
            id: 'gate-advisory-1',
            runId,
            nodeId,
            level: 'warn',
            blocksApproval: false,
            summary: '1 evidence gap needs reviewer attention.',
            missingEvidence: ['Attach passing local test evidence before final approval.'],
            riskCount: 1,
            createdAt,
          },
          createdAt,
        }
        const trace = {
          id: 'agent-trace-1',
          runId,
          nodeId,
          reviewId: review.id,
          runtime,
          createdAt,
          steps: [
            {
              id: 'agent-trace-step-1',
              kind: 'context',
              label: 'Build redacted context',
              summary: 'Prepared review context.',
              timestamp: createdAt,
            },
          ],
        }
        const tokenUsage = {
          id: 'agent-token-usage-1',
          runId,
          nodeId,
          userId: requestedBy,
          projectId,
          provider: 'local',
          model: 'fake',
          inputTokens: 128,
          outputTokens: 72,
          cacheReadTokens: 0,
          costUsd: 0,
          timestamp: createdAt,
          source: 'estimated',
        }
        const reviewedRun = {
          id: runId,
          title: '重构 GitHub webhook 重试策略',
          request: '请先澄清 webhook retry 的失败边界，再设计实现方案。',
          projectId,
          creatorId: 'u-ling',
          status: 'clarifying',
          currentNodeId: nodeId,
          branchName: 'ai/webhook-retry',
          createdAt: '2026-06-21T16:00:00.000Z',
          updatedAt: createdAt,
          nodes: [
            {
              id: nodeId,
              stage: 'clarify',
              title: '需求确认 Gate',
              subtitle: '确认需求已准备进入方案设计',
              kind: 'gate',
              status: 'blocked',
              ownerId: 'u-ling',
              requiredRole: 'member',
              retryCount: 0,
              artifactIds: [],
            },
          ],
          edges: [],
        }

        return {
          review,
          trace,
          tokenUsage,
          state: {
            projects: [localProject],
            runs: [reviewedRun],
            artifacts: [],
            events: [],
            testEvidence: [],
            settings: { themePreference: 'system' },
            mcpServers: [],
            agentReviews: [review],
            agentTraces: [trace],
            agentTokenUsage: [tokenUsage],
            codingRuns: [],
            codingEvents: [],
            codingPermissionRequests: [],
            codingPermissionDecisions: [],
            managedCodingWorkspaces: [],
            dependencyBootstrapEvidence: [],
            codingDiffArtifacts: [],
          },
        }
      },
      ensureCodingEngine: async ({ projectId }: { projectId: string }) => ({
        projectId,
        engine: 'fake',
        status: 'ready',
      }),
      getCodingRuntimeConfiguration: async () => null,
      detectCodingRuntimeEngines: async ({ projectId }: { projectId: string }) => ({
        projectId,
        candidates: [{
          engine: 'opencode-http',
          executor: 'opencode-http',
          status: 'available',
          binaryPath: '/opt/devflow/bin/opencode',
          version: '1.2.3',
          requiresConfirmation: true,
          reason: '已检测到本机 OpenCode。确认后才会把它用于当前项目。',
        }],
        detectedAt: '2026-06-15T00:03:30.000Z',
      }),
      saveCodingRuntimeConfiguration: async (input: {
        projectId: string
        executor: 'native-model' | 'opencode-http'
        providerId: string
        binaryPath?: string
        modelId?: string
        detectedVersion?: string
      }) => {
        codingConfigurationSaves.push(input)
        return input.executor === 'opencode-http'
          ? {
              projectId: input.projectId,
              executor: input.executor,
              providerId: input.providerId,
              binaryPath: input.binaryPath,
              modelId: input.modelId,
              detectedVersion: input.detectedVersion,
              version: 1,
              updatedAt: '2026-06-15T00:03:30.000Z',
            }
          : {
              projectId: input.projectId,
              executor: input.executor,
              providerId: input.providerId,
              version: 1,
              updatedAt: '2026-06-15T00:03:30.000Z',
            }
      },
      getCodingRuntimeReadiness: async ({ runId, nodeId, projectId }: { runId: string; nodeId: string; projectId: string }) => ({
        projectId,
        runId,
        nodeId,
        status: 'ready',
        engine: 'fake',
        executor: 'native-model',
        availability: 'available',
        capabilities: ['cancellation', 'structured_diff', 'workspace_edit', 'workspace_read'],
        providerRequirement: 'saved-provider',
        providerId: 'doubao-review',
        configVersion: 1,
        checks: [
          { code: 'executor_unconfigured', status: 'ready', message: 'Coding Executor 已配置。' },
          { code: 'engine_unavailable', status: 'ready', message: 'Coding Engine 可用。' },
          { code: 'capability_unavailable', status: 'ready', message: '执行能力满足要求。' },
          { code: 'provider_unavailable', status: 'ready', message: 'Provider 可用。' },
          { code: 'team_project_unpaired', status: 'ready', message: 'Team Project 已配对。' },
          { code: 'test_command_missing', status: 'ready', message: '测试命令已配置。' },
          { code: 'budget_policy_missing', status: 'ready', message: '预算策略已配置。' },
          { code: 'budget_blocked', status: 'ready', message: '预算评估允许执行。' },
        ],
        evaluatedAt: '2026-06-15T00:03:30.000Z',
      }),
      getCodingChangeSetPreview: async ({ changeSetId, codingRunId }: { changeSetId: string; codingRunId: string }) => ({
        stateVersion: 2,
        id: changeSetId,
        codingRunId,
        phase: 'initial',
        changedPaths: initialScenario === 'coding-permission' || initialScenario === 'coding-lifecycle' ? ['src/a.ts', 'src/b.ts'] : ['devflow-fake-change.txt'],
        unifiedDiff: initialScenario === 'coding-permission' || initialScenario === 'coding-lifecycle'
          ? `diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,60 +1,60 @@\n${Array.from({ length: 60 }, (_, index) => `-old a ${index}\n+new a ${index}`).join('\n')}\ndiff --git a/src/b.ts b/src/b.ts\n--- a/src/b.ts\n+++ b/src/b.ts\n@@ -1,60 +1,60 @@\n${Array.from({ length: 60 }, (_, index) => `-old b ${index}\n+new b ${index}`).join('\n')}`
          : 'diff --git a/devflow-fake-change.txt b/devflow-fake-change.txt\n+fake change',
        changeSetDigest: 'c'.repeat(64),
        createdAt: '2026-06-15T00:05:00.000Z',
        expiresAt: '2099-06-15T00:20:00.000Z',
      }),
      getCodingRuntimeBudgetPolicy: async () => null,
      saveCodingRuntimeBudgetPolicy: async ({ projectId, enabled, monthlyLimitUsd, warningThresholdUsd }: { projectId: string; enabled: boolean; monthlyLimitUsd: number; warningThresholdUsd: number }) => ({
        projectId,
        enabled,
        monthlyLimitUsd,
        warningThresholdUsd,
        currency: 'USD',
        updatedAt: '2026-06-15T00:03:30.000Z',
      }),
      createCodingRuntimeBudgetApproval: async ({ projectId, requestedBy, maxAdditionalCostUsd, reason }: { projectId: string; requestedBy: string; maxAdditionalCostUsd: number; reason: string }) => ({
        id: 'runtime-budget-approval-1',
        projectId,
        providerId: 'fake-coding-engine',
        requestedBy,
        approvedBy: requestedBy,
        role: 'owner',
        maxAdditionalCostUsd,
        reason,
        status: 'approved',
        createdAt: '2026-06-15T00:03:30.000Z',
        expiresAt: '2026-06-15T00:18:30.000Z',
      }),
      runCodingAgent: async ({
        runId,
        nodeId,
        projectId,
        requestedBy,
      }: {
        runId: string
        nodeId: string
        projectId: string
        requestedBy: string
        userInstruction: string
      }) => {
        const startedAt = '2026-06-15T00:05:00.000Z'
        if (initialScenario === 'coding-lifecycle') {
          codingLifecycleStarted = true
          const state = codingScenarioState()
          return { codingRun: state.codingRuns[0], state }
        }
        const codingRun = {
          id: 'coding-run-1',
          runId,
          nodeId,
          projectId,
          requestedBy,
          providerId: 'fake-coding-engine',
          engine: 'fake',
          status: 'waiting_permission',
          branchName: 'devflow/run-1-node-build-coding-run-1',
          managedWorkspaceId: 'workspace-1',
          summary: 'Waiting for permission relay.',
          changedPaths: [],
          startedAt,
          redacted: true,
        }
        const permissionRequest = {
          id: 'permission-1',
          codingRunId: codingRun.id,
          runId,
          nodeId,
          toolName: 'edit',
          riskLevel: 'warn',
          summary: 'Allow fake edit in managed worktree.',
          details: 'devflow-fake-change.txt',
          status: 'pending',
          requestedAt: startedAt,
          expiresAt: '2026-06-15T00:10:00.000Z',
        }

        return {
          codingRun,
          state: {
            projects: [localProject],
            runs: [],
            artifacts: [],
            events: [],
            testEvidence: [],
            settings: { themePreference: 'system' },
            mcpServers: [],
            agentReviews: [],
            agentTraces: [],
            agentTokenUsage: [],
            codingRuns: [codingRun],
            codingEvents: [],
            codingPermissionRequests: [permissionRequest],
            codingPermissionDecisions: [],
            managedCodingWorkspaces: [],
            dependencyBootstrapEvidence: [],
            codingDiffArtifacts: [],
          },
        }
      },
      cancelCodingAgentRun: async ({ codingRunId }: { codingRunId: string }) => ({
        id: codingRunId,
        status: 'interrupted',
      }),
      replyCodingPermission: async ({
        requestId,
        codingRunId,
        decision,
      }: {
        requestId: string
        codingRunId: string
        decision: string
      }) => {
        codingPermissionReplies.push({ requestId, codingRunId, decision })
        if (
          (initialScenario === 'coding-permission' || initialScenario === 'coding-lifecycle') &&
          decision === 'approved'
        ) {
          codingPermissionApproved = true
        }
        return {
          id: requestId,
          codingRunId,
          status: decision === 'approved' ? 'approved' : 'rejected',
        }
      },
      subscribeCodingRun: async () => ({
        projects: [localProject],
        runs: [],
        artifacts: [],
        events: [],
        testEvidence: [],
        settings: { themePreference: 'system' },
        mcpServers: [],
        agentReviews: [],
        agentTraces: [],
        agentTokenUsage: [],
        codingRuns: [],
        codingEvents: [],
        codingPermissionRequests: [],
        codingPermissionDecisions: [],
        managedCodingWorkspaces: [],
        dependencyBootstrapEvidence: [],
        codingDiffArtifacts: [],
      }),
      listCodingAgentRuns: async () => [],
      openManagedWorktree: async ({ workspaceId }: { workspaceId: string }) => ({
        id: workspaceId,
      }),
      deleteManagedWorktree: async ({ workspaceId }: { workspaceId: string }) => ({
        id: workspaceId,
        deletedAt: '2026-06-15T00:06:00.000Z',
      }),
      startAgentRuntime: async () => {
        throw new Error('Agent Runtime start is not available in the E2E renderer fixture.')
      },
      advanceAgentRuntime: async () => {
        throw new Error('Agent Runtime advance is not available in the E2E renderer fixture.')
      },
      cancelAgentRuntime: async () => {
        throw new Error('Agent Runtime cancel is not available in the E2E renderer fixture.')
      },
      listAgentRuntimes: async () => [],
      getAgentRuntime: async () => {
        throw new Error('Agent Runtime detail is not available in the E2E renderer fixture.')
      },
      listCoordinationSessions: async () => [],
      startCoordinationPlan: async () => {
        throw new Error('Agent Coordination start is not available in the E2E renderer fixture.')
      },
      getCoordinationSession: async () => {
        throw new Error('Agent Coordination detail is not available in the E2E renderer fixture.')
      },
      resumeCoordinationSession: async () => {
        throw new Error('Agent Coordination resume is not available in the E2E renderer fixture.')
      },
      startCoordinationTask: async () => {
        throw new Error('Agent Coordination task start is not available in the E2E renderer fixture.')
      },
      cancelCoordinationSession: async () => {
        throw new Error('Agent Coordination cancellation is not available in the E2E renderer fixture.')
      },
      onCodingRunStatusUpdated: () => () => undefined,
      onCodingEventAppended: () => () => undefined,
      onCodingPermissionUpdated: () => () => undefined,
      onAgentRuntimeUpdated: () => () => undefined,
      onLocalStateUpdated: () => () => undefined,
    }
  }, scenario)
}

async function createFixtureRun(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /新建 Run/ }).click()
  const dialog = page.getByRole('dialog', { name: /Create new run/ })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('标题').fill('重构 GitHub webhook 重试策略')
  await dialog.getByLabel('一句话需求').fill('请先澄清 webhook retry 的失败边界，再设计实现方案。')
  await dialog.getByRole('button', { name: /创建并开始澄清/ }).click()
  await expect(page.locator('.run-list').getByText('重构 GitHub webhook 重试策略', { exact: true })).toBeVisible()
  await expect(page.getByTestId('toast')).toContainText('新 Run 已创建')
  await expect(page.getByTestId('workflow-canvas')).toContainText('需求澄清')
  await expect(page.getByTestId('node-inspector')).toContainText('需求澄清')
}

test.describe('AI DevFlow desktop workbench', () => {
  test('compares requirement inputs, requests changes, generates v2, and approves only v2', async ({ page }) => {
    await installDesktopApi(page, 'clarification-revision')
    await page.goto('/')

    const inspector = page.getByTestId('node-inspector')
    await expect(page.getByTestId('clarification-review')).toBeVisible()
    await expect(page.getByTestId('clarification-raw-request')).toContainText('Clarify webhook retry boundaries')
    await expect(page.getByTestId('clarification-repository-findings')).toContainText('Retry handler exists')
    await expect(page.getByTestId('clarification-current-revision')).toContainText('v1 · review_requested')

    await inspector.getByLabel('结构化修订意见').fill('State the retry boundary explicitly.')
    await inspector.getByRole('button', { name: '请求修订当前版本' }).click()
    await expect(page.getByTestId('toast')).toContainText('流程返回需求澄清')
    await expect(inspector).toContainText('需求澄清')

    await inspector.getByRole('button', { name: /生成需求澄清/ }).click()
    await expect(page.getByTestId('toast')).toContainText('需求澄清已生成')
    await expect(page.getByTestId('clarification-current-revision')).toContainText('v2 · review_requested')
    await expect(page.getByTestId('clarification-revision-history')).toContainText('v1 · superseded')
    await expect(page.getByTestId('clarification-revision-history')).toContainText('State the retry boundary explicitly.')

    await inspector.getByRole('button', { name: /通过 Gate/ }).click()
    const requests = await page.evaluate(() => (window as unknown as { __clarificationRequests: unknown[] }).__clarificationRequests)
    const approvals = await page.evaluate(() => (window as unknown as { __clarificationApprovals: unknown[] }).__clarificationApprovals)
    expect(requests).toHaveLength(1)
    expect(approvals).toContainEqual(expect.objectContaining({
      expectedClarificationRevision: expect.objectContaining({
        artifactId: 'artifact-run-clarification-e2e-clarification-v2',
        revision: 2,
        revisionDigest: 'f'.repeat(64),
      }),
    }))
  })

  test('loads the workbench and supports core developer interactions', async ({ page }) => {
    await installDesktopApi(page)
    await page.goto('/')

    await expect(page).toHaveTitle(/AI DevFlow Studio/)
    await expect(page.getByTestId('runtime-source-badge')).toContainText('local SQLite empty')
    await expect(page.getByText('开发者工作台')).toBeVisible()
    await expect(page.getByTestId('workflow-empty-state')).toContainText('暂无 Run')
    await expect(page.getByTestId('node-inspector-empty')).toContainText('选择真实 Run')

    await page.getByTestId('theme-toggle').click()
    await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'light')

    await createFixtureRun(page)

    const workflow = page.getByTestId('workflow-canvas')
    await expect(page.getByTestId('stage-summary-clarify')).toContainText('节点：Task 1 · Gate 1')
    await expect(page.getByTestId('stage-summary-design')).toContainText('节点：Task 1 · Gate 1')
    await expect(page.getByTestId('stage-summary-build')).toContainText('节点：Task 1')
    await expect(page.getByTestId('stage-summary-test')).toContainText('节点：Test 1')
    await expect(page.getByTestId('stage-summary-pr')).toContainText('节点：Delivery 1')
    await expect(page.getByTestId('stage-summary-accept')).toContainText('节点：Acceptance 1')
    await expect(page.getByTestId('stage-summary-pr')).toContainText('展示：折叠输出 1')
    await expect(page.getByTestId('stage-summary-build')).not.toContainText('展示：')
    const clarifyCard = workflow.getByTestId('flow-node-run-created-from-request-clarify')
    await clarifyCard.click()
    await page.getByRole('tab', { name: 'Gate影响' }).click()
    const gateImpact = page.getByTestId('gate-impact-summary')
    await expect(gateImpact).toContainText('直接下游 Gate')
    await expect(gateImpact).toContainText('需求确认 Gate')
    await expect(gateImpact).toContainText('等待中')
    await expect(gateImpact).toContainText('当前 Task 的产物尚未关联到该 Gate')
    await expect(gateImpact.getByRole('button', { name: /通过 Gate|Override/ })).toHaveCount(0)
    await gateImpact.getByRole('button', { name: '查看 Gate' }).click()
    await expect(page.getByTestId('node-inspector')).toContainText('类型：Gate · 来源：Team Policy')
    const designCard = workflow.getByTestId('flow-node-run-created-from-request-design')
    await expect(designCard).toContainText('Task')
    await expect(designCard).not.toContainText('Review')
    await designCard.click()
    await expect(page.getByTestId('node-inspector')).toContainText('类型：Task · 来源：Run 模板')

    await page.getByRole('button', { name: /选择本地仓库/ }).click()
    await expect(page.locator('.local-project-panel').getByText('fixture-project', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /^测试$/ }).click()
    await page.getByLabel('测试命令').fill('pnpm test -- --run')
    await page.getByRole('button', { name: /保存测试命令/ }).click()
    await expect(page.getByTestId('toast')).toContainText('测试命令已保存')

    await expect(page.getByTestId('tests-view')).toContainText('测试计划与证据')
    await expect(page.getByTestId('tests-view')).toContainText('pnpm test -- --run')
    await page.getByRole('button', { name: /工作台/ }).click()

    await page.getByLabel('Search runs and knowledge').fill('nothing matches this')
    await expect(page.getByTestId('search-results')).toContainText('没有匹配结果')
    await expect(page.getByText('没有匹配的 Run')).toBeVisible()
    await page.getByLabel('Search runs and knowledge').fill('重构 GitHub')
    await expect(page.getByTestId('search-results')).toContainText('重构 GitHub webhook 重试策略')
    await expect(page.locator('.run-list').getByText('重构 GitHub webhook 重试策略', { exact: true })).toBeVisible()
  })

  test('supports manager, knowledge, skill, MCP, and test views', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await installDesktopApi(page)
    await page.goto('/')
    await createFixtureRun(page)

    await page.getByRole('button', { name: /^Agents$/ }).click()
    await expect(page.getByTestId('agent-workbench')).toContainText('Agent 执行台')
    await expect(page.getByTestId('agent-workbench')).toContainText('doubao-review')
    await expect(
      page.getByRole('button', { name: /运行门禁审查/ }),
    ).toHaveCount(0)
    await page.getByRole('button', { name: /生成需求澄清/ }).click()
    await expect(page.getByTestId('toast')).toContainText('需求澄清已生成，进入需求确认 Gate')
    await page
      .getByTestId('flow-node-run-created-from-request-clarify-gate')
      .click()
    await page.getByRole('button', { name: /^Agents$/ }).click()
    await expect(page.getByTestId('agent-workbench')).toContainText('需求确认 Gate')
    await expect(page.getByRole('button', { name: /运行门禁审查/ })).toBeEnabled()
    await page.getByRole('button', { name: /运行门禁审查/ }).click()
    await expect(page.getByTestId('toast')).toContainText('基于知识的门禁审查已归档')
    await expect(page.getByTestId('agent-workbench')).toContainText('warning-only')
    await expect(page.getByTestId('agent-workbench')).toContainText('Build redacted context')

    await page.getByRole('button', { name: /工作台/ }).click()
    const reviewedGateInspector = page.getByTestId('node-inspector')
    await expect(reviewedGateInspector).toContainText('需求确认 Gate')
    const referencesTab = reviewedGateInspector.getByRole('tab', { name: '引用来源' })
    await referencesTab.focus()
    await referencesTab.press('Enter')
    await expect(page.getByTestId('knowledge-reference-sources')).toContainText(
      '当前 Gate 尚无节点作用域内的 Knowledge 引用',
    )
    await expect(page.getByTestId('knowledge-reference-sources')).not.toContainText(
      'Knowledge review completed for this node.',
    )
    const evidenceTab = reviewedGateInspector.getByRole('tab', { name: 'Evidence' })
    await evidenceTab.focus()
    await evidenceTab.press('Enter')
    await expect(page.getByTestId('review-evidence-results')).toContainText(
      'Knowledge review completed for this node.',
    )
    await expect(page.getByTestId('review-evidence-results')).not.toContainText('Review Criteria')

    await page.getByLabel('Search runs and knowledge').fill('missing knowledge node')
    await page.getByRole('button', { name: /Team Overview/ }).click()
    await expect(page.getByTestId('team-overview')).toContainText('项目交付健康')
    await expect(page.getByTestId('team-overview')).toContainText('未加载 Team Project')

    await page.getByRole('button', { name: /Knowledge/ }).click()
    await expect(page.getByTestId('knowledge-view')).toContainText('Knowledge Governance')
    await expect(page.getByTestId('knowledge-view')).toContainText('没有匹配的知识文档')
    await expect(page.getByText('没有匹配的知识节点')).toBeVisible()
    await page.getByLabel('Search runs and knowledge').fill('')

    await page.getByRole('button', { name: /^Agents$/ }).click()
    await expect(page.getByTestId('agent-workbench')).toContainText('基于知识的门禁审查')
    await expect(page.getByTestId('agent-workbench')).toContainText('doubao-review')
    await expect(page.getByTestId('agent-workbench')).toContainText('warning-only')
    await expect(page.getByTestId('agent-workbench')).toContainText('Build redacted context')

    await page.getByRole('button', { name: /^Skills$/ }).click()
    await expect(page.getByTestId('skill-view')).toContainText('团队能力目录')
    await expect(page.getByTestId('skill-view')).toContainText('未加载真实团队 Skills')

    await page.getByRole('button', { name: /^MCP$/ }).click()
    await expect(page.getByTestId('mcp-view')).toContainText('本机工具连接器')
    await expect(page.getByTestId('mcp-view')).toContainText('未加载本地 MCP 连接器')

    await page.getByRole('button', { name: /^测试$/ }).click()
    await expect(page.getByTestId('tests-view')).toContainText('测试计划与证据')
    await page.getByRole('button', { name: /执行测试/ }).click()
    await expect(page.getByTestId('toast')).toContainText('只能执行当前运行中或失败的测试节点')
    await expect(page.getByTestId('tests-view')).not.toContainText('Local test evidence')
    await expect(page.getByTestId('tests-view')).not.toContainText('passed')
    expect(pageErrors).toEqual([])
  })

  test('keeps Coding Engine detection advisory until the user confirms the project executor', async ({ page }) => {
    await installDesktopApi(page)
    await page.goto('/')
    await createFixtureRun(page)

    await page.getByRole('button', { name: /^Agents$/ }).click()
    const codingSettings = page.locator('details.runtime-settings').filter({
      hasText: 'Coding Agent 执行配置',
    })
    if (!(await codingSettings.getAttribute('open'))) {
      await codingSettings.locator('summary').click()
    }
    await expect(codingSettings).toContainText('Coding Executor：已配置')
    await expect(codingSettings).toContainText('Coding Engine：可用')
    await expect(codingSettings).toContainText('Provider：可用')
    await expect(codingSettings).toContainText('Team Project：已配对')
    await expect(codingSettings).toContainText('测试命令：已配置')
    await expect(codingSettings).toContainText('预算策略：已配置')
    await expect(codingSettings).toContainText('预算评估：允许执行')

    await codingSettings.getByLabel('Coding Executor').selectOption('opencode-http')
    await codingSettings.getByRole('button', { name: '检测本机 OpenCode' }).click()
    await expect(codingSettings.getByTestId('opencode-discovery-status')).toContainText(
      '尚未确认用于当前项目',
    )
    expect(await page.evaluate(() => (
      window as unknown as { __codingConfigurationSaves: unknown[] }
    ).__codingConfigurationSaves)).toEqual([])

    await codingSettings.getByRole('button', { name: '确认并用于当前项目' }).click()
    await expect.poll(() => page.evaluate(() => (
      window as unknown as { __codingConfigurationSaves: unknown[] }
    ).__codingConfigurationSaves.length)).toBe(1)
    expect(await page.evaluate(() => (
      window as unknown as { __codingConfigurationSaves: Array<Record<string, unknown>> }
    ).__codingConfigurationSaves[0])).toEqual({
      projectId: 'local-project-1',
      executor: 'opencode-http',
      providerId: 'openai',
      modelId: 'gpt-4.1-mini',
      binaryPath: '/opt/devflow/bin/opencode',
      detectedVersion: '1.2.3',
    })
  })

  test('reviews one exact multi-file Change Set through the shared Agents approval surface', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await installDesktopApi(page, 'coding-permission')
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.goto('/')
    await page.waitForTimeout(250)
    expect(pageErrors).toEqual([])

    const inspector = page.getByTestId('node-inspector')
    await expect(inspector.getByTestId('workbench-coding-permission-summary')).toContainText('2 个文件')
    await expect(inspector.getByRole('button', { name: /Approve exact/ })).toHaveCount(0)
    await inspector.getByRole('button', { name: '审查并批准修改' }).click()

    const review = page.getByTestId('coding-change-set-review')
    await expect(review).toBeVisible()
    await expect(review.getByLabel('src/a.ts diff')).toBeVisible()
    await expect(review.getByLabel('src/b.ts diff')).toBeVisible()
    await expect(review).toContainText('c'.repeat(64))
    const diffStyle = await review.getByLabel('src/a.ts diff').evaluate((element) => ({
      whiteSpace: getComputedStyle(element).whiteSpace,
      overflowX: getComputedStyle(element).overflowX,
    }))
    expect(diffStyle.whiteSpace).toBe('pre')
    expect(['auto', 'scroll']).toContain(diffStyle.overflowX)
    const reviewBox = await review.boundingBox()
    expect(reviewBox?.width ?? 0).toBeGreaterThan(900)
    await page.evaluate(() => {
      document.documentElement.style.zoom = '1.25'
    })
    await review.getByRole('button', { name: 'Approve exact Change Set' }).scrollIntoViewIfNeeded()
    await expect(review.getByRole('button', { name: 'Approve exact Change Set' })).toBeVisible()
    await expect(review.getByRole('button', { name: 'Reject' })).toBeVisible()
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(review).toBeVisible()
    await page.emulateMedia({ colorScheme: 'light' })
    await expect(review).toBeVisible()

    await review.getByRole('button', { name: 'Approve exact Change Set' }).click()
    await expect.poll(() => page.evaluate(() => (
      window as unknown as { __codingPermissionReplies: unknown[] }
    ).__codingPermissionReplies)).toEqual([{
      requestId: 'permission-review',
      codingRunId: 'coding-run-review',
      decision: 'approved',
    }])
    await expect(review).toHaveCount(0)
    await expect(page.locator('.agent-current-task--change-set')).toHaveCount(0)
    await page.getByRole('button', { name: /工作台/ }).click()
    await expect(page.getByTestId('flow-node-node-test-review')).toContainText('当前步骤')
    expect(pageErrors).toEqual([])
  })

  test('runs Coding from idle through approval, persisted evidence, and the next workflow node', async ({ page }) => {
    await installDesktopApi(page, 'coding-lifecycle')
    await page.goto('/')

    const inspector = page.getByTestId('node-inspector')
    await inspector.getByRole('button', { name: '启动 Coding Agent' }).click()
    const review = page.getByTestId('coding-change-set-review')
    await expect(review.getByLabel('src/a.ts diff')).toContainText('new a 59')
    await expect(review.getByLabel('src/b.ts diff')).toContainText('new b 59')
    await review.getByRole('button', { name: 'Approve exact Change Set' }).click()

    await page.getByRole('button', { name: /工作台/ }).click()
    await expect(page.getByTestId('flow-node-node-test-review')).toContainText('当前步骤')
    await page.getByTestId('flow-node-node-build-review').click()
    const terminal = page.getByTestId('workbench-coding-terminal')
    await expect(terminal).toContainText('150')
    await expect(terminal).toContainText('$0.012')
    await expect(terminal).toContainText('Saved worktree test passed.')
    await expect(terminal).toContainText('+new')
    await expect(terminal.getByRole('list', { name: 'Coding Run terminal trace' })).toContainText('Applied the exact approved Change Set.')
    await expect(inspector.getByRole('button', { name: /启动|重新运行/ })).toHaveCount(0)
  })
})
