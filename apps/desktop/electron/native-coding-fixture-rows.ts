import ts from 'typescript'

export type FixtureRow = { parameters: string[]; arguments: string[]; label: string }

function literal(node: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node))
    return literal(node.expression)
  if (ts.isArrayLiteralExpression(node)) return node.elements.every(literal)
  if (ts.isObjectLiteralExpression(node))
    return node.properties.every(
      (p) =>
        ts.isPropertyAssignment(p) &&
        (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) || ts.isNumericLiteral(p.name)) &&
        literal(p.initializer),
    )
  if (ts.isPrefixUnaryExpression(node))
    return node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)
  return (
    ts.isStringLiteralLike(node) ||
    ts.isNumericLiteral(node) ||
    [ts.SyntaxKind.NullKeyword, ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword].includes(node.kind)
  )
}

/** Enumerate only public data rows. Never evaluate a fixture, template tag,
 * factory, getter, spread or computed key while building the private menu. */
export function staticFixtureRows(
  call: ts.CallExpression,
  callback: ts.ArrowFunction | ts.FunctionExpression,
  tree: ts.SourceFile,
): FixtureRow[] {
  const each = call.expression
  if (
    !ts.isCallExpression(each) ||
    !ts.isPropertyAccessExpression(each.expression) ||
    each.expression.name.text !== 'each' ||
    !ts.isIdentifier(each.expression.expression) ||
    each.arguments.length !== 1 ||
    !ts.isArrayLiteralExpression(each.arguments[0]!)
  )
    return []
  const table = each.arguments[0]!
  if (
    table.elements.length > 16 ||
    !callback.parameters.length ||
    callback.parameters.some((p) => !ts.isIdentifier(p.name) || p.dotDotDotToken || p.initializer)
  )
    return []
  const parameters = callback.parameters.map((p) => p.name.getText(tree))
  const rows: FixtureRow[] = []
  for (const entry of table.elements) {
    if (!literal(entry) || entry.end - entry.getStart(tree) > 1024) return []
    let value: ts.Expression = entry
    while (ts.isAsExpression(value) || ts.isSatisfiesExpression(value) || ts.isParenthesizedExpression(value))
      value = value.expression
    const args = ts.isArrayLiteralExpression(value) ? value.elements.map((e) => e.getText(tree)) : [entry.getText(tree)]
    if (parameters.length !== args.length) return []
    const label = parameters
      .map((name, i) => name + '=' + args[i])
      .join(', ')
      .replace(/\s+/gu, ' ')
      .slice(0, 240)
    rows.push({ parameters, arguments: args, label })
  }
  return rows
}
