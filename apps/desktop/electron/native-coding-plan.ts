import { isDeepStrictEqual } from 'node:util'
import { COORDINATION_MAX_TASK_NODES, COORDINATION_MAX_DEPENDENCY_EDGES, redactSensitiveText, type CodingPlanNode, type CodingPlanRevision, type ReadOnlyFunctionDefinition } from '@ai-devflow/shared'
import { codingRelativePath } from './coding-candidate-workspace'
import type { NativeCodingSession } from './native-coding-session'
import type { CodingDeliveryEvidence } from './coding-evidence-v3'

const verifyId = 'host-verify'
const statuses = ['pending', 'in_progress', 'done', 'dropped'] as const
const idPattern = /^[a-z][a-z0-9_-]{0,63}$/
const strings = (maxItems: number, maxLength: number) => ({ type: 'array', maxItems, items: { type: 'string', minLength: 1, maxLength } })
export const updatePlanTool: ReadOnlyFunctionDefinition = { type: 'function', function: {
  name: 'update_plan',
  description: '按需给复杂任务建立计划。每次单独新增或更新一个节点，传当前 objectiveVersion 和计划 expectedVersion（新计划为 0）。新增必须给 title、kind，先建依赖项。完成时 evidenceRefs 引用本目标的成功工具调用 id 或已通过的命令 id。放弃须有 dropReason。宿主掌管验收节点。写入范围仅作计划说明。',
  parameters: { type: 'object', additionalProperties: false, required: ['objectiveVersion', 'expectedVersion', 'id'], properties: {
    objectiveVersion: { type: 'integer', minimum: 1 }, expectedVersion: { type: 'integer', minimum: 0 }, id: { type: 'string', maxLength: 64 },
    title: { type: 'string', minLength: 1, maxLength: 160 }, kind: { type: 'string', enum: ['investigate', 'implement'] },
    status: { type: 'string', enum: [...statuses] }, dropReason: { type: 'string', minLength: 1, maxLength: 500 },
    dependsOn: strings(11, 64), acceptanceRefs: strings(12, 256), writeScope: strings(12, 256), evidenceRefs: strings(12, 256),
  } },
} }

export function currentCodingPlan(session: NativeCodingSession): CodingPlanRevision | undefined {
  const latest = session.planHistory?.at(-1)
  return latest?.objectiveVersion === session.objectiveVersion ? latest : undefined
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/** A start or cancellation receipt alone does not prove a command passed. Link reads back to this objective's launch. */
function evidenceFor(session: NativeCodingSession, objective: number): Set<string> {
  const refs = new Set<string>()
  const receipts = session.toolReceipts.filter(item => item.objectiveVersion === objective && item.status === 'completed' && !item.error)
  const launched = new Set(receipts.filter(item => ['run_test_plan', 'run_command'].includes(item.name)).map(item => session.id + ':' + item.id))
  for (const receipt of receipts) {
    const result = record(receipt.result)
    if (!result || result.error || result.denied || result.executed === false || result.supersededByHumanSteering) continue
    if (receipt.effect === 'command' || ['read_command', 'cancel_command'].includes(receipt.name)) {
      const command = receipt.name === 'read_command' ? record(result.receipt) : result
      if (!command || !['run_command', 'run_test_plan', 'read_command'].includes(receipt.name) || command.status !== 'passed' ||
          command.exitCode !== 0 || typeof command.id !== 'string' || !launched.has(command.id)) continue
      refs.add(command.id)
    }
    refs.add(receipt.id)
  }
  return refs
}

function textField(value: unknown, limit: number): value is string {
  return typeof value === 'string' && Boolean(value.trim()) && value.length <= limit && !/[\u0000-\u001f\u007f]/u.test(value)
}

function listField(value: unknown, limit: number, width: number): value is string[] {
  return Array.isArray(value) && value.length <= limit && value.every(item => textField(item, width)) && new Set(value).size === value.length
}

const settled = (node: CodingPlanNode) => node.status === 'done' || node.status === 'dropped'
function hostNode(nodes: CodingPlanNode[], evidence?: string): CodingPlanNode {
  return { id: verifyId, kind: 'verify', owner: 'host', title: '验收交付', status: evidence ? 'done' : 'pending',
    dependsOn: nodes.filter(node => node.kind === 'implement').map(node => node.id), acceptanceRefs: [], writeScope: [], evidenceRefs: evidence ? [evidence] : [] }
}

function validDelivery(session: NativeCodingSession, objective: number, evidence: CodingDeliveryEvidence): boolean {
  return ['technical_completed', 'verified_no_change', 'manual_accepted'].includes(evidence.status) &&
    session.revisions.some(revision => revision.objectiveVersion === objective && revision.digest === evidence.revisionDigest)
}

function validateRevision(session: NativeCodingSession, plan: CodingPlanRevision, prior: CodingPlanRevision | undefined, evidence: Set<string>) {
  if (!plan || !Number.isSafeInteger(plan.objectiveVersion) || plan.objectiveVersion < 1 || plan.objectiveVersion > session.objectiveVersion ||
      plan.version !== (prior?.version ?? 0) + 1 || !Array.isArray(plan.nodes) || plan.nodes.length < 2 || plan.nodes.length > COORDINATION_MAX_TASK_NODES)
    throw new Error('Invalid plan revision or node count (maximum 12 including host verification)')
  const byId = new Map(plan.nodes.map(node => [node.id, node]))
  if (byId.size !== plan.nodes.length) throw new Error('Duplicate plan node id')
  for (const old of prior?.nodes ?? []) {
    const next = byId.get(old.id)
    if (!next || next.kind !== old.kind || (settled(old) && !isDeepStrictEqual(old, next))) throw new Error('Closed nodes are immutable; existing nodes must keep their id and kind')
  }
  const host = byId.get(verifyId)
  if (!host || !Array.isArray(host.evidenceRefs) || !isDeepStrictEqual(host, hostNode(plan.nodes, host.evidenceRefs[0])) ||
      (host.status === 'done' && !session.deliveryEvidence.some(item => item.id === host.evidenceRefs[0] && validDelivery(session, plan.objectiveVersion, item))))
    throw new Error('Only host delivery evidence can complete verification')
  let edges = 0
  for (const node of plan.nodes) {
    if (typeof node.id !== 'string' || !idPattern.test(node.id) || !textField(node.title, 160) || !statuses.includes(node.status) ||
        (node.id !== verifyId && (node.owner !== 'agent' || !['investigate', 'implement'].includes(node.kind))) ||
        !listField(node.dependsOn, 11, 64) || !listField(node.acceptanceRefs, 12, 256) || !listField(node.writeScope, 12, 256) || !listField(node.evidenceRefs, 12, 256))
      throw new Error('Invalid plan node fields or duplicate references')
    for (const scope of node.writeScope) codingRelativePath(scope)
    if (node.id !== verifyId && (node.evidenceRefs.some(ref => !evidence.has(ref)) || (node.status === 'done' && !node.evidenceRefs.length)))
      throw new Error('Completing work requires a successful tool receipt or passed command from this objective')
    if (node.status === 'dropped' ? !textField(node.dropReason, 500) : node.dropReason !== undefined) throw new Error('Only dropped nodes take a required dropReason')
    edges += node.dependsOn.length
    for (const dep of node.dependsOn) {
      const parent = byId.get(dep)
      if (!parent || dep === verifyId) throw new Error('Declare dependency nodes first; host verification cannot be a prerequisite')
      if ((node.status === 'done' || node.status === 'in_progress') && !settled(parent)) throw new Error('Finish prerequisite nodes before starting dependent work')
    }
  }
  if (edges > COORDINATION_MAX_DEPENDENCY_EDGES) throw new Error('Plan exceeds 24 dependency edges')
  const visiting = new Set<string>(), visited = new Set<string>()
  function visit(id: string) {
    if (visiting.has(id)) throw new Error('Plan dependencies contain a cycle')
    if (visited.has(id)) return
    visiting.add(id)
    for (const dep of byId.get(id)!.dependsOn) visit(dep)
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of byId.keys()) visit(id)
}

export function validateCodingPlanHistory(session: NativeCodingSession, previous?: NativeCodingSession) {
  const history = session.planHistory, prefix = previous?.planHistory ?? []
  if (!history && !prefix.length) return
  if (!Array.isArray(history) || session.parent || session.privateAcceptanceFor || !isDeepStrictEqual(history.slice(0, prefix.length), prefix))
    throw new Error('Root coding plan history is append-only')
  let prior = prefix.at(-1)
  const evidence = new Map<number, Set<string>>()
  for (const revision of history.slice(prefix.length)) {
    if (!revision || (prior && revision.objectiveVersion < prior.objectiveVersion) || (previous && revision.objectiveVersion !== session.objectiveVersion)) throw new Error('Stale plan objective')
    if (!evidence.has(revision.objectiveVersion)) evidence.set(revision.objectiveVersion, evidenceFor(session, revision.objectiveVersion))
    validateRevision(session, revision, prior?.objectiveVersion === revision.objectiveVersion ? prior : undefined, evidence.get(revision.objectiveVersion)!)
    prior = revision
  }
}

export function updateCodingPlan(session: NativeCodingSession, patch: Record<string, unknown>): CodingPlanRevision {
  const prior = currentCodingPlan(session)
  if (session.parent || session.privateAcceptanceFor) throw new Error('Only the root coding agent may update this plan')
  if (patch.objectiveVersion !== session.objectiveVersion || patch.expectedVersion !== (prior?.version ?? 0)) throw new Error('Stale plan; use the latest objectiveVersion and plan version')
  const id = patch.id
  if (typeof id !== 'string' || !idPattern.test(id) || id === verifyId) throw new Error('Use a short lowercase node id; host-verify belongs to the host')
  const old = prior?.nodes.find(node => node.id === id)
  if (old && settled(old)) throw new Error('Closed plan nodes are immutable')
  const { objectiveVersion: _objective, expectedVersion: _version, ...fields } = patch
  const editable = ['id', 'kind', 'title', 'status', 'dependsOn', 'acceptanceRefs', 'writeScope', 'evidenceRefs', 'dropReason']
  if (Object.keys(fields).some(key => !editable.includes(key))) throw new Error('Unknown plan field')
  const node = { owner: 'agent', status: 'pending', dependsOn: [], acceptanceRefs: [], writeScope: [], evidenceRefs: [], ...old, ...fields } as CodingPlanNode
  if (isDeepStrictEqual(node, old)) throw new Error('This patch would not change the plan')
  if (!listField(node.acceptanceRefs, 12, 256) || node.acceptanceRefs.some(ref => !session.acceptance.some(item => item.id === ref && item.objectiveVersion === session.objectiveVersion)))
    throw new Error('Use acceptance ids from this objective')
  // The plan is displayed in the renderer and returned in model context.
  if (redactSensitiveText(JSON.stringify(fields)).redacted) throw new Error('Remove sensitive information from the plan')
  const nodes = (prior?.nodes ?? []).filter(item => item.id !== verifyId).map(item => item.id === id ? node : item)
  if (!old) nodes.push(node)
  const plan = { version: (prior?.version ?? 0) + 1, objectiveVersion: session.objectiveVersion, nodes: [...nodes, hostNode(nodes)] }
  validateRevision(session, plan, prior, evidenceFor(session, session.objectiveVersion))
  session.planHistory ??= []
  session.planHistory.push(plan)
  return plan
}

export function unfinishedPlanWork(session: NativeCodingSession): string | undefined {
  const open = currentCodingPlan(session)?.nodes.filter(node => node.kind === 'implement' && !settled(node))
  if (open?.length) return 'Finish implementation nodes with evidence or drop them with a reason before proposing changes: ' + open.map(node => node.id).join(', ')
}

export function completeCodingPlan(session: NativeCodingSession, evidence: CodingDeliveryEvidence) {
  const plan = currentCodingPlan(session)
  if (!plan || plan.nodes.find(node => node.id === verifyId)?.status === 'done' || !validDelivery(session, plan.objectiveVersion, evidence)) return
  const nodes = plan.nodes.map(node => node.id === verifyId ? hostNode(plan.nodes, evidence.id) : node)
  session.planHistory!.push({ ...plan, version: plan.version + 1, nodes })
}

export function codingPlanContext(session: NativeCodingSession) {
  if (session.parent || session.privateAcceptanceFor) return undefined
  const plan = currentCodingPlan(session)
  if (!plan) return { version: 0 }
  return { version: plan.version, nodes: plan.nodes.map(({ id, title, status, dependsOn }) => ({ id, title, status, dependsOn })),
    acceptanceIds: session.acceptance.filter(item => item.objectiveVersion === session.objectiveVersion).map(item => item.id).slice(0, 12),
    recentEvidenceIds: [...evidenceFor(session, session.objectiveVersion)].slice(-12) }
}
