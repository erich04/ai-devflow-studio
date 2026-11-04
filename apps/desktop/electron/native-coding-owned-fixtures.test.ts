// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { ownedFixtureContracts, checkOwnedFixtureInputs } from './native-coding-owned-fixtures'

it('requires a new mocked project read model to come from its observed producer, without restricting external failure stimuli', () => {
  const file = 'ui/Viewer.test.ts'
  const source = 'const original: ListSnapshot = {items: []}; const existing=vi.fn().mockResolvedValue(original)'
  const prod =
    'export type ListSnapshot={items:unknown[]}; type ListInput={rows:unknown[]}; export function buildList(input: ListInput): ListSnapshot { return {items:input.rows} }\nexport function parse(value:unknown): ListSnapshot {throw Error()}'
  const producerTest = {
    path: 'shared/list.test.ts',
    source: "const rows=['a']; it('builds',()=>{const value=buildList({rows}); expect(value.items).toEqual(rows)})",
  }
  const contracts = ownedFixtureContracts([{ path: file, source }, producerTest], [{ path: 'shared/list.ts', source: prod }])
  expect(contracts[0]?.producers[0]?.example).toContain('buildList({rows})')
  expect(contracts[0]?.producers[0]?.inputDefinition).toContain('rows')
  const control = "const lookup=vi.fn().mockResolvedValue(original)\nconst external=vi.fn().mockResolvedValue('ok')"
  const handBuilt =
    'const edited: ListSnapshot = {...original,items:[]}\n' + control.replace('Value(original)', 'Value(edited)')
  expect(() => checkOwnedFixtureInputs(file, control, handBuilt, contracts)).toThrow(/lookup.*ListSnapshot.*buildList/)
  expect(() =>
    checkOwnedFixtureInputs(
      file,
      control,
      control + "\nlookup.mockResolvedValue({...original,items:['invented']})",
      contracts,
    ),
  ).toThrow()
  expect(() => checkOwnedFixtureInputs(file, control, "original.items.push('invented')\n" + control, contracts)).toThrow()
  const real =
    "const {buildList}=await import('../shared/list')\nconst edited=buildList(rawInput)\n" +
    control.replace('Value(original)', 'Value(edited)')
  expect(() => checkOwnedFixtureInputs(file, control, real, contracts)).not.toThrow()
  expect(() => checkOwnedFixtureInputs(file, control, control.replace("'ok'", "'malformed'"), contracts)).not.toThrow()
  expect(() => checkOwnedFixtureInputs(file, control, real.replace('../shared/list', '../fake'), contracts)).toThrow()
  expect(() =>
    checkOwnedFixtureInputs(file, control, handBuilt, contracts, 'Reject a malformed ListSnapshot received from the bridge'),
  ).not.toThrow()
  expect(() => checkOwnedFixtureInputs(file, control, handBuilt, contracts, 'Handle deletion in ListSnapshot')).toThrow()
})

it('rejects a fabricated downstream payload and accepts the repaired upstream implementation through the governed harness', async () => {
  const { rm, symlink } = await import('node:fs/promises')
  const { default: path } = await import('node:path')
  const { codingHarnessFixture, codingToolReply } = await import('./native-coding-test-fixture')
  const { codingDigest } = await import('./coding-candidate-workspace')
  const deps = await import('./coding-dependency-preparation')
  const header = 'export type ListView={items:string[]}; type ListInput={rows:{name:string;archived:boolean}[]}\n'
  const old = header + 'export function buildList(input:ListInput):ListView{return {items:input.rows.map(row=>row.name)}}'
  const fixed =
    header +
    'export function buildList(input:ListInput):ListView{return {items:input.rows.filter(row=>!row.archived).map(row=>row.name)}}'
  const view =
    "import {vi,it,expect} from 'vitest'\nimport type {ListView} from '../src/list'\nconst original:ListView={items:['visible']}\nit('displays a valid response',async()=>{\n const lookup=vi.fn().mockResolvedValue(original)\n expect((await lookup()).items).toContain('visible')\n expect((await lookup()).items).not.toContain('private')\n})"
  let code = 0,
    cases = 0
  const f = await codingHarnessFixture(
    async () =>
      ++code === 1
        ? codingToolReply('write', 'write_file', { path: 'src/list.ts', content: fixed, expectedHash: codingDigest(old) })
        : codingToolReply('submit', 'propose_changeset', { summary: 'Apply the visibility rule' }),
    'node node_modules/vitest/vitest.mjs run ui/view.test.ts src/list.test.ts',
    {},
    async (req) => {
      if (req.tools[0]!.function.name === 'select_behavior_contract')
        return codingToolReply('select', 'select_behavior_contract', {
          scenarios: [{ units: ['r1.1'], anchor: 'f1:t1', precondition: 'A caller displays the list' }],
          contextOnly: [],
        })
      const msg = JSON.parse(req.messages.at(-1)!.content as string)
      cases++
      if (cases === 2) expect(msg.correction).toMatch(/project-owned ListView.*buildList/)
      const setup =
        cases === 1
          ? "const result={...original,items:['private','visible']}"
          : "const {buildList}=await import('../src/list')\n const result=buildList({rows:[{name:'private',archived:true},{name:'visible',archived:false}]})"
      return codingToolReply('cases-' + cases, 'submit_fixture_cases', {
        cases: [
          {
            scenario: 's1',
            baseline: 'fail',
            edits: [{ line: 2, deleteCount: 1, insert: setup + '\n const lookup=vi.fn().mockResolvedValue(result)' }],
          },
        ],
      })
    },
    {
      userInstruction: 'Archived records must disappear from the displayed list.',
      baselineFiles: {
        'package.json': '{"type":"module","devDependencies":{"vitest":"3.2.6"}}',
        'pnpm-lock.yaml': 'lockfileVersion: 9.0\n',
        'vitest.config.mjs': "export default {test:{environment:'node',include:['**/*.test.ts']}}",
        'src/list.ts': old,
        'ui/view.test.ts': view,
        'src/list.test.ts':
          "import {it,expect} from 'vitest';import {buildList} from './list';it('lists visible records',()=>{expect(buildList({rows:[]}).items).toEqual([])})",
      },
    },
  )
  const prepare = vi.spyOn(deps, 'prepareCodingDependencies').mockImplementation(async (input) => {
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
    await f.authorize()
    await f.executor.settled('coding')
    const { snapshot } = await f.get()
    expect(snapshot.status).toBe('review')
    expect(cases).toBe(2)
    await f.executor.harness!.command(
      {
        protocolVersion: 2,
        type: 'approve',
        codingRunId: 'coding',
        commandId: 'approve',
        expectedVersion: snapshot.version,
        objectiveVersion: snapshot.objectiveVersion,
        revisionDigest: snapshot.revision!.digest,
        confirmedCriteria: [],
      },
      async () => {},
    )
    await f.executor.settled('coding')
    const session = (await f.store.getNativeCodingSession('native-coding'))!
    expect(session.status).toBe('completed')
    expect(session.deliveryEvidence.at(-1)?.result?.independentVerification?.status).toBe('passed')
  } finally {
    prepare.mockRestore()
    await f.executor.shutdown()
    await f.store.close()
    await rm(f.root, { recursive: true, force: true })
  }
}, 30000)
