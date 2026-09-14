import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const packagePaths = [
  'package.json',
  'packages/shared/package.json',
  'apps/desktop/package.json',
  'apps/api/package.json',
  'apps/web/package.json',
  'apps/worker/package.json',
]

describe('V2.3 package version alignment', () => {
  it('keeps every first-party package on the exact V2.3 release version', () => {
    const versions = Object.fromEntries(
      packagePaths.map((packagePath) => [
        packagePath,
        (JSON.parse(readFileSync(packagePath, 'utf8')) as { version?: unknown }).version,
      ]),
    )

    expect(versions).toEqual(
      Object.fromEntries(packagePaths.map((packagePath) => [packagePath, '2.3.0'])),
    )
  })
})
