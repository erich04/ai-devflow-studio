import { clarificationRevisionNumber, listClarificationRevisions } from './clarification'
import { resolveDesignGateMaterial } from './design-revision'
import type { Artifact, ClarificationRevisionStatus, WorkflowNode, WorkflowRun } from './domain'

export type RunMaterialVersions = {
  requirement?: { version: number; status: ClarificationRevisionStatus | 'legacy'; artifactId: string; updatedAt: string }
  design?: { version?: number; artifactId: string; updatedAt: string; gateStatus: WorkflowNode['status'] }
}

/**
 * Display numbers for a run's designs, derived from the recorded `designRevision.previous` chain.
 * v1 is the one design without lineage. With several roots, a fork, a cycle or a broken link the
 * affected designs get no number. Numbers are for display only; approval binds exact identities.
 */
export function numberDesignVersions(runId: string, artifacts: readonly Artifact[]): Map<string, number> {
  const designs = artifacts.filter((artifact) => artifact.runId === runId && artifact.kind === 'design')
  const numbers = new Map<string, number>()
  const roots = designs.filter((design) => !design.designRevision)
  if (roots.length !== 1) return numbers
  let current: Artifact | undefined = roots[0]!
  let version = 1
  while (current && !numbers.has(current.id)) {
    numbers.set(current.id, version)
    const parent: Artifact = current
    const children = designs.filter((design) =>
      design.designRevision?.previous.artifactId === parent.id &&
      design.designRevision.previous.updatedAt === parent.updatedAt,
    )
    current = children.length === 1 ? children[0] : undefined
    version += 1
  }
  return numbers
}

function latestDesign(runId: string, artifacts: readonly Artifact[]): Artifact | undefined {
  return artifacts
    .filter((artifact) => artifact.runId === runId && artifact.kind === 'design')
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))[0]
}

/** The current requirement and design versions of one run: ids, numbers and statuses only. */
export function summarizeRunMaterialVersions(run: WorkflowRun, artifacts: readonly Artifact[]): RunMaterialVersions {
  const summary: RunMaterialVersions = {}
  const requirement = listClarificationRevisions(run.id, artifacts).at(-1)
  if (requirement) {
    summary.requirement = {
      version: clarificationRevisionNumber(requirement),
      status: requirement.clarificationRevision?.status ?? 'legacy',
      artifactId: requirement.id,
      updatedAt: requirement.updatedAt,
    }
  }
  const gate = run.nodes.find((node) => node.kind === 'gate' && node.stage === 'design')
  if (gate) {
    const material = resolveDesignGateMaterial({ run, gateNode: gate, artifacts })
    const design = material.state === 'ready' ? material.artifact : latestDesign(run.id, artifacts)
    if (design) {
      const version = numberDesignVersions(run.id, artifacts).get(design.id)
      summary.design = {
        ...(version === undefined ? {} : { version }),
        artifactId: design.id,
        updatedAt: design.updatedAt,
        gateStatus: gate.status,
      }
    }
  }
  return summary
}
