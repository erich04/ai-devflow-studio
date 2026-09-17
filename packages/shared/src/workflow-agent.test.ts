import { describe, expect, it, vi } from 'vitest'
import type { AgentProvider } from './agent-review'
import { createFakeAgentProvider, createOpenAiCompatibleAgentProvider } from './agent-review'
import { completeWorkflowAgentNode, createWorkflowRunFromRequest } from './workflow'
import {
  runWorkflowStageAgent,
  StageAgentExecutionError,
  type StageAgentExecutor,
} from './workflow-agent'

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
  it.each(['clarify', 'design'] as const)('passes saved conversation decisions to the %s model prompt', async (stage) => {
    const node = stage === 'clarify' ? clarifyNode() : designNode()
    const proposal = {
      id: 'conversation-proposal-confirmed-interaction', runId: created.run.id, nodeId: node.id,
      kind: 'log' as const, title: 'Discussion proposal', summary: 'User-saved proposal; pending review.',
      content: 'Confirmed: clear only completed tasks immediately; no confirmation dialog and no undo. Preserve remaining IDs and order.',
      redacted: true, updatedAt: '2026-09-17T06:00:00.000Z',
    }
    let messages = ''
    const provider = createOpenAiCompatibleAgentProvider({
      id: 'deepseek-test', model: 'deepseek-flash', apiKey: 'test-key', baseUrl: 'https://api.deepseek.com',
      fetcher: async (_, init) => {
        messages = JSON.stringify(JSON.parse(String(init?.body)).messages)
        return Response.json({ choices: [{ message: { content: JSON.stringify({
          title: 'Stage output', summary: 'Saved decisions considered.', content: 'Implement the clarified requirement.',
          goals: ['Clear completed tasks'], acceptanceCriteria: ['Preserve remaining tasks'],
          nonGoals: ['Undo'], openQuestions: [], assumptions: [], risks: [],
        }) } }] })
      },
    })
    const result = await runWorkflowStageAgent({
      run: created.run, node, artifacts: [...created.artifacts, proposal],
      provider, requestedBy: 'u-ling', runtime: 'electron',
    })
    expect(result.prompt).toContain(proposal.content)
    expect(messages).toContain(proposal.content)
    expect(result.artifact.clarificationRevision?.repositoryFindings).toBeUndefined()
  })

  it('limits saved proposal input to this Run and node, redacts it, and preserves its pending authority', async () => {
    const proposal = {
      id: 'conversation-proposal-current', runId: created.run.id, nodeId: clarifyNode().id,
      kind: 'log' as const, title: 'Current proposal', summary: 'Pending review.',
      content: 'Keep task order. API_KEY=sk-supersecret123456789 in /Users/alice/private/repo',
      redacted: false, updatedAt: '2026-09-17T06:00:00.000Z',
    }
    const result = await runWorkflowStageAgent({
      run: created.run, node: clarifyNode(), provider: createFakeAgentProvider(),
      artifacts: [...created.artifacts, proposal,
        { ...proposal, id: 'conversation-proposal-other-run', runId: 'other-run', content: 'OTHER_RUN_PRIVATE_INPUT' },
        { ...proposal, id: 'conversation-proposal-other-node', nodeId: designNode().id, content: 'OTHER_NODE_PROPOSAL' },
        { ...proposal, id: 'ordinary-log', content: 'ORDINARY_LOG_BODY' },
      ], requestedBy: 'u-ling', runtime: 'electron',
    })
    expect(result.prompt).toContain('Keep task order.')
    expect(result.prompt).toContain('not Gate approval or verified repository evidence')
    for (const excluded of ['OTHER_RUN_PRIVATE_INPUT', 'OTHER_NODE_PROPOSAL', 'ORDINARY_LOG_BODY', 'sk-supersecret123456789', '/Users/alice/private/repo']) {
      expect(result.prompt).not.toContain(excluded)
    }
  })

  it('rejects oversized saved proposals before calling the provider instead of truncating decisions', async () => {
    const provider = createFakeAgentProvider()
    const generate = vi.spyOn(provider, 'generateWorkflowArtifact')
    await expect(runWorkflowStageAgent({
      run: created.run, node: clarifyNode(), provider, requestedBy: 'u-ling', runtime: 'electron',
      artifacts: [...created.artifacts, {
        id: 'conversation-proposal-oversized', runId: created.run.id, nodeId: clarifyNode().id,
        kind: 'log', title: 'Large proposal', summary: 'Pending', content: 'decision '.repeat(16_000),
        redacted: true, updatedAt: '2026-09-17T06:00:00.000Z',
      }],
    })).rejects.toMatchObject({ terminalReason: 'input_limit' })
    expect(generate).not.toHaveBeenCalled()
  })

  it('timestamps the artifact and terminal provenance after the provider has completed', async () => {
    let now = '2026-09-10T10:00:00.000Z'
    const provider = createFakeAgentProvider()
    const generate = provider.generateWorkflowArtifact!
    provider.generateWorkflowArtifact = async (input) => {
      now = '2026-09-10T10:00:10.000Z'
      return generate(input)
    }
    const result = await runWorkflowStageAgent({
      run: created.run, node: clarifyNode(), artifacts: created.artifacts, provider,
      requestedBy: 'u-ling', runtime: 'electron', now: () => now,
    })
    expect(result.provenance.startedAt).toBe('2026-09-10T10:00:00.000Z')
    expect(result.provenance.completedAt).toBe('2026-09-10T10:00:10.000Z')
    expect(result.artifact.updatedAt).toBe(result.provenance.completedAt)
    expect(result.trace.createdAt).toBe(result.provenance.completedAt)
  })

  it('retains reported usage and a bounded field diagnostic when the design is rejected', async () => {
    const provider = createFakeAgentProvider()
    const generate = provider.generateWorkflowArtifact!
    provider.generateWorkflowArtifact = async (input) => ({
      ...await generate(input), content: '',
      usage: { inputTokens: 1942, outputTokens: 1953, cacheReadTokens: 0 },
    })
    const error = await runWorkflowStageAgent({
      run: created.run, node: designNode(), artifacts: created.artifacts, provider,
      requestedBy: 'u-ling', runtime: 'electron',
    }).catch((failure: unknown) => failure)
    expect(error).toBeInstanceOf(StageAgentExecutionError)
    expect(error).toMatchObject({
      terminalReason: 'schema_invalid', message: 'design.content is outside the allowed length',
      tokenUsage: { inputTokens: 1942, outputTokens: 1953, source: 'provider_reported' },
    })
  })

  it.each([
    undefined, {}, { inputTokens: 10 }, { inputTokens: -1, outputTokens: 2 },
    { inputTokens: 10, outputTokens: NaN }, { inputTokens: 10, outputTokens: 2, cacheReadTokens: 11 },
  ])('does not invent reported usage when a rejected response has incomplete or invalid usage: %j', async (usage) => {
    const provider = createFakeAgentProvider()
    const generate = provider.generateWorkflowArtifact!
    provider.generateWorkflowArtifact = async (input) => {
      const output = { ...await generate(input), content: '' }
      delete output.usage
      return { ...output, ...(usage ? { usage } : {}) }
    }
    const error = await runWorkflowStageAgent({
      run: created.run, node: designNode(), artifacts: created.artifacts, provider,
      requestedBy: 'u-ling', runtime: 'electron',
    }).catch((failure: unknown) => failure)
    expect(error).toBeInstanceOf(StageAgentExecutionError)
    expect(error).not.toHaveProperty('tokenUsage', expect.anything())
  })

  it('redacts failure diagnostics before bounding their length', () => {
    const error = new StageAgentExecutionError('schema_invalid',
      `design.content /Users/example/private/output.txt OPENAI_API_KEY=sk-1234567890abcdefghijklmnop ${'x'.repeat(1000)}`)
    expect(error.message).not.toContain('/Users/example')
    expect(error.message).not.toContain('sk-1234567890')
    expect(error.message.length).toBeLessThanOrEqual(512)
  })

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
    expect(result.artifact.clarificationRevision).toMatchObject({
      revision: 1,
      status: 'review_requested',
      rawRequestArtifactId: 'artifact-run-live-stage-agent-raw-request',
      executor: { kind: 'direct-provider', terminalReason: 'success' },
    })
    expect(result.trace.executorProvenance).toMatchObject({ kind: 'direct-provider' })
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
        content: '# Implementation plan\n\nUpdate the local-project empty-state label in Desktop.\n\n## Verification\n\nCheck empty and selected project states.\n\n## Delivery\n\nAttach the diff and test evidence to the Draft PR.',
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
    expect(result.artifact.content).toContain('# Implementation plan')
    expect(result.artifact.content).toContain('Check empty and selected project states.')
    expect(result.artifact.content).not.toContain('## Goals')
    expect(result.prompt).toContain('required non-empty content string')
  })

  it.each([undefined, '', '   '])('rejects design without implementation content: %s', async (content) => {
    const provider = createFakeAgentProvider()
    const generate = provider.generateWorkflowArtifact!
    provider.generateWorkflowArtifact = async (input) => {
      const output = await generate(input)
      delete output.content
      if (content !== undefined) output.content = content
      return output
    }

    await expect(runWorkflowStageAgent({
      run: created.run,
      node: designNode(),
      artifacts: created.artifacts,
      provider,
      requestedBy: 'u-ling',
      runtime: 'electron',
    })).rejects.toMatchObject({ terminalReason: 'schema_invalid' })
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

  it('uses the same contract for a read-only local Agent and records verified repository evidence', async () => {
    const digest = 'a'.repeat(64)
    const executor: StageAgentExecutor = {
      kind: 'local-agent',
      id: 'fake-read-only-cli',
      version: '1.2.3',
      providerId: 'local-provider',
      model: 'local-model',
      execute: vi.fn().mockResolvedValue({
        terminalReason: 'success',
        toolCalls: 4,
        durationMs: 12,
        value: {
          model: 'local-model',
          title: 'Repository-grounded clarification',
          summary: 'Verified the project entrypoint.',
          goals: ['Keep the workflow authoritative.'],
          acceptanceCriteria: ['Citations are repo-relative and digest bound.'],
          nonGoals: ['Do not change repository files.'],
          openQuestions: [],
          assumptions: [],
          risks: [],
          repositoryFindings: {
            version: 1,
            repositoryDigest: digest,
            verifiedFacts: [{ id: 'fact-1', statement: 'The app has an entrypoint.', citationIds: ['citation-1'] }],
            citations: [{ id: 'citation-1', path: 'src/index.ts', contentDigest: digest, lineStart: 1 }],
            assumptions: [],
            openQuestions: [],
            uncheckedScopes: ['generated output'],
          },
        },
      }),
    }

    const result = await runWorkflowStageAgent({
      run: created.run,
      node: clarifyNode(),
      artifacts: [...created.artifacts, {
        id: 'conversation-proposal-local', runId: created.run.id, nodeId: clarifyNode().id,
        kind: 'log', title: 'Saved decision', summary: 'Pending review',
        content: 'Do not add a confirmation dialog.', redacted: true, updatedAt: '2026-06-28T14:00:00.000Z',
      }],
      executor,
      requestedBy: 'u-ling',
      runtime: 'electron',
      now: () => '2026-06-28T14:05:00.000Z',
    })

    expect(result.source).toBe('local_agent')
    expect(result.artifact.redacted).toBe(true)
    expect(result.artifact.content).toContain('src/index.ts#')
    expect(result.artifact.clarificationRevision?.repositoryFindings?.verifiedFacts).toHaveLength(1)
    expect(result.tokenUsage).toMatchObject({ source: 'unknown', usageStatus: 'unknown', costUsd: null })
    expect(result.trace.steps.map((step) => step.summary).join('\n')).not.toContain('/Users/')
    const prompt = vi.mocked(executor.execute).mock.calls[0]![0].prompt
    expect(prompt).toContain('Do not add a confirmation dialog.')
    expect(prompt).toContain('arrays of OBJECTS, not strings')
    expect(prompt).toContain('"citationIds":["citation-1"]')
    expect(prompt).toContain('"path":"<repo-relative-file>"')
    expect(prompt.match(/Return only valid JSON with [^.]+\./)?.[0]).toContain('repositoryFindings')
    expect(prompt).not.toContain('All list fields must be arrays of strings')
  })

  it('retains executor-reported consumption when output validation fails before an Artifact is returned', async () => {
    const executor: StageAgentExecutor = {
      kind: 'local-agent', id: 'opencode', version: '1', providerId: 'deepseek', model: 'deepseek-v4-flash',
      execute: async () => { throw new StageAgentExecutionError('evidence_invalid', 'Citation rejected', undefined,
        { inputTokens: 15268, outputTokens: 1444, cacheReadTokens: 12416 }) },
    }
    const error = await runWorkflowStageAgent({
      run: created.run, node: clarifyNode(), artifacts: created.artifacts, executor,
      requestedBy: 'u-ling', runtime: 'electron',
    }).catch((failure: unknown) => failure)
    expect(error).toMatchObject({ terminalReason: 'evidence_invalid', tokenUsage: {
      inputTokens: 15268, outputTokens: 1444, cacheReadTokens: 12416, source: 'provider_reported',
      executorKind: 'local-agent', providerId: 'deepseek', costUsd: null, costStatus: 'unknown',
    } })
  })

  it('fails closed when a local Agent omits repository citations', async () => {
    const executor: StageAgentExecutor = {
      kind: 'local-agent',
      id: 'fake-read-only-cli',
      version: '1',
      model: 'local-model',
      execute: vi.fn().mockResolvedValue({
        terminalReason: 'success',
        toolCalls: 1,
        value: {
          model: 'local-model',
          title: 'Unverified clarification',
          summary: 'No citations.',
          goals: ['Goal'],
          acceptanceCriteria: ['Acceptance'],
          nonGoals: ['Non-goal'],
          openQuestions: [],
          assumptions: [],
          risks: [],
        },
      }),
    }

    await expect(runWorkflowStageAgent({
      run: created.run,
      node: clarifyNode(),
      artifacts: created.artifacts,
      executor,
      requestedBy: 'u-ling',
      runtime: 'electron',
    })).rejects.toThrow('returned no repository citations')
  })

  it('redacts secrets and absolute paths before either executor receives context', async () => {
    const generateWorkflowArtifact = vi.fn().mockResolvedValue({
      model: 'safe-model', title: 'Safe', summary: 'Safe summary', goals: ['Goal'],
      acceptanceCriteria: ['Acceptance'], nonGoals: ['Non-goal'], openQuestions: [], assumptions: [], risks: [],
    })
    const provider: AgentProvider = {
      id: 'safe-provider', name: 'Safe', model: 'safe-model', reviewKnowledge: vi.fn(), generateWorkflowArtifact,
    }
    await runWorkflowStageAgent({
      run: { ...created.run, request: 'Use API_KEY=sk-supersecret123456789 in /Users/alice/private/repo' },
      node: clarifyNode(), artifacts: created.artifacts, provider, requestedBy: 'u-ling', runtime: 'electron',
    })
    const call = generateWorkflowArtifact.mock.calls[0]![0]
    expect(JSON.stringify(call)).not.toContain('sk-supersecret123456789')
    expect(JSON.stringify(call)).not.toContain('/Users/alice/private/repo')
    expect(JSON.stringify(call)).toContain('[REDACTED:')
  })
})
