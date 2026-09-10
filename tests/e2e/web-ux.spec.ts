import { expect, test, type BrowserContext } from '@playwright/test'
import { createSessionCookie } from '../../apps/api/src/auth/session-cookie'

const apiUrl = process.env.DEVFLOW_E2E_API_URL!
const webUrl = process.env.DEVFLOW_E2E_WEB_URL!
const fixtureSecret = process.env.DEVFLOW_E2E_SESSION_SECRET

test.describe('Web UX in the isolated seed API', () => {
  test.skip(!fixtureSecret || process.env.DEVFLOW_ENABLE_DEMO_DATA !== 'true', 'Requires the isolated E2E runner and its ephemeral session key')

  async function signIn(context: BrowserContext, user = 'u-erich') {
    const cookie = createSessionCookie({ authAccountId: `acct-demo-${user}` }, fixtureSecret!)
    await context.addCookies([{ name: 'devflow_session', value: cookie.split(';')[0]!.split('=')[1]!, url: webUrl }])
  }

  for (const width of [1440, 1920, 2560, 1120, 760, 390]) {
    test(`request and pairing layouts at ${width}px in both themes`, async ({ page, context, request }, testInfo) => {
      await signIn(context)
      const slug = `ux-${width}-${Date.now()}`
      const creation = await request.post(`${apiUrl}/api/team/projects`, {
        headers: { cookie: createSessionCookie({ authAccountId: 'acct-demo-u-erich' }, fixtureSecret!).split(';')[0]! },
        data: { name: `UX ${width}`, slug, description: 'Isolated Web regression.', repository: 'fixture/mini-agent' },
      })
      expect(creation.ok()).toBe(true)
      const projectId = `p-${slug}`
      // Only this visual fixture replaces issuance: screenshots never contain a live pairing secret.
      await page.route('**/api/pairing-code', async (route) => route.fulfill({
        json: route.request().method() === 'DELETE' ? { revoked: true } : {
          id: `pair-${slug}`, organizationId: 'org-demo', projectId, createdByUserId: 'u-erich', issuedRole: 'lead',
          code: `${projectId}.fixture-pairing-code-for-layout-only`, attemptsRemaining: 5,
          createdAt: '2026-09-10T12:00:00Z', expiresAt: '2026-09-10T12:10:00Z',
        },
      }))
      await page.setViewportSize({ width, height: 936 })
      await page.goto(`${webUrl}/?projectId=${projectId}`)
      await page.getByRole('button', { name: 'Create desktop pairing code' }).click()
      const code = page.getByLabel(`Desktop pairing code for ${projectId}`)
      await expect(code).toBeVisible()
      const copy = page.getByRole('button', { name: '复制配对码' })
      const codeBounds = (await code.boundingBox())!
      const copyBounds = (await copy.boundingBox())!
      expect(codeBounds.width).toBeGreaterThanOrEqual(200)
      expect(copyBounds.y).toBeGreaterThanOrEqual(codeBounds.y + codeBounds.height)
      expect(await page.locator('html').evaluate((element) => element.scrollWidth <= window.innerWidth)).toBe(true)

      for (const theme of ['light', 'dark']) {
        await page.getByRole('combobox', { name: '颜色主题' }).selectOption(theme)
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        const work = page.getByRole('region', { name: 'Work Requests', exact: true })
        const delivery = page.getByRole('region', { name: 'GitHub Delivery', exact: true })
        const workBounds = (await work.boundingBox())!
        const deliveryBounds = (await delivery.boundingBox())!
        expect(Math.abs(workBounds.x - deliveryBounds.x)).toBeLessThan(1)
        expect(Math.abs(workBounds.width - deliveryBounds.width)).toBeLessThan(1)
        expect(workBounds.width).toBeLessThanOrEqual(1320)
        const emptyBounds = (await page.getByText('当前项目还没有工作请求。', { exact: true }).boundingBox())!
        const submitBounds = (await page.getByRole('button', { name: 'Create Work Request', exact: true }).boundingBox())!
        expect(emptyBounds.y).toBeGreaterThanOrEqual(submitBounds.y + submitBounds.height)
        expect(Math.abs(emptyBounds.x - submitBounds.x)).toBeLessThan(1)
        await testInfo.attach(`${width}-${theme}-empty`, { body: await work.screenshot(), contentType: 'image/png' })
        await testInfo.attach(`${width}-${theme}-pairing`, { body: await page.locator('.pairing-code-panel').screenshot(), contentType: 'image/png' })
      }

      await page.getByRole('textbox', { name: 'Work Request title' }).fill('Update the README heading')
      await page.getByRole('textbox', { name: 'Work Request details' }).fill('Change one heading, preserve the rest, and run the configured tests.')
      await page.getByRole('button', { name: 'Create Work Request', exact: true }).click()
      await expect(page.getByText('Work Request created. A paired Desktop can now claim it.')).toBeVisible()
      for (const theme of ['light', 'dark']) {
        await page.getByRole('combobox', { name: '颜色主题' }).selectOption(theme)
        const work = page.getByRole('region', { name: 'Work Requests', exact: true })
        await expect(work.getByRole('article')).toHaveCount(1)
        expect((await page.getByLabel('Work Request title').boundingBox())!.width).toBeGreaterThanOrEqual(260)
        expect(await page.locator('html').evaluate((element) => element.scrollWidth <= window.innerWidth)).toBe(true)
        await testInfo.attach(`${width}-${theme}-populated`, { body: await work.screenshot(), contentType: 'image/png' })
      }
      await page.getByRole('button', { name: '撤销配对码' }).click()
      await expect(code).toHaveCount(0)
    })
  }

  test('theme survives reload, shell navigation, and sign-out, and follows system changes', async ({ page, context }) => {
    await signIn(context)
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.goto(webUrl)
    await expect(page.getByRole('combobox', { name: '颜色主题' })).toHaveValue('system')
    const surface = () => page.locator('.studio-shell').evaluate((element) => getComputedStyle(element).backgroundColor)
    const dark = await surface()
    await page.emulateMedia({ colorScheme: 'light' })
    expect(await surface()).not.toBe(dark)
    await page.getByRole('combobox', { name: '颜色主题' }).selectOption('dark')
    expect(await surface()).toBe(dark)
    await page.reload()
    await expect(page.getByRole('combobox', { name: '颜色主题' })).toHaveValue('dark')
    await page.getByRole('link', { name: '备份壳', exact: true }).click()
    await expect(page.getByRole('combobox', { name: '颜色主题' })).toHaveValue('dark')
    await page.getByRole('button', { name: '退出登录' }).click()
    await expect(page).toHaveURL(`${webUrl}/`)
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  })

  test('a real server action applies policy and both shells immediately show the API snapshot', async ({ page, context }) => {
    await signIn(context)
    await page.goto(`${webUrl}/?projectId=p-payments`)
    const policy = page.locator('#policy')
    await expect(policy.locator('a[href="#policy"]')).toHaveCount(0)
    await policy.getByRole('button', { name: 'Apply recommended enforcement' }).click()
    await expect(policy.getByRole('status')).toHaveText('已读取云端最新策略。')
    await expect(policy.getByRole('button', { name: '推荐策略已应用' })).toBeDisabled()
    await expect(policy).toContainText('4 条')
    const confirmed = await policy.locator('time').getAttribute('datetime')
    await page.getByRole('link', { name: '备份壳', exact: true }).click()
    await expect(page.locator('#policy time')).toHaveAttribute('datetime', confirmed!)
    await expect(page.locator('#policy')).toContainText('4 条')
    await expect(page.locator('#policy').getByRole('button', { name: '推荐策略已应用' })).toBeDisabled()
  })
})
