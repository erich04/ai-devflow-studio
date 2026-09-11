import { describe, expect, it } from 'vitest'
import { runs, artifacts } from './fixtures'
import { buildGateReviewSubjectSnapshot } from './agent-review'
import { parseGateReviewSubjectSnapshot } from './gate-review-subject'
import { createRemoteRunSummary, parseRemoteRunSummary } from './remote-sync'

const run = { ...runs[0]!, currentNodeId: 'n-design-gate' }

describe('Main-owned Gate Review subject snapshots', () => {
  it('derives digests from actual persisted subjects, ignoring an attached projection, and detects body-only changes', async () => {
    const snapshot = await buildGateReviewSubjectSnapshot({ run, artifacts })
    const changed = await buildGateReviewSubjectSnapshot({
      run: { ...run, gateReviewSubject: snapshot },
      artifacts: artifacts.map((artifact) => artifact.id === 'art-design'
        ? { ...artifact, content: `${artifact.content}\nChanged without a timestamp change.` } : artifact),
    })
    expect(changed.artifacts.find((artifact) => artifact.id === 'art-design')!.contentDigest)
      .not.toBe(snapshot.artifacts.find((artifact) => artifact.id === 'art-design')!.contentDigest)
    expect(JSON.stringify(snapshot)).not.toContain(run.request)
    expect(snapshot.artifacts.every((artifact) => Object.keys(artifact).sort().join(',') === 'contentDigest,id,kind,nodeId,updatedAt')).toBe(true)
    expect(parseRemoteRunSummary({ ...createRemoteRunSummary(run), gateReviewSubject: snapshot }).gateReviewSubject).toEqual(snapshot)
  })

  it.each(['body', 'path', 'digest', 'duplicate', 'foreign-run', 'foreign-node', 'version'])('rejects malformed or mismatched metadata: %s', async (scenario) => {
    const snapshot = await buildGateReviewSubjectSnapshot({ run, artifacts })
    const bad = structuredClone(snapshot)
    if (scenario === 'path') bad.artifacts[0]!.id = '/Users/alice/private'
    if (scenario === 'digest') bad.requestDigest = 'API_KEY=not-a-digest'
    if (scenario === 'duplicate') bad.artifacts.push(bad.artifacts[0]!)
    if (scenario === 'foreign-run') bad.runId = 'other-run'
    if (scenario === 'foreign-node') bad.nodeId = 'other-gate'
    if (scenario === 'version') bad.runVersion += 1
    const value = scenario === 'body' ? { ...bad, content: 'Raw local Artifact body' } : bad
    expect(() => parseRemoteRunSummary({ ...createRemoteRunSummary(run), gateReviewSubject: value } )).toThrow()
  })

  it('cannot create proof for missing or incomplete local subjects', async () => {
    await expect(buildGateReviewSubjectSnapshot({ run, artifacts: [] })).rejects.toThrow()
    await expect(buildGateReviewSubjectSnapshot({ run, artifacts: artifacts.map((artifact) =>
      artifact.id === 'art-design' ? { ...artifact, content: '' } : artifact) })).rejects.toThrow(/incomplete/)
    expect(() => parseGateReviewSubjectSnapshot({})).toThrow()
  })
})
