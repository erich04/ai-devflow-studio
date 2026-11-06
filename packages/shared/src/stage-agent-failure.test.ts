import { describe, expect, it } from 'vitest'
import { sanitizeStageAgentFailureDetails, stageAgentFailureDetails } from './stage-agent-failure'
import { StageAgentExecutionError } from './workflow-agent'

describe('persisted failure diagnostics', () => {
  it('accepts only bounded structured fields and locally authored hints', () => {
    const details = stageAgentFailureDetails('provider_auth', 'provider')
    const error = new StageAgentExecutionError('failed', 'Safe summary', undefined, undefined, {
      ...details, hint: 'PRIVATE_KEY /private/path RAW_BODY', httpStatus: -1,
      relayRequestId: 'PRIVATE_KEY', cleanupFailures: ['process_stop', 'process_stop', 'secret' as never],
      rawResponse: 'PRIVATE_PROMPT',
    } as typeof details)
    expect(error.failureDetails).toEqual({ ...details, cleanupFailures: ['process_stop'] })
    expect(JSON.stringify(error)).not.toMatch(/PRIVATE_|RAW_BODY|rawResponse|\/private/)
  })
  it('describes a changed revision input with its own hint', () => {
    expect(stageAgentFailureDetails('revision_input_changed', 'stage_validation')).toEqual({
      version: 1, code: 'revision_input_changed', source: 'stage_validation',
      hint: '修订请求引用的答疑提案已变化，未生成新版本。请到「材料与版本」核对提案。',
    })
    expect(sanitizeStageAgentFailureDetails({ version: 1, code: 'revision_input_changed', source: 'stage_validation', hint: 'other' })?.hint)
      .toBe('修订请求引用的答疑提案已变化，未生成新版本。请到「材料与版本」核对提案。')
  })
  it('keeps old traces and unknown future versions loadable without trusting their text', () => {
    for (const value of [undefined, {}, { version: 2, code: 'budget_denied', hint: 'secret' }, { version: 1, code: '__proto__', source: 'provider' }]) {
      expect(sanitizeStageAgentFailureDetails(value)).toBeUndefined()
    }
  })
})
