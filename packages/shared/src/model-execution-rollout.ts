/** Startup deployment controls only. Readers and settlement never depend on these flags. */
export function modelExecutionRollout(env: Record<string, string | undefined> = typeof process === 'undefined' ? {} : process.env) {
  return {
    longContent: env.DEVFLOW_LONG_CONTENT_ENABLED !== '0',
    pendingBudget: env.DEVFLOW_BUDGET_PENDING_HOLDS_ENABLED !== '0',
    stepRecovery: env.DEVFLOW_STEP_RECOVERY_ENABLED !== '0',
  }
}
