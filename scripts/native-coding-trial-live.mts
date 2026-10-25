/** One isolated, paid trial through production CodingRuntime and governed executors. */
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { AgentProviderRequestError, createOpenAiCompatibleAgentProvider, governAgentProvider, type AgentProvider, type WorkflowRun, type CodingHarnessCommand, type CodingHarnessSnapshot, type CodingPermissionRequest } from '../packages/shared/src/index.ts'
import { createLocalStore } from '../apps/desktop/electron/local-store.ts'
import { createCodingRuntime } from '../apps/desktop/electron/coding-runtime.ts'
import { createNativeCodingExecutorV2, createAgentProviderNativeCodingV2DecisionProvider } from '../apps/desktop/electron/native-coding-executor-v2.ts'
import { createNativeCodingExecutorV3 } from '../apps/desktop/electron/native-coding-harness.ts'
import { createOpencodeHttpCodingEngineAdapter } from '../apps/desktop/electron/opencode-http-engine.ts'
import { createOpencodeProcessManager } from '../apps/desktop/electron/opencode-process.ts'
import { buildOpencodeRuntimeEnv } from '../apps/desktop/electron/coding-engine.ts'
import { isolatedOpencodeProfileEnv } from '../apps/desktop/electron/opencode-profile-isolation.ts'
import { createGovernedOpencodeProxy } from '../apps/desktop/electron/governed-opencode-proxy.ts'
import { runLocalTestCommand } from '../apps/desktop/electron/test-runner.ts'
import { createWorkflowRuntime } from '../apps/desktop/electron/workflow-runtime.ts'
import { createEvaluationLedger, evaluationUsage, saveJson, digest } from './native-coding-live-support.ts'
import { handleEvaluationChildControls } from './native-coding-live-operator.ts'

export type TrialInput = { id: string; engine: 'native-v2' | 'native-v3' | 'opencode'; repository: string; output: string; prompt: string; testCommand: string; maxCalls: number; maxCostUsd: number; maxSteps: number; maxActiveMilliseconds: number; maxOutputTokens: number; opencodeBinary: string; questionAnswer?: string; roundRoot?: string; scopeId?: string }
export async function runLiveTrial(input: TrialInput, apiKey: string) {
  const start = Date.now(), now = () => new Date().toISOString(), projectId = 'evaluation-project', providerId = 'deepseek-evaluation'
  const ledger = await createEvaluationLedger({ file: path.join(input.output, 'ledger.json'), projectId, maxCalls: input.maxCalls, maxCostUsd: input.maxCostUsd,
    ...(input.roundRoot ? { roundRoot: input.roundRoot } : {}), ...(input.scopeId ? { scopeId: input.scopeId } : {}) })
  await mkdir(input.output)
  const store = await createLocalStore({ dbPath: path.join(input.output, 'devflow.sqlite') })
  const project = { id: projectId, name: 'Authorized Native comparison', path: input.repository, packageManager: 'pnpm' as const, testCommand: input.testCommand, createdAt: now(), updatedAt: now() }
  await store.upsertProject(project)
  const observations: Array<Record<string, unknown>> = [], actions: Array<Record<string, unknown>> = []
  const deadlineAbort = new AbortController()
  const deadlineSignal = (signal?: AbortSignal | null) => signal ? AbortSignal.any([signal, deadlineAbort.signal]) : deadlineAbort.signal
  let providerUnavailable: { httpStatus: number; at: string } | undefined
  const providerFetch: typeof fetch = async (url, init) => {
    const response = await fetch(url, { ...init, redirect: 'error', signal: deadlineSignal(init?.signal) })
    if (response.status === 401 || response.status === 402) {
      providerUnavailable = { httpStatus: response.status, at: now() }
      await saveJson(path.join(input.output, 'provider-availability.json'), providerUnavailable)
      if ('seal' in ledger) await ledger.seal()
    }
    return response
  }
  const runBoundedTest: typeof runLocalTestCommand = value => runLocalTestCommand({ ...value, signal: deadlineSignal(value.signal) })
  const redact = (text: string) => text.replaceAll(apiKey, '[redacted]')
  const raw = createOpenAiCompatibleAgentProvider({ id: providerId, name: 'DeepSeek V4.1 Flash', model: 'deepseek-flash', apiKey, baseUrl: 'https://api.deepseek.com', thinking: { mode: 'enabled', effort: 'high' }, structuredRequestTimeoutMs: 180000, fetcher: providerFetch })
  const capped: AgentProvider = { ...raw, resolveRequestPolicy: value => raw.resolveRequestPolicy!({ ...value, maxOutputTokens: Math.min(value.maxOutputTokens ?? input.maxOutputTokens, input.maxOutputTokens) }) }
  const governed = governAgentProvider(capped, projectId, ledger)
  const observe = async <T,>(kind: string, request: unknown, call: () => Promise<T>): Promise<T> => {
    const index = observations.length, record: Record<string, unknown> = { index, kind, startedAt: now(), request }; observations.push(record)
    await saveJson(path.join(input.output, `model-${index}.json`), record)
    try { const value = await call(); record.result = value; return value }
    catch (error) { record.error = redact(error instanceof Error ? error.message : String(error)); if (error instanceof AgentProviderRequestError) record.providerError = { code: error.code, deliveryState: error.deliveryState, billingState: error.billingState, sanitizedCause: error.sanitizedCause, responseMetadata: error.responseMetadata, usage: error.usage }; throw error }
    finally { record.completedAt = now(); await saveJson(path.join(input.output, `model-${index}.json`), JSON.parse(redact(JSON.stringify(record)))) }
  }
  const provider: AgentProvider = { ...governed,
    completeNativeConversation: request => observe('native-tools', { ...request, signal: undefined }, () => governed.completeNativeConversation!(request)),
    completeStructuredJson: request => observe('structured', { ...request, signal: undefined }, () => governed.completeStructuredJson!(request)) }
  let native: ReturnType<typeof createNativeCodingExecutorV3> | undefined
  let relay: Awaited<ReturnType<typeof createGovernedOpencodeProxy>> | undefined
  const manager = createOpencodeProcessManager()
  let engine: ReturnType<typeof createOpencodeHttpCodingEngineAdapter> | undefined
  let executor: ReturnType<typeof createNativeCodingExecutorV2> | ReturnType<typeof createNativeCodingExecutorV3> | undefined
  if (input.engine === 'native-v3') executor = native = createNativeCodingExecutorV3({ store, provider, root: path.join(input.output, 'harness'), configVersion: 1 })
  else if (input.engine === 'native-v2') executor = createNativeCodingExecutorV2({ store, decisionProvider: createAgentProviderNativeCodingV2DecisionProvider(provider), configVersion: 1, runSavedTest: runBoundedTest, testTimeoutMs: 300000 })
  else {
    relay = await createGovernedOpencodeProxy({ binding: { providerId, modelId: 'deepseek-flash', baseUrl: 'https://api.deepseek.com', apiKey, fingerprint: digest('frozen-deepseek-flash-high') }, projectId, governance: ledger, maxOutputTokens: input.maxOutputTokens,
      fetcher: async (url, init) => { const body = JSON.parse(String(init?.body)); await writeFile(path.join(input.output, `opencode-request-${observations.length}.json`), redact(JSON.stringify(body)), { mode: 0o600 }); observations.push({ kind: 'opencode', startedAt: now() }); return providerFetch(url, init) } })
    const env = buildOpencodeRuntimeEnv({ baseEnv: process.env, apiKeyEnvName: 'OPENCODE_API_KEY', providerBinding: relay.binding })
    const config = JSON.parse(env.OPENCODE_CONFIG_CONTENT!)
    config.provider[providerId].models['deepseek-flash'] = { name: 'DeepSeek V4.1 Flash', limit: { context: 1048576, output: input.maxOutputTokens }, options: { thinking: { type: 'enabled' }, reasoningEffort: 'high' } }
    env.OPENCODE_CONFIG_CONTENT = JSON.stringify(config)
    engine = createOpencodeHttpCodingEngineAdapter({ binaryPath: input.opencodeBinary, providerID: providerId, modelID: 'deepseek-flash', processManager: manager, configurationFingerprint: 'frozen-evaluation-1', requireExecutionAuthorization: true, permissionDiscoveryTimeoutMs: 180000, runtimeEnv: { ...env, ...isolatedOpencodeProfileEnv(path.join(input.output, 'opencode-profile')) } })
  }
  const workflow = createWorkflowRuntime(store)
  const coding = createCodingRuntime({ store, ...(executor ? { executor } : { engine: engine! }), worktreeRoot: path.join(input.output, 'worktrees'), runTestCommand: runBoundedTest, testTimeoutMs: 300000,
    completeWorkflowBuild: async ({ runId, nodeId, codingRunId, diffId, now: timestamp }) => {
      const events = await store.listEvents(runId)
      const result = await workflow.execute({ runId, command: { type: 'complete_build', nodeId, codingRunId, diffId }, candidates: { events: [{ id: `completed-${codingRunId}`, runId, nodeId, sequence: events.length + 1, kind: 'file_change', message: 'Isolated evaluated coding completion.', timestamp }] }, now: timestamp })
      if (!result.applied) throw new Error(`Workflow rejected completion: ${result.blockers.map(item => item.code).join(',')}`)
    },
    budgetGuard: async () => ({ status: 'allowed', blocksRun: false, currentSpendUsd: evaluationUsage(ledger.records()).knownCostUsd, projectedCostUsd: 0, limitUsd: input.maxCostUsd, reason: 'Explicitly authorized isolated evaluation; each actual call is separately admitted and settled.' }) })
  const run: WorkflowRun = { id: 'evaluation', version: 1, title: 'Implement the supplied behavior', request: input.prompt, projectId, creatorId: 'evaluation-operator', status: 'building', currentNodeId: 'evaluation-build', branchName: 'evaluation/change', createdAt: now(), updatedAt: now(),
    nodes: [{ id: 'evaluation-design', stage: 'design', title: 'Supplied acceptance requirement', subtitle: '', kind: 'task', status: 'success', ownerId: 'evaluation-operator', retryCount: 0, artifactIds: ['evaluation-design-artifact'] }, { id: 'evaluation-build', stage: 'build', title: 'Implement', subtitle: '', kind: 'task', status: 'running', ownerId: 'evaluation-operator', retryCount: 0, artifactIds: [] }, { id: 'evaluation-test', stage: 'test', title: 'Test', subtitle: '', kind: 'test', status: 'pending', ownerId: 'evaluation-operator', retryCount: 0, artifactIds: [] }], edges: [{ id: 'build-to-test', source: 'evaluation-build', target: 'evaluation-test', kind: 'normal' }] }
  await store.saveRun(run)
  await store.saveArtifact({ id: 'evaluation-design-artifact', runId: run.id, nodeId: 'evaluation-design', kind: 'design', title: 'Behavioral requirement', summary: input.prompt, content: input.prompt, redacted: true, updatedAt: now() })
  await saveJson(path.join(input.output, 'input.json'), input)
  let codingRunId: string | undefined, failure: string | undefined, finalSnapshot: CodingHarnessSnapshot | undefined
  let actionWrites = Promise.resolve(), deadlineExpired = false, deadlineCleanup: Promise<void> | undefined
  const recordAction = async (action: Record<string, unknown>) => { actions.push({ at: now(), ...action }); const next = actionWrites.then(() => saveJson(path.join(input.output, 'operator-actions.json'), actions)); actionWrites = next.catch(() => {}); await next }
  // The product's cumulative active-time allowance is not the benchmark wall
  // deadline. Stop actual model I/O, owned processes and verification at this
  // separate operator boundary, even while settled() is awaiting a long batch.
  const deadlineTimer = setTimeout(() => {
    deadlineExpired = true; deadlineAbort.abort(new Error('Frozen evaluation wall-time deadline'))
    deadlineCleanup = (async () => {
      await recordAction({ type: 'evaluation_deadline', maxActiveMilliseconds: input.maxActiveMilliseconds })
      await native?.shutdown(); await manager.stopAll()
    })().catch(error => { failure = redact(`Deadline cleanup: ${String(error)}`) })
  }, Math.max(1, input.maxActiveMilliseconds - (Date.now() - start)))
  function legacyDecision(permission: CodingPermissionRequest): 'approved' | 'rejected' {
    const origin = permission.origin ?? 'coding_executor'
    if (origin === 'execution_authorization' || origin === 'change_acceptance' || origin === 'dependency_bootstrap' || ['edit', 'write', 'patch', 'workspace_edit'].includes(permission.permission)) return 'approved'
    // Use the installed integration's path/permission policy. No external access grant.
    const command = permission.command ?? ''
    return permission.permission === 'bash' && /^(?:rg|grep|cat|ls|find|pwd|git (?:status|diff|ls-files)|corepack pnpm (?:exec vitest|test)|pnpm (?:exec vitest|test)|npm test)\b/u.test(command) && !/[;&|`$<>]/u.test(command) ? 'approved' : 'rejected'
  }
  try {
    const started = await coding.runCodingAgent({ runId: run.id, nodeId: run.currentNodeId, projectId, requestedBy: run.creatorId, userInstruction: input.prompt }); codingRunId = started.codingRun.id
    if (native) {
      const get = (target = codingRunId!) => coding.codingHarnessCommand({ protocolVersion: 2, type: 'get', codingRunId: target })
      const command = async (body: Record<string, unknown>, target = codingRunId!) => { const snapshot = await get(target); const value = { protocolVersion: 2, codingRunId: target, commandId: `operator-${actions.length}`, expectedVersion: snapshot.version, ...body } as CodingHarnessCommand; await recordAction({ command: value }); return coding.codingHarnessCommand(value) }
      await command({ type: 'authorize', profile: 'trusted_local' })
      let answered = false
      while (!deadlineExpired) {
        await native.settled(codingRunId)
        const snapshot = await get(); finalSnapshot = snapshot
        await saveJson(path.join(input.output, 'snapshot.json'), snapshot)
        const childControls = await handleEvaluationChildControls(snapshot, { get, command })
        if (childControls.unansweredChild) { failure = `unanswered_child_question:${childControls.unansweredChild}`; break }
        if (childControls.handled) continue
        if (snapshot.status === 'review' && snapshot.revision) {
          // Approval permits verification only. The independent evaluator still judges correctness.
          await command({ type: 'approve', revisionDigest: snapshot.revision.digest, objectiveVersion: snapshot.objectiveVersion, confirmedCriteria: [] }); continue
        }
        if (snapshot.status === 'waiting_input' && snapshot.question && input.questionAnswer && !answered) { answered = true; await command({ type: 'reply', questionId: snapshot.question.id, objectiveVersion: snapshot.objectiveVersion, text: input.questionAnswer }); continue }
        if (snapshot.status === 'waiting_permission' && snapshot.permission) { await command({ type: 'permission', permissionId: snapshot.permission.id, decision: 'rejected' }); continue }
        if (['running', 'ready', 'waiting_task'].includes(snapshot.status)) { await new Promise(resolve => setTimeout(resolve, 100)); continue }
        break
      }
    } else {
      for (let index = 0; index < 100; index++) {
        if (deadlineExpired) break
        const current = (await store.listCodingAgentRuns(run.id)).find(item => item.id === codingRunId)!
        if (current.status !== 'waiting_permission') break
        const pending = (await store.listCodingPermissionRequests(codingRunId)).filter(item => item.status === 'pending')
        if (!pending.length) break
        for (const permission of pending) { const decision = legacyDecision(permission); await recordAction({ permissionId: permission.id, origin: permission.origin, permission: permission.permission, commandSummary: permission.command, decision }); await coding.replyCodingPermission({ requestId: permission.id, codingRunId, decidedBy: run.creatorId, decision, comment: 'Frozen isolated benchmark operator policy; independent acceptance follows.' }) }
      }
    }
  } catch (error) { failure = redact(error instanceof Error ? `${error.name}: ${error.message}` : String(error)) }
  finally {
    clearTimeout(deadlineTimer); await deadlineCleanup
    await native?.shutdown(); await manager.stopAll(); await relay?.close()
    const persistedRuns = await store.listCodingAgentRuns(run.id)
    // start() can fail after the production runtime has already saved its run.
    // Keep that actual failed run instead of reporting a paid call as not started.
    const current = codingRunId ? persistedRuns.find(item => item.id === codingRunId) : persistedRuns.at(-1)
    codingRunId ??= current?.id
    const workspace = current ? (await store.listManagedCodingWorkspaces(projectId)).find(item => item.id === current.managedWorkspaceId) : undefined
    const session = codingRunId ? await store.getNativeCodingSession(`native-${codingRunId}`) : undefined
    const events = codingRunId ? await store.listCodingAgentEvents(codingRunId) : []
    const usage = evaluationUsage(ledger.records())
    const report = { id: input.id, engine: input.engine, provider: 'deepseek', model: 'deepseek-flash', displayName: 'DeepSeek-V4.1-Flash', claimedCompleted: current?.status === 'completed', status: session?.status ?? current?.status ?? 'not_started', failure: deadlineExpired ? failure ?? 'evaluation_wall_time_limit' : failure, providerUnavailable, deadlineExpired, durationMs: Date.now() - start, ...usage,
      codingRun: current, workspace: workspace?.worktreePath, finalSnapshot, metrics: { humanInterventions: actions.filter(action => (action.command as { type?: string })?.type === 'reply').length, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, peakContextTokens: usage.peakContextTokens,
        effectiveInvestigationSteps: session ? session.toolReceipts.filter(row => row.effect === 'read' && row.status === 'completed').length : input.engine === 'native-v2' ? observations.filter(row => row.kind === 'structured').length : null,
        repairAttempts: session ? session.revisions.length - Math.min(1, session.revisions.length) : null, recoveryAttempts: 0, recoverySuccesses: 0 } }
    await saveJson(path.join(input.output, 'trial.json'), report)
    await saveJson(path.join(input.output, 'events.json'), events)
    if (session) await saveJson(path.join(input.output, 'session.json'), session)
    await saveJson(path.join(input.output, 'test-evidence.json'), await store.listTestEvidence(run.id))
    await store.close()
    console.log(JSON.stringify({ id: input.id, engine: input.engine, status: report.status, failure, modelCalls: ledger.records().length, costUsd: usage.costUsd }))
    if ('summary' in ledger) await saveJson(path.join(input.output, 'round-budget.json'), ledger.summary())
    if (input.roundRoot) await saveJson(path.join(input.output, 'ledger.json'), { readOnlyProjection: true, rows: ledger.records() })
    ledger.close()
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [inputPath, keyPath] = process.argv.slice(2)
  if (!inputPath || !keyPath) throw new Error('Usage: trial-live <trial-input.json> <private-key-file>')
  const input = JSON.parse(await readFile(inputPath, 'utf8')) as TrialInput
  if (process.env.DEVFLOW_NATIVE_EVALUATION_ROUND) {
    if (!input.roundRoot || !input.scopeId) throw new Error('Guarded trial requires its frozen shared round and scope before loading credentials')
    const { openInteractiveRound } = await import('./native-coding-round-budget.ts')
    const gate = await openInteractiveRound(input.roundRoot, input.scopeId); gate.close()
  }
  await runLiveTrial(input, (await readFile(keyPath, 'utf8')).trim())
}
