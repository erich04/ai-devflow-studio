import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  indexKnowledgeSources,
  type KnowledgeChunk,
  type KnowledgeDocument,
  type KnowledgeSourceFile,
  type LocalProject,
} from '@ai-devflow/shared'

const execFile = promisify(execFileCallback)
const MAX_FILE_BYTES = 256 * 1024
const MAX_FILES = 256
const MAX_TOTAL_BYTES = 4 * 1024 * 1024
const MAX_TOTAL_CHARACTERS = 2_000_000
const MAX_CHUNKS = 4_096
const EXCLUDED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  'coverage',
  '.cache',
  '.parcel-cache',
  '.turbo',
  '.vite',
])

function pathIdentifier(sourcePath: string): string {
  return createHash('sha256').update(sourcePath).digest('hex').slice(0, 20)
}

function isInsideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' &&
    !path.isAbsolute(relative)
}

function isExcludedPath(sourcePath: string): boolean {
  return sourcePath.split('/').slice(0, -1).some((segment) =>
    EXCLUDED_DIRECTORIES.has(segment) ||
    (segment.startsWith('.') && segment.toLocaleLowerCase().includes('cache')),
  )
}

async function resolveSafeRegularFile(
  root: string,
  sourcePath: string,
): Promise<string | null> {
  if (
    path.posix.isAbsolute(sourcePath) ||
    sourcePath.includes('\\') ||
    path.posix.normalize(sourcePath) !== sourcePath ||
    sourcePath.split('/').includes('..')
  ) {
    return null
  }

  let candidate = root
  for (const segment of sourcePath.split('/')) {
    candidate = path.join(candidate, segment)
    const metadata = await lstat(candidate)
    if (metadata.isSymbolicLink()) return null
  }
  const resolved = await realpath(candidate)
  if (!isInsideRoot(root, resolved)) return null
  return (await lstat(resolved)).isFile() ? resolved : null
}

async function readSafeRegularFile(
  root: string,
  sourcePath: string,
): Promise<{ content: Buffer } | { tooLarge: true } | null> {
  const safePath = await resolveSafeRegularFile(root, sourcePath)
  if (!safePath) return null

  const handle = await open(safePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
  try {
    const metadata = await handle.stat()
    if (!metadata.isFile()) return null
    if (metadata.size > MAX_FILE_BYTES) return { tooLarge: true }
    const resolvedAfterOpen = await realpath(safePath)
    if (!isInsideRoot(root, resolvedAfterOpen)) return null
    const content = await handle.readFile()
    return content.byteLength > MAX_FILE_BYTES ? { tooLarge: true } : { content }
  } finally {
    await handle.close()
  }
}

function remapStableKnowledgeIds(index: {
  documents: KnowledgeDocument[]
  chunks: KnowledgeChunk[]
}): { documents: KnowledgeDocument[]; chunks: KnowledgeChunk[] } {
  const documentIds = new Map(index.documents.map((document) => [
    document.sourcePath,
    `repository-knowledge-document-${pathIdentifier(document.sourcePath)}`,
  ]))
  const chunkCounts = new Map<string, number>()

  return {
    documents: index.documents.map((document) => ({
      ...document,
      id: documentIds.get(document.sourcePath)!,
    })),
    chunks: index.chunks.map((chunk) => {
      const chunkNumber = (chunkCounts.get(chunk.sourcePath) ?? 0) + 1
      chunkCounts.set(chunk.sourcePath, chunkNumber)
      const documentId = documentIds.get(chunk.sourcePath)!
      return {
        ...chunk,
        id: `${documentId}-chunk-${chunkNumber}`,
        documentId,
      }
    }),
  }
}

function splitMarkdownChunkSegments(markdown: string): string[] {
  const segments: string[] = []
  let currentLines: string[] = []

  for (const line of markdown.split('\n')) {
    if (/^(#{1,3})\s+(.+)$/u.test(line.trim()) && currentLines.join('\n').trim()) {
      segments.push(currentLines.join('\n'))
      currentLines = []
    }
    currentLines.push(line)
  }
  if (currentLines.join('\n').trim()) segments.push(currentLines.join('\n'))
  return segments.length > 0 ? segments : [markdown]
}

function boundSourcesForChunkLimit(sources: KnowledgeSourceFile[]): {
  sources: KnowledgeSourceFile[]
  truncated: boolean
} {
  let usedChunks = 0
  let truncated = false
  const bounded = sources.map((source, index) => {
    const remainingDocuments = sources.length - index - 1
    const availableChunks = Math.max(1, MAX_CHUNKS - usedChunks - remainingDocuments)
    const segments = splitMarkdownChunkSegments(source.markdown)
    const acceptedSegments = segments.slice(0, availableChunks)
    usedChunks += acceptedSegments.length
    if (acceptedSegments.length < segments.length) truncated = true
    return acceptedSegments.length === segments.length
      ? source
      : { ...source, markdown: acceptedSegments.join('\n') }
  })
  return { sources: bounded, truncated }
}

export type RepositoryKnowledgeWarning =
  | 'unsafe_path_skipped'
  | 'path_limit_exceeded'
  | 'depth_limit_exceeded'
  | 'file_count_limit_exceeded'
  | 'file_size_limit_exceeded'
  | 'total_size_limit_exceeded'
  | 'character_limit_exceeded'
  | 'chunk_limit_exceeded'

const WARNING_ORDER: readonly RepositoryKnowledgeWarning[] = [
  'unsafe_path_skipped',
  'path_limit_exceeded',
  'depth_limit_exceeded',
  'file_count_limit_exceeded',
  'file_size_limit_exceeded',
  'total_size_limit_exceeded',
  'character_limit_exceeded',
  'chunk_limit_exceeded',
]

export type RepositoryKnowledgeSnapshot = {
  projectId: string
  contentHash: string
  documents: KnowledgeDocument[]
  chunks: KnowledgeChunk[]
  indexedAt: string
  truncated: boolean
  warnings: RepositoryKnowledgeWarning[]
}

export type RepositoryKnowledgeService = {
  index(project: LocalProject): Promise<RepositoryKnowledgeSnapshot>
}

export function createRepositoryKnowledgeService(options: {
  now?: () => string
} = {}): RepositoryKnowledgeService {
  const now = options.now ?? (() => new Date().toISOString())

  return {
    async index(project) {
      const indexedAt = now()
      const root = await realpath(project.path)
      const { stdout } = await execFile(
        'git',
        ['ls-files', '-z', '--cached', '--', '*.md', '*.markdown'],
        { cwd: root, maxBuffer: 2 * 1024 * 1024 },
      )
      const relativePaths = stdout
        .split('\0')
        .filter(Boolean)
        .sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
      const warnings = new Set<RepositoryKnowledgeWarning>()
      const sources: KnowledgeSourceFile[] = []
      let totalBytes = 0
      let totalCharacters = 0
      let inspectedCandidates = 0
      for (const sourcePath of relativePaths) {
        if (isExcludedPath(sourcePath)) continue
        if (sourcePath.length > 1_024 || Buffer.byteLength(sourcePath, 'utf8') > 1_024) {
          warnings.add('path_limit_exceeded')
          continue
        }
        if (sourcePath.split('/').length - 1 > 16) {
          warnings.add('depth_limit_exceeded')
          continue
        }
        if (inspectedCandidates >= MAX_FILES) {
          warnings.add('file_count_limit_exceeded')
          break
        }
        inspectedCandidates += 1
        let file: Awaited<ReturnType<typeof readSafeRegularFile>>
        try {
          file = await readSafeRegularFile(root, sourcePath)
        } catch {
          file = null
        }
        if (!file) {
          warnings.add('unsafe_path_skipped')
          continue
        }
        if ('tooLarge' in file) {
          warnings.add('file_size_limit_exceeded')
          continue
        }
        const { content } = file
        if (totalBytes + content.byteLength > MAX_TOTAL_BYTES) {
          warnings.add('total_size_limit_exceeded')
          break
        }
        const markdown = content.toString('utf8')
        const characterCount = Array.from(markdown).length
        if (totalCharacters + characterCount > MAX_TOTAL_CHARACTERS) {
          warnings.add('character_limit_exceeded')
          break
        }
        totalBytes += content.byteLength
        totalCharacters += characterCount
        sources.push({
          sourcePath,
          markdown,
          updatedAt: indexedAt,
        })
      }
      const boundedSources = boundSourcesForChunkLimit(sources)
      if (boundedSources.truncated) warnings.add('chunk_limit_exceeded')
      const index = indexKnowledgeSources(boundedSources.sources)
      const fullMarkdownByPath = new Map(sources.map((source) => [
        source.sourcePath,
        source.markdown,
      ]))
      index.documents = index.documents.map((document) => ({
        ...document,
        markdown: fullMarkdownByPath.get(document.sourcePath)!,
      }))
      const remappedIndex = remapStableKnowledgeIds(index)
      if (remappedIndex.chunks.length > MAX_CHUNKS) {
        warnings.add('chunk_limit_exceeded')
        remappedIndex.chunks.length = MAX_CHUNKS
      }
      const contentHash = createHash('sha256')
        .update(JSON.stringify(sources.map(({ sourcePath, markdown }) => ({ sourcePath, markdown }))))
        .digest('hex')

      return {
        projectId: project.id,
        contentHash: `sha256:${contentHash}`,
        documents: remappedIndex.documents,
        chunks: remappedIndex.chunks,
        indexedAt,
        truncated: warnings.size > 0,
        warnings: WARNING_ORDER.filter((warning) => warnings.has(warning)),
      }
    },
  }
}
