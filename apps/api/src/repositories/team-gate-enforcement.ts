import {
  buildKnowledgeGovernanceChecks,
  evaluateGateEnforcement,
  type GateEnforcementDecision,
  type GateOverrideDecision,
  type TeamSession,
  type TestEvidence,
  type WorkflowNode,
  type WorkflowRun,
} from '@ai-devflow/shared'
import { canAccessProject } from '../auth/session'
import type { TeamRepository } from './team-repository'

export type TeamGateEnforcementInput = {
  runId: string
  nodeId: string
  projectId: string
}

type TeamGateEnforcementRepository = Pick<
  TeamRepository,
  | 'getRunsBundle'
  | 'getTeamOverview'
  | 'getEnforcementPolicy'
  | 'listGateOverrides'
>

export type TeamGateEnforcementContext = {
  run: WorkflowRun
  node: WorkflowNode
  policyBundle: Awaited<
    ReturnType<TeamGateEnforcementRepository['getEnforcementPolicy']>
  >
  overrides: GateOverrideDecision[]
  decision: GateEnforcementDecision
}

function toTestEvidence(
  summary: Awaited<
    ReturnType<TeamGateEnforcementRepository['getTeamOverview']>
  >['testEvidenceSummaries'][number],
): TestEvidence {
  return {
    ...summary,
    cwd: '',
    stdout: '',
    stderr: '',
    redacted: true,
  }
}

export async function evaluateTeamGateEnforcement(
  repository: TeamGateEnforcementRepository,
  session: TeamSession,
  input: TeamGateEnforcementInput,
): Promise<TeamGateEnforcementContext> {
  if (!canAccessProject(session, input.projectId)) {
    throw new Error('Project access required')
  }

  // This evaluator also runs against one checked-out transaction client during
  // Gate Command preflight. Keep its reads sequential: node-postgres does not
  // support overlapping queries on a single client, and the snapshot must stay
  // inside that transaction.
  const bundle = await repository.getRunsBundle(session)
  const overview = await repository.getTeamOverview(session)
  const policyBundle = await repository.getEnforcementPolicy(
    input.projectId,
    session,
  )
  const storedOverrides = await repository.listGateOverrides(
    { runId: input.runId },
    session,
  )
  const storedRun = bundle.runs.find((candidate) => candidate.id === input.runId)
  if (
    !storedRun ||
    storedRun.projectId !== input.projectId ||
    !canAccessProject(session, storedRun.projectId)
  ) {
    throw new Error('Project access required')
  }

  const localNodeId = (nodeId: string) => {
    const remotePrefix = `${storedRun.id}:`
    return nodeId.startsWith(remotePrefix)
      ? nodeId.slice(remotePrefix.length)
      : nodeId
  }
  const run: WorkflowRun = {
    ...storedRun,
    currentNodeId: localNodeId(storedRun.currentNodeId),
    nodes: storedRun.nodes.map((candidate) => ({
      ...candidate,
      id: localNodeId(candidate.id),
    })),
    edges: storedRun.edges.map((edge) => ({
      ...edge,
      source: localNodeId(edge.source),
      target: localNodeId(edge.target),
    })),
  }

  const canonicalNodeId = localNodeId(input.nodeId)
  const node = run.nodes.find((candidate) => candidate.id === canonicalNodeId)
  if (!node) {
    throw new Error(`Run node not found: ${input.nodeId}`)
  }

  const governanceChecks = buildKnowledgeGovernanceChecks({
    run,
    node,
    artifacts: bundle.artifacts
      .filter((artifact) => artifact.runId === run.id)
      .map((artifact) => ({
        ...artifact,
        nodeId: localNodeId(artifact.nodeId),
      })),
    documents: [],
    chunks: [],
    testEvidence: overview.testEvidenceSummaries
      .filter((summary) => summary.runId === run.id)
      .map(toTestEvidence)
      .map((evidence) => ({
        ...evidence,
        nodeId: localNodeId(evidence.nodeId),
      })),
  })
  const agentReviews = overview.agentReviews
    .filter(
      (review) =>
        review.runId === run.id && localNodeId(review.nodeId) === node.id,
    )
    .map((review) => ({
      ...review,
      nodeId: localNodeId(review.nodeId),
      policyFindings: review.policyFindings.map((finding) => ({
        ...finding,
        nodeId: localNodeId(finding.nodeId),
      })),
    }))
  const latestAgentReview =
    agentReviews.sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    )[0] ?? null
  const agentPolicyFindings = agentReviews.flatMap(
    (review) => review.policyFindings,
  )
  const overrides = storedOverrides.map((override) => ({
    ...override,
    nodeId: localNodeId(override.nodeId),
  }))

  return {
    run,
    node,
    policyBundle,
    overrides,
    decision: evaluateGateEnforcement({
      run,
      node,
      effectivePolicy: policyBundle.effectivePolicy,
      governanceChecks,
      agentPolicyFindings,
      latestAgentReview,
      overrides,
      policySource: 'remote_cache',
    }),
  }
}
