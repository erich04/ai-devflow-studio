import {
  createOpenAiCompatibleAgentProvider,
  runKnowledgeReviewAgent,
  type AgentReviewContext,
} from '@ai-devflow/shared'

const apiKey = process.env.DEVFLOW_AGENT_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY
const baseUrl =
  process.env.DEVFLOW_AGENT_OPENAI_BASE_URL ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'
const model = process.env.DEVFLOW_AGENT_OPENAI_MODEL ?? process.env.OPENAI_MODEL ?? 'gpt-4.1-mini'

if (!apiKey) {
  console.log(
    'Skipping live Agent provider smoke: set DEVFLOW_AGENT_OPENAI_API_KEY or OPENAI_API_KEY to run it.',
  )
  process.exit(0)
}

const provider = createOpenAiCompatibleAgentProvider({
  id: 'openai-live-smoke',
  name: 'OpenAI-compatible Live Smoke',
  model,
  baseUrl,
  apiKey,
})

const context: AgentReviewContext = {
  run: {
    id: 'run-agent-live-smoke',
    title: 'Live provider smoke run',
    request: 'Review a redacted knowledge-gated change before human approval.',
    projectId: 'p-payments',
    status: 'paused_at_gate',
    branchName: 'ai/live-agent-smoke',
  },
  node: {
    id: 'n-design-gate',
    stage: 'design',
    title: 'Architecture Gate',
    subtitle: 'Lead checks evidence before implementation.',
    kind: 'gate',
    status: 'blocked',
  },
  artifacts: [
    {
      id: 'art-design',
      kind: 'design',
      title: 'Design summary',
      summary: 'Health endpoint design includes status mapping and test strategy.',
      content: 'Only redacted design summary is sent to the provider.',
      redacted: true,
    },
  ],
  testEvidence: [
    {
      id: 'evidence-redacted',
      command: 'pnpm test',
      status: 'passed',
      exitCode: 0,
      durationMs: 100,
      summary: 'Redacted test evidence passed.',
      redacted: true,
    },
  ],
  knowledgeReferences: [],
  knowledgeChunks: [],
}

async function main() {
  const result = await runKnowledgeReviewAgent({
    request: {
      id: `agent-live-smoke-${Date.now()}`,
      runId: context.run.id,
      nodeId: context.node.id,
      projectId: context.run.projectId,
      requestedBy: 'u-erich',
      runtime: 'api',
      providerId: provider.id,
    },
    context,
    provider,
  })

  if (!result.review.conclusion || !result.review.summary) {
    throw new Error('Live Agent provider smoke did not return a structured review.')
  }

  if (result.tokenUsage.inputTokens <= 0 || result.tokenUsage.outputTokens <= 0) {
    throw new Error('Live Agent provider smoke did not map token usage.')
  }

  console.log(
    `Live Agent provider smoke passed with ${result.review.model}; usage source: ${result.tokenUsage.source}.`,
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
