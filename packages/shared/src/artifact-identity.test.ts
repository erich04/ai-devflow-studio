import { describe, expect, it } from 'vitest'
import {
  buildDesignRevisionIdentity,
  isSavedDesignProposal,
  isSavedDiscussionProposal,
  resolveSavedProposals,
  SavedProposalSelectionError,
} from './artifact-identity'
import * as designRevision from './design-revision'
import type { Artifact, DesignRevisionIdentity, WorkflowRun } from './domain'

const run = { id: 'run-1' } as WorkflowRun

function proposal(id: string, overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: `conversation-proposal-${id}`,
    runId: 'run-1',
    nodeId: 'node-agent',
    kind: 'log',
    title: `提案 ${id}`,
    summary: '摘要',
    content: `提案正文 ${id}`,
    redacted: true,
    updatedAt: '2026-10-30T10:00:00.000Z',
    ...overrides,
  }
}

async function resolve(artifacts: Artifact[], identities: DesignRevisionIdentity[], max = 20) {
  return resolveSavedProposals({ run, artifacts, identities, allowedNodeIds: ['node-agent', 'node-gate'], max })
}

describe('saved discussion proposals', () => {
  it('recognises saved proposals by kind and id prefix', () => {
    expect(isSavedDiscussionProposal(proposal('a'))).toBe(true)
    expect(isSavedDiscussionProposal(proposal('a', { kind: 'design' }))).toBe(false)
    expect(isSavedDiscussionProposal(proposal('a', { id: 'artifact-a' }))).toBe(false)
    expect(isSavedDesignProposal).toBe(isSavedDiscussionProposal)
  })

  it('keeps the moved identity helpers reachable from design-revision', () => {
    expect(designRevision.buildDesignRevisionIdentity).toBe(buildDesignRevisionIdentity)
    expect(designRevision.isSavedDesignProposal).toBe(isSavedDiscussionProposal)
  })

  it('returns the artifacts in identity order from either allowed node', async () => {
    const first = proposal('a')
    const second = proposal('b', { nodeId: 'node-gate' })
    const identities = [await buildDesignRevisionIdentity(second), await buildDesignRevisionIdentity(first)]
    expect((await resolve([first, second], identities)).map((item) => item.id)).toEqual([second.id, first.id])
    expect(await resolve([first], [])).toEqual([])
  })

  it('rejects every invalid selection with a SavedProposalSelectionError', async () => {
    const valid = proposal('a')
    const identity = await buildDesignRevisionIdentity(valid)
    const cases: Array<[string, Artifact[], DesignRevisionIdentity[], number?]> = [
      ['too many', [valid, proposal('b')], [identity, await buildDesignRevisionIdentity(proposal('b'))], 1],
      ['duplicate', [valid], [identity, identity]],
      ['missing', [], [identity]],
      ['other run', [{ ...valid, runId: 'run-2' }], [identity]],
      ['other node', [{ ...valid, nodeId: 'node-other' }], [identity]],
      ['not a proposal', [{ ...valid, kind: 'design' }], [identity]],
      ['empty body', [{ ...valid, content: '  ' }], [await buildDesignRevisionIdentity({ ...valid, content: '  ' })]],
      ['changed time', [valid], [{ ...identity, updatedAt: '2026-10-30T10:00:01.000Z' }]],
      ['changed body', [{ ...valid, content: '新正文' }], [identity]],
    ]
    for (const [name, artifacts, identities, max] of cases) {
      const error = await resolve(artifacts, identities, max).catch((caught: unknown) => caught)
      expect(error, name).toBeInstanceOf(SavedProposalSelectionError)
      expect((error as Error).message, name).toMatch(/[\u4e00-\u9fff]/u)
    }
  })
})
