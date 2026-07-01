import { describe, expect, it } from 'vitest'
import type { TestEvidence, WorkflowRun } from './domain'
import {
  createAuthenticatedTeamSessionHeaders,
  createDemoTeamSessionHeaders,
  createRemoteTestEvidenceSummary,
  createRemoteRunSummary,
} from './remote-sync'

const run: WorkflowRun = {
  id: 'run-1',
  title: 'Remote sync run',
  request: 'Sync only approved summaries.',
  projectId: 'project-1',
  creatorId: 'user-1',
  status: 'building',
  currentNodeId: 'node-gate',
  branchName: 'ai/remote-sync',
  createdAt: '2026-06-16T00:00:00.000Z',
  updatedAt: '2026-06-16T00:10:00.000Z',
  nodes: [],
  edges: [],
}

const evidence: TestEvidence = {
  id: 'evidence-1',
  runId: 'run-1',
  nodeId: 'node-test',
  projectId: 'project-1',
  command: 'pnpm test',
  cwd: 'C:\\Users\\erich\\repo',
  status: 'passed',
  exitCode: 0,
  durationMs: 1200,
  stdout: 'SECRET_TOKEN=sk-123',
  stderr: 'stack trace that should stay local',
  summary: 'Tests passed in 1200ms',
  redacted: true,
  createdAt: '2026-06-16T00:12:00.000Z',
}

describe('remote sync helpers', () => {
  it('creates explicit demo team session headers for API clients', () => {
    expect(createDemoTeamSessionHeaders()).toEqual({
      'x-devflow-session-source': 'demo',
      'x-devflow-organization-id': 'org-demo',
      'x-devflow-user-id': 'u-erich',
      'x-devflow-user-role': 'owner',
      'x-devflow-project-roles': 'p-payments:owner,p-admin:owner',
    })
  })

  it('creates authenticated team session headers for paired clients', () => {
    expect(createAuthenticatedTeamSessionHeaders({
      organizationId: 'org-demo',
      userId: 'u-github-1',
      role: 'lead',
      authAccountId: 'acct-github-1',
      projectRoles: [
        { projectId: 'p-payments', role: 'lead' },
        { projectId: 'p-admin', role: 'member' },
      ],
    })).toEqual({
      'x-devflow-session-source': 'authenticated',
      'x-devflow-organization-id': 'org-demo',
      'x-devflow-user-id': 'u-github-1',
      'x-devflow-user-role': 'lead',
      'x-devflow-auth-account-id': 'acct-github-1',
      'x-devflow-project-roles': 'p-payments:lead,p-admin:member',
    })
  })

  it('creates a remote run summary without local-only execution details', () => {
    expect(createRemoteRunSummary(run, 'approval')).toEqual({
      kind: 'approval',
      runId: 'run-1',
      projectId: 'project-1',
      title: 'Remote sync run',
      status: 'building',
      currentNodeId: 'node-gate',
      branchName: 'ai/remote-sync',
      updatedAt: '2026-06-16T00:10:00.000Z',
    })
  })

  it('creates redacted remote test evidence summaries and omits raw stdout, stderr, and cwd', () => {
    const summary = createRemoteTestEvidenceSummary(evidence)

    expect(summary).toEqual({
      id: 'evidence-1',
      runId: 'run-1',
      nodeId: 'node-test',
      projectId: 'project-1',
      command: 'pnpm test',
      status: 'passed',
      exitCode: 0,
      durationMs: 1200,
      summary: 'Tests passed in 1200ms',
      redacted: true,
      createdAt: '2026-06-16T00:12:00.000Z',
    })
    expect(JSON.stringify(summary)).not.toContain('SECRET_TOKEN')
    expect(JSON.stringify(summary)).not.toContain('stack trace')
    expect(JSON.stringify(summary)).not.toContain('C:\\Users\\erich')
  })
})
