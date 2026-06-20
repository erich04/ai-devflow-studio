import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const workflowPath = join(process.cwd(), '.github/workflows/release.yml')

describe('GitHub release workflow', () => {
  it('publishes build artifacts only from explicit releases', () => {
    expect(existsSync(workflowPath)).toBe(true)

    const workflow = readFileSync(workflowPath, 'utf8')

    expect(workflow).toContain('name: Release')
    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).toContain('tags:')
    expect(workflow).toContain("'v*'")
    expect(workflow).toContain('contents: write')
    expect(workflow).toContain('corepack pnpm verify')
    expect(workflow).toContain('corepack pnpm build')
    expect(workflow).toContain('corepack pnpm test:postgres-smoke')
    expect(workflow).toContain('actions/upload-artifact@v4')
    expect(workflow).toContain('gh release create')
    expect(workflow).toContain('gh release upload')
    expect(workflow).not.toContain('DEVFLOW_RUN_OPENCODE_SMOKE=1')
  })
})
