import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoots = ['apps', 'packages', 'scripts', 'tests']
const sourceExtensions = new Set(['.ts', '.tsx', '.mjs'])
const ignoredDirectoryNames = new Set([
  '.next',
  '.tmp',
  'coverage',
  'dist',
  'dist-electron',
  'node_modules',
  'out',
  'outputs',
  'playwright-report',
  'test-results',
])
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
      if (ignoredDirectoryNames.has(entry)) {
        continue
      }
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

function normalizeRepositoryPath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/')
}

function isAllowedProductionFixtureImport(relativePath: string): boolean {
  return allowedProductionFixtureImports.has(normalizeRepositoryPath(relativePath))
}

describe('demo fixture boundary', () => {
  it('recognizes an allowed production fixture import when the repository path uses Windows separators', () => {
    expect(isAllowedProductionFixtureImport('apps\\api\\src\\db\\seed-demo.ts')).toBe(true)
  })

  it('does not expose fixtures or scan dependency and build-output trees', () => {
    const indexSource = readFileSync(path.join(rootDir, 'packages/shared/src/index.ts'), 'utf8')

    expect(indexSource).not.toContain("export * from './fixtures'")
    for (const directory of ['node_modules', '.next', 'dist', 'dist-electron']) {
      expect(ignoredDirectoryNames.has(directory)).toBe(true)
    }
  })

  it('keeps production fixture imports limited to explicit demo data entrypoints', () => {
    const offenders: string[] = []

    for (const sourceRoot of sourceRoots) {
      for (const file of walkFiles(path.join(rootDir, sourceRoot))) {
        const relativePath = normalizeRepositoryPath(path.relative(rootDir, file))
        const source = readFileSync(file, 'utf8')
        const importsFixtures =
          source.includes('@ai-devflow/shared/fixtures') ||
          source.includes("from './fixtures'") ||
          source.includes('from "./fixtures"')

        if (!importsFixtures || isTestFile(relativePath)) {
          continue
        }

        if (!isAllowedProductionFixtureImport(relativePath)) {
          offenders.push(relativePath)
        }
      }
    }

    expect(offenders).toEqual([])
  })
})
