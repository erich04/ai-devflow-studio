import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoots = ['apps', 'packages', 'scripts', 'tests']
const sourceExtensions = new Set(['.ts', '.tsx', '.mjs'])
const allowedProductionFixtureImports = new Set([
  'apps/api/src/db/cleanup-demo.ts',
  'apps/api/src/db/seed-demo.ts',
  'apps/api/src/repositories/team-repository.ts',
])

function walkFiles(dir: string): string[] {
  const entries = readdirSync(dir)
  const files: string[] = []

  for (const entry of entries) {
    const absolute = path.join(dir, entry)
    const stat = statSync(absolute)
    if (stat.isDirectory()) {
      files.push(...walkFiles(absolute))
      continue
    }

    if (sourceExtensions.has(path.extname(entry))) {
      files.push(absolute)
    }
  }

  return files
}

function isTestFile(relativePath: string): boolean {
  return /\.test\.[cm]?[tj]sx?$/.test(relativePath)
}

describe('demo fixture boundary', () => {
  it('does not expose fixtures from the shared public barrel', () => {
    const indexSource = readFileSync(path.join(rootDir, 'packages/shared/src/index.ts'), 'utf8')

    expect(indexSource).not.toContain("export * from './fixtures'")
  })

  it('keeps production fixture imports limited to explicit demo data entrypoints', () => {
    const offenders: string[] = []

    for (const sourceRoot of sourceRoots) {
      for (const file of walkFiles(path.join(rootDir, sourceRoot))) {
        const relativePath = path.relative(rootDir, file)
        const source = readFileSync(file, 'utf8')
        const importsFixtures =
          source.includes('@ai-devflow/shared/fixtures') ||
          source.includes("from './fixtures'") ||
          source.includes('from "./fixtures"')

        if (!importsFixtures || isTestFile(relativePath)) {
          continue
        }

        if (!allowedProductionFixtureImports.has(relativePath)) {
          offenders.push(relativePath)
        }
      }
    }

    expect(offenders).toEqual([])
  })
})
