import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const signoffPath = join(process.cwd(), 'docs/plans/v0.8.1-release-signoff.md')

describe('v0.8.1 release signoff documentation', () => {
  it('keeps the manual walkthrough gate honest about Computer Use limitations', () => {
    const markdown = readFileSync(signoffPath, 'utf8')

    expect(markdown).toContain('Manual walkthrough')
    expect(markdown).toContain('Computer Use successfully read the real Electron window')
    expect(markdown).toContain('blocked_policy_unavailable')
    expect(markdown).toContain('Remediation Plan')
    expect(markdown).toContain('noWindowsAvailable')
    expect(markdown).toContain('click-based walkthrough is pending')
    expect(markdown).toContain('corepack pnpm test:e2e')
    expect(markdown).toContain('corepack pnpm test:electron-smoke')
    expect(markdown).toContain('do')
    expect(markdown).toContain('not replace the final human walkthrough gate')
  })
})
