import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const acceptancePath = join(process.cwd(), 'docs/product/design-references/airbnb-iii-visual-acceptance.md')
const captureScriptPath = join(process.cwd(), 'scripts/capture-desktop-visuals.mjs')

describe('Airbnb-III visual acceptance workflow', () => {
  it('documents the seven reference surfaces and the pixel-completion gate', () => {
    const markdown = readFileSync(acceptancePath, 'utf8')

    expect(markdown).toContain('corepack pnpm visual:desktop')
    expect(markdown).toContain('Do not claim pixel-level completion until every row below is `pass`.')
    expect(markdown).toContain('airbnb-iii-workbench-reference.png')
    expect(markdown).toContain('airbnb-iii-team-policy-reference.png')
    expect(markdown).toContain('airbnb-iii-knowledge-reference.png')
    expect(markdown).toContain('airbnb-iii-agents-reference.png')
    expect(markdown).toContain('airbnb-iii-skills-reference.png')
    expect(markdown).toContain('airbnb-iii-mcp-reference.png')
    expect(markdown).toContain('airbnb-iii-tests-reference.png')
  })

  it('writes a capture manifest with route, viewport, and reference provenance', () => {
    const script = readFileSync(captureScriptPath, 'utf8')

    expect(script).toContain("manifest.json")
    expect(script).toContain("generatedAt")
    expect(script).toContain("referenceDirectory: 'docs/product/design-references'")
    expect(script).toContain("3840x2160")
    expect(script).toContain("workbench")
    expect(script).toContain("tests")
  })
})
