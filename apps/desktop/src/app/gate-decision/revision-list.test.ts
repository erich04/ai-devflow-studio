import { describe, expect, it } from 'vitest'
import type { Artifact } from '@ai-devflow/shared'
import { buildF1, buildF3, buildF4, buildF5, nodeIdsOf } from '../../testing/gate-fixtures'
import {
  applyRevisionListOp, composeRevisionText, deriveChatItems, emptyRevisionList, findStoredList, importLegacyDrafts, isListSubmitted, listKey,
  measureRevisionText, numberItems, otherListsOf, parseRevisionListStore, parseRevisionTextHeader, type ListTarget, type RevisionListOp, type StoredRevisionList,
} from './revision-list'
const digest = 'a'.repeat(64)
const target: ListTarget = { kind: 'requirement', runId: 'gate-run', artifactId: 'gate-run-clarification-v1', revision: 1, revisionDigest: digest }
const t = (second: number) => `2026-10-30T09:00:${String(second).padStart(2, '0')}.000Z`
function apply(list: StoredRevisionList, ...ops: RevisionListOp[]): StoredRevisionList {
  return ops.reduce((current, op, index) => {
    const result = applyRevisionListOp(current, op, t(index + 1))
    if (!result.ok) throw new Error(result.message)
    return result.list
  }, list)
}
const finding = (index: number, text = `意见 ${index + 1} 原文`) => ({ reviewId: 'review-f1', index, text })
const proposal = (id: string, nodeId: string, updatedAt: string, title = '答疑提案'): Artifact =>
  ({ id: `conversation-proposal-${id}`, runId: 'gate-run', nodeId, kind: 'log', title, summary: '', content: '提案正文', redacted: true, updatedAt })
describe('keys and storage', () => {
  it('keys a list by the exact version', () => {
    expect(listKey(target)).toBe(`requirement:gate-run:gate-run-clarification-v1:1:${digest}`)
    expect(listKey({ kind: 'design', runId: 'r', artifactId: 'd', updatedAt: 'u', contentDigest: digest })).toBe(`design:r:d:u:${digest}`)
  })
  it('drops corrupted lists and items one by one and counts them', () => {
    const good = apply(emptyRevisionList(target, t(0)), { type: 'addOwn', text: '补一条' })
    const raw = JSON.stringify({ version: 1, lists: {
      [listKey(target)]: { ...good, items: [...good.items, { id: 'x', source: 'finding', addedAt: t(1), text: 'no finding ref' }], declined: [{ reviewId: 1 }] },
      'requirement:wrong-key': good,
      [`design:r:d:u:${digest}`]: { version: 1, target: { kind: 'design', runId: 'r', artifactId: 'd', updatedAt: 'u', contentDigest: 'short' } },
    } })
    const { store, dropped } = parseRevisionListStore(raw)
    expect(Object.keys(store.lists)).toEqual([listKey(target)])
    expect(store.lists[listKey(target)]!.items).toEqual(good.items)
    expect(dropped).toBe(4)
    expect(parseRevisionListStore('{not json')).toEqual({ store: { version: 1, lists: {} }, dropped: 1 })
    expect(parseRevisionListStore(null)).toEqual({ store: { version: 1, lists: {} }, dropped: 0 })
  })
  it('imports #247 drafts with the exact field mapping (AC24)', () => {
    const items = importLegacyDrafts('v1', [
      { reviewId: 'old-review', index: 1, issue: '原意见二', finding: ' 已核实 ', change: '改成每页 20 条' },
      { reviewId: 'review-f1', index: 3, issue: '原意见四', finding: '', change: '' },
      { reviewId: 'review-f1', index: 4, issue: '原意见五', finding: 'x'.repeat(1001), change: '' },
    ], '  其他修订说明  ', t(0))
    expect(items.map(({ id, source, text, addedAt, imported }) => ({ id, source, text: text.slice(0, 20), addedAt, imported }))).toEqual([
      { id: 'imported-s-old-review-1', source: 'finding', text: '改成每页 20 条\n核实结论：已核实', addedAt: '2026-10-30T09:00:00.000Z', imported: 'revision-suggestion' },
      { id: 'imported-s-review-f1-3', source: 'finding', text: '原意见四', addedAt: '2026-10-30T09:00:00.001Z', imported: 'revision-suggestion' },
      { id: 'imported-s-review-f1-4', source: 'finding', text: `核实结论：${'x'.repeat(15)}`, addedAt: '2026-10-30T09:00:00.002Z', imported: 'revision-suggestion' },
      { id: 'imported-d-v1', source: 'own', text: '其他修订说明', addedAt: '2026-10-30T09:00:00.003Z', imported: 'revision-draft' },
    ])
    expect(items[0]!.finding).toEqual({ reviewId: 'old-review', index: 1, text: '原意见二' })
    expect(items[2]!.text.length).toBeGreaterThan(1000)           // kept; blocks submission instead
    // An item from another review than the bound one is tagged.
    expect(numberItems(items, [], 'review-f1').map((item) => item.tag)).toEqual(['较早的审查', undefined, undefined, undefined])
    expect(numberItems(items, [], 'review-f1').map((item) => item.label)).toEqual(['来自意见 2', '来自意见 4', '来自意见 5', '我添加的'])
  })
})
describe('operations', () => {
  it('adopts, unadopts, declines and undeclines one finding at a time', () => {
    let list = apply(emptyRevisionList(target, t(0)), { type: 'adopt', finding: finding(1) }, { type: 'decline', reviewId: 'review-f1', index: 2 })
    expect(list.items.map((item) => item.id)).toEqual(['f-review-f1-1'])
    expect(list.declined).toEqual([{ reviewId: 'review-f1', index: 2 }])
    const firstAdded = list.items[0]!.addedAt
    const readopted = applyRevisionListOp(list, { type: 'adopt', finding: finding(1) }, t(30))   // re-adopting gets a new addedAt
    if (!readopted.ok) throw new Error(readopted.message)
    list = readopted.list
    expect(list.items).toHaveLength(1)
    expect(list.items[0]!.addedAt).not.toBe(firstAdded)
    list = apply(list, { type: 'adopt', finding: finding(2) })    // adopting a declined finding clears the decline
    expect(list.declined).toEqual([])
    list = apply(list, { type: 'unadopt', reviewId: 'review-f1', index: 1 }, { type: 'decline', reviewId: 'review-f1', index: 2 }, { type: 'undecline', reviewId: 'review-f1', index: 2 })
    expect(list.items).toEqual([])
    expect(list.declined).toEqual([])
    list = apply(list, { type: 'adoptAllSuggestions', findings: [finding(3), finding(4)] })
    expect(numberItems(list.items).map((item) => item.label)).toEqual(['来自意见 4', '来自意见 5'])
  })
  it('answers, changes the answer in place and clears it', () => {
    const question = { index: 1, text: '是否允许搜索已归档的任务？', merged: [] }
    let list = apply(emptyRevisionList(target, t(0)), { type: 'addOwn', text: '先加一条' }, { type: 'answer', question, answer: '允许' })
    expect(numberItems(list.items).map((item) => [item.number, item.label, item.text])).toEqual([[1, '我添加的', '先加一条'], [2, '来自问题 2', '允许']])
    list = apply(list, { type: 'answer', question, answer: '只允许最近 30 天' })
    expect(numberItems(list.items).map((item) => [item.number, item.text])).toEqual([[1, '先加一条'], [2, '只允许最近 30 天']])
    list = apply(list, { type: 'clearAnswer', index: 1 })
    expect(list.items.map((item) => item.source)).toEqual(['own'])
  })
  it('renumbers every item after removing item 1 (AC23)', () => {
    let list = apply(emptyRevisionList(target, t(0)), { type: 'addOwn', text: '一' }, { type: 'adopt', finding: finding(1) }, { type: 'addOwn', text: '三' })
    const numbered = numberItems(list.items)
    expect(numbered.map((item) => item.number)).toEqual([1, 2, 3])
    list = apply(list, { type: 'remove', itemId: numbered[0]!.id })
    expect(numberItems(list.items).map((item) => [item.number, item.label])).toEqual([[1, '来自意见 2'], [2, '我添加的']])
  })
  it('validates text and rejects unknown items', () => {
    const list = emptyRevisionList(target, t(0))
    expect(applyRevisionListOp(list, { type: 'addOwn', text: '   ' }, t(1))).toEqual({ ok: false, message: '请写下要修改的内容。' })
    expect(applyRevisionListOp(list, { type: 'addOwn', text: 'x'.repeat(1001) }, t(1))).toEqual({ ok: false, message: '最多 1000 字，现在 1001 字。' })
    expect(applyRevisionListOp(list, { type: 'edit', itemId: 'nope', text: 'x' }, t(1))).toEqual({ ok: false, message: '这一项已不在修订清单里。' })
    expect(applyRevisionListOp(list, { type: 'remove', itemId: 'nope' }, t(1))).toEqual({ ok: false, message: '这一项已不在修订清单里。' })
    expect(applyRevisionListOp(list, { type: 'chatNote', proposalId: 'p', note: 'x'.repeat(1001) }, t(1))).toEqual({ ok: false, message: '说明最多 1000 字，现在 1001 字。' })
    const own = apply(list, { type: 'addOwn', text: '原文' })
    expect(apply(own, { type: 'edit', itemId: own.items[0]!.id, text: ' 新文字 ' }).items[0]!.text).toBe('新文字')
  })
  it('removes, re-adds and annotates chat items and records submission with the generation choice', () => {
    let list = apply(emptyRevisionList(target, t(0)), { type: 'chatRemove', proposalId: 'p1' })
    expect(list.chat.p1).toEqual({ removed: true })
    list = apply(list, { type: 'chatReAdd', proposalId: 'p1' }, { type: 'chatNote', proposalId: 'p1', note: '只采用第二段' })
    expect(list.chat.p1).toEqual({ addedAt: t(1), note: '只采用第二段' })
    list = apply(list, { type: 'markSubmitted', text: 'T', proposals: [], itemCount: 1, feedbackArtifactId: 'fb', generation: { executor: 'native-agent', providerId: 'deepseek' } },
      { type: 'markConfirmedWithout', count: 2 })
    expect(list.submitted).toEqual({ at: t(1), text: 'T', proposals: [], itemCount: 1, feedbackArtifactId: 'fb', generation: { executor: 'native-agent', providerId: 'deepseek' } })
    expect(list.confirmedWithout).toEqual({ at: t(2), count: 2 })
    expect(parseRevisionListStore(JSON.stringify({ version: 1, lists: { [listKey(target)]: list } })).store.lists[listKey(target)]).toEqual(list)
  })
})
describe('derived chat items (§5.5)', () => {
  it('lists unused proposals of the stage, minus covered and removed ones; a removal carries forward', async () => {
    const f1 = await buildF1()
    const ids = nodeIdsOf()
    // v1 records inputProposals, so no proposal counts as considered by an unrecorded generation.
    const agentLate = proposal('agent', ids.clarify, '2026-10-30T08:30:00.000Z')
    const gate = proposal('gate', ids.clarifyGate, '2026-10-30T08:31:00.000Z')
    const otherStage = proposal('design', ids.design, '2026-10-30T08:32:00.000Z')
    const artifacts = [...f1.artifacts, agentLate, gate, otherStage]
    const base = { kind: 'requirement' as const, runId: 'gate-run', agentNodeId: ids.clarify, gateNodeId: ids.clarifyGate, artifacts, otherLists: [] }
    expect(deriveChatItems({ ...base, list: undefined }).map((item) => item.proposal.id)).toEqual([agentLate.id, gate.id])
    // Used by a revision's inputProposals or a submitted feedback.
    const used = artifacts.map((artifact) => artifact.id === f1.current.id
      ? { ...artifact, clarificationRevision: { ...artifact.clarificationRevision!, inputProposals: [{ artifactId: agentLate.id, updatedAt: agentLate.updatedAt, contentDigest: digest }] } } : artifact)
    expect(deriveChatItems({ ...base, artifacts: used, list: undefined }).map((item) => item.proposal.id)).toEqual([gate.id])
    // A legacy revision without inputProposals read every agent-node proposal saved before it started.
    const legacy = artifacts.map((artifact) => artifact.id === f1.current.id
      ? { ...artifact, clarificationRevision: { ...artifact.clarificationRevision!, inputProposals: undefined, executor: { ...artifact.clarificationRevision!.executor, startedAt: '2026-10-30T09:00:00.000Z' } } } as unknown as Artifact : artifact)
    expect(deriveChatItems({ ...base, artifacts: legacy, list: undefined }).map((item) => item.proposal.id)).toEqual([gate.id])
    // Removed in an earlier list: stays removed in the next one, unless this list re-adds it.
    const earlier = apply(emptyRevisionList(target, t(0)), { type: 'chatRemove', proposalId: gate.id })
    const next = emptyRevisionList({ ...target, artifactId: 'v2', revision: 2 }, t(0))
    expect(deriveChatItems({ ...base, list: next, otherLists: [earlier] }).map((item) => item.proposal.id)).toEqual([agentLate.id])
    const readded = apply(next, { type: 'chatReAdd', proposalId: gate.id })
    const items = deriveChatItems({ ...base, list: readded, otherLists: [earlier] })
    expect(items.map((item) => [item.proposal.id, item.addedAt])).toEqual([[agentLate.id, agentLate.updatedAt], [gate.id, t(1)]])
  })
})
describe('composition (§5.6)', () => {
  it('composes every source in list order without ids (AC26)', async () => {
    let list = apply(emptyRevisionList(target, t(0)),
      { type: 'adopt', finding: finding(1, '两条验收标准都没有说明多个关键词的处理方式。'), text: '补一条：多个关键词时需全部包含。' },
      { type: 'answer', question: { index: 0, text: '搜索是否区分大小写？', merged: [{ reviewId: 'review-f1', index: 0, text: '待确认问题 1 没有结论。' }] }, answer: '不区分' },
      { type: 'addOwn', text: '在验收标准里补一条失败时的提示' },
      { type: 'adopt', finding: finding(3, '非目标可以补充为什么不做全文检索。') },
      { type: 'chatNote', proposalId: 'conversation-proposal-p', note: '只用第二段' })
    const chat = [{ proposal: proposal('p', 'gate-run-clarify', t(3), '搜索结果排序'), addedAt: t(3), note: '只用第二段' }]
    const items = numberItems(list.items, chat, 'review-f1')
    const text = composeRevisionText(items, { kind: 'requirement', version: '需求 v1' })
    expect(text).toBe([
      '修订清单（共 5 项，针对需求 v1）：',
      '1. 来自意见 2：补一条：多个关键词时需全部包含。',
      '   审查意见原文：两条验收标准都没有说明多个关键词的处理方式。',
      '2. 来自问题 1：待确认问题「搜索是否区分大小写？」的回答是：不区分。请把这个决定写进需求正文的相应位置，并从待确认问题中删除这个问题。',
      '   这个回答也处理了审查意见 1：待确认问题 1 没有结论。',
      '3. 来自答疑：采用已保存的答疑提案「搜索结果排序」（提交这份修订清单时随附全文）。补充说明：只用第二段',
      '4. 我添加的：在验收标准里补一条失败时的提示',
      '5. 来自意见 4：非目标可以补充为什么不做全文检索。',
    ].join('\n'))
    expect(text).not.toMatch(/review-f1|gate-run|conversation-proposal/u)
    expect(parseRevisionTextHeader(text)).toEqual({ count: 5, kind: 'requirement', version: 1 })
    expect(parseRevisionTextHeader('请补充')).toBeUndefined()
    const design = composeRevisionText(numberItems([]), { kind: 'design', version: '方案 v2' })
    expect(parseRevisionTextHeader(design)).toEqual({ count: 0, kind: 'design', version: 2 })
    list = apply(list, { type: 'remove', itemId: list.items[0]!.id })
    expect(composeRevisionText(numberItems(list.items), { kind: 'requirement', version: '需求 v1' })).toMatch(/^修订清单（共 3 项/u)
    // The 来自答疑 line without a note.
    expect(composeRevisionText(numberItems([], [{ ...chat[0]!, note: undefined } as never]), { kind: 'requirement', version: '需求 v1' }))
      .toContain('1. 来自答疑：采用已保存的答疑提案「搜索结果排序」（提交这份修订清单时随附全文）。')
    // An answer that already ends a sentence gets no second 「。」.
    const ended = apply(emptyRevisionList(target, t(0)), { type: 'answer', question: { index: 0, text: '搜索是否区分大小写？', merged: [] }, answer: '不区分。' })
    expect(composeRevisionText(numberItems(ended.items), { kind: 'requirement', version: '需求 v1' }))
      .toContain('的回答是：不区分。请把这个决定写进需求正文的相应位置')
  })
  it('reports an overflow with the exact counts and never truncates (AC27)', () => {
    expect(measureRevisionText('x'.repeat(4000))).toEqual({ length: 4000, limit: 4000, over: 0 })
    expect(measureRevisionText('x'.repeat(4123))).toEqual({ length: 4123, limit: 4000, over: 123, reason: '修订内容共 4123 字，超过上限 4000 字（多 123 字）。请精简后再提交。' })
  })
})
describe('submitted lists and lookups', () => {
  it('counts a list as submitted from the flag, a feedback record or a design lineage', async () => {
    const f3 = await buildF3()
    const v1 = f3.previous!
    const requirement = emptyRevisionList({ kind: 'requirement', runId: f3.run.id, artifactId: v1.id, revision: 1, revisionDigest: v1.clarificationRevision!.revisionDigest }, t(0))
    expect(isListSubmitted(requirement, f3.artifacts)).toBe(true)
    expect(isListSubmitted(requirement, f3.artifacts.filter((artifact) => artifact.kind !== 'clarification_feedback'))).toBe(false)
    expect(isListSubmitted(apply(requirement, { type: 'markSubmitted', text: 'x', proposals: [], itemCount: 0 }), [])).toBe(true)
    const f5 = await buildF5()
    const previous = f5.current.designRevision!.previous
    const design = emptyRevisionList({ kind: 'design', runId: f5.run.id, artifactId: previous.artifactId, updatedAt: previous.updatedAt, contentDigest: previous.contentDigest }, t(0))
    expect(isListSubmitted(design, f5.artifacts)).toBe(true)
    const f4 = await buildF4()
    expect(isListSubmitted(design, f4.artifacts)).toBe(false)
  })
  it('finds a history list without a digest and lists the other lists of the stage', () => {
    const older = apply(emptyRevisionList(target, t(0)), { type: 'addOwn', text: '旧' })
    const newer = { ...apply(emptyRevisionList({ ...target, revisionDigest: 'b'.repeat(64) }, t(5)), { type: 'addOwn', text: '新' }), updatedAt: t(9) }
    const store = { version: 1 as const, lists: { [listKey(older.target)]: older, [listKey(newer.target)]: newer } }
    expect(findStoredList(store, { kind: 'requirement', runId: 'gate-run', reading: { id: target.artifactId, updatedAt: 'x' }, revision: 1 })).toBe(newer)
    expect(findStoredList(store, { kind: 'requirement', runId: 'gate-run', reading: { id: target.artifactId, updatedAt: 'x' }, revision: 2 })).toBeUndefined()
    expect(otherListsOf(store, { kind: 'requirement', runId: 'gate-run', exceptKey: listKey(newer.target) })).toEqual([older])
  })
})
