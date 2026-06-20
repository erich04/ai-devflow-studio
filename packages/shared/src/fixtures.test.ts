import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { knowledgeDocuments, knowledgeSources, projects, runs } from './fixtures'

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, '\n')
}

function listMarkdownFiles(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const absolutePath = join(root, entry)
    const relativePath = absolutePath.replace(`${process.cwd()}/`, '')
    if (statSync(absolutePath).isDirectory()) {
      return listMarkdownFiles(absolutePath)
    }
    return relativePath.endsWith('.md') ? [relativePath] : []
  })
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

  it('indexes every Git Markdown knowledge source file', () => {
    const markdownFiles = listMarkdownFiles(join(process.cwd(), 'docs/knowledge')).sort()
    const sourcePaths = knowledgeSources.map((source) => source.sourcePath).sort()

    expect(sourcePaths).toEqual(markdownFiles)
  })

  it('includes runtime and demo readiness checklists in the indexed knowledge documents', () => {
    expect(knowledgeDocuments.map((document) => document.sourcePath)).toEqual(
      expect.arrayContaining([
        'docs/knowledge/checklists/electron-demo-readiness.md',
        'docs/knowledge/checklists/opencode-runtime-signoff.md',
        'docs/knowledge/checklists/postgres-smoke-readiness.md',
        'docs/knowledge/checklists/v09-demo-readiness.md',
      ]),
    )
  })
})
