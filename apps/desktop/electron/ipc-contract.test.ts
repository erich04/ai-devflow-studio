import { describe, expect, it } from 'vitest'
import type {
  AgentEvent,
  McpServerDefinition,
  RemoteRunSummary,
  RemoteTestEvidenceSummary,
  WorkflowRun,
} from '@ai-devflow/shared'
import {
  parseAgentEventInput,
  parseAgentProviderCredentialInput,
  parseMcpServersInput,
  parseRunKnowledgeReviewInput,
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
})
