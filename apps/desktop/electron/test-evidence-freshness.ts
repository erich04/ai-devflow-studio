import type { ManagedCodingWorkspace, TestEvidence, TestEvidenceFreshness } from '@ai-devflow/shared'
import { computeSourceTreeDigest, type SourceTreeDigest } from './source-tree-digest.js'

/**
 * Compares each recorded test tree with the tree it was taken from now (hardening H3, X6).
 * Read-only; a result without a fingerprint, or whose workspace is gone, is never called current.
 */
export async function evaluateTestEvidenceFreshness(input: {
  evidence: readonly TestEvidence[]
  projectId: string
  projectPath: string
  workspaces: readonly ManagedCodingWorkspace[]
  digest?: (cwd: string) => Promise<SourceTreeDigest | null>
}): Promise<TestEvidenceFreshness[]> {
  const digest = input.digest ?? computeSourceTreeDigest
  const current = new Map<string, Promise<SourceTreeDigest | null>>()
  const digestOf = (cwd: string) => {
    if (!current.has(cwd)) current.set(cwd, digest(cwd))
    return current.get(cwd)!
  }
  return Promise.all(input.evidence.map(async (evidence): Promise<TestEvidenceFreshness> => {
    const recorded = evidence.sourceTree
    if (!recorded || evidence.projectId !== input.projectId) return { evidenceId: evidence.id, state: 'unrecorded' }
    let cwd = input.projectPath
    if (recorded.workspaceId) {
      const workspace = input.workspaces.find((candidate) => candidate.id === recorded.workspaceId)
      if (!workspace || workspace.projectId !== input.projectId || workspace.cleanupStatus !== 'active' || workspace.deletedAt) {
        return { evidenceId: evidence.id, state: 'unavailable' }
      }
      cwd = workspace.worktreePath
    }
    const now = await digestOf(cwd)
    if (!now) return { evidenceId: evidence.id, state: 'unavailable' }
    return { evidenceId: evidence.id, state: now.full === recorded.digest ? 'current' : 'stale' }
  }))
}
