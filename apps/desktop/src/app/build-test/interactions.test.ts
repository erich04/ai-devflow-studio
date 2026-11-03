import { describe, expect, it } from 'vitest'
import type { ConversationMessage } from '../../../electron/workbench-conversation-contract'
import { addChange, addCoding, addReport, approve, buildTestFacts, NOW } from '../../testing/build-test-fixtures'
import { buildTestChatContext, changeRevisionLinkForMessage } from './chat'
import { shownChangeVersion } from './versions'
import { projectBuildTestDecision } from './projection'
import { applyRevisionListOp, emptyRevisionList, listKey, parseRevisionListStore, type RevisionListStore } from '../gate-decision/revision-list'
import { costText, deadlineMeta } from './copy'
import { scanFirstLayerText } from '../first-layer-scan'

describe('change discussions and exact revision targets', () => {
  it('keeps completed build context on its approved change while test discusses the pending repair', () => {
    const f = buildTestFacts(), r = addCoding(f), initial = addChange(f, r)
    approve(f, initial); addReport(f, r, 'failed'); const repair = addChange(f, r, 'repair')
    expect(shownChangeVersion(f, 'build')?.id).toBe(initial.changeSetId)
    expect(shownChangeVersion(f, 'test')?.id).toBe(repair.changeSetId)
    const build = buildTestChatContext(f, { runId: f.run.id, stage: 'build' })
    expect(build.readable).toContain('改动 v1（已批准）'); expect(build.focus?.changeSetId).toBeUndefined()
    const test = buildTestChatContext(f, { runId: f.run.id, stage: 'test' })
    expect(test.readable).toContain('改动 v2（修复，未批准）'); expect(test.focus?.changeSetId).toBe(repair.changeSetId)
    expect(buildTestChatContext(f, { runId: f.run.id, stage: 'test', reading: initial.changeSetId }).focus).toBeUndefined()
  })
  it('persists a message-bound list and shows a receipt only after its successor exists', () => {
    const f = buildTestFacts(), r = addCoding(f), p = addChange(f, r)
    const message: ConversationMessage = { id: 'answer', role: 'assistant', text: '解释\n建议：保留标题\n建议：只改搜索逻辑', createdAt: NOW, focus: { runId: f.run.id, nodeId: f.buildNode.id, changeSetId: p.changeSetId!, changeSetDigest: p.changeSetDigest! } }
    const store: RevisionListStore = { version: 1, lists: {} }
    const link = changeRevisionLinkForMessage(message, f, store); expect(link.state).toBe('add'); if (link.state !== 'add') throw new Error('missing target')
    expect(link.suggestion).toBe('只改搜索逻辑')
    const added = applyRevisionListOp(emptyRevisionList(link.target, NOW), { type: 'addChat', conversationId: 'chat', messageId: message.id, text: link.suggestion }, NOW)
    if (!added.ok) throw new Error(added.message)
    store.lists[listKey(link.target)] = added.list
    expect(changeRevisionLinkForMessage(message, f, store)).toMatchObject({ state: 'added', text: '已加入修订清单（第 1 项）' })
    const submitted = applyRevisionListOp(added.list, { type: 'markSubmitted', text: '只改搜索逻辑', itemCount: 1, proposals: [] }, NOW)
    if (!submitted.ok) throw new Error(submitted.message)
    store.lists[listKey(link.target)] = submitted.list
    expect(changeRevisionLinkForMessage(message, f, store).state).toBe('added')
    p.status = 'superseded'; addChange(f, r)
    f.history!.changeSets[1]!.revision = { index: 1, itemCount: 1, changeRequest: '只改搜索逻辑', previous: { id: p.changeSetId!, digest: p.changeSetDigest! } }
    expect(changeRevisionLinkForMessage(message, f, store)).toMatchObject({ state: 'written', text: '已写进改动 v2' })
    expect(parseRevisionListStore(JSON.stringify(store)).store.lists[listKey(link.target)]?.items[0]?.chat?.messageId).toBe('answer')
  })
  it('never adds another task, expired request, oversized advice, or text without a precise change identity', () => {
    const f = buildTestFacts(), r = addCoding(f), p = addChange(f, r), store: RevisionListStore = { version: 1, lists: {} }
    const message: ConversationMessage = { id: 'answer', role: 'assistant', text: '建议：保留标题', createdAt: NOW }
    expect(changeRevisionLinkForMessage(message, f, store).state).toBe('none')
    message.focus = { runId: 'other', nodeId: f.buildNode.id, changeSetId: p.changeSetId!, changeSetDigest: p.changeSetDigest! }
    expect(changeRevisionLinkForMessage(message, f, store).state).toBe('disabled')
    message.focus.runId = f.run.id; message.text = `建议：${'改'.repeat(301)}`
    expect(changeRevisionLinkForMessage(message, f, store)).toMatchObject({ state: 'disabled', text: expect.stringContaining('300') })
    message.text = '建议：保留标题'; f.now = p.expiresAt
    expect(changeRevisionLinkForMessage(message, f, store).state).toBe('disabled')
  })
})
describe('first-layer decision copy', () => {
  it('warns that an OpenCode tool deadline pauses execution rather than discarding the work', () => {
    expect(deadlineMeta('2026-11-02T12:03:00.000Z', NOW, '暂停权限', '费用未知')).toMatchObject({ tone: 'warn', text: expect.stringContaining('开发暂停，受管工作区保留') })
    expect(deadlineMeta('2026-11-02T12:03:00.000Z', NOW, '修复', '最多约 $0.020').text).toContain('要交给 AI 重新修复')
  })
  it('does not present unknown pricing as free or round small costs to zero', () => {
    const f = buildTestFacts(); f.costs!.start = 0; expect(costText(f.costs, 'start')).toBe('费用未知')
    f.costs!.start = .000001; expect(costText(f.costs, 'start')).toBe('最多不到 $0.001')
    f.costs!.billing = 'no_cost'; expect(costText(f.costs, 'start')).toBe('不调用付费模型')
  })
  it('detects all forbidden display families while allowing product and model names', () => {
    expect(new Set(scanFirstLayerText('1/2 abcdef123456 2026-11-02 coding-run-23 waiting_permission 第 2 次尝试 Tests have failed').map(x => x.rule))).toEqual(new Set(['fraction', 'hash', 'machine-time', 'internal-id', 'state', 'attempt', 'english-sentence']))
    expect(scanFirstLayerText('DevFlow Native · deepseek-v4-flash · Draft PR · CI 检查', ['deepseek-v4-flash'])).toEqual([])
  })
  it('keeps decision copy free of internal statuses across approval, revision, repair and passed/stale evidence', () => {
    const f = buildTestFacts(), r = addCoding(f), p = addChange(f, r)
    const scan = (stage: 'build' | 'test') => {
      const { bar } = projectBuildTestDecision({ facts: f, stage })
      const text = [bar.title, ...bar.notes.filter(n => !n.raw?.length).map(n => n.text), ...bar.buttons.map(b => b.label), ...bar.costLines.map(c => c.text)].join('\n')
      expect(scanFirstLayerText(text, ['deepseek-v4-flash'])).toEqual([])
    }
    scan('build'); approve(f, p); addReport(f, r, 'failed'); const repair = addChange(f, r, 'repair'); scan('test')
    approve(f, repair); r.status = 'testing'; scan('test'); r.status = 'completed'; const e = addReport(f, r)
    f.freshness.states = { [e.id]: 'current' }; scan('test'); f.freshness.states = { [e.id]: 'stale' }; scan('test')
  })
})
