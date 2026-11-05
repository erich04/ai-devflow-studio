import { isDeepStrictEqual } from 'node:util'
import type { LocalStore } from './local-store'
import { codingDigest } from './coding-candidate-workspace'
import { createNativeCodingSession, mutateNativeCodingSession, parseNativeCodingSession, type NativeCodingSession } from './native-coding-session'
import { currentIndependentChecks, independentCheckSourceDigest, needsIndependentChecks } from './native-coding-independent-verification'

type Store = Pick<LocalStore, 'getNativeCodingSession' | 'saveNativeCodingSession'>

/** A host-supplied wall deadline is stable after authorization. Existing tasks
 * without that deadline retain their serial preparation protocol. */
export function concurrentCodingAcceptance(session: NativeCodingSession): boolean {
  return Boolean(session.operatorDeadlineAt && session.binding?.independentVerificationRequired &&
    !session.binding.manualValidationPlan && !session.parent && !session.privateAcceptanceFor)
}

export function codingRootRunId(session: NativeCodingSession): string {
  return session.parent?.codingRunId ?? session.privateAcceptanceFor?.rootCodingRunId ?? session.codingRunId
}

export async function codingAcceptanceWorkers(store: Store, root: NativeCodingSession): Promise<NativeCodingSession[]> {
  return Promise.all((root.acceptanceWorkers ?? []).map(async descriptor => {
    const worker = await store.getNativeCodingSession(descriptor.sessionId)
    const owner = worker?.privateAcceptanceFor
    if (!worker || !owner || owner.rootSessionId !== root.id || owner.rootCodingRunId !== root.codingRunId ||
        owner.objectiveVersion !== descriptor.objectiveVersion || owner.sourceDigest !== descriptor.sourceDigest ||
        owner.baselineDigest !== descriptor.baselineDigest || worker.binding?.workspaceRoot !== root.binding?.workspaceRoot ||
        worker.localProjectId !== root.localProjectId || worker.workflowRunId !== root.workflowRunId ||
        worker.nodeId !== root.nodeId || worker.providerId !== root.providerId || worker.model !== root.model)
      throw new Error('Missing or mismatched private acceptance worker')
    return worker
  }))
}

/** Save the worker before linking it, and link it before dispatch. A crash in
 * between leaves an unused deterministic record that can safely be linked on
 * recovery. A linked missing record is never recreated as an unbilled attempt. */
export async function prepareCodingAcceptanceWorker(store: Store, rootId: string, baselineDigest: string): Promise<NativeCodingSession | undefined> {
  const root = await store.getNativeCodingSession(rootId)
  if (!root || !concurrentCodingAcceptance(root) || !root.operatorDeadlineAt) throw new Error('Concurrent acceptance is not authorized')
  if (!needsIndependentChecks(root)) return undefined
  if (!root.binding?.executionGranted || root.pendingInput.length || !['ready', 'running'].includes(root.status) ||
      root.binding.input?.digest !== baselineDigest) throw new Error('Private acceptance source is no longer current')
  const sourceDigest = independentCheckSourceDigest(root)
  const identity = codingDigest(JSON.stringify({ root: root.id, objectiveVersion: root.objectiveVersion, sourceDigest, baselineDigest }))
  const codingRunId = `acceptance-${identity.slice(0, 40)}`
  const sessionId = `native-${codingRunId}`
  const descriptor = { sessionId, objectiveVersion: root.objectiveVersion, sourceDigest, baselineDigest }
  let worker = await store.getNativeCodingSession(sessionId)
  if (!worker) {
    if (root.acceptanceWorkers?.some(item => item.sessionId === sessionId)) throw new Error('Missing linked private acceptance worker')
    const created = createNativeCodingSession({ id: sessionId, codingRunId, localProjectId: root.localProjectId,
      workflowRunId: root.workflowRunId, nodeId: root.nodeId, providerId: root.providerId, model: root.model,
      objective: root.objective, now: new Date().toISOString() })
    created.objectiveVersion = root.objectiveVersion
    created.binding = structuredClone(root.binding)
    created.limits = structuredClone(root.limits)
    created.operatorDeadlineAt = root.operatorDeadlineAt
    created.acceptance = structuredClone(root.acceptance)
    created.independentVerification = structuredClone(root.independentVerification ?? { plans: [], humanInputs: [] })
    created.transcript = [structuredClone(root.transcript[0]!)]
    created.privateAcceptanceFor = { rootSessionId: root.id, rootCodingRunId: root.codingRunId,
      objectiveVersion: root.objectiveVersion, sourceDigest, baselineDigest }
    if (root.taskBudget) created.taskBudget = { ...root.taskBudget, taskId: codingRunId, parentTaskId: root.taskBudget.taskId }
    await store.saveNativeCodingSession(parseNativeCodingSession(created), 0)
    worker = await store.getNativeCodingSession(sessionId)
  }
  if (!worker || worker.localProjectId !== root.localProjectId || worker.providerId !== root.providerId ||
      worker.model !== root.model || !isDeepStrictEqual(worker.privateAcceptanceFor, {
        rootSessionId: root.id, rootCodingRunId: root.codingRunId, objectiveVersion: root.objectiveVersion, sourceDigest, baselineDigest,
      })) throw new Error('Private acceptance identity changed')
  const linked = root.acceptanceWorkers?.find(item => item.sessionId === sessionId)
  if (linked) {
    if (!isDeepStrictEqual(linked, descriptor)) throw new Error('Private acceptance link changed')
    return worker
  }
  await mutateNativeCodingSession(store, root.id, current => {
    if (current.objectiveVersion !== root.objectiveVersion || current.pendingInput.length ||
        independentCheckSourceDigest(current) !== sourceDigest || !['ready', 'running'].includes(current.status))
      throw new Error('Private acceptance source changed before dispatch')
    current.acceptanceWorkers ??= []
    if (!current.acceptanceWorkers.some(item => item.sessionId === sessionId)) current.acceptanceWorkers.push(descriptor)
  })
  return worker
}

export async function mergeCodingAcceptancePlan(store: Store, rootId: string, workerId: string): Promise<void> {
  const worker = await store.getNativeCodingSession(workerId)
  const owner = worker?.privateAcceptanceFor
  const plan = worker && currentIndependentChecks(worker)
  if (!worker || !owner || !plan || worker.status !== 'completed' || owner.rootSessionId !== rootId ||
      plan.baselineDigest !== owner.baselineDigest) throw new Error('Independent acceptance plan is not ready')
  await mutateNativeCodingSession(store, rootId, root => {
    if (root.objectiveVersion !== owner.objectiveVersion || root.pendingInput.length ||
        independentCheckSourceDigest(root) !== owner.sourceDigest || root.status !== 'running' ||
        !root.acceptanceWorkers?.some(item => item.sessionId === workerId))
      throw new Error('Independent acceptance plan was superseded')
    if (currentIndependentChecks(root)) return
    // Session validation preserves the root's existing immutable plan/draft
    // prefixes. The worker never receives subsequent implementer history.
    root.independentVerification = structuredClone(worker.independentVerification!)
    root.binding!.testPlanDigest = codingDigest(JSON.stringify({ testPlan: root.binding!.testPlan, independentChecks: plan.digest }))
  })
}
