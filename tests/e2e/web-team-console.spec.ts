import { expect, test } from '@playwright/test'

const apiUrl = process.env.DEVFLOW_E2E_API_URL ?? 'http://127.0.0.1:4310'
const webUrl = process.env.DEVFLOW_E2E_WEB_URL ?? 'http://127.0.0.1:4311'
const teamHeaders = {
  'x-devflow-session-source': 'demo',
  'x-devflow-organization-id': 'org-demo',
  'x-devflow-user-id': 'u-ling',
  'x-devflow-user-role': 'lead',
  'x-devflow-project-roles': 'p-payments:lead',
}

test.describe('AI DevFlow web team console', () => {
  test('shows synced run and redacted test evidence uploaded through the team API', async ({
    page,
    request,
  }) => {
    const suffix = Date.now()
    const runId = `run-e2e-${suffix}`
    const runTitle = `E2E synced team run ${suffix}`
    const evidenceSummary = `E2E tests passed ${suffix}`
    const reviewConclusion = `E2E Gate Review completed ${suffix}`
    const reviewSummary = `E2E warning-only advisory ${suffix}`

    const runResponse = await request.post(`${apiUrl}/api/sync/run-summary`, {
      headers: teamHeaders,
      data: {
        kind: 'run',
        runId,
        version: 1,
        projectId: 'p-payments',
        title: runTitle,
        status: 'building',
        currentNodeId: 'n-build',
        currentNode: { id: 'n-build', stage: 'build', kind: 'task', status: 'running' },
        branchName: `ai/e2e-team-sync-${suffix}`,
        updatedAt: '2026-06-16T12:00:00.000Z',
      },
    })
    expect(runResponse.status()).toBe(202)

    const evidenceResponse = await request.post(`${apiUrl}/api/sync/test-evidence-summary`, {
      headers: teamHeaders,
      data: {
        id: `evidence-e2e-${suffix}`,
        runId,
        nodeId: 'n-test',
        projectId: 'p-payments',
        command: 'pnpm test -- --run',
        status: 'passed',
        exitCode: 0,
        durationMs: 900,
        summary: evidenceSummary,
        redacted: true,
        createdAt: '2026-06-16T12:01:00.000Z',
      },
    })
    expect(evidenceResponse.status()).toBe(202)

    const agentReviewResponse = await request.post(`${apiUrl}/api/sync/agent-review-summary`, {
      headers: teamHeaders,
      data: {
        id: `agent-review-e2e-${suffix}`,
        runId,
        nodeId: 'n-build',
        projectId: 'p-payments',
        runtime: 'electron',
        providerId: 'fake-knowledge-review',
        model: 'fake',
        conclusion: reviewConclusion,
        summary: reviewSummary,
        riskCount: 1,
        missingEvidenceCount: 1,
        advisoryLevel: 'warn',
        blocksApproval: false,
        confidence: 0.82,
        redacted: true,
        createdAt: '2026-06-16T12:02:00.000Z',
      },
    })
    expect(agentReviewResponse.status()).toBe(202)

    const selectedRunUrl = new URL(webUrl)
    selectedRunUrl.searchParams.set('projectId', 'p-payments')
    selectedRunUrl.searchParams.set('runId', runId)
    await page.goto(selectedRunUrl.toString())

    // Plan S5, Q3: the task detail sections are named in Chinese.
    await expect(page.getByRole('region', { name: '进度与材料' })).toBeVisible()
    await expect(page.getByRole('region', { name: '审批', exact: true })).toContainText('当前没有待审批的步骤')
    await expect(page.getByRole('region', { name: '测试证据' })).toBeVisible()
    await expect(page.getByRole('region', { name: '门禁审查' })).toContainText(reviewSummary)
    await expect(page.getByRole('heading', { name: runTitle, exact: true })).toBeVisible()
    await expect(page.getByText(evidenceSummary)).toBeVisible()
    await expect(page.locator('body')).toContainText(reviewSummary)
    await expect(page.locator('body')).toContainText('warning-only')
    await expect(page.getByText('pnpm test -- --run').first()).toBeVisible()
    await expect(page.locator('body')).not.toContainText('stdout')
    await expect(page.locator('body')).not.toContainText('stderr')
    await expect(page.locator('body')).not.toContainText('cwd')
    await expect(page.locator('body')).not.toContainText('prompt')
    await expect(page.locator('body')).not.toContainText('sk-test-provider-secret')
  })
})
