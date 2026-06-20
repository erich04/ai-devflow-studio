import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const userGuidePath = join(process.cwd(), 'docs/guides/devflow-studio-v0.8-user-guide.md')
const userGuideDir = dirname(userGuidePath)

function readUserGuide(): string {
  return readFileSync(userGuidePath, 'utf8')
}

function extractImagePaths(markdown: string): string[] {
  return Array.from(markdown.matchAll(/!\[[^\]]*]\(([^)]+)\)/g)).map((match) => match[1])
}

describe('v0.8 user guide documentation', () => {
  it('keeps every referenced screenshot available on disk', () => {
    const markdown = readUserGuide()
    const imagePaths = extractImagePaths(markdown)

    expect(imagePaths.length).toBeGreaterThanOrEqual(8)
    expect(imagePaths).toEqual(
      expect.arrayContaining([
        './screenshots/14-electron-current-userdata-workbench.png',
        './screenshots/02-search-filter.png',
        './screenshots/05-tests-evidence.png',
        './screenshots/12-electron-knowledge.png',
        './screenshots/04-agent-workbench.png',
        './screenshots/09-coding-node.png',
        './screenshots/11-electron-team-overview.png',
        './screenshots/08-team-overview.png',
      ]),
    )

    for (const imagePath of imagePaths) {
      expect(existsSync(join(userGuideDir, imagePath))).toBe(true)
    }
  })

  it('documents the release-candidate demo and signoff workflow', () => {
    const markdown = readUserGuide()

    expect(markdown).toContain('corepack pnpm dev:electron')
    expect(markdown).toContain('Gate Enforcement')
    expect(markdown).toContain('Remediation Plan')
    expect(markdown).toContain('Retry Coding')
    expect(markdown).toContain('Knowledge Review Agent')
    expect(markdown).toContain('Team Overview')
    expect(markdown).toContain('corepack pnpm verify')
    expect(markdown).toContain('corepack pnpm build')
    expect(markdown).toContain('corepack pnpm release:status')
    expect(markdown).toContain('corepack pnpm opencode:status')
    expect(markdown).toContain('DEVFLOW_DATABASE_URL=')
    expect(markdown).toContain('231 个 unit tests')
    expect(markdown).toContain('GitHub Actions')
    expect(markdown).toContain('billing/spending-limit')
  })
})
