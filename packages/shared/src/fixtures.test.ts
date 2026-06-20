import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { knowledgeDocuments, knowledgeSources, projects, runs } from './fixtures'

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, '\n')
}

describe('fixtures product narrative', () => {
  it('does not expose HoneyAI or opencode as active DevFlow product fixtures', () => {
    const serialized = JSON.stringify({ projects, runs })

    expect(serialized).not.toMatch(/HoneyAI/)
    expect(serialized).not.toMatch(/xiaohanarch\/HoneyAI/)
    expect(serialized).not.toMatch(/opencode adapter/)
  })
})

describe('knowledge source fixtures', () => {
  it('mirror the Git Markdown knowledge source files', () => {
    for (const source of knowledgeSources) {
      const markdown = readFileSync(join(process.cwd(), source.sourcePath), 'utf8')
      expect(normalizeLineEndings(source.markdown)).toBe(normalizeLineEndings(markdown))
    }
  })

  it('includes the opencode runtime signoff checklist in the indexed knowledge documents', () => {
    expect(knowledgeDocuments).toContainEqual(
      expect.objectContaining({
        sourcePath: 'docs/knowledge/checklists/opencode-runtime-signoff.md',
        title: 'opencode Runtime Signoff Checklist',
      }),
    )
  })
})
