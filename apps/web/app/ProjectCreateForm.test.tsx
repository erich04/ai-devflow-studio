import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectCreateForm } from './ProjectCreateForm'
import type { CreateProjectResult } from './project-actions'

function setup(createAction: (data: FormData) => Promise<CreateProjectResult>) {
  render(<ProjectCreateForm createAction={createAction} signInUrl="http://api.local/api/auth/github/start" />)
  for (const [label, value] of Object.entries({
    项目名称: 'Mini Agent', '项目标识（Slug）': 'mini-agent', 仓库: 'erich/mini-agent', 项目描述: 'Small pilot.',
  })) fireEvent.change(screen.getByLabelText(label), { target: { value } })
  const form = screen.getByRole('button', { name: '创建项目' }).closest('form')!
  return { form }
}

beforeEach(() => vi.clearAllMocks())

describe('ProjectCreateForm', () => {
  it('keeps a loaded form recoverable when its session expires and allows retry after sign-in', async () => {
    const createAction = vi.fn<(data: FormData) => Promise<CreateProjectResult>>()
      .mockResolvedValueOnce({ ok: false, error: '登录已过期', authenticationRequired: true })
      .mockResolvedValueOnce({ ok: true, projectName: 'Mini Agent', projectId: 'p-mini-agent' })
    const { form } = setup(createAction)
    fireEvent.submit(form)
    expect(await screen.findByRole('alert')).toHaveTextContent('登录已过期')
    expect(screen.getByLabelText('项目名称')).toHaveValue('Mini Agent')
    expect(screen.getByLabelText('项目标识（Slug）')).toHaveValue('mini-agent')
    expect(screen.getByLabelText('仓库')).toHaveValue('erich/mini-agent')
    expect(screen.getByLabelText('项目描述')).toHaveValue('Small pilot.')
    const login = screen.getByRole('link', { name: /重新登录 GitHub/ })
    expect(login).toHaveAttribute('href', 'http://api.local/api/auth/github/start')
    expect(login).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('button', { name: '创建项目' })).toBeEnabled()

    fireEvent.submit(form)
    expect(await screen.findByRole('status')).toHaveTextContent('项目「Mini Agent」已创建，可以继续桌面配对。')
    expect(screen.getByRole('button', { name: '创建项目' })).toBeEnabled()
    expect(screen.getByLabelText('项目名称')).toHaveValue('')
    expect(createAction.mock.calls[1]![0].get('slug')).toBe('mini-agent')
  })

  it('prevents duplicate submissions while creation is pending', async () => {
    let finish!: (value: CreateProjectResult) => void
    const createAction = vi.fn(() => new Promise<CreateProjectResult>((resolve) => { finish = resolve }))
    const { form } = setup(createAction)
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(createAction).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: '创建中…' })).toBeDisabled()
    await act(async () => finish({ ok: true, projectName: 'Mini Agent', projectId: 'p-mini-agent' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '创建项目' })).toBeEnabled())
  })

  it('retains inputs if the server action transport fails and does not suggest creation succeeded', async () => {
    const { form } = setup(vi.fn(async () => { throw new Error('private transport failure') }))
    fireEvent.submit(form)
    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法确认')
    expect(screen.getByLabelText('项目名称')).toHaveValue('Mini Agent')
    expect(screen.getByRole('button', { name: '创建项目' })).toBeEnabled()
  })
})
