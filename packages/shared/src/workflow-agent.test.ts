import { describe, expect, it, vi } from 'vitest'
import type { AgentProvider } from './agent-review'
import { createFakeAgentProvider } from './agent-review'
import { completeWorkflowAgentNode, createWorkflowRunFromRequest } from './workflow'
import { runWorkflowStageAgent } from './workflow-agent'

const created = createWorkflowRunFromRequest({
  runId: 'run-live-stage-agent',
  title: 'Improve local project selection empty state',
  request: 'Clarify the local-project empty state and make the Desktop card copy less misleading.',
  projectId: 'p-desktop',
  creatorId: 'u-ling',
  branchName: 'ai/local-project-empty-state',
  now: '2026-06-28T14:00:00.000Z',
})

function clarifyNode() {
  return created.run.nodes.find((node) => node.id === 'run-live-stage-agent-clarify')!
}

function designNode() {
  return created.run.nodes.find((node) => node.id === 'run-live-stage-agent-design')!
}

describe('runWorkflowStageAgent', () => {
  it('generates a model-backed clarification artifact with provenance', async () => {
    const provider: AgentProvider = {
      id: 'doubao-review',
      name: 'Volcengine Ark',
      model: 'ark-code-latest',
      reviewKnowledge: vi.fn(),
      generateWorkflowArtifact: vi.fn().mockResolvedValue({
        model: 'ark-code-latest',
        title: '需求澄清结果',
        summary: 'Clarified empty-state copy and success criteria.',
        goals: ['Show that no local project is selected.'],
        acceptanceCriteria: ['The card copy no longer implies a selected repository.'],
        nonGoals: ['Do not change SQLite or sync behavior.'],
        openQuestions: ['Should remote-only Runs show a separate project warning?'],
        assumptions: ['The user is in local-only mode.'],
        risks: ['Users may confuse team project and local project.'],
        usage: { inputTokens: 40, outputTokens: 20, cacheReadTokens: 0 },
      }),
    }

    const result = await runWorkflowStageAgent({
      run: created.run,
      node: clarifyNode(),
      artifacts: created.artifacts,
      provider,
      requestedBy: 'u-ling',
      runtime: 'electron',
      now: () => '2026-06-28T14:05:00.000Z',
    })

    expect(result.source).toBe('model')
    expect(result.providerId).toBe('doubao-review')
    expect(result.model).toBe('ark-code-latest')
    expect(result.artifact).toMatchObject({
      id: 'artifact-run-live-stage-agent-clarification',
      kind: 'clarification',
      title: '需求澄清结果',
      summary: 'Clarified empty-state copy and success criteria.',
      redacted: false,
    })
    expect(result.artifact.content).toContain('Source: model generated · Provider: doubao-review · Model: ark-code-latest')
    expect(result.artifact.content).toContain('Show that no local project is selected.')
    expect(provider.generateWorkflowArtifact).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({ stage: 'clarify', providerId: 'doubao-review' }),
      prompt: expect.stringContaining('Generate a requirements clarification artifact.'),
    }))
  })

  it('generates a design artifact from the clarification context and links it through workflow completion', async () => {
    const clarification = await runWorkflowStageAgent({
      run: created.run,
      node: clarifyNode(),
      artifacts: created.artifacts,
      provider: createFakeAgentProvider(),
      requestedBy: 'u-ling',
      runtime: 'electron',
      now: () => '2026-06-28T14:05:00.000Z',
    })
    const completedClarify = completeWorkflowAgentNode({
      run: created.run,
      nodeId: clarifyNode().id,
      artifacts: created.artifacts,
      generatedArtifact: clarification.artifact,
      existingEvents: created.events,
      actorName: 'Ling',
      now: '2026-06-28T14:05:00.000Z',
    })
    const runAtDesign = {
      ...completedClarify.run,
      currentNodeId: designNode().id,
      status: 'designing' as const,
      nodes: completedClarify.run.nodes.map((node) =>
        node.id === designNode().id ? { ...node, status: 'running' as const } : node,
      ),
    }
    const provider: AgentProvider = {
      id: 'doubao-review',
      name: 'Volcengine Ark',
      model: 'ark-code-latest',
      reviewKnowledge: vi.fn(),
      generateWorkflowArtifact: vi.fn().mockResolvedValue({
        model: 'ark-code-latest',
        title: '方案设计',
        summary: 'Design uses the clarification artifact.',
        goals: ['Update the Desktop workbench copy.'],
        acceptanceCriteria: ['Unit tests cover the selected local project text.'],
        nonGoals: ['Do not modify policy evaluator.'],
        openQuestions: [],
        assumptions: ['Clarification artifact is approved.'],
        risks: [],
      }),
    }

    const result = await runWorkflowStageAgent({
      run: runAtDesign,
      node: designNode(),
      artifacts: completedClarify.artifacts,
      provider,
      requestedBy: 'u-ling',
      runtime: 'electron',
      now: () => '2026-06-28T14:15:00.000Z',
    })

    expect(result.artifact).toMatchObject({
      id: 'artifact-run-live-stage-agent-design',
      kind: 'design',
      redacted: true,
    })
    expect(provider.generateWorkflowArtifact).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({
        artifacts: expect.arrayContaining([
          expect.objectContaining({ kind: 'clarification', id: 'artifact-run-live-stage-agent-clarification' }),
        ]),
      }),
      prompt: expect.stringContaining('Generate a design artifact based on the clarified request.'),
    }))
    expect(result.artifact.content).toContain('Design uses the clarification artifact.')
  })

  it('does not create an artifact when the provider fails', async () => {
    const provider: AgentProvider = {
      id: 'doubao-review',
      name: 'Volcengine Ark',
      model: 'ark-code-latest',
      reviewKnowledge: vi.fn(),
      generateWorkflowArtifact: vi.fn().mockRejectedValue(new Error('provider unavailable')),
    }

    await expect(runWorkflowStageAgent({
      run: created.run,
      node: clarifyNode(),
      artifacts: created.artifacts,
      provider,
      requestedBy: 'u-ling',
      runtime: 'electron',
      now: () => '2026-06-28T14:05:00.000Z',
    })).rejects.toThrow('provider unavailable')
  })

  it('marks fake fallback output as fake/template provenance', async () => {
    const result = await runWorkflowStageAgent({
      run: created.run,
      node: clarifyNode(),
      artifacts: created.artifacts,
      provider: createFakeAgentProvider(),
      requestedBy: 'u-ling',
      runtime: 'electron',
      now: () => '2026-06-28T14:05:00.000Z',
    })

    expect(result.source).toBe('fake_template')
    expect(result.artifact.content).toContain('Source: fake/template · Provider: fake-knowledge-review · Model: fake')
  })
})
