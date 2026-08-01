import { execFile as execFileCallback } from 'node:child_process'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import type { LocalProject } from '@ai-devflow/shared'
import type { RepositoryKnowledgeSnapshot } from '@ai-devflow/shared'
import { createRepositoryKnowledgeService } from './repository-knowledge'

const execFile = promisify(execFileCallback)
const indexedAt = '2026-08-01T12:00:00.000Z'
const tempDirectories: string[] = []

afterEach(async () => {
  await Promise.all(tempDirectories.map((directory) =>
    rm(directory, { recursive: true, force: true }),
  ))
  tempDirectories.length = 0
})

async function createTrackedRepository(
  files: Record<string, string | Buffer>,
): Promise<LocalProject> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devflow-knowledge-'))
  tempDirectories.push(root)
  await execFile('git', ['init', '--quiet'], { cwd: root })

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath)
    await mkdir(path.dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, content)
  }
  if (Object.keys(files).length > 0) {
    await execFile('git', ['add', '--', ...Object.keys(files)], { cwd: root })
  }

  return {
    id: 'project-repository-knowledge',
    name: 'repository-knowledge',
    path: root,
    packageManager: 'pnpm',
    detectedTestCommand: 'pnpm test',
    testCommand: 'pnpm test -- --run',
    createdAt: indexedAt,
    updatedAt: indexedAt,
  }
}

describe('createRepositoryKnowledgeService', () => {
  it('indexes Git-managed Markdown in canonical path order with a deterministic snapshot hash', async () => {
    const project = await createTrackedRepository({
      'z-last.markdown': '# Last\n\nLast guidance.',
      'docs/a-first.md': '# First\n\nFirst guidance.',
      'ignored.txt': 'not Markdown',
    })
    await writeFile(path.join(project.path, 'untracked.md'), '# Untracked')
    const service = createRepositoryKnowledgeService({ now: () => indexedAt })

    const first = await service.index(project)
    const second = await service.index(project)

    expect(first).toEqual(second)
    expect(first).toMatchObject({
      projectId: project.id,
      indexedAt,
      truncated: false,
      warnings: [],
      contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    })
    expect(first.documents.map((document) => document.sourcePath)).toEqual([
      'docs/a-first.md',
      'z-last.markdown',
    ])
    expect(first.chunks.map((chunk) => chunk.sourcePath)).toEqual([
      'docs/a-first.md',
      'z-last.markdown',
    ])

    await writeFile(path.join(project.path, 'docs/a-first.md'), '# First\n\nChanged guidance.')
    const changed = await service.index(project)
    expect(changed.contentHash).not.toBe(first.contentHash)
  })

  it('assigns stable unique document and chunk IDs when basenames repeat', async () => {
    const project = await createTrackedRepository({
      'docs/guide.md': '# Docs Guide\n\nDocument guidance.',
      'standards/guide.md': '# Standards Guide\n\nStandards guidance.',
    })
    const service = createRepositoryKnowledgeService({ now: () => indexedAt })

    const first = await service.index(project)
    const second = await service.index(project)

    expect(new Set(first.documents.map(({ id }) => id)).size).toBe(2)
    expect(new Set(first.chunks.map(({ id }) => id)).size).toBe(2)
    expect(first.documents.map(({ id }) => id)).toEqual(second.documents.map(({ id }) => id))
    expect(first.chunks.map(({ id }) => id)).toEqual(second.chunks.map(({ id }) => id))
    expect(first.chunks.map(({ documentId }) => documentId)).toEqual(
      first.documents.map(({ id }) => id),
    )
  })

  it('keeps duplicate-basename graph entities and tag relations unique and consistently remapped', async () => {
    const project = await createTrackedRepository({
      'docs/guide.md': [
        '---',
        'tags: [shared, security]',
        '---',
        '# Docs Guide',
      ].join('\n'),
      'standards/guide.md': [
        '---',
        'tags: [shared, quality]',
        '---',
        '# Standards Guide',
      ].join('\n'),
    })
    const service = createRepositoryKnowledgeService({ now: () => indexedAt })

    const first = await service.index(project)
    const second = await service.index(project)
    const documentIds = new Set(first.documents.map(({ id }) => id))
    const documentEntities = first.entities.filter(({ kind }) => kind !== 'term')
    const termEntities = first.entities.filter(({ kind }) => kind === 'term')

    expect(documentEntities.map(({ id }) => id)).toEqual(first.documents.map(({ id }) => id))
    expect(new Set(first.entities.map(({ id }) => id)).size).toBe(first.entities.length)
    expect(termEntities.map(({ label }) => label).sort()).toEqual(['quality', 'security', 'shared'])
    expect(first.relations).toHaveLength(4)
    expect(new Set(first.relations.map(({ id }) => id)).size).toBe(first.relations.length)
    expect(first.relations.every(({ source }) => documentIds.has(source))).toBe(true)
    expect(first.relations.every(({ target }) =>
      termEntities.some(({ id }) => id === target),
    )).toBe(true)
    expect(first.entities).toEqual(second.entities)
    expect(first.relations).toEqual(second.relations)
  })

  it('does not follow a Git-managed Markdown symlink outside the project root', async () => {
    const project = await createTrackedRepository({})
    const outside = await mkdtemp(path.join(os.tmpdir(), 'devflow-knowledge-outside-'))
    tempDirectories.push(outside)
    const secretPath = path.join(outside, 'secret.md')
    await writeFile(secretPath, '# Secret\n\nMust not be indexed.')
    await symlink(secretPath, path.join(project.path, 'leak.md'))
    await execFile('git', ['add', '--', 'leak.md'], { cwd: project.path })

    const snapshot = await createRepositoryKnowledgeService({ now: () => indexedAt }).index(project)

    expect(snapshot.documents).toEqual([])
    expect(snapshot.chunks).toEqual([])
    expect(snapshot.truncated).toBe(true)
    expect(snapshot.warnings).toEqual(['unsafe_path_skipped'])
    expect(JSON.stringify(snapshot)).not.toContain(outside)
  })

  it('excludes generated dependency and hidden cache directories', async () => {
    const project = await createTrackedRepository({
      'docs/keep.md': '# Keep',
      'node_modules/package/readme.md': '# Dependency',
      'dist/generated.md': '# Dist',
      'build/generated.md': '# Build',
      '.next/cache.md': '# Next',
      'coverage/report.md': '# Coverage',
      '.cache/private.md': '# Cache',
      '.pytest_cache/private.md': '# Hidden tool cache',
    })

    const snapshot = await createRepositoryKnowledgeService({ now: () => indexedAt }).index(project)

    expect(snapshot.documents.map(({ sourcePath }) => sourcePath)).toEqual(['docs/keep.md'])
    expect(snapshot.truncated).toBe(false)
    expect(snapshot.warnings).toEqual([])
  })

  it('skips Markdown deeper than sixteen directories with a fixed safe warning', async () => {
    const tooDeep = `${Array.from({ length: 17 }, (_, index) => `d${index}`).join('/')}/deep.md`
    const project = await createTrackedRepository({
      'within-limit.md': '# Included',
      [tooDeep]: '# Too deep',
    })

    const snapshot = await createRepositoryKnowledgeService({ now: () => indexedAt }).index(project)

    expect(snapshot.documents.map(({ sourcePath }) => sourcePath)).toEqual(['within-limit.md'])
    expect(snapshot.truncated).toBe(true)
    expect(snapshot.warnings).toEqual(['depth_limit_exceeded'])
    expect(JSON.stringify(snapshot)).not.toContain(project.path)
  })

  it('skips a Markdown file larger than 256 KiB', async () => {
    const project = await createTrackedRepository({
      'small.md': '# Small',
      'oversized.md': Buffer.alloc(256 * 1024 + 1, 'a'),
    })

    const snapshot = await createRepositoryKnowledgeService({ now: () => indexedAt }).index(project)

    expect(snapshot.documents.map(({ sourcePath }) => sourcePath)).toEqual(['small.md'])
    expect(snapshot.truncated).toBe(true)
    expect(snapshot.warnings).toEqual(['file_size_limit_exceeded'])
  })

  it('indexes at most 256 Markdown files in canonical order', async () => {
    const files = Object.fromEntries(Array.from({ length: 257 }, (_, index) => [
      `docs/doc-${String(index).padStart(3, '0')}.md`,
      `# Document ${index}`,
    ]))
    const project = await createTrackedRepository(files)

    const snapshot = await createRepositoryKnowledgeService({ now: () => indexedAt }).index(project)

    expect(snapshot.documents).toHaveLength(256)
    expect(snapshot.documents.at(-1)?.sourcePath).toBe('docs/doc-255.md')
    expect(snapshot.truncated).toBe(true)
    expect(snapshot.warnings).toEqual(['file_count_limit_exceeded'])
  })

  it('bounds file-system inspection even when tracked Markdown candidates are unsafe', async () => {
    const project = await createTrackedRepository({ 'z-safe.md': '# Safe' })
    const outside = await mkdtemp(path.join(os.tmpdir(), 'devflow-knowledge-candidate-limit-'))
    tempDirectories.push(outside)
    const secretPath = path.join(outside, 'secret.md')
    await writeFile(secretPath, '# Outside')
    const unsafePaths = Array.from({ length: 257 }, (_, index) =>
      `a-unsafe-${String(index).padStart(3, '0')}.md`,
    )
    await Promise.all(
      unsafePaths.map((sourcePath) => symlink(secretPath, path.join(project.path, sourcePath))),
    )
    await execFile('git', ['add', '--', ...unsafePaths], { cwd: project.path })

    const snapshot = await createRepositoryKnowledgeService({ now: () => indexedAt }).index(project)

    expect(snapshot.documents).toEqual([])
    expect(snapshot.truncated).toBe(true)
    expect(snapshot.warnings).toEqual([
      'unsafe_path_skipped',
      'file_count_limit_exceeded',
    ])
  })

  it('caps total indexed Markdown bytes at 4 MiB', async () => {
    const almost256KiB = '界'.repeat(87_381)
    const files = Object.fromEntries(Array.from({ length: 17 }, (_, index) => [
      `docs/large-${String(index).padStart(2, '0')}.md`,
      almost256KiB,
    ]))
    const project = await createTrackedRepository(files)

    const snapshot = await createRepositoryKnowledgeService({ now: () => indexedAt }).index(project)

    expect(snapshot.documents).toHaveLength(16)
    expect(snapshot.truncated).toBe(true)
    expect(snapshot.warnings).toEqual(['total_size_limit_exceeded'])
  })

  it('caps total indexed Markdown characters at two million', async () => {
    const files = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [
      `docs/characters-${index}.md`,
      'a'.repeat(250_000),
    ]))
    const project = await createTrackedRepository(files)

    const snapshot = await createRepositoryKnowledgeService({ now: () => indexedAt }).index(project)

    expect(snapshot.documents).toHaveLength(8)
    expect(snapshot.truncated).toBe(true)
    expect(snapshot.warnings).toEqual(['character_limit_exceeded'])
  })

  it('returns at most 4096 indexed chunks with a fixed warning', async () => {
    const markdown = Array.from({ length: 4_097 }, (_, index) =>
      `# Heading ${index}\nContent ${index}.`,
    ).join('\n')
    const project = await createTrackedRepository({ 'many-headings.md': markdown })

    const snapshot = await createRepositoryKnowledgeService({ now: () => indexedAt }).index(project)

    expect(snapshot.documents).toHaveLength(1)
    expect(snapshot.chunks).toHaveLength(4_096)
    expect(snapshot.truncated).toBe(true)
    expect(snapshot.warnings).toEqual(['chunk_limit_exceeded'])

    const changedMarkdown = markdown.replace('Content 4096.', 'Changed beyond indexed chunks.')
    await writeFile(path.join(project.path, 'many-headings.md'), changedMarkdown)
    const changed = await createRepositoryKnowledgeService({ now: () => indexedAt }).index(project)
    expect(changed.contentHash).not.toBe(snapshot.contentHash)
    expect(changed.chunks).toEqual(snapshot.chunks)
  })

  it('skips a Git index entry whose relative POSIX path exceeds 1024 characters', async () => {
    const project = await createTrackedRepository({ 'seed.md': '# Seed' })
    const { stdout } = await execFile('git', ['hash-object', 'seed.md'], { cwd: project.path })
    const longPath = `${Array.from({ length: 5 }, () => 'x'.repeat(210)).join('/')}/too-long.md`
    await execFile(
      'git',
      ['update-index', '--add', '--cacheinfo', `100644,${stdout.trim()},${longPath}`],
      { cwd: project.path },
    )

    const snapshot = await createRepositoryKnowledgeService({ now: () => indexedAt }).index(project)

    expect(snapshot.documents.map(({ sourcePath }) => sourcePath)).toEqual(['seed.md'])
    expect(snapshot.truncated).toBe(true)
    expect(snapshot.warnings).toEqual(['path_limit_exceeded'])
  })

  it('returns an empty deterministic snapshot when the repository has no Markdown', async () => {
    const project = await createTrackedRepository({
      'README.txt': 'There is no Markdown here.',
    })
    const service = createRepositoryKnowledgeService({ now: () => indexedAt })

    const snapshot: RepositoryKnowledgeSnapshot = await service.index(project)

    expect(snapshot).toMatchObject({
      projectId: project.id,
      documents: [],
      chunks: [],
      indexedAt,
      truncated: false,
      warnings: [],
      contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    })
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot)
    await expect(service.index(project)).resolves.toEqual(snapshot)
  })
})
