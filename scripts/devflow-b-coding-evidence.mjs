// Read-only real Electron/OpenCode/host snapshot. Usage: node this.mjs ready.json label [previous/evidence.json]
// No model calls, replies, permissions, plugin queries, workflow mutations or SQLite writes.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile, mkdir, readdir, lstat, readlink, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { chromium } from '@playwright/test'
import { evidenceSha as sha, opaqueEvidence as opaque, sanitizeEvidence as sanitize } from './devflow-b-evidence-redaction.mjs'
import { inspectTestEvidence } from './devflow-b-test-evidence.mjs'
const [readyFile, label = 'snapshot', previousFile] = process.argv.slice(2)
assert(readyFile && /^[a-z0-9-]{1,60}$/.test(label), 'Provide isolated B ready.json and a simple label')
const ready = JSON.parse(await readFile(readyFile, 'utf8'))
assert(ready.scenario === 'opencode' && ready.schema.startsWith('b_live_'))
assert(ready.output.includes('/.tmp/devflow-b-20261023/opencode-'))
assert.equal(new URL(ready.cdpUrl).hostname, '127.0.0.1')
const output = path.join(ready.output, `evidence-${Date.now()}-${label}`)
await mkdir(output, { mode: 0o700 })
const selected = (value, names) => Object.fromEntries(names.filter(name => value?.[name] !== undefined).map(name => [name, value[name]]))
const version = await (await fetch(new URL('/json/version', ready.cdpUrl))).json()
const browser = await chromium.connectOverCDP(version.webSocketDebuggerUrl)
try {
  const page = browser.contexts().flatMap(context => context.pages()).find(item => item.url().includes('index.html'))
  assert(page, 'Actual Electron renderer is required')
  const collect = async () => page.evaluate(async ready => {
    const api = window.aiDevFlowDesktop, state = await api.loadState()
    const run = state.runs.find(item => item.id === ready.runId)
    if (!run || run.projectId !== ready.projectId) throw Error('Expected B Run is missing')
    const codingRuns = state.codingRuns.filter(item => item.runId === run.id)
    const ids = codingRuns.map(item => item.id)
    const coding = rows => rows.filter(item => ids.includes(item.codingRunId))
    const workflow = rows => rows.filter(item => item.runId === run.id)
    const top = document.querySelector('.task-usage-summary')
    const text = document.body.innerText.match(/本任务用量\s*([\d,]+(?:[^\n]*项用量不完整)? tokens[^\n]*)/)
    return { capturedAt: new Date().toISOString(), run, codingRuns, codingEvents: coding(state.codingEvents),
      permissions: coding(state.codingPermissionRequests), permissionDecisions: coding(state.codingPermissionDecisions),
      workspaces: state.managedCodingWorkspaces.filter(item => ids.includes(item.codingRunId)),
      tests: workflow(state.testEvidence), diffs: workflow(state.codingDiffArtifacts),
      bootstrap: coding(state.dependencyBootstrapEvidence), agentUsage: workflow(state.agentTokenUsage),
      traces: workflow(state.agentTraces), workflowEvents: workflow(state.events),
      configuration: await api.getCodingRuntimeConfiguration({ projectId: ready.projectId }),
      visibleUsage: top?.textContent ?? text?.[1] ?? null }
  }, ready)
  const state = await collect()
  const providerEvents = state.codingEvents.filter(event => event.metadata?.providerCall)
  const calls = new Map()
  for (const event of providerEvents) {
    const call = event.metadata.providerCall
    if (!call.requestId) continue
    const key = `${event.codingRunId}:${call.requestId}`
    const previous = calls.get(key)
    if (!previous || call.status !== 'started' || previous.trace.status === 'started') calls.set(key, {
      codingRunId: event.codingRunId, sequence: event.sequence, eventId: event.id, trace: call,
      scope: selected(event.metadata, ['executorSessionId', 'parentSessionId', 'rootSessionId', 'workspaceId']),
    })
  }
  const gitEnv = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }
  const git = (root, args, encoding = 'utf8') => execFileSync('git', args, { cwd: root, encoding, env: gitEnv, timeout: 15_000, maxBuffer: 8 * 1024 * 1024 })
  async function repository(root, name, base) {
    const canonical = await realpath(root)
    assert(canonical.startsWith(ready.output + path.sep), 'Only the current isolated B files may be inspected')
    const files = [], omissions = []; let total = 0
    async function walk(directory, prefix = '') {
      for (const entry of (await readdir(directory)).sort()) {
        if ((!prefix && entry === '.git') || entry === 'node_modules') continue
        const relative = prefix ? `${prefix}/${entry}` : entry, absolute = path.join(directory, entry)
        const info = await lstat(absolute)
        if (info.isSymbolicLink()) { files.push({ path: relative, symlinkTargetDigest: sha(await readlink(absolute)) }); continue }
        if (info.isDirectory()) { await walk(absolute, relative); continue }
        if (!info.isFile()) continue
        if (files.length >= 2000 || info.size > 4 * 1024 * 1024 || total + info.size > 64 * 1024 * 1024) { omissions.push(relative); continue }
        const bytes = await readFile(absolute); total += bytes.length
        files.push({ path: relative, bytes: bytes.length, sha256: sha(bytes) })
      }
    }
    await walk(canonical)
    const head = git(canonical, ['rev-parse', 'HEAD']).trim()
    const status = git(canonical, ['status', '--porcelain=v1', '--untracked-files=all'])
    const rawPatch = git(canonical, ['diff', '--binary', '--no-ext-diff', '--no-textconv', '--no-color', base ?? 'HEAD'])
    const redactedPatch = rawPatch.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[redacted-key]')
      .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]')
      .replace(/((?:api[_-]?key|password|secret|access[_-]?token)\s*[:=]\s*)['"][^'"\n]+['"]/gi, '$1"[redacted]"')
    await writeFile(path.join(output, `${name}.diff`), redactedPatch, { mode: 0o600 })
    const trackedDiff = git(canonical, ['diff', 'HEAD', '--binary', '--no-ext-diff', '--no-textconv', '--no-color', '--no-renames'])
    const trackedDigest = sha(JSON.stringify(['source-tree-v1', head, trackedDiff]))
    const untracked = git(canonical, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean).sort()
    let sourceTreeDigest = null
    if (untracked.length <= 5000 && untracked.every(file => !file.includes('\n'))) {
      const ids = untracked.length ? execFileSync('git', ['hash-object', '--no-filters', '--stdin-paths'], {
        cwd: canonical, env: gitEnv, input: untracked.join('\n') + '\n', encoding: 'utf8', timeout: 15_000,
      }).split('\n').filter(Boolean) : []
      if (ids.length === untracked.length) sourceTreeDigest = sha(JSON.stringify([trackedDigest, untracked.map((file, index) => [file, ids[index]])]))
    }
    const result = { path: canonical, head, status, files, omissions, diffSha256: sha(rawPatch), sourceTreeDigest,
      diffBytes: Buffer.byteLength(rawPatch), diffFile: `${name}.diff`, diffRedacted: redactedPatch !== rawPatch,
      stat: git(canonical, ['diff', '--stat', '--no-ext-diff', '--no-textconv', base ?? 'HEAD']), baseCommitSha: base ?? null }
    if (base) {
      const baseline = []
      for (const relative of git(canonical, ['ls-tree', '-r', '--name-only', '-z', base]).split('\0').filter(Boolean)) {
        const bytes = git(canonical, ['show', `${base}:${relative}`], 'buffer')
        baseline.push({ path: relative, bytes: bytes.length, sha256: sha(bytes) })
      }
      result.baseFiles = baseline
      result.matchesBaseFiles = baseline.every(file => files.some(actual => actual.path === file.path && actual.sha256 === file.sha256)) &&
        baseline.length === files.length && omissions.length === 0
    }
    return result
  }
  const baseCommits = [...new Set(state.workspaces.map(item => item.baseCommitSha).filter(Boolean))]
  const source = await repository(ready.repo, 'source', baseCommits.length === 1 ? baseCommits[0] : undefined)
  const worktrees = []
  for (const workspace of state.workspaces) {
    try { worktrees.push({ id: workspace.id, codingRunId: workspace.codingRunId,
      ...await repository(workspace.worktreePath, `worktree-${worktrees.length + 1}`, workspace.baseCommitSha) }) }
    catch (error) { worktrees.push({ id: workspace.id, codingRunId: workspace.codingRunId, unavailable: true, errorName: error.name }) }
  }
  // Only runtime plugins containing this saved Provider identity are candidates; DB rows additionally
  // require both the exact managed worktree and persisted codingRun/workspace identities.
  const openCode = { databases: [], sessions: [], tools: [], omissions: [] }
  const publicUrl = value => {
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash ? url.href : null } catch { return null }
  }
  for (const entry of (await readdir(tmpdir())).filter(name => name.startsWith('devflow-opencode-serve-'))) {
    const runtime = path.join(tmpdir(), entry), plugin = path.join(runtime, 'config/opencode/devflow-task-guard.mjs')
    let pluginText
    try { pluginText = await readFile(plugin, 'utf8') } catch { continue }
    if (!pluginText.includes(ready.providerId)) continue
    const database = path.join(runtime, 'data/opencode/opencode.db')
    let db
    try {
      db = new DatabaseSync(database, { readOnly: true })
      db.exec('PRAGMA query_only = ON')
      const sessions = db.prepare('SELECT id,parent_id,directory,metadata,agent,time_created,time_updated,cost,tokens_input,tokens_output,tokens_reasoning,tokens_cache_read FROM session WHERE directory = ?')
      for (const workspace of state.workspaces) for (const row of sessions.all(workspace.worktreePath)) {
        const metadata = JSON.parse(row.metadata ?? '{}'), owner = metadata.devflow
        if (owner?.codingRunId !== workspace.codingRunId || owner?.workspaceId !== workspace.id) continue
        const { metadata: _, ...session } = row
        openCode.sessions.push({ ...session, metadata: sanitize(metadata), database })
        const parts = db.prepare('SELECT id,message_id,session_id,time_created,time_updated,data FROM part WHERE session_id = ? ORDER BY time_created LIMIT 2001').all(row.id)
        if (parts.length > 2000) openCode.omissions.push({ sessionId: row.id, reason: 'part_count_bound' })
        for (const part of parts.slice(0, 2000)) {
          if (Buffer.byteLength(part.data) > 2 * 1024 * 1024) { openCode.omissions.push({ partId: part.id, reason: 'part_size_bound' }); continue }
          const data = JSON.parse(part.data)
          if (data.type !== 'tool') continue
          const toolState = data.state ?? {}, input = toolState.input ?? {}, metadata = toolState.metadata ?? {}
          const record = { partId: part.id, messageId: part.message_id, sessionId: part.session_id,
            callId: data.callID ?? null, tool: data.tool, status: toolState.status ?? null,
            timeCreated: part.time_created, timeUpdated: part.time_updated, time: toolState.time ?? null,
            inputKeys: Object.keys(input), inputDigest: sha(JSON.stringify(input)),
            output: toolState.output === undefined ? null : opaque(toolState.output),
            error: toolState.error === undefined ? null : opaque(toolState.error),
            errorCode: typeof toolState.error === 'string' ? toolState.error.match(/\bdevflow_[a-z_]{1,100}\b/)?.[0] ?? null : null,
            outputContainsBlockedToken: typeof toolState.output === 'string' ? /\bblocked\b/i.test(toolState.output) : null,
            metadata: selected(metadata, ['parentSessionId', 'sessionId', 'exit', 'truncated']),
            completedIsNotSuccessProof: true }
          if (typeof input.filePath === 'string') {
            const target = path.resolve(row.directory, input.filePath)
            record.file = target.startsWith(row.directory + path.sep) ? { relative: path.relative(row.directory, target) } : { outsideWorkspace: true, digest: sha(target) }
          }
          if (data.tool === 'task') record.childTask = selected(input, ['subagent_type', 'task_id'])
          if (data.tool === 'question') record.question = { count: Array.isArray(input.questions) ? input.questions.length : null,
            answersDigest: metadata.answers === undefined ? null : sha(JSON.stringify(metadata.answers)) }
          if (data.tool === 'bash') record.command = typeof input.command === 'string' ? opaque(input.command) : null
          if (data.tool === 'devflow_document') {
            record.documentRequestUrl = publicUrl(input.url)
            try {
              const document = JSON.parse(toolState.output)
              record.document = { sourceUrl: publicUrl(document.sourceUrl), finalUrl: publicUrl(document.finalUrl),
                redirects: Array.isArray(document.redirects) ? document.redirects.map(publicUrl) : Number.isSafeInteger(document.redirects) ? document.redirects : null,
                ...selected(document, ['contentType', 'bytes', 'truncated', 'trust']),
                text: typeof document.text === 'string' ? opaque(document.text) : null,
                dnsResolution: sanitize(document.dnsResolution) }
            } catch { record.documentOutputStructured = false }
          }
          openCode.tools.push(record)
        }
      }
      if (openCode.sessions.some(session => session.database === database)) openCode.databases.push({ path: database, pluginSha256: sha(pluginText), queryOnly: true })
    } catch (error) { openCode.omissions.push({ database, errorName: error.name }) }
    finally { db?.close() }
  }
  const stageTokens = state.agentUsage.reduce((sum, row) => sum + (row.inputTokens ?? 0) + (row.outputTokens ?? 0), 0)
  const aggregateCosts = state.codingRuns.flatMap(run => run.runtimeCostSummary ? [run.runtimeCostSummary] : [])
  const costs = state.codingRuns.flatMap(run => {
    const cost = run.runtimeCostSummary
    if (!cost) return []
    return run.engine === 'opencode-http' && cost.providerCallSettlements?.length
      ? cost.providerCallSettlements.map(call => ({ ...cost, ...call })) : [cost]
  })
  const eligible = costs.filter(cost => cost.costUsd !== null && cost.cacheReadTokens !== null &&
    cost.phase === 'provider_settlement' && cost.usageStatus === 'complete' && cost.costStatus === 'settled')
  const codingTokens = eligible.reduce((sum, cost) => sum + cost.inputTokens + cost.outputTokens, 0)
  const knownCodingTokens = aggregateCosts.reduce((sum, cost) => sum + (cost.inputTokens ?? 0) + (cost.outputTokens ?? 0), 0)
  const visibleTokenMatch = state.visibleUsage?.match(/([\d,]+)(?:\s|\s*\+)/)
  const visibleTokens = visibleTokenMatch ? Number(visibleTokenMatch[1].replaceAll(',', '')) : null
  const terminalCalls = [...calls.values()].filter(call => call.trace.status !== 'started')
  const providerTotals = terminalCalls.reduce((sum, call) => ({
    inputTokens: sum.inputTokens + (call.trace.usage?.inputTokens ?? 0),
    outputTokens: sum.outputTokens + (call.trace.usage?.outputTokens ?? 0),
    missingUsageCalls: sum.missingUsageCalls + (Number.isSafeInteger(call.trace.usage?.inputTokens) && Number.isSafeInteger(call.trace.usage?.outputTokens) ? 0 : 1),
  }), { inputTokens: 0, outputTokens: 0, missingUsageCalls: 0 })
  const usage = { stageTokens, completeCodingTokens: codingTokens, knownCodingTokensIncludingIncomplete: knownCodingTokens,
    expectedVisibleTokens: stageTokens + codingTokens, visibleTokens, visibleText: state.visibleUsage,
    matchesUiAggregation: visibleTokens === null ? null : visibleTokens === stageTokens + codingTokens,
    incompleteCostRows: costs.length - eligible.length, providerTotals,
    providerEvents: providerEvents.length, uniqueRequests: calls.size, terminalRequests: terminalCalls.length }
  const reconciliation = state.codingRuns.map(run => {
    const ownCalls = terminalCalls.filter(call => call.codingRunId === run.id)
    const knownInput = ownCalls.reduce((sum, call) => sum + (call.trace.usage?.inputTokens ?? 0), 0)
    const knownOutput = ownCalls.reduce((sum, call) => sum + (call.trace.usage?.outputTokens ?? 0), 0)
    const cost = run.runtimeCostSummary
    const sessions = openCode.sessions.filter(session => session.metadata?.devflow?.codingRunId === run.id)
    const scopes = [...new Set(ownCalls.map(call => call.scope.executorSessionId))].map(sessionId => {
      const stored = sessions.find(session => session.id === sessionId)
      const root = stored ? stored.parent_id ?? stored.id : null
      return { sessionId: sessionId ?? null, databaseSessionFound: !!stored, rootSessionId: root,
        storedParentId: stored?.parent_id ?? null, agent: stored?.agent ?? null,
        requests: ownCalls.filter(call => call.scope.executorSessionId === sessionId).length,
        scopeConsistent: stored ? ownCalls.filter(call => call.scope.executorSessionId === sessionId).every(call =>
          call.scope.parentSessionId === root && stored.metadata.devflow.workspaceId === run.managedWorkspaceId &&
          (!stored.parent_id || stored.metadata.devflow.rootSessionId === root)) : null }
    })
    return { codingRunId: run.id, knownInput, knownOutput, recordedInput: cost?.inputTokens ?? null,
      recordedOutput: cost?.outputTokens ?? null,
      knownUsageMatchesAggregate: cost ? knownInput === cost.inputTokens && knownOutput === cost.outputTokens : null,
      providerCallIdsCoverTerminalRequests: cost?.providerCallIds ? ownCalls.every(call => cost.providerCallIds.includes(call.trace.requestId)) : null,
      scopes }
  })
  const budgetData = JSON.parse(await readFile(path.resolve(ready.output, '../budget/ledger.json'), 'utf8'))
  assert.equal(budgetData.scope, 'devflow-b-20261023')
  const budget = { scope: budgetData.scope, capMicroyuan: budgetData.budget_microyuan, closed: budgetData.closed, blocked: budgetData.blocked,
    committedAndReservedMicroyuan: budgetData.calls.reduce((sum, call) => sum + (call.committed_microyuan ?? call.reserved_microyuan), 0),
    unknownCalls: budgetData.calls.filter(call => call.committed_microyuan === undefined).length,
    // The ledger does not store product request IDs; preserve it for time/usage comparison, never invent a binding.
    exactProductRequestIdBinding: false, calls: budgetData.calls }
  const testChecks = state.tests.map(test => inspectTestEvidence(test, { state, ready, source, worktrees }))
  let endState = null, finalSampleError = null
  try { endState = await collect() }
  catch (error) { finalSampleError = { name: error.name, rendererClosed: page.isClosed() } }
  const sequence = value => Math.max(0, ...value.codingEvents.map(event => event.sequence))
  const evidence = { recordedAt: new Date().toISOString(), sanitizerVersion: 2, label, runId: ready.runId, projectId: ready.projectId,
    snapshotWindow: { start: state.capturedAt, end: endState?.capturedAt ?? null, firstMaxEventSequence: sequence(state), lastMaxEventSequence: endState ? sequence(endState) : null,
      maximumEventSequenceUnchanged: endState ? sequence(state) === sequence(endState) : null, finalSampleError, atomic: false },
    state: sanitize(state), providerCalls: sanitize([...calls.values()]), usage, reconciliation, testChecks, budget, source, worktrees, openCode }
  if (previousFile) {
    const previous = JSON.parse(await readFile(previousFile, 'utf8'))
    assert.equal(previous.runId, ready.runId)
    evidence.previousComparison = { previousFile, sourceFilesUnchanged: JSON.stringify(previous.source.files) === JSON.stringify(source.files),
      worktrees: worktrees.map(tree => { const old = previous.worktrees.find(item => item.id === tree.id); return { id: tree.id,
        previousFound: !!old, filesUnchanged: old && tree.files && old.files ? JSON.stringify(old.files) === JSON.stringify(tree.files) : null,
        diffUnchanged: old?.diffSha256 && tree.diffSha256 ? old.diffSha256 === tree.diffSha256 : null } }) }
  }
  await writeFile(path.join(output, 'evidence.json'), JSON.stringify(evidence, null, 2), { mode: 0o600 })
  const summary = { output, runStatus: state.run.status,
    coding: state.codingRuns.map(run => ({ id: run.id, status: run.status, questionStatus: run.question?.status ?? null,
      receipts: run.questionReceipts?.length ?? 0, cost: selected(run.runtimeCostSummary, ['inputTokens', 'outputTokens', 'usageStatus', 'costStatus', 'costUsd']) })),
    usage, reconciliation, sourceMatchesBase: source.matchesBaseFiles ?? null, sourceClean: source.status === '',
    worktrees: worktrees.map(tree => ({ id: tree.id, unavailable: tree.unavailable ?? false, changedFiles: tree.status ?? null })),
    openCodeSessions: openCode.sessions.length, toolRecords: openCode.tools.length,
    documents: openCode.tools.filter(tool => tool.tool === 'devflow_document').map(tool => selected(tool, ['status', 'documentRequestUrl', 'document', 'error'])),
    permissions: state.permissions.map(item => selected(item, ['id', 'origin', 'permission', 'status'])),
    canonicalTests: testChecks.filter(test => test.canonicalWorkflowTest), codingHostStandardTests: testChecks.filter(test => test.codingHostStandardTest),
    otherTestEvidence: testChecks.filter(test => !test.canonicalWorkflowTest && !test.codingHostStandardTest),
    scopeGaps: [...calls.values()].filter(call => !call.scope.executorSessionId).map(call => call.trace.requestId),
    maximumEventSequenceUnchanged: evidence.snapshotWindow.maximumEventSequenceUnchanged,
    ...(evidence.previousComparison ? { previousComparison: evidence.previousComparison } : {}) }
  await writeFile(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2), { mode: 0o600 })
  console.log(JSON.stringify(summary, null, 2))
} finally { await browser.close() }
