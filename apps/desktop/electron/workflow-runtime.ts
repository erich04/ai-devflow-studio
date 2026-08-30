import {
  applyWorkflowCommand,
  type AgentEvent,
  type AgentTrace,
  type AgentTokenUsage,
  type Artifact,
  type BudgetGuardDecision,
  type DesktopPairingCredential,
  type GateEnforcementDecision,
  type GateOverrideDecision,
  type Role,
  type TestEvidence,
  type WorkflowApprovalEvidence,
  type WorkflowBlocker,
  type WorkflowCommand,
  type WorkflowNode,
  type WorkflowRun,
} from '@ai-devflow/shared'
import type { LocalStore } from './local-store.js'

export type WorkflowRuntimeCandidates = {
  artifacts?: readonly Artifact[]
  events?: readonly AgentEvent[]
  testEvidence?: readonly TestEvidence[]
  agentTraces?: readonly AgentTrace[]
  agentTokenUsage?: readonly AgentTokenUsage[]
}

export type ExecuteWorkflowCommandInput = {
  runId: string
  command: WorkflowCommand
  now: string
  expectedRunUpdatedAt?: string
  candidates?: WorkflowRuntimeCandidates
  approval?: WorkflowApprovalEvidence
  budgetDecision?: BudgetGuardDecision
}

export type WorkflowRuntimeBlocker =
  | WorkflowBlocker
  | {
      code: 'run_not_found' | 'stale_run'
      message: string
    }

export type WorkflowRuntimeResult =
  | {
      applied: true
      run: WorkflowRun
      blockers: []
      nextNode?: WorkflowNode
    }
  | {
      applied: false
      run: WorkflowRun | null
      blockers: WorkflowRuntimeBlocker[]
    }

export type WorkflowRuntimeStore = Pick<
  LocalStore,
  | 'getRun'
  | 'listArtifacts'
  | 'listCodingAgentRuns'
  | 'listCodingDiffArtifacts'
  | 'listTestEvidence'
  | 'listAgentReviews'
  | 'listGitHubDeliveryIntents'
  | 'commitWorkflowMutation'
>

export type WorkflowRuntime = {
  execute(input: ExecuteWorkflowCommandInput): Promise<WorkflowRuntimeResult>
}

export type TrustedWorkflowActor = {
  userId: string
  userName: string
  role: Role
}

export function resolveTrustedWorkflowActor(
  run: WorkflowRun,
  pairing: DesktopPairingCredential | null,
): TrustedWorkflowActor {
  if (pairing?.localProjectId === run.projectId) {
    return {
      userId: pairing.userId,
      userName: pairing.userId,
      role: pairing.role,
    }
  }

  return {
    userId: run.creatorId,
    userName: run.creatorId,
    role: 'owner',
  }
}

export function createTrustedGateOverrideDraft(input: {
  id: string
  run: WorkflowRun
  node: WorkflowNode
  actor: TrustedWorkflowActor
  reason: string
  decision: GateEnforcementDecision
  createdAt: string
}): GateOverrideDecision {
  return {
    id: input.id,
    runId: input.run.id,
    nodeId: input.node.id,
    projectId: input.run.projectId,
    userId: input.actor.userId,
    role: input.actor.role,
    reason: input.reason,
    blockedReasonIds: input.decision.blockingReasons.map((reason) => reason.id),
    policyVersion: input.decision.policyVersion,
    provisional: true,
    status: 'provisional',
    createdAt: input.createdAt,
  }
}

export function createWorkflowRuntime(store: WorkflowRuntimeStore): WorkflowRuntime {
  return {
    async execute(input) {
      const run = await store.getRun(input.runId)
      if (!run) {
        return rejected(null, 'run_not_found', `Workflow run not found: ${input.runId}`)
      }
      if (
        input.expectedRunUpdatedAt !== undefined &&
        input.expectedRunUpdatedAt !== run.updatedAt
      ) {
        return rejected(
          run,
          'stale_run',
          'The workflow run changed after the command was prepared',
        )
      }

      const candidates = input.candidates ?? {}
      if (!candidatesBelongToCommand(candidates, run, input.command)) {
        return {
          applied: false,
          run,
          blockers: [
            {
              code: 'evidence_scope_mismatch',
              message: 'Candidate evidence does not belong to the selected workflow run',
            },
          ],
        }
      }

      const [
        artifacts,
        codingRuns,
        codingDiffs,
        testEvidence,
        agentReviews,
        githubDeliveryIntents,
      ] =
        await Promise.all([
          store.listArtifacts(run.id),
          store.listCodingAgentRuns(run.id),
          store.listCodingDiffArtifacts(run.id),
          store.listTestEvidence(run.id),
          store.listAgentReviews(run.id),
          store.listGitHubDeliveryIntents(run.id),
        ])
      const result = applyWorkflowCommand({
        run,
        command: input.command,
        now: input.now,
        evidence: {
          artifacts: mergeById(artifacts, candidates.artifacts),
          codingRuns,
          codingDiffs,
          testEvidence: mergeById(testEvidence, candidates.testEvidence),
          agentReviews,
          githubDeliveryIntents,
          ...(input.approval ? { approval: input.approval } : {}),
          ...(input.budgetDecision
            ? { budgetDecision: input.budgetDecision }
            : {}),
        },
      })
      if (!result.applied) {
        return {
          applied: false,
          run,
          blockers: result.blockers,
        }
      }

      const committed = await store.commitWorkflowMutation({
        expectedRun: run,
        run: result.run,
        ...(candidates.artifacts
          ? { artifacts: candidates.artifacts }
          : {}),
        ...(candidates.events ? { events: candidates.events } : {}),
        ...(candidates.testEvidence
          ? { testEvidence: candidates.testEvidence }
          : {}),
        ...(candidates.agentTraces
          ? { agentTraces: candidates.agentTraces }
          : {}),
        ...(candidates.agentTokenUsage
          ? { agentTokenUsage: candidates.agentTokenUsage }
          : {}),
      })
      if (!committed.committed) {
        return rejected(
          await store.getRun(run.id),
          committed.reason,
          committed.reason === 'stale_run'
            ? 'The workflow run changed before the command could be committed'
            : `Workflow run not found: ${run.id}`,
        )
      }

      return {
        applied: true,
        run: result.run,
        blockers: [],
        ...(result.nextNode ? { nextNode: result.nextNode } : {}),
      }
    },
  }
}

function candidatesBelongToCommand(
  candidates: WorkflowRuntimeCandidates,
  run: WorkflowRun,
  command: WorkflowCommand,
): boolean {
  const nodeId = command.nodeId
  const allowedArtifactNodeIds = new Set([nodeId])
  if (command.type === 'approve_gate') {
    for (const edge of run.edges) {
      if (edge.target === nodeId && (edge.kind === 'normal' || edge.kind === 'gate')) {
        allowedArtifactNodeIds.add(edge.source)
      }
    }
  }
  return !(
    candidates.artifacts?.some(
      (artifact) => artifact.runId !== run.id || !allowedArtifactNodeIds.has(artifact.nodeId),
    ) ||
    candidates.events?.some(
      (event) =>
        event.runId !== run.id ||
        (event.nodeId !== undefined && event.nodeId !== nodeId),
    ) ||
    candidates.testEvidence?.some(
      (evidence) =>
        evidence.runId !== run.id ||
        evidence.projectId !== run.projectId ||
        evidence.nodeId !== nodeId,
    ) ||
    candidates.agentTraces?.some(
      (trace) => trace.runId !== run.id || trace.nodeId !== nodeId,
    ) ||
    candidates.agentTokenUsage?.some(
      (usage) => usage.runId !== run.id || usage.nodeId !== nodeId,
    )
  )
}

function mergeById<T extends { id: string }>(
  stored: readonly T[],
  candidates: readonly T[] | undefined,
): T[] {
  const merged = new Map(stored.map((item) => [item.id, item]))
  for (const candidate of candidates ?? []) {
    merged.set(candidate.id, candidate)
  }
  return [...merged.values()]
}

function rejected(
  run: WorkflowRun | null,
  code: 'run_not_found' | 'stale_run',
  message: string,
): WorkflowRuntimeResult {
  return {
    applied: false,
    run,
    blockers: [{ code, message }],
  }
}
