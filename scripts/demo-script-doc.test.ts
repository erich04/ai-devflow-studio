import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('v0.9 demo script documentation', () => {
  it('documents the 5-minute real-runtime demo path and release-safe boundaries', () => {
    const markdown = readFileSync(
      join(process.cwd(), 'docs/guides/devflow-studio-v0.9-demo-script.md'),
      'utf8',
    )

    expect(markdown).toContain('# DevFlow Studio v0.9 演示脚本')
    expect(markdown).toContain('corepack pnpm opencode:status')
    expect(markdown).toContain('corepack pnpm test:opencode-smoke')
    expect(markdown).toContain('Gate Enforcement')
    expect(markdown).toContain('Remediation Plan')
    expect(markdown).toContain('Retry Coding')
    expect(markdown).toContain('real opencode')
    expect(markdown).toContain('Team Overview')
    expect(markdown).toContain('不要宣称')
  })
})
