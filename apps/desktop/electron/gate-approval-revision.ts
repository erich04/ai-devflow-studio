import {
  buildClarificationReviewBundle,
  type Artifact,
  type WorkflowNode,
  type WorkflowRun,
} from '@ai-devflow/shared'
import type { ClarificationRevisionIdentity } from './ipc-contract.js'

export const staleClarificationRevisionMessage =
  'Gate approval rejected: clarification revision is missing, stale, or no longer current'

/**
 * The trusted approval check for the clarification Gate: the approver must name the exact
 * revision (artifact, revision number and digest) that is still current. Returns that
 * revision or throws before anything is written (plan V3).
 */
export function requireCurrentClarificationRevision(input: {
  run: WorkflowRun
  gateNode: WorkflowNode
  artifacts: readonly Artifact[]
  expected: ClarificationRevisionIdentity | undefined
}): Artifact {
  const bundle = buildClarificationReviewBundle({ run: input.run, gateNode: input.gateNode, artifacts: input.artifacts })
  const expected = input.expected
  const metadata = bundle.activeRevision?.clarificationRevision
  if (
    bundle.state !== 'ready' || !bundle.activeRevision || !metadata || !expected ||
    expected.artifactId !== bundle.activeRevision.id ||
    expected.revision !== metadata.revision ||
    expected.revisionDigest !== metadata.revisionDigest
  ) {
    throw new Error(staleClarificationRevisionMessage)
  }
  return bundle.activeRevision
}
