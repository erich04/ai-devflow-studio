import { describe, expect, it } from 'vitest'
import type {
  AgentEvent,
  McpServerDefinition,
  RemoteCodingAgentSummary,
  RemoteRunSummary,
  RemoteTestEvidenceSummary,
  WorkflowRun,
} from '@ai-devflow/shared'
import {
  parseAgentEventInput,
  parseAgentProviderCredentialInput,
  parseCancelCodingAgentRunInput,
  parsePairDesktopInput,
  parseMcpServersInput,
  parseOpenManagedWorktreeInput,
  parseReplyCodingPermissionInput,
  parseRunCodingAgentInput,
  parseRunKnowledgeReviewInput,
  parseRemoteCodingAgentSummaryInput,
  parseRemoteRunSummaryInput,
  parseRemoteSnapshotInput,
  parseRemoteTestEvidenceSummaryInput,
  parseRunProjectTestsInput,
  parseSaveRunInput,
  parseSaveProjectTestCommandInput,
  parseSettingsInput,
  parseValidateTestCommandInput,
} from './ipc-contract'

const run: WorkflowRun = {
  id: 'run-1',
  title: 'Run local tests',
  request: 'Archive local test evidence.',
  projectId: 'project-1',
  creatorId: 'user-1',
  status: 'testing',
  currentNodeId: 'node-test',
  branchName: 'ai/local-tests',
  createdAt: '2026-06-15T00:00:00.000Z',
  updatedAt: '2026-06-15T00:00:00.000Z',
  nodes: [],
  edges: [],
}

const event: AgentEvent = {
  id: 'event-approval-1',
  runId: 'run-1',
  nodeId: 'node-test',
  sequence: 1,
  kind: 'approval',
  message: 'Gate approved',
  timestamp: '2026-06-15T00:01:00.000Z',
}

const mcpServer: McpServerDefinition = {
  id: 'mcp-filesystem',
  name: 'Filesystem',
  command: 'npx @modelcontextprotocol/server-filesystem',
  permission: 'read',
  enabledLocally: true,
  lastAuditEvent: 'Enabled locally',
}

const remoteRunSummary: RemoteRunSummary = {
  kind: 'approval',
  runId: 'run-1',
  projectId: 'project-1',
  title: 'Run local tests',
  status: 'building',
  currentNodeId: 'node-test',
  branchName: 'ai/local-tests',
  updatedAt: '2026-06-15T00:02:00.000Z',
}

const remoteEvidenceSummary: RemoteTestEvidenceSummary = {
  id: 'evidence-1',
  runId: 'run-1',
  nodeId: 'node-test',
  projectId: 'project-1',
  command: 'pnpm test',
  status: 'passed',
  exitCode: 0,
  durationMs: 900,
  summary: 'Tests passed in 900ms',
  redacted: true,
  createdAt: '2026-06-15T00:03:00.000Z',
}

const remoteCodingSummary: RemoteCodingAgentSummary = {
  id: 'coding-run-1',
  runId: 'run-1',
  nodeId: 'node-build',
  projectId: 'project-1',
  requestedBy: 'user-1',
  providerId: 'fake-coding-engine',
  engine: 'fake',
  status: 'completed',
  branchName: 'devflow/run-1-node-build-coding-run-1',
  summary: 'Created a small fake coding diff.',
  changedPaths: ['src/example.ts'],
  startedAt: '2026-06-15T00:04:00.000Z',
  completedAt: '2026-06-15T00:05:00.000Z',
  redacted: true,
}

describe('IPC contract parsers', () => {
  it('accepts a valid save test command payload', () => {
    expect(parseSaveProjectTestCommandInput({ projectId: 'project-1', testCommand: 'pnpm test' })).toEqual({
      projectId: 'project-1',
      testCommand: 'pnpm test',
    })
  })

  it('accepts a valid validate test command payload', () => {
    expect(parseValidateTestCommandInput({ projectId: 'project-1', testCommand: 'pnpm test' })).toEqual({
      projectId: 'project-1',
      testCommand: 'pnpm test',
    })
  })

  it('rejects an empty validate test command payload', () => {
    expect(() => parseValidateTestCommandInput({ projectId: 'project-1', testCommand: ' ' })).toThrow(
      /testCommand/,
    )
  })

  it('rejects an empty test command payload', () => {
    expect(() => parseSaveProjectTestCommandInput({ projectId: 'project-1', testCommand: ' ' })).toThrow(
      /testCommand/,
    )
  })

  it('accepts a valid run project tests payload', () => {
    expect(
      parseRunProjectTestsInput({
        projectId: 'project-1',
        runId: 'run-1',
        nodeId: 'node-test',
        run,
      }),
    ).toEqual({ projectId: 'project-1', runId: 'run-1', nodeId: 'node-test', run })
  })

  it('rejects a run project tests payload whose runId does not match the run snapshot', () => {
    expect(() =>
      parseRunProjectTestsInput({
        projectId: 'project-1',
        runId: 'other-run',
        nodeId: 'node-test',
        run,
      }),
    ).toThrow(/runId/)
  })

  it('accepts valid save run, event, settings, and MCP payloads', () => {
    expect(parseSaveRunInput(run)).toEqual(run)
    expect(parseAgentEventInput(event)).toEqual(event)
    expect(parseSettingsInput({ themePreference: 'dark' })).toEqual({ themePreference: 'dark' })
    expect(parseMcpServersInput([mcpServer])).toEqual([mcpServer])
  })

  it('rejects invalid settings and MCP payloads', () => {
    expect(() => parseSettingsInput({ themePreference: 'neon' })).toThrow(/themePreference/)
    expect(() => parseMcpServersInput([{ id: 'mcp-bad', name: 'Bad' }])).toThrow(/MCP/)
  })

  it('accepts remote snapshot and upload payloads', () => {
    expect(parseRemoteSnapshotInput({ organizationId: 'org-1' })).toEqual({
      organizationId: 'org-1',
    })
    expect(parseRemoteSnapshotInput(undefined)).toEqual({})
    expect(parseRemoteRunSummaryInput(remoteRunSummary)).toEqual(remoteRunSummary)
    expect(parseRemoteTestEvidenceSummaryInput(remoteEvidenceSummary)).toEqual(remoteEvidenceSummary)
    expect(parseRemoteCodingAgentSummaryInput(remoteCodingSummary)).toEqual(remoteCodingSummary)
  })

  it('rejects local-only fields in remote test evidence upload payloads', () => {
    expect(() =>
      parseRemoteTestEvidenceSummaryInput({
        ...remoteEvidenceSummary,
        cwd: '/Users/erich/project',
      }),
    ).toThrow(/local-only/)
    expect(() =>
      parseRemoteTestEvidenceSummaryInput({
        ...remoteEvidenceSummary,
        stdout: 'secret output',
      }),
    ).toThrow(/local-only/)
  })

  it('rejects local-only fields and unsafe paths in remote coding summary payloads', () => {
    expect(() =>
      parseRemoteCodingAgentSummaryInput({
        ...remoteCodingSummary,
        cwd: '/Users/erich/project',
      }),
    ).toThrow(/local-only/)
    expect(() =>
      parseRemoteCodingAgentSummaryInput({
        ...remoteCodingSummary,
        patch: '+secret',
      }),
    ).toThrow(/local-only/)
    expect(() =>
      parseRemoteCodingAgentSummaryInput({
        ...remoteCodingSummary,
        changedPaths: ['/Users/erich/project/src/example.ts'],
      }),
    ).toThrow(/Invalid remote coding agent summary/)
  })

  it('accepts provider credential and knowledge review payloads', () => {
    expect(
      parseAgentProviderCredentialInput({
        providerId: 'openai-default',
        apiKey: 'sk-test-secret',
        model: 'gpt-4.1-mini',
      }),
    ).toEqual({
      providerId: 'openai-default',
      apiKey: 'sk-test-secret',
      model: 'gpt-4.1-mini',
    })

    expect(
      parseRunKnowledgeReviewInput({
        runId: 'run-1',
        nodeId: 'node-test',
        projectId: 'project-1',
        requestedBy: 'u-ling',
        runtime: 'electron',
      }),
    ).toEqual({
      runId: 'run-1',
      nodeId: 'node-test',
      projectId: 'project-1',
      requestedBy: 'u-ling',
      runtime: 'electron',
    })
  })

  it('accepts desktop pairing codes and rejects empty pairing payloads', () => {
    expect(parsePairDesktopInput({ code: 'pair-id.copy-once-secret' })).toEqual({
      code: 'pair-id.copy-once-secret',
    })
    expect(() => parsePairDesktopInput({ code: ' ' })).toThrow(/code/)
  })

  it('rejects empty provider credentials and malformed knowledge review payloads', () => {
    expect(() =>
      parseAgentProviderCredentialInput({
        providerId: 'openai-default',
        apiKey: ' ',
        model: 'gpt-4.1-mini',
      }),
    ).toThrow(/apiKey/)

    expect(() =>
      parseRunKnowledgeReviewInput({
        runId: 'run-1',
        nodeId: 'node-test',
      }),
    ).toThrow(/projectId/)
  })

  it('accepts coding agent payloads without accepting renderer-supplied raw prompts', () => {
    expect(
      parseRunCodingAgentInput({
        runId: 'run-1',
        nodeId: 'node-build',
        projectId: 'project-1',
        requestedBy: 'user-1',
        providerId: 'fake-coding-engine',
        userInstruction: 'Keep changes minimal.',
      }),
    ).toEqual({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'fake-coding-engine',
      userInstruction: 'Keep changes minimal.',
    })

    expect(
      parseRunCodingAgentInput({
        runId: 'run-1',
        nodeId: 'node-build',
        projectId: 'project-1',
        requestedBy: 'user-1',
        providerId: 'opencode-http',
        userInstruction: 'Use the approved runtime budget.',
        runtimeBudgetApprovalId: ' runtime-budget-approval-1 ',
      }),
    ).toEqual({
      runId: 'run-1',
      nodeId: 'node-build',
      projectId: 'project-1',
      requestedBy: 'user-1',
      providerId: 'opencode-http',
      userInstruction: 'Use the approved runtime budget.',
      runtimeBudgetApprovalId: 'runtime-budget-approval-1',
    })

    expect(() =>
      parseRunCodingAgentInput({
        runId: 'run-1',
        nodeId: 'node-build',
        projectId: 'project-1',
        requestedBy: 'user-1',
        providerId: 'fake-coding-engine',
        userInstruction: 'Do it.',
        prompt: 'renderer must not send prebuilt prompts',
      }),
    ).toThrow(/prompt/)
  })

  it('accepts coding permission replies, cancellations, and managed worktree actions', () => {
    expect(
      parseReplyCodingPermissionInput({
        requestId: 'permission-1',
        codingRunId: 'coding-run-1',
        decidedBy: 'user-1',
        decision: 'approved',
        comment: 'Allow once.',
      }),
    ).toEqual({
      requestId: 'permission-1',
      codingRunId: 'coding-run-1',
      decidedBy: 'user-1',
      decision: 'approved',
      comment: 'Allow once.',
    })

    expect(parseCancelCodingAgentRunInput({ codingRunId: 'coding-run-1' })).toEqual({
      codingRunId: 'coding-run-1',
    })

    expect(parseOpenManagedWorktreeInput({ workspaceId: 'workspace-1' })).toEqual({
      workspaceId: 'workspace-1',
    })
  })
})
