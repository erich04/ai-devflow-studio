import { listTaskTestReports, parseTestOutput, type TaskTestReport } from '@ai-devflow/shared'
import type { BlockKey } from '../gate-decision/material'
import type { BuildTestFacts } from './facts'
import { buildChangeVersions } from './versions'
import { formatDecisionTime } from './copy'
export type TestReportView = { id: string; title: string; recordedAt: string; facts: Array<{ text: string; raw?: true }>; result: string; reusedNote?: string; keyLinesLabel: string; keyLines: Array<{ key: BlockKey; text: string }>; fullLogLabel: string; fullLog: string; report: TaskTestReport; failures: string[] }
export function buildTestReports(f: BuildTestFacts): TestReportView[] {
  const versions = buildChangeVersions(f)
  return listTaskTestReports({ run: f.run, codingRuns: f.codingRuns, codingEvents: f.codingEvents, testEvidence: f.testEvidence, workspaces: f.managedCodingWorkspaces }).map(report => {
    const e = report.evidence, output = parseTestOutput(`${e.stdout}\n${e.stderr}`, e.status)
    const event = f.codingEvents.find(event => event.codingRunId === report.codingRunId && event.metadata?.evidenceId === e.id)
    const approvals = f.codingPermissionDecisions.filter(d => d.codingRunId === report.codingRunId && d.decision === 'approved' && d.decidedAt <= e.createdAt && versions.some(v => v.request.id === d.requestId && v.codingRunId === report.codingRunId)).sort((a, b) => a.decidedAt.localeCompare(b.decidedAt))
    const last = approvals.at(-1), approval = last && approvals.filter(a => a.decidedAt === last.decidedAt).length === 1 ? last : undefined
    const version = versions.find(v => v.codingRunId === report.codingRunId && v.id === event?.metadata?.changeSetId && v.request.changeSetDigest === event?.metadata?.changeSetDigest) ?? versions.find(v => v.codingRunId === report.codingRunId && v.request.testEvidenceId === e.id) ?? (approval ? versions.find(v => v.request.id === approval.requestId) : undefined)
    const result = output.counts ? output.counts.failed ? `${output.counts.total} 条测试里 ${output.counts.failed} 条没通过` : e.status === 'passed' ? `${output.counts.total} 条测试都通过` : `${output.counts.total} 条测试都通过，但测试命令里的其他检查没通过（退出码 ${e.exitCode ?? '未知'}）` : e.status === 'passed' ? '通过' : '没通过'
    return { id: e.id, title: `${report.label}${version ? ` · 针对${version.label}` : ''} · ${e.status === 'passed' ? '通过' : '没通过'}`, recordedAt: `记录于 ${formatDecisionTime(e.createdAt, f.now)}`, facts: [{ text: e.command, raw: true }, { text: e.sourceTree?.workspaceId ? '在受管工作区运行' : '在项目目录运行' }, { text: `用时 ${(e.durationMs / 1000).toFixed(1)} 秒` }, { text: e.exitCode === null ? '没有退出码' : `退出码 ${e.exitCode}` }], result,
      ...(f.testEvidence.some(r => r.reusedFrom?.evidenceId === e.id) ? { reusedNote: '测试证据确认时用的就是这份结果。' } : {}), keyLinesLabel: e.status === 'passed' ? '输出的最后几行' : '失败输出的关键行', keyLines: output.keyLines.map(text => ({ key: '0:1' as BlockKey, text })), fullLogLabel: `完整日志（${output.lineCount} 行）`, fullLog: output.lines.join('\n'), report, failures: output.failures }
  })
}
