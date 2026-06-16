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
      createRun: async (run: unknown) => run,
      saveRun: async (run: unknown) => run,
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
          },
        }
      },
    }
  })
}

test.describe('AI DevFlow desktop workbench', () => {
  test('loads the workbench and supports core developer interactions', async ({ page }) => {
    await installDesktopApi(page)
    await page.goto('/')

    await expect(page).toHaveTitle(/AI DevFlow Studio/)
    await expect(page.getByText('开发者工作台')).toBeVisible()
    await expect(page.getByTestId('workflow-canvas')).toBeVisible()
    await expect(page.getByTestId('node-inspector')).toContainText('架构 Gate')

    await page.getByTestId('theme-toggle').click()
    await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'light')

    await page.getByRole('button', { name: /通过 Gate/ }).click()
    await expect(page.getByTestId('toast')).toContainText('架构 Gate 已通过')

    await page.getByRole('button', { name: /新建 Run/ }).click()
    await expect(page.getByRole('dialog', { name: /Create new run/ })).toBeVisible()
    await page.getByRole('button', { name: /创建并开始澄清/ }).click()
    await expect(page.getByText('重构 GitHub webhook 重试策略')).toBeVisible()
    await expect(page.getByTestId('toast')).toContainText('新 Run 已创建')

    await page.getByRole('button', { name: /选择本地仓库/ }).click()
    await expect(page.locator('.local-project-panel').getByText('fixture-project', { exact: true })).toBeVisible()
    await page.getByLabel('测试命令').fill('pnpm test -- --run')
    await page.getByRole('button', { name: /保存测试命令/ }).click()
    await expect(page.getByTestId('toast')).toContainText('测试命令已保存')

    await page.getByLabel('Search runs and knowledge').fill('nothing matches this')
    await expect(page.getByText('没有匹配的 Run')).toBeVisible()
    await page.getByLabel('Search runs and knowledge').fill('health endpoint')
    await expect(page.getByText('为 Payments API 增加 /health 端点')).toBeVisible()
  })

  test('supports manager, knowledge, skill, MCP, and test views', async ({ page }) => {
    await installDesktopApi(page)
    await page.goto('/')

    await page.getByLabel('Search runs and knowledge').fill('missing knowledge node')
    await page.getByRole('button', { name: /Team Overview/ }).click()
    await expect(page.getByTestId('team-overview')).toContainText('项目交付健康')
    await expect(page.getByTestId('team-overview').getByText('Payments API')).toBeVisible()

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

    await page.getByRole('button', { name: /^Skills$/ }).click()
    await expect(page.getByTestId('skill-view')).toContainText('团队能力目录')
    await expect(page.getByText('方案评审')).toBeVisible()

    await page.getByRole('button', { name: /^MCP$/ }).click()
    await expect(page.getByTestId('mcp-view')).toContainText('本机工具连接器')
    await page.getByRole('button', { name: /Disable/ }).first().click()
    await expect(page.getByRole('button', { name: /Enable/ }).first()).toBeVisible()

    await page.getByRole('button', { name: /^测试$/ }).click()
    await expect(page.getByTestId('tests-view')).toContainText('测试计划与证据')
    await page.getByRole('button', { name: /执行本地测试/ }).click()
    await expect(page.getByTestId('toast')).toContainText('测试通过，证据已归档')
    await expect(page.getByTestId('tests-view')).toContainText('Local test evidence')
  })
})
