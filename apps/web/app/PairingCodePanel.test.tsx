import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PairingCodePanel } from './PairingCodePanel'

const pairingSubject = { userId: 'u-lead', userName: 'Ling', role: 'lead' as const }
const changedScopes = [
  { name: 'project', projectId: 'p-two', subject: pairingSubject },
  { name: 'account', projectId: 'p-one', subject: { ...pairingSubject, userId: 'u-other' } },
  { name: 'role', projectId: 'p-one', subject: { ...pairingSubject, role: 'member' as const } },
]

function panel(projectId: string) {
  return (
    <PairingCodePanel
      projectId={projectId}
      projectName={projectId === 'p-one' ? 'Project One' : 'Project Two'}
      subject={pairingSubject}
    />
  )
}

beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-01T12:00:00.000Z')) })

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('PairingCodePanel', () => {
  it('expires the displayed code, blocks copying it and allows one fresh issuance', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-01T12:00:00.000Z'))
    const code = { id: 'pair-one', organizationId: 'org-demo', projectId: 'p-one',
      createdByUserId: 'u-lead', issuedRole: 'lead', code: 'pair-one.old-secret',
      createdAt: new Date().toISOString(), expiresAt: '2026-08-01T12:10:00.000Z', attemptsRemaining: 5 }
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(code), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...code, id: 'pair-two', code: 'pair-two.new-secret', expiresAt: '2026-08-01T12:20:00.000Z' }), { status: 201 }))
    const writeText = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    render(panel('p-one'))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create desktop pairing code' })) })
    expect(screen.getByText(code.code)).toBeInTheDocument()
    await act(async () => { vi.advanceTimersByTime(600_001) })
    expect(screen.getByText('配对码已过期')).toBeInTheDocument()
    expect(screen.queryByText(code.code)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '复制配对码' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '复制配对码' }))
    expect(writeText).not.toHaveBeenCalled()
    await act(async () => {
      const button = screen.getByRole('button', { name: '重新生成配对码' })
      fireEvent.click(button); fireEvent.click(button)
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(screen.getByText('pair-two.new-secret')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '复制配对码' })).toBeEnabled()
    expect(screen.getByText('配对操作诊断 · 2')).toBeInTheDocument()
  })

  it('retains an issuance started before the initial passive effects finish', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      id: 'pair-p-one',
      organizationId: 'org-demo',
      projectId: 'p-one',
      createdByUserId: 'u-lead',
      issuedRole: 'lead',
      code: 'p-one.early-click-secret',
      expiresAt: '2026-08-01T12:10:00.000Z',
      createdAt: '2026-08-01T12:00:00.000Z',
      attemptsRemaining: 5,
    }), { status: 201 }))
    vi.stubGlobal('fetch', fetcher)

    function EarlyClick() {
      useLayoutEffect(() => {
        screen.getByRole('button', { name: 'Create desktop pairing code' }).click()
      }, [])
      return panel('p-one')
    }

    await act(async () => { render(<EarlyClick />) })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('p-one.early-click-secret')).toBeVisible()
  })

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
    expect(await screen.findByText(/团队服务返回了无法识别的结果.*诊断编号/, { selector: 'small' })).toBeInTheDocument()
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

  it.each(changedScopes)('clears a copy-once code when the $name changes', async ({ projectId, subject }) => {
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

    rerender(<PairingCodePanel projectId={projectId} projectName={projectId} subject={subject} />)

    expect(screen.queryByText('p-one.copy-once-secret')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(`Desktop pairing code for ${projectId}`)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '复制配对码' })).not.toBeInTheDocument()
  })

  it.each(changedScopes)('ignores an old response that arrives after the $name changes', async ({ projectId, subject }) => {
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
      signal: expect.any(AbortSignal),
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-devflow-diagnostic-id': expect.stringMatching(/^[0-9a-f-]{36}$/),
      },
      body: JSON.stringify({ projectId: 'p-one' }),
    })
    rerender(<PairingCodePanel projectId={projectId} projectName={projectId} subject={subject} />)

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
      expect(screen.getByText(/团队服务返回了无法识别的结果.*诊断编号/, { selector: 'small' })).toBeInTheDocument(),
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
