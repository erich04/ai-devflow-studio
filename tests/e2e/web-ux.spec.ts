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
    await page.getByRole('link', { name: '团队总览', exact: true }).click()
    await expect(page.getByRole('combobox', { name: '颜色主题' })).toHaveValue('dark')
    await page.getByRole('button', { name: '退出登录' }).click()
    await expect(page).toHaveURL(`${webUrl}/`)
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  })

  test('a real server action previews and saves policy, and Studio shows the authoritative snapshot', async ({ page, context }) => {
    await signIn(context)
    await page.goto(`${webUrl}/?projectId=p-payments&view=settings&section=policy`)
    const policy = page.locator('#team-policy')
    await expect(policy.getByRole('table').locator('tbody tr')).toHaveCount(10)
    await policy.getByRole('button', { name: '使用 Recommended 预设' }).click()
    await policy.getByRole('button', { name: '预览变更' }).click()
    const preview = policy.getByRole('region', { name: 'Policy 变更预览' })
    await expect(preview).toContainText('warn → block')
    await preview.getByRole('button', { name: '确认保存' }).click()
    await expect(policy.getByRole('status')).toContainText('已读取云端策略 v2')
    await expect(policy).toContainText('Team 已保存')
    const confirmed = await policy.locator('time').getAttribute('datetime')
    await page.reload()
    await expect(policy.locator('time')).toHaveAttribute('datetime', confirmed!)
    await expect(policy.getByLabel('规则 1 动作', { exact: true })).toHaveValue('block')
    await page.getByRole('link', { name: '工作台', exact: true }).click()
    await expect(page.locator('#policy')).toContainText('Recommended enforcement preset')
    await expect(page.locator('#policy')).toContainText('v2')
  })

  for (const width of [1440, 760, 390]) {
    test(`Studio creates and selects a project, then submits a request at ${width}px`, async ({ page, context }, testInfo) => {
      await signIn(context)
      await page.setViewportSize({ width, height: 900 })
      await page.goto(webUrl)
      await expect(page.locator('a[href^="/legacy-shell"]')).toHaveCount(0)
      const trigger = page.getByRole('button', { name: '创建团队项目' })
      await trigger.click()
      const dialog = page.getByRole('dialog', { name: '创建团队项目' })
      await expect(dialog).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(dialog).not.toBeVisible()
      await expect(trigger).toBeFocused()
      await trigger.click()
      const slug = `studio-${width}-${Date.now()}`
      await dialog.getByLabel('Name', { exact: true }).fill(`Studio ${width}`)
      await dialog.getByLabel('Slug', { exact: true }).fill(slug)
      await dialog.getByLabel('Repository', { exact: true }).fill('fixture/mini-agent')
      await dialog.getByLabel('Description', { exact: true }).fill('Verify project creation and one small request in Studio.')
      for (const theme of ['light', 'dark']) {
        await page.evaluate((theme) => document.documentElement.dataset.theme = theme, theme)
        await testInfo.attach(`project-dialog-${width}-${theme}`, { body: await dialog.screenshot(), contentType: 'image/png' })
      }
      await dialog.getByRole('button', { name: 'Create project', exact: true }).click()
      await expect(page).toHaveURL(`${webUrl}/?projectId=p-${slug}`)
      await expect(page.getByRole('region', { name: `Desktop pairing for Studio ${width}` })).toBeVisible()
      await expect(page.getByRole('region', { name: 'GitHub Delivery', exact: true })).toBeVisible()
      await page.getByLabel('Work Request title').fill('Change the README heading')
      await page.getByLabel('Work Request details').fill('Change the README heading to Mini Agent Ready and preserve the remaining content.')
      await page.getByRole('button', { name: 'Create Work Request', exact: true }).click()
      await expect(page.getByText('Work Request created. A paired Desktop can now claim it.')).toBeVisible()
      await page.getByRole('link', { name: '设置', exact: true }).click()
      await expect(page.getByRole('heading', { name: `项目预算 · Studio ${width}` })).toBeVisible()
      await page.getByRole('link', { name: 'Policy', exact: true }).click()
      const policy = page.locator('#team-policy')
      await expect(policy.getByRole('table').locator('tbody tr')).toHaveCount(10)
      for (const theme of ['light', 'dark']) {
        await page.getByRole('combobox', { name: '颜色主题' }).selectOption(theme)
        expect(await page.locator('html').evaluate((element) => element.scrollWidth <= window.innerWidth)).toBe(true)
        await testInfo.attach(`policy-${width}-${theme}`, { body: await policy.screenshot(), contentType: 'image/png' })
      }
      await page.reload()
      await expect(page.getByRole('navigation', { name: 'Select project' }).getByRole('link', { name: new RegExp(`Studio ${width}`) })).toHaveAttribute('aria-current', 'page')
    })
  }

  test('members see all rules but cannot create projects or edit policy', async ({ page, context }) => {
    await signIn(context, 'u-wang')
    await page.goto(`${webUrl}/?projectId=p-payments&view=settings&section=policy`)
    await expect(page.getByRole('button', { name: '创建团队项目' })).toHaveCount(0)
    await expect(page.getByRole('table', { name: 'Team Policy 规则' }).locator('tbody tr')).toHaveCount(10)
    await expect(page.getByRole('button', { name: '预览变更' })).toHaveCount(0)
    await expect(page.getByText('当前为只读模式，只有组织 Owner 可以修改 Team Policy。')).toBeVisible()
  })
})
