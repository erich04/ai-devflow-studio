/**
 * Reading blocks of the gate material (design §3.25, §5.2). The offset parser gets the GFM
 * extensions `remark-gfm` registers, so tables and code blocks get the positions they have in the
 * rendered DOM. Nothing here imports `unified` or mdast types: only `mdast-util-from-markdown`'s
 * `Options` and a local node type are used.
 */
import { fromMarkdown, type Options } from 'mdast-util-from-markdown'
import remarkGfm from 'remark-gfm'
import { clarificationRevisionNumber, type Artifact } from '@ai-devflow/shared'
import { PLACEHOLDER_TEXT_PATTERN, partitionArtifact } from '../artifact-sections'
import { formatLocalTime } from '../desktop-view-model'
import { gateCopy, type GateKind } from './copy'
import { parseRevisionTextHeader } from './revision-list'
let cached: Options | undefined
export function gfmParseOptions(): Options {
  if (cached) return cached
  const data: { micromarkExtensions?: unknown[]; fromMarkdownExtensions?: unknown[] } = {}
  remarkGfm.call({ data: () => data } as never)              // same call react-markdown makes, without options
  cached = { extensions: data.micromarkExtensions, mdastExtensions: data.fromMarkdownExtensions } as Options
  return cached
}
type MdNode = { type: string; spread?: boolean | null; children?: MdNode[]; data?: { hProperties?: Record<string, unknown> } }
// Copy of mdast-util-to-hast 13.2.1 lib/handlers/list-item.js (listLoose, listItemLoose).
const isLooseItem = (item: MdNode) => item.spread ?? ((item.children?.length ?? 0) > 1)
export const isLooseList = (list: MdNode) => Boolean(list.spread) || (list.children ?? []).some(isLooseItem)
/** Render-tree plugin for gate pages: every list item paragraph keeps its own `<p>` (§3.25). */
export function remarkKeepListParagraphs() {
  return (tree: MdNode) => {
    const visit = (node: MdNode) => {
      if (node.type === 'list') {
        if (!isLooseList(node)) node.data = { ...node.data, hProperties: { ...node.data?.hProperties, dataGateTight: 'true' } }
        node.spread = true                                    // every item paragraph keeps its <p>
      }
      node.children?.forEach(visit)
    }
    visit(tree)
  }
}
export type Range = { start: number; end: number }
/** `${start}:${end}` of a reading block = its element's data attributes. */
export type BlockKey = `${number}:${number}`
export type ReadingBlock = Range & { kind: 'paragraph' | 'table' | 'code' }
export type BlockIndex = {
  blocks: ReadingBlock[]
  blockAt(offset: number): ReadingBlock | undefined
  intersecting(range: Range): ReadingBlock[]
}
export const blockKey = (range: Range): BlockKey => `${range.start}:${range.end}`
export function parseBlockKey(key: BlockKey): Range {
  const [start, end] = key.split(':').map(Number) as [number, number]
  return { start, end }
}
type PositionedNode = MdNode & { position?: { start: { offset?: number }; end: { offset?: number } } }
function visitBlocks(node: PositionedNode, offset: number, push: (block: ReadingBlock, node: PositionedNode) => void) {
  if (node.type === 'paragraph' || node.type === 'table' || node.type === 'code') {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start !== undefined && end !== undefined) push({ start: offset + start, end: offset + end, kind: node.type }, node)
    return                                                    // never descend into a block
  }
  for (const child of (node.children ?? []) as PositionedNode[]) visitBlocks(child, offset, push)
}
const readableSections = (content: string) => partitionArtifact(content).filter((section) => section.group !== 'evidence' && section.group !== 'records')
/** Paragraph, table and code blocks of the readable sections, in document order (§3.25). */
export function gateReadingBlocks(content: string): ReadingBlock[] {
  const blocks: ReadingBlock[] = []
  for (const section of readableSections(content)) {
    const tree = fromMarkdown(section.markdown, gfmParseOptions()) as unknown as PositionedNode
    visitBlocks(tree, section.start, (block) => blocks.push(block))
  }
  return blocks
}
export function indexReadingBlocks(blocks: readonly ReadingBlock[]): BlockIndex {
  const sorted = [...blocks].sort((a, b) => a.start - b.start)
  return {
    blocks: sorted,
    blockAt(offset) {
      let low = 0
      let high = sorted.length - 1
      while (low <= high) {
        const middle = (low + high) >> 1
        const block = sorted[middle]!
        if (offset < block.start) high = middle - 1
        else if (offset >= block.end) low = middle + 1
        else return block
      }
      return undefined
    },
    intersecting(range) {
      return sorted.filter((block) => block.start < range.end && block.end > range.start)
    },
  }
}
const normalise = (text: string) => text.replace(/\s+/gu, ' ').trim()
export type LocatedQuestion = { number: number; text: string; range?: Range }
/**
 * Open questions of a requirement, each matched to its item in 「待确认问题」 by whitespace-normalised
 * equality with the item's first paragraph. Only a unique match is located; placeholders are dropped.
 */
export function locateOpenQuestions(content: string, openQuestions: readonly string[]): LocatedQuestion[] {
  const items: Array<{ text: string; range: Range }> = []
  for (const section of readableSections(content).filter((item) => item.title === '待确认问题')) {
    const tree = fromMarkdown(section.markdown, gfmParseOptions()) as unknown as PositionedNode
    const visit = (node: PositionedNode) => {
      if (node.type === 'listItem') {
        const paragraph = (node.children ?? []).find((child) => child.type === 'paragraph') as PositionedNode | undefined
        const start = paragraph?.position?.start.offset
        const end = paragraph?.position?.end.offset
        if (start !== undefined && end !== undefined) items.push({ text: normalise(section.markdown.slice(start, end)), range: { start: section.start + start, end: section.start + end } })
      }
      for (const child of (node.children ?? []) as PositionedNode[]) visit(child)
    }
    visit(tree)
  }
  return openQuestions
    .filter((question) => question.trim() && !PLACEHOLDER_TEXT_PATTERN.test(question.trim()))
    .map((question, position) => {
      const matches = items.filter((item) => item.text === normalise(question))
      return { number: position + 1, text: question, ...(matches.length === 1 ? { range: matches[0]!.range } : {}) }
    })
}
/** Blocks of `current` whose normalised text is not part of the previous version (AC36). */
export function newBlocks(current: string, previous: string | undefined): BlockKey[] {
  if (previous === undefined) return []
  const before = normalise(previous)
  return gateReadingBlocks(current).filter((block) => !before.includes(normalise(current.slice(block.start, block.end)))).map(blockKey)
}
/** The material header line (§5.8); "记录于 …" is `recordedAtLine`. */
export function materialHeader(input: { kind: GateKind; artifact: Artifact; artifacts: readonly Artifact[]; number?: number; designNumbers?: ReadonlyMap<string, number> }): string {
  const { artifact } = input
  if (input.kind === 'requirement') {
    const metadata = artifact.clarificationRevision
    if (!metadata) return gateCopy.headerRequirementLegacy
    const number = clarificationRevisionNumber(artifact)
    if (!metadata.previousRevisionArtifactId) return number === 1 ? gateCopy.headerRequirementV1 : gateCopy.headerRequirementNextFree(number, number - 1)
    const previous = input.artifacts.find((item) => item.id === metadata.previousRevisionArtifactId)
    const previousNumber = previous ? clarificationRevisionNumber(previous) : number - 1
    const feedback = input.artifacts
      .filter((item) => item.kind === 'clarification_feedback' && item.clarificationFeedback?.targetArtifactId === metadata.previousRevisionArtifactId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
    const count = feedback ? parseRevisionTextHeader(feedback.content)?.count : undefined
    return count === undefined ? gateCopy.headerRequirementNextFree(number, previousNumber) : gateCopy.headerRequirementNext(number, previousNumber, count)
  }
  const number = input.number ?? input.designNumbers?.get(artifact.id)
  const version = number === undefined ? undefined : `方案 v${number}`
  if (!artifact.designRevision) {
    const requirement = artifact.designEvidence?.clarification
    if (number !== undefined && number !== 1) return gateCopy.headerDesignUnnumbered(version!)
    if (number === undefined) return gateCopy.headerDesignUnnumbered(`方案（记录于 ${formatLocalTime(artifact.updatedAt)}）`)
    return requirement && !requirement.legacy && requirement.revision !== undefined ? gateCopy.headerDesignV1(requirement.revision) : gateCopy.headerDesignV1Legacy
  }
  const lineage = artifact.designRevision
  const previousNumber = input.designNumbers?.get(lineage.previous.artifactId)
  const previousLabel = previousNumber === undefined ? '上一版方案' : `方案 v${previousNumber}`
  const count = (lineage.changeRequest ? parseRevisionTextHeader(lineage.changeRequest)?.count : undefined) ?? lineage.proposals.length
  return gateCopy.headerDesignNext(version ?? `方案（记录于 ${formatLocalTime(artifact.updatedAt)}）`, previousLabel, count)
}
export const recordedAtLine = (artifact: Pick<Artifact, 'updatedAt'>) => gateCopy.recordedAt(formatLocalTime(artifact.updatedAt))
/** "原始需求：{first line}…" (§5.8); the ellipsis is added only when more text follows. */
export function rawRequestLine(text: string): string {
  const lines = text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
  const first = lines[0] ?? ''
  return gateCopy.rawRequest(lines.length > 1 ? `${first}…` : first)
}
