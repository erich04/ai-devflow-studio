// K0/K2 probe (docs/plans/knowledge-context-redesign-2026-09-29.zh-CN.md §6, §11):
// which instruction files reach the model when DevFlow runs the read-only
// OpenCode stage Agent. K0 recorded the pre-change behaviour in §11; this
// script now asserts the K2 behaviour of the shipped executor and exits 1 when
// the repository AGENTS.md is missing or any user-global sentinel leaks.
//
// Uses a local fake OpenAI-compatible server, a throwaway Git repository and a
// throwaway HOME seeded with sentinel "user global" instruction files. It never
// reads or modifies the real user profile and never calls a paid provider.
//
//   DEVFLOW_OPENCODE_BIN=/path/to/opencode corepack pnpm exec tsx scripts/knowledge-context-opencode-probe.mts
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DEFAULT_STAGE_AGENT_EXECUTION_BOUNDS, LOCAL_AGENT_KNOWLEDGE_REVIEW_BOUNDS, READ_ONLY_STAGE_AGENT_CAPABILITY } from '../packages/shared/src/index.ts'
import { buildOpencodeRuntimeEnv } from '../apps/desktop/electron/coding-engine.ts'
import { createReadOnlyLocalKnowledgeReviewProvider } from '../apps/desktop/electron/knowledge-review-local-agent.ts'
import { createOpencodeProcessManager } from '../apps/desktop/electron/opencode-process.ts'
import { createReadOnlyLocalStageAgentExecutor } from '../apps/desktop/electron/stage-agent-executor.ts'

const SENTINELS = {
  repoAgents: 'SENTINEL_REPO_AGENTS_MD',
  repoClaude: 'SENTINEL_REPO_CLAUDE_MD',
  globalOpencodeAgents: 'SENTINEL_GLOBAL_OPENCODE_AGENTS_MD',
  globalClaude: 'SENTINEL_GLOBAL_CLAUDE_MD',
  globalSkill: 'SENTINEL_GLOBAL_CLAUDE_SKILL',
  globalConfigInstruction: 'SENTINEL_GLOBAL_CONFIG_INSTRUCTIONS',
  globalAgentsSkill: 'SENTINEL_GLOBAL_AGENTS_SKILL',
} as const

const binaryPath = process.env.DEVFLOW_OPENCODE_BIN || 'opencode'
const providerId = 'devflow-probe'
const modelId = 'probe-model'
const root = await mkdtemp(path.join(tmpdir(), 'devflow-knowledge-probe-'))
const repo = path.join(root, 'repo')
const fakeHome = path.join(root, 'home')

async function seed(): Promise<void> {
  await mkdir(path.join(repo, 'docs', 'knowledge'), { recursive: true })
  await writeFile(path.join(repo, 'AGENTS.md'), `# Repo rules\n\n${SENTINELS.repoAgents}\n`)
  await writeFile(path.join(repo, 'CLAUDE.md'), `# Repo Claude rules\n\n${SENTINELS.repoClaude}\n`)
  await writeFile(path.join(repo, 'README.md'), '# Probe repository\n')
  await writeFile(path.join(repo, 'docs', 'knowledge', 'testing.md'), '---\ntitle: Testing\n---\n# Testing\n')
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo })
  execFileSync('git', ['add', '.'], { cwd: repo })
  execFileSync('git', ['-c', 'user.name=Probe', '-c', 'user.email=probe@example.invalid', 'commit', '-q', '-m', 'seed'], { cwd: repo })

  const opencodeConfig = path.join(fakeHome, '.config', 'opencode')
  await mkdir(opencodeConfig, { recursive: true })
  await writeFile(path.join(opencodeConfig, 'AGENTS.md'), `${SENTINELS.globalOpencodeAgents}\n`)
  await writeFile(path.join(opencodeConfig, 'global-extra.md'), `${SENTINELS.globalConfigInstruction}\n`)
  await writeFile(path.join(opencodeConfig, 'opencode.json'), JSON.stringify({
    $schema: 'https://opencode.ai/config.json',
    instructions: [path.join(opencodeConfig, 'global-extra.md')],
  }))
  const claudeHome = path.join(fakeHome, '.claude')
  await mkdir(path.join(claudeHome, 'skills', 'probe-skill'), { recursive: true })
  await writeFile(path.join(claudeHome, 'CLAUDE.md'), `${SENTINELS.globalClaude}\n`)
  await writeFile(path.join(claudeHome, 'skills', 'probe-skill', 'SKILL.md'),
    `---\nname: probe-skill\ndescription: ${SENTINELS.globalSkill}\n---\n# Probe skill\n`)
  const agentsSkills = path.join(fakeHome, '.agents', 'skills', 'agents-skill')
  await mkdir(agentsSkills, { recursive: true })
  await writeFile(path.join(agentsSkills, 'SKILL.md'),
    `---\nname: agents-skill\ndescription: ${SENTINELS.globalAgentsSkill}\n---\n# Agents skill\n`)
}

const finalOutput = JSON.stringify({
  title: 'Probe clarification',
  summary: 'Probe output.',
  goals: ['probe'],
  acceptanceCriteria: ['probe'],
  nonGoals: ['probe'],
  openQuestions: [],
  assumptions: [],
  risks: [],
  repositoryFindings: {
    version: 1,
    repositoryDigest: '',
    verifiedFacts: [{ id: 'fact-1', statement: 'README exists.', citationIds: ['citation-1'] }],
    citations: [{ id: 'citation-1', path: 'README.md', contentDigest: '', lineStart: 1, lineEnd: 1 }],
    assumptions: [],
    openQuestions: [],
    uncheckedScopes: [],
  },
})

// Gate Review through the read-only OpenCode session (knowledge-context K2).
const reviewOutput = JSON.stringify({
  conclusion: 'Probe review.',
  summary: 'Probe review output.',
  risks: [],
  missingEvidence: [],
  missingEvidenceDetails: [],
  suggestedTests: [],
  confidence: 0.5,
  repositoryFindings: {
    version: 1,
    repositoryDigest: '',
    verifiedFacts: [{ id: 'fact-1', statement: 'README exists.', citationIds: ['citation-1'] }],
    citations: [{ id: 'citation-1', path: 'README.md', contentDigest: '', lineStart: 1, lineEnd: 1 }],
    assumptions: [],
    openQuestions: [],
    uncheckedScopes: [],
  },
})

type Captured = { scenario: string; text: string }
const captured: Captured[] = []
let scenario = 'none'

const server = createServer((request, response) => {
  void (async () => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString('utf8')
    captured.push({ scenario, text: raw })
    const body = raw ? JSON.parse(raw) as { model?: string } : {}
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const id = `probe-${captured.length}`
    const content = scenario === 'review' ? reviewOutput : finalOutput
    response.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] })}\n\n`)
    response.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } })}\n\n`)
    response.end('data: [DONE]\n\n')
  })().catch(() => { response.writeHead(500); response.end() })
})

function presence(name: string): Record<keyof typeof SENTINELS, boolean> {
  const text = captured.filter((entry) => entry.scenario === name).map((entry) => entry.text).join('\n')
  return Object.fromEntries(Object.entries(SENTINELS).map(([key, value]) => [key, text.includes(value)])) as Record<keyof typeof SENTINELS, boolean>
}

async function runScenario(name: string, extraEnv: NodeJS.ProcessEnv, baseUrl: string): Promise<{ outcome: string }> {
  scenario = name
  const processManager = createOpencodeProcessManager()
  const binding = { providerId, modelId, baseUrl, apiKey: 'synthetic-no-billing', fingerprint: `probe-${name}` }
  // Same construction as apps/desktop/electron/main.ts for the read-only stage Agent.
  const runtimeEnv = buildOpencodeRuntimeEnv({
    baseEnv: { PATH: process.env.PATH, LANG: 'en_US.UTF-8', HOME: fakeHome, TMPDIR: process.env.TMPDIR, ...extraEnv },
    apiKeyEnvName: 'OPENCODE_API_KEY',
  })
  const executor = createReadOnlyLocalStageAgentExecutor({
    projectId: `probe-${name}`,
    projectPath: repo,
    binaryPath,
    providerId,
    modelId,
    detectedVersion: 'probe',
    processManager,
    runtimeEnv,
    providerBinding: binding,
  })
  try {
    await executor.execute({
      request: {} as never,
      context: {} as never,
      prompt: 'Return the clarification JSON.',
      capability: READ_ONLY_STAGE_AGENT_CAPABILITY,
      bounds: { ...DEFAULT_STAGE_AGENT_EXECUTION_BOUNDS, timeoutMs: 90_000 },
    })
    return { outcome: 'success' }
  } catch (error) {
    return { outcome: `failed: ${(error as Error).message}` }
  } finally {
    await processManager.stopAll()
  }
}

async function runReviewScenario(baseUrl: string): Promise<{ outcome: string; citations?: unknown }> {
  scenario = 'review'
  const processManager = createOpencodeProcessManager()
  const binding = { providerId, modelId, baseUrl, apiKey: 'synthetic-no-billing', fingerprint: 'probe-review' }
  const provider = createReadOnlyLocalKnowledgeReviewProvider({
    projectId: 'probe-review',
    projectPath: repo,
    binaryPath,
    metadata: { id: providerId, name: 'Probe', model: modelId },
    processManager,
    // Same construction as apps/desktop/electron/main.ts; the budget relay is replaced by the fake server.
    runtimeEnv: buildOpencodeRuntimeEnv({
      baseEnv: { PATH: process.env.PATH, LANG: 'en_US.UTF-8', HOME: fakeHome, TMPDIR: process.env.TMPDIR },
      apiKeyEnvName: 'OPENCODE_API_KEY',
    }),
    openBudgetRelay: async () => ({ binding, usageSince: () => undefined, close: async () => undefined }),
    knowledgeRoot: 'docs/knowledge',
    bounds: { ...LOCAL_AGENT_KNOWLEDGE_REVIEW_BOUNDS, timeoutMs: 90_000 },
  })
  try {
    const output = await provider.reviewKnowledge({ request: {} as never, context: {} as never, prompt: 'REVIEW_PROMPT_PROBE' })
    return { outcome: 'success', citations: output.repositoryFindings?.citations }
  } catch (error) {
    return { outcome: `failed: ${(error as Error).message} (${(error as { sanitizedCause?: string }).sanitizedCause ?? 'no cause'})` }
  } finally {
    await processManager.stopAll()
  }
}

try {
  await seed()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
  const results: Record<string, unknown> = {}
  // The environment DevFlow's main process passes (HOME inherited from the desktop process).
  const shipped = await runScenario('shipped', {}, baseUrl)
  const loaded = presence('shipped')
  results.shipped = { ...shipped, requests: captured.filter((entry) => entry.scenario === 'shipped').length, loaded }
  const leaked = Object.entries(loaded).filter(([key, value]) => key.startsWith('global') && value).map(([key]) => key)
  if (shipped.outcome !== 'success' || !loaded.repoAgents || leaked.length) {
    console.error(`probe failed: outcome=${shipped.outcome}; repoAgents=${loaded.repoAgents}; leaked=${leaked.join(',') || 'none'}`)
    process.exitCode = 1
  }
  const review = await runReviewScenario(baseUrl)
  const reviewLoaded = presence('review')
  const reviewRequests = captured.filter((entry) => entry.scenario === 'review')
  const reviewPromptSent = reviewRequests.some((entry) => entry.text.includes('REVIEW_PROMPT_PROBE') &&
    entry.text.includes('Use only the read, glob, grep and list tools'))
  results.review = { ...review, requests: reviewRequests.length, loaded: reviewLoaded, reviewPromptSent }
  const reviewLeaked = Object.entries(reviewLoaded).filter(([key, value]) => key.startsWith('global') && value).map(([key]) => key)
  const citationDigested = Array.isArray(review.citations) &&
    review.citations.some((citation) => /^[a-f0-9]{64}$/u.test((citation as { contentDigest?: string }).contentDigest ?? ''))
  if (review.outcome !== 'success' || !reviewLoaded.repoAgents || reviewLeaked.length || !reviewPromptSent || !citationDigested) {
    console.error(`review probe failed: outcome=${review.outcome}; repoAgents=${reviewLoaded.repoAgents}; leaked=${reviewLeaked.join(',') || 'none'}; prompt=${reviewPromptSent}; digested=${citationDigested}`)
    process.exitCode = 1
  }
  const absoluteRepoPathSent = captured.some((entry) => entry.text.includes(repo))
  console.log(JSON.stringify({
    opencodeBinary: binaryPath,
    opencodeVersion: execFileSync(binaryPath, ['--version'], { encoding: 'utf8' }).trim(),
    paidProviderCalls: 0,
    results,
    absoluteRepoPathSentToProvider: absoluteRepoPathSent,
  }, null, 2))
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  if (!process.env.DEVFLOW_KEEP_PROBE) await rm(root, { recursive: true, force: true })
}
