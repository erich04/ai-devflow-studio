// Host evidence for the isolated real native review. Does not invoke a model or change settings.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, readdir, lstat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from '@playwright/test'
const [readyFile, label] = process.argv.slice(2)
assert(readyFile && /^[a-z0-9-]+$/.test(label), 'Provide B ready.json and a simple audit label')
const ready = JSON.parse(await readFile(readyFile, 'utf8'))
assert.equal(ready.scenario, 'no-opencode')
assert(ready.output.includes('/.tmp/devflow-b-20261023/no-opencode-'))
const git = args => execFileSync('git', args, { cwd: ready.repo, encoding: 'utf8' })
const files = []
async function walk(directory, prefix = '') {
  for (const name of (await readdir(directory)).sort()) {
    if (!prefix && name === '.git') continue
    const relative = prefix ? `${prefix}/${name}` : name
    const absolute = path.join(directory, name)
    const stat = await lstat(absolute)
    assert(!stat.isSymbolicLink(), 'The synthetic fixture must not contain symlinks')
    if (stat.isDirectory()) await walk(absolute, relative)
    else if (stat.isFile()) {
      const bytes = await readFile(absolute)
      files.push({ path: relative, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
    }
  }
}
await walk(ready.repo)
const ledger = JSON.parse(await readFile(path.resolve(ready.output, '../budget/ledger.json'), 'utf8'))
assert.equal(ledger.scope, 'devflow-b-20261023')
const version = await (await fetch(new URL('/json/version', ready.cdpUrl))).json()
const browser = await chromium.connectOverCDP(version.webSocketDebuggerUrl)
try {
  const page = browser.contexts().flatMap(context => context.pages()).find(item => item.url().includes('index.html'))
  assert(page)
  const desktop = await page.evaluate(async ready => {
    const api = window.aiDevFlowDesktop
    const state = await api.loadState()
    const run = state.runs.find(item => item.id === ready.runId)
    const records = Object.fromEntries(Object.entries(state).filter(([key, value]) =>
      Array.isArray(value) && /review|invocation|operation|trace|call|usage/i.test(key)
    ).map(([key, value]) => [key, value.filter(item => item.runId === ready.runId || item.projectId === ready.projectId)]))
    return {
      configuration: await api.getCodingRuntimeConfiguration({ projectId: ready.projectId }),
      discovery: await api.detectCodingRuntimeEngines({ projectId: ready.projectId }),
      reviewExecutor: state.settings.knowledgeReviewExecutor,
      run: { id: run.id, currentNodeId: run.currentNodeId, status: run.status, nodes: run.nodes },
      codingRuns: state.codingRuns.filter(item => item.runId === ready.runId), records,
      artifacts: state.artifacts.filter(item => item.runId === ready.runId),
    }
  }, ready)
  const evidence = {
    recordedAt: new Date().toISOString(), label, repo: ready.repo,
    head: git(['rev-parse', 'HEAD']).trim(), status: git(['status', '--porcelain=v1', '--untracked-files=all']),
    diffSha256: createHash('sha256').update(git(['diff', '--binary', 'HEAD'])).digest('hex'), files,
    desktop, budget: { capMicroyuan: ledger.budget_microyuan, calls: ledger.calls },
  }
  const output = path.join(ready.output, `native-review-${label}.json`)
  await writeFile(output, JSON.stringify(evidence, null, 2), { mode: 0o600 })
  await page.screenshot({ path: output.replace(/\.json$/, '.png'), fullPage: true })
  console.log(JSON.stringify({ output, fileCount: files.length, clean: evidence.status === '',
    executor: desktop.configuration.executor, reviewExecutor: desktop.reviewExecutor,
    currentNodeId: desktop.run.currentNodeId, calls: ledger.calls.length }))
} finally { await browser.close() }
