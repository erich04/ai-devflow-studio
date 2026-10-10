import { describe, expect, it, vi } from 'vitest'
import { createFakeAgentProvider } from './agent-review'
import { applyDesignRevision, resolveDesignRevisionInput } from './design-revision'
import { runWorkflowStageAgent } from './workflow-agent'
import { designRevisionFixture } from './test-fixtures/design-revision'

describe('explicit design revision from saved proposals', () => {
  it('sends the full old design and only selected proposals, preserves history and stays at the review Gate', async () => {
    const f = await designRevisionFixture()
    const before = structuredClone(f)
    const provider = createFakeAgentProvider()
    const generate = vi.fn(provider.generateWorkflowArtifact!)
    provider.generateWorkflowArtifact = generate
    const unselected = { ...f.proposal, id: 'conversation-proposal-unselected', content: 'UNSELECTED_DRAFT' }
    const generated = await runWorkflowStageAgent({ ...f, artifacts: [...f.artifacts, unselected], provider,
      requestedBy: 'user-1', runtime: 'electron', designRevision: f.selection })
    const prompt = generate.mock.calls[0]![0].prompt
    expect(prompt).toContain(f.design.content)
    expect(prompt).toContain(f.proposal.content)
    expect(prompt).not.toContain(unselected.content)
    expect(prompt).toContain('complete revised design')
    expect(generated.artifact.id).not.toBe(f.design.id)
    expect(generated.artifact.designRevision).toEqual({ version: 1, previous: f.selection.previous, proposals: f.selection.proposals })
    const run = await applyDesignRevision({ ...f, gateNodeId: f.run.currentNodeId, request: f.selection, artifact: generated.artifact })
    expect(run).toMatchObject({ currentNodeId: f.run.currentNodeId, status: 'paused_at_gate', version: f.run.version + 1 })
    expect(run.nodes.map((node) => node.status)).toEqual(f.run.nodes.map((node) => node.status))
    expect(run.nodes.find((node) => node.id === run.currentNodeId)?.artifactIds).toContain(generated.artifact.id)
    expect(run.nodes.find((node) => node.id === run.currentNodeId)?.artifactIds).not.toContain(f.design.id)
    expect(run.nodes.find((node) => node.id === f.node.id)?.artifactIds).toEqual([f.design.id, generated.artifact.id])
    expect(f).toEqual(before)
  })

  it.each(['stale-run', 'stale-design', 'stale-proposal', 'wrong-run', 'wrong-node', 'unsaved', 'empty', 'duplicate', 'approved'] as const)(
    'rejects %s before calling a model', async (failure) => {
      const f = await designRevisionFixture()
      if (failure === 'stale-run') f.run.version++
      if (failure === 'stale-design') f.design.content += 'changed'
      if (failure === 'stale-proposal') f.proposal.content += 'changed'
      if (failure === 'wrong-run') f.proposal.runId = 'another'
      if (failure === 'wrong-node') f.proposal.nodeId = f.run.currentNodeId
      if (failure === 'unsaved') f.artifacts = f.artifacts.filter((item) => item.id !== f.proposal.id)
      if (failure === 'empty') f.selection.proposals = []
      if (failure === 'duplicate') f.selection.proposals.push(f.selection.proposals[0]!)
      if (failure === 'approved') f.run.nodes.find((node) => node.id === f.run.currentNodeId)!.status = 'success'
      const provider = createFakeAgentProvider()
      const generate = vi.spyOn(provider, 'generateWorkflowArtifact')
      await expect(runWorkflowStageAgent({ ...f, provider, requestedBy: 'user-1', runtime: 'electron', designRevision: f.selection })).rejects.toThrow()
      expect(generate).not.toHaveBeenCalled()
    })

  it('rejects changed inputs after generation and never overwrites an existing artifact', async () => {
    const f = await designRevisionFixture()
    const generated = await runWorkflowStageAgent({ ...f, provider: createFakeAgentProvider(), requestedBy: 'user-1', runtime: 'electron', designRevision: f.selection })
    await expect(applyDesignRevision({ ...f, gateNodeId: f.run.currentNodeId, request: f.selection,
      artifact: { ...generated.artifact, id: f.design.id } })).rejects.toThrow()
    f.proposal.content += 'a newer opinion'
    await expect(applyDesignRevision({ ...f, gateNodeId: f.run.currentNodeId, request: f.selection, artifact: generated.artifact })).rejects.toThrow()
  })

  it('resolves the original design Agent without reopening or advancing it', async () => {
    const f = await designRevisionFixture()
    const resolved = await resolveDesignRevisionInput({ ...f, gateNodeId: f.run.currentNodeId, request: f.selection })
    expect(resolved.node).toEqual(f.node)
    expect(resolved.node.status).toBe('success')
    expect(resolved.previous).toEqual(f.design)
  })
})
