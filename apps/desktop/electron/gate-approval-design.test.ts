import { describe, expect, it } from 'vitest'
import {
  buildDesignRevisionIdentity,
  createDesignRevisionDigest,
  resolveDesignGateMaterial,
  type AgentEvent,
  type Artifact,
} from '@ai-devflow/shared'
import { artifacts as fixtureArtifacts, runs as fixtureRuns } from '@ai-devflow/shared/fixtures'
import {
  designApprovalEvent,
  isDesignReviewGate,
  requireCurrentDesignRevision,
  staleDesignRevisionMessage,
} from './gate-approval-design'

async function designGate() {
  const run = fixtureRuns[0]!
  const gateNode = run.nodes.find((node) => node.id === 'n-design-gate')!
  const artifacts = fixtureArtifacts.filter((artifact) => artifact.runId === run.id)
  const design = artifacts.find((artifact) => artifact.id === 'art-design')!
  const expected = await buildDesignRevisionIdentity(design)
  return { run, gateNode, artifacts, design, expected }
}

describe('design-review Gate approval version check (plan S4, Z1–Z2)', () => {
  it('digests exactly what the reviewer reads: title, summary and body', async () => {
    const { design } = await designGate()
    const digest = await createDesignRevisionDigest(design)
    expect(digest).toMatch(/^[a-f0-9]{64}$/u)
    expect(await createDesignRevisionDigest({ ...design, content: `${design.content} ` })).not.toBe(digest)
    expect(await createDesignRevisionDigest({ ...design, title: `${design.title}!` })).not.toBe(digest)
    expect(await createDesignRevisionDigest({ ...design, summary: `${design.summary}!` })).not.toBe(digest)
    const retimed: Artifact = { ...design, updatedAt: '2030-01-01T00:00:00.000Z' }
    expect(await createDesignRevisionDigest(retimed)).toBe(digest)
  })

  it('returns the linked design when the approver names it exactly', async () => {
    const value = await designGate()
    await expect(requireCurrentDesignRevision(value)).resolves.toMatchObject({
      artifact: { id: 'art-design' },
      identity: value.expected,
    })
  })

  it.each([
    ['a missing expectation', (value: Awaited<ReturnType<typeof designGate>>) => ({ ...value, expected: undefined })],
    ['another artifact', (value: Awaited<ReturnType<typeof designGate>>) => ({ ...value, expected: { ...value.expected, artifactId: 'art-other' } })],
    ['another recorded time', (value: Awaited<ReturnType<typeof designGate>>) => ({ ...value, expected: { ...value.expected, updatedAt: '2030-01-01T00:00:00.000Z' } })],
    ['a different digest', (value: Awaited<ReturnType<typeof designGate>>) => ({ ...value, expected: { ...value.expected, contentDigest: 'c'.repeat(64) } })],
    ['content changed after it was shown', (value: Awaited<ReturnType<typeof designGate>>) => ({
      ...value,
      artifacts: value.artifacts.map((artifact) => artifact.id === 'art-design' ? { ...artifact, content: 'Rewritten design.' } : artifact),
    })],
  ])('rejects %s before anything is written', async (_label, mutate) => {
    await expect(requireCurrentDesignRevision(mutate(await designGate()))).rejects.toThrow(staleDesignRevisionMessage)
  })

  it('rejects a Gate without a design, with two designs, or with a design from an unrelated step', async () => {
    const value = await designGate()
    await expect(requireCurrentDesignRevision({ ...value, gateNode: { ...value.gateNode, artifactIds: [] } }))
      .rejects.toThrow(staleDesignRevisionMessage)
    const second: Artifact = { ...value.design, id: 'art-design-2' }
    await expect(requireCurrentDesignRevision({
      ...value,
      gateNode: { ...value.gateNode, artifactIds: ['art-design', 'art-design-2'] },
      artifacts: [...value.artifacts, second],
    })).rejects.toThrow(staleDesignRevisionMessage)
    const foreign = value.artifacts.map((artifact) => artifact.id === 'art-design' ? { ...artifact, nodeId: 'n-build' } : artifact)
    expect(resolveDesignGateMaterial({ run: value.run, gateNode: value.gateNode, artifacts: foreign }).state).toBe('wrong_source')
    await expect(requireCurrentDesignRevision({ ...value, artifacts: foreign })).rejects.toThrow(staleDesignRevisionMessage)
  })

  it('records the confirmed design version on the approval event', async () => {
    const { expected } = await designGate()
    const base: AgentEvent = { id: 'event-1', runId: 'run-1', nodeId: 'n-design-gate', sequence: 3, kind: 'approval', message: 'Gate approved', timestamp: '2026-09-28T10:00:00.000Z' }
    expect(designApprovalEvent({ base, identity: expected, actorId: 'u-ling' })).toEqual({
      ...base,
      designAudit: { version: 1, action: 'approved', ...expected, actorId: 'u-ling' },
    })
  })

  it('only treats the design-review Gate as carrying a design version', () => {
    const run = fixtureRuns[0]!
    expect(run.nodes.filter(isDesignReviewGate).map((node) => node.id)).toEqual(['n-design-gate'])
  })
})
