import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { createTeamProject, DevFlowApiError } from '../lib/devflow-api'
import { createProjectAction } from './project-actions'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('../lib/devflow-api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/devflow-api')>(),
  createTeamProject: vi.fn(),
}))

function input() {
  const data = new FormData()
  for (const [key, value] of Object.entries({
    name: ' Mini Agent ', slug: 'mini-agent', description: 'Small pilot.', repository: 'erich/mini-agent',
  })) data.set(key, value)
  return data
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: 'test-session' }) } as never)
})

describe('createProjectAction', () => {
  it('returns the created project and refreshes both project entry points', async () => {
    vi.mocked(createTeamProject).mockResolvedValue({ name: 'Mini Agent' } as never)
    await expect(createProjectAction(input())).resolves.toEqual({ ok: true, projectName: 'Mini Agent' })
    expect(createTeamProject).toHaveBeenCalledWith({
      name: 'Mini Agent', slug: 'mini-agent', description: 'Small pilot.', repository: 'erich/mini-agent',
      cookieHeader: 'devflow_session=test-session',
    })
    expect(revalidatePath).toHaveBeenCalledWith('/legacy-shell')
    expect(revalidatePath).toHaveBeenCalledWith('/')
  })

  it.each([
    [401, '登录已过期'], [403, '没有创建项目的权限'], [400, '项目信息无效'],
    [409, 'Slug 已存在'], [503, '暂时无法确认'],
  ])('returns recoverable feedback for HTTP %s without refreshing as success', async (status, message) => {
    vi.mocked(createTeamProject).mockRejectedValue(new DevFlowApiError('/api/team/projects', Number(status)))
    const result = await createProjectAction(input())
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining(String(message)) })
    if (status === 401) expect(result).toHaveProperty('authenticationRequired', true)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('does not expose transport details or discard an uncertain creation result', async () => {
    vi.mocked(createTeamProject).mockRejectedValue(new Error('private upstream details'))
    await expect(createProjectAction(input())).resolves.toEqual({
      ok: false, error: '项目创建结果暂时无法确认。请先刷新项目列表检查，再决定是否重试。',
    })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('rejects incomplete input before contacting the API', async () => {
    await expect(createProjectAction(new FormData())).resolves.toMatchObject({ ok: false })
    expect(createTeamProject).not.toHaveBeenCalled()
  })
})
