import { describe, expect, it, vi } from 'vitest'
import type {
  AgentEvent,
  Artifact,
  DesktopPairingCredential,
  GateCommand,
  GateCommandAcknowledgement,
  GateCommandReceipt,
  GateEnforcementDecision,
  GateOverrideDecision,
  PolicySnapshot,
  WorkflowRun,
} from '@ai-devflow/shared'
import type {
  LocalGateCommandAcknowledgement,
  LocalGateCommandExecution,
  LocalGateCommandReceiptObservation,
  CommitGateCommandExecutionInput,
  RecordGateCommandReceiptObservationInput,
  WorkRequestMaterializationBinding,
} from './local-store'
import { gateCommandExecutionFingerprint } from './local-store'
import {
  createGateCommandProcessor,
  type FrozenGateCommandBinding,
  type GateCommandProcessorDependencies,
} from './gate-command-processor'
import { RemoteSyncHttpError } from './remote-sync'

const evaluatedAt = '2026-08-01T02:01:30.000Z'

const pairing: DesktopPairingCredential = {
  tokenId: 'desktop-token-1',
  organizationId: 'org-1',
  projectId: 'team-project-1',
  localProjectId: 'local-project-1',
  userId: 'desktop-user-1',
  role: 'lead',
  authAccountId: 'auth-account-1',
  projectMemberships: [
    {
      projectId: 'team-project-1',
      userId: 'desktop-user-1',
      role: 'lead',
    },
  ],
  createdAt: '2026-08-01T00:00:00.000Z',
}

const materialization: WorkRequestMaterializationBinding = {
  workRequestId: 'work-request-1',
  organizationId: pairing.organizationId,
  teamProjectId: pairing.projectId,
  localProjectId: pairing.localProjectId!,
  runId: 'run-1',
  claimVersion: 2,
  sourceFingerprint: 'b'.repeat(64),
  materializeIdempotencyKey: 'materialize:work-request-1:run-1',
  status: 'acknowledged',
  acknowledgedVersion: 3,
  createdAt: '2026-08-01T00:01:00.000Z',
  updatedAt: '2026-08-01T00:02:00.000Z',
  acknowledgedAt: '2026-08-01T00:02:00.000Z',
}

const binding: FrozenGateCommandBinding = {
  pairing,
  claimTokenId: pairing.tokenId,
  project: {
    teamProjectId: pairing.projectId,
    localProjectId: pairing.localProjectId!,
  },
}

const designArtifact: Artifact = {
  id: 'artifact-design-1',
  runId: materialization.runId,
  nodeId: 'design-node-1',
  kind: 'design',
  title: 'Design',
  summary: 'Canonical design evidence.',
  content: 'Redacted design evidence.',
  redacted: true,
  updatedAt: '2026-08-01T01:00:00.000Z',
}

const run: WorkflowRun = {
  id: materialization.runId,
  version: 3,
  title: 'Remote Gate delivery',
  request: 'Advance the canonical workflow.',
  projectId: pairing.localProjectId!,
  creatorId: 'run-creator-1',
  status: 'paused_at_gate',
  currentNodeId: 'design-gate-1',
  branchName: 'ai/remote-gate-delivery',
  createdAt: '2026-08-01T00:03:00.000Z',
  updatedAt: '2026-08-01T01:01:00.000Z',
  nodes: [
    {
      id: designArtifact.nodeId,
      stage: 'design',
      title: 'Design',
      subtitle: 'Prepare design evidence',
      kind: 'agent',
      status: 'success',
      ownerId: 'design-agent-1',
      retryCount: 0,
      artifactIds: [designArtifact.id],
    },
    {
      id: 'design-gate-1',
      stage: 'design',
      title: 'Design Gate',
      subtitle: 'Lead approval',
      kind: 'gate',
      status: 'running',
      ownerId: 'gate-owner-1',
      requiredRole: 'lead',
      retryCount: 0,
      artifactIds: [designArtifact.id],
    },
    {
      id: 'build-node-1',
      stage: 'build',
      title: 'Build',
      subtitle: 'Implement the design',
      kind: 'task',
      status: 'pending',
      ownerId: 'build-agent-1',
      retryCount: 0,
      artifactIds: [],
    },
  ],
  edges: [
    {
      id: 'edge-design-gate',
      source: designArtifact.nodeId,
      target: 'design-gate-1',
      kind: 'gate',
    },
    {
      id: 'edge-gate-build',
      source: 'design-gate-1',
      target: 'build-node-1',
      kind: 'normal',
    },
  ],
}

const pendingCommand: GateCommand = {
  id: 'gate-command-1',
  organizationId: pairing.organizationId,
  projectId: pairing.projectId,
  workRequestId: materialization.workRequestId,
  runId: run.id,
  nodeId: run.currentNodeId,
  action: 'approve',
  workflowCommand: 'approve_gate',
  reason: 'Server-only reason must not enter local events.',
  requestedByUserId: 'review-lead-1',
  requestedRole: 'lead',
  idempotencyKey: 'gate-command:run-1:v3',
  requestFingerprint: 'a'.repeat(64),
  expectedRunVersion: run.version,
  expectedPolicyVersion: 2,
  expectedBlockerIds: [],
  version: 1,
  evaluationStatus: 'allowed',
  evaluationBlockerIds: [],
  evaluatedAt: '2026-08-01T02:00:00.000Z',
  status: 'pending',
  outcomeCode: null,
  expiresAt: '2026-08-01T02:15:00.000Z',
  createdAt: '2026-08-01T02:00:01.000Z',
  updatedAt: '2026-08-01T02:00:01.000Z',
}

const deliveringCommand: GateCommand = {
  ...pendingCommand,
  version: 2,
  status: 'delivering',
  updatedAt: '2026-08-01T02:01:00.000Z',
}

const receipt: GateCommandReceipt = {
  id: 'gate-receipt-1',
  commandId: deliveringCommand.id,
  attempt: 1,
  leasedAt: '2026-08-01T02:01:00.000Z',
  leaseExpiresAt: '2026-08-01T02:02:00.000Z',
  acknowledgedAt: null,
}

function passingDecision(): GateEnforcementDecision {
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

function blockedDecision(): GateEnforcementDecision {
  return {
    status: 'blocked',
    blocksApproval: true,
    blockingReasons: [
      {
        id: 'blocker-a',
        target: 'missing_agent_review',
        ruleKey: 'design.review_required',
        action: 'block',
        summary: 'A design review is required.',
      },
    ],
    warningReasons: [],
    requiredActions: ['Complete a design review.'],
    canOverride: true,
    overrideRoleRequired: 'lead',
    policySource: 'remote_cache',
    policyVersion: 2,
    provisional: false,
  }
}

function acceptedOverride(
  overrides: Partial<GateOverrideDecision> = {},
): GateOverrideDecision {
  return {
    id: 'gate-override-1',
    runId: run.id,
    nodeId: run.currentNodeId,
    projectId: run.projectId,
    userId: deliveringCommand.requestedByUserId,
    role: 'lead',
    reason: 'Reviewed and accepted for this exact blocker set.',
    blockedReasonIds: ['blocker-a'],
    policyVersion: 2,
    provisional: false,
    status: 'accepted',
    createdAt: '2026-08-01T01:45:00.000Z',
    ...overrides,
  }
}

const policySnapshot: PolicySnapshot = {
  projectId: pairing.projectId,
  organizationPolicy: null,
  projectOverride: null,
  effectivePolicy: {
    id: 'effective-policy-1',
    organizationId: pairing.organizationId,
    projectId: pairing.projectId,
    version: 2,
    rules: [],
    updatedAt: '2026-08-01T01:30:00.000Z',
  },
  version: 2,
  updatedAt: '2026-08-01T01:30:00.000Z',
  syncedAt: '2026-08-01T01:31:00.000Z',
  source: 'remote_cache',
}

const repositoryKnowledgeBinding = {
  projectId: run.projectId,
  evaluatedFingerprint: `sha256:${'1'.repeat(64)}`,
  observedFingerprint: `sha256:${'1'.repeat(64)}`,
}

function localExecution(input: {
  command: GateCommand
  outcomeCode: LocalGateCommandExecution['outcomeCode']
  beforeRunVersion: number
  afterRunVersion: number
}): LocalGateCommandExecution {
  return {
    commandId: input.command.id,
    organizationId: input.command.organizationId,
    teamProjectId: input.command.projectId,
    localProjectId: pairing.localProjectId!,
    claimTokenId: pairing.tokenId,
    workRequestId: input.command.workRequestId,
    runId: input.command.runId,
    nodeId: input.command.nodeId,
    action: input.command.action,
    workflowCommand: input.command.workflowCommand,
    requestedByUserId: input.command.requestedByUserId,
    requestedRole: input.command.requestedRole,
    serverRequestFingerprint: input.command.requestFingerprint,
    executionFingerprint: gateCommandExecutionFingerprint(input.command),
    expectedRunVersion: input.command.expectedRunVersion,
    expectedPolicyVersion: input.command.expectedPolicyVersion,
    expectedBlockerIdsHash: 'd'.repeat(64),
    outcomeCode: input.outcomeCode,
    beforeRunVersion: input.beforeRunVersion,
    afterRunVersion: input.afterRunVersion,
    evaluatedAt,
    commandExpiresAt: input.command.expiresAt,
    createdAt: evaluatedAt,
  }
}

function localAcknowledgement(input: {
  receipt: GateCommandReceipt
  commandId: string
  outcomeCode: LocalGateCommandAcknowledgement['outcomeCode']
  beforeRunVersion: number
  afterRunVersion: number
}): LocalGateCommandAcknowledgement {
  return {
    receiptId: input.receipt.id,
    commandId: input.commandId,
    outcomeCode: input.outcomeCode,
    beforeRunVersion: input.beforeRunVersion,
    afterRunVersion: input.afterRunVersion,
    evaluatedAt,
    status: 'pending',
    failureCode: null,
    failedAt: null,
    remoteAcknowledgementId: null,
    remoteCreatedAt: null,
    remoteReplayed: null,
    createdAt: evaluatedAt,
    acknowledgedAt: null,
  }
}

function receivedReceiptObservation(
  input: RecordGateCommandReceiptObservationInput,
): LocalGateCommandReceiptObservation {
  return {
    receiptId: input.receipt.id,
    commandId: input.command.id,
    attempt: input.receipt.attempt,
    leasedAt: input.receipt.leasedAt,
    leaseExpiresAt: input.receipt.leaseExpiresAt,
    receivedAt: input.receivedAt,
    organizationId: input.command.organizationId,
    teamProjectId: input.command.projectId,
    localProjectId: input.expectedPairing.localProjectId,
    workRequestId: input.command.workRequestId,
    runId: input.command.runId,
    nodeId: input.command.nodeId,
    claimTokenId: input.expectedPairing.tokenId,
    executionFingerprint: gateCommandExecutionFingerprint(input.command),
    status: 'received',
    outcomeCode: null,
    evaluatedAt: null,
  }
}

function successfulReceiptObservationRecorder() {
  return vi.fn<
    GateCommandProcessorDependencies['store']['recordGateCommandReceiptObservation']
  >(async (input) => ({
    recorded: true,
    replayed: false,
    observation: receivedReceiptObservation(input),
  }))
}

function createSingleCommandHarness(input: {
  inboxCommand?: GateCommand
  command?: GateCommand
  receipt?: GateCommandReceipt
  run?: WorkflowRun | null
  materialization?: WorkRequestMaterializationBinding
  decision?: GateEnforcementDecision
  policySnapshot?: PolicySnapshot
  overrides?: GateOverrideDecision[]
  repositoryKnowledge?: typeof repositoryKnowledgeBinding
  events?: AgentEvent[]
  timestamp?: string
}) {
  const inboxCommand = input.inboxCommand ?? pendingCommand
  const command = input.command ?? deliveringCommand
  const deliveredReceipt = input.receipt ?? receipt
  const localRun = input.run === undefined ? run : input.run
  const commandMaterialization = input.materialization ?? materialization
  const timestamp = input.timestamp ?? evaluatedAt
  const commitGateCommandExecution = vi.fn(
    async (commit: CommitGateCommandExecutionInput) => {
      const beforeRunVersion =
        commit.expectedRun?.version ?? commit.command.expectedRunVersion
      const afterRunVersion = commit.run?.version ?? beforeRunVersion
      const execution = localExecution({
        command: commit.command,
        outcomeCode: commit.outcomeCode,
        beforeRunVersion,
        afterRunVersion,
      })
      const acknowledgement = localAcknowledgement({
        receipt: commit.receipt,
        commandId: commit.command.id,
        outcomeCode: commit.outcomeCode,
        beforeRunVersion,
        afterRunVersion,
      })
      return {
        committed: true as const,
        replayed: false,
        execution,
        acknowledgement: { ...acknowledgement, evaluatedAt: commit.evaluatedAt },
      }
    },
  )
  const acknowledgeGateCommandReceipt = vi.fn(
    async (
      receiptId: string,
      acknowledgementInput: {
        commandId: string
        outcomeCode: LocalGateCommandAcknowledgement['outcomeCode']
        beforeRunVersion: number
        afterRunVersion: number
        evaluatedAt: string
      },
    ) => ({
      acknowledgement: {
        id: `remote-ack-${receiptId}`,
        receiptId,
        ...acknowledgementInput,
        createdAt: timestamp,
      },
      replayed: false,
    }),
  )
  const evaluateLocalEnforcement = vi.fn(async () => ({
    decision: input.decision ?? passingDecision(),
    policySnapshot: input.policySnapshot ?? policySnapshot,
    overrides: input.overrides ?? [],
    repositoryKnowledge:
      input.repositoryKnowledge ?? repositoryKnowledgeBinding,
    evidence: {
      artifacts: [
        localRun?.id === designArtifact.runId
          ? designArtifact
          : { ...designArtifact, runId: localRun?.id ?? command.runId },
      ],
      codingRuns: [],
      codingDiffs: [],
      testEvidence: [],
      agentReviews: [],
    },
  }))
  const listEvents = vi.fn(async () => input.events ?? [])
  const recordGateCommandReceiptObservation =
    successfulReceiptObservationRecorder()
  const createGateCommandReceipt = vi.fn(async (_commandId: string) => ({
    command,
    receipt: deliveredReceipt,
    replayed: false,
  }))
  const dependencies = {
    remote: {
      listGateCommandInbox: vi.fn(async () => [inboxCommand]),
      createGateCommandReceipt,
      acknowledgeGateCommandReceipt,
    },
    store: {
      recordGateCommandReceiptObservation,
      getRun: vi.fn(async (runId: string) =>
        localRun?.id === runId ? localRun : null,
      ),
      listEvents,
      getGateCommandExecution: vi.fn<
        GateCommandProcessorDependencies['store']['getGateCommandExecution']
      >(async () => null),
      getGateCommandAcknowledgement: vi.fn<
        GateCommandProcessorDependencies['store']['getGateCommandAcknowledgement']
      >(async () => null),
      listPendingGateCommandAcknowledgements: vi.fn<
        GateCommandProcessorDependencies['store']['listPendingGateCommandAcknowledgements']
      >(async () => []),
      getWorkRequestMaterializationByWorkRequestId: vi.fn(
        async (workRequestId: string) =>
          commandMaterialization.workRequestId === workRequestId
            ? commandMaterialization
            : null,
      ),
      getWorkRequestMaterializationByRunId: vi.fn(async (runId: string) =>
        commandMaterialization.runId === runId ? commandMaterialization : null,
      ),
      commitGateCommandExecution,
      recordGateCommandAcknowledgement: vi.fn(async (record) => ({
        recorded: true as const,
        replayed: false,
        acknowledgement: {
          ...localAcknowledgement({
            receipt: deliveredReceipt,
            commandId: record.acknowledgement.commandId,
            outcomeCode: record.acknowledgement.outcomeCode,
            beforeRunVersion: record.acknowledgement.beforeRunVersion,
            afterRunVersion: record.acknowledgement.afterRunVersion,
          }),
          status: 'acknowledged' as const,
          remoteAcknowledgementId: record.acknowledgement.id,
          remoteCreatedAt: record.acknowledgement.createdAt,
          remoteReplayed: record.replayed,
          acknowledgedAt: record.acknowledgedAt,
        },
      })),
      terminalizeGateCommandAcknowledgement: vi.fn(),
    },
    evaluateLocalEnforcement,
    now: vi.fn(() => timestamp),
  }
  return {
    dependencies,
    commitGateCommandExecution,
    evaluateLocalEnforcement,
    listEvents,
    recordGateCommandReceiptObservation,
    acknowledgeGateCommandReceipt,
  }
}

describe('Gate Command background processor', () => {
  it('uses the authoritative delivering command and atomically applies then acknowledges it', async () => {
    const execution = localExecution({
      command: deliveringCommand,
      outcomeCode: 'applied',
      beforeRunVersion: 3,
      afterRunVersion: 4,
    })
    const pendingAcknowledgement = localAcknowledgement({
      receipt,
      commandId: deliveringCommand.id,
      outcomeCode: 'applied',
      beforeRunVersion: 3,
      afterRunVersion: 4,
    })
    const remoteAcknowledgement: GateCommandAcknowledgement = {
      id: 'gate-acknowledgement-1',
      commandId: deliveringCommand.id,
      receiptId: receipt.id,
      outcomeCode: 'applied',
      beforeRunVersion: 3,
      afterRunVersion: 4,
      evaluatedAt,
      createdAt: '2026-08-01T02:01:31.000Z',
    }
    const commitGateCommandExecution = vi.fn(async (input) => ({
      committed: true as const,
      replayed: false,
      execution,
      acknowledgement: pendingAcknowledgement,
      input,
    }))
    const recordGateCommandAcknowledgement = vi.fn(async () => ({
      recorded: true as const,
      replayed: false,
      acknowledgement: {
        ...pendingAcknowledgement,
        status: 'acknowledged' as const,
        remoteAcknowledgementId: remoteAcknowledgement.id,
        remoteCreatedAt: remoteAcknowledgement.createdAt,
        remoteReplayed: true,
        acknowledgedAt: '2026-08-01T02:01:32.000Z',
      },
    }))
    const acknowledgeGateCommandReceipt = vi.fn(async () => ({
      acknowledgement: remoteAcknowledgement,
      replayed: true,
    }))
    const evaluateLocalEnforcement = vi.fn(async () => ({
      decision: passingDecision(),
      policySnapshot,
      overrides: [],
      repositoryKnowledge: repositoryKnowledgeBinding,
      evidence: {
        artifacts: [designArtifact],
        codingRuns: [],
        codingDiffs: [],
        testEvidence: [],
        agentReviews: [],
      },
    }))
    const dependencies = {
      remote: {
        listGateCommandInbox: vi.fn(async () => [pendingCommand]),
        createGateCommandReceipt: vi.fn(async () => ({
          command: deliveringCommand,
          receipt,
          replayed: false,
        })),
        acknowledgeGateCommandReceipt,
      },
      store: {
        recordGateCommandReceiptObservation:
          successfulReceiptObservationRecorder(),
        getRun: vi.fn(async () => run),
        listEvents: vi.fn(async () => [] as AgentEvent[]),
        getGateCommandExecution: vi.fn(async () => null),
        getGateCommandAcknowledgement: vi.fn(async () => null),
        listPendingGateCommandAcknowledgements: vi.fn(async () => []),
        getWorkRequestMaterializationByWorkRequestId: vi.fn(async () =>
          materialization,
        ),
        getWorkRequestMaterializationByRunId: vi.fn(async () => materialization),
        commitGateCommandExecution,
        recordGateCommandAcknowledgement,
        terminalizeGateCommandAcknowledgement: vi.fn(),
      },
      evaluateLocalEnforcement,
      now: vi
        .fn()
        .mockReturnValueOnce(evaluatedAt)
        .mockReturnValueOnce(evaluatedAt)
        .mockReturnValueOnce('2026-08-01T02:01:32.000Z'),
    } satisfies GateCommandProcessorDependencies
    const processor = createGateCommandProcessor(dependencies)

    await expect(processor.processAvailable(binding)).resolves.toEqual({
      pendingAcknowledgementsRetried: 0,
      commandsSeen: 1,
      results: [
        {
          commandId: deliveringCommand.id,
          receiptId: receipt.id,
          status: 'acknowledged',
          outcomeCode: 'applied',
        },
      ],
    })
    expect(evaluateLocalEnforcement).toHaveBeenCalledWith({
      command: deliveringCommand,
      run,
      node: run.nodes[1],
    })
    expect(commitGateCommandExecution).toHaveBeenCalledTimes(1)
    const commitInput = commitGateCommandExecution.mock.calls[0]![0]
    expect(commitInput).toMatchObject({
      command: deliveringCommand,
      receipt,
      expectedPairing: {
        tokenId: pairing.tokenId,
        organizationId: pairing.organizationId,
        projectId: pairing.projectId,
        localProjectId: pairing.localProjectId,
      },
      outcomeCode: 'applied',
      evaluatedAt,
      expectedRun: run,
      run: {
        id: run.id,
        version: 4,
        currentNodeId: 'build-node-1',
      },
      event: {
        runId: run.id,
        nodeId: deliveringCommand.nodeId,
        kind: 'approval',
        timestamp: evaluatedAt,
      },
      evaluationBinding: {
        policySnapshot,
        enforcement: passingDecision(),
        overrides: [],
        selectedOverrideId: null,
        repositoryKnowledge: repositoryKnowledgeBinding,
        evidence: {
          artifacts: [designArtifact],
          codingRuns: [],
          codingDiffs: [],
          testEvidence: [],
          agentReviews: [],
        },
      },
    })
    expect(commitInput.event?.message).not.toContain(deliveringCommand.reason)
    expect(acknowledgeGateCommandReceipt).toHaveBeenCalledWith(
      receipt.id,
      {
        commandId: deliveringCommand.id,
        outcomeCode: 'applied',
        beforeRunVersion: 3,
        afterRunVersion: 4,
        evaluatedAt,
      },
      pairing,
    )
    expect(recordGateCommandAcknowledgement).toHaveBeenCalledWith({
      receiptId: receipt.id,
      acknowledgement: remoteAcknowledgement,
      replayed: true,
      acknowledgedAt: '2026-08-01T02:01:32.000Z',
    })
  })

  it('persists the authoritative receipt before loading the Run or local evidence', async () => {
    const harness = createSingleCommandHarness({})

    await createGateCommandProcessor(
      harness.dependencies as GateCommandProcessorDependencies,
    ).processAvailable(binding)

    expect(harness.recordGateCommandReceiptObservation).toHaveBeenCalledWith({
      command: deliveringCommand,
      receipt,
      expectedPairing: {
        tokenId: pairing.tokenId,
        organizationId: pairing.organizationId,
        projectId: pairing.projectId,
        localProjectId: pairing.localProjectId,
      },
      receivedAt: evaluatedAt,
    })
    const observationOrder =
      harness.recordGateCommandReceiptObservation.mock.invocationCallOrder[0]!
    expect(observationOrder).toBeLessThan(
      harness.dependencies.store.getRun.mock.invocationCallOrder[0]!,
    )
    expect(observationOrder).toBeLessThan(
      harness.listEvents.mock.invocationCallOrder[0]!,
    )
    expect(observationOrder).toBeLessThan(
      harness.evaluateLocalEnforcement.mock.invocationCallOrder[0]!,
    )
  })

  it('fails closed before local evidence reads when receipt observation conflicts', async () => {
    const harness = createSingleCommandHarness({})
    harness.recordGateCommandReceiptObservation.mockResolvedValue({
      recorded: false,
      reason: 'receipt_conflict',
    })

    await expect(
      createGateCommandProcessor(
        harness.dependencies as GateCommandProcessorDependencies,
      ).processAvailable(binding),
    ).resolves.toMatchObject({
      commandsSeen: 1,
      results: [
        {
          commandId: deliveringCommand.id,
          receiptId: receipt.id,
          status: 'local_conflict',
          outcomeCode: null,
        },
      ],
    })
    expect(harness.dependencies.store.getRun).not.toHaveBeenCalled()
    expect(harness.listEvents).not.toHaveBeenCalled()
    expect(harness.evaluateLocalEnforcement).not.toHaveBeenCalled()
    expect(harness.commitGateCommandExecution).not.toHaveBeenCalled()
    expect(harness.acknowledgeGateCommandReceipt).not.toHaveBeenCalled()
  })

  it('rejects an authoritative binding escape before receipt observation or Run reads', async () => {
    const command: GateCommand = {
      ...deliveringCommand,
      projectId: 'team-project-other',
      requestFingerprint: '4'.repeat(64),
    }
    const harness = createSingleCommandHarness({ command })

    await expect(
      createGateCommandProcessor(
        harness.dependencies as GateCommandProcessorDependencies,
      ).processAvailable(binding),
    ).resolves.toMatchObject({
      commandsSeen: 1,
      results: [
        {
          commandId: command.id,
          receiptId: receipt.id,
          status: 'acknowledged',
          outcomeCode: 'scope_mismatch',
        },
      ],
    })
    expect(harness.recordGateCommandReceiptObservation).not.toHaveBeenCalled()
    expect(harness.dependencies.store.getRun).not.toHaveBeenCalled()
    expect(harness.evaluateLocalEnforcement).not.toHaveBeenCalled()
    expect(harness.commitGateCommandExecution).toHaveBeenCalledWith(
      expect.objectContaining({ outcomeCode: 'scope_mismatch' }),
    )
  })

  it('uses a bounded deterministic event identifier without embedding the raw command identifier', async () => {
    const longCommandId = `gate-command-${'sensitive-segment-'.repeat(40)}`
    const command = {
      ...deliveringCommand,
      id: longCommandId,
    }
    const inboxCommand = {
      ...pendingCommand,
      id: longCommandId,
    }
    const deliveredReceipt = {
      ...receipt,
      commandId: longCommandId,
    }
    const { dependencies, commitGateCommandExecution } =
      createSingleCommandHarness({
        inboxCommand,
        command,
        receipt: deliveredReceipt,
      })

    await createGateCommandProcessor(dependencies).processAvailable(binding)

    const eventId = commitGateCommandExecution.mock.calls[0]![0].event?.id
    expect(eventId).toMatch(/^event-gate-command-[a-f0-9]{32}$/)
    expect(eventId).not.toContain(longCommandId)
  })

  it('continues event sequencing from the maximum persisted sequence when history has a gap', async () => {
    const harness = createSingleCommandHarness({
      events: [
        {
          id: 'event-existing-1',
          runId: run.id,
          nodeId: run.nodes[0]!.id,
          sequence: 1,
          kind: 'thinking',
          message: 'First event.',
          timestamp: '2026-08-01T01:00:00.000Z',
        },
        {
          id: 'event-existing-3',
          runId: run.id,
          nodeId: run.nodes[0]!.id,
          sequence: 3,
          kind: 'thinking',
          message: 'Third event.',
          timestamp: '2026-08-01T01:01:00.000Z',
        },
      ],
    })

    await createGateCommandProcessor(
      harness.dependencies as GateCommandProcessorDependencies,
    ).processAvailable(binding)

    expect(harness.commitGateCommandExecution.mock.calls[0]![0].event).toMatchObject({
      sequence: 4,
    })
  })

  it('ignores an accepted override from a different project', async () => {
    const command = {
      ...deliveringCommand,
      expectedBlockerIds: ['blocker-a'],
      evaluationStatus: 'blocked' as const,
      evaluationBlockerIds: ['blocker-a'],
    }
    const { dependencies, commitGateCommandExecution } =
      createSingleCommandHarness({
        command,
        decision: blockedDecision(),
        overrides: [
          acceptedOverride({ projectId: 'team-project-different' }),
        ],
      })

    await createGateCommandProcessor(dependencies).processAvailable(binding)

    expect(commitGateCommandExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        outcomeCode: 'evidence_blocked',
      }),
    )
    expect(commitGateCommandExecution.mock.calls[0]![0]).not.toHaveProperty(
      'run',
    )
  })

  it('selects the exact accepted override after ignoring stale historical candidates', async () => {
    const command = {
      ...deliveringCommand,
      expectedBlockerIds: ['blocker-a'],
      evaluationStatus: 'blocked' as const,
      evaluationBlockerIds: ['blocker-a'],
    }
    const { dependencies, commitGateCommandExecution } =
      createSingleCommandHarness({
        command,
        decision: blockedDecision(),
        overrides: [
          acceptedOverride({
            id: 'gate-override-rejected',
            status: 'rejected',
          }),
          acceptedOverride({ id: 'gate-override-current' }),
        ],
      })

    await createGateCommandProcessor(dependencies).processAvailable(binding)

    expect(commitGateCommandExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        outcomeCode: 'applied',
        run: expect.objectContaining({ version: 4 }),
      }),
    )
  })

  it('uses the exact accepted override represented by a realistic overridden decision', async () => {
    const command = {
      ...deliveringCommand,
      expectedBlockerIds: ['blocker-a'],
      evaluationStatus: 'allowed' as const,
      evaluationBlockerIds: ['blocker-a'],
    }
    const decision: GateEnforcementDecision = {
      ...blockedDecision(),
      status: 'overridden',
      blocksApproval: false,
      requiredActions: [],
    }
    const { dependencies, commitGateCommandExecution } =
      createSingleCommandHarness({
        command,
        decision,
        overrides: [acceptedOverride()],
      })

    await createGateCommandProcessor(dependencies).processAvailable(binding)

    expect(commitGateCommandExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        outcomeCode: 'applied',
        run: expect.objectContaining({ version: 4 }),
      }),
    )
  })

  it('canonicalizes a valid multi-blocker decision before command and override matching', async () => {
    const command = {
      ...deliveringCommand,
      expectedBlockerIds: ['blocker-a', 'blocker-b'],
      evaluationStatus: 'allowed' as const,
      evaluationBlockerIds: ['blocker-a', 'blocker-b'],
    }
    const decision: GateEnforcementDecision = {
      ...blockedDecision(),
      status: 'overridden',
      blocksApproval: false,
      blockingReasons: [
        {
          ...blockedDecision().blockingReasons[0]!,
          id: 'blocker-b',
          ruleKey: 'build.tests_required',
        },
        blockedDecision().blockingReasons[0]!,
      ],
      requiredActions: [],
    }
    const { dependencies, commitGateCommandExecution } =
      createSingleCommandHarness({
        command,
        decision,
        overrides: [
          acceptedOverride({
            blockedReasonIds: ['blocker-a', 'blocker-b'],
          }),
        ],
      })

    await createGateCommandProcessor(dependencies).processAvailable(binding)

    expect(commitGateCommandExecution).toHaveBeenCalledWith(
      expect.objectContaining({ outcomeCode: 'applied' }),
    )
  })

  it('fails closed when local enforcement reports duplicate blocker identifiers', async () => {
    const duplicatedReason = blockedDecision().blockingReasons[0]!
    const command = {
      ...deliveringCommand,
      expectedBlockerIds: [duplicatedReason.id],
      evaluationStatus: 'blocked' as const,
      evaluationBlockerIds: [duplicatedReason.id],
    }
    const harness = createSingleCommandHarness({
      command,
      decision: {
        ...blockedDecision(),
        blockingReasons: [duplicatedReason, { ...duplicatedReason }],
      },
    })

    await createGateCommandProcessor(
      harness.dependencies as GateCommandProcessorDependencies,
    ).processAvailable(binding)

    expect(harness.commitGateCommandExecution).toHaveBeenCalledWith(
      expect.objectContaining({ outcomeCode: 'blockers_changed' }),
    )
    expect(harness.commitGateCommandExecution.mock.calls[0]![0]).not.toHaveProperty(
      'run',
    )
  })

  it('does not select a historical override when current enforcement passes', async () => {
    const historicalOverride = acceptedOverride({
      id: 'gate-override-historical',
      policyVersion: 1,
    })
    const harness = createSingleCommandHarness({
      overrides: [historicalOverride],
    })

    await createGateCommandProcessor(
      harness.dependencies as GateCommandProcessorDependencies,
    ).processAvailable(binding)

    expect(harness.commitGateCommandExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        outcomeCode: 'applied',
        evaluationBinding: expect.objectContaining({
          overrides: [historicalOverride],
          selectedOverrideId: null,
        }),
      }),
    )
  })

  it('stops the poll before inbox receipt acquisition while a pending ACK remains', async () => {
    const execution = localExecution({
      command: deliveringCommand,
      outcomeCode: 'applied',
      beforeRunVersion: 3,
      afterRunVersion: 4,
    })
    const pendingAcknowledgement = localAcknowledgement({
      receipt,
      commandId: deliveringCommand.id,
      outcomeCode: 'applied',
      beforeRunVersion: 3,
      afterRunVersion: 4,
    })
    const listGateCommandInbox = vi.fn(async () => [pendingCommand])
    const createGateCommandReceipt = vi.fn()
    const dependencies = {
      remote: {
        listGateCommandInbox,
        createGateCommandReceipt,
        acknowledgeGateCommandReceipt: vi.fn(async () => {
          throw new Error('remote acknowledgement unavailable')
        }),
      },
      store: {
        recordGateCommandReceiptObservation:
          successfulReceiptObservationRecorder(),
        getRun: vi.fn(async () => run),
        listEvents: vi.fn(async () => []),
        getGateCommandExecution: vi.fn(async () => execution),
        getGateCommandAcknowledgement: vi.fn(async () => pendingAcknowledgement),
        listPendingGateCommandAcknowledgements: vi.fn(async () => [
          pendingAcknowledgement,
        ]),
        getWorkRequestMaterializationByWorkRequestId: vi.fn(async () =>
          materialization,
        ),
        getWorkRequestMaterializationByRunId: vi.fn(async () => materialization),
        commitGateCommandExecution: vi.fn(),
        recordGateCommandAcknowledgement: vi.fn(),
        terminalizeGateCommandAcknowledgement: vi.fn(),
      },
      evaluateLocalEnforcement: vi.fn(),
      now: vi.fn(() => evaluatedAt),
    } satisfies GateCommandProcessorDependencies

    await expect(
      createGateCommandProcessor(dependencies).processAvailable(binding),
    ).resolves.toEqual({
      pendingAcknowledgementsRetried: 1,
      commandsSeen: 0,
      results: [
        {
          commandId: deliveringCommand.id,
          receiptId: receipt.id,
          status: 'ack_pending',
          outcomeCode: 'applied',
        },
      ],
    })
    expect(listGateCommandInbox).not.toHaveBeenCalled()
    expect(createGateCommandReceipt).not.toHaveBeenCalled()
  })

  it('redelivery never reapplies or creates a second ACK and retries the original pending receipt', async () => {
    const execution = localExecution({
      command: deliveringCommand,
      outcomeCode: 'applied',
      beforeRunVersion: 3,
      afterRunVersion: 4,
    })
    const originalPendingAcknowledgement = localAcknowledgement({
      receipt,
      commandId: deliveringCommand.id,
      outcomeCode: 'applied',
      beforeRunVersion: 3,
      afterRunVersion: 4,
    })
    const redeliveryCommand: GateCommand = {
      ...deliveringCommand,
      version: 3,
      updatedAt: '2026-08-01T02:02:00.000Z',
    }
    const redeliveryReceipt: GateCommandReceipt = {
      id: 'gate-receipt-2',
      commandId: redeliveryCommand.id,
      attempt: 2,
      leasedAt: '2026-08-01T02:02:00.000Z',
      leaseExpiresAt: '2026-08-01T02:03:00.000Z',
      acknowledgedAt: null,
    }
    const remoteAcknowledgement: GateCommandAcknowledgement = {
      id: 'gate-acknowledgement-original',
      commandId: deliveringCommand.id,
      receiptId: receipt.id,
      outcomeCode: 'applied',
      beforeRunVersion: 3,
      afterRunVersion: 4,
      evaluatedAt,
      createdAt: '2026-08-01T02:02:31.000Z',
    }
    const commitGateCommandExecution = vi.fn(async (input) => ({
      committed: true as const,
      replayed: true,
      execution,
      acknowledgement: originalPendingAcknowledgement,
      input,
    }))
    const recordGateCommandReceiptObservation =
      successfulReceiptObservationRecorder()
    const evaluateLocalEnforcement = vi.fn()
    const acknowledgeGateCommandReceipt = vi.fn(async () => ({
      acknowledgement: remoteAcknowledgement,
      replayed: true,
    }))
    const dependencies = {
      remote: {
        listGateCommandInbox: vi.fn(async () => [pendingCommand]),
        createGateCommandReceipt: vi.fn(async () => ({
          command: redeliveryCommand,
          receipt: redeliveryReceipt,
          replayed: false,
        })),
        acknowledgeGateCommandReceipt,
      },
      store: {
        recordGateCommandReceiptObservation,
        getRun: vi.fn(async () => run),
        listEvents: vi.fn(async () => []),
        getGateCommandExecution: vi.fn(async () => execution),
        getGateCommandAcknowledgement: vi.fn(async () => null),
        listPendingGateCommandAcknowledgements: vi
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([originalPendingAcknowledgement]),
        getWorkRequestMaterializationByWorkRequestId: vi.fn(async () =>
          materialization,
        ),
        getWorkRequestMaterializationByRunId: vi.fn(async () => materialization),
        commitGateCommandExecution,
        recordGateCommandAcknowledgement: vi.fn(async () => ({
          recorded: true as const,
          replayed: false,
          acknowledgement: {
            ...originalPendingAcknowledgement,
            status: 'acknowledged' as const,
            remoteAcknowledgementId: remoteAcknowledgement.id,
            remoteCreatedAt: remoteAcknowledgement.createdAt,
            remoteReplayed: true,
            acknowledgedAt: '2026-08-01T02:02:31.000Z',
          },
        })),
        terminalizeGateCommandAcknowledgement: vi.fn(),
      },
      evaluateLocalEnforcement,
      now: vi
        .fn()
        .mockReturnValueOnce('2026-08-01T02:02:30.000Z')
        .mockReturnValueOnce('2026-08-01T02:02:31.000Z'),
    } satisfies GateCommandProcessorDependencies

    await expect(
      createGateCommandProcessor(dependencies).processAvailable(binding),
    ).resolves.toMatchObject({
      commandsSeen: 1,
      results: [
        {
          commandId: deliveringCommand.id,
          receiptId: receipt.id,
          status: 'acknowledged',
          outcomeCode: 'applied',
        },
      ],
    })
    expect(recordGateCommandReceiptObservation).toHaveBeenCalledTimes(1)
    expect(commitGateCommandExecution).toHaveBeenCalledWith({
      command: redeliveryCommand,
      receipt: redeliveryReceipt,
      expectedPairing: {
        tokenId: pairing.tokenId,
        organizationId: pairing.organizationId,
        projectId: pairing.projectId,
        localProjectId: pairing.localProjectId,
      },
      outcomeCode: 'applied',
      evaluatedAt: '2026-08-01T02:02:30.000Z',
    })
    expect(evaluateLocalEnforcement).not.toHaveBeenCalled()
    expect(acknowledgeGateCommandReceipt).toHaveBeenCalledWith(
      receipt.id,
      {
        commandId: deliveringCommand.id,
        outcomeCode: 'applied',
        beforeRunVersion: 3,
        afterRunVersion: 4,
        evaluatedAt,
      },
      pairing,
    )
    expect(acknowledgeGateCommandReceipt).not.toHaveBeenCalledWith(
      redeliveryReceipt.id,
      expect.anything(),
      expect.anything(),
    )
  })

  it('rejects redelivery when the authoritative evaluation payload changed under the same command id', async () => {
    const execution = localExecution({
      command: deliveringCommand,
      outcomeCode: 'applied',
      beforeRunVersion: 3,
      afterRunVersion: 4,
    })
    const pendingAcknowledgement = localAcknowledgement({
      receipt,
      commandId: deliveringCommand.id,
      outcomeCode: 'applied',
      beforeRunVersion: 3,
      afterRunVersion: 4,
    })
    const changedCommand: GateCommand = {
      ...deliveringCommand,
      expectedBlockerIds: ['server-blocker-changed'],
      evaluationStatus: 'blocked',
      evaluationBlockerIds: ['server-blocker-changed'],
    }
    const acknowledgeGateCommandReceipt = vi.fn()
    const dependencies = {
      remote: {
        listGateCommandInbox: vi.fn(async () => [pendingCommand]),
        createGateCommandReceipt: vi.fn(async () => ({
          command: changedCommand,
          receipt,
          replayed: true,
        })),
        acknowledgeGateCommandReceipt,
      },
      store: {
        recordGateCommandReceiptObservation:
          successfulReceiptObservationRecorder(),
        getRun: vi.fn(async () => run),
        listEvents: vi.fn(async () => []),
        getGateCommandExecution: vi.fn(async () => execution),
        getGateCommandAcknowledgement: vi.fn(async () => null),
        listPendingGateCommandAcknowledgements: vi
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([pendingAcknowledgement]),
        getWorkRequestMaterializationByWorkRequestId: vi.fn(async () =>
          materialization,
        ),
        getWorkRequestMaterializationByRunId: vi.fn(async () => materialization),
        commitGateCommandExecution: vi.fn(),
        recordGateCommandAcknowledgement: vi.fn(),
        terminalizeGateCommandAcknowledgement: vi.fn(),
      },
      evaluateLocalEnforcement: vi.fn(),
      now: vi.fn(() => evaluatedAt),
    } satisfies GateCommandProcessorDependencies

    await expect(
      createGateCommandProcessor(dependencies).processAvailable(binding),
    ).resolves.toMatchObject({
      commandsSeen: 1,
      results: [
        {
          commandId: deliveringCommand.id,
          receiptId: receipt.id,
          status: 'local_conflict',
          outcomeCode: null,
        },
      ],
    })
    expect(acknowledgeGateCommandReceipt).not.toHaveBeenCalled()
  })

  it('rejects redelivery of an execution created under an older claim token', async () => {
    const priorExecution: LocalGateCommandExecution = {
      ...localExecution({
        command: deliveringCommand,
        outcomeCode: 'applied',
        beforeRunVersion: 3,
        afterRunVersion: 4,
      }),
      claimTokenId: 'desktop-token-prior',
    }
    const priorAcknowledgement = localAcknowledgement({
      receipt,
      commandId: deliveringCommand.id,
      outcomeCode: 'applied',
      beforeRunVersion: 3,
      afterRunVersion: 4,
    })
    const harness = createSingleCommandHarness({})
    harness.dependencies.store.getGateCommandExecution.mockResolvedValue(
      priorExecution,
    )
    harness.dependencies.store.getGateCommandAcknowledgement.mockResolvedValue(
      priorAcknowledgement,
    )
    harness.dependencies.store.listPendingGateCommandAcknowledgements.mockResolvedValue(
      [priorAcknowledgement],
    )

    await expect(
      createGateCommandProcessor(
        harness.dependencies as GateCommandProcessorDependencies,
      ).processAvailable(binding),
    ).resolves.toMatchObject({
      commandsSeen: 1,
      results: [
        {
          commandId: deliveringCommand.id,
          receiptId: receipt.id,
          status: 'local_conflict',
          outcomeCode: null,
        },
      ],
    })
    expect(harness.acknowledgeGateCommandReceipt).not.toHaveBeenCalled()
    expect(harness.commitGateCommandExecution).not.toHaveBeenCalled()
  })

  it('binds the redacted command reason into the immutable redelivery fingerprint', () => {
    expect(
      gateCommandExecutionFingerprint({
        ...deliveringCommand,
        reason: 'A different bounded and redacted reason.',
      }),
    ).not.toBe(gateCommandExecutionFingerprint(deliveringCommand))
  })

  it('rejects a non-canonical authoritative local node id before local mutation', async () => {
    const command: GateCommand = {
      ...deliveringCommand,
      nodeId: `${run.id}:${run.currentNodeId}`,
    }
    const harness = createSingleCommandHarness({ command })

    await expect(
      createGateCommandProcessor(
        harness.dependencies as GateCommandProcessorDependencies,
      ).processAvailable(binding),
    ).resolves.toMatchObject({
      results: [
        {
          commandId: command.id,
          receiptId: receipt.id,
          status: 'local_conflict',
          outcomeCode: null,
        },
      ],
    })
    expect(harness.evaluateLocalEnforcement).not.toHaveBeenCalled()
    expect(harness.commitGateCommandExecution).not.toHaveBeenCalled()
    expect(harness.acknowledgeGateCommandReceipt).not.toHaveBeenCalled()
  })

  it('routes each project inbox command through its own exact Work Request materialization', async () => {
    const otherMaterialization: WorkRequestMaterializationBinding = {
      ...materialization,
      workRequestId: 'work-request-2',
      runId: 'run-2',
      sourceFingerprint: 'e'.repeat(64),
      materializeIdempotencyKey: 'materialize:work-request-2:run-2',
    }
    const otherRun: WorkflowRun = {
      ...run,
      id: otherMaterialization.runId,
      branchName: 'ai/other-materialized-work-request',
      nodes: run.nodes.map((node) => ({ ...node })),
      edges: run.edges.map((edge) => ({ ...edge })),
    }
    const otherInboxCommand: GateCommand = {
      ...pendingCommand,
      id: 'gate-command-2',
      workRequestId: otherMaterialization.workRequestId,
      runId: otherMaterialization.runId,
      idempotencyKey: 'gate-command:run-2:v3',
      requestFingerprint: 'f'.repeat(64),
    }
    const otherDeliveringCommand: GateCommand = {
      ...otherInboxCommand,
      version: 2,
      status: 'delivering',
      updatedAt: '2026-08-01T02:01:00.000Z',
    }
    const otherReceipt: GateCommandReceipt = {
      ...receipt,
      id: 'gate-receipt-2',
      commandId: otherDeliveringCommand.id,
    }
    const harness = createSingleCommandHarness({
      inboxCommand: otherInboxCommand,
      command: otherDeliveringCommand,
      receipt: otherReceipt,
      run: otherRun,
      materialization: otherMaterialization,
    })

    await expect(
      createGateCommandProcessor(
        harness.dependencies as GateCommandProcessorDependencies,
      ).processAvailable(binding),
    ).resolves.toMatchObject({
      commandsSeen: 1,
      results: [
        {
          commandId: otherDeliveringCommand.id,
          receiptId: otherReceipt.id,
          status: 'acknowledged',
          outcomeCode: 'applied',
        },
      ],
    })
    expect(harness.evaluateLocalEnforcement).toHaveBeenCalledTimes(1)
    expect(harness.commitGateCommandExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        command: otherDeliveringCommand,
        expectedPairing: {
          tokenId: pairing.tokenId,
          organizationId: pairing.organizationId,
          projectId: pairing.projectId,
          localProjectId: pairing.localProjectId,
        },
        outcomeCode: 'applied',
      }),
    )
  })

  it('isolates one unexpected local evaluation failure and continues with the next inbox command', async () => {
    const secondInboxCommand: GateCommand = {
      ...pendingCommand,
      id: 'gate-command-2',
      idempotencyKey: 'gate-command:run-1:v3:second',
      requestFingerprint: 'f'.repeat(64),
    }
    const secondDeliveringCommand: GateCommand = {
      ...secondInboxCommand,
      version: 2,
      status: 'delivering',
      updatedAt: deliveringCommand.updatedAt,
    }
    const secondReceipt: GateCommandReceipt = {
      ...receipt,
      id: 'gate-receipt-2',
      commandId: secondDeliveringCommand.id,
    }
    const harness = createSingleCommandHarness({})
    harness.dependencies.remote.listGateCommandInbox.mockResolvedValue([
      pendingCommand,
      secondInboxCommand,
    ])
    harness.dependencies.remote.createGateCommandReceipt.mockImplementation(
      async (commandId: string) =>
        commandId === deliveringCommand.id
          ? { command: deliveringCommand, receipt, replayed: false }
          : {
              command: secondDeliveringCommand,
              receipt: secondReceipt,
              replayed: false,
            },
    )
    harness.evaluateLocalEnforcement
      .mockRejectedValueOnce(new Error('local evaluation unavailable'))
      .mockResolvedValueOnce({
        decision: passingDecision(),
        policySnapshot,
        overrides: [],
        repositoryKnowledge: repositoryKnowledgeBinding,
        evidence: {
          artifacts: [designArtifact],
          codingRuns: [],
          codingDiffs: [],
          testEvidence: [],
          agentReviews: [],
        },
      })

    await expect(
      createGateCommandProcessor(
        harness.dependencies as GateCommandProcessorDependencies,
      ).processAvailable(binding),
    ).resolves.toMatchObject({
      commandsSeen: 2,
      results: [
        {
          commandId: deliveringCommand.id,
          status: 'delivery_failed',
          outcomeCode: null,
        },
        {
          commandId: secondDeliveringCommand.id,
          receiptId: secondReceipt.id,
          status: 'acknowledged',
          outcomeCode: 'applied',
        },
      ],
    })
    expect(harness.commitGateCommandExecution).toHaveBeenCalledTimes(1)
    expect(harness.commitGateCommandExecution).toHaveBeenCalledWith(
      expect.objectContaining({ command: secondDeliveringCommand }),
    )
    expect(harness.recordGateCommandReceiptObservation).toHaveBeenCalledTimes(2)
    expect(harness.recordGateCommandReceiptObservation).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        command: deliveringCommand,
        receipt,
      }),
    )
    expect(harness.recordGateCommandReceiptObservation).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        command: secondDeliveringCommand,
        receipt: secondReceipt,
      }),
    )
    expect(harness.acknowledgeGateCommandReceipt).toHaveBeenCalledTimes(1)
  })

  it('does not acquire a receipt for another Work Request without an exact local materialization', async () => {
    const unrelatedInboxCommand: GateCommand = {
      ...pendingCommand,
      id: 'gate-command-unrelated',
      workRequestId: 'work-request-unrelated',
      runId: 'run-unrelated',
      idempotencyKey: 'gate-command:run-unrelated:v3',
      requestFingerprint: '9'.repeat(64),
    }
    const harness = createSingleCommandHarness({
      inboxCommand: unrelatedInboxCommand,
    })
    harness.dependencies.store.getWorkRequestMaterializationByWorkRequestId.mockResolvedValue(
      null,
    )
    harness.dependencies.store.getWorkRequestMaterializationByRunId.mockResolvedValue(
      null,
    )

    await expect(
      createGateCommandProcessor(
        harness.dependencies as GateCommandProcessorDependencies,
      ).processAvailable(binding),
    ).resolves.toMatchObject({
      commandsSeen: 1,
      results: [
        {
          commandId: unrelatedInboxCommand.id,
          receiptId: null,
          status: 'not_bound',
          outcomeCode: null,
        },
      ],
    })
    expect(
      harness.dependencies.remote.createGateCommandReceipt,
    ).not.toHaveBeenCalled()
    expect(harness.commitGateCommandExecution).not.toHaveBeenCalled()
  })

  it('terminalizes a deterministic ACK rejection and does not block the project inbox', async () => {
    const execution = localExecution({
      command: deliveringCommand,
      outcomeCode: 'applied',
      beforeRunVersion: 3,
      afterRunVersion: 4,
    })
    const pendingAcknowledgement = localAcknowledgement({
      receipt,
      commandId: deliveringCommand.id,
      outcomeCode: 'applied',
      beforeRunVersion: 3,
      afterRunVersion: 4,
    })
    const listGateCommandInbox = vi.fn(async () => [] as GateCommand[])
    const terminalizeGateCommandAcknowledgement = vi.fn(async () => ({
      terminalized: true as const,
      replayed: false,
    }))
    const dependencies = {
      remote: {
        listGateCommandInbox,
        createGateCommandReceipt: vi.fn(),
        acknowledgeGateCommandReceipt: vi.fn(async () => {
          throw new RemoteSyncHttpError({
            status: 403,
            code: 'forbidden',
            path:
              '/api/desktop/gate-command-receipts/:receiptId/acknowledgements',
            retryable: false,
          })
        }),
      },
      store: {
        recordGateCommandReceiptObservation:
          successfulReceiptObservationRecorder(),
        getRun: vi.fn(async () => run),
        listEvents: vi.fn(async () => []),
        getGateCommandExecution: vi.fn(async () => execution),
        getGateCommandAcknowledgement: vi.fn(async () => pendingAcknowledgement),
        listPendingGateCommandAcknowledgements: vi
          .fn()
          .mockResolvedValueOnce([pendingAcknowledgement])
          .mockResolvedValueOnce([]),
        getWorkRequestMaterializationByWorkRequestId: vi.fn(async () =>
          materialization,
        ),
        getWorkRequestMaterializationByRunId: vi.fn(async () => materialization),
        commitGateCommandExecution: vi.fn(),
        recordGateCommandAcknowledgement: vi.fn(),
        terminalizeGateCommandAcknowledgement,
      },
      evaluateLocalEnforcement: vi.fn(),
      now: vi.fn(() => '2026-08-01T02:01:32.000Z'),
    }

    await expect(
      createGateCommandProcessor(
        dependencies as GateCommandProcessorDependencies,
      ).processAvailable(binding),
    ).resolves.toEqual({
      pendingAcknowledgementsRetried: 1,
      commandsSeen: 0,
      results: [
        {
          commandId: deliveringCommand.id,
          receiptId: receipt.id,
          status: 'ack_terminal',
          outcomeCode: 'applied',
        },
      ],
    })
    expect(terminalizeGateCommandAcknowledgement).toHaveBeenCalledWith({
      receiptId: receipt.id,
      failureCode: 'forbidden',
      failedAt: '2026-08-01T02:01:32.000Z',
    })
    expect(listGateCommandInbox).toHaveBeenCalledWith(
      pairing.projectId,
      pairing,
    )
  })

  it('does not pull inbox while an ACK backlog remains beyond the bounded retry batch', async () => {
    const firstExecution = localExecution({
      command: deliveringCommand,
      outcomeCode: 'applied',
      beforeRunVersion: 3,
      afterRunVersion: 4,
    })
    const firstPending = localAcknowledgement({
      receipt,
      commandId: deliveringCommand.id,
      outcomeCode: 'applied',
      beforeRunVersion: 3,
      afterRunVersion: 4,
    })
    const secondCommand: GateCommand = {
      ...deliveringCommand,
      id: 'gate-command-backlog-2',
      idempotencyKey: 'gate-command:backlog-2',
      requestFingerprint: '8'.repeat(64),
    }
    const secondReceipt: GateCommandReceipt = {
      ...receipt,
      id: 'gate-receipt-backlog-2',
      commandId: secondCommand.id,
    }
    const secondExecution = localExecution({
      command: secondCommand,
      outcomeCode: 'applied',
      beforeRunVersion: 3,
      afterRunVersion: 4,
    })
    const secondPending = localAcknowledgement({
      receipt: secondReceipt,
      commandId: secondCommand.id,
      outcomeCode: 'applied',
      beforeRunVersion: 3,
      afterRunVersion: 4,
    })
    const listGateCommandInbox = vi.fn(async () => [] as GateCommand[])
    const dependencies = {
      remote: {
        listGateCommandInbox,
        createGateCommandReceipt: vi.fn(),
        acknowledgeGateCommandReceipt: vi.fn(
          async (
            receiptId: string,
            acknowledgementInput: {
              commandId: string
              outcomeCode: 'applied'
              beforeRunVersion: number
              afterRunVersion: number
              evaluatedAt: string
            },
          ) => ({
            acknowledgement: {
              id: `remote-${receiptId}`,
              receiptId,
              ...acknowledgementInput,
              createdAt: '2026-08-01T02:01:32.000Z',
            },
            replayed: false,
          }),
        ),
      },
      store: {
        recordGateCommandReceiptObservation:
          successfulReceiptObservationRecorder(),
        getRun: vi.fn(async () => run),
        listEvents: vi.fn(async () => []),
        getGateCommandExecution: vi.fn(async (commandId: string) =>
          commandId === firstExecution.commandId
            ? firstExecution
            : secondExecution,
        ),
        getGateCommandAcknowledgement: vi.fn(async () => null),
        listPendingGateCommandAcknowledgements: vi
          .fn()
          .mockResolvedValueOnce([firstPending, secondPending])
          .mockResolvedValueOnce([secondPending]),
        getWorkRequestMaterializationByWorkRequestId: vi.fn(async () =>
          materialization,
        ),
        getWorkRequestMaterializationByRunId: vi.fn(async () => materialization),
        commitGateCommandExecution: vi.fn(),
        recordGateCommandAcknowledgement: vi.fn(async () => ({
          recorded: true as const,
          replayed: false,
          acknowledgement: {
            ...firstPending,
            status: 'acknowledged' as const,
            remoteAcknowledgementId: 'remote-gate-receipt-1',
            remoteCreatedAt: '2026-08-01T02:01:32.000Z',
            remoteReplayed: false,
            acknowledgedAt: '2026-08-01T02:01:32.000Z',
          },
        })),
        terminalizeGateCommandAcknowledgement: vi.fn(),
      },
      evaluateLocalEnforcement: vi.fn(),
      now: vi.fn(() => '2026-08-01T02:01:32.000Z'),
      maxCommandsPerPoll: 1,
    } satisfies GateCommandProcessorDependencies

    await expect(
      createGateCommandProcessor(dependencies).processAvailable(binding),
    ).resolves.toMatchObject({
      pendingAcknowledgementsRetried: 1,
      commandsSeen: 0,
      results: [
        {
          commandId: firstPending.commandId,
          receiptId: firstPending.receiptId,
          status: 'acknowledged',
        },
      ],
    })
    expect(listGateCommandInbox).not.toHaveBeenCalled()
    expect(
      dependencies.remote.acknowledgeGateCommandReceipt,
    ).toHaveBeenCalledTimes(1)
  })

  it('preserves an old-project pending ACK without sending it or starving the newly paired project', async () => {
    const oldCommand: GateCommand = {
      ...deliveringCommand,
      id: 'gate-command-old-project',
      organizationId: 'org-old',
      projectId: 'team-project-old',
      workRequestId: 'work-request-old',
      runId: 'run-old',
      nodeId: 'gate-old',
      idempotencyKey: 'gate-command:run-old:v3',
      requestFingerprint: '8'.repeat(64),
    }
    const oldReceipt: GateCommandReceipt = {
      ...receipt,
      id: 'gate-receipt-old-project',
      commandId: oldCommand.id,
    }
    const oldExecution: LocalGateCommandExecution = {
      ...localExecution({
        command: oldCommand,
        outcomeCode: 'applied',
        beforeRunVersion: 3,
        afterRunVersion: 4,
      }),
      localProjectId: 'local-project-old',
    }
    const oldPending = localAcknowledgement({
      receipt: oldReceipt,
      commandId: oldCommand.id,
      outcomeCode: 'applied',
      beforeRunVersion: 3,
      afterRunVersion: 4,
    })
    const harness = createSingleCommandHarness({})
    harness.dependencies.store.listPendingGateCommandAcknowledgements.mockResolvedValue([
      oldPending,
    ])
    harness.dependencies.store.getGateCommandExecution.mockImplementation(
      async (commandId: string) =>
        commandId === oldCommand.id ? oldExecution : null,
    )

    await expect(
      createGateCommandProcessor(
        harness.dependencies as GateCommandProcessorDependencies,
      ).processAvailable(binding),
    ).resolves.toMatchObject({
      pendingAcknowledgementsRetried: 0,
      commandsSeen: 1,
      results: [
        {
          commandId: deliveringCommand.id,
          receiptId: receipt.id,
          status: 'acknowledged',
          outcomeCode: 'applied',
        },
      ],
    })
    expect(harness.acknowledgeGateCommandReceipt).toHaveBeenCalledTimes(1)
    expect(harness.acknowledgeGateCommandReceipt).toHaveBeenCalledWith(
      receipt.id,
      expect.anything(),
      pairing,
    )
    expect(harness.acknowledgeGateCommandReceipt).not.toHaveBeenCalledWith(
      oldReceipt.id,
      expect.anything(),
      expect.anything(),
    )
  })

  it('preserves a same-project ACK from an older claim token without sending or blocking', async () => {
    const priorCommand: GateCommand = {
      ...deliveringCommand,
      id: 'gate-command-prior-token',
      idempotencyKey: 'gate-command:run-1:v3:prior-token',
      requestFingerprint: '7'.repeat(64),
    }
    const priorReceipt: GateCommandReceipt = {
      ...receipt,
      id: 'gate-receipt-prior-token',
      commandId: priorCommand.id,
    }
    const priorExecution: LocalGateCommandExecution = {
      ...localExecution({
        command: priorCommand,
        outcomeCode: 'applied',
        beforeRunVersion: 3,
        afterRunVersion: 4,
      }),
      claimTokenId: 'desktop-token-prior',
    }
    const priorPending = localAcknowledgement({
      receipt: priorReceipt,
      commandId: priorCommand.id,
      outcomeCode: 'applied',
      beforeRunVersion: 3,
      afterRunVersion: 4,
    })
    const harness = createSingleCommandHarness({})
    harness.dependencies.store.listPendingGateCommandAcknowledgements.mockResolvedValue([
      priorPending,
    ])
    harness.dependencies.store.getGateCommandExecution.mockImplementation(
      async (commandId: string) =>
        commandId === priorCommand.id ? priorExecution : null,
    )

    await expect(
      createGateCommandProcessor(
        harness.dependencies as GateCommandProcessorDependencies,
      ).processAvailable(binding),
    ).resolves.toMatchObject({
      pendingAcknowledgementsRetried: 0,
      commandsSeen: 1,
      results: [
        {
          commandId: deliveringCommand.id,
          receiptId: receipt.id,
          status: 'acknowledged',
          outcomeCode: 'applied',
        },
      ],
    })
    expect(harness.acknowledgeGateCommandReceipt).toHaveBeenCalledTimes(1)
    expect(harness.acknowledgeGateCommandReceipt).not.toHaveBeenCalledWith(
      priorReceipt.id,
      expect.anything(),
      expect.anything(),
    )
  })

  it('filters foreign pending ACKs before applying the bounded retry limit', async () => {
    const foreignCommand: GateCommand = {
      ...deliveringCommand,
      id: 'gate-command-foreign-backlog',
      organizationId: 'org-foreign',
      projectId: 'team-project-foreign',
      idempotencyKey: 'gate-command:foreign-backlog:run-1:v3',
      requestFingerprint: '6'.repeat(64),
    }
    const foreignReceipt: GateCommandReceipt = {
      ...receipt,
      id: 'gate-receipt-foreign-backlog',
      commandId: foreignCommand.id,
    }
    const foreignExecution: LocalGateCommandExecution = {
      ...localExecution({
        command: foreignCommand,
        outcomeCode: 'applied',
        beforeRunVersion: 3,
        afterRunVersion: 4,
      }),
      localProjectId: 'local-project-foreign',
    }
    const foreignPending = localAcknowledgement({
      receipt: foreignReceipt,
      commandId: foreignCommand.id,
      outcomeCode: 'applied',
      beforeRunVersion: 3,
      afterRunVersion: 4,
    })
    const currentExecution = localExecution({
      command: deliveringCommand,
      outcomeCode: 'applied',
      beforeRunVersion: 3,
      afterRunVersion: 4,
    })
    const currentPending = localAcknowledgement({
      receipt,
      commandId: deliveringCommand.id,
      outcomeCode: 'applied',
      beforeRunVersion: 3,
      afterRunVersion: 4,
    })
    const harness = createSingleCommandHarness({})
    harness.dependencies.store.listPendingGateCommandAcknowledgements.mockResolvedValue(
      [foreignPending, currentPending],
    )
    harness.dependencies.store.getGateCommandExecution.mockImplementation(
      async (commandId: string) =>
        commandId === foreignCommand.id ? foreignExecution : currentExecution,
    )

    await expect(
      createGateCommandProcessor({
        ...(harness.dependencies as GateCommandProcessorDependencies),
        maxCommandsPerPoll: 1,
      }).retryPendingAcknowledgements(binding),
    ).resolves.toEqual([
      {
        commandId: deliveringCommand.id,
        receiptId: receipt.id,
        status: 'acknowledged',
        outcomeCode: 'applied',
      },
    ])
    expect(harness.acknowledgeGateCommandReceipt).toHaveBeenCalledTimes(1)
    expect(harness.acknowledgeGateCommandReceipt).toHaveBeenCalledWith(
      receipt.id,
      expect.anything(),
      pairing,
    )
  })

  it('resumes a preserved pending ACK after pairing returns to its exact claim token', async () => {
    const priorPairing: DesktopPairingCredential = {
      ...pairing,
      tokenId: 'desktop-token-prior',
    }
    const priorBinding: FrozenGateCommandBinding = {
      pairing: priorPairing,
      claimTokenId: priorPairing.tokenId,
      project: binding.project,
    }
    const priorExecution: LocalGateCommandExecution = {
      ...localExecution({
        command: deliveringCommand,
        outcomeCode: 'applied',
        beforeRunVersion: 3,
        afterRunVersion: 4,
      }),
      claimTokenId: priorPairing.tokenId,
    }
    const priorPending = localAcknowledgement({
      receipt,
      commandId: deliveringCommand.id,
      outcomeCode: 'applied',
      beforeRunVersion: 3,
      afterRunVersion: 4,
    })
    const harness = createSingleCommandHarness({})
    harness.dependencies.store.listPendingGateCommandAcknowledgements.mockResolvedValue(
      [priorPending],
    )
    harness.dependencies.store.getGateCommandExecution.mockResolvedValue(
      priorExecution,
    )

    await expect(
      createGateCommandProcessor(
        harness.dependencies as GateCommandProcessorDependencies,
      ).retryPendingAcknowledgements(priorBinding),
    ).resolves.toEqual([
      {
        commandId: deliveringCommand.id,
        receiptId: receipt.id,
        status: 'acknowledged',
        outcomeCode: 'applied',
      },
    ])
    expect(harness.acknowledgeGateCommandReceipt).toHaveBeenCalledWith(
      receipt.id,
      expect.anything(),
      priorPairing,
    )
  })

  it('maps an unavailable local policy snapshot to stale_policy even when version zero matches', async () => {
    const policyUnavailableReason = {
      id: 'policy-unavailable',
      target: 'missing_agent_review' as const,
      ruleKey: 'policy-unavailable',
      action: 'block' as const,
      summary: 'The policy cache is unavailable.',
    }
    const command: GateCommand = {
      ...deliveringCommand,
      expectedPolicyVersion: 0,
      expectedBlockerIds: [policyUnavailableReason.id],
    }
    const inboxCommand: GateCommand = {
      ...command,
      version: 1,
      status: 'pending',
      updatedAt: pendingCommand.updatedAt,
    }
    const harness = createSingleCommandHarness({
      inboxCommand,
      command,
      decision: {
        ...passingDecision(),
        status: 'blocked_policy_unavailable',
        blocksApproval: true,
        blockingReasons: [policyUnavailableReason],
        requiredActions: ['Sync the current Team policy.'],
        policySource: 'unavailable',
        policyVersion: 0,
      },
      policySnapshot: {
        ...policySnapshot,
        effectivePolicy: null,
        version: 0,
        source: 'unavailable',
      },
    })

    await expect(
      createGateCommandProcessor(
        harness.dependencies as GateCommandProcessorDependencies,
      ).processAvailable(binding),
    ).resolves.toMatchObject({
      results: [
        {
          status: 'acknowledged',
          outcomeCode: 'stale_policy',
        },
      ],
    })
    expect(harness.commitGateCommandExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        outcomeCode: 'stale_policy',
      }),
    )
    const commitInput = harness.commitGateCommandExecution.mock.calls[0]![0]
    expect(commitInput).not.toHaveProperty('expectedRun')
    expect(commitInput).not.toHaveProperty('run')
    expect(commitInput).not.toHaveProperty('event')
  })

  it('does not apply when local evaluation crosses the half-open receipt lease boundary', async () => {
    const harness = createSingleCommandHarness({})
    harness.dependencies.now
      .mockReset()
      .mockReturnValueOnce('2026-08-01T02:01:30.000Z')
      .mockReturnValueOnce(receipt.leaseExpiresAt)

    await expect(
      createGateCommandProcessor(
        harness.dependencies as GateCommandProcessorDependencies,
      ).processAvailable(binding),
    ).resolves.toMatchObject({
      results: [
        {
          commandId: deliveringCommand.id,
          receiptId: receipt.id,
          status: 'lease_expired',
          outcomeCode: null,
        },
      ],
    })
    expect(harness.evaluateLocalEnforcement).toHaveBeenCalledTimes(1)
    expect(harness.commitGateCommandExecution).not.toHaveBeenCalled()
    expect(harness.acknowledgeGateCommandReceipt).not.toHaveBeenCalled()
  })

  it('loads event sequencing before the final asynchronous enforcement evaluation', async () => {
    const harness = createSingleCommandHarness({})

    await createGateCommandProcessor(
      harness.dependencies as GateCommandProcessorDependencies,
    ).processAvailable(binding)

    expect(harness.listEvents).toHaveBeenCalledOnce()
    expect(harness.evaluateLocalEnforcement).toHaveBeenCalledOnce()
    expect(harness.listEvents.mock.invocationCallOrder[0]).toBeLessThan(
      harness.evaluateLocalEnforcement.mock.invocationCallOrder[0]!,
    )
    expect(
      harness.evaluateLocalEnforcement.mock.invocationCallOrder[0],
    ).toBeLessThan(
      harness.commitGateCommandExecution.mock.invocationCallOrder[0]!,
    )
  })

  it('fails closed when repository knowledge changes after local evaluation', async () => {
    const harness = createSingleCommandHarness({
      repositoryKnowledge: {
        ...repositoryKnowledgeBinding,
        observedFingerprint: `sha256:${'2'.repeat(64)}`,
      },
    })

    await createGateCommandProcessor(
      harness.dependencies as GateCommandProcessorDependencies,
    ).processAvailable(binding)

    expect(harness.commitGateCommandExecution).toHaveBeenCalledWith(
      expect.objectContaining({ outcomeCode: 'evidence_blocked' }),
    )
    const commitInput = harness.commitGateCommandExecution.mock.calls[0]![0]
    expect(commitInput).not.toHaveProperty('run')
    expect(commitInput).not.toHaveProperty('evaluationBinding')
  })

  it('maps the exact command expiry boundary to expired without changing the Run', async () => {
    const harness = createSingleCommandHarness({
      timestamp: deliveringCommand.expiresAt,
    })

    await expect(
      createGateCommandProcessor(
        harness.dependencies as GateCommandProcessorDependencies,
      ).processAvailable(binding),
    ).resolves.toMatchObject({
      results: [
        {
          status: 'acknowledged',
          outcomeCode: 'expired',
        },
      ],
    })
    expect(harness.evaluateLocalEnforcement).not.toHaveBeenCalled()
    const commitInput = harness.commitGateCommandExecution.mock.calls[0]![0]
    expect(commitInput.outcomeCode).toBe('expired')
    expect(commitInput).not.toHaveProperty('run')
    expect(commitInput).not.toHaveProperty('event')
  })

  it('keeps expired precedence when the authoritative command also escapes scope', async () => {
    const command: GateCommand = {
      ...deliveringCommand,
      projectId: 'team-project-other',
      requestFingerprint: '5'.repeat(64),
    }
    const harness = createSingleCommandHarness({
      command,
      timestamp: command.expiresAt,
    })

    await expect(
      createGateCommandProcessor(
        harness.dependencies as GateCommandProcessorDependencies,
      ).processAvailable(binding),
    ).resolves.toMatchObject({
      results: [
        {
          status: 'acknowledged',
          outcomeCode: 'expired',
        },
      ],
    })
    expect(harness.commitGateCommandExecution).toHaveBeenCalledWith(
      expect.objectContaining({ outcomeCode: 'expired' }),
    )
    expect(harness.evaluateLocalEnforcement).not.toHaveBeenCalled()
  })
})
