import type {
  KnowledgeContextManifest,
  KnowledgeDocument,
  NodeStage,
  ProjectInstructionsSnapshot,
  RepositoryKnowledgeLinkTarget,
} from './domain'
import { knowledgeFrontMatterList, readKnowledgeFrontMatter } from './knowledge'
import {
  isKnowledgeStage,
  KNOWLEDGE_STAGES,
  PROJECT_INSTRUCTIONS_MAX_BYTES,
  summarizeKnowledgeStageBudgets,
  type KnowledgeStageBudgetSummary,
} from './knowledge-context'

/**
 * Deterministic checks of the project knowledge directory (knowledge-context plan K4).
 * They only inform the knowledge page: nothing here blocks a Gate or a workflow step,
 * and no model is involved. File-system facts (link targets outside the index) come
 * from the desktop indexer; everything else is derived from the indexed Markdown.
 */

export type KnowledgeCheckFinding =
  | { code: 'missing_front_matter'; sourcePath: string; reason: 'missing' | 'unclosed' }
  | { code: 'invalid_stage_value'; sourcePath: string; field: 'stages' | 'gate'; values: string[] }
  | { code: 'broken_link'; sourcePath: string; line: number; target: string; reason: 'missing' | 'outside_repository' }
  | { code: 'broken_anchor'; sourcePath: string; line: number; target: string; anchor: string }
  | { code: 'stage_over_budget'; stage: NodeStage; budgetBytes: number; requiredBytes: number; sourcePaths: string[] }
  | { code: 'instructions_truncated'; sourcePath: string; bytes: number; maxBytes: number }
  | { code: 'manifest_file_missing'; sourcePath: string; manifestCount: number; lastRecordedAt: string; stages: NodeStage[] }

export type KnowledgeCheckCode = KnowledgeCheckFinding['code']

export type RecordedKnowledgeContextManifest = {
  manifest: KnowledgeContextManifest
  recordedAt: string
}

export type KnowledgeDirectoryCheckInput = {
  documents: readonly KnowledgeDocument[]
  knowledgeRoot?: string | null
  projectInstructions?: ProjectInstructionsSnapshot | null
  linkTargets?: readonly RepositoryKnowledgeLinkTarget[]
  /** The index hit a limit, so a missing document may simply not have been indexed. */
  indexTruncated?: boolean
  /** Context manifests recorded by earlier model calls of this project. */
  recordedManifests?: readonly RecordedKnowledgeContextManifest[]
  budgetBytes?: number
}

export type KnowledgeDirectoryCheckReport = {
  findings: KnowledgeCheckFinding[]
  budgets: KnowledgeStageBudgetSummary[]
  /** Relative links inside the repository whose target was verified. */
  checkedLinkCount: number
  /** Relative links whose target the indexer did not resolve (bound reached or not followed). */
  uncheckedLinkCount: number
  manifestCheck: 'checked' | 'no_manifests' | 'index_truncated'
  checkedManifestCount: number
}

const CODE_ORDER: readonly KnowledgeCheckCode[] = [
  'missing_front_matter',
  'invalid_stage_value',
  'broken_link',
  'broken_anchor',
  'stage_over_budget',
  'instructions_truncated',
  'manifest_file_missing',
]

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

type ProseLine = { line: number; text: string }

const FENCE = /^ {0,3}(`{3,}|~{3,})/u

/** Lines outside front matter and fenced code blocks, with 1-based line numbers of the file. */
function proseLines(markdown: string): ProseLine[] {
  const lines = markdown.split(/\r?\n/u)
  let start = 0
  // Same boundary as the front matter parser: the first later line starting with `---`.
  if (markdown.startsWith('---')) {
    const close = lines.findIndex((line, index) => index > 0 && line.startsWith('---'))
    if (close !== -1) start = close + 1
  }
  const result: ProseLine[] = []
  let fence: string | undefined
  for (let index = start; index < lines.length; index += 1) {
    const text = lines[index]!
    const marker = FENCE.exec(text)?.[1]
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length &&
        text.trim().slice(marker.length).trim() === '') {
        fence = undefined
      }
      continue
    }
    if (marker) {
      fence = marker
      continue
    }
    result.push({ line: index + 1, text })
  }
  return result
}

function withoutInlineCode(text: string): string {
  return text.replace(/(`+)[\s\S]*?\1/gu, (match) => ' '.repeat(match.length))
}

const INLINE_LINK = /!?\[(?:[^\]\\]|\\.)*\]\(\s*(<[^>\n]*>|[^\s)]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/gu
const REFERENCE_DEFINITION = /^ {0,3}\[[^\]]+\]:\s*(<[^>\n]*>|\S+)/u

function stripAngleBrackets(target: string): string {
  return target.startsWith('<') && target.endsWith('>') ? target.slice(1, -1) : target
}

/** Inline links, images and reference definitions outside code, in file order. */
export function extractMarkdownLinks(markdown: string): Array<{ line: number; target: string }> {
  const links: Array<{ line: number; target: string }> = []
  for (const { line, text } of proseLines(markdown)) {
    const visible = withoutInlineCode(text)
    const definition = REFERENCE_DEFINITION.exec(visible)
    if (definition) {
      links.push({ line, target: stripAngleBrackets(definition[1]!) })
      continue
    }
    for (const match of visible.matchAll(INLINE_LINK)) {
      links.push({ line, target: stripAngleBrackets(match[1]!) })
    }
  }
  return links
}

const HEADING = /^ {0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/u
const HTML_ANCHOR = /<a\s[^>]*?\b(?:id|name)\s*=\s*(?:"([^"]*)"|'([^']*)')/giu

/** GitHub-style heading slug: lower case, punctuation removed, spaces as hyphens. */
function headingSlug(heading: string): string {
  return heading
    .replace(/<[^>]*>/gu, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /gu, '-')
}

/** Heading slugs (duplicates numbered `-1`, `-2`) and explicit `<a id>` / `<a name>` anchors. */
export function extractMarkdownAnchors(markdown: string): string[] {
  const anchors = new Set<string>()
  const slugCounts = new Map<string, number>()
  for (const { text } of proseLines(markdown)) {
    const visible = withoutInlineCode(text)
    for (const match of visible.matchAll(HTML_ANCHOR)) {
      const value = (match[1] ?? match[2] ?? '').trim()
      if (value) anchors.add(value)
    }
    const heading = HEADING.exec(visible)
    if (!heading) continue
    const slug = headingSlug(heading[1]!)
    if (!slug) continue
    const seen = slugCounts.get(slug) ?? 0
    slugCounts.set(slug, seen + 1)
    anchors.add(seen === 0 ? slug : `${slug}-${seen}`)
  }
  return [...anchors].sort(comparePaths)
}

export type ResolvedKnowledgeLink =
  | { kind: 'external' }
  | { kind: 'same_document'; anchor: string }
  | { kind: 'outside_repository' }
  /** `path` is repository-relative; `''` is the repository root. */
  | { kind: 'repository'; path: string; anchor?: string }

const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/iu

function safeDecode(value: string, decode: (value: string) => string): string {
  try {
    return decode(value)
  } catch {
    return value
  }
}

/**
 * Resolves a link written in `fromPath` the way GitHub renders it: relative to the
 * document, or to the repository root when it starts with `/`. URLs with a scheme,
 * protocol-relative URLs and empty targets are external and not checked.
 */
export function resolveKnowledgeLink(fromPath: string, target: string): ResolvedKnowledgeLink {
  const trimmed = target.trim()
  if (!trimmed || URL_SCHEME.test(trimmed) || trimmed.startsWith('//')) return { kind: 'external' }
  const hashIndex = trimmed.indexOf('#')
  const rawPath = (hashIndex === -1 ? trimmed : trimmed.slice(0, hashIndex)).replace(/\?.*$/u, '')
  const anchor = hashIndex === -1 ? '' : safeDecode(trimmed.slice(hashIndex + 1), decodeURIComponent)
  if (!rawPath) return anchor ? { kind: 'same_document', anchor } : { kind: 'external' }
  const decodedPath = safeDecode(rawPath, decodeURI)
  const segments = decodedPath.startsWith('/') ? [] : fromPath.split('/').slice(0, -1)
  for (const segment of decodedPath.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (segments.length === 0) return { kind: 'outside_repository' }
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  return { kind: 'repository', path: segments.join('/'), ...(anchor ? { anchor } : {}) }
}

/** Repository paths linked from the documents that are not indexed documents themselves. */
export function collectKnowledgeLinkTargetPaths(
  documents: readonly Pick<KnowledgeDocument, 'sourcePath' | 'markdown'>[],
): string[] {
  const indexed = new Set(documents.map((document) => document.sourcePath))
  const paths = new Set<string>()
  for (const document of documents) {
    for (const link of extractMarkdownLinks(document.markdown)) {
      const resolved = resolveKnowledgeLink(document.sourcePath, link.target)
      if (resolved.kind === 'repository' && resolved.path && !indexed.has(resolved.path)) {
        paths.add(resolved.path)
      }
    }
  }
  return [...paths].sort(comparePaths)
}

function hasAnchor(anchors: ReadonlySet<string>, anchor: string): boolean {
  return anchors.has(anchor) || anchors.has(anchor.toLowerCase())
}

function frontMatterFindings(document: KnowledgeDocument): KnowledgeCheckFinding[] {
  const frontMatter = readKnowledgeFrontMatter(document.markdown)
  if (frontMatter.status !== 'present') {
    return [{ code: 'missing_front_matter', sourcePath: document.sourcePath, reason: frontMatter.status }]
  }
  const findings: KnowledgeCheckFinding[] = []
  for (const field of ['stages', 'gate'] as const) {
    const value = frontMatter.fields[field]
    if (value === undefined) continue
    // `gate` accepts true/false; `stages` must be a list of stages.
    if (typeof value === 'boolean') {
      if (field === 'stages') {
        findings.push({ code: 'invalid_stage_value', sourcePath: document.sourcePath, field, values: [String(value)] })
      }
      continue
    }
    const invalid = knowledgeFrontMatterList(value)
      .map((item) => item.trim())
      .filter((item) => item && !isKnowledgeStage(item.toLowerCase()))
    if (invalid.length > 0) {
      findings.push({ code: 'invalid_stage_value', sourcePath: document.sourcePath, field, values: invalid })
    }
  }
  return findings
}

function stageIndex(stage: NodeStage): number {
  return KNOWLEDGE_STAGES.indexOf(stage)
}

function findingSortKey(finding: KnowledgeCheckFinding): [number, number, string, number] {
  return [
    CODE_ORDER.indexOf(finding.code),
    'stage' in finding ? stageIndex(finding.stage) : -1,
    'sourcePath' in finding ? finding.sourcePath : '',
    'line' in finding ? finding.line : 0,
  ]
}

function compareFindings(left: KnowledgeCheckFinding, right: KnowledgeCheckFinding): number {
  const a = findingSortKey(left)
  const b = findingSortKey(right)
  return a[0] - b[0] || a[1] - b[1] || comparePaths(a[2], b[2]) || a[3] - b[3]
}

export function checkKnowledgeDirectory(input: KnowledgeDirectoryCheckInput): KnowledgeDirectoryCheckReport {
  const documents = [...input.documents].sort((left, right) => comparePaths(left.sourcePath, right.sourcePath))
  const documentByPath = new Map(documents.map((document) => [document.sourcePath, document]))
  const linkTargets = new Map((input.linkTargets ?? []).map((target) => [target.path, target]))
  const anchorCache = new Map<string, ReadonlySet<string>>()
  const anchorsOf = (document: KnowledgeDocument): ReadonlySet<string> => {
    let anchors = anchorCache.get(document.sourcePath)
    if (!anchors) {
      anchors = new Set(extractMarkdownAnchors(document.markdown))
      anchorCache.set(document.sourcePath, anchors)
    }
    return anchors
  }
  const findings: KnowledgeCheckFinding[] = []
  let checkedLinkCount = 0
  let uncheckedLinkCount = 0

  for (const document of documents) {
    findings.push(...frontMatterFindings(document))
    for (const link of extractMarkdownLinks(document.markdown)) {
      const resolved = resolveKnowledgeLink(document.sourcePath, link.target)
      const at = { sourcePath: document.sourcePath, line: link.line, target: link.target }
      if (resolved.kind === 'external') continue
      if (resolved.kind === 'outside_repository') {
        checkedLinkCount += 1
        findings.push({ code: 'broken_link', ...at, reason: 'outside_repository' })
        continue
      }
      if (resolved.kind === 'same_document') {
        checkedLinkCount += 1
        if (!hasAnchor(anchorsOf(document), resolved.anchor)) {
          findings.push({ code: 'broken_anchor', ...at, anchor: resolved.anchor })
        }
        continue
      }
      if (!resolved.path) {
        checkedLinkCount += 1
        continue
      }
      const indexedTarget = documentByPath.get(resolved.path)
      if (indexedTarget) {
        checkedLinkCount += 1
        if (resolved.anchor && !hasAnchor(anchorsOf(indexedTarget), resolved.anchor)) {
          findings.push({ code: 'broken_anchor', ...at, anchor: resolved.anchor })
        }
        continue
      }
      const target = linkTargets.get(resolved.path)
      if (!target || target.kind === 'unsupported') {
        uncheckedLinkCount += 1
        continue
      }
      checkedLinkCount += 1
      if (target.kind === 'missing') {
        findings.push({ code: 'broken_link', ...at, reason: 'missing' })
        continue
      }
      if (resolved.anchor && target.kind === 'file' && target.anchors &&
        !hasAnchor(new Set(target.anchors), resolved.anchor)) {
        findings.push({ code: 'broken_anchor', ...at, anchor: resolved.anchor })
      }
    }
  }

  const budgets = summarizeKnowledgeStageBudgets(documents, input.budgetBytes)
  for (const budget of budgets) {
    if (budget.overBudgetPaths.length > 0) {
      findings.push({
        code: 'stage_over_budget',
        stage: budget.stage,
        budgetBytes: budget.budgetBytes,
        requiredBytes: budget.requiredBytes,
        sourcePaths: budget.overBudgetPaths,
      })
    }
  }
  const instructions = input.projectInstructions ?? null
  if (instructions?.truncated) {
    findings.push({
      code: 'instructions_truncated',
      sourcePath: instructions.sourcePath,
      bytes: instructions.bytes,
      maxBytes: PROJECT_INSTRUCTIONS_MAX_BYTES,
    })
  }

  const manifests = input.recordedManifests ?? []
  let checkedManifestCount = 0
  let manifestCheck: KnowledgeDirectoryCheckReport['manifestCheck'] = 'no_manifests'
  if (manifests.length > 0 && input.indexTruncated) {
    manifestCheck = 'index_truncated'
  } else if (manifests.length > 0) {
    const root = input.knowledgeRoot ?? null
    const missing = new Map<string, { count: number; lastRecordedAt: string; stages: Set<NodeStage> }>()
    for (const { manifest, recordedAt } of manifests) {
      // A manifest of another knowledge directory cannot be compared with this index.
      if ((manifest.knowledgeRoot ?? null) !== root) continue
      checkedManifestCount += 1
      const paths = new Set([...manifest.included, ...manifest.catalogued].map((entry) => entry.sourcePath))
      if (manifest.instructions) paths.add(manifest.instructions.sourcePath)
      for (const sourcePath of paths) {
        if (documentByPath.has(sourcePath) || sourcePath === instructions?.sourcePath) continue
        const entry = missing.get(sourcePath) ?? { count: 0, lastRecordedAt: recordedAt, stages: new Set<NodeStage>() }
        entry.count += 1
        if (recordedAt > entry.lastRecordedAt) entry.lastRecordedAt = recordedAt
        entry.stages.add(manifest.stage)
        missing.set(sourcePath, entry)
      }
    }
    if (checkedManifestCount > 0) manifestCheck = 'checked'
    for (const [sourcePath, entry] of missing) {
      findings.push({
        code: 'manifest_file_missing',
        sourcePath,
        manifestCount: entry.count,
        lastRecordedAt: entry.lastRecordedAt,
        stages: KNOWLEDGE_STAGES.filter((stage) => entry.stages.has(stage)),
      })
    }
  }

  return {
    findings: findings.sort(compareFindings),
    budgets,
    checkedLinkCount,
    uncheckedLinkCount,
    manifestCheck,
    checkedManifestCount,
  }
}
