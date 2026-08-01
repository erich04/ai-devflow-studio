import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { WorkRequest } from '@ai-devflow/shared'
import { WorkRequestInbox } from './WorkRequestInbox'

const openRequest: WorkRequest = {
  id: 'wr-rollout',
  organizationId: 'org-demo',
  projectId: 'p-payments',
  title: 'Prepare rollout',
  request: 'Keep the rollout reversible.',
  version: 1,
  status: 'open',
  createdByUserId: 'u-ling',
  claim: null,
  expiresAt: null,
  createdAt: '2026-08-01T12:00:00.000Z',
  updatedAt: '2026-08-01T12:00:00.000Z',
}

describe('WorkRequestInbox', () => {
  it('renders the server lifecycle and delegates one exact selected request', () => {
    const onMaterialize = vi.fn()
    render(
      <WorkRequestInbox
        workRequests={[
          openRequest,
          {
            ...openRequest,
            id: 'wr-recovery',
            version: 2,
            status: 'claim_pending',
            claim: {
              runId: 'run-recovery',
              claimedAt: '2026-08-01T12:01:00.000Z',
              materializedAt: null,
            },
          },
        ]}
        isPaired
        isLoading={false}
        materializingId={null}
        error={null}
        onRefresh={vi.fn()}
        onMaterialize={onMaterialize}
      />,
    )

    expect(screen.getAllByText('Prepare rollout')).toHaveLength(2)
    expect(screen.getByText('待领取')).toBeInTheDocument()
    expect(screen.getByText('待恢复')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '创建本地 Run：Prepare rollout' }))
    expect(onMaterialize).toHaveBeenCalledWith(openRequest)
  })

  it('keeps writes unavailable while unpaired or while the selected request is in flight', () => {
    const { rerender } = render(
      <WorkRequestInbox
        workRequests={[openRequest]}
        isPaired={false}
        isLoading={false}
        materializingId={null}
        error={null}
        onRefresh={vi.fn()}
        onMaterialize={vi.fn()}
      />,
    )
    expect(screen.getByText('绑定 Team Project 后可领取工作请求')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /创建本地 Run/ })).not.toBeInTheDocument()

    rerender(
      <WorkRequestInbox
        workRequests={[openRequest]}
        isPaired
        isLoading={false}
        materializingId={openRequest.id}
        error={null}
        onRefresh={vi.fn()}
        onMaterialize={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: '正在创建：Prepare rollout' })).toBeDisabled()
  })

  it('shows bounded loading, failure, and empty states', () => {
    const { rerender } = render(
      <WorkRequestInbox
        workRequests={[]}
        isPaired
        isLoading
        materializingId={null}
        error={null}
        onRefresh={vi.fn()}
        onMaterialize={vi.fn()}
      />,
    )
    expect(screen.getByText('正在加载 Work Requests…')).toBeInTheDocument()

    rerender(
      <WorkRequestInbox
        workRequests={[]}
        isPaired
        isLoading={false}
        materializingId={null}
        error="Work Request inbox unavailable."
        onRefresh={vi.fn()}
        onMaterialize={vi.fn()}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Work Request inbox unavailable.')

    rerender(
      <WorkRequestInbox
        workRequests={[]}
        isPaired
        isLoading={false}
        materializingId={null}
        error={null}
        onRefresh={vi.fn()}
        onMaterialize={vi.fn()}
      />,
    )
    expect(screen.getByText('当前没有可执行的 Work Request')).toBeInTheDocument()
  })
})
