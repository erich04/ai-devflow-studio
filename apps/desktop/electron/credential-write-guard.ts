/** Reject duplicate writes while OS authorization is pending; never queue a stale intent. */
export function createCredentialWriteGuard() {
  const active = new Set<'provider' | 'team'>()
  return async function write<T>(category: 'provider' | 'team', operation: () => Promise<T>): Promise<T> {
    if (active.has(category)) throw new Error('已有配置操作正在进行，请先完成或取消系统授权，再重试。')
    active.add(category)
    try { return await operation() } finally { active.delete(category) }
  }
}
