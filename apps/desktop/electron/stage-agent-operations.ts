import { StageAgentExecutionError } from '@ai-devflow/shared'

/** One explicit generation per Run; cancellation never accepts a late result. */
export class StageAgentOperations {
  private readonly active = new Map<string, { nodeId: string; controller: AbortController; committing: boolean }>()

  async run<T>(runId: string, nodeId: string, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.active.has(runId)) throw new Error('这个 Run 已有阶段生成正在进行，请先等待或取消。')
    const operation = { nodeId, controller: new AbortController(), committing: false }
    this.active.set(runId, operation)
    try { return await action(operation.controller.signal) }
    finally { if (this.active.get(runId) === operation) this.active.delete(runId) }
  }

  cancel(runId: string, nodeId: string): boolean {
    const operation = this.active.get(runId)
    if (!operation || operation.nodeId !== nodeId || operation.committing) return false
    operation.controller.abort(new StageAgentExecutionError('cancelled', '已取消阶段生成。'))
    return true
  }

  seal(runId: string, nodeId: string): void {
    const operation = this.active.get(runId)
    if (!operation || operation.nodeId !== nodeId) throw new Error('阶段生成已结束。')
    operation.controller.signal.throwIfAborted()
    operation.committing = true
  }
}
