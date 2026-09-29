import type { LocalProject, WorkflowRun } from '@ai-devflow/shared'
import { displayNodeTitle } from './node-inspector-view-model'

export type TestRunReadiness = {
  /** Empty when the saved command can run at the task's actual test step. */
  blockedReason: string
  /** True when the only thing missing is a saved test command (offer “设置测试命令”). */
  needsCommand: boolean
  savedCommand: string
}

/**
 * Whether the task's test step can run now. The same rule backs the task page (plan W4) and
 * the Tests page, so neither offers a run the other would refuse. Tests can only run at the
 * actual test step (plan X6); the reason is shown before the click, not after.
 */
export function buildTestRunReadiness(input: {
  project: Pick<LocalProject, 'testCommand'> | undefined
  run: WorkflowRun | undefined
}): TestRunReadiness {
  const savedCommand = input.project?.testCommand?.trim() ?? ''
  const actualNode = input.run?.nodes.find((node) => node.id === input.run?.currentNodeId)
  const canRunAtActualStep = Boolean(
    actualNode && actualNode.kind === 'test' && actualNode.stage === 'test' &&
      (actualNode.status === 'running' || actualNode.status === 'failed'),
  )
  const blockedReason = !input.project
    ? '先选择本地仓库，再配置或执行测试。'
    : !savedCommand
      ? '先保存当前项目的测试命令。'
      : !input.run
        ? '先选择一个任务。'
        : !canRunAtActualStep
          ? `任务进入测试步骤后才能执行；当前实际步骤：${actualNode ? displayNodeTitle(actualNode) : '无'}。`
          : ''
  return { blockedReason, needsCommand: Boolean(input.project) && !savedCommand, savedCommand }
}
