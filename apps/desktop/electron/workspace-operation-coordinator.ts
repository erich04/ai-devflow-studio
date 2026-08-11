export type WorkspaceOperationCoordinator = {
  runExclusive<T>(workspaceId: string, operation: () => Promise<T>): Promise<T>
}

export function createWorkspaceOperationCoordinator(): WorkspaceOperationCoordinator {
  const tails = new Map<string, Promise<void>>()

  return {
    async runExclusive<T>(workspaceId: string, operation: () => Promise<T>): Promise<T> {
      const previous = tails.get(workspaceId) ?? Promise.resolve()
      let release!: () => void
      const current = new Promise<void>((resolve) => {
        release = resolve
      })
      const tail = previous.catch(() => undefined).then(() => current)
      tails.set(workspaceId, tail)

      await previous.catch(() => undefined)
      try {
        return await operation()
      } finally {
        release()
        void tail.finally(() => {
          if (tails.get(workspaceId) === tail) {
            tails.delete(workspaceId)
          }
        })
      }
    },
  }
}
