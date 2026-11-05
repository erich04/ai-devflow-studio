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
    const choices = plan!.request.tools[0]!.function.parameters as {
      properties: {
        contextOnly: { items: { properties: { unit: { enum?: string[] } } } }
        scenarios: { items: { properties: { units: { items: { enum?: string[] } } } } }
      }
    }
    expect(choices.properties.contextOnly.items.properties.unit.enum).toEqual(['r1.1'])
    expect(choices.properties.scenarios.items.properties.units.items.enum).toEqual(['r1.1'])

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
    expect(writing.fixtures[0].examples[0].protectedAssertionLines).toEqual([[1, 1]])
    expect(JSON.stringify(writing.fixtures[0])).toContain('framekit-profile.ts')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('distinguishes a project observation of the affected route from requirements and keeps grader files out of discovery', async () => {
  const texts = new Map([
    [
      'docs/validation/widget-replay.md',
      '# Local validation\n\n## Results\n\n' +
        'Ordinary older setup details. '.repeat(230) +
        '\n\nFrameKit billing was pending in the settlement journal. The transport trace had already finished.',
    ],
    ['docs/evaluation/widget-key.md', '# FrameKit billing\nPRIVATE-GRADER-ANSWER'],
    ['docs/validation/.env/trace.md', '# FrameKit billing\nPRIVATE-FILE'],
    ['docs/validation/other.md', '# Unrelated palettes\nThe display was magenta.'],
  ])
  const files = [...texts].map(([path, text]) => ({ path, hash: codingDigest(text), size: Buffer.byteLength(text) }))
  const context = await acceptanceContext(
    files,
    async (hash) => Buffer.from([...texts.values()].find((t) => codingDigest(t) === hash)!),
    'Expose the pending FrameKit billing status.',
    [],
    6000,
  )
  expect(context.observations).toEqual([
    expect.objectContaining({
      path: 'docs/validation/widget-replay.md',
      content: expect.stringContaining('settlement journal'),
    }),
  ])
  expect(context.contracts).toEqual([])
  expect(JSON.stringify(context)).not.toMatch(/PRIVATE-GRADER|PRIVATE-FILE|magenta/)
  expect(
    [...context.observations, ...context.files, ...context.contracts].reduce((n, v) => n + v.content.length, 0),
  ).toBeLessThanOrEqual(6000)
})

it('gives a private selector the public route and actual stimulus behind a rejected baseline case number', async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises')
  const path = await import('node:path'),
    { tmpdir } = await import('node:os')
  const { CodingCandidateWorkspace } = await import('./coding-candidate-workspace')
  const { fixturePlanning } = await import('./native-coding-fixture-planning')
  const { fixtureSelectionFromResponse, fixtureChecksFromResponse } = await import(
    './native-coding-independent-verification'
  )
  const { codingToolReply } = await import('./native-coding-test-fixture')
  const root = await mkdtemp(path.join(tmpdir(), 'private-reselect-')),
    delivery = path.join(root, 'project')
  try {
    await mkdir(delivery)
    await writeFile(
      path.join(delivery, 'route.test.ts'),
      "import {it,expect} from 'vitest'\nit('finishes after pressing resume',()=>{\n const operation='manual'\n expect(operation).toBeTruthy()\n})\nit('finishes an active job',()=>{expect(true).toBe(true)})",
    )
    const ws = await CodingCandidateWorkspace.create({
      root: path.join(root, 'ws'),
      delivery,
      baseCommitSha: 'a'.repeat(40),
      excludedPaths: [],
    })
    const source = {
      objectiveVersion: 1,
      sourceDigest: 'b'.repeat(64),
      baselineDigest: ws.identity.base.digest,
      criteria: [{ id: 'goal', text: 'Finish an active job.', sourceRef: 'approved' }],
      adapter: { kind: 'vitest' as const, directory: '.' },
    }
    const select = (await fixturePlanning(source, ws, ['route.test.ts']))!
    const selection = fixtureSelectionFromResponse(
      select,
      codingToolReply('select', 'select_behavior_contract', {
        scenarios: [{ units: ['r1.1'], anchor: 'f1:t1', precondition: 'The user explicitly resumes a stopped job.' }],
        contextOnly: [],
      }),
    )
    const stamp = { sourceDigest: source.sourceDigest, objectiveVersion: 1 }
    const selected = { ...stamp, attemptId: 'select', selection, feedback: 'Source selected' }
    const generate = (await fixturePlanning(source, ws, ['route.test.ts'], {
      plans: [],
      humanInputs: [],
      drafts: [selected],
    }))!
    const plan = fixtureChecksFromResponse(
      generate,
      codingToolReply('draft', 'submit_fixture_cases', {
        cases: [
          {
            scenario: 's1',
            baseline: 'fail',
            edits: [{ line: 2, deleteCount: 1, insert: " const operation='another-manual-run'" }],
          },
        ],
      }),
      new Date().toISOString(),
    )
    const feedback = 'case-1 (declared fail, observed pass)'
    const rejected = { ...stamp, attemptId: 'invalid', feedback, preflightStatus: 'invalid' as const, plan }
    const retry = (await fixturePlanning(source, ws, ['route.test.ts'], {
      plans: [],
      humanInputs: [],
      drafts: [selected, rejected],
    }))!
    const data = JSON.parse(retry.request.messages[0]!.content as string)
    expect(data.rejectedSelection).toMatchObject({
      stage: 'baseline_preflight',
      outcome: feedback,
      scenarios: [
        {
          caseId: 'case-1',
          anchor: 'f1:t1',
          units: ['r1.1'],
          precondition: 'The user explicitly resumes a stopped job.',
          variantLines: expect.stringContaining('another-manual-run'),
        },
      ],
    })
    const noExecution = (await fixturePlanning(source, ws, ['route.test.ts'], {
      plans: [],
      humanInputs: [],
      drafts: [
        selected,
        { ...rejected, correctCases: true },
        { ...stamp, attemptId: 'proposal', reselect: true, feedback: 'All variations predict pass.' },
      ],
    }))!
    const proposed = JSON.parse(noExecution.request.messages[0]!.content as string).rejectedSelection
    expect(proposed.stage).toBe('proposal_only')
    expect(proposed.scenarios[0]).toMatchObject({ anchor: 'f1:t1' })
    expect(proposed.scenarios[0]).not.toHaveProperty('caseId')
    const other = (await fixturePlanning({ ...source, objectiveVersion: 2 }, ws, ['route.test.ts'], {
      plans: [],
      humanInputs: [],
      drafts: [selected, rejected],
    }))!
    expect(JSON.parse(other.request.messages[0]!.content as string).rejectedSelection).toBeUndefined()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('shows the owning implementation of an additional public fixture, including relevant middle-of-file logic', async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises')
  const { default: path } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const { CodingCandidateWorkspace } = await import('./coding-candidate-workspace')
  const { fixturePlanning } = await import('./native-coding-fixture-planning')
  const root = await mkdtemp(path.join(tmpdir(), 'private-owner-context-')),
    delivery = path.join(root, 'project')
  try {
    await mkdir(delivery)
    const files = {
      'transport.test.ts': "import {it,expect} from 'vitest';it('connects',()=>{expect(1).toBe(1)})",
      'framekit-adapter.ts':
        '// Unrelated surrounding implementation\n'.repeat(700) +
        'export function startAnalysis(){ return adapter.complete({phase:"analysis",maxOutputTokens:2048}) }\n' +
        '// Other unrelated implementation\n'.repeat(700),
      'framekit-adapter.test.ts':
        "import {it,describe,expect} from 'vitest';import {startAnalysis} from './framekit-adapter';describe('FrameKit adapter',()=>{it('calls startAnalysis',()=>{expect(startAnalysis()).toBeDefined()})})",
    }
    for (const [file, body] of Object.entries(files)) await writeFile(path.join(delivery, file), body)
    const workspace = await CodingCandidateWorkspace.create({
      root: path.join(root, 'workspace'),
      delivery,
      baseCommitSha: 'a'.repeat(40),
      excludedPaths: [],
    })
    const source = {
      objectiveVersion: 1,
      sourceDigest: 'd'.repeat(64),
      baselineDigest: workspace.identity.base.digest,
      criteria: [
        { id: 'goal', sourceRef: 'approved', text: 'FrameKit analysis must use the correct output allowance.' },
      ],
      adapter: { kind: 'vitest' as const, directory: '.' },
    }
    const plan = (await fixturePlanning(source, workspace, ['transport.test.ts']))!
    const data = JSON.parse(plan.request.messages[0]!.content as string)
    const actual = data.fixtures.find((f: { path: string }) => f.path === 'framekit-adapter.test.ts')
    expect(actual?.production?.path).toBe('framekit-adapter.ts')
    expect(actual?.production?.content).toContain('maxOutputTokens:2048')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
