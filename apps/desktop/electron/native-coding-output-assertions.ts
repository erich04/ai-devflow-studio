import ts from 'typescript'
import { InvalidFixtureDraft } from './native-coding-fixture-cases'

function observedAliases(fileName: string, body: string): string[][] {
  if (!body.includes('??')) return []
  const tree = ts.createSourceFile(
    fileName,
    body,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const assertions: ts.Expression[] = []
  const chains: ts.BinaryExpression[] = []
  function collect(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'expect' &&
      node.arguments[0]
    )
      assertions.push(node.arguments[0])
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken &&
      !(ts.isBinaryExpression(node.parent) && node.parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
    )
      chains.push(node)
    ts.forEachChild(node, collect)
  }
  collect(tree)
  function parts(node: ts.Expression): ts.Expression[] {
    if (ts.isParenthesizedExpression(node)) return parts(node.expression)
    return ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      ? [...parts(node.left), ...parts(node.right)]
      : [node]
  }
  function path(node: ts.Expression): string[] | undefined {
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node))
      return path(node.expression)
    if (ts.isIdentifier(node)) return [node.text]
    if (!ts.isPropertyAccessExpression(node)) return undefined
    const parent = path(node.expression)
    return parent && [...parent, node.name.text]
  }
  const found: string[][] = []
  for (const chain of chains) {
    const values = parts(chain).map(path)
    if (values.length < 3 || values.some((v) => !v || v.length < 2 || v[0] !== values[0]?.[0])) continue
    const fields = [...new Set(values.map((v) => v!.slice(1).join('.')))]
    if (fields.length < 3) continue
    let outer: ts.Node = chain
    while (ts.isParenthesizedExpression(outer.parent) || ts.isAsExpression(outer.parent)) outer = outer.parent
    const alias =
      ts.isVariableDeclaration(outer.parent) && ts.isIdentifier(outer.parent.name) ? outer.parent.name.text : undefined
    const inAssertion = assertions.some((arg) => {
      if (arg.pos <= chain.pos && arg.end >= chain.end) return true
      if (!alias || arg.pos < chain.end) return false
      function uses(n: ts.Node): boolean {
        return (
          (ts.isIdentifier(n) && n.text === alias && !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n)) ||
          ts.forEachChild(n, (c) => uses(c) || undefined) === true
        )
      }
      return uses(arg)
    })
    if (inAssertion) found.push(fields)
  }
  return found
}

/** An assertion should observe the affected record's real contract. Guessing
 * many different names on one result can reject a correct implementation.
 * Preserve aliases explicitly approved or already used by the public fixture. */
export function checkObservedResultFields(file: string, control: string, variant: string, approved: string) {
  const candidates = observedAliases(file, variant)
  if (!candidates.length) return
  const baseline = observedAliases(file, control).map((fields) => JSON.stringify(fields))
  const named = new Set(approved.match(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/gu) ?? [])
  for (const fields of candidates) {
    if (baseline.includes(JSON.stringify(fields)) || fields.every((f) => named.has(f))) continue
    throw new InvalidFixtureDraft(
      `Unverified result aliases in a behavioral assertion (${fields.slice(0, 7).join(', ')}). Trace the requested outcome to its documented public record or reader in B. Use the authoritative field and exercise the operation that owns it.`,
    )
  }
}
