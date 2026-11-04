// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { codingDigest } from './coding-candidate-workspace'
import { fixtureTemplate, FixtureCaseCorrection } from './native-coding-fixture-cases'
import {
  fixtureChecksFromResponse,
  validateFrozenIndependentChecks,
  validateIndependentVerification,
} from './native-coding-independent-verification'
import { classifyIndependentPreflight } from './native-coding-check-preflight'
import type { AcceptancePlanning } from './native-coding-fixture-planning'
import { codingHarnessFixture, codingToolReply } from './native-coding-test-fixture'

it('retains a valid private variation while correcting its sibling and freezes only the complete sourced plan', () => {
  const fixture = fixtureTemplate(
    'example.test.ts',
    "import {it,expect} from 'vitest'\nit('happy',()=>{\nconst value=1\nexpect(value).toBe(1)\n})",
  )
  const source = {
    objectiveVersion: 1,
    baselineDigest: 'b'.repeat(64),
    sourceDigest: 'c'.repeat(64),
    adapter: { kind: 'vitest' as const, directory: '.' },
    criteria: [{ id: 'objective', sourceRef: 'approved', text: 'First change. Second change.' }],
  }
  const selection = {
    scenarios: ['r1.1', 'r1.2'].map((unit) => ({
      units: [unit],
      fixture: 'f1',
      anchor: 't1',
      precondition: 'Valid control',
    })),
    contextOnly: [],
  }
  const p: AcceptancePlanning = {
    source,
    fixtures: [fixture],
    selection,
    phase: 'cases',
    request: { systemPrompt: '', messages: [], tools: [] },
  }
  const first = { scenario: 's1', baseline: 'fail', edits: [{ line: 2, deleteCount: 1, insert: 'const value=2' }] }
  const bad = { scenario: 's2', baseline: 'fail', edits: [{ line: 3, deleteCount: 1, insert: 'expect(true).toBe(true)' }] }
  const reply = (cases: unknown[]) => codingToolReply('author', 'submit_fixture_cases', { cases })
  const now = '2026-11-04T17:00:00.000Z'
  let correction: FixtureCaseCorrection | undefined
  try {
    fixtureChecksFromResponse(p, reply([first, bad]), now)
  } catch (error) {
    expect(error).toBeInstanceOf(FixtureCaseCorrection)
    correction = error as FixtureCaseCorrection
  }
  expect(correction!.partial.cases.map((c) => c.scenario)).toEqual(['s1'])
  expect(correction!.partial.selectionDigest).toBe(codingDigest(JSON.stringify(selection)))
  expect(correction!.message).toMatch(/s2.*assertion/i)
  const tampered = structuredClone(correction!.partial)
  tampered.cases[0]!.body = 'throw new Error()'
  expect(() =>
    validateIndependentVerification({
      plans: [],
      humanInputs: [],
      drafts: [
        {
          attemptId: 'partial',
          sourceDigest: source.sourceDigest,
          objectiveVersion: 1,
          partial: tampered,
          feedback: 'repair',
        },
      ],
    }),
  ).toThrow(/partial/)
  const retry = { ...p, partial: correction!.partial }
  expect(() => fixtureChecksFromResponse(retry, reply([first]), now)).toThrow()
  const plan = fixtureChecksFromResponse(retry, reply([{ ...first, scenario: 's2' }]), now)
  expect(validateFrozenIndependentChecks(plan).checks).toHaveLength(2)
  expect(plan.checks[0]?.body).toContain('const value=2')
  expect(plan.checks.map((check) => check.fixture?.units)).toEqual([['r1.1'], ['r1.2']])
  const mismatch = classifyIndependentPreflight(
    plan,
    { planDigest: plan.digest, status: 'failed', checkedCriteria: ['case-1', 'case-2'], failedCriteria: ['case-1'] },
    '[]',
  )
  expect(mismatch).toMatchObject({ status: 'invalid', correctCases: true, retainedCaseIds: ['case-1'] })
  const broken = classifyIndependentPreflight(
    plan,
    {
      planDigest: plan.digest,
      status: 'invalid',
      checkedCriteria: ['case-1'],
      failedCriteria: [],
      invalidCriteria: ['case-2'],
    },
    '[]',
  )
  expect(broken.feedback).toMatch(/case-1.*declared fail.*observed pass/i)
})

it('uses the retained cases through the normal governed plan-authoring loop', async () => {
  const deps = await import('./coding-dependency-preparation')
  const { symlink, rm } = await import('node:fs/promises')
  const path = await import('node:path')
  let cases = 0
  const fixture = await codingHarnessFixture(
    async () => codingToolReply('stop', 'report_blocked', { reason: 'verification recorded' }),
    'node node_modules/vitest/vitest.mjs run value.test.ts',
    {},
    async (request) => {
      if (request.tools[0]?.function.name === 'select_behavior_contract')
        return codingToolReply('selection', 'select_behavior_contract', {
          scenarios: ['r1.1', 'r1.2'].map((unit) => ({
            units: [unit],
            anchor: 'f1:t1',
            precondition: 'Known successful public call',
          })),
          contextOnly: [],
        })
      const form = JSON.parse(request.messages[0]!.content as string)
      cases++
      const changed = {
        scenario: 's1',
        baseline: 'fail',
        edits: [{ line: 2, deleteCount: 1, insert: " const value='changed'" }],
      }
      if (cases === 1)
        return codingToolReply('partial', 'submit_fixture_cases', {
          cases: [
            changed,
            { scenario: 's2', baseline: 'fail', edits: [{ line: 3, deleteCount: 1, insert: ' expect(true).toBe(true)' }] },
          ],
        })
      expect(form.scenarios.map((s: { id: string }) => s.id)).toEqual(['s2'])
      expect(form.retainedScenarios).toEqual(['s1'])
      return codingToolReply('correct', 'submit_fixture_cases', { cases: [{ ...changed, scenario: 's2' }] })
    },
    {
      userInstruction: 'First behavior. Second behavior.',
      baselineFiles: {
        'package.json': '{"type":"module","devDependencies":{"vitest":"3.2.6"}}',
        'pnpm-lock.yaml': 'lockfileVersion: 9.0\n',
        'vitest.config.mjs': "export default {test:{environment:'node',include:['*.test.ts']}}",
        'value.test.ts':
          "import {it,expect} from 'vitest'\nit('accepts original',()=>{\n const value='original'\n expect(value).toBe('original')\n})",
      },
    },
  )
  const prepare = vi.spyOn(deps, 'prepareCodingDependencies').mockImplementation(async (input) => {
    await symlink(
      path.resolve('node_modules'),
      path.join(input.directory, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    return { inputDigest: input.plan.inputDigest }
  })
  try {
    await fixture.authorize()
    await fixture.executor.settled('coding')
    const state = (await fixture.store.getNativeCodingSession('native-coding'))!.independentVerification!
    expect(cases).toBe(2)
    expect(state.drafts?.find((d) => d.partial)?.partial?.cases.map((c) => c.scenario)).toEqual(['s1'])
    expect(state.plans[0]?.checks.map((c) => c.criterionId)).toEqual(['case-1', 'case-2'])
    validateIndependentVerification(JSON.parse(JSON.stringify(state)))
  } finally {
    prepare.mockRestore()
    await fixture.executor.shutdown()
    await fixture.store.close()
    await rm(fixture.root, { recursive: true, force: true })
  }
}, 30000)

it('returns an all-preservation declaration for re-selection without bootstrapping or running the baseline', () => {
  const f = fixtureTemplate('case.test.ts', "it('public',()=>{\nconst a='first'\nexpect(a).toBe('first')\n})")
  const source = {
    objectiveVersion: 1,
    baselineDigest: 'a'.repeat(64),
    sourceDigest: 'b'.repeat(64),
    criteria: [{ id: 'r', sourceRef: 'approved', text: 'Support another input.' }],
    adapter: { kind: 'vitest' as const, directory: '.' },
  }
  const p: AcceptancePlanning = {
    source,
    fixtures: [f],
    phase: 'cases',
    selection: { scenarios: [{ units: ['r1.1'], fixture: 'f1', anchor: 't1', precondition: 'valid' }], contextOnly: [] },
    request: { systemPrompt: '', messages: [], tools: [] },
  }
  const r = codingToolReply('pass', 'submit_fixture_cases', {
    cases: [{ scenario: 's1', baseline: 'pass', edits: [{ line: 2, deleteCount: 1, insert: 'const a="first"' }] }],
  })
  expect(() => fixtureChecksFromResponse(p, r, '2026-11-04T17:00:00.000Z')).toThrow(/declared.*unchanged baseline/i)
})

it('requires a real operation alongside mocked UI evidence for a separate named capability', async () => {
  const { fixtureSelectionFromResponse } = await import('./native-coding-independent-verification')
  const page = fixtureTemplate(
    'screen.test.tsx',
    `import {it,expect,vi} from 'vitest'
import {render,screen,fireEvent} from '@testing-library/react'
it('opens the action',()=>{
 const api=installBridge({save:vi.fn().mockResolvedValue({ok:true})})
 render(<Screen api={api}/>)
 fireEvent.click(screen.getByRole('button'))
 expect(api.save).toHaveBeenCalled()
 expect(screen.getByRole('status')).toHaveTextContent('saved')
})`,
  )
  const service = fixtureTemplate(
    'service.test.ts',
    "import {save} from './service';it('saves an eligible job',async()=>{await expect(save(job)).resolves.toMatchObject({status:'saved'})})",
  )
  const source = {
    objectiveVersion: 1,
    sourceDigest: 'a'.repeat(64),
    baselineDigest: 'b'.repeat(64),
    criteria: [{ id: 'objective', sourceRef: 'approved', text: 'ARCHIVE jobs can be saved. The UI shows the action.' }],
  }
  expect(service.anchors[0]?.behavior?.resolves).toEqual(['save'])
  const input = {
    source,
    phase: 'select' as const,
    fixtures: [page, service],
    requiredSubjects: [{ unit: 'r1.1', value: 'archive' }],
    request: { systemPrompt: '', messages: [], tools: [] },
  }
  const scenario = (unit: string, anchor: string) => ({ units: [unit], anchor, precondition: 'An authorized existing job' })
  const select = (rows: ReturnType<typeof scenario>[]) =>
    codingToolReply('select', 'select_behavior_contract', { scenarios: rows, contextOnly: [] })
  expect(() => fixtureSelectionFromResponse(input, select([scenario('r1.1', 'f1:t1'), scenario('r1.2', 'f1:t1')]))).toThrow(
    /r1\.1.*f1:t1.*real/i,
  )
  const both = fixtureSelectionFromResponse(input, select([scenario('r1.1', 'f2:t1'), scenario('r1.2', 'f1:t1')]))
  expect(both.scenarios.map((s) => s.fixture)).toEqual(['f2', 'f1'])
  const mixed = fixtureSelectionFromResponse(input, select([
    scenario('r1.1', 'f2:t1'),
    { ...scenario('r1.1', 'f1:t1'), units: ['r1.1', 'r1.2'] },
  ]))
  const author = {
    ...input, phase: 'cases' as const, selection: mixed, namedInputs: ['archive'],
    source: { ...source, adapter: {kind:'vitest' as const, directory:'.'} },
  }
  const authored = (bindInService: boolean) => {
    const contrast = { control: 'active', requested: 'archive', field: 'mode' }
    return codingToolReply('cases', 'submit_fixture_cases', {cases: [
      {scenario:'s1', baseline: 'fail', edits:[{line:1,deleteCount:0,insert:bindInService
        ? "await __devflowInvoke(save,[{mode:__devflowInput}],subject=>subject)"
        : "expect(typeof save).toBe('function')"}], ...(bindInService ? {contrast}: {})},
      {scenario:'s2', baseline:'pass', edits:[{line:3,deleteCount:0,insert:bindInService
        ? "expect(api.save).toBeDefined()"
        : "await __devflowInvoke(api.save,[{mode:__devflowInput}],subject=>subject)"}], ...(bindInService ? {}: {contrast})},
    ]})
  }
  expect(() => fixtureChecksFromResponse(author,authored(false),'2026-11-04T21:00:00Z')).toThrow(/bound operation|real operation/i)
  expect(fixtureChecksFromResponse(author,authored(true),'2026-11-04T21:00:00Z').checks[0]?.fixture?.contrast?.requested).toBe('archive')
  const independentUi = {
    ...input,
    source: {
      ...source,
      criteria: [{ id: 'objective', sourceRef: 'approved', text: 'ARCHIVE status is visible in the UI.' }],
    },
  }
  expect(() => fixtureSelectionFromResponse(independentUi, select([scenario('r1.1', 'f1:t1')]))).not.toThrow()
})

it('does not let an in-memory replacement stand in for a source that also requires persisted recovery to save successfully', async () => {
  const { fixtureSelectionFromResponse } = await import('./native-coding-independent-verification')
  const math = fixtureTemplate(
    'rebuild.test.ts',
    "it('builds a derived record',()=>{const updated=rebuild(original);expect(updated.id).not.toBe(original.id)})",
  )
  const disk = fixtureTemplate(
    'journal.test.ts',
    `import {readFile,writeFile,mkdtemp} from 'node:fs/promises'
import {openJournal} from './journal-store'
it('saves and reloads the journal',async()=>{
 const folder=await mkdtemp('isolated-journal')
 const store=await openJournal({dbPath:folder+'/journal.db'})
 await store.saveEntry(original)
 const readBack=await store.listEntries()
 expect(readBack).toContainEqual(original)
})`,
  )
  const source = {
    objectiveVersion: 1,
    sourceDigest: 'b'.repeat(64),
    baselineDigest: 'c'.repeat(64),
    criteria: [
      { id: 'goal', sourceRef: 'approved', text: 'Repair the damaged persisted journal and allow a legitimate state save.' },
    ],
  }
  const p = {
    source,
    phase: 'select' as const,
    fixtures: [math, disk],
    request: { systemPrompt: '', messages: [], tools: [] },
  }
  const sim = (key: string) =>
    codingToolReply('selected', 'select_behavior_contract', {
      scenarios: [
        { units: ['r1.1'], anchor: key, precondition: 'Previously stored state contains a damaged derived record' },
      ],
      contextOnly: [],
    })
  expect(() => fixtureSelectionFromResponse(p, sim('f1:t1'))).toThrow(/r1.1.*store.*f2:t1/i)
  expect(fixtureSelectionFromResponse(p, sim('f2:t1')).scenarios[0]?.fixture).toBe('f2')
  const selected = fixtureSelectionFromResponse(p, sim('f2:t1'))
  const writeLine = disk.anchors[0]!.control!.split('\n').findIndex((line) => line.includes('await store.saveEntry')) + 1
  const noWrite = codingToolReply('wrong-route', 'submit_fixture_cases', {
    cases: [
      {
        scenario: 's1',
        baseline: 'fail',
        edits: [{ line: writeLine, deleteCount: 1, insert: ' const localOnly = rebuild(original)' }],
      },
    ],
  })
  expect(() =>
    fixtureChecksFromResponse({ ...p, phase: 'cases', selection: selected }, noWrite, '2026-11-04T19:00:00Z'),
  ).toThrow(/real store write/i)
  const inspection = {
    ...p,
    source: {
      ...source,
      criteria: [{ id: 'goal', sourceRef: 'approved', text: 'Inspect an initially persisted attachment before retrying.' }],
    },
  }
  expect(() => fixtureSelectionFromResponse(inspection, sim('f1:t1'))).not.toThrow()
})

it('rejects an acceptance assertion that searches undocumented aliases for a single output field', () => {
  const file = 'delivery.test.ts',
    fixture = fixtureTemplate(
      file,
      "it('reads a completed attempt',()=>{\n const result=readReceipt()\n expect(result.id).toBe('job')\n})",
    )
  const source = {
    adapter: { kind: 'vitest' as const, directory: '.' },
    objectiveVersion: 1,
    sourceDigest: 'a'.repeat(64),
    baselineDigest: 'b'.repeat(64),
    criteria: [{ id: 'approved', text: 'Expose the authoritative delivery outcome.', sourceRef: 'request' }],
  }
  const p = {
    source,
    phase: 'cases' as const,
    fixtures: [fixture],
    request: { systemPrompt: '', messages: [], tools: [] },
    selection: {
      scenarios: [{ fixture: 'f1', anchor: 't1', units: ['r1.1'], precondition: 'Known receipt' }],
      contextOnly: [],
    },
  }
  const reply = (expression: string) =>
    codingToolReply('draft', 'submit_fixture_cases', {
      cases: [
        {
          scenario: 's1',
          baseline: 'fail',
          edits: [
            {
              line: 4,
              deleteCount: 0,
              insert: ` const observed=${expression}\n expect(String(observed ?? '')).toBe('ready')`,
            },
          ],
        },
      ],
    })
  const aliases = 'result?.deliveryState ?? result?.delivery?.status ?? result?.outcome'
  expect(() => fixtureChecksFromResponse(p, reply(aliases), '2026-11-04T20:00:00Z')).toThrow(/unverified.*aliases/i)
  expect(() => fixtureChecksFromResponse(p, reply('result.deliveryState ?? null'), '2026-11-04T20:00:00Z')).not.toThrow()
  const approved = {
    ...p,
    source: {
      ...source,
      criteria: [
        { ...source.criteria[0]!, text: 'Accept deliveryState, delivery.status or outcome from supported formats.' },
      ],
    },
  }
  expect(() => fixtureChecksFromResponse(approved, reply(aliases), '2026-11-04T20:00:00Z')).not.toThrow()
})

it('requires a caller to observe a lost acknowledgement after a visible effect has completed', async () => {
  const { fixtureSelectionFromResponse } = await import('./native-coding-independent-verification')
  const storage = fixtureTemplate('store.test.ts', "it('reads a saved value',()=>{expect(currentValue).toBe('saved')})")
  const client = fixtureTemplate(
    'client.test.ts',
    `it('updates after save succeeds',async()=>{
 let stored='old'
 const submit=vi.fn().mockResolvedValue('saved')
 const read=vi.fn(async()=>stored)
 const shown=await clientUpdate(submit,read)
 expect(submit).toHaveBeenCalledTimes(1)
 expect(shown).toBe('saved')
})`,
  )
  const source = {
    objectiveVersion: 1,
    sourceDigest: 'f'.repeat(64),
    baselineDigest: 'a'.repeat(64),
    criteria: [
      {
        id: 'goal',
        text: 'When the write is committed but the response is lost, read back the stored result.',
        sourceRef: 'approved',
      },
    ],
    adapter: { kind: 'vitest' as const, directory: '.' },
  }
  const sel = {
    source,
    phase: 'select' as const,
    fixtures: [storage, client],
    request: { systemPrompt: '', messages: [], tools: [] },
  }
  const choose = (anchor: string) =>
    codingToolReply('selected', 'select_behavior_contract', {
      scenarios: [{ units: ['r1.1'], anchor, precondition: 'The caller submits a single write' }],
      contextOnly: [],
    })
  expect(() => fixtureSelectionFromResponse(sel, choose('f1:t1'))).toThrow(/r1\.1.*caller/i)
  const p = { ...sel, phase: 'cases' as const, selection: fixtureSelectionFromResponse(sel, choose('f2:t1')) }
  const submit = (line: string) =>
    fixtureChecksFromResponse(
      p,
      codingToolReply('write', 'submit_fixture_cases', {
        cases: [{ scenario: 's1', baseline: 'fail', edits: [{ line: 3, deleteCount: 1, insert: line }] }],
      }),
      '2026-11-04T20:00:00Z',
    )
  expect(() => submit(" const submit=vi.fn().mockRejectedValue(new Error('failed before a commit'))")).toThrow(
    /after.*commit/i,
  )
  expect(() => submit(" const submit=vi.fn(()=>__devflowLoseReplyAfterCommit(()=> 'saved'))")).toThrow(/effect/i)
  const plan = submit(" const submit=vi.fn(()=>__devflowLoseReplyAfterCommit(()=>{stored='saved';return stored}))")
  expect(plan.checks[0]?.fixture?.lostReply).toBe(true)
  expect(() => submit(" const submit=vi.fn(); await __devflowLoseReplyAfterCommit(()=>{stored='saved';return stored})")).toThrow(/effect/i)
})

it('delivers both replies only after the identical write settles, and invalidates an unreached fault', async () => {
  const { replyDeliveryBody } = await import('./native-coding-lost-reply')
  const { runInNewContext } = await import('node:vm')
  const check = (body: string, lost: boolean, log: string[]) =>
    runInNewContext(`(async()=>{
${replyDeliveryBody(body, lost)}
})()`, { log }) as Promise<void>
  const write = `
    async function submit() {
      return __devflowLoseReplyAfterCommit(async () => {
        await Promise.resolve()
        log.push('committed')
        return 'saved'
      })
    }
    try { log.push(await submit()) } catch { log.push('reply unavailable') }`
  for (const lost of [false, true]) {
    const log: string[] = []
    await check(write, lost, log)
    expect(log).toEqual(['committed', lost ? 'reply unavailable' : 'saved'])
    await expect(check('if (false) await __devflowLoseReplyAfterCommit(() => log.push("write"))', lost, [])).rejects.toThrow('DevFlowCommittedEffectNotReached')
    await expect(check('try { await __devflowLoseReplyAfterCommit(() => { throw new Error("write failed") }) } catch {}', lost, [])).rejects.toThrow('DevFlowCommittedEffectNotReached')
  }
})

it('requires an actual clock stimulus for a requested time-boundary scenario', () => {
  const fixture=fixtureTemplate('recovery.test.ts',`it('resumes safely',async()=>{
 let calls=0
 const handle=()=>++calls
 await exercise(handle)
 expect(calls).toBe(1)
})`)
  const source={objectiveVersion:1,sourceDigest:'b'.repeat(64),baselineDigest:'a'.repeat(64),
    criteria:[{id:'goal',sourceRef:'approved',text:'Finish bounded recovery when the elapsed-time boundary arrives.'}],
    adapter:{kind:'vitest' as const,directory:'.'}}
  const selection={scenarios:[{units:['r1.1'],fixture:'f1',anchor:'t1',precondition:'An already active step crosses its wall-clock deadline.'}],contextOnly:[]}
  const planning={source,fixtures:[fixture],selection,phase:'cases' as const,request:{systemPrompt:'',messages:[],tools:[]}}
  const reply=(setup:string)=>codingToolReply('case','submit_fixture_cases',{cases:[{
    scenario:'s1',baseline:'fail',edits:[{line:2,deleteCount:0,insert:setup},{line:6,deleteCount:0,insert:'expect(calls<=12).toBe(true)'}],
  }]})
  expect(()=>fixtureChecksFromResponse(planning,reply('const maxCalls=12'),'2026-11-04T22:00:00Z')).toThrow(/clock|time boundary/i)
  expect(()=>fixtureChecksFromResponse(planning,reply("vi.spyOn(Date,'now').mockImplementation(()=>advancedTime)"),'2026-11-04T22:00:00Z')).not.toThrow()
  const countGoal={...planning,source:{...source,criteria:[{...source.criteria[0]!,text:'Finish after no more than twelve calls.'}]}}
  expect(()=>fixtureChecksFromResponse(countGoal,reply('const maxCalls=12'),'2026-11-04T22:00:00Z')).not.toThrow()
})
