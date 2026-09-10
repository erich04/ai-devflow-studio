import { expect, it, vi } from 'vitest'
import { redirect } from 'next/navigation'
import Page from './page'
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
it('retains old bookmarks through the unified read and write interface', async () => {
  await Page({ searchParams: Promise.resolve({ projectId: 'p-test' }) })
  expect(redirect).toHaveBeenCalledWith('/?view=team&projectId=p-test')
})
