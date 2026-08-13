import type {
  CancelCoordinationSessionInput,
  CoordinationSessionSnapshot,
  ResumeCoordinationSessionInput,
  StartCoordinationPlanInput,
  StartCoordinationTaskInput,
} from './ipc-contract.js'
import type { AgentCoordinationRendererAccess } from './agent-coordination-renderer-access.js'
import type { BoundedAgentCoordinationPlan } from './agent-coordination-plan.js'
import type { SpecialistRuntimeCoordinator } from './specialist-runtime-coordinator.js'

type CoordinationCommandCoordinator = Pick<
  SpecialistRuntimeCoordinator,
  'resume' | 'start' | 'cancel'
>

export type AgentCoordinationCommands = {
  startPlan(input: StartCoordinationPlanInput): Promise<CoordinationSessionSnapshot>
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
  planner: BoundedAgentCoordinationPlan
}): AgentCoordinationCommands {
  async function revalidate(command: ResumeCoordinationSessionInput) {
    return input.access.get(selection(command))
  }

  return {
    async startPlan(command) {
      const result = await input.planner.start(command)
      return input.access.get({
        coordinationId: result.coordinationId,
        runId: command.runId,
        localProjectId: command.localProjectId,
      })
    },

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
