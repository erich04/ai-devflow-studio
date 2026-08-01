import { createHash } from 'node:crypto'
import {
  applyWorkflowCommand,
  assertCanonicalLocalNodeId,
  canApproveGateNow,
  type AgentEvent,
  type CreateGateCommandAcknowledgementInput,
  type DesktopPairingCredential,
  type GateCommand,
  type GateCommandAcknowledgement,
  type GateCommandOutcomeCode,
  type GateCommandReceipt,
  type GateEnforcementDecision,
  type GateOverrideDecision,
  type PolicySnapshot,
  type RemoteSyncFailureCode,
  type WorkflowEvidenceSnapshot,
  type WorkflowNode,
  type WorkflowRun,
} from '@ai-devflow/shared'
import type {
  CommitGateCommandExecutionInput,
  CommitGateCommandExecutionResult,
  GateCommandEvaluationBinding,
  LocalGateCommandAcknowledgement,
  LocalGateCommandExecution,
  RecordGateCommandReceiptObservationInput,
  RecordGateCommandReceiptObservationResult,
  RecordGateCommandAcknowledgementInput,
  RecordGateCommandAcknowledgementResult,
  WorkRequestMaterializationBinding,
  WorkRequestMaterializationExpectedPairing,
} from './local-store.js'
import { gateCommandExecutionFingerprint } from './local-store.js'
import { RemoteSyncHttpError } from './remote-sync.js'

export type FrozenGateCommandBinding = Readonly<{
  pairing: Readonly<DesktopPairingCredential>
  claimTokenId: string
  project: Readonly<{
    teamProjectId: string
    localProjectId: string
  }>
}>

export type GateCommandReceiptResult = {
  command: GateCommand
  receipt: GateCommandReceipt
  replayed: boolean
}

export type GateCommandAcknowledgementResult = {
  acknowledgement: GateCommandAcknowledgement
  replayed: boolean
}

export type GateCommandProcessorRemoteClient = {
  listGateCommandInbox(
    projectId: string,
    pairing: DesktopPairingCredential | null,
  ): Promise<GateCommand[]>
  createGateCommandReceipt(
    commandId: string,
    pairing: DesktopPairingCredential | null,
  ): Promise<GateCommandReceiptResult>
  acknowledgeGateCommandReceipt(
    receiptId: string,
    input: CreateGateCommandAcknowledgementInput,
    pairing: DesktopPairingCredential | null,
  ): Promise<GateCommandAcknowledgementResult>
}

export type GateCommandProcessorStore = {
  getRun(runId: string): Promise<WorkflowRun | null>
  listEvents(runId?: string): Promise<AgentEvent[]>
  recordGateCommandReceiptObservation(
    input: RecordGateCommandReceiptObservationInput,
  ): Promise<RecordGateCommandReceiptObservationResult>
  getGateCommandExecution(
    commandId: string,
  ): Promise<LocalGateCommandExecution | null>
  getGateCommandAcknowledgement(
    receiptId: string,
  ): Promise<LocalGateCommandAcknowledgement | null>
  listPendingGateCommandAcknowledgements(): Promise<
    LocalGateCommandAcknowledgement[]
  >
  getWorkRequestMaterializationByWorkRequestId(
    workRequestId: string,
  ): Promise<WorkRequestMaterializationBinding | null>
  getWorkRequestMaterializationByRunId(
    runId: string,
  ): Promise<WorkRequestMaterializationBinding | null>
  commitGateCommandExecution(
    input: CommitGateCommandExecutionInput,
  ): Promise<CommitGateCommandExecutionResult>
  recordGateCommandAcknowledgement(
    input: RecordGateCommandAcknowledgementInput,
  ): Promise<RecordGateCommandAcknowledgementResult>
  terminalizeGateCommandAcknowledgement(input: {
    receiptId: string
    failureCode: RemoteSyncFailureCode
    failedAt: string
  }): Promise<
    | { terminalized: true; replayed: boolean }
    | {
        terminalized: false
        reason: 'not_found' | 'conflict' | 'invalid_input'
      }
  >
}

export type LocalGateCommandEvaluation = {
  decision: GateEnforcementDecision
  policySnapshot: PolicySnapshot
  overrides: GateOverrideDecision[]
  evidence: WorkflowEvidenceSnapshot
  repositoryKnowledge: GateCommandEvaluationBinding['repositoryKnowledge']
}

export type GateCommandProcessorDependencies = {
  remote: GateCommandProcessorRemoteClient
  store: GateCommandProcessorStore
  evaluateLocalEnforcement(input: {
    command: GateCommand
    run: WorkflowRun
    node: WorkflowNode
  }): Promise<LocalGateCommandEvaluation>
  now?: () => string
  maxCommandsPerPoll?: number
}

export type GateCommandProcessResult = {
  commandId: string
  receiptId: string | null
  status:
    | 'acknowledged'
    | 'ack_pending'
    | 'ack_terminal'
    | 'lease_expired'
    | 'delivery_failed'
    | 'local_conflict'
    | 'not_bound'
  outcomeCode: GateCommandOutcomeCode | null
}

export type GateCommandProcessingSummary = {
  pendingAcknowledgementsRetried: number
  commandsSeen: number
  results: GateCommandProcessResult[]
}

export type GateCommandProcessor = {
  processAvailable(
    binding: FrozenGateCommandBinding,
  ): Promise<GateCommandProcessingSummary>
  retryPendingAcknowledgements(
    binding: FrozenGateCommandBinding,
  ): Promise<GateCommandProcessResult[]>
}

const DEFAULT_MAX_COMMANDS_PER_POLL = 25

function expectedPairing(
  binding: FrozenGateCommandBinding,
  materialization: WorkRequestMaterializationBinding,
): WorkRequestMaterializationExpectedPairing {
  return {
    tokenId: binding.claimTokenId,
    organizationId: binding.pairing.organizationId,
    projectId: binding.project.teamProjectId,
    localProjectId: materialization.localProjectId,
  }
}

function assertFrozenBinding(binding: FrozenGateCommandBinding): void {
  if (
    binding.claimTokenId !== binding.pairing.tokenId ||
    binding.project.teamProjectId !== binding.pairing.projectId ||
    binding.project.localProjectId !== binding.pairing.localProjectId
  ) {
    throw new Error('Gate Command processor binding is invalid.')
  }
}

function sameMaterializationBinding(
  left: WorkRequestMaterializationBinding,
  right: WorkRequestMaterializationBinding,
): boolean {
  return (
    left.workRequestId === right.workRequestId &&
    left.organizationId === right.organizationId &&
    left.teamProjectId === right.teamProjectId &&
    left.localProjectId === right.localProjectId &&
    left.runId === right.runId &&
    left.claimVersion === right.claimVersion &&
    left.sourceFingerprint === right.sourceFingerprint &&
    left.materializeIdempotencyKey === right.materializeIdempotencyKey &&
    left.status === right.status &&
    left.acknowledgedVersion === right.acknowledgedVersion &&
    left.createdAt === right.createdAt &&
    left.updatedAt === right.updatedAt &&
    left.acknowledgedAt === right.acknowledgedAt
  )
}

function sameCanonicalIds(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}

function canonicalUniqueIds(values: readonly string[]): string[] | null {
  const unique = new Set(values)
  return unique.size === values.length ? [...unique].sort() : null
}

function safeResult(input: {
  commandId: string
  receiptId?: string
  status: GateCommandProcessResult['status']
  outcomeCode?: GateCommandOutcomeCode
}): GateCommandProcessResult {
  return {
    commandId: input.commandId,
    receiptId: input.receiptId ?? null,
    status: input.status,
    outcomeCode: input.outcomeCode ?? null,
  }
}

function executionMatchesCommand(
  execution: LocalGateCommandExecution,
  command: GateCommand,
): boolean {
  return (
    execution.commandId === command.id &&
    execution.organizationId === command.organizationId &&
    execution.teamProjectId === command.projectId &&
    execution.workRequestId === command.workRequestId &&
    execution.runId === command.runId &&
    execution.nodeId === command.nodeId &&
    execution.action === command.action &&
    execution.workflowCommand === command.workflowCommand &&
    execution.requestedByUserId === command.requestedByUserId &&
    execution.requestedRole === command.requestedRole &&
    execution.serverRequestFingerprint === command.requestFingerprint &&
    execution.expectedRunVersion === command.expectedRunVersion &&
    execution.expectedPolicyVersion === command.expectedPolicyVersion &&
    execution.commandExpiresAt === command.expiresAt &&
    execution.executionFingerprint === gateCommandExecutionFingerprint(command)
  )
}

function acknowledgementMatchesExecution(
  acknowledgement: LocalGateCommandAcknowledgement,
  execution: LocalGateCommandExecution,
): boolean {
  return (
    acknowledgement.commandId === execution.commandId &&
    acknowledgement.outcomeCode === execution.outcomeCode &&
    acknowledgement.beforeRunVersion === execution.beforeRunVersion &&
    acknowledgement.afterRunVersion === execution.afterRunVersion &&
    acknowledgement.evaluatedAt === execution.evaluatedAt
  )
}

function executionMatchesBinding(
  execution: LocalGateCommandExecution,
  binding: FrozenGateCommandBinding,
): boolean {
  return (
    execution.organizationId === binding.pairing.organizationId &&
    execution.teamProjectId === binding.project.teamProjectId &&
    execution.localProjectId === binding.project.localProjectId &&
    execution.claimTokenId === binding.claimTokenId
  )
}

function selectExactOverride(input: {
  command: GateCommand
  run: WorkflowRun
  node: WorkflowNode
  decision: GateEnforcementDecision
  blockerIds: readonly string[]
  overrides: readonly GateOverrideDecision[]
}): GateOverrideDecision | undefined {
  if (
    !input.decision.blocksApproval &&
    input.decision.status !== 'overridden'
  ) {
    return undefined
  }
  return input.overrides.find((candidate) => {
    const candidateBlockerIds = canonicalUniqueIds(candidate.blockedReasonIds)
    return (
      candidate.status === 'accepted' &&
      !candidate.provisional &&
      candidate.runId === input.run.id &&
      candidate.nodeId === input.node.id &&
      candidate.projectId === input.run.projectId &&
      candidate.userId === input.command.requestedByUserId &&
      candidate.role === 'lead' &&
      candidate.policyVersion === input.decision.policyVersion &&
      candidateBlockerIds !== null &&
      sameCanonicalIds(candidateBlockerIds, input.blockerIds) &&
      candidate.reason.trim().length > 0
    )
  })
}

function gateCommandEventId(commandId: string): string {
  const digest = createHash('sha256').update(commandId).digest('hex').slice(0, 32)
  return `event-gate-command-${digest}`
}

export function createGateCommandProcessor(
  dependencies: GateCommandProcessorDependencies,
): GateCommandProcessor {
  const now = dependencies.now ?? (() => new Date().toISOString())
  const maxCommands = Math.max(
    1,
    Math.floor(
      dependencies.maxCommandsPerPoll ?? DEFAULT_MAX_COMMANDS_PER_POLL,
    ),
  )

  async function acknowledge(
    binding: FrozenGateCommandBinding,
    acknowledgement: LocalGateCommandAcknowledgement,
  ): Promise<GateCommandProcessResult> {
    try {
      const remote = await dependencies.remote.acknowledgeGateCommandReceipt(
        acknowledgement.receiptId,
        {
          commandId: acknowledgement.commandId,
          outcomeCode: acknowledgement.outcomeCode,
          beforeRunVersion: acknowledgement.beforeRunVersion,
          afterRunVersion: acknowledgement.afterRunVersion,
          evaluatedAt: acknowledgement.evaluatedAt,
        },
        binding.pairing,
      )
      const recorded = await dependencies.store.recordGateCommandAcknowledgement({
        receiptId: acknowledgement.receiptId,
        acknowledgement: remote.acknowledgement,
        replayed: remote.replayed,
        acknowledgedAt: now(),
      })
      return safeResult({
        commandId: acknowledgement.commandId,
        receiptId: acknowledgement.receiptId,
        status: recorded.recorded ? 'acknowledged' : 'local_conflict',
        outcomeCode: acknowledgement.outcomeCode,
      })
    } catch (error) {
      if (error instanceof RemoteSyncHttpError && !error.retryable) {
        try {
          const terminalized =
            await dependencies.store.terminalizeGateCommandAcknowledgement({
              receiptId: acknowledgement.receiptId,
              failureCode: error.code,
              failedAt: now(),
            })
          return safeResult({
            commandId: acknowledgement.commandId,
            receiptId: acknowledgement.receiptId,
            status: terminalized.terminalized
              ? 'ack_terminal'
              : 'local_conflict',
            outcomeCode: acknowledgement.outcomeCode,
          })
        } catch {
          return safeResult({
            commandId: acknowledgement.commandId,
            receiptId: acknowledgement.receiptId,
            status: 'local_conflict',
            outcomeCode: acknowledgement.outcomeCode,
          })
        }
      }
      return safeResult({
        commandId: acknowledgement.commandId,
        receiptId: acknowledgement.receiptId,
        status: 'ack_pending',
        outcomeCode: acknowledgement.outcomeCode,
      })
    }
  }

  async function retryPendingAcknowledgements(
    binding: FrozenGateCommandBinding,
  ): Promise<GateCommandProcessResult[]> {
    assertFrozenBinding(binding)
    const pending = await dependencies.store.listPendingGateCommandAcknowledgements()
    const currentBindingPending: LocalGateCommandAcknowledgement[] = []
    for (const acknowledgement of pending) {
      const execution = await dependencies.store.getGateCommandExecution(
        acknowledgement.commandId,
      )
      if (execution && executionMatchesBinding(execution, binding)) {
        currentBindingPending.push(acknowledgement)
        if (currentBindingPending.length === maxCommands) break
      }
    }
    const results: GateCommandProcessResult[] = []
    for (const acknowledgement of currentBindingPending) {
      results.push(await acknowledge(binding, acknowledgement))
    }
    return results
  }

  async function processCommand(
    binding: FrozenGateCommandBinding,
    inboxCommand: GateCommand,
    materialization: WorkRequestMaterializationBinding,
  ): Promise<GateCommandProcessResult> {
    let delivery: GateCommandReceiptResult
    try {
      delivery = await dependencies.remote.createGateCommandReceipt(
        inboxCommand.id,
        binding.pairing,
      )
    } catch {
      return safeResult({
        commandId: inboxCommand.id,
        status: 'delivery_failed',
      })
    }

    const command = delivery.command
    const receipt = delivery.receipt
    try {
      assertCanonicalLocalNodeId(command.runId, command.nodeId)
    } catch {
      return safeResult({
        commandId: command.id,
        receiptId: receipt.id,
        status: 'local_conflict',
      })
    }
    let timestamp = now()
    if (
      command.id !== inboxCommand.id ||
      receipt.commandId !== command.id ||
      receipt.acknowledgedAt !== null ||
      Date.parse(timestamp) < Date.parse(receipt.leasedAt)
    ) {
      return safeResult({
        commandId: command.id,
        receiptId: receipt.id,
        status: 'local_conflict',
      })
    }
    if (
      Date.parse(timestamp) >= Date.parse(receipt.leaseExpiresAt) &&
      Date.parse(timestamp) < Date.parse(command.expiresAt)
    ) {
      return safeResult({
        commandId: command.id,
        receiptId: receipt.id,
        status: 'lease_expired',
      })
    }

    const materializationPairing = expectedPairing(binding, materialization)
    const scoped =
      command.organizationId === binding.pairing.organizationId &&
      command.projectId === binding.project.teamProjectId &&
      command.workRequestId === materialization.workRequestId &&
      command.runId === materialization.runId
    if (Date.parse(timestamp) >= Date.parse(command.expiresAt) || !scoped) {
      timestamp = now()
      let terminalOutcomeCode: GateCommandOutcomeCode
      if (Date.parse(timestamp) >= Date.parse(command.expiresAt)) {
        terminalOutcomeCode = 'expired'
      } else if (Date.parse(timestamp) >= Date.parse(receipt.leaseExpiresAt)) {
        return safeResult({
          commandId: command.id,
          receiptId: receipt.id,
          status: 'lease_expired',
        })
      } else {
        terminalOutcomeCode = 'scope_mismatch'
      }
      const commit = await dependencies.store.commitGateCommandExecution({
        command,
        receipt,
        expectedPairing: materializationPairing,
        outcomeCode: terminalOutcomeCode,
        evaluatedAt: timestamp,
      })
      return commit.committed
        ? acknowledge(binding, commit.acknowledgement)
        : safeResult({
            commandId: command.id,
            receiptId: receipt.id,
            status: 'local_conflict',
          })
    }

    const observation =
      await dependencies.store.recordGateCommandReceiptObservation({
        command,
        receipt,
        expectedPairing: materializationPairing,
        receivedAt: timestamp,
      })
    if (!observation.recorded) {
      return safeResult({
        commandId: command.id,
        receiptId: receipt.id,
        status: 'local_conflict',
      })
    }

    const existingExecution = await dependencies.store.getGateCommandExecution(
      command.id,
    )
    if (existingExecution) {
      if (
        !executionMatchesBinding(existingExecution, binding) ||
        !executionMatchesCommand(existingExecution, command)
      ) {
        return safeResult({
          commandId: command.id,
          receiptId: receipt.id,
          status: 'local_conflict',
        })
      }
      const replayCommit =
        await dependencies.store.commitGateCommandExecution({
          command,
          receipt,
          expectedPairing: materializationPairing,
          outcomeCode: existingExecution.outcomeCode,
          evaluatedAt: timestamp,
        })
      if (
        !replayCommit.committed ||
        !executionMatchesBinding(replayCommit.execution, binding) ||
        !executionMatchesCommand(replayCommit.execution, command) ||
        !acknowledgementMatchesExecution(
          replayCommit.acknowledgement,
          replayCommit.execution,
        )
      ) {
        return safeResult({
          commandId: command.id,
          receiptId: receipt.id,
          status: 'local_conflict',
        })
      }
      if (replayCommit.acknowledgement.status === 'pending') {
        return acknowledge(binding, replayCommit.acknowledgement)
      }
      if (replayCommit.acknowledgement.status === 'acknowledged') {
        return safeResult({
          commandId: command.id,
          receiptId: replayCommit.acknowledgement.receiptId,
          status: 'acknowledged',
          outcomeCode: replayCommit.acknowledgement.outcomeCode,
        })
      }
      return safeResult({
        commandId: command.id,
        receiptId: receipt.id,
        status: 'local_conflict',
      })
    }

    const localRun = await dependencies.store.getRun(command.runId)
    let outcomeCode: GateCommandOutcomeCode
    let plannedRun: WorkflowRun | undefined
    let approvalEvent: AgentEvent | undefined
    let evaluationBinding: GateCommandEvaluationBinding | undefined

    if (localRun && localRun.projectId !== binding.project.localProjectId) {
      outcomeCode = 'scope_mismatch'
    } else if (!localRun) {
      outcomeCode = 'run_not_found'
    } else if (localRun.version !== command.expectedRunVersion) {
      outcomeCode = 'stale_run'
    } else {
      const node = localRun.nodes.find((candidate) => candidate.id === command.nodeId)
      if (!node || localRun.currentNodeId !== node.id) {
        outcomeCode = 'evidence_blocked'
      } else {
        const events =
          command.action === 'approve'
            ? await dependencies.store.listEvents(localRun.id)
            : []
        const evaluation = await dependencies.evaluateLocalEnforcement({
          command,
          run: localRun,
          node,
        })
        const blockerIds = canonicalUniqueIds(
          evaluation.decision.blockingReasons.map((reason) => reason.id),
        )
        const policyIsStale =
          evaluation.policySnapshot.source !== 'remote_cache' ||
          evaluation.policySnapshot.effectivePolicy === null ||
          evaluation.policySnapshot.projectId !== command.projectId ||
          evaluation.policySnapshot.version !==
            evaluation.decision.policyVersion ||
          evaluation.policySnapshot.effectivePolicy?.version !==
            evaluation.decision.policyVersion ||
          evaluation.decision.policySource !== 'remote_cache' ||
          evaluation.decision.provisional
        if (
          policyIsStale ||
          evaluation.decision.policyVersion !== command.expectedPolicyVersion
        ) {
          outcomeCode = 'stale_policy'
        } else if (
          blockerIds === null ||
          !sameCanonicalIds(blockerIds, command.expectedBlockerIds)
        ) {
          outcomeCode = 'blockers_changed'
        } else if (command.action === 'reject') {
          outcomeCode =
            command.requestedRole === 'lead' || command.requestedRole === 'owner'
              ? 'human_rejected'
              : 'authorization_denied'
        } else {
          const expectedWorkflowCommand =
            node.kind === 'acceptance' ? 'approve_acceptance' : 'approve_gate'
          const override = selectExactOverride({
            command,
            run: localRun,
            node,
            decision: evaluation.decision,
            blockerIds,
            overrides: evaluation.overrides,
          })
          const approval = canApproveGateNow({
            userRole: command.requestedRole,
            userId: command.requestedByUserId,
            run: localRun,
            node,
            enforcement: evaluation.decision,
            ...(override ? { override } : {}),
          })
          const repositoryKnowledgeIsCurrent =
            evaluation.repositoryKnowledge.projectId === localRun.projectId &&
            evaluation.repositoryKnowledge.evaluatedFingerprint ===
              evaluation.repositoryKnowledge.observedFingerprint
          if (command.workflowCommand !== expectedWorkflowCommand) {
            outcomeCode = 'evidence_blocked'
          } else if (!repositoryKnowledgeIsCurrent) {
            outcomeCode = 'evidence_blocked'
          } else if (!approval.allowed) {
            outcomeCode =
              approval.reason === 'role_denied'
                ? 'authorization_denied'
                : 'evidence_blocked'
          } else {
            timestamp = now()
            if (Date.parse(timestamp) >= Date.parse(command.expiresAt)) {
              outcomeCode = 'expired'
            } else if (
              Date.parse(timestamp) >= Date.parse(receipt.leaseExpiresAt)
            ) {
              return safeResult({
                commandId: command.id,
                receiptId: receipt.id,
                status: 'lease_expired',
              })
            } else {
              const applied = applyWorkflowCommand({
                run: localRun,
                command: {
                  type: command.workflowCommand,
                  nodeId: command.nodeId,
                },
                now: timestamp,
                evidence: {
                  ...evaluation.evidence,
                  approval: {
                    roleAllowed: true,
                    policy: {
                      blocksApproval: false,
                    },
                    review:
                      node.kind === 'acceptance' ? 'required' : 'not_required',
                    budget:
                      node.kind === 'acceptance' ? 'required' : 'not_required',
                  },
                },
              })
              if (!applied.applied) {
                outcomeCode = applied.blockers.some(
                  (blocker) => blocker.code === 'authorization_denied',
                )
                  ? 'authorization_denied'
                  : 'evidence_blocked'
              } else {
                plannedRun = applied.run
                evaluationBinding = {
                  policySnapshot: evaluation.policySnapshot,
                  enforcement: evaluation.decision,
                  overrides: evaluation.overrides,
                  selectedOverrideId: override?.id ?? null,
                  evidence: {
                    artifacts: evaluation.evidence.artifacts,
                    codingRuns: evaluation.evidence.codingRuns,
                    codingDiffs: evaluation.evidence.codingDiffs,
                    testEvidence: evaluation.evidence.testEvidence,
                    agentReviews: evaluation.evidence.agentReviews,
                    ...(evaluation.evidence.budgetDecision
                      ? { budgetDecision: evaluation.evidence.budgetDecision }
                      : {}),
                  },
                  repositoryKnowledge: evaluation.repositoryKnowledge,
                }
                approvalEvent = {
                  id: gateCommandEventId(command.id),
                  runId: command.runId,
                  nodeId: command.nodeId,
                  sequence:
                    events.reduce(
                      (maximum, event) => Math.max(maximum, event.sequence),
                      0,
                    ) + 1,
                  kind: 'approval',
                  message:
                    'Remote Gate Command approved the current workflow node.',
                  timestamp,
                }
                outcomeCode = 'applied'
              }
            }
          }
        }
      }
    }

    if (!plannedRun) {
      timestamp = now()
      if (Date.parse(timestamp) >= Date.parse(command.expiresAt)) {
        outcomeCode = 'expired'
      } else if (
        Date.parse(timestamp) >= Date.parse(receipt.leaseExpiresAt)
      ) {
        return safeResult({
          commandId: command.id,
          receiptId: receipt.id,
          status: 'lease_expired',
        })
      }
    }

    const commit = await dependencies.store.commitGateCommandExecution({
      command,
      receipt,
      expectedPairing: materializationPairing,
      outcomeCode,
      evaluatedAt: timestamp,
      ...(plannedRun && approvalEvent && evaluationBinding && localRun
        ? {
            expectedRun: localRun,
            run: plannedRun,
            event: approvalEvent,
            evaluationBinding,
          }
        : {}),
    })
    return commit.committed
      ? acknowledge(binding, commit.acknowledgement)
      : safeResult({
          commandId: command.id,
          receiptId: receipt.id,
          status: 'local_conflict',
        })
  }

  return {
    retryPendingAcknowledgements,

    async processAvailable(binding) {
      assertFrozenBinding(binding)
      const pendingResults = await retryPendingAcknowledgements(binding)
      if (
        pendingResults.some((result) => result.status === 'ack_pending')
      ) {
        return {
          pendingAcknowledgementsRetried: pendingResults.length,
          commandsSeen: 0,
          results: pendingResults,
        }
      }
      const remainingPending =
        await dependencies.store.listPendingGateCommandAcknowledgements()
      let currentBindingBacklogRemains = false
      for (const acknowledgement of remainingPending) {
        const execution = await dependencies.store.getGateCommandExecution(
          acknowledgement.commandId,
        )
        if (execution && executionMatchesBinding(execution, binding)) {
          currentBindingBacklogRemains = true
          break
        }
      }
      if (currentBindingBacklogRemains) {
        return {
          pendingAcknowledgementsRetried: pendingResults.length,
          commandsSeen: 0,
          results: pendingResults,
        }
      }
      const inbox = await dependencies.remote.listGateCommandInbox(
        binding.project.teamProjectId,
        binding.pairing,
      )
      const commands = inbox.slice(0, maxCommands)
      const results: GateCommandProcessResult[] = [...pendingResults]
      for (const command of commands) {
        if (command.workRequestId === null) {
          results.push(
            safeResult({ commandId: command.id, status: 'not_bound' }),
          )
          continue
        }
        const [byWorkRequest, byRun] = await Promise.all([
          dependencies.store.getWorkRequestMaterializationByWorkRequestId(
            command.workRequestId,
          ),
          dependencies.store.getWorkRequestMaterializationByRunId(command.runId),
        ])
        if (
          !byWorkRequest ||
          !byRun ||
          !sameMaterializationBinding(byWorkRequest, byRun) ||
          byWorkRequest.organizationId !== binding.pairing.organizationId ||
          byWorkRequest.teamProjectId !== binding.project.teamProjectId ||
          byWorkRequest.localProjectId !== binding.project.localProjectId ||
          byWorkRequest.workRequestId !== command.workRequestId ||
          byWorkRequest.runId !== command.runId
        ) {
          results.push(
            safeResult({ commandId: command.id, status: 'not_bound' }),
          )
          continue
        }
        try {
          results.push(await processCommand(binding, command, byWorkRequest))
        } catch {
          results.push(
            safeResult({
              commandId: command.id,
              status: 'delivery_failed',
            }),
          )
        }
      }
      return {
        pendingAcknowledgementsRetried: pendingResults.length,
        commandsSeen: commands.length,
        results,
      }
    },
  }
}
