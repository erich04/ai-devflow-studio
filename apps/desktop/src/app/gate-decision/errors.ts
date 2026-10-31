/**
 * Write results in Chinese: what happened, what was kept, what to do next (FR-7.10, design §6).
 * Raw messages and codes go to `technical` only (AC31).
 */
import { describeStageAgentFailure, type StageAgentFailureDetails } from '@ai-devflow/shared'
import { gateCopy, nextVersionLabel, versionLabel, type GateKind } from './copy'
export type DescribedError = { text: string; technical: string }
const messageOf = (error: unknown) => (error instanceof Error ? error.message : typeof error === 'string' ? error : String(error ?? ''))
const trimStop = (text: string) => text.trim().replace(/[。.]+$/u, '')
/** `requestClarificationChanges` rejections (shared and main messages). */
export function describeRevisionRequestError(error: unknown, version: number): DescribedError {
  const technical = messageOf(error)
  const label = versionLabel('requirement', version)
  const text = /Clarification revision changed|missing, stale, or no longer current|stale_run/iu.test(technical) ? gateCopy.requestStale(label)
    : /already submitted/iu.test(technical) ? gateCopy.requestAlreadySubmitted(label)
      : /between 1 and 4000 characters|超过 4000/iu.test(technical) ? gateCopy.requestTooLong
        : /only available on the current requirement Gate/iu.test(technical) ? gateCopy.requestNotCurrent
          : /Legacy clarification/iu.test(technical) ? gateCopy.requestLegacy
            : /提案|proposal/iu.test(technical) ? gateCopy.requestProposalsChanged
              : gateCopy.requestFailed
  return { text, technical }
}
/** `approveGate` rejections. */
export function describeApprovalError(error: unknown, input: { kind: GateKind; version?: number }): DescribedError {
  const technical = messageOf(error)
  const label = versionLabel(input.kind, input.version)
  const text = /does not target the current clarification revision|clarification_revision_stale/iu.test(technical) && input.kind === 'requirement' ? gateCopy.approveNeedsReview(label)
    : /clarification revision is missing, stale, or no longer current|需求版本已变化/iu.test(technical) ? gateCopy.approveRequirementChanged
      : /design material is missing, changed, or no longer current|方案内容已变化/iu.test(technical) ? gateCopy.approveDesignChanged
        : /role|permission|权限/iu.test(technical) ? gateCopy.approvePermission
          : /Gate approval rejected|blocked|policy/iu.test(technical) ? gateCopy.approvePolicyBlocked
            : gateCopy.approveFailed
  return { text, technical }
}
/** A failed generation of vN+1 (stage failure trace, or a design revision rejection). */
export function describeGenerationFailure(input: { kind: GateKind; version?: number; details?: StageAgentFailureDetails; error?: unknown }): DescribedError {
  const next = nextVersionLabel(input.kind, input.version)
  const technical = [input.details ? `${input.details.code} (${input.details.source})` : '', input.error === undefined ? '' : messageOf(input.error)].filter(Boolean).join(' · ')
  if (input.details?.code === 'revision_input_changed') return { text: gateCopy.pendingInputChanged, technical }
  const chinese = input.error !== undefined && /[\u4e00-\u9fff]/u.test(messageOf(input.error)) ? trimStop(messageOf(input.error)) : undefined
  const description = input.details ? trimStop(describeStageAgentFailure(input.details)) : chinese ?? gateCopy.generationUnknownReason
  return {
    text: input.kind === 'requirement' ? gateCopy.generationFailedRequirement(next, description) : gateCopy.generationFailedDesign(next, description),
    technical,
  }
}
