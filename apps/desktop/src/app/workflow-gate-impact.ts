import type { Artifact, WorkflowNode, WorkflowRun } from '@ai-devflow/shared'
import { displayNodeTitle } from './node-inspector-view-model'
import { buildWorkflowNodePresentation } from './workflow-node-presentation'

export type GateImpactArtifact = {
  id: string
  title: string
  kind: Artifact['kind']
}

export type WorkflowGateImpactViewModel =
  | {
      state: 'none'
      summary: string
    }
  | {
      state: 'found'
      gateId: string
      gateTitle: string
      gateStatus: WorkflowNode['status']
      gateStatusLabel: string
      isCurrentStep: boolean
      distance: number
      relationshipLabel: string
      providedArtifactCount: number
      linkedArtifacts: GateImpactArtifact[]
      unconsumedArtifactCount: number
    }

function isGateLikeNode(node: WorkflowNode): boolean {
  return node.kind === 'gate' || node.kind === 'acceptance'
}

function downstreamDistances(run: WorkflowRun, sourceNodeId: string): Map<string, number> {
  const outgoing = new Map<string, string[]>()
  for (const edge of run.edges ?? []) {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target])
  }

  const distances = new Map<string, number>([[sourceNodeId, 0]])
  const queue = [sourceNodeId]
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const currentId = queue[cursor]!
    const nextDistance = (distances.get(currentId) ?? 0) + 1
    for (const targetId of outgoing.get(currentId) ?? []) {
      const knownDistance = distances.get(targetId)
      if (knownDistance !== undefined && knownDistance <= nextDistance) {
        continue
      }
      distances.set(targetId, nextDistance)
      queue.push(targetId)
    }
  }
  distances.delete(sourceNodeId)
  return distances
}

export function buildWorkflowGateImpact(input: {
  run: WorkflowRun
  node: WorkflowNode
  artifacts: Artifact[]
}): WorkflowGateImpactViewModel {
  const nodeOrder = new Map(input.run.nodes.map((node, index) => [node.id, index]))
  const distances = downstreamDistances(input.run, input.node.id)
  const gate = input.run.nodes
    .filter((node) => isGateLikeNode(node) && distances.has(node.id))
    .sort((left, right) =>
      (distances.get(left.id) ?? Number.POSITIVE_INFINITY) -
        (distances.get(right.id) ?? Number.POSITIVE_INFINITY) ||
      (nodeOrder.get(left.id) ?? Number.POSITIVE_INFINITY) -
        (nodeOrder.get(right.id) ?? Number.POSITIVE_INFINITY),
    )[0]

  if (!gate) {
    return {
      state: 'none',
      summary: '当前节点不影响后续 Gate。',
    }
  }

  const sourceArtifactIds = new Set([
    ...(input.node.artifactIds ?? []),
    ...input.artifacts.filter((artifact) => artifact.nodeId === input.node.id).map((artifact) => artifact.id),
  ])
  const gateArtifactIds = new Set(gate.artifactIds ?? [])
  const linkedArtifactIds = [...sourceArtifactIds].filter((artifactId) => gateArtifactIds.has(artifactId))
  const artifactsById = new Map(input.artifacts.map((artifact) => [artifact.id, artifact]))
  const linkedArtifacts = linkedArtifactIds.map((artifactId): GateImpactArtifact => {
    const artifact = artifactsById.get(artifactId)
    return {
      id: artifactId,
      title: artifact?.title ?? artifactId,
      kind: artifact?.kind ?? 'raw_request',
    }
  })
  const distance = distances.get(gate.id)!
  const presentation = buildWorkflowNodePresentation(gate)

  return {
    state: 'found',
    gateId: gate.id,
    gateTitle: displayNodeTitle(gate),
    gateStatus: gate.status,
    gateStatusLabel: presentation.statusLabel,
    isCurrentStep: input.run.currentNodeId === gate.id,
    distance,
    relationshipLabel: distance === 1 ? '直接下游 Gate' : `最近下游 Gate · ${distance} 步`,
    providedArtifactCount: sourceArtifactIds.size,
    linkedArtifacts,
    unconsumedArtifactCount: Math.max(0, sourceArtifactIds.size - linkedArtifactIds.length),
  }
}
