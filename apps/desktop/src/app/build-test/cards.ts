import { splitBacktickSegments } from '@ai-devflow/shared'
import type { BlockKey } from '../gate-decision/material'
import { BUILD_TEST_MARGIN_ORDER, compareMarginOrder } from '../gate-decision/placement'
import type { CardView } from '../gate-decision/projection'
import { effectiveCodingRun, taskCodingRuns, type BuildTestFacts } from './facts'
import type { BuildTestMaterialView } from './material'
import { buildChangeVersions, type ChangeVersion } from './versions'
export function buildCards(f: BuildTestFacts, shown: ChangeVersion | undefined, material: BuildTestMaterialView, anchors: Map<string, BlockKey>, history: boolean, stage: 'build' | 'test'): CardView[] {
  const cards: CardView[] = [], run = effectiveCodingRun(f)
  const base = { number: 1, ranges: [], blocks: [], actionable: false, mergedLines: [] }
  const requests = f.codingPermissionRequests.filter(p => p.runId === f.run.id && !p.changeSetId && p.origin !== 'change_acceptance').sort((a, b) => a.requestedAt.localeCompare(b.requestedAt) || a.id.localeCompare(b.id))
  for (const [index, request] of requests.entries()) if (request.codingRunId === run?.id) {
    const pending = request.status === 'pending' && Date.parse(request.expiresAt) > Date.parse(f.now), paused = run.permissionPause?.requestId === request.id
    const action = request.origin === 'execution_authorization' ? '授权 OpenCode 在受管工作区里读、搜索和改文件。' : request.origin === 'dependency_bootstrap' ? '要运行的安装命令：' : request.permission === 'bash' ? '要运行的命令：' : request.permission === 'external_directory' ? '要访问受管工作区以外的目录：' : '要改的文件：'
    cards.push({ ...base, id: `permission:${request.id}`, kind: 'permission', number: index + 1, title: `权限请求 ${index + 1}`, text: action, quote: request.command ?? request.filePaths?.join('\n') ?? request.filePath ?? '', permission: request, status: pending ? 'open' : request.status === 'approved' ? 'allowed' : request.status === 'expired' ? 'expired' : 'rejected', statusText: paused ? '已过期，开发暂停' : pending ? '' : request.status === 'approved' ? f.codingPermissionDecisions.some(d => d.requestId === request.id && d.sessionGrantId) ? '已按这次开发里的授权自动允许' : f.codingPermissionDecisions.some(d => d.requestId === request.id && d.scope === 'session') ? '已允许，并在这次开发里复用' : '已允许一次' : request.status === 'expired' ? '已过期' : '已拒绝', actionable: !history && f.canDecide && (pending || paused) })
  }
  let questionNumber = 0
  for (const coding of taskCodingRuns(f)) {
    const receipts = coding.questionReceipts ?? []
    for (const receipt of receipts.filter(r => r.id !== coding.question?.id || r.revision !== coding.question?.revision)) for (const [index, question] of (receipt.questions ?? []).entries()) {
      questionNumber++
      if (coding.id !== run?.id) continue
      const answers = receipt.answers?.[index] ?? []
      cards.push({ ...base, id: `question:${receipt.id}:${receipt.revision}:${index}`, kind: 'coding_question', number: questionNumber, title: `问题 ${questionNumber}`, text: '', segments: [{ text: `${question.header}\n${question.question}`, raw: true }], status: answers.length ? 'answered' : 'skipped', statusText: answers.length ? `已回答：${answers.join('、')}` : receipt.status === 'expired' ? '没有在期限内回答，开发已停止' : '已跳过' })
    }
    if (coding.question) coding.question.questions.forEach((question, index) => {
      questionNumber++
      if (coding.id !== run?.id) return
      const q = coding.question!, receipt = receipts.find(r => r.id === q.id && r.revision === q.revision)
      const answers = receipt?.answers?.[index] ?? []
      cards.push({ ...base, id: `question:${q.id}:${index}`, kind: 'coding_question', number: questionNumber, title: `问题 ${questionNumber}`, text: '', segments: [{ text: `${question.header}\n${question.question}`, raw: true }], codingQuestion: { codingRunId: coding.id, request: q, index }, status: q.status === 'pending' ? 'open' : answers.length ? 'answered' : 'skipped', statusText: answers.length ? `已回答：${answers.join('、')}` : q.status === 'expired' ? '没有在期限内回答，开发已停止' : q.status === 'pending' ? '' : q.status === 'sending' ? '正在提交回答' : q.status === 'delivery_unknown' ? '回答是否送达尚未确定' : '已跳过', actionable: !history && f.canDecide && q.status === 'pending' && Date.parse(q.expiresAt) > Date.parse(f.now) })
    })
  }
  const review = f.history?.reviews.filter(r => r.changeSetId === shown?.id && r.status === 'completed').at(-1)
  if (review) for (const finding of review.findings) {
    const anchor = finding.anchor ? anchors.get(`${finding.anchor.path}:${finding.anchor.side}:${finding.anchor.line}`) : undefined
    const item = f.list?.items.find(i => i.finding?.reviewId === review.id && i.finding.index === finding.index)
    const next = f.history?.changeSets.find(c => c.revision?.previous.id === shown?.id)
    const nextVersion = next ? buildChangeVersions(f).find(v => v.id === next.id)?.label : undefined
    const declined = f.list?.declined.some(i => i.reviewId === review.id && i.index === finding.index)
    const actionable = !history && f.canDecide && shown?.request.status === 'pending' && Date.parse(shown.request.expiresAt) > Date.parse(f.now) && !run?.revisionInFlight
    cards.push({ ...base, id: `finding:${review.id}:${finding.index}`, kind: 'finding', number: finding.index + 1, title: '', text: `${finding.consequence}。${finding.reason}`, segments: splitBacktickSegments(`${finding.consequence}。${finding.reason}`), ...(review.levelsKnown && finding.importance ? { level: finding.importance } : {}), ...(anchor ? { anchor, ranges: [{ start: Number(anchor.split(':')[0]), end: Number(anchor.split(':')[1]) }], blocks: [anchor] } : {}), status: item ? 'adopted' : declined ? 'declined' : 'open', actionable, finding: { reviewId: review.id, index: finding.index, text: finding.item, ...(finding.importance ? { level: finding.importance } : {}) }, ...(finding.becomes ? { becomes: finding.becomes } : {}), ...(item ? { itemRef: { itemId: item.id, number: (f.list?.items.indexOf(item) ?? 0) + 1, ...(history ? { static: true as const } : {}) }, statusText: f.list?.submitted && nextVersion ? `已写进${nextVersion}` : `改动 v${(shown?.number ?? 0) + 1} 里会${finding.becomes ? '改成：' : `处理：${item.text}`}` } : {}), ...(!actionable ? { readOnlyReason: `${shown?.label ?? '这份改动'} ${shown?.status ?? '已经处理过'}，不能再处理。` } : {}) })
  }
  if (stage === 'test' || (run?.engine === 'opencode-http' && run.status === 'failed')) {
    const latest = material.reports[0], failed = material.reports.find(r => r.report.evidence.status !== 'passed')
    if (failed) (failed.failures.length ? failed.failures : ['测试命令没通过']).slice(0, 5).forEach((name, index) => {
      const line = failed.keyLines.find(l => l.text.includes(name)) ?? failed.keyLines[0], passed = latest?.report.evidence.status === 'passed'
      cards.push({ ...base, id: `failure:${failed.id}:${index}`, kind: 'test_failure', number: index + 1, title: `测试失败 ${index + 1} · 重要`, text: '', segments: [{ text: name === '测试命令没通过' ? '测试命令没通过：' : '「' }, { text: name === '测试命令没通过' ? line?.text ?? '' : name, raw: true }, { text: name === '测试命令没通过' ? '' : '」没通过。' }], level: 'important', status: passed ? 'fixed' : 'open', ...(passed ? { statusText: '✓ 修复后通过了' } : {}), ...(line ? { anchor: line.key, blocks: [line.key], ranges: [{ start: Number(line.key.split(':')[0]), end: Number(line.key.split(':')[1]) }] } : {}) })
    })
    const freshness = latest ? f.freshness.states[latest.id] : undefined
    if (!history && latest?.report.evidence.status === 'passed' && freshness && freshness !== 'current' && f.testNode.status !== 'success') cards.push({ ...base, id: `evidence:${latest.id}`, kind: 'stale_evidence', title: freshness === 'stale' ? '证据过期 · 重要' : '证据无法核实 · 重要', level: 'important', status: 'open', text: freshness === 'stale' ? '测试之后受管工作区有改动，这份结果不能再证明当前代码。DevFlow 只能交付批准过的改动，所以要先撤销这些改动；撤销后这份结果会重新有效。' : freshness === 'unrecorded' ? '这次测试没有记下当时的代码状态。常见原因是测试命令会改动项目里的文件。' : '受管工作区已不存在或读不到，无法核实这份结果是否对应当前代码。' })
  }
  cards.sort((a, b) => compareMarginOrder({ ...a, position: a.anchor ? Number(a.anchor.split(':')[0]) : undefined }, { ...b, position: b.anchor ? Number(b.anchor.split(':')[0]) : undefined }, BUILD_TEST_MARGIN_ORDER))
  let index = 0
  return cards.map(c => c.kind === 'finding' ? { ...c, number: ++index, title: `意见 ${index}${c.level ? c.level === 'important' ? ' · 重要' : ' · 建议' : ''}` } : c)
}
