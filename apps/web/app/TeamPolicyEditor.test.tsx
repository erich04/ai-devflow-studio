import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createWarnOnlyDefaultPolicy } from '@ai-devflow/shared'
import { TeamPolicyEditor } from './TeamPolicyEditor'
import type { TeamPolicyResult } from './team-policy-actions'

const policy = createWarnOnlyDefaultPolicy({ organizationId: 'org-test' })
function setup(canEdit = true) {
  const read = vi.fn<() => Promise<TeamPolicyResult>>().mockResolvedValue({ ok: true, policy, source: 'persisted' })
  const save = vi.fn<() => Promise<TeamPolicyResult>>().mockResolvedValue({ ok: true, policy: { ...policy, version: 2 }, source: 'persisted' })
  render(<TeamPolicyEditor initialPolicy={policy} initialSource="default" canEdit={canEdit} readAction={read} saveAction={save} />)
  return { read, save }
}

describe('Team Policy authoring', () => {
  it('previews actual action changes before any write and persists only after confirmation', async () => {
    const { save } = setup()
    fireEvent.click(screen.getByRole('button', { name: '使用 Recommended 预设' }))
    expect(save).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '预览变更' }))
    const preview = screen.getByRole('region', { name: 'Policy 变更预览' })
    expect(within(preview).getAllByText(/warn → block/)).toHaveLength(4)
    expect(screen.getByLabelText('规则 1 动作')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '确认保存' }))
    expect(await screen.findByRole('status')).toHaveTextContent('v2')
    expect(save).toHaveBeenCalledOnce()
    expect(screen.getByText('Team 已保存')).toBeInTheDocument()
  })

  it('shows all rules to members without exposing mutation controls', () => {
    setup(false)
    expect(screen.getByRole('table').querySelectorAll('tbody tr')).toHaveLength(10)
    expect(screen.queryByRole('button', { name: '预览变更' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('blocks invalid non-overridable probabilistic findings before preview', () => {
    const { save } = setup()
    fireEvent.click(screen.getByLabelText('规则 6 允许例外'))
    expect(screen.getByRole('alert')).toHaveTextContent('Agent findings cannot be hard-block')
    expect(screen.getByRole('button', { name: '预览变更' })).toBeDisabled()
    expect(save).not.toHaveBeenCalled()
  })

  it('can save the default rules as a persisted policy without falsely calling the fallback saved', async () => {
    setup()
    expect(screen.getByText('默认回退 · 尚未保存到 Team')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '预览变更' }))
    expect(screen.getByText('将当前默认规则首次保存到 Team，规则内容不变。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认保存' }))
    expect(await screen.findByRole('status')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '预览变更' })).toBeDisabled()
  })

  it('prevents repeated saves and requires authoritative read-back after an uncertain save', async () => {
    const { save, read } = setup()
    let finish!: (result: TeamPolicyResult) => void
    save.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    fireEvent.click(screen.getByRole('button', { name: '预览变更' }))
    fireEvent.click(screen.getByRole('button', { name: '确认保存' }))
    expect(screen.getByRole('button', { name: '正在保存并读取…' })).toBeDisabled()
    expect(save).toHaveBeenCalledOnce()
    await act(async () => finish({ ok: false, refreshRequired: true, error: '保存结果暂时无法确认' }))
    expect(screen.getByRole('button', { name: '确认保存' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '重新读取云端策略' }))
    expect(await screen.findByRole('status')).toBeInTheDocument()
    expect(read).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledOnce()
  })
})
