import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vitest'
import { createOpenAiCompatibleAgentProvider, type AgentProvider } from '@ai-devflow/shared'
import { createNativeRepositoryReviewProvider } from './knowledge-review-native'
const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))) })
it('reviews real files with host-computed citations without an OpenCode binary', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'native-review-')); dirs.push(root)
  execFileSync('git', ['init', '-q', root])
  execFileSync('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-q', '--allow-empty', '-m', 'fixture'])
  await writeFile(path.join(root, 'app.ts'), 'export const searchEnabled = true\n')
  let round = 0
  const complete = vi.fn(async (input: { userPrompt: string }) => {
    round++
    const value = round === 1 ? { tool: { name: 'repo_read', args: { path: 'app.ts' } } } : {
      conclusion: 'pass', summary: 'Search exists.', risks: [], missingEvidence: [], suggestedTests: [], confidence: 1,
      repositoryFindings: { version: 1, repositoryDigest: '', citations: [{ id: 'c1', path: 'app.ts', contentDigest: '', lineStart: 1, lineEnd: 1 }],
        verifiedFacts: [{ id: 'f1', statement: 'searchEnabled is true', citationIds: ['c1'] }], assumptions: [], openQuestions: [], uncheckedScopes: [] },
    }
    if (round === 2) expect(input.userPrompt).toContain('searchEnabled = true')
    return { value, usage: { inputTokens: 10, outputTokens: 5, budgetAttemptIds: [`call-${round}`] } }
  })
  const direct: AgentProvider = { id: 'fixture', name: 'fixture', model: 'fixture', completeStructuredJson: complete, reviewKnowledge: vi.fn() }
  const provider = createNativeRepositoryReviewProvider({ projectPath: root, provider: direct })
  const result = await provider.reviewKnowledge({ prompt: 'Verify search.', request: {} as never, context: {} as never })
  expect(provider.executorKind).toBe('native-agent')
  expect(result.repositoryFindings?.citations[0]?.contentDigest).toMatch(/^[a-f0-9]{64}$/)
  expect(result.usage).toMatchObject({ inputTokens: 20, outputTokens: 10, budgetAttemptIds: ['call-1', 'call-2'] })
  expect(complete).toHaveBeenCalledTimes(2)
})
it('rejects citations for unread files and never accepts them based on model claims', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'native-review-')); dirs.push(root)
  execFileSync('git', ['init', '-q', root])
  execFileSync('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-q', '--allow-empty', '-m', 'fixture']); await writeFile(path.join(root, 'app.ts'), 'true\n')
  const complete = vi.fn(async () => ({ value: { conclusion: 'pass', summary: 'ok', risks: [], missingEvidence: [], suggestedTests: [], confidence: 1,
    repositoryFindings: { version: 1, citations: [{ id: 'c1', path: 'app.ts', lineStart: 1, lineEnd: 1 }], verifiedFacts: [], assumptions: [], openQuestions: [], uncheckedScopes: [] } } }))
  const provider = createNativeRepositoryReviewProvider({ projectPath: root, provider: { id: 'fixture', name: 'fixture', model: 'fixture', completeStructuredJson: complete, reviewKnowledge: vi.fn() } })
  await expect(provider.reviewKnowledge({ prompt: 'Verify.', request: {} as never, context: {} as never })).rejects.toMatchObject({ sanitizedCause: 'native_review_invalid_findings' })
})

it('rejects concatenated tool objects, then carries one completed read into the next turn', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'native-review-')); dirs.push(root)
  execFileSync('git', ['init', '-q', root])
  execFileSync('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-q', '--allow-empty', '-m', 'fixture'])
  await writeFile(path.join(root, 'app.ts'), 'export const enabled = true\n')
  const requests: Array<{ messages: Array<{ role: string; content: string }> }> = []
  const singleRead = { tool: { name: 'repo_read', args: { path: 'app.ts' } } }
  const finalReview = {
    conclusion: 'pass', summary: 'Enabled is true.', risks: [], missingEvidence: [], suggestedTests: [], confidence: 1,
    repositoryFindings: { version: 1, repositoryDigest: '', citations: [{ id: 'c1', path: 'app.ts', contentDigest: '', lineStart: 1, lineEnd: 1 }],
      verifiedFacts: [{ id: 'f1', statement: 'enabled is true', citationIds: ['c1'] }], assumptions: [], openQuestions: [], uncheckedScopes: [] },
  }
  const direct = createOpenAiCompatibleAgentProvider({ id: 'fixture', name: 'fixture', model: 'fixture',
    baseUrl: 'https://fixture.example/v1', apiKey: 'fixture-key', fetcher: async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)))
      const turn = requests.length
      // Reproduce the real failure shape: each object is valid, but two objects are not one response.
      const content = turn === 1 ? JSON.stringify(singleRead) + JSON.stringify(singleRead)
        : JSON.stringify(turn === 2 ? singleRead : finalReview)
      return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5 } }), { headers: { 'content-type': 'application/json' } })
    },
  })
  const result = await createNativeRepositoryReviewProvider({ projectPath: root, provider: direct })
    .reviewKnowledge({ prompt: 'Verify enabled.', request: {} as never, context: {} as never })
  expect(requests).toHaveLength(3)
  const turns = requests.map(request => JSON.parse(request.messages.find(message => message.role === 'user')!.content))
  // Neither concatenated object was executed. The retry is corrected before any observation exists.
  expect(turns[0].observations).toEqual([])
  expect(turns[1].observations).toEqual([])
  expect(turns[1].correction).toContain('Do not concatenate objects, batch tools')
  expect(turns[2].observations).toHaveLength(1)
  expect(turns[2].observations[0]).toMatchObject({ tool: 'repo_read', result: { path: 'app.ts', content: 'export const enabled = true\n' } })
  expect(turns[2].correction).toBeUndefined()
  expect(requests.every(request => request.messages[0]!.content.includes('stop and wait for its host observation'))).toBe(true)
  expect(result.repositoryFindings?.citations[0]?.contentDigest).toMatch(/^[a-f0-9]{64}$/)
  expect(result.usage).toMatchObject({ inputTokens: 30, outputTokens: 15 })
})
