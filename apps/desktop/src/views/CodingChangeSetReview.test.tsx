import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CodingAgentRun } from '@ai-devflow/shared'
import type { CodingPermissionProjection } from '../app/coding-runtime-action-projection'
import { CodingChangeSetReview, splitUnifiedDiffByFile } from './CodingChangeSetReview'

const diff = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1 @@
-old
+new
diff --git a/src/b.ts b/src/b.ts
--- a/src/b.ts
+++ b/src/b.ts
@@ -0,0 +1 @@
+second`

const run: CodingAgentRun = {
  id: 'coding-1', runId: 'run-1', nodeId: 'node-1', projectId: 'project-1', requestedBy: 'user-1',
  providerId: 'provider-1', engine: 'native', status: 'waiting_permission', branchName: 'codex/1',
  userInstruction: 'change', prompt: 'change', summary: 'waiting', changedPaths: [],
  startedAt: '2026-08-30T12:00:00.000Z', redacted: true,
}

function projection(overrides: Partial<CodingPermissionProjection> = {}): CodingPermissionProjection {
  return {
    request: {
      id: 'permission-1', codingRunId: run.id, runId: run.runId, nodeId: run.nodeId, origin: 'coding_executor',
      permission: 'patch', title: 'Review exact diff', changeSetId: 'change-set-1', changeSetDigest: 'digest-1',
      risk: 'warn', reasons: ['Exact review'], status: 'pending', requestedAt: '2026-08-30T12:00:00.000Z',
      expiresAt: '2026-08-30T12:05:00.000Z',
    },
    kind: 'change-set', remainingMs: 120_000, expired: false, canApprove: true, previewVerified: true,
    changedPaths: ['src/a.ts', 'src/b.ts'], changeSetDigest: 'digest-1',
    preview: {
      stateVersion: 2, id: 'change-set-1', codingRunId: run.id, phase: 'initial', changedPaths: ['src/a.ts', 'src/b.ts'],
      unifiedDiff: diff, changeSetDigest: 'digest-1', createdAt: '2026-08-30T12:00:00.000Z', expiresAt: '2026-08-30T12:05:00.000Z',
    },
    ...overrides,
  }
}

describe('CodingChangeSetReview', () => {
  it('segments a multi-file unified diff without wrapping it into one preview', () => {
    expect(splitUnifiedDiffByFile(diff).map((file) => file.path)).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('renders exact facts and approves the verified request once', () => {
    const onDecision = vi.fn()
    render(<CodingChangeSetReview permission={projection()} run={run} workspace={undefined} isReplying={false} onDecision={onDecision} />)
    const review = screen.getByTestId('coding-change-set-review')
    expect(within(review).getAllByText('src/a.ts')).toHaveLength(2)
    expect(within(review).getByLabelText('src/b.ts diff')).toBeTruthy()
    expect(within(review).getByText('digest-1')).toBeTruthy()
    fireEvent.click(within(review).getByRole('button', { name: 'Approve exact Change Set' }))
    expect(onDecision).toHaveBeenCalledWith('approved')
  })

  it('fails closed for every decision once the review is stale or expired', () => {
    const onDecision = vi.fn()
    render(<CodingChangeSetReview
      permission={projection({ canApprove: false, expired: true, remainingMs: 0, staleReason: 'Permission 已过期，不能审批。' })}
      run={run}
      workspace={undefined}
      isReplying={false}
      onDecision={onDecision}
    />)
    expect(screen.getByRole('button', { name: 'Approve exact Change Set' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    expect(onDecision).not.toHaveBeenCalled()
  })

  it('does not render an unverified digest-mismatched preview', () => {
    render(<CodingChangeSetReview
      permission={projection({
        canApprove: false,
        previewVerified: false,
        changedPaths: [],
        staleReason: 'Change Set 的 Run、ID 或 digest 已不匹配。',
      })}
      run={run}
      workspace={undefined}
      isReplying={false}
      onDecision={vi.fn()}
    />)

    expect(screen.queryByLabelText('src/a.ts diff')).not.toBeInTheDocument()
    expect(screen.getByText('精确预览尚未通过 ID、Run、digest 与 TTL 校验。')).toBeInTheDocument()
  })

  it('presents final Change Acceptance as Workflow acceptance rather than another write permission', () => {
    const onDecision = vi.fn()
    render(<CodingChangeSetReview
      permission={projection({
        request: {
          id: 'acceptance-1', codingRunId: run.id, runId: run.runId, nodeId: run.nodeId,
          origin: 'change_acceptance', permission: 'patch', title: 'Accept the final OpenCode changes',
          diffArtifactId: 'diff-1', diffSourceDigest: 'a'.repeat(64), testEvidenceId: 'test-1',
          managedWorkspaceId: 'workspace-1', diffPreview: diff, risk: 'warn', reasons: ['Exact final review'],
          status: 'pending', requestedAt: '2026-08-30T12:00:00.000Z', expiresAt: '2026-08-30T12:05:00.000Z',
        },
        kind: 'change-acceptance',
        changedPaths: ['src/a.ts', 'src/b.ts'],
        diffArtifact: {
          id: 'diff-1', runId: run.runId, nodeId: run.nodeId, projectId: run.projectId,
          changedPaths: ['src/a.ts', 'src/b.ts'], patch: diff, sourceDigest: 'a'.repeat(64),
          truncated: false, redacted: false, createdAt: '2026-08-30T12:00:00.000Z',
        },
        testEvidence: {
          id: 'test-1', runId: run.runId, nodeId: run.nodeId, projectId: run.projectId,
          command: 'pnpm test', cwd: '<workspace>', status: 'passed', exitCode: 0, durationMs: 10,
          stdout: 'passed', stderr: '', summary: 'Canonical test passed.', redacted: true,
          createdAt: '2026-08-30T12:00:00.000Z',
        },
      })}
      run={{ ...run, engine: 'opencode-http' }}
      workspace={undefined}
      isReplying={false}
      onDecision={onDecision}
    />)

    expect(screen.getByText('最终变更接收（Change Acceptance）')).toBeInTheDocument()
    expect(screen.getByText('passed')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '接收最终修改' }))
    expect(onDecision).toHaveBeenCalledWith('approved')
    expect(screen.getByRole('button', { name: '拒绝并保留 worktree' })).toBeEnabled()
  })
})
