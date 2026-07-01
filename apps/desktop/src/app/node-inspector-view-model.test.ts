import { describe, expect, it } from 'vitest'
import type { WorkflowNode } from '@ai-devflow/shared'
import { artifacts as fixtureArtifacts, runs as fixtureRuns } from '@ai-devflow/shared/fixtures'
import {
  buildNodeInspectorViewModel,
  resolveInspectorTabForSearchResult,
} from './node-inspector-view-model'

const run = fixtureRuns[0]!

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
    expect(viewModel.statusDescriptors.map((descriptor) => descriptor.label)).not.toContain('Knowledge Review')
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
    expect(viewModel.tabs.map((tab) => tab.label)).toEqual(['状态', 'Knowledge Review', '引用来源', 'Evidence'])
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
      'Knowledge Review',
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
      primaryActionId: 'approveGate',
      secondaryActionIds: ['openKnowledgeReview'],
    })
    expect(viewModel.nextAction.copy).toContain('Gate 条件拆解')
    expect(viewModel.nextAction.copy).not.toContain('Tests')
    expect(viewModel.actions.map((action) => action.id)).toEqual([])
    expect(viewModel.gateRequirementRows.map((row) => row.label)).toEqual([
      'Policy snapshot',
      'Role permission',
      'Knowledge Review',
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
