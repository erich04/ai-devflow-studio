/**
 * Deterministic gate-page fixtures F1–F6 (UX batch 1 requirements §6), shared by unit, component
 * and App tests. Built from the prototype's example; every digest is computed, never hard-coded.
 */
import {
  buildDesignRevisionIdentity,
  createDesignRevisionDigest,
  numberDesignVersions,
  createClarificationRevisionDigest,
  createWorkflowRunFromRequest,
  sha256Text,
  type AgentEvent,
  type AgentReviewMissingEvidenceDetail,
  type AgentReviewResult,
  type Artifact,
  type ClarificationRevisionStatus,
  type GateEnforcementDecision,
  type GateEnforcementReason,
  type NodeStage,
  type StageAgentExecutorProvenance,
  type WorkflowNode,
  type WorkflowRun,
} from '@ai-devflow/shared'
import { bindReview, reviewCheckOf } from '../app/gate-decision/review-binding'
import { gateReadingBlocks, indexReadingBlocks, locateOpenQuestions, newBlocks } from '../app/gate-decision/material'
import { resolveGatePage, type GatePage, type GateVersion } from '../app/gate-decision/page'
import { deriveReviewTarget, type GateProjectionInput, type GateVersionFacts } from '../app/gate-decision/projection'
import { applyRevisionListOp, deriveChatItems, emptyRevisionList, type ListTarget, type RevisionListOp, type StoredRevisionList } from '../app/gate-decision/revision-list'
export { designRevisionFixture } from './design-revision'
export const GATE_FIXTURE_RUN_ID = 'gate-run'
export const GATE_FIXTURE_NOW = '2026-10-30T08:00:00.000Z'
const at = (minutes: number) => new Date(Date.parse(GATE_FIXTURE_NOW) + minutes * 60_000).toISOString()
export const nodeIdsOf = (runId = GATE_FIXTURE_RUN_ID) => ({
  clarify: `${runId}-clarify`, clarifyGate: `${runId}-clarify-gate`, design: `${runId}-design`, designGate: `${runId}-design-gate`,
})
export type GateFixture = {
  run: WorkflowRun
  artifacts: Artifact[]
  reviews: AgentReviewResult[]
  events: AgentEvent[]
  agentNode: WorkflowNode
  gateNode: WorkflowNode
  /** The version the gate asks to approve. */
  current: Artifact
  /** The version before `current`, when there is one. */
  previous?: Artifact
  /** The gate node's latest review, when there is one. */
  review?: AgentReviewResult
}
export const F1_QUESTIONS = ['搜索是否区分大小写？', '是否允许搜索已归档的任务？'] as const
export const F1_FINDINGS = [
  '待确认问题 1 没有结论：大小写规则会改变验收标准的匹配结果。',
  '两条验收标准都没有说明多个关键词的处理方式。',
  '目标里可以写明搜索入口的位置。',
  '非目标可以补充为什么不做全文检索。',
  '可以补一条性能预期。',
] as const
const F1_GOALS = ['用户可以按关键词搜索任务。', '搜索结果保留状态筛选。']
const F1_CRITERIA = ['输入关键词后，列表只显示标题包含关键词的任务。', '没有匹配时显示「暂无匹配任务」。']
const F1_NON_GOALS = ['不做全文检索。']
const F1_ASSUMPTIONS = ['任务数量在 1000 条以内。']
const F1_RISKS = ['中文分词可能影响匹配。']
const section = (title: string, values: readonly string[]) => [`## ${title}`, ...(values.length ? values.map((value) => `- ${value}`) : ['- None recorded.']), '']
function requirementContent(input: { goals: readonly string[]; criteria: readonly string[]; questions: readonly string[] }) {
  return [
    ...section('Goals', input.goals), ...section('Acceptance Criteria', input.criteria), ...section('Non-goals', F1_NON_GOALS),
    ...section('Assumptions', F1_ASSUMPTIONS), ...section('Risks', F1_RISKS), ...section('Open Questions', input.questions),
    '## Repository Findings', '- Repository verification was not performed by this executor.', '',
  ].join('\n')
}
const DESIGN_V1_CONTENT = [
  '> Source: fake/template · Provider: fake · Model: fake · Generated: 2026-10-30T08:20:00.000Z', '',
  '## Implementation', '- 在任务列表上方加入搜索框。', '- 搜索在前端完成，不新增依赖。', '',
  '## Verification', '- 单元测试覆盖大小写和空结果。', '',
  '## Delivery and rollback', '- 出问题时移除搜索框即可回退。', '',
].join('\n')
export const F4_FINDINGS = ['搜索框的位置没有说明在窄屏下怎么排。', '验证计划没有覆盖保留状态筛选。', '回退说明可以写明影响的文件。'] as const
function executor(startedAt: string): StageAgentExecutorProvenance {
  return { version: 1, kind: 'direct-provider', executorId: 'fake', executorVersion: '1', capabilityProfile: 'repository-read-only-v1',
    providerId: 'fake-provider', model: 'fake-model', startedAt, completedAt: startedAt, durationMs: 0, terminalReason: 'success', contextDigest: 'context' }
}
function baseRun(runId = GATE_FIXTURE_RUN_ID) {
  return createWorkflowRunFromRequest({ runId, title: '任务搜索', request: '给任务列表加搜索。\n保留状态筛选，不新增依赖。',
    projectId: 'project-1', creatorId: 'user-1', branchName: 'feature/search', now: GATE_FIXTURE_NOW })
}
type Placement = { stage: NodeStage; agentArtifacts: string[]; gateArtifacts: string[]; finishedStages?: NodeStage[] }
function placeRun(run: WorkflowRun, placement: Placement): WorkflowRun {
  const ids = nodeIdsOf(run.id)
  const agentId = placement.stage === 'clarify' ? ids.clarify : ids.design
  const gateId = placement.stage === 'clarify' ? ids.clarifyGate : ids.designGate
  const finished = new Set(placement.finishedStages ?? [])
  return { ...run, status: 'paused_at_gate', currentNodeId: gateId,
    nodes: run.nodes.map((node) => {
      if (finished.has(node.stage)) return { ...node, status: 'success' as const }
      if (node.id === agentId) return { ...node, status: 'success' as const, artifactIds: [...node.artifactIds, ...placement.agentArtifacts] }
      if (node.id === gateId) return { ...node, status: 'running' as const, artifactIds: placement.gateArtifacts }
      return node
    }) }
}
async function clarificationArtifact(input: { runId: string; revision: number; status: ClarificationRevisionStatus; questions: readonly string[];
  criteria?: readonly string[]; previous?: Artifact; feedbackIds?: string[]; updatedAt: string }): Promise<Artifact> {
  const ids = nodeIdsOf(input.runId)
  const fields = { title: '需求澄清结果', summary: '任务搜索的范围与验收标准。', goals: F1_GOALS, acceptanceCriteria: [...(input.criteria ?? F1_CRITERIA)],
    nonGoals: F1_NON_GOALS, assumptions: F1_ASSUMPTIONS, risks: F1_RISKS, openQuestions: [...input.questions] }
  return { id: `${input.runId}-clarification-v${input.revision}`, runId: input.runId, nodeId: ids.clarify, kind: 'clarification',
    title: fields.title, summary: fields.summary, redacted: true, updatedAt: input.updatedAt,
    content: requirementContent({ goals: fields.goals, criteria: fields.acceptanceCriteria, questions: fields.openQuestions }),
    clarificationRevision: { version: 1, revision: input.revision, status: input.status, revisionDigest: await createClarificationRevisionDigest(fields),
      rawRequestArtifactId: `artifact-${input.runId}-raw-request`, ...(input.previous ? { previousRevisionArtifactId: input.previous.id } : {}),
      feedbackArtifactIds: input.feedbackIds ?? [], ...fields, executor: executor(input.updatedAt), generatedAt: input.updatedAt, inputProposals: [] } }
}
/** A citation of `quote` in `artifact`, exactly as the grounding code stores a verified one. */
export async function citationOf(artifact: Artifact, quote: string) {
  const start = artifact.content.indexOf(quote)
  if (start < 0) throw new Error(`Quote not in fixture: ${quote}`)
  return { sourceId: artifact.id, title: artifact.title, quote, contentDigest: await sha256Text(artifact.content), start, end: start + quote.length, updatedAt: artifact.updatedAt }
}
export async function reviewOf(input: { id: string; artifact: Artifact; gateNodeId: string; findings: readonly string[]; createdAt: string
  details?: Array<{ quotes: readonly string[]; importance?: 'important' | 'suggestion' }>; manifest?: boolean }): Promise<AgentReviewResult> {
  const { artifact } = input
  const digest = await sha256Text(artifact.content)
  const details: AgentReviewMissingEvidenceDetail[] = await Promise.all((input.details ?? []).map(async (detail, index) => ({
    index, assessment: 'gap' as const, requiresReview: true, citations: await Promise.all(detail.quotes.map((quote) => citationOf(artifact, quote))),
    ...(detail.importance ? { importance: detail.importance } : {}) })))
  const stage = artifact.kind === 'design' ? 'design' : 'clarify'
  return { id: input.id, requestId: `${input.id}-request`, projectId: 'project-1', runId: artifact.runId, nodeId: input.gateNodeId,
    runtime: 'electron', providerId: 'fake-provider', model: 'fake-model', conclusion: '需要补充', summary: '审查摘要',
    risks: [], suggestedTests: [], knowledgeReferences: [], policyFindings: [], confidence: 0.8,
    missingEvidence: [...input.findings], ...(input.details ? { missingEvidenceDetails: details } : {}),
    gateAdvisory: { id: `${input.id}-advisory`, runId: artifact.runId, nodeId: input.gateNodeId, level: 'warn', blocksApproval: false, summary: '建议', missingEvidence: [], riskCount: 0, createdAt: input.createdAt },
    createdAt: input.createdAt,
    ...(input.manifest === false ? {} : { contextManifest: { version: 1 as const, stage, coverage: 'complete' as const,
      runRequest: { contentDigest: 'raw', sanitizerVersion: '1', coverage: 'complete' as const },
      subjectArtifacts: [{ id: artifact.id, runId: artifact.runId, nodeId: artifact.nodeId, kind: artifact.kind, updatedAt: artifact.updatedAt,
        contentDigest: digest, sanitizerVersion: '1', coverage: 'complete' as const, chunks: [] }],
      knowledgeCriteria: [], criteriaCoverage: 'empty' as const } as unknown as NonNullable<AgentReviewResult['contextManifest']> }) }
}
function fixtureOf(run: WorkflowRun, stage: NodeStage, rest: Omit<GateFixture, 'run' | 'agentNode' | 'gateNode'>): GateFixture {
  const ids = nodeIdsOf(run.id)
  const node = (id: string) => run.nodes.find((item) => item.id === id)!
  return { run, ...rest, agentNode: node(stage === 'clarify' ? ids.clarify : ids.design), gateNode: node(stage === 'clarify' ? ids.clarifyGate : ids.designGate) }
}
/** F1: requirement v1 at the current gate, reviewed with levels; 意见 1 cites 问题 1 verbatim. */
export async function buildF1(options: { levels?: boolean } = {}): Promise<GateFixture> {
  const levels = options.levels ?? true
  const created = baseRun()
  const ids = nodeIdsOf()
  const v1 = await clarificationArtifact({ runId: created.run.id, revision: 1, status: 'review_requested', questions: F1_QUESTIONS, updatedAt: at(5) })
  const level = (value: 'important' | 'suggestion') => (levels ? value : undefined)
  const review = await reviewOf({ id: 'review-f1', artifact: v1, gateNodeId: ids.clarifyGate, findings: F1_FINDINGS, createdAt: at(10), details: [
    { quotes: [F1_QUESTIONS[0], F1_GOALS[0]!], importance: level('important')! },
    { quotes: [F1_CRITERIA[0]!, F1_CRITERIA[1]!], importance: level('important')! },
    { quotes: [F1_GOALS[0]!], importance: level('suggestion')! },
    { quotes: [F1_NON_GOALS[0]!], importance: level('suggestion')! },
    { quotes: [], importance: level('suggestion')! },
  ].map((detail) => (detail.importance ? detail : { quotes: detail.quotes })) })
  const run = placeRun(created.run, { stage: 'clarify', agentArtifacts: [v1.id], gateArtifacts: [v1.id] })
  return fixtureOf(run, 'clarify', { artifacts: [...created.artifacts, v1], reviews: [review], events: [...created.events], current: v1, review })
}
/** F2: F1 without levels. */
export const buildF2 = () => buildF1({ levels: false })
export const F3_REVISION_TEXT = '修订清单（共 2 项，针对需求 v1）：\n1. 来自问题 1：待确认问题「搜索是否区分大小写？」的回答是：不区分。请把这个决定写进需求正文的相应位置，并从待确认问题中删除这个问题。\n2. 我添加的：补一条多个关键词的验收标准。'
/** F3: requirement v2 generated after F1's review; the only review still targets v1. */
export async function buildF3(): Promise<GateFixture> {
  const f1 = await buildF1()
  const ids = nodeIdsOf()
  const v1: Artifact = { ...f1.current, clarificationRevision: { ...f1.current.clarificationRevision!, status: 'superseded' } }
  const feedback: Artifact = { id: `${f1.run.id}-clarification-feedback-1`, runId: f1.run.id, nodeId: ids.clarifyGate, kind: 'clarification_feedback',
    title: '需求 v1 的修订意见', summary: '修订清单', content: F3_REVISION_TEXT, redacted: true, updatedAt: at(20),
    clarificationFeedback: { version: 1, targetArtifactId: v1.id, targetRevision: 1, targetRevisionDigest: v1.clarificationRevision!.revisionDigest,
      actorId: 'user-1', actorName: 'User', reasonDigest: await sha256Text(F3_REVISION_TEXT), createdAt: at(20), proposals: [] } }
  const v2 = await clarificationArtifact({ runId: f1.run.id, revision: 2, status: 'review_requested', questions: [F1_QUESTIONS[1]],
    criteria: [...F1_CRITERIA, '输入多个关键词时，任务标题需包含全部关键词。', '搜索不区分大小写。'], previous: v1, feedbackIds: [feedback.id], updatedAt: at(30) })
  const created = baseRun()
  const run = placeRun(created.run, { stage: 'clarify', agentArtifacts: [v1.id, v2.id], gateArtifacts: [v2.id] })
  return fixtureOf(run, 'clarify', { artifacts: [...created.artifacts, v1, feedback, v2], reviews: f1.reviews, events: f1.events, current: v2, previous: v1, review: f1.review! })
}
async function approvedClarification(runId: string) {
  return clarificationArtifact({ runId, revision: 1, status: 'approved', questions: [], updatedAt: at(5) })
}
async function designV1(runId: string, approved: Artifact, options: { legacy?: boolean } = {}): Promise<Artifact> {
  const ids = nodeIdsOf(runId)
  return { id: `${runId}-design-v1`, runId, nodeId: ids.design, kind: 'design', title: '方案设计', summary: '前端搜索方案。', redacted: true,
    content: DESIGN_V1_CONTENT, updatedAt: at(40),
    ...(options.legacy ? {} : { designEvidence: { version: 1 as const, executor: executor(at(40)), clarification: { gateNodeId: ids.clarifyGate,
      artifactId: approved.id, contentDigest: await sha256Text(approved.content), revision: 1, revisionDigest: approved.clarificationRevision!.revisionDigest, legacy: false } } }) }
}
/** F4: design v1 at the current design gate, reviewed: 3 findings, 2 of them 重要. */
export async function buildF4(): Promise<GateFixture> {
  const created = baseRun()
  const ids = nodeIdsOf()
  const approved = await approvedClarification(created.run.id)
  const design = await designV1(created.run.id, approved)
  const review = await reviewOf({ id: 'review-f4', artifact: design, gateNodeId: ids.designGate, findings: F4_FINDINGS, createdAt: at(45), details: [
    { quotes: ['在任务列表上方加入搜索框。'], importance: 'important' },
    { quotes: ['单元测试覆盖大小写和空结果。'], importance: 'important' },
    { quotes: [], importance: 'suggestion' },
  ] })
  const placed = placeRun(created.run, { stage: 'design', agentArtifacts: [design.id], gateArtifacts: [design.id], finishedStages: ['clarify'] })
  const run = { ...placed, nodes: placed.nodes.map((node) => node.id === ids.clarify || node.id === ids.clarifyGate ? { ...node, artifactIds: [approved.id] } : node) }
  return fixtureOf(run, 'design', { artifacts: [...created.artifacts, approved, design], reviews: [review], events: [...created.events], current: design, review })
}
export const F5_CHANGE_REQUEST = '修订清单（共 1 项，针对方案 v1）：\n1. 来自意见 2：验证计划补充保留状态筛选。'
/** F5: design v2 generated after F4's review; the only review targets v1. */
export async function buildF5(): Promise<GateFixture> {
  const f4 = await buildF4()
  const ids = nodeIdsOf()
  const v1 = f4.current
  const v2: Artifact = { ...v1, id: `${f4.run.id}-design-v2`, updatedAt: at(60),
    content: DESIGN_V1_CONTENT.replace('- 单元测试覆盖大小写和空结果。', '- 单元测试覆盖大小写和空结果。\n- 单元测试覆盖保留状态筛选。'),
    designRevision: { version: 1, previous: await buildDesignRevisionIdentity(v1), proposals: [], changeRequest: F5_CHANGE_REQUEST } }
  const run = { ...f4.run, version: f4.run.version + 1, nodes: f4.run.nodes.map((node) =>
    node.id === ids.designGate ? { ...node, artifactIds: [v2.id] } : node.id === ids.design ? { ...node, artifactIds: [...node.artifactIds, v2.id] } : node) }
  return fixtureOf(run, 'design', { artifacts: [...f4.artifacts, v2], reviews: f4.reviews, events: f4.events, current: v2, previous: v1, review: f4.review! })
}
/** F6: legacy data — a clarification without revision metadata, a review without manifest or located citations, a design without design evidence. */
export async function buildF6(): Promise<{ requirement: GateFixture; design: GateFixture }> {
  const created = baseRun()
  const ids = nodeIdsOf()
  const legacyClarification: Artifact = { id: `${created.run.id}-clarification-legacy`, runId: created.run.id, nodeId: ids.clarify, kind: 'clarification',
    title: '需求澄清结果', summary: '旧版记录', redacted: true, updatedAt: at(5),
    content: requirementContent({ goals: F1_GOALS, criteria: F1_CRITERIA, questions: F1_QUESTIONS }) }
  const legacyReview = await reviewOf({ id: 'review-f6', artifact: legacyClarification, gateNodeId: ids.clarifyGate, findings: F1_FINDINGS.slice(0, 2), createdAt: at(10), manifest: false })
  const requirementRun = placeRun(created.run, { stage: 'clarify', agentArtifacts: [legacyClarification.id], gateArtifacts: [legacyClarification.id] })
  const requirement = fixtureOf(requirementRun, 'clarify', { artifacts: [...created.artifacts, legacyClarification], reviews: [legacyReview], events: [...created.events],
    current: legacyClarification, review: legacyReview })
  const approved = await approvedClarification(created.run.id)
  const design = await designV1(created.run.id, approved, { legacy: true })
  const placed = placeRun(created.run, { stage: 'design', agentArtifacts: [design.id], gateArtifacts: [design.id], finishedStages: ['clarify'] })
  const designRun = { ...placed, nodes: placed.nodes.map((node) => node.id === ids.clarify || node.id === ids.clarifyGate ? { ...node, artifactIds: [approved.id] } : node) }
  return { requirement, design: fixtureOf(designRun, 'design', { artifacts: [...created.artifacts, approved, design], reviews: [], events: [...created.events], current: design }) }
}
/** A gate enforcement reason with Chinese summary and remediation. */
export const policyReason = (target: GateEnforcementReason['target'], id = `${target}-1`): GateEnforcementReason =>
  ({ id, target, ruleKey: target, action: 'block', summary: `${target} 摘要`, remediation: `${target} 处理方法` })
/** A gate enforcement decision; `pass` unless overridden. */
export function policyDecision(overrides: Partial<GateEnforcementDecision> = {}): GateEnforcementDecision {
  return { status: 'pass', blocksApproval: false, blockingReasons: [], warningReasons: [], requiredActions: [], canOverride: false,
    overrideRoleRequired: 'lead', policySource: 'built_in_default', policyVersion: 1, provisional: false, ...overrides }
}
/** The exact list target of a version. */
export async function listTargetFor(artifact: Artifact): Promise<ListTarget> {
  return artifact.kind === 'design'
    ? { kind: 'design', runId: artifact.runId, artifactId: artifact.id, updatedAt: artifact.updatedAt, contentDigest: await createDesignRevisionDigest(artifact) }
    : { kind: 'requirement', runId: artifact.runId, artifactId: artifact.id, revision: artifact.clarificationRevision?.revision ?? 1, revisionDigest: artifact.clarificationRevision!.revisionDigest }
}
/** A stored list of `artifact` after `ops`, one millisecond apart. */
export async function listFor(artifact: Artifact, ops: readonly RevisionListOp[] = []): Promise<StoredRevisionList> {
  const start = Date.parse('2026-10-30T09:00:00.000Z')
  let list = emptyRevisionList(await listTargetFor(artifact), new Date(start).toISOString())
  for (const [index, op] of ops.entries()) {
    const result = applyRevisionListOp(list, op, new Date(start + (index + 1) * 1000).toISOString())
    if (!result.ok) throw new Error(result.message)
    list = result.list
  }
  return list
}
async function versionFacts(page: GatePage, version: GateVersion, review: AgentReviewResult | undefined, artifacts: readonly Artifact[]): Promise<GateVersionFacts> {
  const { artifact } = version
  const blocks = indexReadingBlocks(gateReadingBlocks(artifact.content))
  const previousId = artifact.clarificationRevision?.previousRevisionArtifactId ?? artifact.designRevision?.previous.artifactId
  const previous = previousId ? artifacts.find((item) => item.id === previousId) : undefined
  return {
    artifact, ...(version.number === undefined ? {} : { number: version.number }), label: version.label,
    binding: bindReview({ review, artifact, contentDigest: { state: 'done', value: await sha256Text(artifact.content) }, blocks }),
    questions: page.kind === 'requirement' ? locateOpenQuestions(artifact.content, artifact.clarificationRevision?.openQuestions ?? []) : [],
    blocks, newBlocks: newBlocks(artifact.content, previous?.content),
  }
}
/**
 * The projection input of a fixture as App would build it once every digest is known: a passing
 * policy, a Lead who may approve, nothing running. `overrides` replace any field.
 */
export async function gateProjectionInput(fixture: GateFixture, options: {
  nodeId?: string; readingArtifactId?: string; list?: StoredRevisionList; readingList?: StoredRevisionList
} = {}, overrides: Partial<GateProjectionInput> = {}): Promise<GateProjectionInput> {
  const node = fixture.run.nodes.find((item) => item.id === (options.nodeId ?? fixture.gateNode.id))!
  const page = resolveGatePage({ run: fixture.run, node, artifacts: fixture.artifacts, reviews: fixture.reviews, events: fixture.events,
    ...(options.readingArtifactId ? { readingArtifactId: options.readingArtifactId } : {}) })
  if (!page) throw new Error('Fixture is not a gate page')
  const designNumbers = numberDesignVersions(fixture.run.id, fixture.artifacts)
  const current = await versionFacts(page, page.current, page.currentReview, fixture.artifacts)
  const reading = page.reading.artifact.id === page.current.artifact.id ? undefined : await versionFacts(page, page.reading, page.readingReview, fixture.artifacts)
  return {
    kind: page.kind, mode: page.mode,
    current: { ...current, determinable: page.determinable, ...(page.determinableMessage ? { determinableMessage: page.determinableMessage } : {}) },
    ...(reading ? { reading } : {}),
    artifacts: fixture.artifacts, designNumbers, rawRequest: fixture.run.request,
    reviewTarget: deriveReviewTarget({ kind: page.kind, run: fixture.run, gateNode: page.gateNode, reviews: fixture.reviews, current: page.current.artifact, artifacts: fixture.artifacts, designNumbers }),
    ...(options.list ? { list: options.list } : {}),
    ...(options.readingList ? { readingList: options.readingList } : {}),
    chatItems: deriveChatItems({ kind: page.kind, runId: fixture.run.id, agentNodeId: page.agentNode.id, gateNodeId: page.gateNode.id, artifacts: fixture.artifacts, list: options.list, otherLists: [] }),
    policy: { decision: policyDecision(), isLoading: false, enabled: true, teamBinding: true },
    reviewCheck: { state: reviewCheckOf({ binding: current.binding }) },
    permission: { roleCanApprove: true, role: 'lead', ...(page.gateNode.requiredRole ? { requiredRole: page.gateNode.requiredRole } : {}) },
    runFacts: { reviewRunning: false, generationRunning: false, writeLock: false },
    generation: { executorLabel: 'Direct Provider', modelLabel: 'fake-model', modelSelected: true },
    reviewProviderLabel: 'Fake · fake-model',
    generationAllowed: page.generationAllowed,
    ...overrides,
  }
}
/** F1 after 「提交修订，生成 v2」 committed the request: v1 is revision_requested and the run sits at the clarify agent node. */
export async function buildF1RevisionPending(text = F3_REVISION_TEXT): Promise<GateFixture & { feedback: Artifact }> {
  const f1 = await buildF1()
  const ids = nodeIdsOf()
  const v1: Artifact = { ...f1.current, clarificationRevision: { ...f1.current.clarificationRevision!, status: 'revision_requested' } }
  const feedback: Artifact = { id: `${f1.run.id}-clarification-feedback-1`, runId: f1.run.id, nodeId: ids.clarifyGate, kind: 'clarification_feedback',
    title: '需求 v1 的修订意见', summary: '修订清单', content: text, redacted: true, updatedAt: at(20),
    clarificationFeedback: { version: 1, targetArtifactId: v1.id, targetRevision: 1, targetRevisionDigest: v1.clarificationRevision!.revisionDigest,
      actorId: 'user-1', actorName: 'User', reasonDigest: await sha256Text(text), createdAt: at(20), proposals: [] } }
  const run: WorkflowRun = { ...f1.run, status: 'clarifying', currentNodeId: ids.clarify,
    nodes: f1.run.nodes.map((node) => node.id === ids.clarify ? { ...node, status: 'running' as const } : node.id === ids.clarifyGate ? { ...node, status: 'pending' as const, artifactIds: [] } : node) }
  const artifacts = f1.artifacts.map((artifact) => (artifact.id === v1.id ? v1 : artifact)).concat(feedback)
  return { ...fixtureOf(run, 'clarify', { artifacts, reviews: f1.reviews, events: f1.events, current: v1, review: f1.review! }), feedback }
}
