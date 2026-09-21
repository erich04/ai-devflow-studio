import { fireEvent, render, screen } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { OrganizationManager } from './OrganizationManager'

it('prevents native GET submission of invitation credentials before hydration', () => {
  const html = renderToStaticMarkup(<OrganizationManager initial={{ selectedOrganizationId: 'org-a', multiOrganizationEnabled: true, organizations: [
    { id: 'org-a', name: 'Team A', slug: 'a', role: 'owner', status: 'active', userId: 'u-a' },
  ] }} projects={[]} requestAction={vi.fn()} />)
  const document = new DOMParser().parseFromString(html, 'text/html')
  expect(document.querySelector('input[name="token"]')?.closest('form')?.method).toBe('post')
  expect(Array.from(document.querySelectorAll('button')).every(button => button.disabled || button.closest('fieldset')?.disabled)).toBe(true)
})

it('reloads live authority after editing the signed-in member instead of querying with the old owner role', async () => {
  const selected = vi.fn()
  const request = vi.fn().mockResolvedValueOnce({ ok: true, data: { members: [{ userId: 'u-a', name: 'Alice', providerAccountId: '101', role: 'owner', status: 'active', projects: [] }] } }).mockResolvedValueOnce({ ok: true, data: { updated: true } })
  render(<OrganizationManager initial={{ selectedOrganizationId: 'org-a', multiOrganizationEnabled: true, organizations: [
    { id: 'org-a', name: 'Team A', slug: 'a', role: 'owner', status: 'active', userId: 'u-a' },
  ] }} projects={[]} requestAction={request} onSelected={selected} />)
  fireEvent.click(screen.getByRole('button', { name: '加载或刷新成员' }))
  fireEvent.click(await screen.findByRole('button', { name: '保存 Alice 的权限' }))
  await vi.waitFor(() => expect(selected).toHaveBeenCalledOnce())
  expect(request).toHaveBeenCalledTimes(2)
})

it('makes an organization switch explicit and retains the current view when it fails', async () => {
  const request = vi.fn().mockResolvedValue({ ok: false, status: 403, error: '没有此组织的访问权限' })
  const selected = vi.fn()
  render(<OrganizationManager initial={{ selectedOrganizationId: 'org-a', multiOrganizationEnabled: true, organizations: [
    { id: 'org-a', name: 'Team A', slug: 'a', role: 'member', status: 'active', userId: 'u-a' },
    { id: 'org-b', name: 'Team B', slug: 'b', role: 'member', status: 'active', userId: 'u-b' },
  ] }} projects={[]} requestAction={request} onSelected={selected} />)
  expect(request).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '切换到 Team B' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('没有此组织的访问权限')
  expect(selected).not.toHaveBeenCalled()
  expect(request).toHaveBeenCalledWith('/api/organizations/org-b/select', 'POST')
})

it('keeps existing organizations selectable when new organization onboarding is disabled', () => {
  render(<OrganizationManager initial={{ selectedOrganizationId: 'org-a', multiOrganizationEnabled: false, organizations: [
    { id: 'org-a', name: 'Archived team', slug: 'a', role: 'member', status: 'archived', userId: 'u-a' },
  ] }} projects={[]} requestAction={vi.fn()} />)
  expect(screen.queryByRole('button', { name: '创建组织' })).not.toBeInTheDocument()
  expect(screen.getByText(/当前部署未开放新组织入驻/)).toBeInTheDocument()
  expect(screen.getAllByText(/已归档/).length).toBeGreaterThan(0)
})
