import { isActiveCodingAgentRunStatus, listTaskTestReports, parseTestOutput, redactSensitiveText, type CodingAgentRun, type WorkflowRun } from '@ai-devflow/shared'
import type { CodingRuntimeStore } from './coding-runtime.js'
import { parseCodingRetryContext, type CodingRetryContext } from './build-test-contract.js'

export async function resolveCodingRetryContext(input: { run: WorkflowRun; nodeId: string; context: CodingRetryContext; userInstruction: string }, store: CodingRuntimeStore): Promise<{ userInstruction: string; userReason: string; retryOf: NonNullable<CodingAgentRun['retryOf']> }> {
  const context = parseCodingRetryContext(input.context)
  const invalid = () => { throw new Error('[coding_context_invalid] 上一次开发或测试记录已变化，请重新查看。') }
  const codingRuns = await store.listCodingAgentRuns(input.run.id)
  const previous = codingRuns.find(r => r.id === context.previousCodingRunId)
  if (!previous || previous.projectId !== input.run.projectId || previous.runId !== input.run.id || previous.nodeId !== input.nodeId || isActiveCodingAgentRunStatus(previous.status)) return invalid()
  if (context.changeSetId && !(await store.listCodingChangeSets?.(previous.id))?.some(c => c.id === context.changeSetId && c.projectId === input.run.projectId)) return invalid()
  const requests = await store.listCodingPermissionRequests(previous.id)
  let explanation = requests.some(r => r.status === 'rejected' && (r.changeSetId || r.origin === 'change_acceptance')) ? 'The previous proposed changes were rejected.' : 'The previous development attempt did not finish.'
  if (context.failedTestEvidenceId) {
    const reports = listTaskTestReports({ run: input.run, codingRuns, testEvidence: await store.listTestEvidence(input.run.id), codingEvents: await store.listCodingAgentEvents(previous.id), workspaces: await store.listManagedCodingWorkspaces(input.run.projectId) })
    const report = reports.find(r => r.evidence.id === context.failedTestEvidenceId)
    if (!report || report.codingRunId !== previous.id || report.evidence.status === 'passed') return invalid()
    explanation = `The previous changes did not pass tests.\n${parseTestOutput(`${report.evidence.stdout}\n${report.evidence.stderr}`, report.evidence.status).keyLines.join('\n')}`
  }
  const reason = context.reason ? redactSensitiveText(context.reason).value : ''
  return { userInstruction: `${input.userInstruction}\n\nPrevious attempt (${context.kind}): ${explanation}${reason ? `\nUser reason: ${reason}` : ''}`, userReason: reason, retryOf: { kind: context.kind, codingRunId: previous.id, ...(context.changeSetId ? { changeSetId: context.changeSetId } : {}), ...(context.failedTestEvidenceId ? { failedTestEvidenceId: context.failedTestEvidenceId } : {}), hasReason: Boolean(reason) } }
}
