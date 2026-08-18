import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('LocalStore architecture invariants', () => {
  it('keeps one atomic filesystem persistence outlet', async () => {
    const [storeSource, persistenceSource] = await Promise.all([
      readFile(path.join(process.cwd(), 'apps/desktop/electron/local-store.ts'), 'utf8'),
      readFile(
        path.join(process.cwd(), 'apps/desktop/electron/local-store-persistence.ts'),
        'utf8',
      ),
    ])

    expect(storeSource).toContain("from './local-store-persistence'")
    expect(storeSource).toContain("from './local-store-privacy'")
    expect(storeSource).toContain("from './local-store-workflow'")
    expect(storeSource).not.toMatch(/\brename\s*\(/u)
    expect(storeSource).not.toMatch(/\bwriteFile\s*\(/u)
    expect(persistenceSource.match(/\bwriteFile\s*\(/gu)).toHaveLength(1)
    expect(persistenceSource.match(/\brename\s*\(/gu)).toHaveLength(1)
    expect(persistenceSource).toContain('.tmp`')
    expect(persistenceSource.indexOf('writeFile(')).toBeLessThan(
      persistenceSource.indexOf('rename('),
    )
  })
})
