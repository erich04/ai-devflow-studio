import { describe, expect, it } from 'vitest'
import type {
  CreateGateCommandInput,
  GateEnforcementDecision,
  GateOverrideDecision,
  WorkflowNode,
  WorkflowRun,
} from '@ai-devflow/shared'
import { preflightGateCommand } from './gate-command-preflight'

function currentGate(): WorkflowNode {
  return {
    id: 'gate-current',
    stage: 'design',
    title: 'Design approval',
    subtitle: 'Lead review',
    kind: 'gate',
    status: 'blocked',
    ownerId: 'user-owner',
    requiredRole: 'lead',
    retryCount: 0,
    artifactIds: ['artifact-design'],
  }
}

function canonicalRun(node: WorkflowNode = currentGate()): WorkflowRun {
  return {
    id: 'run-1',
    version: 3,
    title: 'Gate preflight',
    request: 'Verify server-side collaboration intent.',
    projectId: 'project-1',
    creatorId: 'user-creator',
    status: 'paused_at_gate',
    currentNodeId: node.id,
    branchName: 'ai/gate-preflight',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:03:00.000Z',
    nodes: [
      {
        ...currentGate(),
        id: 'gate-historical',
        status: 'success',
      },
      node,
    ],
    edges: [],
  }
}

function passingEnforcement(): GateEnforcementDecision {
  return {
    status: 'pass',
    blocksApproval: false,
    blockingReasons: [],
    warningReasons: [],
    requiredActions: [],
    canOverride: false,
    overrideRoleRequired: 'lead',
    policySource: 'remote_cache',
    policyVersion: 2,
    provisional: false,
  }
}

function blockedEnforcement(
  blockerIds: string[] = ['blocker-b', 'blocker-a'],
): GateEnforcementDecision {
  return {
    ...passingEnforcement(),
    status: 'blocked',
    blocksApproval: true,
    blockingReasons: blockerIds.map((id) => ({
      id,
      target: 'governance_check',
      ruleKey: `rule:${id}`,
      action: 'block',
      summary: `Blocked by ${id}.`,
    })),
    requiredActions: ['Resolve current policy blockers.'],
    canOverride: true,
  }
}

function approveInput(
  overrides: Partial<CreateGateCommandInput> = {},
): CreateGateCommandInput {
  return {
    projectId: 'project-1',
    runId: 'run-1',
    nodeId: 'gate-current',
    action: 'approve',
    reason: 'Reviewed the current Team projection.',
    expectedRunVersion: 3,
    expectedPolicyVersion: 2,
    expectedBlockerIds: [],
    idempotencyKey: 'gate:create:run-1:v3',
    ...overrides,
  }
}

function acceptedOverride(
  overrides: Partial<GateOverrideDecision> = {},
): GateOverrideDecision {
  return {
    id: 'override-1',
    runId: 'run-1',
    nodeId: 'gate-current',
    projectId: 'project-1',
    userId: 'user-review-lead',
    role: 'lead',
    reason: 'Reviewed the current blockers and accepted the exception.',
    blockedReasonIds: ['blocker-a', 'blocker-b'],
    policyVersion: 2,
    provisional: false,
    status: 'accepted',
    createdAt: '2026-08-01T00:02:00.000Z',
    ...overrides,
  }
}

describe('Gate Command server preflight', () => {
  it('allows the current Gate and derives approve_gate without mutating the Run', () => {
    const node = currentGate()
    const run = canonicalRun(node)

    const result = preflightGateCommand({
      command: approveInput(),
      run,
      currentNode: node,
      requester: { userId: 'user-review-lead', role: 'lead' },
      enforcement: passingEnforcement(),
    })

    expect(result).toEqual({
      allowed: true,
      workflowCommand: 'approve_gate',
      evaluationStatus: 'allowed',
      evaluationBlockerIds: [],
    })
    expect(run).toEqual(canonicalRun(node))
  })

  it('rejects a historical Gate even when its ID still exists in the Run', () => {
    const run = canonicalRun()
    const historicalGate = run.nodes[0]!

    expect(
      preflightGateCommand({
        command: approveInput({ nodeId: historicalGate.id }),
        run,
        currentNode: historicalGate,
        requester: { userId: 'user-review-lead', role: 'lead' },
        enforcement: passingEnforcement(),
      }),
    ).toEqual({ allowed: false, code: 'node_not_current' })
  })

  it('rejects project or Run scope that differs from the canonical Run', () => {
    const node = currentGate()
    const run = canonicalRun(node)

    for (const command of [
      approveInput({ projectId: 'project-other' }),
      approveInput({ runId: 'run-other' }),
    ]) {
      expect(
        preflightGateCommand({
          command,
          run,
          currentNode: node,
          requester: { userId: 'user-review-lead', role: 'lead' },
          enforcement: passingEnforcement(),
        }),
      ).toEqual({ allowed: false, code: 'stale_run' })
    }
  })

  it('rejects a stale current-node snapshot that weakens canonical role policy', () => {
    const node = currentGate()
    const run = canonicalRun(node)

    expect(
      preflightGateCommand({
        command: approveInput(),
        run,
        currentNode: { ...node, requiredRole: 'member' },
        requester: { userId: 'user-member', role: 'member' },
        enforcement: passingEnforcement(),
      }),
    ).toEqual({ allowed: false, code: 'node_not_current' })
  })

  it('distinguishes stale Run and policy versions before authorization', () => {
    const node = currentGate()
    const run = canonicalRun(node)

    expect(
      preflightGateCommand({
        command: approveInput({ expectedRunVersion: 2 }),
        run,
        currentNode: node,
        requester: { userId: 'user-review-lead', role: 'lead' },
        enforcement: passingEnforcement(),
      }),
    ).toEqual({ allowed: false, code: 'stale_run' })
    expect(
      preflightGateCommand({
        command: approveInput({ expectedPolicyVersion: 1 }),
        run,
        currentNode: node,
        requester: { userId: 'user-review-lead', role: 'lead' },
        enforcement: passingEnforcement(),
      }),
    ).toEqual({ allowed: false, code: 'stale_policy' })
  })

  it('rejects a command prepared from a different canonical blocker-ID set', () => {
    const node = currentGate()
    const base = {
      run: canonicalRun(node),
      currentNode: node,
      requester: { userId: 'user-review-lead', role: 'lead' as const },
      enforcement: blockedEnforcement(),
    }

    for (const expectedBlockerIds of [
      ['blocker-a'],
      ['blocker-b', 'blocker-a'],
      ['blocker-a', 'blocker-a', 'blocker-b'],
    ]) {
      expect(
        preflightGateCommand({
          ...base,
          command: approveInput({ expectedBlockerIds }),
        }),
      ).toEqual({ allowed: false, code: 'blockers_changed' })
    }
    expect(
      preflightGateCommand({
        ...base,
        command: approveInput({
          expectedBlockerIds: ['blocker-a', 'blocker-b'],
        }),
        enforcement: blockedEnforcement([
          'blocker-a',
          'blocker-a',
          'blocker-b',
        ]),
      }),
    ).toEqual({ allowed: false, code: 'blockers_changed' })
  })

  it('uses only an exact accepted override from the independent requesting lead', () => {
    const node = currentGate()
    const input = {
      command: approveInput({
        expectedBlockerIds: ['blocker-a', 'blocker-b'],
      }),
      run: canonicalRun(node),
      currentNode: node,
      requester: { userId: 'user-review-lead', role: 'lead' as const },
      enforcement: blockedEnforcement(),
    }

    expect(
      preflightGateCommand({ ...input, override: acceptedOverride() }),
    ).toEqual({
      allowed: true,
      workflowCommand: 'approve_gate',
      evaluationStatus: 'allowed',
      evaluationBlockerIds: ['blocker-a', 'blocker-b'],
    })
    expect(
      preflightGateCommand({
        ...input,
        override: acceptedOverride({ projectId: 'project-other' }),
      }),
    ).toEqual({ allowed: false, code: 'preflight_blocked' })

    for (const override of [
      acceptedOverride({ runId: 'run-other' }),
      acceptedOverride({ nodeId: 'gate-other' }),
      acceptedOverride({ userId: 'user-other' }),
      acceptedOverride({ role: 'owner' }),
      acceptedOverride({ policyVersion: 1 }),
      acceptedOverride({ blockedReasonIds: ['blocker-b', 'blocker-a'] }),
      acceptedOverride({ provisional: true }),
      acceptedOverride({ status: 'provisional' }),
    ]) {
      expect(preflightGateCommand({ ...input, override })).toEqual({
        allowed: false,
        code: 'preflight_blocked',
      })
    }
  })

  it('reports separation of duties when a creator or node owner uses an override', () => {
    const node = currentGate()
    const run = canonicalRun(node)

    for (const userId of [run.creatorId, node.ownerId]) {
      expect(
        preflightGateCommand({
          command: approveInput({
            expectedBlockerIds: ['blocker-a', 'blocker-b'],
          }),
          run,
          currentNode: node,
          requester: { userId, role: 'lead' },
          enforcement: blockedEnforcement(),
          override: acceptedOverride({ userId }),
        }),
      ).toEqual({ allowed: false, code: 'separation_of_duties' })
    }
  })

  it('allows a lead to record human rejection without bypassing blocker binding', () => {
    const node = currentGate()
    const input = {
      command: approveInput({
        action: 'reject',
        expectedBlockerIds: ['blocker-a', 'blocker-b'],
      }),
      run: canonicalRun(node),
      currentNode: node,
      requester: { userId: 'user-review-lead', role: 'lead' as const },
      enforcement: blockedEnforcement(),
    }

    expect(preflightGateCommand(input)).toEqual({
      allowed: true,
      workflowCommand: null,
      evaluationStatus: 'allowed',
      evaluationBlockerIds: ['blocker-a', 'blocker-b'],
    })
    expect(
      preflightGateCommand({
        ...input,
        command: { ...input.command, expectedBlockerIds: [] },
      }),
    ).toEqual({ allowed: false, code: 'blockers_changed' })
  })

  it('derives approve_acceptance for the current acceptance node', () => {
    const node: WorkflowNode = {
      ...currentGate(),
      id: 'acceptance-current',
      stage: 'accept',
      kind: 'acceptance',
      title: 'Acceptance signoff',
    }

    expect(
      preflightGateCommand({
        command: approveInput({ nodeId: node.id }),
        run: canonicalRun(node),
        currentNode: node,
        requester: { userId: 'user-review-lead', role: 'lead' },
        enforcement: passingEnforcement(),
      }),
    ).toEqual({
      allowed: true,
      workflowCommand: 'approve_acceptance',
      evaluationStatus: 'allowed',
      evaluationBlockerIds: [],
    })
  })

  it('maps role denial and enforcement denial to stable preflight codes', () => {
    const node = currentGate()
    const run = canonicalRun(node)

    expect(
      preflightGateCommand({
        command: approveInput(),
        run,
        currentNode: node,
        requester: { userId: 'user-member', role: 'member' },
        enforcement: passingEnforcement(),
      }),
    ).toEqual({ allowed: false, code: 'role_forbidden' })
    expect(
      preflightGateCommand({
        command: approveInput({
          expectedBlockerIds: ['blocker-a', 'blocker-b'],
        }),
        run,
        currentNode: node,
        requester: { userId: 'user-review-lead', role: 'lead' },
        enforcement: blockedEnforcement(),
      }),
    ).toEqual({ allowed: false, code: 'preflight_blocked' })
  })

  it('requires lead or owner authority for rejection even on a member Gate', () => {
    const node: WorkflowNode = {
      ...currentGate(),
      requiredRole: 'member',
    }

    expect(
      preflightGateCommand({
        command: approveInput({ action: 'reject' }),
        run: canonicalRun(node),
        currentNode: node,
        requester: { userId: 'user-member', role: 'member' },
        enforcement: passingEnforcement(),
      }),
    ).toEqual({ allowed: false, code: 'role_forbidden' })

    expect(
      preflightGateCommand({
        command: approveInput({ action: 'reject' }),
        run: canonicalRun(node),
        currentNode: node,
        requester: { userId: 'user-owner-role', role: 'owner' },
        enforcement: passingEnforcement(),
      }),
    ).toMatchObject({ allowed: true, workflowCommand: null })
  })

  it('rejects a non-Gate current node before role evaluation', () => {
    const node: WorkflowNode = {
      ...currentGate(),
      kind: 'task',
      stage: 'build',
      status: 'running',
    }

    expect(
      preflightGateCommand({
        command: approveInput(),
        run: canonicalRun(node),
        currentNode: node,
        requester: { userId: 'user-owner-role', role: 'owner' },
        enforcement: passingEnforcement(),
      }),
    ).toEqual({ allowed: false, code: 'node_not_current' })
  })

  it('requires the explicit paused current-approval projection shape', () => {
    for (const status of ['success', 'failed', 'pending'] as const) {
      const node: WorkflowNode = { ...currentGate(), status }
      expect(
        preflightGateCommand({
          command: approveInput(),
          run: canonicalRun(node),
          currentNode: node,
          requester: { userId: 'user-review-lead', role: 'lead' },
          enforcement: passingEnforcement(),
        }),
      ).toEqual({ allowed: false, code: 'node_not_current' })
    }

    const node = currentGate()
    for (const status of ['completed', 'building'] as const) {
      expect(
        preflightGateCommand({
          command: approveInput(),
          run: { ...canonicalRun(node), status },
          currentNode: node,
          requester: { userId: 'user-review-lead', role: 'lead' },
          enforcement: passingEnforcement(),
        }),
      ).toEqual({ allowed: false, code: 'node_not_current' })
    }

    for (const status of ['running', 'blocked'] as const) {
      const validNode: WorkflowNode = { ...currentGate(), status }
      expect(
        preflightGateCommand({
          command: approveInput(),
          run: canonicalRun(validNode),
          currentNode: validNode,
          requester: { userId: 'user-review-lead', role: 'lead' },
          enforcement: passingEnforcement(),
        }),
      ).toMatchObject({ allowed: true, workflowCommand: 'approve_gate' })
    }
  })
})
