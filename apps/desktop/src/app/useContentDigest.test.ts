import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildDesignRevisionIdentity, type Artifact } from '@ai-devflow/shared'
import { clearContentDigestCacheForTests, useContentDigest, useDesignIdentity } from './useContentDigest'
const controls = vi.hoisted(() => ({ failNext: 0, designCalls: 0 }))
vi.mock('@ai-devflow/shared', async (importOriginal) => {
  const original = await importOriginal<typeof import('@ai-devflow/shared')>()
  return {
    ...original,
    sha256Text: (value: string) => {
      if (controls.failNext > 0) { controls.failNext--; return Promise.reject(new Error('SubtleCrypto unavailable')) }
      return original.sha256Text(value)
    },
    createDesignRevisionDigest: (artifact: Pick<Artifact, 'title' | 'summary' | 'content'>) => { controls.designCalls++; return original.createDesignRevisionDigest(artifact) },
  }
})
beforeEach(() => {
  clearContentDigestCacheForTests()
  controls.failNext = 0
  controls.designCalls = 0
})
afterEach(cleanup)
function recording<T extends { state: string }>(hook: () => T) {
  const states: string[] = []
  const rendered = renderHook(() => { const value = hook(); states.push(value.state); return value })
  return { ...rendered, states }
}
describe('useContentDigest', () => {
  it('is pending on the first open and done on the first render of a second mount', async () => {
    const first = recording(() => useContentDigest('需求正文'))
    expect(first.states[0]).toBe('pending')
    await waitFor(() => expect(first.result.current.state).toBe('done'))
    expect(first.result.current.value).toMatch(/^[a-f0-9]{64}$/u)
    first.unmount()
    const second = recording(() => useContentDigest('需求正文'))
    expect(second.states[0]).toBe('done')
    second.unmount()
    clearContentDigestCacheForTests()
    const third = recording(() => useContentDigest('需求正文'))
    expect(third.states[0]).toBe('pending')
    await waitFor(() => expect(third.result.current.state).toBe('done'))
  })
  it('treats an undefined text as done without a value', () => {
    const { result } = renderHook(() => useContentDigest(undefined))
    expect(result.current.state).toBe('done')
    expect(result.current.value).toBeUndefined()
  })
  it('fails when the digest rejects and recomputes on retry()', async () => {
    controls.failNext = 1
    const { result } = renderHook(() => useContentDigest('会失败一次'))
    await waitFor(() => expect(result.current.state).toBe('failed'))
    expect(result.current.error).toBe('SubtleCrypto unavailable')
    act(() => result.current.retry())
    expect(result.current.state).toBe('pending')
    await waitFor(() => expect(result.current.state).toBe('done'))
  })
  it('keeps at most 20 digests, evicting the oldest first', async () => {
    for (let index = 0; index < 21; index++) {
      const { result, unmount } = renderHook(() => useContentDigest(`text-${index}`))
      await waitFor(() => expect(result.current.state).toBe('done'), { interval: 1 })
      unmount()
    }
    expect(recording(() => useContentDigest('text-20')).states[0]).toBe('done')
    expect(recording(() => useContentDigest('text-1')).states[0]).toBe('done')
    expect(recording(() => useContentDigest('text-0')).states[0]).toBe('pending')
  })
})
describe('useDesignIdentity', () => {
  const design = (id: string, updatedAt: string): Artifact => ({ id, runId: 'r', nodeId: 'design', kind: 'design', title: '方案设计', summary: '摘要',
    content: '## Implementation\n- 同样的正文\n', redacted: true, updatedAt })
  it('shares one digest between equal designs but keeps each design\'s own identity', async () => {
    const one = design('design-a', '2026-10-30T08:00:00.000Z')
    const two = design('design-b', '2026-10-30T09:00:00.000Z')
    const { result } = renderHook(() => ({ one: useDesignIdentity(one), two: useDesignIdentity(two) }))
    await waitFor(() => expect(result.current.two.state).toBe('done'))
    expect(controls.designCalls).toBe(1)
    expect(result.current.one.identity).toEqual(await buildDesignRevisionIdentity(one))
    expect(result.current.two.identity).toEqual(await buildDesignRevisionIdentity(two))
    expect(result.current.one.identity?.artifactId).not.toBe(result.current.two.identity?.artifactId)
    expect(result.current.one.identity?.contentDigest).toBe(result.current.two.identity?.contentDigest)
  })
  it('is done without an identity for no artifact', () => {
    const { result } = renderHook(() => useDesignIdentity(undefined))
    expect(result.current).toMatchObject({ state: 'done' })
    expect(result.current.identity).toBeUndefined()
  })
})
