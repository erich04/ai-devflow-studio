import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createDesignRevisionDigest, listDesignApprovals, sameDesignRevision } from './design-revision'
import type { AgentEvent } from './domain'

describe('design revision identity (plan S4, Z1)', () => {
  it('keeps the digest formula that smoke scripts reproduce outside the renderer', async () => {
    const artifact = { title: '方案设计', summary: '摘要', content: '正文\n第二行' }
    // scripts/electron-smoke.mjs, v15 and workspace-baseline samples hash the same JSON.
    const expected = createHash('sha256').update(JSON.stringify({ title: artifact.title, summary: artifact.summary, content: artifact.content })).digest('hex')
    expect(await createDesignRevisionDigest(artifact)).toBe(expected)
  })

  it('compares all three identity fields', () => {
    const identity = { artifactId: 'a', updatedAt: '2026-09-28T10:00:00.000Z', contentDigest: 'b'.repeat(64) }
    expect(sameDesignRevision(identity, { ...identity })).toBe(true)
    expect(sameDesignRevision(identity, { ...identity, artifactId: 'c' })).toBe(false)
    expect(sameDesignRevision(identity, { ...identity, updatedAt: '2026-09-28T10:00:01.000Z' })).toBe(false)
    expect(sameDesignRevision(identity, { ...identity, contentDigest: 'c'.repeat(64) })).toBe(false)
  })

  it('lists only the design approvals of the run, newest first', () => {
    const approval = (id: string, runId: string, timestamp: string, audited = true): AgentEvent => ({
      id, runId, sequence: 1, kind: 'approval', message: 'approved', timestamp,
      ...(audited ? { designAudit: { version: 1 as const, action: 'approved' as const, artifactId: 'design', updatedAt: timestamp, contentDigest: 'a'.repeat(64), actorId: 'u' } } : {}),
    })
    const events = [
      approval('old', 'run-1', '2026-09-28T10:00:00.000Z'),
      approval('new', 'run-1', '2026-09-28T11:00:00.000Z'),
      approval('other-run', 'run-2', '2026-09-28T12:00:00.000Z'),
      approval('clarify', 'run-1', '2026-09-28T13:00:00.000Z', false),
    ]
    expect(listDesignApprovals(events, 'run-1').map((event) => event.id)).toEqual(['new', 'old'])
  })
})
