import { codingHarnessSnapshot, markCodingDeliveryConflict, currentCodingDeliveryDigest } from './native-coding-projection'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { parseCodingHarnessCommand, sanitizeCodingDiffArtifact, redactSensitiveText, type AgentProvider, type CodingAgentRun, type CodingHarnessCommand, type CodingHarnessSnapshot, type CodingHarnessPage, type TestEvidence, type ModelCostRecord } from '@ai-devflow/shared'
import type { CodingExecutor, CodingExecutorHarnessResult, CodingExecutorStartInput } from './coding-executor'
import type { LocalStore } from './local-store'
import { createNativeCodingSession, mutateNativeCodingSession, type NativeCodingSession } from './native-coding-session'
import { NativeCodingLoop } from './native-coding-loop'
import { createNativeCodingTools } from './native-coding-tools'
import { CodingCandidateWorkspace, atomicCodingFile, codingDigest, snapshotCodingTree, type CodingRevision, type CodingManifest } from './coding-candidate-workspace'
import { CodingCommandRunner, type CodingCommandPlan, type CodingExecutionProfile } from './coding-command-runner'
import { applyAndVerifyCodingRevision, recoverCodingDelivery } from './coding-evidence-v3'
import { codingDependencyPlan, codingShellPlan, prepareCodingDependencies } from './coding-dependency-preparation'
import { pendingCodingPermission } from './native-coding-permissions'
import { computeSourceTreeDigest } from './source-tree-digest'
import { captureWorktreeDiff } from './coding-runner'
import { mergeCodingChild } from './coding-child-merge'
import { codingActiveMilliseconds } from './coding-activity-clock'
import type { CodingLoopTools } from './native-coding-loop'
import { createCodingExtensions } from './native-coding-extensions'
import type { NativeCodingProfile } from './native-coding-profile'
import type { CodingTaskAuthority } from './native-coding-tools'
import { inspectCodingInput } from './coding-input'

type Core = { loop: NativeCodingLoop; workspace: CodingCandidateWorkspace; commands: CodingCommandRunner }
const terminal = (session: NativeCodingSession) => ['completed', 'cancelled', 'failed'].includes(session.status)
function shellPlan(command: string, profile: CodingExecutionProfile): CodingCommandPlan {
  return codingShellPlan(command, profile)
}

type HarnessHost = { store: LocalStore; provider: AgentProvider; root: string; configVersion: number; containerProfile?: Extract<CodingExecutionProfile, { kind: 'container' }>; network?: NativeCodingProfile['network']; changed?: (codingRunId: string) => void; costRecords?(projectId: string): Promise<ModelCostRecord[]> }
type Harness = CodingExecutor & { settled(codingRunId: string): Promise<void>; shutdown(): Promise<void> }
const services = new WeakMap<LocalStore, Map<string, Harness>>()
export async function shutdownNativeCodingHarnesses(store: LocalStore): Promise<void> {
  await Promise.all([...services.get(store)?.values() ?? []].map(service => service.shutdown()))
  services.delete(store)
}
/** IPC creates runtime facades repeatedly. Workers and command ownership must outlive those facades. */
export function createNativeCodingExecutorV3(host: HarnessHost): Harness {
  let cache = services.get(host.store)
  if (!cache) { cache = new Map(); services.set(host.store, cache) }
  const key = JSON.stringify([host.root, host.configVersion, host.provider.id, host.provider.model, host.containerProfile, host.network])
  const existing = cache.get(key)
  if (existing) return existing
  const service = createHarnessService(host); cache.set(key, service); return service
}
function createHarnessService(host: HarnessHost): Harness {
  const cores = new Map<string, Core>(), jobs = new Map<string, Promise<void>>()
  const loadingCores = new Map<string, Promise<Core>>()
  const commandQueues = new Map<string, Promise<unknown>>()
  const verifications = new Map<string, AbortController>()
  const budgetTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const stopping = new Map<string, Promise<void>>()
  let shuttingDown = false
  const sessionId = (id: string) => `native-${id}`
  const read = async (id: string) => { const value = await host.store.getNativeCodingSession(sessionId(id)); if (!value?.binding) throw new Error('Native v3 session not found'); return value }
  const mutate = (id: string, change: (session: NativeCodingSession) => void) => mutateNativeCodingSession(host.store, sessionId(id), change)
  // One wall-clock union covers parent, children and commands. A blocked request
  // or a detached test cannot evade the bound by never reaching the next step.
  const monitorBudget = async (id: string) => {
    clearTimeout(budgetTimers.get(id)); budgetTimers.delete(id)
    if (shuttingDown || stopping.has(id)) return
    const session = await read(id)
    if (terminal(session) || !session.activity.some(item => item.endedAt === undefined)) return
    const remaining = session.limits.maxActiveMilliseconds - codingActiveMilliseconds(session.activity)
    budgetTimers.set(id, setTimeout(() => {
      budgetTimers.delete(id)
      void stopScope(id, 'task_limit').catch(() => {
        // Retain the lease and durable worker receipts; startup recovery must
        // reconcile any process whose termination could not be proved.
        host.changed?.(id)
      })
    }, Math.max(1, remaining)))
  }
  const stopScope = (id: string, reason: string): Promise<void> => {
    const previous = stopping.get(id)
    if (previous) return previous
    const operation = (async () => {
      clearTimeout(budgetTimers.get(id)); budgetTimers.delete(id)
      const root = await read(id)
      verifications.get(id)?.abort()
      await commandQueues.get(id)?.catch(() => undefined)
      const sessions = [root, ...await Promise.all(root.children.filter(child => child.state === 'active').map(child => read(child.codingRunId)))]
      for (const session of sessions) {
        if (terminal(await read(session.codingRunId))) continue
        if (!session.binding?.executionGranted) continue
        const core = await loadCore(session, async () => {})
        if (reason !== 'application_shutdown' || jobs.has(session.codingRunId) || core.commands.hasActiveCommands) await core.loop.pause(session.id, reason)
        await core.commands.cancelAll()
      }
      await Promise.all(sessions.map(session => jobs.get(session.codingRunId)))
    })()
    stopping.set(id, operation)
    void operation.finally(() => { if (stopping.get(id) === operation) stopping.delete(id) }).catch(() => undefined)
    return operation
  }
  const loadCore = (session: NativeCodingSession, assertAuthority: () => Promise<void>): Promise<Core> => {
    const cached = cores.get(session.codingRunId)
    if (cached) return Promise.resolve(cached)
    const pending = loadingCores.get(session.codingRunId)
    if (pending) return pending
    // Scheduling, collection and cancellation must share the same live process
    // owner even while its filesystem state is still being opened.
    const loading = createCore(session, assertAuthority)
    loadingCores.set(session.codingRunId, loading)
    void loading.finally(() => { if (loadingCores.get(session.codingRunId) === loading) loadingCores.delete(session.codingRunId) }).catch(() => undefined)
    return loading
  }
  const createCore = async (session: NativeCodingSession, assertAuthority: () => Promise<void>): Promise<Core> => {
    const binding = session.binding!, workspace = await CodingCandidateWorkspace.open(binding.workspaceRoot)
    const activity = async (unitId: string, active: boolean) => {
      const rootId = session.parent?.codingRunId ?? session.codingRunId
      await mutate(rootId, draft => {
        const interval = draft.activity.find(item => item.unitId === unitId && item.endedAt === undefined)
        if (active && !interval) draft.activity.push({ unitId, startedAt: Date.now() })
        else if (!active && interval) interval.endedAt = Date.now()
      })
      await monitorBudget(rootId)
      host.changed?.(rootId)
    }
    const commands = new CodingCommandRunner(path.join(binding.workspaceRoot, 'commands'), (id, active) => activity(`command:${id}`, active))
    const { context, request } = binding
    const sources = [{ id: 'coding-brief', title: '已批准任务与约束', version: request.contextDigest, content: context.brief.prompt },
      ...context.upstreamArtifacts.map(artifact => ({ id: artifact.id, title: artifact.title, version: codingDigest(artifact.content), content: artifact.content }))]
    const checkedAuthority = async () => {
      await assertAuthority()
      if (Date.now() >= Date.parse(binding.authorizationExpiresAt ?? session.createdAt)) throw new Error('authorization_expired')
      if (session.parent) {
        const parent = await read(session.parent.codingRunId)
        if (parent.objectiveVersion !== session.parent.objectiveVersion || parent.pendingInput.length || !['ready', 'running', 'waiting_input', 'waiting_task', 'waiting_permission'].includes(parent.status) || parent.children.find(child => child.codingRunId === session.codingRunId)?.state !== 'active') throw new Error('Delegated authority is no longer current')
      }
    }
    const authority: CodingTaskAuthority = { scope: request.scope.organizationId && request.scope.projectId
      ? { kind: 'team', organizationId: request.scope.organizationId, projectId: request.scope.projectId, userId: request.scope.userId, sessionId: request.scope.sessionId, localProjectId: session.localProjectId }
      : { kind: 'local', organizationId: null, projectId: null, userId: request.scope.userId, sessionId: request.scope.sessionId, localProjectId: session.localProjectId },
      runVersion: request.authority.runVersion, policyVersion: request.authority.policyVersion,
      expiresAt: binding.authorizationExpiresAt ?? session.createdAt, allowCandidateEdits: binding.executionGranted, commands: [binding.testPlan] }
    const tools = createNativeCodingTools({ store: host.store, sessionId: session.id, workspace, commands, assertAuthority: checkedAuthority, sources, testPlanDigest: binding.testPlanDigest,
      extensions: createCodingExtensions({ store: host.store, sessionId: session.id, workspace, commands, authority, ...(host.network ? { network: host.network } : {}), assertAuthority: checkedAuthority }),
      ...(session.parent ? { child: { mode: session.parent.mode, paths: session.parent.paths } } : { delegation: {
        execute: (name, input, context) => childOperation(name, input, context, workspace, assertAuthority),
        reconcile: async receipt => {
          if (receipt.name === 'delegate_task') {
            const childId = `child-${codingDigest(`${session.id}:${receipt.id}`).slice(0, 40)}`, child = await host.store.getNativeCodingSession(sessionId(childId))
            if (child) {
              await mutate(session.codingRunId, draft => { if (!draft.children.some(entry => entry.codingRunId === childId)) draft.children.push({ sessionId: child.id, codingRunId: childId, title: String(receipt.input.title), state: 'active' }) })
              schedule(childId, assertAuthority); return { state: 'completed' as const, result: { codingRunId: childId, baseDigest: child.parent!.baseDigest } }
            }
            return { state: 'not_executed' as const }
          }
          if (receipt.name === 'merge_task') {
            try { return { state: 'completed' as const, result: await childOperation(receipt.name, receipt.input, { session: await read(session.codingRunId), operationId: receipt.id, signal: new AbortController().signal }, workspace, assertAuthority) } } catch { return { state: 'unknown' as const } }
          }
          return { state: 'not_executed' as const }
        },
      } }),
      authority })
    const loop = new NativeCodingLoop({ store: host.store, provider: host.provider, tools, changed: () => { host.changed?.(session.codingRunId); if (session.parent) host.changed?.(session.parent.codingRunId) },
      assertAuthority: checkedAuthority,
      reconcileWorkers: () => commands.reconcile(),
      activity: (unitId, active) => activity(`${session.id}:${unitId}`, active),
      rootActiveMilliseconds: async () => codingActiveMilliseconds((await read(session.parent?.codingRunId ?? session.codingRunId)).activity),
      reserveRootStep: async attemptId => {
        const rootId = session.parent?.codingRunId ?? session.codingRunId
        const root = await mutate(rootId, draft => {
          draft.rootStepAttempts ??= draft.attempts.map(attempt => attempt.id)
          if (!draft.rootStepAttempts.includes(attemptId) && draft.rootStepAttempts.length < draft.limits.maxSteps && !terminal(draft) && ['ready', 'running', 'waiting_input', 'waiting_task', 'waiting_permission'].includes(draft.status)) draft.rootStepAttempts.push(attemptId)
        })
        return root.rootStepAttempts!.includes(attemptId)
      },
      stopPreviousWorker: async writer => {
        if (writer.processId === process.pid) return false
        try { process.kill(writer.processId, 0); return false } catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH' && !commands.hasActiveCommands && await commands.reconcile() }
      } })
    const core = { loop, workspace, commands }; cores.set(session.codingRunId, core); return core
  }
  const stopChildren = async (session: NativeCodingSession, cancel: boolean, assertAuthority: () => Promise<void>) => {
    for (const entry of session.children.filter(child => child.state === 'active')) {
      const child = await read(entry.codingRunId)
      if (terminal(child)) continue
      const core = await loadCore(child, assertAuthority)
      await core.loop.pause(child.id); await core.commands.cancelAll(); await jobs.get(entry.codingRunId)
      if (cancel) await core.loop.cancel(child.id)
      else await mutate(child.codingRunId, draft => { if (draft.status === 'paused') draft.pauseReason = 'parent_pause' })
    }
  }
  const childOperation = async (name: string, input: Record<string, unknown>, context: Parameters<CodingLoopTools['execute']>[2], workspace: CodingCandidateWorkspace, assertAuthority: () => Promise<void>): Promise<unknown> => {
    const parent = await read(context.session.codingRunId)
    if (parent.parent || parent.status !== 'running' || parent.objectiveVersion !== context.session.objectiveVersion) throw new Error('Delegation requires the current root writer')
    if (name === 'delegate_task') {
      if (parent.children.filter(child => child.state === 'active').length >= 3) throw new Error('Three child tasks are already active; collect or exclude one first')
      if (!parent.taskBudget || Number(input.maxTokens) < 1 || Number(input.maxTokens) > parent.taskBudget.maxTokens || Number(input.maxCostUsd) > parent.taskBudget.maxCostUsd) throw new Error('Child budget must be a subset of root authorization')
      if (input.mode === 'isolated_coding' && !(input.paths as string[]).length) throw new Error('Coding child requires explicit writable paths')
      const childId = `child-${codingDigest(`${parent.id}:${context.operationId}`).slice(0, 40)}`
      let child = await host.store.getNativeCodingSession(sessionId(childId))
      if (!child) {
        const directory = path.join(workspace.root, 'children'); await mkdir(directory, { recursive: true, mode: 0o700 })
        const intentFile = path.join(directory, `${childId}.intent.json`), inputDigest = codingDigest(JSON.stringify({ input, objectiveVersion: parent.objectiveVersion }))
        let intent: { inputDigest: string; base: CodingManifest }
        try { intent = JSON.parse(await readFile(intentFile, 'utf8')) as typeof intent }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          intent = { inputDigest, base: await workspace.capture() }
          await atomicCodingFile(intentFile, Buffer.from(JSON.stringify(intent)))
        }
        if (intent.inputDigest !== inputDigest) throw new Error('Delegation identity changed during recovery')
        const base = intent.base
        // Keep executable working directories as shallow as root sessions.
        // Deep parent/children nesting exceeds Windows' process-cwd limit.
        // Existing sessions still reopen the exact path in their saved binding.
        const view = path.join(host.root, `${childId}-base`), root = path.join(host.root, codingDigest(sessionId(childId)))
        await workspace.materializeAtomic(base, view)
        let childWorkspace: CodingCandidateWorkspace
        try { childWorkspace = await CodingCandidateWorkspace.open(root) } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          childWorkspace = await CodingCandidateWorkspace.create({ root, delivery: view, baseCommitSha: workspace.identity.baseCommitSha, excludedPaths: base.excludedPaths })
        }
        if (childWorkspace.identity.base.digest !== base.digest) throw new Error('Child workspace differs from its frozen delegation input')
        child = createNativeCodingSession({ id: sessionId(childId), codingRunId: childId, workflowRunId: parent.workflowRunId, nodeId: parent.nodeId, localProjectId: parent.localProjectId, providerId: parent.providerId, model: parent.model, objective: String(input.prompt), now: new Date().toISOString() })
        child.binding = { ...structuredClone(parent.binding!), workspaceRoot: root, context: { ...structuredClone(parent.binding!.context), id: childId, userInstruction: String(input.prompt) } }
        child.parent = { sessionId: parent.id, codingRunId: parent.codingRunId, objectiveVersion: parent.objectiveVersion, baseDigest: childWorkspace.identity.base.digest, mode: input.mode as 'read_only' | 'isolated_coding', paths: input.paths as string[] }
        child.taskBudget = { ...parent.taskBudget, taskId: `coding-task-${codingDigest(child.id)}`, parentTaskId: parent.taskBudget.rootId, maxTokens: Number(input.maxTokens), maxCostUsd: Number(input.maxCostUsd) }
        child.transcript[0] = { role: 'user', content: JSON.stringify({ task: child.objective, rootObjective: parent.objective, sourceDigest: child.parent.baseDigest, writablePaths: child.parent.paths, mode: child.parent.mode, context: parent.binding!.context.brief.prompt }) }
        if (!await host.store.saveNativeCodingSession(child, 0)) throw new Error('Child task was concurrently created')
      }
      await mutate(parent.codingRunId, draft => { if (!draft.children.some(entry => entry.codingRunId === childId)) draft.children.push({ sessionId: child!.id, codingRunId: childId, title: String(input.title), state: 'active' }) })
      schedule(childId, assertAuthority); return { codingRunId: childId, baseDigest: child.parent!.baseDigest }
    }
    const entry = parent.children.find(child => child.codingRunId === input.codingRunId)
    if (!entry) throw new Error('Child task is outside this root')
    let child = await read(entry.codingRunId)
    const core = await loadCore(child, assertAuthority)
    if (name === 'cancel_task') {
      if (!terminal(child)) { await core.loop.pause(child.id); await core.commands.cancelAll(); await jobs.get(child.codingRunId); await core.loop.cancel(child.id) }
      await mutate(parent.codingRunId, draft => { draft.children.find(item => item.codingRunId === child.codingRunId)!.state = 'excluded' }); return { excluded: child.codingRunId }
    }
    if (name === 'await_task') {
      const end = Date.now() + 5000
      while (['ready', 'running'].includes(child.status) && Date.now() < end) { context.signal.throwIfAborted(); await new Promise(resolve => setTimeout(resolve, 100)); child = await read(child.codingRunId) }
      const findings = child.toolReceipts.filter(receipt => receipt.name === 'report_findings' && receipt.status === 'completed').at(-1)?.result
      if (findings && child.status === 'review') await mutate(parent.codingRunId, draft => { draft.children.find(item => item.codingRunId === child.codingRunId)!.state = 'included' })
      return { codingRunId: child.codingRunId, status: child.status, ...(['ready', 'running', 'waiting_input', 'waiting_permission'].includes(child.status) ? { pendingChild: child.codingRunId } : {}), sourceDigest: child.parent!.baseDigest, findings, ...(revisionFor(child) ? { revision: { id: revisionFor(child)!.id, digest: revisionFor(child)!.digest } } : {}), question: child.question ? { text: child.question.text, requiresHuman: true } : undefined }
    }
    if (name === 'merge_task') {
      const revision = revisionFor(child)
      if (!revision || revision.id !== input.childChangeSetId || child.parent?.objectiveVersion !== parent.objectiveVersion || entry.state === 'excluded') throw new Error('Child revision is stale or excluded')
      const result = await mergeCodingChild({ parent: workspace, child: core.workspace, revision, expectedParentRevision: String(input.expectedParentRevision), objectiveVersion: parent.objectiveVersion, assertWriter: async () => { await assertAuthority(); const current = await read(parent.codingRunId); if (current.status !== 'running' || current.objectiveVersion !== parent.objectiveVersion || context.signal.aborted) throw new Error('Parent writer was revoked') } })
      if ('childChangeSetId' in result) await mutate(parent.codingRunId, draft => { const record = draft.children.find(item => item.codingRunId === child.codingRunId)!; record.state = 'included'; record.mergedChangeSetId = revision.id })
      return result
    }
    throw new Error('Unknown child operation')
  }
  const revisionFor = (session: NativeCodingSession): CodingRevision | undefined => session.revisions.filter(revision => revision.objectiveVersion === session.objectiveVersion).at(-1)
  const projectRun = async (session: NativeCodingSession): Promise<CodingAgentRun> => {
    const binding = session.binding!, context = binding.context
    const previous = (await host.store.listCodingAgentRuns()).find(run => run.id === session.codingRunId)
    return { ...(previous ?? { id: session.codingRunId, runId: session.workflowRunId, nodeId: session.nodeId, projectId: session.localProjectId,
      requestedBy: context.requestedBy, providerId: session.providerId, engine: 'native' as const, configVersion: host.configVersion,
      managedWorkspaceId: context.workspace.id, branchName: context.workspace.branchName, userInstruction: context.userInstruction, prompt: context.brief.prompt,
      changedPaths: [], startedAt: session.createdAt, redacted: true }),
      // `running` keeps the existing workflow reservation active; v2 turn state is explicit below.
      status: session.status === 'cancelled' ? 'cancelled' : session.status === 'failed' ? 'failed' : 'running',
      summary: session.pauseReason ?? `Native v3 · ${session.status} · ${session.steps} 个模型步骤`,
      harness: { protocolVersion: 2, sessionId: session.id, status: session.status, version: session.version },
      ...(revisionFor(session) ? { changedPaths: revisionFor(session)!.operations.map(operation => operation.path) } : {}),
    }
  }
  const publish = async (session: NativeCodingSession) => {
    const previous = (await host.store.listCodingAgentRuns()).find(run => run.id === session.codingRunId)
    if (previous && !['completed', 'cancelled', 'failed', 'timed_out'].includes(previous.status)) {
      await host.store.commitCodingAgentMutation({ expectedRun: previous, expectedPendingPermissionRequestIds: [], run: await projectRun(session) })
    }
    host.changed?.(session.codingRunId)
  }
  const schedule = (id: string, assertAuthority: () => Promise<void>) => {
    if (shuttingDown || stopping.has(id) || jobs.has(id)) return
    const job = (async () => {
      let session = await read(id)
      const core = await loadCore(session, assertAuthority)
      while (['ready', 'running', 'reconciling'].includes(session.status)) {
        await assertAuthority()
        await core.loop.runBatch(session.id); session = await read(id); await publish(session)
        if (session.status !== 'ready') break
        await new Promise<void>(resolve => setImmediate(resolve))
      }
    })().catch(async error => {
      const current = await read(id)
      let stopped = true
      try { await cores.get(id)?.commands.cancelAll() } catch { stopped = false }
      if (!terminal(current)) await publish(await mutate(id, draft => { draft.status = stopped ? 'paused' : 'reconciling'; draft.pauseReason = stopped ? error instanceof Error ? error.message : 'Native execution interrupted' : 'previous_command_not_stopped' }))
    }).finally(async () => {
      jobs.delete(id)
      // A reply can be persisted while the previous batch is releasing its lease.
      const current = await read(id)
      if (current.status === 'ready') schedule(id, assertAuthority)
      if (current.parent && ['review', 'cancelled', 'failed', 'paused', 'reconciling'].includes(current.status)) {
        const parent = await read(current.parent.codingRunId)
        if (parent.status === 'waiting_task' && parent.pauseReason === `child:${id}`) { await mutate(parent.codingRunId, draft => { if (draft.status === 'waiting_task') { draft.status = 'ready'; delete draft.pauseReason } }); schedule(parent.codingRunId, assertAuthority) }
      }
      if (current.status === 'waiting_task' && current.pauseReason?.startsWith('child:')) {
        const child = await read(current.pauseReason.slice(6))
        if (['review', 'cancelled', 'failed', 'paused', 'reconciling'].includes(child.status)) { await mutate(id, draft => { if (draft.status === 'waiting_task') draft.status = 'ready' }); schedule(id, assertAuthority) }
      }
    })
    jobs.set(id, job)
  }
  const snapshot = (session: NativeCodingSession, page?: CodingHarnessPage) => codingHarnessSnapshot(session, host, page)
  const result = async (id: string, page?: CodingHarnessPage): Promise<CodingExecutorHarnessResult> => {
    const session = await read(id), view = await snapshot(session, page), codingRun = await projectRun(session)
    const bundle: CodingExecutorHarnessResult = { kind: 'harness', protocolVersion: 2, codingRun, events: [], snapshot: view }
    const evidence = session.deliveryEvidence.at(-1)
    if (session.status === 'completed' && evidence && ['technical_completed', 'verified_no_change', 'manual_accepted'].includes(evidence.status)) {
      const binding = session.binding!, revision = revisionFor(session)!, core = await loadCore(session, async () => {})
      const currentDelivery = await currentCodingDeliveryDigest(binding.context.workspace.worktreePath, revision.base.excludedPaths)
      if (currentDelivery !== evidence.targetDigest) {
        if (!view.evidence.some(item => item.status.startsWith('historical_content_'))) view.evidence.push({ id: `${evidence.id}-historical`, status: currentDelivery === null ? 'historical_content_unavailable' : 'historical_content_changed', summary: '当前交付内容已变化或无法读取。原记录保留为历史证据，不再据此推进当前工作流。' })
        const persisted = (await host.store.listCodingAgentRuns()).find(run => run.id === id)
        if (persisted && !['completed', 'cancelled', 'failed', 'timed_out'].includes(persisted.status)) { markCodingDeliveryConflict(view); bundle.codingRun.summary = view.controlUnavailableReason!; bundle.codingRun.harness = { ...bundle.codingRun.harness!, status: 'delivery_conflict' } }
        return bundle
      }
      if (evidence.status === 'manual_accepted') {
        const captured = await captureWorktreeDiff({ worktreePath: binding.context.workspace.worktreePath })
        bundle.completion = { manualEvidence: evidence, diff: sanitizeCodingDiffArtifact({ id: revision.id, runId: session.workflowRunId, nodeId: session.nodeId, projectId: session.localProjectId, changedPaths: captured.changedPaths, patch: captured.patch, sourceDigest: codingDigest(captured.patch), createdAt: revision.createdAt }) }
        return bundle
      }
      const command = evidence.result ? await core.commands.read(evidence.result.logId, 0, 16000) : undefined
      const tree = await computeSourceTreeDigest(binding.context.workspace.worktreePath)
      const testEvidence: TestEvidence = { id: evidence.id, runId: session.workflowRunId, nodeId: session.nodeId, projectId: session.localProjectId,
        command: binding.context.project.testCommand, cwd: evidence.verificationDirectory!, status: 'passed', exitCode: 0,
        durationMs: Date.parse(evidence.completedAt) - Date.parse(evidence.startedAt), stdout: command?.output ?? '', stderr: '', summary: `批准修订 ${revision.digest} 已在独立验证目录通过；交付内容一致。`,
        redacted: true, createdAt: evidence.completedAt, ...(tree ? { sourceTree: { digest: tree.full, workspaceId: binding.context.workspace.id } } : {}),
        codingVerification: { schemaVersion: 1, executionLocation: 'private_verification', revisionDigest: revision.digest, productDigest: evidence.targetDigest, testPlanDigest: revision.testPlanDigest, verificationBefore: evidence.verificationBefore!, verificationAfter: evidence.verificationAfter!, deliveryAfter: evidence.deliveryAfter!, environmentDigest: evidence.environmentDigest! } }
      const captured = await captureWorktreeDiff({ worktreePath: binding.context.workspace.worktreePath })
      const diff = sanitizeCodingDiffArtifact({ id: revision.id, runId: session.workflowRunId, nodeId: session.nodeId, projectId: session.localProjectId,
        changedPaths: captured.changedPaths, patch: captured.patch, sourceDigest: codingDigest(captured.patch), createdAt: revision.createdAt })
      bundle.completion = { diff, testEvidence }
    }
    return bundle
  }
  const executeCommand = async (value: CodingHarnessCommand, assertAuthority: () => Promise<void>, acceptedInterruption = false): Promise<CodingExecutorHarnessResult> => {
    const command = parseCodingHarnessCommand(value), id = command.codingRunId
    let session = await read(id)
    if (command.type === 'get') return result(id, command)
    const fingerprint = codingDigest(JSON.stringify(command)), replay = session.commands.find(item => item.id === command.commandId)
    if (replay) { if (replay.digest !== fingerprint) throw new Error('Conflicting coding command'); return result(id) }
    if (!acceptedInterruption && session.version !== command.expectedVersion) throw new Error('任务已更新，请刷新后重试。')
    await assertAuthority()
    if (!session.binding!.executionGranted && command.type !== 'authorize') {
      if (command.type === 'cancel') await mutate(id, draft => { draft.status = 'cancelled'; draft.commands.push({ id: command.commandId, digest: fingerprint }) })
      else if (command.type === 'steer') await mutate(id, draft => { draft.pendingInput.push({ id: command.commandId, text: command.text }); draft.commands.push({ id: command.commandId, digest: fingerprint }) })
      else throw new Error('Authorize candidate execution before continuing this task')
      await publish(await read(id)); return result(id)
    }
    if (command.type === 'renew_authorization') {
      if (session.parent || session.status !== 'paused' || session.pauseReason !== 'authorization_expired' || jobs.has(id)) throw new Error('No expired root authority to renew')
      // Old Core objects own the abort controllers and command workers. Never
      // discard them while a child is still running under the previous grant.
      await stopChildren(session, false, assertAuthority)
      const expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString()
      await mutate(id, draft => { draft.binding!.authorizationExpiresAt = expiresAt; draft.commands.push({ id: command.commandId, digest: fingerprint }) })
      cores.delete(id)
      for (const child of session.children.filter(item => item.state === 'active')) { await mutate(child.codingRunId, draft => { draft.binding!.authorizationExpiresAt = expiresAt }); cores.delete(child.codingRunId) }
      return result(id)
    }
    if (command.type === 'authorize') {
      if (session.binding!.executionGranted || session.status !== 'waiting_permission') throw new Error('Execution authorization is stale')
      if (!command.manualValidationPlan && !session.binding!.context.project.testCommand.trim()) throw new Error('请在开工前选择明确的人工验收计划，或保存适用的自动测试命令。')
      const profile = command.profile === 'container' ? host.containerProfile : { kind: 'trusted_local' as const }
      if (!profile) throw new Error('Container profile is not configured; no local fallback')
      const input = await inspectCodingInput(session.binding!.context.workspace.worktreePath, session.binding!.context.workspace.baseCommitSha!)
      if (input.digest !== session.binding!.input?.digest) throw new Error('Input files changed after the authorization was presented; start a fresh run with the new baseline')
      const dependencyPlan = await codingDependencyPlan(session.binding!.context.workspace.worktreePath, profile, ['node_modules', '.cache', 'coverage'])
      if (dependencyPlan.inputDigest !== session.binding!.dependencyPlan?.inputDigest || dependencyPlan.command !== session.binding!.dependencyPlan?.command) throw new Error('Dependency plan changed since execution was presented')
      await mkdir(host.root, { recursive: true, mode: 0o700 })
      const created = await CodingCandidateWorkspace.create({ root: session.binding!.workspaceRoot, delivery: session.binding!.context.workspace.worktreePath, baseCommitSha: session.binding!.context.workspace.baseCommitSha!, excludedPaths: ['node_modules', '.cache', 'coverage'] })
      if (created.identity.base.digest !== input.digest) throw new Error('Input changed while creating the immutable candidate')
      session = await mutate(id, draft => { draft.binding!.executionGranted = true; draft.binding!.profile = profile; draft.binding!.dependencyPlan = dependencyPlan; draft.binding!.authorizationExpiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString(); draft.binding!.testPlan = shellPlan(draft.binding!.context.project.testCommand, profile); draft.binding!.testPlanDigest = codingDigest(JSON.stringify(command.manualValidationPlan ? { manualValidationPlan: command.manualValidationPlan } : draft.binding!.testPlan)); if (command.manualValidationPlan) { draft.binding!.manualValidationPlan = command.manualValidationPlan; draft.transcript.push({ role: 'user', content: `本任务事先选择人工验收，自动测试不会被记为通过。人工计划：${command.manualValidationPlan}` }) }; draft.status = 'ready'; draft.commands.push({ id: command.commandId, digest: fingerprint }) })
      schedule(id, assertAuthority)
    } else {
      const core = await loadCore(session, assertAuthority)
      if (command.type === 'reply') {
        await core.loop.replyInput(session.id, { id: `reply-${command.commandId}`, questionId: command.questionId, objectiveVersion: command.objectiveVersion, text: command.text }); schedule(id, assertAuthority)
      } else if (command.type === 'steer') {
        // Persist the human boundary before awaiting child cancellation so no
        // in-flight child or parent can freeze under the superseded objective.
        await core.loop.steer(session.id, { id: `steer-${command.commandId}`, text: command.text })
        await stopChildren(session, false, assertAuthority)
        await mutate(id, draft => { for (const child of draft.children) if (child.state === 'active') child.state = 'excluded' })
        if (session.status === 'review') await mutate(id, draft => { draft.status = 'ready' })
        schedule(id, assertAuthority)
      } else if (command.type === 'extend_limits') {
        if (session.parent || session.status !== 'paused' || session.pauseReason !== 'task_limit') throw new Error('Only a paused root task may receive additional execution time')
        if (command.maxSteps < session.limits.maxSteps || command.maxActiveMilliseconds < session.limits.maxActiveMilliseconds) throw new Error('Extension must preserve the existing limits')
        await mutate(id, draft => { draft.limits.maxSteps = command.maxSteps; draft.limits.maxActiveMilliseconds = command.maxActiveMilliseconds })
        for (const entry of session.children.filter(child => child.state === 'active')) await mutate(entry.codingRunId, draft => { draft.limits.maxSteps = command.maxSteps; draft.limits.maxActiveMilliseconds = command.maxActiveMilliseconds })
      } else if (command.type === 'pause') { await core.loop.pause(session.id); await core.commands.cancelAll(); await jobs.get(id) }
      else if (command.type === 'cancel') { await stopChildren(session, true, assertAuthority); await core.loop.pause(session.id); await core.commands.cancelAll(); await jobs.get(id); await core.loop.cancel(session.id) }
      else if (command.type === 'resume') {
        await core.loop.resume(session.id)
        for (const entry of session.children.filter(child => child.state === 'active')) { const child = await read(entry.codingRunId); if (child.status === 'paused' && child.pauseReason === 'parent_pause') { const childCore = await loadCore(child, assertAuthority); await childCore.loop.resume(child.id); schedule(child.codingRunId, assertAuthority) } }
        schedule(id, assertAuthority)
      }
      else if (command.type === 'permission') {
        const permission = pendingCodingPermission(session)
        if (!permission || permission.id !== command.permissionId) throw new Error('Permission is stale')
        await mutate(id, draft => {
          const current = pendingCodingPermission(draft)
          if (draft.status !== 'waiting_permission' || current?.id !== command.permissionId || current.objectiveVersion !== draft.objectiveVersion) throw new Error('Permission changed')
          current.decision = command.decision; current.expiresAt = new Date(Date.now() + 60 * 60_000).toISOString(); draft.status = 'ready'
        })
        schedule(id, assertAuthority)
      }
      else if (command.type === 'retry_unknown') {
        if (session.status !== 'reconciling' || session.pauseReason !== 'model_delivery_unknown') throw new Error('No unknown model request to retry')
        if (jobs.has(id) || session.writer || core.commands.hasActiveCommands) throw new Error('Previous execution has not stopped')
        await mutate(id, draft => { for (const attempt of draft.attempts) if (attempt.status === 'started' || attempt.status === 'unknown') { attempt.status = 'unknown'; attempt.acknowledgedBy = command.commandId }; draft.status = 'ready'; draft.pauseReason = 'human_authorized_new_attempt' })
        // Explicit new attempt; previous unknown charges remain in the authoritative ledger.
        schedule(id, assertAuthority)
      } else if (command.type === 'reject') {
        if (session.status !== 'review' || session.pendingInput.length || revisionFor(session)?.digest !== command.revisionDigest) throw new Error('Stale revision')
        await mutate(id, draft => {
          if (draft.status !== 'review' || draft.pendingInput.length || draft.objectiveVersion !== command.objectiveVersion || revisionFor(draft)?.digest !== command.revisionDigest) throw new Error('Stale revision')
          draft.status = 'ready'; draft.transcript.push({ role: 'user', content: '用户拒绝这份修订，请继续调查和改进；不能再次提交相同内容作为成功。' })
        }); schedule(id, assertAuthority)
      } else if (command.type === 'approve') {
        if (session.parent) throw new Error('Child results must be explicitly merged into their parent candidate')
        const revision = revisionFor(session)
        if (session.status !== 'review' || session.pendingInput.length || !revision || revision.digest !== command.revisionDigest || session.objectiveVersion !== command.objectiveVersion) throw new Error('Stale coding approval')
        if (core.commands.hasActiveCommands) throw new Error('Candidate writers are still active')
        if (session.binding!.manualValidationPlan ? !command.manualValidationEvidence : command.manualValidationEvidence !== undefined) throw new Error('人工验收必须事先选择计划，并在批准确切修订时填写人工检查依据。')
        await mutate(id, draft => {
          if (draft.status !== 'review' || draft.pendingInput.length || draft.objectiveVersion !== command.objectiveVersion || revisionFor(draft)?.digest !== command.revisionDigest) throw new Error('Stale coding approval')
          const confirmed = new Set(command.confirmedCriteria ?? [])
          if (draft.acceptance.some(criterion => !confirmed.has(criterion.id)) || [...confirmed].some(id => !draft.acceptance.some(criterion => criterion.id === id))) throw new Error('Explicitly review every sourced acceptance criterion before final approval')
          for (const criterion of draft.acceptance) { criterion.resolution = 'human_confirmed'; criterion.objectiveVersion = draft.objectiveVersion; criterion.revisionDigest = command.revisionDigest }
          draft.status = 'applying'; draft.commands.push({ id: command.commandId, digest: fingerprint })
        })
        const verificationController = new AbortController(); verifications.set(id, verificationController)
        const assertVerification = async () => { verificationController.signal.throwIfAborted(); await assertAuthority() }
        const evidence = await applyAndVerifyCodingRevision({ workspace: core.workspace, revision,
          ...(session.binding!.manualValidationPlan ? { manualAcceptance: { plan: session.binding!.manualValidationPlan, notes: command.manualValidationEvidence!, actorId: session.binding!.context.requestedBy, confirmedAt: new Date().toISOString() } } : {}),
          approval: { id: command.commandId, revisionDigest: revision.digest, objectiveVersion: session.objectiveVersion, policyVersion: session.binding!.request.authority.policyVersion, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() },
          assertAuthority: assertVerification,
          verify: async directory => {
            await mutate(id, draft => { draft.status = 'verifying' })
            const dependencies = await codingDependencyPlan(directory, session.binding!.profile, revision.base.excludedPaths)
            if (revision.testPlanDigest !== codingDigest(JSON.stringify({ testPlan: session.binding!.testPlanDigest, dependencies: dependencies.digest }))) throw new Error('Frozen verification plan changed')
            await prepareCodingDependencies({ directory, profile: session.binding!.profile, excludedPaths: revision.base.excludedPaths, runner: core.commands, operationId: `${session.id}:verify:${command.commandId}`, plan: dependencies, signal: verificationController.signal, final: true })
            const logId = `${session.id}:verify:${command.commandId}`
            await core.commands.start(logId, session.binding!.testPlan, directory, verificationController.signal)
            const tested = await core.commands.wait(logId)
            return { exitCode: tested.exitCode, status: tested.status === 'passed' ? 'passed' : tested.status === 'timed_out' ? 'timed_out' : tested.status === 'cancelled' ? 'cancelled' : 'failed', logId }
          } }).catch(async error => { await mutate(id, draft => { if (draft.status === 'applying') { draft.status = 'paused'; draft.pauseReason = error instanceof Error ? error.message : 'Application did not start' } }); throw error }).finally(() => { verifications.delete(id) })
        await mutate(id, draft => {
          draft.deliveryEvidence.push(evidence)
          draft.status = ['technical_completed', 'verified_no_change', 'manual_accepted'].includes(evidence.status) ? 'completed' : evidence.status === 'delivery_conflict' ? 'delivery_conflict' : evidence.status === 'test_failed' && evidence.result?.status !== 'cancelled' ? 'ready' : 'paused'
          if (draft.status === 'paused' || draft.status === 'ready') { draft.pauseReason = evidence.status === 'evidence_invalid' ? 'invalid_test_plan' : 'final_test_failed'; draft.transcript.push({ role: 'user', content: JSON.stringify({ finalVerification: evidence, deliveryRestored: true, instruction: 'Investigate the recorded final failure, repair the candidate, and submit a NEW revision for human approval.' }) }) }
        })
        if ((await read(id)).status === 'ready') schedule(id, assertAuthority)
      } else throw new Error('This coding permission is not pending')
      if (command.type === 'pause') await stopChildren(session, false, assertAuthority)
      const current = await read(id)
      if (!current.commands.some(item => item.id === command.commandId)) await mutate(id, draft => { draft.commands.push({ id: command.commandId, digest: fingerprint }) })
    }
    await publish(await read(id)); return result(id)
  }
  const executor: Harness = {
    descriptor: { stateVersion: 1, id: 'coding-executor-native', version: 3, kind: 'native', availability: { status: 'available', reasonCode: null }, capabilities: ['cancellation', 'checkpoint_continuation', 'structured_diff', 'structured_test_evidence', 'workspace_edit', 'workspace_read'] },
    engine: 'native', providerId: host.provider.id, modelId: host.provider.model, billing: 'metered', ...(host.provider.billingProvider ? { billingProvider: host.provider.billingProvider } : {}),
    ensure: async ({ project }) => {
      if (!host.provider.supportsNativeTools || !host.provider.completeNativeConversation || !host.provider.serializeNativeRequest) throw new Error('Native v3 requires a verified native tool provider')
      return { projectId: project.id, engine: 'native', status: 'ready' }
    },
    async start(input: CodingExecutorStartInput) {
      await executor.ensure({ project: input.runtimeContext.project })
      const { reportProviderCall: _calls, reportPermissionPolicyDecision: _permissions, assertContextCurrent: _assert, ...context } = input.runtimeContext
      if (!context.workspace.baseCommitSha) throw new Error('Native v3 requires an immutable input commit')
      const session = createNativeCodingSession({ id: sessionId(input.request.id), codingRunId: input.request.id, workflowRunId: context.run.id, nodeId: context.node.id,
        localProjectId: context.project.id, providerId: host.provider.id, model: host.provider.model, objective: context.userInstruction, now: new Date().toISOString() })
      const profile = { kind: 'trusted_local' as const }, testPlan = shellPlan(context.project.testCommand, profile)
      session.binding = { request: input.request, context, workspaceRoot: path.join(host.root, codingDigest(session.id)), profile, testPlan, testPlanDigest: codingDigest(JSON.stringify(testPlan)), executionGranted: false, dependencyPlan: await codingDependencyPlan(context.workspace.worktreePath, profile, ['node_modules', '.cache', 'coverage']) }
      session.binding.input = await inspectCodingInput(context.workspace.worktreePath, context.workspace.baseCommitSha)
      session.acceptance = context.upstreamArtifacts.flatMap(artifact => artifact.clarificationRevision?.status === 'approved' ? artifact.clarificationRevision.acceptanceCriteria.map((text, index) => ({ id: `criterion-${codingDigest(`${artifact.id}:${index}:${text}`)}`, objectiveVersion: 1, sourceRef: `${artifact.id}@${artifact.clarificationRevision!.revisionDigest}`, text, confirmation: 'approved_source' as const, resolution: 'unresolved' as const })) : [])
      if (session.acceptance.length > 100) throw new Error('More than 100 confirmed acceptance criteria; split the approved workflow scope first')
      const taskId = `coding-task-${codingDigest(session.id)}`
      session.taskBudget = { rootId: taskId, taskId, maxTokens: input.request.budget.maxTokens, rootMaxTokens: input.request.budget.maxTokens, maxCostUsd: input.request.budget.maxCostUsd, rootMaxCostUsd: input.request.budget.maxCostUsd }
      session.status = 'waiting_permission'
      session.transcript[0] = { role: 'user', content: `${context.userInstruction}\n\n任务简报（宿主提供的已批准来源）：\n${context.brief.prompt}` }
      if (!await host.store.saveNativeCodingSession(session, 0)) throw new Error('Native coding run already exists')
      return result(input.request.id)
    },
    async continuePermission() { throw new Error('Native v3 uses coding harness protocol 2; a v1 permission cannot continue it') },
    async cancel({ codingRun }) {
      verifications.get(codingRun.id)?.abort()
      await commandQueues.get(codingRun.id)?.catch(() => undefined)
      const session = await read(codingRun.id)
      if (terminal(session)) return
      await stopChildren(session, true, async () => {})
      if (session.binding!.executionGranted) { const core = await loadCore(session, async () => {}); await core.loop.pause(session.id); await core.commands.cancelAll(); await jobs.get(codingRun.id); await core.loop.cancel(session.id) }
      else await mutate(codingRun.id, draft => { draft.status = 'cancelled' })
    },
    harness: { protocolVersion: 2, async command(value, assertAuthority) {
      const command = parseCodingHarnessCommand(value)
      if (command.type === 'get') return executeCommand(command, assertAuthority)
      // Validate the user and checkpoint before interrupting a long verification.
      let acceptedInterruption = false
      if (['cancel', 'pause', 'steer'].includes(command.type) && verifications.has(command.codingRunId)) {
        await assertAuthority()
        if ((await read(command.codingRunId)).version !== command.expectedVersion) throw new Error('任务已更新，请刷新后重试。')
        acceptedInterruption = true; verifications.get(command.codingRunId)?.abort()
      }
      const prior = commandQueues.get(command.codingRunId) ?? Promise.resolve()
      const next = prior.catch(() => undefined).then(() => executeCommand(command, assertAuthority, acceptedInterruption))
      commandQueues.set(command.codingRunId, next)
      void next.finally(() => { if (commandQueues.get(command.codingRunId) === next) commandQueues.delete(command.codingRunId) }).catch(() => undefined)
      return next
    },
      async recover(codingRun, assertAuthority) {
        const session = await host.store.getNativeCodingSession(sessionId(codingRun.id))
        if (!session) return null
        if (session.binding?.executionGranted && !terminal(session)) {
          const core = await loadCore(session, assertAuthority)
          if (!await core.commands.reconcile()) { await mutate(codingRun.id, draft => { draft.status = 'reconciling'; draft.pauseReason = 'previous_command_not_stopped' }); return result(codingRun.id) }
          const children = await Promise.all(session.children.filter(child => child.state === 'active').map(child => read(child.codingRunId)))
          // Reconcile every descendant before either side can resume. Children
          // own independent workspaces but their old processes still spend the
          // parent's authority and budget.
          for (const child of children) {
            const childCore = await loadCore(child, assertAuthority)
            if (!await childCore.commands.reconcile()) { await mutate(codingRun.id, draft => { draft.status = 'reconciling'; draft.pauseReason = 'previous_child_command_not_stopped' }); return result(codingRun.id) }
          }
          if (!jobs.has(codingRun.id)) await mutate(codingRun.id, draft => {
            for (const activity of draft.activity) if (activity.endedAt === undefined) activity.endedAt = Math.max(activity.startedAt, Date.parse(session.updatedAt))
          })
          const recovery = await recoverCodingDelivery(core.workspace)
          const completed = recovery.evidence.filter(item => ['technical_completed', 'verified_no_change', 'manual_accepted'].includes(item.status)).at(-1)
          if (completed && (await snapshotCodingTree(core.workspace.identity.delivery, core.workspace.identity.base.excludedPaths)).digest === completed.targetDigest) {
            await mutate(codingRun.id, draft => { if (!draft.deliveryEvidence.some(item => item.id === completed.id)) draft.deliveryEvidence.push(completed); draft.status = 'completed'; delete draft.pauseReason })
          } else if (completed || recovery.status === 'delivery_conflict') await mutate(codingRun.id, draft => { draft.status = 'delivery_conflict'; draft.pauseReason = 'delivery_reconciliation_required' })
          else if (['applying', 'verifying'].includes(session.status)) await mutate(codingRun.id, draft => { draft.status = 'paused'; draft.pauseReason = 'delivery_restored_after_restart' })
          else {
            for (const child of children) if (['ready', 'running', 'reconciling'].includes(child.status)) schedule(child.codingRunId, assertAuthority)
            if (session.status === 'waiting_task' && session.pauseReason?.startsWith('child:')) {
              const child = await read(session.pauseReason.slice(6))
              if (['review', 'paused', 'cancelled', 'failed', 'reconciling'].includes(child.status)) await mutate(codingRun.id, draft => { draft.status = 'ready'; delete draft.pauseReason })
            }
            if (['ready', 'running', 'reconciling'].includes((await read(codingRun.id)).status)) schedule(codingRun.id, assertAuthority)
          }
        }
        return result(codingRun.id)
      } },
    async settled(id) { while (jobs.has(id)) await jobs.get(id) },
    async shutdown() {
      shuttingDown = true
      for (const timer of budgetTimers.values()) clearTimeout(timer)
      budgetTimers.clear()
      const projectIds = new Set((await host.store.listProjects()).map(project => project.id))
      const sessions = (await Promise.all([...projectIds].map(id => host.store.listNativeCodingSessions(id)))).flat()
      await Promise.all(sessions.filter(session => !session.parent && !terminal(session) && session.binding?.workspaceRoot.startsWith(host.root + path.sep)).map(session => stopScope(session.codingRunId, 'application_shutdown')))
    },
  }
  return executor
}
