import type { DesktopPairingCredential, WorkflowRun } from '@ai-devflow/shared'
import { describe, expect, it } from 'vitest'
import { resolveTrustedCodingRequest } from './coding-request-authority'

const run = {
  id: 'run-1',
  projectId: 'local-project-1',
  creatorId: 'run-creator-1',
} as WorkflowRun

const pairing = {
  localProjectId: 'local-project-1',
  userId: 'paired-user-1',
  role: 'lead',
} as DesktopPairingCredential

describe('coding request authority', () => {
  it('uses the paired Workflow actor instead of renderer requestedBy', () => {
    expect(resolveTrustedCodingRequest({
      input: {
        runId: 'run-1',
        projectId: 'local-project-1',
        requestedBy: 'forged-renderer-user',
        nodeId: 'node-1',
      },
      run,
      pairing,
    })).toEqual({
      runId: 'run-1',
      projectId: 'local-project-1',
      requestedBy: 'paired-user-1',
      nodeId: 'node-1',
    })
  })

  it('falls back to the persisted Workflow creator when the project is unpaired', () => {
    expect(resolveTrustedCodingRequest({
      input: {
        runId: 'run-1',
        projectId: 'local-project-1',
        requestedBy: 'forged-renderer-user',
      },
      run,
      pairing: null,
    }).requestedBy).toBe('run-creator-1')
  })

  it.each([
    { name: 'missing run', run: null, projectId: 'local-project-1' },
    { name: 'wrong run id', run: { ...run, id: 'run-2' }, projectId: 'local-project-1' },
    { name: 'wrong project', run, projectId: 'local-project-2' },
  ])('fails closed for $name', ({ run: candidate, projectId }) => {
    expect(() => resolveTrustedCodingRequest({
      input: {
        runId: 'run-1',
        projectId,
        requestedBy: 'forged-renderer-user',
      },
      run: candidate,
      pairing,
    })).toThrow('Coding request does not match a persisted Workflow run')
  })
})
