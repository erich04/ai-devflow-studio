import { expect, test } from '@playwright/test'

const apiUrl = 'http://127.0.0.1:4310'
const webUrl = 'http://127.0.0.1:4311'
const teamHeaders = {
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
    const runTitle = `E2E synced team run ${suffix}`
    const evidenceSummary = `E2E tests passed ${suffix}`

    const runResponse = await request.post(`${apiUrl}/api/sync/run-summary`, {
      headers: teamHeaders,
      data: {
        kind: 'approval',
        runId: `run-e2e-${suffix}`,
        projectId: 'p-payments',
        title: runTitle,
        status: 'building',
        currentNodeId: 'n-build',
        branchName: `ai/e2e-team-sync-${suffix}`,
        updatedAt: '2026-06-16T12:00:00.000Z',
      },
    })
    expect(runResponse.status()).toBe(202)

    const evidenceResponse = await request.post(`${apiUrl}/api/sync/test-evidence-summary`, {
      headers: teamHeaders,
      data: {
        id: `evidence-e2e-${suffix}`,
        runId: `run-e2e-${suffix}`,
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

    await page.goto(webUrl)

    await expect(page.getByText('Recent Runs')).toBeVisible()
    await expect(page.getByText('Test Evidence')).toBeVisible()
    await expect(page.getByText(runTitle)).toBeVisible()
    await expect(page.getByText(evidenceSummary)).toBeVisible()
    await expect(page.getByText('pnpm test -- --run')).toBeVisible()
    await expect(page.locator('body')).not.toContainText('stdout')
    await expect(page.locator('body')).not.toContainText('stderr')
  })
})
