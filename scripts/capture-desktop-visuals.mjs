import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const baseUrl = process.env.DEVFLOW_DESKTOP_URL ?? 'http://127.0.0.1:5173/'
const outputDir = path.resolve('test-results/airbnb-iii-visual')

const viewports = [
  { name: '3840x2160', width: 3840, height: 2160 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1440x900', width: 1440, height: 900 },
]

const routes = [
  { name: 'workbench', button: '工作台' },
  { name: 'team', button: 'Team Overview' },
  { name: 'knowledge', button: 'Knowledge' },
  { name: 'agents', button: 'Agents' },
  { name: 'skills', button: 'Skills' },
  { name: 'mcp', button: 'MCP' },
  { name: 'tests', button: '测试' },
]

async function captureRoute(page, route, viewportName) {
  if (route.name !== 'workbench') {
    await page.getByRole('button', { name: route.button }).click()
  } else {
    await page.getByRole('button', { name: route.button }).click().catch(() => undefined)
  }

  await page.locator('.workspace').waitFor({ state: 'visible' })
  await page.screenshot({
    path: path.join(outputDir, `${viewportName}-${route.name}.png`),
    fullPage: true,
  })
}

async function main() {
  await mkdir(outputDir, { recursive: true })
  const browser = await chromium.launch()
  const generatedAt = new Date().toISOString()
  const captures = []

  try {
    for (const viewport of viewports) {
      const page = await browser.newPage({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
      })

      await page.goto(baseUrl, { waitUntil: 'networkidle' })

      for (const route of routes) {
        await captureRoute(page, route, viewport.name)
        captures.push({
          route: route.name,
          viewport: viewport.name,
          width: viewport.width,
          height: viewport.height,
          file: `${viewport.name}-${route.name}.png`,
        })
      }

      await page.close()
    }
  } finally {
    await browser.close()
  }

  await writeFile(
    path.join(outputDir, 'manifest.json'),
    JSON.stringify({
      generatedAt,
      baseUrl,
      deviceScaleFactor: 1,
      referenceDirectory: 'docs/product/design-references',
      captures,
    }, null, 2),
  )

  console.log(`Desktop visual captures written to ${outputDir}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
