import type { ConversationFocus, ConversationMessage } from '../../../electron/workbench-conversation-contract'
import { claimed, resolveBuildTestPage, effectiveCodingRun, isActive, type BuildTestFacts } from './facts'
import { buildChangeVersions, shownChangeVersion } from './versions'
import { buildTestReports } from './reports'
import { listKey, type ListTarget, type RevisionListStore } from '../gate-decision/revision-list'
export type BuildTestChatPage = { runId: string; stage: 'build' | 'test'; reading?: string | undefined }
export type ChangeChatLink = { state: 'none' } | { state: 'written'; text: string } | { state: 'added'; text: string; itemId: string; listKey: string } | { state: 'disabled'; text: string } | { state: 'add'; text: string; title: string; target: Extract<ListTarget, { kind: 'change' }>; suggestion: string }
export function changeRevisionLinkForMessage(message: ConversationMessage, f: BuildTestFacts | undefined, store: RevisionListStore): ChangeChatLink {
  const focus = message.focus, suggestion = [...message.text.matchAll(/^建议[：:][ \t]*(.+)$/gmu)].at(-1)?.[1]?.trim()
  if (message.role !== 'assistant' || !focus?.changeSetId || !focus.changeSetDigest || !suggestion) return { state: 'none' }
  if (!f || focus.runId !== f.run.id) return { state: 'disabled', text: '请打开这条建议对应的任务，再查看修订清单。' }
  const versions = buildChangeVersions(f), version = versions.find(v => v.id === focus.changeSetId && v.record?.digest === focus.changeSetDigest)
  if (!version?.record) return { state: 'disabled', text: '这条建议对应的改动内容还没读到。' }
  const target: Extract<ListTarget, { kind: 'change' }> = { kind: 'change', runId: f.run.id, codingRunId: version.codingRunId, changeSetId: version.id, changeSetDigest: version.record.digest }, key = listKey(target)
  const list = store.lists[key], index = list?.items.findIndex(i => i.source === 'chat' && i.chat?.messageId === message.id) ?? -1
  if (index >= 0) {
    const next = versions.find(v => v.record?.revision?.previous.id === version.id)
    if (list?.submitted && next) return { state: 'written', text: `已写进${next.label}` }
    return { state: 'added', text: `已加入修订清单（第 ${index + 1} 项）`, itemId: list!.items[index]!.id, listKey: key }
  }
  const run = effectiveCodingRun(f), current = versions.filter(v => v.codingRunId === run?.id).at(-1)
  if (version.request.status !== 'pending' || !isActive(run)) return { state: 'disabled', text: `${version.label} 已经处理过，答疑建议不能再加入修订清单。` }
  if (run?.revisionInFlight) return { state: 'disabled', text: `正在生成改动 v${versions.length + 1}，完成后可以加入新版本的修订清单。` }
  if (current?.id !== version.id) return { state: 'disabled', text: `这条建议针对${version.label}，当前是${current?.label ?? '另一份改动'}；请在答疑里针对当前改动再问一次。` }
  if (suggestion.length > 300) return { state: 'disabled', text: '建议超过 300 字，请在答疑里请 AI 缩短后再加入。' }
  if (!f.canDecide || f.writes.some(w => !claimed(w, f)) || Date.parse(version.request.expiresAt) <= Date.parse(f.now)) return { state: 'disabled', text: '这份改动当前不能加入修订清单。' }
  return { state: 'add', text: '加入修订清单', title: `将作为「来自答疑」加入${version.label} 的修订清单，不会修改改动，也不会推进流程。`, target, suggestion }
}
export function buildTestChatContext(f: BuildTestFacts, page: BuildTestChatPage): { readable: string; focus?: ConversationFocus } {
  const versions = buildChangeVersions(f), run = effectiveCodingRun(f), latest = versions.filter(v => v.codingRunId === run?.id).at(-1), shown = shownChangeVersion(f, page.stage, page.reading)
  const reports = buildTestReports(f), report = page.reading ? reports.find(r => r.id === page.reading) : reports.at(-1)
  const workspace = f.managedCodingWorkspaces.find(w => w.id === run?.managedWorkspaceId)
  const parts = [page.stage === 'test' && report ? report.report.label : undefined, shown ? `改动 v${shown.number}（${shown.repair ? '修复，' : ''}${shown.request.status === 'approved' ? '已批准' : '未批准'}）` : page.stage === 'build' ? '开发进度' : undefined, workspace?.cleanupStatus === 'active' && !workspace.deletedAt ? '受管工作区（只读）' : undefined, page.stage === 'build' && resolveBuildTestPage(f, page.stage) !== 'finished' ? f.designLabel : undefined].filter(Boolean)
  const focus: ConversationFocus = { runId: f.run.id, nodeId: page.stage === 'build' ? f.buildNode.id : f.testNode.id }
  if (!page.reading && resolveBuildTestPage(f, page.stage) === 'current' && latest?.request.status === 'pending' && Date.parse(latest.request.expiresAt) > Date.parse(f.now) && isActive(run) && !run?.revisionInFlight) {
    if (latest.record) { focus.changeSetId = latest.id; focus.changeSetDigest = latest.record.digest }
    else { focus.diffArtifactId = latest.id; focus.diffSourceDigest = latest.request.diffSourceDigest! }
  }
  return { readable: `可读：${parts.join(' · ')}`, ...(!page.reading ? { focus } : {}) }
}
