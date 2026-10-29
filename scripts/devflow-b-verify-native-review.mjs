// Independently reconcile the real review artifact with the host files, ledger and Electron UI.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from '@playwright/test'
const [readyFile, reviewFile] = process.argv.slice(2)
const ready = JSON.parse(await readFile(readyFile, 'utf8'))
assert.equal(ready.scenario, 'no-opencode')
const before = JSON.parse(await readFile(path.join(ready.output, 'native-review-fixed-before.json'), 'utf8'))
const after = JSON.parse(await readFile(path.join(ready.output, 'native-review-fixed-after.json'), 'utf8'))
const result = JSON.parse(await readFile(reviewFile, 'utf8'))
assert.equal(result.review.executorKind, 'native-agent')
assert.equal(result.review.runId, ready.runId)
assert.deepEqual(after.files, before.files)
assert.equal(after.head, before.head)
assert.equal(after.status, '')
assert.equal(after.diffSha256, before.diffSha256)
assert.deepEqual(after.desktop.run, before.desktop.run)
assert.deepEqual(after.desktop.configuration, before.desktop.configuration)
assert.equal(after.desktop.configuration.executor, 'native-model')
assert.equal(after.desktop.codingRuns.length, 0)
assert(after.desktop.discovery.candidates.every(item => item.status === 'unavailable'))
const git = args => execFileSync('git', args, { cwd: ready.repo })
const repositoryHash = createHash('sha256').update(git(['rev-parse', 'HEAD']))
  .update(git(['status', '--porcelain=v1', '-z', '--untracked-files=all']))
  .update(git(['diff', '--binary', 'HEAD']))
for (const relative of git(['ls-files', '--others', '--exclude-standard', '-z']).toString().split('\0').filter(Boolean).sort()) {
  repositoryHash.update(relative).update(await readFile(path.resolve(ready.repo, relative)))
}
assert.equal(repositoryHash.digest('hex'), result.review.repositoryFindings.repositoryDigest)
const citations = []
for (const citation of result.review.repositoryFindings.citations) {
  const canonical = await realpath(path.resolve(ready.repo, citation.path))
  assert(canonical.startsWith(ready.repo + path.sep))
  const bytes = await readFile(canonical)
  const actualDigest = createHash('sha256').update(bytes).digest('hex')
  assert.equal(actualDigest, citation.contentDigest)
  const lines = bytes.toString().replace(/\n$/, '').split('\n')
  assert(citation.lineStart >= 1 && citation.lineEnd >= citation.lineStart && citation.lineEnd <= lines.length)
  citations.push({ ...citation, digestVerified: true, lineRangeVerified: true })
}
assert.deepEqual(citations.map(item => item.path).sort(), ['src/app.js', 'src/store.js', 'test/store.test.js'])
const calls = after.budget.calls.slice(before.budget.calls.length)
assert(calls.length > 0 && calls.every(call => call.status === 'completed' && Number.isInteger(call.committed_microyuan)))
const inputTokens = calls.reduce((sum, call) => sum + call.usage.prompt_tokens, 0)
const outputTokens = calls.reduce((sum, call) => sum + call.usage.completion_tokens, 0)
assert.equal(result.tokenUsage.inputTokens, inputTokens)
assert.equal(result.tokenUsage.outputTokens, outputTokens)
assert.equal(result.tokenUsage.budgetAttemptIds.length, calls.length)
const totalTokens = after.desktop.records.agentTokenUsage.reduce((sum, usage) => sum + usage.inputTokens + usage.outputTokens, 0)
const costUsd = after.desktop.records.agentTokenUsage.reduce((sum, usage) => sum + usage.costUsd, 0)
const version = await (await fetch(new URL('/json/version', ready.cdpUrl))).json()
const browser = await chromium.connectOverCDP(version.webSocketDebuggerUrl)
try {
  const page = browser.contexts().flatMap(context => context.pages()).find(item => item.url().includes('index.html'))
  assert(page)
  const body = await page.locator('body').innerText()
  assert(body.includes(`${totalTokens.toLocaleString('en-US')} tokens`))
  assert(body.includes('核对 3 项事实，引用 3 个文件'))
  assert(body.includes('需求确认 Gate'))
  await page.screenshot({ path: path.join(ready.output, 'native-review-success.png'), fullPage: true })
  const findings = page.getByText('审查方式：内置审查读取仓库核对 · 核对 3 项事实，引用 3 个文件', { exact: true })
  await findings.scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(ready.output, 'native-review-success-findings.png') })
  const report = { recordedAt: new Date().toISOString(), passed: true, reviewId: result.review.id,
    unchangedFiles: before.files.length, repositoryDigestVerified: true, citations,
    gateUnchanged: true, codingExecutor: 'native-model', openCodeAvailable: false,
    ledgerCallIds: calls.map(call => call.id), budgetAttemptIds: result.tokenUsage.budgetAttemptIds,
    inputTokens, outputTokens, conservativeCny: calls.reduce((sum, call) => sum + call.committed_microyuan, 0) / 1e6,
    taskTotalTokens: totalTokens, taskDisplayedCostUsd: Number(costUsd.toFixed(3)), taskEstimatedCostUsd: costUsd }
  const output = path.join(ready.output, 'native-review-success-verification.json')
  await writeFile(output, JSON.stringify(report, null, 2), { mode: 0o600 })
  console.log(JSON.stringify({ output, ...report }, null, 2))
} finally { await browser.close() }
