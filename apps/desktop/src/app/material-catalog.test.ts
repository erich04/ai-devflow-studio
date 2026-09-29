import { describe, expect, it } from 'vitest'
import {
  buildClarificationReviewBundle,
  completeWorkflowAgentNode,
  createWorkflowRunFromRequest,
  type AgentEvent,
  type Artifact,
  type WorkflowRun,
} from '@ai-devflow/shared'
import { artifacts as fixtureArtifacts, runs as fixtureRuns } from '@ai-devflow/shared/fixtures'
import {
  describeMaterial,
  groupMaterials,
  pendingRequirementTarget,
  selectDefaultMaterial,
  selectRequirementReading,
  type MaterialContext,
} from './material-catalog'

const now = '2026-09-28T10:00:00.000Z'
const time = (iso: string) => iso.slice(11, 16)

function revision(run: WorkflowRun, nodeId: string, number: number, status: NonNullable<Artifact['clarificationRevision']>['status'], rawId: string): Artifact {
  return {
    id: `artifact-${run.id}-clarification${number === 1 ? '' : `-v${number}`}`, runId: run.id, nodeId, kind: 'clarification',
    // Same business title for every version: the case of Issue #181.
    title: '为任务清单增加按完成状态筛选的功能', summary: `Revision ${number}.`, content: `Body ${number}.`, redacted: true,
    updatedAt: `2026-09-28T10:0${number}:00.000Z`,
    clarificationRevision: {
      version: 1, revision: number, status, revisionDigest: String(number).repeat(64),
      rawRequestArtifactId: rawId, feedbackArtifactIds: [],
      goals: ['Goal'], acceptanceCriteria: ['Acceptance'], nonGoals: [], assumptions: [], risks: [], openQuestions: [],
      executor: {
        version: 1, kind: 'direct-provider', executorId: 'fake', executorVersion: '1',
        capabilityProfile: 'repository-read-only-v1', model: 'fake', startedAt: now,
        completedAt: now, durationMs: 1, terminalReason: 'success', contextDigest: 'b'.repeat(64),
      },
      generatedAt: now,
    },
  }
}

/** Raw request, a discussion proposal, v1 and v2 on the clarification step; the Gate links v2. */
function issue181(v1Status: 'superseded' | 'approved', v2Status: 'approved' | 'review_requested') {
  const created = createWorkflowRunFromRequest({
    runId: 'run-181', title: '任务筛选', request: '为任务清单增加按完成状态筛选的功能。', projectId: 'project-1',
    creatorId: 'user-1', branchName: 'ai/filter', now,
  })
  const clarify = created.run.nodes.find((node) => node.stage === 'clarify' && node.kind === 'agent')!
  const raw = created.artifacts.find((artifact) => artifact.kind === 'raw_request')!
  const v1 = revision(created.run, clarify.id, 1, v1Status, raw.id)
  const completed = completeWorkflowAgentNode({
    run: created.run, nodeId: clarify.id, artifacts: created.artifacts, generatedArtifact: v1,
    existingEvents: created.events, actorName: 'User', now,
  })
  const v2 = { ...revision(completed.run, clarify.id, 2, v2Status, raw.id), clarificationRevision: { ...revision(completed.run, clarify.id, 2, v2Status, raw.id).clarificationRevision!, previousRevisionArtifactId: v1.id } }
  const gate = completed.run.nodes.find((node) => node.stage === 'clarify' && node.kind === 'gate')!
  const run: WorkflowRun = {
    ...completed.run,
    nodes: completed.run.nodes.map((node) => node.id === gate.id
      ? { ...node, artifactIds: [v2.id], status: v2Status === 'approved' ? 'success' : 'running' }
      : node),
  }
  const proposal: Artifact = {
    id: 'conversation-proposal-message-1', runId: run.id, nodeId: clarify.id, kind: 'log',
    title: '讨论提案（待确认）：需求澄清结论（草稿）：按完成状态筛选', summary: 'Proposal.', content: '状态：待确认的讨论提案', redacted: true, updatedAt: '2026-09-28T10:03:00.000Z',
  }
  const artifacts = [...completed.artifacts.filter((artifact) => artifact.id !== v1.id), v1, proposal, v2]
  const gateNode = run.nodes.find((node) => node.id === gate.id)!
  const context: MaterialContext = { run, events: [], formatTime: time }
  return { run, gateNode, artifacts, raw, v1, v2, proposal, context }
}

describe('material labels and groups (plan §9.1, S4 Z5, Issue #181)', () => {
  it('tells the four materials of Issue #181 apart by type, version, status and time', () => {
    const value = issue181('superseded', 'approved')
    const labels = [value.raw, value.proposal, value.v1, value.v2].map((artifact) => describeMaterial(artifact, value.context).label)
    expect(labels).toEqual([
      '原始需求 原始输入 · 10:00',
      '讨论提案 记录于 10:03 · 待确认，不是正式材料',
      '需求澄清 v1 · 已被替代（历史） · 10:01',
      '需求澄清 v2 · 已确认 · 10:02',
    ])
    expect(groupMaterials([value.v2, value.raw, value.proposal, value.v1].map((artifact) => describeMaterial(artifact, value.context)))
      .map((section) => [section.label, section.entries.map((entry) => entry.artifact.id)]))
      .toEqual([
        ['已确认依据', [value.v2.id]],
        ['原始输入与参考', [value.raw.id]],
        ['讨论提案', [value.proposal.id]],
        ['历史记录', [value.v1.id]],
      ])
  })

  it('never shows a clarification without version metadata as confirmed unless its Gate passed', () => {
    const value = issue181('superseded', 'review_requested')
    const { clarificationRevision: _dropped, ...withoutMetadata } = value.v1
    const legacy: Artifact = { ...withoutMetadata, id: 'legacy-clarification' }
    const pendingGate = describeMaterial(legacy, { ...value.context, run: { ...value.run, nodes: value.run.nodes.map((node) => node.id === value.gateNode.id ? { ...node, artifactIds: [legacy.id] } : node) } })
    expect(pendingGate).toMatchObject({ statusLabel: '旧版记录，状态未记录', group: 'pending', versionLabel: '记录于 10:01' })
    const passedGate = describeMaterial(legacy, { ...value.context, run: { ...value.run, nodes: value.run.nodes.map((node) => node.id === value.gateNode.id ? { ...node, artifactIds: [legacy.id], status: 'success' } : node) } })
    expect(passedGate.statusLabel).toContain('需求确认 Gate 已通过')
    expect(passedGate.statusLabel).not.toBe('已确认')
  })

  it('reads a design as pending review, confirmed by its approval record, or changed after approval', () => {
    const run = fixtureRuns[0]!
    const design = fixtureArtifacts.find((artifact) => artifact.id === 'art-design')!
    const context: MaterialContext = { run, events: [], formatTime: time }
    expect(describeMaterial(design, context)).toMatchObject({ typeLabel: '方案设计', statusLabel: '待评审', group: 'pending' })
    const passed = { ...run, nodes: run.nodes.map((node) => node.id === 'n-design-gate' ? { ...node, status: 'success' as const } : node) }
    expect(describeMaterial(design, { ...context, run: passed }).statusLabel).toBe('方案评审 Gate 已通过（旧记录未绑定版本）')
    const approval: AgentEvent = {
      id: 'approval', runId: run.id, nodeId: 'n-design-gate', sequence: 9, kind: 'approval', message: 'approved', timestamp: now,
      designAudit: { version: 1, action: 'approved', artifactId: design.id, updatedAt: design.updatedAt, contentDigest: 'a'.repeat(64), actorId: 'u-ling' },
    }
    expect(describeMaterial(design, { ...context, run: passed, events: [approval] })).toMatchObject({ statusLabel: '已确认', group: 'confirmed' })
    expect(describeMaterial({ ...design, updatedAt: '2030-01-01T00:00:00.000Z' }, { ...context, run: passed, events: [approval] }).group).toBe('history')
  })
})

describe('default reading (plan §9.1, S4 Z4, Issue #181)', () => {
  it('opens the approved v2 by default and still reaches every other material', () => {
    const value = issue181('superseded', 'approved')
    const bundle = buildClarificationReviewBundle({ run: value.run, gateNode: value.gateNode, artifacts: value.artifacts })
    expect(selectRequirementReading(bundle)?.id).toBe(value.v2.id)
    expect(pendingRequirementTarget(bundle)).toBeUndefined()
    for (const artifact of [value.v1, value.raw]) expect(selectRequirementReading(bundle, artifact.id)?.id).toBe(artifact.id)
    // A proposal is not a requirement version; asking for it falls back to the bound version.
    expect(selectRequirementReading(bundle, value.proposal.id)?.id).toBe(value.v2.id)
  })

  it('opens the pending version when an approved older version and a newer pending one both exist', () => {
    const value = issue181('approved', 'review_requested')
    const bundle = buildClarificationReviewBundle({ run: value.run, gateNode: value.gateNode, artifacts: value.artifacts })
    expect(selectRequirementReading(bundle)?.id).toBe(value.v2.id)
    expect(pendingRequirementTarget(bundle)?.id).toBe(value.v2.id)
  })

  it('falls back to the confirmed version, then the latest, then nothing when there is no formal material', () => {
    const value = issue181('approved', 'review_requested')
    const unlinked = { ...value.gateNode, artifactIds: [] }
    const revising = value.artifacts.map((artifact) => artifact.id === value.v2.id
      ? { ...artifact, clarificationRevision: { ...artifact.clarificationRevision!, status: 'revision_requested' as const } }
      : artifact)
    expect(selectRequirementReading(buildClarificationReviewBundle({ run: value.run, gateNode: unlinked, artifacts: revising }))?.id).toBe(value.v1.id)
    const noApproval = revising.map((artifact) => artifact.id === value.v1.id
      ? { ...artifact, clarificationRevision: { ...artifact.clarificationRevision!, status: 'superseded' as const } }
      : artifact)
    expect(selectRequirementReading(buildClarificationReviewBundle({ run: value.run, gateNode: unlinked, artifacts: noApproval }))?.id).toBe(value.v2.id)
    const onlyRaw = value.artifacts.filter((artifact) => artifact.kind !== 'clarification')
    expect(selectRequirementReading(buildClarificationReviewBundle({ run: value.run, gateNode: unlinked, artifacts: onlyRaw }))).toBeUndefined()
  })

  it('never defaults to a proposal, and follows an explicit choice', () => {
    const value = issue181('superseded', 'approved')
    const onlyProposal = [describeMaterial(value.proposal, value.context)]
    expect(selectDefaultMaterial(onlyProposal)).toBeUndefined()
    expect(selectDefaultMaterial(onlyProposal, value.proposal.id)?.artifact.id).toBe(value.proposal.id)
    const entries = [value.raw, value.v1, value.v2].map((artifact) => describeMaterial(artifact, value.context))
    expect(selectDefaultMaterial(entries)?.artifact.id).toBe(value.v2.id)
    expect(selectDefaultMaterial(entries, value.raw.id)?.artifact.id).toBe(value.raw.id)
  })
})
