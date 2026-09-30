import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GitHubRepositoryBinding } from '@ai-devflow/shared'
import type { GitHubDeliveryRequestView } from './lib/devflow-api'
import {
  GitHubDeliveryApprovals,
  GitHubRepositoryBindingSettings,
} from './GitHubDeliveryPanel'

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

const approvedResponse = {
  request: {
    ...delivery,
    stateVersion: 3,
    status: 'approved',
    updatedAt: '2026-08-11T14:02:00.000Z',
  },
  outcomeCode: 'delivery_approved',
}

const rejectedResponse = {
  request: {
    ...delivery,
    stateVersion: 3,
    status: 'revoked',
    outcomeCode: 'approval_rejected',
    updatedAt: '2026-08-11T14:02:00.000Z',
  },
  outcomeCode: 'delivery_rejected',
}

const deliveryCardName = '交付请求 Deliver the exact approved change'
const deliveryConfirmationName = '确认已核对交付 Deliver the exact approved change'

const decisionUnavailableCopy = 'GitHub 交付服务暂时不可用，没有应用任何决定。'
const decisionAuthorityCopy = '需要 Lead 或 Owner 权限才能作出决定，没有应用任何决定。'
const decisionProviderCopy = 'GitHub 服务暂时不可用，没有应用任何决定。'
const configureUnsafeCopy = '仓库绑定无法安全修改，没有更改任何仓库权限。'
const configureAuthorityCopy = '需要 Owner 权限才能配置仓库绑定。'
const bindingConflictCopy = '此仓库已绑定其他项目，请使用独立仓库。'
const repositoryNotAssignedCopy = '请联系部署管理员，将此 GitHub 仓库分配给当前组织后再配置。'
const bindingProviderCopy = 'GitHub 服务暂时不可用，没有更改任何仓库权限。'
const revokeUnsafeCopy = '仓库绑定无法安全撤销，没有更改任何仓库权限。'
const revokeAuthorityCopy = '需要 Owner 权限才能撤销仓库绑定。'

/** Server feedback that must never be reflected into the page. */
const leakyServerMessage = '/Users/alice/private github.internal API_TOKEN=private'

const jsonHeaders = {
  accept: 'application/json',
  'content-type': 'application/json',
}

function stubFetch(body: unknown, status: number) {
  const fetcher = vi.fn(async () => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

function expectNoReflectedServerDetails() {
  expect(document.body).not.toHaveTextContent('/Users/')
  expect(document.body).not.toHaveTextContent('API_TOKEN')
  expect(document.body).not.toHaveTextContent('github.internal')
  expect(document.body).not.toHaveTextContent('private')
}

function decisionCall(action: 'approve' | 'reject') {
  return [
    '/api/github-delivery',
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        action,
        projectId: 'p-payments',
        requestId: 'delivery-1',
        expectedStateVersion: 2,
      }),
    },
  ] as const
}

function configureCall(expectedStateVersion: number) {
  return [
    '/api/github-delivery',
    {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({
        action: 'configure',
        projectId: 'p-payments',
        installationId: '12345',
        repositoryId: '98765',
        expectedStateVersion,
      }),
    },
  ] as const
}

const revokeCall = [
  '/api/github-delivery',
  {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({
      action: 'revoke',
      projectId: 'p-payments',
      expectedStateVersion: 3,
    }),
  },
] as const

afterEach(() => {
  vi.unstubAllGlobals()
})

type ApprovalsProps = Parameters<typeof GitHubDeliveryApprovals>[0]

function approvals(props: Partial<ApprovalsProps> = {}) {
  return (
    <GitHubDeliveryApprovals
      projectId="p-payments"
      binding={binding}
      initialDeliveries={[delivery]}
      canDecide
      {...props}
    />
  )
}

function renderApprovals(props: Partial<ApprovalsProps> = {}) {
  return render(approvals(props))
}

function deliveryCard(name = deliveryCardName): HTMLElement {
  return screen.getByRole('article', { name })
}

function technicalDetails(card: HTMLElement): HTMLElement {
  const details = within(card).getByText('技术详情', { selector: 'summary' }).closest('details')
  if (!details) throw new Error('技术详情 is not rendered as <details>')
  return details
}

/** The value of a first-screen fact, i.e. one that is not folded into 技术详情. */
function firstScreenFact(card: HTMLElement, label: string): HTMLElement {
  const technical = technicalDetails(card)
  const term = within(card)
    .getAllByText(label, { selector: 'dt' })
    .find((element) => !technical.contains(element))
  const value = term?.nextElementSibling
  if (!(value instanceof HTMLElement)) throw new Error(`Missing first-screen fact ${label}`)
  return value
}

function technicalFact(card: HTMLElement, label: string): HTMLElement {
  const value = within(technicalDetails(card)).getByText(label, { selector: 'dt' }).nextElementSibling
  if (!(value instanceof HTMLElement)) throw new Error(`Missing technical fact ${label}`)
  return value
}

function confirmDelivery() {
  fireEvent.click(screen.getByRole('checkbox', { name: deliveryConfirmationName }))
}

function decide(action: 'approve' | 'reject') {
  fireEvent.click(screen.getByRole('button', { name: action === 'approve' ? '批准交付' : '驳回交付' }))
}

function expectDeliveryUnchanged() {
  const card = deliveryCard()
  expect(within(card).getByText('等待审批')).toBeInTheDocument()
  expect(firstScreenFact(card, '请求修订')).toHaveTextContent('第 1 版 · 请求版本 v2')
  expect(screen.queryByText('已批准交付。桌面端现在可以发布这个精确版本的分支。')).not.toBeInTheDocument()
  expect(screen.queryByText('已驳回交付，没有授权发布任何分支。')).not.toBeInTheDocument()
}

describe('GitHubDeliveryApprovals', () => {
  it('shows the exact approval object on the first screen and every full identifier in 技术详情', () => {
    renderApprovals({
      initialDeliveries: [
        delivery,
        { ...delivery, id: 'delivery-other', projectId: 'p-other', prTitle: 'Other project delivery' },
      ],
    })

    const region = screen.getByRole('region', { name: '交付审批' })
    expect(region).toHaveAttribute('id', 'github-delivery')
    expect(within(region).getByRole('heading', { name: '交付请求' })).toBeInTheDocument()
    expect(within(region).getAllByRole('article')).toHaveLength(1)
    expect(screen.queryByText('Other project delivery')).not.toBeInTheDocument()

    const card = deliveryCard()
    expect(within(card).getByText('Deliver the exact approved change')).toBeInTheDocument()
    expect(within(card).getByText('等待审批')).toBeInTheDocument()
    expect(firstScreenFact(card, '目标仓库')).toHaveTextContent('example/payments')
    expect(firstScreenFact(card, '分支')).toHaveTextContent('devflow/run-1-pr-1 → main')

    const expectedCommit = firstScreenFact(card, '预期提交')
    expect(within(expectedCommit).getByText(`${'b'.repeat(12)}…`)).toHaveAttribute('title', 'b'.repeat(40))
    expect(expectedCommit).not.toHaveTextContent('b'.repeat(13))
    expect(within(expectedCommit).getByRole('button', { name: '复制预期提交' })).toBeInTheDocument()

    const changedPaths = firstScreenFact(card, '改动文件')
    expect(changedPaths).toHaveTextContent('2 个')
    expect(within(changedPaths).getByText('apps/web/app/GitHubDeliveryPanel.tsx')).toBeInTheDocument()
    expect(within(changedPaths).getByText('apps/web/app/lib/devflow-api.ts')).toBeInTheDocument()
    expect(within(changedPaths).queryByText(/其余/u)).not.toBeInTheDocument()

    const evidence = firstScreenFact(card, '验证范围')
    expect(evidence).toHaveTextContent('测试证据 test-1')
    expect(within(evidence).getByRole('button', { name: '复制测试证据标识' })).toBeInTheDocument()
    expect(firstScreenFact(card, '请求修订')).toHaveTextContent('第 1 版 · 请求版本 v2')
    expect(within(firstScreenFact(card, '审批截止')).getByText('2026-08-12 14:00 UTC'))
      .toHaveAttribute('datetime', '2026-08-12T14:00:00.000Z')

    // Full commits and digests exist only inside the folded 技术详情.
    const technical = technicalDetails(card)
    for (const fullValue of ['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(64), 'd'.repeat(64), 'e'.repeat(64), 'f'.repeat(64)]) {
      for (const element of within(card).getAllByText(fullValue)) {
        expect(technical).toContainElement(element)
      }
    }
    expect(technical).not.toHaveAttribute('open')
    fireEvent.click(within(technical).getByText('技术详情'))
    expect(technical).toHaveAttribute('open')

    for (const [label, value] of [
      ['交付请求标识', 'delivery-1'],
      ['任务标识', 'run-1'],
      ['任务版本', '7'],
      ['步骤标识', 'pr-1'],
      ['仓库绑定标识', 'binding-1'],
      ['仓库绑定版本', '3'],
      ['GitHub 仓库 ID', '98765'],
      ['基准提交', 'a'.repeat(40)],
      ['预期提交', 'b'.repeat(40)],
      ['交付意图摘要', 'c'.repeat(64)],
      ['差异来源摘要', 'd'.repeat(64)],
      ['PR 包摘要', 'f'.repeat(64)],
      ['测试证据标识', 'test-1'],
      ['测试证据摘要', 'e'.repeat(64)],
    ] as const) {
      const fact = technicalFact(card, label)
      expect(within(fact).getByText(value)).toBeInTheDocument()
      // The expected commit and the evidence id are copied from the first screen, so each copy
      // button name stays unique within the card.
      if (label === '预期提交' || label === '测试证据标识') {
        expect(within(fact).queryByRole('button')).not.toBeInTheDocument()
      } else {
        expect(within(fact).getByRole('button', { name: `复制${label}` })).toBeInTheDocument()
      }
    }
    expect(within(card).getAllByRole('button', { name: '复制预期提交' })).toHaveLength(1)
    expect(within(card).getAllByRole('button', { name: '复制测试证据标识' })).toHaveLength(1)
    expect(document.body).not.toHaveTextContent('/Users/')
    expect(document.body).not.toHaveTextContent('API_TOKEN')
  })

  it('lists the first eight changed paths and folds the rest', () => {
    const changedPaths = Array.from({ length: 10 }, (_, index) => `src/module-${String(index).padStart(2, '0')}.ts`)
    renderApprovals({ initialDeliveries: [{ ...delivery, changedPaths }] })

    const fact = firstScreenFact(deliveryCard(), '改动文件')
    expect(fact).toHaveTextContent('10 个')
    const folded = within(fact).getByText('其余 2 个文件', { selector: 'summary' }).closest('details')
    expect(folded).not.toBeNull()
    for (const path of changedPaths.slice(0, 8)) {
      expect(folded).not.toContainElement(within(fact).getByText(path))
    }
    for (const path of changedPaths.slice(8)) {
      expect(folded).toContainElement(within(fact).getByText(path))
    }
  })

  it('shows only the current task deliveries when runId is given', () => {
    const otherTask: GitHubDeliveryRequestView = {
      ...delivery,
      id: 'delivery-2',
      runId: 'run-2',
      nodeId: 'pr-2',
      headBranch: 'devflow/run-2-pr-2',
      prTitle: 'Deliver another task',
    }
    renderApprovals({
      runId: 'run-2',
      initialDeliveries: [
        delivery,
        otherTask,
        { ...otherTask, id: 'delivery-3', projectId: 'p-other', prTitle: 'Other project, same task id' },
      ],
    })

    const region = screen.getByRole('region', { name: '交付审批' })
    expect(within(region).getByRole('heading', { name: '本任务的交付请求' })).toBeInTheDocument()
    expect(within(region).getAllByRole('article')).toHaveLength(1)
    expect(deliveryCard('交付请求 Deliver another task')).toBeInTheDocument()
    expect(screen.queryByRole('article', { name: deliveryCardName })).not.toBeInTheDocument()
    expect(screen.queryByText('Other project, same task id')).not.toBeInTheDocument()
  })

  it.each<[string, string | undefined, GitHubDeliveryRequestView[], string]>([
    ['a project without requests', undefined, [], '当前项目还没有交付请求。'],
    ['a project whose only request belongs to another project', undefined, [{ ...delivery, projectId: 'p-other' }], '当前项目还没有交付请求。'],
    ['a task without requests', 'run-9', [delivery], '当前任务还没有交付请求。'],
  ])('explains an empty list for %s', (_case, runId, initialDeliveries, copy) => {
    renderApprovals({ initialDeliveries, ...(runId ? { runId } : {}) })

    expect(screen.getByText(copy)).toBeInTheDocument()
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
  })

  it('shows who must decide and no decision controls when the viewer cannot decide', () => {
    const fetcher = stubFetch(approvedResponse, 200)
    renderApprovals({ canDecide: false })

    const card = deliveryCard()
    expect(within(card).getByText('等待负责人审批（需要 Lead 或 Owner）。')).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: '批准交付' })).not.toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: '驳回交付' })).not.toBeInTheDocument()
    expect(within(card).queryByRole('checkbox')).not.toBeInTheDocument()
    // The approval object stays reviewable.
    expect(firstScreenFact(card, '预期提交')).toHaveTextContent(`${'b'.repeat(12)}…`)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('disables approval when the request binding version is not the active binding version', () => {
    const fetcher = stubFetch(approvedResponse, 200)
    renderApprovals({ binding: { ...binding, version: 4 } })

    const card = deliveryCard()
    const confirmation = within(card).getByRole('checkbox', { name: deliveryConfirmationName })
    const approve = within(card).getByRole('button', { name: '批准交付' })
    const reject = within(card).getByRole('button', { name: '驳回交付' })
    expect(confirmation).toBeDisabled()
    expect(approve).toBeDisabled()
    expect(reject).toBeDisabled()
    expect(within(card).getByText(/请求使用的仓库绑定 v3 与当前生效的 v4 不一致/u)).toBeInTheDocument()

    // Browsers never dispatch clicks to a disabled checkbox (jsdom's fireEvent does),
    // so only the disabled decision buttons are exercised here.
    fireEvent.click(approve)
    fireEvent.click(reject)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each<[string, GitHubRepositoryBinding | null]>([
    ['no binding', null],
    ['a revoked binding at the requested version', { ...binding, status: 'revoked' }],
    ['a later revoked binding', { ...binding, version: 4, status: 'revoked' }],
    ['a stale binding at the requested version', { ...binding, status: 'stale' }],
  ])('requires an active verified binding before a decision (%s)', (_case, currentBinding) => {
    const fetcher = stubFetch(approvedResponse, 200)
    renderApprovals({ binding: currentBinding })

    const card = deliveryCard()
    expect(within(card).getByRole('checkbox', { name: deliveryConfirmationName })).toBeDisabled()
    expect(within(card).getByRole('button', { name: '批准交付' })).toBeDisabled()
    expect(within(card).getByRole('button', { name: '驳回交付' })).toBeDisabled()
    expect(within(card).getByText(/需要一个已验证并生效的仓库绑定/u)).toBeInTheDocument()
    expect(within(card).queryByText(/不一致/u)).not.toBeInTheDocument()

    decide('approve')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('disables a confirmed decision when a revoked binding arrives as a new prop', () => {
    const fetcher = stubFetch(approvedResponse, 200)
    const { rerender } = renderApprovals()

    confirmDelivery()
    expect(screen.getByRole('button', { name: '批准交付' })).toBeEnabled()
    rerender(approvals({ binding: { ...binding, version: 4, status: 'revoked' } }))

    expect(screen.getByRole('checkbox', { name: deliveryConfirmationName })).toBeDisabled()
    // The confirmation was given under the old binding and does not carry over.
    expect(screen.getByRole('checkbox', { name: deliveryConfirmationName })).not.toBeChecked()
    expect(screen.getByRole('button', { name: '批准交付' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '驳回交付' })).toBeDisabled()
    decide('approve')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('requires an explicit human confirmation before approving an exact Delivery version', async () => {
    const fetcher = stubFetch(approvedResponse, 200)
    renderApprovals()

    const card = deliveryCard()
    const approve = within(card).getByRole('button', { name: '批准交付' })
    const reject = within(card).getByRole('button', { name: '驳回交付' })
    expect(approve).toBeDisabled()
    expect(reject).toBeDisabled()
    fireEvent.click(approve)
    expect(fetcher).not.toHaveBeenCalled()

    confirmDelivery()
    expect(approve).toBeEnabled()
    expect(reject).toBeEnabled()
    fireEvent.click(approve)

    await waitFor(() => expect(fetcher).toHaveBeenCalledWith(...decisionCall('approve')))
    expect(await screen.findByText('已批准交付。桌面端现在可以发布这个精确版本的分支。')).toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledTimes(1)
    const updated = deliveryCard()
    expect(within(updated).getByText('已批准，等待桌面端发布')).toBeInTheDocument()
    expect(firstScreenFact(updated, '请求修订')).toHaveTextContent('第 1 版 · 请求版本 v3')
    expect(within(updated).queryByRole('checkbox')).not.toBeInTheDocument()
    expect(within(updated).queryByRole('button', { name: '批准交付' })).not.toBeInTheDocument()
    expect(within(updated).queryByRole('button', { name: '驳回交付' })).not.toBeInTheDocument()
  })

  it('records an explicit rejection from the server-owned Delivery projection', async () => {
    const fetcher = stubFetch(rejectedResponse, 200)
    renderApprovals()

    confirmDelivery()
    decide('reject')

    await waitFor(() => expect(fetcher).toHaveBeenCalledWith(...decisionCall('reject')))
    expect(await screen.findByText('已驳回交付，没有授权发布任何分支。')).toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledTimes(1)
    const updated = deliveryCard()
    expect(within(updated).getByText('已撤销')).toBeInTheDocument()
    expect(firstScreenFact(updated, '请求修订')).toHaveTextContent('第 1 版 · 请求版本 v3')
    expect(within(updated).queryByRole('button', { name: '批准交付' })).not.toBeInTheDocument()
  })

  it.each<[string, 'approve' | 'reject', number, unknown]>([
    ['an unexpected success status', 'approve', 201, approvedResponse],
    ['an extra top-level field', 'approve', 200, { ...approvedResponse, binding }],
    [
      'an over-broad request projection',
      'approve',
      200,
      { ...approvedResponse, request: { ...approvedResponse.request, redacted: true, diff: 'diff --git a/secret b/secret' } },
    ],
    ['a request from another project', 'approve', 200, { ...approvedResponse, request: { ...approvedResponse.request, projectId: 'p-other' } }],
    ['a different request', 'approve', 200, { ...approvedResponse, request: { ...approvedResponse.request, id: 'delivery-2' } }],
    ['a state version that did not advance', 'approve', 200, { ...approvedResponse, request: { ...approvedResponse.request, stateVersion: 2 } }],
    ['the opposite outcome', 'approve', 200, { ...approvedResponse, outcomeCode: 'delivery_rejected' }],
    ['an approval that is not approved', 'approve', 200, { ...approvedResponse, request: { ...approvedResponse.request, status: 'publishing_branch' } }],
    ['a rejection without the rejection outcome', 'reject', 200, { ...rejectedResponse, request: { ...rejectedResponse.request, outcomeCode: null } }],
    ['a rejection that is not revoked', 'reject', 200, { ...rejectedResponse, request: { ...rejectedResponse.request, status: 'approved' } }],
    ['a non-object body', 'approve', 200, null],
  ])('rejects a decision response with %s', async (_case, action, status, body) => {
    const fetcher = stubFetch(body, status)
    renderApprovals()

    confirmDelivery()
    decide(action)

    expect(await screen.findByText(decisionUnavailableCopy)).toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith(...decisionCall(action))
    expectDeliveryUnchanged()
    expect(document.body).not.toHaveTextContent('diff --git')
  })

  it('does not misreport a rejected Web origin as decision authority', async () => {
    stubFetch({
      code: 'origin_forbidden',
      message: 'GitHub 交付写入请求的来源被拒绝。',
    }, 403)
    renderApprovals()

    confirmDelivery()
    decide('approve')

    expect(await screen.findByText(decisionUnavailableCopy)).toBeInTheDocument()
    expect(screen.queryByText(decisionAuthorityCopy)).not.toBeInTheDocument()
    expectDeliveryUnchanged()
  })

  it.each([
    [403, 'authority_required', decisionAuthorityCopy],
    [409, 'state_conflict', '交付请求已变化，没有应用任何决定。请刷新后重新核对。'],
    [410, 'expired', '交付请求已过期，没有应用任何决定。请在桌面端重新发起交付。'],
    [404, 'not_found', '找不到这个交付请求，可能已被撤销。请刷新页面。'],
    [503, 'provider_unavailable', decisionProviderCopy],
  ])('explains a typed decision failure without reflecting server details (%s, %s)', async (status, code, copy) => {
    const fetcher = stubFetch({ code, message: leakyServerMessage }, status)
    renderApprovals()

    confirmDelivery()
    decide('approve')

    expect(await screen.findByText(copy)).toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expectDeliveryUnchanged()
    expectNoReflectedServerDetails()
  })

  it.each([
    [401, 'authority_required'],
    [502, 'provider_unavailable'],
    [409, 'binding_conflict'],
    [403, 'repository_not_assigned'],
  ])('requires the matching status before showing typed decision guidance (%s, %s)', async (status, code) => {
    stubFetch({ code, message: leakyServerMessage }, status)
    renderApprovals()

    confirmDelivery()
    decide('reject')

    expect(await screen.findByText(decisionUnavailableCopy)).toBeInTheDocument()
    expect(screen.queryByText(decisionAuthorityCopy)).not.toBeInTheDocument()
    expect(screen.queryByText(decisionProviderCopy)).not.toBeInTheDocument()
    expectDeliveryUnchanged()
    expectNoReflectedServerDetails()
  })
})

type BindingSettingsProps = Parameters<typeof GitHubRepositoryBindingSettings>[0]

function renderBindingSettings(props: Partial<BindingSettingsProps> = {}) {
  return render(
    <GitHubRepositoryBindingSettings
      projectId="p-payments"
      projectName="Payments"
      initialBinding={null}
      canManage
      {...props}
    />,
  )
}

function bindingCard(): HTMLElement {
  return within(screen.getByRole('region', { name: 'GitHub 仓库绑定' })).getByRole('article')
}

function fillBindingForm({ installationId = '12345', repositoryId = '98765' } = {}) {
  fireEvent.change(screen.getByLabelText('GitHub App 安装 ID'), {
    target: { value: installationId },
  })
  fireEvent.change(screen.getByLabelText('GitHub 仓库 ID'), {
    target: { value: repositoryId },
  })
}

function toggleBindingConfirmation() {
  fireEvent.click(screen.getByRole('checkbox', { name: '确认仓库绑定' }))
}

function submitConfiguredBinding(initialBinding: GitHubRepositoryBinding | null) {
  fillBindingForm()
  toggleBindingConfirmation()
  fireEvent.click(screen.getByRole('button', { name: initialBinding ? '更新仓库绑定' : '配置仓库绑定' }))
}

function confirmAndRevoke() {
  const group = screen.getByRole('group', { name: '撤销仓库绑定' })
  fireEvent.click(within(group).getByRole('checkbox', { name: '确认撤销仓库绑定' }))
  fireEvent.click(within(group).getByRole('button', { name: '撤销仓库绑定' }))
}

describe('GitHubRepositoryBindingSettings', () => {
  it('shows the exact project binding with owner controls', () => {
    renderBindingSettings({ initialBinding: binding })

    const region = screen.getByRole('region', { name: 'GitHub 仓库绑定' })
    expect(within(region).getByRole('heading', { name: '仓库绑定 · Payments' })).toBeInTheDocument()
    const card = bindingCard()
    expect(within(card).getByText('example/payments')).toBeInTheDocument()
    expect(within(card).getByText('生效中')).toBeInTheDocument()
    expect(within(card).getByText('默认分支 main · 绑定版本 v3')).toBeInTheDocument()
    expect(within(region).getByRole('form', { name: '仓库绑定设置' })).toBeInTheDocument()
    expect(within(region).getByRole('button', { name: '更新仓库绑定' })).toBeDisabled()
    expect(within(region).getByRole('group', { name: '撤销仓库绑定' })).toBeInTheDocument()
  })

  it.each<[string, GitHubRepositoryBinding | null, string, string, string]>([
    ['no binding', null, '尚未绑定仓库', '未配置', '配置仓库绑定'],
    ['a revoked binding', { ...binding, version: 4, status: 'revoked' }, 'example/payments', '已撤销', '更新仓库绑定'],
  ])('offers configuration but no revocation for %s', (_case, initialBinding, repository, status, submitName) => {
    renderBindingSettings({ initialBinding })

    const card = bindingCard()
    expect(within(card).getByText(repository)).toBeInTheDocument()
    expect(within(card).getByText(status)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: submitName })).toBeDisabled()
    expect(screen.queryByRole('group', { name: '撤销仓库绑定' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '撤销仓库绑定' })).not.toBeInTheDocument()
  })

  it('shows no binding controls to non-owners', () => {
    const fetcher = stubFetch({}, 200)
    renderBindingSettings({ initialBinding: binding, canManage: false })

    expect(screen.getByText('只有 Owner 可以修改或撤销仓库绑定。')).toBeInTheDocument()
    expect(within(bindingCard()).getByText('默认分支 main · 绑定版本 v3')).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: '仓库绑定设置' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '撤销仓库绑定' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each<[string, GitHubRepositoryBinding | null, number, string, number, string, number]>([
    ['configures a new binding', null, 201, 'binding_created', 0, '配置仓库绑定', 1],
    ['updates the exact existing binding version', binding, 200, 'binding_updated', 3, '更新仓库绑定', 4],
  ])('%s only after explicit confirmation of valid identifiers', async (
    _case,
    initialBinding,
    status,
    outcomeCode,
    expectedStateVersion,
    submitName,
    nextVersion,
  ) => {
    const fetcher = stubFetch({
      binding: { ...binding, version: nextVersion, updatedAt: '2026-08-11T15:00:00.000Z' },
      outcomeCode,
    }, status)
    renderBindingSettings({ initialBinding })

    const form = screen.getByRole('form', { name: '仓库绑定设置' })
    const submit = screen.getByRole('button', { name: submitName })
    fillBindingForm({ installationId: '012345' })
    toggleBindingConfirmation()
    expect(submit).toBeDisabled()
    fireEvent.submit(form)

    fillBindingForm()
    expect(submit).toBeEnabled()
    toggleBindingConfirmation()
    expect(submit).toBeDisabled()
    fireEvent.submit(form)
    expect(fetcher).not.toHaveBeenCalled()

    toggleBindingConfirmation()
    fireEvent.click(submit)

    await waitFor(() => expect(fetcher).toHaveBeenCalledWith(...configureCall(expectedStateVersion)))
    expect(await screen.findByText('仓库绑定已验证并生效。')).toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledTimes(1)
    const card = bindingCard()
    expect(within(card).getByText('example/payments')).toBeInTheDocument()
    expect(within(card).getByText('生效中')).toBeInTheDocument()
    expect(within(card).getByText(`默认分支 main · 绑定版本 v${nextVersion}`)).toBeInTheDocument()
    expect(screen.getByLabelText('GitHub App 安装 ID')).toHaveValue('')
    expect(screen.getByLabelText('GitHub 仓库 ID')).toHaveValue('')
    expect(screen.getByRole('checkbox', { name: '确认仓库绑定' })).not.toBeChecked()
    expect(screen.getByRole('button', { name: '更新仓库绑定' })).toBeDisabled()
    expect(screen.getByRole('group', { name: '撤销仓库绑定' })).toBeInTheDocument()
  })

  it.each<[string, GitHubRepositoryBinding | null, number, unknown]>([
    ['an unexpected success status', null, 200, { binding: { ...binding, version: 1 }, outcomeCode: 'binding_created' }],
    ['the wrong outcome', null, 201, { binding: { ...binding, version: 1 }, outcomeCode: 'binding_updated' }],
    ['an extra top-level field', null, 201, { binding: { ...binding, version: 1 }, outcomeCode: 'binding_created', request: delivery }],
    ['a binding for another project', null, 201, { binding: { ...binding, version: 1, teamProjectId: 'p-other' }, outcomeCode: 'binding_created' }],
    ['an unredacted binding', null, 201, { binding: { ...binding, version: 1, redacted: false }, outcomeCode: 'binding_created' }],
    ['a binding that is not active', null, 201, { binding: { ...binding, version: 1, status: 'stale' }, outcomeCode: 'binding_created' }],
    ['a missing binding', null, 201, { binding: null, outcomeCode: 'binding_created' }],
    ['a binding version that did not advance', binding, 200, { binding, outcomeCode: 'binding_updated' }],
  ])('rejects a binding configuration response with %s', async (_case, initialBinding, status, body) => {
    const fetcher = stubFetch(body, status)
    renderBindingSettings({ initialBinding })

    submitConfiguredBinding(initialBinding)

    expect(await screen.findByText(configureUnsafeCopy)).toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith(...configureCall(initialBinding?.version ?? 0))
    expect(screen.queryByText('仓库绑定已验证并生效。')).not.toBeInTheDocument()
    expect(within(bindingCard()).getByText(initialBinding ? '默认分支 main · 绑定版本 v3' : '尚未绑定仓库')).toBeInTheDocument()
    expect(screen.getByLabelText('GitHub 仓库 ID')).toHaveValue('98765')
  })

  it('does not misreport a rejected Web origin as missing owner authority', async () => {
    stubFetch({
      code: 'origin_forbidden',
      message: 'GitHub 交付写入请求的来源被拒绝。',
    }, 403)
    renderBindingSettings()

    submitConfiguredBinding(null)

    expect(await screen.findByText(configureUnsafeCopy)).toBeInTheDocument()
    expect(screen.queryByText(configureAuthorityCopy)).not.toBeInTheDocument()
  })

  it.each([
    [409, 'binding_conflict', true],
    [409, 'state_conflict', false],
    [403, 'binding_conflict', false],
  ])('explains only a confirmed repository binding conflict (%s, %s)', async (status, code, conflict) => {
    const fetcher = stubFetch({ code, message: leakyServerMessage }, status)
    renderBindingSettings()

    submitConfiguredBinding(null)

    expect(await screen.findByText(conflict ? bindingConflictCopy : configureUnsafeCopy)).toBeInTheDocument()
    if (!conflict) expect(screen.queryByText(bindingConflictCopy)).not.toBeInTheDocument()
    expect(screen.getByLabelText('GitHub 仓库 ID')).toHaveValue('98765')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expectNoReflectedServerDetails()
  })

  it('shows owner guidance only for the typed authority failure', async () => {
    stubFetch({
      code: 'authority_required',
      message: '未能核实所需的项目权限。',
    }, 403)
    renderBindingSettings()

    submitConfiguredBinding(null)

    expect(await screen.findByText(configureAuthorityCopy)).toBeInTheDocument()
  })

  it('requires the matching forbidden status before showing owner guidance', async () => {
    stubFetch({
      code: 'authority_required',
      message: 'A session is required.',
    }, 401)
    renderBindingSettings()

    submitConfiguredBinding(null)

    expect(await screen.findByText(configureUnsafeCopy)).toBeInTheDocument()
    expect(screen.queryByText(configureAuthorityCopy)).not.toBeInTheDocument()
  })

  it.each([
    [403, true],
    [409, false],
  ])('asks for deployment assignment only for the typed unassigned repository failure (%s)', async (status, assigned) => {
    stubFetch({ code: 'repository_not_assigned', message: leakyServerMessage }, status)
    renderBindingSettings()

    submitConfiguredBinding(null)

    expect(await screen.findByText(assigned ? repositoryNotAssignedCopy : configureUnsafeCopy)).toBeInTheDocument()
    if (!assigned) expect(screen.queryByText(repositoryNotAssignedCopy)).not.toBeInTheDocument()
    expectNoReflectedServerDetails()
  })

  it.each([
    [503, true],
    [502, false],
  ])('shows provider-unavailable feedback only for the typed provider failure without reflecting provider details (%s)', async (status, typed) => {
    const fetcher = stubFetch({ code: 'provider_unavailable', message: leakyServerMessage }, status)
    renderBindingSettings({ initialBinding: binding })

    fillBindingForm()
    const update = screen.getByRole('button', { name: '更新仓库绑定' })
    expect(update).toBeDisabled()
    toggleBindingConfirmation()
    fireEvent.click(update)

    expect(await screen.findByText(typed ? bindingProviderCopy : configureUnsafeCopy)).toBeInTheDocument()
    if (!typed) expect(screen.queryByText(bindingProviderCopy)).not.toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledWith(...configureCall(3))
    expect(within(bindingCard()).getByText('默认分支 main · 绑定版本 v3')).toBeInTheDocument()
    expectNoReflectedServerDetails()
  })

  it('requires owner confirmation before revoking the exact binding version', async () => {
    const fetcher = stubFetch({
      binding: {
        ...binding,
        version: 4,
        status: 'revoked',
        updatedAt: '2026-08-11T15:00:00.000Z',
      },
      outcomeCode: 'binding_revoked',
    }, 200)
    renderBindingSettings({ initialBinding: binding })

    const group = screen.getByRole('group', { name: '撤销仓库绑定' })
    const revoke = within(group).getByRole('button', { name: '撤销仓库绑定' })
    expect(revoke).toBeDisabled()
    fireEvent.click(revoke)
    expect(fetcher).not.toHaveBeenCalled()

    fireEvent.click(within(group).getByRole('checkbox', { name: '确认撤销仓库绑定' }))
    expect(revoke).toBeEnabled()
    fireEvent.click(revoke)

    await waitFor(() => expect(fetcher).toHaveBeenCalledWith(...revokeCall))
    expect(await screen.findByText('仓库绑定已撤销，待处理的交付审批随之失效。')).toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledTimes(1)
    const card = bindingCard()
    expect(within(card).getByText('已撤销')).toBeInTheDocument()
    expect(within(card).getByText('默认分支 main · 绑定版本 v4')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '撤销仓库绑定' })).not.toBeInTheDocument()
  })

  it.each<[string, number, unknown]>([
    ['an unexpected success status', 201, { binding: { ...binding, version: 4, status: 'revoked' }, outcomeCode: 'binding_revoked' }],
    ['the wrong outcome', 200, { binding: { ...binding, version: 4, status: 'revoked' }, outcomeCode: 'binding_updated' }],
    ['an extra top-level field', 200, { binding: { ...binding, version: 4, status: 'revoked' }, outcomeCode: 'binding_revoked', request: delivery }],
    ['a binding for another project', 200, { binding: { ...binding, version: 4, status: 'revoked', teamProjectId: 'p-other' }, outcomeCode: 'binding_revoked' }],
    ['an unredacted binding', 200, { binding: { ...binding, version: 4, status: 'revoked', redacted: false }, outcomeCode: 'binding_revoked' }],
    ['a binding that is still active', 200, { binding: { ...binding, version: 4 }, outcomeCode: 'binding_revoked' }],
    ['a binding version that did not advance', 200, { binding: { ...binding, status: 'revoked' }, outcomeCode: 'binding_revoked' }],
  ])('rejects a revocation response with %s', async (_case, status, body) => {
    const fetcher = stubFetch(body, status)
    renderBindingSettings({ initialBinding: binding })

    confirmAndRevoke()

    expect(await screen.findByText(revokeUnsafeCopy)).toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith(...revokeCall)
    const card = bindingCard()
    expect(within(card).getByText('生效中')).toBeInTheDocument()
    expect(within(card).getByText('默认分支 main · 绑定版本 v3')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '撤销仓库绑定' })).toBeInTheDocument()
  })

  it('does not misreport a rejected Web origin as revocation owner authority', async () => {
    stubFetch({
      code: 'origin_forbidden',
      message: 'GitHub 交付写入请求的来源被拒绝。',
    }, 403)
    renderBindingSettings({ initialBinding: binding })

    confirmAndRevoke()

    expect(await screen.findByText(revokeUnsafeCopy)).toBeInTheDocument()
    expect(screen.queryByText(revokeAuthorityCopy)).not.toBeInTheDocument()
  })

  it.each([
    [403, 'authority_required', revokeAuthorityCopy],
    [401, 'authority_required', revokeUnsafeCopy],
    [503, 'provider_unavailable', bindingProviderCopy],
    [502, 'provider_unavailable', revokeUnsafeCopy],
    [409, 'state_conflict', revokeUnsafeCopy],
  ])('explains a revocation failure only from its typed status and code (%s, %s)', async (status, code, copy) => {
    stubFetch({ code, message: leakyServerMessage }, status)
    renderBindingSettings({ initialBinding: binding })

    confirmAndRevoke()

    expect(await screen.findByText(copy)).toBeInTheDocument()
    if (copy === revokeUnsafeCopy) {
      expect(screen.queryByText(revokeAuthorityCopy)).not.toBeInTheDocument()
      expect(screen.queryByText(bindingProviderCopy)).not.toBeInTheDocument()
    }
    expect(within(bindingCard()).getByText('生效中')).toBeInTheDocument()
    expectNoReflectedServerDetails()
  })
})
