import { StageAgentExecutionError } from '@ai-devflow/shared'

/** One explicit generation per Run; cancellation never accepts a late result. */
export class StageAgentOperations {
  private readonly active = new Map<string, { nodeId: string; controller: AbortController; committing: boolean; done: Promise<void> }>()

  async run<T>(runId: string, nodeId: string, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.active.has(runId)) throw new Error('这个 Run 已有阶段生成正在进行，请先等待或取消。')
    let finish!:()=>void
    const done=new Promise<void>((resolve)=>{finish=resolve})
    const operation = { done, nodeId, controller: new AbortController(), committing: false }
    this.active.set(runId, operation)
    try { return await action(operation.controller.signal) }
    finally { finish(); if (this.active.get(runId) === operation) this.active.delete(runId) }
  }

  cancel(runId: string, nodeId: string): boolean {
    const operation = this.active.get(runId)
    if (!operation || operation.nodeId !== nodeId || operation.committing) return false
    operation.controller.abort(new StageAgentExecutionError('cancelled', '已取消阶段生成。'))
    return true
  }

  async drain():Promise<void> { await Promise.all([...this.active.values()].map((operation)=>operation.done)) }

  cancelAll(): void {
    for (const [runId, operation] of this.active) this.cancel(runId, operation.nodeId)
  }

  seal(runId: string, nodeId: string): void {
    const operation = this.active.get(runId)
    if (!operation || operation.nodeId !== nodeId) throw new Error('阶段生成已结束。')
    operation.controller.signal.throwIfAborted()
    operation.committing = true
  }
}
