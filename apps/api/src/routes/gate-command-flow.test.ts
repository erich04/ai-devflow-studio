import { describe, expect, it } from 'vitest'
import {
  parseGateCommandAcknowledgementRecord,
  parseGateCommandReceiptRecord,
  parseGateCommandRecord,
  type GateEnforcementDecision,
} from '@ai-devflow/shared'
import type { RequestPrincipal } from '../auth/request-auth'
import { createSeedTeamRepository } from '../repositories/team-repository'
import { resolveTeamRoute } from './team-routes'

const browserPrincipal: RequestPrincipal = {
  session: {
    source: 'authenticated',
    organizationId: 'org-demo',
    userId: 'u-ling',
    role: 'lead',
    authAccountId: 'acct-demo-u-ling',
    projectMemberships: [
      { projectId: 'p-payments', userId: 'u-ling', role: 'lead' },
    ],
  },
  authentication: { kind: 'session_cookie', tokenRecordId: null },
}

const desktopPrincipal: RequestPrincipal = {
  session: browserPrincipal.session,
  authentication: {
    kind: 'desktop_bearer',
    tokenRecordId: 'desktop-token-v14-flow',
  },
}

function bodyRecord(result: Awaited<ReturnType<typeof resolveTeamRoute>>) {
  if (
    !result ||
    typeof result.body !== 'object' ||
    result.body === null ||
    Array.isArray(result.body)
  ) {
    throw new Error('Expected a route result object.')
  }
  return result.body as Record<string, unknown>
}

describe('Gate Command server vertical flow', () => {
  it('hands one version-bound command to the materializing Desktop without mutating Team Run state', async () => {
    const repository = createSeedTeamRepository()
    const runId = 'run-v14-gate-flow'
    const nodeId = 'node-design-gate'
    const projectedAt = new Date().toISOString()

    const createdRequest = await repository.createWorkRequest(
      {
        projectId: 'p-payments',
        title: 'Approve the V1.4 pilot design',
        request: 'Keep the Web/Desktop authority handoff explicit.',
        idempotencyKey: 'work-request:create:v14-gate-flow',
        expiresAt: null,
      },
      browserPrincipal,
    )
    if (!createdRequest.ok) throw new Error('Work Request create failed.')
    const claimed = await repository.claimWorkRequest(
      {
        workRequestId: createdRequest.workRequest.id,
        expectedVersion: 1,
        runId,
        idempotencyKey: 'work-request:claim:v14-gate-flow',
      },
      desktopPrincipal,
    )
    if (!claimed.ok) throw new Error('Work Request claim failed.')
    const materialized = await repository.materializeWorkRequest(
      {
        workRequestId: createdRequest.workRequest.id,
        expectedVersion: 2,
        runId,
        idempotencyKey: 'work-request:materialize:v14-gate-flow',
      },
      desktopPrincipal,
    )
    if (!materialized.ok) throw new Error('Work Request materialization failed.')

    await repository.uploadRunSummary(
      {
        kind: 'run',
        runId,
        version: 3,
        projectId: 'p-payments',
        title: 'V1.4 Gate flow',
        status: 'paused_at_gate',
        currentNodeId: nodeId,
        currentNode: {
          id: nodeId,
          stage: 'design',
          kind: 'gate',
          status: 'blocked',
          requiredRole: 'lead',
        },
        branchName: 'codex/v14-gate-flow',
        updatedAt: projectedAt,
      },
      {
        ...desktopPrincipal.session,
        tokenRecordId: desktopPrincipal.authentication.tokenRecordId,
      },
    )

    const evaluationResult = await resolveTeamRoute(
      'POST',
      '/api/enforcement/evaluate',
      repository,
      {
        session: browserPrincipal.session,
        body: { projectId: 'p-payments', runId, nodeId },
      },
    )
    expect(evaluationResult?.status).toBe(200)
    const evaluation = bodyRecord(evaluationResult) as unknown as GateEnforcementDecision
    expect(evaluation.blocksApproval).toBe(false)
    const expectedBlockerIds = evaluation.blockingReasons
      .map((reason) => reason.id)
      .sort()

    const missingNodeResult = await resolveTeamRoute(
      'POST',
      '/api/team/projects/p-payments/gate-commands',
      repository,
      {
        principal: browserPrincipal,
        body: {
          projectId: 'p-payments',
          runId,
          nodeId: 'node-that-is-not-in-the-run',
          action: 'approve',
          reason: 'This stale node must never become a command.',
          expectedRunVersion: 3,
          expectedPolicyVersion: evaluation.policyVersion,
          expectedBlockerIds,
          idempotencyKey: 'gate-command:create:v14-missing-node:v3',
        },
      },
    )
    expect(missingNodeResult).toMatchObject({
      status: 409,
      body: { outcomeCode: 'node_not_current' },
    })

    const createResult = await resolveTeamRoute(
      'POST',
      '/api/team/projects/p-payments/gate-commands',
      repository,
      {
        principal: browserPrincipal,
        body: {
          projectId: 'p-payments',
          runId,
          nodeId,
          action: 'approve',
          reason: 'Reviewed the current authoritative projection.',
          expectedRunVersion: 3,
          expectedPolicyVersion: evaluation.policyVersion,
          expectedBlockerIds,
          idempotencyKey: 'gate-command:create:v14-gate-flow:v3',
        },
      },
    )
    expect(createResult?.status).toBe(201)
    const command = parseGateCommandRecord(bodyRecord(createResult).command)
    expect(command).toMatchObject({
      workRequestId: createdRequest.workRequest.id,
      runId,
      nodeId,
      expectedRunVersion: 3,
      status: 'pending',
    })

    const inboxResult = await resolveTeamRoute(
      'GET',
      '/api/desktop/projects/p-payments/gate-commands/inbox',
      repository,
      { principal: desktopPrincipal },
    )
    expect(inboxResult).toEqual({
      status: 200,
      body: { commands: [command] },
    })

    const receiptResult = await resolveTeamRoute(
      'POST',
      `/api/desktop/gate-commands/${command.id}/receipts`,
      repository,
      { principal: desktopPrincipal, body: {} },
    )
    expect(receiptResult?.status).toBe(201)
    const receipt = parseGateCommandReceiptRecord(
      bodyRecord(receiptResult).receipt,
    )
    const fastClientEvaluatedAt = new Date(
      Date.parse(receipt.leasedAt) + 30_000,
    ).toISOString()

    const acknowledgementResult = await resolveTeamRoute(
      'POST',
      `/api/desktop/gate-command-receipts/${receipt.id}/acknowledgements`,
      repository,
      {
        principal: desktopPrincipal,
        body: {
          commandId: command.id,
          outcomeCode: 'applied',
          beforeRunVersion: 3,
          afterRunVersion: 4,
          evaluatedAt: fastClientEvaluatedAt,
        },
      },
    )
    expect(acknowledgementResult?.status).toBe(201)
    const acknowledgement = parseGateCommandAcknowledgementRecord(
      bodyRecord(acknowledgementResult).acknowledgement,
    )
    expect(acknowledgement).toMatchObject({
      commandId: command.id,
      receiptId: receipt.id,
      outcomeCode: 'applied',
      beforeRunVersion: 3,
      afterRunVersion: 4,
      evaluatedAt: fastClientEvaluatedAt,
    })

    const teamRun = (await repository.getRunsBundle(browserPrincipal.session)).runs.find(
      (run) => run.id === runId,
    )
    expect(teamRun).toMatchObject({
      version: 3,
      status: 'paused_at_gate',
      currentNodeId: nodeId,
    })
  })
})
