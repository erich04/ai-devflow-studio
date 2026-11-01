import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import ts from 'typescript'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentReviewResult } from '@ai-devflow/shared'
import { gateCopy } from './app/gate-decision/copy'
import { spaceAfterVersion } from './app/version-spacing'
import { ReviewRerunDialog } from './views/ReviewRerunDialog'
import { GateReviewRunPanel } from './views/TaskWorkPanel'

afterEach(cleanup)
/** "不作为需求 v2的审查结果": a version number directly followed by Chinese misses a space (decision 77). */
const MISSING_SPACE = /v\d+\p{Script=Han}/u
const startsWithHan = /^\p{Script=Han}/u
const root = 'apps/desktop/src'
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return entry.name === 'testing' ? [] : sourceFiles(path)
    return /\.tsx?$/u.test(entry.name) && !/\.test\.tsx?$/u.test(entry.name) ? [path] : []
  })
}
// Values that name a version label: `${previous}`, `{currentLabel}`, `${version}`…
const VERSION_NAME = /^(label|version|target|previous|current|next|reading|older|reviewed)$|(Label|Version)$/u
// Labels with these names never end with a version number: executor and stage names.
const NOT_VERSIONS = new Set(['TaskWorkPanel.tsx:executorLabel', 'DesktopViews.tsx:stage.label'])
/** Whether the value of an interpolation can end with a version label. */
function endsWithVersion(expression: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(expression)) return endsWithVersion(expression.expression)
  if (ts.isConditionalExpression(expression)) return endsWithVersion(expression.whenTrue) || endsWithVersion(expression.whenFalse)
  if (ts.isBinaryExpression(expression) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(expression.operatorToken.kind)) {
    return endsWithVersion(expression.left) || endsWithVersion(expression.right)
  }
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return /v\d+$/u.test(expression.text)
  if (ts.isTemplateExpression(expression)) {
    const last = expression.templateSpans.at(-1)!
    return last.literal.text ? /v\d+$/u.test(last.literal.text) : endsWithVersion(last.expression)
  }
  if (ts.isCallExpression(expression) && expression.expression.getText() === 'spaceAfterVersion') return false
  const names: string[] = []
  const collect = (node: ts.Node) => { if (ts.isIdentifier(node)) names.push(node.text); ts.forEachChild(node, collect) }
  collect(expression)
  return names.some((name) => VERSION_NAME.test(name))
}
/** Text JSX renders from a text node: a leading run of whitespace with a newline is dropped. */
const jsxText = (node: ts.JsxText) => (/\n/u.test(/^\s*/u.exec(node.text)![0]) ? node.text.replace(/^\s+/u, '') : node.text)
/** User-visible text with a version number right before Chinese: literals, and version labels interpolated right before Chinese. */
function missingSpaces(file: string, code = readFileSync(file, 'utf8')): string[] {
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const name = file.split('/').at(-1)!
  const found: string[] = []
  const report = (node: ts.Node, text: string) => found.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1} ${text}`)
  const interpolated = (node: ts.Node, expression: ts.Expression, next: string) => {
    if (startsWithHan.test(next) && endsWithVersion(expression) && !NOT_VERSIONS.has(`${name}:${expression.getText()}`)) report(node, `{${expression.getText()}}${next.slice(0, 8)}`)
  }
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node)) {
      if (MISSING_SPACE.test(node.text)) report(node, node.text.trim())
    }
    if (ts.isTemplateSpan(node)) interpolated(node, node.expression, node.literal.text)
    if (ts.isJsxExpression(node) && node.expression && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      const siblings = node.parent.children
      const next = siblings[siblings.indexOf(node) + 1]
      if (next && ts.isJsxText(next)) interpolated(node, node.expression, jsxText(next))
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

describe('a space after a version number before Chinese text (decision 77)', () => {
  it('adds the space only after a version number', () => {
    expect(spaceAfterVersion('需求 v2')).toBe('需求 v2 ')
    expect(spaceAfterVersion('方案 v12')).toBe('方案 v12 ')
    expect(spaceAfterVersion('之前的版本')).toBe('之前的版本')
    expect(spaceAfterVersion('方案（记录于 10-30 08:40）')).toBe('方案（记录于 10-30 08:40）')
  })
  it('finds no version number followed by Chinese in apps/desktop/src, and no version label interpolated right before Chinese', () => {
    const files = sourceFiles(root)
    expect(files.length).toBeGreaterThan(100)
    expect(files.flatMap((file) => missingSpaces(file))).toEqual([])
    // The scan catches the forms it guards against and accepts the spaced one.
    expect([
      'const a = "不作为需求 v2的结果"',
      'const b = (previous: string) => `${previous}的审查结果`',
      'const c = (currentLabel: string) => <p>不作为{currentLabel}的审查结果</p>',
      'const d = (currentLabel: string) => <p>不作为{currentLabel}\n  的审查结果</p>',
      'const e = (target?: string) => `${target ?? "需求 v2"}的结果`',
      'const f = (target: string) => `不作为${spaceAfterVersion(target)}的结果`',
      'const g = (providerLabel?: string) => `${providerLabel ? `使用 ${providerLabel}。` : ""}审查只提供建议`',
    ].map((code) => missingSpaces('probe.tsx', code).length)).toEqual([1, 1, 1, 1, 1, 0, 0])
  })
  it('renders the re-review dialog and the review panel with the space', () => {
    // Each line of text on its own: textContent of a whole dialog would join a heading to the next paragraph.
    const lines = () => Array.from(document.body.querySelectorAll('h2, p, button, strong')).map((element) => element.textContent ?? '')
    render(<ReviewRerunDialog target="需求 v2" context="任务 · 需求确认" provider="Fake" reviewedAt="10-30 08:10" reviewedLabel="需求 v1" appliesToCurrent={false} onCancel={() => {}} onConfirm={() => {}} />)
    expect(lines()).toContain('继续会调用 Provider 审查需求 v2，新增审查记录和 token 用量，并可能产生 Provider 费用。需求 v1 的审查结果保留在历史记录中，不作为需求 v2 的结果。')
    expect(lines().filter((line) => MISSING_SPACE.test(line))).toEqual([])
    cleanup()
    render(<ReviewRerunDialog target="需求 v2" context="任务" provider="Fake" reviewedAt="10-30 08:10" reviewedLabel={undefined} appliesToCurrent={false} onCancel={() => {}} onConfirm={() => {}} />)
    expect(document.body.textContent).toContain('之前的版本的审查结果保留在历史记录中，不作为需求 v2 的结果。')
    cleanup()
    const review = { id: 'r', createdAt: '2026-10-30T08:10:00.000Z', model: 'fake-model' } as AgentReviewResult
    render(<GateReviewRunPanel latestReview={review} reviewScope={{ appliesToCurrent: false, reviewedLabel: '需求 v1' }} currentLabel="需求 v2" failure={undefined}
      isRunning={false} providerLabel="Fake" blockedReason={undefined} isWriteLocked={false} showRunButton={false} onRequestRun={() => {}} />)
    expect(document.body.textContent).toContain('不作为需求 v2 的审查结果')
    expect(lines().filter((line) => MISSING_SPACE.test(line))).toEqual([])
  })
  it('keeps every gate page text spaced for version labels and version numbers', () => {
    const patterns: unknown[][] = [
      Array(4).fill('需求 v2'), ['requirement', ...Array(3).fill('需求 v2')], ['design', ...Array(3).fill('方案 v3')], Array(4).fill(2), ['requirement', 2, 1, 3],
    ]
    let checked = 0
    for (const [key, value] of Object.entries(gateCopy)) {
      const texts = typeof value === 'function'
        ? patterns.flatMap((args) => { try { return [(value as (...input: unknown[]) => unknown)(...args)] } catch { return [] } })
        : [value]
      expect(texts.length, key).toBeGreaterThan(0)
      for (const text of texts) if (typeof text === 'string') { expect(text, key).not.toMatch(MISSING_SPACE); checked++ }
    }
    expect(checked).toBeGreaterThan(200)
  })
})
