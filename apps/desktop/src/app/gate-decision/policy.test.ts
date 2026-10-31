import { describe, expect, it } from 'vitest'
import { policyDecision as decision, policyReason as reason } from '../../testing/gate-fixtures'
import { derivePolicyFacts } from './policy'
describe('derivePolicyFacts', () => {
  it('keeps loading, failed and preview apart, and none of them lets findings be left', () => {
    const loading = derivePolicyFacts({ decision: null, isLoading: true, enabled: true })
    expect(loading).toMatchObject({ loading: true, failed: false, preview: false, decided: false, findingsMayBeLeft: false })
    // Decision null without an error while not loading is still "loading" (no conclusion).
    expect(derivePolicyFacts({ decision: null, isLoading: false, enabled: true })).toMatchObject({ loading: true, failed: false })
    const failed = derivePolicyFacts({ decision: null, isLoading: false, loadError: 'IPC failed', enabled: true })
    expect(failed).toMatchObject({ failed: true, loading: false, decided: false, findingsMayBeLeft: false })
    const preview = derivePolicyFacts({ decision: decision(), isLoading: false, enabled: false })
    expect(preview).toMatchObject({ preview: true, failed: false, loading: false, decided: false, findingsMayBeLeft: false })
  })
  it('never reads the unavailable decision as a missing-review block', () => {
    const facts = derivePolicyFacts({ decision: decision({ status: 'blocked_policy_unavailable', blocksApproval: true,
      blockingReasons: [reason('missing_agent_review', 'policy-unavailable')] }), isLoading: false, enabled: true })
    expect(facts).toMatchObject({ unavailable: true, blocks: false, missingReviewBlock: false, otherBlock: false, findingsMayBeLeft: false })
  })
  it('counts overridable and hard blocks and separates their targets', () => {
    for (const status of ['blocked', 'hard_blocked'] as const) {
      const facts = derivePolicyFacts({ decision: decision({ status, blocksApproval: true, canOverride: status === 'blocked',
        blockingReasons: [reason('missing_agent_review'), reason('governance_check')] }), isLoading: false, enabled: true })
      expect(facts).toMatchObject({ blocks: true, missingReviewBlock: true, otherBlock: true, findingsBlock: false, findingsMayBeLeft: true, canOverride: status === 'blocked' })
    }
    const findings = derivePolicyFacts({ decision: decision({ status: 'blocked', blocksApproval: true, blockingReasons: [reason('agent_finding')] }), isLoading: false, enabled: true })
    expect(findings).toMatchObject({ findingsBlock: true, findingsMayBeLeft: false, otherBlock: true })
  })
  it('reads a warn-only missing review as a warning, never as a block', () => {
    const facts = derivePolicyFacts({ decision: decision({ status: 'warn', warningReasons: [reason('missing_agent_review')] }), isLoading: false, enabled: true })
    expect(facts).toMatchObject({ blocks: false, missingReviewBlock: false, missingReviewWarning: true, findingsMayBeLeft: true })
  })
})
