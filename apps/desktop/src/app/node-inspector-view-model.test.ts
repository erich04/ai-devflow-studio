import { describe, expect, it } from 'vitest'
import type {
  Artifact,
  GitHubDeliveryIntent,
  GitHubDeliveryOperatorOutcome,
  WorkflowNode,
} from '@ai-devflow/shared'
import { artifacts as fixtureArtifacts, runs as fixtureRuns } from '@ai-devflow/shared/fixtures'
import {
  buildGateReadinessPresentation,
  buildNodeInspectorViewModel,
  resolveInspectorTabForSearchResult,
  selectGitHubDeliveryIntentForInspector,
} from './node-inspector-view-model'

const run = fixtureRuns[0]!

function prDeliveryPackage(nodeId: string): Artifact {
  return {
    id: 'artifact-pr-delivery-package',
    runId: run.id,
    nodeId,
    kind: 'pr',
    title: 'PR Delivery Package',
    summary: 'Redacted package bound to the reviewed coding source.',
    content: 'Safe delivery summary.',
    redacted: true,
    updatedAt: '2026-08-11T12:00:00.000Z',
    githubDeliverySource: {
      stateVersion: 1,
      codingRunId: 'coding-run-1',
      workspaceId: 'workspace-1',
      diffArtifactId: 'diff-1',
      diffSourceDigest: 'a'.repeat(64),
      testEvidenceId: 'test-evidence-1',
      headBranch: 'devflow/run-1',
    },
  }
}

function githubDeliveryIntent(
  status: GitHubDeliveryIntent['status'],
  overrides: Partial<GitHubDeliveryIntent> = {},
): GitHubDeliveryIntent {
  return {
    stateVersion: 1,
    id: 'github-delivery-intent-1',
    organizationId: 'org-demo',
    teamProjectId: run.projectId,
    localProjectId: run.projectId,
    runId: run.id,
    runVersion: run.version,
    nodeId: 'n-pr',
    repositoryBindingId: 'github-binding-1',
    repositoryBindingVersion: 3,
    installationId: '12345',
    repositoryId: '98765',
    codingRunId: 'coding-run-1',
    codingRunCompletedAt: '2026-08-11T11:30:00.000Z',
    workspaceId: 'workspace-1',
    deliverySeriesKey: `github-delivery:${'e'.repeat(64)}`,
    deliveryAttempt: 1,
    repository: 'erich/ai-devflow-studio',
    baseBranch: 'main',
    headBranch: 'devflow/run-1',
    baseCommitSha: '1'.repeat(40),
    expectedCommitSha: '2'.repeat(40),
    diffArtifactId: 'diff-1',
    diffSourceDigest: 'a'.repeat(64),
    testEvidenceId: 'test-evidence-1',
    testEvidenceCreatedAt: '2026-08-11T11:45:00.000Z',
    testEvidenceDigest: 'b'.repeat(64),
    prPackageArtifactId: 'artifact-pr-delivery-package',
    prPackageUpdatedAt: '2026-08-11T12:00:00.000Z',
    prPackageDigest: 'c'.repeat(64),
    changedPaths: ['apps/desktop/src/App.tsx'],
    intentDigest: 'd'.repeat(64),
    idempotencyKey: 'github-delivery:v1:fixture',
    status,
    createdAt: '2026-08-11T12:01:00.000Z',
    updatedAt: '2026-08-11T12:02:00.000Z',
    redacted: true,
    ...overrides,
  }
}

function findNode(predicate: (node: WorkflowNode) => boolean): WorkflowNode {
  const node = run.nodes.find(predicate)
  if (!node) {
    throw new Error('Fixture node not found')
  }
  return node
}

function viewModelFor(node: WorkflowNode, overrides: Partial<Parameters<typeof buildNodeInspectorViewModel>[0]> = {}) {
  return buildNodeInspectorViewModel({
    node,
    requestedTab: '状态',
    isSelectedCurrentNode: true,
    artifacts: fixtureArtifacts.filter((artifact) => artifact.nodeId === node.id),
    events: [],
    latestAgentReview: undefined,
    policySnapshot: null,
    gateEnforcementDecision: null,
    isLoadingGateEnforcement: false,
    canApprove: false,
    hasTeamProjectBinding: true,
    canVerifyGitHubDeliveryRevocation: false,
    ...overrides,
  })
}

describe('node inspector view model', () => {
  it('keeps clarify agents in Task inspector tabs and exposes the clarify action', () => {
    const node: WorkflowNode = {
      ...findNode((candidate) => candidate.kind === 'agent' && candidate.stage === 'clarify'),
      status: 'running',
    }
    const viewModel = viewModelFor(node)

    expect(viewModel.visualKind).toBe('Task')
    expect(viewModel.tabs.map((tab) => tab.label)).toEqual(['状态', '产物', 'Trace', 'Gate影响'])
    expect(viewModel.activeTab.sections).toEqual(['statusMatrix'])
    expect(viewModel.tabs.find((tab) => tab.label === 'Gate影响')?.sections).toEqual(['gateImpactSummary'])
    expect(viewModel.statusDescriptors.map((descriptor) => descriptor.id)).toEqual([
      'node-status',
      'raw-request',
      'clarification-artifact',
      'trace',
    ])
    expect(viewModel.statusDescriptors.map((descriptor) => descriptor.label)).not.toContain('Policy snapshot')
    expect(viewModel.statusDescriptors.map((descriptor) => descriptor.label)).not.toContain('门禁审查')
    expect(viewModel.statusDescriptors.map((descriptor) => descriptor.label)).not.toContain('Budget guard')
    expect(viewModel.nextAction).toMatchObject({
      title: '生成需求澄清',
      primaryActionId: 'completeAgent',
      secondaryActionIds: [],
    })
    expect(viewModel.actionCatalog.completeAgent).toMatchObject({
      label: '生成需求澄清',
      testId: 'complete-clarify-agent',
    })
    expect(viewModel.actions.map((action) => action.id)).not.toContain('approveGate')
  })

  it('maps design agents to Review tabs and falls back from invalid requested tabs', () => {
    const node: WorkflowNode = {
      ...findNode((candidate) => candidate.kind === 'agent' && candidate.stage === 'design'),
      status: 'running',
    }
    const viewModel = viewModelFor(node, { requestedTab: 'Trace' })

    expect(viewModel.visualKind).toBe('Review')
    expect(viewModel.tabs.map((tab) => tab.label)).toEqual(['状态', '门禁审查', '引用来源', 'Evidence'])
    expect(viewModel.activeTab.label).toBe('状态')
    expect(viewModel.activeTab.sections).toEqual(['statusMatrix'])
    expect(viewModel.statusDescriptors.map((descriptor) => descriptor.id)).toEqual([
      'node-status',
      'design-artifact',
      'knowledge-review',
      'trace',
    ])
    expect(viewModel.nextAction).toMatchObject({
      title: '生成设计方案',
      primaryActionId: 'completeAgent',
      secondaryActionIds: [],
    })
    expect(viewModel.actionCatalog.completeAgent).toMatchObject({
      label: '生成设计方案',
      testId: 'complete-design-agent',
    })
  })

  it('hides local test actions and requirements on clarify gates', () => {
    const node: WorkflowNode = {
      ...findNode((candidate) => candidate.kind === 'gate' && candidate.stage === 'clarify'),
      status: 'running',
    }
    const viewModel = viewModelFor(node, { requestedTab: 'Gate条件', canApprove: true })

    expect(viewModel.visualKind).toBe('Gate')
    expect(viewModel.activeTab.sections).toEqual(['gateRequirementMatrix', 'gateEnforcementPanel', 'governance'])
    expect(viewModel.statusDescriptors.map((descriptor) => descriptor.id)).toEqual([
      'gate-decision',
      'policy-snapshot',
      'approval-permission',
      'knowledge-review',
      'required-artifact',
    ])
    expect(viewModel.nextAction).toMatchObject({
      title: '通过 Gate',
      primaryActionId: 'approveGate',
      secondaryActionIds: ['openKnowledgeReview'],
    })
    expect(viewModel.nextAction.copy).not.toContain('Tests')
    expect(viewModel.actions.map((action) => action.id)).toEqual([])
    expect(viewModel.gateRequirementRows.map((row) => row.label)).toEqual([
      'Policy snapshot',
      'Role permission',
      '门禁审查',
      'Budget',
      'Required Artifact',
    ])
  })

  it('keeps gate status focused on readiness without duplicate node summary details', () => {
    const node: WorkflowNode = {
      ...findNode((candidate) => candidate.kind === 'gate' && candidate.stage === 'clarify'),
      status: 'running',
    }
    const viewModel = viewModelFor(node, { canApprove: true })

    expect(viewModel.visualKind).toBe('Gate')
    expect(viewModel.tabs.map((tab) => tab.label)).toEqual(['状态', 'Gate条件', 'Evidence', 'Remediation'])
    expect(viewModel.activeTab.sections).toEqual(['statusMatrix'])
    expect(viewModel.activeTab.sections).not.toContain('nodeSummary')
    expect(viewModel.activeTab.sections).not.toContain('gateEnforcementPanel')
    expect(viewModel.activeTab.sections).not.toContain('governance')
    expect(viewModel.activeTab.sections).not.toContain('agentReview')
    expect(viewModel.activeTab.sections).not.toContain('artifacts')
    expect(viewModel.statusDescriptors.map((descriptor) => descriptor.id)).toEqual([
      'gate-decision',
      'policy-snapshot',
      'approval-permission',
      'knowledge-review',
      'required-artifact',
    ])
  })

  it('hides local test actions and requirements on design gates', () => {
    const node = findNode((candidate) => candidate.id === run.currentNodeId && candidate.kind === 'gate')
    const viewModel = viewModelFor(node, { requestedTab: 'Gate条件' })

    expect(viewModel.visualKind).toBe('Gate')
    expect(viewModel.activeTab.sections).toEqual(['gateRequirementMatrix', 'gateEnforcementPanel', 'governance'])
    expect(viewModel.statusDescriptors.map((descriptor) => descriptor.id)).toEqual([
      'gate-decision',
      'policy-snapshot',
      'approval-permission',
      'knowledge-review',
      'required-artifact',
    ])
    expect(viewModel.nextAction).toMatchObject({
      title: '通过 Gate',
      secondaryActionIds: ['openKnowledgeReview'],
    })
    expect(viewModel.nextAction.primaryActionId).toBeUndefined()
    expect(viewModel.nextAction.copy).toContain('Gate 条件拆解')
    expect(viewModel.nextAction.copy).not.toContain('Tests')
    expect(viewModel.actions.map((action) => action.id)).toEqual([])
    expect(viewModel.gateRequirementRows.map((row) => row.label)).toEqual([
      'Policy snapshot',
      'Role permission',
      '门禁审查',
      'Budget',
      'Required Artifact',
    ])
  })

  it('keeps local test actions and requirements for later gate stages', () => {
    const designGate = findNode((candidate) => candidate.kind === 'gate' && candidate.stage === 'design')
    const testGate: WorkflowNode = {
      ...designGate,
      id: 'synthetic-test-gate',
      stage: 'test',
      title: '测试证据 Gate',
      subtitle: '确认测试证据后继续交付',
      artifactIds: [],
    }
    const viewModel = viewModelFor(testGate, { requestedTab: 'Gate条件', canApprove: true })

    expect(viewModel.nextAction).toMatchObject({
      title: '通过 Gate',
      primaryActionId: 'approveGate',
      secondaryActionIds: ['openKnowledgeReview', 'openTests'],
    })
    expect(viewModel.nextAction.copy).toContain('Tests')
    expect(viewModel.statusDescriptors.map((descriptor) => descriptor.id)).toContain('test-evidence')
    expect(viewModel.gateRequirementRows.map((row) => row.label)).toContain('Test Evidence')
  })

  it('summarizes passed, warning, missing, and blocked readiness and opens only attention groups', () => {
    const presentation = buildGateReadinessPresentation({
      descriptors: [
        { id: 'gate-decision', label: '结论', state: '警告', tone: 'warn', readiness: 'warning', summary: '', nextAction: '', impact: '' },
        { id: 'policy-snapshot', label: '策略', state: '已加载', tone: 'good', readiness: 'passed', summary: '', nextAction: '', impact: '' },
        { id: 'approval-permission', label: '权限', state: '不可审批', tone: 'bad', readiness: 'blocked', summary: '', nextAction: '', impact: '' },
        { id: 'knowledge-review', label: '审查', state: '缺失', tone: 'soft', readiness: 'missing', summary: '', nextAction: '', impact: '' },
      ],
      decision: {
        status: 'warn',
        blocksApproval: false,
        blockingReasons: [],
        warningReasons: [],
        requiredActions: [],
        canOverride: false,
        overrideRoleRequired: 'lead',
        policySource: 'built_in_default',
        policyVersion: 1,
        provisional: false,
      },
      isLoading: false,
      canApprove: false,
    })

    expect(presentation.summary).toMatchObject({
      canPass: false,
      counts: { passed: 1, warning: 1, missing: 1, blocked: 1 },
      headline: 'Gate 暂时不能通过',
    })
    expect(presentation.groups.find((group) => group.id === 'conclusion')).toMatchObject({
      state: 'warning',
      defaultOpen: true,
    })
    expect(presentation.groups.find((group) => group.id === 'policy-permission')).toMatchObject({
      state: 'blocked',
      defaultOpen: true,
    })
    expect(presentation.groups.find((group) => group.id === 'review-evidence')).toMatchObject({
      state: 'missing',
      defaultOpen: true,
    })
  })

  it('collapses fully passed readiness groups', () => {
    const presentation = buildGateReadinessPresentation({
      descriptors: [
        { id: 'gate-decision', label: '结论', state: '通过', tone: 'good', readiness: 'passed', summary: '', nextAction: '', impact: '' },
        { id: 'policy-snapshot', label: '策略', state: '已加载', tone: 'good', readiness: 'passed', summary: '', nextAction: '', impact: '' },
      ],
      decision: {
        status: 'pass',
        blocksApproval: false,
        blockingReasons: [],
        warningReasons: [],
        requiredActions: [],
        canOverride: false,
        overrideRoleRequired: 'lead',
        policySource: 'remote_cache',
        policyVersion: 3,
        provisional: false,
      },
      isLoading: false,
      canApprove: true,
    })

    expect(presentation.summary).toMatchObject({
      canPass: true,
      counts: { passed: 2, warning: 0, missing: 0, blocked: 0 },
      headline: 'Gate 已准备好，可以通过',
    })
    expect(presentation.groups.every((group) => group.defaultOpen === false)).toBe(true)
  })

  it('maps build, test, PR, and acceptance nodes to their true primary actions', () => {
    const buildNode = findNode((candidate) => candidate.kind === 'task' && candidate.stage === 'build')
    const testNode = findNode((candidate) => candidate.kind === 'test')
    const prNode = findNode((candidate) => candidate.kind === 'pr')
    const acceptanceNode = findNode((candidate) => candidate.kind === 'acceptance')

    expect(viewModelFor(buildNode).nextAction.primaryActionId).toBe('runCodingAgent')
    expect(viewModelFor(testNode).nextAction.primaryActionId).toBe('openTests')
    expect(viewModelFor(prNode).nextAction.primaryActionId).toBe('createPrDraft')
    expect(viewModelFor(acceptanceNode, { artifacts: [] }).nextAction.primaryActionId).toBe('createAcceptanceBundle')
    expect(viewModelFor(acceptanceNode).nextAction.primaryActionId).toBe('approveGate')
    expect(viewModelFor(buildNode).statusDescriptors.map((descriptor) => descriptor.id)).toEqual([
      'node-status',
      'coding-diff',
      'trace',
      'budget',
    ])
    expect(viewModelFor(testNode).statusDescriptors.map((descriptor) => descriptor.id)).toEqual([
      'node-status',
      'test-evidence',
      'test-report',
      'trace',
    ])
    expect(viewModelFor(prNode).statusDescriptors.map((descriptor) => descriptor.id)).toEqual([
      'node-status',
      'pr-draft',
      'test-evidence',
      'handoff-evidence',
    ])
    expect(viewModelFor(acceptanceNode).statusDescriptors.map((descriptor) => descriptor.id)).toEqual([
      'node-status',
      'acceptance-bundle',
      'test-evidence',
      'gate-decision',
    ])

    expect(viewModelFor(prNode, { requestedTab: 'Handoff' })).toMatchObject({
      visualKind: 'Delivery',
      activeTab: { label: 'Handoff', sections: ['deliveryHandoff', 'trace'] },
    })
    expect(viewModelFor(buildNode).activeTab.sections).not.toContain('gateEnforcementPanel')
    expect(viewModelFor(testNode).activeTab.sections).not.toContain('gateEnforcementPanel')
    expect(viewModelFor(prNode).activeTab.sections).not.toContain('gateEnforcementPanel')
    expect(viewModelFor(buildNode).actions.map((action) => action.id)).not.toContain('approveGate')
    expect(viewModelFor(testNode).actions.map((action) => action.id)).not.toContain('approveGate')
    expect(viewModelFor(prNode).actions.map((action) => action.id)).not.toContain('approveGate')
  })

  it('requires an explicit GitHub Delivery preparation after the exact PR package is attached', () => {
    const prNode = findNode((candidate) => candidate.kind === 'pr')
    const prPackage = prDeliveryPackage(prNode.id)

    const viewModel = viewModelFor(prNode, { artifacts: [prPackage] })

    expect(viewModel.nextAction).toMatchObject({
      title: 'Prepare GitHub Delivery',
      primaryActionId: 'prepareGitHubDelivery',
      secondaryActionIds: [],
    })
    expect(viewModel.actions.map((action) => action.id)).not.toContain('createPrDraft')
  })

  it('waits for an explicit Web lead or owner approval after preparation', () => {
    const prNode = findNode((candidate) => candidate.kind === 'pr')
    const viewModel = viewModelFor(prNode, {
      artifacts: [prDeliveryPackage(prNode.id)],
      githubDeliveryIntent: githubDeliveryIntent('approval_required'),
    })

    expect(viewModel.nextAction).toMatchObject({
      title: '等待 Web 审批',
      primaryActionId: 'reviseGitHubDelivery',
      secondaryActionIds: ['stopGitHubDelivery'],
    })
    expect(viewModel.nextAction.copy).toContain('lead/owner')
    expect(viewModel.nextAction.copy).toContain('新 intent revision')
    expect(viewModel.actionCatalog).toHaveProperty(
      'reviseGitHubDelivery.label',
      'Revise GitHub Delivery',
    )
    expect(viewModel.actionCatalog.reviseGitHubDelivery.disabledReasons).toEqual([])
  })

  it('offers only the explicit resume action when automatic recovery has stopped', () => {
    const prNode = findNode((candidate) => candidate.kind === 'pr')
    const viewModel = viewModelFor(prNode, {
      artifacts: [prDeliveryPackage(prNode.id)],
      githubDeliveryIntent: githubDeliveryIntent('recovery_required'),
    })

    expect(viewModel.nextAction).toMatchObject({
      title: '恢复 GitHub Delivery',
      primaryActionId: 'resumeGitHubDelivery',
      secondaryActionIds: [],
    })
    expect(viewModel.nextAction.copy).toContain('显式 Resume')
    expect(viewModel.actions.map((action) => action.id)).not.toContain('prepareGitHubDelivery')
  })

  it('never offers Resume for a credential-content block and names the safe rebuild path', () => {
    const prNode = findNode((candidate) => candidate.kind === 'pr')
    const blockedIntent = githubDeliveryIntent('recovery_required')
    const blockedOutcome: GitHubDeliveryOperatorOutcome = {
      stateVersion: 1,
      intentId: blockedIntent.id,
      intentUpdatedAt: blockedIntent.updatedAt,
      outcomeCode: 'content_scan_blocked',
      recordedAt: blockedIntent.updatedAt,
      redacted: true,
    }
    const viewModel = viewModelFor(prNode, {
      artifacts: [prDeliveryPackage(prNode.id)],
      githubDeliveryIntent: blockedIntent,
      githubDeliveryOperatorOutcome: blockedOutcome,
    })

    expect(viewModel.nextAction).toMatchObject({
      title: '发布内容已安全阻断',
      secondaryActionIds: [],
    })
    expect(viewModel.nextAction.primaryActionId).toBeUndefined()
    expect(viewModel.nextAction.copy).toContain('不能 Resume')
    expect(viewModel.nextAction.copy).toContain('新的 Work Request/Run')
    expect(viewModel.nextAction.copy).toContain('Coding Agent')
    expect(viewModel.actions.map((action) => action.id)).not.toContain('resumeGitHubDelivery')
  })

  it.each([
    'publishing_branch',
    'branch_published',
    'creating_pr',
  ] as const)('leaves %s delivery progress to the bounded background processor', (status) => {
    const prNode = findNode((candidate) => candidate.kind === 'pr')
    const viewModel = viewModelFor(prNode, {
      artifacts: [prDeliveryPackage(prNode.id)],
      githubDeliveryIntent: githubDeliveryIntent(status),
    })

    expect(viewModel.nextAction.title).toBe('GitHub Delivery 自动推进中')
    expect(viewModel.nextAction.copy).toContain('无需再次点击')
    expect(viewModel.nextAction.primaryActionId).toBeUndefined()
  })

  it('offers explicit Revise and Stop while an approved delivery remains pre-publication', () => {
    const prNode = findNode((candidate) => candidate.kind === 'pr')
    const viewModel = viewModelFor(prNode, {
      artifacts: [prDeliveryPackage(prNode.id)],
      githubDeliveryIntent: githubDeliveryIntent('approved'),
    })

    expect(viewModel.nextAction).toMatchObject({
      title: 'GitHub Delivery 已批准',
      primaryActionId: 'reviseGitHubDelivery',
      secondaryActionIds: ['stopGitHubDelivery'],
    })
    expect(viewModel.nextAction.copy).toContain('旧审批失效')
    expect(viewModel.actionCatalog.reviseGitHubDelivery.disabledReasons).toEqual([])
    expect(viewModel.actionCatalog.stopGitHubDelivery.label).toBe('Stop GitHub Delivery')
  })

  it('describes failed delivery without inferring whether authorization was consumed', () => {
    const prNode = findNode((candidate) => candidate.kind === 'pr')
    const viewModel = viewModelFor(prNode, {
      artifacts: [prDeliveryPackage(prNode.id)],
      githubDeliveryIntent: githubDeliveryIntent('failed'),
    })

    expect(viewModel.nextAction.copy).toContain('安全停止')
    expect(viewModel.nextAction.copy).toContain('不会自动重试')
    expect(viewModel.nextAction.copy).toContain('核对远端记录')
    expect(viewModel.nextAction.copy).toContain('新的 Work Request/Run')
    expect(viewModel.nextAction.copy).not.toMatch(/授权.*消耗/)
    expect(viewModel.nextAction.primaryActionId).toBe('retryGitHubDelivery')
    expect(viewModel.actionCatalog).toHaveProperty(
      'retryGitHubDelivery.label',
      'Retry GitHub Delivery',
    )
    expect(viewModel.actionCatalog.retryGitHubDelivery.disabledReasons).toEqual([])
  })

  it('retries a revoked delivery only through an explicit action with a live binding', () => {
    const prNode = findNode((candidate) => candidate.kind === 'pr')
    const viewModel = viewModelFor(prNode, {
      artifacts: [prDeliveryPackage(prNode.id)],
      githubDeliveryIntent: githubDeliveryIntent('revoked'),
      hasTeamProjectBinding: true,
    })

    expect(viewModel.nextAction).toMatchObject({
      title: 'Retry GitHub Delivery',
      primaryActionId: 'retryGitHubDelivery',
      secondaryActionIds: [],
    })
    expect(viewModel.nextAction.copy).toContain('精确远端终态')
    expect(viewModel.nextAction.copy).toContain('新的 Work Request/Run')
  })

  it('treats a completed Draft PR as delivery evidence while workflow advancement catches up', () => {
    const prNode = findNode((candidate) => candidate.kind === 'pr')
    const viewModel = viewModelFor(prNode, {
      artifacts: [prDeliveryPackage(prNode.id)],
      githubDeliveryIntent: githubDeliveryIntent('completed', {
        completion: {
          stateVersion: 1,
          remoteRequestId: 'delivery-request-1',
          publicationId: 'publication-1',
          pullRequestOutcomeId: 'pull-request-outcome-1',
          pullRequestId: '123456',
          pullRequestNumber: 17,
          pullRequestUrl: 'https://github.com/erich/ai-devflow-studio/pull/17',
          providerCreatedAt: '2026-08-11T12:03:00.000Z',
          recordedAt: '2026-08-11T12:03:01.000Z',
          draft: true,
          redacted: true,
        },
      }),
      canVerifyGitHubDeliveryRevocation: true,
    })

    expect(viewModel.nextAction).toMatchObject({
      title: 'Draft PR 已创建',
      secondaryActionIds: ['verifyGitHubDeliveryRevocation'],
    })
    expect(viewModel.nextAction.copy).toContain('Workflow')
    expect(viewModel.nextAction.primaryActionId).toBeUndefined()
    expect(viewModel.actionCatalog.verifyGitHubDeliveryRevocation).toMatchObject({
      label: 'Verify credential revocation',
      disabledReasons: [],
    })
  })

  it('keeps credential revocation verification reachable from Acceptance delivery evidence', () => {
    const acceptanceNode = findNode((candidate) => candidate.kind === 'acceptance')
    const viewModel = viewModelFor(acceptanceNode, {
      githubDeliveryIntent: githubDeliveryIntent('completed'),
      canVerifyGitHubDeliveryRevocation: true,
    })

    expect(viewModel.actions.map((action) => action.id)).toContain(
      'verifyGitHubDeliveryRevocation',
    )
  })

  it('keeps credential revocation verification reachable on a completed PR node', () => {
    const prNode = {
      ...findNode((candidate) => candidate.kind === 'pr'),
      status: 'success' as const,
    }
    const viewModel = viewModelFor(prNode, {
      isSelectedCurrentNode: false,
      githubDeliveryIntent: githubDeliveryIntent('completed'),
      canVerifyGitHubDeliveryRevocation: true,
    })

    expect([
      ...viewModel.nextAction.secondaryActionIds,
      ...viewModel.actions.map((action) => action.id),
    ]).toContain('verifyGitHubDeliveryRevocation')
  })

  it.each([
    'approval_required',
    'approved',
    'publishing_branch',
    'branch_published',
    'creating_pr',
    'failed',
    'recovery_required',
    'revoked',
  ] as const)('does not offer credential revocation verification for %s delivery', (status) => {
    const prNode = findNode((candidate) => candidate.kind === 'pr')
    const viewModel = viewModelFor(prNode, {
      githubDeliveryIntent: githubDeliveryIntent(status),
      canVerifyGitHubDeliveryRevocation: true,
    })

    expect(viewModel.nextAction.primaryActionId).not.toBe(
      'verifyGitHubDeliveryRevocation',
    )
    expect(viewModel.nextAction.secondaryActionIds).not.toContain(
      'verifyGitHubDeliveryRevocation',
    )
    expect(viewModel.actions.map((action) => action.id)).not.toContain(
      'verifyGitHubDeliveryRevocation',
    )
  })

  it('selects the active immutable revision ahead of its same-timestamp revoked predecessor', () => {
    const prNode = findNode((candidate) => candidate.kind === 'pr')
    const replacedAt = '2026-08-11T13:00:00.000Z'
    const predecessor = githubDeliveryIntent('revoked', {
      id: 'github-delivery-intent-revision-1',
      deliveryAttempt: 1,
      createdAt: '2026-08-11T12:00:00.000Z',
      updatedAt: replacedAt,
    })
    const revision = githubDeliveryIntent('approval_required', {
      id: 'github-delivery-intent-revision-2',
      deliveryAttempt: 1,
      createdAt: replacedAt,
      updatedAt: replacedAt,
      intentDigest: 'f'.repeat(64),
    })

    expect(selectGitHubDeliveryIntentForInspector({
      run,
      node: prNode,
      intents: [predecessor, revision],
    })).toBe(revision)
    expect(selectGitHubDeliveryIntentForInspector({
      run,
      node: prNode,
      intents: [revision, predecessor],
    })).toBe(revision)
  })

  it('selects the completed PR intent recorded on the Acceptance Run instead of a newer historical intent', () => {
    const acceptanceNode = findNode((candidate) => candidate.kind === 'acceptance')
    const pullRequestUrl = 'https://github.com/erich/ai-devflow-studio/pull/17'
    const prPackageArtifactId = 'artifact-pr-delivery-package'
    const acceptanceRun = {
      ...run,
      pullRequestUrl,
      nodes: run.nodes.map((node) => (
        node.kind === 'pr'
          ? { ...node, artifactIds: [...node.artifactIds, prPackageArtifactId] }
          : node
      )),
    }
    const canonicalIntent = githubDeliveryIntent('completed', {
      prPackageArtifactId,
      completion: {
        stateVersion: 1,
        remoteRequestId: 'delivery-request-1',
        publicationId: 'publication-1',
        pullRequestOutcomeId: 'pull-request-outcome-1',
        pullRequestId: '123456',
        pullRequestNumber: 17,
        pullRequestUrl,
        providerCreatedAt: '2026-08-11T12:03:00.000Z',
        recordedAt: '2026-08-11T12:03:01.000Z',
        draft: true,
        redacted: true,
      },
    })
    const newerHistoricalIntent = githubDeliveryIntent('completed', {
      id: 'github-delivery-intent-historical',
      prPackageArtifactId,
      updatedAt: '2026-08-11T13:00:00.000Z',
      completion: {
        ...canonicalIntent.completion!,
        pullRequestId: '654321',
        pullRequestNumber: 18,
        pullRequestUrl: 'https://github.com/erich/ai-devflow-studio/pull/18',
      },
    })

    expect(selectGitHubDeliveryIntentForInspector({
      run: acceptanceRun,
      node: acceptanceNode,
      intents: [newerHistoricalIntent, canonicalIntent],
    })).toBe(canonicalIntent)
  })

  it('fails closed when more than one PR intent claims the Acceptance Run Draft URL', () => {
    const acceptanceNode = findNode((candidate) => candidate.kind === 'acceptance')
    const pullRequestUrl = 'https://github.com/erich/ai-devflow-studio/pull/17'
    const prPackageArtifactId = 'artifact-pr-delivery-package'
    const acceptanceRun = {
      ...run,
      pullRequestUrl,
      nodes: run.nodes.map((node) => (
        node.kind === 'pr'
          ? { ...node, artifactIds: [...node.artifactIds, prPackageArtifactId] }
          : node
      )),
    }
    const canonicalIntent = githubDeliveryIntent('completed', {
      prPackageArtifactId,
      completion: {
        stateVersion: 1,
        remoteRequestId: 'delivery-request-1',
        publicationId: 'publication-1',
        pullRequestOutcomeId: 'pull-request-outcome-1',
        pullRequestId: '123456',
        pullRequestNumber: 17,
        pullRequestUrl,
        providerCreatedAt: '2026-08-11T12:03:00.000Z',
        recordedAt: '2026-08-11T12:03:01.000Z',
        draft: true,
        redacted: true,
      },
    })
    const conflictingIntent = {
      ...canonicalIntent,
      id: 'github-delivery-intent-conflict',
      expectedCommitSha: '3'.repeat(40),
      intentDigest: 'e'.repeat(64),
    }

    expect(selectGitHubDeliveryIntentForInspector({
      run: acceptanceRun,
      node: acceptanceNode,
      intents: [canonicalIntent, conflictingIntent],
    })).toBeUndefined()
  })

  it.each([
    ['failed', true, '交付已安全停止', '不会自动重试', 'retryGitHubDelivery'],
    ['revoked', false, 'GitHub 授权已撤销', '重新绑定', undefined],
  ] as const)(
    'shows a safe operator next step for %s delivery',
    (status, hasTeamProjectBinding, title, guidance, primaryActionId) => {
    const prNode = findNode((candidate) => candidate.kind === 'pr')
    const viewModel = viewModelFor(prNode, {
      artifacts: [prDeliveryPackage(prNode.id)],
      githubDeliveryIntent: githubDeliveryIntent(status),
      hasTeamProjectBinding,
    })

    expect(viewModel.nextAction.title).toBe(title)
    expect(viewModel.nextAction.copy).toContain(guidance)
    expect(viewModel.nextAction.primaryActionId).toBe(primaryActionId)
  })

  it('keeps build budget guidance neutral until a concrete budget decision is available', () => {
    const buildNode = findNode((candidate) => candidate.kind === 'task' && candidate.stage === 'build')
    const descriptor = viewModelFor(buildNode).statusDescriptors.find((candidate) => candidate.id === 'budget')

    expect(descriptor).toMatchObject({
      state: 'preflight required',
      summary: '真实 runtime 会在启动前完成预算与授权检查。',
      nextAction: '在 Agents 中查看预算检查结果，并按实际阻断原因处理。',
    })
    expect(`${descriptor?.summary} ${descriptor?.nextAction}`).not.toMatch(/approval|lead/i)
  })

  it('does not expose a primary action for non-current or completed nodes', () => {
    const buildNode = findNode((candidate) => candidate.kind === 'task' && candidate.stage === 'build')
    const clarifyNode = findNode((candidate) => candidate.kind === 'agent' && candidate.stage === 'clarify')
    const waitingAction = viewModelFor(buildNode, { isSelectedCurrentNode: false }).nextAction
    const completedAction = viewModelFor(clarifyNode).nextAction

    expect(waitingAction).toMatchObject({
      title: '等待上游节点',
      secondaryActionIds: [],
    })
    expect(waitingAction.primaryActionId).toBeUndefined()
    expect(completedAction).toMatchObject({
      title: '查看已完成证据',
      secondaryActionIds: [],
    })
    expect(completedAction.primaryActionId).toBeUndefined()
  })

  it('resolves artifact and event search results to inspector tabs', () => {
    const clarifyNode = findNode((candidate) => candidate.kind === 'agent' && candidate.stage === 'clarify')
    const designNode = findNode((candidate) => candidate.kind === 'agent' && candidate.stage === 'design')
    const gateNode = findNode((candidate) => candidate.kind === 'gate')
    const prNode = findNode((candidate) => candidate.kind === 'pr')

    expect(resolveInspectorTabForSearchResult(clarifyNode, 'artifact')).toBe('产物')
    expect(resolveInspectorTabForSearchResult(designNode, 'artifact')).toBe('Evidence')
    expect(resolveInspectorTabForSearchResult(prNode, 'artifact')).toBe('Artifacts')
    expect(resolveInspectorTabForSearchResult(clarifyNode, 'event')).toBe('Trace')
    expect(resolveInspectorTabForSearchResult(prNode, 'event')).toBe('Handoff')
    expect(resolveInspectorTabForSearchResult(gateNode, 'event')).toBe('状态')
  })
})
