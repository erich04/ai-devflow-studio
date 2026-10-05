import { expect, test } from '@playwright/test'
import { createSessionCookie } from '../../apps/api/src/auth/session-cookie'

const apiUrl = process.env.DEVFLOW_E2E_API_URL!
const webUrl = process.env.DEVFLOW_E2E_WEB_URL!
const secret = process.env.DEVFLOW_E2E_SESSION_SECRET

test('budget page reconciles isolated recorded costs and surfaces late conflicts without running a model', async ({ page, context, request }) => {
  test.skip(!secret || process.env.DEVFLOW_ENABLE_DEMO_DATA !== 'true', 'Requires isolated deterministic E2E runner')
  const cookie = createSessionCookie({ authAccountId: 'acct-demo-u-erich' }, secret!).split(';')[0]!
  await context.addCookies([{ name: 'devflow_session', value: cookie.slice('devflow_session='.length), url: webUrl }])
  const headers = { cookie }, slug = `cost-recovery-${Date.now()}`, projectId = `p-${slug}`, id = `model-call-${slug}`
  expect((await request.post(`${apiUrl}/api/team/projects`, { headers, data: { name: 'Cost recovery fixture', slug, description: 'Deterministic costs only', repository: 'fixture/mini-agent' } })).ok()).toBe(true)
  const policy = (enabled: boolean) => request.put(`${apiUrl}/api/runtime/budget-policy`, { headers, data: { projectId, enabled, monthlyLimitUsd: 1, warningThresholdUsd: 0.8 } })
  expect((await policy(false)).ok()).toBe(true)
  const quote = { id, projectId, providerId: 'deepseek', model: 'deepseek-flash', createdAt: new Date().toISOString(), billingProvider: 'deepseek', inputTokens: 100, maxOutputTokens: 100 }
  expect((await (await request.post(`${apiUrl}/api/runtime/model-calls/reserve`, { headers, data: quote })).json()).accepted).toBe(true)
  expect((await request.post(`${apiUrl}/api/runtime/model-calls/settle`, { headers, data: { id, projectId, state: 'failed' } })).ok()).toBe(true)
  expect((await policy(true)).ok()).toBe(true)
  const blocked = await (await request.post(`${apiUrl}/api/runtime/model-calls/reserve`, { headers, data: { ...quote, id: `${id}-blocked` } })).json()
  expect(blocked.accepted).toBe(false)
  await page.goto(`${webUrl}/?projectId=${projectId}&view=settings&section=budget`)
  const recovery = page.getByRole('region', { name: '费用核对与恢复' })
  await expect(recovery).toContainText('实际费用待确认 1 笔')
  await recovery.getByRole('button', { name: '核对费用' }).click()
  await recovery.getByLabel('核定金额（USD）').fill('0.25')
  await recovery.getByLabel('执行状态依据').selectOption('ended')
  await recovery.getByLabel('核对原因').fill('确定性账单夹具核对')
  await recovery.getByLabel('非敏感依据').fill('Fixture invoice INV-123 confirms finished call')
  await recovery.getByRole('button', { name: '保存费用核对' }).click()
  await expect(recovery).toContainText('实际费用待确认 0 笔')
  await expect(recovery).toContainText('已确认花费 $0.25')
  await expect(recovery).toContainText('Token 仍未知')
  await page.reload()
  await expect(recovery).toContainText('有效费用 $0.25')
  const late = { id, projectId, state: 'completed', usage: { inputTokens: 200, outputTokens: 20, cacheReadTokens: 0, cacheMissTokens: 200, cacheStatus: 'complete' as const } }
  const receipt = await (await request.post(`${apiUrl}/api/runtime/model-calls/settle`, { headers, data: late })).json()
  expect(receipt.status).toBe('conflict_recorded')
  expect(await (await request.post(`${apiUrl}/api/runtime/model-calls/settle`, { headers, data: late })).json()).toEqual(receipt)
  await page.reload()
  await expect(recovery).toContainText('迟到结算冲突')
  await expect(recovery).toContainText('实际费用待确认 1 笔')
  await recovery.getByText('核对与冲突记录（2）').click()
  await expect(recovery).toContainText('输入 200 / 输出 20 Token')
  const overview = await (await request.get(`${apiUrl}/api/team/overview`, { headers })).json()
  expect(overview.runs.filter((run: { projectId: string }) => run.projectId === projectId)).toEqual([])
})
