export class CodingEngineStartupCleanupError extends AggregateError {
  constructor(errors: readonly unknown[]) {
    super(errors, 'coding engine startup failed and cleanup did not complete')
    this.name = 'CodingEngineStartupCleanupError'
  }
}
