import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createRecommendedEnforcementPreset, createWarnOnlyDefaultPolicy } from '@ai-devflow/shared'
import { EnforcementPolicyPanel } from './EnforcementPolicyPanel'
import type { EnforcementPolicyResult } from './enforcement-policy-actions'

const initialPolicy = createWarnOnlyDefaultPolicy({ organizationId: 'org-test' })
const saved = createRecommendedEnforcementPreset({ organizationId: 'org-test', updatedAt: '2026-09-10T12:00:00Z' })

describe('EnforcementPolicyPanel', () => {
  it('guards repeated submissions and displays the confirmed snapshot without reloading', async () => {
    let resolve!: (result: EnforcementPolicyResult) => void
    const update = vi.fn(() => new Promise<EnforcementPolicyResult>((done) => { resolve = done }))
    render(<EnforcementPolicyPanel initialPolicy={initialPolicy} updateAction={update} />)
    const form = screen.getByRole('button', { name: 'Apply recommended enforcement' }).closest('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(update).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '正在读取并确认…' })).toBeDisabled()
    await act(async () => { resolve({ ok: true, policy: saved }) })
    expect(screen.getByText('4 条')).toBeInTheDocument()
    expect(screen.getByText(saved.updatedAt)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '推荐策略已应用' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('已读取云端最新策略')
  })

  it('retains inline failure and switches uncertain write retries to reading', async () => {
    const update = vi.fn().mockResolvedValueOnce({ ok: false, refreshRequired: true, error: '保存结果暂时无法确认' })
      .mockResolvedValueOnce({ ok: true, policy: saved })
    render(<EnforcementPolicyPanel initialPolicy={initialPolicy} updateAction={update} />)
    fireEvent.click(screen.getByRole('button', { name: 'Apply recommended enforcement' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('保存结果暂时无法确认')
    fireEvent.click(screen.getByRole('button', { name: '重新读取云端策略' }))
    await screen.findByRole('status')
    expect(update.mock.calls.map((call) => call[1])).toEqual(['apply', 'refresh'])
  })

  it('updates the displayed snapshot when the server refreshes the page props', () => {
    const update = vi.fn()
    const { rerender } = render(<EnforcementPolicyPanel initialPolicy={initialPolicy} updateAction={update} />)
    rerender(<EnforcementPolicyPanel initialPolicy={saved} updateAction={update} />)
    expect(screen.getByText(saved.name)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '推荐策略已应用' })).toBeDisabled()
    expect(update).not.toHaveBeenCalled()
  })
})
