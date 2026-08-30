import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import initSqlJs from 'sql.js'
import {
  createAgentRuntime,
  createWorkflowRunFromRequest,
  recordAgentPermissionDecision,
  requestAgentAction,
  resumeAgentRuntime,
} from '@ai-devflow/shared'
import { createLocalStore, type AgentRuntimeCapabilityGrant } from './local-store.js'
import {
  createNativeToolRegistry,
  digestNativeToolValue,
  type NativeToolAuditRecord,
} from './native-tool-registry.js'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function dbPath(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'devflow-native-tool-store-'))
  directories.push(directory)
  return path.join(directory, 'devflow.sqlite')
}

function startAudit(grant: AgentRuntimeCapabilityGrant): NativeToolAuditRecord {
  return {
    stateVersion: 1,
    id: 'native-tool-audit-start-1',
    runtimeId: grant.runtimeId,
    actionId: 'action-1',
    grantId: grant.id,
    organizationId: null,
    projectId: null,
    userId: 'user-1',
    sessionId: 'session-1',
    localProjectId: 'local-project-1',
    toolId: grant.capabilityId,
    toolVersion: grant.capabilityVersion,
    source: 'native',
    installationId: null,
    installationVersion: null,
    permissionClass: grant.permissionClass,
    sideEffectClass: 'none',
    resourceKind: grant.resourceKind,
    resourceId: grant.resourceId,
    status: 'started',
    code: null,
    inputDigest: grant.requestDigest,
    resultDigest: null,
    resultBytes: null,
    redactionState: 'not_recorded',
    createdAt: '2026-08-12T20:30:03.000Z',
  }
}

describe('Native Tool durable local audit', () => {
  it('atomically consumes one capability and persists bounded audit across restart', async () => {
    const storePath = await dbPath()
    const store = await createLocalStore({ dbPath: storePath })
    expect(await store.getSchemaVersion()).toBe(34)

    const project = {
      id: 'local-project-1',
      name: 'native-tool-fixture',
      path: '/tmp/native-tool-fixture',
      packageManager: 'npm' as const,
      testCommand: 'npm test',
      createdAt: '2026-08-12T20:00:00.000Z',
      updatedAt: '2026-08-12T20:00:00.000Z',
    }
    const workflow = createWorkflowRunFromRequest({
      runId: 'run-1',
      title: 'Exercise one durable Native Tool audit',
      request: 'Execute one bounded local Tool.',
      projectId: project.id,
      creatorId: 'user-1',
      branchName: 'devflow/native-tool-audit',
      now: '2026-08-12T20:00:00.000Z',
    })
    await store.upsertProject(project)
    await store.saveRun(workflow.run)

    const requestDigest = digestNativeToolValue({ message: 'hello' })
    const created = createAgentRuntime({
      stateVersion: 1,
      id: 'agent-runtime-1',
      scope: {
        kind: 'local',
        organizationId: null,
        projectId: null,
        userId: 'user-1',
        sessionId: 'session-1',
        localProjectId: 'local-project-1',
      },
      authority: {
        runId: workflow.run.id,
        nodeId: workflow.run.currentNodeId,
        runVersion: workflow.run.version,
        policyVersion: 1,
      },
      contextDigest: 'a'.repeat(64),
      capabilitySetDigest: 'b'.repeat(64),
      bounds: {
        maxSteps: 2,
        maxWallTimeMs: 60_000,
        maxToolCalls: 2,
        maxToolResultBytes: 1_024,
        maxTrajectoryMetadataBytes: 4_096,
        maxCheckpointBytes: 16_384,
        maxTokens: 1_000,
        maxCostUsd: 1,
      },
      requestedAt: '2026-08-12T20:30:00.000Z',
      deadline: '2026-08-12T20:31:00.000Z',
    })
    await store.commitAgentRuntimeTransition({ expectedRuntime: null, transition: created })
    const resumed = resumeAgentRuntime({
      runtime: created.runtime,
      expectedCheckpointVersion: created.checkpoint.version,
      authority: created.runtime.authority,
      contextDigest: created.runtime.contextDigest,
      capabilitySetDigest: created.runtime.capabilitySetDigest,
      now: '2026-08-12T20:30:01.000Z',
    })
    await store.commitAgentRuntimeTransition({ expectedRuntime: created.runtime, transition: resumed })
    const requested = requestAgentAction({
      runtime: resumed.runtime,
      expectedCheckpointVersion: resumed.checkpoint.version,
      action: {
        id: 'action-1',
        kind: 'tool',
        capabilityId: 'runtime.echo',
        capabilityVersion: 1,
        requestDigest,
        requiresPermission: true,
      },
      now: '2026-08-12T20:30:02.000Z',
    })
    await store.commitAgentRuntimeTransition({ expectedRuntime: resumed.runtime, transition: requested })
    const approved = recordAgentPermissionDecision({
      runtime: requested.runtime,
      expectedCheckpointVersion: requested.checkpoint.version,
      actionId: 'action-1',
      requestDigest,
      decision: 'approved_once',
      now: '2026-08-12T20:30:02.000Z',
    })
    await store.commitAgentRuntimeTransition({ expectedRuntime: requested.runtime, transition: approved })

    const grantRecord: AgentRuntimeCapabilityGrant = {
      stateVersion: 1,
      id: 'native-tool-grant-1',
      runtimeId: approved.runtime.id,
      capabilityId: 'runtime.echo',
      capabilityVersion: 1,
      requestDigest,
      permissionClass: 'read',
      resourceKind: 'local_project',
      resourceId: project.id,
      status: 'active',
      grantedAt: '2026-08-12T20:30:03.000Z',
      expiresAt: '2026-08-12T20:30:30.000Z',
      settledAt: null,
    }
    const ids = [
      grantRecord.id,
      'native-tool-audit-start-1',
      'native-tool-audit-success-1',
    ]
    const handler = async ({ input }: { input: unknown }) => ({
      echoed: (input as { message: string }).message,
    })
    const registry = createNativeToolRegistry({
      tools: [
        {
          definition: {
            stateVersion: 1,
            id: 'runtime.echo',
            version: 1,
            source: 'native',
            description: 'Return one bounded test value.',
            permissionClass: 'read',
            sideEffectClass: 'none',
            defaultDeadlineMs: 5_000,
            maxResultBytes: 1_024,
            idempotency: 'idempotent',
            auditPolicy: 'redacted_metadata_only',
            inputSchema: {
              type: 'object',
              additionalProperties: false,
              required: ['message'],
              properties: { message: { type: 'string', maxLength: 100 } },
            },
            outputSchema: {
              type: 'object',
              additionalProperties: false,
              required: ['echoed'],
              properties: { echoed: { type: 'string', maxLength: 100 } },
            },
          },
          handler,
        },
      ],
      clock: () => '2026-08-12T20:30:03.000Z',
      createId: () => {
        const id = ids.shift()
        if (!id) throw new Error('unexpected_native_tool_id')
        return id
      },
      persistence: {
        reserveGrant: async (grant) => {
          const result = await store.reserveAgentRuntimeCapabilityGrant(grant)
          return { reserved: result.reserved }
        },
        beginExecution: async (input) => {
          const result = await store.beginAgentRuntimeToolExecution(input)
          return { consumed: result.consumed }
        },
        appendAudit: (audit) => store.appendAgentRuntimeToolAudit(audit),
      },
    })
    const grant = await registry.issueGrant({
      runtime: approved.runtime,
      toolId: 'runtime.echo',
      toolVersion: 1,
      permission: {
        decision: 'approved',
        permissionClass: 'read',
        decidedAt: '2026-08-12T20:30:02.000Z',
        expiresAt: grantRecord.expiresAt,
      },
      resourceScope: { kind: 'local_project', localProjectId: project.id },
      callLimit: 1,
    })
    const tamperedGrant = { ...grantRecord, permissionClass: 'execute' as const }
    await expect(
      store.beginAgentRuntimeToolExecution({
        expectedGrant: tamperedGrant,
        audit: {
          ...startAudit(tamperedGrant),
          id: 'native-tool-audit-tampered-scope-1',
        },
      }),
    ).resolves.toEqual({ consumed: false, reason: 'grant_stale' })
    await expect(
      registry.execute({
        grant,
        runtime: approved.runtime,
        actionId: 'action-1',
        input: { message: 'hello' },
      }),
    ).resolves.toEqual({
      value: { echoed: 'hello' },
      resultDigest: digestNativeToolValue({ echoed: 'hello' }),
      resultBytes: 18,
    })
    const started = startAudit(grantRecord)
    const succeeded: NativeToolAuditRecord = {
      ...started,
      id: 'native-tool-audit-success-1',
      status: 'succeeded',
      resultDigest: digestNativeToolValue({ echoed: 'hello' }),
      resultBytes: 18,
      redactionState: 'passed',
      createdAt: '2026-08-12T20:30:03.000Z',
    }
    expect(await store.listAgentRuntimeToolAudits(grantRecord.runtimeId)).toEqual([
      started,
      succeeded,
    ])
    store.close()

    const reopened = await createLocalStore({ dbPath: storePath })
    expect(await reopened.listAgentRuntimeToolAudits(grantRecord.runtimeId)).toEqual([
      started,
      succeeded,
    ])
    expect(await reopened.listAgentRuntimeCapabilityGrants(grantRecord.runtimeId)).toEqual([
      { ...grantRecord, status: 'consumed', settledAt: started.createdAt },
    ])
    reopened.close()

    const SQL = await initSqlJs()
    const database = new SQL.Database(await readFile(storePath))
    expect(
      database.exec('pragma table_info(agent_runtime_tool_audits)')[0]?.values.map(
        (row) => String(row[1]),
      ),
    ).toEqual(expect.arrayContaining(['source', 'installation_id', 'installation_version']))
    expect(
      database.exec(
        'select source, installation_id, installation_version from agent_runtime_tool_audits order by created_at, id',
      )[0]?.values,
    ).toEqual([
      ['native', null, null],
      ['native', null, null],
    ])
    database.close()
  })

  it('rejects audit tamper and rolls back grant consumption with the audit insert', async () => {
    const storePath = await dbPath()
    const store = await createLocalStore({ dbPath: storePath })
    const invalidAudit = {
      ...startAudit({
        stateVersion: 1,
        id: 'native-tool-grant-missing',
        runtimeId: 'runtime-missing',
        capabilityId: 'runtime.echo',
        capabilityVersion: 1,
        requestDigest: 'a'.repeat(64),
        permissionClass: 'read',
        resourceKind: 'local_project',
        resourceId: 'local-project-1',
        status: 'active',
        grantedAt: '2026-08-12T20:30:02.000Z',
        expiresAt: '2026-08-12T20:30:30.000Z',
        settledAt: null,
      }),
      rawOutput: 'must-never-persist',
    }
    await expect(store.appendAgentRuntimeToolAudit(invalidAudit as never)).rejects.toThrow(
      'invalid_native_tool_audit',
    )
    expect(await store.listAgentRuntimeToolAudits()).toEqual([])
    store.close()
  })
})
