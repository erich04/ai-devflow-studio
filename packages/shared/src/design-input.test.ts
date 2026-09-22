import { describe, expect, it, vi } from 'vitest'
import { createFakeAgentProvider, createOpenAiCompatibleAgentProvider } from './agent-review'
import { approveClarificationRevision, sha256Text } from './clarification'
import { resolveDesignClarificationInput } from './design-input'
import { runWorkflowStageAgent, type StageAgentExecutor } from './workflow-agent'
import { createWorkflowRunFromRequest, completeWorkflowAgentNode, advanceWorkflowAfterGateApproval } from './workflow'

async function approvedFixture() {
  const created = createWorkflowRunFromRequest({ runId: 'design-input-run', title: 'Filters',
    request: 'All / unfinished / completed. Reset filter on refresh; preserve task data.',
    projectId: 'project-1', creatorId: 'user-1', branchName: 'feature/filter', now: '2026-09-22T00:00:00.000Z' })
  const clarification = await runWorkflowStageAgent({ ...created, node: created.run.nodes[0]!,
    provider: createFakeAgentProvider(), requestedBy: 'user-1', runtime: 'electron' })
  const completed = completeWorkflowAgentNode({ ...created, nodeId: created.run.currentNodeId,
    generatedArtifact: clarification.artifact, existingEvents: created.events, actorName: 'User', now: '2026-09-22T00:01:00.000Z' })
  const approved = approveClarificationRevision({ artifact: clarification.artifact, actorId: 'user-1',
    gateNodeId: completed.run.currentNodeId, sequence: 3, now: '2026-09-22T00:02:00.000Z' })
  const advanced = advanceWorkflowAfterGateApproval({ run: completed.run, approvedNodeId: completed.run.currentNodeId, now: '2026-09-22T00:02:00.000Z' })
  return { run: advanced.run, artifacts: [created.artifacts[0]!, approved.artifact], approved: approved.artifact,
    node: advanced.run.nodes.find((node) => node.id === advanced.run.currentNodeId)! }
}

describe('design approval inputs', () => {
  it('binds the Gate-approved revision even if an unlinked draft has a newer timestamp', async () => {
    const fixture = await approvedFixture()
    const futureDraft = { ...fixture.approved, id: 'unapproved-draft', content: 'DO_NOT_SEND_UNAPPROVED_BODY',
      updatedAt: '2030-01-01T00:00:00.000Z', clarificationRevision: { ...fixture.approved.clarificationRevision!, status: 'draft' as const, revision: 2 } }
    let sent = ''
    const provider = createOpenAiCompatibleAgentProvider({ id: 'design-provider', model: 'test', apiKey: 'test', baseUrl: 'https://test.invalid',
      fetcher: async (_, init) => { sent = String(init?.body); return Response.json({ choices: [{ message: { content: JSON.stringify({
        title: 'Design', summary: 'Plan', content: '# Plan\nChange filters.\nRun npm test later.',
        goals: ['Filters'], acceptanceCriteria: ['Data persists'], nonGoals: ['Search'], openQuestions: [], assumptions: [], risks: [],
      }) } }] }) } })
    const proposal = { ...fixture.approved, id: 'conversation-proposal-design', nodeId: fixture.node.id,
      kind: 'log' as const, content: 'DESIGN_PROPOSAL_BODY: no new counts' }
    const result = await runWorkflowStageAgent({ ...fixture, artifacts: [...fixture.artifacts, futureDraft, proposal,
      { ...proposal, id: 'conversation-proposal-other-node', nodeId: 'other-node', content: 'OTHER_NODE_BODY' }],
      provider, requestedBy: 'user-1', runtime: 'electron' })
    const userPrompt = JSON.parse(sent).messages[1].content
    expect(userPrompt).toContain(fixture.run.request)
    expect(userPrompt).toContain(fixture.approved.content)
    expect(userPrompt).toContain(proposal.content)
    expect(userPrompt).not.toContain('DO_NOT_SEND_UNAPPROVED_BODY')
    expect(userPrompt).not.toContain('OTHER_NODE_BODY')
    expect(result.artifact.designEvidence?.clarification).toEqual({ artifactId: fixture.approved.id,
      gateNodeId: fixture.run.nodes.find((node) => node.stage === 'clarify' && node.kind === 'gate')!.id,
      revision: 1, revisionDigest: fixture.approved.clarificationRevision!.revisionDigest,
      contentDigest: await sha256Text(fixture.approved.content), legacy: false })
  })

  it.each(['pending', 'ambiguous', 'wrong-run', 'wrong-node', 'unapproved', 'tampered'] as const)('rejects %s input before provider invocation', async (failure) => {
    const fixture = await approvedFixture()
    const gate = fixture.run.nodes.find((node) => node.stage === 'clarify' && node.kind === 'gate')!
    if (failure === 'pending') gate.status = 'pending'
    if (failure === 'ambiguous') { gate.artifactIds.push('duplicate'); fixture.artifacts.push({ ...fixture.approved, id: 'duplicate' }) }
    if (failure === 'wrong-run') fixture.approved.runId = 'other'
    if (failure === 'wrong-node') fixture.approved.nodeId = fixture.node.id
    if (failure === 'unapproved') fixture.approved.clarificationRevision!.status = 'review_requested'
    if (failure === 'tampered') fixture.approved.clarificationRevision!.goals = ['Tampered']
    const provider = createFakeAgentProvider()
    const generate = vi.spyOn(provider, 'generateWorkflowArtifact')
    await expect(runWorkflowStageAgent({ ...fixture, provider, requestedBy: 'user-1', runtime: 'electron' })).rejects.toThrow()
    expect(generate).not.toHaveBeenCalled()
  })

  it('keeps uniquely Gate-linked legacy clarification usable without migrating it', async () => {
    const fixture = await approvedFixture()
    delete fixture.approved.clarificationRevision
    const resolved = await resolveDesignClarificationInput(fixture.run, fixture.artifacts)
    expect(resolved.binding.legacy).toBe(true)
    expect(resolved.binding.revision).toBeUndefined()
  })

  it('persists OpenCode design findings and stops at the design review Gate', async () => {
    const fixture = await approvedFixture()
    const output = await createFakeAgentProvider().generateWorkflowArtifact!({ request: {
      id: 'test', runId: fixture.run.id, nodeId: fixture.node.id, projectId: fixture.run.projectId,
      requestedBy: 'user-1', runtime: 'electron', stage: 'design' }, context: { run: fixture.run, node: fixture.node, artifacts: fixture.artifacts }, prompt: '' })
    const executor: StageAgentExecutor = { kind: 'local-agent', id: 'opencode', version: '1', providerId: 'saved-provider', model: 'test', execute: vi.fn(async () => ({
      value: { ...output, repositoryFindings: { version: 1 as const, repositoryDigest: 'a'.repeat(64),
        verifiedFacts: [{ id: 'fact', statement: 'A filter is present.', citationIds: ['source'] }],
        citations: [{ id: 'source', path: 'src/filter.ts', lineStart: 2, lineEnd: 3, contentDigest: 'b'.repeat(64) }],
        assumptions: [], openQuestions: [], uncheckedScopes: ['Generated files'] } }, terminalReason: 'success' as const, toolCalls: 2,
    })) }
    const result = await runWorkflowStageAgent({ ...fixture, executor, requestedBy: 'user-1', runtime: 'electron' })
    expect(result.artifact.designEvidence?.repositoryFindings?.citations[0]?.path).toBe('src/filter.ts')
    expect(result.artifact.content).toContain('src/filter.ts')
    const call = vi.mocked(executor.execute).mock.calls[0]![0]
    expect(call.prompt).toContain('Describe proposed file changes and verification commands as a future plan only')
    expect(call.capability).toMatchObject({ repositoryWrite: false, shell: false, workflowMutation: false })
    const completed = completeWorkflowAgentNode({ ...fixture, nodeId: fixture.node.id, generatedArtifact: result.artifact,
      existingEvents: [], actorName: 'User', now: result.artifact.updatedAt })
    expect(completed.nextNode).toMatchObject({ stage: 'design', kind: 'gate', status: 'running' })
  })
})
