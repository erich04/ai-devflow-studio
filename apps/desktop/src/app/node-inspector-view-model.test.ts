import { describe, expect, it } from 'vitest'
import type {
  Artifact,
  CodingAgentRun,
  CodingDiffArtifact,
  GitHubDeliveryIntent,
  GitHubDeliveryOperatorOutcome,
  WorkflowNode,
  TestEvidence,
} from '@ai-devflow/shared'
import { artifacts as fixtureArtifacts, runs as fixtureRuns } from '@ai-devflow/shared/fixtures'
import {
  buildGateReadinessPresentation,
  buildNodeInspectorViewModel,
  formatStatusState,
  inspectorTabPlansByNodeType,
  resolveInspectorTabForSearchResult,
  selectGitHubDeliveryIntentForInspector,
  selectInspectorPrPackage,
  hasArchivedUpstreamCodingDiff,
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
  it('shows an upstream archived diff before any delivery intent, without treating the package as generated', () => {
    const node = findNode((candidate) => candidate.kind === 'pr')
    const build = findNode((candidate) => candidate.stage === 'build')
    const coding: CodingAgentRun = {
      id: 'coding-latest', runId: run.id, nodeId: build.id, projectId: run.projectId,
      requestedBy: 'user', providerId: 'provider', engine: 'native', status: 'completed',
      branchName: 'feature/test', userInstruction: '', prompt: '', summary: '', changedPaths: ['README.md'],
      startedAt: '2026-09-19T00:00:00Z', completedAt: '2026-09-19T00:01:00Z', redacted: true,
      diffArtifactId: 'diff-latest',
    }
    const diff: CodingDiffArtifact = {
      id: coding.diffArtifactId!, runId: run.id, nodeId: build.id, projectId: run.projectId,
      changedPaths: ['README.md'], patch: '-old\n+new', sourceDigest: 'a'.repeat(64), truncated: false,
      redacted: true, createdAt: coding.completedAt!,
    }
    const ready = (codingRuns = [coding], diffs = [diff]) => hasArchivedUpstreamCodingDiff({ run, node, codingRuns, diffs })
    expect(ready()).toBe(true) // A cleaned workspace does not erase the archived diff.
    const vm = viewModelFor(node, { artifacts: [], upstreamCodingDiffReady: ready() })
    expect(vm.statusDescriptors.find((item) => item.id === 'handoff-evidence')).toMatchObject({ state: 'ready' })
    expect(vm.statusDescriptors.find((item) => item.id === 'pr-draft')).toMatchObject({ state: 'empty' })
    expect(vm.nextAction.primaryActionId).toBe('createPrDraft')
    for (const status of ['running', 'failed', 'cancelled'] as const) {
      expect(ready([coding, { ...coding, id: 'newer', status, startedAt: '2026-09-19T01:00:00Z' }])).toBe(false)
    }
    expect(ready([{ ...coding, projectId: 'foreign' }])).toBe(false)
    expect(ready([{ ...coding, runId: 'foreign' }])).toBe(false)
    expect(ready([{ ...coding, nodeId: node.id }])).toBe(false)
    for (const invalid of [
      { ...diff, runId: 'foreign' }, { ...diff, nodeId: node.id }, { ...diff, projectId: 'foreign' },
      { ...diff, id: 'other' }, { ...diff, truncated: true }, { ...diff, sourceDigest: '' }, { ...diff, patch: '' },
    ]) expect(ready([coding], [invalid])).toBe(false)
  })

  it('shows the archived Native diff even when it is not a generic workflow Artifact', () => {
    const node = findNode((candidate) => candidate.stage === 'build')
    const vm = viewModelFor(node, {
      artifacts: [],
      codingActionProjection: {
        scope: { runId: run.id, nodeId: node.id, projectId: run.projectId },
        phase: 'completed', history: [],
        action: { id: 'view-result', target: 'agents-evidence', label: '查看结果', summary: '', disabled: false,
          createsNewRun: false, mayInvokeProvider: false, requiresConfirmation: false },
        terminal: { providerId: 'deepseek', engine: 'native', reason: 'completed', changedPaths: ['README.md'],
          diffPatch: '-# Old\n+# New', trace: [], workspaceCleanupStatus: 'active', canOpenWorkspace: true },
      },
    })
    expect(vm.statusDescriptors.find((item) => item.id === 'coding-diff')).toMatchObject({ state: 'ready', tone: 'good' })
  })

  it('shows the exact delivery test and diff instead of requiring downstream duplicate Artifacts', () => {
    const node = findNode((candidate) => candidate.kind === 'pr')
    const intent = githubDeliveryIntent('completed')
    const evidence: TestEvidence = { id: intent.testEvidenceId, runId: run.id, nodeId: 'build', projectId: run.projectId,
      command: 'pnpm test', cwd: '<workspace>', status: 'passed', exitCode: 0, durationMs: 5,
      stdout: '', stderr: '', summary: 'Exact commit passed', redacted: true, createdAt: intent.testEvidenceCreatedAt }
    const vm = viewModelFor(node, { artifacts: [], githubDeliveryIntent: intent, testEvidence: [evidence] })
    expect(vm.statusDescriptors.find((item) => item.id === 'test-evidence')).toMatchObject({ state: 'passed' })
    expect(vm.statusDescriptors.find((item) => item.id === 'handoff-evidence')).toMatchObject({ state: 'ready' })
    const failed = viewModelFor(node, { artifacts: [], githubDeliveryIntent: intent, testEvidence: [{ ...evidence, status: 'failed' }] })
    expect(failed.statusDescriptors.find((item) => item.id === 'test-evidence')).toMatchObject({ state: 'failed', tone: 'bad' })
  })

  it('resolves only the exact upstream PR package for Acceptance', () => {
    const node = findNode((candidate) => candidate.kind === 'acceptance')
    const intent = githubDeliveryIntent('completed')
    const pkg = prDeliveryPackage(intent.nodeId)
    expect(selectInspectorPrPackage({ node, artifacts: [pkg], githubDeliveryIntent: intent })).toEqual(pkg)
    expect(selectInspectorPrPackage({ node, artifacts: [{ ...pkg, id: 'unrelated-package' }], githubDeliveryIntent: intent })).toBeUndefined()
    expect(selectInspectorPrPackage({ node, artifacts: [pkg] })).toBeUndefined()
  })

  it('keeps clarify agents in Task inspector tabs and exposes the clarify action', () => {
    const node: WorkflowNode = {
      ...findNode((candidate) => candidate.kind === 'agent' && candidate.stage === 'clarify'),
      status: 'running',
    }
    const viewModel = viewModelFor(node)

    expect(viewModel.visualKind).toBe('Task')
    expect(viewModel.tabs.map((tab) => tab.label)).toEqual(['概览', '内容与审查', '产物与证据', '执行记录'])
    expect(viewModel.activeTab.sections).toEqual(['statusMatrix', 'gateImpactSummary'])
    expect(viewModel.tabs.find((tab) => tab.label === '概览')?.sections).toContain('gateImpactSummary')
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
      title: '可以生成需求修订',
      kind: 'ready',
      primaryActionId: 'completeAgent',
      secondaryActionIds: [],
    })
    expect(viewModel.actionCatalog.completeAgent).toMatchObject({
      label: '生成修订',
      testId: 'complete-clarify-agent',
    })
    expect(viewModel.contextProjection.fields.find((field) => field.field === 'agent_review')).toMatchObject({
      state: 'not_applicable',
      visible: false,
    })
    expect(viewModel.actions.map((action) => action.id)).not.toContain('approveGate')
  })

  it('maps design agents to Task tabs and keeps Gate Review separate', () => {
    const node: WorkflowNode = {
      ...findNode((candidate) => candidate.kind === 'agent' && candidate.stage === 'design'),
      status: 'running',
    }
    const viewModel = viewModelFor(node, { requestedTab: '轨迹' })

    expect(viewModel.visualKind).toBe('Task')
    expect(viewModel.header.presentation).toMatchObject({
      nodeKind: 'Task',
      sourceKind: 'run_template',
      displayMode: 'standard',
    })
    expect(viewModel.tabs.map((tab) => tab.label)).toEqual(['概览', '内容与审查', '产物与证据', '执行记录'])
    expect(viewModel.activeTab.label).toBe('执行记录')
    expect(viewModel.activeTab.sections).toEqual(['trace', 'artifactRecords'])
    expect(viewModel.statusDescriptors.map((descriptor) => descriptor.id)).toEqual([
      'node-status',
      'design-artifact',
      'trace',
    ])
    expect(viewModel.nextAction).toMatchObject({
      title: '可以生成方案',
      kind: 'ready',
      primaryActionId: 'completeAgent',
      secondaryActionIds: [],
    })
    expect(viewModel.actionCatalog.completeAgent).toMatchObject({
      label: '生成方案',
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
    expect(viewModel.activeTab.sections).toEqual(['statusMatrix', 'gateEnforcementPanel', 'remediationActions'])
    expect(viewModel.statusDescriptors.map((descriptor) => descriptor.id)).toEqual([
      'gate-decision',
      'policy-snapshot',
      'approval-permission',
      'knowledge-review',
      'required-artifact',
    ])
    expect(viewModel.nextAction).toMatchObject({
      title: '等待你确认需求',
      kind: 'approvable',
      primaryActionId: 'approveGate',
      secondaryActionIds: ['openKnowledgeReview'],
    })
    expect(viewModel.actionCatalog.approveGate.label).toBe('确认需求')
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
    expect(viewModel.tabs.map((tab) => tab.label)).toEqual(['概览', '内容与审查', '产物与证据', '执行记录'])
    expect(viewModel.activeTab.sections).toEqual(['statusMatrix', 'gateEnforcementPanel', 'remediationActions'])
    expect(viewModel.activeTab.sections).not.toContain('nodeSummary')
    expect(viewModel.activeTab.sections).toContain('gateEnforcementPanel')
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

  it('separates Knowledge reference sources from auditable Review Evidence for Gate nodes', () => {
    const node = findNode((candidate) => candidate.kind === 'gate' && candidate.stage === 'design')
    const viewModel = viewModelFor(node, {
      requestedTab: '引用来源',
      knowledgeReferenceCount: 2,
      testEvidenceCount: 0,
    })
    const referencesTab = viewModel.tabs.find((tab) => tab.label === '产物与证据')
    const evidenceTab = viewModel.tabs.find((tab) => tab.label === '内容与审查')

    expect(referencesTab?.sections).toEqual(['artifacts', 'testEvidence', 'knowledgeReferences', 'governance'])
    expect(evidenceTab?.sections).toEqual(['workspaceContent'])
    expect(referencesTab?.sections).not.toEqual(evidenceTab?.sections)
    expect(viewModel.activeTab).toEqual(referencesTab)
    expect(viewModel.contextProjection.fields.find((field) => field.field === 'test_evidence')).toMatchObject({
      state: 'optional',
      visible: false,
    })
  })

  it('audits every tab plan for accidental semantic aliases', () => {
    for (const tabs of Object.values(inspectorTabPlansByNodeType)) {
      const uniqueSemanticPlans = new Map<string, string>()
      for (const tab of tabs) {
        const signature = tab.sections.join('|')
        const previous = uniqueSemanticPlans.get(signature)
        expect(
          previous,
          `${previous ?? 'unknown'} and ${tab.label} unexpectedly share ${signature}`,
        ).toBeUndefined()
        uniqueSemanticPlans.set(signature, tab.label)
      }
    }
  })

  it('hides local test actions and requirements on design gates', () => {
    const node = findNode((candidate) => candidate.id === run.currentNodeId && candidate.kind === 'gate')
    const viewModel = viewModelFor(node, { requestedTab: 'Gate条件' })

    expect(viewModel.visualKind).toBe('Gate')
    expect(viewModel.activeTab.sections).toEqual(['statusMatrix', 'gateEnforcementPanel', 'remediationActions'])
    expect(viewModel.statusDescriptors.map((descriptor) => descriptor.id)).toEqual([
      'gate-decision',
      'policy-snapshot',
      'approval-permission',
      'knowledge-review',
      'required-artifact',
    ])
    expect(viewModel.nextAction).toMatchObject({
      title: '等待有权限的成员确认方案',
      kind: 'awaiting_role',
      secondaryActionIds: ['openKnowledgeReview'],
    })
    expect(viewModel.nextAction.primaryActionId).toBeUndefined()
    expect(viewModel.nextAction.copy).toContain('没有审批权限')
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
      title: '等待你确认测试证据 Gate',
      primaryActionId: 'approveGate',
      secondaryActionIds: ['openKnowledgeReview', 'openTests'],
    })
    expect(viewModel.actionCatalog.approveGate.label).toBe('通过 Gate')
    expect(viewModel.statusDescriptors.map((descriptor) => descriptor.id)).toContain('test-evidence')
    expect(viewModel.gateRequirementRows.map((row) => row.label)).toContain('Test Evidence')
    expect(viewModel.contextProjection.fields.find((field) => field.field === 'test_evidence')).toMatchObject({
      state: 'missing_required',
      visible: true,
    })
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
      activeTab: { label: '概览', sections: ['statusMatrix', 'gateImpactSummary', 'deliveryHandoff'] },
    })
    expect(viewModelFor(buildNode).activeTab.sections).not.toContain('gateEnforcementPanel')
    expect(viewModelFor(testNode).activeTab.sections).not.toContain('gateEnforcementPanel')
    expect(viewModelFor(prNode).activeTab.sections).not.toContain('gateEnforcementPanel')
    expect(viewModelFor(buildNode).actions.map((action) => action.id)).not.toContain('approveGate')
    expect(viewModelFor(testNode).actions.map((action) => action.id)).not.toContain('approveGate')
    expect(viewModelFor(prNode).actions.map((action) => action.id)).not.toContain('approveGate')
  })

  it('presents completed acceptance as approved while keeping read-only delivery verification available', () => {
    const node = { ...findNode((candidate) => candidate.kind === 'acceptance'), status: 'success' as const }
    const vm = viewModelFor(node, {
      canApprove: true,
      githubDeliveryIntent: githubDeliveryIntent('completed'),
      canVerifyGitHubDeliveryRevocation: true,
    })
    expect(vm.nextAction.primaryActionId).toBeUndefined()
    // The follow-up check stays on the first layer, not in the “⋯” menu.
    expect(vm.nextAction.secondaryActionIds).toEqual(['verifyGitHubDeliveryRevocation'])
    expect(vm.actions).toEqual([])
    expect(vm.statusDescriptors.find((item) => item.id === 'gate-decision')).toMatchObject({
      state: '已批准',
      summary: '该节点已完成批准；历史审查与策略评估仍保留供核对。',
      nextAction: '查看执行记录与已归档证据。',
    })
  })

  it('requires an explicit GitHub Delivery preparation after the exact PR package is attached', () => {
    const prNode = findNode((candidate) => candidate.kind === 'pr')
    const prPackage = prDeliveryPackage(prNode.id)

    const viewModel = viewModelFor(prNode, { artifacts: [prPackage] })

    expect(viewModel.nextAction).toMatchObject({
      title: '可以准备交付',
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
      secondaryActionIds: [],
      persistentActionIds: ['stopGitHubDelivery'],
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
      title: '交付需要恢复',
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

    expect(viewModel.nextAction.title).toBe('正在发布交付')
    expect(viewModel.nextAction.persistentActionIds).toEqual(['stopGitHubDelivery'])
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
      title: '交付已获批准，等待发布',
      primaryActionId: 'reviseGitHubDelivery',
      secondaryActionIds: [],
      persistentActionIds: ['stopGitHubDelivery'],
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
      title: '交付授权已撤销',
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

    expect(viewModel.nextAction.secondaryActionIds).toContain('verifyGitHubDeliveryRevocation')
    expect(viewModel.actions.map((action) => action.id)).not.toContain('verifyGitHubDeliveryRevocation')
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
      title: '等待上游完成',
      kind: 'waiting_upstream',
      secondaryActionIds: [],
    })
    expect(waitingAction.primaryActionId).toBeUndefined()
    expect(completedAction).toMatchObject({
      title: '此步骤已完成',
      kind: 'history',
      secondaryActionIds: [],
    })
    expect(completedAction.primaryActionId).toBeUndefined()
  })

  it('resolves artifact and event search results to inspector tabs', () => {
    const clarifyNode = findNode((candidate) => candidate.kind === 'agent' && candidate.stage === 'clarify')
    const designNode = findNode((candidate) => candidate.kind === 'agent' && candidate.stage === 'design')
    const gateNode = findNode((candidate) => candidate.kind === 'gate')
    const prNode = findNode((candidate) => candidate.kind === 'pr')

    expect(resolveInspectorTabForSearchResult(clarifyNode, 'artifact')).toBe('产物与证据')
    expect(resolveInspectorTabForSearchResult(designNode, 'artifact')).toBe('产物与证据')
    expect(resolveInspectorTabForSearchResult(designNode, 'event')).toBe('执行记录')
    expect(resolveInspectorTabForSearchResult(prNode, 'artifact')).toBe('产物与证据')
    expect(resolveInspectorTabForSearchResult(clarifyNode, 'event')).toBe('执行记录')
    expect(resolveInspectorTabForSearchResult(prNode, 'event')).toBe('执行记录')
    expect(resolveInspectorTabForSearchResult(gateNode, 'event')).toBe('执行记录')
  })
})

describe('task status row projection (S1, plan §6.1)', () => {
  const clarifyGate: WorkflowNode = {
    ...findNode((candidate) => candidate.kind === 'gate' && candidate.stage === 'clarify'),
    status: 'running',
  }
  const requirementV2 = { kind: 'requirement' as const, determinable: true, revision: 2 }
  const decision = (overrides: Partial<NonNullable<Parameters<typeof buildNodeInspectorViewModel>[0]['gateEnforcementDecision']>> = {}) => ({
    status: 'warn' as const,
    blocksApproval: false,
    blockingReasons: [],
    warningReasons: [],
    requiredActions: [],
    canOverride: false,
    overrideRoleRequired: 'lead' as const,
    policySource: 'built_in_default' as const,
    policyVersion: 1,
    provisional: false,
    ...overrides,
  })
  const missingReviewReason = {
    id: 'missing-review', target: 'missing_agent_review' as const, ruleKey: 'missing_agent_review:protected_gate:missing',
    action: 'warn' as const, summary: 'Gate Review missing',
  }
  const review = (counts: { risks: number; tests: number }) => ({
    risks: Array.from({ length: counts.risks }, (_, index) => `risk ${index}`),
    missingEvidence: [],
    suggestedTests: Array.from({ length: counts.tests }, (_, index) => `test ${index}`),
    policyFindings: [],
    knowledgeReferences: [],
    gateAdvisory: { level: counts.risks ? 'warn' : 'info', blocksApproval: false, summary: 'review', missingEvidence: [], riskCount: counts.risks },
  }) as unknown as NonNullable<Parameters<typeof buildNodeInspectorViewModel>[0]['latestAgentReview']>

  it('keeps approval reachable when a warn-only policy only lacks the Gate Review (D1)', () => {
    const viewModel = viewModelFor(clarifyGate, {
      canApprove: true,
      approvalTarget: requirementV2,
      gateEnforcementDecision: decision({ warningReasons: [missingReviewReason] }),
    })
    expect(viewModel.nextAction).toMatchObject({
      kind: 'approvable',
      title: '等待你确认需求 v2',
      qualifier: '尚未运行 AI 审查',
      primaryActionId: 'openKnowledgeReview',
      secondaryActionIds: ['approveGate'],
      confirmBefore: { actionId: 'approveGate' },
    })
    expect(viewModel.nextAction.confirmBefore?.message).toContain('需求 v2')
    expect(viewModel.actionCatalog.approveGate.label).toBe('确认需求 v2')
    expect(viewModel.actionCatalog.openKnowledgeReview.label).toBe('去 Agents 运行门禁审查')
  })

  it('confirms directly and counts review suggestions when a review exists (X5)', () => {
    const viewModel = viewModelFor(clarifyGate, {
      canApprove: true,
      approvalTarget: requirementV2,
      latestAgentReview: review({ risks: 3, tests: 1 }),
      gateEnforcementDecision: decision({ status: 'pass' }),
    })
    expect(viewModel.nextAction).toMatchObject({
      kind: 'approvable', title: '等待你确认需求 v2', qualifier: '有 4 条建议', primaryActionId: 'approveGate',
    })
    expect(viewModel.nextAction.confirmBefore).toBeUndefined()
  })

  it('shows no qualifier when the review has no suggestions', () => {
    const viewModel = viewModelFor(clarifyGate, {
      canApprove: true,
      approvalTarget: requirementV2,
      latestAgentReview: review({ risks: 0, tests: 0 }),
      gateEnforcementDecision: decision({ status: 'pass' }),
    })
    expect(viewModel.nextAction).toMatchObject({ kind: 'approvable', primaryActionId: 'approveGate', secondaryActionIds: [] })
    expect(viewModel.nextAction.qualifier).toBeUndefined()
  })

  it('never offers approval under an enforced block', () => {
    const blocked = viewModelFor(clarifyGate, {
      canApprove: false,
      approvalTarget: requirementV2,
      gateEnforcementDecision: decision({ status: 'blocked', blocksApproval: true, blockingReasons: [{ ...missingReviewReason, action: 'block' }] }),
    })
    expect(blocked.nextAction).toMatchObject({ kind: 'blocked', tone: 'blocked', primaryActionId: 'openKnowledgeReview' })
    expect(blocked.nextAction.secondaryActionIds).not.toContain('approveGate')
    expect(blocked.nextAction.primaryActionId).not.toBe('approveGate')
  })

  it('treats an unavailable team policy as unverified and offers a team data update (X4)', () => {
    const viewModel = viewModelFor(clarifyGate, {
      canApprove: false,
      approvalTarget: requirementV2,
      gateEnforcementDecision: decision({
        status: 'blocked_policy_unavailable', blocksApproval: true,
        blockingReasons: [{ id: 'policy-unavailable', target: 'missing_agent_review', ruleKey: 'policy-unavailable', action: 'block', summary: 'Sync team enforcement policy before approving this Gate.' }],
      }),
    })
    expect(viewModel.nextAction).toMatchObject({ kind: 'unverified', title: '状态待核实', primaryActionId: 'syncTeam' })
    expect(viewModel.nextAction.copy).not.toMatch(/Sync team/)
  })

  it('refuses to name an approval target it cannot determine', () => {
    const viewModel = viewModelFor(clarifyGate, {
      canApprove: true,
      approvalTarget: { kind: 'requirement', determinable: false, reason: '当前 Gate 关联了多个 Clarification Revision，已安全阻断审批。' },
      gateEnforcementDecision: decision({ status: 'pass' }),
    })
    expect(viewModel.nextAction).toMatchObject({ kind: 'unverified' })
    expect(viewModel.nextAction.primaryActionId).toBeUndefined()
  })

  it('does not tell a non-current Gate that it can pass (D5)', () => {
    const viewModel = viewModelFor(clarifyGate, {
      isSelectedCurrentNode: false,
      canApprove: true,
      gateEnforcementDecision: decision({ status: 'pass' }),
    })
    expect(viewModel.nextAction.title).not.toMatch(/可以|确认/)
    expect(viewModel.gateReadinessSummary).toMatchObject({ canPass: false, headline: '尚未轮到这个 Gate' })
  })

  it('keeps stop and reject visible for running and permission states (X2)', () => {
    const buildNode = findNode((candidate) => candidate.kind === 'task' && candidate.stage === 'build')
    const projection = (action: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
      scope: { runId: run.id, nodeId: buildNode.id, projectId: run.projectId },
      history: [],
      action: { target: 'agents-progress', summary: 'summary', disabled: false, createsNewRun: false, mayInvokeProvider: false, requiresConfirmation: false, label: 'label', ...action },
      ...extra,
    }) as unknown as NonNullable<Parameters<typeof buildNodeInspectorViewModel>[0]['codingActionProjection']>
    const running = viewModelFor(buildNode, { codingActionProjection: projection({ id: 'view-progress' }, { phase: 'running' }) })
    expect(running.nextAction).toMatchObject({ kind: 'running', persistentActionIds: ['stopCodingRun'] })
    const permission = viewModelFor(buildNode, {
      codingActionProjection: projection({ id: 'review-permission' }, {
        phase: 'waiting_permission',
        permission: { request: { title: 'Apply change' }, canApprove: true, expired: false, remainingMs: 42_000, changedPaths: ['a.ts'] },
      }),
    })
    expect(permission.nextAction).toMatchObject({
      kind: 'permission', qualifier: '剩余 42 秒', primaryActionId: 'approveCodingPermission',
      persistentActionIds: ['rejectCodingPermission', 'stopCodingRun'],
    })
    // Code changes are approved only after the exact diff is shown, so the row links to that review.
    const changeSet = viewModelFor(buildNode, {
      codingActionProjection: projection({ id: 'review-permission', label: '审查并批准修改' }, {
        phase: 'waiting_permission',
        permission: { kind: 'change-set', request: { title: 'Apply change' }, canApprove: true, expired: false, remainingMs: 42_000, changedPaths: ['a.ts'] },
      }),
    })
    expect(changeSet.nextAction).toMatchObject({
      kind: 'permission', primaryActionId: 'openCodingAgent', secondaryActionIds: [],
      persistentActionIds: ['rejectCodingPermission', 'stopCodingRun'],
    })
    expect(changeSet.actionCatalog.openCodingAgent.label).toBe('审查并批准修改')
  })
})

describe('status value wording (plan §6.3, T1)', () => {
  it('maps engineering values to first-layer copy and leaves unknown values unchanged', () => {
    expect(formatStatusState('ready')).toBe('已记录')
    expect(formatStatusState('empty')).toBe('尚未生成')
    expect(formatStatusState('3 events')).toBe('有 3 条执行记录')
    expect(formatStatusState('2 linked')).toBe('已关联 2 份材料')
    expect(formatStatusState('待核实')).toBe('待核实')
  })
})
