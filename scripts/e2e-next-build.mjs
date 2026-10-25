import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

/** A private compiler/cache directory for a test server sharing a source checkout. */
export async function createIsolatedNextBuild(webDir) {
  await mkdir(path.join(webDir, '.tmp'), { recursive: true })
  const directory = await mkdtemp(path.join(webDir, '.tmp', 'next-e2e-'))
  const distDir = path.relative(webDir, directory).split(path.sep).join('/')
  const declarations = path.join(webDir, 'next-env.d.ts')
  const tsconfigPath = path.join(webDir, 'tsconfig.json')
  const originalTsconfig = await readFile(tsconfigPath, 'utf8')
  const originalDeclarations = await readFile(declarations, 'utf8')
  const originalRouteReference = originalDeclarations.split('\n').find(line => line.includes('/types/routes.d.ts'))
  return {
    env: { DEVFLOW_E2E_NEXT_DIST_DIR: distDir },
    async close() {
      // Next adds its generated types to shared source configuration. Remove only our own additions.
      const tsconfig = JSON.parse(await readFile(tsconfigPath, 'utf8'))
      if (tsconfig.include?.includes(`${distDir}/types/**/*.ts`)) {
        tsconfig.include = tsconfig.include.filter(value => value !== `${distDir}/types/**/*.ts`)
        const comparable = value => JSON.stringify({ ...value, ...(value.include ? { include: [...value.include].sort() } : {}) })
        await writeFile(tsconfigPath, comparable(tsconfig) === comparable(JSON.parse(originalTsconfig)) ? originalTsconfig : JSON.stringify(tsconfig, null, 2) + '\n')
      }
      const currentDeclarations = await readFile(declarations, 'utf8')
      const reference = `/// <reference path="./${distDir}/types/routes.d.ts" />`
      if (currentDeclarations.includes(reference)) {
        await writeFile(declarations, currentDeclarations.replace(reference, originalRouteReference ?? ''))
      }
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
    },
  }
}
