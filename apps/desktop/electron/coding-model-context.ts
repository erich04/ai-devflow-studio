/** A cached executor may serve many runs, but a model round must have one executing host guard. */
export function createCodingModelContext() {
  const active = new Map<symbol, (() => Promise<void>) | undefined>()
  return {
    async assertCurrent() {
      const guard = active.size === 1 ? active.values().next().value : undefined
      if (!guard) throw new Error('编码模型缺少唯一执行上下文，请重新运行。')
      await guard()
    },
    async run<T>(guard: (() => Promise<void>) | undefined, action: () => Promise<T>): Promise<T> {
      const key = Symbol('coding-operation')
      active.set(key, guard)
      try { return await action() } finally { active.delete(key) }
    },
  }
}
