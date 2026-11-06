import type { GateEnforcementDecision } from '@ai-devflow/shared'
/**
 * Policy facts, derived once before any bar row (design §3.20, §5.3). Three states have no
 * decision and are kept apart: loading, failed to load, and seed preview data.
 */
export type GatePolicyFacts = {
  preview: boolean
  failed: boolean
  loading: boolean
  decided: boolean
  unavailable: boolean
  blocks: boolean
  reasons: GateEnforcementDecision['blockingReasons']
  missingReviewBlock: boolean
  otherBlock: boolean
  missingReviewWarning: boolean
  findingsBlock: boolean
  /** The only source of "（都是建议，可不处理）". */
  findingsMayBeLeft: boolean
  canOverride: boolean
}
export function derivePolicyFacts(input: {
  decision: GateEnforcementDecision | null | undefined
  isLoading: boolean
  loadError?: string | null | undefined
  enabled: boolean
}): GatePolicyFacts {
  const decision = input.decision ?? null
  const preview = !input.enabled                                       // seed preview data: no evaluation at all
  const failed = !preview && !input.isLoading && decision === null && Boolean(input.loadError)
  const loading = !preview && !failed && (input.isLoading || decision === null)
  const decided = !preview && !failed && !loading                     // a decision object exists
  const unavailable = decided && decision!.status === 'blocked_policy_unavailable'
  const blocks = decided && !unavailable && decision!.blocksApproval  // 'blocked' (overridable) and 'hard_blocked'
  const reasons = blocks ? decision!.blockingReasons : []
  const missingReviewBlock = reasons.some((r) => r.target === 'missing_agent_review' && r.id !== 'policy-unavailable')
  const otherBlock = reasons.some((r) => r.target !== 'missing_agent_review')
  const missingReviewWarning = decided && !unavailable && !blocks &&
    decision!.warningReasons.some((r) => r.target === 'missing_agent_review')
  const findingsBlock = reasons.some((r) => r.target === 'agent_finding')
  const findingsMayBeLeft = decided && !unavailable && !findingsBlock
  const canOverride = blocks && decision!.canOverride
  return { preview, failed, loading, decided, unavailable, blocks, reasons, missingReviewBlock, otherBlock, missingReviewWarning, findingsBlock, findingsMayBeLeft, canOverride }
}
