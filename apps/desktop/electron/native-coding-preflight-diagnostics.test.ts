// @vitest-environment node
import { expect, it } from 'vitest'
import { preflightFrameReader } from './native-coding-preflight-diagnostics'

it('matches the immutable source name across Windows volume casing, short temp directories, Vite file URLs and native stacks', () => {
  const get = new Function('return (' + preflightFrameReader(['guard.ts', 'app/guard.ts']) + ')')()
  const input = {
    stackStr:
      'Error: example\n    at save (file:///d:/Users/RUNNER~1/AppData/Local/Temp/DF%20WORK/App/guard.ts:12:8)\n    at check (D:\\other\\node_modules\\lib\\guard.ts:1:2)',
    stacks: [{ file: 'D:\\UniqueCheckout\\app\\guard.ts', line: 12, column: 8 }],
  }
  expect(get(input, true)).toEqual([{ file: 'app/guard.ts', line: 12 }])
  expect(get({ stack: 'Error\n    at save (/private/tmp/work/guard.ts:3:5)' }, false)).toEqual([
    { file: 'guard.ts', line: 3 },
  ])
  expect(get({ stack: 'Error\n    at save (/private/tmp/work/other.ts:6:8)' }, false)).toEqual([])
})

it('uses a unique verified baseline guard when transformed stack lines are offset, without echoing a dynamic error', async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises')
  const { default: path } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const { codingDigest, CodingCandidateWorkspace } = await import('./coding-candidate-workspace')
  const { privatePreflightDiagnostics } = await import('./native-coding-preflight-diagnostics')
  const root = await mkdtemp(path.join(tmpdir(), 'guard-offset-'))
  try {
    const delivery = path.join(root, 'delivery')
    await mkdir(delivery)
    await writeFile(
      path.join(delivery, 'store.ts'),
      "function save(v:number){\nif(v<1) throw new Error('Invalid saved revision')\n}\n",
    )
    const ws = await CodingCandidateWorkspace.create({
      root: path.join(root, 'work'),
      delivery,
      baseCommitSha: 'a'.repeat(40),
      excludedPaths: [],
    })
    const item = {
      id: 'c',
      kind: 'TestSetupError',
      messageDigest: codingDigest('Invalid saved revision'),
      frames: [{ file: 'store.ts', line: 3 }],
    }
    expect(JSON.parse(await privatePreflightDiagnostics([item], ['c'], ws))[0].baselineGuard.location).toBe('store.ts:2')
    expect(
      JSON.parse(
        await privatePreflightDiagnostics([{ ...item, messageDigest: codingDigest('secret runtime value') }], ['c'], ws),
      )[0].baselineGuard,
    ).toBeUndefined()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('locates a localized baseline parser guard and describes its declared result without exposing runtime values', async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises')
  const path = await import('node:path'),
    { tmpdir } = await import('node:os')
  const { CodingCandidateWorkspace, codingDigest } = await import('./coding-candidate-workspace')
  const { privatePreflightDiagnostics } = await import('./native-coding-preflight-diagnostics')
  const root = await mkdtemp(path.join(tmpdir(), 'localized-private-guard-')),
    project = path.join(root, 'project')
  try {
    await mkdir(project)
    await writeFile(
      path.join(project, 'archive.ts'),
      [
        "export type ArchiveSetting = { mode: 'defer' | 'run'; detail?: 'low' | 'high'; credential?: 'private_literal' }",
        'export function parseArchive(value:unknown):ArchiveSetting {',
        "if (typeof value !== 'object' || value === null) throw new Error('配置无效。')",
        'return value as ArchiveSetting',
        '}',
      ].join('\n'),
    )
    const ws = await CodingCandidateWorkspace.create({
      root: path.join(root, 'work'),
      delivery: project,
      baseCommitSha: 'a'.repeat(40),
      excludedPaths: [],
    })
    const entry = {
      id: 'job',
      kind: 'TestSetupError',
      frames: [{ file: 'archive.ts', line: 3 }],
      messageDigest: codingDigest('配置无效。'),
    }
    const notes = await privatePreflightDiagnostics([entry], ['job'], ws)
    expect(JSON.parse(notes)[0].baselineGuard).toMatchObject({
      location: 'archive.ts:3',
      reason: '配置无效。',
      condition: "typeof value !== 'object' || value === null",
      declaredResult: {
        function: 'parseArchive',
        type: 'ArchiveSetting',
        fields: [
          { name: 'mode', optional: false, values: ['defer', 'run'] },
          { name: 'detail', optional: true, values: ['low', 'high'] },
        ],
      },
    })
    expect(notes).not.toMatch(/credential|private_literal/)
    expect(
      await privatePreflightDiagnostics([{ ...entry, messageDigest: codingDigest('user-supplied error') }], ['job'], ws),
    ).not.toContain('ArchiveSetting')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('resolves distinct failed conditions behind one verified local throw helper without copying private inputs', async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises'),
    path = await import('node:path'),
    { tmpdir } = await import('node:os')
  const { CodingCandidateWorkspace, codingDigest } = await import('./coding-candidate-workspace')
  const { privatePreflightDiagnostics } = await import('./native-coding-preflight-diagnostics')
  const root = await mkdtemp(path.join(tmpdir(), 'private-static-caller-')),
    delivery = path.join(root, 'project')
  try {
    await mkdir(delivery)
    await writeFile(
      path.join(delivery, 'shape.ts'),
      [
        'function fail(): never {',
        "  throw new Error('Invalid public shape')",
        '}',
        'export function decode(item:any){',
        '  if (item.owner !== item.record.owner) fail()',
        "  if (item.password === 'private-fixture-literal') fail()",
        '}',
      ].join('\n'),
    )
    const ws = await CodingCandidateWorkspace.create({
      root: path.join(root, 'ws'),
      delivery,
      baseCommitSha: 'a'.repeat(40),
      excludedPaths: [],
    })
    const entry = {
      id: 'x',
      kind: 'TestSetupError',
      messageDigest: codingDigest('Invalid public shape'),
      frames: [
        { file: 'shape.ts', line: 2 },
        { file: 'shape.ts', line: 5 },
      ],
    }
    const good = JSON.parse(await privatePreflightDiagnostics([entry], ['x'], ws))[0].baselineGuard
    expect(good.caller).toMatchObject({ location: 'shape.ts:5', condition: 'item.owner !== item.record.owner' })
    const privateValue = await privatePreflightDiagnostics(
      [{ ...entry, frames: [entry.frames[0], { file: 'shape.ts', line: 6 }] }],
      ['x'],
      ws,
    )
    expect(privateValue).not.toContain('private-fixture-literal')
    const spoof = await privatePreflightDiagnostics([{ ...entry, messageDigest: codingDigest('unknown') }], ['x'], ws)
    expect(spoof).not.toContain('item.record.owner')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
