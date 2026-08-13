import {
  createAgentRuntimeRendererListItem,
  createAgentRuntimeRendererSnapshot,
  type AgentRuntimeRendererListItem,
  type AgentRuntimeRendererSnapshot,
} from '@ai-devflow/shared'
import type { GetAgentRuntimeInput, ListAgentRuntimesInput } from './ipc-contract.js'
import type { LocalStore } from './local-store.js'

type AgentRuntimeRendererStore = Pick<
  LocalStore,
  | 'listAgentRuntimes'
  | 'getAgentRuntime'
  | 'listAgentRuntimeEvents'
  | 'getAgentRuntimeTerminalSummary'
>

export type AgentRuntimeRendererAccess = {
  list(input: ListAgentRuntimesInput): Promise<AgentRuntimeRendererListItem[]>
  get(input: GetAgentRuntimeInput): Promise<AgentRuntimeRendererSnapshot>
}

function matchesSelection(
  runtime: Awaited<ReturnType<LocalStore['getAgentRuntime']>>,
  input: ListAgentRuntimesInput,
): boolean {
  return Boolean(
    runtime &&
    runtime.authority.runId === input.runId &&
    runtime.scope.localProjectId === input.localProjectId,
  )
}

export function createAgentRuntimeRendererAccess(
  store: AgentRuntimeRendererStore,
): AgentRuntimeRendererAccess {
  return {
    async list(input) {
      const runtimes = (await store.listAgentRuntimes())
        .filter((runtime) => matchesSelection(runtime, input))
        .sort((left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id),
        )
      return Promise.all(runtimes.map(async (runtime) =>
        createAgentRuntimeRendererListItem({
          runtime,
          terminalSummary: await store.getAgentRuntimeTerminalSummary(runtime.id),
        })))
    },

    async get(input) {
      const runtime = await store.getAgentRuntime(input.runtimeId)
      if (!runtime) throw new Error('Agent Runtime was not found')
      if (!matchesSelection(runtime, input)) {
        throw new Error('Agent Runtime renderer selection is stale')
      }
      const [events, terminalSummary] = await Promise.all([
        store.listAgentRuntimeEvents(runtime.id),
        store.getAgentRuntimeTerminalSummary(runtime.id),
      ])
      return createAgentRuntimeRendererSnapshot({ runtime, events, terminalSummary })
    },
  }
}
