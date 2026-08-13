import type {
  CancelCoordinationSessionInput,
  CoordinationSessionSnapshot,
  ResumeCoordinationSessionInput,
  StartCoordinationTaskInput,
} from './ipc-contract.js'
import type { AgentCoordinationRendererAccess } from './agent-coordination-renderer-access.js'
import type { SpecialistRuntimeCoordinator } from './specialist-runtime-coordinator.js'

type CoordinationCommandCoordinator = Pick<
  SpecialistRuntimeCoordinator,
  'resume' | 'start' | 'cancel'
>

export type AgentCoordinationCommands = {
  resume(input: ResumeCoordinationSessionInput): Promise<CoordinationSessionSnapshot>
  startTask(input: StartCoordinationTaskInput): Promise<CoordinationSessionSnapshot>
  cancel(input: CancelCoordinationSessionInput): Promise<CoordinationSessionSnapshot>
}

function selection(input: ResumeCoordinationSessionInput) {
  return {
    coordinationId: input.coordinationId,
    runId: input.runId,
    localProjectId: input.localProjectId,
  }
}

export function createAgentCoordinationCommands(input: {
  access: Pick<AgentCoordinationRendererAccess, 'get'>
  coordinator: CoordinationCommandCoordinator
}): AgentCoordinationCommands {
  async function revalidate(command: ResumeCoordinationSessionInput) {
    return input.access.get(selection(command))
  }

  return {
    async resume(command) {
      await revalidate(command)
      await input.coordinator.resume({
        coordinationId: command.coordinationId,
        expectedSessionVersion: command.expectedSessionVersion,
      })
      return revalidate(command)
    },

    async startTask(command) {
      await revalidate(command)
      await input.coordinator.start({
        coordinationId: command.coordinationId,
        expectedSessionVersion: command.expectedSessionVersion,
        taskId: command.taskId,
        expectedTaskVersion: command.expectedTaskVersion,
      })
      return revalidate(command)
    },

    async cancel(command) {
      await revalidate(command)
      await input.coordinator.cancel({
        coordinationId: command.coordinationId,
        expectedSessionVersion: command.expectedSessionVersion,
      })
      return revalidate(command)
    },
  }
}
