import {
  createCoordinationRendererSnapshot,
  type CoordinationRendererSnapshot,
} from '@ai-devflow/shared'
import type {
  GetCoordinationSessionInput,
  ListCoordinationSessionsInput,
} from './ipc-contract.js'
import type { CoordinationRecoverySnapshot, LocalStore } from './local-store.js'

type AgentCoordinationRendererStore = Pick<
  LocalStore,
  'listCoordinationRecoverySnapshots' | 'getCoordinationRecoverySnapshot'
>

export type AgentCoordinationRendererAccess = {
  list(input: ListCoordinationSessionsInput): Promise<CoordinationRendererSnapshot[]>
  get(input: GetCoordinationSessionInput): Promise<CoordinationRendererSnapshot>
}

function matchesSelection(
  snapshot: CoordinationRecoverySnapshot,
  input: ListCoordinationSessionsInput,
): boolean {
  return snapshot.coordination.authority.runId === input.runId &&
    snapshot.coordination.scope.localProjectId === input.localProjectId
}

export function createAgentCoordinationRendererAccess(
  store: AgentCoordinationRendererStore,
): AgentCoordinationRendererAccess {
  return {
    async list(input) {
      return (await store.listCoordinationRecoverySnapshots())
        .filter((snapshot) => matchesSelection(snapshot, input))
        .sort((left, right) =>
          right.state.updatedAt.localeCompare(left.state.updatedAt) ||
          left.coordination.id.localeCompare(right.coordination.id),
        )
        .map(createCoordinationRendererSnapshot)
    },

    async get(input) {
      const snapshot = await store.getCoordinationRecoverySnapshot(input.coordinationId)
      if (snapshot === null) throw new Error('Agent Coordination was not found')
      if (!matchesSelection(snapshot, input)) {
        throw new Error('Agent Coordination renderer selection is stale')
      }
      return createCoordinationRendererSnapshot(snapshot)
    },
  }
}
