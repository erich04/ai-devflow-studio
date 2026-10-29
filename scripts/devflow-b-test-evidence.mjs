// Interpret host-redacted TestEvidence without inventing an absolute execution directory.
export function inspectTestEvidence(test, { state, ready, source, worktrees }) {
  const node = state.run.nodes.find(row => row.id === test.nodeId)
  const workspaceId = test.sourceTree?.workspaceId
  const workspace = workspaceId ? state.workspaces.find(row => row.id === workspaceId) : undefined
  const coding = workspace ? state.codingRuns.find(row => row.id === workspace.codingRunId) : undefined
  const tree = workspaceId ? worktrees.find(row => row.id === workspaceId) : source
  const workflowOwned = test.runId === ready.runId && test.projectId === ready.projectId && !!node
  const workspaceOwnershipMatches = workspaceId ? !!(workflowOwned && workspace && coding && tree?.path &&
    workspace.projectId === ready.projectId && workspace.sourcePath === ready.repo &&
    workspace.worktreePath === tree.path && tree.codingRunId === coding.id &&
    coding.managedWorkspaceId === workspace.id && coding.projectId === ready.projectId && coding.runId === ready.runId) : null
  const sourceDigestMatchesDisk = typeof test.sourceTree?.digest === 'string' && tree?.sourceTreeDigest
    ? test.sourceTree.digest === tree.sourceTreeDigest : null
  const cwdRedacted = test.cwd === '<workspace>'
  const cwdMatchesDisk = !cwdRedacted && tree?.path ? test.cwd === tree.path : null
  const workspaceBindingVerified = workspaceOwnershipMatches === false || sourceDigestMatchesDisk === false || cwdMatchesDisk === false
    ? false : workspaceOwnershipMatches === true && sourceDigestMatchesDisk === true && (cwdRedacted || cwdMatchesDisk === true) ? true : null
  return {
    ...Object.fromEntries(['id', 'nodeId', 'status', 'exitCode', 'durationMs', 'sourceTree', 'cwd'].filter(key => test[key] !== undefined).map(key => [key, test[key]])),
    canonicalWorkflowTest: workflowOwned && node.kind === 'test',
    codingHostStandardTest: workspaceOwnershipMatches === true && coding.testEvidenceId === test.id && coding.nodeId === test.nodeId,
    cwdRepresentation: cwdRedacted ? 'redacted_workspace' : typeof test.cwd === 'string' ? 'literal' : 'missing',
    cwdMatchesDisk, workspaceOwnershipMatches, sourceDigestMatchesDisk, workspaceBindingVerified,
  }
}
