import { expect, test } from '@playwright/test'

async function installDesktopApi(
  page: import('@playwright/test').Page,
  scenario: 'empty' | 'configured' | 'coding-permission' | 'coding-lifecycle' | 'clarification-revision' | 'agent-ux-unpaired' | 'agent-ux-paired' = 'empty',
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
    const governedFixture = initialScenario === 'configured' || initialScenario === 'coding-permission' || initialScenario === 'coding-lifecycle' || initialScenario === 'clarification-revision'
    const fixturePairing = {
      tokenId: 'desktop-e2e-token', organizationId: 'org-e2e', projectId: 'team-e2e',
      localProjectId: localProject.id, userId: 'u-ling', role: 'lead', issuedRole: 'lead',
      expiresAt: '2999-01-01T00:00:00.000Z', userName: 'Ling', projectName: 'E2E Team',
      authAccountId: 'acct-ling', projectMemberships: [{ projectId: 'team-e2e', userId: 'u-ling', role: 'lead' }],
      createdAt: '2026-08-30T12:00:00.000Z',
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
        ...(governedFixture ? { desktopPairingCredential: fixturePairing } : {}),
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

    const agentUxState = (paired: boolean) => {
      const designNode = {
        id: 'node-agent-ux-design', stage: 'design', title: '方案设计', subtitle: '生成方案与测试策略',
        kind: 'agent', status: 'running', ownerId: 'u-ling', retryCount: 0, artifactIds: [],
      }
      const designGate = {
        id: 'node-agent-ux-design-gate', stage: 'design', title: '方案评审 Gate', subtitle: '人工确认设计方案',
        kind: 'gate', status: 'pending', ownerId: 'u-ling', requiredRole: 'member', retryCount: 0, artifactIds: [],
      }
      return {
        ...(governedFixture ? { desktopPairingCredential: fixturePairing } : {}),
        projects: [localProject],
        runs: [{
          id: 'run-agent-ux', version: 3, title: '设计 Agent 体验验收', request: '生成清晰的设计方案。',
          projectId: localProject.id, creatorId: 'u-ling', status: 'designing', currentNodeId: designNode.id,
          branchName: 'devflow/agent-ux', createdAt: '2026-08-30T12:00:00.000Z', updatedAt: '2026-08-30T12:00:00.000Z',
          nodes: [designNode, designGate],
          edges: [{ id: 'edge-agent-ux-design', source: designNode.id, target: designGate.id, kind: 'gate' }],
        }],
        artifacts: [], events: [], testEvidence: [], settings: { themePreference: 'system' }, mcpServers: [],
        agentReviews: [], agentTraces: [], agentTokenUsage: [], codingRuns: [], codingEvents: [],
        codingPermissionRequests: [], codingPermissionDecisions: [], managedCodingWorkspaces: [],
        dependencyBootstrapEvidence: [], codingDiffArtifacts: [],
        ...(paired ? {
          desktopPairingCredential: {
            tokenId: 'desktop-agent-ux-token', organizationId: 'org-agent-ux', projectId: 'team-agent-ux',
            localProjectId: localProject.id, userId: 'u-ling', role: 'lead', issuedRole: 'lead',
            expiresAt: '2999-01-01T00:00:00.000Z', userName: 'Ling', projectName: 'Agent UX Team',
            authAccountId: 'acct-ling',
            projectMemberships: [{ projectId: 'team-agent-ux', userId: 'u-ling', role: 'lead' }],
            createdAt: '2026-08-30T12:00:00.000Z',
          },
        } : {}),
      }
    }

    ;(window as unknown as { aiDevFlowDesktop: unknown }).aiDevFlowDesktop = {
      platform: 'e2e',
      loadState: async () => initialScenario === 'agent-ux-unpaired' || initialScenario === 'agent-ux-paired'
        ? agentUxState(initialScenario === 'agent-ux-paired')
        : initialScenario === 'coding-permission' || initialScenario === 'coding-lifecycle'
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
          ...(governedFixture ? { desktopPairingCredential: fixturePairing } : {}),
          projects: [localProject], runs: [run], artifacts: [raw, clarification], events: [], testEvidence: [],
          settings: { themePreference: 'system' }, mcpServers: [], agentReviews: [], agentTraces: [],
          agentTokenUsage: [], codingRuns: [], codingEvents: [], codingPermissionRequests: [],
          codingPermissionDecisions: [], managedCodingWorkspaces: [], dependencyBootstrapEvidence: [],
          codingDiffArtifacts: [],
        }
      })() : ({
        ...(governedFixture ? { desktopPairingCredential: fixturePairing } : {}),
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
            ...(governedFixture ? { desktopPairingCredential: fixturePairing } : {}),
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
          ...(governedFixture ? { desktopPairingCredential: fixturePairing } : {}),
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
            ...(governedFixture ? { desktopPairingCredential: fixturePairing } : {}),
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
            ...(governedFixture ? { desktopPairingCredential: fixturePairing } : {}),
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
          { code: 'executor_unconfigured', status: 'ready', message: '执行工具已配置。' },
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
      getCodingRuntimeBudgetPolicy: async () => governedFixture ? {
        projectId: localProject.id, enabled: true, monthlyLimitUsd: 50, warningThresholdUsd: 40,
        currency: 'USD', updatedAt: '2026-08-30T12:00:00.000Z',
      } : null,
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
            ...(governedFixture ? { desktopPairingCredential: fixturePairing } : {}),
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
        ...(governedFixture ? { desktopPairingCredential: fixturePairing } : {}),
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

type Page = import('@playwright/test').Page
type Locator = import('@playwright/test').Locator

/** The task menu is the task title's disclosure (plan Y6): runs, usage, policy, budget, board view. */
async function showProjectRuns(page: Page) {
  const menu = page.locator('details.workbench-project-menu')
  await expect(menu).toBeVisible()
  if (await menu.getAttribute('open') === null) await menu.locator(':scope > summary').click()
  await expect(menu).toHaveAttribute('open', '')
  return menu
}

async function closeTaskMenu(page: Page) {
  const menu = page.locator('details.workbench-project-menu')
  if (await menu.getAttribute('open') !== null) await menu.locator(':scope > summary').click()
  await expect(menu).not.toHaveAttribute('open', '')
}

/** Current task usage, policy and budget details are in the task menu (plan Y6). */
async function openTaskUsage(page: Page) {
  await showProjectRuns(page)
  const usage = page.getByTestId('task-menu-usage')
  await expect(usage).toBeVisible()
  return usage
}

/** 精简导航／流程视图／列表视图 moved from the stage row into the task menu (plan Y6). */
async function chooseBoardView(page: Page, name: '精简导航' | '流程视图' | '列表视图') {
  const usage = await openTaskUsage(page)
  const option = usage.getByRole('group', { name: '看板展示方式' }).getByRole('button', { name, exact: true })
  await option.click()
  await expect(option).toHaveAttribute('aria-pressed', 'true')
  // The menu is a dropdown over the board; close it before interacting with the board.
  await closeTaskMenu(page)
}

async function openTopbarProjectMenu(page: Page) {
  const menu = page.locator('.topbar-project-menu')
  await expect(menu).toBeVisible()
  if (await menu.getAttribute('open') === null) await menu.locator(':scope > summary').click()
}

/** Four primary entries (plan §4.1, Y1): 任务, 知识, 团队, 设置. */
const PRIMARY_NAV = ['任务', '知识', '团队', '设置'] as const

function primaryNavigation(page: Page) {
  return page.locator('aside[aria-label="Primary navigation"]')
}

async function clickPrimaryNav(page: Page, name: typeof PRIMARY_NAV[number]) {
  await primaryNavigation(page).getByRole('button', { name, exact: true }).click()
}

const SETTINGS_SECTION_IDS = {
  本地项目: 'project',
  模型与执行方式: 'models',
  扩展能力: 'extensions',
  团队连接: 'team',
  外观: 'appearance',
  高级: 'advanced',
} as const

/** Opens 设置 and one of its sections (plan Y2); returns the section content container. */
async function openSettingsSection(page: Page, name: keyof typeof SETTINGS_SECTION_IDS) {
  if (await page.getByTestId('settings-view').count() === 0) await clickPrimaryNav(page, '设置')
  // The section list must stay reachable at every window size (plan Y2).
  const sections = page.getByRole('navigation', { name: '设置分区' })
  await expect(sections).toBeVisible()
  await sections.getByRole('button', { name, exact: true }).click()
  const section = page.getByTestId(`settings-section-${SETTINGS_SECTION_IDS[name]}`)
  await expect(section).toBeVisible()
  return section
}

/** Opens a folded <details> (by its summary) inside a settings section. */
async function openSettingsDisclosure(scope: Locator, summaryText: string) {
  const details = scope.locator('details.runtime-settings').filter({
    has: scope.page().locator('summary', { hasText: summaryText }),
  })
  await expect(details).toHaveCount(1)
  if (await details.getAttribute('open') === null) await details.locator(':scope > summary').click()
  await expect(details).toHaveAttribute('open', '')
  return details
}

/** TOC, review basis links and 查看原文 share one folded 阅读工具 above the body (plan Y6). */
async function openReadingTools(scope: Locator) {
  const tools = scope.getByTestId('artifact-reading-tools').first()
  await expect(tools).toBeVisible()
  if (await tools.getAttribute('open') === null) await tools.locator(':scope > summary').click()
  await expect(tools).toHaveAttribute('open', '')
  return tools
}

/**
 * Sub-steps are folded into the stage item (plan §5.1, Y6): clicking the stage item that is
 * being browsed toggles #workflow-stage-nodes; open them before clicking a node button.
 */
async function clickSubStep(page: Page, testId: string) {
  const toggle = page.getByTestId('stage-navigation').locator('[data-testid="stage-item"][aria-expanded]')
  await expect(toggle).toHaveCount(1)
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('#workflow-stage-nodes')).toBeVisible()
  await page.getByTestId(testId).click()
}

/** Inspector tabs are 当前工作 / 材料与版本 / 执行记录 (plan W1); 当前工作 is always the default. */
const INSPECTOR_TABS = ['当前工作', '材料与版本', '执行记录'] as const

function inspectorTab(page: import('@playwright/test').Page, name: typeof INSPECTOR_TABS[number]) {
  return page.getByTestId('node-inspector').getByRole('tab', { name, exact: true })
}

/** Node artifacts, test evidence history and knowledge references live in 材料与版本. */
async function showNodeMaterials(page: import('@playwright/test').Page) {
  await inspectorTab(page, '材料与版本').click()
  await expect(inspectorTab(page, '材料与版本')).toHaveAttribute('aria-selected', 'true')
}

/** Execution happens in the task (plan W5): 设置 (which replaced the Agents/Tests pages) must not be open. */
async function expectStaysOnWorkbench(page: Page) {
  await expect(page.getByTestId('workflow-canvas')).toBeVisible()
  await expect(page.getByTestId('node-inspector')).toBeVisible()
  await expect(page.getByTestId('settings-view')).toHaveCount(0)
}

async function createFixtureRun(page: Page) {
  await page.getByRole('button', { name: '新建任务', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建任务', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('标题').fill('重构 GitHub webhook 重试策略')
  await dialog.getByLabel('一句话需求').fill('请先澄清 webhook retry 的失败边界，再设计实现方案。')
  await dialog.getByRole('button', { name: '创建任务', exact: true }).click()
  await showProjectRuns(page)
  await expect(page.locator('.run-list').getByText('重构 GitHub webhook 重试策略', { exact: true })).toBeVisible()
  await closeTaskMenu(page)
  await expect(page.getByTestId('toast')).toContainText('任务已创建，尚未调用模型')
  await expect(page.getByTestId('workflow-canvas')).toContainText('需求澄清')
  await expect(page.getByTestId('node-inspector')).toContainText('需求澄清')
}

test.describe('AI DevFlow desktop workbench', () => {
  for (const viewport of [{ width: 1440, height: 920 }, { width: 760, height: 600 }]) {
    for (const colorScheme of ['light', 'dark'] as const) {
      test(`confirms exact Provider removal with keyboard focus and no fallback (${viewport.width}, ${colorScheme})`, async ({ page }, testInfo) => {
        await page.setViewportSize(viewport)
        await page.emulateMedia({ colorScheme })
        await installDesktopApi(page)
        await page.addInitScript(() => {
          const api = window.aiDevFlowDesktop!
          const list = api.listAgentProviders
          let removed = false
          api.listAgentProviders = async () => {
            const original = await list()
            const other = { ...original[0]!, id: 'other-saved-provider', name: 'Other saved provider' }
            return removed ? [other] : [...original, other]
          }
          api.inspectAgentProviderRemoval = async ({ providerId }) => ({
            providerId, credential: { providerId, name: 'Saved QA Provider with a long descriptive name', model: 'fixture-model-with-a-long-name', maskedCredential: 'qa…only', updatedAt: '2026-09-10T12:00:00.000Z' },
            references: [], historicalRecordCount: 12,
          })
          api.removeAgentProviderCredential = async ({ providerId }) => {
            removed = true
            return { status: 'deleted', providerId }
          }
        })
        await page.goto('/')
        // Provider configuration moved from Agents to 设置／模型与执行方式 (plan Y2, Y3).
        const models = await openSettingsSection(page, '模型与执行方式')
        await openSettingsDisclosure(models, '模型提供方 · 本机')
        const manage = models.getByRole('button', { name: '管理已保存 Provider' })
        await manage.click()
        const dialog = page.getByRole('dialog', { name: '管理已保存 Provider' })
        await expect(dialog.getByText('保留历史记录：12 条。')).toBeVisible()
        await expect(dialog.getByRole('button', { name: '取消' })).toBeFocused()
        await page.keyboard.press('Shift+Tab')
        await expect(dialog.getByRole('button', { name: '确认删除 Provider' })).toBeFocused()
        await page.keyboard.press('Tab')
        await expect(dialog.getByRole('button', { name: '取消' })).toBeFocused()
        expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
        await dialog.screenshot({ path: testInfo.outputPath(`provider-removal-${viewport.width}-${colorScheme}.png`) })
        await page.keyboard.press('Escape')
        await expect(dialog).toHaveCount(0)
        await expect(manage).toBeFocused()
        await manage.click()
        await dialog.getByRole('button', { name: '确认删除 Provider' }).click()
        await expect(dialog).toHaveCount(0)
        await expect(page.getByLabel('Saved Agent Provider')).toHaveValue('')
        await expect(page.getByLabel('Saved Agent Provider')).toBeFocused()
        await expect(manage).toBeDisabled()
      })
    }
  }

  for (const viewport of [{ width: 1180, height: 760 }, { width: 1834, height: 768 }]) {
    for (const colorScheme of ['light', 'dark'] as const) {
      test(`scrolls the Team policy page to its final snapshot action (${viewport.width}, ${colorScheme})`, async ({ page }) => {
        await page.setViewportSize(viewport)
        await page.emulateMedia({ colorScheme })
        await installDesktopApi(page, 'clarification-revision')
        await page.addInitScript(() => {
          const api = window.aiDevFlowDesktop!
          const load = api.loadEnforcementPolicy
          api.loadEnforcementPolicy = async (input) => {
            const snapshot = await load(input)
            return {
              ...snapshot,
              effectivePolicy: {
                ...snapshot.effectivePolicy,
                rules: Array.from({ length: 10 }, (_, index) => ({
                    ruleKey: `governance_check:testing_standard:needs_evidence_${index}`, target: 'governance_check', action: 'warn', source: 'organization',
                })),
              },
            } as typeof snapshot
          }
        })
        await page.goto('/')
        await clickPrimaryNav(page, '团队')
        const team = page.getByTestId('team-overview')
        // The first layer names the rule in Chinese; the raw rule key stays in its 详情 (plan Y9).
        const lastRule = team.getByTestId('team-policy-rule').last()
        await expect(team.getByTestId('team-policy-rule')).toHaveCount(10)
        await expect(lastRule).toContainText('测试规范：待核实')
        await expect(lastRule.locator('details > code')).toHaveText('governance_check:testing_standard:needs_evidence_9')
        await expect(lastRule.locator('details > code')).not.toBeVisible()
        await expect.poll(() => team.locator('.policy-row strong').evaluateAll((elements) =>
          elements.every((element) => element.scrollWidth <= element.clientWidth),
        )).toBe(true)
        const box = (await team.boundingBox())!
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
        const syncButton = team.getByRole('button', { name: '更新团队数据' })
        await expect.poll(async () => {
          const reachable = await syncButton.evaluate((element) => {
            const button = element.getBoundingClientRect()
            const parent = element.closest('.team-page')!.getBoundingClientRect()
            return button.top >= parent.top && button.bottom <= parent.bottom
          })
          if (!reachable) await page.mouse.wheel(0, 240)
          return reachable
        }).toBe(true)
        await expect(syncButton).toBeInViewport()
        await page.mouse.wheel(0, 3000)
        await expect(team.getByRole('button', { name: '保存团队策略草稿' })).toBeInViewport()
        await expect.poll(() => team.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
      })

      test(`shows actual Run tokens with an explicitly unknown price (${viewport.width}, ${colorScheme})`, async ({ page }, testInfo) => {
        await page.setViewportSize(viewport)
        await page.emulateMedia({ colorScheme })
        await installDesktopApi(page, 'agent-ux-paired')
        await page.addInitScript(() => {
          const api = window.aiDevFlowDesktop!
          const load = api.loadState
          api.loadState = async () => {
            const state = await load()
            const run = state.runs[0]!
            return { ...state, agentTokenUsage: [{ id: 'opencode-consumption', runId: run.id, nodeId: run.currentNodeId,
              projectId: run.projectId, userId: run.creatorId, provider: 'openai', providerId: 'deepseek', model: 'deepseek-v4-flash',
              inputTokens: 15268, outputTokens: 1444, cacheReadTokens: 12416, costUsd: null,
              source: 'provider_reported', costStatus: 'unknown', usageStatus: 'complete', executorKind: 'local-agent', timestamp: run.updatedAt }] }
          }
        })
        await page.goto('/')
        // 「本任务用量」 is plain first-layer text so the unknown cost stays visible (plan §3, Y6).
        const runSummary = page.getByTestId('task-usage-summary')
        await expect(runSummary).toContainText('本任务用量')
        await expect(runSummary).toContainText('16,712')
        await expect(runSummary).toContainText('金额待确认')
        await expect(runSummary).not.toContainText('$0.00')
        await expect(page.getByRole('button', { name: /^本任务用量/ })).toHaveCount(0)
        // Usage, policy and budget details moved into the task menu (plan Y6).
        const taskUsage = await openTaskUsage(page)
        const usage = taskUsage.getByTestId('run-token-usage')
        await expect(usage).toContainText('16,712')
        await expect(usage).toContainText('1 项金额待确认')
        await expect(usage).not.toContainText('$0.00')
        await expect(taskUsage.getByTestId('runtime-budget-status')).toContainText('数据不完整')
        await page.screenshot({ path: testInfo.outputPath('unknown-run-cost.png') })
      })

      test(`opens card attachment counts with the keyboard (${viewport.width}, ${colorScheme})`, async ({ page }, testInfo) => {
        await page.setViewportSize(viewport)
        await page.emulateMedia({ colorScheme })
        await installDesktopApi(page, 'agent-ux-paired')
        await page.addInitScript(() => {
          const api = window.aiDevFlowDesktop!
          const load = api.loadState
          api.loadState = async () => {
            const state = await load()
            const run = state.runs[0]!
            const nodeId = run.nodes[1]!.id
            return {
              ...state,
              artifacts: [{ id: 'review-owned', runId: run.id, nodeId, kind: 'design', title: '本次 Gate 审查报告',
                summary: '已归档的审查结论', content: 'Reviewed the current requirement.', redacted: true, updatedAt: run.updatedAt }],
              events: [{ id: 'review-event', runId: run.id, nodeId, kind: 'agent_step', sequence: 1,
                message: 'Review archived once.', timestamp: run.updatedAt }],
            }
          }
        })
        const errors: string[] = []
        page.on('pageerror', (error) => errors.push(error.message))
        await page.goto('/')
        const card = page.getByTestId('workflow-card-node-agent-ux-design-gate')
        await chooseBoardView(page, '流程视图')
        const inspector = page.getByTestId('node-inspector')
        // Board chips keep their names; artifacts and (on a Gate) test evidence open 材料与版本,
        // the trace opens 执行记录 (plan W1).
        for (const [label, count, tab, text] of [
          ['产物', 1, '材料与版本', '本次 Gate 审查报告'],
          ['测试证据', 0, '材料与版本', '当前节点尚未归档测试证据。'],
          ['轨迹', 1, '执行记录', 'Review archived once.'],
        ] as const) {
          const chip = card.getByRole('button', { name: `方案评审 Gate：${label} ${count}` })
          await chip.focus()
          await chip.press('Enter')
          await expect(inspector.getByRole('tab', { name: tab, exact: true })).toHaveAttribute('aria-selected', 'true')
          await expect(inspector).toContainText(text)
        }
        await card.getByRole('button', { name: '方案评审 Gate：产物 1' }).click()
        await expect(inspector.getByTestId('node-artifacts').locator('.artifact-card')).toHaveCount(1)
        // The Gate's own material is read in 当前工作, not duplicated in the material card.
        await inspector.getByTestId('node-artifacts').getByRole('button', { name: '在「当前工作」中阅读', exact: true }).click()
        await expect(inspector.getByRole('tab', { name: '当前工作', exact: true })).toHaveAttribute('aria-selected', 'true')
        await expect(inspector).toContainText('Reviewed the current requirement.')
        await expect(page.locator('button button')).toHaveCount(0)
        const tabs = inspector.locator('.workspace-primary-tabs').getByRole('tab')
        await expect(tabs).toHaveText([...INSPECTOR_TABS])
        for (const tab of await tabs.all()) {
          await tab.focus()
          await tab.press('Enter')
          await expect(tab).toHaveAttribute('aria-selected', 'true')
          await expect(tab).toBeInViewport()
        }
        await expect(tabs).toHaveCount(3)
        await showNodeMaterials(page)
        await expect(inspector.getByTestId('knowledge-reference-sources')).toBeVisible()
        await page.screenshot({ path: testInfo.outputPath('attachment-navigation.png') })
        expect(errors).toEqual([])
      })

      test(`reads complete Markdown by sections and reaches persistent Gate evidence (${viewport.width}, ${colorScheme})`, async ({ page }) => {
        await page.setViewportSize(viewport)
        await page.emulateMedia({ colorScheme })
        await installDesktopApi(page, 'clarification-revision')
        await page.addInitScript(() => {
          const api = window.aiDevFlowDesktop!
          const load = api.loadState
          api.loadState = async () => {
            const state = await load()
            return {
              ...state,
              artifacts: state.artifacts.map((artifact) => artifact.kind === 'clarification'
                ? { ...artifact, content: Array.from({ length: 16 }, (_, index) => `## Acceptance ${index + 1}\n\nConfirm the retry boundary, preserve unrelated content, and retain auditable evidence for the current requirement.`).join('\n\n') }
                : artifact),
            }
          }
        })
        await page.goto('/')
        const inspector = page.getByTestId('node-inspector')
        // The Gate's body opens by default in 当前工作 (plan W1).
        await expect(inspectorTab(page, '当前工作')).toHaveAttribute('aria-selected', 'true')
        const document = inspector.getByTestId('clarification-current-revision')
        await expect(document.locator('.artifact-reading-section')).toHaveCount(16)
        // TOC, review basis and 查看原文 are folded into one 阅读工具 on the first screen (plan Y6).
        await expect(document.locator('.artifact-toc')).not.toBeVisible()
        await expect(document.locator('.material-reference-links')).not.toBeVisible()
        const readingTools = await openReadingTools(document)
        await expect(readingTools.locator('.artifact-toc a')).toHaveCount(16)
        const lastSection = document.locator('.artifact-reading-section').last()
        await readingTools.locator('.artifact-toc a').last().click()
        await expect(lastSection.locator('p')).toContainText('Confirm the retry boundary')
        await readingTools.getByRole('button', { name: '查看原文', exact: true }).click()
        await expect(document.locator('.message-plain')).toContainText('## Acceptance 16')
        await readingTools.getByRole('button', { name: '返回排版', exact: true }).click()
        await expect(document.locator('.artifact-reading-section')).toHaveCount(16)
        // 团队规范 in the reader only points to the reference list kept in 材料与版本.
        await readingTools.locator('.material-reference-links').getByRole('button', { name: '团队规范', exact: true }).click()
        const pointer = inspector.getByTestId('knowledge-reference-pointer')
        await expect(pointer).toContainText('完整列表与来源在「材料与版本」中')
        await expect(inspector.getByTestId('knowledge-reference-sources')).toHaveCount(0)
        await pointer.getByRole('button', { name: '查看引用来源', exact: true }).click()
        const evidenceTab = inspectorTab(page, '材料与版本')
        await expect(evidenceTab).toHaveAttribute('aria-selected', 'true')
        await expect(inspector.getByTestId('knowledge-reference-sources')).toBeVisible()
        await inspectorTab(page, '当前工作').click()
        await evidenceTab.scrollIntoViewIfNeeded()
        await expect(evidenceTab).toBeVisible()
        await evidenceTab.click()
        await expect(evidenceTab).toHaveAttribute('aria-selected', 'true')
      })
    }
  }

  test('keeps the unpaired design flow focused on one explained primary action', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.setViewportSize({ width: 1180, height: 760 })
    await installDesktopApi(page, 'agent-ux-unpaired')
    await page.goto('/')

    // Execution happens in the task (plan W5): the status row's one primary action is the design
    // generation and names the model before the call. The Agents "current task" card duplicated
    // this row and was removed (plan Y3).
    const inspector = page.getByTestId('node-inspector')
    const statusRow = inspector.getByTestId('task-status-row')
    await expect(inspector).toContainText('方案设计')
    await expect(statusRow.locator('.primary-button:visible')).toHaveCount(1)
    await expect(statusRow.getByTestId('complete-design-agent')).toHaveClass(/primary-button/u)
    await expect(statusRow).toContainText('可以生成方案')
    await expect(statusRow).toContainText(/doubao-review/u)

    // 设置 only configures (plan Y2): no generation and no primary action there.
    const models = await openSettingsSection(page, '模型与执行方式')
    await expect(models.getByRole('button', { name: /生成设计方案|生成方案/u })).toHaveCount(0)
    await expect(models.locator('.primary-button:visible')).toHaveCount(0)

    // The independent Runtime and multi-agent tools moved from Agents to 设置／高级 (plan Y2).
    const workbench = await openSettingsSection(page, '高级')
    const advanced = workbench.getByTestId('agent-advanced-tools')
    const summary = advanced.locator(':scope > summary')
    await expect(advanced).not.toHaveAttribute('open', '')
    await expect(workbench.locator('.primary-button:visible')).toHaveCount(0)
    await expect(workbench.getByText('workflow.evaluate', { exact: true })).not.toBeVisible()
    await expect(summary).toContainText('未连接团队 · 多 Agent 入口不可用')
    await summary.focus()
    await summary.press('Enter')
    await expect(advanced).toHaveAttribute('open', '')

    const coordinationAction = workbench.getByRole('button', { name: '创建固定多 Agent 验收会话（需先配对 Team）' })
    await expect(coordinationAction).toBeDisabled()
    await expect(coordinationAction).toHaveAccessibleDescription(/不可用：请先在设置／团队连接中把当前本地项目连接到团队项目。.*必须先将当前 Local Project 配对到 Team Project/u)
    await expect(workbench.getByRole('button', { name: '创建独立 Runtime 验证实例（高级）' })).toBeEnabled()
    await expect(workbench.locator('.primary-button:visible')).toHaveCount(0)
    await expect(page.getByTestId('settings-view').getByRole('button', { name: /生成设计方案|生成方案/u })).toHaveCount(0)

    const darkContrast = await page.evaluate(() => {
      const styles = getComputedStyle(document.documentElement)
      const luminance = (value: string) => {
        const hex = value.trim().replace('#', '')
        const channels = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
          .map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
        return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
      }
      const foreground = luminance(styles.getPropertyValue('--text'))
      const background = luminance(styles.getPropertyValue('--surface-2'))
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
    })
    expect(darkContrast).toBeGreaterThan(4.5)

    // The theme moved from the top bar to 设置／外观 (plan Y5).
    const appearance = await openSettingsSection(page, '外观')
    await appearance.getByTestId('theme-toggle').click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    const lightContrast = await page.evaluate(() => {
      const styles = getComputedStyle(document.documentElement)
      const luminance = (value: string) => {
        const hex = value.trim().replace('#', '')
        const channels = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
          .map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
        return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
      }
      const foreground = luminance(styles.getPropertyValue('--text'))
      const background = luminance(styles.getPropertyValue('--surface-2'))
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
    })
    expect(lightContrast).toBeGreaterThan(4.5)
    // Returning to the task runs nothing; the design generation is still the status row's primary action.
    await clickPrimaryNav(page, '任务')
    await expectStaysOnWorkbench(page)
    await expect(inspector).toContainText('方案设计')
    await expect(statusRow.getByTestId('complete-design-agent')).toBeVisible()
    await expect(statusRow.locator('.primary-button:visible')).toHaveCount(1)
  })

  test('exposes paired Runtime and Coordination only through the keyboard-accessible advanced area', async ({ page }) => {
    await installDesktopApi(page, 'agent-ux-paired')
    await page.goto('/')
    // The independent Runtime and multi-agent tools moved from Agents to 设置／高级 (plan Y2).
    const workbench = await openSettingsSection(page, '高级')
    const advanced = workbench.getByTestId('agent-advanced-tools')
    const summary = advanced.locator(':scope > summary')
    await expect(advanced).not.toHaveAttribute('open', '')
    await expect(summary).toContainText('已连接团队 · 多 Agent 入口可用')
    await expect(workbench.getByRole('region', { name: '独立 Runtime 验收与诊断' })).not.toBeVisible()
    await summary.focus()
    await summary.press('Space')
    await expect(advanced).toHaveAttribute('open', '')

    await expect(workbench.getByRole('region', { name: '独立 Runtime 验收与诊断' })).toBeVisible()
    await expect(workbench.getByRole('region', { name: '固定多 Agent 验收会话' })).toBeVisible()
    await expect(workbench.getByTitle('Runtime：独立于当前 Workflow 的有界执行状态机。')).toBeVisible()
    await expect(workbench.getByTitle('Multi-Agent Coordination：多个受限 Specialist 按固定依赖图协作。')).toBeVisible()
    await expect(workbench.getByText('workflow.evaluate', { exact: true })).toBeVisible()
    await expect(workbench).toContainText('首次创建不调用当前 Stage Provider')
    await expect(workbench).toContainText('后续 bounded-implementer 可能只在受管工作区写入')
    await expect(workbench).toContainText('不生成当前设计 Artifact、不推进工作流、不审批 Gate')

    const runtimeAction = workbench.getByRole('button', { name: '创建独立 Runtime 验证实例（高级）' })
    const coordinationAction = workbench.getByRole('button', { name: '创建固定多 Agent 验收会话（高级）' })
    await expect(runtimeAction).toBeEnabled()
    await expect(coordinationAction).toBeEnabled()
    await expect(runtimeAction).toHaveClass(/ghost-button/u)
    await expect(coordinationAction).toHaveClass(/ghost-button/u)
    // Diagnostics offer no primary action; design generation stays in the task (plan W5, Y2).
    await expect(workbench.locator('.primary-button:visible')).toHaveCount(0)
    await expect(page.getByTestId('settings-view').getByRole('button', { name: /生成设计方案|生成方案/u })).toHaveCount(0)
  })

  test('compares requirement inputs, requests changes, generates v2, and approves only v2', async ({ page }) => {
    await installDesktopApi(page, 'clarification-revision')
    await page.goto('/')

    const inspector = page.getByTestId('node-inspector')
    await expect(inspectorTab(page, '当前工作')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('clarification-review')).toBeVisible()
    // The review basis links are folded into the body's 阅读工具 (plan Y6).
    const readingTools = await openReadingTools(inspector.getByTestId('clarification-current-revision'))
    await readingTools.getByRole('button', { name: /原始需求/ }).click()
    await expect(page.getByTestId('clarification-raw-request')).toContainText('Clarify webhook retry boundaries')
    await readingTools.getByRole('button', { name: /代码调查/ }).click()
    await expect(page.getByTestId('clarification-repository-findings')).toContainText('Retry handler exists')
    await expect(page.getByTestId('clarification-current-revision')).toContainText('需求澄清 v1')
    await expect(page.getByTestId('clarification-current-revision')).toContainText('待确认')

    await inspector.getByRole('button', { name: '请求修订当前版本', exact: true }).click()
    await inspector.getByLabel('结构化修订意见').fill('State the retry boundary explicitly.')
    await inspector.getByRole('button', { name: '确认提交修订请求', exact: true }).click()
    await expect(page.getByTestId('toast')).toContainText('流程返回需求澄清')
    await expect(inspector).toContainText('需求澄清')

    await inspector.getByRole('button', { name: '生成修订', exact: true }).click()
    await expect(page.getByTestId('toast')).toContainText('需求澄清已生成')
    await inspectorTab(page, '当前工作').click()
    await expect(inspectorTab(page, '当前工作')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('clarification-current-revision')).toContainText('需求澄清 v2')
    await expect(page.getByTestId('clarification-current-revision')).toContainText('待确认')
    await page.getByTestId('clarification-revision-history').locator('summary').click()
    await expect(page.getByTestId('clarification-revision-history')).toContainText('需求澄清 v1 · 已被替代（历史）')
    await expect(page.getByTestId('clarification-revision-history')).toContainText('State the retry boundary explicitly.')

    await inspector.getByTestId('task-status-row').getByRole('button', { name: '确认需求 v2', exact: true }).click()
    await expect.poll(() => page.evaluate(() => (window as unknown as { __clarificationApprovals: unknown[] }).__clarificationApprovals.length)).toBe(1)
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
    // Four primary entries (plan Y1); the top bar has no theme toggle (plan Y5).
    await expect(primaryNavigation(page).getByRole('button')).toHaveText([...PRIMARY_NAV])
    await expect(page.locator('header.topbar').getByTestId('theme-toggle')).toHaveCount(0)
    // The data source badge is part of 设置／高级 (plan Y2).
    const advanced = await openSettingsSection(page, '高级')
    await expect(advanced.getByTestId('runtime-source-badge')).toContainText('本地暂无任务')
    // The theme is chosen in 设置／外观 (plan Y5).
    const appearance = await openSettingsSection(page, '外观')
    const themeToggle = appearance.getByTestId('theme-toggle')
    await expect(themeToggle).toHaveText('跟随系统')
    await themeToggle.click()
    await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'light')
    await expect(themeToggle).toHaveText('浅色')

    await clickPrimaryNav(page, '任务')
    await showProjectRuns(page)
    await expect(page.getByText('当前项目的任务')).toBeVisible()
    await expect(page.getByTestId('workflow-empty-state')).toContainText('任务阶段')
    await expect(page.getByTestId('workflow-empty-state')).toContainText('暂无任务')
    await expect(page.getByTestId('node-inspector-empty')).toContainText('任务详情')
    await expect(page.getByTestId('node-inspector-empty')).toContainText('选择任务后显示当前步骤、材料、执行记录与审批。')

    await createFixtureRun(page)

    const workflow = page.getByTestId('workflow-canvas')
    await chooseBoardView(page, '流程视图')
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
    // The downstream Gate impact of a Task is part of 当前工作 (plan W1).
    await inspectorTab(page, '当前工作').click()
    await expect(inspectorTab(page, '当前工作')).toHaveAttribute('aria-selected', 'true')
    const gateImpact = page.getByTestId('gate-impact-summary')
    await expect(gateImpact).toContainText('对后续 Gate 的影响')
    await expect(gateImpact).toContainText('紧接着的 Gate')
    await expect(gateImpact).toContainText('需求确认 Gate')
    await expect(gateImpact).toContainText('等待中')
    await expect(gateImpact).toContainText('当前步骤的材料尚未关联到该 Gate')
    await expect(gateImpact.getByRole('button', { name: /通过 Gate|确认需求|确认方案|Override/ })).toHaveCount(0)
    await gateImpact.getByRole('button', { name: '查看该 Gate' }).click()
    await expect(page.getByTestId('node-inspector')).toContainText('Gate · Team Policy')
    const designCard = workflow.getByTestId('flow-node-run-created-from-request-design')
    await expect(designCard).toContainText('Task')
    await expect(designCard).not.toContainText('Review')
    await designCard.click()
    await expect(page.getByTestId('node-inspector')).toContainText('Task · Run 模板')

    await openTopbarProjectMenu(page)
    await page.getByRole('button', { name: /选择本地仓库/ }).click()
    await expect(page.locator('.local-project-panel').getByText('fixture-project', { exact: true })).toBeVisible()
    // The project panel overlays the navigation; Escape closes it and returns focus to its trigger.
    await page.keyboard.press('Escape')
    await expect(page.locator('.topbar-project-menu')).not.toHaveAttribute('open', '')
    await expect(page.locator('.topbar-project-menu > summary')).toBeFocused()
    // The test command moved from the Tests page to 设置／本地项目 (plan Y4).
    const localProject = await openSettingsSection(page, '本地项目')
    const testsSettings = localProject.getByTestId('settings-project')
    await testsSettings.getByLabel('测试命令').fill('pnpm test -- --run')
    await testsSettings.getByRole('button', { name: /保存测试命令/ }).click()
    await expect(page.getByTestId('toast')).toContainText('测试命令已保存')

    await expect(testsSettings).toContainText('本项目测试记录')
    await expect(testsSettings.getByLabel('测试命令')).toHaveValue('pnpm test -- --run')
    await expect(testsSettings).toContainText('pnpm test -- --run')
    await expect(testsSettings.getByTestId('test-command-status')).toContainText('已保存')
    await clickPrimaryNav(page, '任务')

    await showProjectRuns(page)
    await page.getByLabel('搜索当前项目').fill('nothing matches this')
    await expect(page.getByTestId('search-results')).toContainText('没有匹配结果')
    await expect(page.getByText('没有匹配的 Run')).toBeVisible()
    await page.getByLabel('搜索当前项目').fill('重构 GitHub')
    await expect(page.getByTestId('search-results')).toContainText('重构 GitHub webhook 重试策略')
    await expect(page.locator('.run-list').getByText('重构 GitHub webhook 重试策略', { exact: true })).toBeVisible()
  })

  test('supports manager, knowledge, skill, MCP, and test views', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await installDesktopApi(page, 'configured')
    await page.goto('/')
    await createFixtureRun(page)

    // Agents configuration moved to 设置／模型与执行方式 (plan Y2, Y3); settings only configure,
    // execution is handled in the task (plan W5).
    const models = await openSettingsSection(page, '模型与执行方式')
    await expect(models.getByTestId('settings-models')).toContainText('当前 Agent Provider：doubao-review')
    const settings = page.getByTestId('settings-view')
    await expect(settings.getByRole('button', { name: /运行门禁审查/ })).toHaveCount(0)
    await expect(settings.getByRole('button', { name: /生成需求澄清/ })).toHaveCount(0)
    await clickPrimaryNav(page, '任务')
    await expectStaysOnWorkbench(page)
    const reviewedGateInspector = page.getByTestId('node-inspector')
    await reviewedGateInspector.getByTestId('task-status-row').getByTestId('complete-clarify-agent').click()
    await expect(page.getByTestId('toast')).toContainText('需求澄清已生成，进入需求确认 Gate')
    await clickSubStep(page, 'flow-node-run-created-from-request-clarify-gate')
    await expect(reviewedGateInspector).toContainText('需求确认 Gate')
    // Gate Review runs in place from the task status row (plan W2).
    const runReview = reviewedGateInspector.getByTestId('task-status-row').getByRole('button', { name: /运行门禁审查/ })
    await expect(runReview).toBeEnabled()
    await runReview.click()
    await expect(page.getByTestId('toast')).toContainText('门禁审查已完成，审查意见显示在「当前工作」中')
    await expectStaysOnWorkbench(page)
    await expect(reviewedGateInspector).toContainText('需求确认 Gate')
    await expect(inspectorTab(page, '当前工作')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('review-evidence-results')).toContainText('Knowledge review completed for this node.')
    await expect(page.getByTestId('review-evidence-results')).toContainText('warning-only')
    // A saved review is re-run only after the existing confirmation; cancelling sends nothing.
    await reviewedGateInspector.getByTestId('task-review-run').getByRole('button', { name: '重新审查', exact: true }).click()
    const rerunDialog = page.getByRole('dialog', { name: '确认重新审查' })
    await expect(rerunDialog.getByRole('button', { name: '继续并重新审查', exact: true })).toBeVisible()
    await rerunDialog.getByRole('button', { name: '取消', exact: true }).click()
    await expect(rerunDialog).toHaveCount(0)

    await showNodeMaterials(page)
    const referencesTab = inspectorTab(page, '材料与版本')
    await referencesTab.focus()
    await referencesTab.press('Enter')
    await expect(page.getByTestId('knowledge-reference-sources')).toContainText(
      '当前 Gate 还没有属于本步骤的知识引用',
    )
    await expect(page.getByTestId('knowledge-reference-sources')).not.toContainText(
      'Knowledge review completed for this node.',
    )
    // 材料与版本 lists the archived report; its conclusion and opinions are read in 当前工作.
    const archivedReport = reviewedGateInspector.getByRole('region', { name: '已归档的审查报告' })
    await expect(archivedReport).toContainText('ark-code-latest')
    await archivedReport.getByRole('button', { name: '在「当前工作」中查看审查意见', exact: true }).click()
    await expect(inspectorTab(page, '当前工作')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('review-evidence-results')).toContainText(
      'Knowledge review completed for this node.',
    )
    await expect(page.getByTestId('review-evidence-results')).not.toContainText('Review Criteria')

    await page.getByLabel('搜索当前项目').fill('missing knowledge node')
    await clickPrimaryNav(page, '团队')
    await expect(page.getByTestId('team-overview')).toContainText('项目交付健康')
    await expect(page.getByTestId('team-overview')).toContainText('尚未加载团队项目')

    await clickPrimaryNav(page, '知识')
    await expect(page.getByTestId('knowledge-view')).toContainText('知识治理')
    await expect(page.getByTestId('knowledge-view')).toContainText('没有匹配的知识文档')
    await expect(page.getByText('没有匹配的知识节点')).toBeVisible()
    // Memory management moved here from the Agents page (plan Y3).
    await expect(page.getByTestId('knowledge-memory-section')).toBeVisible()
    await page.getByLabel('搜索当前项目').fill('')

    // The review evidence formerly on Agents is in the Gate's 执行记录, folded (plan Y3).
    await clickPrimaryNav(page, '任务')
    await expectStaysOnWorkbench(page)
    await expect(reviewedGateInspector).toContainText('需求确认 Gate')
    await inspectorTab(page, '执行记录').click()
    await expect(inspectorTab(page, '执行记录')).toHaveAttribute('aria-selected', 'true')
    const evidenceGroups = reviewedGateInspector.getByTestId('agent-evidence-groups')
    await expect(evidenceGroups).not.toHaveAttribute('open', '')
    await evidenceGroups.locator(':scope > summary').click()
    await expect(evidenceGroups).toHaveAttribute('open', '')
    await expect(evidenceGroups).toContainText('基于知识的门禁审查')
    await expect(evidenceGroups).toContainText('doubao-review')
    await expect(evidenceGroups).toContainText('warning-only')
    await expect(evidenceGroups.getByText('Build redacted context', { exact: true })).toBeVisible()

    // Skills and MCP moved to 设置／扩展能力 (plan Y2).
    const extensions = await openSettingsSection(page, '扩展能力')
    await expect(extensions.getByTestId('skill-view')).toContainText('团队能力目录')
    await expect(extensions.getByTestId('skill-view')).toContainText('未加载团队 Skills')
    await expect(extensions.getByTestId('mcp-view')).toContainText('本机工具连接器')
    await expect(extensions.getByTestId('mcp-view')).toContainText('未加载本地 MCP 连接器')

    // The test command and records moved to 设置／本地项目 (plan Y4).
    const localProject = await openSettingsSection(page, '本地项目')
    const testsView = localProject.getByTestId('settings-project')
    await expect(testsView).toContainText('测试命令')
    await expect(testsView).toContainText('本项目测试记录')
    // Tests only run at the actual test step; the reason is shown before any click (plan D4, X6).
    // The section keeps the command and history; its one entry hands back to the task (plan W5).
    await expect(testsView.getByRole('button', { name: /执行测试|执行本地测试|运行检查/ })).toHaveCount(0)
    await expect(testsView.getByTestId('tests-run-blocked-reason')).toBeVisible()
    await expect(testsView).not.toContainText('Local test evidence')
    await expect(testsView).not.toContainText('passed')
    const handleTestsInTask = testsView.getByRole('button', { name: '在任务中处理', exact: true })
    await expect(handleTestsInTask).toBeEnabled()
    await handleTestsInTask.click()
    await expectStaysOnWorkbench(page)
    // The current step is the reviewed Gate, not a test step: no check can run from here.
    await expect(page.getByTestId('node-inspector')).toContainText('需求确认 Gate')
    await expect(page.getByTestId('task-status-row').getByRole('button', { name: '运行检查', exact: true })).toHaveCount(0)
    expect(pageErrors).toEqual([])
  })

  test('keeps Coding Engine detection advisory until the user confirms the project executor', async ({ page }) => {
    await installDesktopApi(page)
    await page.goto('/')
    await createFixtureRun(page)

    // The project execution tool moved from Agents to 设置／模型与执行方式 (plan Y2).
    const models = await openSettingsSection(page, '模型与执行方式')
    const codingSettings = await openSettingsDisclosure(models, '项目执行工具 · 本地项目')
    await expect(codingSettings).toContainText('执行工具：已配置')
    await expect(codingSettings).toContainText('Coding Engine：可用')
    await expect(codingSettings).toContainText('Provider：可用')
    await expect(codingSettings).toContainText('Team Project：已配对')
    await expect(codingSettings).toContainText('测试命令：已配置')
    await expect(codingSettings).toContainText('预算策略：已配置')
    await expect(codingSettings).toContainText('预算评估：允许执行')

    await codingSettings.getByLabel('执行工具', { exact: true }).selectOption('opencode-http')
    await expect(codingSettings.getByLabel('OpenCode 已保存 Provider')).toHaveValue('doubao-review')
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
      providerId: 'doubao-review',
      modelId: 'ark-code-latest',
      binaryPath: '/opt/devflow/bin/opencode',
      detectedVersion: '1.2.3',
    })
  })

  test('reviews one exact multi-file Change Set in the task before approval', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await installDesktopApi(page, 'coding-permission')
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.goto('/')
    await page.waitForTimeout(250)
    expect(pageErrors).toEqual([])

    // The exact diff review is rendered in 当前工作 (plan W3); approval exists only there.
    const inspector = page.getByTestId('node-inspector')
    const statusRow = inspector.getByTestId('task-status-row')
    const changeSetPanel = inspector.getByTestId('task-coding-change-set')
    await expect(changeSetPanel.getByTestId('coding-change-set-review')).toBeVisible()
    await expect(statusRow.getByRole('button', { name: /批准这些改动/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '批准这些改动' })).toHaveCount(1)
    await inspector.getByRole('tab', { name: '执行记录', exact: true }).click()
    await statusRow.getByRole('button', { name: '审查并批准修改', exact: true }).click()
    await expect(inspectorTab(page, '当前工作')).toHaveAttribute('aria-selected', 'true')
    await expect(changeSetPanel).toBeFocused()
    await expectStaysOnWorkbench(page)

    const review = changeSetPanel.getByTestId('coding-change-set-review')
    await expect(review).toBeVisible()
    await expect(review.getByLabel('src/a.ts 的改动')).toBeVisible()
    await expect(review.getByLabel('src/b.ts 的改动')).toBeVisible()
    await expect(review).toContainText('c'.repeat(64))
    const diffStyle = await review.getByLabel('src/a.ts 的改动').evaluate((element) => ({
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
    await review.getByRole('button', { name: '批准这些改动' }).scrollIntoViewIfNeeded()
    await expect(review.getByRole('button', { name: '批准这些改动' })).toBeVisible()
    await expect(review.getByRole('button', { name: '拒绝改动' })).toBeVisible()
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(review).toBeVisible()
    await page.emulateMedia({ colorScheme: 'light' })
    await expect(review).toBeVisible()

    await review.getByRole('button', { name: '批准这些改动' }).click()
    await expect.poll(() => page.evaluate(() => (
      window as unknown as { __codingPermissionReplies: unknown[] }
    ).__codingPermissionReplies)).toEqual([{
      requestId: 'permission-review',
      codingRunId: 'coding-run-review',
      decision: 'approved',
    }])
    await expect(review).toHaveCount(0)
    await expectStaysOnWorkbench(page)
    await page.getByRole('navigation', { name: '六阶段导航' }).getByRole('button', { name: /测试证据/ }).click()
    await expect(page.getByTestId('flow-node-node-test-review')).toContainText('当前步骤')
    expect(pageErrors).toEqual([])
  })

  test('runs Coding from idle through approval, persisted evidence, and the next workflow node', async ({ page }) => {
    await installDesktopApi(page, 'coding-lifecycle')
    await page.goto('/')

    const inspector = page.getByTestId('node-inspector')
    await inspector.getByRole('button', { name: '启动 Coding Agent' }).click()
    // The exact diff is reviewed and approved in the task's 当前工作 (plan W3).
    const review = inspector.getByTestId('task-coding-change-set').getByTestId('coding-change-set-review')
    await expect(review.getByLabel('src/a.ts 的改动')).toContainText('new a 59')
    await expect(review.getByLabel('src/b.ts 的改动')).toContainText('new b 59')
    await expectStaysOnWorkbench(page)
    await review.getByRole('button', { name: '批准这些改动' }).click()
    await expect(review).toHaveCount(0)
    await expectStaysOnWorkbench(page)

    await page.getByRole('navigation', { name: '六阶段导航' }).getByRole('button', { name: /测试证据/ }).click()
    await expect(page.getByTestId('flow-node-node-test-review')).toContainText('当前步骤')
    await page.getByRole('navigation', { name: '六阶段导航' }).getByRole('button', { name: /开发实现/ }).click()
    await clickSubStep(page, 'flow-node-node-build-review')
    await expect(inspectorTab(page, '当前工作')).toHaveAttribute('aria-selected', 'true')
    const terminal = page.getByTestId('workbench-coding-terminal')
    await expect(terminal).toContainText('已完成')
    // Changes and the diff are part of 当前工作 once the run is terminal.
    const changes = inspector.getByRole('region', { name: '开发变更与检查' })
    await expect(changes).toContainText('Saved worktree test passed.')
    await expect(changes).toContainText('+new')
    await inspectorTab(page, '执行记录').click()
    // Coding evidence from the Agents page replaces the old 开发执行详情 table (plan Y3).
    await expect(inspector.getByText('开发执行详情', { exact: true })).toHaveCount(0)
    const records = inspector.getByTestId('coding-run-records')
    await expect(records).toBeVisible()
    const terminalSummary = records.getByTestId('coding-terminal-summary')
    await expect(terminalSummary).toContainText('输入 / 输出 tokens')
    await expect(terminalSummary).toContainText('120 / 30')
    await expect(terminalSummary).toContainText('150')
    await expect(terminalSummary).toContainText('提供方实际结算')
    await expect(terminalSummary).toContainText('$0.012')
    const audit = records.getByTestId('coding-run-audit')
    await expect(audit).toContainText('coding-run-review')
    await expect(audit.getByRole('list', { name: 'Coding Run trace history' })).toContainText('Applied the exact approved Change Set.')
    await expect(audit.getByRole('list', { name: 'Coding Run permission history' })).toContainText('permission-review')
    // The remaining evidence groups are folded at the end of 执行记录 (plan Y3).
    await expect(inspector.getByTestId('agent-evidence-groups')).not.toHaveAttribute('open', '')
    // The managed worktree moved from Agents into the build step's 执行记录 (plan W3).
    await expect(inspector.getByTestId('coding-workspace-records')).toContainText('/tmp/devflow-review')
    await expect(inspector.getByRole('button', { name: /启动|重新运行/ })).toHaveCount(0)
  })
})
