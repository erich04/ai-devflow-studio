import { describe, expect, it } from 'vitest'
import type { McpServerDefinition } from '@ai-devflow/shared'
import {
  ipcChannels,
  parseApproveGateInput,
  parseAdvanceAgentRuntimeInput,
  parseCancelAgentRuntimeInput,
  parseAgentProviderCredentialInput,
  parseCancelCodingAgentRunInput,
  parseCreateAcceptanceBundleInput,
  parseCreatePrDraftInput,
  parsePrepareGitHubDeliveryInput,
  parseReviseGitHubDeliveryInput,
  parseRetryGitHubDeliveryInput,
  parseResumeGitHubDeliveryInput,
  parseStopGitHubDeliveryInput,
  parseStartAgentRuntimeInput,
  parseVerifyGitHubDeliveryRevocationInput,
  parseCreateRunInput,
  parseDeleteRunInput,
  parseCompleteWorkflowAgentNodeInput,
  parsePairDesktopInput,
  parseMcpServersInput,
  parseOpenManagedWorktreeInput,
  parseReplyCodingPermissionInput,
  parseLoadRepositoryKnowledgeInput,
  parseGetAgentRuntimeInput,
  parseGetCoordinationSessionInput,
  parseListAgentMemoryLifecycleInput,
  parseDeleteAgentMemoryInput,
  parsePromoteAgentMemoryCandidateInput,
  parseReviseAgentMemoryInput,
  parseListAgentRuntimesInput,
  parseListCoordinationSessionsInput,
  parseListWorkRequestsInput,
  parseMaterializeWorkRequestInput,
  parseRefreshRepositoryKnowledgeInput,
  parseRunCodingAgentInput,
  parseRunKnowledgeReviewInput,
  parseRemoteSnapshotInput,
  parseRetryRemoteSyncOperationInput,
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

  it('binds Agent Runtime commands to the selected project, Run, and exact checkpoint', () => {
    expect(parseStartAgentRuntimeInput({
      runId: 'run-1',
      nodeId: 'node-1',
      localProjectId: 'project-1',
    })).toEqual({
      runId: 'run-1',
      nodeId: 'node-1',
      localProjectId: 'project-1',
    })
    const command = {
      runtimeId: 'agent-runtime-1',
      runId: 'run-1',
      localProjectId: 'project-1',
      expectedVersion: 4,
      expectedCheckpointVersion: 4,
    }
    expect(parseAdvanceAgentRuntimeInput(command)).toEqual(command)
    expect(parseCancelAgentRuntimeInput(command)).toEqual(command)

    for (const incomplete of [
      { runtimeId: 'agent-runtime-1' },
      { ...command, runId: '' },
      { ...command, localProjectId: '' },
      { ...command, expectedVersion: 0 },
      { ...command, expectedCheckpointVersion: 1.5 },
    ]) {
      expect(() => parseAdvanceAgentRuntimeInput(incomplete)).toThrow()
      expect(() => parseCancelAgentRuntimeInput(incomplete)).toThrow()
    }

    for (const forbidden of [
      { path: '/tmp/repository' },
      { command: 'rm -rf build' },
      { capabilityId: 'shell.execute' },
      { checkpoint: { version: 99 } },
      { result: { outcome: 'success' } },
      { stopReason: 'success' },
      { contextDigest: 'a'.repeat(64) },
      { policyVersion: 99 },
    ]) {
      expect(() =>
        parseStartAgentRuntimeInput({
          runId: 'run-1',
          nodeId: 'node-1',
          localProjectId: 'project-1',
          ...forbidden,
        }),
      ).toThrow(/unexpected field/i)
      expect(() =>
        parseAdvanceAgentRuntimeInput({ ...command, ...forbidden }),
      ).toThrow(/unexpected field/i)
    }
  })

  it('binds Agent Runtime list and detail reads to one selected Run and local project', () => {
    expect(parseListAgentRuntimesInput({
      runId: 'run-1',
      localProjectId: 'project-1',
    })).toEqual({ runId: 'run-1', localProjectId: 'project-1' })
    expect(parseGetAgentRuntimeInput({
      runtimeId: 'agent-runtime-1',
      runId: 'run-1',
      localProjectId: 'project-1',
    })).toEqual({
      runtimeId: 'agent-runtime-1',
      runId: 'run-1',
      localProjectId: 'project-1',
    })

    for (const payload of [
      undefined,
      {},
      { runId: 'run-1' },
      { runId: 'run-1', localProjectId: 'project-1', source: 'raw' },
    ]) {
      expect(() => parseListAgentRuntimesInput(payload)).toThrow()
    }
    expect(() => parseGetAgentRuntimeInput({
      runtimeId: 'agent-runtime-1',
      runId: 'run-1',
      localProjectId: 'project-1',
      path: '/Users/example/repo',
    })).toThrow(/unexpected field/i)
  })

  it('binds Agent Coordination list and detail reads to one selected Run and local project', () => {
    expect(parseListCoordinationSessionsInput({
      runId: 'run-1',
      localProjectId: 'project-1',
    })).toEqual({ runId: 'run-1', localProjectId: 'project-1' })
    expect(parseGetCoordinationSessionInput({
      coordinationId: 'coordination-1',
      runId: 'run-1',
      localProjectId: 'project-1',
    })).toEqual({
      coordinationId: 'coordination-1',
      runId: 'run-1',
      localProjectId: 'project-1',
    })
    expect(() => parseListCoordinationSessionsInput({
      runId: 'run-1',
      localProjectId: 'project-1',
      scope: { sessionId: 'secret' },
    })).toThrow(/unexpected field/i)
    expect(() => parseGetCoordinationSessionInput({
      coordinationId: 'coordination-1',
      runId: 'run-1',
      localProjectId: 'project-1',
      summary: 'hidden reasoning',
    })).toThrow(/unexpected field/i)
  })

  it('keeps Agent Memory lifecycle reads bound to one exact Runtime selection', () => {
    expect(parseListAgentMemoryLifecycleInput({
      runtimeId: 'agent-runtime-1',
      runId: 'run-1',
      localProjectId: 'project-1',
    })).toEqual({
      runtimeId: 'agent-runtime-1',
      runId: 'run-1',
      localProjectId: 'project-1',
    })

    for (const payload of [
      undefined,
      {},
      { runtimeId: 'agent-runtime-1', runId: 'run-1', localProjectId: '' },
      { runtimeId: 'agent-runtime-1', localProjectId: 'project-1' },
      { runId: 'run-1', localProjectId: 'project-1' },
      { runtimeId: 'agent-runtime-1', runId: 'run-1', localProjectId: 'project-1', memoryId: 'memory-1' },
      { runtimeId: 'agent-runtime-1', runId: 'run-1', localProjectId: 'project-1', candidateId: 'candidate-1' },
      { runtimeId: 'agent-runtime-1', runId: 'run-1', localProjectId: 'project-1', sessionId: 'pairing-token' },
      { runtimeId: 'agent-runtime-1', runId: 'run-1', localProjectId: 'project-1', capability: {} },
      { runtimeId: 'agent-runtime-1', runId: 'run-1', localProjectId: 'project-1', statement: 'untrusted renderer text' },
    ]) {
      expect(() => parseListAgentMemoryLifecycleInput(payload)).toThrow()
    }
  })

  it('accepts only exact candidate identities for a human Memory promotion command', () => {
    const payload = {
      runtimeId: 'agent-runtime-1',
      runId: 'run-1',
      localProjectId: 'project-1',
      candidateId: 'memory-candidate-1',
      expectedContentDigest: 'a'.repeat(64),
      expectedProvenanceDigest: 'b'.repeat(64),
    }
    expect(parsePromoteAgentMemoryCandidateInput(payload)).toEqual(payload)

    for (const forbidden of [
      { memoryId: 'renderer-memory-1' },
      { decisionId: 'renderer-decision-1' },
      { actorId: 'spoofed-user' },
      { actorKind: 'policy' },
      { policyId: 'renderer-policy' },
      { policyVersion: 99 },
      { capability: {} },
      { authorityDigest: 'c'.repeat(64) },
      { statement: 'Renderer replacement text.' },
      { scope: { kind: 'local' } },
    ]) {
      expect(() => parsePromoteAgentMemoryCandidateInput({ ...payload, ...forbidden })).toThrow()
    }
    for (const malformed of [
      { ...payload, candidateId: '' },
      { ...payload, expectedContentDigest: 'A'.repeat(64) },
      { ...payload, expectedProvenanceDigest: 'b'.repeat(63) },
    ]) {
      expect(() => parsePromoteAgentMemoryCandidateInput(malformed)).toThrow()
    }
  })

  it('accepts only exact current versions and replacement text for a human Memory revision', () => {
    const payload = {
      runtimeId: 'agent-runtime-1',
      runId: 'run-1',
      localProjectId: 'project-1',
      memoryId: 'agent-memory-1',
      expectedRevision: 2,
      expectedHeadVersion: 3,
      expectedContentDigest: 'a'.repeat(64),
      expectedProvenanceDigest: 'b'.repeat(64),
      statement: 'Use the newly reviewed bounded retry policy.',
    }
    expect(parseReviseAgentMemoryInput(payload)).toEqual(payload)

    for (const forbidden of [
      { decisionId: 'renderer-decision-1' },
      { actorId: 'spoofed-user' },
      { actorKind: 'policy' },
      { policyId: 'renderer-policy' },
      { policyVersion: 99 },
      { visibility: 'project_shared' },
      { sensitivity: 'internal' },
      { retentionClass: 'session' },
      { expiresAt: '2026-08-13T13:00:00.000Z' },
      { capability: {} },
      { authorityDigest: 'c'.repeat(64) },
      { scope: { kind: 'local' } },
    ]) {
      expect(() => parseReviseAgentMemoryInput({ ...payload, ...forbidden })).toThrow()
    }
    for (const malformed of [
      { ...payload, memoryId: '' },
      { ...payload, expectedRevision: 0 },
      { ...payload, expectedHeadVersion: 1.5 },
      { ...payload, expectedContentDigest: 'A'.repeat(64) },
      { ...payload, expectedProvenanceDigest: 'b'.repeat(63) },
      { ...payload, statement: '' },
      { ...payload, statement: ' padded ' },
      { ...payload, statement: 'x'.repeat(8_193) },
    ]) {
      expect(() => parseReviseAgentMemoryInput(malformed)).toThrow()
    }
  })

  it('accepts only exact current versions and digests for a human Memory deletion', () => {
    const payload = {
      runtimeId: 'agent-runtime-1',
      runId: 'run-1',
      localProjectId: 'project-1',
      memoryId: 'agent-memory-1',
      expectedRevision: 2,
      expectedHeadVersion: 3,
      expectedContentDigest: 'a'.repeat(64),
      expectedProvenanceDigest: 'b'.repeat(64),
    }
    expect(parseDeleteAgentMemoryInput(payload)).toEqual(payload)

    for (const forbidden of [
      { decisionId: 'renderer-decision-1' },
      { actorId: 'spoofed-user' },
      { actorKind: 'policy' },
      { policyId: 'renderer-policy' },
      { policyVersion: 99 },
      { capability: {} },
      { authorityDigest: 'c'.repeat(64) },
      { purgedAt: '2026-08-13T13:00:00.000Z' },
      { scope: { kind: 'local' } },
    ]) {
      expect(() => parseDeleteAgentMemoryInput({ ...payload, ...forbidden })).toThrow()
    }
    for (const malformed of [
      { ...payload, memoryId: '' },
      { ...payload, expectedRevision: 0 },
      { ...payload, expectedHeadVersion: 1.5 },
      { ...payload, expectedContentDigest: 'A'.repeat(64) },
      { ...payload, expectedProvenanceDigest: 'b'.repeat(63) },
    ]) {
      expect(() => parseDeleteAgentMemoryInput(malformed)).toThrow()
    }
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
      prepareGitHubDelivery: 'devflow:github-delivery:prepare',
      reviseGitHubDelivery: 'devflow:github-delivery:revise',
      retryGitHubDelivery: 'devflow:github-delivery:retry',
      resumeGitHubDelivery: 'devflow:github-delivery:resume',
      stopGitHubDelivery: 'devflow:github-delivery:stop',
      createAcceptanceBundle: 'devflow:acceptance-bundle:create',
    })
  })

  it('keeps GitHub Delivery recovery bound to an exact local Intent version', () => {
    const input = {
      intentId: 'github-delivery-intent-1',
      expectedUpdatedAt: '2026-08-11T12:34:56.000Z',
    }

    expect(parseResumeGitHubDeliveryInput(input)).toEqual(input)
    expect(() =>
      parseResumeGitHubDeliveryInput({
        ...input,
        token: 'renderer-must-never-send-a-token',
      }),
    ).toThrow(/unexpected field/i)
    expect(() =>
      parseResumeGitHubDeliveryInput({
        ...input,
        expectedUpdatedAt: 'yesterday',
      }),
    ).toThrow(/expectedUpdatedAt/i)
  })

  it('accepts only an exact local Intent CAS for a credential revocation proof', () => {
    const input = {
      intentId: 'github-delivery-intent-1',
      expectedUpdatedAt: '2026-08-11T12:34:56.000Z',
    }

    expect(parseVerifyGitHubDeliveryRevocationInput(input)).toEqual(input)
    expect(ipcChannels.verifyGitHubDeliveryRevocation).toBe(
      'devflow:github-delivery:revocation:verify',
    )
    for (const derived of [
      { requestId: 'renderer-request' },
      { repository: 'example/project' },
      { expectedStateVersion: 8 },
      { token: 'renderer-token' },
      { path: '/private/worktree' },
    ]) {
      expect(() =>
        parseVerifyGitHubDeliveryRevocationInput({ ...input, ...derived }),
      ).toThrow(/unexpected field/i)
    }
  })

  it.each([
    ['revision', parseReviseGitHubDeliveryInput],
    ['retry', parseRetryGitHubDeliveryInput],
  ])('accepts only an exact local Intent CAS for GitHub Delivery %s', (_label, parser) => {
    const input = {
      intentId: 'github-delivery-intent-1',
      expectedUpdatedAt: '2026-08-11T12:34:56.000Z',
    }
    expect(parser(input)).toEqual(input)
    for (const derived of [
      { runId: 'renderer-run' },
      { nodeId: 'renderer-node' },
      { deliveryAttempt: 999 },
      { deliverySeriesKey: 'renderer-series' },
      { path: '/private/worktree' },
      { token: 'renderer-token' },
    ]) {
      expect(() => parser({ ...input, ...derived })).toThrow(/unexpected field/i)
    }
  })

  it('accepts only an exact local Intent CAS for GitHub Delivery Stop', () => {
    const input = {
      intentId: 'github-delivery-intent-1',
      expectedUpdatedAt: '2026-08-11T12:34:56.000Z',
    }

    expect(parseStopGitHubDeliveryInput(input)).toEqual(input)
    expect(() => parseStopGitHubDeliveryInput({
      ...input,
      token: 'renderer-must-never-send-a-token',
    })).toThrow(/unexpected field/i)
    expect(() => parseStopGitHubDeliveryInput({
      ...input,
      expectedUpdatedAt: 'yesterday',
    })).toThrow(/expectedUpdatedAt/i)
    expect(() => parseStopGitHubDeliveryInput({
      ...input,
      expectedUpdatedAt: ` ${input.expectedUpdatedAt}`,
    })).toThrow(/expectedUpdatedAt/i)
    expect(() => parseStopGitHubDeliveryInput({
      ...input,
      intentId: '/Users/alice/private-intent',
    })).toThrow(/intentId/i)
  })

  it.each([
    ['PR draft', parseCreatePrDraftInput],
    ['GitHub delivery preparation', parsePrepareGitHubDeliveryInput],
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
    ['GitHub delivery preparation', parsePrepareGitHubDeliveryInput],
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

  it('accepts an identifier-only remote sync retry command', () => {
    expect(parseRetryRemoteSyncOperationInput({ operationId: ' operation-1 ' })).toEqual({
      operationId: 'operation-1',
    })
  })

  it('accepts an identifier-only repository knowledge load command', () => {
    expect(parseLoadRepositoryKnowledgeInput({ projectId: ' project-1 ' })).toEqual({
      projectId: 'project-1',
    })
  })

  it.each(['path', 'root', 'cwd', 'project', 'markdown'])(
    'rejects renderer-supplied %s in repository knowledge load commands',
    (field) => {
      expect(() =>
        parseLoadRepositoryKnowledgeInput({
          projectId: 'project-1',
          [field]: field === 'project' ? { path: '/private/repo' } : 'private content',
        }),
      ).toThrow(new RegExp(field))
    },
  )

  it('accepts an identifier-only repository knowledge refresh command', () => {
    expect(parseRefreshRepositoryKnowledgeInput({ projectId: ' project-1 ' })).toEqual({
      projectId: 'project-1',
    })
  })

  it.each(['path', 'root', 'cwd', 'project', 'markdown'])(
    'rejects renderer-supplied %s in repository knowledge refresh commands',
    (field) => {
      expect(() =>
        parseRefreshRepositoryKnowledgeInput({
          projectId: 'project-1',
          [field]: field === 'project' ? { path: '/private/repo' } : 'private content',
        }),
      ).toThrow(new RegExp(field))
    },
  )

  it.each([
    ['load', parseLoadRepositoryKnowledgeInput],
    ['refresh', parseRefreshRepositoryKnowledgeInput],
  ])('rejects an empty projectId in repository knowledge %s commands', (_label, parser) => {
    expect(() => parser({ projectId: ' ' })).toThrow(/projectId/)
  })

  it('exposes identifier-only repository knowledge channels without raw repository writers', () => {
    expect(ipcChannels).toMatchObject({
      loadRepositoryKnowledge: 'devflow:repository-knowledge:load',
      refreshRepositoryKnowledge: 'devflow:repository-knowledge:refresh',
    })
    expect(ipcChannels).not.toHaveProperty('indexRepositoryPath')
    expect(ipcChannels).not.toHaveProperty('uploadRepositoryKnowledge')
    expect(ipcChannels).not.toHaveProperty('writeRepositoryKnowledge')
  })

  it.each(['payload', 'scope', 'body', 'token'])(
    'rejects renderer-supplied %s data in remote sync retry commands',
    (field) => {
      expect(() =>
        parseRetryRemoteSyncOperationInput({
          operationId: 'operation-1',
          [field]: { forged: true },
        }),
      ).toThrow(new RegExp(field))
    },
  )

  it('exposes only an operator retry channel for renderer-initiated remote sync writes', () => {
    expect(ipcChannels).toMatchObject({
      retryRemoteSyncOperation: 'devflow:remote-sync:operation:retry',
    })
    expect(ipcChannels).not.toHaveProperty('enqueueRemoteSyncOperation')
    expect(ipcChannels).not.toHaveProperty('uploadRunSummary')
  })

  it('defines a dedicated main-to-renderer local state update channel', () => {
    expect(ipcChannels.localStateUpdated).toBe('devflow:local-state:updated')
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

    expect(
      parseRunKnowledgeReviewInput({
        runId: 'run-1',
        nodeId: 'node-test',
        projectId: 'project-1',
        requestedBy: 'u-ling',
        runtime: 'electron',
        providerId: 'team-openai',
        runtimeBudgetApprovalId: ' approval-knowledge-1 ',
      }),
    ).toEqual({
      runId: 'run-1',
      nodeId: 'node-test',
      projectId: 'project-1',
      requestedBy: 'u-ling',
      runtime: 'electron',
      providerId: 'team-openai',
      runtimeBudgetApprovalId: 'approval-knowledge-1',
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

  it('keeps Work Request list and materialization commands identifier-only', () => {
    expect(
      parseListWorkRequestsInput({ localProjectId: 'local-project-1' }),
    ).toEqual({ localProjectId: 'local-project-1' })
    expect(
      parseMaterializeWorkRequestInput({
        localProjectId: 'local-project-1',
        workRequestId: 'work-request-1',
        expectedVersion: 2,
      }),
    ).toEqual({
      localProjectId: 'local-project-1',
      workRequestId: 'work-request-1',
      expectedVersion: 2,
    })

    expect(() =>
      parseListWorkRequestsInput({
        localProjectId: 'local-project-1',
        projectId: 'renderer-team-project',
      }),
    ).toThrow(/unexpected field/i)
  })

  it.each([
    ['runId', 'renderer-run'],
    ['projectId', 'renderer-team-project'],
    ['teamProjectId', 'renderer-team-project'],
    ['organizationId', 'renderer-organization'],
    ['title', 'Renderer title'],
    ['request', 'Renderer request'],
    ['creatorId', 'renderer-user'],
    ['branchName', 'renderer/branch'],
    ['idempotencyKey', 'renderer-idempotency'],
    ['pairing', { tokenId: 'renderer-token-record' }],
    ['token', 'renderer-bearer-secret'],
    ['authToken', 'renderer-bearer-secret'],
  ])('rejects renderer-supplied Work Request authority field %s', (field, value) => {
    expect(() =>
      parseMaterializeWorkRequestInput({
        localProjectId: 'local-project-1',
        workRequestId: 'work-request-1',
        expectedVersion: 2,
        [field]: value,
      }),
    ).toThrow(/unexpected field/i)
  })

  it('requires exact Work Request identifiers and a positive int4 version', () => {
    for (const input of [
      { localProjectId: ' local-project-1 ' },
      { localProjectId: '' },
      { localProjectId: '   ' },
      { localProjectId: 'x'.repeat(201) },
    ]) {
      expect(() => parseListWorkRequestsInput(input)).toThrow(/localProjectId/)
    }

    for (const expectedVersion of [0, -1, 1.5, 2_147_483_648, Number.NaN, Infinity, '1']) {
      expect(() =>
        parseMaterializeWorkRequestInput({
          localProjectId: 'local-project-1',
          workRequestId: 'work-request-1',
          expectedVersion,
        }),
      ).toThrow(/expectedVersion/)
    }

    expect(() =>
      parseMaterializeWorkRequestInput({
        localProjectId: 'local-project-1',
        workRequestId: 'x'.repeat(201),
        expectedVersion: 1,
      }),
    ).toThrow(/workRequestId/)
    expect(() =>
      parseMaterializeWorkRequestInput({
        localProjectId: 'local-project-1',
        workRequestId: ' work-request-1 ',
        expectedVersion: 1,
      }),
    ).toThrow(/workRequestId/)
  })

  it('exposes only narrow Work Request list and materialize channels', () => {
    expect(ipcChannels).toMatchObject({
      listWorkRequests: 'devflow:work-requests:list',
      materializeWorkRequest: 'devflow:work-requests:materialize',
    })
    expect(ipcChannels).not.toHaveProperty('claimWorkRequest')
    expect(ipcChannels).not.toHaveProperty('createWorkRequest')
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
