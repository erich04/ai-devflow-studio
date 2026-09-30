import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GateCommand } from '@ai-devflow/shared'
import {
  GATE_COMMAND_STATUS_POLL_INTERVAL_MS,
  GateCommandPanel,
} from './GateCommandPanel'

function command(overrides: Partial<GateCommand> = {}): GateCommand {
  return {
    id: 'gate-command-1',
    version: 1,
    organizationId: 'org-a',
    projectId: 'project-a',
    workRequestId: 'wr-1',
    runId: 'run-1',
    nodeId: 'gate-1',
    action: 'approve',
    workflowCommand: 'approve_gate',
    reason: 'Reviewed current projection.',
    requestedByUserId: 'user-lead',
    requestedRole: 'lead',
    idempotencyKey: 'gate:approve:fixed',
    requestFingerprint: 'a'.repeat(64),
    expectedRunVersion: 3,
    expectedPolicyVersion: 2,
    expectedBlockerIds: [],
    evaluationStatus: 'allowed',
    evaluationBlockerIds: [],
    evaluatedAt: '2026-08-01T10:00:00.000Z',
    status: 'pending',
    outcomeCode: null,
    expiresAt: '2026-08-01T10:15:00.000Z',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  }
}

const defaultProps = {
  projectId: 'project-a',
  runId: 'run-1',
  nodeId: 'gate-1',
  expectedRunVersion: 3,
  evaluation: {
    status: 'pass' as const,
    blocksApproval: false,
    policyVersion: 2,
    expectedBlockerIds: [] as string[],
  },
  initialCommands: [] as GateCommand[],
  createIdempotencyKey: (action: 'approve' | 'reject') =>
    `gate:${action}:fixed`,
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('GateCommandPanel', () => {
  it('submits an exact version-bound approval and shows the pending command', async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      return new Response(
        JSON.stringify({
          command: command({
            reason: body.reason,
            idempotencyKey: body.idempotencyKey,
          }),
          replayed: false,
          outcomeCode: 'created',
        }),
        { status: 201 },
      )
    })
    vi.stubGlobal('fetch', fetcher)
    render(<GateCommandPanel {...defaultProps} />)

    fireEvent.change(screen.getByLabelText('审批说明'), {
      target: { value: 'Reviewed current projection.' },
    })
    fireEvent.click(screen.getByRole('button', { name: '批准并继续' }))

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    expect(fetcher).toHaveBeenCalledWith('/api/gate-commands', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        projectId: 'project-a',
        runId: 'run-1',
        nodeId: 'gate-1',
        action: 'approve',
        reason: 'Reviewed current projection.',
        expectedRunVersion: 3,
        expectedPolicyVersion: 2,
        expectedBlockerIds: [],
        idempotencyKey: 'gate:approve:fixed',
      }),
    })
    expect(await screen.findByText(/等待拥有该任务的桌面端/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '批准并继续' })).toBeDisabled()
  })

  it('blocks approval but still permits a lead to record human rejection', async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      return new Response(
        JSON.stringify({
          command: command({
            action: 'reject',
            workflowCommand: null,
            reason: body.reason,
            idempotencyKey: body.idempotencyKey,
            expectedBlockerIds: ['blocker-a'],
            evaluationBlockerIds: ['blocker-a'],
          }),
          replayed: false,
          outcomeCode: 'created',
        }),
        { status: 201 },
      )
    })
    vi.stubGlobal('fetch', fetcher)
    render(
      <GateCommandPanel
        {...defaultProps}
        evaluation={{
          status: 'blocked',
          blocksApproval: true,
          policyVersion: 2,
          expectedBlockerIds: ['blocker-a'],
        }}
      />,
    )

    fireEvent.change(screen.getByLabelText('审批说明'), {
      target: { value: 'Acceptance criteria are not met.' },
    })
    expect(screen.getByRole('button', { name: '批准并继续' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '驳回' }))

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      action: 'reject',
      expectedBlockerIds: ['blocker-a'],
      idempotencyKey: 'gate:reject:fixed',
    })
  })

  it('rejects an over-broad response instead of displaying it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            command: { ...command(), leasedToTokenId: 'secret-token-id' },
            replayed: false,
            outcomeCode: 'created',
          }),
          { status: 201 },
        ),
      ),
    )
    render(<GateCommandPanel {...defaultProps} />)
    fireEvent.change(screen.getByLabelText('审批说明'), {
      target: { value: 'Reviewed current projection.' },
    })
    fireEvent.click(screen.getByRole('button', { name: '批准并继续' }))

    expect(
      await screen.findByText('审批服务返回了无法核对的结果，请刷新后确认是否已提交。'),
    ).toBeInTheDocument()
    expect(screen.queryByText('secret-token-id')).not.toBeInTheDocument()
  })

  it('rejects a valid-looking create body returned with the wrong success status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            command: command(),
            replayed: false,
            outcomeCode: 'created',
          }),
          { status: 200 },
        ),
      ),
    )
    render(<GateCommandPanel {...defaultProps} />)
    fireEvent.change(screen.getByLabelText('审批说明'), {
      target: { value: 'Reviewed current projection.' },
    })
    fireEvent.click(screen.getByRole('button', { name: '批准并继续' }))

    expect(
      await screen.findByText('审批服务暂时不可用，没有创建审批。'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/等待拥有该任务的桌面端/)).not.toBeInTheDocument()
  })

  it('ignores a late response after the selected Run changes', async () => {
    let resolveResponse!: (response: Response) => void
    const fetcher = vi.fn(
      () => new Promise<Response>((resolve) => (resolveResponse = resolve)),
    )
    vi.stubGlobal('fetch', fetcher)
    const { rerender } = render(<GateCommandPanel {...defaultProps} />)
    fireEvent.change(screen.getByLabelText('审批说明'), {
      target: { value: 'Reviewed current projection.' },
    })
    fireEvent.click(screen.getByRole('button', { name: '批准并继续' }))

    rerender(
      <GateCommandPanel
        {...defaultProps}
        runId="run-2"
        nodeId="acceptance-2"
        expectedRunVersion={8}
      />,
    )
    resolveResponse(
      new Response(
        JSON.stringify({
          command: command(),
          replayed: false,
          outcomeCode: 'created',
        }),
        { status: 201 },
      ),
    )

    await waitFor(() =>
      expect(screen.getByLabelText('审批说明')).toHaveValue(''),
    )
    expect(screen.queryByText(/等待拥有该任务的桌面端/)).not.toBeInTheDocument()
  })

  it.each([
    {
      status: 'applied' as const,
      outcomeCode: 'applied' as const,
      updatedAt: '2026-08-01T10:01:00.000Z',
      message: /Desktop 已执行批准/,
    },
    {
      status: 'rejected' as const,
      outcomeCode: 'stale_policy' as const,
      updatedAt: '2026-08-01T10:01:00.000Z',
      message: /本地策略已变化/,
    },
    {
      status: 'expired' as const,
      outcomeCode: 'expired' as const,
      updatedAt: '2026-08-01T10:15:00.000Z',
      message: /已过期/,
    },
  ])('shows the $status lifecycle after a page reload', (terminal) => {
    render(
      <GateCommandPanel
        {...defaultProps}
        initialCommands={[
          command({
            version: terminal.status === 'expired' ? 2 : 3,
            status: terminal.status,
            outcomeCode: terminal.outcomeCode,
            updatedAt: terminal.updatedAt,
          }),
        ]}
      />,
    )

    expect(screen.getByText(terminal.message)).toBeInTheDocument()
    expect(
      screen.queryByText(/等待拥有该任务的桌面端/),
    ).not.toBeInTheDocument()
  })

  it('polls a pending command to its strict terminal lifecycle', async () => {
    vi.useFakeTimers()
    const applied = command({
      version: 3,
      status: 'applied',
      outcomeCode: 'applied',
      updatedAt: '2026-08-01T10:01:00.000Z',
    })
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ commands: [applied] }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetcher)
    render(
      <GateCommandPanel
        {...defaultProps}
        initialCommands={[command()]}
      />,
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(GATE_COMMAND_STATUS_POLL_INTERVAL_MS)
    })

    expect(fetcher).toHaveBeenCalledWith(
      '/api/gate-commands?projectId=project-a',
      { headers: { accept: 'application/json' } },
    )
    expect(screen.getByText(/Desktop 已执行批准/)).toBeInTheDocument()
  })

  // Plan S5, Q4: no dead buttons, and approval waits for the material version.
  it('shows who has to decide and no controls when the member can neither approve nor reject', () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    render(
      <GateCommandPanel
        {...defaultProps}
        authority={{ canApprove: false, canReject: false, waitingLabel: '等待负责人审批（需要 Lead 及以上）。' }}
      />,
    )
    expect(screen.getByRole('note')).toHaveTextContent('等待负责人审批（需要 Lead 及以上）。')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('审批说明')).not.toBeInTheDocument()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('offers only rejection to a lead below the required approval role', () => {
    render(
      <GateCommandPanel
        {...defaultProps}
        authority={{ canApprove: false, canReject: true, waitingLabel: '' }}
      />,
    )
    expect(screen.queryByRole('button', { name: '批准并继续' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '驳回' })).toBeInTheDocument()
    expect(screen.getByText('批准需要更高的项目角色；你可以驳回。')).toBeInTheDocument()
  })

  it('keeps approval unavailable while the material version is not synced, and rejection available', () => {
    render(
      <GateCommandPanel
        {...defaultProps}
        approvalUnavailableReason="所审材料的版本尚未从桌面端同步"
      />,
    )
    fireEvent.change(screen.getByLabelText('审批说明'), { target: { value: 'Reviewed.' } })
    expect(screen.getByRole('button', { name: '批准并继续' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '驳回' })).toBeEnabled()
    expect(screen.getByText(/暂时不能批准：所审材料的版本尚未从桌面端同步/)).toHaveTextContent('仍可驳回')
  })

  it('explains an unreadable pre-approval check instead of leaving silent disabled buttons', () => {
    render(<GateCommandPanel {...defaultProps} evaluation={null} />)
    expect(screen.getByRole('button', { name: '批准并继续' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '驳回' })).toBeDisabled()
    expect(screen.getByText('无法读取审批前检查，暂时不能提交。请刷新页面重试。')).toBeInTheDocument()
  })

  it.each([
    [409, '任务、策略、阻断项或所审材料已变化，没有创建审批。请刷新后重新核对。'],
    [403, '当前身份没有这个审批的权限，没有创建审批。'],
    [503, '审批服务暂时不可用，没有创建审批。'],
  ])('explains a %s creation failure in Chinese', async (status, copy) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: '审批请求被拒绝。' }), { status })))
    render(<GateCommandPanel {...defaultProps} />)
    fireEvent.change(screen.getByLabelText('审批说明'), { target: { value: 'Reviewed.' } })
    fireEvent.click(screen.getByRole('button', { name: '批准并继续' }))
    expect(await screen.findByText(copy)).toBeInTheDocument()
    expect(screen.queryByText('审批请求被拒绝。')).not.toBeInTheDocument()
  })
})
