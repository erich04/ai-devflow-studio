import { describe, expect, it } from 'vitest'
import type { GateReviewSubjectSnapshot, WorkflowNode, WorkflowRun } from '@ai-devflow/shared'
import type { BrowserAuthSessionResponse } from './lib/devflow-api'
import {
  canonicalNodeId,
  describeGateMaterial,
  effectiveProjectRole,
  formatWebTime,
  gateDecisionLabel,
  requiredRoleLabel,
  requiresMaterialSnapshot,
  shortIdentifier,
} from './web-labels'

const digestA = 'a'.repeat(64)
const digestB = 'b'.repeat(64)
const digestC = 'c'.repeat(64)

function session(input: {
  userId?: string
  role: BrowserAuthSessionResponse['user']['role']
  memberships?: BrowserAuthSessionResponse['projectMemberships']
}): BrowserAuthSessionResponse {
  const userId = input.userId ?? 'user-self'
  return {
    user: { id: userId, name: 'Self', role: input.role },
    authentication: { provider: 'local-development' },
    projectMemberships: input.memberships ?? [],
  }
}

function node(input: Partial<WorkflowNode> & Pick<WorkflowNode, 'id' | 'kind' | 'stage'>): WorkflowNode {
  return {
    title: `Title of ${input.id}`,
    subtitle: 'Step',
    status: 'blocked',
    ownerId: 'user-lead',
    retryCount: 0,
    artifactIds: [],
    ...input,
  }
}

function run(input: Partial<WorkflowRun> & Pick<WorkflowRun, 'nodes' | 'currentNodeId'>): WorkflowRun {
  return {
    id: 'run-1',
    version: 7,
    title: 'Add export',
    request: 'Add CSV export',
    projectId: 'project-a',
    creatorId: 'user-member',
    status: 'paused_at_gate',
    branchName: 'devflow/run-1',
    createdAt: '2026-09-28T07:00:00.000Z',
    updatedAt: '2026-09-28T08:00:00.000Z',
    edges: [],
    ...input,
  }
}

function subject(input: Partial<GateReviewSubjectSnapshot> & Pick<GateReviewSubjectSnapshot, 'nodeId' | 'stage'>): GateReviewSubjectSnapshot {
  return {
    version: 1,
    runId: 'run-1',
    runVersion: 7,
    sanitizerVersion: 'sensitive-text-v1',
    requestDigest: digestA,
    artifacts: [],
    ...input,
  }
}

describe('formatWebTime', () => {
  it('formats a valid ISO timestamp in UTC to the minute', () => {
    expect(formatWebTime('2026-09-28T08:05:59.999Z')).toBe('2026-09-28 08:05 UTC')
  })

  it('converts an offset timestamp to UTC', () => {
    expect(formatWebTime('2026-09-28T10:05:00+02:00')).toBe('2026-09-28 08:05 UTC')
  })

  it('reports an invalid, empty or missing value as not recorded', () => {
    expect(formatWebTime('not-a-date')).toBe('时间未记录')
    expect(formatWebTime('')).toBe('时间未记录')
    expect(formatWebTime(undefined)).toBe('时间未记录')
  })
})

describe('effectiveProjectRole', () => {
  it('returns null without a session', () => {
    expect(effectiveProjectRole(null, 'project-a')).toBeNull()
  })

  it('treats the organization Owner as owner in every project, even without memberships', () => {
    const owner = session({ role: 'owner' })
    expect(effectiveProjectRole(owner, 'project-a')).toBe('owner')
    expect(effectiveProjectRole(owner, 'project-b')).toBe('owner')
  })

  it('uses the project membership for other organization roles', () => {
    const lead = session({
      role: 'lead',
      memberships: [
        { projectId: 'project-a', userId: 'user-self', role: 'member' },
        { projectId: 'project-b', userId: 'user-self', role: 'lead' },
      ],
    })
    expect(effectiveProjectRole(lead, 'project-a')).toBe('member')
    expect(effectiveProjectRole(lead, 'project-b')).toBe('lead')
  })

  it('promotes an organization member to the project role they hold', () => {
    const member = session({
      role: 'member',
      memberships: [{ projectId: 'project-a', userId: 'user-self', role: 'lead' }],
    })
    expect(effectiveProjectRole(member, 'project-a')).toBe('lead')
  })

  it('returns null without a membership in that project', () => {
    const member = session({
      role: 'member',
      memberships: [{ projectId: 'project-b', userId: 'user-self', role: 'lead' }],
    })
    expect(effectiveProjectRole(member, 'project-a')).toBeNull()
  })

  it('ignores a membership that belongs to another user', () => {
    const member = session({
      role: 'lead',
      memberships: [{ projectId: 'project-a', userId: 'user-other', role: 'owner' }],
    })
    expect(effectiveProjectRole(member, 'project-a')).toBeNull()
  })
})

describe('gateDecisionLabel', () => {
  it('names acceptance, requirement and design decisions distinctly', () => {
    expect(gateDecisionLabel({ kind: 'acceptance', stage: 'accept', title: 'Accept' })).toBe('业务验收')
    expect(gateDecisionLabel({ kind: 'gate', stage: 'clarify', title: 'Clarify gate' })).toBe('需求确认')
    expect(gateDecisionLabel({ kind: 'gate', stage: 'design', title: 'Design gate' })).toBe('方案评审')
  })

  it('falls back to the node title for other Gates and non-Gate nodes', () => {
    expect(gateDecisionLabel({ kind: 'gate', stage: 'build', title: '代码评审 Gate' })).toBe('代码评审 Gate')
    expect(gateDecisionLabel({ kind: 'agent', stage: 'clarify', title: 'Clarify agent' })).toBe('Clarify agent')
    expect(gateDecisionLabel({ kind: 'task', stage: 'design', title: 'Design task' })).toBe('Design task')
  })
})

describe('requiredRoleLabel', () => {
  it('defaults to project members when no role is required', () => {
    expect(requiredRoleLabel({})).toBe('项目成员及以上')
    expect(requiredRoleLabel({ requiredRole: 'member' })).toBe('项目成员及以上')
  })

  it('names Lead and Owner requirements', () => {
    expect(requiredRoleLabel({ requiredRole: 'lead' })).toBe('Lead 及以上')
    expect(requiredRoleLabel({ requiredRole: 'owner' })).toBe('Owner 及以上')
  })
})

describe('canonicalNodeId', () => {
  it('strips the storage prefix of the same run', () => {
    expect(canonicalNodeId('run-1', 'run-1:node-gate')).toBe('node-gate')
  })

  it('keeps an already canonical id', () => {
    expect(canonicalNodeId('run-1', 'node-gate')).toBe('node-gate')
  })

  it('does not strip a prefix of another run that merely starts with the same characters', () => {
    expect(canonicalNodeId('run-1', 'run-10:node-gate')).toBe('run-10:node-gate')
    expect(canonicalNodeId('run-1', 'run-1node-gate')).toBe('run-1node-gate')
  })

  it('strips only one prefix', () => {
    expect(canonicalNodeId('run-1', 'run-1:run-1:node-gate')).toBe('run-1:node-gate')
  })
})

describe('shortIdentifier', () => {
  it('keeps values up to length + 2 characters', () => {
    expect(shortIdentifier('abcdefgh')).toBe('abcdefgh')
    expect(shortIdentifier('abcdefghij')).toBe('abcdefghij')
  })

  it('truncates longer values with an ellipsis', () => {
    expect(shortIdentifier('abcdefghijk')).toBe('abcdefgh…')
  })

  it('honours a custom length', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567'
    expect(shortIdentifier(sha, 12)).toBe('0123456789ab…')
    expect(shortIdentifier('0123456789abcd', 12)).toBe('0123456789abcd')
  })
})

describe('requiresMaterialSnapshot', () => {
  it('only requires a snapshot for requirement and design Gates', () => {
    expect(requiresMaterialSnapshot({ kind: 'gate', stage: 'clarify' })).toBe(true)
    expect(requiresMaterialSnapshot({ kind: 'gate', stage: 'design' })).toBe(true)
    expect(requiresMaterialSnapshot({ kind: 'gate', stage: 'build' })).toBe(false)
    expect(requiresMaterialSnapshot({ kind: 'acceptance', stage: 'accept' })).toBe(false)
    expect(requiresMaterialSnapshot({ kind: 'agent', stage: 'clarify' })).toBe(false)
  })
})

describe('describeGateMaterial', () => {
  const clarifyGate = node({ id: 'run-1:node-clarify-gate', kind: 'gate', stage: 'clarify' })
  const designGate = node({ id: 'run-1:node-design-gate', kind: 'gate', stage: 'design', requiredRole: 'lead' })
  const clarificationArtifact = {
    id: 'artifact-clarification',
    nodeId: 'node-clarify',
    kind: 'clarification' as const,
    updatedAt: '2026-09-28T07:30:00.000Z',
    contentDigest: digestB,
  }
  const designArtifact = {
    id: 'artifact-design',
    nodeId: 'node-design',
    kind: 'design' as const,
    updatedAt: '2026-09-28T07:45:00.000Z',
    contentDigest: digestC,
  }

  it('does not require material for other Gates or acceptance, even without a subject', () => {
    const buildGate = node({ id: 'run-1:node-build-gate', kind: 'gate', stage: 'build' })
    const acceptance = node({ id: 'run-1:node-accept', kind: 'acceptance', stage: 'accept' })
    expect(describeGateMaterial(run({ nodes: [buildGate], currentNodeId: buildGate.id }), buildGate)).toEqual({
      status: 'not_required',
      label: '由桌面端按本地证据复核',
    })
    expect(describeGateMaterial(run({ nodes: [acceptance], currentNodeId: acceptance.id }), acceptance)).toEqual({
      status: 'not_required',
      label: '由桌面端按本地证据复核',
    })
  })

  it('reports missing material when no subject was uploaded', () => {
    expect(describeGateMaterial(run({ nodes: [clarifyGate], currentNodeId: clarifyGate.id }), clarifyGate)).toEqual({
      status: 'missing',
      label: '所审材料的版本尚未从桌面端同步',
    })
  })

  it('reports stale material when the subject belongs to another step', () => {
    const current = run({
      nodes: [clarifyGate],
      currentNodeId: clarifyGate.id,
      gateReviewSubject: subject({ nodeId: 'node-other-gate', stage: 'clarify', artifacts: [clarificationArtifact] }),
    })
    expect(describeGateMaterial(current, clarifyGate)).toEqual({
      status: 'stale',
      label: '已同步的材料版本不属于当前步骤或任务版本，等待桌面端重新同步',
    })
  })

  it('reports stale material when the subject belongs to another Run version', () => {
    const current = run({
      version: 8,
      nodes: [clarifyGate],
      currentNodeId: clarifyGate.id,
      gateReviewSubject: subject({ nodeId: 'node-clarify-gate', runVersion: 7, stage: 'clarify', artifacts: [clarificationArtifact] }),
    })
    expect(describeGateMaterial(current, clarifyGate).status).toBe('stale')
  })

  it('compares against the canonical node id, not the prefixed storage id', () => {
    const current = run({
      nodes: [clarifyGate],
      currentNodeId: clarifyGate.id,
      gateReviewSubject: subject({ nodeId: 'run-1:node-clarify-gate', stage: 'clarify', artifacts: [clarificationArtifact] }),
    })
    expect(describeGateMaterial(current, clarifyGate).status).toBe('stale')
  })

  it('binds a requirement Gate stored with a prefixed node id to the matching clarification', () => {
    const current = run({
      nodes: [clarifyGate],
      currentNodeId: clarifyGate.id,
      gateReviewSubject: subject({ nodeId: 'node-clarify-gate', stage: 'clarify', artifacts: [clarificationArtifact] }),
    })
    expect(describeGateMaterial(current, clarifyGate)).toEqual({
      status: 'current',
      label: '需求澄清 · 记录于 2026-09-28 07:30 UTC',
      recordedAt: '2026-09-28T07:30:00.000Z',
      digest: digestB,
      artifactId: 'artifact-clarification',
    })
  })

  it('binds a requirement Gate with an unprefixed node id as well', () => {
    const unprefixed = node({ id: 'node-clarify-gate', kind: 'gate', stage: 'clarify' })
    const current = run({
      nodes: [unprefixed],
      currentNodeId: unprefixed.id,
      gateReviewSubject: subject({ nodeId: 'node-clarify-gate', stage: 'clarify', artifacts: [clarificationArtifact] }),
    })
    expect(describeGateMaterial(current, unprefixed)).toMatchObject({
      status: 'current',
      digest: digestB,
      artifactId: 'artifact-clarification',
    })
  })

  it('binds a design Gate to the design artifact, not the approved clarification in the same subject', () => {
    const current = run({
      nodes: [designGate],
      currentNodeId: designGate.id,
      gateReviewSubject: subject({
        nodeId: 'node-design-gate',
        stage: 'design',
        artifacts: [clarificationArtifact, designArtifact],
      }),
    })
    expect(describeGateMaterial(current, designGate)).toEqual({
      status: 'current',
      label: '方案 · 记录于 2026-09-28 07:45 UTC',
      recordedAt: '2026-09-28T07:45:00.000Z',
      digest: digestC,
      artifactId: 'artifact-design',
    })
  })

  it('reports missing material when the subject lacks the needed artifact kind', () => {
    const designWithoutDesign = run({
      nodes: [designGate],
      currentNodeId: designGate.id,
      gateReviewSubject: subject({ nodeId: 'node-design-gate', stage: 'design', artifacts: [clarificationArtifact] }),
    })
    expect(describeGateMaterial(designWithoutDesign, designGate)).toEqual({
      status: 'missing',
      label: '所审材料的版本尚未从桌面端同步',
    })

    const clarifyWithoutClarification = run({
      nodes: [clarifyGate],
      currentNodeId: clarifyGate.id,
      gateReviewSubject: subject({ nodeId: 'node-clarify-gate', stage: 'clarify', artifacts: [designArtifact] }),
    })
    expect(describeGateMaterial(clarifyWithoutClarification, clarifyGate).status).toBe('missing')
  })
})
