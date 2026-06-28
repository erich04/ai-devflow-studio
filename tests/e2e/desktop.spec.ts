import { expect, test } from '@playwright/test'

async function installDesktopApi(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
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

    ;(window as unknown as { aiDevFlowDesktop: unknown }).aiDevFlowDesktop = {
      platform: 'e2e',
      loadState: async () => ({
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
      uploadRunSummary: async () => ({
        accepted: true,
        syncedAt: '2026-06-16T00:00:00.000Z',
        message: 'run summary accepted',
      }),
      uploadTestEvidenceSummary: async () => ({
        accepted: true,
        syncedAt: '2026-06-16T00:00:00.000Z',
        message: 'test evidence summary accepted',
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
          edges: [],
        }
      },
      completeWorkflowAgentNode: async (input: {
        runId: string
        nodeId: string
        userName: string
      }) => {
        const timestamp = '2026-06-21T16:05:00.000Z'
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
        const artifact = {
          id: `artifact-${input.runId}-clarification`,
          runId: input.runId,
          nodeId: input.nodeId,
          kind: 'clarification',
          title: '需求澄清结果',
          summary: 'Clarified scope for the requested change.',
          content: '# 需求澄清结果\n\n## Acceptance Criteria\n- The request is ready for 方案评审 Gate review.',
          redacted: false,
          updatedAt: timestamp,
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
          projectId: 'p-payments',
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
              artifactIds: [rawRequestArtifact.id, artifact.id],
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
          edges: [],
        }

        return {
          run,
          artifact,
          event,
          state: {
            projects: [localProject],
            runs: [run],
            artifacts: [rawRequestArtifact, artifact],
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
      saveRun: async (run: unknown) => run,
      saveArtifact: async (artifact: unknown) => artifact,
      approveGate: async ({
        runId,
        nodeId,
        userName,
      }: {
        runId: string
        nodeId: string
        userName: string
      }) => {
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
          message: `${userName} Gate approved`,
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
          id: 'fake-knowledge-review',
          name: 'Deterministic Fake Provider',
          kind: 'fake',
          model: 'fake',
          enabled: true,
          updatedAt: '1970-01-01T00:00:00.000Z',
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
          providerId: providerId ?? 'fake-knowledge-review',
          model: 'fake',
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

        return {
          review,
          trace,
          tokenUsage,
          state: {
            projects: [localProject],
            runs: [],
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
      runCodingAgent: async ({
        runId,
        nodeId,
        projectId,
        requestedBy,
        providerId,
      }: {
        runId: string
        nodeId: string
        projectId: string
        requestedBy: string
        providerId: string
        userInstruction: string
      }) => {
        const startedAt = '2026-06-15T00:05:00.000Z'
        const codingRun = {
          id: 'coding-run-1',
          runId,
          nodeId,
          projectId,
          requestedBy,
          providerId,
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
      }) => ({
        id: requestId,
        codingRunId,
        status: decision === 'approved' ? 'approved' : 'rejected',
      }),
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
      uploadCodingAgentSummary: async () => ({
        accepted: true,
        syncedAt: '2026-06-16T00:00:00.000Z',
        message: 'coding agent summary accepted',
      }),
      onCodingRunStatusUpdated: () => () => undefined,
      onCodingEventAppended: () => () => undefined,
      onCodingPermissionUpdated: () => () => undefined,
    }
  })
}

test.describe('AI DevFlow desktop workbench', () => {
  test('loads the workbench and supports core developer interactions', async ({ page }) => {
    await installDesktopApi(page)
    await page.goto('/')

    await expect(page).toHaveTitle(/AI DevFlow Studio/)
    await expect(page.getByTestId('runtime-source-badge')).toContainText('seed fallback')
    await expect(page.getByTestId('runtime-source-badge')).toContainText('fixture fallback')
    await expect(page.getByText('开发者工作台')).toBeVisible()
    await expect(page.getByTestId('workflow-canvas')).toBeVisible()
    await expect(page.getByTestId('workflow-canvas')).toContainText('Team policy 插入')
    await expect(page.getByTestId('workflow-canvas')).toContainText('ART')
    await expect(page.getByTestId('inspector-status-matrix')).toContainText('Policy snapshot')
    await expect(page.getByTestId('node-inspector')).toContainText('方案评审 Gate')

    await page.getByTestId('theme-toggle').click()
    await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'light')

    await page.getByRole('button', { name: /通过 Gate/ }).click()
    await expect(page.getByTestId('toast')).toContainText('方案评审 Gate 已通过')

    await page.getByRole('button', { name: /新建 Run/ }).click()
    await expect(page.getByRole('dialog', { name: /Create new run/ })).toBeVisible()
    await page.getByRole('button', { name: /创建并开始澄清/ }).click()
    await expect(page.locator('.run-list').getByText('重构 GitHub webhook 重试策略', { exact: true })).toBeVisible()
    await expect(page.getByTestId('toast')).toContainText('新 Run 已创建')

    await page.getByRole('button', { name: /选择本地仓库/ }).click()
    await expect(page.locator('.local-project-panel').getByText('fixture-project', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /^测试$/ }).click()
    await page.getByLabel('测试命令').fill('pnpm test -- --run')
    await page.getByRole('button', { name: /保存测试命令/ }).click()
    await expect(page.getByTestId('toast')).toContainText('测试命令已保存')

    await page.getByRole('button', { name: /工作台/ }).click()
    await page.getByRole('button', { name: /执行测试/ }).click()
    await expect(page.getByTestId('tests-view')).toContainText('来自 Workbench Inspector')
    await expect(page.getByTestId('tests-view')).toContainText('执行本地测试并生成 Test Evidence')
    await page.getByRole('button', { name: /返回当前 Inspector/ }).click()
    await expect(page.getByTestId('node-inspector')).toBeVisible()

    await page.getByLabel('Search runs and knowledge').fill('nothing matches this')
    await expect(page.getByTestId('search-results')).toContainText('没有匹配结果')
    await expect(page.getByText('没有匹配的 Run')).toBeVisible()
    await page.getByLabel('Search runs and knowledge').fill('health endpoint')
    await expect(page.getByTestId('search-results')).toContainText('API Health Endpoint Standard')
    await expect(page.locator('.run-list').getByText('为 Payments API 增加 /health 端点', { exact: true })).toBeVisible()

    await page.getByLabel('Search runs and knowledge').fill('healthService.check')
    await page.getByTestId('search-results').getByRole('button', { name: /方案设计/ }).click()
    await expect(page.getByTestId('focused-artifact')).toContainText('healthService.check')

    await page.getByLabel('Search runs and knowledge').fill('degraded 状态定义')
    await page.getByTestId('search-results').getByRole('button', { name: /thinking/ }).click()
    await expect(page.getByTestId('focused-event')).toContainText('degraded 状态定义')
  })

  test('supports manager, knowledge, skill, MCP, and test views', async ({ page }) => {
    await installDesktopApi(page)
    await page.goto('/')

    await page.getByRole('button', { name: /Agent Review/ }).click()
    await expect(page.getByTestId('agent-workbench')).toContainText('来自 Workbench Inspector')
    await expect(page.getByTestId('agent-workbench')).toContainText('运行 Knowledge Review 并补齐 Gate Advisory')
    await page.getByRole('button', { name: /Run Knowledge Review/ }).click()
    await expect(page.getByTestId('toast')).toContainText('Knowledge Review 已归档')
    await expect(page.getByTestId('agent-workbench')).toContainText('warning-only')
    await expect(page.getByTestId('agent-workbench')).toContainText('Build redacted context')
    await page.getByRole('button', { name: /返回当前 Inspector/ }).click()
    await expect(page.getByTestId('node-inspector')).toContainText('Knowledge Review Agent')

    await page.getByRole('button', { name: /查看引用来源/ }).first().click()
    await expect(page.getByTestId('knowledge-view')).toContainText('来自 Workbench Inspector')
    await expect(page.getByTestId('focused-knowledge-document')).toContainText('API Health Endpoint Standard')
    await page.getByRole('button', { name: /返回当前 Inspector/ }).click()
    await expect(page.getByTestId('node-inspector')).toContainText('Knowledge Governance')

    await page.getByLabel('Search runs and knowledge').fill('missing knowledge node')
    await page.getByRole('button', { name: /Team Overview/ }).click()
    await expect(page.getByTestId('team-overview')).toContainText('项目交付健康')
    await expect(page.getByTestId('team-overview').getByText('Payments API', { exact: true }).first()).toBeVisible()

    await page.getByRole('button', { name: /Knowledge/ }).click()
    await expect(page.getByTestId('knowledge-view')).toContainText('Knowledge Governance')
    await expect(page.getByTestId('knowledge-view')).toContainText('Git Markdown Index')
    await expect(page.getByTestId('knowledge-view')).toContainText('轻量知识图谱')
    await expect(page.getByText('没有匹配的知识节点')).toBeVisible()
    await page.getByLabel('Search runs and knowledge').fill('')
    await expect(page.getByTestId('knowledge-view')).toContainText('API Health Endpoint Standard')
    await expect(page.getByTestId('knowledge-view')).toContainText('docs/knowledge/standards/api-health.md')
    await expect(page.getByTestId('knowledge-view')).toContainText('Run references')
    await expect(page.getByTestId('knowledge-view')).toContainText('artifact')
    await expect(page.getByTestId('knowledge-view')).toContainText('lexical')
    await expect(page.getByTestId('knowledge-view')).toContainText(/kh-[a-f0-9]{8}/)
    await page.getByLabel('Search runs and knowledge').fill('API Health Endpoint Standard')
    await page.getByTestId('search-results').getByRole('button', { name: /API Health Endpoint Standard/ }).first().click()
    await expect(page.getByTestId('focused-knowledge-document')).toContainText('API Health Endpoint Standard')
    await page.getByLabel('Search runs and knowledge').fill('')

    await page.getByRole('button', { name: /^Agents$/ }).click()
    await expect(page.getByTestId('agent-workbench')).toContainText('Knowledge Review Agent')
    await expect(page.getByTestId('agent-workbench')).toContainText('Deterministic Fake Provider')
    await expect(page.getByTestId('agent-workbench')).toContainText('warning-only')
    await expect(page.getByTestId('agent-workbench')).toContainText('Build redacted context')

    await page.getByRole('button', { name: /^Skills$/ }).click()
    await expect(page.getByTestId('skill-view')).toContainText('团队能力目录')
    await expect(page.getByText('方案评审')).toBeVisible()

    await page.getByRole('button', { name: /^MCP$/ }).click()
    await expect(page.getByTestId('mcp-view')).toContainText('本机工具连接器')
    await page.getByRole('button', { name: /Disable/ }).first().click()
    await expect(page.getByRole('button', { name: /Enable/ }).first()).toBeVisible()

    await page.getByRole('button', { name: /^测试$/ }).click()
    await expect(page.getByTestId('tests-view')).toContainText('测试计划与证据')
    await page.getByRole('button', { name: /执行测试/ }).click()
    await expect(page.getByTestId('toast')).toContainText('测试通过，证据已归档')
    await expect(page.getByTestId('tests-view')).toContainText('Local test evidence')
    await page.getByRole('button', { name: /工作台/ }).click()
    await expect(page.getByTestId('node-inspector')).toContainText('Local Test Evidence Standard')
    await expect(page.getByTestId('node-inspector')).toContainText('satisfied')
  })
})
