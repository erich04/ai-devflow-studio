import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, expect, it } from 'vitest'
import { buildAgentReviewContext, createFakeAgentProvider, runKnowledgeReviewAgent } from '@ai-devflow/shared'
import { artifacts, runs } from '@ai-devflow/shared/fixtures'
import { createLocalStore, type LocalStore } from './local-store'
import { parseAgentReviewFeedbackInput } from './agent-review-feedback'

const directories: string[] = []
const stores: LocalStore[] = []
afterEach(async () => {
  for (const store of stores.splice(0)) store.close()
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

it('persists a human false-positive report without changing the original finding or advancing a Gate', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'devflow-review-feedback-')); directories.push(directory)
  const dbPath = path.join(directory, 'state.sqlite')
  const store = await createLocalStore({ dbPath }); stores.push(store)
  const run = runs[0]!
  const node = run.nodes.find((item) => item.id === 'n-design-gate')!
  await store.saveRun(run)
  const context = await buildAgentReviewContext({ run, node, artifacts, testEvidence: [], knowledgeDocuments: [], knowledgeChunks: [] })
  const { review } = await runKnowledgeReviewAgent({ context, provider: createFakeAgentProvider(),
    request: { id: 'qa-review', runId: run.id, projectId: run.projectId, nodeId: node.id, requestedBy: run.creatorId, runtime: 'electron' },
  })
  review.missingEvidence = ['是否撤销还没有决定']
  await store.saveAgentReview(review)
  const input = { runId: run.id, projectId: run.projectId, reviewId: review.id, missingEvidenceIndex: 0,
    reason: '非目标已经明确不提供撤销，请复核。' }
  const updated = await store.recordAgentReviewFeedback(input)
  expect(updated.feedback).toEqual([expect.objectContaining({ kind: 'false_positive', actorId: run.creatorId,
    missingEvidenceIndex: 0, reason: input.reason })])
  expect(updated.missingEvidence).toEqual(review.missingEvidence)
  expect(updated.gateAdvisory).toEqual(review.gateAdvisory)
  expect(updated.policyFindings).toEqual(review.policyFindings)
  expect(await store.getRun(run.id)).toEqual(run)
  await store.recordAgentReviewFeedback(input)
  expect((await store.listAgentReviews(run.id))[0]?.feedback).toHaveLength(1)
  expect(() => parseAgentReviewFeedbackInput({ ...input, actorId: 'forged-owner' })).toThrow('参数无效')
  const secret = 'sk-abcdefghijklmnopqrstuvwxyz123456'
  const redacted = await store.recordAgentReviewFeedback({ ...input, reason: `引用这里的说明 ${secret}` })
  expect(JSON.stringify(redacted.feedback)).not.toContain(secret)
  const reopened = await createLocalStore({ dbPath }); stores.push(reopened)
  expect((await reopened.listAgentReviews(run.id))[0]?.feedback).toEqual(redacted.feedback)
  expect((await reopened.listEvents(run.id)).at(-1)?.kind).toBe('agent_review')
  await expect(reopened.recordAgentReviewFeedback({ ...input, projectId: 'other-project' })).rejects.toThrow('不匹配')
  await expect(reopened.recordAgentReviewFeedback({ ...input, missingEvidenceIndex: 99 })).rejects.toThrow('不存在')
})
