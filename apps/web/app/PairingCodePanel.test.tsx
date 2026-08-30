import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PairingCodePanel } from './PairingCodePanel'

const pairingSubject = { userId: 'u-lead', userName: 'Ling', role: 'lead' as const }

function panel(projectId: string) {
  return (
    <PairingCodePanel
      projectId={projectId}
      projectName={projectId === 'p-one' ? 'Project One' : 'Project Two'}
      subject={pairingSubject}
    />
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('PairingCodePanel', () => {
  it('shows the signed-in subject before creation and disables anonymous issuance', () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const { rerender } = render(panel('p-one'))
    expect(screen.getByText((_, element) =>
      element?.classList.contains('pairing-subject') === true &&
      /Ling.*lead.*Project One.*lead/.test(element.textContent ?? ''),
    )).toBeInTheDocument()

    rerender(
      <PairingCodePanel projectId="p-one" projectName="Project One" subject={null} />,
    )
    expect(screen.getByRole('button', { name: 'Create desktop pairing code' })).toBeDisabled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects a code whose immutable subject differs from the signed-in member', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      id: 'pair-p-one',
      organizationId: 'org-demo',
      projectId: 'p-one',
      createdByUserId: 'u-attacker',
      issuedRole: 'lead',
      code: 'p-one.must-not-render',
      expiresAt: '2026-08-01T12:10:00.000Z',
      createdAt: '2026-08-01T12:00:00.000Z',
      attemptsRemaining: 5,
    }), { status: 201 })))
    render(panel('p-one'))
    fireEvent.click(screen.getByRole('button', { name: 'Create desktop pairing code' }))
    expect(await screen.findByText(
      'Pairing code subject did not match the signed-in member.',
    )).toBeInTheDocument()
    expect(screen.queryByText('p-one.must-not-render')).not.toBeInTheDocument()
  })

  it('revokes the exact generated code and clears the copy-once secret', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'pair-p-one',
        organizationId: 'org-demo',
        projectId: 'p-one',
        createdByUserId: 'u-lead',
        issuedRole: 'lead',
        code: 'p-one.copy-once-secret',
        expiresAt: '2026-08-01T12:10:00.000Z',
        createdAt: '2026-08-01T12:00:00.000Z',
        attemptsRemaining: 5,
      }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ revoked: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    render(panel('p-one'))
    fireEvent.click(screen.getByRole('button', { name: 'Create desktop pairing code' }))
    await screen.findByText('p-one.copy-once-secret')
    fireEvent.click(screen.getByRole('button', { name: '撤销配对码' }))
    await screen.findByText('配对码已撤销。')
    expect(screen.queryByText('p-one.copy-once-secret')).not.toBeInTheDocument()
    expect(fetcher).toHaveBeenLastCalledWith('/api/pairing-code', expect.objectContaining({
      method: 'DELETE',
      body: JSON.stringify({ projectId: 'p-one', pairingCodeId: 'pair-p-one' }),
    }))
  })

  it('clears a copy-once code as soon as the selected project changes', async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'pair-p-one',
          organizationId: 'org-demo',
          projectId: 'p-one',
          createdByUserId: 'u-lead',
          issuedRole: 'lead',
          code: 'p-one.copy-once-secret',
          expiresAt: '2026-08-01T12:10:00.000Z',
          createdAt: '2026-08-01T12:00:00.000Z',
          attemptsRemaining: 5,
        }),
        { status: 201 },
      ),
    )
    vi.stubGlobal('fetch', fetcher)
    const { rerender } = render(panel('p-one'))

    fireEvent.click(screen.getByRole('button', { name: 'Create desktop pairing code' }))
    await waitFor(() => expect(screen.getByText('p-one.copy-once-secret')).toBeInTheDocument())

    rerender(panel('p-two'))

    expect(screen.queryByText('p-one.copy-once-secret')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Desktop pairing code for p-two')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '复制配对码' })).not.toBeInTheDocument()
  })

  it('ignores an old project response that arrives after selection changes', async () => {
    let resolveResponse!: (response: Response) => void
    const fetcher = vi.fn(
      () => new Promise<Response>((resolve) => {
        resolveResponse = resolve
      }),
    )
    vi.stubGlobal('fetch', fetcher)
    const { rerender } = render(panel('p-one'))

    fireEvent.click(screen.getByRole('button', { name: 'Create desktop pairing code' }))
    expect(fetcher).toHaveBeenCalledWith('/api/pairing-code', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ projectId: 'p-one' }),
    })
    rerender(panel('p-two'))

    await act(async () => {
      resolveResponse(
        new Response(
          JSON.stringify({
            id: 'pair-p-one',
            organizationId: 'org-demo',
            projectId: 'p-one',
            createdByUserId: 'u-lead',
            issuedRole: 'lead',
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
        issuedRole: 'lead',
        code: 'p-two.copy-once-secret',
        expiresAt: '2026-08-01T12:10:00.000Z',
        createdAt: '2026-08-01T12:00:00.000Z',
        attemptsRemaining: 5,
        token: 'must-not-reach-browser',
      }), { status: 201 }),
    ))
    render(panel('p-one'))

    fireEvent.click(screen.getByRole('button', { name: 'Create desktop pairing code' }))

    await waitFor(() =>
      expect(screen.getByText('Pairing code response was invalid.')).toBeInTheDocument(),
    )
    expect(screen.queryByText('p-two.copy-once-secret')).not.toBeInTheDocument()
  })

  it('only offers copying after a pairing code has been created and reports success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({
        id: 'pair-p-one',
        organizationId: 'org-demo',
        projectId: 'p-one',
        createdByUserId: 'u-lead',
        issuedRole: 'lead',
        code: 'p-one.copy-once-secret',
        expiresAt: '2026-08-01T12:10:00.000Z',
        createdAt: '2026-08-01T12:00:00.000Z',
        attemptsRemaining: 5,
      }), { status: 201 }),
    ))
    render(panel('p-one'))

    expect(screen.queryByRole('button', { name: '复制配对码' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create desktop pairing code' }))
    await screen.findByText('p-one.copy-once-secret')

    fireEvent.click(screen.getByRole('button', { name: '复制配对码' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('p-one.copy-once-secret'))
    expect(screen.getByRole('status')).toHaveTextContent('已复制')
    expect(screen.getByRole('button', { name: '已复制' })).toBeEnabled()
  })

  it('keeps the code visible and uses a secret-free message when clipboard copying fails', async () => {
    const leakedFailure = 'clipboard rejected p-one.copy-once-secret'
    const writeText = vi.fn().mockRejectedValue(new Error(leakedFailure))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({
        id: 'pair-p-one',
        organizationId: 'org-demo',
        projectId: 'p-one',
        createdByUserId: 'u-lead',
        issuedRole: 'lead',
        code: 'p-one.copy-once-secret',
        expiresAt: '2026-08-01T12:10:00.000Z',
        createdAt: '2026-08-01T12:00:00.000Z',
        attemptsRemaining: 5,
      }), { status: 201 }),
    ))
    render(panel('p-one'))

    fireEvent.click(screen.getByRole('button', { name: 'Create desktop pairing code' }))
    await screen.findByText('p-one.copy-once-secret')
    fireEvent.click(screen.getByRole('button', { name: '复制配对码' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('复制失败，请重试或手动复制。')
    expect(screen.getByText('p-one.copy-once-secret')).toBeInTheDocument()
    expect(screen.queryByText(leakedFailure)).not.toBeInTheDocument()
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('discards late clipboard feedback after the selected project changes', async () => {
    let resolveCopy!: () => void
    const writeText = vi.fn(() => new Promise<void>((resolve) => {
      resolveCopy = resolve
    }))
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({
        id: 'pair-p-one',
        organizationId: 'org-demo',
        projectId: 'p-one',
        createdByUserId: 'u-lead',
        issuedRole: 'lead',
        code: 'p-one.copy-once-secret',
        expiresAt: '2026-08-01T12:10:00.000Z',
        createdAt: '2026-08-01T12:00:00.000Z',
        attemptsRemaining: 5,
      }), { status: 201 }),
    ))
    const { rerender } = render(panel('p-one'))

    fireEvent.click(screen.getByRole('button', { name: 'Create desktop pairing code' }))
    await screen.findByText('p-one.copy-once-secret')
    fireEvent.click(screen.getByRole('button', { name: '复制配对码' }))
    expect(screen.getByRole('button', { name: '复制中...' })).toBeDisabled()

    rerender(panel('p-two'))
    await act(async () => resolveCopy())

    expect(screen.queryByText('p-one.copy-once-secret')).not.toBeInTheDocument()
    expect(screen.queryByText('已复制')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '复制配对码' })).not.toBeInTheDocument()
  })
})
