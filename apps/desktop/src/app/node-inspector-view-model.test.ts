import { describe, expect, it } from 'vitest'
import { artifacts as fixtureArtifacts, runs as fixtureRuns, type WorkflowNode } from '@ai-devflow/shared'
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
    const node = findNode((candidate) => candidate.kind === 'agent' && candidate.stage === 'clarify')
    const viewModel = viewModelFor(node)

    expect(viewModel.visualKind).toBe('Task')
    expect(viewModel.tabs.map((tab) => tab.label)).toEqual(['状态', '产物', 'Trace', 'Gate影响'])
    expect(viewModel.activeTab.sections).toEqual([
      'statusMatrix',
      'nodeSummary',
      'gateEnforcementPanel',
      'governance',
      'agentReview',
      'artifacts',
    ])
    expect(viewModel.actions.map((action) => action.id)).toEqual(['completeAgent', 'approveGate'])
    expect(viewModel.actions[0]).toMatchObject({
      label: '生成需求澄清',
      testId: 'complete-clarify-agent',
    })
  })

  it('maps design agents to Review tabs and falls back from invalid requested tabs', () => {
    const node = findNode((candidate) => candidate.kind === 'agent' && candidate.stage === 'design')
    const viewModel = viewModelFor(node, { requestedTab: 'Trace' })

    expect(viewModel.visualKind).toBe('Review')
    expect(viewModel.tabs.map((tab) => tab.label)).toEqual(['状态', 'Knowledge Review', '引用来源', 'Evidence'])
    expect(viewModel.activeTab.label).toBe('状态')
    expect(viewModel.actions[0]).toMatchObject({
      label: '生成设计方案',
      testId: 'complete-design-agent',
    })
  })

  it('maps gates to Gate tabs and provides gate requirement rows', () => {
    const node = findNode((candidate) => candidate.kind === 'gate')
    const viewModel = viewModelFor(node, { requestedTab: 'Gate条件' })

    expect(viewModel.visualKind).toBe('Gate')
    expect(viewModel.activeTab.sections).toEqual(['gateRequirementMatrix', 'gateEnforcementPanel', 'governance'])
    expect(viewModel.gateRequirementRows.map((row) => row.label)).toEqual([
      'Policy snapshot',
      'Role permission',
      'Knowledge Review',
      'Test Evidence',
      'Budget',
      'Required Artifact',
    ])
  })

  it('maps delivery nodes to handoff tabs and delivery actions', () => {
    const prNode = findNode((candidate) => candidate.kind === 'pr')
    const acceptanceNode = findNode((candidate) => candidate.kind === 'acceptance')

    expect(viewModelFor(prNode, { requestedTab: 'Handoff' })).toMatchObject({
      visualKind: 'Delivery',
      activeTab: { label: 'Handoff', sections: ['deliveryHandoff', 'trace'] },
    })
    expect(viewModelFor(prNode).actions.map((action) => action.id)).toEqual(['approveGate', 'createPrDraft'])
    expect(viewModelFor(acceptanceNode).actions.map((action) => action.id)).toEqual([
      'approveGate',
      'createAcceptanceBundle',
    ])
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
