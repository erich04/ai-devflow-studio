import { describe, expect, it } from 'vitest'
import type {
  GateReviewSubjectSnapshot,
  Project,
  RequiredGateRole,
  TeamMember,
  WorkflowNode,
  WorkflowRun,
} from '@ai-devflow/shared'
import type { BrowserAuthSessionResponse, GitHubDeliveryRequestView } from './lib/devflow-api'
import { buildWebTodo, describeTodoFreshness, type DeliveryFacts } from './web-todo-view-model'

const digestA = 'a'.repeat(64)
const digestB = 'b'.repeat(64)
const digestC = 'c'.repeat(64)
const commitSha = '0123456789abcdef0123456789abcdef01234567'
const readAt = '2026-09-28T09:15:30.000Z'

function project(id: string): Project {
  return {
    id,
    name: `Project ${id}`,
    slug: id,
    description: 'Fixture project',
    repository: `acme/${id}`,
    defaultBranch: 'main',
    health: 'on_track',
    knowledgeBasePath: 'docs',
    testCommand: 'pnpm test',
  }
}

const projectA = project('project-a')
const projectB = project('project-b')

const members: TeamMember[] = [
  { id: 'user-owner', name: 'Olivia Owner', role: 'owner', avatarInitials: 'OO', focus: 'Org' },
  { id: 'user-lead', name: 'Leo Lead', role: 'lead', avatarInitials: 'LL', focus: 'Review' },
  { id: 'user-member', name: 'Mia Member', role: 'member', avatarInitials: 'MM', focus: 'Build' },
]

function session(
  userId: string,
  role: BrowserAuthSessionResponse['user']['role'],
  projectMemberships: BrowserAuthSessionResponse['projectMemberships'] = [],
): BrowserAuthSessionResponse {
  return {
    user: { id: userId, name: userId, role },
    authentication: { provider: 'local-development' },
    projectMemberships,
  }
}

/** Postgres returns organization Owners without explicit project memberships. */
const ownerSession = session('user-owner', 'owner')
const leadSession = session('user-lead', 'lead', [{ projectId: 'project-a', userId: 'user-lead', role: 'lead' }])
const memberSession = session('user-member', 'member', [{ projectId: 'project-a', userId: 'user-member', role: 'member' }])
/** Organization Lead who only holds a member role in project-a. */
const demotedLeadSession = session('user-lead', 'lead', [{ projectId: 'project-a', userId: 'user-lead', role: 'member' }])
/** Signed in, but only a member of project-b. */
const outsiderSession = session('user-outsider', 'member', [{ projectId: 'project-b', userId: 'user-outsider', role: 'lead' }])

const loadedNone: DeliveryFacts = { status: 'loaded', items: [] }

function node(input: Partial<WorkflowNode> & Pick<WorkflowNode, 'id' | 'kind' | 'stage'>): WorkflowNode {
  return {
    title: input.id,
    subtitle: 'Step',
    status: 'blocked',
    ownerId: 'user-lead',
    retryCount: 0,
    artifactIds: [],
    ...input,
  }
}

function run(input: Partial<WorkflowRun> & Pick<WorkflowRun, 'id' | 'nodes' | 'currentNodeId'>): WorkflowRun {
  return {
    version: 4,
    title: `Task ${input.id}`,
    request: 'Add CSV export',
    projectId: 'project-a',
    creatorId: 'user-member',
    status: 'paused_at_gate',
    branchName: `devflow/${input.id}`,
    createdAt: '2026-09-28T06:00:00.000Z',
    updatedAt: '2026-09-28T08:00:00.000Z',
    edges: [],
    ...input,
  }
}

type GateRunOptions = {
  id: string
  stage: 'clarify' | 'design' | 'build' | 'accept'
  kind?: 'gate' | 'acceptance'
  requiredRole?: RequiredGateRole
  /** Team data stores node ids as `${runId}:${nodeId}`; the Desktop and the subject use the canonical id. */
  prefixed?: boolean
  nodeStatus?: WorkflowNode['status']
  runStatus?: WorkflowRun['status']
  updatedAt?: string
  projectId?: string
  creatorId?: string
  version?: number
  subject?: 'current' | 'none' | 'stale-version' | 'other-node'
  title?: string
}

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

function gateRun(options: GateRunOptions): WorkflowRun {
  const kind = options.kind ?? (options.stage === 'accept' ? 'acceptance' : 'gate')
  const canonicalId = `node-${options.stage}-${kind}`
  const storedId = options.prefixed === false ? canonicalId : `${options.id}:${canonicalId}`
  const version = options.version ?? 4
  const gate = node({
    id: storedId,
    kind,
    stage: options.stage,
    status: options.nodeStatus ?? 'blocked',
    title: options.title ?? `${options.stage} ${kind}`,
    ...(options.requiredRole ? { requiredRole: options.requiredRole } : {}),
  })
  const subjectMode = options.subject ?? 'current'
  const gateReviewSubject: GateReviewSubjectSnapshot | undefined = subjectMode === 'none'
    ? undefined
    : {
        version: 1,
        runId: options.id,
        runVersion: subjectMode === 'stale-version' ? version - 1 : version,
        nodeId: subjectMode === 'other-node' ? 'node-previous-gate' : canonicalId,
        stage: options.stage,
        sanitizerVersion: 'sensitive-text-v1',
        requestDigest: digestA,
        artifacts: options.stage === 'design' ? [clarificationArtifact, designArtifact] : [clarificationArtifact],
      }
  return run({
    id: options.id,
    version,
    projectId: options.projectId ?? 'project-a',
    creatorId: options.creatorId ?? 'user-member',
    status: options.runStatus ?? 'paused_at_gate',
    updatedAt: options.updatedAt ?? '2026-09-28T08:00:00.000Z',
    nodes: [node({ id: `${options.id}:node-previous`, kind: 'agent', stage: options.stage, status: 'success' }), gate],
    currentNodeId: gate.id,
    ...(gateReviewSubject ? { gateReviewSubject } : {}),
  })
}

function delivery(input: Partial<GitHubDeliveryRequestView> & Pick<GitHubDeliveryRequestView, 'id' | 'runId' | 'status'>): GitHubDeliveryRequestView {
  return {
    stateVersion: 3,
    intentRevision: 1,
    projectId: 'project-a',
    runVersion: 9,
    nodeId: 'node-pr',
    repositoryBindingId: 'binding-1',
    repositoryBindingVersion: 1,
    deliverySeriesKey: `series-${input.id}`,
    deliveryAttempt: 1,
    repositoryId: '123456',
    repository: 'acme/project-a',
    outcomeCode: null,
    expectedRunVersion: 9,
    baseBranch: 'main',
    headBranch: 'devflow/feature',
    baseCommitSha: 'f'.repeat(40),
    expectedCommitSha: commitSha,
    intentDigest: digestA,
    diffDigest: digestB,
    testEvidenceId: 'evidence-1',
    testEvidenceDigest: digestC,
    packageDigest: digestA,
    changedPaths: ['src/export.ts'],
    prTitle: 'Add CSV export',
    expiresAt: '2026-09-29T08:00:00.000Z',
    updatedAt: '2026-09-28T08:30:00.000Z',
    ...input,
  }
}

function builtRun(id: string, input: Partial<WorkflowRun> = {}): WorkflowRun {
  const pr = node({ id: `${id}:node-pr`, kind: 'pr', stage: 'pr', status: 'running', title: 'PR 交付' })
  return run({ id, status: 'testing', nodes: [pr], currentNodeId: pr.id, ...input })
}

function todo(input: {
  runs?: WorkflowRun[]
  session?: BrowserAuthSessionResponse | null
  deliveries?: DeliveryFacts
  project?: Project
}) {
  return buildWebTodo({
    project: input.project ?? projectA,
    runs: input.runs ?? [],
    members,
    session: input.session === undefined ? ownerSession : input.session,
    deliveries: input.deliveries ?? loadedNone,
    readAt,
  })
}

describe('buildWebTodo · Gates', () => {
  it('lists a paused requirement Gate as the owner’s decision, bound to the uploaded subject', () => {
    const result = todo({ runs: [gateRun({ id: 'run-clarify', stage: 'clarify' })] })

    expect(result.items).toEqual([
      {
        id: 'gate:run-clarify:node-clarify-gate',
        kind: 'gate',
        label: '需求确认',
        taskTitle: 'Task run-clarify',
        runId: 'run-clarify',
        requester: '任务发起人 Mia Member',
        material: '需求澄清 · 记录于 2026-09-28 07:30 UTC',
        updatedAt: '2026-09-28T08:00:00.000Z',
        responsibility: 'mine',
        responsibilityLabel: '需要你审批',
        href: '/?projectId=project-a&runId=run-clarify#human-gate',
      },
    ])
    expect(result.notices).toEqual([])
    expect(result.complete).toBe(true)
    expect(result.readAt).toBe(readAt)
  })

  it('handles an unprefixed stored node id the same way', () => {
    const result = todo({ runs: [gateRun({ id: 'run-clarify', stage: 'clarify', prefixed: false })] })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      id: 'gate:run-clarify:node-clarify-gate',
      material: '需求澄清 · 记录于 2026-09-28 07:30 UTC',
      responsibility: 'mine',
    })
  })

  it('shows a Lead-only design Gate to a project member as waiting for the lead', () => {
    const result = todo({
      runs: [gateRun({ id: 'run-design', stage: 'design', requiredRole: 'lead', prefixed: false })],
      session: memberSession,
    })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      id: 'gate:run-design:node-design-gate',
      kind: 'gate',
      label: '方案评审',
      material: '方案 · 记录于 2026-09-28 07:45 UTC',
      responsibility: 'others',
      href: '/?projectId=project-a&runId=run-design#human-gate',
    })
    expect(result.items[0]!.responsibilityLabel).toContain('等待负责人审批')
    expect(result.items[0]!.responsibilityLabel).toBe('等待负责人审批（需要 Lead 及以上）')
    expect(result.complete).toBe(true)
  })

  it('shows the same design Gate to the project lead as theirs', () => {
    const result = todo({
      runs: [gateRun({ id: 'run-design', stage: 'design', requiredRole: 'lead' })],
      session: leadSession,
    })

    expect(result.items[0]).toMatchObject({ responsibility: 'mine', responsibilityLabel: '需要你审批' })
  })

  it('names the Owner requirement for a Lead looking at an Owner-only Gate', () => {
    const result = todo({
      runs: [gateRun({ id: 'run-owner-gate', stage: 'build', requiredRole: 'owner', title: '发布评审' })],
      session: leadSession,
    })

    expect(result.items[0]).toMatchObject({
      label: '发布评审',
      material: '由桌面端按本地证据复核',
      responsibility: 'others',
      responsibilityLabel: '等待负责人审批（需要 Owner 及以上）',
    })
  })

  it('lists a business acceptance whose node is running', () => {
    const result = todo({
      runs: [gateRun({ id: 'run-accept', stage: 'accept', nodeStatus: 'running' })],
      session: memberSession,
    })

    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'gate:run-accept:node-accept-acceptance',
        kind: 'gate',
        label: '业务验收',
        material: '由桌面端按本地证据复核',
        responsibility: 'mine',
      }),
    ])
  })

  it('keeps the Gate but says the material is missing or stale instead of hiding it', () => {
    const result = todo({
      runs: [
        gateRun({ id: 'run-missing', stage: 'clarify', subject: 'none', updatedAt: '2026-09-28T08:02:00.000Z' }),
        gateRun({ id: 'run-stale', stage: 'design', subject: 'stale-version', updatedAt: '2026-09-28T08:01:00.000Z' }),
        gateRun({ id: 'run-other-node', stage: 'clarify', subject: 'other-node', updatedAt: '2026-09-28T08:00:00.000Z' }),
      ],
    })

    expect(result.items.map((item) => [item.runId, item.material])).toEqual([
      ['run-missing', '所审材料的版本尚未从桌面端同步'],
      ['run-stale', '已同步的材料版本不属于当前步骤或任务版本，等待桌面端重新同步'],
      ['run-other-node', '已同步的材料版本不属于当前步骤或任务版本，等待桌面端重新同步'],
    ])
    // Still the owner's decision (a rejection is possible), but approval waits for the material.
    expect(result.items.every((item) => item.responsibility === 'mine')).toBe(true)
    expect(result.items.every((item) => item.responsibilityLabel === '需要你审批 · 材料版本未同步，暂不能批准')).toBe(true)
  })

  it.each(['pending', 'success', 'skipped'] as const)('skips a Gate whose node status is %s', (nodeStatus) => {
    const result = todo({ runs: [gateRun({ id: 'run-gate', stage: 'clarify', nodeStatus })] })

    expect(result.items).toEqual([])
    expect(result.complete).toBe(true)
  })

  it('lists a failed Gate node as an anomaly, not as an approvable Gate', () => {
    const result = todo({ runs: [gateRun({ id: 'run-gate', stage: 'clarify', nodeStatus: 'failed', title: '需求确认 Gate' })] })

    expect(result.items).toEqual([
      expect.objectContaining({ id: 'anomaly:run-gate', kind: 'anomaly', label: '步骤失败：需求确认 Gate' }),
    ])
  })

  it.each(['clarifying', 'designing', 'building', 'completed', 'cancelled'] as const)(
    'skips a blocked Gate when the run is %s instead of paused_at_gate',
    (runStatus) => {
      const result = todo({ runs: [gateRun({ id: 'run-gate', stage: 'clarify', runStatus })] })

      expect(result.items).toEqual([])
    },
  )

  it('skips a paused run whose current node is not a Gate', () => {
    const agent = node({ id: 'run-agent:node-design-agent', kind: 'agent', stage: 'design', status: 'running' })
    const historicalGate = node({ id: 'run-agent:node-clarify-gate', kind: 'gate', stage: 'clarify', status: 'blocked' })
    const result = todo({
      runs: [run({ id: 'run-agent', nodes: [historicalGate, agent], currentNodeId: agent.id })],
    })

    expect(result.items).toEqual([])
  })
})

describe('buildWebTodo · identity', () => {
  it('marks Gates as 权限待核实 without a session and says why the list is incomplete', () => {
    const result = todo({
      runs: [gateRun({ id: 'run-clarify', stage: 'clarify' })],
      session: null,
      deliveries: loadedNone,
    })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ responsibility: 'unknown', responsibilityLabel: '权限待核实' })
    expect(result.notices).toEqual(['未读取当前身份，暂时无法判断哪些事项需要你处理。'])
    expect(result.complete).toBe(false)
  })

  it('does not repeat the identity notice when deliveries were not loaded for lack of a browser identity', () => {
    const result = todo({
      runs: [gateRun({ id: 'run-clarify', stage: 'clarify' })],
      session: null,
      deliveries: { status: 'not_loaded' },
    })

    expect(result.items[0]).toMatchObject({ responsibility: 'unknown', responsibilityLabel: '权限待核实' })
    expect(result.notices).toEqual(['未建立浏览器身份，交付审批与审批权限没有读取，列表不完整。'])
    expect(result.complete).toBe(false)
  })

  it('adds both notices when deliveries failed and no session was read', () => {
    const result = todo({ session: null, deliveries: { status: 'failed' } })

    expect(result.notices).toEqual([
      '交付请求暂时无法读取，列表可能不完整。',
      '未读取当前身份，暂时无法判断哪些事项需要你处理。',
    ])
    expect(result.complete).toBe(false)
  })

  it('treats the organization Owner as owner in every project', () => {
    const inA = todo({ runs: [gateRun({ id: 'run-a', stage: 'design', requiredRole: 'owner' })], session: ownerSession })
    const inB = todo({
      project: projectB,
      runs: [gateRun({ id: 'run-b', stage: 'design', requiredRole: 'owner', projectId: 'project-b' })],
      session: ownerSession,
    })

    expect(inA.items[0]).toMatchObject({ responsibility: 'mine' })
    expect(inB.items[0]).toMatchObject({ responsibility: 'mine', href: '/?projectId=project-b&runId=run-b#human-gate' })
  })

  it('uses the project membership rather than the organization role', () => {
    const result = todo({
      runs: [gateRun({ id: 'run-design', stage: 'design', requiredRole: 'lead' })],
      deliveries: { status: 'loaded', items: [delivery({ id: 'delivery-1', runId: 'run-design', status: 'approval_required' })] },
      session: demotedLeadSession,
    })

    expect(result.items.map((item) => [item.kind, item.responsibility])).toEqual([
      ['delivery', 'others'],
      ['gate', 'others'],
    ])
  })

  it('shows a signed-in user without a role in the project who has to decide, not 权限待核实', () => {
    // The server refuses Gate Commands and delivery decisions without a project role, so the
    // answer is definite: someone else has to decide.
    const result = todo({
      runs: [gateRun({ id: 'run-clarify', stage: 'clarify' })],
      deliveries: { status: 'loaded', items: [delivery({ id: 'delivery-1', runId: 'run-clarify', status: 'approval_required' })] },
      session: outsiderSession,
    })

    expect(result.items.map((item) => [item.kind, item.responsibility, item.responsibilityLabel])).toEqual([
      ['delivery', 'others', '等待负责人审批（需要 Lead 或 Owner）'],
      ['gate', 'others', '等待负责人审批（需要 项目成员及以上）'],
    ])
    expect(result.notices).toEqual([])
    expect(result.complete).toBe(true)
  })
})

describe('buildWebTodo · deliveries', () => {
  it('never reports an empty list as complete when deliveries were not loaded', () => {
    const result = todo({ deliveries: { status: 'not_loaded' } })

    expect(result.items).toEqual([])
    expect(result.notices).toEqual(['未建立浏览器身份，交付审批与审批权限没有读取，列表不完整。'])
    expect(result.notices[0]).toContain('浏览器身份')
    expect(result.complete).toBe(false)
  })

  it('never reports an empty list as complete when deliveries failed to load', () => {
    const result = todo({ deliveries: { status: 'failed' } })

    expect(result.items).toEqual([])
    expect(result.notices).toEqual(['交付请求暂时无法读取，列表可能不完整。'])
    expect(result.complete).toBe(false)
  })

  it('reports a real “nothing to do” only when every source loaded', () => {
    const result = todo({
      runs: [
        builtRun('run-built'),
        run({ id: 'run-done', status: 'completed', nodes: [], currentNodeId: 'none' }),
      ],
      deliveries: {
        status: 'loaded',
        items: [
          delivery({ id: 'delivery-approved', runId: 'run-built', status: 'approved' }),
          delivery({ id: 'delivery-publishing', runId: 'run-built', status: 'publishing_branch' }),
          delivery({ id: 'delivery-published', runId: 'run-built', status: 'branch_published' }),
          delivery({ id: 'delivery-creating', runId: 'run-built', status: 'creating_pr' }),
          delivery({ id: 'delivery-completed', runId: 'run-done', status: 'completed' }),
          delivery({ id: 'delivery-revoked', runId: 'run-done', status: 'revoked' }),
        ],
      },
    })

    expect(result.items).toEqual([])
    expect(result.notices).toEqual([])
    expect(result.complete).toBe(true)
  })

  it('lists a delivery awaiting approval as the lead’s decision', () => {
    const result = todo({
      runs: [builtRun('run-built')],
      deliveries: { status: 'loaded', items: [delivery({ id: 'delivery-1', runId: 'run-built', status: 'approval_required' })] },
      session: leadSession,
    })

    expect(result.items).toEqual([
      {
        id: 'delivery:delivery-1',
        kind: 'delivery',
        label: '交付审批',
        taskTitle: 'Task run-built',
        runId: 'run-built',
        requester: '任务发起人 Mia Member',
        material: '请求 v3 · 提交 0123456789ab…',
        updatedAt: '2026-09-28T08:30:00.000Z',
        responsibility: 'mine',
        responsibilityLabel: '需要你审批',
        href: '/?projectId=project-a&runId=run-built#github-delivery',
      },
    ])
    expect(result.complete).toBe(true)
  })

  it('lists a delivery awaiting approval as the owner’s decision', () => {
    const result = todo({
      runs: [builtRun('run-built')],
      deliveries: { status: 'loaded', items: [delivery({ id: 'delivery-1', runId: 'run-built', status: 'approval_required' })] },
      session: ownerSession,
    })

    expect(result.items[0]).toMatchObject({ responsibility: 'mine' })
  })

  it('shows a delivery awaiting approval to a member as waiting for Lead or Owner', () => {
    const result = todo({
      runs: [builtRun('run-built')],
      deliveries: { status: 'loaded', items: [delivery({ id: 'delivery-1', runId: 'run-built', status: 'approval_required' })] },
      session: memberSession,
    })

    expect(result.items[0]).toMatchObject({
      kind: 'delivery',
      responsibility: 'others',
      responsibilityLabel: '等待负责人审批（需要 Lead 或 Owner）',
    })
  })

  it('shows a delivery awaiting approval as 权限待核实 without a session', () => {
    const result = todo({
      runs: [builtRun('run-built')],
      deliveries: { status: 'loaded', items: [delivery({ id: 'delivery-1', runId: 'run-built', status: 'approval_required' })] },
      session: null,
    })

    expect(result.items[0]).toMatchObject({ responsibility: 'unknown', responsibilityLabel: '权限待核实' })
    expect(result.complete).toBe(false)
  })

  it('lists failed and recovery_required deliveries as anomalies', () => {
    const result = todo({
      runs: [builtRun('run-built')],
      deliveries: {
        status: 'loaded',
        items: [
          delivery({ id: 'delivery-failed', runId: 'run-built', status: 'failed', updatedAt: '2026-09-28T08:40:00.000Z' }),
          delivery({ id: 'delivery-recovery', runId: 'run-built', status: 'recovery_required', updatedAt: '2026-09-28T08:35:00.000Z' }),
        ],
      },
      session: memberSession,
    })

    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'delivery-anomaly:delivery-failed',
        kind: 'anomaly',
        label: '交付失败',
        responsibility: 'unknown',
        responsibilityLabel: '在桌面端处理交付',
        href: '/?projectId=project-a&runId=run-built#github-delivery',
      }),
      expect.objectContaining({
        id: 'delivery-anomaly:delivery-recovery',
        kind: 'anomaly',
        label: '需要恢复',
        responsibility: 'unknown',
        responsibilityLabel: '在桌面端处理交付',
      }),
    ])
  })

  it('falls back to a short run id and the desktop as requester when the run is not loaded', () => {
    const result = todo({
      deliveries: { status: 'loaded', items: [delivery({ id: 'delivery-1', runId: 'run-missing-123', status: 'approval_required' })] },
      session: leadSession,
    })

    expect(result.items[0]).toMatchObject({
      taskTitle: '任务 run-miss…',
      requester: '桌面端',
      href: '/?projectId=project-a&runId=run-missing-123#github-delivery',
    })
  })
})

describe('buildWebTodo · run anomalies', () => {
  it('lists a failed run', () => {
    const failed = builtRun('run-failed', { status: 'failed', updatedAt: '2026-09-28T07:10:00.000Z' })
    const result = todo({ runs: [failed] })

    expect(result.items).toEqual([
      {
        id: 'anomaly:run-failed',
        kind: 'anomaly',
        label: '任务执行失败',
        taskTitle: 'Task run-failed',
        runId: 'run-failed',
        requester: '任务发起人 Mia Member',
        material: '在桌面端查看失败位置与已保留的结果',
        updatedAt: '2026-09-28T07:10:00.000Z',
        responsibility: 'unknown',
        responsibilityLabel: '需要任务负责人处理',
        href: '/?projectId=project-a&runId=run-failed#evidence-chain',
      },
    ])
    expect(result.complete).toBe(true)
  })

  it('lists a failed current step of a running task', () => {
    const step = node({ id: 'run-step:node-build', kind: 'agent', stage: 'build', status: 'failed', title: '开发实现' })
    const result = todo({ runs: [run({ id: 'run-step', status: 'building', nodes: [step], currentNodeId: step.id })] })

    expect(result.items).toEqual([
      expect.objectContaining({ id: 'anomaly:run-step', kind: 'anomaly', label: '步骤失败：开发实现' }),
    ])
  })

  it('lists a failed run with a failed current step once', () => {
    const step = node({ id: 'run-step:node-build', kind: 'agent', stage: 'build', status: 'failed', title: '开发实现' })
    const result = todo({ runs: [run({ id: 'run-step', status: 'failed', nodes: [step], currentNodeId: step.id })] })

    expect(result.items).toEqual([expect.objectContaining({ id: 'anomaly:run-step', label: '任务执行失败' })])
  })

  it('does not list a failed historical step when the current step is healthy', () => {
    const oldStep = node({ id: 'run-step:node-build', kind: 'agent', stage: 'build', status: 'failed' })
    const current = node({ id: 'run-step:node-test', kind: 'test', stage: 'test', status: 'running' })
    const result = todo({ runs: [run({ id: 'run-step', status: 'testing', nodes: [oldStep, current], currentNodeId: current.id })] })

    expect(result.items).toEqual([])
  })
})

describe('buildWebTodo · scope, ordering and requester', () => {
  it('excludes runs and deliveries of another project', () => {
    const result = todo({
      runs: [
        gateRun({ id: 'run-b-gate', stage: 'clarify', projectId: 'project-b' }),
        builtRun('run-b-failed', { projectId: 'project-b', status: 'failed' }),
      ],
      deliveries: {
        status: 'loaded',
        items: [
          delivery({ id: 'delivery-b-approval', runId: 'run-b-gate', projectId: 'project-b', status: 'approval_required' }),
          delivery({ id: 'delivery-b-failed', runId: 'run-b-failed', projectId: 'project-b', status: 'failed' }),
        ],
      },
    })

    expect(result.items).toEqual([])
    expect(result.complete).toBe(true)
  })

  it('orders mine → unknown → others, newer first, then by id', () => {
    const result = todo({
      runs: [
        gateRun({ id: 'run-mine-gate', stage: 'clarify', updatedAt: '2026-09-28T08:00:00.000Z' }),
        gateRun({ id: 'run-others-gate', stage: 'build', requiredRole: 'owner', updatedAt: '2026-09-28T11:00:00.000Z' }),
        builtRun('run-failed', { status: 'failed', updatedAt: '2026-09-28T10:00:00.000Z' }),
        builtRun('run-built'),
      ],
      deliveries: {
        status: 'loaded',
        items: [
          delivery({ id: 'delivery-mine', runId: 'run-built', status: 'approval_required', updatedAt: '2026-09-28T09:00:00.000Z' }),
          delivery({ id: 'delivery-late', runId: 'run-built', status: 'failed', updatedAt: '2026-09-28T07:00:00.000Z' }),
          delivery({ id: 'delivery-tie', runId: 'run-built', status: 'recovery_required', updatedAt: '2026-09-28T10:00:00.000Z' }),
        ],
      },
      session: leadSession,
    })

    expect(result.items.map((item) => item.id)).toEqual([
      'delivery:delivery-mine',
      'gate:run-mine-gate:node-clarify-gate',
      'anomaly:run-failed',
      'delivery-anomaly:delivery-tie',
      'delivery-anomaly:delivery-late',
      'gate:run-others-gate:node-build-gate',
    ])
  })

  it('names the requester, or 未知成员 when the creator is not a member', () => {
    const result = todo({
      runs: [
        gateRun({ id: 'run-known', stage: 'clarify', creatorId: 'user-lead', updatedAt: '2026-09-28T08:01:00.000Z' }),
        gateRun({ id: 'run-unknown', stage: 'clarify', creatorId: 'user-gone' }),
      ],
      deliveries: { status: 'loaded', items: [delivery({ id: 'delivery-1', runId: 'run-unknown', status: 'failed' })] },
    })

    expect(result.items.map((item) => [item.id, item.requester])).toEqual([
      ['gate:run-known:node-clarify-gate', '任务发起人 Leo Lead'],
      ['gate:run-unknown:node-clarify-gate', '任务发起人 未知成员'],
      ['delivery-anomaly:delivery-1', '任务发起人 未知成员'],
    ])
  })
})

describe('describeTodoFreshness', () => {
  it('includes the formatted read time', () => {
    const result = todo({})

    expect(describeTodoFreshness(result)).toBe(
      '团队数据读取于 2026-09-28 09:15 UTC。任务状态来自桌面端最近一次上传，以各行的更新时间为准。',
    )
  })

  it('says the time was not recorded for an invalid read time', () => {
    expect(describeTodoFreshness({ items: [], notices: [], complete: true, readAt: 'invalid' })).toContain(
      '团队数据读取于 时间未记录。',
    )
  })
})
