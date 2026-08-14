const RETRYABLE_BUILDKIT_TRANSPORT_FAILURE =
  'rpc error: code = Unavailable desc = error reading from server: EOF'

export function isRetryableDockerBuildInfrastructureFailure(error: unknown): boolean {
  return error instanceof Error && error.message.includes(RETRYABLE_BUILDKIT_TRANSPORT_FAILURE)
}

export async function runDockerComposeBuildWithInfrastructureRetry<T>({
  run,
  cleanup,
  reportRetry = console.warn,
}: {
  run: () => Promise<T>
  cleanup: () => Promise<void>
  reportRetry?: (message: string) => void
}): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (!isRetryableDockerBuildInfrastructureFailure(error)) {
      throw error
    }

    await cleanup()
    reportRetry('BuildKit transport became unavailable; cleaned the Compose project and retrying once.')
    return run()
  }
}
