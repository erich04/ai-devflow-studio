import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkRequest } from '@ai-devflow/shared'
import { WorkRequestPanel } from './WorkRequestPanel'

function request(projectId = 'p-one'): WorkRequest {
  return {
    id: `wr-${projectId}`,
    organizationId: 'org-demo',
    projectId,
    title: `Request for ${projectId}`,
    request: 'Keep the change reversible.',
    version: 1,
    status: 'open',
    createdByUserId: 'u-lead',
    claim: null,
    expiresAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('WorkRequestPanel', () => {
  it('shows only the selected project and retries a failed create with the same key', async () => {
    const created = {
      ...request('p-one'),
      id: 'wr-created',
      title: 'Prepare rollout',
    }
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        workRequest: created,
        replayed: false,
        outcomeCode: 'created',
      }), { status: 201 }))
    vi.stubGlobal('fetch', fetcher)
    render(
      <WorkRequestPanel
        projectId="p-one"
        initialWorkRequests={[request('p-one')]}
        createIdempotencyKey={() => 'create:stable-key'}
      />,
    )

    expect(screen.getByText('Request for p-one')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Work Request title'), {
      target: { value: 'Prepare rollout' },
    })
    fireEvent.change(screen.getByLabelText('Work Request details'), {
      target: { value: 'Keep the rollout reversible.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create Work Request' }))
    await waitFor(() => expect(screen.getByText('Work Request creation failed.')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Create Work Request' }))
    await waitFor(() => expect(screen.getByText('Prepare rollout')).toBeInTheDocument())

    expect(fetcher).toHaveBeenCalledTimes(2)
    for (const call of fetcher.mock.calls) {
      expect(JSON.parse(String(call[1]?.body))).toMatchObject({
        projectId: 'p-one',
        idempotencyKey: 'create:stable-key',
      })
    }
  })

  it('clears old project state and ignores a late create response', async () => {
    let resolveResponse!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
      resolveResponse = resolve
    })))
    const { rerender } = render(
      <WorkRequestPanel
        projectId="p-one"
        initialWorkRequests={[request('p-one')]}
        createIdempotencyKey={() => 'create:key'}
      />,
    )
    fireEvent.change(screen.getByLabelText('Work Request title'), {
      target: { value: 'Late request' },
    })
    fireEvent.change(screen.getByLabelText('Work Request details'), {
      target: { value: 'Must not cross projects.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create Work Request' }))

    rerender(
      <WorkRequestPanel
        projectId="p-two"
        initialWorkRequests={[request('p-two')]}
        createIdempotencyKey={() => 'create:key-two'}
      />,
    )
    expect(screen.queryByText('Request for p-one')).not.toBeInTheDocument()
    expect(screen.getByText('Request for p-two')).toBeInTheDocument()

    await act(async () => {
      resolveResponse(new Response(JSON.stringify({
        workRequest: { ...request('p-one'), title: 'Late request' },
        replayed: false,
        outcomeCode: 'created',
      }), { status: 201 }))
    })
    expect(screen.queryByText('Late request')).not.toBeInTheDocument()
  })

  it('does not display an over-broad Work Request response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({
        workRequest: {
          ...request('p-one'),
          claimedByTokenId: 'must-not-reach-renderer',
        },
        replayed: false,
        outcomeCode: 'created',
      }), { status: 201 }),
    ))
    render(
      <WorkRequestPanel
        projectId="p-one"
        initialWorkRequests={[]}
        createIdempotencyKey={() => 'create:key'}
      />,
    )
    fireEvent.change(screen.getByLabelText('Work Request title'), {
      target: { value: 'Unsafe response check' },
    })
    fireEvent.change(screen.getByLabelText('Work Request details'), {
      target: { value: 'Reject internal metadata.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create Work Request' }))

    await waitFor(() => expect(screen.getByText('Work Request response was invalid.')).toBeInTheDocument())
    expect(screen.queryByText('must-not-reach-renderer')).not.toBeInTheDocument()
  })
})
