import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PairingCodePanel } from './PairingCodePanel'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('PairingCodePanel', () => {
  it('clears a copy-once code as soon as the selected project changes', async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'pair-p-one',
          organizationId: 'org-demo',
          projectId: 'p-one',
          createdByUserId: 'u-lead',
          code: 'p-one.copy-once-secret',
          expiresAt: '2026-08-01T12:10:00.000Z',
          createdAt: '2026-08-01T12:00:00.000Z',
          attemptsRemaining: 5,
        }),
        { status: 201 },
      ),
    )
    vi.stubGlobal('fetch', fetcher)
    const { rerender } = render(<PairingCodePanel projectId="p-one" />)

    fireEvent.click(screen.getByRole('button', { name: 'Create desktop pairing code' }))
    await waitFor(() => expect(screen.getByText('p-one.copy-once-secret')).toBeInTheDocument())

    rerender(<PairingCodePanel projectId="p-two" />)

    expect(screen.queryByText('p-one.copy-once-secret')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Desktop pairing code for p-two')).not.toBeInTheDocument()
  })

  it('ignores an old project response that arrives after selection changes', async () => {
    let resolveResponse!: (response: Response) => void
    const fetcher = vi.fn(
      () => new Promise<Response>((resolve) => {
        resolveResponse = resolve
      }),
    )
    vi.stubGlobal('fetch', fetcher)
    const { rerender } = render(<PairingCodePanel projectId="p-one" />)

    fireEvent.click(screen.getByRole('button', { name: 'Create desktop pairing code' }))
    expect(fetcher).toHaveBeenCalledWith('/api/pairing-code', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ projectId: 'p-one' }),
    })
    rerender(<PairingCodePanel projectId="p-two" />)

    await act(async () => {
      resolveResponse(
        new Response(
          JSON.stringify({
            id: 'pair-p-one',
            organizationId: 'org-demo',
            projectId: 'p-one',
            createdByUserId: 'u-lead',
            code: 'late.p-one-secret',
            expiresAt: '2026-08-01T12:10:00.000Z',
            createdAt: '2026-08-01T12:00:00.000Z',
            attemptsRemaining: 5,
          }),
          { status: 201 },
        ),
      )
    })

    expect(screen.queryByText('late.p-one-secret')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create desktop pairing code' })).toBeEnabled()
  })

  it('does not display a pairing code returned for a different project', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({
        id: 'pair-p-two',
        organizationId: 'org-demo',
        projectId: 'p-two',
        createdByUserId: 'u-lead',
        code: 'p-two.copy-once-secret',
        expiresAt: '2026-08-01T12:10:00.000Z',
        createdAt: '2026-08-01T12:00:00.000Z',
        attemptsRemaining: 5,
        token: 'must-not-reach-browser',
      }), { status: 201 }),
    ))
    render(<PairingCodePanel projectId="p-one" />)

    fireEvent.click(screen.getByRole('button', { name: 'Create desktop pairing code' }))

    await waitFor(() =>
      expect(screen.getByText('Pairing code response was invalid.')).toBeInTheDocument(),
    )
    expect(screen.queryByText('p-two.copy-once-secret')).not.toBeInTheDocument()
  })
})
