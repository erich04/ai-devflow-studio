import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectCreateForm } from './ProjectCreateForm'
import type { CreateProjectResult } from './project-actions'

function setup(createAction: (data: FormData) => Promise<CreateProjectResult>) {
  render(<ProjectCreateForm createAction={createAction} signInUrl="http://api.local/api/auth/github/start" />)
  for (const [label, value] of Object.entries({
    Name: 'Mini Agent', Slug: 'mini-agent', Repository: 'erich/mini-agent', Description: 'Small pilot.',
  })) fireEvent.change(screen.getByLabelText(label), { target: { value } })
  const form = screen.getByRole('button', { name: 'Create project' }).closest('form')!
  return { form }
}

beforeEach(() => vi.clearAllMocks())

describe('ProjectCreateForm', () => {
  it('keeps a loaded form recoverable when its session expires and allows retry after sign-in', async () => {
    const createAction = vi.fn<(data: FormData) => Promise<CreateProjectResult>>()
      .mockResolvedValueOnce({ ok: false, error: '登录已过期', authenticationRequired: true })
      .mockResolvedValueOnce({ ok: true, projectName: 'Mini Agent' })
    const { form } = setup(createAction)
    fireEvent.submit(form)
    expect(await screen.findByRole('alert')).toHaveTextContent('登录已过期')
    expect(screen.getByLabelText('Name')).toHaveValue('Mini Agent')
    expect(screen.getByLabelText('Slug')).toHaveValue('mini-agent')
    expect(screen.getByLabelText('Repository')).toHaveValue('erich/mini-agent')
    expect(screen.getByLabelText('Description')).toHaveValue('Small pilot.')
    const login = screen.getByRole('link', { name: /重新登录 GitHub/ })
    expect(login).toHaveAttribute('href', 'http://api.local/api/auth/github/start')
    expect(login).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('button', { name: 'Create project' })).toBeEnabled()

    fireEvent.submit(form)
    expect(await screen.findByRole('status')).toHaveTextContent('Mini Agent')
    expect(screen.getByRole('button', { name: 'Create project' })).toBeEnabled()
    expect(screen.getByLabelText('Name')).toHaveValue('')
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
    await act(async () => finish({ ok: true, projectName: 'Mini Agent' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create project' })).toBeEnabled())
  })

  it('retains inputs if the server action transport fails and does not suggest creation succeeded', async () => {
    const { form } = setup(vi.fn(async () => { throw new Error('private transport failure') }))
    fireEvent.submit(form)
    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法确认')
    expect(screen.getByLabelText('Name')).toHaveValue('Mini Agent')
    expect(screen.getByRole('button', { name: 'Create project' })).toBeEnabled()
  })
})
