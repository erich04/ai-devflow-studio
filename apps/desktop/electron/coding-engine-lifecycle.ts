export class CodingEngineStartupCleanupError extends AggregateError {
  constructor(errors: readonly unknown[]) {
    super(errors, 'coding engine startup failed and cleanup did not complete')
    this.name = 'CodingEngineStartupCleanupError'
  }
}

export class CodingEngineContinuationCleanupError extends AggregateError {
  constructor(errors: readonly unknown[]) {
    super(errors, 'coding engine continuation failed and cleanup did not complete')
    this.name = 'CodingEngineContinuationCleanupError'
  }
}

export class CodingEnginePermissionDiscoveryError extends Error {
  readonly code:
    | 'message_completed_without_permission'
    | 'permission_discovery_timed_out'

  constructor(
    code:
      | 'message_completed_without_permission'
      | 'permission_discovery_timed_out',
  ) {
    super(
      code === 'message_completed_without_permission'
        ? 'opencode completed without requesting a managed permission'
        : 'opencode permission discovery timed out while the provider message was pending',
    )
    this.name = 'CodingEnginePermissionDiscoveryError'
    this.code = code
  }
}
