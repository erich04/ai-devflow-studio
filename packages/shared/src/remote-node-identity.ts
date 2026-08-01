const RESERVED_TEAM_NODE_NAMESPACE_MESSAGE =
  'Local node ID uses the reserved Team node namespace.'
const REMOTE_NODE_IDENTIFIER_MAX_LENGTH = 200

function isCanonicalIdentifier(value: string): boolean {
  return (
    value.length >= 1 &&
    value.length <= REMOTE_NODE_IDENTIFIER_MAX_LENGTH &&
    value.trim() === value
  )
}

export function assertCanonicalLocalNodeId(
  runId: string,
  nodeId: string,
): void {
  if (!isCanonicalIdentifier(runId) || !isCanonicalIdentifier(nodeId)) {
    throw new Error('Invalid local Run or node ID.')
  }
  if (nodeId.startsWith(`${runId}:`)) {
    throw new Error(RESERVED_TEAM_NODE_NAMESPACE_MESSAGE)
  }
}

export function toTeamStoredNodeId(runId: string, nodeId: string): string {
  assertCanonicalLocalNodeId(runId, nodeId)
  return `${runId}:${nodeId}`
}

export function fromTeamStoredNodeId(
  runId: string,
  storedNodeId: string,
): string {
  const prefix = `${runId}:`
  if (!storedNodeId.startsWith(prefix)) {
    throw new Error('Stored Team node ID is outside the Run namespace.')
  }
  const localNodeId = storedNodeId.slice(prefix.length)
  if (!localNodeId || localNodeId.startsWith(prefix)) {
    throw new Error('Stored Team node ID is not canonical.')
  }
  return localNodeId
}
