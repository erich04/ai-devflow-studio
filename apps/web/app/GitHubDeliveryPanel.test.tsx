import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GitHubRepositoryBinding } from '@ai-devflow/shared'
import type { GitHubDeliveryRequestView } from './lib/devflow-api'
import { GitHubDeliveryPanel } from './GitHubDeliveryPanel'

const binding: GitHubRepositoryBinding = {
  stateVersion: 1,
  id: 'binding-1',
  version: 3,
  organizationId: 'org-demo',
  teamProjectId: 'p-payments',
  installationId: '12345',
  repositoryId: '98765',
  repository: 'example/payments',
  defaultBranch: 'main',
  status: 'active',
  validatedAt: '2026-08-11T14:00:00.000Z',
  updatedAt: '2026-08-11T14:00:00.000Z',
  redacted: true,
}

const delivery: GitHubDeliveryRequestView = {
  id: 'delivery-1',
  stateVersion: 2,
  intentRevision: 1,
  projectId: 'p-payments',
  runId: 'run-1',
  runVersion: 7,
  nodeId: 'pr-1',
  repositoryBindingId: 'binding-1',
  repositoryBindingVersion: 3,
  deliverySeriesKey: `github-delivery:${'9'.repeat(64)}`,
  deliveryAttempt: 1,
  repositoryId: '98765',
  repository: 'example/payments',
  status: 'approval_required',
  outcomeCode: null,
  expectedRunVersion: 7,
  baseBranch: 'main',
  headBranch: 'devflow/run-1-pr-1',
  baseCommitSha: 'a'.repeat(40),
  expectedCommitSha: 'b'.repeat(40),
  intentDigest: 'c'.repeat(64),
  diffDigest: 'd'.repeat(64),
  testEvidenceId: 'test-1',
  testEvidenceDigest: 'e'.repeat(64),
  packageDigest: 'f'.repeat(64),
  changedPaths: [
    'apps/web/app/GitHubDeliveryPanel.tsx',
    'apps/web/app/lib/devflow-api.ts',
  ],
  prTitle: 'Deliver the exact approved change',
  expiresAt: '2026-08-12T14:00:00.000Z',
  updatedAt: '2026-08-11T14:01:00.000Z',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GitHubDeliveryPanel', () => {
  it('shows the complete exact approval object in explicit Team Project context', () => {
    render(
      <GitHubDeliveryPanel
        projectId="p-payments"
        projectName="Payments"
        initialBinding={binding}
        initialDeliveries={[delivery]}
      />,
    )

    expect(screen.getByRole('region', { name: 'GitHub Delivery' })).toBeInTheDocument()
    expect(screen.getByText('Payments · p-payments')).toBeInTheDocument()
    expect(screen.getAllByText('example/payments').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Deliver the exact approved change')).toBeInTheDocument()
    expect(screen.getByText('Run version 7')).toBeInTheDocument()
    expect(screen.getByText('test-1')).toBeInTheDocument()
    expect(screen.getByText('b'.repeat(40))).toBeInTheDocument()
    expect(screen.getByText('e'.repeat(64))).toBeInTheDocument()
    expect(screen.getByText('f'.repeat(64))).toBeInTheDocument()
    expect(screen.getByText('c'.repeat(64))).toBeInTheDocument()
    expect(screen.getByText('d'.repeat(64))).toBeInTheDocument()
    expect(screen.getByText('a'.repeat(40))).toBeInTheDocument()
    expect(screen.getByText('Intent revision 1')).toBeInTheDocument()
    expect(screen.getByText('Binding version 3')).toBeInTheDocument()
    expect(screen.getByText('binding-1')).toBeInTheDocument()
    expect(screen.getByText('Repository ID 98765')).toBeInTheDocument()
    expect(screen.getByText('delivery-1')).toBeInTheDocument()
    expect(screen.getByText('pr-1')).toBeInTheDocument()
    expect(screen.getByText('apps/web/app/GitHubDeliveryPanel.tsx')).toBeInTheDocument()
    expect(screen.getByText('apps/web/app/lib/devflow-api.ts')).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('/Users/')
    expect(document.body).not.toHaveTextContent('API_TOKEN')
  })

  it('disables approval when the request binding version is not the active binding version', () => {
    render(
      <GitHubDeliveryPanel
        projectId="p-payments"
        projectName="Payments"
        initialBinding={{ ...binding, version: 4 }}
        initialDeliveries={[delivery]}
      />,
    )

    const confirmation = screen.getByRole('checkbox', {
      name: 'Confirm delivery delivery-1',
    })
    expect(confirmation).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Approve delivery' })).toBeDisabled()
    expect(screen.getByText(
      'Request binding v3 does not match active binding v4. Reload or create a revised request.',
    )).toBeInTheDocument()
  })

  it('clears human delivery confirmations after a binding update', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      binding: {
        ...binding,
        version: 4,
        updatedAt: '2026-08-11T15:00:00.000Z',
      },
      outcomeCode: 'binding_updated',
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    render(
      <GitHubDeliveryPanel
        projectId="p-payments"
        projectName="Payments"
        initialBinding={binding}
        initialDeliveries={[delivery]}
      />,
    )

    const deliveryConfirmation = screen.getByRole('checkbox', {
      name: 'Confirm delivery delivery-1',
    })
    fireEvent.click(deliveryConfirmation)
    expect(deliveryConfirmation).toBeChecked()
    fireEvent.change(screen.getByLabelText('GitHub App installation ID'), {
      target: { value: '12345' },
    })
    fireEvent.change(screen.getByLabelText('GitHub repository ID'), {
      target: { value: '98765' },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Confirm repository binding' }))
    fireEvent.click(screen.getByRole('button', { name: 'Update repository binding' }))

    expect(await screen.findByText(
      'GitHub repository binding verified and active.',
    )).toBeInTheDocument()
    expect(deliveryConfirmation).not.toBeChecked()
    expect(deliveryConfirmation).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Approve delivery' })).toBeDisabled()
  })

  it('does not misreport a rejected Web origin as missing owner authority', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      code: 'origin_forbidden',
      message: 'GitHub Delivery mutation origin was rejected.',
    }), { status: 403 })))
    render(
      <GitHubDeliveryPanel
        projectId="p-payments"
        projectName="Payments"
        initialBinding={null}
        initialDeliveries={[]}
      />,
    )

    fireEvent.change(screen.getByLabelText('GitHub App installation ID'), {
      target: { value: '12345' },
    })
    fireEvent.change(screen.getByLabelText('GitHub repository ID'), {
      target: { value: '98765' },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Confirm repository binding' }))
    fireEvent.click(screen.getByRole('button', { name: 'Configure repository binding' }))

    expect(await screen.findByText(
      'GitHub repository binding could not be changed safely.',
    )).toBeInTheDocument()
    expect(screen.queryByText(
      'Owner authority is required to configure this repository binding.',
    )).not.toBeInTheDocument()
  })

  it('shows owner guidance only for the typed authority failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      code: 'authority_required',
      message: 'Required project authority was not verified.',
    }), { status: 403 })))
    render(
      <GitHubDeliveryPanel
        projectId="p-payments"
        projectName="Payments"
        initialBinding={null}
        initialDeliveries={[]}
      />,
    )

    fireEvent.change(screen.getByLabelText('GitHub App installation ID'), {
      target: { value: '12345' },
    })
    fireEvent.change(screen.getByLabelText('GitHub repository ID'), {
      target: { value: '98765' },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Confirm repository binding' }))
    fireEvent.click(screen.getByRole('button', { name: 'Configure repository binding' }))

    expect(await screen.findByText(
      'Owner authority is required to configure this repository binding.',
    )).toBeInTheDocument()
  })

  it('requires the matching forbidden status before showing owner guidance', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      code: 'authority_required',
      message: 'A session is required.',
    }), { status: 401 })))
    render(
      <GitHubDeliveryPanel
        projectId="p-payments"
        projectName="Payments"
        initialBinding={null}
        initialDeliveries={[]}
      />,
    )

    fireEvent.change(screen.getByLabelText('GitHub App installation ID'), {
      target: { value: '12345' },
    })
    fireEvent.change(screen.getByLabelText('GitHub repository ID'), {
      target: { value: '98765' },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Confirm repository binding' }))
    fireEvent.click(screen.getByRole('button', { name: 'Configure repository binding' }))

    expect(await screen.findByText(
      'GitHub repository binding could not be changed safely.',
    )).toBeInTheDocument()
    expect(screen.queryByText(
      'Owner authority is required to configure this repository binding.',
    )).not.toBeInTheDocument()
  })

  it('does not misreport a rejected Web origin as decision authority', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      code: 'origin_forbidden',
      message: 'GitHub Delivery mutation origin was rejected.',
    }), { status: 403 })))
    render(
      <GitHubDeliveryPanel
        projectId="p-payments"
        projectName="Payments"
        initialBinding={binding}
        initialDeliveries={[delivery]}
      />,
    )

    fireEvent.click(screen.getByRole('checkbox', {
      name: 'Confirm delivery delivery-1',
    }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve delivery' }))

    expect(await screen.findByText(
      'GitHub Delivery service is unavailable. No decision was applied.',
    )).toBeInTheDocument()
    expect(screen.queryByText(
      'Lead or owner authority is required for this decision.',
    )).not.toBeInTheDocument()
  })

  it('requires an explicit human confirmation before approving an exact Delivery version', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      request: {
        ...delivery,
        stateVersion: 3,
        status: 'approved',
        updatedAt: '2026-08-11T14:02:00.000Z',
      },
      outcomeCode: 'delivery_approved',
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    render(
      <GitHubDeliveryPanel
        projectId="p-payments"
        projectName="Payments"
        initialBinding={binding}
        initialDeliveries={[delivery]}
      />,
    )

    const approve = screen.getByRole('button', { name: 'Approve delivery' })
    const reject = screen.getByRole('button', { name: 'Reject delivery' })
    expect(approve).toBeDisabled()
    expect(reject).toBeDisabled()

    fireEvent.click(screen.getByRole('checkbox', {
      name: 'Confirm delivery delivery-1',
    }))
    expect(approve).toBeEnabled()
    fireEvent.click(approve)

    await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/github-delivery', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'approve',
        projectId: 'p-payments',
        requestId: 'delivery-1',
        expectedStateVersion: 2,
      }),
    }))
    expect(await screen.findByText('Delivery approved. Desktop may now publish the exact branch.')).toBeInTheDocument()
    expect(screen.getByText('approved')).toBeInTheDocument()
    expect(screen.getByText(/request v3/u)).toBeInTheDocument()
  })

  it('records an explicit rejection from the server-owned Delivery projection', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      request: {
        ...delivery,
        stateVersion: 3,
        status: 'revoked',
        outcomeCode: 'approval_rejected',
        updatedAt: '2026-08-11T14:02:00.000Z',
      },
      outcomeCode: 'delivery_rejected',
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    render(
      <GitHubDeliveryPanel
        projectId="p-payments"
        projectName="Payments"
        initialBinding={binding}
        initialDeliveries={[delivery]}
      />,
    )

    fireEvent.click(screen.getByRole('checkbox', {
      name: 'Confirm delivery delivery-1',
    }))
    fireEvent.click(screen.getByRole('button', { name: 'Reject delivery' }))

    await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/github-delivery', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'reject',
        projectId: 'p-payments',
        requestId: 'delivery-1',
        expectedStateVersion: 2,
      }),
    }))
    expect(await screen.findByText(
      'Delivery rejected. No branch publication was authorized.',
    )).toBeInTheDocument()
    expect(screen.getByText('revoked')).toBeInTheDocument()
    expect(screen.getByText(/request v3/u)).toBeInTheDocument()
  })

  it('shows typed provider-unavailable feedback without reflecting provider details', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      code: 'provider_unavailable',
      message: 'github.internal API_TOKEN=private',
    }), { status: 503 }))
    vi.stubGlobal('fetch', fetcher)
    render(
      <GitHubDeliveryPanel
        projectId="p-payments"
        projectName="Payments"
        initialBinding={binding}
        initialDeliveries={[]}
      />,
    )

    fireEvent.change(screen.getByLabelText('GitHub App installation ID'), {
      target: { value: '12345' },
    })
    fireEvent.change(screen.getByLabelText('GitHub repository ID'), {
      target: { value: '98765' },
    })
    const configure = screen.getByRole('button', { name: 'Update repository binding' })
    expect(configure).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Confirm repository binding' }))
    fireEvent.click(configure)

    expect(await screen.findByText(
      'GitHub provider is unavailable. No repository authority was changed.',
    )).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('github.internal')
    expect(document.body).not.toHaveTextContent('private')
  })

  it('requires owner confirmation before revoking the exact binding version', async () => {
    const revokedBinding: GitHubRepositoryBinding = {
      ...binding,
      version: 4,
      status: 'revoked',
      updatedAt: '2026-08-11T15:00:00.000Z',
    }
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      binding: revokedBinding,
      outcomeCode: 'binding_revoked',
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    render(
      <GitHubDeliveryPanel
        projectId="p-payments"
        projectName="Payments"
        initialBinding={binding}
        initialDeliveries={[delivery]}
      />,
    )

    const deliveryConfirmation = screen.getByRole('checkbox', {
      name: 'Confirm delivery delivery-1',
    })
    fireEvent.click(deliveryConfirmation)
    expect(deliveryConfirmation).toBeChecked()
    const revoke = screen.getByRole('button', { name: 'Revoke repository binding' })
    expect(revoke).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', {
      name: 'Confirm repository binding revocation',
    }))
    expect(revoke).toBeEnabled()
    fireEvent.click(revoke)

    await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/github-delivery', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'revoke',
        projectId: 'p-payments',
        expectedStateVersion: 3,
      }),
    }))
    expect(await screen.findByText(
      'Repository binding revoked. Pending delivery authority is no longer valid.',
    )).toBeInTheDocument()
    expect(screen.getAllByText('revoked').length).toBeGreaterThanOrEqual(1)
    expect(deliveryConfirmation).not.toBeChecked()
    expect(deliveryConfirmation).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Approve delivery' })).toBeDisabled()
  })

  it('does not misreport a rejected Web origin as revocation owner authority', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      code: 'origin_forbidden',
      message: 'GitHub Delivery mutation origin was rejected.',
    }), { status: 403 })))
    render(
      <GitHubDeliveryPanel
        projectId="p-payments"
        projectName="Payments"
        initialBinding={binding}
        initialDeliveries={[]}
      />,
    )

    fireEvent.click(screen.getByRole('checkbox', {
      name: 'Confirm repository binding revocation',
    }))
    fireEvent.click(screen.getByRole('button', { name: 'Revoke repository binding' }))

    expect(await screen.findByText(
      'GitHub repository binding could not be revoked safely.',
    )).toBeInTheDocument()
    expect(screen.queryByText(
      'Owner authority is required to revoke this repository binding.',
    )).not.toBeInTheDocument()
  })
})
