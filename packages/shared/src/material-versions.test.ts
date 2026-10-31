import { describe, expect, it } from 'vitest'
import { numberDesignVersions, summarizeRunMaterialVersions } from './material-versions'
import type { Artifact, WorkflowNode, WorkflowRun } from './domain'

function design(id: string, updatedAt: string, previous?: string, previousUpdatedAt?: string): Artifact {
  return {
    id,
    runId: 'run-1',
    nodeId: 'run-1-design',
    kind: 'design',
    title: '方案设计',
    summary: '摘要',
    content: `正文 ${id}`,
    redacted: true,
    updatedAt,
    ...(previous
      ? {
          designRevision: {
            version: 1 as const,
            previous: { artifactId: previous, updatedAt: previousUpdatedAt ?? updatedAt, contentDigest: 'a'.repeat(64) },
            proposals: [],
          },
        }
      : {}),
  }
}

const t1 = '2026-10-30T10:00:00.000Z'
const t2 = '2026-10-30T11:00:00.000Z'
const t3 = '2026-10-30T12:00:00.000Z'
const t4 = '2026-10-30T13:00:00.000Z'

describe('numberDesignVersions', () => {
  it('numbers a recorded chain from the one root', () => {
    const numbers = numberDesignVersions('run-1', [
      design('d3', t3, 'd2', t2),
      design('d1', t1),
      design('d2', t2, 'd1', t1),
      { ...design('other-run', t1), runId: 'run-2' },
    ])
    expect([...numbers.entries()].sort()).toEqual([['d1', 1], ['d2', 2], ['d3', 3]])
  })

  it('stops at a fork and leaves both branches unnumbered', () => {
    const numbers = numberDesignVersions('run-1', [
      design('d1', t1),
      design('d2', t2, 'd1', t1),
      design('d3a', t3, 'd2', t2),
      design('d3b', t3, 'd2', t2),
      design('d4', t4, 'd3a', t3),
    ])
    expect(Object.fromEntries(numbers)).toEqual({ d1: 1, d2: 2 })
  })

  it('leaves a broken link and everything after it unnumbered', () => {
    const numbers = numberDesignVersions('run-1', [
      design('d1', t1),
      design('d2', t2, 'missing', t1),
      design('d3', t3, 'd2', t2),
      design('d2b', t2, 'd1', '2026-10-30T09:00:00.000Z'),
    ])
    expect(Object.fromEntries(numbers)).toEqual({ d1: 1 })
  })

  it('leaves a cycle unnumbered', () => {
    const numbers = numberDesignVersions('run-1', [
      design('d1', t1),
      design('x', t2, 'y', t3),
      design('y', t3, 'x', t2),
    ])
    expect(Object.fromEntries(numbers)).toEqual({ d1: 1 })
  })

  it('numbers nothing with several roots or no root', () => {
    expect(numberDesignVersions('run-1', [design('d1', t1), design('d1b', t2)]).size).toBe(0)
    expect(numberDesignVersions('run-1', [design('x', t2, 'y', t3), design('y', t3, 'x', t2)]).size).toBe(0)
  })
})

describe('summarizeRunMaterialVersions', () => {
  function run(gateStatus: WorkflowNode['status'], gateArtifactIds: string[]): WorkflowRun {
    return {
      id: 'run-1',
      nodes: [
        { id: 'run-1-design', kind: 'agent', stage: 'design', status: 'success', artifactIds: [] },
        { id: 'run-1-design-review', kind: 'gate', stage: 'design', status: gateStatus, artifactIds: gateArtifactIds },
      ],
      edges: [{ id: 'edge', source: 'run-1-design', target: 'run-1-design-review' }],
    } as unknown as WorkflowRun
  }

  function clarification(id: string, revision?: number, status = 'review_requested'): Artifact {
    return {
      id,
      runId: 'run-1',
      nodeId: 'run-1-clarify',
      kind: 'clarification',
      title: '需求澄清结果',
      summary: '',
      content: '正文',
      redacted: true,
      updatedAt: t1,
      ...(revision ? { clarificationRevision: { revision, status } as NonNullable<Artifact['clarificationRevision']> } : {}),
    }
  }

  it('reports the latest requirement revision and the Gate design with its number', () => {
    const artifacts = [
      clarification('c1', 1, 'superseded'),
      clarification('c2', 2, 'approved'),
      design('d1', t1),
      design('d2', t2, 'd1', t1),
    ]
    expect(summarizeRunMaterialVersions(run('running', ['d2']), artifacts)).toEqual({
      requirement: { version: 2, status: 'approved', artifactId: 'c2', updatedAt: t1 },
      design: { version: 2, artifactId: 'd2', updatedAt: t2, gateStatus: 'running' },
    })
  })

  it('marks a requirement without revision metadata as legacy and omits an unknown design number', () => {
    const artifacts = [clarification('c1'), design('d1', t1), design('d1b', t2)]
    expect(summarizeRunMaterialVersions(run('pending', []), artifacts)).toEqual({
      requirement: { version: 1, status: 'legacy', artifactId: 'c1', updatedAt: t1 },
      design: { artifactId: 'd1b', updatedAt: t2, gateStatus: 'pending' },
    })
  })

  it('omits materials the run does not have', () => {
    expect(summarizeRunMaterialVersions(run('pending', []), [])).toEqual({})
  })
})
