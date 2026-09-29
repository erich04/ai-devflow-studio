// Workspace redesign baseline (plan docs/plans/task-centered-workspace-redesign-2026-09-28.zh-CN.md, S0).
// Measures the desktop task page in a real Electron window, in an isolated environment,
// with deterministic fake runtimes. No real model calls, no default user data.
//
//   corepack pnpm baseline:workspace [--samples a,b] [--sizes 1440x742,...] [--theme light|dark]
//                                    [--zoom 1] [--out dir] [--keep-temp] [--self-check]
import { execFile } from 'node:child_process'
import { mkdir, realpath, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { _electron as electron } from '@playwright/test'
import {
  createSampleRepo,
  createWorkspace,
  delay,
  electronExecutable,
  launchDesktop,
  removeWorkspace,
  rootDir,
  screenInfo,
  setContentSize,
  startTeamApi,
  stopProcess,
  type TeamApi,
  type Workspace,
} from './workspace-baseline/environment.mts'
import { measurePage } from './workspace-baseline/measure.mts'
import { findSamples, type Sample, type SampleContext } from './workspace-baseline/samples.mts'

const execFileAsync = promisify(execFile)
const here = path.dirname(fileURLToPath(import.meta.url))

/**
 * Content sizes fixed in S0 (task 4.2). Main baseline first. All three share the main
 * baseline height: the plan's vertical targets are absolute pixels, so only width varies.
 * 1024 is below the product minimum window width and is reached by relaxing the minimum
 * inside the measuring process only.
 */
const defaultSizes = ['1440x742', '1280x742', '1024x742']

interface Options {
  samples?: string[]
  sizes: Array<{ width: number; height: number }>
  /** When false, each sample uses its own default sizes. */
  sizesExplicit: boolean
  theme: 'light' | 'dark'
  zoom: number
  out: string
  keepTemp: boolean
  selfCheck: boolean
  list: boolean
}

function fail(message: string): never {
  console.error(`workspace-baseline: ${message}`)
  process.exit(2)
}

function parseSize(value: string) {
  const match = /^(\d{3,4})x(\d{3,4})$/.exec(value.trim())
  if (!match) fail(`invalid size "${value}", expected WIDTHxHEIGHT such as 1440x742`)
  return { width: Number(match[1]), height: Number(match[2]) }
}

function parseArgs(argv: string[]): Options {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const options: Options = {
    sizes: defaultSizes.map(parseSize),
    sizesExplicit: false,
    theme: 'light',
    zoom: 1,
    out: path.join(rootDir, 'outputs', 'workspace-baseline', stamp),
    keepTemp: false,
    selfCheck: false,
    list: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const value = () => argv[++index] ?? fail(`${arg} needs a value`)
    if (arg === '--samples') options.samples = value().split(',').map((id) => id.trim()).filter(Boolean)
    else if (arg === '--sizes') {
      options.sizes = value().split(',').map(parseSize)
      options.sizesExplicit = true
    } else if (arg === '--list') options.list = true
    else if (arg === '--theme') {
      const theme = value()
      if (theme !== 'light' && theme !== 'dark') fail(`invalid theme "${theme}"`)
      options.theme = theme
    } else if (arg === '--zoom') {
      options.zoom = Number(value())
      if (!(options.zoom >= 0.5 && options.zoom <= 3)) fail('zoom must be between 0.5 and 3')
    } else if (arg === '--out') options.out = path.resolve(value())
    else if (arg === '--keep-temp') options.keepTemp = true
    else if (arg === '--self-check') options.selfCheck = true
    else fail(`unknown argument "${arg}"`)
  }
  return options
}

// ---------------------------------------------------------------------------------------------
// Self-check: the measuring function against a static page with known answers.

async function runSelfCheck(): Promise<void> {
  const app = await electron.launch({
    executablePath: electronExecutable(),
    args: [path.join(here, 'workspace-baseline/self-check/main.cjs')],
  })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('load')
    await delay(300)
    const result = await measurePage(page, {
      fontRoot: 'main',
      regions: { firstBlock: '#first-block', header: 'header' },
      controlScopes: { header: 'header' },
      phrases: ['Current step'],
      truncationSelector: '[data-measure-truncation]',
    })
    const checks: Array<[string, unknown, unknown]> = [
      ['viewport', result.viewport, { width: 800, height: 600 }],
      ['visible controls', result.controls.items.map((item) => item.name), ['Header action', 'Link', 'Tab', 'Summary']],
      ['controls in header', result.controls.byScope.header, 1],
      ['font sizes (hidden, clipped and off-viewport text excluded)', result.fonts.sizes, [11, 12, 14, 18]],
      ['phrase count', result.phrases['Current step'], 2],
      ['truncation (own overflow, fits, clipped by scroller)', result.truncation.map((item) => item.truncated), [true, false, true]],
      ['first block top', result.regions.firstBlock?.box?.top !== undefined && result.regions.firstBlock.box.top >= 40, true],
    ]
    let failed = 0
    for (const [label, actual, expected] of checks) {
      const ok = JSON.stringify(actual) === JSON.stringify(expected)
      if (!ok) failed += 1
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`)
    }
    if (failed > 0) throw new Error(`${failed} self-check assertion(s) failed`)
    console.log('workspace-baseline self-check passed.')
  } finally {
    await app.close()
  }
}

// ---------------------------------------------------------------------------------------------
// Baseline run.

interface RecordEntry {
  sample: string
  size: string
  theme: string
  zoom: number
  valid: boolean
  sizing: Awaited<ReturnType<typeof setContentSize>>
  screenshot: string
  summary: ReturnType<typeof summarize>
  measurement: Awaited<ReturnType<typeof measurePage>>
}

function summarize(measurement: Awaited<ReturnType<typeof measurePage>>) {
  const box = (name: string) => measurement.regions[name]?.box
  const topbar = box('topbar')
  const strip = box('statusStrip')
  const main = box('main')
  const discussion = box('discussion')
  return {
    statusRowBottom: box('statusRow')?.bottom ?? null,
    firstBodyBlockTop: box('firstBodyBlock')?.top ?? null,
    topbarAndStripHeight: (topbar?.height ?? 0) + (strip?.height ?? 0),
    topbarAndStripControls: (measurement.controls.byScope.topbar ?? 0) + (measurement.controls.byScope.statusStrip ?? 0),
    viewportControls: measurement.controls.count,
    locationPhrases: measurement.phrases,
    fontSizes: { distinct: measurement.fonts.distinct, min: measurement.fonts.min, sizes: measurement.fonts.sizes },
    discussionWidth: discussion?.width ?? 0,
    discussionShareOfMain: discussion && main ? Math.round((discussion.width / main.width) * 1000) / 10 : 0,
    truncatedStageLabels: measurement.truncation.filter((item) => item.truncated).map((item) => item.text),
    toastVisible: measurement.regions.toast?.found ?? false,
    pageOverflow: {
      horizontal: measurement.page.horizontalOverflow,
      vertical: measurement.page.verticalOverflow,
      scrollHeight: measurement.page.scrollHeight,
    },
  }
}

async function gitCommit() {
  try {
    const [{ stdout: head }, { stdout: status }] = await Promise.all([
      execFileAsync('git', ['rev-parse', '--short', 'HEAD'], { cwd: rootDir }),
      execFileAsync('git', ['status', '--porcelain', '--', 'apps', 'packages'], { cwd: rootDir }),
    ])
    return { head: head.trim(), productCodeDirty: status.trim().length > 0 }
  } catch {
    return { head: 'unknown', productCodeDirty: null }
  }
}

/** Replaces temp paths and refuses to write anything that looks like a user path or secret. */
function sanitize(value: unknown, tempRoots: string[]): string {
  let text = JSON.stringify(value, null, 2)
  for (const root of tempRoots) text = text.split(root).join('<temp>')
  const home = os.homedir()
  if (home && home.length > 1 && text.includes(home)) throw new Error('refusing to write output that contains the home directory path')
  if (/Bearer\s+[A-Za-z0-9._-]{8,}|"token"\s*:\s*"[^"]+"|pairingCode/i.test(text)) {
    throw new Error('refusing to write output that looks like it contains a credential or pairing code')
  }
  return `${text}\n`
}

async function runSample(sample: Sample, options: Options, tempRoots: string[]) {
  const log = (message: string) => console.log(`[${sample.id}] ${message}`)
  const records: RecordEntry[] = []
  const extraShots: string[] = []
  const observations: Record<string, unknown> = {}
  if (!sample.prepare) {
    log('not prepared in Electron; see the alternative in the manifest')
    return { status: 'not-in-electron' as const, records, extraShots, observations }
  }
  const sizes = options.sizesExplicit ? options.sizes : (sample.sizes ?? ['1440x742']).map(parseSize)
  const first = sizes[0]!
  let workspace: Workspace | undefined
  let api: TeamApi | undefined
  let ctx: SampleContext | undefined
  const cleanups: Array<() => Promise<void>> = []
  try {
    workspace = await createWorkspace()
    tempRoots.push(workspace.tempRoot, await realpath(workspace.tempRoot))
    await createSampleRepo(workspace.repoDir, sample.repoVariant)
    api = await startTeamApi(workspace)
    const launch = async () => {
      const desktop = await launchDesktop({ workspace: workspace!, apiUrl: api!.url, theme: options.theme, env: sample.launchEnv })
      await setContentSize(desktop, first.width, first.height, options.zoom)
      return desktop
    }
    const shotsDir = path.join(options.out, 'shots')
    await mkdir(shotsDir, { recursive: true })
    const context: SampleContext = {
      desktop: await launch(),
      workspace,
      api,
      theme: options.theme,
      log,
      capture: async (label: string) => {
        // Extra evidence only at the main baseline configuration.
        if (options.zoom !== 1) return
        const name = `${sample.id}-${label}-${first.width}x${first.height}${options.theme === 'dark' ? '-dark' : ''}.jpg`
        await context.desktop.page.screenshot({ path: path.join(shotsDir, name), type: 'jpeg', quality: 85, scale: 'css' })
        extraShots.push(`shots/${name}`)
      },
      observe: (key: string, value: unknown) => {
        observations[key] = value
      },
      relaunch: async (whileClosed?: () => Promise<void>) => {
        await context.desktop.app.close()
        await delay(500)
        if (whileClosed) await whileClosed()
        context.desktop = await launch()
      },
      onCleanup: (action: () => Promise<void>) => {
        cleanups.push(action)
      },
    }
    ctx = context
    log('preparing')
    await sample.prepare(context)
    const desktop = context.desktop
    for (const size of sizes) {
      const sizing = await setContentSize(desktop, size.width, size.height, options.zoom)
      await delay(700)
      const suffix = `${options.theme === 'dark' ? '-dark' : ''}${options.zoom !== 1 ? `-zoom${Math.round(options.zoom * 100)}` : ''}`
      const shotName = `${sample.id}-${size.width}x${size.height}${suffix}.jpg`
      if (options.zoom === 1) {
        await desktop.page.screenshot({ path: path.join(shotsDir, shotName), type: 'jpeg', quality: 85, scale: 'css' })
      } else {
        // Playwright crops zoomed Electron pages; capture the rendered window instead,
        // scaled to the content size so it matches the other screenshots.
        const jpeg = await desktop.app.evaluate(async ({ BrowserWindow }, width) => {
          const window = BrowserWindow.getAllWindows()[0]!
          const image = await window.webContents.capturePage()
          return image.resize({ width, quality: 'best' }).toJPEG(85).toString('base64')
        }, size.width)
        await writeFile(path.join(shotsDir, shotName), Buffer.from(jpeg, 'base64'))
      }
      const measurement = await measurePage(desktop.page, sample.measure)
      const entry: RecordEntry = {
        sample: sample.id,
        size: `${size.width}x${size.height}`,
        theme: options.theme,
        zoom: options.zoom,
        valid: sizing.valid,
        sizing,
        screenshot: `shots/${shotName}`,
        summary: summarize(measurement),
        measurement,
      }
      records.push(entry)
      log(`${entry.size}${sizing.valid ? '' : ' INVALID'}: ${JSON.stringify(entry.summary)}`)
    }
    const environment = {
      screen: await screenInfo(desktop),
      versions: await desktop.app.evaluate(() => ({ electron: process.versions.electron, chrome: process.versions.chrome })),
    }
    if (sample.followUp) {
      try {
        log('follow-up checks')
        await sample.followUp(context)
      } catch (error) {
        observations.followUpError = (error as Error).message.split('\n')[0]
        log(`follow-up failed: ${observations.followUpError}`)
      }
    }
    return { status: 'prepared' as const, records, extraShots, observations, environment }
  } catch (error) {
    log(`FAILED: ${(error as Error).message.split('\n')[0]}`)
    if (ctx) {
      await ctx.desktop.page
        .screenshot({ path: path.join(options.out, `failure-${sample.id}.jpg`), type: 'jpeg', quality: 70, scale: 'css' })
        .catch(() => {})
    }
    return { status: 'failed' as const, error: (error as Error).message.split('\n').slice(0, 5).join('\n'), records, extraShots, observations }
  } finally {
    await ctx?.desktop.app.close().catch(() => {})
    for (const cleanup of cleanups) await cleanup().catch(() => {})
    await stopProcess(api?.process)
    if (workspace && !options.keepTemp) await removeWorkspace(workspace)
    else if (workspace) log(`kept temp directory ${workspace.tempRoot}`)
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.selfCheck) {
    await runSelfCheck()
    return
  }
  if (options.list) {
    for (const sample of findSamples(undefined)) console.log(`${sample.id}\t${sample.method}\t${sample.title}`)
    return
  }
  const selected = (() => {
    try {
      return findSamples(options.samples)
    } catch (error) {
      return fail((error as Error).message)
    }
  })()
  await mkdir(options.out, { recursive: true })
  const tempRoots: string[] = []
  const manifest = []
  const metrics: RecordEntry[] = []
  let environment: unknown
  let failures = 0
  for (const sample of selected) {
    const result = await runSample(sample, options, tempRoots)
    if (result.status === 'failed') failures += 1
    if ('environment' in result) environment ??= result.environment
    metrics.push(...result.records)
    manifest.push({
      id: sample.id,
      title: sample.title,
      planRefs: sample.planRefs,
      method: sample.method,
      simulated: sample.simulated,
      transient: sample.transient,
      limits: sample.limits,
      layoutOnly: sample.method !== 'ui',
      alternative: sample.alternative,
      screenshots: result.records.map((record) => record.screenshot),
      extraScreenshots: result.extraShots,
      observations: result.observations,
      result: result.status,
      error: 'error' in result ? result.error : undefined,
    })
  }
  const run = {
    generatedAt: new Date().toISOString(),
    commit: await gitCommit(),
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    theme: options.theme,
    zoom: options.zoom,
    sizes: options.sizesExplicit ? options.sizes.map((size) => `${size.width}x${size.height}`) : 'per sample',
    environment,
  }
  await writeFile(path.join(options.out, 'metrics.json'), sanitize({ run, records: metrics }, tempRoots))
  await writeFile(path.join(options.out, 'manifest.json'), sanitize({ run, samples: manifest }, tempRoots))
  console.log(`workspace-baseline: wrote ${path.relative(rootDir, options.out) || options.out}`)
  if (failures > 0) {
    console.error(`workspace-baseline: ${failures} sample(s) failed`)
    process.exitCode = 1
  }
}

await main()
