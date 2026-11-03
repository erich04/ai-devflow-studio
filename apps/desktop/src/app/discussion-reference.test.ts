import { afterEach, describe, expect, it } from 'vitest'
import {
  MAX_REFERENCE_LABEL,
  MAX_REFERENCES_PER_CONVERSATION,
  addDiscussionReference,
  buildDiscussionReference,
  composeMessageWithReferences,
  loadDiscussionReferences,
  referenceChipLabel,
  saveDiscussionReferences,
} from './discussion-reference'

const base = {
  materialId: 'artifact-1', materialTitle: '需求澄清', version: '需求 v2',
  projectName: '任务清单', runTitle: '清理任务', stageLabel: '需求澄清', stepTitle: '需求确认 Gate',
  readAt: '2026-09-28T02:00:00.000Z',
}

afterEach(() => localStorage.clear())

describe('discussion references (plan W7)', () => {
  it('prepends the named material, version, scope and read time to the typed text', () => {
    const text = composeMessageWithReferences([buildDiscussionReference({ ...base, excerpt: '意见：补充空态文案' })], '这样够吗？')
    expect(text).toMatch(/^【引用材料】需求澄清（需求 v2）\n项目：任务清单 · 任务：清理任务 · 阶段：需求澄清 · 步骤：需求确认 Gate\n读取时间：/)
    expect(text).toContain('之后材料可能已更新')
    expect(text).toContain('引用内容：\n意见：补充空态文案')
    expect(text.endsWith('\n\n这样够吗？')).toBe(true)
    expect(composeMessageWithReferences([], '只有文字')).toBe('只有文字')
  })

  it('keeps one card per material version and a bounded number of cards', () => {
    const first = buildDiscussionReference(base)
    const again = buildDiscussionReference({ ...base, readAt: '2026-09-28T03:00:00.000Z' })
    expect(addDiscussionReference([first], again)).toEqual([again])
    let cards = [first]
    for (let index = 0; index < 5; index += 1) cards = addDiscussionReference(cards, buildDiscussionReference({ ...base, materialId: `m-${index}` }))
    expect(cards).toHaveLength(MAX_REFERENCES_PER_CONVERSATION)
    expect(cards.at(-1)?.materialId).toBe('m-4')
  })

  it('bounds long excerpts', () => {
    const reference = buildDiscussionReference({ ...base, excerpt: 'x'.repeat(5000) })
    expect(reference.excerpt!.length).toBeLessThanOrEqual(1501)
  })

  it('stores cards per conversation as local UI state and ignores invalid stored values', () => {
    const reference = buildDiscussionReference(base)
    expect(saveDiscussionReferences('project-1', 'chat-1', [reference])).toBe(true)
    expect(loadDiscussionReferences('project-1', 'chat-1')).toEqual([reference])
    expect(loadDiscussionReferences('project-1', 'chat-2')).toEqual([])
    localStorage.setItem('devflow-discussion-references:project-1:chat-3', JSON.stringify([{ id: 1 }, 'x']))
    expect(loadDiscussionReferences('project-1', 'chat-3')).toEqual([])
    localStorage.setItem('devflow-discussion-references:project-1:chat-4', '{broken')
    expect(loadDiscussionReferences('project-1', 'chat-4')).toEqual([])
    expect(saveDiscussionReferences('project-1', 'chat-1', [])).toBe(true)
    expect(localStorage.getItem('devflow-discussion-references:project-1:chat-1')).toBeNull()
  })

  it('builds one chip line of 1–120 characters for every reference (finding 25)', () => {
    expect(referenceChipLabel({ label: '需求 v1 · 意见 2 · 重要', materialTitle: '需求澄清结果', version: '需求 v1' })).toBe('需求 v1 · 意见 2 · 重要')
    expect(referenceChipLabel({ materialTitle: '需求澄清', version: '需求 v2' })).toBe('需求澄清（需求 v2）')
    const long = referenceChipLabel({ materialTitle: '题'.repeat(200), version: '需求 v1' })
    expect(long).toHaveLength(MAX_REFERENCE_LABEL)
    expect(long.endsWith('…')).toBe(true)
    // A surrogate pair at the cut is never split.
    const emoji = referenceChipLabel({ label: `${'a'.repeat(118)}😀${'b'.repeat(10)}`, materialTitle: 'x', version: 'v' })
    expect(emoji).toBe(`${'a'.repeat(118)}…`)
    expect(emoji.length).toBeLessThanOrEqual(MAX_REFERENCE_LABEL)
    expect(referenceChipLabel({ materialTitle: '第一行\n第二行\t\0结尾\u0007', version: '需求 v1' })).toBe('第一行 第二行 结尾（需求 v1）')
    expect(referenceChipLabel({ label: ' \n\0 ', materialTitle: 'x', version: 'v' })).toBe('引用材料')
  })

  it('keeps an optional label and drops stored references with an empty or over-long one', () => {
    const labelled = buildDiscussionReference({ ...base, label: '需求 v2 · 问题 1' })
    expect(labelled.label).toBe('需求 v2 · 问题 1')
    const unlabelled = buildDiscussionReference(base)
    localStorage.setItem('devflow-discussion-references:project-1:chat-5', JSON.stringify([
      labelled, unlabelled, { ...unlabelled, id: 'empty', label: '' }, { ...unlabelled, id: 'long', label: 'x'.repeat(121) },
    ]))
    expect(loadDiscussionReferences('project-1', 'chat-5')).toEqual([labelled, unlabelled])
  })
})
