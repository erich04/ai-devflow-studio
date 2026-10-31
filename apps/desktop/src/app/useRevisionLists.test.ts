import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyRevisionList, listKey, REVISION_LISTS_STORAGE_KEY, type ListTarget } from './gate-decision/revision-list'
import { REVISION_SUGGESTIONS_STORAGE_KEY } from './revision-suggestions'
import { REVISION_DRAFTS_STORAGE_KEY, useRevisionLists } from './useRevisionLists'
const digest = 'a'.repeat(64)
const target: ListTarget = { kind: 'requirement', runId: 'run', artifactId: 'v1', revision: 1, revisionDigest: digest }
const design: ListTarget = { kind: 'design', runId: 'run', artifactId: 'd1', updatedAt: '2026-10-30T08:00:00.000Z', contentDigest: digest }
const stored = () => JSON.parse(localStorage.getItem(REVISION_LISTS_STORAGE_KEY) ?? 'null')
beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
describe('useRevisionLists', () => {
  it('saves every operation under the exact version key and survives a remount', () => {
    const first = renderHook(() => useRevisionLists())
    expect(first.result.current.listFor(target)).toBeUndefined()
    let result: ReturnType<typeof first.result.current.apply> | undefined
    act(() => { result = first.result.current.apply(target, { type: 'addOwn', text: '补一条失败提示' }) })
    expect(result).toMatchObject({ ok: true })
    expect(first.result.current.listFor(target)?.items.map((item) => item.text)).toEqual(['补一条失败提示'])
    expect(Object.keys(stored().lists)).toEqual([listKey(target)])
    first.unmount()
    const second = renderHook(() => useRevisionLists())
    expect(second.result.current.listFor(target)?.items.map((item) => item.text)).toEqual(['补一条失败提示'])
    expect(second.result.current.listFor(design)).toBeUndefined()
  })
  it('returns a validation message without saving', () => {
    const { result } = renderHook(() => useRevisionLists())
    let outcome: ReturnType<typeof result.current.apply> | undefined
    act(() => { outcome = result.current.apply(target, { type: 'addOwn', text: '  ' }) })
    expect(outcome).toEqual({ ok: false, message: '请写下要修改的内容。' })
    expect(localStorage.getItem(REVISION_LISTS_STORAGE_KEY)).toBeNull()
  })
  it('imports #247 drafts in memory and deletes them for that artifact only on the first save (AC24)', () => {
    localStorage.setItem(REVISION_SUGGESTIONS_STORAGE_KEY, JSON.stringify({
      v1: [{ reviewId: 'review', index: 0, issue: '原意见', finding: '已核实', change: '改成这样' }],
      other: [{ reviewId: 'review', index: 1, issue: '别的版本', finding: '', change: '' }],
    }))
    localStorage.setItem(REVISION_DRAFTS_STORAGE_KEY, JSON.stringify({ v1: '自由文字', other: '保留' }))
    const { result } = renderHook(() => useRevisionLists())
    const imported = result.current.listFor(target)!
    expect(imported.items.map((item) => [item.id, item.text])).toEqual([['imported-s-review-0', '改成这样\n核实结论：已核实'], ['imported-d-v1', '自由文字']])
    expect(result.current.listFor(target)).toEqual(imported)                     // stable across reads
    expect(localStorage.getItem(REVISION_LISTS_STORAGE_KEY)).toBeNull()           // nothing saved by reading
    expect(JSON.parse(localStorage.getItem(REVISION_DRAFTS_STORAGE_KEY)!)).toEqual({ v1: '自由文字', other: '保留' })
    act(() => { result.current.apply(target, { type: 'addOwn', text: '新加的' }) })
    expect(stored().lists[listKey(target)].items.map((item: { id: string }) => item.id)).toEqual(['imported-s-review-0', 'imported-d-v1', expect.stringMatching(/^o-/u)])
    expect(Object.keys(JSON.parse(localStorage.getItem(REVISION_SUGGESTIONS_STORAGE_KEY)!))).toEqual(['other'])
    expect(JSON.parse(localStorage.getItem(REVISION_DRAFTS_STORAGE_KEY)!)).toEqual({ other: '保留' })
    expect(result.current.listFor(target)?.items).toHaveLength(3)                // not imported twice
  })
  it('counts unreadable stored entries in a notice', () => {
    const good = emptyRevisionList(target, '2026-10-30T09:00:00.000Z')
    localStorage.setItem(REVISION_LISTS_STORAGE_KEY, JSON.stringify({ version: 1, lists: { [listKey(target)]: good, broken: { version: 1 } } }))
    const { result } = renderHook(() => useRevisionLists())
    expect(result.current.droppedNotice).toBe('本机修订清单中有 1 条记录无法读取，已忽略。')
    expect(result.current.listFor(target)).toEqual(good)
  })
  it('keeps the change in memory when saving fails and returns the alert', () => {
    localStorage.setItem(REVISION_DRAFTS_STORAGE_KEY, JSON.stringify({ v1: '自由文字' }))
    const { result } = renderHook(() => useRevisionLists())
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError') })
    let outcome: ReturnType<typeof result.current.apply> | undefined
    act(() => { outcome = result.current.apply(target, { type: 'addOwn', text: '保存会失败' }) })
    expect(outcome).toEqual({ ok: false, message: '本机修订清单保存失败，页面上的内容仍保留；请复制后再关闭应用。' })
    expect(result.current.saveError).toBe('本机修订清单保存失败，页面上的内容仍保留；请复制后再关闭应用。')
    expect(result.current.listFor(target)?.items.map((item) => item.text)).toEqual(['自由文字', '保存会失败'])
    vi.restoreAllMocks()
    expect(JSON.parse(localStorage.getItem(REVISION_DRAFTS_STORAGE_KEY)!)).toEqual({ v1: '自由文字' })  // old draft kept
    act(() => { result.current.apply(target, { type: 'addOwn', text: '再试一次' }) })
    expect(result.current.saveError).toBeUndefined()
    expect(stored().lists[listKey(target)].items).toHaveLength(3)
  })
})
