import { describe, expect, it } from 'vitest'
import type { McpServerDefinition } from '@ai-devflow/shared'
import {
  ipcChannels,
  parseApproveGateInput,
  parseAgentProviderCredentialInput,
  parseCancelCodingAgentRunInput,
  parseCreateAcceptanceBundleInput,
  parseCreatePrDraftInput,
  parseCreateRunInput,
  parseDeleteRunInput,
  parseCompleteWorkflowAgentNodeInput,
  parsePairDesktopInput,
  parseMcpServersInput,
  parseOpenManagedWorktreeInput,
  parseReplyCodingPermissionInput,
  parseRunCodingAgentInput,
  parseRunKnowledgeReviewInput,
  parseRemoteSnapshotInput,
  parseRunProjectTestsInput,
  parseSaveGateOverrideInput,
  parseSaveProjectTestCommandInput,
  parseSettingsInput,
  parseValidateTestCommandInput,
} from './ipc-contract'

const mcpServer: McpServerDefinition = {
  id: 'mcp-filesystem',
  name: 'Filesystem',
  command: 'npx @modelcontextprotocol/server-filesystem',
  permission: 'read',
  enabledLocally: true,
  lastAuditEvent: 'Enabled locally',
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
      }),
    ).toEqual({ projectId: 'project-1', runId: 'run-1', nodeId: 'node-test' })
  })

  it('keeps gate approval input identifier-only', () => {
    expect(
      parseApproveGateInput({
        runId: 'run-1',
        nodeId: 'node-gate',
      }),
    ).toEqual({ runId: 'run-1', nodeId: 'node-gate' })

    expect(() =>
      parseApproveGateInput({
        runId: 'run-1',
        nodeId: 'node-gate',
        userId: 'spoofed-owner',
        userName: 'Spoofed Owner',
        role: 'owner',
      }),
    ).toThrow(/unexpected field/i)
  })

  it('keeps Gate override input command-only and rejects derived trust fields', () => {
    expect(
      parseSaveGateOverrideInput({
        runId: 'run-1',
        nodeId: 'node-gate',
        reason: 'Reviewed the canonical blocking evidence.',
      }),
    ).toEqual({
      runId: 'run-1',
      nodeId: 'node-gate',
      reason: 'Reviewed the canonical blocking evidence.',
    })

    for (const derivedField of [
      { projectId: 'spoofed-project' },
      { userId: 'spoofed-owner' },
      { role: 'owner' },
      { blockedReasonIds: [] },
      { policyVersion: 999 },
      { provisional: false },
    ]) {
      expect(() =>
        parseSaveGateOverrideInput({
          runId: 'run-1',
          nodeId: 'node-gate',
          reason: 'Reviewed the canonical blocking evidence.',
          ...derivedField,
        }),
      ).toThrow(/unexpected field/i)
    }
  })

  it('accepts a request-based create run payload', () => {
    expect(
      parseCreateRunInput({
        title: 'Fix webhook retry',
        request: 'Clarify retry boundaries and implement the fix.',
        projectId: 'p-payments',
        creatorId: 'u-wang',
        branchName: 'ai/webhook-retry',
      }),
    ).toEqual({
      title: 'Fix webhook retry',
      request: 'Clarify retry boundaries and implement the fix.',
      projectId: 'p-payments',
      creatorId: 'u-wang',
      branchName: 'ai/webhook-retry',
    })
  })

  it('accepts a workflow agent node completion payload', () => {
    expect(
      parseCompleteWorkflowAgentNodeInput({
        runId: 'run-1',
        nodeId: 'run-1-clarify',
        userId: 'u-ling',
        userName: 'Ling',
        providerId: 'doubao-review',
      }),
    ).toEqual({
      runId: 'run-1',
      nodeId: 'run-1-clarify',
      userId: 'u-ling',
      userName: 'Ling',
      providerId: 'doubao-review',
    })
  })

  it('rejects workflow agent node completion payloads with renderer-supplied artifacts', () => {
    expect(() =>
      parseCompleteWorkflowAgentNodeInput({
        runId: 'run-1',
        nodeId: 'run-1-clarify',
        userId: 'u-ling',
        userName: 'Ling',
        artifact: {
          id: 'artifact-forged',
          content: 'forged',
        },
      }),
    ).toThrow(/artifact/)
  })

  it('rejects create run payloads without a raw request', () => {
    expect(() =>
      parseCreateRunInput({
        title: 'Fix webhook retry',
        projectId: 'p-payments',
        creatorId: 'u-wang',
        branchName: 'ai/webhook-retry',
      }),
    ).toThrow(/request/)
  })

  it.each(['run', 'artifact', 'event', 'evidence'])(
    'rejects renderer-supplied %s data in run project tests payloads',
    (field) => {
      expect(() =>
        parseRunProjectTestsInput({
          projectId: 'project-1',
          runId: 'run-1',
          nodeId: 'node-test',
          [field]: { id: 'forged' },
        }),
      ).toThrow(new RegExp(field))
    },
  )

  it('exposes dedicated delivery channels without generic persistence channels', () => {
    expect(ipcChannels).not.toHaveProperty('saveRun')
    expect(ipcChannels).not.toHaveProperty('saveArtifact')
    expect(ipcChannels).not.toHaveProperty('saveEvent')
    expect(ipcChannels).toMatchObject({
      createPrDraft: 'devflow:pr-draft:create',
      createAcceptanceBundle: 'devflow:acceptance-bundle:create',
    })
  })

  it.each([
    ['PR draft', parseCreatePrDraftInput],
    ['acceptance bundle', parseCreateAcceptanceBundleInput],
  ])('accepts a minimal %s command payload', (_label, parser) => {
    expect(
      parser({
        runId: 'run-1',
        nodeId: 'node-delivery',
      }),
    ).toEqual({ runId: 'run-1', nodeId: 'node-delivery' })
  })

  it.each([
    ['PR draft', parseCreatePrDraftInput],
    ['acceptance bundle', parseCreateAcceptanceBundleInput],
  ])('fails closed for renderer-supplied delivery data in %s commands', (_label, parser) => {
    for (const field of ['run', 'artifact', 'event', 'evidence', 'projectId']) {
      expect(() =>
        parser({
          runId: 'run-1',
          nodeId: 'node-delivery',
          [field]: { id: 'forged' },
        }),
      ).toThrow(new RegExp(field))
    }
  })

  it('accepts valid settings and MCP payloads', () => {
    expect(parseSettingsInput({ themePreference: 'dark' })).toEqual({ themePreference: 'dark' })
    expect(parseMcpServersInput([mcpServer])).toEqual([mcpServer])
  })

  it('rejects invalid settings and MCP payloads', () => {
    expect(() => parseSettingsInput({ themePreference: 'neon' })).toThrow(/themePreference/)
    expect(() => parseMcpServersInput([{ id: 'mcp-bad', name: 'Bad' }])).toThrow(/MCP/)
  })

  it('accepts remote snapshot payloads without exposing renderer-controlled upload channels', () => {
    expect(parseRemoteSnapshotInput({ organizationId: 'org-1' })).toEqual({
      organizationId: 'org-1',
    })
    expect(parseRemoteSnapshotInput(undefined)).toEqual({})
    expect(ipcChannels).not.toHaveProperty('uploadRunSummary')
    expect(ipcChannels).not.toHaveProperty('uploadTestEvidenceSummary')
    expect(ipcChannels).not.toHaveProperty('uploadCodingAgentSummary')
  })

  it('accepts provider credential and knowledge review payloads', () => {
    expect(
      parseAgentProviderCredentialInput({
        providerId: 'doubao-review',
        apiKey: 'sk-test-secret',
        model: 'ark-code-latest',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
      }),
    ).toEqual({
      providerId: 'doubao-review',
      apiKey: 'sk-test-secret',
      model: 'ark-code-latest',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
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

  it('requires a local project when pairing the desktop with a team project', () => {
    expect(parsePairDesktopInput({
      code: 'pair-id.copy-once-secret',
      localProjectId: 'local-project-1',
    })).toEqual({
      code: 'pair-id.copy-once-secret',
      localProjectId: 'local-project-1',
    })
    expect(() => parsePairDesktopInput({ code: ' ' })).toThrow(/code/)
    expect(() =>
      parsePairDesktopInput({ code: 'pair-id.copy-once-secret' }),
    ).toThrow(/localProjectId/)
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

    expect(parseDeleteRunInput({ runId: ' run-1 ', deleteRemote: true })).toEqual({
      runId: 'run-1',
      deleteRemote: true,
    })
    expect(() => parseDeleteRunInput({ runId: ' ' })).toThrow(/runId/)
    expect(() => parseDeleteRunInput({ runId: 'run-1', deleteRemote: 'yes' })).toThrow(/deleteRemote/)
  })
})
