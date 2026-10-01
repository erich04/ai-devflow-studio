import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { passedEvidenceApplicability, useTestEvidenceFreshness } from './test-evidence-freshness'

const evidence = { id: 'evidence-1', runId: 'run-1', createdAt: '2026-09-30T08:00:00.000Z' }

describe('test evidence applicability copy (hardening H3)', () => {
  it('only calls a result current when the tree fingerprint matches', () => {
    expect(passedEvidenceApplicability(evidence, 'current')).toMatchObject({ stale: false, text: expect.stringContaining('结果对应当前代码') })
    expect(passedEvidenceApplicability(evidence, 'stale')).toMatchObject({ stale: true, text: expect.stringContaining('结果已过期') })
    expect(passedEvidenceApplicability(evidence, 'unavailable').text).toContain('适用性无法核实')
    expect(passedEvidenceApplicability(evidence, 'unrecorded').text).toContain('证据没有记录所测代码的提交，适用性无法核实')
    expect(passedEvidenceApplicability(evidence, undefined).text).toContain('适用性无法核实')
  })
})

describe('useTestEvidenceFreshness', () => {
  it('reads freshness for the run, re-reads on focus, and never guesses on failure', async () => {
    const getTestEvidenceFreshness = vi.fn()
      .mockResolvedValueOnce([{ evidenceId: 'evidence-1', state: 'current' }])
      .mockResolvedValueOnce([{ evidenceId: 'evidence-1', state: 'stale' }])
      .mockRejectedValueOnce(new Error('git unavailable'))
      .mockResolvedValue([{ evidenceId: 'evidence-1', state: 'current' }])
    // A new API object on every render must not re-read (App passes the same bridge each time).
    const { result } = renderHook(() => useTestEvidenceFreshness({ getTestEvidenceFreshness }, 'run-1', [evidence]))
    await waitFor(() => expect(result.current).toEqual({ 'evidence-1': 'current' }))
    expect(getTestEvidenceFreshness).toHaveBeenCalledWith({ runId: 'run-1' })
    act(() => { window.dispatchEvent(new Event('focus')) })
    await waitFor(() => expect(result.current).toEqual({ 'evidence-1': 'stale' }))
    act(() => { window.dispatchEvent(new Event('focus')) })
    await waitFor(() => expect(result.current).toEqual({}))
    expect(getTestEvidenceFreshness).toHaveBeenCalledTimes(3)
  })

  it('does not call the main process without evidence for the run', () => {
    const getTestEvidenceFreshness = vi.fn()
    renderHook(() => useTestEvidenceFreshness({ getTestEvidenceFreshness }, 'run-2', [evidence]))
    expect(getTestEvidenceFreshness).not.toHaveBeenCalled()
  })
})
