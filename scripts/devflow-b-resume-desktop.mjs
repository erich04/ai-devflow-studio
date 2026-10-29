// Main Todo desktop only. Default --check is offline; --inspect is read-only live validation.
// Restart requires --restart --pid <exact Electron browser PID>; never stops API/Web or their owner.
// Default: preserve all workflow/coding/evidence state at the design Gate, or a quiescent failed build.
// --interrupt-coding <CodingRun.id>: require waiting_input + an owned pending question; after restart
// require termination, a settled old question, unchanged materials/worktrees, and no replayed/duplicate expense.
// Pass the same optional interruption flag to --inspect to verify its live preconditions without stopping.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const root = fileURLToPath(new URL('..', import.meta.url))
const exec = promisify(execFile)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const digest = value => createHash('sha256').update(value).digest('hex')
const bootstrap = path.join(root, 'scripts/devflow-b-electron-bootstrap.cjs')
const requireDesktop = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
const preservedEnvironment = ['DEVFLOW_DEPLOYMENT_PROFILE', 'DEVFLOW_ENABLE_DEMO_DATA', 'DEVFLOW_ENABLE_FAKE_RUNTIME',
  'DEVFLOW_LOCAL_AUTH_ENABLED', 'DEVFLOW_REQUIRE_AUTH', 'DEV_AUTH_ENABLED', 'DEVFLOW_OPENCODE_BIN',
  'DEVFLOW_WEB_APP_URL', 'DEVFLOW_API_BASE_URL', 'DEVFLOW_NEXT_DIST_DIR', 'DEVFLOW_B_HARNESS',
  'DEVFLOW_B_GATEWAY_CONFIG', 'DEVFLOW_USER_DATA_DIR', 'DEVFLOW_DATA_PROFILE_REGISTRY_PATH']
const activeCodingStatuses = ['queued', 'preparing', 'running', 'bootstrapping', 'applying', 'testing', 'waiting_input', 'waiting_permission']

export function parseArguments(args) {
  const [readyFile, mode = '--check', ...flags] = args
  assert(readyFile && ['--check', '--inspect', '--restart'].includes(mode), 'Provide ready.json and --check, --inspect or --restart')
  const options = {}
  for (let index = 0; index < flags.length; index += 2) {
    const flag = flags[index], value = flags[index + 1]
    assert(['--pid', '--interrupt-coding'].includes(flag) && value && !options[flag], 'Unknown, duplicate or incomplete option')
    options[flag] = value
  }
  assert(mode === '--restart' ? /^\d+$/.test(options['--pid']) : !options['--pid'], 'Only restart requires --pid PID')
  if (options['--interrupt-coding']) assert(/^[\w-]+$/.test(options['--interrupt-coding']), 'Provide an exact CodingRun.id')
  return { readyFile, mode, pid: Number(options['--pid']), interruptCodingRunId: options['--interrupt-coding'] }
}

export function assertRestartBefore(snapshot, interruptCodingRunId) {
  assert.equal(snapshot.otherActiveCodingIds.length, 0, 'Another Workflow Run has active coding')
  const active = snapshot.codingRuns.filter(run => activeCodingStatuses.includes(run.status))
  if (interruptCodingRunId) {
    const run = snapshot.codingRuns.find(run => run.id === interruptCodingRunId)
    assert(run?.engine === 'opencode-http' && run.status === 'waiting_input', 'Interruption requires the exact OpenCode Coding Run in waiting_input')
    assert(run.question?.status === 'pending' && run.question.codingRunId === run.id && run.question.managedWorkspaceId === run.managedWorkspaceId, 'An owned pending question is required')
    assert.equal(active.length, 1, 'Another coding operation is active')
    assert(snapshot.node.kind === 'task' && snapshot.node.stage === 'build' && run.nodeId === snapshot.currentNodeId, 'Question does not belong to the current build')
    assert(snapshot.workspaces.some(workspace => workspace.id === run.managedWorkspaceId && workspace.codingRunId === run.id && !workspace.deletedAt), 'Question workspace is missing')
    return 'interrupt-question'
  }
  assert.equal(active.length, 0, 'Active coding requires explicit --interrupt-coding')
  assert.equal(snapshot.inFlightRequestIds.length, 0, 'Provider requests are still active')
  if (snapshot.node.kind === 'gate' && snapshot.node.stage === 'design' && snapshot.node.status !== 'success') return 'design-gate-update'
  assert(snapshot.node.kind === 'task' && snapshot.node.stage === 'build' && snapshot.codingRuns.some(run => run.nodeId === snapshot.currentNodeId && run.status === 'failed'), 'Normal update requires the original design Gate or a failed build')
  return 'failed-build-update'
}

export function assertRestartAfter(before, after, interruptCodingRunId) {
  assert.equal(after.runId, before.runId, 'Workflow Run changed')
  assert.equal(after.currentNodeId, before.currentNodeId, 'Workflow unexpectedly advanced')
  assert.equal(after.materialDigest, before.materialDigest, 'Workflow materials changed')
  assert.deepEqual(after.workspaces, before.workspaces, 'Managed worktree identity or retention changed')
  if (!interruptCodingRunId) {
    assert.equal(after.preservedStateDigest, before.preservedStateDigest, 'Original workflow/coding/evidence state changed')
    return
  }
  const original = before.codingRuns.find(run => run.id === interruptCodingRunId)
  const recovered = after.codingRuns.find(run => run.id === interruptCodingRunId)
  assert.deepEqual(after.codingRuns.map(run => run.id).sort(), before.codingRuns.map(run => run.id).sort(), 'Recovery created or lost a Coding Run')
  assert.deepEqual(after.codingRuns.filter(run => run.id !== interruptCodingRunId), before.codingRuns.filter(run => run.id !== interruptCodingRunId), 'Recovery changed another Coding Run')
  assert(original && recovered && ['failed', 'cancelled', 'timed_out'].includes(recovered.status), 'Interrupted Coding Run did not terminate')
  assert.equal(recovered.managedWorkspaceId, original.managedWorkspaceId)
  assert.equal(recovered.question?.id, original.question.id, 'Original question was lost or replaced')
  assert(!['pending', 'sending'].includes(recovered.question?.status) && recovered.question?.settledAt, 'Old question remains actionable')
  assert.equal(after.inFlightRequestIds.length, 0, 'Recovered provider request is still active')
  assert.deepEqual(after.providerCalls.map(call => call.requestId).sort(), before.providerCalls.map(call => call.requestId).sort(), 'A provider request was replayed, started or lost during recovery')
  for (const [id, receipt] of Object.entries(before.terminalReceipts)) assert.equal(after.terminalReceipts[id], receipt, 'Previously terminal provider evidence changed')
  const summary = recovered.runtimeCostSummary
  const calls = after.providerCalls.filter(call => call.codingRunId === recovered.id && call.status !== 'started' && call.billingState !== 'not_incurred')
  const ids = calls.map(call => call.requestId)
  assert.equal(new Set(ids).size, ids.length, 'Duplicate terminal provider call')
  assert.deepEqual([...(summary?.providerCallIds ?? [])].sort(), ids.sort(), 'Usage projection lost or duplicated a provider call')
  const attempts = calls.flatMap(call => call.usage?.budgetAttemptIds ?? [])
  assert.equal(new Set(attempts).size, attempts.length, 'A budget attempt was charged more than once')
  assert.deepEqual([...(summary?.budgetAttemptIds ?? [])].sort(), attempts.sort(), 'Budget attribution was lost or duplicated')
  const observed = value => Number.isSafeInteger(value) && value >= 0 ? value : 0
  for (const field of ['inputTokens', 'outputTokens']) assert.equal(summary?.[field] ?? 0, calls.reduce((sum, call) => sum + observed(call.usage?.[field]), 0), `Observed ${field} changed or was counted twice`)
  for (const id of original.runtimeCostSummary?.providerCallIds ?? []) assert(summary?.providerCallIds?.includes(id), 'Previous expense disappeared')
  if (calls.some(call => call.usage?.usageCompleteness === 'partial' || call.usage?.inputTokens === undefined || call.usage?.outputTokens === undefined)) {
    assert.equal(summary?.costStatus, 'unknown', 'Incomplete usage was presented as a settled charge')
    assert.equal(summary?.costUsd, null)
  }
  if (!before.inFlightRequestIds.length) assert.deepEqual(summary, original.runtimeCostSummary, 'Quiescent expenses changed across recovery')
}

export function validateDescriptor(ready, readyFile, repository = root) {
  const output = path.resolve(ready.output ?? '')
  const stamp = /^opencode-(\d+)$/.exec(path.basename(output))?.[1]
  assert(stamp && ready.scenario === 'opencode', 'Only the isolated main Todo scenario is allowed')
  assert.equal(path.dirname(output), path.join(repository, '.tmp/devflow-b-20261023'))
  assert.equal(ready.schema, `b_live_${stamp}`)
  assert.equal(path.resolve(readyFile), path.join(output, 'ready.json'))
  for (const [key, name] of Object.entries({ profile: 'profile', repo: 'todo', gatewayConfig: 'gateway.json' })) {
    assert.equal(ready[key], path.join(output, name), `Unexpected ${key}`)
  }
  const ports = []
  for (const key of ['apiUrl', 'webUrl', 'cdpUrl']) {
    const url = new URL(ready[key])
    assert(url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.pathname === '/' && !url.username && !url.password && !url.search && !url.hash)
    assert(/^\d+$/.test(url.port) && Number(url.port) > 1024 && Number(url.port) <= 65535)
    ports.push(Number(url.port))
  }
  assert.equal(new Set(ports).size, ports.length, 'Service ports must be distinct')
  for (const key of ['runId', 'projectId']) assert(typeof ready[key] === 'string' && /^[\w-]+$/.test(ready[key]))
  return { ...ready, profileFingerprint: digest(path.resolve(ready.profile)).slice(0, 16) }
}

export function assertProcessEvidence({ ready, pid, cdpPid, owners, executable, expectedExecutable, command, environment, bootstrapPath = bootstrap }) {
  assert(Number.isSafeInteger(pid) && pid > 1, 'Provide an exact Electron PID')
  assert.equal(cdpPid, pid, 'CDP browser PID differs from the requested process')
  assert.deepEqual(owners, [pid], 'CDP port is not owned solely by the requested Electron')
  assert.equal(executable, expectedExecutable, 'Target is not this checkout’s Electron executable')
  const argument = text => command.split(/\s+/).includes(text)
  assert(argument(bootstrapPath), 'Target is not the B verification bootstrap')
  assert(argument(`--remote-debugging-port=${new URL(ready.cdpUrl).port}`), 'Unexpected CDP argument')
  assert.equal(environment.DEVFLOW_B_HARNESS, '1')
  assert.equal(environment.DEVFLOW_USER_DATA_DIR, ready.profile, 'Target has another profile')
  assert.equal(environment.DEVFLOW_B_GATEWAY_CONFIG, ready.gatewayConfig, 'Target has another ledger gateway')
  assert.equal(environment.DEVFLOW_DATA_PROFILE_REGISTRY_PATH, path.join(ready.output, 'profiles.json'))
  assert.equal(environment.DEVFLOW_API_BASE_URL, ready.apiUrl)
}

async function commandOutput(program, args) {
  try { return (await exec(program, args, { maxBuffer: 4 * 1024 * 1024 })).stdout.trim() }
  catch { throw Error(`Unable to inspect process with ${program}; no process was stopped`) }
}
async function owners(url) {
  const port = new URL(url).port
  const output = await commandOutput('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'])
  const pids = [...new Set(output.split(/\s+/).map(Number))].sort((a, b) => a - b)
  assert(pids.length && pids.every(pid => Number.isSafeInteger(pid) && pid > 1), 'Missing listener identity')
  return pids
}
async function processEvidence(ready, pid, cdpPid) {
  const command = await commandOutput('ps', ['-ww', '-p', String(pid), '-o', 'command='])
  const executable = await commandOutput('ps', ['-ww', '-p', String(pid), '-o', 'comm='])
  // Read only this positively identified fixture process. Never log the environment (it can contain secrets).
  assert.equal(await realpath(executable), await realpath(requireDesktop('electron')))
  assert(command.includes(bootstrap), 'Not the B bootstrap process')
  const raw = await commandOutput('ps', ['eww', '-p', String(pid), '-o', 'command='])
  const environment = {}
  for (const name of preservedEnvironment) {
    const matches = [...raw.matchAll(new RegExp(`(?:^| )${name}=(.*?)(?= [A-Za-z_][A-Za-z0-9_]*=|$)`, 'g'))]
    assert(matches.length <= 1, `Ambiguous ${name}`)
    if (matches.length) environment[name] = matches[0][1]
  }
  assertProcessEvidence({ ready, pid, cdpPid, owners: await owners(ready.cdpUrl), executable: await realpath(executable),
    expectedExecutable: await realpath(requireDesktop('electron')), command, environment })
  return { environment, started: await commandOutput('ps', ['-p', String(pid), '-o', 'lstart=']) }
}
async function healthy(ready) {
  for (const [url, endpoint] of [[ready.apiUrl, '/ready'], [ready.webUrl, '/health']]) {
    assert((await fetch(new URL(endpoint, url), { signal: AbortSignal.timeout(5000), redirect: 'error' })).ok, `Existing service unavailable: ${url}`)
  }
  return { api: await owners(ready.apiUrl), web: await owners(ready.webUrl) }
}
async function connect(ready) {
  const { chromium } = await import('@playwright/test')
  const version = await (await fetch(new URL('/json/version', ready.cdpUrl), { signal: AbortSignal.timeout(5000) })).json()
  const socket = new URL(version.webSocketDebuggerUrl)
  assert(socket.protocol === 'ws:' && socket.hostname === '127.0.0.1' && socket.port === new URL(ready.cdpUrl).port)
  return chromium.connectOverCDP(socket.href)
}
async function snapshot(browser, ready) {
  const cdp = await browser.newBrowserCDPSession()
  const info = await cdp.send('SystemInfo.getProcessInfo'); await cdp.detach()
  const pid = info.processInfo.find(process => process.type === 'browser')?.id
  const page = browser.contexts().flatMap(context => context.pages()).find(page => page.url().startsWith('file:') && page.url().endsWith('/index.html'))
  assert(page, 'Real Electron renderer is missing')
  const evidence = await page.evaluate(async ready => {
    const api = window.aiDevFlowDesktop
    if (!api) throw Error('Real preload is missing')
    const [state, profile] = await Promise.all([api.loadState(), api.loadDataProfileDiagnostics()])
    const run = state.runs.find(run => run.id === ready.runId)
    const project = state.projects.find(project => project.id === ready.projectId)
    if (!run || run.projectId !== ready.projectId || project?.path !== ready.repo) throw Error('Original Todo Run/project is missing')
    const node = run.nodes.find(node => node.id === run.currentNodeId)
    if (!node) throw Error('Current workflow node is missing')
    const artifacts = state.artifacts.filter(artifact => artifact.runId === run.id).sort((a, b) => a.id.localeCompare(b.id))
    if (!artifacts.some(artifact => artifact.kind === 'design')) throw Error('Saved design material is missing')
    const codingRuns = state.codingRuns.filter(coding => coding.runId === run.id).sort((a, b) => a.id.localeCompare(b.id))
    if (codingRuns.some(coding => coding.projectId !== ready.projectId)) throw Error('Coding project scope mismatch')
    const codingIds = new Set(codingRuns.map(coding => coding.id))
    const codingEvents = state.codingEvents.filter(event => codingIds.has(event.codingRunId))
    const workspaces = state.managedCodingWorkspaces.filter(workspace => codingIds.has(workspace.codingRunId))
      .map(workspace => ({ id: workspace.id, codingRunId: workspace.codingRunId, projectId: workspace.projectId,
        worktreePath: workspace.worktreePath, branchName: workspace.branchName, cleanupStatus: workspace.cleanupStatus,
        deletedAt: workspace.deletedAt })).sort((a, b) => a.id.localeCompare(b.id))
    const providerCalls = codingEvents.flatMap(event => event.metadata?.providerCall ? [event.metadata.providerCall] : [])
    const terminalIds = new Set(providerCalls.filter(call => call.status !== 'started').map(call => call.requestId))
    return { profileFingerprint: profile.pathFingerprint, runId: run.id, currentNodeId: run.currentNodeId,
      node: { id: node.id, kind: node.kind, stage: node.stage, status: node.status, artifactIds: node.artifactIds },
      artifacts, codingRuns, workspaces, providerCalls,
      otherActiveCodingIds: state.codingRuns.filter(coding => coding.runId !== run.id && ['queued','preparing','running','bootstrapping','applying','testing','waiting_input','waiting_permission'].includes(coding.status)).map(coding => coding.id),
      inFlightRequestIds: [...new Set(providerCalls.filter(call => call.status === 'started' && !terminalIds.has(call.requestId)).map(call => call.requestId))],
      preserved: { run, artifacts, codingRuns, codingEvents, workspaces,
        permissions: state.codingPermissionRequests.filter(permission => codingIds.has(permission.codingRunId)),
        tests: state.testEvidence.filter(test => test.runId === run.id), diffs: state.codingDiffArtifacts.filter(diff => diff.runId === run.id) } }
  }, ready)
  assert.equal(evidence.profileFingerprint, ready.profileFingerprint, 'CDP belongs to another application profile')
  // Check only this profile's retained worktrees; never follow a path into a user checkout.
  const worktreeRoot = path.join(ready.profile, 'coding-worktrees')
  for (const workspace of evidence.workspaces) {
    assert.equal(workspace.projectId, ready.projectId)
    assert(workspace.worktreePath.startsWith(worktreeRoot + path.sep), 'Workspace escaped the isolated profile')
    if (!workspace.deletedAt) {
      assert.equal(await realpath(workspace.worktreePath), workspace.worktreePath, 'Workspace path was replaced')
      await access(path.join(workspace.worktreePath, '.git'))
    }
  }
  const terminalReceipts = {}
  const calls = new Map()
  for (const call of evidence.providerCalls) {
    if (call.status !== 'started') terminalReceipts[call.requestId] = digest(JSON.stringify(call))
    if (call.status !== 'started' || !calls.has(call.requestId)) calls.set(call.requestId, call)
  }
  return { pid, runId: evidence.runId, currentNodeId: evidence.currentNodeId, node: evidence.node,
    materialDigest: digest(JSON.stringify(evidence.artifacts)), preservedStateDigest: digest(JSON.stringify(evidence.preserved)),
    codingRuns: evidence.codingRuns, workspaces: evidence.workspaces, inFlightRequestIds: evidence.inFlightRequestIds, otherActiveCodingIds: evidence.otherActiveCodingIds,
    providerCalls: [...calls.values()], terminalReceipts }
}

function reportSnapshot(snapshot) {
  return { pid: snapshot.pid, runId: snapshot.runId, currentNodeId: snapshot.currentNodeId, node: snapshot.node,
    materialDigest: snapshot.materialDigest, preservedStateDigest: snapshot.preservedStateDigest,
    codingRuns: snapshot.codingRuns.map(run => ({ id: run.id, status: run.status, managedWorkspaceId: run.managedWorkspaceId,
      question: run.question ? { id: run.question.id, status: run.question.status } : undefined, runtimeCostSummary: run.runtimeCostSummary })),
    workspaces: snapshot.workspaces, inFlightRequestIds: snapshot.inFlightRequestIds, terminalReceipts: snapshot.terminalReceipts }
}

export async function main(args = process.argv.slice(2)) {
  const { readyFile, mode, pid: requestedPid, interruptCodingRunId } = parseArguments(args)
  const ready = validateDescriptor(JSON.parse(await readFile(readyFile, 'utf8')), readyFile)
  for (const item of [ready.output, ready.profile, ready.repo, ready.gatewayConfig, readyFile]) assert.equal(await realpath(item), item, 'Isolated fixture paths must not be symlinked')
  const gatewayBytes = await readFile(ready.gatewayConfig), gateway = JSON.parse(gatewayBytes)
  if (gateway.url) { const url = new URL(gateway.url); assert(url.protocol === 'http:' && url.hostname === '127.0.0.1' && !url.username && !url.password && !url.search && !url.hash) }
  const bundle = path.join(root, 'apps/desktop/dist-electron/main.js')
  const bundleBytes = await readFile(bundle); await access(path.join(root, 'apps/desktop/dist/index.html'))
  const bundleHash = digest(bundleBytes)
  if (mode === '--check') {
    console.log(JSON.stringify({ checked: true, offline: true, runId: ready.runId, profile: ready.profile, schema: ready.schema,
      cdpUrl: ready.cdpUrl, interruptCodingRunId, bundleHash, bundleModifiedAt: (await stat(bundle)).mtime.toISOString(), modelCallsStarted: 0 }))
    return
  }
  assert(process.platform === 'darwin', 'Live process verification currently supports this macOS fixture only')
  const servicePids = await healthy(ready)
  let browser = await connect(ready), desktop
  try {
    let before = await snapshot(browser, ready)
    const expectation = assertRestartBefore(before, interruptCodingRunId)
    const pid = mode === '--restart' ? requestedPid : before.pid
    const evidence = await processEvidence(ready, pid, before.pid)
    if (mode === '--inspect') {
      console.log(JSON.stringify({ inspected: true, expectation, ...reportSnapshot(before), profile: ready.profile, servicePids, modelCallsStarted: 0 }))
      return
    }
    // Recheck immediately before the only signal; PID reuse or changed scope fails closed.
    const rechecked = await processEvidence(ready, pid, before.pid)
    assert.equal(rechecked.started, evidence.started)
    assert.deepEqual(await healthy(ready), servicePids)
    assert.equal(digest(await readFile(bundle)), bundleHash, 'Build changed during preflight')
    const last = await snapshot(browser, ready)
    assert.equal(assertRestartBefore(last, interruptCodingRunId), expectation)
    assert.equal(last.materialDigest, before.materialDigest)
    if (interruptCodingRunId) {
      const original = before.codingRuns.find(run => run.id === interruptCodingRunId)
      const current = last.codingRuns.find(run => run.id === interruptCodingRunId)
      assert.equal(current.question.id, original.question.id, 'Question changed during restart preflight')
    } else assert.equal(last.preservedStateDigest, before.preservedStateDigest, 'State changed during restart preflight')
    before = last
    await writeFile(path.join(ready.output, `desktop-restart-before-${Date.now()}.json`), JSON.stringify({ expectation, ...reportSnapshot(before) }, null, 2), { mode: 0o600 })
    await browser.close(); browser = undefined
    process.kill(pid, 'SIGTERM') // Exact browser PID only; never a group, service, or parent controller.
    let stopped = false
    for (let attempt = 0; attempt < 100; attempt++) {
      try { process.kill(pid, 0) } catch (error) { if (error.code === 'ESRCH') { stopped = true; break } throw error }
      await sleep(100)
    }
    assert(stopped, 'Electron did not stop; no force kill or new process was attempted')
    try { await fetch(new URL('/json/version', ready.cdpUrl), { signal: AbortSignal.timeout(1000) }); throw Error('CDP port was replaced; refusing to launch') }
    catch (error) { if (error.message === 'CDP port was replaced; refusing to launch') throw error }
    assert.deepEqual(await healthy(ready), servicePids)
    assert.equal(digest(await readFile(ready.gatewayConfig)), digest(gatewayBytes), 'Gateway changed during restart')
    const env = { ...process.env }
    for (const name of Object.keys(env)) if (/^(?:DEVFLOW_|DEV_AUTH_|NEXT_PUBLIC_DEVFLOW_)/.test(name)) delete env[name]
    Object.assign(env, evidence.environment)
    delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL
    const { _electron: electron } = await import('@playwright/test')
    desktop = await electron.launch({ executablePath: requireDesktop('electron'), cwd: path.join(root, 'apps/desktop'),
      args: [bootstrap, `--remote-debugging-port=${new URL(ready.cdpUrl).port}`], env })
    await (await desktop.firstWindow()).waitForLoadState('domcontentloaded')
    for (let attempt = 0; attempt < 100; attempt++) {
      try { browser = await connect(ready); break } catch { await sleep(100) }
    }
    assert(browser, 'Restarted desktop CDP did not become ready')
    let after = await snapshot(browser, ready)
    if (interruptCodingRunId) {
      for (let attempt = 0; attempt < 100 && activeCodingStatuses.includes(after.codingRuns.find(run => run.id === interruptCodingRunId)?.status); attempt++) {
        await sleep(100); after = await snapshot(browser, ready)
      }
    }
    assertRestartAfter(before, after, interruptCodingRunId)
    await processEvidence(ready, after.pid, after.pid)
    assert.deepEqual(await healthy(ready), servicePids)
    assert.equal(digest(await readFile(ready.gatewayConfig)), digest(gatewayBytes))
    await browser.close(); browser = undefined
    const report = { resumed: true, expectation, interruptCodingRunId, previousPid: pid, ...reportSnapshot(after),
      profile: ready.profile, schema: ready.schema, cdpUrl: ready.cdpUrl, bundleHash, servicePids, modelCallsStarted: 0, at: new Date().toISOString() }
    await writeFile(path.join(ready.output, 'desktop-only-resume.json'), JSON.stringify(report, null, 2), { mode: 0o600 })
    console.log(JSON.stringify(report))
    // Keep this launcher alive. Ctrl-C closes only its own replacement Electron; no shared STOP file.
    await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); desktop.process().once('exit', resolve) })
  } finally { await browser?.close().catch(() => {}); await desktop?.close().catch(() => {}) }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(JSON.stringify({ error: String(error.message), modelCallsStarted: 0 })); process.exitCode = 1 })
}
