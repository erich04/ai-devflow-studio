// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { createIsolatedNextBuild } from './e2e-next-build.mjs'

it('isolates build directories and removes only its generated references during cleanup', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'next-build-isolation-'))
  try {
    const original = '/// <reference path="./.next/types/routes.d.ts" />\n'
    await writeFile(path.join(directory, 'next-env.d.ts'), original)
    await writeFile(path.join(directory, 'tsconfig.json'), JSON.stringify({ include: ['src/**/*.ts'] }))
    const first = await createIsolatedNextBuild(directory), second = await createIsolatedNextBuild(directory)
    const firstDir = first.env.DEVFLOW_E2E_NEXT_DIST_DIR, secondDir = second.env.DEVFLOW_E2E_NEXT_DIST_DIR
    expect(firstDir).not.toBe(secondDir)
    await writeFile(path.join(directory, firstDir, 'owned.txt'), 'owned')
    await writeFile(path.join(directory, secondDir, 'other.txt'), 'other')
    await writeFile(path.join(directory, 'next-env.d.ts'), `/// <reference path="./${firstDir}/types/routes.d.ts" />\n// independent edit\n`)
    await writeFile(path.join(directory, 'tsconfig.json'), JSON.stringify({ include: ['src/**/*.ts', `${firstDir}/types/**/*.ts`, `${secondDir}/types/**/*.ts`], independent: true }))
    await first.close()
    expect(await readFile(path.join(directory, 'next-env.d.ts'), 'utf8')).toBe(original + '// independent edit\n')
    expect(JSON.parse(await readFile(path.join(directory, 'tsconfig.json'), 'utf8'))).toEqual({ include: ['src/**/*.ts', `${secondDir}/types/**/*.ts`], independent: true })
    expect(await readFile(path.join(directory, secondDir, 'other.txt'), 'utf8')).toBe('other')
    await expect(readFile(path.join(directory, firstDir, 'owned.txt'))).rejects.toThrow()
    await second.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})
