import type { CodingPermissionRequest } from '@ai-devflow/shared'
import type { BlockKey } from '../gate-decision/material'
import type { BarView, GateDecisionView } from '../gate-decision/projection'
import { countsText, formatDecisionTime, versionSpacing } from './copy'
import { effectiveCodingRun, type BuildTestFacts } from './facts'
import { buildTestReports, type TestReportView } from './reports'
import { buildChangeVersions, shownChangeVersion, type ChangeVersion } from './versions'
export type DiffRowView = { key: BlockKey; kind: 'del' | 'add' | 'gap' | 'note'; oldLine?: number; newLine?: number; text: string; isNew?: true; aria: string }
export type BuildTestMaterialView = { kind: 'progress' | 'change' | 'report'; header: string; recordedAt?: string; subline?: string; banner?: string; progress?: { intro: string; steps: Array<{ key: BlockKey; text: string; state: 'done' | 'current' | 'paused' }> }; change?: { files: Array<{ path: string; counts: string; rows: DiffRowView[]; note?: string }>; unverified?: string; sameAsNote?: string }; placeholder?: string; reports: TestReportView[]; bars: BarView[]; newBlocks: BlockKey[]; list: Array<{ id: string; text: string; current: boolean }>; signature: string }
export type BuildTestDecisionView = Omit<GateDecisionView, 'material'> & { material: BuildTestMaterialView; identity: { runId: string; request?: CodingPermissionRequest; evidence?: { id: string; runUpdatedAt: string } } }
const phases: Record<string, string> = { analysis: '读方案和相关代码', initial: '写改动', revision: '按清单修改', change_review: 'AI 自检改动', repair: '生成修复' }
export function progressText(status: string, phase?: string): string {
  if (['queued', 'preparing'].includes(status)) return '准备受管工作区'
  if (status === 'bootstrapping') return '安装依赖'
  if (status === 'applying') return '把改动应用到受管工作区'
  if (status === 'testing') return '运行测试'
  return phase && phases[phase] ? phases[phase] : '正在开发'
}
export function buildMaterial(f: BuildTestFacts, stage: 'build' | 'test', reading?: string): { material: BuildTestMaterialView; shown?: ChangeVersion; anchors: Map<string, BlockKey> } {
  const versions = buildChangeVersions(f), run = effectiveCodingRun(f), current = versions.filter(v => v.codingRunId === run?.id).at(-1)
  const shown = shownChangeVersion(f, stage, reading)
  const reports = buildTestReports(f), readReport = reports.find(r => r.id === reading)
  let serial = 0
  const key = (): BlockKey => { serial++; return `${serial}:${serial + 1}` }
  const anchors = new Map<string, BlockKey>()
  const material: BuildTestMaterialView = { kind: 'progress', header: '开发进度', reports: [], bars: [], newBlocks: [], list: [...versions.map(v => ({ id: v.id, text: `${v.label} · ${v.status}`, current: v.id === current?.id })), ...reports.map(r => ({ id: r.id, text: r.title, current: r.id === reports.at(-1)?.id }))], signature: '' }
  if (shown && (stage === 'build' || shown.repair && shown.request.status === 'pending' || reading)) {
    material.kind = 'change'
    const previous = versions.find(v => v.id === shown.record?.revision?.previous.id)
    material.header = `${shown.label} · ${shown.record?.revision ? `根据${previous?.label ?? '上一版改动'} 和 ${shown.record.revision.itemCount} 项修改生成，改过的行标了「新」` : shown.repair ? '根据测试没通过的原因生成，只标出这次修复加的或改的行' : shown.request.origin === 'change_acceptance' ? `OpenCode 根据${f.designLabel} 改好` : `根据${f.designLabel}${run?.retryOf ? ' 重新生成' : ' 生成'}`}`
    material.recordedAt = `记录于 ${formatDecisionTime(shown.createdAt, f.now)}`
    material.subline = `${shown.view?.files.length ?? 0} 个文件 · ${countsText(shown.view?.additions ?? 0, shown.view?.deletions ?? 0)} 行 · ${shown.request.origin === 'change_acceptance' ? '已在受管工作区里，测试已通过，批准后进入下一步' : shown.request.status === 'approved' ? '已批准，已应用到受管工作区' : '在受管工作区里，批准前不会应用'}`
    material.change = { files: (shown.record?.verified === false ? undefined : shown.view)?.files.map(file => ({ path: file.path, counts: countsText(file.additions, file.deletions), ...(file.tooLarge ? { note: '这个文件太大，只能在受管工作区里查看。' } : file.unparsed ? { note: '这份差异无法按行显示，请在执行记录里查看原文。' } : {}), rows: file.rows.map(row => {
      const block = key()
      if (row.kind === 'add' || row.kind === 'del') {
        anchors.set(`${file.path}:${row.kind === 'add' ? 'new' : 'old'}:${row.kind === 'add' ? row.newLine : row.oldLine}`, block)
        if (row.isNew) material.newBlocks.push(block)
        return { ...row, key: block, aria: row.isNew ? `${shown.label} 新改的行` : row.kind === 'add' ? '新增的行' : '删除的行' }
      }
      return { kind: row.kind, key: block, text: row.kind === 'gap' ? `第 ${row.from}${row.to !== row.from ? `–${row.to}` : ''} 行没有改动` : '文件末尾的换行有变化', aria: '' }
    }) })) ?? [], ...(shown.record?.verified === false || !shown.view ? { unverified: 'DevFlow 核对不了这份改动的显示内容，不能在这里批准。详情在「执行记录」。' } : {}) }
    if (previous && material.change && !material.newBlocks.length) material.change.sameAsNote = `和${previous.label} 一样，没有新增修改。`
  } else if (stage === 'build' && !readReport) {
    const events = f.codingEvents.filter(e => e.codingRunId === run?.id)
    const reached = [...new Set(events.flatMap(e => { const phase = e.metadata?.providerCall && typeof e.metadata.providerCall === 'object' ? (e.metadata.providerCall as { phase?: string }).phase : undefined; return phase && phases[phase] ? [phases[phase]!] : [] }))]
    const active = progressText(run?.status ?? 'queued')
    if (!reached.includes(active)) reached.push(active)
    material.progress = { intro: 'AI 会先读方案和相关代码，再写改动。写好后先给你看，你批准后才会应用和测试。', steps: reached.map((text, i) => ({ key: key(), text, state: i < reached.length - 1 ? 'done' : run?.status === 'waiting_input' || run?.status === 'waiting_permission' ? 'paused' : 'current' })) }
  } else { material.kind = 'report'; material.header = readReport?.title ?? '测试报告' }
  const shownReports = readReport ? [readReport] : stage === 'test' ? [...reports].reverse() : run?.status === 'failed' && run.engine === 'opencode-http' ? reports.filter(r => r.report.codingRunId === run.id).slice(-1) : []
  material.reports = shownReports.map(report => ({ ...report, keyLines: report.keyLines.map(line => ({ ...line, key: key() })) }))
  if (reading) {
    const failed = reports.find(r => r.title.includes(`针对${shown?.label} ·`) && r.report.evidence.status !== 'passed')
    const status = shown ? `${shown.status}${failed ? `，${failed.report.label.replace('测试报告', '测试没通过')}` : ''}` : readReport?.report.evidence.status === 'passed' ? '通过' : '没通过'
    material.banner = `这是${shown?.label ?? readReport?.report.label ?? '历史材料'}（${status}）。现在${current?.request.status === 'pending' ? `要处理的是${current.label}` : '没有待批准的改动'}。这里只能查看。`
  }
  const mainShown = shownChangeVersion(f, stage)
  const mainMaterialId = stage === 'build' || mainShown?.repair && mainShown.request.status === 'pending' ? mainShown?.id : reports.at(-1)?.id
  material.list = material.list.map(item => ({ ...item, current: item.id === mainMaterialId }))
  material.header = versionSpacing(material.header)
  if (material.banner) material.banner = versionSpacing(material.banner)
  material.signature = `${material.kind}:${shown?.id ?? ''}:${material.reports.map(r => r.id).join(',')}:${serial}`
  return { material, ...(shown ? { shown } : {}), anchors }
}
