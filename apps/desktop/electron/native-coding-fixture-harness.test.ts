// @vitest-environment node
import { readFile, rm, symlink } from 'node:fs/promises'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import type { NativeConversationRequest } from '@ai-devflow/shared'
import { codingHarnessFixture, codingToolReply } from './native-coding-test-fixture'
import { CodingCandidateWorkspace, codingDigest } from './coding-candidate-workspace'
import { CodingCommandRunner } from './coding-command-runner'
import { preflightIndependentChecks } from './native-coding-check-preflight'
import { freezeIndependentChecks } from './native-coding-independent-verification'
import * as dependencies from './coding-dependency-preparation'

it('rejects a projection-only delivery, then accepts the exact repaired runtime using the same frozen public controls', async () => {
  const oldCode = "export const allowed = (lane: string) => lane === 'live'\n"
  const newCode = "export const allowed = (lane: string) => ['live', 'stored'].includes(lane)\n"
  const suite = (module: string) =>
    `import { it, expect } from 'vitest'\nimport { allowed } from './${module}'\nimport { modes } from './fixtures'\nit('runs a live request', () => {\n  const lane = 'live'\n  const result = allowed(lane)\n  expect(result).toBe(true)\n})\n`
  const requests: NativeConversationRequest[] = []
  let codingTurn = 0,
    selectionCalls = 0,
    caseCalls = 0
  const author = async (req: NativeConversationRequest) => {
    requests.push(req)
    if (req.tools[0]!.function.name === 'select_behavior_contract') {
      selectionCalls++
      const scenarios = [{ units: ['r1.1'], anchor: 'f1:t1', precondition: 'Display accepts a live request' }]
      if (selectionCalls > 1)
        scenarios.push({ units: ['r1.2'], anchor: 'f2:t1', precondition: 'The service processes a live request' })
      return codingToolReply(`selection-${selectionCalls}`, 'select_behavior_contract', { scenarios, contextOnly: [] })
    }
    caseCalls++
    return codingToolReply('variations-' + caseCalls, 'submit_fixture_cases', {
      cases: ['s1', 's2'].map((scenario) => ({
        scenario,
        baseline: caseCalls === 1 ? 'pass' : 'fail',
        ...(caseCalls > 1 ? { contrast: { field: 'mode', control: 'live', requested: 'stored' } } : {}),
        edits: [
          ...(caseCalls === 1
            ? [{ line: 2, deleteCount: 1, insert: '  const lane = "live"' }]
            : [
                {
                  line: 2,
                  deleteCount: 2,
                  insert:
                    '  const lane = __devflowInput\n  const result = __devflowInvoke(allowed, [lane], actual => modes.find(row => row.mode === actual))',
                },
              ]),
        ],
      })),
    })
  }
  const fixture = await codingHarnessFixture(
    async (req) => {
      expect(JSON.stringify(req.messages)).not.toContain('Display accepts a live request')
      codingTurn++
      if (codingTurn === 1 || codingTurn === 3)
        return codingToolReply(`edit-${codingTurn}`, 'write_file', {
          path: codingTurn === 1 ? 'screen.ts' : 'service.ts',
          content: newCode,
          expectedHash: codingDigest(oldCode),
        })
      return codingToolReply(`submit-${codingTurn}`, 'propose_changeset', { summary: 'Review this revision' })
    },
    'node node_modules/vitest/vitest.mjs run screen.test.ts service.test.ts',
    {},
    author,
    {
      userInstruction: '界面允许 STORED 请求。实际服务允许 STORED 请求。',
      baselineFiles: {
        'package.json': '{"private":true,"type":"module","devDependencies":{"vitest":"3.2.6"}}',
        'pnpm-lock.yaml': 'lockfileVersion: 9.0\n',
        'vitest.config.mjs': "export default {test:{environment:'node',include:['*.test.ts']}}",
        'fixtures.ts': "export const modes = [{mode:'live'}, {mode:'stored'}]\n",
        'screen.ts': oldCode,
        'service.ts': oldCode,
        'screen.test.ts': suite('screen'),
        'service.test.ts': suite('service'),
      },
    },
  )
  const prepare = vi.spyOn(dependencies, 'prepareCodingDependencies').mockImplementation(async (input) => {
    try {
      await symlink(
        path.resolve('node_modules'),
        path.join(input.directory, 'node_modules'),
        process.platform === 'win32' ? 'junction' : 'dir',
      )
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
    }
    return { inputDigest: input.plan.inputDigest }
  })
  try {
    await fixture.authorize()
    await fixture.executor.settled('coding')
    expect(selectionCalls).toBe(3)
    expect(requests.map((r) => r.tools[0]!.function.name)).toEqual([
      'select_behavior_contract',
      'select_behavior_contract',
      'submit_fixture_cases',
      'select_behavior_contract',
      'submit_fixture_cases',
    ])
    const approve = async (id: string) => {
      const view = (await fixture.get()).snapshot
      const saved = (await fixture.store.getNativeCodingSession('native-coding'))!
      expect(
        view.status,
        JSON.stringify({
          reason: view.pauseReason,
          drafts: saved.independentVerification?.drafts?.map((draft) => draft.feedback),
          tools: saved.transcript
            .filter((m) => m.role === 'tool')
            .slice(0, 8)
            .map((m) => m.content?.slice(0, 260)),
        }),
      ).toBe('review')
      await fixture.executor.harness!.command(
        {
          protocolVersion: 2,
          type: 'approve',
          codingRunId: 'coding',
          commandId: id,
          expectedVersion: view.version,
          objectiveVersion: view.objectiveVersion,
          revisionDigest: view.revision!.digest,
          confirmedCriteria: [],
        },
        async () => {},
      )
      await fixture.executor.settled('coding')
    }
    await approve('first')
    let session = (await fixture.store.getNativeCodingSession('native-coding'))!
    expect(session.deliveryEvidence.at(-1)?.result?.independentVerification).toMatchObject({
      status: 'failed',
      failedCriteria: ['case-2'],
    })
    expect(await readFile(path.join(fixture.delivery, 'screen.ts'), 'utf8')).toBe(oldCode)
    await approve('repair')
    session = (await fixture.store.getNativeCodingSession('native-coding'))!
    expect(session.status).toBe('completed')
    expect(session.independentVerification?.plans).toHaveLength(1)
    expect(session.deliveryEvidence.at(-1)?.result?.independentVerification?.status).toBe('passed')
    expect(await readFile(path.join(fixture.delivery, 'service.ts'), 'utf8')).toBe(newCode)
    expect(await readFile(path.join(fixture.delivery, 'service.test.ts'), 'utf8')).toBe(suite('service'))

    const approved = session.independentVerification!.plans[0]!
    const altered = approved.checks.map((check, index) => ({
      ...check,
      body: index === 0 ? check.body.replace('[lane]', "['live']") : check.body + '\nexpect(false).toBe(true)',
    }))
    const plan = freezeIndependentChecks(approved, { checks: altered }, approved.createdAt, approved.coverage)
    const workspace = await CodingCandidateWorkspace.open(session.binding!.workspaceRoot)
    const runner = new CodingCommandRunner(path.join(fixture.root, 'control-replay'))
    try {
      const probe = await preflightIndependentChecks({
        plan,
        workspace,
        runner,
        profile: { kind: 'trusted_local' },
        operationId: 'control-replay',
        signal: new AbortController().signal,
      })
      expect(probe.status).toBe('invalid')
      expect(probe.feedback).toContain('"kind":"MismatchedInput"')
      expect(probe.feedback).toContain('"kind":"MatchedControlFailed"')
    } finally {
      await runner.cancelAll()
    }
  } finally {
    prepare.mockRestore()
    await fixture.executor.shutdown()
    await fixture.store.close()
    await rm(fixture.root, { recursive: true, force: true })
  }
}, 30000)
