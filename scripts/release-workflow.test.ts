import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const releaseWorkflowPath = join(process.cwd(), '.github/workflows/release.yml')
const verifyWorkflowPath = join(process.cwd(), '.github/workflows/verify.yml')

function readWorkflow(path: string) {
  return readFileSync(path, 'utf8').replace(/\r\n?/g, '\n')
}

function jobBlock(workflow: string, jobId: string) {
  const marker = `  ${jobId}:\n`
  const start = workflow.indexOf(marker)
  if (start < 0) {
    throw new Error(`Missing workflow job: ${jobId}`)
  }

  const contentStart = start + marker.length
  const remaining = workflow.slice(contentStart)
  const nextJob = remaining.match(/^  [a-zA-Z0-9_-]+:\n/m)
  const end = nextJob?.index === undefined ? workflow.length : contentStart + nextJob.index
  return workflow.slice(start, end)
}

describe('GitHub release workflow', () => {
  it('runs every deterministic release gate before publishing artifacts', () => {
    expect(existsSync(releaseWorkflowPath)).toBe(true)

    const workflow = readWorkflow(releaseWorkflowPath)

    expect(workflow).toContain('name: Release')
    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).toContain('tags:')
    expect(workflow).toContain("'v*'")
    expect(workflow).toContain('contents: write')
    expect(workflow).toContain('corepack pnpm verify')
    expect(workflow).toContain('corepack pnpm build')
    expect(workflow).toContain('corepack pnpm test:build-output-smoke')
    expect(workflow).toContain('corepack pnpm test:e2e')
    expect(workflow).toContain('corepack pnpm test:electron-smoke')
    expect(workflow).toContain('corepack pnpm test:postgres-smoke')
    expect(workflow).toContain('corepack pnpm test:docker-smoke')
    expect(workflow).toContain('windows-compatibility:')
    expect(workflow).toContain('runs-on: windows-latest')
    expect(workflow).toContain('--mode=pre-tag')
    expect(workflow).toContain('--mode=tagged')
    expect(workflow).toContain('actions/upload-artifact@v4')
    expect(workflow).toContain('gh release create')
    expect(workflow).toContain('gh release upload')
    expect(workflow).not.toContain('DEVFLOW_RUN_OPENCODE_SMOKE=1')
    expect(workflow).not.toContain('test:opencode-smoke')
  })

  it('checks out the signoff parent history and tags before release status', () => {
    const workflow = readWorkflow(releaseWorkflowPath)
    const windowsJob = jobBlock(workflow, 'windows-compatibility')
    const artifactsJob = jobBlock(workflow, 'release-artifacts')

    expect(windowsJob).toMatch(
      /- uses: actions\/checkout@v4\n\s+with:\n\s+fetch-depth: 2[\s\S]*?corepack pnpm test/,
    )
    expect(artifactsJob).toMatch(
      /- uses: actions\/checkout@v4\n\s+with:\n\s+fetch-depth: 2\n\s+fetch-tags: true[\s\S]*?release:status/,
    )
  })

  it('uses a slash-safe artifact label for manual branch dispatches', () => {
    const workflow = readWorkflow(releaseWorkflowPath)

    expect(workflow).toContain('VERSION="$(node scripts/release-artifact-label.mjs)"')
    expect(workflow).not.toContain('VERSION="${GITHUB_REF_NAME:-manual-${GITHUB_RUN_NUMBER}}"')
  })
})

describe('GitHub verify workflow', () => {
  it('can be dispatched against an exact release-candidate ref with its parent history', () => {
    const workflow = readWorkflow(verifyWorkflowPath)
    const macosJob = jobBlock(workflow, 'macos-verify')
    const windowsJob = jobBlock(workflow, 'windows-compatibility')

    expect(workflow).toMatch(/on:\n(?:.|\n)*?workflow_dispatch:/)
    expect(macosJob).toMatch(
      /- uses: actions\/checkout@v4\n\s+with:\n\s+fetch-depth: 2[\s\S]*?corepack pnpm verify/,
    )
    expect(windowsJob).toMatch(
      /- uses: actions\/checkout@v4\n\s+with:\n\s+fetch-depth: 2[\s\S]*?corepack pnpm test/,
    )
  })

  it('runs deterministic build, output, browser, desktop, Postgres, and Docker gates', () => {
    expect(existsSync(verifyWorkflowPath)).toBe(true)

    const workflow = readWorkflow(verifyWorkflowPath)

    expect(workflow).toContain('corepack pnpm verify')
    expect(workflow).toContain('corepack pnpm build')
    expect(workflow).toContain('corepack pnpm test:build-output-smoke')
    expect(workflow).toContain('corepack pnpm test:e2e')
    expect(workflow).toContain('corepack pnpm test:electron-smoke')
    expect(workflow).toContain('corepack pnpm test:postgres-smoke')
    expect(workflow).toContain('corepack pnpm test:docker-smoke')
    expect(workflow).not.toContain('DEVFLOW_RUN_OPENCODE_SMOKE=1')
    expect(workflow).not.toContain('test:opencode-smoke')
  })
})
