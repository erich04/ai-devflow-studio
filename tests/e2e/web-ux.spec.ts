import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { createSessionCookie } from '../../apps/api/src/auth/session-cookie'

const apiUrl = process.env.DEVFLOW_E2E_API_URL!
const webUrl = process.env.DEVFLOW_E2E_WEB_URL!
const fixtureSecret = process.env.DEVFLOW_E2E_SESSION_SECRET

/**
 * Fills the team request form once React owns it. On a slow runner the server-rendered inputs
 * can accept text before hydration, which then resets the controlled state and leaves the
 * submit button disabled; refill until the button reflects the input.
 */
async function fillWorkRequest(page: Page, title: string, details: string) {
  const submit = page.getByRole('button', { name: '创建团队请求', exact: true })
  await expect(async () => {
    await page.getByLabel('团队请求标题', { exact: true }).fill(title)
    await page.getByLabel('团队请求需求说明', { exact: true }).fill(details)
    await expect(submit).toBeEnabled({ timeout: 1_000 })
  }).toPass({ timeout: 20_000 })
}

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
          createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        },
      }))
      await page.setViewportSize({ width, height: 936 })
      // Plan S5, Q2: a selected project opens 我的待办; management is not on the first screen.
      await page.goto(`${webUrl}/?projectId=${projectId}`)
      await expect(page.getByRole('heading', { level: 1, name: '我的待办' })).toBeVisible()
      await expect(page.getByText(/团队数据读取于 .* UTC/)).toBeVisible()
      await expect(page.getByRole('button', { name: '生成桌面配对码' })).toHaveCount(0)
      expect(await page.locator('html').evaluate((element) => element.scrollWidth <= window.innerWidth)).toBe(true)

      // Pairing lives in settings (plan S5, Q6).
      await page.goto(`${webUrl}/?projectId=${projectId}&view=settings&section=desktop`)
      await page.getByRole('button', { name: '生成桌面配对码' }).click()
      const code = page.getByLabel(`项目 ${projectId} 的桌面配对码`)
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
        await testInfo.attach(`${width}-${theme}-pairing`, { body: await page.locator('.pairing-code-panel').screenshot(), contentType: 'image/png' })
      }
      await page.getByRole('button', { name: '撤销配对码' }).click()
      await expect(code).toHaveCount(0)

      // Team requests and tasks share one column in 项目任务.
      await page.goto(`${webUrl}/?projectId=${projectId}&view=tasks`)
      for (const theme of ['light', 'dark']) {
        await page.getByRole('combobox', { name: '颜色主题' }).selectOption(theme)
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        const work = page.getByRole('region', { name: '团队请求', exact: true })
        const tasks = page.getByRole('region', { name: '开发任务', exact: true })
        const workBounds = (await work.boundingBox())!
        const taskBounds = (await tasks.boundingBox())!
        expect(Math.abs(workBounds.x - taskBounds.x)).toBeLessThan(1)
        expect(Math.abs(workBounds.width - taskBounds.width)).toBeLessThan(1)
        expect(workBounds.width).toBeLessThanOrEqual(1320)
        const emptyBounds = (await page.getByText('当前项目还没有团队请求。', { exact: true }).boundingBox())!
        const submitBounds = (await page.getByRole('button', { name: '创建团队请求', exact: true }).boundingBox())!
        expect(emptyBounds.y).toBeGreaterThanOrEqual(submitBounds.y + submitBounds.height)
        expect(Math.abs(emptyBounds.x - submitBounds.x)).toBeLessThan(1)
        expect(await page.locator('html').evaluate((element) => element.scrollWidth <= window.innerWidth)).toBe(true)
        await testInfo.attach(`${width}-${theme}-empty`, { body: await work.screenshot(), contentType: 'image/png' })
      }

      await fillWorkRequest(page, 'Update the README heading', 'Change one heading, preserve the rest, and run the configured tests.')
      await page.getByRole('button', { name: '创建团队请求', exact: true }).click()
      await expect(page.getByText('团队请求已创建。已配对的桌面端现在可以领取。')).toBeVisible()
      for (const theme of ['light', 'dark']) {
        await page.getByRole('combobox', { name: '颜色主题' }).selectOption(theme)
        const work = page.getByRole('region', { name: '团队请求', exact: true })
        await expect(work.getByRole('article')).toHaveCount(1)
        await expect(work.getByRole('article')).toContainText('待领取')
        expect((await page.getByLabel('团队请求标题', { exact: true }).boundingBox())!.width).toBeGreaterThanOrEqual(260)
        expect(await page.locator('html').evaluate((element) => element.scrollWidth <= window.innerWidth)).toBe(true)
        await testInfo.attach(`${width}-${theme}-populated`, { body: await work.screenshot(), contentType: 'image/png' })
      }
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
    await page.getByRole('link', { name: '团队', exact: true }).click()
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
    await policy.getByRole('button', { name: '使用推荐预设' }).click()
    await policy.getByRole('button', { name: '预览变更' }).click()
    const preview = policy.getByRole('region', { name: '策略变更预览' })
    await expect(preview).toContainText('warn → block')
    await preview.getByRole('button', { name: '确认保存' }).click()
    await expect(policy.getByRole('status')).toContainText('已读取云端策略 v2')
    await expect(policy).toContainText('已保存到团队')
    const confirmed = await policy.locator('time').getAttribute('datetime')
    await page.reload()
    await expect(policy.locator('time')).toHaveAttribute('datetime', confirmed!)
    await expect(policy.getByLabel('规则 1 动作', { exact: true })).toHaveValue('block')
    // Navigating away and back reads the saved snapshot again (the task page summary is covered by page tests).
    await page.getByRole('link', { name: '我的待办', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: '我的待办' })).toBeVisible()
    await page.getByRole('link', { name: '设置', exact: true }).click()
    await page.getByRole('link', { name: '策略', exact: true }).click()
    await expect(page.locator('#team-policy')).toContainText('v2')
    await expect(page.locator('#team-policy').getByLabel('规则 1 动作', { exact: true })).toHaveValue('block')
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
      await dialog.getByLabel('项目名称', { exact: true }).fill(`Studio ${width}`)
      await dialog.getByLabel('项目标识（Slug）', { exact: true }).fill(slug)
      await dialog.getByLabel('仓库', { exact: true }).fill('fixture/mini-agent')
      await dialog.getByLabel('项目描述', { exact: true }).fill('Verify project creation and one small request in Studio.')
      for (const theme of ['light', 'dark']) {
        await page.evaluate((theme) => document.documentElement.dataset.theme = theme, theme)
        await testInfo.attach(`project-dialog-${width}-${theme}`, { body: await dialog.screenshot(), contentType: 'image/png' })
      }
      await dialog.getByRole('button', { name: '创建项目', exact: true }).click()
      await expect(page).toHaveURL(`${webUrl}/?projectId=p-${slug}`)
      await expect(page.getByRole('heading', { level: 1, name: '我的待办' })).toBeVisible()
      await page.getByRole('link', { name: '项目任务', exact: true }).click()
      await expect(page).toHaveURL(`${webUrl}/?projectId=p-${slug}&view=tasks`)
      await page.waitForLoadState('load')
      await expect(page.getByRole('heading', { level: 1, name: '项目任务' })).toBeVisible()
      await fillWorkRequest(page, 'Change the README heading', 'Change the README heading to Mini Agent Ready and preserve the remaining content.')
      await page.getByRole('button', { name: '创建团队请求', exact: true }).click()
      await expect(page.getByText('团队请求已创建。已配对的桌面端现在可以领取。')).toBeVisible()
      await page.getByRole('link', { name: '设置', exact: true }).click()
      await expect(page.getByRole('heading', { name: `项目预算 · Studio ${width}` })).toBeVisible()
      await page.getByRole('link', { name: '策略', exact: true }).click()
      const policy = page.locator('#team-policy')
      await expect(policy.getByRole('table').locator('tbody tr')).toHaveCount(10)
      for (const theme of ['light', 'dark']) {
        await page.getByRole('combobox', { name: '颜色主题' }).selectOption(theme)
        expect(await page.locator('html').evaluate((element) => element.scrollWidth <= window.innerWidth)).toBe(true)
        await testInfo.attach(`policy-${width}-${theme}`, { body: await policy.screenshot(), contentType: 'image/png' })
      }
      await page.getByRole('link', { name: '桌面连接', exact: true }).click()
      await expect(page.getByRole('heading', { name: `桌面连接 · Studio ${width}` })).toBeVisible()
      await expect(page.getByRole('button', { name: '生成桌面配对码' })).toBeVisible()
      await page.reload()
      await expect(page.getByRole('navigation', { name: '选择项目' }).getByRole('link', { name: new RegExp(`Studio ${width}`) })).toHaveAttribute('aria-current', 'page')
    })
  }

  test('members see all rules but cannot create projects or edit policy', async ({ page, context }) => {
    await signIn(context, 'u-wang')
    await page.goto(`${webUrl}/?projectId=p-payments&view=settings&section=policy`)
    await expect(page.getByRole('button', { name: '创建团队项目' })).toHaveCount(0)
    await expect(page.getByRole('table', { name: '团队策略规则' }).locator('tbody tr')).toHaveCount(10)
    await expect(page.getByRole('button', { name: '预览变更' })).toHaveCount(0)
    await expect(page.getByText('当前为只读模式，只有组织 Owner 可以修改团队策略。')).toBeVisible()
  })
})
