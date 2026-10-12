/** Qualify public baseline regression plans without exposing future acceptance tests. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CodingCommandRunner } from '../apps/desktop/electron/coding-command-runner'
import { codingShellPlan } from '../apps/desktop/electron/coding-dependency-preparation'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const save = (file: string, value: unknown) => writeFile(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
type PublicPlan = { taskId: string; baseSha: string; publicTestFiles: string[]; selectionRule: string; testCommand: string }
const commandFor = (files: string[]) => `corepack pnpm exec vitest run ${files.join(' ')}`
const git = (args: string[], cwd = repository) => execFileSync('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 })
const sourceFiles = ['scripts/native-coding-public-plans.mts', 'apps/desktop/electron/coding-command-runner.ts', 'apps/desktop/electron/coding-dependency-preparation.ts']

async function derive(file: string) {
  const raw = await readFile(path.join(repository, 'docs/evaluation/native-coding-v3-tasks.json'))
  const manifest = JSON.parse(raw.toString()) as { tasks: Array<{ id: string; baseSha: string; acceptanceTests: string[] }> }
  const qualification = JSON.parse(await readFile(path.join(repository, 'docs/evaluation/native-coding-v3-qualification-20261011.json'), 'utf8')) as { manifestDigest: string; results: Array<{ taskId: string; qualified: boolean }> }
  if (qualification.manifestDigest !== digest(raw)) throw new Error('Private task qualification does not match the manifest')
  const tasks: PublicPlan[] = []
  for (const task of manifest.tasks.filter(task => qualification.results.some(row => row.taskId === task.id && row.qualified))) {
    const existing = git(['ls-tree', '-r', '--name-only', task.baseSha]).toString().trim().split('\n').filter(file => /\.test\.tsx?$/u.test(file))
    let selected = task.acceptanceTests.filter(file => existing.includes(file))
    let selectionRule = 'Existing public baseline suites at the task acceptance paths; no reference contents.'
    if (!selected.length) {
      for (const wanted of task.acceptanceTests) {
        const folder = path.posix.dirname(wanted), parts = path.posix.basename(wanted).split('-')
        for (let count = parts.length - 1; count > 0; count--) {
          const prefix = `${folder}/${parts.slice(0, count).join('-')}-`
          const matches = existing.filter(file => path.posix.dirname(file) === folder && file.startsWith(prefix))
          if (matches.length) { selected.push(...matches); break }
        }
      }
      selectionRule = 'No acceptance suite exists at baseline: existing same-directory suites sharing the longest dash-delimited filename prefix; no future test contents.'
    }
    selected = [...new Set(selected)].sort()
    if (!selected.length || selected.some(file => !/^(apps|packages|scripts|tests)\/[a-zA-Z0-9._/-]+\.test\.tsx?$/u.test(file) || file.split('/').includes('..'))) throw new Error(`No safe public regression plan for ${task.id}`)
    tasks.push({ taskId: task.id, baseSha: task.baseSha, publicTestFiles: selected, selectionRule, testCommand: commandFor(selected) })
  }
  await writeFile(file, JSON.stringify({ schemaVersion: 1, taskManifestDigest: digest(raw), purpose: 'Same public saved test plan for every engine. Targeted baseline regression only, not whole-repository release/provenance testing. Future reference acceptance remains private and unchanged. Qualify each plan before paid trials.', tasks }, null, 2) + '\n', { flag: 'wx' })
}

async function qualify(file: string, output: string) {
  const bytes = await readFile(file), manifest = JSON.parse(bytes.toString()) as { schemaVersion: number; taskManifestDigest: string; tasks: PublicPlan[] }
  if (manifest.schemaVersion !== 1 || manifest.tasks.length < 30 || new Set(manifest.tasks.map(task => task.taskId)).size !== manifest.tasks.length) throw new Error('Invalid public plan manifest')
  await mkdir(output)
  const sourceDigests = Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, digest(await readFile(path.join(repository, file)))])))
  const results: Array<Record<string, unknown>> = []
  for (const task of manifest.tasks) {
    if (!/^[a-z0-9-]+$/u.test(task.taskId) || !/^[a-f0-9]{40}$/u.test(task.baseSha) || !task.publicTestFiles.length || task.publicTestFiles.some(file => !/^(apps|packages|scripts|tests)\/[a-zA-Z0-9._/-]+\.test\.tsx?$/u.test(file) || file.split('/').includes('..')) || task.testCommand !== commandFor(task.publicTestFiles)) throw new Error('Invalid public plan')
    const directory = path.join(output, task.taskId); await mkdir(directory)
    const scratch = await mkdtemp(path.join(os.tmpdir(), 'df-public-plan-')), checkout = path.join(scratch, 'baseline'), archive = path.join(scratch, 'baseline.tar')
    const runner = new CodingCommandRunner(path.join(directory, 'commands')), started = Date.now()
    let observation: { qualified: boolean; [key: string]: unknown } = { qualified: false }
    try {
      await mkdir(checkout)
      git(['archive', '--format=tar', `--output=${archive}`, task.baseSha]); execFileSync('tar', ['-xf', archive, '-C', checkout])
      for (const args of [['init', '-b', 'main'], ['config', 'user.name', 'Evaluation'], ['config', 'user.email', 'evaluation@example.invalid'], ['add', '.'], ['commit', '-m', 'Blinded isolated baseline']]) git(args, checkout)
      for (const file of task.publicTestFiles) git(['cat-file', '-e', `HEAD:${file}`], checkout)
      const reportPath = path.join(checkout, 'public-plan-tests.json')
      const plan = codingShellPlan(task.testCommand + ' --reporter=json --outputFile=public-plan-tests.json', { kind: 'trusted_local' })
      plan.preparation = { ...codingShellPlan('corepack pnpm install --frozen-lockfile', { kind: 'trusted_local' }), timeoutMs: 300000 }
      plan.timeoutMs = 300000
      await runner.start('public-plan', plan, checkout)
      const receipt = await runner.wait('public-plan')
      let report: { numPassedTests: number; numFailedTests: number; numPendingTests: number; numTotalTests: number; numUnhandledErrors: number } | undefined
      try { report = JSON.parse(await readFile(reportPath, 'utf8')) as typeof report } catch { /* absence is a failed qualification */ }
      if (report) await writeFile(path.join(directory, 'tests.json'), await readFile(reportPath))
      observation = { qualified: receipt.status === 'passed' && !!report && report.numPassedTests > 0 && report.numFailedTests === 0 && !report.numUnhandledErrors, receipt, tests: report ? { passed: report.numPassedTests, failed: report.numFailedTests, skipped: report.numPendingTests, total: report.numTotalTests, unhandledErrors: report.numUnhandledErrors ?? 0 } : null, reportDigest: report ? digest(await readFile(reportPath)) : null }
    } catch (error) { observation = { qualified: false, error: error instanceof Error ? error.message : String(error) } }
    finally { await runner.cancelAll(); await rm(scratch, { recursive: true, force: true }) }
    const row = { taskId: task.taskId, baseSha: task.baseSha, testCommand: task.testCommand, durationMs: Date.now() - started, ...observation }
    results.push(row); await save(path.join(directory, 'qualification.json'), row)
    await save(path.join(output, 'qualification.json'), { schemaVersion: 1, publicPlanDigest: digest(bytes), taskManifestDigest: manifest.taskManifestDigest, sourceDigests, platform: process.platform, node: process.version, qualified: results.filter(row => row.qualified).length, results })
    console.log(JSON.stringify({ task: task.taskId, qualified: row.qualified, durationMs: row.durationMs }))
  }
}

const [command, file, output] = process.argv.slice(2)
if (command === 'derive' && file && !output) await derive(path.resolve(file))
else if (command === 'qualify' && file && output) await qualify(path.resolve(file), path.resolve(output))
else throw new Error('Usage: tsx scripts/native-coding-public-plans.mts derive <new-manifest.json> | qualify <manifest.json> <new-output>')
