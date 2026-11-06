import { describe, expect, it } from 'vitest'
import { stageAgentFailureDetails } from '@ai-devflow/shared'
import { describeApprovalError, describeGenerationFailure, describeRevisionRequestError } from './errors'
// Raw codes such as clarification_revision_stale or revision_input_changed never reach `text` (AC31).
const rawCode = /[a-z]+_[a-z_]+|Error:|Gate approval rejected/u
describe('write result copy', () => {
  it('maps revision request rejections to Chinese and keeps the raw text in technical', () => {
    const cases: Array<[string, string]> = [
      ['Clarification revision changed after the review was prepared', '需求版本已变化，修订请求没有提交。修订清单保留在需求 v1 上；请阅读当前版本后重新决定。'],
      ['Clarification revision feedback was already submitted', '需求 v1 的修订请求已经提交过，这次没有重复提交。修订清单保留。'],
      ['Clarification revision feedback must be between 1 and 4000 characters', '修订内容超过 4000 字，修订请求没有提交。请精简后再提交。'],
      ['Request changes is only available on the current requirement Gate', '这一步已不是当前的需求确认，修订请求没有提交。修订清单保留。'],
      ['Legacy clarification must be regenerated before requesting a tracked revision', '旧版需求没有版本记录，不能提交修订；需要时请重新生成需求。'],
      ['所选提案已变化，请刷新后重新选择。', '修订清单里的答疑提案已变化，修订请求没有提交。请检查来自答疑的项后重试。'],
      ['stale_run: version mismatch', '需求版本已变化，修订请求没有提交。修订清单保留在需求 v1 上；请阅读当前版本后重新决定。'],
      ['socket hang up', '修订请求没有提交，修订清单保留。请稍后重试。'],
    ]
    for (const [message, text] of cases) {
      const result = describeRevisionRequestError(new Error(message), 1)
      expect(result).toEqual({ text, technical: message })
      expect(result.text).not.toMatch(rawCode)
    }
  })
  it('maps approval rejections', () => {
    expect(describeApprovalError(new Error('Gate approval rejected: clarification_revision_stale The requirement review does not target the current clarification revision'), { kind: 'requirement', version: 2 }).text)
      .toBe('需要先审查需求 v2，确认没有提交。修订清单仍保留。')
    expect(describeApprovalError(new Error('Requested clarification revision is missing, stale, or no longer current'), { kind: 'requirement', version: 2 }).text)
      .toBe('需求版本已变化，本次确认没有提交。修订清单保留；请阅读当前待确认的版本后再确认。')
    expect(describeApprovalError(new Error('Requested design material is missing, changed, or no longer current'), { kind: 'design', version: 1 }).text)
      .toBe('方案内容已变化，本次确认没有提交。请阅读最新方案后再确认。')
    expect(describeApprovalError(new Error('Gate approval rejected: policy_blocked'), { kind: 'design', version: 1 }).text).toBe('审批条件没有满足，本次确认没有提交。修订清单仍保留。')
    for (const message of ['x_y failed', 'Gate approval rejected: role_not_allowed', 'boom']) {
      expect(describeApprovalError(new Error(message), { kind: 'requirement', version: 1 }).text).not.toMatch(rawCode)
    }
  })
  it('describes failed generations without codes', () => {
    const failure = describeGenerationFailure({ kind: 'requirement', version: 1, details: stageAgentFailureDetails('timeout', 'stage_validation') })
    expect(failure.text).toMatch(/^需求 v2 没有生成：.+。修订请求已记录，可以重新生成。$/u)
    expect(failure.text).not.toMatch(/。。/u)
    expect(failure.technical).toContain('timeout')
    expect(describeGenerationFailure({ kind: 'requirement', version: 1, details: stageAgentFailureDetails('revision_input_changed', 'stage_validation') }).text)
      .toBe('修订请求引用的答疑提案已不可用，无法重新生成；请到「材料与版本」核对提案。')
    expect(describeGenerationFailure({ kind: 'design', version: 1, error: new Error('所选提案已变化或不属于当前方案设计步骤，请重新选择。') }).text)
      .toBe('方案 v2 没有生成：所选提案已变化或不属于当前方案设计步骤，请重新选择。修订清单保留，可以修改后重新生成。')
    const english = describeGenerationFailure({ kind: 'design', version: 1, error: new Error('design_revision_conflict') })
    expect(english.text).toBe('方案 v2 没有生成：原因未知。修订清单保留，可以修改后重新生成。')
    for (const item of [failure, english]) expect(item.text).not.toMatch(rawCode)
  })
})
