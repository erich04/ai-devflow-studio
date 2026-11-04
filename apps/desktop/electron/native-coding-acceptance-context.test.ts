// @vitest-environment node
import { expect, it } from 'vitest'
import { acceptanceContext, fixtureInputExamples, focusFixtureEvidence } from './native-coding-acceptance-context'
import { codingDigest } from './coding-candidate-workspace'

it('keeps the baseline definition and every named execution surface when a large early suite would otherwise consume the input budget', async () => {
  const files = new Map([
    ['docs/adr/0001-recovery.md', '# 旧约定\n\n## 步骤恢复\n\n每个失败步骤允许两次恢复调用，成功步骤后重置。'],
    ['docs/adr/0002-color.md', '# Color\nAn unrelated palette.'],
    ['.ssh/private.md', 'PRIVATE-CREDENTIAL'],
    ['ui/screen.test.ts', '// display setup\n'.repeat(6000)],
    ['ui/screen.ts', 'export const view = "ready";\n'],
    ['runtime/service.test.ts', 'export const fixtureAtTheEnd = true;'],
    ['runtime/service.ts', 'export const runRecovery = () => 1;'],
  ])
  const manifest = [...files].map(([path, content]) => ({
    path,
    hash: codingDigest(content),
    size: Buffer.byteLength(content),
  }))
  const read = async (hash: string) => Buffer.from([...files.values()].find((text) => codingDigest(text) === hash)!)
  const result = await acceptanceContext(
    manifest,
    read,
    '步骤恢复时保留已完成的调用',
    ['ui/screen.test.ts', 'runtime/service.test.ts'],
    14000,
  )
  expect(result.files.map((item) => item.path)).toEqual(
    expect.arrayContaining(['ui/screen.test.ts', 'runtime/service.test.ts', 'runtime/service.ts']),
  )
  expect(result.files.find((item) => item.path === 'ui/screen.test.ts')?.truncated).toBe(true)
  expect(
    result.contracts.some((item) => item.path === 'docs/adr/0001-recovery.md' && item.content.includes('两次恢复调用')),
  ).toBe(true)
  expect(JSON.stringify(result)).not.toMatch(/PRIVATE-CREDENTIAL|unrelated palette/)
  expect([...result.files, ...result.contracts].reduce((n, item) => n + item.content.length, 0)).toBeLessThanOrEqual(14000)
})

it('grounds a named mode in the data actually imported by the public test, including workspace package exports', async () => {
  const files = new Map([
    ['packages/data/package.json', JSON.stringify({ name: '@sample/data', exports: { './fixtures': './src/data.ts' } })],
    [
      'packages/data/src/data.ts',
      "// mode: 'ghost'\nexport const jobs = [{ id: 'job-b', mode: 'batch', payload: 'original' }, {id:'job-c',mode:'live'}]",
    ],
    ['unrelated/fixtures.ts', "export const other = [{ mode: 'batch', payload: 'unrelated' }]"],
  ])
  const manifest = [...files].map(([path, content]) => ({
    path,
    hash: codingDigest(content),
    size: Buffer.byteLength(content),
  }))
  const read = async (hash: string) => Buffer.from([...files.values()].find((text) => codingDigest(text) === hash)!)
  const result = await fixtureInputExamples(
    manifest,
    read,
    'Allow BATCH jobs to finish. Compare GHOST examples in the notes.',
    [{ path: 'app/service.test.ts', source: "import { jobs } from '@sample/data/fixtures'" }],
  )
  expect(result).toHaveLength(1)
  expect(result[0]).toMatchObject({ path: 'packages/data/src/data.ts', term: 'BATCH', field: 'mode', value: 'batch' })
  expect(result[0]?.observedValues).toEqual(['batch', 'live'])
  expect(result[0]?.excerpt).toContain('job-b')
})

it('keeps a relevant middle implementation slice within the model input allowance while retaining its original path', () => {
  const source = [
    ...Array.from({ length: 250 }, (_, i) => 'export const unrelatedColor' + i + ' = "grey"'),
    'function resumeInterruptedPayment() { /* 支付中断恢复时核对账本 */ }',
    ...Array.from({ length: 250 }, (_, i) => 'export const noise' + i + ' = "blue"'),
  ].join('\n')
  const focus = focusFixtureEvidence(
    { path: 'payments.ts', content: source, truncated: false },
    '支付中断恢复 resumeInterruptedPayment',
    3600,
  )
  expect(focus?.content).toContain('resumeInterruptedPayment')
  expect(focus?.content.length).toBeLessThanOrEqual(3600)
  expect(focus).toMatchObject({ path: 'payments.ts', truncated: true })
})

it('keeps all named suites as context when only some of them offer eligible public controls', async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises')
  const { default: path } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const { CodingCandidateWorkspace } = await import('./coding-candidate-workspace')
  const { fixturePlanning } = await import('./native-coding-fixture-planning')
  const root = await mkdtemp(path.join(tmpdir(), 'fixture-menu-')),
    delivery = path.join(root, 'delivery')
  try {
    await mkdir(delivery)
    await writeFile(
      path.join(delivery, 'platform.test.ts'),
      "import {it,expect} from 'vitest'; it.each([1,2])('platform %s',n=>expect(n).toBeGreaterThan(0))",
    )
    await writeFile(
      path.join(delivery, 'behavior.test.ts'),
      "import {it,expect} from 'vitest'; it('positive',()=>{expect(1).toBe(1)})",
    )
    const ws = await CodingCandidateWorkspace.create({
      root: path.join(root, 'work'),
      delivery,
      baseCommitSha: 'a'.repeat(40),
      excludedPaths: ['node_modules'],
    })
    const plan = await fixturePlanning(
      {
        objectiveVersion: 1,
        baselineDigest: ws.identity.base.digest,
        sourceDigest: 'b'.repeat(64),
        criteria: [{ id: 'goal', sourceRef: 'approved', text: 'Work across modes.' }],
      },
      ws,
      ['platform.test.ts', 'behavior.test.ts'],
    )
    expect(plan?.phase).toBe('select')
    const payload = JSON.parse(plan!.request.messages[0]!.content as string)
    expect(payload.fixtures.map((f: { path: string; anchors: unknown[] }) => [f.path, f.anchors.length])).toEqual([
      ['platform.test.ts', 0],
      ['behavior.test.ts', 1],
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('finds the normal named feature in immutable nearby public fixtures even when the regression command lists only transport tests', async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises')
  const { default: path } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const { CodingCandidateWorkspace } = await import('./coding-candidate-workspace')
  const { fixturePlanning } = await import('./native-coding-fixture-planning')
  const { fixtureSelectionFromResponse } = await import('./native-coding-independent-verification')
  const { codingToolReply } = await import('./native-coding-test-fixture')
  const root = await mkdtemp(path.join(tmpdir(), 'fixture-owner-')),
    delivery = path.join(root, 'project')
  try {
    await mkdir(delivery)
    const files = {
      'framekit-transport.test.ts': "import {it, expect} from 'vitest'; it('starts the transport',()=>{expect(1).toBe(1)})",
      'framekit-profile.ts': 'export function openProfile() { return {active:true} }',
      'framekit-audit.ts': 'export function unrelatedAudit() { return 3 }',
      'tenant.test.ts':
        "import {describe,it,expect} from 'vitest';describe('FrameKit tenant profiles',()=>{it('opens for a tenant',async()=>{const {openProfile}=await import('./framekit-profile');expect(openProfile().active).toBe(true)})});describe('other',()=>{it('displays unrelated state',async()=>{await import('./framekit-audit');expect(2).toBe(2)})})",
      'unrelated.test.ts':
        "import {describe,it,expect} from 'vitest'; describe('FrameKit mentioned only',()=>{it('matches a string',()=>{expect('unused').toBe('unused')})})",
    }
    for (const [name, content] of Object.entries(files)) await writeFile(path.join(delivery, name), content)
    const ws = await CodingCandidateWorkspace.create({
      root: path.join(root, 'work'),
      delivery,
      baseCommitSha: 'c'.repeat(40),
      excludedPaths: ['node_modules'],
    })
    await writeFile(path.join(delivery, 'tenant.test.ts'), '// CANDIDATE-ONLY-TRAP')
    const source = {
      objectiveVersion: 1,
      baselineDigest: ws.identity.base.digest,
      sourceDigest: 'd'.repeat(64),
      criteria: [{ id: 'goal', sourceRef: 'request', text: 'Keep FrameKit tenant profiles isolated.' }],
    }
    const plan = (await fixturePlanning(source, ws, ['framekit-transport.test.ts']))!
    const payload = JSON.parse(plan.request.messages[0]!.content as string)
    expect(payload.fixtures.map((f: { path: string }) => f.path)).toEqual(['framekit-transport.test.ts', 'tenant.test.ts'])
    expect(payload.fixtures[1].anchors.map((a: { key: string }) => a.key)).toEqual(['f2:t1'])
    expect(JSON.stringify(payload.fixtures[1])).toContain('openProfile')
    expect(JSON.stringify(payload.fixtures[1])).not.toContain('framekit-audit')
    expect(JSON.stringify(payload)).not.toContain('CANDIDATE-ONLY-TRAP')
    const reply = (anchor: string) =>
      codingToolReply('select', 'select_behavior_contract', {
        scenarios: [{ units: ['r1.1'], anchor, precondition: 'The normal tenant entry opens a profile' }],
        contextOnly: [],
      })
    expect(() => fixtureSelectionFromResponse(plan, reply('f2:t2'))).toThrow(/unsupported/)
    const selection = fixtureSelectionFromResponse(plan, reply('f2:t1'))
    const next = (await fixturePlanning(source, ws, ['framekit-transport.test.ts'], {
      plans: [],
      humanInputs: [],
      drafts: [{ attemptId: 'sel', sourceDigest: source.sourceDigest, objectiveVersion: 1, selection, feedback: 'OK' }],
    }))!
    const writing = JSON.parse(next.request.messages[0]!.content as string)
    expect(writing.fixtures.map((f: { path: string }) => f.path)).toEqual(['tenant.test.ts'])
    expect(JSON.stringify(writing.fixtures[0])).toContain('framekit-profile.ts')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
