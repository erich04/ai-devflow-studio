export type OpencodeProcessStopper = {
  stopAll(): Promise<void>
}

export async function stopOpencodeWithRetry(
  processManager: OpencodeProcessStopper,
): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await processManager.stopAll()
      return
    } catch (error) {
      lastError = error
    }
  }

  throw new Error('opencode process cleanup failed after retry', {
    cause: lastError,
  })
}
