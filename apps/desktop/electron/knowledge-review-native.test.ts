import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vitest'
import type { AgentProvider } from '@ai-devflow/shared'
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
