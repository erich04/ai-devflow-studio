import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { createSessionCookie } from '../../apps/api/src/auth/session-cookie'

/**
 * Web screenshots for the README and guides (plan S6, R3). Runs only with
 * DEVFLOW_CAPTURE_DOC_SCREENSHOTS=1 inside the isolated e2e runner (in-memory API with demo
 * data, ephemeral session key); it never runs in the normal e2e suite.
 *
 *   DEVFLOW_CAPTURE_DOC_SCREENSHOTS=1 corepack pnpm test:e2e tests/e2e/doc-screenshots.spec.ts
 */
const apiUrl = process.env.DEVFLOW_E2E_API_URL!
const webUrl = process.env.DEVFLOW_E2E_WEB_URL!
const fixtureSecret = process.env.DEVFLOW_E2E_SESSION_SECRET
const outDir = path.resolve('docs/guides/screenshots/workspace-redesign-20260928/web')
const teamHeaders = {
  'x-devflow-session-source': 'demo',
  'x-devflow-organization-id': 'org-demo',
  'x-devflow-user-id': 'u-ling',
  'x-devflow-user-role': 'lead',
  'x-devflow-project-roles': 'p-payments:lead',
}

async function shot(page: Page, name: string, fullPage = false) {
  await page.waitForLoadState('networkidle')
  expect(await page.locator('html').evaluate((element) => element.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage })
}

test('capture Web documentation screenshots', async ({ page, context, request }) => {
  test.skip(process.env.DEVFLOW_CAPTURE_DOC_SCREENSHOTS !== '1' || !fixtureSecret, 'Opt-in documentation capture')
  mkdirSync(outDir, { recursive: true })
  const suffix = Date.now()
  const runId = `run-doc-design-${suffix}`
  // A task paused at its design Gate, uploaded with the material snapshot the desktop sends.
  const upload = await request.post(`${apiUrl}/api/sync/run-summary`, {
    headers: teamHeaders,
    data: {
      kind: 'run', runId, version: 3, projectId: 'p-payments', title: 'Health API 增加依赖探测',
      status: 'paused_at_gate', currentNodeId: 'n-design-gate',
      currentNode: { id: 'n-design-gate', stage: 'design', kind: 'gate', status: 'blocked', requiredRole: 'lead' },
      branchName: `ai/${runId}`, updatedAt: new Date().toISOString(),
      gateReviewSubject: {
        version: 1, runId, runVersion: 3, nodeId: 'n-design-gate', stage: 'design', sanitizerVersion: 'sensitive-text-v1',
        requestDigest: 'a'.repeat(64),
        artifacts: [{ id: `artifact-${runId}-design`, nodeId: 'n-design', kind: 'design', updatedAt: new Date().toISOString(), contentDigest: 'b'.repeat(64) }],
      },
    },
  })
  expect(upload.status()).toBe(202)
  const evidence = await request.post(`${apiUrl}/api/sync/test-evidence-summary`, {
    headers: teamHeaders,
    data: {
      id: `evidence-doc-${suffix}`, runId, nodeId: 'n-test', projectId: 'p-payments', command: 'npm test',
      status: 'passed', exitCode: 0, durationMs: 1200, summary: '14 项测试通过（脱敏摘要）', redacted: true,
      createdAt: new Date().toISOString(),
    },
  })
  expect(evidence.status()).toBe(202)

  const cookie = createSessionCookie({ authAccountId: 'acct-demo-u-erich' }, fixtureSecret!)
  await context.addCookies([{ name: 'devflow_session', value: cookie.split(';')[0]!.split('=')[1]!, url: webUrl }])
  await page.setViewportSize({ width: 1440, height: 900 })

  await page.goto(`${webUrl}/?projectId=p-payments`)
  await expect(page.getByRole('heading', { level: 1, name: '我的待办' })).toBeVisible()
  await shot(page, 'web-todo')

  await page.goto(`${webUrl}/?projectId=p-payments&runId=${runId}`)
  await expect(page.getByRole('region', { name: '审批', exact: true })).toBeVisible()
  await shot(page, 'web-task-detail')
  await shot(page, 'web-task-detail-full', true)

  await page.goto(`${webUrl}/?projectId=p-payments&view=tasks`)
  await expect(page.getByRole('heading', { level: 1, name: '项目任务' })).toBeVisible()
  await shot(page, 'web-project-tasks')

  await page.goto(`${webUrl}/?projectId=p-payments&view=team`)
  await shot(page, 'web-team')

  for (const section of ['budget', 'policy', 'desktop', 'github']) {
    await page.goto(`${webUrl}/?projectId=p-payments&view=settings&section=${section}`)
    await shot(page, `web-settings-${section}`)
  }

  await page.emulateMedia({ colorScheme: 'dark' })
  await page.getByRole('combobox', { name: '颜色主题' }).selectOption('dark')
  await page.goto(`${webUrl}/?projectId=p-payments&runId=${runId}`)
  await shot(page, 'web-task-detail-dark')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('combobox', { name: '颜色主题' }).selectOption('light')
  await page.goto(`${webUrl}/?projectId=p-payments`)
  await shot(page, 'web-todo-390', true)
})
