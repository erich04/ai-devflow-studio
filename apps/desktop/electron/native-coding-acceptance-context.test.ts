// @vitest-environment node
import { expect, it } from 'vitest'
import { acceptanceContext, fixtureInputExamples } from './native-coding-acceptance-context'
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
