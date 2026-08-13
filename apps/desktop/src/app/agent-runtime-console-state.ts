import {
  parseAgentRuntimeRendererListItem,
  parseAgentRuntimeRendererSnapshot,
  type AgentRuntimeRendererListItem,
  type AgentRuntimeRendererSnapshot,
} from '@ai-devflow/shared'

export type AgentRuntimeConsoleSelection = {
  runId: string
  localProjectId: string
}

export type AgentRuntimeConsoleState = {
  selection: AgentRuntimeConsoleSelection
  items: AgentRuntimeRendererListItem[]
  selectedRuntimeId: string | null
  detail: AgentRuntimeRendererSnapshot | null
}

export type AgentRuntimeConsoleMergeResult = {
  state: AgentRuntimeConsoleState
  accepted: boolean
  reason: 'accepted' | 'out_of_scope' | 'out_of_order' | 'duplicate'
}

function matchesSelection(
  runtime: AgentRuntimeRendererListItem['runtime'],
  selection: AgentRuntimeConsoleSelection,
): boolean {
  return (
    runtime.runId === selection.runId &&
    runtime.localProjectId === selection.localProjectId
  )
}

function listItemFromSnapshot(
  snapshot: AgentRuntimeRendererSnapshot,
): AgentRuntimeRendererListItem {
  return {
    projectionVersion: snapshot.projectionVersion,
    runtime: snapshot.runtime,
    terminalSummary: snapshot.terminalSummary,
    redacted: true,
  }
}

function sortItems(items: AgentRuntimeRendererListItem[]): AgentRuntimeRendererListItem[] {
  return [...items].sort((left, right) =>
    right.runtime.updatedAt.localeCompare(left.runtime.updatedAt) ||
    left.runtime.runtimeId.localeCompare(right.runtime.runtimeId),
  )
}

export function createAgentRuntimeConsoleState(input: {
  selection: AgentRuntimeConsoleSelection
  list: unknown[]
  detail: unknown | null
}): AgentRuntimeConsoleState {
  const items = input.list.map(parseAgentRuntimeRendererListItem)
  if (items.some((item) => !matchesSelection(item.runtime, input.selection))) {
    throw new Error('agent_runtime_console_selection_mismatch')
  }
  const detail = input.detail === null
    ? null
    : parseAgentRuntimeRendererSnapshot(input.detail)
  if (detail && !matchesSelection(detail.runtime, input.selection)) {
    throw new Error('agent_runtime_console_selection_mismatch')
  }
  const sorted = sortItems(items)
  const selectedRuntimeId = detail?.runtime.runtimeId ?? sorted[0]?.runtime.runtimeId ?? null
  return {
    selection: { ...input.selection },
    items: sorted,
    selectedRuntimeId,
    detail,
  }
}

export function mergeAgentRuntimeConsoleSnapshot(input: {
  state: AgentRuntimeConsoleState
  snapshot: unknown
}): AgentRuntimeConsoleMergeResult {
  const snapshot = parseAgentRuntimeRendererSnapshot(input.snapshot)
  if (!matchesSelection(snapshot.runtime, input.state.selection)) {
    return { state: input.state, accepted: false, reason: 'out_of_scope' }
  }
  const current = input.state.items.find(
    (item) => item.runtime.runtimeId === snapshot.runtime.runtimeId,
  )
  if (current && snapshot.runtime.version < current.runtime.version) {
    return { state: input.state, accepted: false, reason: 'out_of_order' }
  }
  if (current && snapshot.runtime.version === current.runtime.version) {
    const currentSnapshot = input.state.detail?.runtime.runtimeId === snapshot.runtime.runtimeId
      ? input.state.detail
      : null
    if (currentSnapshot === null && input.state.selectedRuntimeId === snapshot.runtime.runtimeId) {
      return {
        state: { ...input.state, detail: snapshot },
        accepted: true,
        reason: 'accepted',
      }
    }
    if (currentSnapshot && JSON.stringify(currentSnapshot) !== JSON.stringify(snapshot)) {
      throw new Error('agent_runtime_projection_conflict')
    }
    return { state: input.state, accepted: false, reason: 'duplicate' }
  }
  const item = listItemFromSnapshot(snapshot)
  const items = sortItems([
    ...input.state.items.filter(
      (candidate) => candidate.runtime.runtimeId !== snapshot.runtime.runtimeId,
    ),
    item,
  ])
  return {
    state: {
      ...input.state,
      items,
      selectedRuntimeId: input.state.selectedRuntimeId ?? snapshot.runtime.runtimeId,
      detail: input.state.selectedRuntimeId === snapshot.runtime.runtimeId ||
        input.state.selectedRuntimeId === null
        ? snapshot
        : input.state.detail,
    },
    accepted: true,
    reason: 'accepted',
  }
}
