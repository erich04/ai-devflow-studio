import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateDescriptor, assertProcessEvidence } from './devflow-b-resume-desktop.mjs'

const repository = '/isolated/worktree'
const output = `${repository}/.tmp/devflow-b-20261023/opencode-123`
const ready = { scenario: 'opencode', output, schema: 'b_live_123', profile: `${output}/profile`, repo: `${output}/todo`, gatewayConfig: `${output}/gateway.json`,
  apiUrl: 'http://127.0.0.1:61341', webUrl: 'http://127.0.0.1:61342', cdpUrl: 'http://127.0.0.1:61343', runId: 'run-original', projectId: 'project-original' }
const evidence = { ready, pid: 4242, cdpPid: 4242, owners: [4242], executable: '/bundled/Electron', expectedExecutable: '/bundled/Electron',
  command: '/bundled/Electron /isolated/bootstrap.cjs --remote-debugging-port=61343', bootstrapPath: '/isolated/bootstrap.cjs',
  environment: { DEVFLOW_B_HARNESS: '1', DEVFLOW_USER_DATA_DIR: ready.profile, DEVFLOW_B_GATEWAY_CONFIG: ready.gatewayConfig,
    DEVFLOW_DATA_PROFILE_REGISTRY_PATH: `${output}/profiles.json`, DEVFLOW_API_BASE_URL: ready.apiUrl } }

test('accepts the exact isolated descriptor and independently matching process evidence', () => {
  assert.equal(validateDescriptor(ready, `${output}/ready.json`, repository).runId, ready.runId)
  assert.doesNotThrow(() => assertProcessEvidence(evidence))
})
for (const [name, change] of Object.entries({ foreignProfile: { profile: '/Users/someone/Library/Application Support/DevFlow' },
  siblingScenario: { scenario: 'no-opencode' }, sharedSchema: { schema: 'public' }, externalApi: { apiUrl: 'https://team.example' },
  sharedPort: { cdpUrl: ready.apiUrl }, gatewayElsewhere: { gatewayConfig: '/somewhere/gateway.json' }, pathEscape: { output: `${output}/../opencode-999` } })) {
  test(`refuses descriptor ${name} before process inspection`, () => assert.throws(() => validateDescriptor({ ...ready, ...change }, `${output}/ready.json`, repository)))
}
for (const [name, change] of Object.entries({ wrongPid: { pid: 4243 }, anotherListener: { owners: [4242, 4243] },
  wrongBinary: { executable: '/Applications/User.app/Electron' }, parentController: { command: 'node scripts/devflow-b-resume.mjs' },
  wrongPort: { command: '/bundled/Electron /isolated/bootstrap.cjs --remote-debugging-port=65175' },
  foreignProfile: { environment: { ...evidence.environment, DEVFLOW_USER_DATA_DIR: '/foreign/profile' } },
  foreignGateway: { environment: { ...evidence.environment, DEVFLOW_B_GATEWAY_CONFIG: '/foreign/gateway.json' } },
  ordinaryElectron: { environment: { ...evidence.environment, DEVFLOW_B_HARNESS: '0' } } })) {
  test(`refuses process ${name} before SIGTERM`, () => assert.throws(() => assertProcessEvidence({ ...evidence, ...change })))
}

const { parseArguments, assertRestartBefore, assertRestartAfter } = await import('./devflow-b-resume-desktop.mjs')
const snapshot = { pid: 4242, runId: 'workflow', currentNodeId: 'design', node: { kind: 'gate', stage: 'design', status: 'running' },
  materialDigest: 'materials', preservedStateDigest: 'original', codingRuns: [], workspaces: [], inFlightRequestIds: [], otherActiveCodingIds: [], terminalReceipts: {}, providerCalls: [] }
const waiting = { ...snapshot, currentNodeId: 'build', node: { kind: 'task', stage: 'build', status: 'running' },
  codingRuns: [{ id: 'coding', nodeId: 'build', engine: 'opencode-http', status: 'waiting_input', managedWorkspaceId: 'workspace',
    question: { id: 'question', codingRunId: 'coding', managedWorkspaceId: 'workspace', status: 'pending' } }],
  workspaces: [{ id: 'workspace', codingRunId: 'coding', worktreePath: '/isolated/profile/coding-worktrees/run' }] }
const failed = { ...waiting, codingRuns: [{ ...waiting.codingRuns[0], status: 'failed', question: { ...waiting.codingRuns[0].question, status: 'invalidated', settledAt: 'now' } }] }

test('requires an exact opt-in Coding Run ID and exact PID for interruption', () => {
  assert.deepEqual(parseArguments(['/ready.json','--restart','--pid','4242','--interrupt-coding','coding']), { readyFile: '/ready.json', mode: '--restart', pid: 4242, interruptCodingRunId: 'coding' })
  assert.throws(() => parseArguments(['/ready.json','--restart','--interrupt-coding','coding']))
  assert.throws(() => parseArguments(['/ready.json','--restart','--pid','4242','--interrupt-coding','coding','--interrupt-coding','other']))
  assert.throws(() => assertRestartBefore(waiting))
  assert.throws(() => assertRestartBefore(waiting, 'another-coding'))
  assert.equal(assertRestartBefore(waiting, 'coding'), 'interrupt-question')
})
test('preserves the default Gate contract and allows only quiescent failed builds', () => {
  assert.equal(assertRestartBefore(snapshot), 'design-gate-update')
  assert.equal(assertRestartBefore(failed), 'failed-build-update')
  assert.throws(() => assertRestartBefore({ ...failed, inFlightRequestIds: ['still-running'] }))
  assert.throws(() => assertRestartBefore({ ...failed, otherActiveCodingIds: ['another-workflow'] }))
  assertRestartAfter(snapshot, { ...snapshot, pid: 9000 })
  assertRestartAfter(failed, { ...failed, pid: 9000 })
  assert.throws(() => assertRestartAfter(failed, { ...failed, preservedStateDigest: 'changed' }))
})
test('will not interrupt a settled or foreign pending question', () => {
  for (const question of [{ ...waiting.codingRuns[0].question, status: 'answered' }, { ...waiting.codingRuns[0].question, codingRunId: 'foreign' }]) {
    assert.throws(() => assertRestartBefore({ ...waiting, codingRuns: [{ ...waiting.codingRuns[0], question }] }, 'coding'))
  }
})
test('requires termination, question invalidation, unchanged materials and retained workspace', () => {
  assertRestartAfter(waiting, failed, 'coding')
  assert.throws(() => assertRestartAfter(waiting, waiting, 'coding'))
  assert.throws(() => assertRestartAfter(waiting, { ...failed, codingRuns: [{ ...failed.codingRuns[0], question: waiting.codingRuns[0].question }] }, 'coding'))
  assert.throws(() => assertRestartAfter(waiting, { ...failed, materialDigest: 'changed' }, 'coding'))
  assert.throws(() => assertRestartAfter(waiting, { ...failed, workspaces: [] }, 'coding'))
})
test('preserves partial usage through interrupted-call settlement without a duplicate expense', () => {
  const call = { requestId: 'relay-one', codingRunId: 'coding', status: 'failed', billingState: 'unknown', usage: { inputTokens: 100, outputTokens: 20, usageCompleteness: 'partial', budgetAttemptIds: ['budget-one'] } }
  const summary = { inputTokens: 100, outputTokens: 20, costStatus: 'unknown', costUsd: null, providerCallIds: ['relay-one'], budgetAttemptIds: ['budget-one'] }
  const before = { ...waiting, inFlightRequestIds: ['relay-one'], providerCalls: [{ ...call, status: 'started' }] }
  const after = { ...failed, providerCalls: [call], codingRuns: [{ ...failed.codingRuns[0], runtimeCostSummary: summary }] }
  assertRestartAfter(before, after, 'coding')
  for (const changed of [{ ...summary, inputTokens: 200 }, { ...summary, providerCallIds: ['relay-one', 'relay-one'] }, { ...summary, budgetAttemptIds: [] }]) {
    assert.throws(() => assertRestartAfter(before, { ...after, codingRuns: [{ ...failed.codingRuns[0], runtimeCostSummary: changed }] }, 'coding'))
  }
  assert.throws(() => assertRestartAfter({ ...before, terminalReceipts: { previous: 'unchanged' } }, after, 'coding'))
  assert.throws(() => assertRestartAfter(before, { ...after, providerCalls: [...after.providerCalls, { ...call, requestId: 'replayed' }] }, 'coding'))
  assert.throws(() => assertRestartAfter(before, { ...after, codingRuns: [...after.codingRuns, { ...failed.codingRuns[0], id: 'new-run' }] }, 'coding'))
})
