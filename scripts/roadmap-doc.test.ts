import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const roadmapPath = join(process.cwd(), 'docs/roadmap.md')

describe('product roadmap north star', () => {
  it('keeps future planning anchored to the team pilot product direction', () => {
    const markdown = readFileSync(roadmapPath, 'utf8')

    expect(markdown).toContain('## Product North Star')
    expect(markdown).toContain('small-team self-hosted AI DevFlow workbench')
    expect(markdown).toContain('v1.0.x')
    expect(markdown).toContain('v1.1 Runtime Cost + Budget Guard')
    expect(markdown).toContain('v2.0')
    expect(markdown).toContain('public SaaS')
    expect(markdown).toContain('Next concrete action')
  })
})
